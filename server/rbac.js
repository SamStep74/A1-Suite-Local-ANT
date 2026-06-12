"use strict";

/**
 * A1 RBAC — pure engine (Phase 9: M14.3 RLS + M14.5 RBAC).
 *
 * Pattern A: CJS module, no Fastify imports, all functions take `db`
 * as the first parameter so the route layer in server/app.js owns
 * the Fastify surface, auth, app-access, validation, and the audit
 * (global audit_events) writes. The engine writes to the rbac-local
 * `rbac_audit` table (the contract-mandated RBAC event log); the
 * route layer can additionally write to `audit_events` if desired.
 *
 * What this engine enforces (per contract §2.5):
 *   1. RLS: every check requires `user.org_id === orgId`; mismatch
 *      throws RbacError("ORG_MISMATCH").
 *   2. RBAC: every check consults the user's effective permission
 *      set, computed from rbac_user_roles → rbac_role_permissions.
 *   3. Owner short-circuit: if the user holds the `owner` role in
 *      the target org, all 29 permissions are allowed.
 *   4. Audit on every denial: writes rbac_audit (action:
 *      "permission.denied") with the reason in the detail JSON.
 *
 * Idempotent: ensureRbacSchema + the grantRole/revokeRole helpers
 * use UNIQUE (org_id, user_id, role_id) on rbac_user_roles + the
 * INSERT OR IGNORE pattern, so re-granting the same role is a no-op.
 *
 * The 29 permission codes + the 5×N matrix live here as the
 * source of truth. The TypeScript const in
 * web-modern/src/lib/rbac/permissions.ts mirrors the same set; the
 * verifier cross-checks both layers against the contract.
 */

const crypto = require("node:crypto");

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}

function nowIso() { return new Date().toISOString(); }

// ─── Error ──────────────────────────────────────────────────────────────

class RbacError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RbacError";
    this.statusCode = 403;
    this.code = code;
  }
}

// ─── Permission codes (the 29, per contract §2.3) ──────────────────────

const PERMISSIONS = Object.freeze([
  // crm.tube
  "crm.tube.access",
  // crm.deal
  "crm.deal.read",
  "crm.deal.create",
  "crm.deal.update",
  "crm.deal.delete",
  "crm.deal.move_stage",
  // crm.contact
  "crm.contact.read",
  "crm.contact.create",
  "crm.contact.update",
  "crm.contact.delete",
  "crm.contact.enrich",
  // crm.sequence
  "crm.sequence.read",
  "crm.sequence.create",
  "crm.sequence.update",
  "crm.sequence.delete",
  "crm.sequence.enroll",
  // crm.integration
  "crm.integration.read",
  "crm.integration.manage",
  // finance.report
  "finance.report.read",
  "finance.report.create",
  "finance.report.approve",
  // inventory.balance
  "inventory.balance.read",
  "inventory.balance.write",
  // cfo.snapshot
  "cfo.snapshot.read",
  "cfo.snapshot.approve",
  "cfo.snapshot.run",
  // audit
  "audit.read",
  // org
  "org.user.manage",
  "org.settings.manage"
]);

// ─── Permission matrix (the 5×N table, per contract §2.3) ─────────────

// Owner = all 29. Admin = all except org.user.manage.
// Accountant = all *read* and *create* + finance.approve + cfo.run;
//   no *delete*, no integration.manage, no org.*.
// Operator = CRM + inventory only; no finance, no cfo, no audit, no org.
// Viewer = the 8 read-class permissions.
const PERMISSIONS_BY_ROLE = Object.freeze({
  owner: Object.freeze([...PERMISSIONS]),
  admin: Object.freeze([
    "crm.tube.access",
    "crm.deal.read", "crm.deal.create", "crm.deal.update", "crm.deal.delete", "crm.deal.move_stage",
    "crm.contact.read", "crm.contact.create", "crm.contact.update", "crm.contact.delete", "crm.contact.enrich",
    "crm.sequence.read", "crm.sequence.create", "crm.sequence.update", "crm.sequence.delete", "crm.sequence.enroll",
    "crm.integration.read", "crm.integration.manage",
    "finance.report.read", "finance.report.create", "finance.report.approve",
    "inventory.balance.read", "inventory.balance.write",
    "cfo.snapshot.read", "cfo.snapshot.approve", "cfo.snapshot.run",
    "audit.read",
    "org.settings.manage"
  ]),
  accountant: Object.freeze([
    "crm.tube.access",
    "crm.deal.read", "crm.deal.create", "crm.deal.update", "crm.deal.move_stage",
    "crm.contact.read", "crm.contact.create", "crm.contact.update", "crm.contact.enrich",
    "crm.sequence.read", "crm.sequence.create", "crm.sequence.update", "crm.sequence.enroll",
    "crm.integration.read",
    "finance.report.read", "finance.report.create", "finance.report.approve",
    "inventory.balance.read", "inventory.balance.write",
    "cfo.snapshot.read", "cfo.snapshot.approve", "cfo.snapshot.run",
    "audit.read"
  ]),
  operator: Object.freeze([
    "crm.tube.access",
    "crm.deal.read", "crm.deal.create", "crm.deal.update", "crm.deal.move_stage",
    "crm.contact.read", "crm.contact.create", "crm.contact.update", "crm.contact.enrich",
    "crm.sequence.read", "crm.sequence.create", "crm.sequence.update", "crm.sequence.enroll",
    "crm.integration.read",
    "inventory.balance.read", "inventory.balance.write"
  ]),
  viewer: Object.freeze([
    "crm.tube.access",
    "crm.deal.read",
    "crm.contact.read",
    "crm.sequence.read",
    "crm.integration.read",
    "finance.report.read",
    "inventory.balance.read",
    "cfo.snapshot.read"
  ])
});

// ─── Pure lookups ──────────────────────────────────────────────────────

/**
 * Returns the set of permission codes granted to a role by the
 * static §2.3 matrix. Pure: no DB. Used by tests + by the demo
 * route that lists a user's effective permissions.
 */
function permissionsForRole(roleCode) {
  return new Set(PERMISSIONS_BY_ROLE[roleCode] || []);
}

/**
 * Effective permissions for a user within an org, computed from
 * rbac_user_roles → rbac_role_permissions. The `owner` role is a
 * short-circuit (per contract §2.5.1.b): the user gets the full 29.
 *
 * Returns an empty Set if the user has no roles in this org.
 */
function effectivePermissionsFor(db, userId, orgId) {
  const rows = db
    .prepare(`
      SELECT r.code AS code
      FROM rbac_user_roles ur
      JOIN rbac_roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND ur.org_id = ?
    `)
    .all(userId, orgId);
  if (rows.length === 0) return new Set();
  if (rows.some(r => r.code === "owner")) return new Set(PERMISSIONS);
  const out = new Set();
  for (const row of rows) {
    const set = PERMISSIONS_BY_ROLE[row.code];
    if (!set) continue;
    for (const p of set) out.add(p);
  }
  return out;
}

// ─── rbac_audit writes ─────────────────────────────────────────────────

function writeAudit(db, orgId, userId, action, resource, detail) {
  db.prepare(`
    INSERT INTO rbac_audit (id, org_id, user_id, action, resource, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomId("rbac-aud"),
    orgId,
    userId || null,
    action,
    resource || null,
    JSON.stringify(detail || {}),
    nowIso()
  );
}

function findRoleIdByCode(db, code) {
  const row = db.prepare("SELECT id FROM rbac_roles WHERE code = ?").get(code);
  return row ? row.id : null;
}

// ─── The gate (RLS + RBAC) ─────────────────────────────────────────────

/**
 * Throws RbacError on denial. Returns void on success.
 *
 *   - RbacError("NOT_AUTHENTICATED") if user is missing.
 *   - RbacError("ORG_MISMATCH") if user.org_id !== orgId.
 *   - RbacError("PERMISSION_DENIED") if the user's effective
 *     permission set does not contain `permission`.
 *
 * Writes rbac_audit (action: "permission.denied") on every throw.
 * The "permission.granted" audit row is written by grantRole, not
 * here — a successful requirePermission call is the absence of a
 * denial, not an event in itself.
 */
function requirePermission(db, user, orgId, permission) {
  if (!user || !user.id) {
    throw new RbacError("NOT_AUTHENTICATED", "User is not authenticated");
  }
  if (user.org_id !== orgId) {
    writeAudit(db, orgId, user.id, "permission.denied", permission, {
      reason: "ORG_MISMATCH",
      userOrgId: user.org_id || null,
      targetOrgId: orgId
    });
    throw new RbacError("ORG_MISMATCH", "Cannot act across org boundaries");
  }
  const effective = effectivePermissionsFor(db, user.id, orgId);
  if (!effective.has(permission)) {
    writeAudit(db, orgId, user.id, "permission.denied", permission, {
      reason: "PERMISSION_DENIED",
      userOrgId: user.org_id
    });
    throw new RbacError("PERMISSION_DENIED", `Missing permission: ${permission}`);
  }
}

// ─── Grant / revoke (admin surface; not gated by requirePermission) ────

/**
 * INSERT OR IGNORE the (org_id, user_id, role_id) row in
 * rbac_user_roles. Idempotent. Writes rbac_audit
 * (action: "permission.granted"). Throws RbacError("ROLE_NOT_FOUND")
 * if the roleCode is not one of the 5 seeded roles.
 */
function grantRole(db, granterUser, orgId, userId, roleCode) {
  const roleId = findRoleIdByCode(db, roleCode);
  if (!roleId) {
    throw new RbacError("ROLE_NOT_FOUND", `Unknown role: ${roleCode}`);
  }
  db.prepare(`
    INSERT OR IGNORE INTO rbac_user_roles
      (id, org_id, user_id, role_id, granted_by_user_id, granted_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    randomId("rbac-ur"),
    orgId,
    userId,
    roleId,
    granterUser && granterUser.id ? granterUser.id : null,
    nowIso()
  );
  writeAudit(
    db,
    orgId,
    granterUser && granterUser.id ? granterUser.id : null,
    "permission.granted",
    roleCode,
    { targetUserId: userId, roleCode }
  );
}

/**
 * DELETE the (org_id, user_id, role_id) row from rbac_user_roles.
 * Idempotent (DELETE of a missing row is a no-op). Writes rbac_audit
 * (action: "permission.revoked"). Throws RbacError("ROLE_NOT_FOUND")
 * if the roleCode is not one of the 5 seeded roles.
 */
function revokeRole(db, revokerUser, orgId, userId, roleCode) {
  const roleId = findRoleIdByCode(db, roleCode);
  if (!roleId) {
    throw new RbacError("ROLE_NOT_FOUND", `Unknown role: ${roleCode}`);
  }
  db.prepare(`
    DELETE FROM rbac_user_roles
    WHERE org_id = ? AND user_id = ? AND role_id = ?
  `).run(orgId, userId, roleId);
  writeAudit(
    db,
    orgId,
    revokerUser && revokerUser.id ? revokerUser.id : null,
    "permission.revoked",
    roleCode,
    { targetUserId: userId, roleCode }
  );
}

module.exports = {
  RbacError,
  PERMISSIONS,
  PERMISSIONS_BY_ROLE,
  permissionsForRole,
  effectivePermissionsFor,
  requirePermission,
  grantRole,
  revokeRole
};
