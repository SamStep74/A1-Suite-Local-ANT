# Phase 8.13 — Tube port: shared contract (the design doc every track reads)

**Audience:** the 3 parallel workers (Track A / B / C) plus the final integration
verifier. This is the contract; if you need to change it, update this file FIRST
and re-derive the affected task. Do not silently diverge.

**Date:** 2026-06-11
**Status:** Implemented in baseline; tracks extend.

## 1. Surface (already shipped)

The Tube backend lives in `server/crmTube.js` (pure engine, no DB/Fastify imports)
and is wired into `server/app.js` via 14 thin Pattern A routes under
`/api/crm/tube/*`. Migration lives in `server/db.js#ensureCrmTubeSchema` and is
called from the boot sequence. 6/6 contract tests green (`test/crmTube.test.js`).
The `crm-tube` apps slug is seeded at position 15 in `apps` and assigned to
Owner/Admin/Operator.

`server/app.js` already imports the engine as `crmTube` and uses `audit(db, ...)`
+ `randomId("idem")` + `INSERT OR IGNORE INTO idempotency_keys` for every
mutation. Schema is the 14 `tube_*` tables with the v0.5 audit-grade
`UNIQUE(sequence_id, contact_id)` on `tube_sequence_enrollments`.

## 2. Shared shapes (the Zod + agent contract)

### 2.1 Zod schemas — append to `web-modern/src/lib/api/schemas.ts`

```ts
export const TubeTubeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  is_default: z.number().int(),
  position: z.number().int(),
  stages: z.array(TubeStageSchema),
});
export const TubeStageSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number().int(),
  probability: z.number().int().min(0).max(100),
  is_won: z.number().int(),
  is_lost: z.number().int(),
  color: z.string().nullable(),
});
export const TubeDealSchema = z.object({
  id: z.string(),
  title: z.string(),
  value: z.number(),
  currency: z.string(),
  status: z.enum(["open", "won", "lost"]),
  stage_id: z.string(),
  tube_id: z.string(),
  contact_id: z.string().nullable(),
  organization_id: z.string().nullable(),
  owner_user_id: z.string().nullable(),
  contact_name: z.string().nullable(),
  contact_email: z.string().nullable(),
  organization_name: z.string().nullable(),
  stage_name: z.string().nullable(),
  stage_probability: z.number().int().nullable(),
  expected_close_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export const TubeContactSchema = z.object({
  id: z.string(),
  organization_id: z.string().nullable(),
  full_name: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  title: z.string().nullable(),
  linkedin_url: z.string().nullable(),
  lead_score: z.number().int().nullable(),
  status: z.string(),
  organization_name: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export const TubeSequenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  integration_key: z.string().nullable(),
  external_id: z.string().nullable(),
  step_count: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});
export const TubeSequenceDetailSchema = TubeSequenceSchema.extend({
  steps: z.array(z.unknown()),
});
export const TubeIntegrationSchema = z.object({
  id: z.string(),
  connector_key: z.string(),
  display_name: z.string(),
  status: z.enum(["planned", "connected", "paused", "error"]),
  environment: z.enum(["sandbox", "production", "test"]),
  auth_type: z.string(),
  last_health_status: z.string().nullable(),
  last_health_at: z.string().nullable(),
  last_health_latency: z.number().int().nullable(),
  last_sync_at: z.string().nullable(),
});
```

### 2.2 Agent types — mirror in `web-modern/src/lib/agents/types.ts`

Already defined per the ANT Phase 2 spec:

```ts
export interface AgentSuggestion {
  id: string;
  agentId: string;
  contextType: "tube.deal" | "tube.contact" | "tube.sequence" | "tube.integration";
  contextId: string;
  title: string;
  rationale: string;          // WHY
  sourceRecords: string[];     // SOURCE
  confidence: number;         // 0..1, CONFIDENCE
  previewDiff: Record<string, unknown>;  // WHAT WILL CHANGE
  risk: "low" | "medium" | "high";       // RISK
  proposedAction: AgentAction;
}
export interface AgentAction { method: "POST" | "PATCH"; path: string; body: Record<string, unknown>; }
```

### 2.3 Tube agent registry shape — new file `web-modern/src/lib/agents/tube/registry.ts`

```ts
import type { Agent } from "../types";
import { evaluate as evaluateDealHealth } from "./deal-health";
import { evaluate as evaluateEnrichOpportunity } from "./enrich-opportunity";
import { evaluate as evaluateSequenceRollout } from "./sequence-rollout";

export const tubeAgents: Agent[] = [
  {
    id: "tube.deal-health",
    name: "Deal Health",
    role: "tube",
    description: "Detects stale deals (no activity in N days) and suggests a re-engage sequence step.",
    contextTypes: ["tube.deal"],
    triggers: ["on_deal_detail_open"],
    evaluate: evaluateDealHealth,
  },
  {
    id: "tube.enrich-opportunity",
    name: "Enrich Opportunity",
    role: "tube",
    description: "Flags un-enriched contacts in open deals and proposes a bulk enrich run.",
    contextTypes: ["tube.deal", "tube.contact"],
    triggers: ["on_deal_detail_open", "on_contact_detail_open"],
    evaluate: evaluateEnrichOpportunity,
  },
  {
    id: "tube.sequence-rollout",
    name: "Sequence Rollout",
    role: "tube",
    description: "Suggests enrolling a deal's contact into a matching active sequence.",
    contextTypes: ["tube.deal"],
    triggers: ["on_deal_detail_open"],
    evaluate: evaluateSequenceRollout,
  },
];

export function findTubeAgent(agentId: string): Agent | undefined {
  return tubeAgents.find(agent => agent.id === agentId);
}
```

### 2.4 Connector registry shape — new file `server/crmTube/connectors/registry.js`

10 connectors, all deterministic stub by default. Each connector exports a
factory that returns `{ healthCheck, pull, push, receiveWebhook }` and is
loaded from `TUBE_CONNECTORS` keyed by `connector_key`. Real adapter swaps in
when `<KEY>_ENABLED=1` env flag is set. Per-connector secret hashing via
`crypto.createHash("sha256")`; per-connector payload signing via
`crypto.createHmac("sha256", secret)`. Each adapter returns the same envelope
shape:

```js
{
  ok: true,
  connector: "apollo",
  environment: "sandbox" | "production",
  mode: "stub" | "real",
  data: { ... },
  warnings: string[],
  evidence: { url, method, requestHash, responseHash, at }
}
```

## 3. Test strategy (all tracks)

- **Track A (connectors):** per-connector `test/crm-tube/connectors-<key>.test.js`
  exercises health, pull, push, webhook; proves the deterministic stub
  returns a valid envelope + that `<KEY>_ENABLED=0` keeps outbound OFF.
- **Track B (schemas + agents):** `web-modern/src/lib/api/schemas.test.ts` adds
  one accept + one reject per Tube shape; `web-modern/src/lib/agents/tube/*.test.ts`
  exercises the 3 agents (happy + edge cases: empty context, missing config,
  risky action). Coverage target ≥80% on new files.
- **Track C (SPA):** co-located `-index.test.tsx` (mocked Router + Query +
  api client) covers the page shell + view-switcher + at least 1 Decision
  Card rendering for the `crm-tube` route. Playwright smoke for the new
  route (login → /app/crm-tube → see deals board → click a deal → see
  Decision Card on the right rail) added to the existing e2e suite.

## 4. Cross-track invariants

- The 3 agents MUST NOT add new columns. They read what the engine returns.
- The 10 connectors MUST NOT add new tables. They use `tube_integrations`,
  `tube_integration_events`, `tube_field_mappings` (already shipped).
- All Armenian-first copy lives inline in JSX. No new i18n framework.
- The Decision Card Approve button calls the same Fastify route the user
  would have hit manually — the agent is a suggester, not a bypass.
- All secrets are SHA-256 hashed + fingerprinted (12-char prefix). Never
  stored cleartext. PII redacted before audit.

## 5. What is OUT of scope for Phase 8.13

- Real LLM calls in agents (V1 is pure functions; V2 swaps in Vercel AI SDK).
- Calendar view of deals (deferred).
- Webflow form-submission intake (handled by `/app/forms`, not Tube).
- Multi-tenant org resolution (already in `server/platformTenant.js`).
