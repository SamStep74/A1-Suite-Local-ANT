"use strict";
/**
 * A1 SMB CRM — Foundation track contract suite (Phase 10: M14.1–M14.4).
 *
 * Mirrors test/crmTube.test.js shape. Verifies the Pattern A
 * 5-gate spine every later SMB CRM module must satisfy:
 *   1. auth-gated (401 without session)
 *   2. app-access-gated (403 for non-smb-crm user)
 *   3. input-validated (400 on missing/invalid body)
 *   4. happy-path audit-once (200 + exactly one audit_events row)
 *   5. idempotent replay (same envelope, no duplicate audit)
 *
 * Plus two SMB-CRM-specific contract gates:
 *   6. cross-tenant safety (operator in org A cannot see org B's
 *      blueprint; the auth gate is `user.org_id` keyed, not the
 *      body, so a forged body never escapes its own org)
 *   7. audit-row on AI call (POST /api/smb-crm/generate-blueprint
 *      must persist an `audit_events` row that carries the AI
 *      evidence envelope — even when the AI provider is offline
 *      and the call returns a warnings array, the route still
 *      records the call attempt for governance review)
 *
 * Phase 10 — SMB CRM Foundation worker. Tag candidate:
 * phase10-smb-crm-v1.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildApp } = require("../../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../../server/db");
const smbCrmBlueprint = require("../../server/smbCrmBlueprintGenerator");
const smbCrmAuth = require("../../server/smbCrmAuth");

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
  assert.equal(res.statusCode, 200, `login failed: ${res.body}`);
  return res.headers["set-cookie"];
}

function uniqueSlug(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

test("smb-crm GET /api/smb-crm/tenants is auth-gated (401 without session)", async () => {
  await withApp(async app => {
    const res = await app.inject({ method: "GET", url: "/api/smb-crm/tenants" });
    assert.equal(res.statusCode, 401, res.body);
  });
});

test("smb-crm GET /api/smb-crm/tenants requires smb-crm app access (403 for Support user)", async () => {
  await withApp(async app => {
    // Support is seeded with crm + desk + docs + cfo, NOT smb-crm.
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "GET",
      url: "/api/smb-crm/tenants",
      headers: { cookie }
    });
    assert.equal(res.statusCode, 403, res.body);
  });
});

test("smb-crm POST /api/smb-crm/tenants validates idempotencyKey (400 on missing)", async () => {
  await withApp(async app => {
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/smb-crm/tenants",
      headers: { cookie },
      payload: {
        // idempotencyKey intentionally missing.
        slug: uniqueSlug("contract"),
        companyName: "Contract Co",
        locale: "en"
      }
    });
    assert.equal(res.statusCode, 400, res.body);
  });
});

test("smb-crm POST /api/smb-crm/tenants is happy-path audit-once (200 + exactly one audit row)", async () => {
  await withApp(async app => {
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const res = await app.inject({
      method: "POST",
      url: "/api/smb-crm/tenants",
      headers: { cookie },
      payload: {
        idempotencyKey: `idem-create-${Date.now()}-${Math.random()}`,
        slug: uniqueSlug("create"),
        companyName: "Create Co",
        locale: "en",
        plan: "trial"
      }
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.ok(body.tenant, "tenant view present");
    assert.equal(body.tenant.slug.startsWith("create-"), true);
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.equal(after, before + 1, `expected exactly one new audit row, got ${after - before}`);
    const recent = app.db
      .prepare("SELECT type, details FROM audit_events ORDER BY id DESC LIMIT 1")
      .get();
    assert.equal(recent.type, "smb_crm.tenant.created");
  });
});

test("smb-crm POST /api/smb-crm/tenants is idempotent on replay (same envelope, no duplicate audit)", async () => {
  await withApp(async app => {
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const idemKey = `idem-replay-${Date.now()}-${Math.random()}`;
    const payload = {
      idempotencyKey: idemKey,
      slug: uniqueSlug("replay"),
      companyName: "Replay Co",
      locale: "en",
      plan: "starter"
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/smb-crm/tenants",
      headers: { cookie },
      payload
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/smb-crm/tenants",
      headers: { cookie },
      payload
    });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(second.statusCode, 200, second.body);
    assert.deepEqual(first.json(), second.json(),
      "replay must return byte-identical envelope (cached in idempotency_keys)");
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.equal(after, before + 1,
      "idempotency must suppress the duplicate audit row");
  });
});

test("smb-crm cross-tenant safety: blueprint in org A is invisible to a peer org B's getBlueprint", async () => {
  // Real openDatabase, no Fastify shim. Bootstrap a SECOND org
  // (the seed already created `org-armosphera-demo`) and verify
  // that the engine's getBlueprint is org-scoped. We reuse the
  // seeded `user-owner` for org A and bootstrap a second user for
  // org B without going through password hashing — the auth
  // boundary we test is at the engine level (org_id filter), not
  // at the bcrypt layer.
  const { openDatabase, verifyPassword } = require("../../server/db");
  const db = openDatabase(":memory:");
  const now = new Date().toISOString();

  // Org A — the seeded demo org + its owner.
  // The :memory: build re-runs seedIfEmpty, so user-owner exists.
  const ownerA = db.prepare(`SELECT id, org_id FROM users WHERE role = 'Owner' LIMIT 1`).get();
  assert.ok(ownerA, "seedIfEmpty should produce an Owner user");
  const orgA = ownerA.org_id;

  // Org B — bootstrap via direct SQL, owner gets the seeded
  // rbac 'owner' role.
  db.prepare(`INSERT INTO organizations (id, name, legal_name, tax_id, currency, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run("org-b", "Org B", "Org B LLC", "22222222", "AMD", now);
  db.prepare(`INSERT INTO users (id, org_id, email, name, role, password_hash, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("user-b", "org-b", "b@x.test", "Owner B", "Owner",
         "x", now);
  // Wire the rbac owner role for B.
  const ownerRole = db.prepare(`SELECT id FROM rbac_roles WHERE code = 'owner' LIMIT 1`).get();
  assert.ok(ownerRole, "ensureRbacSchema should seed the 'owner' rbac role");
  db.prepare(`INSERT OR IGNORE INTO rbac_user_roles (id, user_id, role_id, org_id, granted_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run("ur-b", "user-b", ownerRole.id, "org-b", now);
  // Wire smb-crm app assignment for Owner in org B (mirrors
  // ensureSmbCrmFoundationSchema's seed).
  db.prepare(`INSERT OR IGNORE INTO app_assignments (org_id, role, app_id, enabled)
              VALUES (?, ?, ?, 1)`)
    .run("org-b", "Owner", "smb-crm");

  // A writes a blueprint.
  const saved = smbCrmBlueprint.saveBlueprint(db, orgA, {
    industry: "retail",
    companyName: "A Co",
    language: "en",
    modules: ["leads"],
    pipeline: ["Lead"],
    fields: ["name"],
    kpis: ["leads"]
  }, { provider: "test", evidence: null });
  assert.ok(saved && saved.id, "saveBlueprint should return a stored row");

  // A can read it.
  const fromA = smbCrmBlueprint.getBlueprint(db, orgA, saved.id);
  assert.ok(fromA, "owner A must read own org's blueprint");
  // B is a different org: the engine's getBlueprint filters by
  // org_id, so B's getBlueprint returns null (404 from the route).
  const fromB = smbCrmBlueprint.getBlueprint(db, "org-b", saved.id);
  assert.equal(fromB, null,
    "owner B must NOT see org A's blueprint — getBlueprint is org-scoped");

  // The auth helper enforces the same boundary at the route layer.
  // A passes its own org; a forged body that asks for a blueprint
  // across the org boundary (user.org_id !== orgId) must throw
  // ORG_MISMATCH.
  smbCrmAuth.requireSmbCrmPermission(db, { id: ownerA.id, org_id: orgA }, orgA,
    "smb_crm.blueprint.read"); // should not throw
  assert.throws(
    () => smbCrmAuth.requireSmbCrmPermission(
      db, { id: "user-b", org_id: "org-b" }, /* requested orgId */ orgA,
      "smb_crm.blueprint.read"
    ),
    (err) => err && err.code === "ORG_MISMATCH",
    "requesting a blueprint in another org must be rejected with ORG_MISMATCH"
  );
});

test("smb-crm POST /api/smb-crm/generate-blueprint writes an audit row even when AI is offline", async () => {
  await withApp(async app => {
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;

    // We do NOT install a fake provider — the route layer's
    // createDefaultProvider() sees no OPENROUTER_API_KEY, builds
    // an in-memory provider that returns a warnings envelope. The
    // contract is: the route still persists an audit row carrying
    // the warnings + the (null) evidence envelope, so a later
    // governance review can see the attempt.
    const res = await app.inject({
      method: "POST",
      url: "/api/smb-crm/generate-blueprint",
      headers: { cookie },
      payload: {
        idempotencyKey: `idem-ai-${Date.now()}-${Math.random()}`,
        questionnaire: {
          industry: "retail",
          companyName: "AI Test Co",
          teamSize: "1-5"
        }
      }
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.ok, true);
    // In offline mode the in-memory provider returns a non-null
    // blueprint (synthetic fallback) OR null with warnings — both
    // shapes are accepted. The audit row must exist either way.
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.ok(after >= before + 1,
      `expected at least one new audit row from generate-blueprint, got ${after - before}`);
    const recent = app.db
      .prepare("SELECT type, details FROM audit_events ORDER BY id DESC LIMIT 1")
      .get();
    assert.equal(recent.type, "smb_crm.blueprint.generated",
      `expected smb_crm.blueprint.generated audit row, got ${recent.type}`);
    const details = JSON.parse(recent.details);
    assert.ok("provider" in details, "audit details should record the provider name");
    assert.ok("idempotencyKey" in details, "audit details should record the idempotency key");
  });
});
