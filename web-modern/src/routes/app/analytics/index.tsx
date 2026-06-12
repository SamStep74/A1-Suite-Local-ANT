/**
 * /app/analytics — Analytics workspace: dashboard | receivables |
 * metrics | snapshots | reports. (Phase 10.0 split.)
 *
 * Mirrors cfo/ pattern (Pattern A from the plan §3.5). The home
 * route is a ViewSwitcher over five surfaces:
 *
 *   - **Dashboard** — role-scoped summary cards from
 *     /api/analytics/role-dashboard (primary metrics + apps +
 *     permissions + next actions)
 *   - **Receivables** — HayHashvapah AR aging buckets + summary
 *     (overdue ratio KPIs)
 *   - **Metrics** — semantic metrics list with owner/role/source
 *     metadata; each row links to /app/analytics/$metricId
 *   - **Snapshots** — historical semantic-metric snapshots grouped
 *     by metric (series) for the trend view
 *   - **Reports** — analyst/owner report packets
 *
 * URL state:
 *   ?view=dashboard | receivables | metrics | snapshots | reports
 *
 * Data (all require app=analytics access):
 *   - GET /api/analytics/role-dashboard
 *   - GET /api/analytics/receivables-aging
 *   - GET /api/analytics/semantic-metrics
 *   - GET /api/analytics/semantic-snapshots
 *   - GET /api/analytics/reports
 *
 * This file is now a thin composition layer:
 *   - `Route` and the `AnalyticsWorkspace` root live here because
 *     they own the 5 useQuery calls, the ViewSwitcher wiring, the
 *     URL-search dispatcher, and the back-link.
 *   - The 5 view subcomponents (Dashboard | Receivables | Metrics |
 *     Snapshots | Reports) plus the shared `KpiCard`, `PageHeader`,
 *     and `EmptyState` live in `lib/analytics/panels` and are
 *     re-exported below.
 *
 * The test (`./-index.test.tsx`) only imports `Route` from this
 * file — the re-export surface exists for downstream consumption
 * parity with the warehouse/$itemId splits.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronLeft } from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  RoleDashboardResponseSchema,
  ReceivablesAgingResponseSchema,
  SemanticMetricsResponseSchema,
  SemanticSnapshotsResponseSchema,
  AnalyticsReportsListResponseSchema,
} from "../../../lib/api/schemas";
import { ViewSwitcher } from "../../../components/view-switcher/ViewSwitcher";
import {
  AnalyticsDashboardView,
  AnalyticsMetricsView,
  AnalyticsPageHeader,
  AnalyticsReceivablesTableView,
  AnalyticsReportsView,
  AnalyticsSnapshotsView,
} from "../../../lib/analytics/panels";

/* ────────── re-exports (preserves the test's named import surface) ─ */

export {
  AnalyticsDashboardView,
  AnalyticsEmptyState,
  AnalyticsKpiCard,
  AnalyticsMetricsView,
  AnalyticsPageHeader,
  AnalyticsReceivablesView,
  AnalyticsReceivablesTableView,
  AnalyticsReportsView,
  AnalyticsSnapshotsView,
} from "../../../lib/analytics/panels";

/* ────────── typed URL search ────────── */

type View = "dashboard" | "receivables" | "metrics" | "snapshots" | "reports";

export const Route = createFileRoute("/app/analytics/")({
  validateSearch: (raw) => {
    const v: View =
      raw.view === "receivables" ||
      raw.view === "metrics" ||
      raw.view === "snapshots" ||
      raw.view === "reports"
        ? raw.view
        : "dashboard";
    return { view: v };
  },
  component: AnalyticsWorkspace,
});

/* ────────── root component ────────── */

function AnalyticsWorkspace() {
  const { t } = useLingui();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view: View = search.view;
  const setView = (next: View) => navigate({ search: { view: next }, replace: true });

  // Tab labels are extracted as message ids; the source string (hy)
  // is the source of truth, and the en/ru catalogs can fill them in
  // later. ViewSwitcher is label-agnostic — it just renders the
  // string we hand it, so wrapping here is enough.
  const VIEW_OPTIONS: { value: View; label: string }[] = [
    { value: "dashboard", label: t`Dashboard` },
    { value: "receivables", label: t`Receivables` },
    { value: "metrics", label: t`Metrics` },
    { value: "snapshots", label: t`Snapshots` },
    { value: "reports", label: t`Reports` },
  ];

  const dashboardQ = useQuery({
    queryKey: ["analytics-role-dashboard"],
    queryFn: async () => {
      const raw = await getJson("/api/analytics/role-dashboard");
      return RoleDashboardResponseSchema.parse(raw);
    },
  });
  const receivablesQ = useQuery({
    queryKey: ["analytics-receivables-aging"],
    queryFn: async () => {
      const raw = await getJson("/api/analytics/receivables-aging");
      return ReceivablesAgingResponseSchema.parse(raw);
    },
  });
  const metricsQ = useQuery({
    queryKey: ["analytics-semantic-metrics"],
    queryFn: async () => {
      const raw = await getJson("/api/analytics/semantic-metrics");
      return SemanticMetricsResponseSchema.parse(raw);
    },
  });
  const snapshotsQ = useQuery({
    queryKey: ["analytics-semantic-snapshots"],
    queryFn: async () => {
      const raw = await getJson("/api/analytics/semantic-snapshots");
      return SemanticSnapshotsResponseSchema.parse(raw);
    },
  });
  const reportsQ = useQuery({
    queryKey: ["analytics-reports"],
    queryFn: async () => {
      const raw = await getJson("/api/analytics/reports");
      return AnalyticsReportsListResponseSchema.parse(raw);
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <AnalyticsPageHeader />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ViewSwitcher options={VIEW_OPTIONS} value={view} onChange={setView} />
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          <Trans>Today</Trans>
        </Link>
      </div>

      {view === "dashboard" && (
        <AnalyticsDashboardView
          data={dashboardQ.data}
          loading={dashboardQ.isLoading}
          error={dashboardQ.isError}
        />
      )}
      {view === "receivables" && (
        <AnalyticsReceivablesTableView
          data={receivablesQ.data}
          loading={receivablesQ.isLoading}
          error={receivablesQ.isError}
        />
      )}
      {view === "metrics" && (
        <AnalyticsMetricsView
          data={metricsQ.data}
          loading={metricsQ.isLoading}
          error={metricsQ.isError}
        />
      )}
      {view === "snapshots" && (
        <AnalyticsSnapshotsView
          data={snapshotsQ.data}
          loading={snapshotsQ.isLoading}
          error={snapshotsQ.isError}
        />
      )}
      {view === "reports" && (
        <AnalyticsReportsView
          data={reportsQ.data}
          loading={reportsQ.isLoading}
          error={reportsQ.isError}
        />
      )}
    </div>
  );
}
