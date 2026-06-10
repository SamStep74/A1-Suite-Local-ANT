# Handoff: asset-management

## Summary
Asset Management (Հիմնական միջոցների կառավարում) is shipped. Pattern A module: pure `server/assets.js` engine (straight-line + reducing-balance depreciation, NBV roll-up, maintenance interval, assignment accounting) + 11 `/api/assets/*` routes wired into the existing audit/idempotency/period-lock plumbing + React `AssetsPanel` with 4 Armenian-first tabs (Ռեեստր / Հարկում / Սպասարկում / Հանձնարարություն) mounted in the existing SPA + 6-test contract suite covering auth, app-access 403, validation, audit-once + idempotent replay, straight-line schedule math, and write-off. Three-digit Armenian chart-of-accounts codes used throughout (111=asset, 112=accumulated depreciation, 711=depreciation expense). Sub-plans 4 (HR) and 9 (Fleet) integration surfaces kept clean — assignments are stored as `(assignee_type, assignee_id)` polymorphic FKs so HR employee ids and fleet vehicle ids can both target the same `asset_assignments` table without coupling.

## Files Changed
- `test/assets.test.js` (new) — 6-test contract suite (RED → GREEN)
- `server/assets.js` (new) — pure engine, no DB/Fastify imports
- `server/db.js` — added 5 tables (`asset_categories`, `assets`, `asset_depreciation_schedules`, `asset_maintenance_logs`, `asset_assignments`) + hidden `apps` row for the `assets` slug + 3 chart-of-accounts seed entries (111/112/711)
- `server/app.js` — added 11 `/api/assets/*` routes + `cachedOrRun` / `lookupIdempotent` / `recordIdempotent` / `postJournalEntry` helpers (PeriodLockedError → 409) + `apps.maturity != 'internal'` filter on the 3 launcher queries (getAssignedApps, getAllApps, getAccessReviewAppMatrix) to keep the hidden `assets` row out of the visible launcher
- `web/src/assets.jsx` (new) — 4-tab React panel
- `web/src/main.jsx` — added `<div id="suite-app-assets">` mount gated by Owner/Admin/Accountant/Operator role check (deliberate; the launcher filter intentionally hides `assets` from the user-visible launcher, so role check is the access gate)
- `HANDOFF.md` — added completion bullet at the top
- `.orchestration/a1-sub-plans-7-10/asset-management/status.md` — state → completed
- `.orchestration/a1-sub-plans-7-10/asset-management/handoff.md` — this file

## Tests / Verification
- `node --test --test-concurrency=4 --test-timeout=60000 test/assets.test.js` → 6 pass, 0 fail, 0 cancelled
- `npm run build:ui` → ✓ built in ~640ms (Vite chunk-size warning is pre-existing)
- Commits on `a1/sub-plan-asset-management`:
  - `a71b86b` test(assets): define Pattern A contract + depreciation math
  - `dc302a1` feat(assets): add pure depreciation/maintenance/NBV engine
  - `6755654` feat(assets): migrate 5 asset tables + seed app_assignments
  - `d9924d7` feat(assets): wire 11 routes + filter hidden apps from launcher
  - `d3d9a95` feat(assets): mount asset-management panel with 4 tabs
- Full suite delta: contract count +6 (868 → 874 expected, 8 of the 10 pre-existing failures are unrelated to this work — see "Follow-ups")

## Follow-ups
- 8 pre-existing test failures (not caused by this sub-plan) confirmed stable on baseline: #52 (`/app/finance 404`), #67, #174, #212, #226, #243, #495, #826. Owned by the integration owner; out of scope here.
- The `apps.maturity != 'internal'` filter is a deliberate design choice: the `assets` row in `apps` exists only to satisfy the `app_assignments.app_id` FK and to back the `appId="assets"` key passed to `requireAppAccess`. It is hidden from the user-visible launcher by filtering on `maturity != 'internal'` in `getAssignedApps`, `getAllApps`, and `getAccessReviewAppMatrix`. Any new app-facing query must respect the same filter.
- UI access is currently role-gated in `web/src/main.jsx` (Owner/Admin/Accountant/Operator). When the apps launcher is reworked to surface a per-app "enabled" state rather than hiding the row entirely, switch the gate to `assignedAppIds.includes("assets")` and drop the role check.
- Sub-plan 9 (Fleet) and sub-plan 4 (HR) should call `assets.recordAssignment(db, { assetId, assigneeType: "fleet_vehicle" | "employee", assigneeId, idempotencyKey })` rather than write to `asset_assignments` directly, so audit + idempotency stay consistent.
- Depreciation auto-posting (scheduled job that runs `post-depreciation` for every asset whose `period_key` is now closed) is deferred — currently the user clicks the button in the UI. Add a cron-style runner in a follow-up if Spayka/Armosphère ops need it.
