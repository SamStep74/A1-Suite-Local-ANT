/**
 * ForecastSummaryCard — weighted pipeline by stage.
 *
 * Reads a CrmForecast and renders a compact summary suitable for the
 * top of /app/crm (replaces a chart for V1) and the right rail of the
 * Mission Control "Owner view". Shows:
 *   - Total pipeline value + weighted value
 *   - At-risk count, unreviewed count
 *   - One row per forecast category (Commit / Best Case / Pipeline)
 *     with a horizontal bar showing the value as a fraction of total
 *
 * V2 swap: replace bars with a stacked horizontal chart (Tremor Raw
 * v3) and add the deals-by-stage breakdown.
 */

import { AlertCircle, TrendingUp, Wallet } from "lucide-react";
import { type CrmForecast } from "../../lib/api/schemas";
import { cn } from "../../lib/utils/cn";
import { money, numberShort } from "../../lib/utils/money";

export interface ForecastSummaryCardProps {
  forecast: CrmForecast;
  className?: string;
}

const CATEGORY_ACCENT: Record<string, string> = {
  Commit: "bg-[var(--color-success,#0a8a4a)]",
  "Best Case": "bg-[var(--color-teal,#00897b)]",
  Pipeline: "bg-[var(--color-blue,#2d6cdf)]",
  Omitted: "bg-[var(--color-muted)]",
};

function categoryAccent(cat: string): string {
  return CATEGORY_ACCENT[cat] ?? "bg-[var(--color-violet,#594cdb)]";
}

export function ForecastSummaryCard({
  forecast,
  className,
}: ForecastSummaryCardProps) {
  const { totals, categories, deals } = forecast;
  const maxValue = Math.max(1, ...categories.map((c) => Number(c.value) || 0));

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3",
        className,
      )}
    >
      <header className="flex items-center justify-between">
        <h3 className="inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
          <TrendingUp className="size-3.5" />
          Forecast
        </h3>
        <span className="text-[11px] text-[var(--color-muted)]">
          {deals.length} deal{deals.length === 1 ? "" : "s"}
        </span>
      </header>

      {/* Totals row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-soft)]/40 p-2">
          <div className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
            <Wallet className="size-3" /> Pipeline
          </div>
          <div className="text-[var(--text-md)] font-semibold tabular-nums text-[var(--color-ink)]">
            {money(totals.value, { compact: true })}
          </div>
        </div>
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-soft)]/40 p-2">
          <div className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
            <TrendingUp className="size-3" /> Weighted
          </div>
          <div className="text-[var(--text-md)] font-semibold tabular-nums text-[var(--color-brand,#0f3b3c)]">
            {money(totals.weightedValue ?? 0, { compact: true })}
          </div>
        </div>
      </div>

      {/* Category bars */}
      <div className="flex flex-col gap-2">
        {categories.map((cat) => {
          const value = Number(cat.value) || 0;
          const weighted = Number(cat.weightedValue ?? 0);
          const pct = (value / maxValue) * 100;
          const weightedPct = value > 0 ? (weighted / value) * 100 : 0;
          return (
            <div key={cat.forecastCategory} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[var(--text-sm)]">
                <span className="inline-flex items-center gap-1.5 text-[var(--color-ink)]">
                  <span
                    className={cn(
                      "inline-block size-2 rounded-full",
                      categoryAccent(cat.forecastCategory),
                    )}
                    aria-hidden
                  />
                  {cat.forecastCategory}
                </span>
                <span className="tabular-nums text-[var(--color-muted)]">
                  {numberShort(value)} · {cat.count}
                </span>
              </div>
              <div
                className="relative h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-soft)]"
                role="meter"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={cn("absolute inset-y-0 left-0", categoryAccent(cat.forecastCategory))}
                  style={{ width: `${pct}%` }}
                />
                {/* Weighted overlay */}
                {weightedPct > 0 && weightedPct < 100 && (
                  <div
                    className="absolute inset-y-0 left-0 border-r border-[var(--color-ink)]/30"
                    style={{ width: `${weightedPct}%` }}
                    aria-hidden
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Risk callouts */}
      {(totals.atRisk ?? 0) > 0 && (
        <div className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-amber,#d78b2f)]/30 bg-[var(--color-amber,#d78b2f)]/5 px-2 py-1 text-[var(--text-sm)] text-[var(--color-amber,#d78b2f)]">
          <AlertCircle className="size-3.5" />
          {totals.atRisk} deal{totals.atRisk === 1 ? "" : "s"} at risk
        </div>
      )}
      {(totals.unreviewed ?? 0) > 0 && (
        <div className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-soft)]/40 px-2 py-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          {totals.unreviewed} deal{totals.unreviewed === 1 ? "" : "s"} unreviewed
        </div>
      )}
    </div>
  );
}
