# Audit runtime — e2e suite at 879165b

**Run at:** 2026-06-15 04:36–04:39 UTC (00:36–00:39 local)
**Base ref:** `879165b` (= `ant/main` = `ant/integration/phase10-9-d`)
**Command:** `cd web-modern && NODE_OPTIONS=--max-old-space-size=2048 timeout 1500 pnpm playwright test --reporter=json`
**Result file:** `/tmp/phase10-10-audit-v2.json` (519 KB)

## Summary

| Metric | Value | Notes |
|---|---|---|
| Expected (pass) | **44** | matches wave-4 baseline at 4f6e17c (no regression) |
| Unexpected (fail) | **66** | matches wave-4 baseline at 4f6e17c |
| Skipped | 0 | |
| Flaky | 0 | retries=0 in this run (no `--retries` flag) |
| **Total tests** | **110** | |
| Wall-clock duration | **179.8 s = 3.0 min** | with 6 workers in parallel |
| Workers used | 6 | Playwright's default parallel mode |
| Pass rate | 40.0 % | |

**Verdict:** ✅ baseline preserved. No new failures introduced by the 10.9 (d) → 10.10 → STATE.md update → 56f4557 lineage. 44/110/66 holds.

## Infra state at run time

- **Fastify backend** on `:4100` — **PID 35308**, started fresh from `server/index.js` of this repo (NOT the stale `:4100` from a different A1-Suite-Local-ui-phase5-r1-merge checkout that was there from a previous M2 session). Killed stale `PID 69950` before starting fresh.
- **Vite dev server** on `:4173` — **PID 23436**, started via `nohup pnpm dev --port 4173 --host 127.0.0.1`. Carried over from a prior step.
- **Playwright webServer**: `null` in config (Vite managed externally; Fastify not auto-started). The config comment at `playwright.config.ts:120` explains this is intentional because of cold-start flakiness with `pnpm dev` + `webServer`.

**Pitfall learned (must remember for future audits):**
> Always check `:4100` for stale processes from other repos before running the audit. A stale Fastify from a sibling checkout will respond to `/api/login` with `{"ok":true,"user":{...}}` **without** a `sid` field, causing the test helper at `e2e/_helpers.ts:35` to throw `login response missing sid` for every login-required test. The first audit run on this phase produced 5/110 (5 specs that don't need login) and looked like a regression — it was just a stale process.

## Per-file breakdown (sorted by pass count desc)

| File | Pass | Fail | Notes |
|---|---:|---:|---|
| `apps.spec.ts` | 17 | 2 | mostly all-pass; 2 individual fails to triage |
| `triage-inbox.spec.ts` | 4 | 0 | **all-pass** — full @smoke coverage |
| `i18n-canary.spec.ts` | 3 | 0 | **all-pass** — full @smoke coverage |
| `state-integrations.spec.ts` | 3 | 0 | **all-pass** — full @smoke coverage |
| `error-pending.spec.ts` | 2 | 0 | **all-pass** — full @smoke coverage |
| `period-close.spec.ts` | 2 | 0 | **all-pass** — full @smoke coverage |
| `locale-switching.spec.ts` | 3 | 3 | mixed — per-spec @smoke |
| `fleet.spec.ts` | 2 | 7 | mixed — per-spec @smoke |
| `spa-mode.spec.ts` | 2 | 2 | mixed — per-spec @smoke |
| `fiscal-gates.spec.ts` | 1 | 4 | mixed — per-spec @smoke |
| `procurement.spec.ts` | 1 | 2 | mixed — per-spec @smoke |
| `shared-components-canary.spec.ts` | 1 | 2 | mixed — per-spec @smoke |
| `cfo-reports.spec.ts` | 1 | 0 | **all-pass** — full @smoke coverage |
| `compliance.spec.ts` | 1 | 0 | **all-pass** — full @smoke coverage |
| `crm-detail.spec.ts` | 1 | 0 | **all-pass** — full @smoke coverage |
| `document-steppers.spec.ts` | 0 | 9 | all-fail — see known-failures.md |
| `onboarding.spec.ts` | 0 | 8 | all-fail — see known-failures.md |
| `greenhouse.spec.ts` | 0 | 7 | all-fail — see known-failures.md |
| `assets.spec.ts` | 0 | 5 | all-fail — see known-failures.md |
| `ask-ai.spec.ts` | 0 | 4 | all-fail — see known-failures.md |
| `warehouse.spec.ts` | 0 | 4 | all-fail — see known-failures.md |
| `ai-onboarding.spec.ts` | 0 | 2 | all-fail — see known-failures.md |
| `export-docs.spec.ts` | 0 | 2 | all-fail — see known-failures.md |
| `cabinet.spec.ts` | 0 | 1 | all-fail — see known-failures.md |
| `healthcheck.spec.ts` | 0 | 1 | all-fail — see known-failures.md |
| `keyboard-grammar.spec.ts` | 0 | 1 | all-fail — see known-failures.md |
| **Total** | **44** | **66** | |

## The 44 smoke candidates (full list)

These are the specs that will receive the `@smoke` tag in task 2.

| # | File | Spec title |
|---:|---|---|
| 1 | apps.spec.ts | `crm → /app/crm/ renders "CRM"` |
| 2 | apps.spec.ts | `crm-tube → /app/crm-tube/ renders "Tube"` |
| 3 | apps.spec.ts | `smb-crm → /app/smb-crm/ renders "SMB CRM"` |
| 4 | apps.spec.ts | `finance → /app/finance/ renders "Finance"` |
| 5 | apps.spec.ts | `copilot → /app/copilot/ renders "Mission Control"` |
| 6 | apps.spec.ts | `desk → /app/desk renders "Desk"` |
| 7 | apps.spec.ts | `campaigns → /app/campaigns/ renders "Campaigns"` |
| 8 | apps.spec.ts | `projects → /app/projects/ renders "Projects"` |
| 9 | apps.spec.ts | `inventory → /app/inventory/ renders "Inventory"` |
| 10 | apps.spec.ts | `purchase → /app/purchase/ renders "Purchase"` |
| 11 | apps.spec.ts | `people → /app/people/ renders "People"` |
| 12 | apps.spec.ts | `docs → /app/docs/ renders "Docs"` |
| 13 | apps.spec.ts | `analytics → /app/analytics/ renders "Analytics"` |
| 14 | apps.spec.ts | `flow → /app/flow/ renders "Flow"` |
| 15 | apps.spec.ts | `forms → /app/forms/ renders "Forms"` |
| 16 | apps.spec.ts | `cfo → /app/cfo/ renders "CFO"` |
| 17 | apps.spec.ts | `fleet → /app/fleet/ renders "Fleet"` |
| 18 | triage-inbox.spec.ts | `default view, switch to Overdue, peek, bulk delete, undo` |
| 19 | triage-inbox.spec.ts | `peek panel: clicking a row opens the right-side preview without navigating away` |
| 20 | triage-inbox.spec.ts | `saved views: switching between default views changes the visible row count` |
| 21 | triage-inbox.spec.ts | `bulk resolve: selecting 2 rows and clicking Delete resolves both; Undo reverts both` |
| 22 | i18n-canary.spec.ts | `?lang=en — analytics route renders the source strings (en catalog is a placeholder)` |
| 23 | i18n-canary.spec.ts | `?lang=hy — analytics route renders under the source locale` |
| 24 | i18n-canary.spec.ts | `?lang=ru — analytics route mounts without throwing (ru catalog is a placeholder)` |
| 25 | state-integrations.spec.ts | `loads, renders the H1 + 6 adapter options + mode badge + back link, and is permissive in the e2e session` |
| 26 | state-integrations.spec.ts | `dispatch flow: selecting src + clicking dispatch POSTs /api/state-int/src/submitVat and renders the result card` |
| 27 | state-integrations.spec.ts | `audit panel: renders the audit block for an Owner session and the refresh button re-issues GET /api/state-int/audit` |
| 28 | error-pending.spec.ts | `notFoundComponent renders for an unknown route` |
| 29 | error-pending.spec.ts | `notFound home button is a working link back to /` |
| 30 | period-close.spec.ts | `open the wizard for June 2026, mark 2 done, 1 blocked, see summary update` |
| 31 | period-close.spec.ts | `prev / next period controls change the period id and label` |
| 32 | locale-switching.spec.ts | `default locale is hy and the switcher is visible in the Topbar` |
| 33 | locale-switching.spec.ts | `switching to en re-renders the UI: en is pressed and html[lang] is en` |
| 34 | locale-switching.spec.ts | `locale persists across reload via localStorage a1:locale` |
| 35 | fleet.spec.ts | `loads, renders the H1 + 7 tabs, defaults to Vehicles, and points back to /app/purchase` |
| 36 | fleet.spec.ts | `does not render the 403 card for a default authenticated user` |
| 37 | spa-mode.spec.ts | `GET / returns the SPA shell with a title` |
| 38 | spa-mode.spec.ts | `window.armospheraApp is undefined (legacy bundle NOT loaded)` |
| 39 | fiscal-gates.spec.ts | `renders the page header + current period chip + 10 seeded rows` |
| 40 | procurement.spec.ts | `does not render the 403 card for a default authenticated user` |
| 41 | shared-components-canary.spec.ts | `DataTable + SavedViews mount on the Receivables tab` |
| 42 | cfo-reports.spec.ts | `loads, paints the P&L with seeded accounts, and exposes Print` |
| 43 | compliance.spec.ts | `loads inside CFO, paints the panel, summary, status pill, and 5 seeded rows` |
| 44 | crm-detail.spec.ts | `list page paints quotes and first-row click opens detail` |

## Failure mode distribution (sampled from audit)

The 66 failures break down into the following error categories (top 5 from a sample of 20 failures):

| Error pattern | Count (sample) | Likely cause |
|---|---:|---|
| "Timeout: locator.waitFor()" | ~7 | UI element not appearing within 5s expect timeout |
| "Expected: visible" / "Expected element handle" | ~6 | DOM not matching test expectations (CSS / markup drift) |
| "Expected: to contain / toEqual" | ~5 | Content drift — text not matching frozen strings |
| "404 on /api/.../seed or /api/.../fixtures" | 1 | Missing fixture data — known issue (e2e needs a seeded :memory: db) |
| Other / unique | ~1 | Ad-hoc |

This distribution is informational only — the per-spec root-cause analysis belongs in `known-failures.md`.

## Retry counts

- This run used `retries: 0` (the config default for non-CI).
- The `test:e2e:full` script should preserve `retries: 0` locally and `retries: 2` in CI (already configured at `playwright.config.ts:42`).
- The `test:e2e:smoke` script should use `retries: 0` everywhere (smoke is the merge gate; flakiness is the signal).

## Per-spec duration (slowest 5 from the 44 passing)

These specs define the wall-clock floor for the smoke suite (the longest smoke spec dominates the smoke runtime):

| File | Spec | Duration |
|---|---|---:|
| warehouse.spec.ts | (the 4 passing — actually no passes in warehouse, swap) | — |
| (need to recompute — only the 44 passing are in scope) | | |

*Note: per-spec durations are in the audit JSON. Task 2 will use this when picking which specs to tag.*

## Carry-over notes for tasks 2-6

- **Tag 44 specs** with ` @smoke` suffix in the test title (mechanical edit; preserves test name).
- **Add scripts**: `test:e2e:smoke: "playwright test --grep @smoke"` + `test:e2e:full: "playwright test"`. The existing `test:e2e:smoke: playwright test apps.spec.ts` should be **renamed** to `test:e2e:apps` to avoid the name collision.
- **Split CI**: `.github/workflows/ci.yml` already has the right structure; the `e2e` job needs to be split into two jobs sharing setup. Plus a new `.github/workflows/e2e-full-nightly.yml` for the cron.
- **known-failures.md**: per-spec table covering all 66 failing tests with per-spec root-cause + deferral status.

## Next step

Open task 2 (tag-smoke): edit each of the 44 spec files in the table above to add ` @smoke` to the test title.
