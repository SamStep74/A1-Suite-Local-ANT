import { describe, expect, it } from "vitest";
import { evaluateDealHealth, dealHealthAgent } from "./deal-health";

const RECENT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const STALE = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

describe("tube.deal-health", () => {
  it("returns no suggestions for a recently-active open deal", () => {
    const out = evaluateDealHealth({
      deal: { id: "d1", status: "open", contact_id: "c1", value: 5000, updated_at: RECENT },
      activities: [{ id: "a1", occurred_at: RECENT }]
    } as any);
    expect(out).toEqual([]);
  });

  it("suggests a re-engage when the last activity is older than 14 days", () => {
    const out = evaluateDealHealth({
      deal: { id: "d2", status: "open", contact_id: "c2", value: 5000, updated_at: STALE },
      activities: [{ id: "a1", occurred_at: STALE }, { id: "a2", occurred_at: STALE }]
    } as any);
    expect(out).toHaveLength(1);
    expect(out[0].agentId).toBe("tube.deal-health");
    expect(out[0].risk).toBe("low");
    expect(out[0].proposedAction.path).toBe("/api/crm/tube/sequences/enroll");
  });

  it("returns no suggestions for a won or lost deal", () => {
    expect(evaluateDealHealth({
      deal: { id: "d3", status: "won", contact_id: "c3", value: 1, updated_at: STALE },
      activities: [{ id: "a1", occurred_at: STALE }]
    } as any)).toEqual([]);
    expect(evaluateDealHealth({
      deal: { id: "d4", status: "lost", contact_id: "c4", value: 1, updated_at: STALE },
      activities: [{ id: "a1", occurred_at: STALE }]
    } as any)).toEqual([]);
  });

  it("returns no suggestions when there is no contact on the deal", () => {
    expect(evaluateDealHealth({
      deal: { id: "d5", status: "open", contact_id: null, value: 1, updated_at: STALE },
      activities: [{ id: "a1", occurred_at: STALE }]
    } as any)).toEqual([]);
  });

  it("agent descriptor wires contextTypes and triggers", () => {
    expect(dealHealthAgent.id).toBe("tube.deal-health");
    expect(dealHealthAgent.triggers).toContain("tube.deal");
  });
});
