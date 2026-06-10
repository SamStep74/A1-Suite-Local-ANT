/**
 * SalesQuoteAgent — V1 tests.
 *
 * The agent is a pure function over the (deal, catalog-pricing)
 * domain. We stub `window.fetch` to drive the pricing resolver; the
 * agent should always emit at least one `createQuote` suggestion for
 * Proposal/Negotiation deals that have lines and no existing draft.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { salesQuoteAgent } from "./sales-quote";
import type { AgentContext } from "./types";

const BASE_DEAL = {
  id: "deal-1",
  customerId: "cust-1",
  customerName: "Ani Beauty",
  title: "Q3 expansion",
  customerSegment: "retail",
  stage: "Proposal",
  existingQuoteCount: 0,
  lines: [
    {
      catalogItemId: "ci-1",
      catalogItemVariantId: null,
      description: "Treatment chair",
      quantity: 2,
    },
    {
      catalogItemId: "ci-2",
      description: "Aesthetic laser",
      quantity: 1,
    },
  ],
};

function ctx(deal: unknown): AgentContext {
  return { type: "crm.deal", id: "deal-1", data: deal };
}

function mockFetch(
  body: unknown,
  init: { status?: number } = {},
): ReturnType<typeof vi.fn> {
  const f = vi.fn().mockResolvedValue({
    ok: init.status === undefined || (init.status >= 200 && init.status < 300),
    status: init.status ?? 200,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  });
  globalThis.fetch = f as unknown as typeof fetch;
  return f;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SalesQuoteAgent.evaluate", () => {
  it("returns no suggestions for a Discovery deal", async () => {
    mockFetch({ pricing: { netPrice: 100, marginStatus: "ok" } });
    const out = await salesQuoteAgent.evaluate(
      ctx({ ...BASE_DEAL, stage: "Discovery" }),
    );
    expect(out).toEqual([]);
  });

  it("returns no suggestions when the deal has no lines", async () => {
    mockFetch({ pricing: { netPrice: 100, marginStatus: "ok" } });
    const out = await salesQuoteAgent.evaluate(
      ctx({ ...BASE_DEAL, lines: [] }),
    );
    expect(out).toEqual([]);
  });

  it("returns no suggestions when a draft quote already exists", async () => {
    mockFetch({ pricing: { netPrice: 100, marginStatus: "ok" } });
    const out = await salesQuoteAgent.evaluate(
      ctx({ ...BASE_DEAL, existingQuoteCount: 1 }),
    );
    expect(out).toEqual([]);
  });

  it("emits a single create-quote suggestion with all lines priced", async () => {
    mockFetch({
      pricing: {
        catalogItemId: "ci-x",
        netPrice: 500000,
        customerSegment: "retail",
        listPrice: 600000,
        discountAmount: 100000,
        marginStatus: "ok",
        marginRuleCode: "STD-20",
        catalogPriceListId: "pl-1",
        catalogPriceListCode: "RETAIL-2026",
        marginPercent: 30,
        minimumMarginPercent: 20,
        targetMarginPercent: 25,
      },
    });
    const out = await salesQuoteAgent.evaluate(ctx(BASE_DEAL));
    expect(out).toHaveLength(1);
    const s = out[0]!;
    expect(s.agentId).toBe("sales-quote");
    expect(s.contextType).toBe("crm.deal");
    expect(s.contextId).toBe("deal-1");
    expect(s.kind).toBe("rule"); // no below_minimum → "rule" (deterministic)
    expect(s.risk).toBe("low");
    expect(s.proposedAction.method).toBe("POST");
    expect(s.proposedAction.path).toBe("/api/crm/quotes");
    const body = s.proposedAction.body as Record<string, unknown> & {
      lines: Array<Record<string, unknown>>;
    };
    expect(body.customerId).toBe("cust-1");
    expect(body.dealId).toBe("deal-1");
    expect(body.title).toBe("Q3 expansion");
    expect(typeof body.validUntil).toBe("string");
    expect(body.lines).toHaveLength(2);
    // First line: catalog-resolved
    expect(body.lines[0]).toMatchObject({
      catalogItemId: "ci-1",
      catalogPriceListCode: "RETAIL-2026",
      pricingSource: "agent:sales-quote",
      pricingCustomerSegment: "retail",
      quantity: 2,
      unitPrice: 500000,
      total: 1000000,
    });
    // Second line: catalog-resolved (same resolver stub)
    expect(body.lines[1]).toMatchObject({
      catalogItemId: "ci-2",
      quantity: 1,
      unitPrice: 500000,
      total: 500000,
    });
  });

  it("flags below_minimum lines and escalates the suggestion risk", async () => {
    mockFetch({
      pricing: {
        netPrice: 100,
        customerSegment: "retail",
        marginStatus: "below_minimum",
        marginRuleCode: "STD-20",
        catalogPriceListCode: "RETAIL-2026",
      },
    });
    const out = await salesQuoteAgent.evaluate(ctx(BASE_DEAL));
    expect(out).toHaveLength(1);
    const s = out[0]!;
    expect(s.risk).toBe("medium");
    expect(s.kind).toBe("agent");
    expect(s.rationale).toMatch(/below the minimum margin/i);
    const diff = s.previewDiff as Record<string, unknown>;
    expect(diff.belowMinLineCount).toBe(2);
  });

  it("falls back to free-text line when the catalog resolver 404s", async () => {
    mockFetch({ message: "not found" }, { status: 404 });
    const out = await salesQuoteAgent.evaluate(ctx(BASE_DEAL));
    expect(out).toHaveLength(1);
    const body = out[0]!.proposedAction.body as { lines: Array<{ catalogItemId?: string; description: string; unitPrice: number; total: number }> };
    // Both lines fall back; first has no catalogItemId
    expect(body.lines[0]).not.toHaveProperty("catalogItemId");
    expect(body.lines[0]!.description).toBe("Treatment chair");
    expect(body.lines[0]!.unitPrice).toBe(0);
    expect(body.lines[0]!.total).toBe(0);
  });
});
