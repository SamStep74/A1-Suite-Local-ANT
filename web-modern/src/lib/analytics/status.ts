/**
 * Pure helpers for the Analytics workspace.
 *
 * Source of truth: server/app.js (getSemanticMetrics,
 * getReceivablesAging, getRoleDashboard, getSemanticMetricSnapshots,
 * getAnalyticsReportPackets, getSemanticMetricDrilldown).
 *
 * These helpers are UI-pure: no React, no I/O. They re-implement
 * select small derivations the engine already produces (overdue
 * ratio, percentiles, top-metric selection) and add UI-specific
 * shaping (tone, sorting) without duplicating the math.
 *
 * Public surface:
 *  - classifyMetricUnit          → "currency" | "percent" | "count" | "status-count" | "unknown"
 *  - classifyMetricTone         → "positive" | "warning" | "critical" | "neutral" | "unknown"
 *  - classifyReportType          → "owner" | "accountant" | "other" | "unknown"
 *  - classifyRolePermission      → "captures" | "owner" | "accountant" | "none"
 *  - classifyDrilldownRecord
 *  - compareMetricsByValueDesc
 *  - compareSnapshotsByReportDateAsc
 *  - compareSeriesByPointCountDesc
 *  - compareReportsByCreatedAtDesc
 *  - compareBucketsByTotalDesc
 *  - overdueRatioPct
 *  - invoiceOverdueRatioPct
 *  - customerOverdueRatioPct
 *  - topMetric
 *  - seriesLatestPoint
 *  - seriesValueRange
 *  - seriesTrendDirection
 *  - formatCurrency / formatPercent (re-exported)
 */
import type {
  ReceivablesAgingSummary,
  RoleDashboardResponse,
  SemanticMetric,
  SemanticSnapshotSeries,
  SemanticSnapshotPoint,
  AnalyticsReport,
  AgingBucket,
} from "../api/schemas";
import { formatCurrency, formatPercent } from "../cfo/status";

/* ────────── types ────────── */

export type MetricUnitClass =
  | "currency"
  | "percent"
  | "count"
  | "status-count"
  | "unknown";

export type MetricTone =
  | "positive"
  | "warning"
  | "critical"
  | "neutral"
  | "unknown";

export type ReportTypeClass = "owner" | "accountant" | "other" | "unknown";

export type RolePermissionClass =
  | "captures"
  | "owner"
  | "accountant"
  | "none";

export type DrilldownTone = "positive" | "warning" | "critical" | "neutral" | "unknown";

export type TrendDirection = "up" | "down" | "flat" | "unknown";

/* ────────── unit classification ────────── */

const KNOWN_UNITS: ReadonlySet<string> = new Set([
  "AMD",
  "USD",
  "EUR",
  "RUB",
  "currency",
  "percent",
  "count",
  "status-count",
]);

const CURRENCY_CODES: ReadonlySet<string> = new Set([
  "AMD",
  "USD",
  "EUR",
  "RUB",
  "GBP",
  "GEL",
]);

export function classifyMetricUnit(
  metric: { unit?: string | null } | null | undefined,
): MetricUnitClass {
  const u = (metric?.unit ?? "").toString().toLowerCase();
  if (CURRENCY_CODES.has((metric?.unit ?? "").toString().toUpperCase())) {
    return "currency";
  }
  if (u === "currency") return "currency";
  if (u === "percent" || u === "%") return "percent";
  if (u === "count") return "count";
  if (u === "status-count") return "status-count";
  if (!KNOWN_UNITS.has((metric?.unit ?? "").toString())) return "unknown";
  return "unknown";
}

/* ────────── tone classification ────────── */

/**
 * Decide the UI tone for a semantic metric. The semantic layer does not
 * prescribe "good vs bad" (some metrics are "higher is better", some
 * are "lower is better"), so this is a small heuristic driven by
 * metric id, refreshCadence, and current value.
 */
export function classifyMetricTone(
  metric: Pick<SemanticMetric, "id" | "value" | "unit"> | null | undefined,
): MetricTone {
  if (!metric) return "unknown";
  const id = (metric.id ?? "").toString().toLowerCase();
  const value = Number(metric.value ?? 0);
  if (!Number.isFinite(value)) return "unknown";

  // Heuristics based on metric id (the only signal available without
  // ground truth from the engine).
  if (id.includes("overdue") || id === "sla-risk" || id === "ticket-backlog") {
    if (value > 0) return "critical";
    return "positive";
  }
  if (id.includes("readiness") || id.includes("roi")) {
    if (value >= 0) return "positive";
    return "warning";
  }
  if (id.includes("pipeline") || id.includes("forecast") || id.includes("receivables")) {
    if (value > 0) return "positive";
    if (value < 0) return "warning";
    return "neutral";
  }
  return "neutral";
}

/* ────────── report type classification ────────── */

export function classifyReportType(
  report: { reportType?: string | null } | null | undefined,
): ReportTypeClass {
  const t = (report?.reportType ?? "").toString().toLowerCase();
  if (t === "owner") return "owner";
  if (t === "accountant") return "accountant";
  if (t === "") return "unknown";
  return "other";
}

/* ────────── role permission classification ────────── */

export function classifyRolePermission(
  dashboard: Pick<RoleDashboardResponse, "permissions"> | null | undefined,
): RolePermissionClass {
  const perms = dashboard?.permissions ?? {};
  if (perms.canCaptureSnapshots) return "captures";
  if (perms.canCreateOwnerReport) return "owner";
  if (perms.canCreateAccountantReport) return "accountant";
  return "none";
}

/* ────────── drilldown record tone ────────── */

export function classifyDrilldownRecord(
  record: Record<string, unknown> | null | undefined,
): DrilldownTone {
  if (!record) return "unknown";
  // Heuristic: a "status" string set to closed/paid/done/resolved = positive,
  // anything containing overdue/breach = critical.
  const status = (record as { status?: string }).status;
  if (typeof status === "string") {
    const s = status.toLowerCase();
    if (s === "closed" || s === "paid" || s === "done" || s === "resolved") {
      return "positive";
    }
    if (s.includes("overdue") || s.includes("breach") || s.includes("at-risk")) {
      return "critical";
    }
    if (s === "open" || s === "pending" || s === "active") return "neutral";
  }
  // Fallback: any numeric `overdueDays` or `daysOverdue` > 0 is critical.
  const od = (record as { overdueDays?: number; daysOverdue?: number }).overdueDays;
  const od2 = (record as { daysOverdue?: number }).daysOverdue;
  const overdue = od ?? od2;
  if (typeof overdue === "number" && overdue > 0) return "critical";
  return "neutral";
}

/* ────────── ordering ────────── */

export function compareMetricsByValueDesc(
  a: Pick<SemanticMetric, "value">,
  b: Pick<SemanticMetric, "value">,
): number {
  return Math.abs(Number(b.value ?? 0)) - Math.abs(Number(a.value ?? 0));
}

export function compareSnapshotsByReportDateAsc(
  a: Pick<SemanticSnapshotPoint, "reportDate">,
  b: Pick<SemanticSnapshotPoint, "reportDate">,
): number {
  const aD = a.reportDate ?? "";
  const bD = b.reportDate ?? "";
  if (aD === bD) return 0;
  return aD < bD ? -1 : 1;
}

export function compareSeriesByPointCountDesc(
  a: Pick<SemanticSnapshotSeries, "points">,
  b: Pick<SemanticSnapshotSeries, "points">,
): number {
  return (b.points?.length ?? 0) - (a.points?.length ?? 0);
}

export function compareReportsByCreatedAtDesc(
  a: Pick<AnalyticsReport, "createdAt">,
  b: Pick<AnalyticsReport, "createdAt">,
): number {
  const aT = a.createdAt ?? "";
  const bT = b.createdAt ?? "";
  if (aT === bT) return 0;
  return aT < bT ? 1 : -1;
}

export function compareBucketsByTotalDesc(
  a: Pick<AgingBucket, "total">,
  b: Pick<AgingBucket, "total">,
): number {
  return Math.abs(Number(b.total ?? 0)) - Math.abs(Number(a.total ?? 0));
}

/* ────────── aggregates ────────── */

export function overdueRatioPct(
  summary: Pick<ReceivablesAgingSummary, "overdue" | "totalOpen">,
): number {
  const total = Number(summary.totalOpen ?? 0);
  const overdue = Number(summary.overdue ?? 0);
  if (total <= 0) return 0;
  if (overdue <= 0) return 0;
  if (overdue >= total) return 100;
  return Math.round((overdue / total) * 100);
}

export function invoiceOverdueRatioPct(
  summary: Pick<ReceivablesAgingSummary, "overdueInvoiceCount" | "invoiceCount">,
): number {
  const total = Number(summary.invoiceCount ?? 0);
  const overdue = Number(summary.overdueInvoiceCount ?? 0);
  if (total <= 0) return 0;
  if (overdue <= 0) return 0;
  if (overdue >= total) return 100;
  return Math.round((overdue / total) * 100);
}

export function customerOverdueRatioPct(
  summary: Pick<ReceivablesAgingSummary, "customerCount">,
  buckets: ReadonlyArray<Pick<AgingBucket, "customerCount" | "key">>,
): number {
  const total = Number(summary.customerCount ?? 0);
  if (total <= 0) return 0;
  // Sum non-current bucket customer counts as a coarse overdue ratio
  // (the engine groups customers by aging bucket).
  let nonCurrentCustomers = 0;
  for (const b of buckets) {
    if (b.key && b.key !== "current") {
      nonCurrentCustomers += Number(b.customerCount ?? 0);
    }
  }
  if (nonCurrentCustomers <= 0) return 0;
  if (nonCurrentCustomers >= total) return 100;
  return Math.round((nonCurrentCustomers / total) * 100);
}

export function topMetric(
  metrics: ReadonlyArray<SemanticMetric>,
): SemanticMetric | null {
  if (!metrics || metrics.length === 0) return null;
  const sorted = metrics.slice().sort(compareMetricsByValueDesc);
  return sorted[0] ?? null;
}

/* ────────── series helpers ────────── */

export function seriesLatestPoint(
  series: Pick<SemanticSnapshotSeries, "points">,
): SemanticSnapshotPoint | null {
  if (!series?.points || series.points.length === 0) return null;
  const sorted = series.points.slice().sort(compareSnapshotsByReportDateAsc);
  return sorted[sorted.length - 1] ?? null;
}

export function seriesValueRange(
  series: Pick<SemanticSnapshotSeries, "points">,
): { min: number; max: number } {
  const points = series?.points ?? [];
  if (points.length === 0) return { min: 0, max: 0 };
  let min = Number(points[0].value ?? 0);
  let max = min;
  for (const p of points) {
    const v = Number(p.value ?? 0);
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

export function seriesTrendDirection(
  series: Pick<SemanticSnapshotSeries, "points">,
): TrendDirection {
  const points = series?.points ?? [];
  if (points.length < 2) return "unknown";
  const sorted = points.slice().sort(compareSnapshotsByReportDateAsc);
  const first = Number(sorted[0].value ?? 0);
  const last = Number(sorted[sorted.length - 1].value ?? 0);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return "unknown";
  if (last > first) return "up";
  if (last < first) return "down";
  return "flat";
}

export { formatCurrency, formatPercent };
