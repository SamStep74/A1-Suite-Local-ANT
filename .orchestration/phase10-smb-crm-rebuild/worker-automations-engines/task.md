# Worker Task: phase10-smb-automations-engines
- Session: `phase10-smb-crm-rebuild`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Base branch: `ant/ant/main` (Track 4 partial state)
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-automations` (REUSED — same as the prior Track 4 attempt)
- Branch: `wip/phase10-smb-automations` (REUSED — same branch; sub-tasks layer onto the same PR)
- Tag to ship: `phase10-smb-crm-v1` (final tag lands after sub-task 4b merges)

## Why this is split

The original Track 4 attempt (single worker) auto-compact-starved twice and only landed 2 of 5 engines (Automations, Outbound). To break the death loop, Track 4 is now split:

- **Sub-task 4a (this file): ENGINE LAYER** — finish the 3 missing engines + 4 missing contract tests. Pure Pattern A, no routes, no HTTP, no app.js edits. This is the layer the SPA worker needs to be unblocked from the API surface.
- **Sub-task 4b (separate worker, see `worker-automations-routes/task.md`): ROUTE LAYER** — wire ~15 thin routes in `server/app.js` + Zod shapes. After 4a lands.

## What's already done (don't redo)

`server/smbCrmAutomations.js` and `server/smbCrmOutbound.js` already exist on `wip/phase10-smb-automations` (commits 897865e and e4b27a7). They are tested and pushed. **DO NOT MODIFY THEM.** If you find a bug, file it in the handoff and we'll patch in a follow-up commit.

The 8 tables in `server/db.js#ensureSmbCrmAutomationSchema` are all present and boot-time wired. **DO NOT modify the schema.**

The 6 smoke tests in `test/smb-crm/automations.smoke.test.js` are passing. **DO NOT delete or rewrite them.**

## Your scope (sub-task 4a)

### Deliverable 1: 3 missing pure engines in `server/`

1. **`server/smbCrmWebhooks.js`** — `handleInboundWebhook(db, orgId, channel, payload, opts)` — 7 channels: `whatsapp`, `meta-leads`, `telephony`, `calendar`, `sheets`, `email`, `payment`. Normalize payload per channel → write a row to `smb_crm_webhook_events` (idempotency-keyed; unique on `(org_id, channel, idempotency_key)`) → return `{ id, status: 'received' | 'duplicate' }`. The handler itself is pure: NO outbound network, NO side-effects on the rest of the system. Real side-effects (parsing Meta payloads, posting back to the provider) are wired by the route layer in sub-task 4b.
   - Public surface: `handleInboundWebhook`, `listWebhookEvents`, `getWebhookEvent`, `toWebhookEventView`. Cross-tenant safety: every read+write takes `orgId`.
   - Each channel has a small normalize function: `normalizeWhatsapp(payload)`, `normalizeMetaLeads(payload)`, etc. They map the upstream's payload shape → a flat envelope `{ channel, idempotencyKey, contactId?, body?, eventType, rawJson }`.

2. **`server/smbCrmImport.js`** — `importCsv(db, orgId, csv, entityType, opts)` — CSV → records with dedup. Mirrors the legacy `lib/importMapper.js`. Entity types: `customer`, `deal`, `task`, `contact`. For V1, only `customer` is fully wired (deals/tasks/contacts are TODO comments in the engine body). Dedup key: `email` (for customer) — case-insensitive trim. Returns `{ importRunId, totalRows, importedRows, dedupedRows, errors }`. The function writes a row to `smb_crm_import_runs` with the totals + `errors_json`.
   - Public surface: `importCsv`, `listImportRuns`, `getImportRun`, `toImportRunView`. Cross-tenant safety: every read+write takes `orgId`.

3. **`server/smbCrmAccounting.js`** — `exportAccounting(db, orgId, period, opts)` — records → CSV (default) or JSON. `period` is one of: `this_month`, `last_month`, `this_quarter`, `ytd`, `custom`. For V1, the export pulls customers + deals + activities for the period and produces a flat CSV with the columns: `date, type, customer, deal, amount, currency, status, notes`. Returns `{ rows: string (CSV), totalRows, period, format }`. No side effects.
   - Public surface: `exportAccounting`, `toAccountingExportView`. Cross-tenant safety: every read takes `orgId`.

4. **`server/smbCrmIntegration.js`** — `listIntegrations(db, orgId, filters)`, `getIntegration(db, orgId, key)`, `rotateSecret(db, orgId, key, opts)`, `healthCheck(db, orgId, key)`. Mirrors the crm-tube connector surface but for the SMB-CRM integration catalog (NOT the crm-tube one). The catalog V1: `meta-whatsapp`, `meta-leads`, `telephony-sinch`, `calendar-google`, `sheets-google`, `email-smtp`, `payment-idram`. Secret rotation: hash the new secret (sha256) + redact the plain text in the audit log. Health-check in stub mode returns a deterministic envelope `{ ok: true, integrationKey, checkedAt }`.
   - Public surface: `listIntegrations`, `getIntegration`, `rotateSecret`, `healthCheck`, `toIntegrationView`. Cross-tenant safety: every read+write takes `orgId`.

### Deliverable 2: 4 missing contract tests in `test/smb-crm/`

- `test/smb-crm/webhooks.test.js` — 2 tests: (a) `handleInboundWebhook` writes a row + returns the row id, (b) re-submitting with the same `(org_id, channel, idempotency_key)` returns `{ status: 'duplicate' }` and does NOT write a second row.
- `test/smb-crm/import-csv.test.js` — 1 test: feed a 5-row CSV with 2 dupes (same email) → assert `importedRows=3, dedupedRows=2`, and a row exists in `smb_crm_import_runs`.
- `test/smb-crm/accounting-export.test.js` — 1 test: seed 3 customers + 2 deals in `this_month` → export → assert the CSV has the right header + the right row count.
- `test/smb-crm/integrations.test.js` — 1 test: rotate secret for `meta-whatsapp` → assert the new credential row's `secret_hash` is sha256, and the audit log does NOT contain the plain secret.

That's 5 new tests across 4 files (the 2 webhook tests are bundled). The 6 automations smoke tests + these 5 = 11 tests total, which exceeds the contract's 10-test minimum.

### Deliverable 3: View adapters for each engine

Each engine must export `to<Engine>View(raw)` that returns a camelCase object. This is the same Pattern A discipline the existing engines follow. The route layer in sub-task 4b will rely on these.

## Out of scope (sub-task 4b will handle)

- Any edits to `server/app.js`
- Zod shapes in `web-modern/src/lib/api/schemas.ts`
- The 7 inbound webhook HTTP routes (`POST /api/smb-crm/webhooks/{whatsapp,meta-leads,...}`)
- The integrations CRUD routes (`GET/POST /api/smb-crm/integrations`, `POST /api/smb-crm/integrations/:key/secret`, `POST /api/smb-crm/integrations/:key/health-check`)
- The automations CRUD routes
- The import route (`POST /api/smb-crm/import`)
- The accounting-export route (`POST /api/smb-crm/accounting-export`)

If you find yourself wanting to add a route, stop. That's 4b's job. Just expose the engine function; the route layer wires it.

## Setup

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-automations`
2. `git fetch ant` and verify you're on `wip/phase10-smb-automations` at the latest rescue commit (`5951a5c` or newer). If a new commit landed, read it.
3. `npm --prefix web-modern install --legacy-peer-deps` (only if `web-modern/node_modules` is missing — check first).
4. `node --test test/smb-crm/automations.smoke.test.js` to confirm the existing 6 tests still pass.

## Workflow (TDD)

1. Write the test file FIRST for each engine. Run it; confirm it fails for the right reason (function missing / table not queried yet).
2. Implement the engine to make the test pass. NO FASTIFY IMPORTS. NO `node:sqlite` IMPORTS. NO `process.env` reads.
3. Run the new test. Confirm it passes.
4. Run the full suite: `node --test test/smb-crm/*.test.js`. Confirm all green.
5. Commit per engine: `git add -A && git commit -m "feat(smb-crm): <engine> engine"`.

## Final steps

1. `node --test test/smb-crm/*.test.js` — all green. Expected: 6 automations + 1 outbound = 7 smoke + 2 webhooks + 1 import + 1 accounting + 1 integration = 12 tests total. (We had 6 smoke + 1 outbound = 7, plus 5 new = 12.)
2. `npm test` — full repo suite must remain green.
3. `git log --oneline -5` to confirm clean commit history.
4. Push: `git push -u ant wip/phase10-smb-automations`.
5. Write the handoff. Mark status.md as: `state=done, completed=<iso timestamp>, awaiting-merge-for-routes-subtask`.

## Constraints (HARD)

- **Do NOT touch** `server/smbCrmAutomations.js`, `server/smbCrmOutbound.js`, `server/crmTube*`, `server/tenants.js`, `server/blueprintGenerator.js`, `server/smbCrmRecords.js`, `server/smbCrmAssist.js`, `server/rbac.js`, `server/app.js`, `web-modern/`.
- **Do NOT push to `ant/ant/main`**.
- Do not spawn subagents — do it inline.
- The 70+ existing test files MUST still pass.
- Use the heredoc + python byte-level replacement workaround for Armenian strings.
- AUTO-COMPACT DISCIPLINE: if you sense the context getting long, commit NOW and exit. Do not loop on refactors. Each engine = 1 commit = 1 exit-and-resume. The prior worker died twice because it tried to land all 5 engines in one session.

## Token discipline (anti-starvation)

The prior worker auto-compact-starved at ~80k tokens of in-flight context. To prevent that:

- Commit after EVERY engine. Do not batch.
- Keep each engine under 250 lines. If it grows past 300, you are over-engineering — refactor or split, then commit.
- Do not read files you don't need. The contract above is the source of truth.
- Exit the tmux session after pushing. The cron will relaunch you if there's more to do.

Report results in your final response.
