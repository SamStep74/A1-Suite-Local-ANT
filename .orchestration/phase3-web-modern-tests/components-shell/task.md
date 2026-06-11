# Worker Task: components-shell
- Session: `phase3-web-modern-tests`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase3-web-modern-tests-components-shell`
- Branch: `wip/phase3-web-modern-components-shell`
- Launcher status file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase3-web-modern-tests/components-shell/status.md`
- Launcher handoff file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase3-web-modern-tests/components-shell/handoff.md`
- Tag to ship: `phase3-components-shell-v1`
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
You are a test-writing agent for the A1 Suite web-modern app at /Users/samvelstepanyan/dev/A1-Suite-Local-ANT. Your goal is to add **fresh component tests** to the shell + UI + feedback components in `web-modern/src/components/`, working in a clean git worktree.

Worktree: {worktree_path}
Branch:   {branch_name}
Typecheck runner: `npm --prefix web-modern run typecheck`
Test runner:     `npm --prefix web-modern test`
Coverage:        `npx --prefix web-modern vitest run --coverage`

## Setup (do these FIRST, in order)

1. `cd {worktree_path}`
2. `npm --prefix web-modern install` (first install in this worktree, takes 2-3 min; package-lock.json is present).
3. `npm --prefix web-modern test` to confirm the existing 1 component test passes: `components/ui/HybridBadge.test.tsx`.
4. Look for any existing component tests: `find web-modern/src/components -name "*.test.tsx" 2>&1 | head`.

## Scope — SEVEN small/medium components to cover

You are writing **fresh** tests (these components are currently untested):

1. `web-modern/src/components/shell/AppLauncher.tsx` (177 lines) — the apps grid that opens from the topbar.
2. `web-modern/src/components/shell/Topbar.tsx` (197 lines) — the top navigation bar.
3. `web-modern/src/components/shell/LeftRail.tsx` (109 lines) — the left-side navigation rail.
4. `web-modern/src/components/shell/BottomBar.tsx` (64 lines) — the bottom action bar.
5. `web-modern/src/components/ui/Button.tsx` (75 lines) — the primary button component (variants, sizes, disabled, loading).
6. `web-modern/src/components/ui/Kbd.tsx` (19 lines) — keyboard-shortcut pill.
7. `web-modern/src/components/feedback/Toaster.tsx` (30 lines) — toast notifications.

All jsdom (default).

## Per-component rules (from project conventions)

- Use vitest + @testing-library/react + jsdom (default; the prior components-tests worker may have added @testing-library/user-event — check `web-modern/package.json`; if not present, add only `userEvent.click` patterns via `fireEvent` or just `userEvent` if it's already installed).
- Place tests adjacent to source: `<name>.test.tsx`.
- Test: rendering with required props, user interactions, edge cases (empty data, error, loading states), accessibility (role, aria-label, keyboard navigation).
- Mock external dependencies at the test boundary:
  - `@/lib/api/client` for any component that fires queries — `vi.mock("@/lib/api/client", () => ({ getJson: vi.fn().mockResolvedValue([]), postJson: vi.fn().mockResolvedValue({}), }))`
  - `@tanstack/react-router` for any component that uses Link or useNavigate — `vi.mock("@tanstack/react-router", () => ({ Link: ({children}: any) => children, useNavigate: () => vi.fn() }))`
  - `@/lib/apps` for the AppLauncher if it reads the 13-apps list — DO NOT MOCK this; render against the real 13 apps so the test catches regressions.
  - `sonner` for Toaster — `vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))`
- Use `screen.getByRole` / `getByLabelText` / `getByText` over `getByTestId` when possible — test like a user would.
- Armenian-first: the components have inline Armenian strings; **do not translate them** in tests, assert on them as-is if needed.
- No snapshot tests unless absolutely necessary — prefer explicit assertions.
- No `console.log` or debug statements left in tests.
- Do not modify the source components — only add tests.

## Workflow (per component)

1. Read the source file to understand its props interface, internal state, and side effects.
2. Identify what to mock (API calls, router, query, sonner, etc.).
3. Write 4-10 tests covering: render with required props, render with optional props, user interactions, edge cases (empty/error/loading), accessibility.
4. Run `npm --prefix web-modern test -- <path-glob>` after each addition.
5. Fix until green. Do not skip or `.todo()` tests.
6. Commit per component: `git add -A && git commit -m "test(components): <name>"`.
7. Move to next component.

## Final steps

1. Run the full test suite: `npm --prefix web-modern test`.
2. `npm --prefix web-modern run typecheck` — must be clean.
3. Push the branch (do NOT push to main): `git push -u ant {branch_name}`.
4. Write a handoff to {handoff_file} with:
   - Components tested (list)
   - Test count delta (X → Y)
   - Any components you couldn't test and why
   - The mock pattern(s) you established (e.g. for sonner, for TanStack Router) so future tests can reuse them
5. Mark {status_file} as: `state=done, completed=<iso timestamp>`.

## Constraints (HARD)

- **Do NOT modify any source components** — only add tests.
- **Do NOT add or remove entries from the 13-apps list in `lib/apps.ts`** — even if your test reads it. The list stays at 13.
- **Do NOT push to `ant/main`** — the orchestrator merges to `main`, then we push to `ant` once reviewed.
- **Do NOT push to `origin`** (if it exists) — only to `ant`.
- Do not spawn subagents for the test writing — do it inline, this is a focused task.
- The 1 existing component test (`HybridBadge.test.tsx`) MUST still pass.
- Report results in your final response. The launcher captures that response automatically.
## Completion
Do not spawn subagents or external agents for this task.
Report results in your final response.
The worker launcher captures your response in `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase3-web-modern-tests/components-shell/handoff.md` automatically.
The worker launcher updates `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase3-web-modern-tests/components-shell/status.md` automatically.
## Tag to Ship
When done, push tag `phase3-components-shell-v1` to remote `ant`:
```bash
git push ant phase3-components-shell-v1
```
