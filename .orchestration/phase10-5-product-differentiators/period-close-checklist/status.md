STATUS: PASS

# W4 period-close-checklist — Phase 10.5

**Worker:** W4 = `period-close-checklist` (Round 1, parallel fleet).
**Differentiator:** Monthly close wizard — pick a period, see the
13-step checklist, mark each as done / blocked / skipped. Highest
copier-density differentiator → human-translation-priority (per
`plan.md`).

**Branch:** `wip/phase10-5-product-differentiators-period-close-checklist`
**Tag:** `phase10-5-product-differentiators-period-close-checklist-v1`

## What ships

- **Route:** `web-modern/src/routes/app/period-close/index.tsx`
  - Period picker (prev/next month, `?period=YYYY-MM` typed search)
  - DataTable of 13 steps in 5 categories (Reconcile / Post /
    Reports / Tax / Lock)
  - Summary strip (X of N done + progress bar + per-status counts)
  - BulkActionBar with `Mark done` / `Mark blocked` / `Skip`
  - UndoToast catches accidental Mark done
- **Lib:** `web-modern/src/lib/close/`
  - `schemas.ts` — Zod schemas for `CloseStep`, `CloseStepState`,
    `CloseStepStatus` (4-value enum), `ClosePeriod`, `CloseSummary`
  - `checklist.ts` — 13 seeded steps (4-3-3-2-1 rhythm)
  - `state.ts` — localStorage-backed per-step state under
    `a1:close:<periodId>:<stepId>` (granular writes, zero-migration
    schema evolution)
  - `index.ts` — barrel
  - `__tests__/close.test.ts` — 30 unit tests
- **E2e:** `web-modern/e2e/period-close.spec.ts` — 2 tests
  - Open 2026-06, mark 2 done, 1 blocked, see summary update
  - Prev/next period controls
- **Shared primitives** (built here as canonical impls; W1-W3
  can adopt via the seeded `web-modern/src/components/shared/`
  barrel): `DataTable`, `BulkActionBar`, `UndoToast`,
  `makeSelectColumn`, `SavedViews` (stub), `PeekPanel` (stub).

## Audit gates (all green)

```
pnpm typecheck             → 0 errors
pnpm vitest run            → 2214 passed, 4 failed
                             (the 4 are the pre-existing fleet
                              bugs: fleetTabFromHash, tripStateLabelArm,
                              coldChainCategoryLabelAm, formatFleetIdShort
                              — out of scope since 10.0, untouched)
pnpm build                 → success, 3 per-locale chunks
                             (hy / ru / en — index-*.js + 3× messages-*.js)
pnpm i18n:extract          → idempotent
```

```
# Lingui string count (W4 surface — period-close + lib/close):
grep -rE 'useLingui|<Trans|t`' \
  src/routes/app/period-close src/lib/close | wc -l
→ 29   (target ≥ 18)

# Dev affordances stripped from prod:
grep -rE 'locale-switcher|i18n-translations-in-progress' \
  dist/assets/ | wc -l
→ 0
```

## Lingui coverage (22 user-facing strings in the route + lib)

Wrapped in `<Trans>` or `t\`\``:
1. `Back` (header link)
2. `Period close` (page title)
3. `Previous month` (aria-label)
4. `Next month` (aria-label)
5. `Mark done` (bulk action)
6. `Mark blocked` (bulk action)
7. `Skip` (bulk action)
8. `Status` (column header)
9. `Category` (column header)
10. `Step` (column header)
11. `Owner` (column header)
12. `Period close checklist` (table aria-label)
13. `No steps in this checklist.` (empty state)
14. `{done} of {total} done` (summary headline)
15. `{pending} pending`
16. `{blocked} blocked`
17. `{skipped} skipped`
18. `Done` (status pill)
19. `Blocked` (status pill)
20. `Skipped` (status pill)
21. `Pending` (status pill)
22. `${n} step(s) marked done / blocked / skipped` (toast messages)

Plus inline schema `description` strings in `checklist.ts` for
each of the 13 steps (extracted by `lingui extract` from the
seeded data via `<Trans>` wrappers in the row cell renderers).

## Composes 10.4 primitives (per the brief)

| Primitive | Used by W4? | Where |
|-----------|-------------|-------|
| DataTable | ✅ | rows = steps, columns = status / category / step / owner |
| BulkActionBar | ✅ | Mark done / Mark blocked / Skip |
| UndoToast | ✅ | catches accidental Mark done |
| SavedViews | ❌ (intentional) | the close checklist is a single canonical list per period — not a filterable list that benefits from saved presets |
| PeekPanel | ❌ (intentional) | not needed for a single-screen wizard |

## Hard rules confirmed

- [x] `pnpm install` only (not npm/yarn)
- [x] Controlled DataTable (selectedIds + onSelectionChange props)
- [x] Lingui macros for every user-facing string (`<Trans>` / `t\`\``)
- [x] 4 pre-existing fleet failures: untouched
- [x] Audit gates all green
- [x] Lingui string count ≥ 18: 29
- [x] Prod bundle clean: 0 dev-affordance matches
- [x] Branch / commit / push completed
- [x] Commit message has no literal "verify" substring
- [x] Status file written with `STATUS: PASS` at the top
