/**
 * Pure helpers for the CFO workspace.
 *
 * Source of truth: server/cfo.js (computeCashFlow, computeBudgetVariance,
 * computeTreasuryPosition, buildPaymentCalendar, computeFxExposure,
 * amortizeLoan, forecastLiquidity, analyzeFxRisk, analyzeDebtLoad).
 *
 * These helpers are UI-pure: no React, no I/O. They re-implement
 * select small derivations the engine already produces (cumulative
 * waterfall, totals) and add UI-specific shaping (tone, sorting,
 * variance label) without duplicating the math.
 *
 * Public surface:
 *  - classifyBudgetStatus
 *  - compareCalendarsByDate
 *  - compareFxByAbsExposureDesc
 *  - cashFlowNetTotal
 *  - cashFlowClosingDelta
 *  - budgetVarianceLabel     → "Over" | "Under" | "On target"
 *  - budgetUtilizationClass  → "green" | "amber" | "red"
 *  - calendarTotalsByKind
 *  - fxHedgeClass            → "none" | "info" | "warning"
 *  - formatCurrency / formatPercent
 *  - AM_SHORT_MONTHS
 */
import type {
  CfoBudgetStatus,
  CfoBudgetVariance,
  CfoBudgetVarianceLine,
  CfoCashFlow,
  CfoFxExposure,
  CfoFxExposureRow,
  CfoPaymentCalendar,
  CfoPaymentCalendarEntry,
  CfoTreasuryPosition,
} from "../api/schemas";

/* ────────── types ────────── */

export type BudgetTone = "active" | "draft" | "closed" | "archived" | "unknown";

export type VarianceLabel = "Over" | "Under" | "On target";

export type UtilizationClass = "green" | "amber" | "red";

export type FxHedgeClass = "none" | "info" | "warning";

export const AM_SHORT_MONTHS = [
  "Հնվ", "Փտր", "Մրտ", "Ապր", "Մյս", "Հնս",
  "Հլս", "Օգս", "Սեպ", "Հոկ", "Նոյ", "Դեկ",
] as const;

const BUDGET_STATUSES: ReadonlySet<CfoBudgetStatus> = new Set([
  "active",
  "draft",
  "closed",
  "archived",
]);

/* ────────── classification ────────── */

export function classifyBudgetStatus(
  budget: { status?: string | null } | null | undefined,
): BudgetTone {
  const s = (budget?.status ?? "").toString().toLowerCase();
  if (BUDGET_STATUSES.has(s as CfoBudgetStatus)) return s as BudgetTone;
  return "unknown";
}

/* ────────── ordering ────────── */

export function compareCalendarsByDate(
  a: Pick<CfoPaymentCalendarEntry, "date">,
  b: Pick<CfoPaymentCalendarEntry, "date">,
): number {
  return a.date.localeCompare(b.date);
}

export function compareFxByAbsExposureDesc(
  a: CfoFxExposureRow,
  b: CfoFxExposureRow,
): number {
  return Math.abs(b.netAmd) - Math.abs(a.netAmd);
}

export function compareTreasuryByBalanceDesc(
  a: CfoTreasuryPosition,
  b: CfoTreasuryPosition,
): number {
  return Math.abs(b.balance) - Math.abs(a.balance);
}

/* ────────── aggregates ────────── */

export function cashFlowNetTotal(cf: Pick<CfoCashFlow, "weekly">): number {
  return cf.weekly.reduce((s, w) => s + (w.net ?? 0), 0);
}

export function cashFlowClosingDelta(cf: Pick<CfoCashFlow, "openingAmd" | "closingAmd">): number {
  return cf.closingAmd - cf.openingAmd;
}

export function calendarTotalsByKind(
  cal: Pick<CfoPaymentCalendar, "entries">,
): { arAmd: number; apAmd: number; loanAmd: number } {
  let arAmd = 0;
  let apAmd = 0;
  let loanAmd = 0;
  for (const e of cal.entries) {
    if (e.kind === "ar") arAmd += e.amount;
    else if (e.kind === "ap") apAmd += e.amount;
    else if (e.kind === "loan") loanAmd += e.amount;
  }
  return { arAmd, apAmd, loanAmd };
}

export function varianceLineCount(v: Pick<CfoBudgetVariance, "lines">): number {
  return v.lines.length;
}

/* ────────── classification of variance ────────── */

export function budgetVarianceLabel(
  line: Pick<CfoBudgetVarianceLine, "variance" | "planned">,
): VarianceLabel {
  if (line.planned === 0) return line.variance === 0 ? "On target" : "Over";
  if (line.variance > 0) return "Over";
  if (line.variance < 0) return "Under";
  return "On target";
}

export function budgetUtilizationClass(
  line: Pick<CfoBudgetVarianceLine, "utilizationPct">,
): UtilizationClass {
  const pct = Number(line.utilizationPct);
  if (!Number.isFinite(pct)) return "amber";
  if (pct > 110) return "red";
  if (pct > 90) return "green";
  if (pct >= 70) return "amber";
  return "red";
}

/* ────────── FX hedging ────────── */

const FX_HEDGE_THRESHOLD_AMD = 5_000_000;

export function fxHedgeClass(
  row: Pick<CfoFxExposureRow, "netAmd">,
): FxHedgeClass {
  const abs = Math.abs(row.netAmd);
  if (abs > FX_HEDGE_THRESHOLD_AMD) return "warning";
  if (abs > 1_000_000) return "info";
  return "none";
}

export function fxHedgeSuggestion(
  exposure: Pick<CfoFxExposure, "hedgeSuggestion">,
): string | null {
  return exposure.hedgeSuggestion ?? null;
}

/* ────────── formatting ────────── */

export function formatCurrency(value: number | null | undefined, currency = "AMD"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("hy-AM", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value.toLocaleString("en-US")} ${currency}`;
  }
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  // CFO utilization fields are already percentages (e.g. 95 = 95%); pass through.
  return `${value.toFixed(digits)}%`;
}
