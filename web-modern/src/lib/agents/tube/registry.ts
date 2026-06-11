/**
 * Tube agent registry — re-exports the 3 Tube agents as a single list
 * plus a findTubeAgent helper. Mirrors the design contract from
 * docs/phase8-tube/design.md section 2.3.
 */
import type { Agent } from "../types";
import { dealHealthAgent } from "./deal-health";
import { enrichOpportunityAgent } from "./enrich-opportunity";
import { sequenceRolloutAgent } from "./sequence-rollout";

export const tubeAgents: Agent[] = [
  dealHealthAgent,
  enrichOpportunityAgent,
  sequenceRolloutAgent
];

export function findTubeAgent(agentId: string): Agent | undefined {
  return tubeAgents.find(agent => agent.id === agentId);
}
