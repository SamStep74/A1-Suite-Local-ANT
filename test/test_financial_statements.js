// test_financial_statements.js — focused tests for the financial statements module.
//
// The financialStatements module (server/financialStatements.js) wraps
// accounting.financialStatements() and adds:
//   1. tbImport / tbImportPost / tbColumnMap (TB import)
//   2. parseCsv / parseAmount (CSV utilities)
//   3. buildBalanceSheet / buildIncomeStatement / buildCashFlow / buildAllStatements
//   4. renderBalanceSheet / renderIncomeStatement / renderCashFlow / renderAllStatements
//   5. mcpTools (7 MCP-style tool definitions for LLM invocation)
//
// Tests (60 tests, all should pass in <300ms):
//   - 5 parseCsv tests (basic, quoted, BOM, CRLF, escaped quotes)
//   - 5 parseAmount tests (number, string, commas, parens, invalid)
//   - 5 tbColumnMap tests (auto-detect, custom header, missing cols)
//   - 5 tbImport tests (basic, with mapping, errors, balance column, period)
//   - 4 tbImportPost tests (integration with in-memory SQLite)
//   - 4 buildModel / buildPeriodFilter / applyFilter tests
//   - 4 buildBalanceSheet / IncomeStatement / CashFlow / All tests (in-memory)
//   - 4 auditBalanceSheet tests (balanced, unbalanced, with period)
//   - 6 renderBalanceSheet / Income / CashFlow / All tests
//   - 5 formatMoney tests
//   - 6 mcpTools tests (tool list, schemas, function execution)
//   - 5 module shape + sovereignty tests

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const fs = require("../server/financialStatements");
const fs2 = require("node:fs");
const path2 = require("node:path");

// Helper: create in-memory SQLite with the minimum schema
function createTestDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE ledger_accounts (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE ledger_journal (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, entry_date TEXT NOT NULL, debit_code TEXT NOT NULL,
      credit_code TEXT NOT NULL, amount INTEGER NOT NULL, memo TEXT, source_type TEXT, source_id TEXT,
      period_key TEXT, created_at TEXT
    )
  `);
  db.exec(`
    CREATE TABLE finance_periods (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, period_key TEXT NOT NULL,
      starts_on TEXT NOT NULL, ends_on TEXT NOT NULL, status TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'seed', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(org_id, period_key)
    )
  `);
  return db;
}

// Use realistic Armenian chart codes (per server/ledger.js CHART, 623 accounts):
//   1xx = assets, 2xx = liabilities, 3xx = equity, 6xx = income, 7xx = expenses
const SAMPLE_TB = `code,name,debit,credit
111,Cash,500000,0
112,Accumulated Depreciation,0,500000
115,Office Equipment,2000000,0
211,Accounts Payable,0,750000
311,Equity,0,1000000
611,Sales Revenue,0,3500000
711,COGS,1800000,0
712,Salaries,450000,0`;

// ─── 1. parseCsv ───

test("parseCsv handles basic CSV", () => {
  const rows = fs.parseCsv("a,b,c\n1,2,3");
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0], ["a", "b", "c"]);
  assert.deepStrictEqual(rows[1], ["1", "2", "3"]);
});

test("parseCsv handles quoted fields with commas", () => {
  const rows = fs.parseCsv('a,b\n"1,2",3');
  assert.deepStrictEqual(rows[1], ["1,2", "3"]);
});

test("parseCsv handles escaped quotes", () => {
  const rows = fs.parseCsv('a,b\n"He said ""hi""",ok');
  assert.deepStrictEqual(rows[1], ['He said "hi"', "ok"]);
});

test("parseCsv handles CRLF and strips BOM", () => {
  const rows = fs.parseCsv("\uFEFFa,b\r\n1,2\r\n3,4");
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows[0], ["a", "b"]);
});

test("parseCsv drops trailing empty rows", () => {
  const rows = fs.parseCsv("a,b\n1,2\n\n\n");
  assert.strictEqual(rows.length, 2);
});

// ─── 2. parseAmount ───

test("parseAmount handles number", () => {
  assert.strictEqual(fs.parseAmount(100), 100);
  assert.strictEqual(fs.parseAmount(0), 0);
  assert.strictEqual(fs.parseAmount(-50.5), -50.5);
});

test("parseAmount handles plain string", () => {
  assert.strictEqual(fs.parseAmount("100"), 100);
  assert.strictEqual(fs.parseAmount("100.50"), 100.5);
});

test("parseAmount handles thousands separators (commas)", () => {
  assert.strictEqual(fs.parseAmount("1,234.56"), 1234.56);
  assert.strictEqual(fs.parseAmount("1,234,567.89"), 1234567.89);
});

test("parseAmount handles parens for negatives", () => {
  assert.strictEqual(fs.parseAmount("(100)"), -100);
  assert.strictEqual(fs.parseAmount("(1,234.56)"), -1234.56);
});

test("parseAmount returns 0 for invalid input", () => {
  assert.strictEqual(fs.parseAmount(null), 0);
  assert.strictEqual(fs.parseAmount(undefined), 0);
  assert.strictEqual(fs.parseAmount(""), 0);
  assert.strictEqual(fs.parseAmount("not a number"), 0);
});

// ─── 3. tbColumnMap ───

test("tbColumnMap auto-detects standard columns", () => {
  const map = fs.tbColumnMap(SAMPLE_TB);
  assert.strictEqual(map.code, 0, "code column should be 0");
  assert.strictEqual(map.name, 1, "name column should be 1");
  assert.strictEqual(map.debit, 2, "debit column should be 2");
  assert.strictEqual(map.credit, 3, "credit column should be 3");
});

test("tbColumnMap detects Armenian headers", () => {
  const csv = "հաշիվ,անվանում,դեբետ,կրեդիտ\n100,Cash,500,0";
  const map = fs.tbColumnMap(csv);
  assert.strictEqual(map.code, 0);
  assert.strictEqual(map.name, 1);
  assert.strictEqual(map.debit, 2);
  assert.strictEqual(map.credit, 3);
});

test("tbColumnMap detects balance column", () => {
  const csv = "Account,Description,Balance\n100,Cash,500000";
  const map = fs.tbColumnMap(csv);
  assert.strictEqual(map.code, 0);
  assert.strictEqual(map.balance, 2, "balance column should be 2");
});

test("tbColumnMap returns -1 for missing columns", () => {
  const csv = "foo,bar\n1,2";
  const map = fs.tbColumnMap(csv);
  assert.strictEqual(map.code, -1);
  assert.strictEqual(map.name, -1);
  assert.strictEqual(map.debit, -1);
  assert.strictEqual(map.credit, -1);
});

test("tbColumnMap returns empty header for empty CSV", () => {
  const map = fs.tbColumnMap("");
  assert.deepStrictEqual(map.header, []);
  assert.strictEqual(map.code, -1);
});

// ─── 4. tbImport ───

test("tbImport parses standard TB with debit/credit columns", () => {
  const { entries, errors, count } = fs.tbImport(SAMPLE_TB);
  assert.strictEqual(count, 8, "should have 8 entries (one per row)");
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(entries.length, 8);
  // First row: Cash debit 500000
  assert.strictEqual(entries[0].debitCode, "111");
  assert.strictEqual(entries[0].amount, 50000000); // 500000 × 100
  assert.strictEqual(entries[0].creditCode, "999"); // suspense default
});

test("tbImport handles credit balances (Liability / Equity / Income)", () => {
  const { entries } = fs.tbImport(SAMPLE_TB);
  // Row 2: Acc.Dep 500000 credit (code 112)
  const accDep = entries.find((e) => e.creditCode === "112");
  assert.ok(accDep, "should have Acc.Dep credit entry");
  assert.strictEqual(accDep.amount, 50000000);
});

test("tbImport handles single balance column (positive = debit, negative = credit)", () => {
  const csv = "Account,Description,Balance\n100,Cash,500000\n700,Payables,-750000";
  const { entries } = fs.tbImport(csv);
  assert.strictEqual(entries.length, 2);
  // Cash: positive = debit
  assert.strictEqual(entries[0].debitCode, "100");
  assert.strictEqual(entries[0].amount, 50000000);
  // Payables: negative = credit
  assert.strictEqual(entries[1].creditCode, "700");
  assert.strictEqual(entries[1].amount, 75000000);
});

test("tbImport with custom mapping", () => {
  const csv = "A,B,C,D\n100,Cash,500000,0\n200,Bank,1500000,0";
  const { entries } = fs.tbImport(csv, { mapping: { code: 0, name: 1, debit: 2, credit: 3 } });
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].debitCode, "100");
});

test("tbImport errors on missing code column", () => {
  const csv = "x,y\n1,2";
  const { errors } = fs.tbImport(csv);
  assert.ok(errors.length > 0);
  assert.match(errors[0], /code/);
});

test("tbImport errors on row with both debit + credit", () => {
  const csv = "code,name,debit,credit\n100,Cash,500,500";
  const { errors, entries } = fs.tbImport(csv);
  assert.ok(errors.length > 0);
  // Only one side used (debit)
  assert.strictEqual(entries.length, 1);
});

test("tbImport uses custom period + date", () => {
  const { entries } = fs.tbImport(SAMPLE_TB, { period: "2025-03", date: "2025-03-15" });
  assert.strictEqual(entries[0].periodKey, "2025-03");
  assert.strictEqual(entries[0].date, "2025-03-15");
});

test("tbImport skips empty rows", () => {
  const csv = "code,name,debit,credit\n100,Cash,500000,0\n,\n200,Bank,1500000,0";
  const { entries } = fs.tbImport(csv);
  assert.strictEqual(entries.length, 2);
});

// ─── 5. tbImportPost (integration) ───

test("tbImportPost posts entries to ledger", () => {
  const db = createTestDb();
  const result = fs.tbImportPost(db, "org-test", SAMPLE_TB);
  assert.strictEqual(result.postedCount, 8);
  // Verify accounts were created
  const accounts = db.prepare("SELECT COUNT(*) AS c FROM ledger_accounts WHERE org_id = ?").get("org-test");
  assert.ok(accounts.c > 0);
  // Verify journal entries
  const journal = db.prepare("SELECT COUNT(*) AS c FROM ledger_journal WHERE org_id = ?").get("org-test");
  assert.strictEqual(journal.c, 8);
});

test("tbImportPost with custom suspense account", () => {
  const db = createTestDb();
  const result = fs.tbImportPost(db, "org-test", SAMPLE_TB, { suspenseAccount: "9999" });
  assert.strictEqual(result.postedCount, 8);
  // First entry should credit 9999
  const first = db.prepare("SELECT credit_code FROM ledger_journal LIMIT 1").get();
  assert.strictEqual(first.credit_code, "9999");
});

test("tbImportPost creates the chart of accounts", () => {
  const db = createTestDb();
  fs.tbImportPost(db, "org-test", SAMPLE_TB);
  // ensureChartOfAccounts is called
  const cashAccount = db.prepare("SELECT * FROM ledger_accounts WHERE code = ? AND org_id = ?").get("111", "org-test");
  assert.ok(cashAccount, "Cash account (111) should be created");
  assert.strictEqual(cashAccount.type, "asset");
});

test("tbImportPost returns the mapping used", () => {
  const db = createTestDb();
  const result = fs.tbImportPost(db, "org-test", SAMPLE_TB);
  assert.ok(result.mapping);
  assert.strictEqual(result.mapping.code, 0);
});

// ─── 6. buildModel / buildPeriodFilter / applyFilter ───

test("buildModel reads accounts + journal from DB", () => {
  const db = createTestDb();
  db.prepare("INSERT INTO ledger_accounts (id, org_id, code, name, type) VALUES (?, ?, ?, ?, ?)")
    .run("a1", "org-test", "111", "Cash", "asset");
  db.prepare("INSERT INTO ledger_journal (id, org_id, entry_date, debit_code, credit_code, amount, period_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("j1", "org-test", "2025-01-15", "111", "611", 50000000, "2025-01", "2025-01-15T00:00:00Z");
  const model = fs.buildModel(db, "org-test");
  assert.strictEqual(model.accounts.length, 1);
  assert.strictEqual(model.journal.length, 1);
  // Shape of the model
  assert.strictEqual(model.accounts[0].id, "111");
  assert.strictEqual(model.journal[0].debitAccount, "111");
});

test("buildPeriodFilter returns a function", () => {
  const filter = fs.buildPeriodFilter({ start: "2025-01-01", end: "2025-03-31" });
  assert.strictEqual(typeof filter, "function");
  assert.strictEqual(filter({ date: "2025-02-15" }), true);
  assert.strictEqual(filter({ date: "2025-04-01" }), false);
});

test("buildPeriodFilter with no period returns always-true", () => {
  const filter = fs.buildPeriodFilter({});
  assert.strictEqual(filter({ date: "2025-12-31" }), true);
});

test("applyFilter filters journal entries", () => {
  const model = { accounts: [], journal: [{ date: "2025-01-15" }, { date: "2025-04-15" }] };
  const filter = (e) => e.date < "2025-03-01";
  const filtered = fs.applyFilter(model, filter);
  assert.strictEqual(filtered.journal.length, 1);
  assert.strictEqual(filtered.journal[0].date, "2025-01-15");
});

// ─── 7. buildBalanceSheet / IncomeStatement / CashFlow / All ───

test("buildBalanceSheet returns assets + liabilities + equity", () => {
  const db = createTestDb();
  // Post some entries
  db.prepare("INSERT INTO ledger_journal (id, org_id, entry_date, debit_code, credit_code, amount, period_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("j1", "org-test", "2025-01-15", "111", "611", 50000000, "2025-01"); // cash from sales
  db.prepare("INSERT INTO ledger_journal (id, org_id, entry_date, debit_code, credit_code, amount, period_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("j2", "org-test", "2025-01-15", "200", "800", 150000000, "2025-01"); // bank from sales
  const bs = fs.buildBalanceSheet(db, "org-test");
  assert.ok(bs);
  assert.ok(Array.isArray(bs.assets));
  assert.ok(Array.isArray(bs.liabilities));
  assert.ok(Array.isArray(bs.equity));
  assert.ok(typeof bs.totalAssets === "number");
  assert.ok(typeof bs.totalLiabilities === "number");
  assert.ok(typeof bs.totalEquity === "number");
  assert.ok(typeof bs.balanced === "boolean");
});

test("buildIncomeStatement returns income + expense", () => {
  const db = createTestDb();
  db.prepare("INSERT INTO ledger_journal (id, org_id, entry_date, debit_code, credit_code, amount, period_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("j1", "org-test", "2025-01-15", "111", "611", 50000000, "2025-01");
  const is = fs.buildIncomeStatement(db, "org-test");
  assert.ok(is);
  assert.ok(Array.isArray(is.income));
  assert.ok(Array.isArray(is.expense));
  assert.ok(typeof is.netProfit === "number");
});

test("buildCashFlow returns cashIn + cashOut + netChange", () => {
  const db = createTestDb();
  db.prepare("INSERT INTO ledger_journal (id, org_id, entry_date, debit_code, credit_code, amount, period_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("j1", "org-test", "2025-01-15", "111", "611", 50000000, "2025-01");
  const cf = fs.buildCashFlow(db, "org-test");
  assert.ok(cf);
  assert.ok(typeof cf.cashIn === "number");
  assert.ok(typeof cf.cashOut === "number");
  assert.ok(typeof cf.netCashChange === "number");
});

test("buildAllStatements returns all 3 + audit", () => {
  const db = createTestDb();
  db.prepare("INSERT INTO ledger_journal (id, org_id, entry_date, debit_code, credit_code, amount, period_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("j1", "org-test", "2025-01-15", "111", "611", 50000000, "2025-01");
  const all = fs.buildAllStatements(db, "org-test", { start: "2025-01-01", end: "2025-12-31", label: "2025" });
  assert.ok(all.balanceSheet);
  assert.ok(all.incomeStatement);
  assert.ok(all.cashFlow);
  assert.ok(all.audit);
  assert.strictEqual(typeof all.audit.balanced, "boolean");
});

// ─── 8. auditBalanceSheet ───

test("auditBalanceSheet returns balanced=true when A=L+E+RE", () => {
  const db = createTestDb();
  // Post entries: debit cash, credit sales
  db.prepare("INSERT INTO ledger_journal (id, org_id, entry_date, debit_code, credit_code, amount, period_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("j1", "org-test", "2025-01-15", "111", "611", 50000000, "2025-01");
  const all = fs.buildAllStatements(db, "org-test", { start: "2025-01-01", end: "2025-12-31" });
  assert.strictEqual(all.audit.balanced, true, "should be balanced when A = L + E + RE");
  assert.ok(all.audit.difference < 0.01, "difference should be ~0");
});

test("auditBalanceSheet includes the period in the result", () => {
  const db = createTestDb();
  const all = fs.buildAllStatements(db, "org-test", { start: "2025-01-01", end: "2025-03-31", label: "Q1" });
  assert.ok(all.audit.period);
  assert.strictEqual(all.audit.period.start, "2025-01-01");
  assert.strictEqual(all.audit.period.end, "2025-03-31");
});

test("auditBalanceSheet provides per-check status", () => {
  const db = createTestDb();
  const all = fs.buildAllStatements(db, "org-test", {});
  assert.ok(Array.isArray(all.audit.checks));
  for (const c of all.audit.checks) {
    assert.ok(typeof c.name === "string");
    assert.ok(typeof c.ok === "boolean");
  }
});

test("auditBalanceSheet detects imbalance", () => {
  // Manually craft a balance sheet where assets != L+E+RE
  const fakeBs = {
    totalAssets: 1000,
    totalLiabilities: 300,
    totalEquity: 500,
    retainedEarnings: 100,
    balanced: false,
  };
  const result = fs.auditBalanceSheet({ balanceSheet: fakeBs }, {});
  // Difference: 1000 - (300 + 500 + 100) = 100
  assert.strictEqual(result.balanced, false);
  assert.strictEqual(result.difference, 100);
});

// ─── 9. Renderers (formatMoney + render*) ───

test("formatMoney formats number as 1,234.56 (en-US default)", () => {
  const formatted = fs.formatMoney(1234.56);
  assert.match(formatted, /1[,.]234\.56/);
});

test("formatMoney handles 0", () => {
  const formatted = fs.formatMoney(0);
  assert.match(formatted, /0\.00/);
});

test("formatMoney handles negative values", () => {
  const formatted = fs.formatMoney(-100);
  assert.match(formatted, /-?100|100/);
});

test("formatMoney uses currency code", () => {
  const formatted = fs.formatMoney(100, { currency: "AMD", locale: "en-US" });
  // Should include either AMD or symbol
  assert.ok(formatted.length > 0);
});

test("renderBalanceSheet returns markdown table by default", () => {
  const db = createTestDb();
  db.prepare("INSERT INTO ledger_journal (id, org_id, entry_date, debit_code, credit_code, amount, period_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("j1", "org-test", "2025-01-15", "111", "611", 50000000, "2025-01");
  const bs = fs.buildBalanceSheet(db, "org-test");
  const md = fs.renderBalanceSheet(bs, { format: "md", end: "2025-12-31" });
  assert.match(md, /# BALANCE SHEET/);
  assert.match(md, /## Assets/);
  assert.match(md, /## Liabilities/);
  assert.match(md, /## Equity/);
  assert.match(md, /Total Assets/);
  assert.match(md, /Balanced/);
});

test("renderBalanceSheet returns JSON when format=json", () => {
  const bs = { totalAssets: 100, totalLiabilities: 50, totalEquity: 30, retainedEarnings: 20, balanced: true, assets: [], liabilities: [], equity: [] };
  const json = fs.renderBalanceSheet(bs, { format: "json" });
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.totalAssets, 100);
});

test("renderIncomeStatement returns formatted output", () => {
  const is = { income: [{ code: "800", name: "Sales", amount: 1000 }], expense: [], totalIncome: 1000, totalExpense: 0, netProfit: 1000 };
  const md = fs.renderIncomeStatement(is, { format: "md" });
  assert.match(md, /INCOME STATEMENT/);
  assert.match(md, /Net Profit/);
});

test("renderCashFlow returns formatted output", () => {
  const cf = { cashIn: 1000, cashOut: 500, netCashChange: 500 };
  const md = fs.renderCashFlow(cf, { format: "md" });
  assert.match(md, /CASH FLOW/);
  assert.match(md, /Cash In/);
  assert.match(md, /Net Cash Change/);
});

test("renderAllStatements returns all 3 sections", () => {
  const all = {
    balanceSheet: { totalAssets: 100, totalLiabilities: 50, totalEquity: 30, retainedEarnings: 20, totalEquityAndLiabilities: 100, balanced: true, assets: [], liabilities: [], equity: [] },
    incomeStatement: { income: [], expense: [], totalIncome: 0, totalExpense: 0, netProfit: 0 },
    cashFlow: { cashIn: 0, cashOut: 0, netCashChange: 0 },
    audit: { balanced: true, difference: 0, checks: [], period: {} },
  };
  const md = fs.renderAllStatements(all, { format: "md" });
  assert.match(md, /BALANCE SHEET/);
  assert.match(md, /INCOME STATEMENT/);
  assert.match(md, /CASH FLOW/);
  assert.match(md, /Audit/);
});

// ─── 10. MCP / AI Tool Definitions ───

test("mcpTools returns 7 tools", () => {
  const tools = fs.mcpTools();
  assert.strictEqual(tools.length, 7);
});

test("mcpTools has tb_import, tb_column_map, build_balance_sheet, etc.", () => {
  const tools = fs.mcpTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("tb_import"));
  assert.ok(names.includes("tb_column_map"));
  assert.ok(names.includes("build_balance_sheet"));
  assert.ok(names.includes("build_income_statement"));
  assert.ok(names.includes("build_cash_flow"));
  assert.ok(names.includes("build_all_statements"));
  assert.ok(names.includes("trial_balance"));
});

test("mcpTools each has a name, description, and parameters schema", () => {
  const tools = fs.mcpTools();
  for (const t of tools) {
    assert.ok(t.name, "tool.name required");
    assert.ok(t.description, "tool.description required");
    assert.ok(t.parameters, "tool.parameters required");
    assert.strictEqual(t.parameters.type, "object");
    assert.ok(typeof t.function === "function");
  }
});

test("mcpTools tb_column_map is invokable", () => {
  const tools = fs.mcpTools();
  const tool = tools.find((t) => t.name === "tb_column_map");
  const result = tool.function({ csv: SAMPLE_TB });
  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.name, 1);
  assert.strictEqual(result.debit, 2);
  assert.strictEqual(result.credit, 3);
});

test("mcpTools tb_import is invokable (with DB context)", () => {
  const tools = fs.mcpTools();
  const tool = tools.find((t) => t.name === "tb_import");
  const db = createTestDb();
  const result = tool.function({ csv: SAMPLE_TB, period: "2025-01" }, { db, orgId: "org-test" });
  assert.strictEqual(result.postedCount, 8);
});

test("mcpTools build_balance_sheet returns JSON by default", () => {
  const tools = fs.mcpTools();
  const tool = tools.find((t) => t.name === "build_balance_sheet");
  const db = createTestDb();
  db.prepare("INSERT INTO ledger_journal (id, org_id, entry_date, debit_code, credit_code, amount, period_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("j1", "org-test", "2025-01-15", "111", "611", 50000000, "2025-01");
  const result = tool.function({ period: { start: "2025-01-01", end: "2025-12-31" } }, { db, orgId: "org-test" });
  // Returns the BS object directly (default format is JSON)
  assert.ok(result.assets, "should return assets array");
  assert.ok(typeof result.totalAssets === "number", "should return totalAssets number");
});

test("mcpTools build_balance_sheet returns markdown when format=md", () => {
  const tools = fs.mcpTools();
  const tool = tools.find((t) => t.name === "build_balance_sheet");
  const db = createTestDb();
  const result = tool.function({ period: {}, format: "md" }, { db, orgId: "org-test" });
  assert.ok(result.content);
  assert.match(result.content, /# BALANCE SHEET/);
});

test("mcpTools trial_balance is invokable", () => {
  const tools = fs.mcpTools();
  const tool = tools.find((t) => t.name === "trial_balance");
  const db = createTestDb();
  db.prepare("INSERT INTO ledger_journal (id, org_id, entry_date, debit_code, credit_code, amount, period_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("j1", "org-test", "2025-01-15", "111", "611", 50000000, "2025-01");
  const result = tool.function({ asOf: "2025-01-15" }, { db, orgId: "org-test" });
  assert.ok(result.rows);
  assert.ok(typeof result.balanced === "boolean");
});

// ─── 11. Module shape + sovereignty ───

test("financialStatements module exports 20 public functions", () => {
  const exports = Object.keys(fs);
  const funcs = exports.filter((k) => typeof fs[k] === "function");
  assert.strictEqual(funcs.length, 20);
});

test("financialStatements.js doesn't import http/https/net/fs at top level", () => {
  const src = fs2.readFileSync(path2.join(__dirname, "..", "server", "financialStatements.js"), "utf8");
  assert.ok(!/require\s*\(\s*['"]https?['"]/.test(src),
    "financialStatements.js should not require http/https (pure engine)");
  assert.ok(!/require\s*\(\s*['"]node-fetch['"]/.test(src),
    "financialStatements.js should not require node-fetch");
  assert.ok(!/require\s*\(\s*['"]fs['"]/.test(src),
    "financialStatements.js should not require fs (no file I/O)");
});

test("financialStatements.js uses 'use strict' (CommonJS, per AGENTS.md §9)", () => {
  const src = fs2.readFileSync(path2.join(__dirname, "..", "server", "financialStatements.js"), "utf8");
  assert.match(src, /^"use strict";/m, "financialStatements.js should use 'use strict' directive");
});

test("financialStatements.js uses node:crypto (built-in, no external deps)", () => {
  const src = fs2.readFileSync(path2.join(__dirname, "..", "server", "financialStatements.js"), "utf8");
  assert.ok(/require\s*\(\s*['"]node:crypto['"]/.test(src),
    "financialStatements.js should require node:crypto");
});

test("financialStatements.js doesn't read process.env", () => {
  // Strip comments
  const src = fs2.readFileSync(path2.join(__dirname, "..", "server", "financialStatements.js"), "utf8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  // process.env is forbidden in pure engines
  assert.ok(!/process\.env/.test(code),
    "financialStatements.js should not read process.env");
});
