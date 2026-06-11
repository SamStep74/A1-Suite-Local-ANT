/**
 * Tube agent — Enrich Opportunity.
 *
 * Pure function. Flags un-enriched contacts in open deals and
 * proposes a bulk enrich run via /api/crm/tube/contacts/enrich.
 */
import { Sparkles } from "lucide-react";
import type { Agent, AgentSuggestion } from "../types";

export interface EnrichOpportunityInput {
  deal: { id: string; status: "open" | "won" | "lost"; contact_id: string | null; value: number };
  contact: { id: string; status: string; lead_score: number | null } | null;
  /** AMD threshold above which a deal is worth enriching. */
  enrichValueThreshold?: number;
}

const DEFAULT_ENRICH_VALUE_THRESHOLD = 100000; // AMD

export function evaluateEnrichOpportunity(ctx: EnrichOpportunityInput): AgentSuggestion[] {
  if (!ctx || !ctx.deal || !ctx.contact) return [];
  if (ctx.deal.status !== "open") return [];
  if (ctx.contact.status !== "new") return [];
  if (ctx.deal.value < (ctx.enrichValueThreshold ?? DEFAULT_ENRICH_VALUE_THRESHOLD)) return [];

  return [{
    id: `enrich-opportunity-${ctx.deal.id}-${ctx.contact.id}`,
    agentId: "tube.enrich-opportunity",
    contextType: "tube.deal",
    contextId: ctx.deal.id,
    title: "Contact is new and the deal is high-value — enrich first",
    rationale: `This contact has no enrichment yet and sits on an open deal worth ${ctx.deal.value.toLocaleString()} AMD. Apollo / Surfe / Pixxi can pull firmographic + intent in one click.`,
    sourceRecords: [ctx.contact.id],
    confidence: 0.75,
    previewDiff: { contact_status: "enriched" },
    risk: "low",
    riskReason: "Enrichment is read-only data from a public data provider; no outreach happens until you act on the result.",
    proposedAction: {
      method: "POST",
      path: "/api/crm/tube/contacts/enrich",
      body: { contactIds: [ctx.contact.id] }
    }
  }];
}

export const enrichOpportunityAgent: Agent = {
  id: "tube.enrich-opportunity",
  name: "Tube Enrich Opportunity",
  role: "tube",
  description: "Flags un-enriched contacts in open deals and proposes a bulk enrich run.",
  triggers: ["tube.deal", "tube.contact"],
  icon: Sparkles,
  evaluate: evaluateEnrichOpportunity as unknown as Agent["evaluate"]
};
