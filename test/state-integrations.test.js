"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

test("state-int migration creates the 4 state-integration tables", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const required = [
      "state_integration_calls",
      "state_integration_credentials",
      "state_signatures",
      "state_id_verifications"
    ];
    for (const name of required) {
      const row = app.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
      assert.ok(row, `table ${name} must exist`);
    }
  } finally {
    await app.close();
  }
});

test("state-int hub exposes 6 adapter names in test mode", () => {
  const adapters = ["src", "eregister", "egov", "idcard", "mobileid", "customs"];
  for (const name of adapters) {
    const mod = require(`../server/stateIntegrations/${name}`);
    assert.strictEqual(typeof mod.prepare, "function");
    assert.strictEqual(typeof mod.send, "function");
    assert.strictEqual(typeof mod.fetchStatus, "function");
    assert.strictEqual(typeof mod.cancel, "function");
    assert.strictEqual(typeof mod.verifySignature, "function");
  }
});

test("state-int hub: 401 on no-auth", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/state-int/src/submit-vat",
      payload: { period: "2026-Q1", netAmount: 100000, idempotencyKey: "k1" }
    });
    assert.strictEqual(res.statusCode, 401);
  } finally { await app.close(); }
});

test("state-int hub: 403 on missing app access (support role)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/state-int/src/submit-vat",
      headers: { cookie },
      payload: { period: "2026-Q1", netAmount: 100000, idempotencyKey: "k2" }
    });
    assert.strictEqual(res.statusCode, 403);
  } finally { await app.close(); }
});

test("state-int hub: 400 on malformed input", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/state-int/src/submit-vat",
      headers: { cookie },
      payload: { period: "bogus" }
    });
    assert.strictEqual(res.statusCode, 400);
  } finally { await app.close(); }
});

test("state-int hub: 200 happy path + audit row written", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const res = await app.inject({
      method: "POST",
      url: "/api/state-int/src/submit-vat",
      headers: { cookie },
      payload: { period: "2026-Q1", netAmount: 100000, vatRate: 20, idempotencyKey: "k3" }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.stateInt.status, "sent");
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.strictEqual(after, before + 1, "audit row must be written");
    const callCount = app.db.prepare("SELECT COUNT(*) AS c FROM state_integration_calls").get().c;
    assert.strictEqual(callCount, 1, "state_integration_calls row must be written");
  } finally { await app.close(); }
});

test("state-int hub: idempotent replay returns cached envelope, no duplicate audit", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const payload = {
      method: "POST", url: "/api/state-int/eregister/lookup", headers: { cookie },
      payload: { taxId: "01234567", idempotencyKey: "k4" }
    };
    const first = await app.inject(payload);
    const second = await app.inject(payload);
    assert.strictEqual(first.statusCode, 200);
    assert.strictEqual(second.statusCode, 200);
    assert.deepStrictEqual(first.json(), second.json());
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.strictEqual(after, before + 1, "idempotency must suppress duplicate audit");
    const callCount = app.db.prepare("SELECT COUNT(*) AS c FROM state_integration_calls").get().c;
    assert.strictEqual(callCount, 1, "no duplicate call row on replay");
  } finally { await app.close(); }
});

test("state-int hub: 403 on production mode without opt-in env", async () => {
  const prev = process.env.STATE_INTEGRATION_MODE;
  process.env.STATE_INTEGRATION_MODE = "production";
  delete process.env.SRC_ENABLED;
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/state-int/src/submit-vat",
      headers: { cookie },
      payload: { period: "2026-Q1", netAmount: 1, vatRate: 20, idempotencyKey: "k5" }
    });
    assert.strictEqual(res.statusCode, 403);
  } finally {
    if (prev === undefined) delete process.env.STATE_INTEGRATION_MODE;
    else process.env.STATE_INTEGRATION_MODE = prev;
    await app.close();
  }
});

test("state-int hub: e-sign adapter returns deterministic signature envelope", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/state-int/egov/sign",
      headers: { cookie },
      payload: {
        documentId: "doc-1",
        signerClaims: { fullName: "Test User", idNumber: "AN1234567" },
        idempotencyKey: "k6"
      }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(body.stateInt.signatureB64);
    assert.ok(body.stateInt.certificateThumbprint);
  } finally { await app.close(); }
});

test("state-int audit endpoint requires auditor role", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "GET",
      url: "/api/state-int/audit",
      headers: { cookie }
    });
    assert.strictEqual(res.statusCode, 403);
  } finally { await app.close(); }
});

test("state-int redactPII: salted full-digest hash + pattern key + nested subtree", () => {
  const { scrubPII, __internals: { isPIIKey } } = require("../server/stateIntegrations");

  // 1. Same value hashed twice produces different output (per-call salt).
  const a = scrubPII({ idNumber: "AN-1234567" });
  const b = scrubPII({ idNumber: "AN-1234567" });
  assert.ok(a.idNumber.startsWith("[hash:sha256:") && a.idNumber.endsWith("]"));
  assert.notStrictEqual(a.idNumber, b.idNumber, "salt must randomize the digest");
  assert.strictEqual(a.idNumber__present, true);

  // 2. Full 256-bit digest (16-byte salt + 32-byte hash = 96 hex chars between the brackets).
  const inner = a.idNumber.slice("[hash:sha256:".length, -1);
  assert.strictEqual(inner.split(":").length, 2, "must be salt:digest");
  assert.strictEqual(inner.split(":")[0].length, 32, "salt is 16 bytes = 32 hex chars");
  assert.strictEqual(inner.split(":")[1].length, 64, "digest is 32 bytes = 64 hex chars");

  // 3. Pattern-based detection catches undeclared PII-shaped keys.
  assert.ok(isPIIKey("tax_id"), "snake_case tax_id");
  assert.ok(isPIIKey("phone_number"), "snake_case phone_number");
  assert.ok(isPIIKey("personalId"), "camelCase personalId");
  assert.ok(!isPIIKey("requestId"), "must NOT redact requestId");
  assert.ok(!isPIIKey("providerRef"), "must NOT redact providerRef");
  assert.ok(!isPIIKey("operation"), "must NOT redact operation");

  // 4. Nested object/array UNDER a PII key is redacted as a single unit
  //    (no cleartext inner values escape).
  const nestedPIIKey = scrubPII({ fullName: { first: "John", last: "Smith" } });
  assert.ok(nestedPIIKey.fullName.__redactedSubtree, "subtree under a PII key must be marked redacted");
  assert.ok(nestedPIIKey.fullName.hash, "subtree under a PII key must carry a hash");
  assert.strictEqual(nestedPIIKey.fullName.first, undefined, "inner cleartext must not leak");
  assert.strictEqual(nestedPIIKey.fullName.last, undefined, "inner cleartext must not leak");
  assert.strictEqual(nestedPIIKey.fullName__present, true);

  // 5. PII-shaped inner keys under a NON-PII parent are individually
  //    redacted (the parent key is preserved so the audit row still
  //    shows the payload shape).
  const innerPII = scrubPII({ signerClaims: { idNumber: "AN-1234567", fullName: "Test" } });
  assert.ok(innerPII.signerClaims.idNumber.startsWith("[hash:sha256:"));
  assert.strictEqual(innerPII.signerClaims.idNumber__present, true);
  assert.ok(innerPII.signerClaims.fullName.startsWith("[hash:sha256:"));
  assert.strictEqual(innerPII.signerClaims.fullName__present, true);

  // 6. Non-PII nested keys are walked through unchanged.
  const pass = scrubPII({ meta: { requestId: "r-1", status: "sent" } });
  assert.strictEqual(pass.meta.requestId, "r-1");
  assert.strictEqual(pass.meta.status, "sent");
});

test("state-int redactPII: handles Buffer and bigint leaf values without leaking", () => {
  const { scrubPII } = require("../server/stateIntegrations");
  const bufResult = scrubPII({ idNumber: Buffer.from("AN-1234567", "utf8") });
  assert.ok(bufResult.idNumber.startsWith("[hash:sha256:"));
  assert.strictEqual(bufResult.idNumber__present, true);
  const bigResult = scrubPII({ idNumber: 1234567n });
  assert.ok(bigResult.idNumber.startsWith("[hash:sha256:"));
  assert.strictEqual(bigResult.idNumber__present, true);
});
