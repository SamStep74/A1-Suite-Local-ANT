# Worker Task: phase10-smb-automations
- Session: `phase10-smb-crm-rebuild`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Base branch: `ant/ant/main` (after foundation + records + assist merged)
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-automations`
- Branch: `wip/phase10-smb-automations`
- Tag to ship: `phase10-smb-crm-v1`

## Contract

`/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase10-smb-crm-rebuild/contract.md` — your Track 4 deliverables in §3 Track 4.

## Setup

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-automations`
2. `git fetch ant` to make sure you're at current `ant/ant/main`.
3. `npm --prefix web-modern install --legacy-peer-deps`
4. `npm --prefix web-modern test` to confirm baseline.

## Scope — SIX deliverables

### Deliverable 1: 5 pure engines in `server/`

- `server/smbCrmAutomations.js` — `runAutomations(db, orgId, triggerEvent, context)` — find matching automations, execute, return run log.
- `server/smbCrmOutbound.js` — `runOutbound(db, orgId, channel, contact, body)` — queue + execute (whatsapp, sms, email, webhook). Uses the same stub/real pattern as the crm-tube connectors.
- `server/smbCrmWebhooks.js` — `handleInboundWebhook(channel, payload)` — 7 channels: whatsapp, meta-leads, telephony, calendar, sheets, email, payment. Normalize + persist + queue.
- `server/smbCrmImport.js` — `importCsv(db, orgId, csv, entityType, dedupKey)` — CSV → records with dedup. Mirrors the legacy `lib/importMapper.js`.
- `server/smbCrmAccounting.js` — `exportAccounting(db, orgId, period, format)` — records → CSV/JSON with correct columns.
- `server/smbCrmIntegration.js` — `listIntegrations`, `getIntegration`, `rotateSecret`, `healthCheck` — mirrors the crm-tube connector surface but for the SMB-CRM integration catalog (NOT the crm-tube one).

### Deliverable 2: Server routes (~15 thin routes in `server/app.js`)

- `GET/POST /api/smb-crm/automations`
- `GET/PATCH/DELETE /api/smb-crm/automations/:id`
- `POST /api/smb-crm/automations/:id/run`
- `GET/POST /api/smb-crm/integrations`
- `POST /api/smb-crm/integrations/:key/secret` (rotate)
- `POST /api/smb-crm/integrations/:key/health-check` (mirrors the crm-tube route shape)
- 7 inbound webhook routes: `POST /api/smb-crm/webhooks/{whatsapp,meta-leads,telephony,calendar,sheets,email,payment}`
- `POST /api/smb-crm/import` (CSV upload)
- `POST /api/smb-crm/accounting-export`

### Deliverable 3: Zod shapes in `web-modern/src/lib/api/schemas.ts`

- `SmbCrmAutomationSchema`, `SmbCrmAutomationRunSchema`
- `SmbCrmOutboundMessageSchema`
- `SmbCrmWebhookEventSchema`
- `SmbCrmIntegrationSchema`
- `SmbCrmImportRequestSchema`, `SmbCrmAccountingExportRequestSchema`
- Plus request/response shapes for each

### Deliverable 4: 8 new tables in `server/db.js#ensureSmbCrmAutomationSchema`

- `smb_crm_automations` (id, org_id, name, trigger_event, action, enabled, created_at, ...)
- `smb_crm_automation_runs` (id, org_id, automation_id, trigger_event, status, started_at, finished_at, log_json)
- `smb_crm_outbound_messages` (id, org_id, channel, contact_id, body, status, scheduled_at, sent_at)
- `smb_crm_webhook_events` (id, org_id, channel, payload_json, status, idempotency_key, created_at, processed_at)
- `smb_crm_integrations` (id, org_id, integration_key, status, environment, auth_type, ...)
- `smb_crm_integration_credentials` (id, org_id, integration_id, secret_hash, secret_fingerprint, rotated_at, rotated_by_user_id)
- `smb_crm_integration_action_triggers` (id, org_id, integration_id, action_key, enabled, config_json)
- `smb_crm_import_runs` (id, org_id, entity_type, total_rows, imported_rows, deduped_rows, errors_json, created_at)

## Tests — 10 contract tests (`test/smb-crm/automations.test.js`)

1. automation CRUD + audit
2. runAutomation: trigger event → matching automations execute (asserts `automation_runs` rows)
3. outbound queue + execute (stub mode: deterministic envelope, no real network)
4. webhook inbound: all 7 channels each round-trip
5. integration health-check (stub mode returns deterministic envelope)
6. secret rotation: hashes the new secret (sha256) + redacts in audit
7. CSV import: 5 rows → 5 records, 2 dupes (same email) → 1 record
8. accounting export: records → CSV with correct columns
9. cross-tenant: webhook in tenant A not visible from tenant B
10. RBAC: viewer can `integration.read` but not `integration.manage`

## Workflow

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-automations`
2. Read the contract. Read the foundation + records + assist handoffs.
3. Build the 5 pure engines.
4. Add 8 tables to `server/db.js#ensureSmbCrmAutomationSchema`. Wire into boot.
5. Add ~15 routes to `server/app.js`.
6. Add Zod shapes.
7. Run `npm test` to confirm 10 tests pass.
8. Commit: `git add -A && git commit -m "feat(smb-crm): automations (5 engines + 8 tables + 15 routes)"`.

## Final steps

1. `npm test` — 10 new tests pass; full suite green.
2. `npm --prefix web-modern test` — green.
3. Push: `git push -u ant wip/phase10-smb-automations`.
4. Write the handoff.
5. Mark status.md as: `state=done, completed=<iso timestamp>`.

## Constraints (HARD)

- **Do NOT touch** `server/crmTube*`, `server/tenants.js`, `server/blueprintGenerator.js`, `server/smbCrmRecords.js`, `server/smbCrmAssist.js`, `server/rbac.js`.
- **Do NOT push to `ant/ant/main`**.
- Do not spawn subagents — do it inline.
- The 70+ existing test files MUST still pass.
- Use the heredoc + python byte-level replacement workaround for Armenian strings.
- Report results in your final response.
