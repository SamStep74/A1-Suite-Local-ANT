# Handoff: phase10-smb-foundation → phase10-smb-{records,assist,automations,delivery,spa}

**Branch:** `wip/phase10-smb-foundation` @ `7ed0360`
**Tag:** `phase10-smb-crm-v1` (pushed)
**Worktree:** `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-foundation`

## What this worker shipped

### Engines (5 pure files, no Fastify/sqlite imports)
| File | Public surface |
|------|----------------|
| `server/smbCrmTenants.js` | `createTenant`, `updateTenant`, `listTenants`, `getTenantBySlug`, `getTenantByHost`, `toTenantView` |
| `server/smbCrmBlueprintGenerator.js` | `INDUSTRY_TEMPLATES` (11 keys: retail, horeca, clinic, realEstate, services, tourism, logistics, construction, education, auto, beauty), `generateBlueprint`, `saveBlueprint`, `getBlueprint`, `applyBlueprint` |
| `server/smbCrmAiProvider.js` | `createDefaultProvider()` → `{generateStructured, translate}`, OpenRouter adapter at `https://openrouter.ai/api/v1/chat/completions`, `inMemoryAiProvider` stub (returns synthetic blueprint + warnings envelope) |
| `server/smbCrmTranslate.js` | `translate(db, locale, key, fallbackText)`, `seedDict(db, rows)`, dict-first HY/EN/RU with AI fallback, `smb_crm_translations` cache table |
| `server/smbCrmAuth.js` | `requireSmbCrmPermission(db, user, orgId, permission)`, `effectiveSmbCrmPermissions(db, userId, orgId)` |

### Schema (server/db.js)
- `ensureSmbCrmFoundationSchema(db)`:
  - 10 tables: `smb_crm_tenants`, `smb_crm_branches`, `smb_crm_industry_templates`, `smb_crm_blueprints`, `smb_crm_blueprint_applied`, `smb_crm_translations`, `smb_crm_modules`, `smb_crm_pipeline_stages`, `smb_crm_fields`, `smb_crm_oportunidades`, `smb_crm_tasks` (the last 6 are apply-time materializations)
  - Registers the `smb-crm` app in the `apps` table (route `/app/smb-crm`, maturity `new`, priority 14)
  - Seeds 11 INDUSTRY_TEMPLATES (HY/EN/RU labels)
  - Seeds 11 `smb_crm.*` permission codes into `rbac_permissions`
  - Projects `SMB_CRM_PERMISSIONS_BY_ROLE` (per-role arrays) into `rbac_role_permissions`
- `ensureSmbCrmAppAssignments(db)`:
  - Adds `app_assignments` rows for Owner + Admin in every org (operator/support/accountant intentionally excluded)
  - Mirrors legacy `users.role` (Admin/Accountant/Operator/Support/Viewer) into `rbac_user_roles`. **Owner is intentionally NOT mirrored** — the pre-existing `rbac.effectivePermissionsFor` short-circuit depends on the seeded Owner user having no rbac_user_roles row. The `smbCrmAuth` helper detects Owner via both paths (rbac_user_roles + `users.role = 'Owner'`).

### Routes (server/app.js — 8 thin handlers)
All under `/api/smb-crm/*` and all gated by:
`auth → requireAppAccess("smb-crm") → smbCrmAuth.requireSmbCrmPermission → input validation → idempotency_keys cache → call engine → audit row`

| Method | Path | Permission | Engine function |
|--------|------|------------|-----------------|
| POST | `/tenants` | `smb_crm.access` | `smbCrmTenants.createTenant` |
| GET | `/tenants` | `smb_crm.access` | `smbCrmTenants.listTenants` |
| GET | `/tenants/current` | `smb_crm.access` | `smbCrmTenants.getTenantBySlug` / `getTenantByHost` |
| PATCH | `/tenants/:id` | `smb_crm.access` | `smbCrmTenants.updateTenant` |
| GET | `/industry-templates` | `smb_crm.blueprint.read` | direct DB read of `smb_crm_industry_templates` |
| POST | `/generate-blueprint` | `smb_crm.blueprint.generate` | `smbCrmBlueprintGenerator.generateBlueprint` + `saveBlueprint` |
| GET | `/blueprints/:id` | `smb_crm.blueprint.read` | `smbCrmBlueprintGenerator.getBlueprint` (org-scoped) |
| POST | `/blueprints/:id/apply` | `smb_crm.blueprint.apply` | `smbCrmBlueprintGenerator.applyBlueprint` |

### RBAC (11 new codes, in `rbac_permissions` + `rbac_role_permissions`)
Per-role distribution (V1):
- owner → all 11
- admin → all 11
- accountant → 6 read-class codes
- operator → 7 (read-class + `.automation.run`)
- viewer → 4 (`.access` + 3 read-class)

Codes: `smb_crm.access`, `.blueprint.read`, `.blueprint.generate`, `.blueprint.apply`, `.integration.read`, `.integration.manage`, `.webhook.read`, `.webhook.manage`, `.automation.read`, `.automation.run`, `.translate.read`

### SPA contracts (web-modern)
- `web-modern/src/lib/api/schemas.ts` — 20 new Zod shapes, gated by `/* ─── block-smb-crm-foundation-begin ─── */` / `/* ─── block-smb-crm-foundation-end ─── */` markers for clean diffs across workers
- `web-modern/src/lib/rbac/permissions.ts` — 11 new entries appended to `RBAC_PERMISSIONS`, plus `SMB_CRM_PERMISSION_CODES` const + `SmbCrmPermissionCode` type + `isSmbCrmPermissionCode()` guard

### Tests (`test/smb-crm/foundation.test.js` — 7 contract gates)
1. auth-gated (401 without session) — `GET /api/smb-crm/tenants`
2. app-access-gated (403 for Support user)
3. input-validated (400 on missing `idempotencyKey`) — `POST /api/smb-crm/tenants`
4. happy-path audit-once (200 + exactly one audit_events row)
5. idempotent replay (same envelope returned, no duplicate audit)
6. cross-tenant safety (org A blueprint invisible to org B at engine + auth-helper level)
7. audit-on-AI-call (POST /api/smb-crm/generate-blueprint persists audit row even when AI is offline)

### `test/api.test.js` change
The single-line assertion `body.apps.length === 14` is updated to `=== 15` to reflect the new `smb-crm` app entry. The 4 individual `app.id === ...` assertions are unchanged. This is a one-line mechanical change.

## Conventions for downstream workers

### Pattern A spine (every later SMB CRM route must satisfy it)
1. `app.auth(request)` to resolve the session
2. `requireAppAccess(db, user, "smb-crm")` to gate the suite-launcher entry
3. `smbCrmAuth.requireSmbCrmPermission(db, user, user.org_id, "smb_crm.<...>")` for the per-route code
4. Validate input (Zod at the SPA, hand-rolled in route — no extra Zod dependency in the server)
5. Idempotency: read `idempotency_keys` for `(org_id, key)` first, return cached envelope if hit, otherwise INSERT and call engine
6. Call the engine (pure function, no Fastify import)
7. Write `audit_events` row via `audit(db, orgId, userId, type, details)`

### File map for downstream workers
- **Track 2 (records)**: extends `smbCrmTenants` + adds `smbCrmCustomers` / `smbCrmDeals` / `smbCrmTasks` engines. Tables: `smb_crm_customers`, `smb_crm_deals`, `smb_crm_tasks_2` (the apply-time `smb_crm_tasks` is already taken — pick a different slug).
- **Track 3 (assist)**: extends `smbCrmBlueprintGenerator` with apply helpers, plus `smbCrmTranslate` already supports the trilingual surface.
- **Track 4 (automations)**: new engines + tables. `smb_crm_automations` and `smb_crm_webhooks`. Wires `smb_crm.integration.manage`, `smb_crm.webhook.manage`, `smb_crm.automation.run`.
- **Track 5 (delivery / SPA)**: imports the Zod shapes from `web-modern/src/lib/api/schemas.ts` (under the `block-smb-crm-foundation-*` markers) + uses `isSmbCrmPermissionCode` from `web-modern/src/lib/rbac/permissions.ts`.

### Hard constraints (do not violate)
- **Do NOT touch** `server/crmTube*` (Phase 9 track)
- **Do NOT touch** `web-modern/src/routes/app/crm-tube/*`
- **Do NOT touch** `server/rbac.js` — its `PERMISSIONS_BY_ROLE` is frozen; the 11 `smb_crm.*` codes live in the parallel `server/smbCrmAuth.js` helper
- New engines must not import `fastify`, `app.js`, or read `process.env` directly

### RBAC helper quirks
- `smbCrmAuth.requireSmbCrmPermission` throws `SmbCrmAuthError` with `code ∈ {NOT_AUTHENTICATED, ORG_MISMATCH, PERMISSION_DENIED, INVALID_PERMISSION}` and `statusCode = 403`. The route layer maps these to HTTP responses.
- Cross-tenant safety is enforced via `user.org_id === orgId` BEFORE the permission lookup, so a forged `orgId` in the body never escapes the user's own org.
- Owner short-circuit: a user with `users.role = 'Owner'` AND no `rbac_user_roles` row still gets all 11 codes (the helper detects Owner via both paths).

## Verification commands

```bash
# All 7 contract tests
node --test test/smb-crm/foundation.test.js
# → 7/7 pass

# Full server test suite (run from repo root)
node --test 'test/**/*.test.js'
# → 988 total: 976 pass, 12 fail
# → 12 are pre-existing baseline failures on ant/ant/main
# → 0 new regressions

# Web-modern typecheck
cd web-modern && npx tsc --noEmit
# → exit 0
```

## Known baselines (failures expected on `ant/ant/main`, NOT this commit's fault)
- `api.test.js:52` — dashboard launcher source wiring
- `api.test.js:67` — integration connector rejects malformed path keys
- `api.test.js:174` — customer 360 joins
- `api.test.js:212` — failed webhook delivery can be retried
- `api.test.js:226` — service case mutations reject malformed metadata
- `api.test.js:243` — workflow rule state and rollback
- `api.test.js:569` — forms reject malformed metadata
- `api.test.js:683-687` — `fetcher` helper tests (5 cases)

These are independent of the SMB CRM track.

## Merge order (per `merge-order.md`)
1. `wip/phase10-smb-foundation` (this branch) — foundation
2. `wip/phase10-smb-records` — depends on #1
3. `wip/phase10-smb-assist` — depends on #1
4. `wip/phase10-smb-automations` — depends on #1
5. `wip/phase10-smb-spa` — depends on #1
6. `wip/phase10-smb-delivery` — depends on #1, integrates #2-#5
