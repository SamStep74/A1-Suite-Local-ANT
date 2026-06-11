# Worker Task: routes-crm
- Session: `phase3-web-modern-tests`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase3-web-modern-tests-routes-crm`
- Branch: `wip/phase3-web-modern-routes-crm`
- Launcher status file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase3-web-modern-tests/routes-crm/status.md`
- Launcher handoff file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase3-web-modern-tests/routes-crm/handoff.md`
- Tag to ship: `phase3-routes-crm-v1`
## Seeded Local Overlays
- `web-modern/src/lib/api`
- `web-modern/src/lib/utils`
- `web-modern/src/lib/rbac`
- `web-modern/src/lib/apps.ts`
- `web-modern/src/components/shell`
- `web-modern/src/components/ui`
- `web-modern/src/components/feedback`
- `web-modern/src/routes/app/crm`
- `web-modern/src/lib/agents/inventory-risk.test.ts`
- `web-modern/src/lib/agents/sales-quote.test.ts`
- `web-modern/src/lib/api/schemas.test.ts`
- `web-modern/src/lib/inventory/__tests__/status.test.ts`
- `web-modern/src/components/ui/HybridBadge.test.tsx`
- `web-modern/vitest.config.ts`
- `web-modern/vitest.setup.ts`
- `web-modern/package.json`
- `web-modern/tsconfig.json`
## Objective
You are a test-writing agent for the A1 Suite web-modern app at /Users/samvelstepanyan/dev/A1-Suite-Local-ANT. Your goal is to add **fresh route-level tests** to the CRM routes in `web-modern/src/routes/app/crm/`, working in a clean git worktree.

Worktree: {worktree_path}
Branch:   {branch_name}
Typecheck runner: `npm --prefix web-modern run typecheck`
Test runner:     `npm --prefix web-modern test`
Coverage:        `npx --prefix web-modern vitest run --coverage`

## Setup (do these FIRST, in order)

1. `cd {worktree_path}`
2. `npm --prefix web-modern install` (first install in this worktree, takes 2-3 min; package-lock.json is present).
3. `npm --prefix web-modern test` to confirm the 5 existing test files on main pass. Note: the parallel `phase2-inventory-tests` worker may have added route tests for `routes/app/inventory/` — those are in a separate worktree, not yours. Your scope is `routes/app/crm/`.
4. `find web-modern/src/routes -name "*.test.ts*" 2>&1 | head` to confirm the route-test landscape before you start.

## Scope — write tests for the CRM routes

The CRM routes are:
- `web-modern/src/routes/app/crm/index.tsx` — CRM list view (customers, leads, deals)
- `web-modern/src/routes/app/crm/$quoteId.tsx` — CRM quote detail view

Read both files end-to-end. They are large and use:
- **TanStack Router** — `createFileRoute`, `Link`, `useNavigate`, `Route.useSearch()`
- **TanStack Query** — `useQuery` for CRM data
- **Internal components** — likely many inline sub-components (pills, headers, empty states, fields)
- **URL search state** — for filter/view persistence

A full rendering test of either route would require mocking the entire TanStack Router + Query stack. **Do not attempt that.** Instead:

### Strategy: test the **pure helpers** and **inline sub-components**

For each route file:
1. Identify any **filter-coercion helpers** (e.g. `coerceCrmFilter`, `parseQuoteStatus`) — small, pure, easy to test.
2. Identify any **inline sub-components** (e.g. `StatusPill`, `CustomerAvatar`, `DealValue`, `EmptyState`, `Field`, `Row`, header bits). These are often pure presentational pieces that don't touch the router or query.
3. Identify any **status-classification helpers** (e.g. `classifyDealStage`).

Write tests for **4-8 of these units** total across both files, plus 1 smoke test per file (an import + assert-it-doesn't-throw test).

If the CRM routes are mostly glue code with no testable sub-components, mirror the strategy used by the `phase2-inventory-tests`'s `routes-inventory` worker (read its handoff at `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase2-inventory-tests/routes-inventory/handoff.md` if it exists by the time you start — it should be done by then, or close to it).

## Per-test rules (from project conventions)

- Use vitest + jsdom (default).
- Place tests adjacent to source: `web-modern/src/routes/app/crm/index.test.tsx` and `$quoteId.test.tsx` — OR sibling to inline sub-components.
- Mock TanStack Router: `vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (cfg: unknown) => cfg, Link: ({children}: any) => children, useNavigate: () => vi.fn() }))`
- Mock TanStack Query: provide a `QueryClientProvider` with a fresh `QueryClient({ defaultOptions: { queries: { retry: false } } })` per test.
- Mock `@/lib/api/client`: `vi.mock("@/lib/api/client", () => ({ getJson: vi.fn().mockResolvedValue([]), postJson: vi.fn().mockResolvedValue({}), }))`
- Armenian-first: the route files have inline Armenian strings; **do not translate them** in tests, assert on them as-is if needed.
- No snapshot tests.
- No `console.log` left in tests.
- Do not modify the route files — only add tests.

## Workflow

1. `cd {worktree_path}` and confirm `web-modern/src/routes/app/crm/` exists (it should — Phase 2.4 committed it).
2. Read both route files end-to-end. List inline sub-components and pure helpers.
3. Pick the 4-8 most testable units across both files.
4. For each unit, write 2-5 tests in a sibling `*.test.tsx` file.
5. Run targeted: `npm --prefix web-modern test -- web-modern/src/routes/app/crm/`
6. Iterate to green. Do not skip or `.todo()` tests.
7. Commit per test file: `git add -A && git commit -m "test(routes): crm <unit>"`.

## Final steps

1. Run the full test suite: `npm --prefix web-modern test`.
2. `npm --prefix web-modern run typecheck` — must be clean.
3. Push the branch (do NOT push to main): `git push -u ant {branch_name}`.
4. Write a handoff to {handoff_file} with:
   - Test files created (list with paths)
   - Units tested (sub-component or helper name + brief description)
   - Test count delta (X → Y)
   - The TanStack Router / Query mock pattern you used (if different from the one in the task spec)
   - If the route shells remain untested, explain why
5. Mark {status_file} as: `state=done, completed=<iso timestamp>`.

## Constraints (HARD)

- **Do NOT modify the route files** — only add tests.
- **Do NOT push to `ant/main`** — the orchestrator merges to `main`, then we push to `ant` once reviewed.
- **Do NOT push to `origin`** (if it exists) — only to `ant`.
- Do not spawn subagents for the test writing — do it inline, this is a focused task.
- The 5 existing test files on main MUST still pass.
- Report results in your final response. The launcher captures that response automatically.
## Completion
Do not spawn subagents or external agents for this task.
Report results in your final response.
The worker launcher captures your response in `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase3-web-modern-tests/routes-crm/handoff.md` automatically.
The worker launcher updates `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase3-web-modern-tests/routes-crm/status.md` automatically.
## Tag to Ship
When done, push tag `phase3-routes-crm-v1` to remote `ant`:
```bash
git push ant phase3-routes-crm-v1
```
