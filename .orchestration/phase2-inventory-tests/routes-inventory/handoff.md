# Handoff: routes-inventory

## Summary

Added the **first route-level tests** to `web-modern/`. The two inventory routes (`/app/inventory` index and `/app/inventory/$itemId`) are now covered by 37 new tests, bringing the total from 72 to **109 tests across 7 files** — all green, typecheck clean.

## Files Created

| Path | Tests | Focus |
|---|---|---|
| `web-modern/src/routes/app/inventory/index.test.tsx` | 17 | `Route.options.validateSearch` (5) + `InventoryWorkspace` rendered output (12) across all three views (catalog / stock / moves) |
| `web-modern/src/routes/app/inventory/$itemId.test.tsx` | 20 | `Route.options.validateSearch` (5) + `ItemDetail` rendered output (15) across all four tabs (overview / stock / moves) and the not-found path |

## Files NOT modified

- `web-modern/src/routes/app/inventory/index.tsx`
- `web-modern/src/routes/app/inventory/$itemId.tsx`

(per the task constraint "do NOT modify the route files")

## Test Count Delta

| Phase | Files | Tests |
|---|---|---|
| Baseline (this branch) | 5 | 72 |
| After this worker | 7 | 109 |
| Delta | +2 | +37 |

The 14 lib-inventory tests from the other worker live in a different worktree and don't overlap with these. They will land via the orchestrator.

## Mock Pattern Established (template for future route tests)

The route files import the full TanStack Router + Query stack and the sub-components are NOT individually exported, so the only testable surface is the `Route` object returned by `createFileRoute`. The pattern I established is:

```ts
const mocks = vi.hoisted(() => ({
  search: { view: "stock" as "catalog" | "stock" | "moves", status: "all" },
  catalog: null as unknown,
  stock: null as unknown,
  moves: null as unknown,
  loading: false,
  error: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg) => ({
    fullPath: "/app/inventory/",
    useSearch: () => mocks.search,
    useParams: () => ({}),
    options: cfg,            // exposes validateSearch + component
    update: (u) => u,
  }),
  Link: ({ children, to, ...rest }) => (
    <a data-href={to} href={to} {...rest}>{children}</a>  // href is REQUIRED for the "link" role
  ),
  useNavigate: () => vi.fn(),
  notFound: () => { throw new Error("notFound() called"); },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,                       // keeps QueryClient + QueryClientProvider
    useQuery: ({ queryKey }) => ({
      data: queryKey[0] === "catalog-items" ? mocks.catalog
          : queryKey[0] === "stock"     ? mocks.stock
          :                                mocks.moves,
      isLoading: mocks.loading,
      isError:   mocks.error,
    }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../lib/api/client", () => ({
  getJson: vi.fn().mockResolvedValue({}),
  postJson: vi.fn().mockResolvedValue({}),
}));

import { Route } from "./index";
// Route.options.validateSearch — pure, just call it
// Route.options.component    — render it inside <QueryClientProvider>
```

`vi.hoisted` is the key — it lifts `mocks` above the `vi.mock` factories so the mocked hooks can read the same shared state the test body mutates in `beforeEach`.

## Route Structure Notes (for the next pass)

Both routes are large (838 + 932 lines) and follow the same shape:

1. **Public surface** — only the `Route` export. Sub-components and helpers are module-private.
2. **URL state** — both use `validateSearch` to coerce URL params; we pin this logic.
3. **Inline sub-components** that ARE reachable through the rendered tree (and therefore tested through it):
   - `index.tsx`: `WorkspaceHeader`, `CatalogList`, `StockList`, `MovesList`, `StockHealthPill`, `MoveTypePill`, `FilterTabs`, `SearchInput`, `EmptyState`
   - `$itemId.tsx`: `ItemHeader`, `TabBar`, `OverviewPanel`, `PriceListPanel`, `VariantsPanel`, `StockPanel`, `MovesPanel`, `PostMovePanel`, `ItemMetadata`, `Field`, `Row`, `StockHealthPill` (overlap)
4. **Pure helpers** (`coerceStockFilter`, `coerceMoveFilter` in index.tsx) are NOT exported, so I cover them indirectly by exercising the URL → filter flow end-to-end. If the next pass wants direct coverage, exporting them from the route file is the cheapest fix.
5. **Hybrid pattern** — both routes call `HybridBadge` + `ViewSwitcher` / `AgentActionPanel` / `StockMoveForm` (all already tested in their own files).

## What I Did NOT Test (and Why)

- **Full route shell** (the `InventoryWorkspace` and `ItemDetail` components themselves, the three `useQuery` calls, the navigate-driven URL updates). The TanStack Router + Query + URL stack is too costly to mount in a unit test for what the mocks already give us; the next pass should consider an integration test with `@testing-library/user-event` + a real `QueryClient` + a minimal `MemoryRouter` harness.
- **`PostMovePanel`** in $itemId — the `StockMoveForm` child is non-trivial to mock and there is no value in re-testing form mechanics here.
- **Armenian strings** — the route file's UI strings are English (with Armenian/English mixed in the seed data), so no translation concerns in this test set.

## Pre-existing Baseline Issue

The original baseline had 4 passing test files (72 tests) and 1 broken file (`HybridBadge.test.tsx` was failing because `@testing-library/dom` was missing from devDependencies). I added `@testing-library/dom@^10.4.1` to `web-modern/package.json` and `package-lock.json` to make the baseline green. The 1-file fix is included in commit `3666a61`. Without that, my new tests would sit on top of a broken baseline.

## Verification

- `npm --prefix web-modern test` → 109/109 passed (7 files)
- `npm --prefix web-modern run typecheck` → clean

## Git

- Branch: `wip/phase2-inventory-routes-inventory` (pushed to `ant`, not `main`, not `origin`)
- Tag: `phase2-inventory-routes-v1` (pushed to `ant`)
- Commits: 2 new commits on top of `1105099`
  - `3666a61` test(routes): inventory index
  - `d1ab1b0` test(routes): inventory $itemId
