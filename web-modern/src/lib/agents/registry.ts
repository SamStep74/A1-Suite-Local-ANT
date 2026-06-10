/**
 * Agent registry — the single source of truth for installed agents.
 *
 * Pages look up agents by either:
 *   - `id` (e.g. `inventory-risk` for the Mission Control widget)
 *   - `triggers` (e.g. an `/app/inventory/$itemId` page passes
 *     `triggerType: "catalog.item"` and gets back the catalog item
 *     agents)
 *
 * Phase 4 will replace this static array with a TanStack Query that
 * hits `GET /api/agents/installed` so users can install / uninstall
 * agents from the Agent Store without a code deploy.
 */

import type { Agent, AgentContext } from "./types";
import { salesQuoteAgent } from "./sales-quote";
import { inventoryRiskAgent } from "./inventory-risk";

/** All installed agents. Order is the order shown in the UI. */
export const AGENTS: readonly Agent[] = [
  salesQuoteAgent,
  inventoryRiskAgent,
] as const;

/** Look up an agent by id. Returns undefined if not installed. */
export function getAgent(id: string): Agent | undefined {
  return AGENTS.find((a) => a.id === id);
}

/** Return all agents wired to a given context type. */
export function getAgentsForTrigger(
  triggerType: AgentContext["type"],
): Agent[] {
  return AGENTS.filter((a) => a.triggers.includes(triggerType));
}
