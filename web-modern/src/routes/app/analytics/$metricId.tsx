/**
 * /app/analytics/$metricId — semantic-metric drilldown route.
 *
 * Drills into a single semantic metric from the Analytics workspace.
 * Fetches `/api/analytics/semantic-metrics/:id/drilldown` and renders:
 *   - header with metric id + label + monogram
 *   - 3 KPI cards: value, record count, AMD total (from drilldown totals)
 *   - drilldown records table (first 50 rows)
 *   - formula + definition + source apps
 *
 * The back-link returns to /app/analytics with view=metrics selected.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, CircleSlash, LineChart } from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  SemanticMetricDrilldownResponseSchema,
  type SemanticMetricDrilldownResponse,
} from "../../../lib/api/schemas";
import { cn } from "../../../lib/utils/cn";
import {
  classifyDrilldownRecord,
  classifyMetricTone,
  classifyMetricUnit,
  formatCurrency,
  formatPercent,
  type DrilldownTone,
} from "../../../lib/analytics/status";

/* ────────── typed URL search ────────── */

export const Route = createFileRoute("/app/analytics/$metricId")({
  validateSearch: () => ({}),
  component: MetricDetail,
});

/* ────────── tones ────────── */

const TONE: Record<DrilldownTone, { bg: string; fg: string }> = {
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

/* ────────── root component ────────── */

function MetricDetail() {
  const { metricId } = Route.useParams();

  const q = useQuery({
    queryKey: ["analytics-metric-drilldown", metricId],
    queryFn: async () => {
      const raw = await getJson(
        `/api/analytics/semantic-metrics/${encodeURIComponent(metricId)}/drilldown`,
      );
      return SemanticMetricDrilldownResponseSchema.parse(
        raw,
      ) as SemanticMetricDrilldownResponse;
    },
    enabled: Boolean(metricId),
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
        <PageHeader metricId={metricId} label={null} />
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading metric…</p>
      </div>
    );
  }

  if (q.isError || !q.data || !q.data.metric) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
        <PageHeader metricId={metricId} label={null} />
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          <CircleSlash className="mx-auto mb-2 size-5 opacity-50" />
          {q.isError
            ? "Failed to load metric drilldown."
            : "No metric data for this id."}
        </div>
        <BackLink />
      </div>
    );
  }

  const metric = q.data.metric;
  const records = (q.data.records ?? []) as Array<Record<string, unknown>>;
  const totals = q.data.totals;
  const tone = TONE[classifyMetricTone(metric)];
  const unitClass = classifyMetricUnit(metric);
  const previewRecords = records.slice(0, 50);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader metricId={metricId} label={metric.label} />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Value"
          value={
            unitClass === "currency"
              ? formatCurrency(Number(metric.value ?? 0))
              : unitClass === "percent"
                ? formatPercent(Number(metric.value ?? 0))
                : String(metric.value ?? 0)
          }
          hint={metric.unit}
          tone={tone.fg}
        />
        <KpiCard
          label="Records"
          value={String(metric.recordCount ?? totals?.recordCount ?? 0)}
          hint="Հաշվառումների քանակ"
        />
        <KpiCard
          label="AMD total"
          value={formatCurrency(Number(totals?.amdTotal ?? 0))}
          hint="AMD ընդհանուր"
        />
      </section>

      <section
        className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
        data-entity="analytics-metric-meta"
      >
        <p className="text-[var(--text-sm)] text-[var(--color-ink)]">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
            Formula
          </span>
          <br />
          <span className="font-mono">{metric.formula ?? "—"}</span>
        </p>
        <p className="mt-2 text-[var(--text-sm)] text-[var(--color-ink)]">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
            Definition
          </span>
          <br />
          {metric.definition ?? "—"}
        </p>
        <p className="mt-2 text-[11px] text-[var(--color-muted)]">
          Owner: <span className="text-[var(--color-ink)]">{metric.ownerRole ?? "—"}</span> ·
          Cadence:{" "}
          <span className="text-[var(--color-ink)]">{metric.refreshCadence ?? "—"}</span> ·
          Sources:{" "}
          <span className="text-[var(--color-ink)]">
            {(metric.sourceApps ?? []).join(", ") || "—"}
          </span>
        </p>
      </section>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="analytics-drilldown-record"
        data-count={String(records.length)}
      >
        <header className="border-b border-[var(--color-line)] px-3 py-2 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          Drilldown records ({records.length})
        </header>
        {previewRecords.length === 0 ? (
          <div className="px-3 py-4 text-center text-[var(--color-muted)]">
            No drilldown records.
          </div>
        ) : (
          <table className="w-full text-[var(--text-sm)]" role="table">
            <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Source
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Customer / Subject
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Total
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {previewRecords.map((r, i) => {
                const rtone = TONE[classifyDrilldownRecord(r)];
                const source = String((r as { sourceApp?: string }).sourceApp ?? "—");
                const customer = String(
                  (r as { customerName?: string }).customerName ??
                    (r as { label?: string }).label ??
                    (r as { subjectId?: string }).subjectId ??
                    "—",
                );
                const total = Number(
                  (r as { total?: number; value?: number; weightedValue?: number }).total ??
                    (r as { value?: number }).value ??
                    (r as { weightedValue?: number }).weightedValue ??
                    0,
                );
                const status = String((r as { status?: string }).status ?? "—");
                return (
                  <tr key={i} className="hover:bg-[var(--color-surface-soft)]">
                    <td className="px-3 py-2 text-[var(--color-muted)]">{source}</td>
                    <td className="px-3 py-2 text-[var(--color-ink)]">{customer}</td>
                    <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                      {formatCurrency(total)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                          rtone.bg,
                          rtone.fg,
                        )}
                      >
                        {status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <BackLink />
    </div>
  );
}

/* ────────── page header ────────── */

function PageHeader({ metricId, label }: { metricId: string; label: string | null }) {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <LineChart className="size-3" />
        ANALYTICS · {metricId}
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
        {label ?? "Չափորոշիչ"}
      </h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Metric drilldown for <span className="font-mono">{metricId}</span>
      </p>
    </header>
  );
}

/* ────────── KPI card ────────── */

function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className={cn("mt-1 font-mono text-[var(--text-lg)]", tone ?? "text-[var(--color-ink)]")}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

/* ────────── back link ────────── */

function BackLink() {
  return (
    <Link
      to="/app/analytics"
      search={{ view: "metrics" }}
      className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
    >
      <ChevronLeft className="size-3.5" />
      Back to Analytics
    </Link>
  );
}
