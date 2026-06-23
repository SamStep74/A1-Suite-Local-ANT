// server/financialStatements.js — Financial Statements module.
//
// Wraps the existing financialStatements() engine from accounting.js
// and adds:
//   1. tbImport(csv) — Trial Balance import (CSV → journal entries)
//   2. tbColumnMap(csv) — Auto-detect column mapping for TB import
//   3. buildBalanceSheet(period) — Formatted Balance Sheet report
//   4. buildIncomeStatement(period) — Formatted Income Statement
//   5. buildCashFlow(period) — Formatted Cash Flow statement
//   6. buildAllStatements(period) — All 3 + audit checks
//   7. mcpTools() — MCP-style tool definitions for LLM invocation
//
// Per the docstring in accounting.js: "Single source of truth used by
// BOTH the Node server (require) and the browser client (window.HHVAccounting),
// so reports computed offline match the API exactly."

"use strict";

const crypto = require("node:crypto");
const accounting = require("./accounting");
const ledger = require("./ledger");

// ─── 1. Trial Balance Import ───────────────────────────────────────

/**
 * Parse a CSV string into rows.
 * Handles quoted fields, escaped quotes, CRLF/LF, BOM.
 * Pure function.
 */
function parseCsv(text) {
  if (text == null) return [];
  // Strip BOM
  let s = String(text).replace(/^\uFEFF/, "");
  // Normalize line endings
  s = s.replace(/\r\n?/g, "\n");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  // Last field
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // Drop trailing empty rows
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  return rows;
}

/**
 * Auto-detect column mapping for a Trial Balance CSV.
 * Returns { code, name, debit, credit, balance } column indices.
 * Pure function (no DB).
 */
function tbColumnMap(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return { code: -1, name: -1, debit: -1, credit: -1, balance: -1, header: [] };
  }
  const header = rows[0].map((c) => c.toLowerCase().trim());
  const findCol = (...patterns) => {
    for (const p of patterns) {
      const idx = header.findIndex((h) => h === p || h.includes(p));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  return {
    code: findCol("code", "account", "հաշիվ"),
    name: findCol("name", "description", "անվանում", "title"),
    debit: findCol("debit", "դեբետ", "dr"),
    credit: findCol("credit", "կրեդիտ", "cr"),
    balance: findCol("balance", "մնացորդ", "saldo"),
    header,
  };
}

/**
 * Parse a Trial Balance CSV into journal entries.
 * Each row produces 0-2 entries (one for debit balance, one for credit balance).
 *
 * Input CSV format (auto-detected columns):
 *   code, name, debit, credit
 * OR with a single balance column:
 *   code, name, balance
 *
 * Returns { entries, errors, mapping }.
 */
function tbImport(csvText, options = {}) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return { entries: [], errors: ["CSV must have header + at least 1 data row"], mapping: null };
  }
  // Auto-detect columns (or use provided mapping)
  const auto = options.mapping || tbColumnMap(csvText);
  const map = {
    code: options.code != null ? options.code : auto.code,
    name: options.name != null ? options.name : auto.name,
    debit: options.debit != null ? options.debit : auto.debit,
    credit: options.credit != null ? options.credit : auto.credit,
    balance: options.balance != null ? options.balance : auto.balance,
  };
  if (map.code < 0) {
    return { entries: [], errors: ["Could not detect 'code' column. Provide mapping explicitly."], mapping: auto };
  }
  const period = options.period || new Date().toISOString().slice(0, 7); // YYYY-MM
  const date = options.date || `${period}-01`;
  const memo = options.memo || "TB import";
  const entries = [];
  const errors = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const code = String(row[map.code] || "").trim();
    if (!code) continue; // skip empty
    const name = map.name >= 0 ? String(row[map.name] || "").trim() : code;
    let debit = 0, credit = 0;
    if (map.balance >= 0) {
      // Single balance column (positive = debit, negative = credit)
      const balance = parseAmount(row[map.balance]);
      if (balance > 0) debit = balance;
      else if (balance < 0) credit = -balance;
    } else {
      // Separate debit/credit columns
      if (map.debit >= 0) debit = parseAmount(row[map.debit]);
      if (map.credit >= 0) credit = parseAmount(row[map.credit]);
    }
    // Skip zero-balance rows
    if (debit === 0 && credit === 0) continue;
    if (debit > 0 && credit > 0) {
      errors.push(`Row ${i + 1}: code=${code} has both debit (${debit}) and credit (${credit}) — using debit only`);
      credit = 0;
    }
    if (debit > 0) {
      entries.push({
        date,
        debitCode: code,
        creditCode: options.suspenseAccount || "999",  // suspense/clearing
        amount: toMinor(debit),
        memo: `${memo}: ${name}`,
        sourceType: "tb_import",
        sourceId: `tb-row-${i + 1}`,
        periodKey: period,
      });
    }
    if (credit > 0) {
      entries.push({
        date,
        debitCode: options.suspenseAccount || "999",
        creditCode: code,
        amount: toMinor(credit),
        memo: `${memo}: ${name}`,
        sourceType: "tb_import",
        sourceId: `tb-row-${i + 1}`,
        periodKey: period,
      });
    }
  }
  return { entries, errors, mapping: map, count: entries.length };
}

/**
 * Parse an amount string (handles commas, parens for negatives, etc.).
 * Pure function.
 */
function parseAmount(s) {
  if (s == null) return 0;
  if (typeof s === "number") return s;
  let str = String(s).trim();
  if (!str) return 0;
  // Parentheses = negative: (1,234.56) = -1234.56
  const isNeg = str.startsWith("(") && str.endsWith(")");
  if (isNeg) str = str.slice(1, -1);
  // Remove thousand separators (commas in English, spaces in French)
  str = str.replace(/[,\s]/g, "");
  const n = parseFloat(str);
  if (!Number.isFinite(n)) return 0;
  return isNeg ? -n : n;
}

/**
 * Convert rubles to kopecks (minor units).
 * Same convention as ledger.toMinor: × 100.
 */
function toMinor(value) {
  return Math.round((Number(value) || 0) * 100);
}

/**
 * Apply TB import entries to the ledger.
 * Returns { posted, errors }.
 */
function tbImportPost(db, orgId, csvText, options = {}) {
  const { entries, errors, mapping, count } = tbImport(csvText, options);
  const posted = [];
  const postErrors = [];
  // Ensure chart of accounts exists
  ledger.ensureChartOfAccounts(db, orgId);
  for (const entry of entries) {
    try {
      const id = ledger.postEntry(db, orgId, entry);
      posted.push(id);
    } catch (e) {
      postErrors.push({ entry, error: e.message });
    }
  }
  return { posted, errors: [...errors, ...postErrors], mapping, count, postedCount: posted.length };
}

// ─── 2. Financial Statement Builders ──────────────────────────────

/**
 * Build the full Financial Statements (BS + IS + CF + audit) for a period.
 *
 * @param {Database} db - SQLite connection
 * @param {string} orgId - Organization id
 * @param {object} period - { start, end, label }
 * @param {object} options - { locale, format, isCashAccount }
 * @returns {object} { incomeStatement, balanceSheet, cashFlow, audit, period }
 */
function buildAllStatements(db, orgId, period = {}, options = {}) {
  const model = buildModel(db, orgId);
  const filter = buildPeriodFilter(period);
  const filtered = applyFilter(model, filter);
  const fs = accounting.financialStatements(filtered, period, options);
  const audit = auditBalanceSheet(fs, period);
  return { ...fs, audit, period: { ...period, ...audit.period } };
}

/**
 * Build a Balance Sheet for a period.
 * Returns { assets, liabilities, equity, totals, balanced }.
 */
function buildBalanceSheet(db, orgId, period = {}, options = {}) {
  return buildAllStatements(db, orgId, period, options).balanceSheet;
}

/**
 * Build an Income Statement for a period.
 * Returns { income, expense, totals, netProfit }.
 */
function buildIncomeStatement(db, orgId, period = {}, options = {}) {
  return buildAllStatements(db, orgId, period, options).incomeStatement;
}

/**
 * Build a Cash Flow Statement for a period.
 * Returns { cashIn, cashOut, netCashChange }.
 */
function buildCashFlow(db, orgId, period = {}, options = {}) {
  return buildAllStatements(db, orgId, period, options).cashFlow;
}

/**
 * Build the ledger model from the DB (used as input to financialStatements).
 * Pure: does not modify DB.
 */
function buildModel(db, orgId) {
  // Note: caller is responsible for calling ledger.ensureChartOfAccounts()
  // before invoking buildModel. This keeps buildModel as a pure read function.
  const accounts = db
    .prepare("SELECT code, name, type FROM ledger_accounts WHERE org_id = ?")
    .all(orgId)
    .map((a) => ({ id: a.code, code: a.code, name: a.name, type: a.type }));
  const journal = db
    .prepare("SELECT entry_date, debit_code, credit_code, amount FROM ledger_journal WHERE org_id = ?")
    .all(orgId)
    .map((j) => ({
      date: j.entry_date,
      debitAccount: j.debit_code,
      creditAccount: j.credit_code,
      amount: j.amount,
    }));
  return { accounts, journal };
}

function buildPeriodFilter(period) {
  if (!period || (!period.start && !period.end)) {
    return () => true;
  }
  return (entry) => {
    const d = String(entry.date || "").slice(0, 10);
    if (period.start && d < period.start) return false;
    if (period.end && d > period.end) return false;
    return true;
  };
}

function applyFilter(model, filter) {
  if (filter === true || filter === (() => true)) {
    return model;
  }
  return { ...model, journal: model.journal.filter(filter) };
}

/**
 * Audit the balance sheet: check that assets = liabilities + equity + retained earnings.
 * Returns { balanced, difference, checks: [...] }.
 */
function auditBalanceSheet(fs, period) {
  const { balanceSheet } = fs;
  const totalAssets = balanceSheet.totalAssets;
  const totalLiab = balanceSheet.totalLiabilities;
  const totalEquity = balanceSheet.totalEquity;
  const retained = balanceSheet.retainedEarnings;
  const expected = Number(totalLiab) + Number(totalEquity) + Number(retained);
  const diff = Number(totalAssets) - expected;
  const tol = 0.01; // 1 cent tolerance
  const balanced = Math.abs(diff) < tol;
  const checks = [
    { name: "assets_total", value: Number(totalAssets), expected: expected, ok: balanced },
    { name: "liabilities_total", value: Number(totalLiab), ok: true },
    { name: "equity_total", value: Number(totalEquity), ok: true },
    { name: "retained_earnings", value: Number(retained), ok: true },
    { name: "balanced", value: diff, expected: 0, ok: balanced, tol },
  ];
  return { balanced, difference: diff, checks, period: { start: period.start, end: period.end } };
}

// ─── 3. FS Template Renderer ─────────────────────────────────────

/**
 * Format a number as a money string (e.g. 1234.56 → "1,234.56").
 * Pure function.
 */
function formatMoney(value, options = {}) {
  const n = Number(value) || 0;
  const locale = options.locale || "en-US";
  const currency = options.currency || "AMD";
  try {
    return new Intl.NumberFormat(locale, {
      style: currency ? "currency" : "decimal",
      currency: currency || undefined,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    // Fallback: simple format
    return n.toFixed(2);
  }
}

/**
 * Render a Balance Sheet as a formatted table (markdown / text).
 * @param {object} bs - Result from buildBalanceSheet
 * @param {object} options - { locale, currency, format: 'md'|'text'|'json' }
 * @returns {string} formatted output
 */
function renderBalanceSheet(bs, options = {}) {
  const format = options.format || "md";
  if (format === "json") return JSON.stringify(bs, null, 2);
  const lines = [];
  const cur = options.currency || "AMD";
  const title = options.title || "BALANCE SHEET";
  const date = options.date || "";
  lines.push(`# ${title}`);
  if (date) lines.push(`*As of ${date}*`);
  lines.push("");
  if (format === "md") {
    lines.push("## Assets");
    lines.push("| Code | Account | Amount |");
    lines.push("|------|---------|--------|");
    for (const a of bs.assets) {
      lines.push(`| ${a.code} | ${a.name} | ${formatMoney(a.amount, options)} |`);
    }
    lines.push(`| | **Total Assets** | **${formatMoney(bs.totalAssets, options)}** |`);
    lines.push("");
    lines.push("## Liabilities");
    lines.push("| Code | Account | Amount |");
    lines.push("|------|---------|--------|");
    for (const l of bs.liabilities) {
      lines.push(`| ${l.code} | ${l.name} | ${formatMoney(l.amount, options)} |`);
    }
    lines.push(`| | **Total Liabilities** | **${formatMoney(bs.totalLiabilities, options)}** |`);
    lines.push("");
    lines.push("## Equity");
    lines.push("| Code | Account | Amount |");
    lines.push("|------|---------|--------|");
    for (const e of bs.equity) {
      lines.push(`| ${e.code} | ${e.name} | ${formatMoney(e.amount, options)} |`);
    }
    lines.push(`| | **Total Equity** | **${formatMoney(bs.totalEquity, options)}** |`);
    lines.push("");
    lines.push(`**Retained Earnings (Current Period):** ${formatMoney(bs.retainedEarnings, options)}`);
    lines.push("");
    lines.push(`**Total Liabilities + Equity + Retained Earnings:** ${formatMoney(bs.totalEquityAndLiabilities, options)}`);
    lines.push("");
    lines.push(`**Balanced:** ${bs.balanced ? "✓ Yes" : "✗ NO — investigate"}`);
  } else {
    // text format
    lines.push(`ASSETS:`);
    for (const a of bs.assets) lines.push(`  ${a.code}  ${a.name.padEnd(40)} ${formatMoney(a.amount, options)}`);
    lines.push(`  ${"".padEnd(50)} ${formatMoney(bs.totalAssets, options)}`);
    lines.push("");
    lines.push(`LIABILITIES:`);
    for (const l of bs.liabilities) lines.push(`  ${l.code}  ${l.name.padEnd(40)} ${formatMoney(l.amount, options)}`);
    lines.push(`  ${"".padEnd(50)} ${formatMoney(bs.totalLiabilities, options)}`);
    lines.push("");
    lines.push(`EQUITY:`);
    for (const e of bs.equity) lines.push(`  ${e.code}  ${e.name.padEnd(40)} ${formatMoney(e.amount, options)}`);
    lines.push(`  ${"".padEnd(50)} ${formatMoney(bs.totalEquity, options)}`);
    lines.push("");
    lines.push(`Retained Earnings: ${formatMoney(bs.retainedEarnings, options)}`);
    lines.push(`Total Liab+Equity+RE: ${formatMoney(bs.totalEquityAndLiabilities, options)}`);
    lines.push(`Balanced: ${bs.balanced ? "YES" : "NO"}`);
  }
  return lines.join("\n");
}

/**
 * Render an Income Statement as a formatted table.
 */
function renderIncomeStatement(is, options = {}) {
  const format = options.format || "md";
  if (format === "json") return JSON.stringify(is, null, 2);
  const lines = [];
  const title = options.title || "INCOME STATEMENT";
  if (options.period) lines.push(`# ${title} — ${options.period}`);
  else lines.push(`# ${title}`);
  lines.push("");
  if (format === "md") {
    lines.push("## Income");
    lines.push("| Code | Account | Amount |");
    lines.push("|------|---------|--------|");
    for (const r of is.income) lines.push(`| ${r.code} | ${r.name} | ${formatMoney(r.amount, options)} |`);
    lines.push(`| | **Total Income** | **${formatMoney(is.totalIncome, options)}** |`);
    lines.push("");
    lines.push("## Expenses");
    lines.push("| Code | Account | Amount |");
    lines.push("|------|---------|--------|");
    for (const r of is.expense) lines.push(`| ${r.code} | ${r.name} | ${formatMoney(r.amount, options)} |`);
    lines.push(`| | **Total Expenses** | **${formatMoney(is.totalExpense, options)}** |`);
    lines.push("");
    lines.push(`## Summary`);
    lines.push(`- **Net Profit:** ${formatMoney(is.netProfit, options)}`);
    lines.push(`- **Margin:** ${(is.totalIncome > 0 ? (is.netProfit / is.totalIncome * 100).toFixed(1) : 0)}%`);
  } else {
    lines.push("INCOME:");
    for (const r of is.income) lines.push(`  ${r.code}  ${r.name.padEnd(40)} ${formatMoney(r.amount, options)}`);
    lines.push(`  TOTAL INCOME: ${formatMoney(is.totalIncome, options)}`);
    lines.push("");
    lines.push("EXPENSES:");
    for (const r of is.expense) lines.push(`  ${r.code}  ${r.name.padEnd(40)} ${formatMoney(r.amount, options)}`);
    lines.push(`  TOTAL EXPENSES: ${formatMoney(is.totalExpense, options)}`);
    lines.push("");
    lines.push(`NET PROFIT: ${formatMoney(is.netProfit, options)}`);
  }
  return lines.join("\n");
}

/**
 * Render a Cash Flow Statement as a formatted table.
 */
function renderCashFlow(cf, options = {}) {
  const format = options.format || "md";
  if (format === "json") return JSON.stringify(cf, null, 2);
  const lines = [];
  lines.push(`# CASH FLOW STATEMENT`);
  if (options.period) lines.push(`*${options.period}*`);
  lines.push("");
  if (format === "md") {
    lines.push("| Item | Amount |");
    lines.push("|------|--------|");
    lines.push(`| Cash In (Receipts) | ${formatMoney(cf.cashIn, options)} |`);
    lines.push(`| Cash Out (Payments) | ${formatMoney(cf.cashOut, options)} |`);
    lines.push(`| **Net Cash Change** | **${formatMoney(cf.netCashChange, options)}** |`);
  } else {
    lines.push(`Cash In:      ${formatMoney(cf.cashIn, options)}`);
    lines.push(`Cash Out:     ${formatMoney(cf.cashOut, options)}`);
    lines.push(`Net Change:   ${formatMoney(cf.netCashChange, options)}`);
  }
  return lines.join("\n");
}

/**
 * Render all 3 statements at once.
 */
function renderAllStatements(allFs, options = {}) {
  const sections = [
    renderBalanceSheet(allFs.balanceSheet, { ...options, date: options.end }),
    "\n---\n",
    renderIncomeStatement(allFs.incomeStatement, { ...options, period: options.label }),
    "\n---\n",
    renderCashFlow(allFs.cashFlow, { ...options, period: options.label }),
    "\n---\n",
    `## Audit\nBalanced: ${allFs.audit.balanced ? "✓ YES" : "✗ NO"}\nDifference: ${formatMoney(allFs.audit.difference, options)}`,
  ];
  return sections.join("\n");
}

// ─── 4. MCP / AI Tool Definitions ────────────────────────────────

/**
 * Return MCP-style tool definitions for the financial statements + TB import.
 * Each tool follows the OpenAI / Anthropic function-calling schema.
 *
 * Usage from an LLM:
 *   const tools = mcpTools();
 *   const fn = tools.find(t => t.name === "tb_import").function;
 *   const args = JSON.parse(llmResponse.tool_call.arguments);
 *   const result = fn(args, { db, orgId });
 */
function mcpTools() {
  return [
    {
      type: "function",
      name: "tb_import",
      description: "Import a Trial Balance from CSV and post the entries to the ledger. Returns the count of entries posted and any errors.",
      parameters: {
        type: "object",
        properties: {
          csv: { type: "string", description: "CSV text containing the trial balance. Must have a header row." },
          period: { type: "string", description: "Period key (YYYY-MM). Defaults to current month." },
          date: { type: "string", description: "Date for the journal entries (YYYY-MM-DD). Defaults to period-01." },
          suspenseAccount: { type: "string", description: "Clearing account for the import (e.g. 999). Defaults to 999." },
          mapping: {
            type: "object",
            description: "Optional column mapping (auto-detected if omitted).",
            properties: {
              code: { type: "number", description: "Column index for account code" },
              name: { type: "number", description: "Column index for account name" },
              debit: { type: "number", description: "Column index for debit amount" },
              credit: { type: "number", description: "Column index for credit amount" },
              balance: { type: "number", description: "Column index for net balance (alternative to debit/credit)" },
            },
          },
        },
        required: ["csv"],
      },
      function: (args, ctx) => {
        const { db, orgId } = ctx || {};
        if (!db || !orgId) return { error: "Missing ctx.db or ctx.orgId" };
        return tbImportPost(db, orgId, args.csv, {
          period: args.period,
          date: args.date,
          suspenseAccount: args.suspenseAccount,
          mapping: args.mapping,
        });
      },
    },
    {
      type: "function",
      name: "tb_column_map",
      description: "Auto-detect the column mapping for a Trial Balance CSV. Returns the mapping { code, name, debit, credit, balance } as column indices (or -1 if not found).",
      parameters: {
        type: "object",
        properties: {
          csv: { type: "string", description: "CSV text (header row only is needed, but a full file works too)" },
        },
        required: ["csv"],
      },
      function: (args) => tbColumnMap(args.csv),
    },
    {
      type: "function",
      name: "build_balance_sheet",
      description: "Build a Balance Sheet for the given period. Returns assets, liabilities, equity, totals, and a balanced check.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "object",
            description: "Period filter { start, end, label }",
            properties: {
              start: { type: "string", description: "Start date (YYYY-MM-DD)" },
              end: { type: "string", description: "End date (YYYY-MM-DD)" },
              label: { type: "string", description: "Human-readable label (e.g. '2025-Q1')" },
            },
          },
          format: { type: "string", enum: ["json", "md", "text"], description: "Output format. Default 'json'." },
          currency: { type: "string", description: "Currency code (e.g. AMD, RUB, USD). Default AMD." },
        },
        required: ["period"],
      },
      function: (args, ctx) => {
        const { db, orgId } = ctx || {};
        if (!db || !orgId) return { error: "Missing ctx.db or ctx.orgId" };
        const bs = buildBalanceSheet(db, orgId, args.period || {}, { currency: args.currency });
        if (args.format === "md" || args.format === "text") {
          return { content: renderBalanceSheet(bs, { format: args.format, currency: args.currency, end: args.period?.end }) };
        }
        return bs;
      },
    },
    {
      type: "function",
      name: "build_income_statement",
      description: "Build an Income Statement for the given period. Returns income, expense, totals, and net profit.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "object",
            description: "Period filter { start, end, label }",
          },
          format: { type: "string", enum: ["json", "md", "text"] },
          currency: { type: "string" },
        },
        required: ["period"],
      },
      function: (args, ctx) => {
        const { db, orgId } = ctx || {};
        if (!db || !orgId) return { error: "Missing ctx.db or ctx.orgId" };
        const is = buildIncomeStatement(db, orgId, args.period || {}, { currency: args.currency });
        if (args.format === "md" || args.format === "text") {
          return { content: renderIncomeStatement(is, { format: args.format, currency: args.currency, period: args.period?.label }) };
        }
        return is;
      },
    },
    {
      type: "function",
      name: "build_cash_flow",
      description: "Build a Cash Flow Statement for the given period. Returns cashIn, cashOut, and netCashChange.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "object" },
          format: { type: "string", enum: ["json", "md", "text"] },
          currency: { type: "string" },
        },
        required: ["period"],
      },
      function: (args, ctx) => {
        const { db, orgId } = ctx || {};
        if (!db || !orgId) return { error: "Missing ctx.db or ctx.orgId" };
        const cf = buildCashFlow(db, orgId, args.period || {}, { currency: args.currency });
        if (args.format === "md" || args.format === "text") {
          return { content: renderCashFlow(cf, { format: args.format, currency: args.currency, period: args.period?.label }) };
        }
        return cf;
      },
    },
    {
      type: "function",
      name: "build_all_statements",
      description: "Build all 3 financial statements (Balance Sheet, Income Statement, Cash Flow) + audit checks in one call.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "object" },
          format: { type: "string", enum: ["json", "md", "text"] },
          currency: { type: "string" },
        },
        required: ["period"],
      },
      function: (args, ctx) => {
        const { db, orgId } = ctx || {};
        if (!db || !orgId) return { error: "Missing ctx.db or ctx.orgId" };
        const all = buildAllStatements(db, orgId, args.period || {}, { currency: args.currency });
        if (args.format === "md" || args.format === "text") {
          return { content: renderAllStatements(all, { format: args.format, currency: args.currency, label: args.period?.label, end: args.period?.end }) };
        }
        return all;
      },
    },
    {
      type: "function",
      name: "trial_balance",
      description: "Generate a Trial Balance report: list of accounts with debit/credit balances, plus totals and a balanced check.",
      parameters: {
        type: "object",
        properties: {
          asOf: { type: "string", description: "As-of date (YYYY-MM-DD). Defaults to today." },
          format: { type: "string", enum: ["json", "md", "text"] },
        },
      },
      function: (args, ctx) => {
        const { db, orgId } = ctx || {};
        if (!db || !orgId) return { error: "Missing ctx.db or ctx.orgId" };
        const tb = ledger.trialBalance(db, orgId);
        if (args.format === "md" || args.format === "text") {
          const lines = [];
          lines.push("# TRIAL BALANCE");
          if (args.asOf) lines.push(`*As of ${args.asOf}*`);
          lines.push("");
          lines.push("| Code | Account | Type | Debit | Credit | Balance |");
          lines.push("|------|---------|------|-------|--------|---------|");
          for (const r of tb.rows) {
            lines.push(`| ${r.code} | ${r.name} | ${r.type} | ${r.debit.toFixed(2)} | ${r.credit.toFixed(2)} | ${r.balance.toFixed(2)} |`);
          }
          lines.push(`| | | **TOTALS** | **${tb.totalDebit.toFixed(2)}** | **${tb.totalCredit.toFixed(2)}** | |`);
          lines.push("");
          lines.push(`**Balanced:** ${tb.balanced ? "✓ YES" : "✗ NO"}`);
          return { content: lines.join("\n") };
        }
        return tb;
      },
    },
  ];
}

module.exports = {
  // TB import
  parseCsv,
  tbColumnMap,
  tbImport,
  tbImportPost,
  parseAmount,
  toMinor,
  // FS builders
  buildModel,
  buildPeriodFilter,
  applyFilter,
  buildBalanceSheet,
  buildIncomeStatement,
  buildCashFlow,
  buildAllStatements,
  auditBalanceSheet,
  // Renderers
  formatMoney,
  renderBalanceSheet,
  renderIncomeStatement,
  renderCashFlow,
  renderAllStatements,
  // MCP / AI tools
  mcpTools,
};
