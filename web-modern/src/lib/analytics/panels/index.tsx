/**
 * /app/analytics — view subcomponents (Phase 10.0 split).
 *
 * The `AnalyticsReceivablesTableView` re-export below is the
 * 10.4 conversion (DataTable + SavedViews + PeekPanel +
 * BulkActionBar on the Receivables tab). It lives in its own
 * file (`./AnalyticsReceivablesTable`) so the legacy
 * `AnalyticsReceivablesView` (KPI cards + plain table) keeps its
 * existing test surface intact — both are re-exported from here
 * so the route can pick whichever it wants.
 *
 * The five view subcomponents (Dashboard | Receivables | Metrics |
 * Snapshots | Reports) plus the shared `KpiCard`, `PageHeader`, and
 * `EmptyState` live here. The route file
 * (`/app/analytics/index.tsx`) owns the 5 useQuery calls, the
 * ViewSwitcher wiring, the URL-search dispatcher, and the back-link.
 *
 * All tone/sort helpers (METRIC_TONE, REPORT_TONE, TREND_LABEL,
 * PERM_LABEL) are colocated with the views that use them — they're
 * UI-shape constants, not pure logic, and don't belong in
 * `lib/analytics/status` (which is UI-pure).
 *
 * Path notes (from `src/lib/analytics/panels/`):
 *   - `../../api/schemas` → Zod-typed response shapes
 *   - `../status`         → pure helpers + UI tone types
 *   - `../../utils/cn`    → class-merge helper
 */
import { Link } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  CircleSlash,
  Clock4,
  Gauge,
  LineChart,
} from "lucide-react";
import {
  type RoleDashboardResponse,
  type ReceivablesAgingResponse,
  type SemanticMetricsResponse,
  type SemanticSnapshotsResponse,
  type AnalyticsReport,
} from "../../api/schemas";
import { cn } from "../../utils/cn";
import {
  classifyMetricUnit,
  classifyMetricTone,
  classifyReportType,
  classifyRolePermission,
  compareBucketsByTotalDesc,
  compareMetricsByValueDesc,
  compareReportsByCreatedAtDesc,
  compareSeriesByPointCountDesc,
  compareSnapshotsByReportDateAsc,
  formatCurrency,
  formatPercent,
  invoiceOverdueRatioPct,
  overdueRatioPct,
  seriesLatestPoint,
  seriesTrendDirection,
  topMetric,
  type MetricTone,
  type ReportTypeClass,
  type RolePermissionClass,
  type TrendDirection,
} from "../status";

/* ────────── shared tones (UI-shape constants, not pure helpers) ─── */

const METRIC_TONE: Record<MetricTone, { bg: string; fg: string }> = {
  positive: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
  },
  warning: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
  },
  critical: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
  },
  neutral: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
  },
};

const REPORT_TONE: Record<ReportTypeClass, { bg: string; fg: string; label: string }> = {
  owner: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
    label: "Owner",
  },
  accountant: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Accountant",
  },
  other: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "Other",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "—",
  },
};

const TREND_LABEL: Record<TrendDirection, string> = {
  up: "↑",
  down: "↓",
  flat: "→",
  unknown: "?",
};

const PERM_LABEL: Record<RolePermissionClass, string> = {
  captures: "Snapshot writer",
  owner: "Owner report",
  accountant: "Accountant report",
  none: "Read only",
};

/* ────────── shared primitives ────────── */

export function AnalyticsKpiCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative" | "warning";
}) {
  const toneClass =
    tone === "positive"
      ? "text-[var(--color-tag-green)]"
      : tone === "negative"
        ? "text-[var(--color-tag-red)]"
        : tone === "warning"
          ? "text-[var(--color-tag-orange)]"
          : "text-[var(--color-ink)]";
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className={cn("mt-1 font-mono text-[var(--text-lg)]", toneClass)}>{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

export function AnalyticsPageHeader() {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <LineChart className="size-3" />
        ANALYTICS
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">Analytics</h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Վահանակ · Դեբիտորական պարտքեր · Սեմանտիկ չափորոշիչներ · Պատկերացումներ · Հաշվետվություններ
      </p>
    </header>
  );
}

export function AnalyticsEmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
      <CircleSlash className="mx-auto mb-2 size-5 opacity-50" />
      {message}
    </div>
  );
}

/* ────────── Dashboard view ────────── */

export function AnalyticsDashboardView({
  data,
  loading,
  error,
}: {
  data: RoleDashboardResponse | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading dashboard…</p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load role dashboard.
      </p>
    );
  }
  if (!data) {
    return <AnalyticsEmptyState message="No dashboard data for this role." />;
  }

  const cards = data.summaryCards ?? [];
  const perm = classifyRolePermission(data);
  const apps = data.apps ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AnalyticsKpiCard
          label="Role"
          value={data.role}
          hint="Դեր"
        />
        <AnalyticsKpiCard
          label="Apps"
          value={String(apps.length)}
          hint="Հասանելի հավելվածներ"
        />
        <AnalyticsKpiCard
          label="Primary metrics"
          value={String(cards.length)}
          hint="Հիմնական չափորոշիչներ"
        />
        <AnalyticsKpiCard
          label="Permission"
          value={PERM_LABEL[perm]}
          hint="Թույլտվություն"
          tone={perm === "none" ? "warning" : "positive"}
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="analytics-summary-card"
        data-count={String(cards.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Metric
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Value
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Unit
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Owner
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Source
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {cards.map((c) => {
              const t = METRIC_TONE[classifyMetricTone(c)];
              const unitClass = classifyMetricUnit(c);
              return (
                <tr key={c.id} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2 text-[var(--color-ink)]">
                    <Link
                      to="/app/analytics/$metricId"
                      params={{ metricId: c.id }}
                      className="hover:underline"
                    >
                      {c.label}
                    </Link>
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-mono",
                      t.fg,
                    )}
                  >
                    {unitClass === "currency"
                      ? formatCurrency(c.value)
                      : unitClass === "percent"
                        ? formatPercent(c.value)
                        : String(c.value)}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{c.unit}</td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {c.ownerRole ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {(c.sourceApps ?? []).join(", ") || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {(data.nextActions ?? []).length > 0 && (
        <section
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
          data-entity="analytics-next-action"
          data-count={String((data.nextActions ?? []).length)}
        >
          <p className="inline-flex items-center gap-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
            <Activity className="size-3.5" />
            Next actions
          </p>
          <ul className="mt-2 space-y-1 text-[var(--text-sm)] text-[var(--color-ink)]">
            {(data.nextActions ?? []).map((a) => (
              <li key={a.actionKey}>
                <span className="font-semibold">{a.label}</span>
                {a.description && (
                  <span className="text-[var(--color-muted)]"> — {a.description}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ────────── Receivables view ────────── */

export function AnalyticsReceivablesView({
  data,
  loading,
  error,
}: {
  data: ReceivablesAgingResponse | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading receivables…</p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load receivables aging.
      </p>
    );
  }
  if (!data || !data.summary) {
    return <AnalyticsEmptyState message="No receivables data." />;
  }

  const summary = data.summary;
  const buckets = (data.buckets ?? []).slice().sort(compareBucketsByTotalDesc);
  const total = Number(summary.totalOpen ?? 0);
  const overdue = Number(summary.overdue ?? 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AnalyticsKpiCard
          label="Total open (AMD)"
          value={formatCurrency(total)}
          hint="Բաց ընդհանուր"
        />
        <AnalyticsKpiCard
          label="Overdue (AMD)"
          value={formatCurrency(overdue)}
          tone="negative"
          hint="Ժամկետանց"
        />
        <AnalyticsKpiCard
          label="Overdue ratio"
          value={formatPercent(overdueRatioPct(summary))}
          tone="negative"
          hint="Ժամկետանցի տոկոս"
        />
        <AnalyticsKpiCard
          label="Invoices"
          value={`${summary.overdueInvoiceCount}/${summary.invoiceCount}`}
          tone="warning"
          hint="Ժամկետանց / ընդհանուր"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="analytics-aging-bucket"
        data-count={String(buckets.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Bucket
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Total
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Invoices
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Customers
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {buckets.map((b) => (
              <tr key={b.key} className="hover:bg-[var(--color-surface-soft)]">
                <td className="px-3 py-2 font-mono text-[var(--color-ink)]">
                  {b.label ?? b.key}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                  {formatCurrency(Number(b.total ?? 0))}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-muted)]">
                  {b.invoiceCount}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-muted)]">
                  {b.customerCount ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {summary.invoiceCount > 0 && (
        <p
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3 text-[11px] text-[var(--color-muted)]"
          data-entity="analytics-invoice-overdue-ratio"
        >
          Invoice overdue ratio:{" "}
          <span className="font-mono text-[var(--color-ink)]">
            {formatPercent(invoiceOverdueRatioPct(summary))}
          </span>
        </p>
      )}
    </div>
  );
}

/* ────────── Metrics view ────────── */

export function AnalyticsMetricsView({
  data,
  loading,
  error,
}: {
  data: SemanticMetricsResponse | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading metrics…</p>;
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load semantic metrics.
      </p>
    );
  }
  const metrics = (data?.metrics ?? []).slice().sort(compareMetricsByValueDesc);
  const top = topMetric(metrics);

  return (
    <div className="space-y-4">
      {top && (
        <div
          className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-tag-blue)_40%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-tag-blue)_8%,var(--color-surface))] p-3"
          data-entity="analytics-top-metric"
        >
          <p className="inline-flex items-center gap-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
            <Gauge className="size-3.5" />
            Top metric
          </p>
          <p className="mt-1 text-[var(--text-sm)] text-[var(--color-ink)]">
            <span className="font-mono">{top.label}</span> — {top.value} {top.unit}
          </p>
        </div>
      )}

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="analytics-metric"
        data-count={String(metrics.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Metric
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Value
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Unit
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Owner
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Cadence
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {metrics.map((m) => {
              const t = METRIC_TONE[classifyMetricTone(m)];
              const unitClass = classifyMetricUnit(m);
              return (
                <tr key={m.id} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2">
                    <Link
                      to="/app/analytics/$metricId"
                      params={{ metricId: m.id }}
                      className={cn("hover:underline", t.fg)}
                    >
                      {m.label}
                    </Link>
                  </td>
                  <td className={cn("px-3 py-2 text-right font-mono", t.fg)}>
                    {unitClass === "currency"
                      ? formatCurrency(Number(m.value ?? 0))
                      : unitClass === "percent"
                        ? formatPercent(Number(m.value ?? 0))
                        : String(m.value ?? 0)}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{m.unit}</td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {m.ownerRole ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {m.refreshCadence ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ────────── Snapshots view ────────── */

export function AnalyticsSnapshotsView({
  data,
  loading,
  error,
}: {
  data: SemanticSnapshotsResponse | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading snapshots…</p>;
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load snapshots.
      </p>
    );
  }
  const series = (data?.series ?? []).slice().sort(compareSeriesByPointCountDesc);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <AnalyticsKpiCard label="Series" value={String(series.length)} hint="Շարքեր" />
        <AnalyticsKpiCard
          label="Snapshots"
          value={String(series.reduce((s, sr) => s + (sr.points?.length ?? 0), 0))}
          hint="Պատկերացումների քանակ"
        />
        <AnalyticsKpiCard
          label="Semantic version"
          value={data?.semanticLayerVersion ?? "—"}
          hint="Սեմանտիկ շերտի տարբերակ"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="analytics-snapshot-series"
        data-count={String(series.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Metric
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Unit
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Points
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Latest
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Trend
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {series.map((s) => {
              const latest = seriesLatestPoint(s);
              const trend = seriesTrendDirection(s);
              const unitClass = classifyMetricUnit({ unit: s.unit });
              return (
                <tr key={s.metricId} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2 text-[var(--color-ink)]">
                    {s.label ?? s.metricId}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{s.unit ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                    {s.points?.length ?? 0}
                  </td>
                  <td className="px-3 py-2 font-mono text-[var(--color-ink)]">
                    {latest
                      ? unitClass === "currency"
                        ? formatCurrency(Number(latest.value))
                        : String(latest.value)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {TREND_LABEL[trend]}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ────────── Reports view ────────── */

export function AnalyticsReportsView({
  data,
  loading,
  error,
}: {
  data: { reports: AnalyticsReport[] } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading reports…</p>;
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load reports.
      </p>
    );
  }
  const reports = (data?.reports ?? []).slice().sort(compareReportsByCreatedAtDesc);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <AnalyticsKpiCard label="Reports" value={String(reports.length)} hint="Հաշվետվություններ" />
        <AnalyticsKpiCard
          label="Owner"
          value={String(reports.filter((r) => classifyReportType(r) === "owner").length)}
          hint="Սեփականատիրոջ հաշվետվություններ"
        />
        <AnalyticsKpiCard
          label="Accountant"
          value={String(
            reports.filter((r) => classifyReportType(r) === "accountant").length,
          )}
          hint="Հաշվապահի հաշվետվություններ"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="analytics-report"
        data-count={String(reports.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                ID
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Type
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Period
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Status
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Metrics
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {reports.map((r) => {
              const t = REPORT_TONE[classifyReportType(r)];
              return (
                <tr key={r.id} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2 font-mono text-[var(--color-ink)]">
                    {r.id}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                        t.bg,
                        t.fg,
                      )}
                    >
                      {t.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {r.periodKey ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {r.status ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                    {r.metricCount ?? 0}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {r.createdAt ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <p className="text-[11px] text-[var(--color-muted)]">
        <BarChart3 className="mr-1 inline-block size-3" />
        Հաշվետվությունները ստեղծվում են ֆինանսական կամ սեփականատիրոջ դերով։ Ստեղծման/ընթերցանության API-ն սերվերից է։
      </p>
      {/* sort util reference to keep compareSnapshotsByReportDateAsc in scope */}
      <span className="hidden" data-entity="analytics-snapshot-sort">
        {compareSnapshotsByReportDateAsc.name}
      </span>
      <span className="hidden" data-entity="analytics-clock">
        <Clock4 className="size-3" />
      </span>
    </div>
  );
}

/* ────────── 10.4 conversion (DataTable + SavedViews + PeekPanel + BulkActionBar) ────────── */

export { AnalyticsReceivablesTableView } from "./AnalyticsReceivablesTable";
