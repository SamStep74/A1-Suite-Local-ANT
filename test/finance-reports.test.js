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

test("expense posting rejects malformed metadata before persistence", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const orgId = app.db.prepare("SELECT id FROM organizations LIMIT 1").get().id;
    const openPeriod = app.db.prepare("SELECT period_key FROM finance_periods WHERE org_id = ? AND status='open' LIMIT 1").get(orgId).period_key;
    const expenseCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM expenses
    `).get().count;
    const expenseSecretCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM expenses
      WHERE description LIKE ?
        OR vendor LIKE ?
        OR incurred_on LIKE ?
        OR description = ?
        OR vendor = ?
    `).get(
      "%secret-expense-%",
      "%secret-expense-%",
      "%secret-expense-%",
      "[object Object]",
      "[object Object]"
    ).count;
    const ledgerCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM ledger_journal
    `).get().count;
    const ledgerSecretCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM ledger_journal
      WHERE memo LIKE ?
        OR memo = ?
    `).get("%secret-expense-%", "Expense [object Object]").count;
    const auditCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM audit_events
      WHERE type = ?
    `).get("finance.expense.created").count;

    const expenseCountBefore = expenseCount();
    const ledgerCountBefore = ledgerCount();
    const auditCountBefore = auditCount();
    const basePayload = {
      description: "Office supplies",
      vendor: "Yerevan Office Supply",
      subtotal: 500,
      vat: 100,
      incurredOn: `${openPeriod}-11`
    };
    const malformedRequests = [
      null,
      { ...basePayload, subtotal: ["500"], description: "secret-expense-array-subtotal-token" },
      { ...basePayload, subtotal: { value: 500, token: "secret-expense-object-subtotal-token" } },
      { ...basePayload, subtotal: "500\nsecret-expense-control-subtotal-token" },
      { ...basePayload, vat: ["100"], description: "secret-expense-array-vat-token" },
      { ...basePayload, vat: { value: 100, token: "secret-expense-object-vat-token" } },
      { ...basePayload, vat: -1, description: "secret-expense-negative-vat-token" },
      { ...basePayload, incurredOn: [`${openPeriod}-11`], description: "secret-expense-array-date-token" },
      { ...basePayload, incurredOn: `${openPeriod}-11\nsecret-expense-control-date-token` },
      { ...basePayload, incurredOn: "not-a-date-secret-expense-date-token" },
      { ...basePayload, incurredOn: "2026-02-30", description: "secret-expense-impossible-date-token" },
      { ...basePayload, description: { text: "Office supplies", token: "secret-expense-object-description-token" } },
      { ...basePayload, description: "Office supplies\nsecret-expense-control-description-token" },
      { ...basePayload, description: `${"D".repeat(201)}secret-expense-long-description-token` },
      { ...basePayload, vendor: { text: "Yerevan Office Supply", token: "secret-expense-object-vendor-token" } },
      { ...basePayload, vendor: "Yerevan Office Supply\nsecret-expense-control-vendor-token" },
      ["secret-expense-array-body-token"]
    ];

    for (const payload of malformedRequests) {
      const rejected = await app.inject({
        method: "POST",
        url: "/api/finance/expenses",
        headers: { cookie },
        payload
      });
      assert.strictEqual(rejected.statusCode, 400, rejected.body);
      assert.doesNotMatch(rejected.body, /secret-expense-/);
    }

    assert.strictEqual(expenseCount(), expenseCountBefore);
    assert.strictEqual(expenseSecretCount(), 0);
    assert.strictEqual(ledgerCount(), ledgerCountBefore);
    assert.strictEqual(ledgerSecretCount(), 0);
    assert.strictEqual(auditCount(), auditCountBefore);

    const created = await app.inject({
      method: "POST",
      url: "/api/finance/expenses",
      headers: { cookie },
      payload: {
        description: "Guarded office expense",
        vendor: "Yerevan Office Supply",
        subtotal: "500",
        vat: "100",
        incurredOn: `${openPeriod}-12`
      }
    });
    assert.strictEqual(created.statusCode, 200, created.body);
    assert.strictEqual(created.json().expense.subtotal, 500);
    assert.strictEqual(created.json().expense.vat, 100);
    assert.strictEqual(created.json().expense.total, 600);
  } finally { await app.close(); }
});
