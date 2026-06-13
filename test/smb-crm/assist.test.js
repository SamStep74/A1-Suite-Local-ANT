"use strict";
/**
 * A1 SMB CRM — AI Assist track contract suite (Phase 10: M14.11–M14.14).
 *
 * 8 contract tests covering the assist surface:
 *   1. salesAssist with mock provider returns valid JSON shape
 *   2. messageAssist with mock provider returns a draft
 *   3. customerSummary with mock provider returns a summary
 *   4. feedback write + read (round-trip)
 *   5. RBAC: feedback requires smb_crm.access (no separate permission)
 *   6. cross-tenant safety: assist call for a deal in tenant A is
 *      not visible from tenant B
 *   7. every assist call writes to assist_runs (audit count is
 *      non-zero after 6 calls)
 *   8. idempotency: re-POST returns the cached envelope
 *
 * Mirrors test/smb-crm/foundation.test.js and records.test.js shape.
 *
 * Phase 10 — SMB CRM Assist worker. Tag candidate: phase10-smb-crm-v1.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildApp } = require("../../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD, openDatabase } = require("../../server/db");
const records = require("../../server/smbCrmRecords");
const smbCrmAiProvider = require("../../server/smbCrmAiProvider");
const smbCrmAssist = require("../../server/smbCrmAssist");
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

function uniqueIdem(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function seedOwnerInSecondOrg(db, orgId = "org-x") {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO organizations (id, name, legal_name, tax_id, currency, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(orgId, "Org X", "Org X LLC", "99999999", "AMD", now);
  db.prepare(`INSERT INTO users (id, org_id, email, name, role, password_hash, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(`user-${orgId}`, orgId, `owner-${orgId}@x.test`, `Owner ${orgId}`, "Owner", "x", now);
  const ownerRole = db.prepare(`SELECT id FROM rbac_roles WHERE code = 'owner' LIMIT 1`).get();
  if (ownerRole) {
    db.prepare(`INSERT OR IGNORE INTO rbac_user_roles (id, user_id, role_id, org_id, granted_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run(`ur-${orgId}`, `user-${orgId}`, ownerRole.id, orgId, now);
  }
  db.prepare(`INSERT OR IGNORE INTO app_assignments (org_id, role, app_id, enabled)
              VALUES (?, ?, ?, 1)`)
    .run(orgId, "Owner", "smb-crm");
}

// ─── 1. salesAssist with inMemoryAiProvider returns valid JSON shape ────
test("smb-crm assist: salesAssist with mock provider returns valid AssistResult shape", async () => {
  await withApp(async app => {
    const cookie = await login(app);
    // Need a deal in the org for salesAssist to read.
    const customerRes = await app.inject({
      method: "POST", url: "/api/smb-crm/customers", headers: { cookie },
      payload: { idempotencyKey: uniqueIdem("idem-cust"), fullName: "Sales Target Co" }
    });
    assert.equal(customerRes.statusCode, 200, customerRes.body);
    const customerId = customerRes.json().customer.id;
    const dealRes = await app.inject({
      method: "POST", url: "/api/smb-crm/deals", headers: { cookie },
      payload: { idempotencyKey: uniqueIdem("idem-deal"), title: "Annual subscription", value: 1200, currency: "AMD", customerId }
    });
    assert.equal(dealRes.statusCode, 200, dealRes.body);
    const dealId = dealRes.json().deal.id;

    // We do NOT use the route here — the contract is on the engine
    // surface. The route is covered by tests 7 + 8 + idempotency.
    const ownerA = app.db.prepare("SELECT id, org_id FROM users WHERE role = 'Owner' LIMIT 1").get();
    const provider = smbCrmAiProvider.createInMemoryProvider({
      generateStructured: {
        suggestedAction: "Send a follow-up email within 24h",
        reasoning: "Deal is in 'quoted' stage and last activity was 9 days ago. Customer has 2 open deals — high intent.",
        confidence: 0.82,
        sourceRecords: [
          { type: "deal", id: dealId, label: "Annual subscription" },
          { type: "customer", id: customerId, label: "Sales Target Co" }
        ],
        riskLevel: "medium"
      }
    });
    const result = await smbCrmAssist.salesAssist(
      app.db, ownerA.org_id, dealId, customerId, provider, { createdBy: ownerA.id }
    );
    // Shape check
    assert.equal(result.suggestedAction, "Send a follow-up email within 24h");
    assert.equal(result.reasoning.startsWith("Deal is in"), true);
    assert.equal(Math.round(result.confidence * 100), 82);
    assert.deepEqual(result.sourceRecords, [
      { type: "deal", id: dealId, label: "Annual subscription" },
      { type: "customer", id: customerId, label: "Sales Target Co" }
    ]);
    assert.equal(result.riskLevel, "medium");
    assert.ok(result.run && result.run.id, "run row is returned");
    assert.equal(result.run.runType, "sales-assist");
  });
});

// ─── 2. messageAssist with mock provider returns a draft ────────────────
test("smb-crm assist: messageAssist with mock provider returns a draft message", async () => {
  const db = openDatabase(":memory:");
  const ownerA = db.prepare("SELECT id, org_id FROM users WHERE role = 'Owner' LIMIT 1").get();
  const customer = records.createCustomer(db, ownerA.org_id, { fullName: "Armine Petrosyan", locale: "hy" });
  const provider = smbCrmAiProvider.createInMemoryProvider({
    generateStructured: {
      body: "Ողջույն Արմինե — ցանկանու՞մ եք շարունակել քննարկումը:",
      channel: "whatsapp",
      language: "hy",
      followups: ["Ողջույն — կարո՞ղ ենք հանդիպել շաբաթվա ընթացքում:"]
    }
  });
  const result = await smbCrmAssist.messageAssist(
    db, ownerA.org_id, customer.id, "whatsapp", "follow-up", provider, { createdBy: ownerA.id }
  );
  assert.ok(result.body && result.body.length > 0, "draft body present");
  assert.equal(result.channel, "whatsapp");
  assert.equal(result.language, "hy");
  assert.equal(result.followups.length, 1);
  assert.ok(result.run && result.run.id, "run row is returned");
  assert.equal(result.run.runType, "message-assist");
});

// ─── 3. customerSummary with mock provider returns a summary ────────────
test("smb-crm assist: customerSummary with mock provider returns a summary", async () => {
  const db = openDatabase(":memory:");
  const ownerA = db.prepare("SELECT id, org_id FROM users WHERE role = 'Owner' LIMIT 1").get();
  const customer = records.createCustomer(db, ownerA.org_id, { fullName: "Karen Sargsyan", companyName: "Karen & Co" });
  const provider = smbCrmAiProvider.createInMemoryProvider({
    generateStructured: {
      summaryText: "Karen has 1 open deal in the 'quoted' stage worth 850,000 AMD. Last activity was a call 4 days ago. No notes on file.",
      keyInsights: [
        "One open deal, mid-pipeline",
        "Recent phone contact suggests warm engagement",
        "No stored preferences or tags yet"
      ]
    }
  });
  const result = await smbCrmAssist.customerSummary(
    db, ownerA.org_id, customer.id, provider, { createdBy: ownerA.id }
  );
  assert.ok(result.summaryText.includes("Karen"), "summary text references the customer");
  assert.equal(result.keyInsights.length, 3);
  assert.equal(result.lastContactAt, null, "no activities → null lastContactAt");
  assert.ok(result.run && result.run.id, "run row is returned");
  assert.equal(result.run.runType, "customer-summary");
});

// ─── 4. feedback write + read (round-trip) ──────────────────────────────
test("smb-crm assist: feedback write + read round-trips through the engine", async () => {
  const db = openDatabase(":memory:");
  const ownerA = db.prepare("SELECT id, org_id FROM users WHERE role = 'Owner' LIMIT 1").get();
  const customer = records.createCustomer(db, ownerA.org_id, { fullName: "Lilit Avetisyan" });
  const provider = smbCrmAiProvider.createInMemoryProvider({
    generateStructured: { summaryText: "Brief summary.", keyInsights: ["one"] }
  });
  const result = await smbCrmAssist.customerSummary(
    db, ownerA.org_id, customer.id, provider, { createdBy: ownerA.id }
  );
  const runId = result.run.id;

  const fb = smbCrmAssist.recordFeedback(db, ownerA.org_id, runId, ownerA.id, "up", "Helpful summary");
  assert.ok(fb && fb.id, "feedback row created");
  assert.equal(fb.rating, "up");
  assert.equal(fb.comment, "Helpful summary");
  assert.equal(fb.runId, runId);

  const list = smbCrmAssist.listFeedback(db, ownerA.org_id, runId);
  assert.equal(list.length, 1, "listFeedback returns the single feedback row");
  assert.equal(list[0].id, fb.id);
  assert.equal(list[0].rating, "up");
});

// ─── 5. RBAC: feedback requires smb_crm.access (no separate permission) ─
test("smb-crm assist: feedback route accepts smb_crm.access; route returns 200 for a user with access", async () => {
  // Engine-level: the helper throws if a non-smb_crm code is passed,
  // and accepts smb_crm.access for the feedback path.
  const db = openDatabase(":memory:");
  const ownerA = db.prepare("SELECT id, org_id FROM users WHERE role = 'Owner' LIMIT 1").get();
  // should not throw — the feedback code IS smb_crm.access
  smbCrmAuth.requireSmbCrmPermission(db, { id: ownerA.id, org_id: ownerA.org_id }, ownerA.org_id, "smb_crm.access");
  // should throw — there is no smb_crm.feedback code; the engine
  // does not seed one. The helper accepts the `smb_crm.` prefix but
  // finds no matching role-grant for the user, so it throws
  // PERMISSION_DENIED. The contract is: feedback reuses smb_crm.access
  // and no new code is seeded.
  assert.throws(
    () => smbCrmAuth.requireSmbCrmPermission(
      db, { id: ownerA.id, org_id: ownerA.org_id }, ownerA.org_id, "smb_crm.feedback"
    ),
    (err) => err && err.code === "PERMISSION_DENIED",
    "the engine must NOT accept a synthetic smb_crm.feedback code (no such permission is seeded)"
  );
  // Route-level: feedback returns 200 for a user with smb_crm.access.
  await withApp(async app => {
    const cookie = await login(app);
    // Seed a run row first (idempotent w/ a real call).
    const customerRes = await app.inject({
      method: "POST", url: "/api/smb-crm/customers", headers: { cookie },
      payload: { idempotencyKey: uniqueIdem("idem-r"), fullName: "FB Co" }
    });
    const customerId = customerRes.json().customer.id;
    const summaryRes = await app.inject({
      method: "POST", url: "/api/smb-crm/customer-summary", headers: { cookie },
      payload: { idempotencyKey: uniqueIdem("idem-cs"), customerId }
    });
    assert.equal(summaryRes.statusCode, 200, summaryRes.body);
    const runId = summaryRes.json().run.id;
    const fbRes = await app.inject({
      method: "POST", url: "/api/smb-crm/feedback", headers: { cookie },
      payload: { idempotencyKey: uniqueIdem("idem-fb"), runId, rating: "up", comment: "ok" }
    });
    assert.equal(fbRes.statusCode, 200, fbRes.body);
    assert.equal(fbRes.json().ok, true);
    assert.equal(fbRes.json().feedback.rating, "up");
  });
});

// ─── 6. cross-tenant safety ─────────────────────────────────────────────
test("smb-crm assist: cross-tenant — assist call for a deal in tenant A is not visible from tenant B", async () => {
  const db = openDatabase(":memory:");
  const ownerA = db.prepare("SELECT id, org_id FROM users WHERE role = 'Owner' LIMIT 1").get();
  seedOwnerInSecondOrg(db, "org-b");

  // Org A creates a deal.
  const customer = records.createCustomer(db, ownerA.org_id, { fullName: "Cross Co" });
  const deal = records.createDeal(db, ownerA.org_id, { title: "Cross-tenant deal", value: 100, customerId: customer.id });

  const provider = smbCrmAiProvider.createInMemoryProvider({
    generateStructured: { suggestedAction: "x", reasoning: "y", confidence: 0.5, sourceRecords: [], riskLevel: "low" }
  });

  // Org A's salesAssist succeeds.
  const aRes = await smbCrmAssist.salesAssist(
    db, ownerA.org_id, deal.id, customer.id, provider, { createdBy: ownerA.id }
  );
  assert.ok(aRes.run && aRes.run.id, "org A's assist run is created");

  // Org B's salesAssist for the SAME dealId must 404 (engine refuses
  // to assemble a prompt for a row it cannot see).
  await assert.rejects(
    () => smbCrmAssist.salesAssist(db, "org-b", deal.id, customer.id, provider, { createdBy: "user-org-b" }),
    (err) => err && err.code === "NOT_FOUND",
    "org B must not be able to run assist on org A's deal"
  );

  // listAssistRuns is org-scoped: org B sees zero runs.
  const aRuns = smbCrmAssist.listAssistRuns(db, ownerA.org_id, {});
  const bRuns = smbCrmAssist.listAssistRuns(db, "org-b", {});
  assert.equal(aRuns.length, 1, "org A sees its 1 run");
  assert.equal(bRuns.length, 0, "org B sees zero runs (no leakage)");
});

// ─── 7. every assist call writes to assist_runs (audit) ─────────────────
test("smb-crm assist: every assist call writes to assist_runs (6 calls → 6 rows)", async () => {
  const db = openDatabase(":memory:");
  const ownerA = db.prepare("SELECT id, org_id FROM users WHERE role = 'Owner' LIMIT 1").get();
  const customer = records.createCustomer(db, ownerA.org_id, { fullName: "Audit Run Co" });
  const deal = records.createDeal(db, ownerA.org_id, { title: "Audit Run Deal", value: 50, customerId: customer.id });

  const provider = smbCrmAiProvider.createInMemoryProvider({
    generateStructured: { ok: true, summaryText: "x", keyInsights: [], suggestedAction: "x", reasoning: "x", confidence: 0.5, sourceRecords: [], riskLevel: "low" }
  });

  const before = db.prepare("SELECT COUNT(*) AS c FROM smb_crm_assist_runs").get().c;
  // 2 sales-assist + 2 message-assist + 2 customer-summary
  await smbCrmAssist.salesAssist(db, ownerA.org_id, deal.id, customer.id, provider, { createdBy: ownerA.id });
  await smbCrmAssist.salesAssist(db, ownerA.org_id, deal.id, customer.id, provider, { createdBy: ownerA.id });
  await smbCrmAssist.messageAssist(db, ownerA.org_id, customer.id, "whatsapp", "follow-up", provider, { createdBy: ownerA.id });
  await smbCrmAssist.messageAssist(db, ownerA.org_id, customer.id, "email", "intro", provider, { createdBy: ownerA.id });
  await smbCrmAssist.customerSummary(db, ownerA.org_id, customer.id, provider, { createdBy: ownerA.id });
  await smbCrmAssist.customerSummary(db, ownerA.org_id, customer.id, provider, { createdBy: ownerA.id });

  const after = db.prepare("SELECT COUNT(*) AS c FROM smb_crm_assist_runs").get().c;
  assert.equal(after, before + 6, `expected 6 new assist_runs rows, got ${after - before}`);

  // Distribution: 2 of each run_type
  const byType = db.prepare(`
    SELECT run_type, COUNT(*) AS c
      FROM smb_crm_assist_runs
     WHERE org_id = ?
     GROUP BY run_type
  `).all(ownerA.org_id);
  const m = Object.fromEntries(byType.map(r => [r.run_type, r.c]));
  assert.equal(m["sales-assist"], 2);
  assert.equal(m["message-assist"], 2);
  assert.equal(m["customer-summary"], 2);
});

// ─── 8. idempotency: re-POST returns cached envelope ────────────────────
test("smb-crm assist: re-POST /api/smb-crm/customer-summary returns the cached envelope (no duplicate assist_run)", async () => {
  await withApp(async app => {
    const cookie = await login(app);
    const customerRes = await app.inject({
      method: "POST", url: "/api/smb-crm/customers", headers: { cookie },
      payload: { idempotencyKey: uniqueIdem("idem-ic-cust"), fullName: "Idem Co" }
    });
    const customerId = customerRes.json().customer.id;

    const idem = uniqueIdem("idem-cs-replay");
    const payload = { idempotencyKey: idem, customerId };
    const a = await app.inject({ method: "POST", url: "/api/smb-crm/customer-summary", headers: { cookie }, payload });
    const b = await app.inject({ method: "POST", url: "/api/smb-crm/customer-summary", headers: { cookie }, payload });
    assert.equal(a.statusCode, 200, a.body);
    assert.equal(b.statusCode, 200, b.body);
    assert.deepEqual(a.json(), b.json(), "replay must return byte-identical envelope");

    // Exactly ONE assist_run row was written (the replay was short-circuited
    // by the idempotency_keys cache, so the engine was never re-entered).
    const ownerOrgId = app.db
      .prepare("SELECT org_id FROM users WHERE role = 'Owner' LIMIT 1")
      .get().org_id;
    const runs = app.db
      .prepare("SELECT COUNT(*) AS c FROM smb_crm_assist_runs WHERE org_id = ? AND run_type = 'customer-summary'")
      .get(ownerOrgId).c;
    assert.equal(runs, 1, "idempotent replay must NOT write a second assist_run");
  });
});
