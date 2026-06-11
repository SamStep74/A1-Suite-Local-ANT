# Worker Task: routes-inventory
- Session: `phase2-inventory-tests`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase2-inventory-tests-routes-inventory`
- Branch: `wip/phase2-inventory-routes-inventory`
- Launcher status file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase2-inventory-tests/routes-inventory/status.md`
- Launcher handoff file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase2-inventory-tests/routes-inventory/handoff.md`
- Tag to ship: `phase2-inventory-routes-v1`
## Seeded Local Overlays
- `web-modern/src/lib/inventory`
- `web-modern/src/routes/app/inventory`
- `web-modern/src/lib/inventory/__tests__`
- `web-modern/src/lib/agents/inventory-risk.test.ts`
- `web-modern/src/lib/agents/sales-quote.test.ts`
- `web-modern/src/lib/api/schemas.test.ts`
- `web-modern/src/components/ui/HybridBadge.test.tsx`
- `web-modern/vitest.config.ts`
- `web-modern/vitest.setup.ts`
- `web-modern/package.json`
- `web-modern/tsconfig.json`
## Objective
You are a test-writing agent for the A1 Suite web-modern app at /Users/samvelstepanyan/dev/A1-Suite-Local-ANT. Your goal is to add **the first route-level tests** to web-modern/, covering the inventory list and detail routes, working in a clean git worktree.

Worktree: {worktree_path}
Branch:   {branch_name}
Typecheck runner: `npm --prefix web-modern run typecheck`
Test runner:     `npm --prefix web-modern test`
Coverage:        `npx --prefix web-modern vitest run --coverage`

## Setup (do these FIRST, in order)

1. `cd {worktree_path}`
2. `npm --prefix web-modern install` (uses web-modern/.npmrc with legacy-peer-deps=true; takes 2-3 min on first run).
3. `npm --prefix web-modern test` to confirm the 22 existing test files all pass. Note the 14 lib-inventory tests the other worker is writing — they will be in the OTHER worker's branch, not yours. Yours is a clean overlay that starts at 14:00 / 22:00 baseline (no overlap).
4. Look for any existing route tests: `find web-modern/src/routes -name "*.test.ts*" 2>&1 | head` — if none, that confirms you're establishing the pattern.

## Context — what already exists in the worktree (seeded from canonical)

The following inventory files are NEW (untracked on canonical main) and have been copied into your worktree via the seed overlay — you will see them as **untracked** when you `git status`:

- `web-modern/src/routes/app/inventory/index.tsx` (838 lines, list view with view switcher, 3 React Query calls)
- `web-modern/src/routes/app/inventory/$itemId.tsx` (933 lines, detail view with tabs and right-rail agent panel)

Other test files you can mirror (all in jsdom):
- `web-modern/src/components/ui/HybridBadge.test.tsx` — simplest pattern (pure render + props)
- `web-modern/src/lib/agents/inventory-risk.test.ts` — agent pattern
- `web-modern/src/lib/api/schemas.test.ts` — zod pattern

## Scope — write the FIRST route tests in web-modern/

The two routes are large (838 and 933 lines) and use:
- **TanStack Router** — `createFileRoute`, `Link`, `useNavigate`, `Route.useSearch()`
- **TanStack Query** — `useQuery` (3 in index, several in detail)
- **Internal components** — many inline sub-components per file
- **URL search state** — `nuqs` or built-in `Route.useSearch()`

A full rendering test of either route would require mocking the entire TanStack Router + Query stack. **Do not attempt that.** Instead:

### Strategy: test the **pure helpers** inside the route files

Each route file has filter-coercion helpers and sub-components you can extract and test in isolation. Focus on the small, testable pieces:

1. `coerceStockFilter` and `coerceMoveFilter` in `index.tsx` — input normalization helpers, likely 5-10 lines each.
2. `classifyStockLevel` is **already in `src/lib/inventory/status.ts`** — the route imports it. That is the other worker's territory; do NOT duplicate.
3. The `ViewSwitcher` is imported from `web-modern/src/components/view-switcher/ViewSwitcher.tsx` — already tested by the prior components pass.
4. The `AgentActionPanel` is imported — also already tested.

### If no pure helpers exist, take a different angle:

Look at `index.tsx` and `$itemId.tsx` for any **inline sub-components** that you can lift-test as `<SubComponent>.test.tsx` siblings. Examples to look for:
- `StockHealthPill` (renders the tier with a label)
- `MoveTypePill` (renders a move-type label)
- `EmptyState` (renders a no-data message)
- `Field`, `Row` (tiny presentational components)

If you find 2+ inline sub-components per route that are pure, test those. If the route is mostly glue code with no testable sub-components, write a **smoke test** that imports the module and asserts it parses (catches syntax / import-graph errors) and then write a 1-test note in the handoff explaining why the route itself isn't tested at this level.

## Per-test rules (from project conventions)

- Use vitest + jsdom (default environment for non-api modules).
- Place tests adjacent to source: `web-modern/src/routes/app/inventory/index.test.tsx` and `$itemId.test.tsx` — OR sibling to inline sub-components.
- Mock TanStack Router: `vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (cfg: unknown) => cfg, Link: ({children}: any) => children, useNavigate: () => vi.fn() }))` — see the pattern in HybridBadge.test.tsx if present, or invent a minimal one and document it in the handoff.
- Mock TanStack Query: provide a `QueryClientProvider` with a fresh `QueryClient({ defaultOptions: { queries: { retry: false } } })` per test. **Do NOT call the real `useQuery` hooks** — either render the helper components that don't use `useQuery`, or mock the `@/lib/api/client` so the queries resolve to empty arrays.
- Mock `@/lib/api/client`: `vi.mock("@/lib/api/client", () => ({ getJson: vi.fn().mockResolvedValue([]), postJson: vi.fn().mockResolvedValue({}), }))` — the inventory endpoints all return arrays.
- Armenian-first: the route files have inline Armenian strings; **do not translate them** in tests, assert on them as-is if needed.
- No snapshot tests.
- No `console.log` left in tests.
- Do not modify the route files — only add tests.

## Workflow

1. `cd {worktree_path}` and confirm `web-modern/src/routes/app/inventory/` is in your working tree (untracked).
2. Read both route files end-to-end. List inline sub-components and pure helpers.
3. Pick the 4-8 most testable units across both files. Prefer small, pure sub-components over the route shells.
4. For each unit, write 2-5 tests in a sibling `*.test.tsx` file.
5. Run targeted: `npm --prefix web-modern test -- web-modern/src/routes/app/inventory/`
6. Iterate to green. Do not skip or `.todo()` tests.
7. Commit per test file: `git add -A && git commit -m "test(routes): inventory <unit>"`.

## Final steps

1. Run the full test suite: `npm --prefix web-modern test`.
2. `npm --prefix web-modern run typecheck` — must be clean.
3. (Coverage is OPTIONAL for routes — the previous passes did not require it. If you do run coverage, it will be low because the route shells import the full graph.)
4. Push the branch (do NOT push to main): `git push -u ant {branch_name}`.
5. Write a handoff to {handoff_file} with:
   - Test files created (list with paths)
   - Units tested (sub-component or helper name + brief description)
   - Test count delta (X → Y)
   - The TanStack Router / Query mock pattern you established (so future route tests can reuse it)
   - Anything you discovered about the route structure that the next pass should know
   - If the route shells remain untested, explain why (so the next pass can decide whether to invest in full TanStack Router harness)
6. Mark {status_file} as: `state=done, completed=<iso timestamp>`.

## Constraints (HARD)

- **Do NOT modify the route files** — only add tests.
- **Do NOT push to `ant/main`** — the orchestrator merges to `main`, then we push to `ant` once reviewed.
- **Do NOT push to `origin`** (if it exists) — only to `ant`.
- Do not spawn subagents for the test writing — do it inline, this is a focused task.
- The 14 lib-inventory tests (other worker) and 22 existing test files (this branch's baseline) MUST still pass after your changes.
- Report results in your final response. The launcher captures that response automatically.
## Completion
Do not spawn subagents or external agents for this task.
Report results in your final response.
The worker launcher captures your response in `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase2-inventory-tests/routes-inventory/handoff.md` automatically.
The worker launcher updates `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase2-inventory-tests/routes-inventory/status.md` automatically.
## Tag to Ship
When done, push tag `phase2-inventory-routes-v1` to remote `ant`:
```bash
git push ant phase2-inventory-routes-v1
```
