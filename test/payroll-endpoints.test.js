"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD } });
  return res.headers["set-cookie"];
}

test("payroll run computes net and posts a balanced ledger entry", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const orgId = app.db.prepare("SELECT id FROM organizations LIMIT 1").get().id;
    const openPeriod = app.db.prepare("SELECT period_key FROM finance_periods WHERE org_id = ? AND status='open' LIMIT 1").get(orgId).period_key;
    const calc = await app.inject({ method: "POST", url: "/api/payroll/calculate", headers: { cookie }, payload: { gross: 600000 } });
    assert.strictEqual(calc.json().payroll.net, 436500);
    const run = await app.inject({ method: "POST", url: "/api/payroll/run", headers: { cookie }, payload: { employeeName: "Անի", gross: 600000, runDate: `${openPeriod}-28` } });
    assert.strictEqual(run.statusCode, 200);
    assert.strictEqual(run.json().run.net, 436500);
    const tb = await app.inject({ method: "GET", url: "/api/finance/trial-balance", headers: { cookie } });
    const byCode = Object.fromEntries(tb.json().rows.map(r => [r.code, r]));
    assert.strictEqual(byCode["714"].balance, 600000);
    assert.strictEqual(byCode["521"].balance, -436500);
    assert.strictEqual(byCode["525"].balance, -163500);
    assert.strictEqual(tb.json().balanced, true);
    const runs = await app.inject({ method: "GET", url: "/api/payroll/runs", headers: { cookie } });
    assert.ok(runs.json().runs.length >= 1);
  } finally { await app.close(); }
});
