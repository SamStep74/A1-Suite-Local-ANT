# Worker Task: phase10-smb-automations-routes
- Session: `phase10-smb-crm-rebuild`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Base branch: `ant/ant/main` (Track 4 complete state — runs AFTER sub-task 4a merges)
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-automations` (REUSED)
- Branch: `wip/phase10-smb-automations` (REUSED — this is the final layer of the same PR)
- Tag to ship: `phase10-smb-crm-v1` (lands after this sub-task's merge)

## Why this is split

This is sub-task 4b. It runs AFTER 4a (engine-layer) merges. The orchestrator will:
1. Merge 4a's branch state into `ant/ant/main`.
2. Re-create this worktree (or pull the latest) at the post-merge commit.
3. Launch THIS worker (phase10-smb-automations-routes) to wire the routes.

If you are reading this BEFORE 4a has merged, STOP. The engines you need (Webhooks, Import, Accounting, Integration) don't exist yet. Wait for the orchestrator to relaunch you with the post-merge context.

## What's already done (sub-task 4a shipped)

After 4a lands, you can assume the following exist on `wip/phase10-smb-automations`:
- `server/smbCrmAutomations.js` ✓
- `server/smbCrmOutbound.js` ✓
- `server/smbCrmWebhooks.js` ✓ (NEW from 4a)
- `server/smbCrmImport.js` ✓ (NEW from 4a)
- `server/smbCrmAccounting.js` ✓ (NEW from 4a)
- `server/smbCrmIntegration.js` ✓ (NEW from 4a)
- 8 tables in `server/db.js#ensureSmbCrmAutomationSchema` ✓
- 12 tests in `test/smb-crm/` ✓ (all green)

You do NOT need to write engines. You do NOT need to add tables. You do NOT need to add tests for engine behavior. The engine tests are 4a's job.

## Your scope (sub-task 4b)

### Deliverable 1: ~15 thin routes in `server/app.js`

Mirror the foundation + records + assist route patterns. Every route follows: `auth → requireAppAccess → validate (Zod) → audit → idempotency (where applicable) → call <engine>.<fn>(db, orgId, ...) → respond`.

Required routes:

**Automations (5 routes):**
- `GET /api/smb-crm/automations` (filters: triggerEvent, enabled, search, page, pageSize)
- `POST /api/smb-crm/automations`
- `GET /api/smb-crm/automations/:id`
- `PATCH /api/smb-crm/automations/:id`
- `DELETE /api/smb-crm/automations/:id`
- `POST /api/smb-crm/automations/:id/run` (manual trigger; calls `smbCrmAutomations.runAutomation`)
- `GET /api/smb-crm/automations/:id/runs` (run history for one automation)

**Integrations (4 routes):**
- `GET /api/smb-crm/integrations`
- `POST /api/smb-crm/integrations` (register a new integration connection)
- `GET /api/smb-crm/integrations/:key`
- `POST /api/smb-crm/integrations/:key/secret` (rotate)
- `POST /api/smb-crm/integrations/:key/health-check`

**Inbound webhooks (7 routes — one per channel):**
- `POST /api/smb-crm/webhooks/whatsapp`
- `POST /api/smb-crm/webhooks/meta-leads`
- `POST /api/smb-crm/webhooks/telephony`
- `POST /api/smb-crm/webhooks/calendar`
- `POST /api/smb-crm/webhooks/sheets`
- `POST /api/smb-crm/webhooks/email`
- `POST /api/smb-crm/webhooks/payment`

Each inbound webhook route:
- Reads `Idempotency-Key` header (or derives from payload).
- Calls `smbCrmWebhooks.handleInboundWebhook(db, orgId, channel, payload, { idempotencyKey })`.
- Responds 200 with `{ status: 'received' | 'duplicate', id }`.
- Webhook routes do NOT require auth (they're called by upstream providers with HMAC instead — V1: trust the header for now; document the security gap in a TODO comment).

**Outbound (1 route):**
- `POST /api/smb-crm/outbound` (queue + immediately send; calls `smbCrmOutbound.queueOutbound` then `sendOutbound`)
- `GET /api/smb-crm/outbound` (list; filters: channel, status, contactId)
- `POST /api/smb-crm/outbound/:id/cancel`

**Import (1 route):**
- `POST /api/smb-crm/import` (multipart CSV upload, OR JSON body with `csv: string`; calls `smbCrmImport.importCsv`)

**Accounting export (1 route):**
- `POST /api/smb-crm/accounting-export` (body: `{ period, format }`; returns the CSV/JSON inline as `{ rows, totalRows, period, format }`)

Total: 5+5+7+3+1+1 = 22 routes. The contract said ~15; we got a few extras (list/cancel on outbound, runs on automations) because the engines naturally expose them. That's fine.

### Deliverable 2: Zod shapes in `web-modern/src/lib/api/schemas.ts`

Add (mirroring the engines' view adapters):
- `SmbCrmAutomationSchema` (request: `{ name, triggerEvent, action, actionJson?, enabled? }`)
- `SmbCrmAutomationViewSchema` (response)
- `SmbCrmAutomationRunViewSchema` (response)
- `SmbCrmOutboundMessageSchema` (request: `{ channel, body, contactId?, toAddress?, scheduledAt? }`)
- `SmbCrmOutboundViewSchema` (response)
- `SmbCrmWebhookEventSchema` (response)
- `SmbCrmIntegrationSchema` (request: `{ integrationKey, environment, authType }`)
- `SmbCrmIntegrationViewSchema` (response — `secret` NEVER appears here, only `secretFingerprint`)
- `SmbCrmSecretRotateRequestSchema` (request: `{ secret: string }`)
- `SmbCrmImportRequestSchema` (request: `{ csv: string, entityType: 'customer' }`)
- `SmbCrmImportRunViewSchema` (response)
- `SmbCrmAccountingExportRequestSchema` (request: `{ period, format }`)
- `SmbCrmAccountingExportViewSchema` (response)

### Deliverable 3: RBAC permission wiring (in `server/rbac.js` and `server/db.js#ensureRbacSchema`)

The contract already specified the permission codes in §2.6 of the master contract. Verify they're seeded (foundation worker should have done this). If not, add them and seed:
- `smb_crm.automation.read`, `.create`, `.update`, `.delete`, `.run`
- `smb_crm.integration.read`, `.manage`
- `smb_crm.webhook.read`, `.manage`

WIRE each route to `requirePermission(db, user, orgId, "<code>")`:
- Automations CRUD: read/create/update/delete per route
- Automations run: `.run`
- Integrations list/get: `.read`
- Integrations create/rotate/health: `.manage`
- Webhook inbound routes: `.manage` (the upstream provider is the caller; V1 lets any authed user with `.manage` trigger)
- Outbound: `.read` for list/get; `.manage` for queue/cancel (or scope it under a new code if you want — your call)
- Import: `.manage`
- Accounting-export: `.manage`

### Deliverable 4: 2 thin route-level contract tests in `test/smb-crm/`

You do NOT re-test engine behavior (4a did that). You only need 2 tests to confirm the route layer wires correctly:

- `test/smb-crm/routes-automations.test.js` — boots Fastify, POST `/api/smb-crm/automations` (authed), GET the list, then DELETE. Assert 201 / 200 / 204.
- `test/smb-crm/routes-webhooks.test.js` — POST to `/api/smb-crm/webhooks/whatsapp` (no auth), assert 200 + `{ status: 'received', id }`. Re-POST with the same `Idempotency-Key` header, assert 200 + `{ status: 'duplicate' }`.

Use the Fastify `app.inject()` pattern that the existing route tests in this repo already use (search `test/` for `inject(` to find the pattern). Do NOT start a real HTTP server.

## Out of scope

- Any engine logic (4a owns that)
- Any schema changes (4a owns that)
- The SPA / web-modern route pages (`/app/smb-crm/...`) — that's the SPA worker's job (Track 5). You only add Zod SHAPES, not React routes.

## Setup

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-automations`
2. `git fetch ant` and verify you're at the post-4a-merge commit on `wip/phase10-smb-automations`.
3. Read `worker-automations-engines/handoff.md` for the engine API surface (4a will have documented exact function signatures).
4. `node --test test/smb-crm/*.test.js` — confirm 4a's tests still pass.

## Workflow (TDD)

1. Add ONE route to `server/app.js`. Run the test for it. Confirm green.
2. Repeat. Commit per route group: `git commit -m "feat(smb-crm): automations routes (5)"`.
3. After all routes: add Zod shapes in one commit. Add RBAC wiring in one commit. Add the 2 route tests in one commit.

## Final steps

1. `node --test test/smb-crm/*.test.js` — all green (12 engine tests + 2 route tests = 14).
2. `npm test` — full repo suite must remain green.
3. Push: `git push -u ant wip/phase10-smb-automations`.
4. Write the handoff. Mark status.md as: `state=done, completed=<iso timestamp>, ready-to-merge`.
5. The orchestrator will then merge this branch into `ant/ant/main` and launch the SPA worker (Track 5).

## Constraints (HARD)

- **Do NOT touch** `server/smbCrm*.js` engine files (read-only). If you need an engine function added, file it in the handoff for a follow-up.
- **Do NOT push to `ant/ant/main`** — the orchestrator does the merge.
- Do not spawn subagents — do it inline.
- The 70+ existing test files MUST still pass.
- Use the heredoc + python byte-level replacement workaround for Armenian strings.
- AUTO-COMPACT DISCIPLINE: commit per route group, do not batch. Each commit = 1 exit-and-resume.

Report results in your final response.
