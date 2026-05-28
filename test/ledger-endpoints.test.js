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

test("trial-balance + statements endpoints reflect posted ledger entries", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const orgId = app.db.prepare("SELECT id FROM organizations LIMIT 1").get().id;
    ledger.postInvoicePosted(app.db, orgId, { id: "inv-e1", total: 1200, vat: 200, date: "2026-05-10" });
    const unauth = await app.inject({ method: "GET", url: "/api/finance/trial-balance" });
    assert.strictEqual(unauth.statusCode, 401);
    const res = await app.inject({ method: "GET", url: "/api/finance/trial-balance", headers: { cookie } });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.balanced, true);
    assert.strictEqual(body.rows.find(r => r.code === "221").balance, 1200);
    const st = await app.inject({ method: "GET", url: "/api/finance/statements", headers: { cookie } });
    assert.strictEqual(st.json().incomeStatement.totalIncome, 1000);
  } finally { await app.close(); }
});
