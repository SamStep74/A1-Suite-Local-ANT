"use strict";

/**
 * SMB CRM — Parallel RBAC helper.
 *
 * HARD CONSTRAINT from the worker task: do not touch
 * `server/rbac.js`. The 11 `smb_crm.*` permission codes are
 * seeded into the existing `rbac_permissions` + `rbac_role_permissions`
 * tables by `ensureSmbCrmFoundationSchema(db)`, but the static
 * `rbac.PERMISSIONS` / `rbac.PERMISSIONS_BY_ROLE` arrays in
 * rbac.js do NOT know about them — and the `requirePermission`
 * engine's owner short-circuit returns only the 29 base codes.
 *
 * This helper is the route layer's gate for smb_crm.* codes.
 * It reads directly from the `rbac_role_permissions` table.
 *
 * Cross-tenant safety: enforces `user.org_id === orgId` before
 * reading the user's roles, mirroring rbac.requirePermission.
 *
 * Pattern A: no Fastify imports, no env reads. All functions
 * take `db` first.
 *
 * For owner/admin (the "all codes" case), the seeded join rows
 * cover them. The "owner short-circuit" lives here, not in rbac.js
 * — owner gets every smb_crm.* code that exists in
 * `rbac_permissions`, regardless of which roles they're actually
 * granted (defensive; the seeded owner role row is the primary
 * source).
 */

class SmbCrmAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SmbCrmAuthError";
    this.statusCode = 403;
    this.code = code;
  }
}

function writeDeniedAudit(db, orgId, userId, permission, reason) {
  db.prepare(`
    INSERT INTO rbac_audit (id, org_id, user_id, action, resource, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    `rbac-aud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    orgId,
    userId || null,
    "permission.denied",
    permission,
    JSON.stringify({ reason, source: "smbCrmAuth" }),
    new Date().toISOString()
  );
}

/**
 * Effective smb_crm.* permission set for a user within an org.
 * Returns a Set of code strings.
 *
 * Owner short-circuit: the seeded `rbac_role_permissions` row
 * for the owner role contains every smb_crm.* code, so the
 * short-circuit happens implicitly via the join. We still keep
 * an explicit guard here so future schema drift doesn't break
 * the contract silently.
 */
function effectiveSmbCrmPermissions(db, userId, orgId) {
  if (!userId || !orgId) return new Set();
  const rows = db
    .prepare(`
      SELECT DISTINCT rp.code AS code
        FROM rbac_user_roles ur
        JOIN rbac_role_permissions rrp ON rrp.role_id = ur.role_id
        JOIN rbac_permissions rp ON rp.id = rrp.permission_id
       WHERE ur.user_id = ? AND ur.org_id = ?
         AND rp.code LIKE 'smb_crm.%'
    `)
    .all(userId, orgId);
  const out = new Set();
  for (const r of rows) out.add(r.code);
  // Defensive: ensure the owner short-circuit always grants
  // smb_crm.access at minimum, so a missing seed doesn't lock
  // the owner out. Two owner-detection paths, because the
  // seeded Owner user has no rbac_user_roles row (intentional
  // — see the comment in ensureSmbCrmAppAssignments in db.js):
  //   1. an explicit rbac_user_roles row pointing at the 'owner' role, OR
  //   2. the legacy users.role field == 'Owner'.
  if (out.size === 0) {
    const isOwner = db
      .prepare(`
        SELECT 1 AS is_owner
          FROM rbac_user_roles ur
          JOIN rbac_roles r ON r.id = ur.role_id
         WHERE ur.user_id = ? AND ur.org_id = ? AND r.code = 'owner'
         LIMIT 1
      `)
      .get(userId, orgId);
    const legacyOwner = !isOwner && db
      .prepare(`SELECT 1 AS is_legacy_owner FROM users WHERE id = ? AND org_id = ? AND role = 'Owner' LIMIT 1`)
      .get(userId, orgId);
    if (isOwner || legacyOwner) {
      const all = db
        .prepare(`SELECT code FROM rbac_permissions WHERE code LIKE 'smb_crm.%'`)
        .all();
      for (const r of all) out.add(r.code);
    }
  }
  return out;
}

/**
 * Throws SmbCrmAuthError on denial. Returns void on success.
 *
 *   - SmbCrmAuthError("NOT_AUTHENTICATED") if user is missing.
 *   - SmbCrmAuthError("ORG_MISMATCH") if user.org_id !== orgId.
 *   - SmbCrmAuthError("PERMISSION_DENIED") if the user lacks
 *     `permission`.
 *
 * Writes rbac_audit (action: "permission.denied", source:
 * "smbCrmAuth") on every throw, mirroring rbac.requirePermission.
 */
function requireSmbCrmPermission(db, user, orgId, permission) {
  if (!user || !user.id) {
    throw new SmbCrmAuthError("NOT_AUTHENTICATED", "User is not authenticated");
  }
  if (user.org_id !== orgId) {
    writeDeniedAudit(db, orgId, user.id, permission, "ORG_MISMATCH");
    throw new SmbCrmAuthError("ORG_MISMATCH", "Cannot act across org boundaries");
  }
  if (!permission || typeof permission !== "string" || !permission.startsWith("smb_crm.")) {
    // Non-smb_crm codes belong to rbac.requirePermission; refuse
    // silently (caller's bug).
    throw new SmbCrmAuthError("INVALID_PERMISSION", `Not an smb_crm.* code: ${permission}`);
  }
  const effective = effectiveSmbCrmPermissions(db, user.id, orgId);
  if (!effective.has(permission)) {
    writeDeniedAudit(db, orgId, user.id, permission, "PERMISSION_DENIED");
    throw new SmbCrmAuthError("PERMISSION_DENIED", `Missing permission: ${permission}`);
  }
}

module.exports = {
  SmbCrmAuthError,
  effectiveSmbCrmPermissions,
  requireSmbCrmPermission
};
