/**
 * Agent types — the contract every Phase 2+ pre-built agent satisfies.
 *
 * Per the plan §3.2 pattern #6 (Explainable AI cards) and §5 (Salesforce
 * Agentforce hybrid), every AI recommendation in the workspace is a
 * structured `AgentSuggestion` that maps 1:1 to a `DecisionCard`.
 *
 * Phase 2 agents are **pure functions** — they take a context, look up
 * whatever data they need via the existing `api()` client, and return
 * suggestions. They NEVER mutate state. The mutation happens in the
 * `DecisionCard`'s `onApprove` callback, which calls the same Fastify
 * route a human would hit if they clicked the button manually.
 *
 * The `EvaluateFn` signature is intentionally synchronous-looking even
 * though agents may issue `await api(...)` calls under the hood — the
 * caller `await`s the whole evaluate. Phase 4 will swap the pure function
 * for a Vercel AI SDK v3 LLM call without changing the DecisionCard
 * contract; that swap happens inside `evaluate`, not at the call site.
 */

import type { LucideIcon } from "lucide-react";
import type { HybridKind } from "../../components/ui/HybridBadge";

/* ────────────── action shapes ────────────── */

/**
 * The mutation the agent wants the user to approve. It is **always** a
 * normal API call to an existing route — there is intentionally no
 * `POST /api/agents/:id/execute` endpoint. This keeps the audit trail
 * clean (the mutation lands in the same route handler a human would
 * hit) and means RBAC is enforced once, in the Fastify route, not twice.
 */
export interface AgentAction {
  method: "POST" | "PATCH" | "DELETE";
  /** Path on the existing Fastify API, e.g. `/api/crm/quotes`. */
  path: string;
  /** Request body, validated server-side via the route's Zod schema. */
  body: Record<string, unknown>;
}

/* ────────────── the suggestion ────────────── */

/**
 * One proposed action from an agent. Drives a `DecisionCard` (or
 * `AIActionPanel` row). The fields are exactly the slots on the card:
 *   - `title`            → card title
 *   - `rationale`        → "WHY" slot
 *   - `sourceRecords`    → "SOURCE" slot (data lineage)
 *   - `confidence`       → 0..1, shown as a percentage
 *   - `previewDiff`      → "WHAT WILL CHANGE" slot (optional)
 *   - `risk`             → "RISK" slot
 *   - `proposedAction`   → the `onApprove` mutation
 */
export interface AgentSuggestion {
  /** Stable id, unique within an agent run. */
  id: string;
  /** The agent that produced this suggestion. */
  agentId: string;
  /** Which domain record the suggestion is about. Drives the
   *  cache key on the right-rail AI Action Panel. */
  contextType:
    | "crm.deal"
    | "crm.quote"
    | "crm.lead"
    | "catalog.item"
    | "inventory.balance"
    | "tube.deal"
    | "tube.contact"
    | "tube.sequence"
    | "tube.integration";
  contextId: string;
  /** Card title (1 line). */
  title: string;
  /** 1-2 sentence "why". Plain language, no jargon. */
  rationale: string;
  /** What records the agent looked at. Each item is a chip in the
   *  SOURCE slot. Strings are labels; structured citations can be
   *  passed via `sourceCitations` if the agent wants kind/href. */
  sourceRecords: string[];
  /** Optional structured citations — preferred over `sourceRecords`
   *  when the agent wants to deep-link. */
  sourceCitations?: SourceCitation[];
  /** 0..1. Mapped to a percentage in the UI. */
  confidence: number;
  /** "WHAT WILL CHANGE" — key/value diff for the preview section. */
  previewDiff: Record<string, unknown>;
  /** Drives the tone of the risk row. */
  risk: "low" | "medium" | "high";
  /** Short risk description, 1 sentence. */
  riskReason: string;
  /** The mutation to run on approve. */
  proposedAction: AgentAction;
  /** Hybrid badge kind (defaults to "agent"). Rule-based agents
   *  (e.g. the future Vendor Risk Agent's "3-way match") pass "rule". */
  kind?: HybridKind;
}

export interface SourceCitation {
  label: string;
  href?: string;
  kind: "rule" | "data" | "kb" | "history" | "ai";
}

/* ────────────── context + evaluate ────────────── */

/**
 * The minimum data the agent needs to evaluate a record. Pages fetch
 * their domain data with TanStack Query, then pass it in. We don't
 * have agents issue their own `api()` calls for the *primary* record
 * (we'd race with the page) but they may fan out for *secondary*
 * data (e.g. Sales Quote Agent needs the deal lines, the catalog
 * price resolution, and the customer — primary is the deal).
 */
export type AgentContext =
  | { type: "crm.deal"; id: string; data: unknown }
  | { type: "crm.quote"; id: string; data: unknown }
  | { type: "crm.lead"; id: string; data: unknown }
  | { type: "tube.deal"; id: string; data: unknown }
  | { type: "tube.contact"; id: string; data: unknown }
  | { type: "tube.sequence"; id: string; data: unknown }
  | { type: "tube.integration"; id: string; data: unknown }
  | { type: "catalog.item"; id: string; data: unknown }
  | { type: "inventory.balance"; id: string; data: unknown };

/**
 * An agent's pure-function evaluator. Pages call `await evaluate(ctx)`
 * and render the returned suggestions in the right-rail AI Action Panel
 * or as a Decision Card.
 */
export type EvaluateFn = (ctx: AgentContext) => Promise<AgentSuggestion[]>;

/* ────────────── the registry entry ────────────── */

export interface Agent {
  /** Stable kebab-case id, e.g. `sales-quote`. */
  id: string;
  /** Human-readable name shown in the Agent Store (Phase 4). */
  name: string;
  /** One-sentence role description. */
  role: string;
  /** Longer description — 1-2 sentences for the Agent Store card. */
  description: string;
  /** Which `contextType`s this agent is wired to. */
  triggers: AgentContext["type"][];
  /** Lucide icon. Picked so the agent reads at-a-glance. */
  icon: LucideIcon;
  /** The pure-function evaluator. */
  evaluate: EvaluateFn;
}
