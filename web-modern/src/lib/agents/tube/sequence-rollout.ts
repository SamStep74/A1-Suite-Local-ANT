/**
 * Tube agent — Sequence Rollout.
 *
 * Pure function. If the deal's contact is enriched and not yet
 * enrolled in any active sequence, suggest enrolling them in
 * the first matching active sequence.
 */
import { Mail } from "lucide-react";
import type { Agent, AgentSuggestion } from "../types";

export interface SequenceRolloutContext {
  deal: { id: string; status: "open" | "won" | "lost"; contact_id: string | null };
  contact: { id: string; status: string } | null;
  sequences: Array<{ id: string; name: string; is_active: boolean }>;
  existingEnrollments: Array<{ sequence_id: string; contact_id: string }>;
}

export function evaluateSequenceRollout(ctx: SequenceRolloutContext): AgentSuggestion[] {
  if (!ctx || !ctx.deal || !ctx.contact) return [];
  if (ctx.deal.status !== "open") return [];
  if (ctx.contact.status === "new") return []; // wait for enrich first
  if (!Array.isArray(ctx.sequences) || ctx.sequences.length === 0) return [];

  const active = ctx.sequences.filter(s => s.is_active);
  if (active.length === 0) return [];
  const alreadyEnrolled = new Set(
    (ctx.existingEnrollments || [])
      .filter(e => e.contact_id === ctx.contact!.id)
      .map(e => e.sequence_id)
  );
  const candidate = active.find(s => !alreadyEnrolled.has(s.id));
  if (!candidate) return [];

  return [{
    id: `sequence-rollout-${ctx.deal.id}-${candidate.id}`,
    agentId: "tube.sequence-rollout",
    contextType: "tube.deal",
    contextId: ctx.deal.id,
    title: `Կոնտակտը պատրաստ է «${candidate.name}» հաջորդականությանը`,
    rationale: `Contact is enriched and not enrolled in any active sequence. The first matching active sequence is "${candidate.name}".`,
    sourceRecords: [ctx.contact.id, candidate.id],
    confidence: 0.7,
    previewDiff: { enrollment_status: "active", sequence_id: candidate.id },
    risk: "low",
    riskReason: "Enrollment is reversible: the contact can stop the sequence with one click, and the audit log keeps a full history.",
    proposedAction: {
      method: "POST",
      path: "/api/crm/tube/sequences/enroll",
      body: { sequenceId: candidate.id, contactIds: [ctx.contact.id] }
    }
  }];
}

export const sequenceRolloutAgent: Agent = {
  id: "tube.sequence-rollout",
  name: "Tube Sequence Rollout",
  role: "tube",
  description: "Suggests enrolling an enriched contact into a matching active sequence.",
  triggers: ["tube.deal"],
  icon: Mail,
  evaluate: evaluateSequenceRollout as unknown as Agent["evaluate"]
};
