"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD } });
  return res.headers["set-cookie"];
}

test("bill create + pay flows through the ledger and AP report", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const orgId = app.db.prepare("SELECT id FROM organizations LIMIT 1").get().id;
    const openPeriod = app.db.prepare("SELECT period_key FROM finance_periods WHERE org_id = ? AND status='open' LIMIT 1").get(orgId).period_key;
    const created = await app.inject({ method: "POST", url: "/api/finance/bills", headers: { cookie }, payload: { supplier: "Acme", subtotal: 500, vat: 100, billDate: `${openPeriod}-05`, dueDate: `${openPeriod}-10` } });
    assert.strictEqual(created.statusCode, 200);
    const billId = created.json().bill.id;
    const tb = Object.fromEntries((await app.inject({ method: "GET", url: "/api/finance/trial-balance", headers: { cookie } })).json().rows.map(r => [r.code, r]));
    assert.strictEqual(tb["521"].balance, -600);
    const ap = await app.inject({ method: "GET", url: "/api/finance/payables", headers: { cookie } });
    assert.strictEqual(ap.json().totalOutstanding, 600);
    const pay = await app.inject({ method: "POST", url: `/api/finance/bills/${billId}/pay`, headers: { cookie }, payload: { amount: 600, paidAt: `${openPeriod}-20` } });
    assert.strictEqual(pay.statusCode, 200);
    const tb2 = await app.inject({ method: "GET", url: "/api/finance/trial-balance", headers: { cookie } });
    assert.strictEqual(tb2.json().balanced, true);
    assert.strictEqual(Object.fromEntries(tb2.json().rows.map(r => [r.code, r]))["521"].balance, 0);
    const ap2 = await app.inject({ method: "GET", url: "/api/finance/payables", headers: { cookie } });
    assert.strictEqual(ap2.json().totalOutstanding, 0);
  } finally { await app.close(); }
});
