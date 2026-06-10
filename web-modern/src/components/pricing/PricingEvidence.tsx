/**
 * PricingEvidence — the quote-line chip with margin-status badge.
 *
 * Shows the user where a quote line's price came from (price list,
 * manual override, etc.) and whether it cleared the margin rule. The
 * chip is the visual evidence backing the Sales Quote Agent's
 * "below minimum margin" flag — without it, the AI's confidence
 * number is unfounded.
 *
 * Variant: "ok" (green dot) | "below_minimum" (red dot) | "unknown"
 * (gray dot, e.g. legacy data with no margin metadata).
 */

import { AlertTriangle, CheckCircle2, HelpCircle, Tag } from "lucide-react";
import { cn } from "../../lib/utils/cn";
import { money } from "../../lib/utils/money";

export interface PricingEvidenceProps {
  /** Resolved unit price (after any discount). */
  unitPrice: number;
  /** Original list price before discount. */
  listPrice?: number | null;
  /** Discount applied (in currency). */
  discountAmount?: number | null;
  /** Discount applied (in percent, 0-100). */
  discountPercent?: number | null;
  /** Net margin percent (0-100). */
  marginPercent?: number | null;
  /** Margin status from the server. */
  marginStatus?: "ok" | "below_minimum" | string | null;
  /** The price list code the line resolved to. */
  priceListCode?: string | null;
  /** Pricing source label (e.g. "list", "agent:sales-quote"). */
  pricingSource?: string | null;
  /** Currency, defaults to AMD. */
  currency?: string;
  /** Compact form for table rows. */
  compact?: boolean;
  className?: string;
}

export function PricingEvidence({
  unitPrice,
  listPrice,
  discountAmount,
  discountPercent,
  marginPercent,
  marginStatus,
  priceListCode,
  pricingSource,
  compact,
  className,
}: PricingEvidenceProps) {
  const isBelow = marginStatus === "below_minimum";
  const isOk = marginStatus === "ok";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-[var(--radius-sm)] border px-2 py-1",
        isBelow
          ? "border-[var(--color-ruby,#b23a48)]/30 bg-[var(--color-ruby,#b23a48)]/5"
          : isOk
            ? "border-[var(--color-success,#0a8a4a)]/30 bg-[var(--color-success,#0a8a4a)]/5"
            : "border-[var(--color-line)] bg-[var(--color-surface-soft)]/40",
        compact ? "text-[var(--text-sm)]" : "text-[var(--text-base)]",
        className,
      )}
      data-status={marginStatus ?? "unknown"}
    >
      {/* Margin badge */}
      {isBelow ? (
        <AlertTriangle className="size-3.5 shrink-0 text-[var(--color-ruby,#b23a48)]" />
      ) : isOk ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-[var(--color-success,#0a8a4a)]" />
      ) : (
        <HelpCircle className="size-3.5 shrink-0 text-[var(--color-muted)]" />
      )}

      {/* Price + source */}
      <span className="font-semibold tabular-nums text-[var(--color-ink)]">
        {money(unitPrice)}
      </span>

      {!compact && priceListCode && (
        <span className="inline-flex items-center gap-0.5 text-[var(--text-sm)] text-[var(--color-muted)]">
          <Tag className="size-3" />
          {priceListCode}
        </span>
      )}

      {!compact && (discountAmount || discountPercent) && (
        <span className="text-[var(--text-sm)] text-[var(--color-muted)]">
          {discountPercent != null
            ? `−${discountPercent.toFixed(1)}%`
            : `−${money(discountAmount ?? 0)}`}
        </span>
      )}

      {!compact && typeof marginPercent === "number" && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-4",
            isBelow
              ? "bg-[var(--color-ruby,#b23a48)]/10 text-[var(--color-ruby,#b23a48)]"
              : "bg-[var(--color-success,#0a8a4a)]/10 text-[var(--color-success,#0a8a4a)]",
          )}
        >
          {marginPercent.toFixed(1)}% margin
        </span>
      )}

      {!compact && pricingSource && pricingSource !== "list" && (
        <span className="text-[11px] text-[var(--color-muted)]">
          via {pricingSource}
        </span>
      )}

      {!compact &&
        typeof listPrice === "number" &&
        listPrice > unitPrice && (
          <span className="text-[11px] text-[var(--color-muted)] line-through">
            {money(listPrice)}
          </span>
        )}
    </div>
  );
}
