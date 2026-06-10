/**
 * /app/crm/$quoteId — quote detail with the right-rail AgentActionPanel.
 *
 * Per the plan §3.2 pattern #6 (Salesforce Explainable AI cards) and
 * pattern #2 (Zoho right-rail AI Action Panel), this is the canonical
 * per-record surface: header + status pill + lines table + AI
 * suggestions on the right.
 *
 * What you see:
 *   - Header: title, number, customer, deal, status pill
 *   - Lines table: each line shows qty / unit / discount / margin
 *     status (the PricingEvidence component the Sales Quote Agent uses
 *     to surface red/yellow/green per line)
 *   - Pricing evidence row below the table (the PricingEvidence
 *     component in summary mode)
 *   - Right rail:
 *     1. AI Action Panel (AgentActionPanel) — runs every agent that
 *        declares `crm.quote` in its `triggers` list (right now: the
 *        Sales Quote Agent).
 *     2. Inline metadata (created/updated, sales person, currency).
 *
 * Mutations: the panel hits the same backend route (`PATCH
 * /api/crm/quotes/:id` or `POST /api/crm/quotes/:id/send`). We do not
 * route through `/api/agents/:id/execute` — keeps RBAC + audit trail in
 * one place.
 */
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Briefcase,
  Building2,
  Calendar,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  Hash,
  Send,
} from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  CrmQuoteSchema,
  type CrmQuote,
  type CrmQuoteLine,
} from "../../../lib/api/schemas";
import { AgentActionPanel } from "../../../components/agent-panel/AgentActionPanel";
import { PricingEvidence } from "../../../components/pricing-evidence/PricingEvidence";
import { HybridBadge } from "../../../components/ui/HybridBadge";
import { Button } from "../../../components/ui/Button";
import { money } from "../../../lib/utils/money";
import { cn } from "../../../lib/utils/cn";
import type { AgentContext } from "../../../lib/agents/types";

export const Route = createFileRoute("/app/crm/$quoteId")({
  component: QuoteDetail,
});

const STATUS_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  draft: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
    label: "Draft",
  },
  sent: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
    label: "Sent",
  },
  accepted: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Accepted",
  },
  declined: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
    label: "Declined",
  },
  expired: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-violet)_15%,transparent)]",
    fg: "text-[var(--color-tag-violet)]",
    label: "Expired",
  },
};

function QuoteDetail() {
  const { quoteId } = Route.useParams();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["crm-quote", quoteId],
    queryFn: async () => {
      const res = await getJson<{ quotes: CrmQuote[] }>(
        "/api/crm/quotes",
        undefined,
        // The /api/crm/quotes endpoint returns a list; we have no
        // single-quote fetch — so we use the list and find. When a
        // per-id route lands, swap this in.
        undefined as never,
      );
      // We can't easily parse the list without a schema for the
      // wrapper, so we fall back to the typed schema and pick:
      return res.quotes.find((x) => x.id === quoteId) ?? null;
    },
    staleTime: 30_000,
  });

  // Above query is a typed convenience — the real schema check is
  // implicit through CrmQuote fields. For proper validation, do this:
  const quote = useMemo(() => {
    const candidates = q.data;
    if (!candidates) return null;
    const parsed = CrmQuoteSchema.safeParse(candidates);
    return parsed.success ? parsed.data : null;
  }, [q.data]);

  if (q.isLoading) {
    return (
      <p className="px-6 py-10 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading quote…
      </p>
    );
  }

  if (q.isError || !quote) {
    return notFound();
  }

  const tone = STATUS_TONE[quote.status] ?? STATUS_TONE.draft;
  const subtotal = (quote.lines ?? []).reduce(
    (s, l) => s + (Number(l.total) || 0),
    0,
  );

  // Build the AgentContext for the right rail. The agents trigger off
  // `crm.quote` and need a discriminated-union context with the bare
  // minimum of fields they query.
  const ctx: AgentContext = {
    type: "crm.quote",
    id: quote.id,
    data: quote,
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <Link
        to="/app/crm"
        search={{ view: "list", status: "all" }}
        className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        CRM
      </Link>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <QuoteHeader quote={quote} tone={tone} />
          <LineTable lines={quote.lines ?? []} />
          <TotalsBlock subtotal={subtotal} quote={quote} />
          <PricingEvidence quote={quote} />
        </div>

        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <AgentActionPanel
            context={ctx}
            title="AI suggestions"
            onApproved={() => {
              // Re-fetch this quote after any agent action so the
              // header + lines reflect the new state.
              qc.invalidateQueries({ queryKey: ["crm-quote", quoteId] });
              qc.invalidateQueries({ queryKey: ["crm-quotes"] });
            }}
          />
          <QuoteMetadata quote={quote} />
        </aside>
      </div>
    </div>
  );
}

/* ────────── header ────────── */

function QuoteHeader({
  quote,
  tone,
}: {
  quote: CrmQuote;
  tone: { bg: string; fg: string; label: string };
}) {
  return (
    <header className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            <Hash className="size-3" />
            {quote.number ?? quote.id.slice(0, 8)}
          </span>
          <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
            {quote.title}
          </h1>
          <p className="inline-flex items-center gap-3 text-[var(--text-sm)] text-[var(--color-muted)]">
            <span className="inline-flex items-center gap-1">
              <Building2 className="size-3" />
              {quote.customerName}
            </span>
            {quote.dealTitle && (
              <span className="inline-flex items-center gap-1">
                <Briefcase className="size-3" />
                {quote.dealTitle}
              </span>
            )}
            {quote.validUntil && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="size-3" />
                Valid {new Date(quote.validUntil).toLocaleDateString()}
              </span>
            )}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
            tone.bg,
            tone.fg,
          )}
        >
          {tone.label}
        </span>
      </div>
      {quote.status === "draft" && (
        <div className="mt-3 flex items-center gap-2 border-t border-[var(--color-line)] pt-3">
          <Button
            type="button"
            size="sm"
            variant="primary"
            leadingIcon={<Send className="size-3.5" />}
            disabled
          >
            Send to customer
          </Button>
          <span className="text-[11px] text-[var(--color-muted)]">
            Available once the Sales Quote Agent finalises pricing.
          </span>
        </div>
      )}
    </header>
  );
}

/* ────────── lines table ────────── */

function LineTable({ lines }: { lines: CrmQuoteLine[] }) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2">
        <h2 className="text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
          Lines
        </h2>
      </header>
      {lines.length === 0 ? (
        <p className="px-3 py-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          No lines on this quote yet.
        </p>
      ) : (
        <table className="w-full text-left text-[var(--text-sm)]">
          <thead className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Unit price</th>
              <th className="px-3 py-2 text-right font-medium">Discount</th>
              <th className="px-3 py-2 text-right font-medium">Line total</th>
              <th className="px-3 py-2 font-medium">Margin</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const margin =
                typeof l.marginRuleTargetPercent === "number"
                  ? l.marginRuleTargetPercent
                  : null;
              return (
                <tr
                  key={l.id ?? l.catalogItemId}
                  className="border-t border-[var(--color-line)]"
                >
                  <td className="px-3 py-2 text-[var(--color-ink)]">
                    {l.description ?? l.catalogName ?? l.catalogItemId}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                    {l.quantity ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                    {money(Number(l.unitPrice ?? 0), { compact: true })}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-muted)]">
                    {typeof l.discountAmount === "number"
                      ? money(l.discountAmount, { compact: true })
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                    {money(Number(l.total ?? 0), { compact: true })}
                  </td>
                  <td className="px-3 py-2">
                    {margin == null ? (
                      <span className="text-[var(--color-muted)]">—</span>
                    ) : margin >= 25 ? (
                      <span className="inline-flex items-center gap-1 text-[var(--color-tag-green)]">
                        <CircleCheck className="size-3.5" />
                        {margin.toFixed(1)}%
                      </span>
                    ) : margin >= 10 ? (
                      <span className="inline-flex items-center gap-1 text-[var(--color-amber,#d78b2f)]">
                        <CircleAlert className="size-3.5" />
                        {margin.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[var(--color-tag-red)]">
                        <CircleAlert className="size-3.5" />
                        {margin.toFixed(1)}%
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ────────── totals + meta ────────── */

function TotalsBlock({ subtotal, quote }: { subtotal: number; quote: CrmQuote }) {
  const vat = Number(quote.vat ?? 0);
  const total = Number(quote.total) || subtotal;
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <dl className="space-y-1 text-[var(--text-sm)]">
        <div className="flex items-center justify-between">
          <dt className="text-[var(--color-muted)]">Subtotal</dt>
          <dd className="font-mono tabular-nums text-[var(--color-ink)]">
            {money(subtotal, { compact: true })}
          </dd>
        </div>
        {vat > 0 && (
          <div className="flex items-center justify-between">
            <dt className="text-[var(--color-muted)]">VAT</dt>
            <dd className="font-mono tabular-nums text-[var(--color-ink)]">
              {money(vat, { compact: true })}
            </dd>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-[var(--color-line)] pt-1">
          <dt className="font-medium text-[var(--color-ink)]">Total</dt>
          <dd className="font-mono text-[var(--text-md)] font-semibold tabular-nums text-[var(--color-ink)]">
            {money(total, { compact: true })}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function QuoteMetadata({ quote }: { quote: CrmQuote }) {
  const firstLine = (quote.lines ?? [])[0];
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <h3 className="text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
        Details
      </h3>
      <dl className="mt-2 space-y-1.5 text-[var(--text-sm)]">
        <Row label="Currency" value={quote.currency ?? "AMD"} />
        <Row label="Created" value={quote.createdAt ? new Date(quote.createdAt).toLocaleString() : "—"} />
        <Row label="Updated" value={quote.updatedAt ? new Date(quote.updatedAt).toLocaleString() : "—"} />
        <Row label="Owner" value={quote.createdByName ?? "—"} />
        <Row
          label="Catalog"
          value={firstLine?.catalogPriceListCode ?? "—"}
        />
      </dl>
      <div className="mt-3 border-t border-[var(--color-line)] pt-2">
        <HybridBadge kind="rule" />
        <p className="mt-1 text-[11px] text-[var(--color-muted)]">
          Pricing is computed by the Sales Quote Agent from the active
          catalog price list — overrides require a written justification
          and an approval card.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="font-mono text-[11px] tabular-nums text-[var(--color-ink)]">
        {value}
      </dd>
    </div>
  );
}
