"use strict";
const crypto = require("node:crypto");
const accounting = require("./accounting");

const CHART = [
  { code: "251", name: "Դրամարկղ", type: "asset" },
  { code: "252", name: "Հաշվարկային հաշիվ", type: "asset" },
  { code: "221", name: "Դեբիտորական պարտքեր", type: "asset" },
  { code: "521", name: "Կրեդիտորական պարտքեր", type: "liability" },
  { code: "524", name: "ԱԱՀ վճարվելիք", type: "liability" },
  { code: "525", name: "Հաշվարկներ բյուջեի և հիմնադրամների հետ", type: "liability" },
  { code: "526", name: "ԱԱՀ դեբետ (մուտքային)", type: "asset" },
  { code: "611", name: "Հասույթ", type: "income" },
  { code: "711", name: "Ծախսեր", type: "expense" },
  { code: "714", name: "Աշխատավարձի ծախս", type: "expense" }
];

function ensureChartOfAccounts(db, orgId) {
  const insert = db.prepare("INSERT OR IGNORE INTO ledger_accounts (id, org_id, code, name, type) VALUES (?, ?, ?, ?, ?)");
  for (const a of CHART) insert.run(`acct-${orgId}-${a.code}`, orgId, a.code, a.name, a.type);
}

class PeriodLockedError extends Error {
  constructor(periodKey) {
    super(`finance period ${periodKey} is closed — cannot post ledger entries`);
    this.name = "PeriodLockedError";
    this.code = "PERIOD_LOCKED";
    this.statusCode = 409;
  }
}

function assertPeriodOpen(db, orgId, periodKey) {
  if (!periodKey) return;
  const row = db.prepare("SELECT status FROM finance_periods WHERE org_id = ? AND period_key = ?").get(orgId, periodKey);
  if (row && row.status === "closed") throw new PeriodLockedError(periodKey);
}

function postEntry(db, orgId, entry) {
  const { date, debitCode, creditCode, amount, memo = "", sourceType = "", sourceId = "", periodKey = "" } = entry;
  const value = Math.round(Number(amount) || 0);
  if (value <= 0) return null;
  assertPeriodOpen(db, orgId, periodKey);
  ensureChartOfAccounts(db, orgId);
  const id = `jrn-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const res = db.prepare(`
    INSERT OR IGNORE INTO ledger_journal
      (id, org_id, entry_date, debit_code, credit_code, amount, memo, source_type, source_id, period_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, orgId, String(date).slice(0, 10), debitCode, creditCode, value, memo, sourceType, sourceId, periodKey, now);
  return res.changes > 0 ? id : null;
}

function postInvoicePosted(db, orgId, invoice) {
  const total = Math.round(Number(invoice.total) || 0);
  const vat = Math.round(Number(invoice.vat) || 0);
  // Prefer the source document's net (subtotal) so the ledger matches the invoice
  // exactly; fall back to total - vat when no subtotal is supplied.
  const hasSubtotal = invoice.subtotal !== undefined && invoice.subtotal !== null && invoice.subtotal !== "";
  const net = hasSubtotal ? Math.round(Number(invoice.subtotal) || 0) : total - vat;
  const date = invoice.date || invoice.issue_date || new Date().toISOString().slice(0, 10);
  const periodKey = invoice.period_key || "";
  const ids = [];
  if (net > 0) ids.push(postEntry(db, orgId, { date, debitCode: "221", creditCode: "611", amount: net, memo: `Invoice ${invoice.number || invoice.id}`, sourceType: "invoice", sourceId: invoice.id, periodKey }));
  if (vat > 0) ids.push(postEntry(db, orgId, { date, debitCode: "221", creditCode: "524", amount: vat, memo: `VAT ${invoice.number || invoice.id}`, sourceType: "invoice", sourceId: invoice.id, periodKey }));
  return ids.filter(Boolean);
}

function postPaymentReceived(db, orgId, payment) {
  return [postEntry(db, orgId, {
    date: payment.date || payment.paid_at || new Date().toISOString().slice(0, 10),
    debitCode: "251", creditCode: "221", amount: payment.amount,
    memo: `Payment ${payment.id}`, sourceType: "payment", sourceId: payment.id, periodKey: payment.period_key || ""
  })].filter(Boolean);
}

function buildLedgerModel(db, orgId) {
  ensureChartOfAccounts(db, orgId);
  const accounts = db.prepare("SELECT code, name, type FROM ledger_accounts WHERE org_id = ?").all(orgId)
    .map(a => ({ id: a.code, code: a.code, name: a.name, type: a.type }));
  const journal = db.prepare("SELECT entry_date, debit_code, credit_code, amount FROM ledger_journal WHERE org_id = ?").all(orgId)
    .map(j => ({ date: j.entry_date, debitAccount: j.debit_code, creditAccount: j.credit_code, amount: j.amount }));
  return { accounts, journal, invoices: [], expenses: [], bills: [], budgets: [] };
}

function trialBalance(db, orgId) {
  const model = buildLedgerModel(db, orgId);
  const balances = accounting.calculateBalances(model);
  const byCode = new Map(model.accounts.map(a => [a.code, a]));
  let totalDebit = 0, totalCredit = 0;
  const rows = Object.entries(balances).map(([code, b]) => {
    totalDebit += b.debit; totalCredit += b.credit;
    const acc = byCode.get(code) || {};
    return { code, name: acc.name || code, type: acc.type || "", debit: accounting.roundMoney(b.debit), credit: accounting.roundMoney(b.credit), balance: accounting.roundMoney(b.balance) };
  }).sort((a, b) => String(a.code).localeCompare(String(b.code)));
  return { rows, totalDebit: accounting.roundMoney(totalDebit), totalCredit: accounting.roundMoney(totalCredit), balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
}

function postExpensePosted(db, orgId, expense) {
  const total = Math.round(Number(expense.total) || 0);
  const vat = Math.round(Number(expense.vat) || 0);
  const hasSubtotal = expense.subtotal !== undefined && expense.subtotal !== null && expense.subtotal !== "";
  const net = hasSubtotal ? Math.round(Number(expense.subtotal) || 0) : total - vat;
  const date = expense.date || expense.incurred_on || new Date().toISOString().slice(0, 10);
  const periodKey = expense.period_key || "";
  const ids = [];
  if (net > 0) ids.push(postEntry(db, orgId, { date, debitCode: "711", creditCode: "521", amount: net, memo: `Expense ${expense.description || expense.id}`, sourceType: "expense", sourceId: expense.id, periodKey }));
  if (vat > 0) ids.push(postEntry(db, orgId, { date, debitCode: "526", creditCode: "521", amount: vat, memo: `Input VAT ${expense.id}`, sourceType: "expense", sourceId: expense.id, periodKey }));
  return ids.filter(Boolean);
}

function vatReport(db, orgId, periodKey = "") {
  const filter = periodKey ? "AND period_key = ?" : "";
  const args = periodKey ? [orgId, periodKey] : [orgId];
  const outputVat = db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM ledger_journal WHERE org_id = ? AND credit_code = '524' ${filter}`).get(...args).v;
  const inputVat = db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM ledger_journal WHERE org_id = ? AND debit_code = '526' ${filter}`).get(...args).v;
  return {
    periodKey: periodKey || "all",
    outputVat: accounting.roundMoney(outputVat),
    inputVat: accounting.roundMoney(inputVat),
    netVatPayable: accounting.roundMoney(outputVat - inputVat),
    note: "Indicative VAT from posted ledger entries; review with an Armenian accountant before filing."
  };
}

function postPayrollRun(db, orgId, run) {
  const gross = Math.round(Number(run.gross) || 0);
  const net = Math.round(Number(run.net) || 0);
  const deductions = Math.round(Number(run.totalDeductions != null ? run.totalDeductions : gross - net) || 0);
  const date = run.date || run.run_date || new Date().toISOString().slice(0, 10);
  const periodKey = run.period_key || "";
  const ids = [];
  if (net > 0) ids.push(postEntry(db, orgId, { date, debitCode: "714", creditCode: "521", amount: net, memo: `Payroll net ${run.employeeName || run.id}`, sourceType: "payroll", sourceId: run.id, periodKey }));
  if (deductions > 0) ids.push(postEntry(db, orgId, { date, debitCode: "714", creditCode: "525", amount: deductions, memo: `Payroll withholdings ${run.id}`, sourceType: "payroll", sourceId: run.id, periodKey }));
  return ids.filter(Boolean);
}

function postBillPosted(db, orgId, bill) {
  const total = Math.round(Number(bill.total) || 0);
  const vat = Math.round(Number(bill.vat) || 0);
  const hasSubtotal = bill.subtotal !== undefined && bill.subtotal !== null && bill.subtotal !== "";
  const net = hasSubtotal ? Math.round(Number(bill.subtotal) || 0) : total - vat;
  const date = bill.date || bill.bill_date || new Date().toISOString().slice(0, 10);
  const periodKey = bill.period_key || "";
  const ids = [];
  if (net > 0) ids.push(postEntry(db, orgId, { date, debitCode: "711", creditCode: "521", amount: net, memo: `Bill ${bill.supplier || bill.id}`, sourceType: "bill", sourceId: bill.id, periodKey }));
  if (vat > 0) ids.push(postEntry(db, orgId, { date, debitCode: "526", creditCode: "521", amount: vat, memo: `Bill VAT ${bill.id}`, sourceType: "bill", sourceId: bill.id, periodKey }));
  return ids.filter(Boolean);
}

function postBillPayment(db, orgId, payment) {
  return [postEntry(db, orgId, {
    date: payment.date || payment.paid_at || new Date().toISOString().slice(0, 10),
    debitCode: "521", creditCode: "251", amount: payment.amount,
    memo: `Bill payment ${payment.id}`, sourceType: "bill_payment", sourceId: payment.id, periodKey: payment.period_key || ""
  })].filter(Boolean);
}

function buildPayablesModel(db, orgId) {
  const bills = db.prepare("SELECT id, supplier, bill_date AS date, due_date AS dueDate, total, status FROM bills WHERE org_id = ?").all(orgId).map(b => {
    const paid = db.prepare("SELECT COALESCE(SUM(amount),0) AS p FROM bill_payments WHERE org_id = ? AND bill_id = ?").get(orgId, b.id).p;
    return { ...b, paidAmount: paid };
  });
  return { bills };
}

function payablesReport(db, orgId, asOf) {
  return accounting.calculatePayables(buildPayablesModel(db, orgId), { asOf: asOf || new Date().toISOString().slice(0, 10) });
}

module.exports = { CHART, ensureChartOfAccounts, postEntry, postInvoicePosted, postPaymentReceived, postExpensePosted, postPayrollRun, postBillPosted, postBillPayment, buildPayablesModel, payablesReport, vatReport, buildLedgerModel, trialBalance, assertPeriodOpen, PeriodLockedError };
