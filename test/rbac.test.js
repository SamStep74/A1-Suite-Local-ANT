"use strict";
/**
 * A1 RBAC — 7 contract tests (Phase 9: M14.3 RLS + M14.5 RBAC).
 *
 * Mirrors the 5-gate test surface in test/crmTube.test.js. Verifies
 * the §2.3 permission matrix end-to-end:
 *   1. owner gets every one of the 29 permissions
 *   2. admin does NOT get org.user.manage
 *   3. accountant gets finance.report.read but NOT crm.deal.delete
 *   4. operator gets crm.deal.read but NOT finance.report.read
 *   5. viewer only gets the 8 read-class permissions
 *   6. cross-org: org A user → org B resource throws ORG_MISMATCH
 *   7. rbac_audit row written for every denied attempt
 *
 * Plus 1 demo-route smoke test (POST /api/rbac/check) to prove the
 * route layer survives end-to-end. Engine + schema tested in :memory:
 * DBs so each test is fully isolated.
 *
 * Phase 9 — Tag candidate: phase9-rbac-ant-v1.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildApp } = require("../server/app");
const { openDatabase, DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");
const rbac = require("../server/rbac");

// ─── Helpers ────────────────────────────────────────────────────────────

async function withApp(fn) {
  const app = buildApp({ dbPath: ":memory:" });
  await app.ready();
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({
    method: "POST",
    url: "/api/login",
    payload: { email, password }
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.headers["set-cookie"];
}

/** Insert a fresh org + user row (idempotent for test reuse). */
function seedOrgAndUser(db, orgId, userId, email, role) {
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, legal_name, tax_id, currency, created_at)
      VALUES (?, ?, ?, ?, 'AMD', ?)
    `).run(orgId, `Org ${orgId}`, `Org ${orgId} LLC`, "00000000", now);
    db.prepare(`
      INSERT OR IGNORE INTO users (id, org_id, email, name, password_hash, role, created_at)
      VALUES (?, ?, ?, ?, 'x', ?, ?)
    `).run(userId, orgId, email, `User ${userId}`, role, now);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// ─── 1. owner gets every one of the 29 permissions ─────────────────────

test("rbac #1: owner gets every one of the 29 permissions (pure + DB paths)", () => {
  // Pure path: the static matrix in rbac.PERMISSIONS_BY_ROLE.
  const ownerPerms = rbac.permissionsForRole("owner");
  assert.equal(ownerPerms.size, 29, "owner should have all 29 permissions");
  for (const p of rbac.PERMISSIONS) {
    assert.ok(ownerPerms.has(p), `owner missing permission: ${p}`);
  }

  // DB path: effective via rbac_user_roles (the runtime source of truth).
  const db = openDatabase(":memory:");
  const orgId = "org-owner-contract";
  const userId = "u-owner-contract";
  seedOrgAndUser(db, orgId, userId, "owner@rbac-contract.test", "owner");
  const ownerUser = { id: userId, org_id: orgId, role: "owner" };
  rbac.grantRole(db, ownerUser, orgId, userId, "owner");
  const effective = rbac.effectivePermissionsFor(db, userId, orgId);
  assert.equal(effective.size, 29, "owner via DB should have all 29 permissions");
});

// ─── 2. admin does NOT get org.user.manage ─────────────────────────────

test("rbac #2: admin does NOT get org.user.manage (29 - 1 = 28 perms)", () => {
  const adminPerms = rbac.permissionsForRole("admin");
  assert.equal(adminPerms.size, 28, "admin should have 28 permissions (29 - org.user.manage)");
  assert.ok(!adminPerms.has("org.user.manage"), "admin must NOT have org.user.manage");
  // Sanity: admin still has the other org-level permission.
  assert.ok(adminPerms.has("org.settings.manage"), "admin should have org.settings.manage");
});

// ─── 3. accountant gets finance.report.read but NOT crm.deal.delete ───

test("rbac #3: accountant gets finance.report.read but NOT crm.deal.delete", () => {
  const accPerms = rbac.permissionsForRole("accountant");
  assert.ok(accPerms.has("finance.report.read"), "accountant must have finance.report.read");
  assert.ok(!accPerms.has("crm.deal.delete"), "accountant must NOT have crm.deal.delete");
});

// ─── 4. operator gets crm.deal.read but NOT finance.report.read ───────

test("rbac #4: operator gets crm.deal.read but NOT finance.report.read", () => {
  const opPerms = rbac.permissionsForRole("operator");
  assert.ok(opPerms.has("crm.deal.read"), "operator must have crm.deal.read");
  assert.ok(!opPerms.has("finance.report.read"), "operator must NOT have finance.report.read");
});

// ─── 5. viewer only gets the 8 read-class permissions ─────────────────

test("rbac #5: viewer only gets the 8 read-class permissions", () => {
  // Contract §2.3: viewer has the 8 read-class permissions, no more.
  const expectedViewer = new Set([
    "crm.tube.access",
    "crm.deal.read",
    "crm.contact.read",
    "crm.sequence.read",
    "crm.integration.read",
    "finance.report.read",
    "inventory.balance.read",
    "cfo.snapshot.read"
  ]);
  const viewerPerms = rbac.permissionsForRole("viewer");
  assert.equal(viewerPerms.size, expectedViewer.size,
    `viewer should have exactly ${expectedViewer.size} read permissions, got ${viewerPerms.size}`);
  for (const p of expectedViewer) {
    assert.ok(viewerPerms.has(p), `viewer missing: ${p}`);
  }
  // Negative: viewer must NOT have any write / approve / manage permission.
  const deniedPerms = [
    "crm.deal.create", "crm.deal.update", "crm.deal.delete", "crm.deal.move_stage",
    "crm.contact.create", "crm.contact.update", "crm.contact.delete", "crm.contact.enrich",
    "crm.sequence.create", "crm.sequence.update", "crm.sequence.delete", "crm.sequence.enroll",
    "crm.integration.manage",
    "finance.report.create", "finance.report.approve",
    "inventory.balance.write",
    "cfo.snapshot.approve", "cfo.snapshot.run",
    "audit.read",
    "org.user.manage", "org.settings.manage"
  ];
  for (const p of deniedPerms) {
    assert.ok(!viewerPerms.has(p), `viewer must NOT have: ${p}`);
  }
});

// ─── 6. cross-org: org A user → org B resource throws ORG_MISMATCH ────

test("rbac #6: cross-org user → org B resource throws RbacError with code ORG_MISMATCH", () => {
  const db = openDatabase(":memory:");
  // User in org A
  seedOrgAndUser(db, "org-A-mismatch", "u-A-mismatch", "a@mismatch.test", "admin");
  const userA = { id: "u-A-mismatch", org_id: "org-A-mismatch", role: "admin" };
  rbac.grantRole(db, userA, "org-A-mismatch", "u-A-mismatch", "admin");
  // Attempt to act on org B (different tenant).
  let thrown = null;
  try {
    rbac.requirePermission(db, userA, "org-B-mismatch", "crm.deal.read");
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, "requirePermission must throw on cross-org access");
  assert.equal(thrown.name, "RbacError");
  assert.equal(thrown.code, "ORG_MISMATCH");
  assert.equal(thrown.statusCode, 403);
});

// ─── 7. rbac_audit row written for every denied attempt ───────────────

test("rbac #7: rbac_audit row written for every denied attempt (6 denials → 6 audit rows)", () => {
  const db = openDatabase(":memory:");
  seedOrgAndUser(db, "org-A-audit", "u-A-audit", "a2@audit.test", "operator");
  const userA = { id: "u-A-audit", org_id: "org-A-audit", role: "operator" };
  rbac.grantRole(db, userA, "org-A-audit", "u-A-audit", "operator");

  // 6 cross-org denials (ORG_MISMATCH) — each must write a row.
  for (let i = 0; i < 6; i++) {
    try {
      rbac.requirePermission(db, userA, "org-B-audit", "crm.deal.read");
    } catch (_) { /* expected */ }
  }
  const denialCount = db
    .prepare("SELECT COUNT(*) AS c FROM rbac_audit WHERE action = 'permission.denied' AND user_id = ?")
    .get("u-A-audit").c;
  assert.equal(denialCount, 6, `expected 6 rbac_audit denial rows, got ${denialCount}`);

  // The detail JSON on each row must include the reason code.
  const sample = db
    .prepare("SELECT detail FROM rbac_audit WHERE action = 'permission.denied' AND user_id = ? LIMIT 1")
    .get("u-A-audit");
  assert.ok(sample, "denial row must exist with detail JSON");
  const detail = JSON.parse(sample.detail);
  assert.equal(detail.reason, "ORG_MISMATCH");

  // A same-org permission denial must ALSO write a row (PERMISSION_DENIED reason).
  // User is operator; org.settings.manage is admin+owner-only.
  const before2 = db
    .prepare("SELECT COUNT(*) AS c FROM rbac_audit WHERE action = 'permission.denied' AND user_id = ?")
    .get("u-A-audit").c;
  try {
    rbac.requirePermission(db, userA, "org-A-audit", "org.settings.manage");
  } catch (_) { /* expected */ }
  const after2 = db
    .prepare("SELECT COUNT(*) AS c FROM rbac_audit WHERE action = 'permission.denied' AND user_id = ?")
    .get("u-A-audit").c;
  assert.equal(after2, before2 + 1, "PERMISSION_DENIED must also write a rbac_audit row");
  const permDenied = db
    .prepare("SELECT detail FROM rbac_audit WHERE action = 'permission.denied' AND user_id = ? AND resource = ?")
    .get("u-A-audit", "org.settings.manage");
  assert.equal(JSON.parse(permDenied.detail).reason, "PERMISSION_DENIED");
});

// ─── 8. demo route (bonus) — POST /api/rbac/check end-to-end ──────────

test("rbac (demo): POST /api/rbac/check returns 200 + effective perms on allow", async () => {
  await withApp(async app => {
    const cookie = await login(app);
    const user = app.db
      .prepare("SELECT id, org_id FROM users WHERE email = ?")
      .get(DEFAULT_EMAIL);
    // Grant owner role to the default seed user so the check allows.
    rbac.grantRole(app.db, user, user.org_id, user.id, "owner");
    const res = await app.inject({
      method: "POST",
      url: "/api/rbac/check",
      headers: { cookie },
      payload: { userId: user.id, orgId: user.org_id, permission: "crm.deal.read" }
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.allowed, true);
    assert.equal(body.permission, "crm.deal.read");
    assert.equal(body.effectivePermissions.length, 29,
      `owner should have all 29 perms, got ${body.effectivePermissions.length}`);
  });
});

test("rbac (demo): POST /api/rbac/check returns 403 with code PERMISSION_DENIED on deny", async () => {
  await withApp(async app => {
    const cookie = await login(app);
    const user = app.db
      .prepare("SELECT id, org_id FROM users WHERE email = ?")
      .get(DEFAULT_EMAIL);
    // Grant viewer — no write / admin perms.
    rbac.grantRole(app.db, user, user.org_id, user.id, "viewer");
    const res = await app.inject({
      method: "POST",
      url: "/api/rbac/check",
      headers: { cookie },
      payload: { userId: user.id, orgId: user.org_id, permission: "org.user.manage" }
    });
    assert.equal(res.statusCode, 403, res.body);
    const body = res.json();
    assert.equal(body.code, "PERMISSION_DENIED",
      `expected code=PERMISSION_DENIED, got body=${JSON.stringify(body)}`);
  });
});
