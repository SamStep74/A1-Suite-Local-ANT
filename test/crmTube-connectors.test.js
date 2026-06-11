"use strict";
/**
 * A1 CRM Tube — connector contract suite.
 *
 * 10 tests, one per connector. Proves:
 *   1. healthCheck returns a valid envelope with mode:"stub" when
 *      the per-connector <KEY>_ENABLED flag is unset.
 *   2. signRequest is deterministic and returns a 64-char hex hmac.
 *   3. hashSecret is deterministic and the fingerprint is a 12-char
 *      prefix of the hash.
 *   4. When <KEY>_ENABLED=1 the factory returns mode:"real".
 *   5. Real-mode webhook rejects when signature header is missing.
 *
 * Plus an integration probe against the live Fastify app: POST
 * /api/crm/tube/integrations/<key>/health-check with a valid session
 * + idempotencyKey returns 200 + envelope; audit row is written
 * exactly once; PII (the cleartext secret) does NOT land in the
 * audit_events row.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  TUBE_CONNECTORS,
  getConnector,
  signRequest,
  hashSecret
} = require("../server/crmTube/connectors/registry");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

const CONNECTOR_KEYS = Object.keys(TUBE_CONNECTORS);

test("connector registry exports all 10 connectors", () => {
  assert.equal(CONNECTOR_KEYS.length, 10);
  for (const key of ["apollo", "cloudtalk", "respond-io", "surfe", "dexatel", "make", "webflow", "closely", "instantly", "pixxi"]) {
    assert.ok(TUBE_CONNECTORS[key], `missing connector ${key}`);
  }
});

test("signRequest is deterministic and returns a 64-char hex hmac", () => {
  const a = signRequest("secret-1", { foo: "bar" });
  const b = signRequest("secret-1", { foo: "bar" });
  const c = signRequest("secret-2", { foo: "bar" });
  assert.equal(a, b, "same secret+body must produce the same signature");
  assert.notEqual(a, c, "different secret must produce a different signature");
  assert.equal(a.length, 64, "SHA-256 hex digest must be 64 chars");
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("hashSecret is deterministic and the fingerprint is a 12-char prefix of the hash", () => {
  const a = hashSecret("hunter2");
  const b = hashSecret("hunter2");
  const c = hashSecret("hunter3");
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.hash, c.hash);
  assert.equal(a.hash.length, 64);
  assert.equal(a.fingerprint.length, 12);
  assert.equal(a.hash.startsWith(a.fingerprint), true, "fingerprint must be the first 12 chars of the hash");
  // Edge: empty/null secret.
  assert.equal(hashSecret("").hash, null);
  assert.equal(hashSecret("").fingerprint, null);
  assert.equal(hashSecret(null).hash, null);
});

for (const key of CONNECTOR_KEYS) {
  test(`${key}: stub mode healthCheck returns a valid envelope with no env flag`, () => {
    const env = {};  // no <KEY>_ENABLED
    const adapter = getConnector(key, { env });
    const result = adapter.healthCheck();
    assert.equal(result.ok, true);
    assert.equal(result.connector, key);
    assert.equal(result.mode, "stub");
    assert.equal(result.environment, "sandbox");
    assert.equal(result.data.status, "connected");
    assert.deepEqual(result.data.scopes, TUBE_CONNECTORS[key].defaultScopes);
  });

  test(`${key}: real mode kicks in when <KEY>_ENABLED=1`, () => {
    const env = { [`${key.toUpperCase().replace(/-/g, "_")}_ENABLED`]: "1" };
    const adapter = getConnector(key, { env, secret: "shh" });
    const result = adapter.healthCheck();
    assert.equal(result.mode, "real");
    assert.ok(result.data.signature, "real mode must sign the request");
    assert.equal(result.data.signature.length, 64);
  });

  test(`${key}: real-mode receiveWebhook rejects when signature header missing`, () => {
    const env = { [`${key.toUpperCase().replace(/-/g, "_")}_ENABLED`]: "1" };
    const adapter = getConnector(key, { env, secret: "shh" });
    const result = adapter.receiveWebhook({ headers: {}, body: { type: "x" } });
    assert.equal(result.ok, false);
    assert.equal(result.accepted, false);
    assert.ok(result.warnings.includes("missing-or-invalid-signature"));
  });
}

// ─── Live Fastify probe (the audit row must NOT carry PII) ───────────

test("POST /api/crm/tube/integrations/apollo/health-check: 200 + audit-once + no PII in audit", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  await app.ready();
  try {
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD }
    });
    assert.equal(loginRes.statusCode, 200, loginRes.body);
    const rawCookie = loginRes.headers["set-cookie"];
    const cookie = (Array.isArray(rawCookie) ? rawCookie[0] : String(rawCookie || "")).split(";")[0];

    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const res = await app.inject({
      method: "POST",
      url: "/api/crm/tube/integrations/apollo/health-check",
      headers: { cookie },
      payload: { idempotencyKey: "test-apollo-health-1", secret: "plaintext-shhh-do-not-leak" }
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.connector, "apollo");
    assert.equal(body.mode, "stub");
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.equal(after, before + 1, "audit must be written exactly once");

    // PII check: the cleartext secret MUST NOT be in the audit row.
    // ANT's audit_events uses (user_id, type, details) not the suite-wide
    // (actor_user_id, action, payload) — same row, different column names.
    const lastAudit = app.db.prepare(
      "SELECT user_id, type, details FROM audit_events ORDER BY id DESC LIMIT 1"
    ).get();
    const auditJson = JSON.stringify(lastAudit);
    assert.ok(!auditJson.includes("plaintext-shhh-do-not-leak"),
      "audit_events.details must NOT carry the cleartext secret");

    // Idempotent replay: same response, no second audit row.
    const replay = await app.inject({
      method: "POST",
      url: "/api/crm/tube/integrations/apollo/health-check",
      headers: { cookie },
      payload: { idempotencyKey: "test-apollo-health-1", secret: "plaintext-shhh-do-not-leak" }
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), body, "replay must return the cached envelope");
    const final = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.equal(final, after, "idempotency must suppress duplicate audit row");
  } finally {
    await app.close();
  }
});

test("POST /api/crm/tube/integrations/<unknown>/health-check: 404 from registry", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  await app.ready();
  try {
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD }
    });
    assert.equal(loginRes.statusCode, 200, loginRes.body);
    const rawCookie = loginRes.headers["set-cookie"];
    const cookie = (Array.isArray(rawCookie) ? rawCookie[0] : String(rawCookie || "")).split(";")[0];
    const res = await app.inject({
      method: "POST",
      url: "/api/crm/tube/integrations/not-a-real-connector/health-check",
      headers: { cookie },
      payload: { idempotencyKey: "test-bad-1" }
    });
    assert.equal(res.statusCode, 404, res.body);
  } finally {
    await app.close();
  }
});
