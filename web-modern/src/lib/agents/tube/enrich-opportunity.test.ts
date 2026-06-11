import { describe, expect, it } from "vitest";
import { evaluateEnrichOpportunity, enrichOpportunityAgent } from "./enrich-opportunity";

describe("tube.enrich-opportunity", () => {
  it("suggests enrich on a new contact with a high-value open deal", () => {
    const out = evaluateEnrichOpportunity({
      deal: { id: "d1", status: "open", contact_id: "c1", value: 250000 },
      contact: { id: "c1", status: "new", lead_score: null }
    } as any);
    expect(out).toHaveLength(1);
    expect(out[0].proposedAction.path).toBe("/api/crm/tube/contacts/enrich");
  });

  it("returns no suggestion when deal value is below the threshold", () => {
    expect(evaluateEnrichOpportunity({
      deal: { id: "d2", status: "open", contact_id: "c2", value: 1000 },
      contact: { id: "c2", status: "new", lead_score: null }
    } as any)).toEqual([]);
  });

  it("returns no suggestion when contact is already enriched/contacted", () => {
    expect(evaluateEnrichOpportunity({
      deal: { id: "d3", status: "open", contact_id: "c3", value: 250000 },
      contact: { id: "c3", status: "enriched", lead_score: 80 }
    } as any)).toEqual([]);
  });

  it("returns no suggestion when deal is closed", () => {
    expect(evaluateEnrichOpportunity({
      deal: { id: "d4", status: "won", contact_id: "c4", value: 250000 },
      contact: { id: "c4", status: "new", lead_score: null }
    } as any)).toEqual([]);
  });

  it("agent descriptor wires both contextTypes and triggers", () => {
    expect(enrichOpportunityAgent.triggers).toEqual(expect.arrayContaining(["tube.deal", "tube.contact"]));
  });
});
