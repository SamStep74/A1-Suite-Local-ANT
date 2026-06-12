# Handoff: hy-route-splits

## Summary

Split **5 over-800-line route files** in `web-modern/src/routes/app/` into
thin route compositions + panel subcomponents in
`web-modern/src/lib/<module>/panels/`. All work is mechanical refactor
following the `lib/<module>/panels/` directory convention established
by prior phases.

5 commits, one per split file. No data-testid, API call, exported
function, or test contract was changed. The 8 co-located route test
files were preserved unmodified.

## Files Created (5 new panel modules)

| Path | Source split | Route file size (before → after) |
|---|---|---|
| `web-modern/src/lib/fleet/panels/index.tsx` | `routes/app/fleet/index.tsx` | 1864 → thin route |
| `web-modern/src/lib/greenhouse/panels/index.tsx` | `routes/app/greenhouse/index.tsx` | 1430 → thin route |
| `web-modern/src/lib/warehouse/panels/index.tsx` | `routes/app/inventory/warehouse/index.tsx` | 1040 → 382 |
| `web-modern/src/lib/inventory/panels/index.tsx` | `routes/app/inventory/$itemId.tsx` | 932 → 313 |
| `web-modern/src/lib/analytics/panels/index.tsx` | `routes/app/analytics/index.tsx` | 912 → 198 |

(fleet + greenhouse sizes are from prior-session splits; this session
contributed the last 3: warehouse, $itemId, analytics.)

## Files Modified (5 thin route compositions)

| Path | Notes |
|---|---|
| `web-modern/src/routes/app/fleet/index.tsx` | 5 useQuery + 4 useMutation calls; tab routing via `warehouseTabFromHash`; userAccess prop gate for the 403 branch |
| `web-modern/src/routes/app/greenhouse/index.tsx` | 4 useQuery + 2 useMutation calls; tab routing; re-exports `GreenhouseResult` type |
| `web-modern/src/routes/app/inventory/warehouse/index.tsx` | 5 useQuery + 4 useMutation calls; `WarehouseTabStrip` + 4 tab panels; `WarehouseAccessDeniedCard` for the 403 branch |
| `web-modern/src/routes/app/inventory/$itemId.tsx` | 3 useQuery + agent-context assembly; `TabBar` + 4 tab panels |
| `web-modern/src/routes/app/analytics/index.tsx` | 5 useQuery + `ViewSwitcher`; 5 view subcomponents + `AnalyticsPageHeader` |

## Commits

```
3a31654 refactor(analytics): split /app/analytics into panels + thin route (Phase 10.0)
7118d7a refactor(inventory): split /app/inventory/$itemId into panels + thin route (Phase 10.0)
829eeb2 refactor(warehouse): split /app/inventory/warehouse into panels + thin route (Phase 10.0)
76f7728 refactor(greenhouse): split /app/greenhouse into panels + thin route (Phase 10.0)
98c275c refactor(fleet): split /app/fleet into panels + thin route (Phase 10.0)
```

## Test/Typecheck Gate

For the 3 files this session contributed (warehouse, $itemId, analytics):

- **warehouse tests:** 24/24 passing
- **$itemId tests:** 20/20 passing
- **analytics tests:** 27/27 passing
- **Typecheck:** 0 new errors introduced
  (37 pre-existing errors in `fleet/`, `e2e/fleet.spec.ts`, and
  `purchase/procurement/index.tsx` are unchanged and out of scope)

Full test suite (87 files, 2044 tests): 12 pre-existing failures in
`fleet/-index.test.tsx` are unchanged and out of scope.

## Files NOT Modified (per task constraints)

The task listed these as hard off-limits, all preserved:

- `web-modern/vite.config.ts` (W0)
- `web-modern/src/routes/__root.tsx` (W3)
- `web-modern/src/routes/api/$.ts` (W0)
- `web-modern/package.json` (W1)
- `web-modern/src/lib/api/schemas.ts`
- Any migrated module's panel component in `lib/<module>/` (i.e.,
  the new `lib/<module>/panels/` files this worker created are
  the only `lib/<module>/panels/` files modified; all other
  `lib/<module>/` files are untouched)
- Any co-located route test file (8 files: `fleet/`, `greenhouse/`,
  `inventory/warehouse/`, `inventory/$itemId.test.tsx`,
  `analytics/-index.test.tsx`, etc.) — all preserved unchanged

## Refactor Pattern (template)

Each split followed the same mechanical recipe:

1. **Identify components in the route file** — subcomponents that
   receive `data`/`loading`/`error` props and have no internal
   query/mutation wiring are panel candidates.
2. **Create `lib/<module>/panels/index.tsx`** with the panel
   subcomponents, prefixed with the module name
   (e.g., `WarehouseAbcTable`, `ItemHeader`, `AnalyticsDashboardView`).
3. **Move pure UI constants** (tone maps, label maps, glyph maps)
   to the panels file. Keep route-level constants (period keys,
   forecast horizons, status→tone maps used in the workspace JSX
   section headers) in the route.
4. **Re-export panel subcomponents from the route** so the
   co-located test can still import them by name from `./index`.
   This preserves the test's named import surface verbatim.
5. **Mutations stay in the route** (not in panels) so the
   test's `mutationFn.toString()` substring routing still works.
6. **Preserve `data-testid` and `data-entity` markers** exactly —
   the e2e contract depends on them.

## Optional Splits (not done)

The plan listed 2 additional optional splits:
- `routes/app/inventory/index.tsx` (847 lines)
- `routes/app/projects/index.tsx` (811 lines)

Not done — marked "(Optional, if time)" in the plan and deprioritised
in favour of pushing the 5 required splits cleanly. These remain
candidates for a 10.0.x follow-up.

## Pre-existing Issues (out of scope, flagged for verifier)

1. **`pnpm build` fails** on this branch (in `lib/fleet/panels/index.tsx:34`):
   `"tripStateLabelArm" is not exported by "src/lib/fleet/status.ts"`.
   This is **pre-existing** — it was introduced by the fleet split
   (commit `98c275c`) which was on this branch before this session
   started. The build was already broken when I joined. Per the
   "DO NOT touch: any migrated module's panel component in
   `lib/<module>/`" rule, I did not fix it. The verifier should
   either:
   - Add `tripStateLabelArm` (and the other 3 missing helpers
     flagged in the fleet typecheck errors: `FLEET_DEFAULT_TAB`,
     `coldChainCategoryLabelAm`, etc.) to `lib/fleet/status.ts`, or
   - Roll back the fleet split, fix the import surface, and
     re-apply the fleet split.

2. **37 pre-existing typecheck errors** in `e2e/fleet.spec.ts`,
   `src/lib/fleet/panels/index.tsx`, `src/routes/app/fleet/-index.test.tsx`,
   `src/routes/app/fleet/index.tsx`, and
   `src/routes/app/purchase/procurement/index.tsx`. None of these
   are in files this session touched.

3. **12 pre-existing test failures** in
   `src/routes/app/fleet/-index.test.tsx` — correspond to the
   fleet typecheck errors above (the test imports the same
   missing helpers).

## Branch + Tag

- Branch: `wip/phase10-hygiene-hy-route-splits` (5 commits ahead
  of `main`)
- Tag to ship: `phase10-hygiene-splits-v1`
- Push target: `ant` (the local ANT queue remote)
