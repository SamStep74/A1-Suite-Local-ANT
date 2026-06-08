"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

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

test("healthcheck ping is auth-gated (401 without session)", async () => {
  await withApp(async app => {
    const res = await app.inject({
      method: "POST",
      url: "/api/healthcheck/ping",
      payload: { message: "hi", idempotencyKey: "hc-noauth" }
    });
    assert.equal(res.statusCode, 401, res.body);
  });
});

test("healthcheck ping requires health app access (403 for non-health user)", async () => {
  await withApp(async app => {
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/healthcheck/ping",
      headers: { cookie },
      payload: { message: "hi", idempotencyKey: "hc-noaccess" }
    });
    assert.equal(res.statusCode, 403, res.body);
  });
});

test("healthcheck ping validates input (400 on missing message or idempotencyKey)", async () => {
  await withApp(async app => {
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/healthcheck/ping",
      headers: { cookie },
      payload: {}
    });
    assert.equal(res.statusCode, 400, res.body);
  });
});

test("healthcheck ping returns deterministic echo + writes exactly one audit_events row", async () => {
  await withApp(async app => {
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    const res = await app.inject({
      method: "POST",
      url: "/api/healthcheck/ping",
      headers: { cookie },
      payload: { message: "skeleton", idempotencyKey: "hc-1" }
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.healthcheck.message, "skeleton");
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(body.healthcheck.respondedAt), `respondedAt should be ISO: ${body.healthcheck.respondedAt}`);
    const after = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    assert.equal(after, before + 1, "audit_events row must be written");
  });
});

test("healthcheck ping is idempotent on replay (same key returns cached envelope, no duplicate audit row)", async () => {
  await withApp(async app => {
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    const payload = {
      method: "POST",
      url: "/api/healthcheck/ping",
      headers: { cookie },
      payload: { message: "skeleton", idempotencyKey: "hc-2" }
    };
    const first = await app.inject(payload);
    const second = await app.inject(payload);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(second.statusCode, 200, second.body);
    assert.deepEqual(first.json(), second.json());
    const after = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    assert.equal(after, before + 1, "idempotency must suppress duplicate audit row");
  });
});
