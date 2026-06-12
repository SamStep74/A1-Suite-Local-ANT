# Worker Task: phase10-smb-assist
- Session: `phase10-smb-crm-rebuild`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Base branch: `ant/ant/main` (after foundation + records merged)
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-assist`
- Branch: `wip/phase10-smb-assist`
- Tag to ship: `phase10-smb-crm-v1`

## Contract

`/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase10-smb-crm-rebuild/contract.md` — your Track 3 deliverables in §3 Track 3.

**Dependencies:** foundation + records workers ship first. Your base is `ant/ant/main` after both are merged.

## Setup

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-assist`
2. `git fetch ant` to make sure you're at current `ant/ant/main`.
3. `npm --prefix web-modern install --legacy-peer-deps`
4. `npm --prefix web-modern test` to confirm baseline.

## Scope — THREE deliverables

### Deliverable 1: `server/smbCrmAssist.js` — pure engine

```js
// Pattern: same as server/crmTube.js. NO Fastify / no node:sqlite imports.

class AssistProviderError extends Error { ... }

// Sales assist (next-best-action):
function buildSalesAssistPrompt(deal, customer, recentActivities)
function parseSalesAssistResponse(rawJson)  // → { suggestedAction, reasoning, confidence, sourceRecords, riskLevel }
function salesAssist(db, orgId, dealId, customerId, provider)  // → AssistResult

// Message assist (drafted message to a contact):
function buildMessageAssistPrompt(customer, channel, intent, history)
function parseMessageAssistResponse(rawJson)  // → { body, channel, language, followups? }
function messageAssist(db, orgId, customerId, channel, intent, provider)

// Customer summary (LLM-generated summary of a customer's full history):
function buildCustomerSummaryPrompt(customer, deals, activities, notes)
function customerSummary(db, orgId, customerId, provider)  // → { summaryText, keyInsights, lastContactAt }

// Feedback (user thumbs-up/down on an AI suggestion):
function recordFeedback(db, orgId, runId, userId, rating, comment?)  // → void
function listFeedback(db, orgId, runId)  // → AssistFeedback[]
```

Wire `ensureSmbCrmAssistSchema(db)` into the boot sequence. Migration: 2 new tables (`smb_crm_assist_runs` for audit, `smb_crm_feedback` for thumbs).

### Deliverable 2: Server routes (5 thin routes in `server/app.js`)

- `POST /api/smb-crm/sales-assist` — input: `{ dealId, customerId }` → returns AssistResult
- `POST /api/smb-crm/message-assist` — input: `{ customerId, channel, intent }` → returns drafted message
- `POST /api/smb-crm/customer-summary` — input: `{ customerId }` → returns summary
- `POST /api/smb-crm/feedback` — input: `{ runId, rating, comment? }` → void
- `GET /api/smb-crm/assist-runs` — list (audit log)

### Deliverable 3: Zod shapes in `web-modern/src/lib/api/schemas.ts`

Append:
- `SmbCrmSalesAssistRequestSchema`, `SmbCrmSalesAssistResultSchema`
- `SmbCrmMessageAssistRequestSchema`, `SmbCrmMessageAssistResultSchema`
- `SmbCrmCustomerSummaryRequestSchema`, `SmbCrmCustomerSummaryResultSchema`
- `SmbCrmFeedbackSchema`, `SmbCrmAssistRunSchema`

## Tests — 8 contract tests (`test/smb-crm/assist.test.js`)

1. salesAssist with `inMemoryAiProvider` returns valid JSON shape (AssistResult)
2. messageAssist with mock provider returns a draft
3. customerSummary with mock provider returns a summary
4. feedback write + read (round-trip)
5. RBAC: `smb_crm.feedback` requires `smb_crm.access` (no separate permission)
6. cross-tenant: assist call for a deal in tenant A not visible from tenant B
7. every assist call writes to assist_runs (assert count is non-zero after 6 calls)
8. idempotency: re-POST returns cached envelope

## Workflow

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-assist`
2. Read the contract. Read the foundation + records handoffs.
3. Build the pure engine.
4. Add 2 tables to `server/db.js#ensureSmbCrmAssistSchema`. Wire into boot.
5. Add 5 routes to `server/app.js`.
6. Add Zod shapes.
7. Run `npm test` to confirm 8 tests pass.
8. Commit: `git add -A && git commit -m "feat(smb-crm): assist (sales-assist, message-assist, customer-summary, feedback)"`.

## Final steps

1. `npm test` — 8 new tests pass; full suite green.
2. `npm --prefix web-modern test` — green.
3. Push: `git push -u ant wip/phase10-smb-assist`.
4. Write the handoff.
5. Mark status.md as: `state=done, completed=<iso timestamp>`.

## Constraints (HARD)

- **Do NOT touch** `server/crmTube*`, `server/tenants.js`, `server/rbac.js`, `web-modern/src/routes/app/crm-tube/*`, `web-modern/src/routes/app/smb-crm/blueprint/*`, `web-modern/src/routes/app/smb-crm/customers/*`, `web-modern/src/routes/app/smb-crm/deals/*`.
- **Do NOT push to `ant/ant/main`**.
- Do not spawn subagents — do it inline.
- The 70+ existing test files MUST still pass.
- Use the heredoc + python byte-level replacement workaround for Armenian strings.
- Report results in your final response.
