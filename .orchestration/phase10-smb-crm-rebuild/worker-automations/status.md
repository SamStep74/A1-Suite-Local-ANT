# Status: phase10-smb-automations
- State: stalled-rescued
- Previous attempts:
  - 2026-06-13 09:34 — first launch; crashed at 10:00 at "Building 5 pure engine modules…" spinner; 0 files written, 0 commits beyond base. Auto-compact starvation suspected. Tmux session killed; status archived in this file's prior revision.
  - 2026-06-13 10:18 — second launch by cron monitor. Made partial progress before tmux session died again. 1 engine + 6 smoke tests committed at 10:31:38 (commit 897865e). Outbound engine (262 lines) was written but uncommitted.
- Worker relaunch: 2026-06-13 10:18 (Asia/Yerevan, UTC+4) by cron (phase10-automations-monitor)
- Branch: wip/phase10-smb-automations
- Base: ant/main @ e1c04d8 (foundation + records + assist merged)
- Rescued by: cron monitor (phase10-automations-monitor) at 2026-06-13 10:33 (Asia/Yerevan, UTC+4)
- Commits shipped on wip/phase10-smb-automations:
  - 897865e feat(smb-crm): automations (schema + 1 engine + 6 smoke tests)
  - e4b27a7 feat(smb-crm): outbound engine (queue + send + batch + cancel, 4 channels stub)
- Watch: /tmp/check-phase10-automations.sh — disabled (worker handed back to user)

## Final state — PARTIAL DELIVERABLE

**Delivered (committed and pushed):**
- ✓ 8 tables in `server/db.js#ensureSmbCrmAutomationSchema` (smb_crm_automations, automation_runs, outbound_messages, webhook_events, integrations, integration_credentials, integration_action_triggers, import_runs)
- ✓ Engine 1: `server/smbCrmAutomations.js` (438 lines, full CRUD + run lifecycle + view adapters)
- ✓ Engine 2: `server/smbCrmOutbound.js` (262 lines, queue/send/batch/cancel for whatsapp/sms/email/webhook, STUB provider)
- ✓ 6 smoke tests passing: `test/smb-crm/automations.smoke.test.js`

**NOT delivered (contract gaps):**
- ✗ Engine 3: `server/smbCrmWebhooks.js` (7 channels: whatsapp, meta-leads, telephony, calendar, sheets, email, payment)
- ✗ Engine 4: `server/smbCrmImport.js` (CSV → records with dedup)
- ✗ Engine 5: `server/smbCrmAccounting.js` (records → accounting CSV/JSON)
- ✗ Engine 6: `server/smbCrmIntegration.js` (listIntegrations, getIntegration, rotateSecret, healthCheck)
- ✗ ~15 routes in `server/app.js` (none of: automations CRUD, integrations CRUD/rotate/health, 7 inbound webhooks, import, accounting-export)
- ✗ Zod shapes in `web-modern/src/lib/api/schemas.ts`
- ✗ 4 of 10 contract tests (we have 6 smoke tests; spec wants 10 contract tests covering all 6 engines + cross-tenant + RBAC + idempotency)

## Verdict: NOT done. Do NOT merge.

The worker's contract for Track 4 (5 engines + 8 tables + 15 routes + 10 contract tests) is ~35% complete. Merging now would block the SPA worker (it needs the full route surface to scaffold the UI). Cron handed back to the user with full state for a manual decision.

## Recommendations for next attempt

1. **Split Track 4 into 2 sub-tasks.** Engine-layer (5 engines + schema + 10 tests) → 1 worker. Route-layer (~15 thin routes + Zod shapes) → second worker. This matches the SPA worker's needs (it can start with a route stub against any one engine and grow).
2. **Use the `--no-input` shell discipline to prevent the auto-compact starvation** that killed both worker launches. Set a `MAX_ITERATIONS=12` cap and a `MAX_TOKENS=80k` early-checkpoint to force the worker to commit-and-exit instead of looping.
3. **Or accept the partial deliverable and merge just the engines + schema.** The SPA worker can scaffold UI against `smbCrmAutomations` and `smbCrmOutbound` directly (the engines are pure and testable), then come back to wire the routes later. Less clean but ships the SPA.
