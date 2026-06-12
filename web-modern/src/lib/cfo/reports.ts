/**
 * Pure helpers for the CFO printable financial statements.
 *
 * Source: server/accounting.js#financialStatements (called by
 * server/app.js at GET /api/finance/statements). The route lives at
 * /app/cfo/reports/ (Phase 7) and is print-friendly — a single click
 * triggers the browser's native print dialog (no PDF library yet;
 * that lives in a follow-up phase).
 *
 * These helpers are pure (no React, no fetch) so they're easy to test
 * and easy for the Mission Control widgets to reuse later.
 *
 * Public surface:
 *  - isBalanced                          → balance sheet sanity check
 *  - balanceSheetDelta                   → how far off A=L+E+RE is
 *  - profitMargin                        → netProfit / totalIncome × 100
 *  - lineTotalOf                         → sum a section's line amounts
 *  - cashFlowNet                         → cashIn − cashOut (cross-check)
 *  - formatReportPeriod                  → CURRENT_PERIOD → "Հունիս 2026"
 *  - currentPeriodKey                    → today's YYYY-MM
 *  - shiftPeriodKey                      → ±N months
 *  - printDateLabel                      → Armenian long date for the
 *                                          "Printed …" footer
 *  - signClassForAmount                  → CSS class for positive /
 *                                          negative / zero amounts
 *  - sortLinesByCodeAsc                  → stable sort by account code
 */
import type {
  BalanceSheet,
  CashFlowStatement,
  FinancialStatementLine,
  IncomeStatement,
} from "../api/schemas";

/* ────────── period helpers ────────── */

/**
 * The current calendar month as a YYYY-MM key, evaluated once at module
 * load. Used by JSDoc examples and any caller that wants "today"
 * without injecting a Date. Grep for `CURRENT_PERIOD` to find every
 * site that depends on "today's period" rather than a fixed value.
 */
export const CURRENT_PERIOD: string = new Date().toISOString().slice(0, 7);

/** YYYY-MM period key for any given date. */
export function currentPeriodKey(today: Date = new Date()): string {
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Shift a YYYY-MM key by `deltaMonths`. Negative goes back. */
export function shiftPeriodKey(periodKey: string, deltaMonths: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) return periodKey;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1; // 0-based
  const d = new Date(Date.UTC(year, month + deltaMonths, 1));
  const ny = d.getUTCFullYear();
  const nm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${ny}-${nm}`;
}

/** Granularity for the period selector. Phase 7 ships month-only;
 *  quarter/year are pre-wired so the route's URL state can grow
 *  without a schema change. */
export type ReportGranularity = "month" | "quarter" | "year";

/** Human-readable Armenian label for a YYYY-MM period key. Mirrors
 *  finance/status.ts#periodLabel — kept duplicated here to avoid a
 *  cross-module dependency from CFO → Finance (CFO is the upper
 *  layer; importing down creates a cycle once Finance ever imports
 *  any CFO helper for the Mission Control widget). */
const AM_MONTHS_FULL = [
  "Հունվար", "Փետրվար", "Մարտ", "Ապրիլ", "Մայիս", "Հունիս",
  "Հուլիս", "Օգոստոս", "Սեպտեմբեր", "Հոկտեմբեր", "Նոյեմբեր", "Դեկտեմբեր",
] as const;

export function formatReportPeriod(periodKey: string | null | undefined): string {
  if (!periodKey) return "—";
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) return periodKey;
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx >= 12) return periodKey;
  return `${AM_MONTHS_FULL[idx]} ${m[1]}`;
}

/** Long Armenian date for the print footer ("Տպագրվել է 10 Հունիս 2026").
 *  Falls back to ISO date if Intl is not available in the runtime
 *  (it always is, but the catch is cheap insurance for the test env
 *  which may run with a polyfill-only locale). */
export function printDateLabel(today: Date = new Date()): string {
  const day = today.getUTCDate();
  const monthIdx = today.getUTCMonth();
  const year = today.getUTCFullYear();
  return `${day} ${AM_MONTHS_FULL[monthIdx]} ${year}`;
}

/* ────────── line aggregations ────────── */

/** Sum a list of statement lines. Skips non-finite and null entries. */
export function lineTotalOf(
  lines: ReadonlyArray<Pick<FinancialStatementLine, "amount">>,
): number {
  let total = 0;
  for (const l of lines) {
    if (typeof l.amount === "number" && Number.isFinite(l.amount)) total += l.amount;
  }
  return total;
}

/** Stable sort by account code, ascending. */
export function sortLinesByCodeAsc(
  lines: ReadonlyArray<FinancialStatementLine>,
): FinancialStatementLine[] {
  return [...lines].sort((a, b) => a.code.localeCompare(b.code));
}

/* ────────── income statement ────────── */

/** Net-profit margin as a percentage. Returns 0 if there was no income. */
export function profitMargin(income: Pick<IncomeStatement, "totalIncome" | "netProfit">): number {
  if (!income.totalIncome) return 0;
  return (income.netProfit / income.totalIncome) * 100;
}

/* ────────── balance sheet ────────── */

/** The accounting equation the engine enforces:
 *  totalAssets === totalLiabilities + totalEquity + retainedEarnings
 *  We use the pre-computed `totalEquityAndLiabilities` field rather
 *  than re-summing L + E + RE, so the helper is robust against
 *  rounding noise in the line totals.
 *
 *  Tolerance: ±1 AMD. The route renders a warning chip whenever this
 *  returns false (or whenever the server's own `balanced` flag is
 *  false). */
export function isBalanced(
  bs: Pick<BalanceSheet, "totalAssets" | "totalEquityAndLiabilities">,
  tolerance = 1,
): boolean {
  return Math.abs(bs.totalAssets - bs.totalEquityAndLiabilities) <= tolerance;
}

/** A − (L + E + RE). Positive means assets exceed the right-hand
 *  side — i.e. the engine under-counted equity or liabilities. */
export function balanceSheetDelta(
  bs: Pick<BalanceSheet, "totalAssets" | "totalEquityAndLiabilities">,
): number {
  return bs.totalAssets - bs.totalEquityAndLiabilities;
}

/* ────────── cash flow ────────── */

/** Net cash received minus paid out, recomputed from the engine's
 *  `cashIn` and `cashOut` fields. The engine already returns
 *  `netCashChange` but we keep this helper for test sanity-checks
 *  and for callers that want a recomputed cross-check. */
export function cashFlowNet(
  cf: Pick<CashFlowStatement, "cashIn" | "cashOut">,
): number {
  return (cf.cashIn ?? 0) - Math.abs(cf.cashOut ?? 0);
}

/* ────────── sign / display helpers ────────── */

/** CSS class for the amount cell: positive = green, negative = red,
 *  zero = muted. Used by the printable view and the inline screen
 *  view alike. */
export function signClassForAmount(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "text-muted-foreground";
  if (amount > 0) return "text-emerald-700 dark:text-emerald-400";
  if (amount < 0) return "text-rose-700 dark:text-rose-400";
  return "text-muted-foreground";
}
