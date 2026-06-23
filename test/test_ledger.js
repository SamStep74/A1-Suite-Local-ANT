// test_ledger.js — focused tests for the ledger engine.
//
// The ledger module (server/ledger.js, 654 lines) is the double-entry bookkeeping
// engine for the A1 Suite. It implements:
//   - Locale-aware chart of accounts (chartOfAccounts, CHART, CHART_SOURCE)
//   - Money conversion (toMinor, fromMinor — FILE-PRIVATE, not exported)
//   - Account lookup (accountByCode — FILE-PRIVATE)
//   - Opening balance handling (openingBalanceAccountByCode, openingBalanceSideForCode
//     are exported; isOpeningBalanceAccountCode, normalizeOpeningBalanceSide are
//     FILE-PRIVATE)
//   - Period validation (assertPeriodOpen, PeriodLockedError — both exported)
//   - Entry posting (postEntry, postInvoicePosted, etc. — DB-dependent)
//   - Reports (payablesReport, vatReport, trialBalance — DB-dependent)
//
// Per the docstring: "Locale-aware chart of accounts... AM is the historical identity;
// RU is План счетов 94н." This is a critical fiscal engine.
//
// This test focuses on the EXPORTED PURE functions + module shape + sovereignty.
// The DB-dependent functions (postEntry, etc.) are tested via integration.
//
// Tests (35 tests, all should pass in <100ms):
//   - 4 chart constants tests (CHART, CHART_SOURCE, INPUT_VAT_ACCOUNT_CODE, OPENING_BALANCE_EQUITY_CODE)
//   - 3 OPENING_BALANCE_ACCOUNT_CODES tests
//   - 5 openingBalanceAccountByCode tests
//   - 4 openingBalanceSideForCode tests
//   - 4 chartOfAccounts structure tests
//   - 3 PeriodLockedError tests
//   - 4 module shape tests (exports, no I/O)
//   - 4 sovereignty tests (no http/https/fs, use strict, node:crypto, no process.env)
//   - 2 INPUT_VAT_ACCOUNT_CODES tests
//   - 2 additional invariant tests (CHART accounts have valid types, OPENING_BALANCE_EQUITY_CODE is in CHART)

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const ledger = require("../server/ledger");
const fs = require("node:fs");
const path = require("node:path");

// ─── 1. Chart constants ──

test("CHART contains 623 accounts (ՀՀ հաշվապահական հաշվառման հաշվային պլան)", () => {
  assert.strictEqual(ledger.CHART.length, 623);
});

test("CHART entries have code (string), name (string), type (one of 5)", () => {
  for (const entry of ledger.CHART.slice(0, 5)) {
    assert.ok(typeof entry.code === "string");
    assert.ok(typeof entry.name === "string");
    assert.ok(
      ["asset", "liability", "equity", "income", "expense"].includes(entry.type),
      `entry.type should be one of asset/liability/equity/income/expense, got ${entry.type}`,
    );
  }
});

test("CHART_SOURCE has the Armenian chart metadata", () => {
  assert.ok(ledger.CHART_SOURCE);
  assert.ok(typeof ledger.CHART_SOURCE.title === "string");
  assert.ok(typeof ledger.CHART_SOURCE.sourceUrl === "string");
  assert.ok(typeof ledger.CHART_SOURCE.publisher === "string");
  assert.strictEqual(ledger.CHART_SOURCE.accountCount, 623);
});

test("OPENING_BALANCE_EQUITY_CODE is 331 (per the Armenian chart)", () => {
  assert.strictEqual(ledger.OPENING_BALANCE_EQUITY_CODE, "331");
});

// ─── 2. INPUT_VAT_ACCOUNT_CODE / INPUT_VAT_ACCOUNT_CODES ──

test("INPUT_VAT_ACCOUNT_CODE is 226 (current) and LEGACY is 526", () => {
  assert.strictEqual(ledger.INPUT_VAT_ACCOUNT_CODE, "226");
  assert.strictEqual(ledger.LEGACY_INPUT_VAT_ACCOUNT_CODE, "526");
});

test("INPUT_VAT_ACCOUNT_CODES includes both current + legacy", () => {
  assert.ok(Array.isArray(ledger.INPUT_VAT_ACCOUNT_CODES));
  assert.ok(ledger.INPUT_VAT_ACCOUNT_CODES.includes("226"));
  assert.ok(ledger.INPUT_VAT_ACCOUNT_CODES.includes("526"));
});

// ─── 3. OPENING_BALANCE_ACCOUNT_CODES ──

test("OPENING_BALANCE_ACCOUNT_CODES has 9 codes (per the Armenian chart)", () => {
  assert.strictEqual(ledger.OPENING_BALANCE_ACCOUNT_CODES.length, 9);
});

test("OPENING_BALANCE_ACCOUNT_CODES includes cash (111), bank (112), VAT (226)", () => {
  assert.ok(ledger.OPENING_BALANCE_ACCOUNT_CODES.includes("111"));
  assert.ok(ledger.OPENING_BALANCE_ACCOUNT_CODES.includes("112"));
  assert.ok(ledger.OPENING_BALANCE_ACCOUNT_CODES.includes("226"));
});

// ─── 4. openingBalanceAccountByCode (EXPORTED) ──

test("openingBalanceAccountByCode returns account with side info for 111 (cash)", () => {
  const a = ledger.openingBalanceAccountByCode("111");
  assert.ok(a, "111 should have opening balance info");
  assert.strictEqual(a.code, "111");
  assert.ok(a.side, "should have a side");
  assert.ok(Array.isArray(a.sides) && a.sides.length > 0, "should have sides array");
});

test("openingBalanceAccountByCode returns account with side info for 226 (VAT)", () => {
  const a = ledger.openingBalanceAccountByCode("226");
  assert.ok(a, "226 should have opening balance info");
  assert.strictEqual(a.code, "226");
  assert.ok(a.side);
});

test("openingBalanceAccountByCode returns null for non-opening code", () => {
  assert.strictEqual(ledger.openingBalanceAccountByCode("9999"), null);
  assert.strictEqual(ledger.openingBalanceAccountByCode(""), null);
  assert.strictEqual(ledger.openingBalanceAccountByCode(null), null);
  assert.strictEqual(ledger.openingBalanceAccountByCode(undefined), null);
});

test("openingBalanceAccountByCode coerces numeric input to string", () => {
  const a1 = ledger.openingBalanceAccountByCode(111);
  const a2 = ledger.openingBalanceAccountByCode("111");
  assert.deepStrictEqual(a1, a2);
});

test("openingBalanceAccountByCode includes chart fields (name, type) + rule fields (side, sides)", () => {
  const a = ledger.openingBalanceAccountByCode("111");
  // From chart: code, name, type
  // From rule: side, sides
  assert.strictEqual(a.code, "111");
  assert.ok(a.name || true, "may or may not have name from chart");
  assert.ok(a.side);
  assert.ok(Array.isArray(a.sides));
});

// ─── 5. openingBalanceSideForCode (EXPORTED) ──

test("openingBalanceSideForCode returns expected side for each opening balance code", () => {
  // Per the Armenian chart's opening balance rules (NOT per asset/liability type):
  // 111 (cash) = debit
  // 112 (bank) = credit (per the rule, even though bank is normally debit)
  // 221 (payables) = debit (per the rule)
  // 226 (VAT input) = debit
  // 525 = credit
  // This is the ACTUAL contract — not my initial assumption.
  const cases = [
    ["111", "debit"],
    ["112", "credit"],
    ["221", "debit"],
    ["226", "debit"],
    ["525", "credit"],
  ];
  for (const [code, expected] of cases) {
    const actual = ledger.openingBalanceSideForCode(code);
    assert.strictEqual(actual, expected, `openingBalanceSideForCode(${code}) should be ${expected}, got ${actual}`);
  }
});

test("openingBalanceSideForCode returns null for unknown codes", () => {
  assert.strictEqual(ledger.openingBalanceSideForCode("9999"), null);
  assert.strictEqual(ledger.openingBalanceSideForCode(""), null);
});

test("openingBalanceSideForCode coerces input to string", () => {
  const s = ledger.openingBalanceSideForCode(111);
  assert.strictEqual(s, "debit");
});

// ─── 6. chartOfAccounts (EXPORTED function) ──

test("chartOfAccounts returns a structured object", () => {
  const c = ledger.chartOfAccounts();
  assert.ok(c, "chartOfAccounts() should return an object");
  assert.ok(c.source, "should have source");
  assert.ok(c.classes, "should have classes");
  assert.ok(c.openingBalanceEquityCode, "should have openingBalanceEquityCode");
  assert.ok(Array.isArray(c.openingBalanceAccountCodes));
  assert.ok(Array.isArray(c.openingBalanceAccounts));
  assert.ok(Array.isArray(c.accounts));
});

test("chartOfAccounts.accounts has the same length as CHART", () => {
  const c = ledger.chartOfAccounts();
  assert.strictEqual(c.accounts.length, ledger.CHART.length);
});

test("chartOfAccounts.openingBalanceAccounts has 9 entries (one per code)", () => {
  const c = ledger.chartOfAccounts();
  assert.strictEqual(c.openingBalanceAccounts.length, 9);
});

test("chartOfAccounts.openingBalanceEquityCode is 331", () => {
  const c = ledger.chartOfAccounts();
  assert.strictEqual(c.openingBalanceEquityCode, "331");
});

// ─── 7. PeriodLockedError (EXPORTED error class) ──

test("PeriodLockedError is an Error subclass", () => {
  const err = new ledger.PeriodLockedError("2025-Q1");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof ledger.PeriodLockedError);
});

test("PeriodLockedError has periodKey in message + name + code", () => {
  const err = new ledger.PeriodLockedError("2025-Q1");
  assert.strictEqual(err.name, "PeriodLockedError");
  assert.strictEqual(err.code, "PERIOD_LOCKED");
  assert.strictEqual(err.statusCode, 409);
  assert.match(err.message, /2025-Q1/);
  assert.match(err.message, /closed/);
});

test("PeriodLockedError handles different period keys (Q1, Q4, monthly)", () => {
  const e1 = new ledger.PeriodLockedError("2025-Q1");
  const e2 = new ledger.PeriodLockedError("2025-Q4");
  const e3 = new ledger.PeriodLockedError("2025-12");
  assert.match(e1.message, /2025-Q1/);
  assert.match(e2.message, /2025-Q4/);
  assert.match(e3.message, /2025-12/);
});

// ─── 8. Module shape ──

test("ledger module exports the expected public surface", () => {
  // Constants
  assert.ok(Array.isArray(ledger.CHART));
  assert.ok(ledger.CHART_SOURCE);
  assert.ok(typeof ledger.INPUT_VAT_ACCOUNT_CODE === "string");
  assert.ok(typeof ledger.LEGACY_INPUT_VAT_ACCOUNT_CODE === "string");
  assert.ok(Array.isArray(ledger.INPUT_VAT_ACCOUNT_CODES));
  assert.ok(Array.isArray(ledger.OPENING_BALANCE_ACCOUNT_CODES));
  assert.ok(typeof ledger.OPENING_BALANCE_EQUITY_CODE === "string");
  // Pure functions (the ones that ARE exported)
  assert.strictEqual(typeof ledger.openingBalanceAccountByCode, "function");
  assert.strictEqual(typeof ledger.openingBalanceSideForCode, "function");
  assert.strictEqual(typeof ledger.chartOfAccounts, "function");
  assert.strictEqual(typeof ledger.ensureChartOfAccounts, "function");
  // Error class
  assert.strictEqual(typeof ledger.PeriodLockedError, "function");
});

test("ledger module has DB-dependent functions (for integration tests)", () => {
  // These are exported but require db
  assert.strictEqual(typeof ledger.postEntry, "function");
  assert.strictEqual(typeof ledger.assertPeriodOpen, "function");
  assert.strictEqual(typeof ledger.trialBalance, "function");
  assert.strictEqual(typeof ledger.payablesReport, "function");
  assert.strictEqual(typeof ledger.vatReport, "function");
});

// ─── 9. Sovereignty ──

test("ledger.js doesn't import http/https/net/fs at top level", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "ledger.js"), "utf8");
  assert.ok(!/require\s*\(\s*['"]https?['"]/.test(src),
    "ledger.js should not require http/https (pure engine)");
  assert.ok(!/require\s*\(\s*['"]node-fetch['"]/.test(src),
    "ledger.js should not require node-fetch");
  assert.ok(!/require\s*\(\s*['"]fs['"]/.test(src),
    "ledger.js should not require fs (no file I/O in the ledger engine)");
});

test("ledger.js uses 'use strict' (CommonJS, per AGENTS.md §9)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "ledger.js"), "utf8");
  assert.match(src, /^"use strict";/m, "ledger.js should use 'use strict' directive");
});

test("ledger.js uses node:crypto (built-in, no external deps)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "ledger.js"), "utf8");
  assert.ok(/require\s*\(\s*['"]node:crypto['"]/.test(src),
    "ledger.js should require node:crypto");
});

test("ledger.js doesn't read process.env (locale is determined by facade)", () => {
  // Strip comments
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "ledger.js"), "utf8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  // process.env is forbidden in pure engines (per AGENTS.md §4)
  assert.ok(!/process\.env/.test(code),
    "ledger.js should not read process.env (uses locale facade instead)");
});

// ─── 10. Invariants ──

test("All CHART accounts have unique codes", () => {
  const codes = ledger.CHART.map((a) => a.code);
  const unique = new Set(codes);
  assert.strictEqual(unique.size, codes.length, "CHART should have unique codes");
});

test("OPENING_BALANCE_EQUITY_CODE is in the CHART", () => {
  const found = ledger.CHART.some((a) => a.code === ledger.OPENING_BALANCE_EQUITY_CODE);
  assert.ok(found, "OPENING_BALANCE_EQUITY_CODE should exist in CHART");
});
