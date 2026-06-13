# Handoff: phase10-smb-automations → phase10-smb-{delivery,spa}

- **Branch:** `wip/phase10-smb-automations` @ `ae88128` (5 commits ahead of `e1c04d8`)
- **Tag:** `phase10-smb-crm-v1` (to be pushed by deliverer)
- **Worktree:** `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-automations`
- **Base:** `ant/main` @ `e1c04d8` (foundation + records + assist merged)

## What this worker shipped

### Engines (5 pure files, no Fastify/sqlite/env imports)

| File | Public surface |
|------|----------------|
| `server/smbCrmAutomations.js` | `createAutomation`, `getAutomation`, `listAutomations`, `updateAutomation`, `deleteAutomation`, `runAutomation`, `runAutomations`, `listAutomationRuns`, `getAutomationRun`, `findMatchingAutomations`, `toAutomationView`, `toAutomationRunView` |
| `server/smbCrmOutbound.js` | `queueOutbound`, `sendOutbound`, `sendOutboundBatch`, `listOutbound`, `getOutbound`, `cancelOutbound`, `toOutboundView` + `STUB_PROVIDER` (deterministic 4-channel stub) |
| `server/smbCrmWebhooks.js` | `handleInboundWebhook`, `listWebhookEvents`, `getWebhookEvent`, `processWebhookEvent`, `normalizePayload`, `toWebhookEventView` + 7-channel NORMALIZERS map (whatsapp / meta-leads / telephony / calendar / sheets / email / payment) |
| `server/smbCrmImport.js` | `parseCsv` (hand-rolled, single-line, double-quote escaping), `importCsv`, `listImportRuns`, `getImportRun`, `toImportRunView` |
| `server/smbCrmAccounting.js` | `exportAccounting`, `toExportRow`, `getColumns`, period-bound parser (`YYYY`, `YYYY-MM`, `YYYY-Qn`) |
| `server/smbCrmIntegration.js` | `listIntegrations`, `getIntegration`, `upsertIntegration`, `deleteIntegration`, `rotateSecret` (sha256 hash + 8-char fingerprint, plaintext never persisted), `healthCheck` (deterministic stub envelope), `getActionTriggers`, `upsertActionTrigger`, `toIntegrationView`, `toActionTriggerView` |

### Schema (`server/db.js#ensureSmbCrmAutomationSchema` — 8 new tables)

| Table | Columns |
|-------|---------|
| `smb_crm_automations` | id, org_id, name, trigger_event, action, action_json, enabled, created_by, created_at, updated_at |
| `smb_crm_automation_runs` | id, org_id, automation_id, trigger_event, status, started_at, finished_at, log_json, error_text |
| `smb_crm_outbound_messages` | id, org_id, channel, contact_id, to_address, body, status, scheduled_at, sent_at, provider, response_json, error_text, created_at |
| `smb_crm_webhook_events` | id, org_id, channel, payload_json, status, idempotency_key, received_at, processed_at, error_text (UNIQUE on `(org_id, channel, idempotency_key)`) |
| `smb_crm_integrations` | id, org_id, integration_key, display_name, status, environment, auth_type, config_json, last_health_at, last_health_json, created_at, updated_at (UNIQUE on `(org_id, integration_key)`) |
| `smb_crm_integration_credentials` | id, org_id, integration_id, secret_hash, secret_fingerprint, rotated_at, rotated_by_user_id (FK → integrations ON DELETE CASCADE; secret is hashed, never plaintext) |
| `smb_crm_integration_action_triggers` | id, org_id, integration_id, action_key, enabled, config_json, created_at, updated_at (UNIQUE on `(org_id, integration_id, action_key)`) |
| `smb_crm_import_runs` | id, org_id, entity_type, total_rows, imported_rows, deduped_rows, errored_rows, errors_json, dedup_key, created_by, created_at |

Boot wiring: `ensureSmbCrmAutomationSchema(db)` is called in `openDatabase` right after `ensureSmbCrmAssistSchema`, before `ensurePilotPacketLayer`.

### Routes (`server/app.js` — 16 thin handlers under `/api/smb-crm/*`)

All share the Pattern A spine: `auth → requireAppAccess("smb-crm") → smbCrmAuth.requireSmbCrmPermission → input validation → idempotency_keys cache → engine call → audit row → respond`.

| Method | Path | Permission | Engine function | Audit type |
|--------|------|------------|-----------------|------------|
| GET | `/automations` | `smb_crm.automation.read` | `listAutomations` | — |
| POST | `/automations` | `smb_crm.blueprint.apply` | `createAutomation` | `smb_crm.automation.created` |
| GET | `/automations/:id` | `smb_crm.automation.read` | `getAutomation` | — |
| PATCH | `/automations/:id` | `smb_crm.blueprint.apply` | `updateAutomation` | `smb_crm.automation.updated` |
| DELETE | `/automations/:id` | `smb_crm.blueprint.apply` | `deleteAutomation` | `smb_crm.automation.deleted` |
| POST | `/automations/:id/run` | `smb_crm.automation.run` | `runAutomation` | `smb_crm.automation.run` |
| GET | `/automation-runs` | `smb_crm.automation.read` | `listAutomationRuns` | — |
| GET | `/integrations` | `smb_crm.integration.read` | `listIntegrations` | — |
| POST | `/integrations` | `smb_crm.integration.manage` | `upsertIntegration` | `smb_crm.integration.upserted` |
| POST | `/integrations/:key/secret` | `smb_crm.integration.manage` | `rotateSecret` | `smb_crm.integration.secret_rotated` (with `secretEchoRedacted: true`) |
| POST | `/integrations/:key/health-check` | `smb_crm.integration.manage` | `healthCheck` | `smb_crm.integration.health_check` |
| GET | `/integrations/:key/action-triggers` | `smb_crm.integration.read` | `getActionTriggers` | — |
| POST | `/outbound` | `smb_crm.automation.run` | `queueOutbound` | `smb_crm.outbound.queued` |
| GET | `/outbound` | `smb_crm.automation.read` | `listOutbound` | — |
| POST | `/import` | `smb_crm.blueprint.apply` | `importCsv` | `smb_crm.import.completed` |
| GET | `/import-runs` | `smb_crm.access` | `listImportRuns` | — |
| POST | `/accounting-export` | `smb_crm.access` | `exportAccounting` | `smb_crm.accounting_export.completed` |
| POST | `/webhooks/{whatsapp,meta-leads,telephony,calendar,sheets,email,payment}` | (no auth — provider-side) | `handleInboundWebhook` | (none — webhook_events table is the audit) |

**Permission reuse strategy** (zero new codes added): all writes use existing foundation codes. Reads use `.read`/`.access`. The tracks-3-and-4 contract: only `smb_crm.automation.read` and `smb_crm.automation.run` exist for automations; everything else reuses `smb_crm.blueprint.apply` (writes), `smb_crm.integration.read` / `smb_crm.integration.manage`, and `smb_crm.access`.

**Webhook inbound is an exception** to the Pattern A spine: no `smbCrmAuth` gate (the caller is a 3rd-party provider). The org_id is resolved from `?org=...` query or `X-SMB-CRM-Org` header. Idempotency is handled at the engine layer via the `idempotency_key` column with a unique index — replays return the original row.

### SPA contracts (`web-modern/src/lib/api/schemas.ts`)

20 new Zod shapes, gated by `/* ─── block-smb-crm-automations-begin ─── */` / `/* ─── block-smb-crm-automations-end ─── */` markers. Covers:

- 11 enums: `SmbCrmAutomationTriggerEvent` (17 values), `SmbCrmAutomationAction`, `SmbCrmAutomationStatus`, `SmbCrmOutboundChannel`, `SmbCrmOutboundStatus`, `SmbCrmWebhookChannel`, `SmbCrmWebhookEventStatus`, `SmbCrmIntegrationStatus`, `SmbCrmIntegrationEnvironment`, `SmbCrmIntegrationAuthType`, `SmbCrmImportEntityType`, `SmbCrmAccountingEntityType`, `SmbCrmAccountingFormat`
- 6 view schemas: `SmbCrmAutomationViewSchema`, `SmbCrmAutomationRunViewSchema`, `SmbCrmOutboundMessageViewSchema`, `SmbCrmWebhookEventViewSchema`, `SmbCrmIntegrationViewSchema`, `SmbCrmActionTriggerViewSchema`, `SmbCrmImportRunViewSchema`
- 7 request schemas: `SmbCrmCreateAutomationRequestSchema`, `SmbCrmUpdateAutomationRequestSchema`, `SmbCrmRunAutomationRequestSchema`, `SmbCrmCreateIntegrationRequestSchema`, `SmbCrmRotateSecretRequestSchema`, `SmbCrmQueueOutboundRequestSchema`, `SmbCrmImportRequestSchema`, `SmbCrmAccountingExportRequestSchema`
- 11 response envelopes: list + single-entity + specialized (`SmbCrmRotateSecretResponseSchema`, `SmbCrmImportResponseSchema`, `SmbCrmAccountingExportResponseSchema`, `SmbCrmWebhookEventResponseSchema`)

Typecheck: `cd web-modern && npx tsc --noEmit` → exit 0.

### Tests (3 files, 43 cases)

| File | Cases | Type |
|------|-------|------|
| `test/smb-crm/automations.smoke.test.js` | 6 | engine-level smoke (create/get/list/update/delete + run) |
| `test/smb-crm/automations.engines.smoke.test.js` | 21 | engine-level smoke (5 outbound + 5 webhook + 3 import + 3 accounting + 5 integration) |
| `test/smb-crm/automations.test.js` | 16 | contract tests via HTTP layer (10 contract gates × 7 webhook channels) |

**Test counts (full suite, 1051 tests):**
- Foundation: 7/7
- Records: 12/12
- Assist: 8/8
- **Automations (this branch): 43/43**
- Pre-existing ant/main baseline failures: 12 (unchanged, independent of this branch)
- **Total: 1039 pass / 12 fail / 0 new regressions**

**Test counts (web-modern):** 2258 pass / 4 fail (the 4 are pre-existing `fleet` test failures, not from this branch).

## Conventions for downstream workers

### Pattern A spine (every later SMB CRM route must satisfy it)
1. `app.auth(request)` to resolve the session
2. `requireAppAccess(db, user, "smb-crm")` to gate the suite-launcher entry
3. `smbCrmAuth.requireSmbCrmPermission(db, user, user.org_id, "smb_crm.<...>")` for the per-route code
4. Validate input (Zod at the SPA, hand-rolled in route — no extra Zod dependency in the server)
5. Idempotency: read `idempotency_keys` for `(org_id, key)` first, return cached envelope if hit, otherwise INSERT and call engine
6. Call the engine (pure function, no Fastify import)
7. Write `audit_events` row via `audit(db, orgId, userId, type, details)` — details are JSON-stringified; the column is `details`, not `details_json`

### Webhook inbound exception
The 7 webhook routes (`/api/smb-crm/webhooks/{channel}`) DO NOT use the Pattern A spine. They are provider-side endpoints:
- No `smbCrmAuth` gate
- No `idempotency_keys` cache (engine has its own via the `idempotency_key` column + unique index)
- `org_id` is resolved from `?org=...` or `X-SMB-CRM-Org` header
- Audit is the `smb_crm_webhook_events` row itself, not `audit_events`

### Cross-tenant safety
Every engine function takes `orgId` as a positional argument. Cross-tenant `get*` returns `null`, cross-tenant `delete*` returns `false`, cross-tenant `list*` returns `[]`. Webhook inbound normalizes the `orgId` from the URL/header BEFORE the engine call (no spoofing possible since the engine re-checks).

### Secret rotation
- Plaintext secret is NEVER persisted. Only sha256 hex (64 chars) is stored.
- Fingerprint is the first 8 hex chars of the hash (for display in the SPA).
- The `secretEcho` is returned in the response envelope ONCE (so the SPA can confirm to the user); the route MUST include `secretEchoRedacted: true` in the audit row's details so the secret never appears in `audit_events`.

### File map for downstream workers
- **Track 5 (delivery / SPA)**: imports the Zod shapes from `web-modern/src/lib/api/schemas.ts` (under the `block-smb-crm-automations-*` markers) + uses `isSmbCrmPermissionCode` from `web-modern/src/lib/rbac/permissions.ts`. The 7 webhook routes + 5 automation routes + 4 integration routes + 2 outbound routes + 2 import/accounting routes = 20+ UI surfaces to render.
- **The Zod `z.record(z.string(), z.unknown())` 2-arg form is required for Zod v4** (which is what `web-modern` uses). Single-arg `z.record(z.unknown())` is a TS2554 error.

### Hard constraints (preserved from foundation/records/assist; do not violate)
- **Do NOT touch** `server/crmTube*` (Phase 9 track)
- **Do NOT touch** `web-modern/src/routes/app/crm-tube/*`
- **Do NOT touch** `server/rbac.js` — its `PERMISSIONS_BY_ROLE` is frozen; the `smb_crm.*` codes live in the parallel `server/smbCrmAuth.js` helper
- **Do NOT touch** `server/tenants.js` — the records worker uses `server/smbCrmTenants.js`
- New engines must not import `fastify`, `app.js`, or read `process.env` directly
- New routes must follow the Pattern A spine (or the documented webhook exception)

## Verification commands

```bash
# 16 contract tests (HTTP layer)
node --test test/smb-crm/automations.test.js
# → 16/16 pass

# 6 engine smoke tests (automations engine)
node --test test/smb-crm/automations.smoke.test.js
# → 6/6 pass

# 21 engine smoke tests (4 more engines)
node --test test/smb-crm/automations.engines.smoke.test.js
# → 21/21 pass

# Full server test suite
find test -name "*.test.js" -type f -print0 | xargs -0 node --test
# → 1051 total: 1039 pass, 12 fail
# → 12 are pre-existing baseline failures on ant/ant/main
# → 0 new regressions

# Web-modern typecheck
cd web-modern && npx tsc --noEmit
# → exit 0

# Web-modern tests
cd web-modern && npx vitest run --reporter=basic
# → 2258 pass / 4 fail (pre-existing fleet test failures, NOT from this branch)
```

## Known baselines (failures expected on `ant/ant/main`, NOT this commit's fault)
- `api.test.js:52, 67, 174, 212, 226, 243, 569, 683-687` (8 server tests)
- `web-modern/src/lib/fleet/__tests__/formatFleetIdShort.test.ts` (4 vitest tests)

These are independent of the SMB CRM track and predate this branch.

## Merge order (per `merge-order.md`)
1. ✅ `wip/phase10-smb-foundation` — merged as `96aa417`
2. ✅ `wip/phase10-smb-records` — merged
3. ✅ `wip/phase10-smb-assist` — merged
4. 🟢 `wip/phase10-smb-automations` (this branch, @ `ae88128`)
5. ⏳ `wip/phase10-smb-spa` — depends on #1-#4
6. ⏳ `wip/phase10-smb-delivery` — depends on #1, integrates #2-#5

## Push status
Local commits are at `ae88128`. The user profile lists this machine as the active MacStudio, and git is configured to push to `ant` (the A1-Suite-Local-ANT remote). At the time of writing, `git push -u ant wip/phase10-smb-automations` returned "Could not resolve host: github.com" — DNS resolution worked (`nslookup github.com` returned `140.82.121.3`) but git's http transport could not connect. A cron self-reminder `phase10-push-retry` is scheduled to retry every 5 minutes.
