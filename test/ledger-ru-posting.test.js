"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { openDatabase } = require("../server/db");
const ledger = require("../server/ledger");

function withLocale(value, fn) {
  const prev = process.env.A1_LOCALE;
  if (value === undefined) delete process.env.A1_LOCALE;
  else process.env.A1_LOCALE = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.A1_LOCALE;
    else process.env.A1_LOCALE = prev;
  }
}

function freshDb() {
  const db = openDatabase(":memory:");
  const orgId = db.prepare("SELECT id FROM organizations LIMIT 1").get().id;
  return { db, orgId };
}

function balances(db, orgId) {
  return Object.fromEntries(ledger.trialBalance(db, orgId).rows.map((r) => [r.code, r]));
}

test("RU invoice → DR62 (AR) / CR90 (revenue) + CR68 (output VAT), balanced", () => {
  withLocale("ru", () => {
    const { db, orgId } = freshDb();
    ledger.postInvoicePosted(db, orgId, { id: "inv-1", number: "INV-1", total: 1220, vat: 220, date: "2026-05-10" });
    const tb = ledger.trialBalance(db, orgId);
    assert.equal(tb.balanced, true);
    const b = balances(db, orgId);
    assert.equal(b["62"].balance, 1220); // AR debit
    assert.equal(b["90"].balance, -1000); // revenue credit
    assert.equal(b["68"].balance, -220); // output VAT credit
    assert.match(b["62"].name, /покупател/); // RU name from seeded chart
  });
});

test("RU payment → DR51 (bank) / CR62 (AR)", () => {
  withLocale("ru", () => {
    const { db, orgId } = freshDb();
    ledger.postInvoicePosted(db, orgId, { id: "inv-1", total: 1000, vat: 0, date: "2026-05-10" });
    ledger.postPaymentReceived(db, orgId, { id: "pay-1", amount: 1000, date: "2026-05-12" });
    const b = balances(db, orgId);
    assert.equal(b["51"].balance, 1000); // bank debit
    assert.equal(b["62"].balance, 0); // AR settled
  });
});

test("RU expense → DR26 (expense) / CR60 (AP) + DR19 (input VAT)", () => {
  withLocale("ru", () => {
    const { db, orgId } = freshDb();
    ledger.postExpensePosted(db, orgId, { id: "exp-1", total: 1220, vat: 220, date: "2026-05-10" });
    const tb = ledger.trialBalance(db, orgId);
    assert.equal(tb.balanced, true);
    const b = balances(db, orgId);
    assert.equal(b["26"].balance, 1000); // expense debit
    assert.equal(b["19"].balance, 220); // input VAT debit
    assert.equal(b["60"].balance, -1220); // AP credit
  });
});

test("RU bill + bill payment → AP 60 settled, bank 51 out", () => {
  withLocale("ru", () => {
    const { db, orgId } = freshDb();
    ledger.postBillPosted(db, orgId, { id: "bill-1", total: 600, vat: 0, date: "2026-05-10" });
    ledger.postBillPayment(db, orgId, { id: "bp-1", amount: 600, date: "2026-05-12" });
    const tb = ledger.trialBalance(db, orgId);
    assert.equal(tb.balanced, true);
    const b = balances(db, orgId);
    assert.equal(b["60"].balance, 0); // AP settled
    assert.equal(b["51"].balance, -600); // bank credit (paid out)
    assert.equal(b["26"].balance, 600); // expense
  });
});

test("RU payroll → DR26 / CR70 (net) + CR68 (НДФЛ)", () => {
  withLocale("ru", () => {
    const { db, orgId } = freshDb();
    ledger.postPayrollRun(db, orgId, { id: "pr-1", gross: 100000, net: 87000, totalDeductions: 13000, date: "2026-05-31" });
    const tb = ledger.trialBalance(db, orgId);
    assert.equal(tb.balanced, true);
    const b = balances(db, orgId);
    assert.equal(b["26"].balance, 100000); // expense (gross)
    assert.equal(b["70"].balance, -87000); // net wages payable
    assert.equal(b["68"].balance, -13000); // НДФЛ payable
  });
});

test("AM postings unchanged under the default locale (regression guard)", () => {
  withLocale(undefined, () => {
    const { db, orgId } = freshDb();
    ledger.postInvoicePosted(db, orgId, { id: "inv-1", total: 1200, vat: 200, date: "2026-05-10" });
    const b = balances(db, orgId);
    assert.equal(b["221"].balance, 1200);
    assert.equal(b["611"].balance, -1000);
    assert.equal(b["524"].balance, -200);
  });
});
