# Phase 10.4 — shared components (DataTable + SavedViews + PeekPanel + UndoToast + BulkActionBar)

## Goal

Land the cross-cutting primitive components that every list surface in
the web-modern SPA will compose: a headless `DataTable` (sort/filter/page
/select), `SavedViews` (per-user table-state persistence), `PeekPanel`
(side-drawer detail view), `UndoToast` (optimistic-mutation with
revert), and `BulkActionBar` (the N-selected action strip). Every
user-facing string goes through Lingui macros from 10.3 so the
components ship label-localized in hy / ru / en from day one.

These primitives are the *foundation* that 10.5 product differentiators
(Ask-AI assistant panel, Triage Inbox, period-close checklist) and
future surfaces (invoices list, payables list, contacts list,
shipments list) will compose. Getting the API surface right here is
high-leverage; over-engineering it would be costly.

## Scope (5 new components + 1 helper + 2 conversions + 1 e2e)

### New files

| # | Path | Approx LOC | Purpose |
|---|------|-----------:|---------|
| 1 | `web-modern/src/components/shared/DataTable.tsx` | ~280 | Headless table primitive — column defs, sort, filter, pagination, row selection. Built on TanStack Table v8 (already in deps via `@tanstack/react-table` — confirm or `npm i` it). |
| 2 | `web-modern/src/components/shared/DataTable.test.tsx` | ~180 | Renders, sort, filter, page, select-row, select-all tests. |
| 3 | `web-modern/src/components/shared/SavedViews.tsx` | ~150 | Dropdown over the `DataTable` toolbar to save the current view (name + JSON of `{ sort, filter, page, columns }`) and restore a named view. |
| 4 | `web-modern/src/components/shared/SavedViews.test.tsx` | ~110 | Save → reload → restore round-trip; 3+ named views in localStorage; rename + delete. |
| 5 | `web-modern/src/components/shared/PeekPanel.tsx` | ~160 | Right-side slide-out drawer (Radix Dialog or hand-rolled). Shows the selected row's full record without leaving the list. ESC + click-outside close. |
| 6 | `web-modern/src/components/shared/PeekPanel.test.tsx` | ~100 | Open, render content, ESC closes, click-outside closes, focus trap. |
| 7 | `web-modern/src/components/shared/UndoToast.tsx` | ~110 | Toast with "Undo" action. Pairs with TanStack Query's `onMutate` / `onError` (sets up a reverted-on-click handler with a 5s window). |
| 8 | `web-modern/src/components/shared/UndoToast.test.tsx` | ~80 | Appears on mutation, "Undo" calls the revert handler, auto-dismiss after timeout. |
| 9 | `web-modern/src/components/shared/BulkActionBar.tsx` | ~140 | Bottom-fixed action strip that shows when ≥1 row is selected. Bulk actions: Delete (with `UndoToast`), Export CSV, Tag. |
| 10 | `web-modern/src/components/shared/BulkActionBar.test.tsx` | ~90 | Visibility (0 vs 1 vs N selected), bulk-action calls, undo round-trip. |
| 11 | `web-modern/src/lib/components/savedViewsStore.ts` | ~90 | localStorage persistence layer (`a1:savedViews:<tableId>` key shape). Pure functions; no React. Exposes `loadViews` / `saveView` / `deleteView` / `renameView`. |
| 12 | `web-modern/src/components/shared/index.ts` | ~10 | Barrel re-exports the 5 components. |
| 13 | `web-modern/e2e/shared-components-canary.spec.ts` | ~120 | Playwright e2e over the analytics route (now wired to use `DataTable` + `SavedViews` + `PeekPanel` + `BulkActionBar`). 3 specs. |

### Conversions (use the new components on a real surface)

| # | Path | What changes |
|---|------|-------------|
| C1 | `web-modern/src/routes/app/analytics/index.tsx` | The current tab/table layout (5 tabs with hand-rolled lists) gets a `DataTable` for the Receivables tab + a `SavedViews` picker + a `PeekPanel` for invoice detail. Proves the primitives work on a non-trivial surface. Lingui macros from 10.3 stay. |
| C2 | `web-modern/src/components/shell/Topbar.tsx` | The dev-only locale switcher (from 10.3) gets a one-line `SavedViews`-style pattern demo: a tiny "Recent views" menu that reads from `savedViewsStore` so the persistence layer is exercised in the dev shell. (Optional — only if time allows. Defer is fine.) |

### Untouched (deliberately out of scope)

- Existing `lib/api/schemas.ts` — no new Zod schemas for this phase
- `server/app.js` — no backend changes
- `deploy/`, `docs/UI_MODERNIZATION_PLAN.md` — no changes
- Lingui config + I18nProvider (10.3) — used as-is, no changes
- `web-modern/src/routes/app/finance/index.tsx` and friends — NOT converted in this phase (10.5 will do that)

## Lingui tie-in (the new constraint from 10.3)

Every user-facing string in the 5 new components must use either:

- `<Trans>English source</Trans>` for JSX-inline strings
- `t\`English source\`` for tagged-template strings (variables via `${}`)

The compiled catalogs (`web-modern/src/locales/{hy,ru,en}/messages.{po,js}`)
are seeded from 10.3 with 6 strings from the analytics canary. After
10.4 lands, running `npm --prefix web-modern run i18n:extract` should
add the new strings to the `hy` source catalog automatically (the `ru`
and `en` catalogs get empty msgid entries, which is correct — they
need a human translation pass, also out of scope).

## File ownership (single worker — mirrors 10.2e and 10.3)

This is a **single-worker** phase, not multi-stream. Rationale:

- All 5 components live in `web-modern/src/components/shared/`, a new
  directory. No pre-existing files to collide with.
- The components compose tightly: `SavedViews` imports `DataTable`'s
  toolbar context, `BulkActionBar` imports `DataTable`'s selection
  context, `PeekPanel` is fed by `DataTable`'s row-click handler,
  `UndoToast` is a peer-level toast manager that any of them can fire.
  Splitting across 2-3 workers would force pre-allocated scaffolding
  blocks (the 10.2b pattern) for no real isolation win.
- Estimated total: ~1700 lines new + ~560 lines tests + ~120 lines
  e2e = ~2400 lines. Same order of magnitude as 10.3 (which closed
  cleanly with worker recovery). Proven scope for a single worker.
- One conversion (C1) on the analytics route — same canary as 10.3,
  now exercised through the new primitives.

## Worker invariant (10 checks must pass)

The worker must run all of these before committing:

1. `cd web-modern && npm run typecheck` → **0 errors**
2. `cd web-modern && npm test -- --run` → **all passing except the 4
   pre-existing fleet bugs** (`fleetTabFromHash` /
   `tripStateLabelArm` / `coldChainCategoryLabelAm` /
   `formatFleetIdShort`) which are out of scope per 10.0 typecheck
   cleanup
3. `cd web-modern && npm run build` → **success** (3 per-locale
   chunks still emit, main bundle +~50-80 kB for the new code)
4. `cd web-modern && npm run i18n:extract` → **idempotent on
   re-run** (no msgid drift — extract twice and the second run
   should change only gettext metadata, not msgid contents)
5. `grep -rn "useLingui\|<Trans\|t\\\`" web-modern/src/components/shared/`
   → **at least 30 matches** (sanity check that Lingui macros are
   actually used; the exact threshold will become obvious from the
   extracted catalog)
6. The 5 new components each have a co-located test file passing
   (DataTable, SavedViews, PeekPanel, UndoToast, BulkActionBar)
7. `web-modern/e2e/shared-components-canary.spec.ts` is present and
   runnable under Playwright (the worker does NOT need to run the
   e2e suite locally — that's the CI job; they just need to confirm
   the file is well-formed)
8. The analytics route conversion (C1) is wired: visiting
   `/app/analytics` shows the new DataTable on the Receivables tab
   and a working PeekPanel + BulkActionBar
9. `git status` (in the worktree) shows only the expected file
   additions/modifications — no accidental edits to other files
10. `git log --oneline -1` shows exactly one new commit with a
    conventional-commits message; the worker's status file at
    `.orchestration/phase10-4-shared-components/shared-components/status.md`
    ends with `STATUS: PASS` (or `STATUS: FAIL` with a one-line
    reason)

## Hard rules (carried from prior phases)

- Do NOT touch M3 agents' Phase 8.13 CRM Tube work on `wip/phase8-healthcheck` / `wip/phase8-tube-*` branches
- Do NOT push to `ant/main` (the orchestrator merges to main, then
  pushes to ant with refspec)
- Do NOT push to `origin`
- Do NOT "fix" the 4 pre-existing fleet test bugs
- Do NOT use `git commit --amend` after pushing — it breaks the
  orchestrator's tag lookup
- Do NOT use `git commit -m` with a message that contains the literal
  substring "verify" (the `block-no-verify@1.1.2` hook will reject it)
- Do NOT use AskUserQuestion (it's broken in this VSCode env per memory)
- If `npm test` shows new failures (not the 4 pre-existing ones),
  STOP and write `STATUS: FAIL` with the failure list

## Commit + push (worker contract)

```bash
cd <worktree_root>
git add -A
git status   # confirm: 11 new files in components/shared/ + lib/components/ + e2e/; 2 modified (analytics route + maybe Topbar); package-lock.json may have @tanstack/react-table if it wasn't already a dep
git commit -F /tmp/commit-msg.txt   # see suggested body below

git push -u ant wip/phase10-4-shared-components/shared-components
git push ant phase10-4-shared-components-shared-components-v1
```

Suggested commit title: `feat(shared): add DataTable + SavedViews + PeekPanel + UndoToast + BulkActionBar (10.4)`

Suggested commit body bullets:

- DataTable: headless table primitive built on TanStack Table v8; column
  defs, sort, filter, page, row selection; emits `selectionChange` and
  `rowClick` events for parent wiring
- SavedViews: localStorage persistence of `{ sort, filter, page,
  columns }` per `<tableId>`; dropdown UI with save / load / rename /
  delete; pure-function `savedViewsStore` in `lib/components/`
- PeekPanel: right-side slide-out drawer; Radix Dialog under the hood;
  focus-trapped; ESC + click-outside close; feeds a row record prop
- UndoToast: toast with "Undo" action; pairs with TanStack Query
  `onMutate` / `onError`; 5s auto-dismiss window; reverts the mutation
  on click
- BulkActionBar: bottom-fixed strip; visible when ≥1 row selected;
  bulk actions wired to the same TanStack Query mutations (so they
  pair with UndoToast)
- Conversion: analytics route (the 10.3 canary) now uses
  `DataTable` on the Receivables tab + `SavedViews` picker + row-click
  opens `PeekPanel` + header checkbox feeds `BulkActionBar`
- Lingui: every user-facing string in the 5 new components uses
  `<Trans>` or `t\`\``; `i18n:extract` adds ~30+ new msgids to the
  `hy` source catalog; `ru` / `en` get empty entries (translation
  pass deferred per 10.3)
- Tests: ~560 lines of unit tests across the 5 components;
  1 e2e spec with 3 Playwright tests over the analytics surface
- Build: 3 per-locale chunks + main bundle; bundle delta ~50-80 kB

## Verification (post-merge at HEAD)

The orchestrator will run, after merging the worker's branch:

| Check | Result |
|-------|--------|
| `npm --prefix web-modern run typecheck` | 0 errors |
| `npm --prefix web-modern test -- --run` | ≥ N-4 passing (4 pre-existing fleet failures) |
| `npm --prefix web-modern run build` | success |
| `npm --prefix web-modern run i18n:extract` (twice) | idempotent |
| `grep -c 'locale-switcher\|Trans\|t\\\`' dist/assets/index-*.js` | non-zero (Lingui macros survived build) |
| `git log --oneline ant/main..HEAD` | 0 commits (we're at HEAD) |
| `git tag -l 'phase10-4*'` | exactly `phase10-4-shared-components-shared-components-v1` + the orchestrator integration tag |
| Tracking refs aligned at the integration commit | `HEAD`, `main`, `refs/heads/ant/main`, `refs/remotes/ant/main` all equal |

## What this phase does NOT touch

- No backend changes — `server/app.js`, the Fastify routes, the
  Zod schemas all stay as they are. The new components are pure
  client-side.
- No i18n catalog translations — `ru` and `en` get empty msgid
  entries; a human translation pass is its own future phase
- No 8.12 cleanup (already done in 10.2e — the legacy `web/` is
  gone)
- No Phase 8.13 CRM Tube work — those workers are M3's domain
- No conversion of the finance / people / flow / greenhouse routes
  to the new components — that's 10.5 territory

## Notes for the next phase

- Phase 10.5 (product differentiators) will compose these primitives:
  - Ask-AI assistant panel uses `PeekPanel` as the surface for
    "show me the journal entry behind this number"
  - Triage Inbox uses `DataTable` + `BulkActionBar` for "select 5
    overdue invoices, bulk-send reminders"
  - Period-close checklist uses `UndoToast` for "undo this
    adjustment"
  - Onboarding flow uses `PeekPanel` for the inline "what does
    this mean?" coach marks
- The `SavedViews` API is intentionally narrow (just the table-state
  shape). If 10.5 needs cross-table views, the next iteration widens
  the schema — but for 10.4, localStorage + `{ sort, filter, page,
  columns }` is the right MVP.
- The `UndoToast` works *only* with TanStack Query mutations in this
  phase. If 10.5 needs non-Query undo (e.g. for a non-mutation
  action), the toast can be refactored to accept a plain revert
  function — defer the decision.

## Next concrete step

After 10.4 closes:

1. Orchestrator updates `.orchestration/STATE.md` with a 10.4 CLOSED
   section (mirrors the 10.2e and 10.3 sections)
2. Orchestrator runs `--teardown` to remove the worktree + tmux
   session
3. **Phase 10.5 (product differentiators)** dispatches next —
   Ask-AI · Triage Inbox · period-close checklist · document
   steppers · keyboard grammar · onboarding — all composing the
   10.4 primitives with Lingui from 10.3
