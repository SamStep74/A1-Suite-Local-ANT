/**
 * PricingEvidence — pricing-evidence strip for CRM quotes.
 *
 * Per the plan §3.2 pattern #6 (Salesforce Explainable AI cards), every
 * pricing decision an agent or a human makes is paired with evidence:
 * the catalog price list code, the price-list version, the per-line
 * margin status, and (when the agent has applied a discount) the
 * reason the agent gave.
 *
 * Two modes:
 *   - **summary** (default): one row of "evidence" pills + a small
 *     explanation paragraph. Used in the CRM workspace sidebar.
 *   - **detail**: a per-line margin table. Used in the quote detail
 *     view.
 *
 * The component is **read-only** — it shows the evidence for a quote
 * and never mutates it. The mutation lives on the Decision Card
 * (Sales Quote Agent) on the right rail.
 *
 * The Sales Quote Agent produces `AgentSuggestion`s whose
 * `sourceRecords` we always pass as the first three chips here, so
 * the user sees the same evidence the agent saw when it decided.
 */
import { useMemo } from "react";
import { TrendingDown, TrendingUp, Receipt } from "lucide-react";
import { HybridBadge } from "../ui/HybridBadge";
import { money } from "../../lib/utils/money";
import { cn } from "../../lib/utils/cn";
import type { CrmQuote, CrmQuoteLine } from "../../lib/api/schemas";

/* ────────── types ────────── */

export type MarginStatus = "green" | "amber" | "red" | "unknown";

export interface PricingEvidenceProps {
  /** The quote whose evidence we're rendering. */
  quote: CrmQuote;
  /**
   * Layout. `summary` collapses to a single row of pills (sidebar);
   * `detail` shows a per-line table. Defaults to `summary`.
   */
  mode?: "summary" | "detail";
  /** Optional extra chips (e.g. agent `sourceRecords`). */
  extraSources?: string[];
  /** ClassName override. */
  className?: string;
}

/* ────────── helpers ────────── */

function marginStatus(marginPercent?: number | null): MarginStatus {
  if (marginPercent == null || Number.isNaN(marginPercent)) return "unknown";
  if (marginPercent >= 25) return "green";
  if (marginPercent >= 10) return "amber";
  return "red";
}

const MARGIN_TONE: Record<MarginStatus, string> = {
  green: "text-[var(--color-tag-green)]",
  amber: "text-[var(--color-amber,#d78b2f)]",
  red: "text-[var(--color-tag-red)]",
  unknown: "text-[var(--color-muted)]",
};

const MARGIN_BG: Record<MarginStatus, string> = {
  green: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
  amber: "bg-[color-mix(in_srgb,var(--color-amber,#d78b2f)_15%,transparent)]",
  red: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
  unknown: "bg-[var(--color-surface-soft)]",
};

/* ────────── root component ────────── */

export function PricingEvidence({
  quote,
  mode = "summary",
  extraSources,
  className,
}: PricingEvidenceProps) {
  const lineSummary = useMemo(() => summarise(quote.lines ?? []), [quote.lines]);

  return (
    <section
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]",
        className,
      )}
      data-entity="pricing-evidence"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2">
        <h2 className="inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
          <Receipt className="size-3.5" />
          Pricing evidence
        </h2>
        <HybridBadge kind="rule" />
      </header>

      <div className="space-y-3 p-3 text-[var(--text-sm)]">
        <div className="flex flex-wrap items-center gap-1.5">
          {lineSummary.priceListCode && (
            <Chip
              label={`Price list: ${lineSummary.priceListCode}`}
              tone="rule"
            />
          )}
          <Chip
            label={`${(quote.lines ?? []).length} line${(quote.lines ?? []).length === 1 ? "" : "s"}`}
            tone="data"
          />
          {lineSummary.dominantStatus !== "unknown" && (
            <Chip
              label={`${lineSummary.dominantStatus.toUpperCase()} margin`}
              tone={
                lineSummary.dominantStatus === "green"
                  ? "ai"
                  : lineSummary.dominantStatus === "amber"
                    ? "rule"
                    : "history"
              }
            />
          )}
          {lineSummary.discountReason && (
            <Chip
              label={`Discount: ${lineSummary.discountReason}`}
              tone="ai"
            />
          )}
          {extraSources?.slice(0, 3).map((s) => (
            <Chip key={s} label={s} tone="data" />
          ))}
        </div>

        {mode === "detail" && <LineMarginTable lines={quote.lines ?? []} />}

        <p className="text-[11px] text-[var(--color-muted)]">
          Prices are sourced from the active catalog price list. Any
          line whose margin falls below 10% requires an override and a
          written justification, surfaced as a Decision Card on the
          right rail.
        </p>
      </div>
    </section>
  );
}

/* ────────── summary helper ────────── */

function summarise(lines: CrmQuoteLine[]) {
  if (lines.length === 0) {
    return {
      dominantStatus: "unknown" as MarginStatus,
      counts: {} as Record<MarginStatus, number>,
      priceListCode: null as string | null,
      discountReason: null as string | null,
    };
  }
  const counts: Record<MarginStatus, number> = {
    green: 0,
    amber: 0,
    red: 0,
    unknown: 0,
  };
  for (const l of lines) {
    counts[marginStatus(l.marginRuleMinimumPercent)]++;
  }
  const order: MarginStatus[] = ["red", "amber", "green", "unknown"];
  const dominant = order.find((s) => counts[s] > 0) ?? "unknown";
  // Pick the first line that has a price list code / pricing source.
  const withCode = lines.find((l) => l.catalogPriceListCode);
  const withSource = lines.find((l) => l.pricingSource);
  return {
    dominantStatus: dominant,
    counts,
    priceListCode: withCode?.catalogPriceListCode ?? null,
    discountReason: withSource?.pricingSource ?? null,
  };
}

/* ────────── per-line table ────────── */

function LineMarginTable({ lines }: { lines: CrmQuoteLine[] }) {
  if (lines.length === 0) {
    return (
      <p className="px-2 py-4 text-center text-[11px] text-[var(--color-muted)]">
        No lines to evaluate.
      </p>
    );
  }
  return (
    <table className="w-full text-left text-[11px]">
      <thead className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <tr>
          <th className="px-1 py-1 font-medium">Line</th>
          <th className="px-1 py-1 text-right font-medium">Unit</th>
          <th className="px-1 py-1 text-right font-medium">Total</th>
          <th className="px-1 py-1 text-right font-medium">Margin</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => {
          const status = marginStatus(l.marginRuleMinimumPercent);
          const unit = Number(l.unitPrice ?? 0);
          const total = Number(l.total ?? 0);
          const target = Number(l.marginRuleTargetPercent ?? 0);
          return (
            <tr
              key={l.id ?? l.catalogItemId}
              className="border-t border-[var(--color-line)]"
            >
              <td className="max-w-[160px] truncate px-1 py-1 text-[var(--color-ink)]">
                {l.description ?? l.catalogName ?? l.catalogItemId ?? l.id}
              </td>
              <td className="px-1 py-1 text-right font-mono tabular-nums text-[var(--color-ink)]">
                {unit ? money(unit, { compact: true }) : "—"}
              </td>
              <td className="px-1 py-1 text-right font-mono tabular-nums text-[var(--color-ink)]">
                {total ? money(total, { compact: true }) : "—"}
              </td>
              <td className="px-1 py-1 text-right">
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] px-1 py-0.5 font-mono tabular-nums",
                    MARGIN_BG[status],
                    MARGIN_TONE[status],
                  )}
                >
                  {status === "red" || status === "amber" ? (
                    <TrendingDown className="size-3" />
                  ) : status === "green" ? (
                    <TrendingUp className="size-3" />
                  ) : null}
                  {target ? `${target.toFixed(1)}%` : "—"}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ────────── chip primitive ────────── */

function Chip({
  label,
  tone,
}: {
  label: string;
  tone: "rule" | "data" | "ai" | "history";
}) {
  const toneClass =
    tone === "ai"
      ? "bg-[color-mix(in_srgb,var(--color-agent,#7c3aed)_15%,transparent)] text-[var(--color-agent,#7c3aed)]"
      : tone === "rule"
        ? "bg-[color-mix(in_srgb,var(--color-deterministic,#475569)_15%,transparent)] text-[var(--color-deterministic,#475569)]"
        : tone === "history"
          ? "bg-[color-mix(in_srgb,var(--color-amber,#d78b2f)_15%,transparent)] text-[var(--color-amber,#d78b2f)]"
          : "bg-[var(--color-surface-soft)] text-[var(--color-ink)]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-medium",
        toneClass,
      )}
    >
      {label}
    </span>
  );
}
