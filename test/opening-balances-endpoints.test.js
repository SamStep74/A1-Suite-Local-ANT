"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD } });
  return res.headers["set-cookie"];
}

test("opening-balances endpoints: auth, post, balanced statements, idempotent", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const unauth = await app.inject({ method: "GET", url: "/api/finance/opening-balances" });
    assert.strictEqual(unauth.statusCode, 401);
    const cookie = await login(app);
    const post = await app.inject({ method: "POST", url: "/api/finance/opening-balances", headers: { cookie },
      payload: { asOf: "2026-01-01", entries: [{ code: "251", amount: 1000000 }, { code: "521", amount: 400000 }] } });
    assert.strictEqual(post.statusCode, 200);
    assert.strictEqual(post.json().count, 2);
    assert.strictEqual(post.json().openingEquity, 600000);
    const st = await app.inject({ method: "GET", url: "/api/finance/statements", headers: { cookie } });
    assert.strictEqual(st.json().balanceSheet.balanced, true);
    assert.strictEqual(st.json().balanceSheet.totalEquity, 600000);
    // idempotent re-post
    await app.inject({ method: "POST", url: "/api/finance/opening-balances", headers: { cookie },
      payload: { asOf: "2026-01-01", entries: [{ code: "251", amount: 1000000 }, { code: "521", amount: 400000 }] } });
    const list = await app.inject({ method: "GET", url: "/api/finance/opening-balances", headers: { cookie } });
    assert.strictEqual(list.json().count, 2);
  } finally { await app.close(); }
});

test("opening-balances POST is writer-gated: Auditor is rejected (403) and nothing is posted", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/login", payload: { email: "auditor@armosphera.local", password: DEFAULT_PASSWORD } });
    const cookie = res.headers["set-cookie"];
    const post = await app.inject({ method: "POST", url: "/api/finance/opening-balances", headers: { cookie },
      payload: { asOf: "2026-01-01", entries: [{ code: "251", amount: 1000000 }] } });
    assert.strictEqual(post.statusCode, 403);
    const orgId = app.db.prepare("SELECT id FROM organizations LIMIT 1").get().id;
    const count = app.db.prepare("SELECT COUNT(*) AS c FROM ledger_journal WHERE org_id = ? AND source_type = 'opening_balance'").get(orgId).c;
    assert.strictEqual(count, 0);
  } finally { await app.close(); }
});

test("opening-balances POST is rejected for a closed period (409) and nothing is posted", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const orgId = app.db.prepare("SELECT id FROM organizations LIMIT 1").get().id;
    const openPeriod = app.db.prepare("SELECT period_key FROM finance_periods WHERE org_id = ? AND status='open' LIMIT 1").get(orgId).period_key;
    const close = await app.inject({ method: "POST", url: `/api/finance/periods/${openPeriod}/close`, headers: { cookie }, payload: { reason: "test close" } });
    assert.strictEqual(close.statusCode, 200, close.body);
    const post = await app.inject({ method: "POST", url: "/api/finance/opening-balances", headers: { cookie },
      payload: { asOf: `${openPeriod}-01`, entries: [{ code: "251", amount: 1000000 }] } });
    assert.strictEqual(post.statusCode, 409);
    const count = app.db.prepare("SELECT COUNT(*) AS c FROM ledger_journal WHERE org_id = ? AND source_type = 'opening_balance'").get(orgId).c;
    assert.strictEqual(count, 0);
  } finally { await app.close(); }
});
