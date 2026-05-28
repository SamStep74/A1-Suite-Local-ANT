"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const ledger = require("../server/ledger");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD } });
  return res.headers["set-cookie"];
}

test("VAT report nets posted output and input VAT; expense endpoint posts to ledger", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const orgId = app.db.prepare("SELECT id FROM organizations LIMIT 1").get().id;
    const openPeriod = app.db.prepare("SELECT period_key FROM finance_periods WHERE org_id = ? AND status='open' LIMIT 1").get(orgId).period_key;
    ledger.postInvoicePosted(app.db, orgId, { id: "inv-r1", total: 1200, vat: 200, subtotal: 1000, date: `${openPeriod}-10`, period_key: openPeriod });
    const exp = await app.inject({ method: "POST", url: "/api/finance/expenses", headers: { cookie }, payload: { description: "Supplies", subtotal: 500, vat: 100, incurredOn: `${openPeriod}-11` } });
    assert.strictEqual(exp.statusCode, 200);
    const unauth = await app.inject({ method: "GET", url: "/api/finance/vat-report" });
    assert.strictEqual(unauth.statusCode, 401);
    const vr = await app.inject({ method: "GET", url: "/api/finance/vat-report", headers: { cookie } });
    const body = vr.json();
    assert.strictEqual(body.outputVat, 200);
    assert.strictEqual(body.inputVat, 100);
    assert.strictEqual(body.netVatPayable, 100);
    const list = await app.inject({ method: "GET", url: "/api/finance/expenses", headers: { cookie } });
    assert.ok(list.json().expenses.length >= 1);
  } finally { await app.close(); }
});
