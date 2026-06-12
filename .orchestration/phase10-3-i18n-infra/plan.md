# Phase 10.3 — i18n infrastructure (Lingui v5, hy+ru+en) + 1 canary route

**Base ref:** `ant/main @ 463089d` (10.2e — legacy build + /legacy/* escape hatch retired)
**Worker stream:** 1 (i18n-infra)
**Tag:** `phase10-3-i18n-infra-v1`
**Strategy:** Serialize 10.3 → 10.4. Phase 10.4 (shared components) will need i18n hooks in DataTable labels from day one, so the infra must land first.

## Goal

Introduce a working i18n pipeline so the next phase can use translated labels everywhere without churning the dependency graph or doing it piecemeal. End state of this phase:

1. **Lingui v5 wired in:** `web-modern/` depends on `@lingui/react`, `@lingui/core`, `@lingui/macro`, `@lingui/cli`. A `lingui.config.js` exists at `web-modern/lingui.config.js`. `.po` catalogs for `hy`, `ru`, `en` are populated (Armenian being the source of truth).
2. **Provider live in `main.tsx`:** `<I18nProvider>` wraps the app, and a dev-only locale switcher sits in `Topbar` (or behind a query-string flag) so engineers can flip the language without restarting Vite.
3. **One canary route fully converted:** `web-modern/src/routes/app/analytics/index.tsx` — every visible user-facing string uses `Trans` / `t\`\`` macros. Labels for the 5 view tabs ("Dashboard", "Receivables", "Metrics", "Snapshots", "Reports"), the page header, empty states, and the back-link text are all extracted. The route still builds, typechecks, and renders; `vitest` and `tsc` stay green.
4. **Build script additions to `web-modern/package.json`:** `i18n:extract` (`lingui extract`) and `i18n:compile` (`lingui compile`) — the compile step is run before `build` so production bundles contain the compiled messages.
5. **A e2e test that proves the canary route renders translated text under each locale** — at minimum `en` + `hy` render their own strings; `ru` is a happy-path test that the locale catalog loads without throwing. (Playwright in `web-modern/e2e/i18n-canary.spec.ts`.)
6. **At least 3 unit tests** covering: the provider reads locale from localStorage, the default locale is `hy`, and a missing-message key falls back to the source string instead of throwing.

## Surface map (what this phase touches)

### A. New files
- `web-modern/lingui.config.js` — Lingui v5 config (catalog paths, locales, src paths, runtime macros)
- `web-modern/src/i18n/I18nProvider.tsx` — wraps the app, sets up `i18n.activate()` from localStorage / `?lang=` query
- `web-modern/src/i18n/lingui.ts` — runtime helpers (`getActiveLocale`, `setLocale`, `LOCALES` constant)
- `web-modern/src/i18n/I18nProvider.test.tsx` — 3+ unit tests
- `web-modern/src/locales/hy/messages.po` — Armenian catalog (source strings)
- `web-modern/src/locales/ru/messages.po` — Russian catalog (placeholder strings OK; will be filled by a later phase)
- `web-modern/src/locales/en/messages.po` — English catalog (placeholder strings OK)
- `web-modern/e2e/i18n-canary.spec.ts` — Playwright e2e

### B. Modified files
- `web-modern/package.json` — add Lingui deps + `i18n:extract` / `i18n:compile` scripts; wire `i18n:compile` into `prebuild`
- `web-modern/src/main.tsx` — wrap `<RouterProvider>` in `<I18nProvider>`
- `web-modern/src/routes/app/analytics/index.tsx` — convert all user-facing strings to `Trans` / `t\`\`` macros
- `web-modern/src/components/shell/Topbar.tsx` — add a dev-only locale switcher (3 buttons, hidden in prod build)

### C. Untouched (intentional)
- **No other route is converted in this phase.** 10.4 will convert the rest as it lands shared components. Trying to convert more than the canary risks scope creep.
- **No work on M3 agents' Phase 8.13 CRM Tube branches** (`wip/phase8-healthcheck`, `wip/phase8-tube-*`).
- **No push to `ant/main` or `origin`** — orchestrator owns the push.

## Worker invariant (10 things that must be true after merge)

1. `web-modern/lingui.config.js` exists and lists `["hy", "ru", "en"]` as locales.
2. `web-modern/src/i18n/I18nProvider.tsx` exists and is rendered by `main.tsx` (import in main.tsx, JSX wrapper in render tree).
3. `web-modern/src/locales/{hy,ru,en}/messages.po` all exist; `hy` is non-empty (the source catalog).
4. `web-modern/src/routes/app/analytics/index.tsx` — every user-facing string in the rendered output is wrapped in `Trans` or a `t\`\`` macro. (Verify by `grep -v "Trans\\|t\`"` against the visible-string spans.)
5. `Topbar` renders a locale switcher (3 buttons: Հյ / РУ / EN) when `import.meta.env.DEV` is true; not rendered in production.
6. `npm run typecheck` (web-modern) exits 0.
7. `npm test -- --run` (web-modern) shows at least 3 new passing tests under `i18n*` glob, and the **4 pre-existing fleet test bugs** remain out of scope.
8. `npm run build` (web-modern) exits 0 — meaning the `i18n:compile` pre-step is wired and the compiled catalogs end up in the build output.
9. `npm run i18n:extract` produces a non-empty `messages.po` (idempotent re-run shows no diff).
10. `web-modern/e2e/i18n-canary.spec.ts` exists and renders the canary route under both `en` and `hy` locales, asserting language-specific text.

## What this phase does NOT touch

- Other route files in `web-modern/src/routes/app/*` — they stay in their current Armenian/English-mix state. 10.4 will convert them as it builds shared components.
- Server side (`server/`). The SPA is the i18n target; the API stays locale-agnostic.
- Existing component translations (e.g. the `amText` / `armText` helper functions scattered around). They stay. New strings use Lingui; old strings stay frozen. 10.4 will deprecate the helpers as routes get converted.
- The .po message files' content beyond what `lingui extract` produces. Translation work is a separate human effort.

## What this phase unblocks

- **Phase 10.4 (shared components)** — DataTable column labels, button labels, empty states, saved-view titles can all use `Trans` from day one.
- **Phase 10.5 (product differentiators)** — the in-app Ask-AI assistant, Triage Inbox, period-close checklist, onboarding — all need translation hooks.
- **Future i18n efforts** — adding a new locale is now a 1-line change in `lingui.config.js` + a new `.po` file.

## Rollback plan

If the merge breaks `tsc` or `vitest` beyond the 4 known fleet bugs:

1. Orchestrator stops here. Do NOT force-merge.
2. Revert the merge commit: `git reset --hard 463089d` on the worker branch.
3. Investigate which Lingui macro use site is ungrammatical (likely a `Plural` in a `trans()` call without a `value`, or a `defineMessage` import that lost the default export under Vite's tree-shaker).
4. Open a follow-up issue against 10.3 with the failing test name.

## Post-merge actions (orchestrator-side)

1. Update `.orchestration/STATE.md` with a 10.3 CLOSED section (mirror the 10.2e section format).
2. Add `phase10-3-i18n-infra-v1 → <sha> ✅` to the tag list.
3. Teardown: `node scripts/orchestrate-worktrees.js .orchestration/phase10-3-i18n-infra/plan.json --teardown`.
4. Refspec push: `git push ant main:refs/heads/ant/main` (already part of merge.sh).
5. Next concrete step: **Phase 10.4 — shared components** (DataTable + saved views + peek panel + undo + bulk-select). The Lingui infra from 10.3 lets 10.4 ship label-localized components.

## Notes

- The canary route is `web-modern/src/routes/app/analytics/index.tsx` (198 lines) — small enough to convert in one worker session, large enough to exercise 5 tabs, headers, back-link, and empty states. Pattern A ViewSwitcher, so the conversion mostly lands in the panel files re-exported from `lib/analytics/panels/`.
- Lingui v5 is current as of 2026-06. Pinned versions go in `package.json` (don't use `^` for the i18n packages — we want reproducible builds).
- The dev-only locale switcher is intentionally a `import.meta.env.DEV` guard. Don't promote it to a user-facing setting; that's 10.5 territory.
- The `prebuild` script in `package.json` is the key wiring: `lingui compile` must run before `vite build`, otherwise the bundle ships with un-transpiled `Trans` JSX and the canary route will throw at runtime.
