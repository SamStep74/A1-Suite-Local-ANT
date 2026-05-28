"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { openDatabase } = require("../server/db");
const ledger = require("../server/ledger");
const accounting = require("../server/accounting");

function freshDb() {
  const db = openDatabase(":memory:");
  const orgId = db.prepare("SELECT id FROM organizations LIMIT 1").get().id;
  return { db, orgId };
}

test("posting an invoice creates balanced Dt receivable / Kt revenue+VAT entries", () => {
  const { db, orgId } = freshDb();
  ledger.postInvoicePosted(db, orgId, { id: "inv-t1", number: "INV-1", total: 1200, vat: 200, date: "2026-05-10", period_key: "" });
  const tb = ledger.trialBalance(db, orgId);
  assert.strictEqual(tb.balanced, true);
  const byCode = Object.fromEntries(tb.rows.map(r => [r.code, r]));
  assert.strictEqual(byCode["221"].balance, 1200);
  assert.strictEqual(byCode["611"].balance, -1000);
  assert.strictEqual(byCode["524"].balance, -200);
});

test("statements show revenue and a balanced sheet", () => {
  const { db, orgId } = freshDb();
  ledger.postInvoicePosted(db, orgId, { id: "inv-t1", total: 1200, vat: 200, date: "2026-05-10" });
  const s = accounting.financialStatements(ledger.buildLedgerModel(db, orgId));
  assert.strictEqual(s.incomeStatement.totalIncome, 1000);
  assert.strictEqual(s.balanceSheet.balanced, true);
});

test("payment posts Dt cash / Kt receivable and clears the receivable", () => {
  const { db, orgId } = freshDb();
  ledger.postInvoicePosted(db, orgId, { id: "inv-t1", total: 1200, vat: 200, date: "2026-05-10" });
  ledger.postPaymentReceived(db, orgId, { id: "pay-t1", invoice_id: "inv-t1", amount: 1200, date: "2026-05-12" });
  const byCode = Object.fromEntries(ledger.trialBalance(db, orgId).rows.map(r => [r.code, r]));
  assert.strictEqual(byCode["221"].balance, 0);
  assert.strictEqual(byCode["251"].balance, 1200);
});

test("posting is idempotent per source", () => {
  const { db, orgId } = freshDb();
  ledger.postInvoicePosted(db, orgId, { id: "inv-t1", total: 1200, vat: 200, date: "2026-05-10" });
  ledger.postInvoicePosted(db, orgId, { id: "inv-t1", total: 1200, vat: 200, date: "2026-05-10" });
  const count = db.prepare("SELECT COUNT(*) AS c FROM ledger_journal WHERE org_id = ?").get(orgId).c;
  assert.strictEqual(count, 2);
});

test("invoice net is taken from the source subtotal when provided", () => {
  const { db, orgId } = freshDb();
  // total/vat round-trip would mis-split; subtotal is authoritative.
  ledger.postInvoicePosted(db, orgId, { id: "inv-sub", total: 151, vat: 50, subtotal: 101, date: "2026-05-10" });
  const byCode = Object.fromEntries(ledger.trialBalance(db, orgId).rows.map(r => [r.code, r]));
  assert.strictEqual(byCode["611"].balance, -101);
  assert.strictEqual(byCode["524"].balance, -50);
  assert.strictEqual(byCode["221"].balance, 151);
});

test("posting into a closed period is blocked", () => {
  const { db, orgId } = freshDb();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO finance_periods (id, org_id, period_key, starts_on, ends_on, status, reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`).run("per-closed", orgId, "2099-01", "2099-01-01", "2099-01-31", "closed", now, now);
  assert.throws(() => ledger.postEntry(db, orgId, { date: "2099-01-10", debitCode: "221", creditCode: "611", amount: 1000, sourceType: "invoice", sourceId: "inv-x", periodKey: "2099-01" }), /PERIOD_LOCKED|closed/);
});
