import { describe, expect, it } from "vitest";
import { evaluateSequenceRollout, sequenceRolloutAgent } from "./sequence-rollout";

describe("tube.sequence-rollout", () => {
  const SEQUENCES = [
    { id: "seq-1", name: "Welcome Flow", is_active: true },
    { id: "seq-2", name: "Re-engage", is_active: false },
    { id: "seq-3", name: "Holiday Push", is_active: true }
  ];

  it("suggests the first active sequence when the contact is enriched and unenrolled", () => {
    const out = evaluateSequenceRollout({
      deal: { id: "d1", status: "open", contact_id: "c1" },
      contact: { id: "c1", status: "enriched" },
      sequences: SEQUENCES,
      existingEnrollments: []
    } as any);
    expect(out).toHaveLength(1);
    expect(out[0].proposedAction.body.sequenceId).toBe("seq-1");
  });

  it("skips sequences the contact is already enrolled in", () => {
    const out = evaluateSequenceRollout({
      deal: { id: "d1", status: "open", contact_id: "c1" },
      contact: { id: "c1", status: "enriched" },
      sequences: SEQUENCES,
      existingEnrollments: [{ sequence_id: "seq-1", contact_id: "c1" }]
    } as any);
    expect(out).toHaveLength(1);
    expect(out[0].proposedAction.body.sequenceId).toBe("seq-3");
  });

  it("returns no suggestion if no active sequence exists", () => {
    expect(evaluateSequenceRollout({
      deal: { id: "d1", status: "open", contact_id: "c1" },
      contact: { id: "c1", status: "enriched" },
      sequences: [{ id: "x", name: "Paused", is_active: false }],
      existingEnrollments: []
    } as any)).toEqual([]);
  });

  it("returns no suggestion if the contact is still `new` (wait for enrich)", () => {
    expect(evaluateSequenceRollout({
      deal: { id: "d1", status: "open", contact_id: "c1" },
      contact: { id: "c1", status: "new" },
      sequences: SEQUENCES,
      existingEnrollments: []
    } as any)).toEqual([]);
  });

  it("returns no suggestion when the deal is closed", () => {
    expect(evaluateSequenceRollout({
      deal: { id: "d1", status: "won", contact_id: "c1" },
      contact: { id: "c1", status: "enriched" },
      sequences: SEQUENCES,
      existingEnrollments: []
    } as any)).toEqual([]);
  });

  it("agent descriptor wires contextTypes and triggers", () => {
    expect(sequenceRolloutAgent.triggers).toContain("tube.deal");
  });
});
