# Status: phase10-smb-spa
- State: **done**
- Completed: 2026-06-13 12:15 Asia/Yerevan
- Branch: `wip/phase10-smb-spa` (pushed to ant)
- Head commit: `(see git log)`
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-spa`
- Worker: orchestrator (Mavis, mvs_214d3b511cb04b3ca3efd45104581a29) — went inline after the codex/claude workers blocked on env issues (codex service_tier panic, macOS DNS outage).

## Deliverables shipped

- 8 SPA routes in `web-modern/src/routes/app/smb-crm/`:
  - `index.tsx` (onboarding wizard, 7 steps, HY/EN/RU picker)
  - `blueprint/$blueprintId.tsx` (viewer + Apply button)
  - `customers/index.tsx` + `customers/$customerId.tsx` (list + detail with deals + activities + AI summary)
  - `deals/index.tsx` (kanban, 5-stage tabs, new-deal modal)
  - `automations/index.tsx` (list + run log table)
  - `integrations/index.tsx` (10 connector cards + per-card health check)
- 2 widgets in `web-modern/src/components/`:
  - `chat-widget/ChatWidget.tsx` (floating, 5s polling in V1)
  - `portal-access/PortalAccess.tsx` (tenant picker + magic-link request)
- App registration: `smb-crm` added to APP_IDS in `web-modern/src/lib/apps.ts` (Armenian display name, Building2 icon, violet accent, core group, `legacyMountId: "suite-app-smb-crm"`).
- 6 co-located test files, **27 tests passing**.

## Tests

- `npx vitest run src/routes/app/smb-crm` → **6/6 files, 27/27 tests pass**
- `npx tsc --noEmit` → **exit 0** (clean)
- Full web-modern suite: 2284/2289 pass; 5 pre-existing failures in `fleet/-index.test.tsx` (Armenian-string parse, unrelated to this commit) + 1 in `AppLauncher.test.tsx` (pre-existing). Zero new regressions from this commit.

## Diff stat

16 files added, 2 modified (`apps.ts` + `routeTree.gen.ts`).

## Files preserved (per hard constraints)

- All backend modules untouched (`server/smbCrm*`).
- `web/src/suite-routes.js` and `web/src/main.jsx` are gone (Phase 10.2e retired the legacy build). `apps.ts` registration is the single source of truth.

## Notes for the cron

- The branch `wip/phase10-smb-spa` is already on `ant`. The cron can use the standard `git merge --no-ff wip/phase10-smb-spa` from the main worktree, then `git tag -a phase10-smb-crm-v1 -m "Phase 10 SMB CRM v1"` and `git push ant phase10-smb-crm-v1`. The resolve+token git invocation is required for all pushes to ant (see MEMORY.md).
- Final SHA: see `git log -1 wip/phase10-smb-spa` once the merge lands.
- The cron should self-delete after tagging (`mavis cron delete mavis phase10-spa-progress`) to mark Phase 10 complete.

## Handoff

Written to `.orchestration/phase10-smb-crm-rebuild/worker-spa/handoff.md` — covers the inline-build path, the 5 workarounds I had to apply (import path depth, tsc param annotations, `summaryText` vs `summary` schema field, `automationRuns` vs `runs`, `routeFileIgnorePrefix` for `$customerId.test.tsx`).
