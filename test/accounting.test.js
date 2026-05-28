"use strict";
const test = require("node:test");
const assert = require("node:assert");
const acc = require("../server/accounting");

function model() {
  return {
    accounts: [
      { id: "a-cash", code: "251", name: "Դրամարկղ", type: "asset" },
      { id: "a-rev", code: "611", name: "Հասույթ", type: "income" },
      { id: "a-rec", code: "221", name: "Դեբիտորական", type: "asset" },
      { id: "a-vat", code: "524", name: "ԱԱՀ վճարվելիք", type: "liability" }
    ],
    journal: [
      { date: "2026-05-10", debitAccount: "a-cash", creditAccount: "a-rev", amount: 1000 }
    ],
    invoices: [
      { id: "inv1", date: "2026-05-10", status: "posted", vatRate: 20, vatAmount: 200, netAmount: 1000, total: 1200 }
    ],
    expenses: []
  };
}

test("calculateBalances reflects a Dt cash / Kt revenue entry", () => {
  const b = acc.calculateBalances(model());
  assert.strictEqual(b["a-cash"].balance, 1000);
  assert.strictEqual(b["a-rev"].balance, -1000);
});

test("financialStatements: income 1000, net profit 1000, balanced", () => {
  const s = acc.financialStatements(model());
  assert.strictEqual(s.incomeStatement.totalIncome, 1000);
  assert.strictEqual(s.incomeStatement.netProfit, 1000);
  assert.strictEqual(s.balanceSheet.balanced, true);
});

test("calculateTaxReport computes output VAT and net payable", () => {
  const r = acc.calculateTaxReport(model());
  assert.strictEqual(r.outputVat, 200);
  assert.strictEqual(r.inputVat, 0);
  assert.strictEqual(r.netVatPayable, 200);
});

test("roundMoney rounds to 2 decimals", () => {
  assert.strictEqual(acc.roundMoney(1.234), 1.23);
});
