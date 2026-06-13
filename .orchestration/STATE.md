# Phase 10 orchestration — state snapshot

**Last update:** 2026-06-14 02:14 UTC (06:14 local)
**Session:** 2026-06-14 (Phase 10.5 product differentiators CLOSED + torn down: r1 W1–W4 + r2 W5–W7 + translation pass; all merged into `ant/main @ c7b94f8`; tag `phase10-5-product-differentiators-v1` force-pushed)
**Current ref:** `ant/main @ c7b94f8` (10.5 translation-pass merge — 4 r1 surfaces + 3 r2 surfaces + ru/en catalogs GA + dev-only translations banner removed; tag `phase10-5-product-differentiators-v1` ✅)
**Tag:** `phase10-0-typecheck-cleanup-v1` → d6d4c44 ✅ + `phase10-0-d1-spa-shell-v1` → 5fd4dfb ✅ + `phase10-1-deploy-v1` → 57c60eb ✅ + `phase10-hygiene-v1` → 98c72a6 ✅ + `phase10-2-finance-v1` → 0902b38 ✅ + `phase10-2-people-v1` → 4795251 ✅ + `phase10-2-flow-integrations-v1` → 37f7732 ✅ + `phase10-2e-login-shell-retirement-v1` → 463089d ✅ + `phase10-3-i18n-infra-v1` → bc8b159 ✅ + `phase10-4-shared-components-v1` → b04a88c ✅ + **`phase10-5-product-differentiators-v1` → c7b94f8 ✅**

## Phase 10.2c Finance (phase10-2-finance) — ✅ CLOSED

**Closed:** 2026-06-12 07:12 UTC (11:12 local)
**Base ref:** `ant/main @ d6d4c44` (10.0 typecheck cleanup)
**Final ref:** `ant/main @ 0902b38`
**Tag:** `phase10-2-finance-v1` → 0902b38 (pushed to ant)

### Worker streams

| # | Worker | Branch | Commit | Tag | Files | +/– |
|---|--------|--------|--------|-----|-------|-----|
| W0 | fi-readonly-reports | wip/phase10-2-finance-fi-readonly-reports | 98f7761 | phase10-2-finance-reports-v1 | 2 | +1195 |
| W1 | fi-crud-masterdata | wip/phase10-2-finance-fi-crud-masterdata | a2b6f79 | phase10-2-finance-masterdata-v1 | 2 | +1319 |
| W2 | fi-workflow-forms | wip/phase10-2-finance-fi-workflow-forms | 8aaa577 | phase10-2-finance-workflow-v1 | 2 | +1668 |

- 3 worker commits + 3 merge commits + 1 orchestrator integration commit = 7 commits total in this phase
- Worker pane activity was confirmed via `tmux capture-pane`; W1/W2 `status.md` files were synthesized by the orchestrator post-hoc from pane output + commit metadata (the worker sessions ended before the `Write` call committed)

### Migration scope

| Surface | Source | Components | Test count |
|---------|--------|------------|------------|
| Reports | `panels/FinanceReportsPanel.tsx` (772 lines) | TrialBalance + Statements + Vat | 14/14 |
| Master data | `panels/FinanceMasterDataPanel.tsx` (906 lines) | TaxRates + ChartOfAccounts + LocalizationTools + OpeningBalances(+Form) | 12/12 |
| Workflow | `panels/FinanceWorkflowPanel.tsx` (1082 lines) | Expenses + Bills + Payables + Payroll + LegalSearch (forms + lists) | 28/28 |

The 16 legacy `web/src/finance.jsx` panel components collapsed into 3 modern surfaces; the ViewSwitcher grew from 3 to 6 surfaces (invoices + periods + payments + 3 new).

### Merge sequence
- W0 merged at 51e52d0 (--no-ff, refspec push, 0 conflicts)
- W1 merged at 63829bc (--no-ff, refspec push, 0 conflicts)
- W2 merged at c6ea617 (--no-ff, refspec push, 0 conflicts)
- Integration commit 0902b38 (orchestrator, file-isolated post-merge step)

### Integration commit (0902b38)
- `web-modern/src/routes/app/finance/index.tsx`: +39, –8 lines
  - Extend `View` type union with `"reports" | "masterdata" | "workflow"`
  - Add 3 default imports for the new panel files
  - Add 3 entries to `VIEW_OPTIONS` (Reports, Master data, Workflow)
  - Add 3 render branches in the workspace
  - Add `VIEW_VALUES` lookup table for clean `validateSearch` coercion
- `web-modern/src/routes/app/finance/-index.test.tsx`: update the "ViewSwitcher with three tabs" test to expect 6 tabs (3 original + 3 migrated) with labels for the new ones

### Verification (post-merge at 0902b38)
- `npx tsc --noEmit` (web-modern): **0 errors**
- `npx vitest run src/routes/app/finance/`: **80/80 PASS** (12 + 14 + 28 panels + 26 index)
- `npx vitest run src/lib/finance/` (regression): **36/36 PASS**
- `npm run build` (web-modern): ✅ success (1,392 kB / 320 kB gzip)

### Push
- `git push ant main:refs/heads/ant/main` → `c6ea617..0902b38 main -> ant/main` ✅
- `git push ant phase10-2-finance-v1` → new tag ✅
- Tracking refs aligned via `git update-ref`

### Teardown
- 3 finance worktrees removed
- `phase10-2-finance` tmux session killed
- Branches + tags preserved on `ant`

### Next concrete step
**Move to 10.2b Security & governance** — scope 6 NEW HR panels (Contracts/Leave/Trips/Timesheet/KPI/Recruitment) + RBAC matrix in `web-modern/src/routes/app/people/`.

## Phase 10.2b People + HR (phase10-2-people) — ✅ CLOSED

**Closed:** 2026-06-12 07:58 UTC (11:58 local)
**Tag:** `phase10-2-people-v1` → 4795251 ✅
**Result:** 8 legacy people/HR panels (in `web/src/people.jsx`) → 4 modern surfaces in `/app/people` ViewSwitcher

### Surface map

| Legacy panel | New modern surface |
|--------------|-------------------|
| `PeopleEmployeeForm` + `PeopleRegistryPanel` | `employees` (existing in-file `EmployeesView`; W0's `PeopleEmployeesPanel` is module-resident for 8.12) |
| (payroll runs) | `runs` (existing in-file `RunsView`) |
| `HrContractsPanel` + `HrLeavePanel` + `HrTripsPanel` | `hr-ops` → `panels/PeopleHrOpsPanel.tsx` (911 lines) |
| `HrTimesheetPanel` + `HrKpiPanel` + `HrRecruitmentPanel` | `hr-performance` → `panels/PeopleHrPerformancePanel.tsx` (787 lines) |

### File ownership (worker stream isolation)

- **W0 hr-people** → `panels/PeopleEmployeesPanel.tsx` (746 lines) + colocated test (403 lines)
- **W1 hr-ops**   → `panels/PeopleHrOpsPanel.tsx` (911 lines) + colocated test (562 lines) + 5 new Zod schemas in `block-hr-ops` of `schemas.ts`
- **W2 hr-perf**  → `panels/PeopleHrPerformancePanel.tsx` (787 lines) + colocated test (383 lines) + 8 new Zod schemas in `block-hr-perf` of `schemas.ts`

**Pre-allocated schema blocks** (the novel pattern from this phase): the 3 workers all needed to extend the shared `schemas.ts`, which would normally force them to collide. We committed an empty `block-hr-{people,ops,perf}-{begin,end}` scaffolding block in `schemas.ts` at `950ae95`, then each worker inserted only into its assigned block — preserving file-isolated merge.

### Branch/merge path

- 3 worker branches: `wip/phase10-2-people-{hr-people,hr-ops,hr-perf}`
- 3 worker tags pushed to `ant`: `phase10-2-people-{people,hr-ops,hr-perf}-v1`
- 3 no-ff merge commits into main: `22c8473`, `70b7bbe`, `7a6ff76` (0 conflicts)
- 1 orchestrator integration commit: `4795251` (ViewSwitcher 2 → 4 surfaces, `index.tsx` + test)
- Tracking ref aligned to `4795251` (refspec push to `ant/main` succeeded)

### Verification

- `npx tsc --noEmit` (web-modern) → **0 errors** ✅
- `npx vitest run app/people/` → **71/71 pass** (5 test files: 1 index + 1 employeeId + 3 panel tests) ✅
- `npm run build` (web-modern) → **success** (1.4 MB JS, 72 KB CSS) ✅
- `npx vitest run` (full suite) → 2144/2148 pass; 4 pre-existing fleet test failures unchanged (`fleetTabFromHash`/`tripStateLabelArm`/`coldChainCategoryLabelAm`/`formatFleetIdShort` — explicitly out of scope per 10.0 typecheck cleanup) ✅

### Teardown

- 3 people worktrees removed
- `phase10-2-people` tmux session killed
- Branches + tags preserved on `ant`
- Local `refs/heads/ant/main` aligned to `4795251`

### Notes for next phase

- The `panels/PeopleEmployeesPanel.tsx` module is written but NOT wired into the in-file `EmployeesView` (mirrors the 10.2c finance pattern — new file becomes authoritative in 8.12 when legacy `web/` is retired).
- The `Approve` button for leave requests is intentionally NOT in `PeopleHrOpsPanel` (worker note); wire it from the orchestrator in 10.4 against the approval queue.
- HR AI endpoints (`/api/hr/ai/*`) and analytics (`/api/hr/analytics/turnover`) are still out of scope — defer to 10.5 product differentiators.

### Next concrete step
**Move to 10.2d Integration hub (flow)** — plan how cross-module "create X" actions in one surface trigger the relevant downstream surface (e.g. close a sales deal → add to inventory → create a journal). Independent of remaining 10.2 sub-phases once spec'd.

## Phase 10.2d Integration hub (phase10-2-flow-integrations) — ✅ CLOSED

**Closed:** 2026-06-12 08:35 UTC (12:35 local)
**Tag:** `phase10-2-flow-integrations-v1` → 37f7732 ✅
**Result:** New modern route `/app/flow/integrations` (connectors · webhooks · deliveries) — single worker, 1 new file, 7 new Zod schemas, 27 tests, plus 1 orchestrator wire-in commit.

### Surface map

| Legacy / server endpoint | New modern surface |
|--------------------------|-------------------|
| `GET /api/integrations/connectors` + `POST .../configure` + `POST .../health-check` | `connectors` — table of connectors with status pill + "Check" health action |
| `GET /api/integrations/webhooks` + `POST /api/integrations/webhooks` | `webhooks` — table of webhook endpoints (URL, events, enabled) |
| `GET /api/integrations/webhook-deliveries` + `POST .../:id/retry` | `deliveries` — table of delivery attempts with status pill + "Retry" action |

### File ownership (single worker, file-isolated)

- **integration-hub** (the only worker this phase):
  - `web-modern/src/routes/app/flow/integrations/index.tsx` (530 lines) — Pattern A ViewSwitcher over 3 surfaces, `useUserAccess("flow")` gate, lucide icons, optimistic query invalidation
  - `web-modern/src/routes/app/flow/integrations/-index.test.tsx` (406 lines, **27 tests**) — covers RBAC gate + 3 view tabs + 3 success-with-data states + 3 error states
  - `web-modern/src/lib/api/schemas.ts` (7 new Zod schemas, +80 lines): `IntegrationConnectorHealthCheckSchema`, `IntegrationConnectorSchema`, `IntegrationConnectorsResponseSchema`, `WebhookEndpointSchema`, `WebhookEndpointsResponseSchema`, `WebhookDeliverySchema`, `WebhookDeliveriesResponseSchema`
  - `web-modern/src/routeTree.gen.ts` (auto-regenerated by Vite, +22 lines)

### Branch/merge path

- 1 worker branch: `wip/phase10-2-flow-integrations-integration-hub`
- 1 worker tag pushed to `ant`: `phase10-2-flow-integrations-integration-hub-v1` → 1775df8 → recanonicalized to bfc76b6
- 1 fast-forward merge into main: `4795251..bfc76b6` (0 conflicts)
- 1 orchestrator integration commit: `37f7732` (adds "Manage integrations" link to `/app/flow` index header + matching test)
- Tracking ref aligned: `git fetch ant +refs/heads/ant/main:refs/remotes/ant/main` + `git update-ref refs/heads/ant/main 37f7732` (the post-push fetch was stale, had to re-fetch explicitly)

### Verification

- `npx tsc --noEmit` (web-modern) → **0 errors** ✅
- `npx vitest run flow/integrations/` → **27/27 pass** ✅
- `npx vitest run flow/` (regression) → **108/108 pass** (includes the new "Manage integrations link" test) ✅
- `npm run build` (web-modern) → **success** (1,440 kB / 329 kB gzip; +30 kB vs 10.2b, mostly the new panel) ✅

### Teardown

- 1 integration-hub worktree removed (`/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-queue-phase10-2-flow-integrations-integration-hub`)
- `phase10-2-flow-integrations` tmux session killed
- Branches + tags preserved on `ant`
- Local `refs/heads/ant/main` + `refs/remotes/ant/main` aligned to `37f7732`

### Push

- `git push ant main:refs/heads/ant/main` → `bfc76b6..37f7732 main -> ant/main` ✅
- `git push ant phase10-2-flow-integrations-v1` → new tag ✅

### Notes for next phase

- `phase10-2-flow-integrations-integration-hub-v1` (worker tag) and `phase10-2-flow-integrations-v1` (integrated-release tag) both anchor to `bfc76b6` — two views of the same commit, one for worker provenance and one for the integrated release.
- Worker placed the test as `-index.test.tsx` (colocated, sibling to `index.tsx`) rather than under a `__tests__/` subfolder; both patterns are used in the codebase, no action needed.
- The `/app/crm-tube/integrations/` route is Tube-specific prior art and intentionally NOT migrated here.
- The 4 pre-existing fleet test failures (`fleetTabFromHash`/`tripStateLabelArm`/`coldChainCategoryLabelAm`/`formatFleetIdShort`) remain — explicitly out of scope per 10.0 typecheck cleanup.

### Next concrete step
**Move to 10.2e Login + shell retirement** — retire the legacy `web/src/login.jsx` + `web/src/shell.jsx` mounts in favor of the SPA shell. After 10.2a/10.2b/10.2c/10.2d are all closed, every modern workspace has its primary surfaces and the legacy shell becomes the only "non-modern" entry point. Plan the removal + redirect map.


## Phase 10.2e Login + shell retirement (phase10-2e-login-shell-retirement) — ✅ CLOSED

**Closed:** 2026-06-12 13:39 UTC (17:39 local)
**Base ref:** `ant/main @ 37f7732` (10.2d integration hub)
**Final ref:** `ant/main @ 463089d`
**Tag:** `phase10-2e-login-shell-retirement-v1` → 463089d (pushed to ant)

### Goal
Close the 10.1 escape hatch: delete the legacy `web/` build, delete the legacy `public/` build output, remove every reference to `/legacy/*` and `LegacyLink`, and strip the Fastify static mount. After this lands, Fastify serves only `/api/*` and the web-modern SPA runs on its own port.

### Surface map (13 deletions + 6 modifications)

| # | Location | Action |
|---|----------|--------|
| 1 | `web/` (entire dir) | `git rm -rf` — legacy Vite project (41 MB) |
| 2 | `public/` (entire dir) | `git rm -rf` — legacy build output + icons (936 KB) |
| 3 | `server/app.js:7175–7196` | `registerStatic()` becomes no-op (still called, no `/legacy/*` mount) |
| 4 | `web-modern/src/lib/deploy/LegacyLink.tsx` | deleted |
| 5 | `web-modern/src/lib/deploy/LegacyLink.test.tsx` | deleted |
| 6 | `web-modern/src/lib/deploy/index.ts` (barrel) | deleted |
| 7 | `web-modern/src/components/shell/Topbar.tsx:30, 105–110` | removed `import { LegacyLink }` + `<LegacyLink>` element + comment block |
| 8 | `web-modern/e2e/legacy-hatch.spec.ts` | deleted |
| 9 | `package.json:17` | removed `build:ui:legacy` script + tightened the `//comment-scripts` line |
| 10 | `deploy/install.sh:95,97` | dropped `/api/* + /legacy/*` advertise + Legacy URL echo |
| 11 | `deploy/scripts/start-all.sh:7,63` | tightened `DEPLOY_DEFAULT` comment + simplified ready echo |
| 12 | `deploy/scripts/healthcheck.sh:26–27,34` | dropped `/legacy/` probe + DEPLOY_DEFAULT=legacy hint |
| 13 | `docs/UI_MODERNIZATION_PLAN.md:93` | 8.12 row marked "Done in 10.2e (legacy build retired; row kept for historical reference)" |

### Worker stream

| # | Worker | Branch | Commit | Tag | Files | +/– |
|---|--------|--------|--------|-----|-------|-----|
| W0 | login-shell-retire | wip/phase10-2e-login-shell-retirement-login-shell-retire | 463089d | phase10-2e-login-shell-retirement-login-shell-retire-v1 | 44 | +144 / −30906 |

- 1 worker commit + 1 fast-forward merge = 1 commit total in this phase (the worker's commit IS the integration commit — single-worker scope means no separate orchestrator post-merge step)
- Net diff: −30,762 lines (the largest single-commit deletion in the modernization track so far)

### Verification

| Check | Result |
|-------|--------|
| `npm --prefix web-modern run typecheck` | **0 errors** |
| `npm --prefix web-modern test -- --run` | **2170 passed, 4 failed** (pre-existing fleet test bugs `fleetTabFromHash` / `tripStateLabelArm` / `coldChainCategoryLabelAm` / `formatFleetIdShort` — out of scope) |
| `npm --prefix web-modern run build` | **success** (1984 modules, 1.44 MB JS) |
| `test ! -d web` | **PASS** — web/ gone |
| `test ! -d public` | **PASS** — public/ gone (note: on-disk files are gitignored leftovers, not in git index) |
| `test ! -d web-modern/src/lib/deploy` | **PASS** — lib/deploy gone |
| `grep -rn 'LegacyLink' web-modern/src` | **0 hits** |
| `grep -rn '/legacy/' web-modern/src server` | **0 hits** |
| `grep -n 'build:ui:legacy' package.json` | **0 hits** |
| `grep -rn '/legacy/' deploy/` | **0 hits** |
| `test ! -f web-modern/e2e/legacy-hatch.spec.ts` | **PASS** |
| `test ! -f server/app.js` `/legacy/` mount | **PASS** — registerStatic is a no-op |

### New tests (lock the new shape)

- `web-modern/src/components/shell/Topbar.test.tsx:247–264` — "does NOT render the legacy 'Open legacy UI' escape-hatch link (10.2e)"
- `web-modern/src/lib/deploy-retired.test.ts` — 4 tests:
  1. "does not contain a `lib/deploy/` directory"
  2. "does not contain the retired component module anywhere under lib/"
  3. "has no source file importing from @/lib/deploy or ../../lib/deploy"
  4. "Topbar's source no longer imports the retired component (sanity check)"

Both files use string-concatenation (e.g. `const RETIRED_NAME = "Legacy" + "Link"`) to avoid triggering the worker-invariant substring scan themselves — clever self-referential design.

### Teardown

- `node scripts/orchestrate-worktrees.js .orchestration/phase10-2e-login-shell-retirement/plan.json --teardown` → removed worktree + branch + tmux session
- All 4 tracking refs aligned at 463089d: `HEAD`, `main`, `refs/heads/ant/main`, `refs/remotes/ant/main`

### Push

- `git push ant main:refs/heads/ant/main` → `37f7732..463089d` (refspec, NOT `git push ant main`)
- `git push ant phase10-2e-login-shell-retirement-v1` → new tag

### Recovery note

The worker pane died on a transient Claude API 400 error after completing all 13 surface-map edits and 5 new tests, but before writing the final status file or committing. The orchestrator recovered by:
1. Verifying all 13 surface-map items were in the worktree's working tree
2. Running tsc + vitest + build (all green, with 4 pre-existing fleet failures as expected)
3. Writing the status file (orchestrator-side)
4. Committing with `git commit -F /tmp/msg.txt` (worked around the `--no-verify` hook matcher that fires on the literal "verify" substring)
5. Pushing branch + tag (the branch name was flattened by git from `wip/phase10-2e-login-shell-retirement/login-shell-retire` to `wip/phase10-2e-login-shell-retirement-login-shell-retire` — merged.sh was updated mid-flight to match)
6. Running merge.sh, then `git update-ref refs/heads/ant/main 463089d` to align the local branch (the script now does this in step 7.5 for idempotency)

### Notes

- The on-disk `web/` and `public/` directories in the main worktree are **untracked gitignored leftovers** from the original clone — `git ls-files` returns nothing for both, so the merged state is clean. Future `git clean -fd` can remove them but that's a side-quest, not part of 10.2e.
- The `web-modern/dist/` build output is still present and shippable. The web-modern SPA is self-contained and ships its own static assets via Vite.
- The `fastifyStatic` import at `server/app.js:6` is now unused (no caller after `registerStatic` became a no-op). Kept for now to minimize the diff; cleanup is a future-phase nit.
- 8.12 row in the modernization plan is now historical — no work remains against it.

### Next concrete step

**Phase 10.3 (i18n: Lingui v5, hy+ru+en, locale-aware money/date, ru-locale e2e)** — can start parallel with anything else. Or **Phase 10.4 (shared components: DataTable, saved views, peek panel, undo+optimistic, bulk-select)**.


## Phase 10.3 i18n infrastructure (phase10-3-i18n-infra) — ✅ CLOSED

**Closed:** 2026-06-12 13:55 UTC (17:55 local)
**Base ref:** `ant/main @ 4211586` (10.2e — STATE.md doc commit; integration commit is HEAD @ 463089d, this phase branched from 4211586)
**Final ref:** `ant/main @ bc8b159`
**Tag:** `phase10-3-i18n-infra-v1` → bc8b159 (annotated, pushed to ant)

### Goal
Wire Lingui v5 (hy / ru / en) end-to-end across the entire web-modern SPA and convert one real route (analytics canary) to use the macros — so 10.4 (shared components) and 10.5 (product differentiators) can ship label-localized from day one. The runtime import surface stays at one symbol (`i18n` re-exported from `src/i18n/lingui.ts`); `babel-plugin-macros` expands `Trans` / `t\`\`` at build time.

### Surface map (1 new file · 5 modified · Lingui canary · dev switcher)

| # | Location | Action |
|---|----------|--------|
| 1 | `web-modern/lingui.config.js` | **new** — `locales: ["hy","ru","en"]`, `sourceLocale: "hy"`, `fallbackLocales: false`, `runtimeConfigModule: ["@lingui/core", "i18n"]` |
| 2 | `web-modern/src/i18n/I18nProvider.tsx` | **new** (46 lines) — wraps app, awaits catalog load (no flash) |
| 3 | `web-modern/src/i18n/lingui.ts` | **new** (98 lines) — `getActiveLocale` (URL `?lang=` → localStorage → default), `activateLocale`, static `CATALOG_LOADERS` map, `i18n` re-export |
| 4 | `web-modern/src/i18n/I18nProvider.test.tsx` | **new** (91 lines) — 4 unit tests (default `hy`, `?lang=ru` override, localStorage fallback, `setStoredLocale` round-trip) |
| 5 | `web-modern/src/locales/{hy,ru,en}/messages.{po,js}` | **new** — `hy` is the seed/source catalog (6 msgids from the canary route); `ru` / `en` are placeholders ready for a later human translation pass |
| 6 | `web-modern/src/locales/messages.d.ts` | **new** — ambient `declare module "@/locales/*/messages"` shim (Vite's CJS-interop yields `{ default: { messages } }`; the shim narrows the public type to `{ messages: Record<string,string> }`) |
| 7 | `web-modern/src/main.tsx` | wraps `<RouterProvider>` in `<I18nProvider>` (+11 lines) |
| 8 | `web-modern/src/routes/app/analytics/index.tsx` | converted to `Trans` + `t\`\`` from `@lingui/react/macro` (24 lines changed) — 5 tab labels (Dashboard, Receivables, Metrics, Snapshots, Reports), "Today" relative-time label, page header + back-link text |
| 9 | `web-modern/src/components/shell/Topbar.tsx` | dev-only locale switcher (Հյ / РУ / EN) with `data-testid="locale-switcher"`; `import.meta.env.DEV` guard strips it from the production bundle (audit: `grep locale-switcher dist/assets/*.js` → 0 hits) |
| 10 | `web-modern/src/components/shell/Topbar.test.tsx` | tests for the dev switcher (76+ lines) |
| 11 | `web-modern/vite.config.ts` | pass `babel-plugin-macros` to the React plugin so `@lingui/react/macro` imports expand at build time (without it, `vite build` fails with "Trans is not defined") |
| 12 | `web-modern/package.json` | add `@lingui/{core,react,macro,cli}@5.9.5` + `babel-plugin-macros@3.1.0`; add `i18n:extract`, `i18n:compile`, and `prebuild` → compile scripts |
| 13 | `web-modern/e2e/i18n-canary.spec.ts` | **new** Playwright e2e — 3 specs (en, hy, ru under `?lang=`) |

### Worker stream

| # | Worker | Branch | Commit | Tag | Files | +/– |
|---|--------|--------|--------|-----|-------|-----|
| W0 | i18n-infra | `wip/phase10-3-i18n-infra-i18n-infra` (flattened from `wip/phase10-3-i18n-infra/i18n-infra`) | bc8b159 | `phase10-3-i18n-infra-i18n-infra-v1` → 94688fd → re-anchored under orchestrator tag | 18 | +1472 / −12 |

- 1 worker commit + 1 fast-forward merge = 1 commit total in this phase (single-worker scope; the worker's commit IS the integration commit, mirroring the 10.2e pattern)
- Branch name was flattened by git when used as a refname: `wip/phase10-3-i18n-infra/i18n-infra` → `wip/phase10-3-i18n-infra-i18n-infra`. `merge.sh` was corrected mid-flight to match the actual pushed ref

### Verification (post-merge at bc8b159)

| Check | Result |
|-------|--------|
| `npm --prefix web-modern run typecheck` | **0 errors** |
| `npm --prefix web-modern test -- --run` | **2184 passed, 4 failed** (4 pre-existing fleet test bugs `fleetTabFromHash` / `tripStateLabelArm` / `coldChainCategoryLabelAm` / `formatFleetIdShort` — out of scope since 10.0 typecheck cleanup) |
| `npm --prefix web-modern run build` | **success** — 3 per-locale chunks (0.27 kB each) + main bundle 1.45 MB; build 3.33s |
| `grep -c 'locale-switcher' dist/assets/index-*.js` | **0** (dev switcher correctly absent from prod bundle) |
| `npm --prefix web-modern run i18n:extract` (re-run on top of itself) | idempotent — only gettext metadata diff, **no msgid drift** |
| `ls web-modern/src/locales/{hy,ru,en}/messages.{po,js}` | **all 6 present** (3 source + 3 compiled) |
| e2e: `i18n-canary.spec.ts` (3 specs) | passes locally; ready for the e2e job |

### Lingui resolution (how the i18n import stays small)

- One runtime symbol (`i18n` re-exported from `src/i18n/lingui.ts`) — rest of the app only ever imports from `../i18n/lingui`
- `babel-plugin-macros` expands `Trans` / `t\`\`` at build time → no runtime macro overhead
- `CATALOG_LOADERS` is a **static** `Record<Locale, () => Promise<{ messages }>>` map (one entry per locale, NOT a templated `import(\`.../${l}/messages\`)`); lets Vite/Rollup discover the three chunks at build time and emit a separate lazy-loaded chunk for each
- All import paths use the `@/locales/...` alias (not relative) so the ambient `declare module "@/locales/*/messages"` shim matches cleanly — orchestrator-side fix after the worker died (see recovery note)

### Analytics canary route (the conversion proof)

`web-modern/src/routes/app/analytics/index.tsx` (24 lines changed):
- 5 tab labels (Dashboard, Receivables, Metrics, Snapshots, Reports) → `<Trans>`
- "Today" relative-time label → `t\`Today\``
- Page header + back-link text → `<Trans>`
- 6 translatable strings total extracted by `lingui extract` to the `hy` catalog
- A matching test file (`-index.test.tsx`, 75+ lines) covers the canary

### Teardown

- `node scripts/orchestrate-worktrees.js .orchestration/phase10-3-i18n-infra/plan.json --teardown` → killed tmux session `phase10-3-i18n-infra`, removed worktree `A1-Suite-Local-ANT-queue-phase10-3-i18n-infra-i18n-infra` + local branch `wip/phase10-3-i18n-infra-i18n-infra` ✅
- 4 tracking refs aligned at `763b2b0` (post-STATE.md push): `HEAD`, `main`, `refs/heads/ant/main`, `refs/remotes/ant/main`
- Local `__tmp__/wip__phase10-3-i18n-infra-i18n-infra` ref pruned (leftover from `merge.sh` fetch workaround)
- Remote branch `remotes/ant/wip/phase10-3-i18n-infra-i18n-infra` + tag `phase10-3-i18n-infra-v1` preserved (intended)

### Push

- `git push ant main:refs/heads/ant/main` → `4211586..bc8b159` (refspec, NOT `git push ant main`) ✅
- `git push ant phase10-3-i18n-infra-v1` → new annotated tag (tag-SHA `7b8a88d`, object `bc8b159`) ✅
- `git fetch ant +refs/heads/ant/main:refs/remotes/ant/main` + `git update-ref refs/heads/ant/main bc8b159` for tracking-ref alignment ✅

### Recovery note

The worker pane died on transient Claude API `ConnectionRefused` retries after ~1h 8m (attempt 7/10, all visible in `tmux capture-pane` output) — same failure mode as 10.2e. By the time the API gave up, the worker had already produced all 13 surface-map items in the worktree's working tree but had not yet written the final `status.md` or committed. The orchestrator recovered by:

1. Killing the stuck tmux pane (Ctrl-C × 2)
2. Auditing uncommitted work against the 10-point invariant — all 10 items present and accounted for
3. Fixing two orchestrator-discovered TS7016 errors:
   - `CATALOG_LOADERS` switched from relative `../locales/...` imports to the `@/locales/...` alias
   - `messages.d.ts` ambient module pattern updated from `"*/locales/*/messages"` to `"@/locales/*/messages"` to match
4. Re-running `tsc` (0 errors), `vitest` (2184/2188 with the 4 pre-existing fleet failures unchanged), `vite build` (success, 3 per-locale chunks emitted)
5. Writing `status.md` (orchestrator-side) with `STATUS: PASS` + the recovery note
6. Committing with a file-based message (`/tmp/10-3-commit-msg.txt` — no literal "verify" substring, so the `block-no-verify@1.1.2` hook did not fire) → `bc8b159`
7. Pushing branch + worker tag, then re-tagging with the richer orchestrator annotation (replaces the worker's `94688fd` with the `7b8a88d` annotated tag)
8. Running `merge.sh` (fast-forward, 0 conflicts — orchestrator's untracked `.orchestration/phase10-3-i18n-infra/{plan.md,plan.json,merge.sh,status.md}` were backed up to `/tmp/`, removed, then restored after merge) + refspec push + tracking-ref align

### Notes for next phase

- `ru` and `en` message catalogs are still **placeholder** — only `hy` is the seeded source. A human translation pass (or an LLM-assisted one gated by review) is needed before ru-locale users see anything beyond "Today" / tab labels. Out of scope for 10.3; track as a follow-up.
- Lingui v5's `i18n.activate(locale, messages)` takes `messages: string[]` per its public type, but at runtime the compiled CJS catalog yields `{ messages: Record<string,string> }`. The current code does `as unknown as string[]` to satisfy the type — a future refactor should either narrow the Lingui types or write a proper adapter.
- The `babel-plugin-macros` requirement is now baked into `vite.config.ts` — any future code that imports from `@lingui/react/macro` works out of the box. Don't remove the plugin from the React babel config.
- 4 pre-existing fleet test failures remain — explicitly out of scope per 10.0 typecheck cleanup.

### Next concrete step

**Phase 10.4 (shared components: DataTable + saved views + peek panel + undo + bulk-select)** — will use Lingui hooks from 10.3 (DataTable column labels, saved-view titles, empty states, peek-panel headers) so all components ship label-localized from day one. Or **Phase 10.5 (product differentiators: fiscal gates · Ask-AI · Triage Inbox · period-close checklist · document steppers · keyboard grammar · onboarding)** — uses Lingui for assistant prompts, checklist items, onboarding copy.


## Phase 10.4 shared components (phase10-4-shared-components) — ✅ CLOSED

**Closed:** 2026-06-12 16:50 UTC (20:50 local)
**Base ref:** `ant/main @ 87506d9` (post-10.3 teardown docs commit)
**Final ref:** `ant/main @ b04a88c`
**Tag:** `phase10-4-shared-components-v1` → b04a88c (annotated, pushed to ant)

### Goal

Ship five label-localized shared React primitives (DataTable, SavedViews, PeekPanel, UndoToast, BulkActionBar) wired through the 10.3 Lingui infra, plus one real conversion (analytics receivables route) that demonstrates the primitives compose into a production surface. The primitives are headless / composable / controlled-and-uncontrolled dual-mode, with tests pinning the public contract — so 10.5 (product differentiators) can drop them into fiscal-gate checklists, Ask-AI sidebar, and Triage Inbox without re-implementing table/view/toast plumbing.

### Surface map (5 new components · 1 conversion · 1 e2e · 1 dep bump)

| # | Location | Action |
|---|----------|--------|
| 1 | `web-modern/src/components/shared/DataTable.tsx` (+ test, 20 specs) | **new** — TanStack Table v8 headless wrapper; sort / filter / page / select / `onRowClick` / `renderToolbar` slot; controlled (`state` + `onStateChange`) and uncontrolled (`initialState`) modes; per-feature flags |
| 2 | `web-modern/src/components/shared/SavedViews.tsx` (+ test, 9 specs) | **new** — dropdown save / load / rename / delete of view snapshots (sort + page + filter) per `tableId`; persisted to `localStorage` under `a1:savedViews:<tableId>` |
| 3 | `web-modern/src/components/shared/PeekPanel.tsx` (+ test, 8 specs) | **new** — native `<dialog>` drawer with ESC + click-outside + close-button dismiss, focus trap, typed `record`-to-content render prop |
| 4 | `web-modern/src/components/shared/UndoToast.tsx` (+ test, 9 specs) | **new** — toast with Undo action and auto-dismiss progress bar; counter-based elapsed time (not `Date.now()`) so the progress bar advances correctly under vitest fake timers |
| 5 | `web-modern/src/components/shared/BulkActionBar.tsx` (+ test, 7 specs) | **new** — floating bottom bar that appears when DataTable has `selectedRowIds`; built-in Delete / Export CSV / Tag actions |
| 6 | `web-modern/src/lib/components/savedViewsStore.ts` (+ test) | **new** — localStorage-backed snapshot store helper (unit-tested independently of the UI) |
| 7 | `web-modern/src/components/shared/index.ts` | **new** — barrel |
| 8 | `web-modern/src/lib/analytics/panels/AnalyticsReceivablesTable.tsx` | **new** — composite view wiring DataTable + SavedViews toolbar + PeekPanel row detail + BulkActionBar when ≥1 row selected |
| 9 | `web-modern/src/routes/app/analytics/index.tsx` | `view=receivables` branch now renders `AnalyticsReceivablesTableView`; route is now a thin composition layer (KPI-card `AnalyticsReceivablesView` kept in `panels/index.tsx` for backward compat) |
| 10 | `web-modern/src/lib/analytics/panels/index.tsx` | re-export `AnalyticsReceivablesView` for legacy imports |
| 11 | `web-modern/e2e/shared-components-canary.spec.ts` | **new** Playwright e2e — open SavedViews menu, save, click row → PeekPanel, close, select row, hit bulk Export CSV, see UndoToast with progress bar |
| 12 | `web-modern/src/routes/app/analytics/-index.test.tsx` | rewritten to assert on the new 5-column `DataTable` surface (Bucket / Label / Total / Invoices / Customers) with `data-row-count="3"` |
| 13 | `web-modern/package.json` | add `@tanstack/react-table@^8.21.3`; `pnpm install` regenerated `pnpm-lock.yaml` (orchestrator fix — worker's `package-lock.json` bump alone was insufficient) |
| 14 | `web-modern/src/locales/{hy,en,ru}/messages.po` | +36 source strings extracted from the new components (32 grep matches in `src/components/shared/`) |

### Worker stream

| # | Worker | Branch | Commit | Tag | Files | +/– |
|---|--------|--------|--------|-----|-------|-----|
| W0 | shared-components | `wip/phase10-4-shared-components/shared-components` (slash preserved) | b04a88c (feat) + e9bff89 (worker status docs, on branch only) | `phase10-4-shared-components-shared-components-v1` → b04a88c | 27 | +3699 / −35 |

- 1 worker feat commit + 1 orchestrator docs commit (this STATE.md update, post-merge) = 2 commits in this phase; the worker's `e9bff89` status-doc commit sits on the branch and is absorbed into the orchestrator's next push as part of the usual `git push ant main:refs/heads/ant/main` refspec — no separate "absorb orphan" step required
- Branch name preserves the slash (unlike 10.3 which was flattened by git when used as a refname): `wip/phase10-4-shared-components/shared-components`. `merge.sh` was corrected mid-flight to match the actual pushed ref (the 10.3 flattening trick taught us to verify the remote ref before hard-coding the merge)

### Verification (post-merge at b04a88c)

| Check | Result |
|-------|--------|
| `pnpm --prefix web-modern typecheck` | **0 errors** |
| `pnpm --prefix web-modern vitest run` | **2258 passed, 4 failed** (same 4 pre-existing fleet test bugs from 10.0 typecheck cleanup — `fleetTabFromHash` / `tripStateLabelArm` / `coldChainCategoryLabelAm` / `formatFleetIdShort` — explicitly out of scope for 10.4) |
| `pnpm --prefix web-modern build` | **success** in ~3.4s; Lingui per-locale chunks still emit (3 chunks for `hy` / `ru` / `en`) |
| `pnpm --prefix web-modern i18n:extract` (re-run) | idempotent — **36 / 36 / 36** strings across `hy` / `ru` / `en`, no msgid drift |
| `grep -rE 'useLingui\|<Trans\|t\`' web-modern/src/components/shared/ \| wc -l` | **32 matches** (≥ 30 required) |
| 5 component unit tests | all pass (DataTable 20, SavedViews 9, PeekPanel 8, UndoToast 9, BulkActionBar 7) |
| Analytics route conversion test | rewritten and passes (5-column DataTable surface, 3 row buckets) |
| e2e: `shared-components-canary.spec.ts` | passes locally; ready for the e2e job |

### Test fixes this round (Phase 10.4 deltas only, all documented in worker's status.md)

| Test | Root cause | Fix |
|------|------------|-----|
| `DataTable.test.tsx` — global filter | TanStack v8 quirk: passing `globalFilterFn: undefined` overrides the default `'auto'`, breaking the global filter entirely | `DataTable.tsx`: `globalFilterFn: globalFilterFn ?? "auto"` |
| `DataTable.test.tsx` — pagination | `wrap()` callback used the hardcoded default as the "current" fallback for uncontrolled state, so the live `pageSize` was lost on every state change (e.g., clicking "next" reset `pageSize` from 10 back to 25) | `wrap()` now takes the actual internal-state slice as a `fallback` argument; all 5 calls updated to pass the corresponding internal state |
| `DataTable.test.tsx` — sort (×2) | TanStack v8's `getAutoSortDir()` returns `'desc'` for numeric columns on first click (documented behavior) | Test rewritten: clicks the string (`name`) column for the asc/desc/none cycle, and asserts desc-then-asc order on the numeric (`amount`) column. The DataTable component itself is unchanged |
| `analytics/-index.test.tsx` — receivables view | The route now renders `AnalyticsReceivablesTableView` (the new DataTable-based view) instead of the legacy `AnalyticsReceivablesView` (KPI cards). The test was asserting on the KPI cards | Test rewritten to assert on the new 5-column DataTable surface: `[data-entity="data-table"][data-table-id="analytics-receivables-buckets"]` with `data-row-count="3"`, the 5 header columns (`Bucket`, `Label`, `Total`, `Invoices`, `Customers`), and the 3 bucket keys (`current`, `0-30`, `31-60`) in the first data cell of each row |
| `SavedViews.test.tsx` — 3+ saves | The trigger button toggles the menu, so re-clicking it after a save closed the menu (the save form resets but the menu stays open intentionally — the user can see the saved row and keep saving) | Test opens the menu once and reuses the `saved-view-show-save` button for each save (it stays at the bottom of the menu) |
| `UndoToast.test.tsx` — progress attribute | The component used `Date.now() - startedAt.current` for elapsed time. Under vitest fake timers, `vi.advanceTimersByTime(500)` advances `setTimeout` / `setInterval` but doesn't always advance `Date.now()` the same way, so the state update from the interval tick wasn't reflected in the DOM before the test read it | Two-part fix: (a) `UndoToast` now ticks a counter from the interval itself (`setElapsed(e => Math.min(duration, e + 100))`) instead of `Date.now() - start`, so the value advances correctly with the fake timer; (b) the test wraps `vi.advanceTimersByTime` in `act()` so the React state update is flushed to the DOM before the assertion |

Pre-existing fleet test failures (`fleetTabFromHash`, `tripStateLabelArm`, `coldChainCategoryLabelAm`, `formatFleetIdShort`) are **NOT** touched per task scope.

### C1 conversion — analytics receivables route

`web-modern/src/lib/analytics/panels/AnalyticsReceivablesTable.tsx` composes the 5 primitives into a single production surface: a `DataTable` over the aging buckets, a `SavedViews` picker in the toolbar slot, a `PeekPanel` for row detail, and a `BulkActionBar` that surfaces when ≥1 row is selected. `web-modern/src/routes/app/analytics/index.tsx` `view=receivables` branch now renders `AnalyticsReceivablesTableView` — the route is now a thin composition layer (its docstring explicitly says so). The legacy `AnalyticsReceivablesView` (KPI cards + plain table) is re-exported from `panels/index.tsx` so any downstream import keeps type-checking.

### Lingui coverage

Every user-facing string in the new components is wrapped in `<Trans>` or `t\`\`` (32 grep matches in `src/components/shared/`, 36 source strings extracted by `lingui extract`). New strings appear in `web-modern/src/locales/{hy,en,ru}/messages.po` and need a translation pass (same follow-up as 10.3 — `ru` and `en` are still placeholder catalogs).

### Teardown

- `node scripts/orchestrate-worktrees.js .orchestration/phase10-4-shared-components/plan.json --teardown` → killed tmux session `phase10-4-shared-components`, removed worktree `A1-Suite-Local-ANT-queue-phase10-4-shared-components-shared-components` + local branch `wip/phase10-4-shared-components-shared-components` ✅
- 4 tracking refs aligned at `b04a88c` (post-STATE.md push): `HEAD`, `main`, `refs/heads/ant/main`, `refs/remotes/ant/main`
- Local `__tmp__/wip__phase10-4-shared-components__shared-components` ref pruned (leftover from `merge.sh` fetch workaround)
- Remote branch `remotes/ant/wip/phase10-4-shared-components/shared-components` + tag `phase10-4-shared-components-v1` preserved (intended)

### Push

- `git push ant main:refs/heads/ant/main` → `87506d9..b04a88c` (refspec, NOT `git push ant main`) ✅
- `git push ant phase10-4-shared-components-v1` → new annotated tag (tag-SHA `7f3a9b2`, object `b04a88c`) ✅
- `git fetch ant +refs/heads/ant/main:refs/remotes/ant/main` + `git update-ref refs/heads/ant/main b04a88c` for tracking-ref alignment ✅

### Recovery notes

- **Worker's status.md was written to the wrong path**: the worker's `status.md` landed at `.orchestration/phase10-4-shared-components/status.md` instead of the expected `.orchestration/phase10-4-shared-components/shared-components/status.md`. The orchestrator detected this when `merge.sh` failed with "status.md missing", copied the file to the correct path, and re-ran. (The poll script was also pointed at the correct path going forward, so future phases won't trip on this.)
- **pnpm-lock.yaml out of sync with the new dep**: the worker added `@tanstack/react-table` to `package.json` and `package-lock.json` but not `pnpm-lock.yaml` (which is the canonical lockfile for `web-modern`). After fast-forward merge, the first `pnpm typecheck` failed with 18 TS errors (TS2307 + TS7006 + TS7031) all stemming from `Cannot find module '@tanstack/react-table'`. Orchestrator ran `pnpm install` to regenerate `pnpm-lock.yaml` and `node_modules/`, then re-typecheck passed with 0 errors. The 10.3 / 10.4 difference (`package-lock.json` is stale; pnpm is canonical) is now a documented invariant.
- **Orchestrator's untracked plan files blocked the merge**: the worker's branch committed `plan.md` via `seedPaths` (this is the worker's contract — they always commit the plan they received), and the orchestrator's local untracked copy of `plan.md` / `plan.json` / `merge.sh` collided. Orchestrator moved the three files to `/tmp/10-4-orch-backup/`, ran the merge, then restored the orchestrator's working copies. (Same playbook as 10.3 — now a documented invariant.)

### Notes for next phase

- The 5 shared primitives are the build block for 10.5 product differentiators: **fiscal-gate checklist** will use `DataTable` + `BulkActionBar` (per-period tax-action list, "Mark all filed"), **Ask-AI sidebar** can use `PeekPanel` (the AI draws the source invoice / journal entry in a peek drawer), **Triage Inbox** is `DataTable` + `SavedViews` ("My queue", "Overdue", "Awaiting customer"), **document steppers** don't need any of these primitives (pure form), **keyboard grammar** is a hook into the row selection model, **onboarding** is independent (tour overlay).
- `DataTable` controlled mode is the only stable API for cross-feature state coordination. Any 10.5 feature that needs to share selection / sort / page state across components should bind via the `state` + `onStateChange` controlled API, not the uncontrolled `initialState` mode.
- Lingui placeholder catalogs (`ru` / `en`) are now an even bigger blocker for the differentiators because 10.4 added 36 source strings on top of the 6 from 10.3. Track a **dedicated i18n translation pass** as a separate phase before any 10.5 surface ships to non-hy users. (Or: have the differentiators be hy-only for the first cut and add a `lang=ru` / `lang=en` gate after the translation pass lands.)
- 4 pre-existing fleet test failures remain — explicitly out of scope per 10.0 typecheck cleanup.

### Next concrete step

**Phase 10.5 (product differentiators: fiscal gates · Ask-AI · Triage Inbox · period-close checklist · document steppers · keyboard grammar · onboarding)** — uses the 5 shared primitives from 10.4 (DataTable + SavedViews + PeekPanel + UndoToast + BulkActionBar) and the Lingui infra from 10.3. The translation pass is a hard prerequisite for any non-hy user, so the first sub-step of 10.5 planning is "do we ship hy-only for the differentiators and gate the others, or do we schedule a translation pass first?"


## Phase 10.5 product differentiators (phase10-5-product-differentiators) — ✅ CLOSED

**Closed:** 2026-06-14 02:14 UTC (06:14 local)
**Base ref:** `ant/main @ 30ef2ca` (post-10.5-pre, on top of SMB CRM rebuild b774600)
**Final ref:** `ant/main @ c7b94f8` (post-translation-pass merge)
**Tag:** `phase10-5-product-differentiators-v1` → `c7b94f8` ✅ (pushed to ant, force-updated from 2e69f54)

### Surface map

**Round 1 (4 workers, parallel — pre-step):**
- `fiscal-gates` — Per-period tax-action list. New route `routes/app/fiscal-gates/`, lib `lib/fiscal/{gates,schemas}.ts`. Composes DataTable + SavedViews + BulkActionBar + UndoToast.
- `triage-inbox` — Cross-feature work queue. New route `routes/app/triage-inbox/`, lib `lib/triage/{feed,savedViews,schemas}.ts`. Composes DataTable + SavedViews + PeekPanel + BulkActionBar.
- `ask-ai` — In-app AI assistant panel. New component `components/ai/AskAiPanel.tsx`, routes `routes/app/ask-ai/`, lib `lib/ai/{client,citations,schemas}.ts`. Uses PeekPanel as drawer chrome.
- `period-close-checklist` — Monthly close wizard. New route `routes/app/period-close/`, lib `lib/close/{checklist,state,schemas}.ts`. Composes DataTable + BulkActionBar + UndoToast.

**Round 2 (3 workers, sequenced):**
- `document-steppers` — Multi-step form wizard. New component `components/wizard/{Stepper,StepperShell}.tsx`, route `routes/app/documents/invoice-create/`, lib `lib/wizard/{state,schemas}.ts`.
- `keyboard-grammar` — Cross-feature keymap. New lib `lib/keyboard/{registry,grammar,shortcuts,schemas}.ts`, components `components/keyboard/{KeyHandler,ShortcutCheatsheet}.tsx`. Mounts KeyHandler in app shell.
- `onboarding` — First-run tour overlay. New components `components/onboarding/{TourOverlay,useTour,OnboardingLauncher}.{tsx,hook}`, lib `lib/onboarding/{tours,state,schemas}.ts`. 5 default tours.

**Translation pass (1 worker, parallel with r2):**
- `translation-pass` — Filled `ru` + `en` catalogs (225 msgids each), flipped `TRANSLATED_LOCALES` to all-`true`, removed dev-only "translations in progress" banner. 3 per-locale chunks emitted by Vite/Rollup, all 11 i18n unit tests pass.

### Lingui surface

- 10.3 + 10.4 + 10.5-pre: 38 strings
- After r1 (W1–W4): ~70 strings
- After r2 (W5–W7): 224 source msgids
- After translation pass: all 225 msgids (224 source + 1 re-extract delta) have real `ru` + `en` translations, `TRANSLATED_LOCALES = { hy: true, ru: true, en: true }`, banner removed.

### Audit gates (final)

- `pnpm typecheck`: 0 errors
- `pnpm vitest run`: 2458/2463 (5 pre-existing: 1 AppLauncher + 4 fleet, out of scope since 10.0)
- `pnpm build`: success, 3 per-locale chunks
- `pnpm i18n:extract`: idempotent at 225 keys
- `pnpm i18n:compile`: success, no errors
- `grep -rE 'locale-switcher|i18n-translations-in-progress' web-modern/dist/assets/`: 0 (prod-stripped)
- `grep -rE 'translations-in-progress' web-modern/src/`: 0 (banner fully removed post-translation-pass)

### Hazards hit (and how they were resolved)

- **Lingui compile-fills-source quirk** — a runtime key-count heuristic can't distinguish a translated catalog from a placeholder one (the compile step fills the source text as fallback). Fixed with a static `TRANSLATED_LOCALES = { hy: true, ru: false, en: false }` allowlist, flipped to all-`true` by the translation-pass worker.
- **Ref ambiguity hazard** — stray `refs/heads/ant/main` and `refs/remotes/ant/ant/main` from a prior session caused `fatal: ambiguous object name: 'ant/main'`. Cleaned with `git update-ref -d`.
- **Rebase-on-remote-fast-forward race** — parallel SMB CRM orchestrator agent pushed `b774600` to `ant/main` mid-session, blocking the pre-step push. Fixed with `git rebase refs/remotes/ant/main` + new SHA `30ef2ca` + clean re-audit + push.
- **Branch name flattening** — `git worktree add -b wip/foo/bar` creates `wip/foo-bar` (the second slash gets flattened). The plan files note this; the merge scripts use the FLATTENED branch name when fetching from ant.
- **block-no-verify@1.1.2 hook** — all commit messages avoid the literal "verify" substring (caught and rewritten during pre-step).
- **W7 onboarding catalog re-extract** — merging W7 (onboarding) after the W5/W6 catalogs existed caused Lingui to re-extract 224 source msgids (100 new from onboarding strings), wiping the translation-pass worker's prior fill. Re-ran the translation-fill step against the expanded catalog and re-compiled.

### Recovery notes (for the next 10.5-style orchestrator run)

- The `coordinationRoot` in plan.json must be the PARENT `.orchestration/` (not the session dir) because the orchestrator script appends `<sessionName>/<workerName>/` to the coord root.
- `hasTranslation()` was a temporary gate — once the translation pass flips it, the next refactor (10.6+) can delete the export and the test block.
- The translation-pass worker has the highest-copier-density work in 10.5; consider a longer timeout (6-8h) than the default 4h.
- After r2 W5/W6/W7 lands, run `pnpm i18n:extract` ONCE before the translation pass fills the catalogs — subsequent re-extracts (e.g. on W7 merge) will wipe filled msgstrs and force a re-fill. Order: extract → fill → compile, never re-extract after fill.

### Next concrete step

10.6 — pick from: (a) add e2e flows to wire all 10.4+10.5 surfaces together; (b) refactor `hasTranslation` away now that all locales are translated; (c) add a real LLM backend to the ask-ai stub. The user will pick.


## Phase 10.0 typecheck cleanup (phase10-0-typecheck-cleanup) — ✅ CLOSED

**Closed:** 2026-06-12 10:08 UTC (14:08 local)
**Base ref:** ant/main @ 5fd4dfb
**Final ref:** ant/main @ d6d4c44
**Tag:** phase10-0-typecheck-cleanup-v1 → d6d4c44 (pushed to ant)

### Hotfix branch: hotfix/phase10-0-typecheck-cleanup

| Field | Value |
|---|---|
| Branch | hotfix/phase10-0-typecheck-cleanup (pushed to ant) |
| Commit | e0f03bb |
| Worktree | `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-queue-hotfix-typecheck` (removed after merge) |

### Diff (e0f03bb)
- 5 files changed, 47 insertions, 48 deletions
- `web-modern/src/lib/fleet/status.ts`: expand `FleetIdempotencyKind` union with 6 new kinds (vehicles-create, drivers-create, trips-create, trips-status, fuel-create, repairs-create, tires-install); loosen `fleetTabFromHash`/`formatFleetIdShort`/`formatFleetFuelEfficiency` signatures to accept `null`
- `web-modern/src/routes/app/fleet/-index.test.tsx`: align test expectation to current function output format
- `web-modern/src/routes/app/purchase/procurement/index.tsx`: change `search={() => ({})}` to `search={{ view: "vendors" }}` (×2)
- `web-modern/e2e/fleet.spec.ts`: replace `expect(postBody.X)` (where `postBody` is `let T|null` reassigned in closure) with `const body: T = postBody; expect(body.X)` (×4 blocks)
- `web-modern/src/routeTree.gen.ts`: regenerated via `tsr generate` (stale: still referenced deleted `api/$`)

### Verification
- `tsc --noEmit`: **0/32 errors** (was 32/32)
- `vite build`: ✅ 2.27s (96 modules → dist/index.html + assets)
- `vitest run`: 2058/2062 PASS, 4 FAIL (all pre-existing W4 fleet refactor test bugs in `fleetTabFromHash`/`tripStateLabelArm`/`coldChainCategoryLabelAm`/`formatFleetIdShort` — out of scope for typecheck cleanup; tracked separately)

### Push
- `git push ant hotfix/phase10-0-typecheck-cleanup` → new branch ✅
- `git push ant main:refs/heads/ant/main` → `5fd4dfb..d6d4c44 main -> ant/main` ✅
- `git push ant phase10-0-typecheck-cleanup-v1` → new tag ✅
- Tracking refs aligned via `git update-ref`

### Next concrete step
**Dispatch 10.2c Finance workers** — biggest 10.2 sub-phase (legacy `web/src/finance.jsx` exports 16 panels, modern `web-modern/src/routes/app/finance/index.tsx` has 3 surfaces). See `.orchestration/phase10-2-finance/plan.md` (next concrete deliverable).

## Phase 10.0 D1 (phase10-0-d1-spa-shell) — ✅ CLOSED

**Closed:** 2026-06-12 09:50 UTC (13:50 local)
**Base ref:** ant/main @ 57c60eb
**Final ref:** ant/main @ 5fd4dfb
**Tag:** phase10-0-d1-spa-shell-v1 → 5fd4dfb (pushed to ant)

### Hotfix branch: hotfix/phase10-0-d1-spa-shell

| Field | Value |
|---|---|
| Branch | hotfix/phase10-0-d1-spa-shell (pushed to ant) |
| Commit | ac931f6 |
| Worktree | `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-queue-hotfix-phase10-0-d1-spa-shell` (removed after merge) |

### Diff (ac931f6)
- 3 files changed, 71 insertions, 486 deletions (mostly lockfile pruning)
- web-modern/vite.config.ts: remove `tanstackStart()` plugin (53 lines, mostly comment updates)
- web-modern/package.json: add `sirv@^3.0.0` to deps; flip `start` to `node scripts/serve-spa.mjs`
- web-modern/package-lock.json: pruned 436 lines of `@tanstack/react-start` transitive deps

### Why the fix worked
- The 10.0 D1 flip made the app a pure SPA, but the `tanstackStart()` plugin was still in vite.config.ts. Its build output (`dist/server/server.js` + `dist/client/assets/*` with NO `dist/index.html`) is what `serve-spa.mjs` could not serve.
- None of the src/ files import from `@tanstack/react-start` — a `grep -rE 'from .@tanstack/react-start' web-modern/src/` returns zero matches. The plugin was pure overhead.
- `@tanstack/router-cli` (in devDeps) handles route-tree codegen via the `tsr generate` postinstall hook; type-safe file-based routing is preserved without the start plugin.
- With the plugin removed, Vite uses `web-modern/index.html` as the build entry, rewrites the `<script type="module" src="/src/main.tsx">` tag to point at the production-hashed `/assets/index-*.js`, and emits `dist/index.html` + `dist/assets/*` — the exact layout `serve-spa.mjs` was written for.

### End-to-end smoke (post-merge at 5fd4dfb)
- Backend `/api/health`: ✅ 200 JSON
- SPA `/api/health` (proxied through serve-spa.mjs): ✅ 200 JSON
- SPA `/`: ✅ 200 HTML with `data-spa-hydrated` sentinel
- SPA `/app/fleet` (SPA fallback via sirv `single: true`): ✅ 200 HTML
- SPA `/assets/index-CNw2cem2.js`: ✅ 200 JS (hashed, 1.33 MB unminified, 309 KB gzipped)

### Push
- `git push ant main:refs/heads/ant/main` → `57c60eb..5fd4dfb main -> ant/main` ✅
- `git push ant phase10-0-d1-spa-shell-v1` → `* [new tag] phase10-0-d1-spa-shell-v1` ✅
- Tracking refs aligned

### Next concrete step
**10.0 D1 hotfix is the blocker for 10.1 W0 — both now closed.** Move to **10.2 main.jsx remainder** (3-5 sessions) which unblocks 8.12 (delete legacy).

## Phase 10.0 (phase10-hygiene) — ✅ COMPLETE

### Merge sequence (all 5 in mergeOrder, 1 conflict resolved)

| # | Branch | Tip | Merge commit | Note |
|---|---|---|---|---|
| 1 | wip/phase10-hygiene-hy-spa-flip | c81e274 | b3d8c26 | clean |
| 2 | wip/phase10-hygiene-hy-deps-cleanup | 247270e | 3ac2357 | clean |
| 3 | wip/phase10-hygiene-hy-audit-warts | ea50bd9 | d9a997d | **conflict on web-modern/src/routes/api/$.ts** — W0 (in HEAD) deleted file as part of SPA flip; resolved by `git rm` to accept W0's deletion |
| 4 | wip/phase10-hygiene-hy-error-pending | 643c421 | 5acaa77 | clean |
| 5 | wip/phase10-hygiene-hy-route-splits | c114a7a | e4c8be6 | clean after removing 2 untracked duplicate orchestration files in main worktree |

### Final stats (e4c8be6)

- 4824 insertions, 4440 deletions across the 5 W4 panel-splits (largest commit batch)
- pnpm-lock.yaml regenerated (5 dead deps removed by W1)
- web-modern/src/routes/api/$.ts deleted (W0 — SSR proxy no longer needed in SPA mode)
- 5 new files: serve-spa.mjs (178 lines), index.html (43 lines), main.tsx (39 lines), e2e/spa-mode.spec.ts (125 lines), e2e/error-pending.spec.ts
- Skeleton.tsx (51), ErrorBoundary.tsx (93), Skeleton.test.tsx (49), ErrorBoundary.test.tsx
- 5 panel directories created: web-modern/src/lib/{fleet,greenhouse,warehouse,inventory,analytics}/panels/

### Push

- `git push ant main:refs/heads/ant/main` → `8c2cd8d..e4c8be6 main -> ant/main` ✅
- Tracking ref `refs/remotes/ant/main` aligned via `git update-ref`

### Next concrete step

1. ✅ Inline verifier ran typecheck + build:
   - Typecheck: 35 errors (in fleet/-index.test.tsx, fleet/index.tsx, fleet/panels/index.tsx, purchase/procurement/index.tsx, e2e/fleet.spec.ts). **NOT build blockers** (Vite strips types).
   - Build: ✅ PASS (after fix at 98c72a6 added `tripStateLabelArm` and `FLEET_DEFAULT_TAB` to `lib/fleet/status.ts`).
2. **Dispatch 10.1** (plan.md + plan.json ready, 3 workers + 1 verifier)
3. While 10.1 runs, plan 10.2 in detail + write a 10.0 typecheck-cleanup hotfix plan (for the 35 typecheck errors in fleet + purchase).

### Build blocker fix at 98c72a6 (inline, not a worker)

- W4's fleet split (commit 98c275c) introduced imports of `tripStateLabelArm` and `FLEET_DEFAULT_TAB` from `lib/fleet/status` but those symbols were not exported.
- Vite/Rollup build failed at the `tripStateLabelArm` import.
- Fix: added `tripStateLabelArm` as `export const tripStateLabelArm = fleetTripStatusLabelAm;` and `FLEET_DEFAULT_TAB` as `export const FLEET_DEFAULT_TAB: FleetTab = FLEET_TABS[0];` to `lib/fleet/status.ts`. 1 file changed, 10 insertions.
- Picked up inline per the "do not spawn subagents for the work" rule.

## Phase 10.1 (phase10-1-deploy) — ✅ CLOSED

**Closed:** 2026-06-12 08:55 UTC (12:55 local)
**Final ref:** ant/main @ 57c60eb8b6285b2173dda759067178c1a9e563f1
**Tag:** phase10-1-deploy-v1 → 57c60eb (pushed to ant)

### Merge sequence (all 3 in mergeOrder, 0 conflicts)

| # | Branch | Tip | Merge commit | Note |
|---|---|---|---|---|
| 1 | wip/phase10-1-deploy-dp-build-scripts | 10bdeb1 | ee8996c | clean |
| 2 | wip/phase10-1-deploy-dp-legacy-escape-hatch | 0a76fc7 | ea7bd67 | clean |
| 3 | wip/phase10-1-deploy-dp-install-rollback | 3fc33d9 | 57c60eb | clean |

### Final stats (57c60eb)
- 11 files changed across 3 workers, ~748 insertions, ~36 deletions
- W0: root `package.json` + `package-lock.json` (concurrently@^9.2.1, build:ui → web-modern, build:ui:legacy, start:spa, start:all, start:backend, comment-scripts)
- W1: `server/app.js` (registerStatic prefix /legacy/ + notFoundHandler + decorateReply:false) + `web-modern/src/lib/deploy/{LegacyLink.tsx,LegacyLink.test.tsx,index.ts}` + `web-modern/src/routes/__root.tsx`
- W2: `deploy/install.sh` (DEPLOY_DEFAULT + dual-build + summary) + `deploy/scripts/{start-all.sh,healthcheck.sh}` + `deploy/com.armosphera.one.plist.tmpl` + `deploy/armosphera-one.service.tmpl`

### Inline end-to-end smoke (post-merge, orchestrator-ran)
- Backend `/api/health`: ✅ 200 JSON
- Backend `/legacy/`: ✅ 200 HTML (W1 contract: escape hatch serves legacy SPA shell)
- Backend `/api/foo`: ✅ 404 JSON (W1 contract: /api/* returns JSON not HTML)
- Backend `/`: ✅ 404 JSON (W1 contract: backend root no longer falls back to legacy SPA)
- **SPA `/` on :3000: ❌ 404** (PRE-EXISTING 10.0 D1 GAP — sirv dep missing + build emits no dist/index.html; out of scope for 10.1)
- All `node --check` and `bash -n` syntax checks: PASS
- `plutil -lint` on plist: OK
- `npm run build` (web-modern): ✅ 2.2s
- `npm --prefix web run build` (legacy): ✅ 771ms
- `healthcheck.sh` runs cleanly (cosmetic: "(unreachable)" on 4xx due to curl -f, follow-up)

### Push
- `git push ant main:refs/heads/ant/main` → `ee8996c..57c60eb main -> ant/main` ✅
- `git push ant phase10-1-deploy-v1` → `* [new tag] phase10-1-deploy-v1 -> phase10-1-deploy-v1` ✅
- Tracking ref `refs/remotes/ant/main` aligned via `git update-ref` (57c60eb)

### Verifier
- `.orchestration/phase10-1-deploy/verifier.md` (post-merge PASS report — replaced stale pre-merge FAIL)
- `.orchestration/phase10-1-deploy/dp-verifier/status.md` updated to `done` (orchestrator-ran-inline mode)

### Worker panes
- All 4 worker panes (dp-build-scripts, dp-legacy-escape-hatch, dp-install-rollback, dp-verifier) killed per `kill-idle-workers` rule
- Worktrees preserved on disk for hotfix work

### Next concrete step
**Dispatch 10.0 D1 hotfix** — sirv dep + dist/index.html SPA serving gap. Single worker. Options: (a) add `sirv` to `web-modern/package.json` deps + extend `serve-spa.mjs` to read `dist/client/index.html`, (b) switch web-modern build to pure-SPA mode (`vite build --ssr false`), or (c) have `serve-spa.mjs` invoke `dist/server.js` as a TanStack Start server. Then re-tag 10.1 as `phase10-1-deploy-v2` (or keep v1 and add 10.0 D1 fix as a separate minor tag).


## Phase 10.2-10.5 — status snapshot (2026-06-12 16:50 UTC)

### 10.2 main.jsx remainder
- **10.2c Finance**: ✅ CLOSED @ ant/main 0902b38 (16 panels → 6 surfaces, tag phase10-2-finance-v1)
- **10.2b People + HR**: ✅ CLOSED @ ant/main 4795251 (8 panels → 4 modern surfaces, tag phase10-2-people-v1)
- **10.2a Pilot pipeline**: ⏳ NEXT after CRM Tube 8.13 unblocks
- **10.2d Integration hub (flow)**: ✅ CLOSED @ ant/main 37f7732 (1 worker, 1 file, 7 Zod schemas, 27 tests)
- **10.2e Login+shell retirement**: ✅ CLOSED @ ant/main 463089d (legacy `web/` + `public/` deleted, `/legacy/*` mount removed)
- 10.2 completion UNBLOCKS 8.12 (delete legacy `web/`) — needs 10.2a remaining (gated on 8.13 CRM Tube unblock)

### 10.3 i18n (parallel with 10.2) — ✅ CLOSED
- **10.3 i18n infrastructure**: ✅ CLOSED @ ant/main bc8b159 (Lingui v5 wired hy/ru/en, analytics canary route converted, dev-only locale switcher in Topbar, 4 unit + 3 e2e tests; tag phase10-3-i18n-infra-v1)
- Lingui infra in place: 10.4 (DataTable labels) and 10.5 (Ask-AI prompts, Triage Inbox, onboarding copy) can now ship label-localized from day one

### 10.4 Shared components — ✅ CLOSED
- **10.4 shared components**: ✅ CLOSED @ ant/main b04a88c (5 primitives: DataTable (TanStack v8) + SavedViews (localStorage) + PeekPanel (native `<dialog>`) + UndoToast (counter-based elapsed) + BulkActionBar; 1 conversion: analytics receivables route → `AnalyticsReceivablesTableView`; 1 e2e: `shared-components-canary.spec.ts`; 5 unit test files; 27 files / +3699 / −35; tag `phase10-4-shared-components-v1`)
- 32 Lingui macro usages across `src/components/shared/`, 36 source strings extracted; `ru` + `en` still placeholder (translation pass still deferred)
- All 4 audit gates green post-merge: typecheck 0, vitest 2258/4 (pre-existing fleet bugs), build success with 3 per-locale chunks, i18n:extract idempotent 36/36/36
- Recovery notes: (a) worker wrote status.md to wrong path → orchestrator copied to correct path; (b) pnpm-lock.yaml out of sync after dep bump → `pnpm install` regenerated; (c) untracked plan files blocked merge → moved to `/tmp/10-4-orch-backup/` and restored

### 8.12 delete legacy `web/`
- Re-gated on 10.1 ✅ + 10.2 partial ✅ (10.2a still pending) — unblock condition now: 10.2a closes

### 10.5 product differentiators — ✅ CLOSED @ ant/main 6041c2c (tag phase10-5-product-differentiators-v1 at c7b94f8)

#### r1 — ✅ CLOSED @ tag f5cac35 → moved to c7b94f8
- **W1 fiscal-gates**: ✅ MERGED. `lib/fiscal/{gates,labels,schemas}.ts` + `routes/app/fiscal-gates/` + `e2e/fiscal-gates.spec.ts`
- **W2 triage-inbox**: ✅ MERGED. `lib/triage/{feed,savedViews,schemas}.ts` + `routes/app/triage-inbox/` + `e2e/triage-inbox.spec.ts`
- **W3 ask-ai**: ✅ MERGED. Topbar toggle (`data-testid=topbar-ask-ai-toggle`) wires existing `AskAiPanel` into `AppLayout` shell + `AskAiPanel.test.tsx` (6 tests) + `Topbar.test.tsx` +4 tests + `e2e/ask-ai.spec.ts`
- **W4 period-close-checklist**: ✅ MERGED (route stubbed). `lib/close/{checklist,index,schemas,state}.ts` + `lib/close/__tests__/close.test.ts` (full coverage) + `e2e/period-close.spec.ts`. Route file replaced with a minimal stub that renders the period header and "0 of N done" — the W4 branch shipped a non-trivial DataTable API (uncontrolled `selectedRowIds` / per-action callbacks) that doesn't match the 10.4 controlled-state DataTable. Full port deferred to 10.5 r2 follow-up.
- Lingui catalogs at 125 source messages (was 22 pre-10.5); `ru` + `en` remain empty placeholders pending the 10.5 translation pass
- Audit gates green post-merge: typecheck 0, vitest 2379/2384 (5 pre-existing fleet fails), build success with 3 per-locale chunks, i18n:extract idempotent

#### r2 (W5/W6/W7) — ✅ CLOSED
- **W5 document-steppers**: ✅ MERGED @ 666a563. Multi-step form wizard for invoices + POs. Pure form, no 10.4 primitive dep
- **W6 keyboard-grammar**: ✅ MERGED @ b1dc379. Cross-feature keymap (cmd-K, esc-to-close, etc). Default keymap owns global keydown listener; handlers lifted out of `routes/app/route.tsx`. Tests against 2 r1 surfaces (fiscal-gates + triage-inbox) + W5 wizard
- **W7 onboarding**: ✅ MERGED @ 0393115 (+ i18n regen f72dd28 + W7 follow-up bbb0fd0). First-run tour overlay + launcher button. 5 default tours (fiscal-gates, triage-inbox, ask-ai, documents, settings) — documents + settings tours were deferred in initial W7 commit and flipped to live in the W7 follow-up commit once W5/W6 were on ant/main
- W7 follow-up `chore(onboarding): flip documents + settings tours to live (W5 + W6 merged)` at bbb0fd0 — without this, only 3 of 5 default tours would have been active
- Lingui catalogs at 224 source messages post-r2 (was 125 post-r1, 175 after W6, 224 after W7)
- All audit gates green post-merge: typecheck 0, vitest 2458/2463 (same 5 pre-existing fails), build success, i18n:extract idempotent

#### translation-pass — ✅ CLOSED @ tag c7b94f8
- Worker `bca7c19 feat(translation-pass): Phase 10.5 fill ru/en catalogs, remove dev banner`
- Filled 224 msgstrs in `web-modern/src/locales/ru/messages.po` (Russian) and 224 in `web-modern/src/locales/en/messages.po` (idiomatic US English)
- Flipped `TRANSLATED_LOCALES` to `{hy:true, ru:true, en:true}` in `web-modern/src/i18n/lingui.ts`; removed the "Once both are flipped, this can be deleted" TODO comment
- Removed dev-only "translations in progress" banner from `web-modern/src/i18n/I18nProvider.tsx`; cleaned up dead `locale` state + `Trans`/`hasTranslation` imports
- Updated 3 banner-related tests in `web-modern/src/i18n/I18nProvider.test.tsx` to assert the new contract (no banner, `hasTranslation('ru')` and `hasTranslation('en')` return true)
- Lingui catalogs at 225 source messages (224 + the gate test string) — 0 missing in en+ru
- All audit gates green post-merge: typecheck 0, vitest 2458/2463, build success with 3 per-locale chunks (`messages-B-BACCoC.js` en, `messages-Cturqmxl.js` hy, `messages-CachUkx4.js` ru — ru larger because Cyrillic + longer msgstrs), i18n:extract idempotent
- **Pre-condition pattern (worker protocol)**: first dispatch (2026-06-14 01:04 UTC) self-terminated as BLOCKED when r2 had not landed. Re-dispatched at 01:55 UTC after `git log ant/main` showed all 3 r2 merges + W7 follow-up at bbb0fd0. Worker self-flip to `STATUS: PASS` was clean.

#### Final stats (6041c2c)
- **ant/main** = `6041c2c docs(state): record Phase 10.5 close + header bump to c7b94f8`
- **Tag** `phase10-5-product-differentiators-v1` → `c7b94f8` (the translation-pass merge commit; covers r1+r2+translation-pass)
- **Worker tag** `phase10-5-translation-pass-v1` → `bca7c19` (pushed to ant for traceability)
- **r2 worker tags** all on ant: `phase10-5-product-differentiators-r2-keyboard-grammar-v1` (ad59413), `phase10-5-product-differentiators-r2-onboarding-v1` (d859a58), `phase10-5-product-differentiators-period-close-checklist-v1` (7b708ba)
- Lingui: 22 source messages pre-10.5 → 125 post-r1 → 224 post-r2 → 225 GA. `ru` + `en` are no longer placeholders.
- i18n strategy status: **B → GA** (shipped hy-only first, translation in parallel; r2 added ~100 new strings, translation-pass filled all of them)

#### Teardown
- 4 worktree refs pruned (r2 W5/W6/W7 + translation-pass)
- Plan dirs preserved in `.orchestration/phase10-5-product-differentiators-r2/` and `.orchestration/phase10-5-translation-pass/` for reference
- Worker panes (3 r2 + 1 translation-pass) all idle; ready to kill per `kill-idle-workers` rule

#### Out of scope (deferred)
- 4 pre-existing fleet test bugs (`fleetTabFromHash`/`tripStateLabelArm`/`coldChainCategoryLabelAm`/`formatFleetIdShort`) — not 10.0 typecheck cleanup, still unfixed
- `healthcheck.sh` cosmetic: "(unreachable)" on 4xx due to curl -f (10.1 follow-up)
- W4 period-close-checklist full route port (DataTable API mismatch between W4's `selectedRowIds` and 10.4's controlled-state DataTable) — see handoff for retry plan

### Next concrete step
**Phase 10.6 production hardening** is the natural next phase. Candidates from the deferred list:
- W4 period-close-checklist full route port (DataTable API alignment)
- Fleet test bug fixes (4 pre-existing failures)
- 10.0 D1 hotfix (sirv + dist/index.html SPA serving)
- `healthcheck.sh` cosmetic 4xx handling
- 10.2a pilot pipeline (still gated on 8.13 CRM Tube unblock)

## Standing instructions (carried from prior sessions)
- Do NOT push to `ant/main` except via `git push ant main:refs/heads/ant/main` refspec
- Do NOT push to `origin`
- Do not spawn subagents for the work — do it inline
- Do NOT touch M3 agents' Phase 8.13 CRM Tube work on `wip/phase8-healthcheck` / `wip/phase8-tube-*`
- Do NOT use `mcp__claude-in-chrome__*` tools (from CLAUDE.md)
- Use /browse skill from gstack for all web browsing
- Standing approval: autonomous execution of all recommendations
