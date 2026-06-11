/**
 * Tube agent — Deal Health.
 *
 * Pure function. No LLM. Detects stale deals (no activity in N days)
 * and suggests a re-engage via the existing enroll endpoint. Mapped
 * 1:1 to a DecisionCard via the standard AgentSuggestion shape.
 */
import { Activity } from "lucide-react";
import type { Agent, AgentSuggestion } from "../types";

export interface DealHealthInput {
  deal: { id: string; status: "open" | "won" | "lost"; contact_id: string | null; value: number; updated_at: string };
  activities: Array<{ id: string; occurred_at: string }>;
  /** Days since the last activity that still counts as "fresh". */
  freshWindowDays?: number;
}

const DEFAULT_FRESH_WINDOW = 14;

export function evaluateDealHealth(ctx: DealHealthInput): AgentSuggestion[] {
  if (!ctx || !ctx.deal) return [];
  if (ctx.deal.status !== "open") return [];
  if (!Array.isArray(ctx.activities) || ctx.activities.length === 0) return [];
  if (!ctx.deal.contact_id) return [];

  const last = ctx.activities
    .map(a => new Date(a.occurred_at).getTime())
    .reduce((max, t) => (t > max ? t : max), 0);
  if (!last) return [];
  const ageDays = (Date.now() - last) / (1000 * 60 * 60 * 24);
  const window = ctx.freshWindowDays ?? DEFAULT_FRESH_WINDOW;
  if (ageDays < window) return [];

  return [{
    id: `deal-health-${ctx.deal.id}-${last}`,
    agentId: "tube.deal-health",
    contextType: "tube.deal",
    contextId: ctx.deal.id,
    title: "Deal went silent — time to reach out",
    rationale: `Last activity ${Math.round(ageDays)} days ago on a still-open deal. A short re-engage email tends to revive conversations.`,
    sourceRecords: ctx.activities.slice(0, 3).map(a => a.id),
    confidence: 0.7,
    previewDiff: { next_action: "enroll_in_re_engage_sequence" },
    risk: "low",
    riskReason: "A short re-engage email is low risk; the contact can unsubscribe in one click.",
    proposedAction: {
      method: "POST",
      path: "/api/crm/tube/sequences/enroll",
      body: {
        sequenceId: "<suggested>",
        contactIds: [ctx.deal.contact_id]
      }
    }
  }];
}

export const dealHealthAgent: Agent = {
  id: "tube.deal-health",
  name: "Tube Deal Health",
  role: "tube",
  description: "Detects stale deals and suggests a re-engage sequence step.",
  triggers: ["tube.deal"],
  icon: Activity,
  evaluate: evaluateDealHealth as unknown as Agent["evaluate"]
};
