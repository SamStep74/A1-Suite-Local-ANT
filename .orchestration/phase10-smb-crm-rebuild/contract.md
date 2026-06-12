# Phase 10 — A1-SMB-CRM-HY → ANT rebuild — shared contract

**Audience:** the 5 parallel workers (foundation, records, assist, automations, spa) plus the final verifier. This is the contract; if you need to change it, update this file FIRST and re-derive the affected task.

**Date:** 2026-06-13
**Status:** Implementing.

## 1. Goal

Rebuild the A1-SMB-CRM-HY product (56 API + 90 lib + 42 test files of vanilla-JS Node + 3300-line vanilla-JS frontend) into the A1-Suite-Local-ANT shell (Fastify + TanStack Start + React + TS + SQLite). The legacy lives at `/Users/samvelstepanyan/dev/A1-SMB-CRM-HY/`; the target is `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/`.

**Core product concept:** trilingual (HY/EN/RU) AI-onboarding SMB CRM for Armenian businesses. The onboarding questionnaire → OpenAI Responses API → structured CRM blueprint (modules, Tube stages, fields, sample records, automations, KPIs). Then the CRM workspace (customers, deals, tasks, quotes) + AI assist (next-best-action, message assist) + webhooks (WhatsApp, Meta, Telephony, Calendar, Sheets, Email, Payment) + automations runner.

**Read first:** `/Users/samvelstepanyan/dev/A1-SMB-CRM-HY/Armosphera-SMB-CRM-Claude-PLAN.md` (the ADR — Russian, but the architectural decisions are clear). Then `lib/crmGenerator.js` (the AI blueprint generator) and `lib/translate.js` (the trilingual layer).

## 2. Cross-worker invariants (must be identical in all 5)

### 2.1 Pattern A spine (the ANT 5-part contract)

Every module in the rebuild follows the same Pattern A:
- `server/<module>.js` — pure engine, no DB/Fastify imports, no `node:sqlite` imports.
- `server/db.js#ensure<Module>Schema` — schema + seed.
- `server/app.js` — thin route(s) under `/api/<module>/<verb>` that do ONLY: auth → requireAppAccess → validate (Zod) → audit → idempotency → call `<module>.<fn>(db, orgId, ...)` → respond.
- `web-modern/src/lib/api/schemas.ts` — Zod shape(s) for the request/response.
- `web-modern/src/routes/app/<module>/-index.test.tsx` + co-located tests.

### 2.2 Tenant model (preserve the existing legacy semantics)

The legacy product has a multi-tenant model:
- `lib/tenantStore.js` — resolves `?tenant=...` query param OR `Host:` subdomain → tenant record.
- `lib/recordStore.js` — per-tenant record CRUD against JSON files (legacy). V1 rebuild: replace JSON files with the existing ANT `crm-tube` style (or new `smb_crm_*` tables).
- `lib/branch.js` — for multi-branch tenants (store chains), each branch is its own data root.

For Phase 10 V1: we keep the **legacy single-DB-per-tenant-isolation** (rows have `org_id` and every query filters by it — same as the crm-tube contract). Multi-tenant DB isolation (A1-Platform's pattern) is V2.

The `crm-tube` tables in ANT already exist (14 `tube_*` tables from Phase 8.13). The SMB CRM rebuild **adds** new tables (don't conflict with crm-tube). New prefix: `smb_crm_<entity>`. Examples:
- `smb_crm_tenants` (id, slug, company_name, locale, plan, created_at, ...)
- `smb_crm_customers` (id, org_id, full_name, email, phone, tags, status, ...)
- `smb_crm_deals` (id, org_id, title, value, currency, stage_id, customer_id, ...)
- `smb_crm_tasks`, `smb_crm_quotes`, `smb_crm_activities`, `smb_crm_goals`
- `smb_crm_blueprints` (the AI-generated CRM blueprint, with the OpenRouter JSON response stored as JSONB)
- `smb_crm_integrations` (per-tenant integration connections, separate from the crm-tube `tube_integrations`)
- `smb_crm_automation_runs` (audit trail for `run-automations`)
- `smb_crm_webhook_events` (one row per inbound webhook, idempotency-keyed)
- `smb_crm_translations` (cached AI translations, key: hash(text + locale))

### 2.3 Trilingual layer (the legacy's strongest feature)

- `server/translate.js` — 3 locales: `hy` (Armenian), `en` (English), `ru` (Russian). Live translation via OpenRouter with a fallback dictionary (the legacy has one). The dictionary is a hardcoded `dict = { "hy": { ... }, "en": { ... }, "ru": { ... } }` that covers every label the legacy uses (modules, stages, fields, KPIs, status pills, empty states, error messages).
- Every user-facing string in the rebuild is **English first, Armenian second, Russian third** — display order is HY/EN/RU on Armenian locales and EN/HY/RU elsewhere. But the *keys* in the dict are English.
- The web-modern SPA uses the existing i18n setup (per Phase 10.3 Lingui v5). No new i18n framework.

### 2.4 AI provider abstraction (per the legacy's CLAUDE PLAN §3)

- `server/aiProvider.js` — interface `{ generateStructured(prompt, schema), translate(text, targetLocale) }`.
- 3 adapters: `openrouter.js` (default), `anthropic.js`, `ollama.js` (for `gemma4:e4b`).
- The OpenRouter adapter uses `OPENROUTER_MODEL` (default `openai/gpt-4o-mini`).
- The ollama adapter is `http://localhost:11434/v1/chat/completions` (the same as the existing legacy `lib/vendor/a1-ai.js`).
- The V1 contract: just the openrouter adapter. The other two are V2.

### 2.5 The blueprint schema (the AI-onboarding's deliverable)

The legacy's `crmGenerator.js` returns a JSON object with:
```json
{
  "industry": "retail",
  "companyName": "...",
  "language": "hy",
  "modules": [{ "id": "loyalty", "name": "...", "description": "...", "priority": "high" }],
  "pipeline": [{ "id": "new", "name": "...", "probability": 10, "color": "#2d6cdf" }],
  "fields": [{ "entity": "customer", "name": "...", "type": "select|text|date|number", "required": false }],
  "opportunities": [{ "title": "...", "stageId": "cart", "value": 0, "owner": "Sales Manager" }],
  "tasks": [{ "title": "...", "due": "this week", "owner": "Owner" }],
  "kpis": [{ "name": "...", "target": "...", "frequency": "weekly" }],
  "automations": [{ "trigger": "...", "action": "...", "when": "..." }],
  "leadFormFields": [{ "name": "...", "type": "...", "required": true }],
  "starterMessages": [{ "channel": "whatsapp", "language": "hy", "body": "..." }],
  "subdomain": "my-shop"
}
```

The V1 rebuild stores this as `smb_crm_blueprints.doc` (JSONB) and exposes 3 routes:
- `POST /api/smb-crm/generate-blueprint` — input: `{ questionnaire: {...} }` → calls AI provider → returns the blueprint.
- `GET /api/smb-crm/blueprints/:id` — fetch a stored blueprint.
- `POST /api/smb-crm/blueprints/:id/apply` — materialize the blueprint into actual rows (modules → smb_crm_modules, pipeline → smb_crm_pipeline_stages, etc.).

### 2.6 RBAC

The Phase 9 RBAC is now live. Every route in the rebuild uses `requirePermission(db, user, orgId, "<code>")`. The permission codes:
- `smb_crm.access` (top-level)
- `smb_crm.customer.read` / `.create` / `.update` / `.delete`
- `smb_crm.deal.read` / `.create` / `.update` / `.delete` / `.move_stage`
- `smb_crm.task.read` / `.create` / `.update` / `.delete`
- `smb_crm.quote.read` / `.create` / `.update` / `.delete`
- `smb_crm.automation.read` / `.create` / `.update` / `.delete` / `.run`
- `smb_crm.integration.read` / `.manage`
- `smb_crm.webhook.read` / `.manage`
- `smb_crm.blueprint.read` / `.generate` / `.apply`
- `smb_crm.translate.read` (this might be combined with `crm.tube.access` if you want — your call)

Add these to the seed in `server/db.js#ensureRbacSchema` as part of this rebuild. Owner has all; admin has all; accountant has `.read`; operator has `.read` + `.create` + `.update`; viewer has only `.read`.

## 3. The 5 worker tracks

### Track 1 — Foundation (worker 1)

Files to create in `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/`:
- `server/tenants.js` — pure engine: `resolveTenant`, `getTenantBySlug`, `createTenant`, `updateTenantSettings`. NO Fastify imports.
- `server/aiProvider.js` — interface + OpenRouter adapter (mirrors the legacy `lib/vendor/a1-ai.js`).
- `server/blueprintGenerator.js` — pure engine: `generateBlueprint(questionnaire, provider) → blueprint object`. Mirrors the legacy `lib/crmGenerator.js` BUT in pure form (no OpenAI import, no env reads).
- `server/translate.js` — pure engine: `translateText(text, targetLocale, dict, provider) → translated string`. Mirrors the legacy `lib/translate.js` with a smaller dict (only the strings this module needs).
- `server/db.js#ensureSmbCrmSchema` — append `smb_crm_tenants` + `smb_crm_blueprints` + `smb_crm_translations` + `smb_crm_industry_templates` (the 11 INDUSTRY_TEMPLATES from the legacy). Wire into the boot sequence.
- `server/app.js` — add 5 thin routes:
  - `POST /api/smb-crm/tenants` (create)
  - `GET /api/smb-crm/tenants/current` (resolve from header/query)
  - `POST /api/smb-crm/generate-blueprint` (the AI call)
  - `GET /api/smb-crm/blueprints/:id`
  - `POST /api/smb-crm/blueprints/:id/apply`
- `test/smb-crm/foundation.test.js` — 7 contract tests:
  1. tenant create / resolve / update
  2. aiProvider generateStructured returns valid JSON
  3. blueprintGenerator with a mock provider returns the full blueprint shape
  4. translateText falls back to dict when provider is unavailable
  5. blueprint apply materializes all entities (modules, stages, fields, opportunities, tasks)
  6. cross-tenant: blueprint from tenant A cannot be applied in tenant B
  7. audit row written for every AI call (regardless of provider used)
- `web-modern/src/lib/api/schemas.ts` — add `SmbCrmTenantSchema`, `SmbCrmBlueprintSchema` (all 11 fields per §2.5), `SmbCrmGenerateBlueprintRequestSchema`, `SmbCrmIndustryTemplateSchema`.
- `web-modern/src/lib/rbac/permissions.ts` — add the 11 new permission codes from §2.6.
- `server/db.js#ensureRbacSchema` — seed the role-permission join rows for the new codes.

### Track 2 — Records (worker 2)

Files to create:
- `server/smbCrmRecords.js` — pure engine for: `customer`, `deal`, `task`, `quote`, `activity`, `goal`. Same shape as `crmTube.js` — pure functions, no DB imports.
- `server/db.js#ensureSmbCrmRecordsSchema` — append `smb_crm_customers` + `smb_crm_deals` + `smb_crm_tasks` + `smb_crm_quotes` + `smb_crm_activities` + `smb_crm_goals` + `smb_crm_pipeline_stages` + `smb_crm_fields` + `smb_crm_modules` + `smb_crm_branches` (the 10 new tables). Wire into the boot sequence.
- `server/app.js` — add ~25 thin routes under `/api/smb-crm/<entity>`:
  - `GET/POST /api/smb-crm/customers`
  - `GET/PATCH/DELETE /api/smb-crm/customers/:id`
  - `POST /api/smb-crm/customers/merge` (the legacy `merge-customers` handler)
  - Same for deals, tasks, quotes, activities, goals.
  - `GET /api/smb-crm/branches` (for multi-branch tenants)
- `test/smb-crm/records.test.js` — 12 contract tests:
  1. customer CRUD (create, read, update, delete) + audit
  2. deal CRUD + stage move
  3. task CRUD + assignment
  4. quote CRUD + status change
  5. activity auto-logged on deal stage change
  6. goal CRUD
  7. customer merge: 2 customers → 1, with a `merge_log` row
  8. cross-tenant: customer in tenant A not visible from tenant B
  9. RBAC: viewer can read but not write
  10. idempotency: re-POST returns cached envelope
  11. branch: deal with `branch_id` only visible from that branch
  12. activity timeline aggregation
- `web-modern/src/lib/api/schemas.ts` — add `SmbCrmCustomerSchema`, `SmbCrmDealSchema`, `SmbCrmTaskSchema`, `SmbCrmQuoteSchema`, `SmbCrmActivitySchema`, `SmbCrmGoalSchema`, `SmbCrmPipelineStageSchema`, `SmbCrmModuleSchema`, `SmbCrmFieldSchema`, `SmbCrmBranchSchema`.

### Track 3 — AI assist (worker 3)

Files to create:
- `server/smbCrmAssist.js` — pure engine: `salesAssist` (next-best-action per deal), `messageAssist` (draft a message to a contact), `customerSummary` (LLM-generated summary of a customer's full history), `feedback` (capture user feedback on an AI suggestion). Mirrors the legacy `lib/salesAssistant.js` + `lib/messageAssistant.js` + `lib/customerSummary.js` + `lib/feedbackHandlers.js`.
- `server/db.js#ensureSmbCrmAssistSchema` — append `smb_crm_assist_runs` (audit log for every AI assist call) + `smb_crm_feedback` (the user thumbs-up/down on suggestions).
- `server/app.js` — add 5 routes:
  - `POST /api/smb-crm/sales-assist` (input: `{ dealId, customerId }` → next-best-action JSON)
  - `POST /api/smb-crm/message-assist` (input: `{ customerId, channel, intent }` → drafted message)
  - `POST /api/smb-crm/customer-summary` (input: `{ customerId }` → summary text)
  - `POST /api/smb-crm/feedback` (input: `{ runId, rating, comment? }`)
  - `GET /api/smb-crm/assist-runs` (audit log)
- `test/smb-crm/assist.test.js` — 8 contract tests:
  1. salesAssist with mock provider returns valid JSON shape
  2. messageAssist with mock provider returns a draft
  3. customerSummary with mock provider returns a summary
  4. feedback write + read
  5. RBAC: smb_crm.feedback requires `smb_crm.access` (no separate permission)
  6. cross-tenant
  7. every assist call writes to assist_runs (audit)
  8. idempotency: re-POST returns cached envelope
- `web-modern/src/lib/api/schemas.ts` — add `SmbCrmSalesAssistRequestSchema`, `SmbCrmMessageAssistRequestSchema`, `SmbCrmCustomerSummaryRequestSchema`, `SmbCrmFeedbackSchema`, `SmbCrmAssistRunSchema`.

### Track 4 — Automations + webhooks (worker 4)

Files to create:
- `server/smbCrmAutomations.js` — pure engine: `runAutomations` (find all automations matching a trigger event, execute them, return the run log). Mirrors the legacy `lib/automationRunner.js`.
- `server/smbCrmOutbound.js` — pure engine: `runOutbound` (queue + execute outbound messages: WhatsApp, SMS, email, webhook). Mirrors the legacy `lib/outboundRunner.js`.
- `server/smbCrmWebhooks.js` — pure engine: `handleInboundWebhook(channel, payload)` (normalize + persist + queue). Mirrors the legacy `lib/*webhookHandlers.js` (7 channels: WhatsApp, Meta leads, Telephony, Calendar, Sheets, Email, Payment).
- `server/smbCrmImport.js` — pure engine: `importMapper` (CSV → records with dedup). Mirrors the legacy `lib/importMapper.js`.
- `server/smbCrmAccounting.js` — pure engine: `exportAccounting` (records → accounting CSV). Mirrors the legacy `lib/accountingExport.js`.
- `server/smbCrmIntegration.js` — pure engine: `listIntegrations`, `getIntegration`, `rotateSecret` (mirrors the crm-tube connector surface but for the SMB-CRM integration catalog, NOT the crm-tube one). Plus `integrationCredentials` (the secret store, hashed).
- `server/db.js#ensureSmbCrmAutomationSchema` — append `smb_crm_automations` + `smb_crm_automation_runs` + `smb_crm_outbound_messages` + `smb_crm_webhook_events` + `smb_crm_integrations` + `smb_crm_integration_credentials` + `smb_crm_integration_action_triggers` + `smb_crm_import_runs`.
- `server/app.js` — add ~15 routes:
  - `GET/POST /api/smb-crm/automations`
  - `GET/PATCH/DELETE /api/smb-crm/automations/:id`
  - `POST /api/smb-crm/automations/:id/run`
  - `GET/POST /api/smb-crm/integrations`
  - `POST /api/smb-crm/integrations/:key/secret`
  - `POST /api/smb-crm/integrations/:key/health-check` (mirrors the crm-tube route)
  - 7 inbound webhook routes (one per channel)
  - `POST /api/smb-crm/import` (CSV upload → records)
  - `POST /api/smb-crm/accounting-export`
- `test/smb-crm/automations.test.js` — 10 contract tests:
  1. automation CRUD + audit
  2. runAutomation: trigger event → matching automations execute
  3. outbound queue + execute
  4. webhook inbound: 7 channels each round-trip
  5. integration health-check (stub mode returns deterministic envelope)
  6. secret rotation hashes the new secret + redacts in audit
  7. CSV import: 5 rows → 5 records, 2 dupes → 1 record
  8. accounting export: records → CSV with correct columns
  9. cross-tenant
  10. RBAC
- `web-modern/src/lib/api/schemas.ts` — add the corresponding Zod shapes.

### Track 5 — SPA + portal + chat widget (worker 5)

Files to create:
- `web-modern/src/routes/app/smb-crm/index.tsx` — the AI-onboarding questionnaire (the entry point). 7-step form in HY/EN/RU, with the LiveLanguageSwitcher from Phase 10.3.
- `web-modern/src/routes/app/smb-crm/blueprint/$blueprintId.tsx` — the blueprint viewer (modules, stages, fields, opportunities, tasks).
- `web-modern/src/routes/app/smb-crm/customers/index.tsx` — customer list with search, status pills, branch filter.
- `web-modern/src/routes/app/smb-crm/customers/$customerId.tsx` — customer detail with deals + tasks + activities + customer summary.
- `web-modern/src/routes/app/smb-crm/deals/index.tsx` — kanban deals board (mirrors `/app/crm-tube`).
- `web-modern/src/routes/app/smb-crm/automations/index.tsx` — automation list with run log.
- `web-modern/src/routes/app/smb-crm/integrations/index.tsx` — integration health view.
- `web-modern/src/components/chat-widget/ChatWidget.tsx` — the chat widget (the legacy `chat-widget.js`).
- `web-modern/src/components/portal-access/PortalAccess.tsx` — the customer portal access view.
- `web-modern/src/routes/app/smb-crm/-index.test.tsx` + 1 test per child page (co-located).
- `web-modern/src/lib/apps.ts` — add `smb-crm` to APP_IDS.
- `web/src/suite-routes.js` — add `smb-crm` to SUITE_APP_IDS.
- `web/src/main.jsx` — add `suite-app-smb-crm` anchor.

## 4. Out of scope for Phase 10 V1

- A1-Platform-style per-tenant DB isolation. V2.
- Real-time websocket (chat widget uses polling in V1). V2.
- Mobile push notifications. V2.
- PDF export of quotes. V2 (the legacy's `documentRenderHandlers.js`).
- Telephony provider integration beyond the webhook handler. V2.
- Native Ollama adapter (V1 uses the OpenRouter adapter; Ollama is V2).
- Cross-tenant analytics. V2.

## 5. Branch + merge + verifier flow

- 5 workers, 5 branches: `wip/phase10-smb-foundation`, `wip/phase10-smb-records`, `wip/phase10-smb-assist`, `wip/phase10-smb-automations`, `wip/phase10-smb-spa`.
- All branched off current `ant/ant/main` at session start.
- Merge order: foundation → records → assist → automations → spa (foundation must land first because the other 4 reference its tables/permission codes).
- Tag to ship: `phase10-smb-crm-v1` after the 5th merge.
- Verifier session: audits each branch against this contract. 7+12+8+10+~5 ≈ 42 contract tests across the 5 branches.
