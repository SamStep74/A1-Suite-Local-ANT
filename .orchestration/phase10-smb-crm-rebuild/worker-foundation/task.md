# Worker Task: phase10-smb-foundation
- Session: `phase10-smb-crm-rebuild`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Base branch: `ant/ant/main` (current HEAD — fetch at session start)
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-foundation`
- Branch: `wip/phase10-smb-foundation`
- Launcher status file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase10-smb-crm-rebuild/worker-foundation/status.md`
- Launcher handoff file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase10-smb-crm-rebuild/worker-foundation/handoff.md`
- Tag to ship: `phase10-smb-crm-v1`

## Contract (READ THIS FIRST)

`/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase10-smb-crm-rebuild/contract.md` is the shared spec. Your Track 1 deliverables are in §3 Track 1. The 7 contract tests you must pass are listed there.

Legacy reference: `/Users/samvelstepanyan/dev/A1-SMB-CRM-HY/` — read `lib/crmGenerator.js`, `lib/translate.js`, `lib/tenantStore.js`, `lib/vendor/a1-ai.js` to understand the original semantics.

## Objective

You are the **foundation worker** for Phase 10. Goal: build the auth/tenants/AI-onboarding/blueprint layer. This is the *first* of 5 parallel workers, so your outputs are dependencies for the other 4.

## Setup (do these FIRST, in order)

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-foundation`
2. `git status` — verify on `wip/phase10-smb-foundation` branched from `ant/ant/main`.
3. `git fetch ant` to make sure you're at the current `ant/ant/main`.
4. `npm --prefix web-modern install --legacy-peer-deps` (first install, 2-3 min).
5. `npm --prefix web-modern test` to confirm the 70+ existing test files pass (1549+ tests).
6. Read the legacy `lib/crmGenerator.js` (200+ lines) + `lib/translate.js` + `lib/vendor/a1-ai.js` to understand the AI + translation semantics.

## Scope — SIX deliverables

### Deliverable 1: `server/tenants.js` — pure engine

```js
// NO Fastify imports. NO node:sqlite imports. Pure functions.
// Pattern: same as server/crmTube.js

class TenantNotFoundError extends Error { ... }
class TenantConflictError extends Error { ... }   // duplicate slug

function resolveTenant(db, identifier) // { slug } or { host } → tenant row
function getTenantBySlug(db, slug)
function getTenantByHost(db, host)
function createTenant(db, { slug, companyName, locale, plan, branch? })
function updateTenantSettings(db, tenantId, settings)
function listBranches(db, tenantId)
```

Wire `ensureSmbCrmFoundationSchema(db)` into the boot sequence in `server/app.js`. Migration: `CREATE TABLE IF NOT EXISTS smb_crm_tenants (...)` + `smb_crm_branches (...)` + `smb_crm_industry_templates (...)` (seed the 11 industries from the legacy `INDUSTRY_TEMPLATES`).

### Deliverable 2: `server/aiProvider.js` — interface + OpenRouter adapter

```js
// Interface (documented in JSDoc):
//   generateStructured({ systemPrompt, userPrompt, jsonSchema }) → { ok, data, warnings, evidence }
//   translate({ text, targetLocale, sourceLocale? }) → { ok, translated, warnings, evidence }

// Default adapter: openrouter
//   Uses fetch() to call https://openrouter.ai/api/v1/chat/completions
//   Reads OPENROUTER_API_KEY + OPENROUTER_MODEL from env (default openai/gpt-4o-mini)
//   The "evidence" envelope is the same shape as the crm-tube connectors: { url, method, requestHash, responseHash, at }
//
// Stubs (for test contexts, no network):
//   inMemoryAiProvider — accepts a canned response in constructor, returns it on call.
//   ollamaAiProvider — V2 (out of scope, just leave a TODO comment).
```

### Deliverable 3: `server/blueprintGenerator.js` — pure engine

```js
// Mirrors the legacy crmGenerator.js but in pure form (no OpenAI import, no env reads).
// Takes a provider (interface from server/aiProvider.js) as an argument.

function buildBlueprintPrompt(questionnaire, industryTemplate)  // → system + user prompts
function parseBlueprintResponse(rawJson)                      // → blueprint object (validated)
function generateBlueprint(questionnaire, provider)          // → blueprint
```

The blueprint shape is the JSON in `contract.md` §2.5. Validate every field with a Zod schema (`web-modern/src/lib/api/schemas.ts` — see Deliverable 5).

### Deliverable 4: `server/translate.js` — pure engine

```js
// Mirrors the legacy lib/translate.js with a smaller dict (only the strings this module needs).
// Default: returns the dict translation (no AI call). If provider is passed and a key is missing
// from the dict, call provider.translate() and cache the result in smb_crm_translations.

function translateText(text, targetLocale, dict, provider) → translated
function buildDict() → { hy: {...}, en: {...}, ru: {...} }   // the seed dict for the 5 routes in this track
```

### Deliverable 5: `web-modern/src/lib/api/schemas.ts` — Zod shapes

Append to the file (after the existing Tube shapes):
- `SmbCrmTenantSchema` (id, slug, companyName, locale enum "hy"|"en"|"ru", plan enum, branchId nullable, createdAt, updatedAt)
- `SmbCrmIndustryTemplateSchema` (id, industryKey, nameHy, nameEn, nameRu, modules[], pipeline[], fields[], kpis[])
- `SmbCrmBlueprintSchema` (the full §2.5 shape: 11 fields)
- `SmbCrmGenerateBlueprintRequestSchema` (questionnaire, providerPreference?)

### Deliverable 6: `web-modern/src/lib/rbac/permissions.ts` — extend the permission set

Append the 11 new codes from `contract.md` §2.6. Plus add the role-permission join rows to `server/db.js#ensureRbacSchema` (owner/admin have all; accountant has all `.read`; operator has all except `org.*`; viewer has only `.read`).

## Server routes (add to `server/app.js`)

- `POST /api/smb-crm/tenants` — create
- `GET /api/smb-crm/tenants/current` — resolve from header or `?tenant=`
- `PATCH /api/smb-crm/tenants/:id` — update settings
- `GET /api/smb-crm/tenants/:id/branches` — list branches
- `POST /api/smb-crm/generate-blueprint` — input: `{ questionnaire }` → calls provider → returns blueprint
- `GET /api/smb-crm/blueprints/:id` — fetch a stored blueprint
- `POST /api/smb-crm/blueprints/:id/apply` — materialize the blueprint into actual rows
- `GET /api/smb-crm/industry-templates` — list the 11 seed templates

All 8 routes follow Pattern A: `auth() → requireAppAccess(db, user, "smb-crm") → requirePermission(db, user, orgId, "smb_crm.X") → validate (Zod) → call <module>.<fn>(db, orgId, ...) → audit → respond`.

Add `smb-crm` to the `apps` table (similar to how `crm-tube` is registered). Assign to Owner/Admin/Accountant/Operator.

## Tests — 7 contract tests (`test/smb-crm/foundation.test.js`)

1. tenant create / resolve / update
2. aiProvider generateStructured with `inMemoryAiProvider` returns valid JSON (envelope shape)
3. blueprintGenerator with a mock provider returns the full blueprint shape
4. translateText falls back to dict when provider is unavailable
5. blueprint apply materializes all entities (modules, stages, fields, oportunidades, tasks) — i.e. `POST /api/smb-crm/blueprints/:id/apply` writes to `smb_crm_modules`, `smb_crm_pipeline_stages`, `smb_crm_fields`, `smb_crm_oportunidades` (or whatever the actual table names are).
6. cross-tenant: blueprint from tenant A cannot be applied in tenant B (403 with `code: "ORG_MISMATCH"`)
7. audit row written for every AI call (assert count is non-zero after running 6 calls)

## Workflow

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-foundation`
2. Read the contract + the legacy `lib/crmGenerator.js` + `lib/translate.js` + `lib/vendor/a1-ai.js` + `lib/tenantStore.js` + `lib/httpHandlers.js`.
3. Build the pure engines (`tenants.js`, `aiProvider.js`, `blueprintGenerator.js`, `translate.js`).
4. Add `ensureSmbCrmFoundationSchema(db)` to `server/db.js`. Add the 11 permission codes + role-permission join rows to `ensureRbacSchema(db)`.
5. Add the 8 thin routes to `server/app.js`. Register `smb-crm` in the `apps` table.
6. Add the Zod shapes to `web-modern/src/lib/api/schemas.ts` and the permission codes to `web-modern/src/lib/rbac/permissions.ts`.
7. Run `npm test` to confirm all 7 contract tests pass. Run `npm --prefix web-modern test` to confirm no web-modern regression.
8. Commit: `git add -A && git commit -m "feat(smb-crm): foundation (tenants, AI provider, blueprint, RBAC codes)"`.

## Final steps

1. `npm test` — confirm 7 new tests pass; full server suite still green.
2. `npm --prefix web-modern test` — confirm web-modern still green.
3. `npm --prefix web-modern run typecheck` — clean.
4. Push: `git push -u ant wip/phase10-smb-foundation`.
5. Write the handoff to `.orchestration/phase10-smb-crm-rebuild/worker-foundation/handoff.md` with:
   - Test count delta (X → Y tests).
   - Files created (list with paths + 1-line description each).
   - Any deviation from the contract.
   - Anything the other 4 workers need to know (e.g. "the 11 new permission codes are seeded here; the other 4 workers should NOT re-seed them").
6. Mark the status file as: `state=done, completed=<iso timestamp>`.

## Constraints (HARD)

- **Do NOT touch** `server/crmTube*` (the Tube port stays shipped).
- **Do NOT touch** `web-modern/src/routes/app/crm-tube/*` (the Tube SPA stays shipped).
- **Do NOT touch** `server/rbac.js` (the Phase 9 RBAC stays shipped).
- **Do NOT push to `ant/ant/main`** — the orchestrator merges.
- Do not spawn subagents — do it inline.
- The 70+ existing test files on `ant/ant/main` MUST still pass.
- The Edit tool has been seen to corrupt Armenian text on mixed-language files. **For Armenian strings, use the heredoc + python byte-level replacement workaround.** Test the file after each Armenian edit by reading it back.
- Report results in your final response. The launcher captures that response automatically.
