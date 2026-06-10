/**
 * SalesQuoteAgent — V1 pure-function evaluator.
 *
 * Trigger: a CRM deal in Proposal / Negotiation stage with no active draft
 * quote. The agent proposes a quote **draft** with one line per deal
 * line, each line priced via `GET /api/catalog/pricing/resolve` for the
 * deal's customer segment. If any line resolves to a `below_minimum`
 * margin, the agent returns TWO suggestions:
 *   1. The "create quote" suggestion (low risk, normal approval flow)
 *   2. A "below-minimum margin" flag on the deal, with a separate
 *      proposedAction that toggles the deal's `managerNote` or escalates
 *
 * The agent NEVER mutates state. It only suggests. The mutation lands
 * through the existing `DecisionCard.onApprove` → `api("POST", ...)` path.
 *
 * V2 swap (Phase 4) — replace `evaluate` body with a Vercel AI SDK v3
 * call that asks the LLM to choose the discount %, line ordering, and
 * whether to surface a margin escalation. Same return shape.
 */

import { Receipt } from "lucide-react";
import type { Agent, AgentContext, AgentSuggestion } from "./types";

/* ────────────── shape of the deal payload we expect ────────────── */

interface DealLine {
  catalogItemId?: string;
  catalogItemVariantId?: string;
  description?: string;
  quantity?: number;
  /** If the user already set a unit price on the deal, we honor it. */
  unitPrice?: number;
}

interface DealShape {
  id: string;
  customerId: string;
  customerName: string;
  title: string;
  stage: string;
  /** Customer segment used for price-list resolution. */
  customerSegment?: string;
  /** Quote-draft lines. May be empty for an early-stage deal. */
  lines?: DealLine[];
  /** Number of draft quotes already on the deal. Used to avoid
   *  re-suggesting a quote when one already exists. */
  existingQuoteCount?: number;
}

/* ────────────── pricing-resolve wire shape ────────────── */

interface PricingResolveResponse {
  pricing: {
    catalogItemId: string;
    catalogItemVariantId?: string | null;
    catalogPriceListId?: string;
    catalogPriceListCode?: string;
    customerSegment: string;
    listPrice: number;
    discountPercent?: number;
    discountAmount?: number;
    netPrice: number;
    standardCost?: number;
    marginAmount?: number;
    marginPercent?: number;
    marginStatus?: "ok" | "below_minimum";
    marginRuleCode?: string;
    minimumMarginPercent?: number;
    targetMarginPercent?: number;
    currency?: string;
  };
}

interface ApiError {
  status?: number;
  message: string;
}

type PricingResult =
  | { ok: true; pricing: PricingResolveResponse["pricing"] }
  | { ok: false; error: ApiError };

/* ────────────── the evaluator ────────────── */

async function evaluate(ctx: AgentContext): Promise<AgentSuggestion[]> {
  if (ctx.type !== "crm.deal") return [];
  const deal = ctx.data as DealShape;

  // Gate: only suggest for deals with proposal/negotiation lines
  if (deal.stage !== "Proposal" && deal.stage !== "Negotiation") return [];
  if (!deal.lines || deal.lines.length === 0) return [];
  if ((deal.existingQuoteCount ?? 0) > 0) return [];

  const customerSegment = deal.customerSegment ?? "standard";

  // Resolve every line's price
  const resolved = await Promise.all(
    deal.lines.map(async (line, idx) => {
      if (!line.catalogItemId) {
        // Free-text line — honor the deal-side price
        return {
          idx,
          line,
          pricing: null as PricingResolveResponse["pricing"] | null,
          error: null as string | null,
        };
      }
      const params = new URLSearchParams({
        catalogItemId: line.catalogItemId,
        customerSegment,
        quantity: String(line.quantity ?? 1),
      });
      if (line.catalogItemVariantId) {
        params.set("catalogItemVariantId", line.catalogItemVariantId);
      }
      const result = await window
        .fetch(`/api/catalog/pricing/resolve?${params.toString()}`, {
          credentials: "include",
        })
        .then(async (r) => {
          if (!r.ok) {
            return { ok: false, error: { status: r.status, message: await r.text() } } satisfies PricingResult;
          }
          return (await r.json()) as PricingResolveResponse;
        })
        .then(
          (body): PricingResult =>
            "pricing" in body
              ? { ok: true, pricing: body.pricing }
              : { ok: false, error: { message: "no pricing in response" } },
        )
        .catch(
          (e): PricingResult => ({ ok: false, error: { message: String(e) } }),
        );
      if (!result.ok) {
        return { idx, line, pricing: null, error: result.error.message };
      }
      return { idx, line, pricing: result.pricing, error: null };
    }),
  );

  // Build the proposed quote body — match the wire shape of POST /api/crm/quotes
  // (server/app.js:2721). Backend accepts free-text and catalog-resolved lines.
  const lines = resolved.map((r) => {
    const qty = r.line.quantity ?? 1;
    if (r.pricing) {
      return {
        catalogItemId: r.line.catalogItemId,
        catalogItemVariantId: r.line.catalogItemVariantId ?? null,
        catalogPriceListId: r.pricing.catalogPriceListId ?? null,
        catalogPriceListCode: r.pricing.catalogPriceListCode ?? null,
        pricingSource: "agent:sales-quote",
        pricingCustomerSegment: r.pricing.customerSegment,
        discountAmount: r.pricing.discountAmount ?? 0,
        description: r.line.description ?? r.pricing.catalogPriceListCode ?? "Item",
        quantity: qty,
        unitPrice: r.pricing.netPrice,
        total: Math.round(r.pricing.netPrice * qty),
      };
    }
    return {
      description: r.line.description ?? "Item",
      quantity: qty,
      unitPrice: r.line.unitPrice ?? 0,
      total: Math.round((r.line.unitPrice ?? 0) * qty),
    };
  });

  const total = lines.reduce((acc, line) => acc + (line.total ?? 0), 0);
  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const belowMin = resolved.filter(
    (r) => r.pricing?.marginStatus === "below_minimum",
  );

  const sourceRecords = [
    `Deal ${deal.id} · ${deal.customerName}`,
    `Customer segment: ${customerSegment}`,
    ...resolved
      .filter((r) => r.pricing)
      .map((r) => `Catalog: ${r.pricing!.catalogPriceListCode ?? r.line.catalogItemId}`),
  ];

  const suggestions: AgentSuggestion[] = [
    {
      id: `sales-quote:create:${deal.id}`,
      agentId: "sales-quote",
      contextType: "crm.deal",
      contextId: deal.id,
      title: `Create draft quote for ${deal.customerName}`,
      rationale:
        belowMin.length > 0
          ? `I priced ${lines.length} lines from the ${customerSegment} price list. ${belowMin.length} line(s) fell below the minimum margin and will be flagged on the quote.`
          : `I priced ${lines.length} lines from the ${customerSegment} price list. All lines are at or above the target margin.`,
      sourceRecords,
      confidence: belowMin.length === 0 ? 0.85 : 0.6,
      previewDiff: {
        status: "no quote",
        to: "draft quote",
        total: total,
        lineCount: lines.length,
        belowMinLineCount: belowMin.length,
        validUntil,
      },
      risk: belowMin.length > 0 ? "medium" : "low",
      riskReason:
        belowMin.length > 0
          ? `${belowMin.length} line(s) below the minimum margin. The quote will be visible to the customer once approved.`
          : "Standard draft quote — review the line prices before sending.",
      kind: belowMin.length > 0 ? "agent" : "rule",
      proposedAction: {
        method: "POST",
        path: "/api/crm/quotes",
        body: {
          customerId: deal.customerId,
          dealId: deal.id,
          title: deal.title,
          validUntil,
          lines,
        },
      },
    },
  ];

  return suggestions;
}

/* ────────────── the registry entry ────────────── */

export const salesQuoteAgent: Agent = {
  id: "sales-quote",
  name: "Sales Quote Agent",
  role: "Drafts quote from deal lines",
  description:
    "Reads the deal's lines, prices them through the catalog, and proposes a draft quote with margin alerts flagged.",
  triggers: ["crm.deal"],
  icon: Receipt,
  evaluate,
};
