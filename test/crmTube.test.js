"use strict";
/**
 * A1 CRM Tube — Pattern A 5-gate contract suite.
 *
 * Mirrors test/healthcheck.test.js shape. Verifies the spine
 * every later ANT module must satisfy:
 *   1. auth-gated (401 without session)
 *   2. app-access-gated (403 for non-crm user)
 *   3. input-validated (400 on missing/invalid body)
 *   4. happy-path audit-once (200 + exactly one audit_events row)
 *   5. idempotent replay (same envelope, no duplicate audit)
 *
 * Plus the engine-level end-to-end against the real openDatabase
 * to prove the UNIQUE(sequence_id, contact_id) constraint holds
 * under Promise.all-of-N concurrent enrolls (the v0.5 audit's
 * last WARN — closed by the 3-layer engine in server/crmTube.js).
 *
 * Phase 8.13 — Tube port. Tag candidate: phase8-tube-v1.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");
const crmTube = require("../server/crmTube");

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

test("crm-tube /api/crm/tube is auth-gated (401 without session)", async () => {
  await withApp(async app => {
    const res = await app.inject({ method: "GET", url: "/api/crm/tube" });
    assert.equal(res.statusCode, 401, res.body);
  });
});

test("crm-tube /api/crm/tube requires crm-tube app access (403 for non-crm user)", async () => {
  await withApp(async app => {
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "GET",
      url: "/api/crm/tube",
      headers: { cookie }
    });
    // Support role doesn't have crm-tube assignment.
    assert.equal(res.statusCode, 403, res.body);
  });
});

test("crm-tube GET /api/crm/tube returns { tubes, defaultTubeId } and seeds the default tube on first call", async () => {
  await withApp(async app => {
    const cookie = await login(app);
    const res = await app.inject({
      method: "GET",
      url: "/api/crm/tube",
      headers: { cookie }
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(body.tubes, "tubes array present");
    assert.equal(body.tubes.length, 1);
    assert.equal(body.tubes[0].name, "Default tube");
    assert.ok(body.defaultTubeId);
    // The default tube ships with 6 stages.
    assert.equal(body.tubes[0].stages.length, 6);
    const stageNames = body.tubes[0].stages.map(s => s.name);
    assert.deepEqual(stageNames, ["Lead", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]);
  });
});

test("crm-tube move-deal-stage requires stageId (400 on missing)", async () => {
  await withApp(async app => {
    const cookie = await login(app);
    // Seed a deal first. ANT doesn't attach `app.user` — fetch
    // the default org + owner from the seeded rows.
    const orgId = app.db.prepare("SELECT id FROM organizations LIMIT 1").get().id;
    const tubeId = crmTube.ensureDefaultTube(app.db, orgId);
    const stageId = app.db.prepare(
      "SELECT id FROM tube_stages WHERE org_id = ? AND tube_id = ? ORDER BY position LIMIT 1"
    ).get(orgId, tubeId).id;
    const contactId = crmTube.listContacts(app.db, orgId)[0]?.id ||
      (() => {
        const id = "contact-test-1";
        app.db.prepare(`
          INSERT INTO tube_contacts (id, org_id, full_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, orgId, "Test Contact", new Date().toISOString(), new Date().toISOString());
        return id;
      })();
    const dealId = "deal-test-1";
    app.db.prepare(`
      INSERT INTO tube_deals (id, org_id, tube_id, stage_id, title, value, currency, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'AMD', 'open', ?, ?)
    `).run(dealId, orgId, tubeId, stageId, "Test deal", 1000, new Date().toISOString(), new Date().toISOString());

    const res = await app.inject({
      method: "POST",
      url: `/api/crm/tube/deals/${dealId}/stage`,
      headers: { cookie },
      payload: {}
    });
    assert.equal(res.statusCode, 400, res.body);
  });
});

test("crm-tube move-deal-stage is idempotent on replay (same response, no duplicate audit)", async () => {
  await withApp(async app => {
    const cookie = await login(app);
    const orgId = app.db.prepare("SELECT id FROM organizations LIMIT 1").get().id;
    const tubeId = crmTube.ensureDefaultTube(app.db, orgId);
    const stages = app.db.prepare(
      "SELECT id, name FROM tube_stages WHERE org_id = ? AND tube_id = ? ORDER BY position"
    ).all(orgId, tubeId);
    const qualifiedStageId = stages.find(s => s.name === "Qualified").id;
    const dealId = "deal-test-idem";
    app.db.prepare(`
      INSERT INTO tube_deals (id, org_id, tube_id, stage_id, title, value, currency, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'AMD', 'open', ?, ?)
    `).run(dealId, orgId, tubeId, stages[0].id, "Idem deal", 500,
      new Date().toISOString(), new Date().toISOString());

    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const payload = {
      method: "POST",
      url: `/api/crm/tube/deals/${dealId}/stage`,
      headers: { cookie },
      payload: { stageId: qualifiedStageId, idempotencyKey: "tube-move-1" }
    };
    const first = await app.inject(payload);
    const second = await app.inject(payload);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(second.statusCode, 200, second.body);
    assert.deepEqual(first.json(), second.json());
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.equal(after, before + 1, "idempotency must suppress duplicate audit row");
  });
});

test("crm-tube engine: enrollContactsInSequence holds UNIQUE under Promise.all concurrent race", async () => {
  // Real openDatabase — no shim. Proves the migration's
  // UNIQUE(sequence_id, contact_id) is load-bearing.
  const { openDatabase } = require("../server/db");
  const db = openDatabase(":memory:");
  const orgId = "org-tube-race";
  // Bootstrap a user + sequence + contact via the same engine the
  // route layer would use.
  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO organizations (id, name, legal_name, tax_id, currency, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(orgId, "Race Org", "Race Org LLC", "00000000", "AMD", new Date().toISOString());
    db.prepare(`
      INSERT INTO users (id, org_id, email, name, password_hash, role, created_at)
      VALUES (?, ?, ?, ?, ?, 'owner', ?)
    `).run("u-race", orgId, "r@race.test", "Race Owner", "x", new Date().toISOString());
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const sequenceId = crmTube.createSequence(db, orgId, { name: "Race", isActive: true }).id;
  const contactId = "c-race";
  db.prepare(`
    INSERT INTO tube_contacts (id, org_id, full_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(contactId, orgId, "Race Contact", new Date().toISOString(), new Date().toISOString());

  // 10 concurrent enrolls for the same (sequence, contact).
  const concurrent = await Promise.all(
    Array.from({ length: 10 }, () =>
      Promise.resolve().then(() =>
        crmTube.enrollContactsInSequence(db, orgId, sequenceId, [contactId])
      )
    )
  );
  const totalEnrolled = concurrent.reduce((acc, n) => acc + n, 0);
  assert.equal(totalEnrolled, 1,
    `Promise.all concurrent enrolls must produce exactly 1 row, got ${totalEnrolled}`);
  const rows = crmTube.listSequenceEnrollments(db, orgId, sequenceId);
  assert.equal(rows.length, 1,
    `tube_sequence_enrollments must hold exactly 1 row for the (seq, contact) pair`);

  // Re-enroll mixing real + missing-c: zero new rows, no throw.
  const mixed = crmTube.enrollContactsInSequence(db, orgId, sequenceId, [contactId, "missing-c"]);
  assert.equal(mixed, 0, "missing contact silently skipped; real contact already enrolled");
  const rowsAfter = crmTube.listSequenceEnrollments(db, orgId, sequenceId);
  assert.equal(rowsAfter.length, 1,
    "missing-c never inserted, no duplicates from re-enroll");
});
