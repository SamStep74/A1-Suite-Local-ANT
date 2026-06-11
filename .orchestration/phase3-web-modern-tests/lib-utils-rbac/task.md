# Worker Task: lib-utils-rbac
- Session: `phase3-web-modern-tests`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase3-web-modern-tests-lib-utils-rbac`
- Branch: `wip/phase3-web-modern-lib-utils-rbac`
- Launcher status file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase3-web-modern-tests/lib-utils-rbac/status.md`
- Launcher handoff file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase3-web-modern-tests/lib-utils-rbac/handoff.md`
- Tag to ship: `phase3-lib-utils-rbac-v1`
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
You are a test-writing agent for the A1 Suite web-modern app at /Users/samvelstepanyan/dev/A1-Suite-Local-ANT. Your goal is to add **fresh unit tests** to three small pure modules in `web-modern/src/lib/utils/` and `web-modern/src/lib/rbac/`, working in a clean git worktree.

Worktree: {worktree_path}
Branch:   {branch_name}
Typecheck runner: `npm --prefix web-modern run typecheck`
Test runner:     `npm --prefix web-modern test`
Coverage:        `npx --prefix web-modern vitest run --coverage`

## Setup (do these FIRST, in order)

1. `cd {worktree_path}`
2. `npm --prefix web-modern install` (first install in this worktree, takes 2-3 min; package-lock.json is present).
3. `npm --prefix web-modern test` to confirm the 5 existing test files on main pass.
4. `npx --prefix web-modern vitest run --coverage web-modern/src/lib/utils/ web-modern/src/lib/rbac/` to see the coverage baseline for your scope.

## Scope — THREE small pure modules to cover

You are writing **fresh** tests (these modules are currently untested):

1. `web-modern/src/lib/utils/cn.ts` (10 lines) — className utility (clsx + tailwind-merge). Test: concatenating strings, conditional classes (`true`/`false`), array inputs, object inputs, tailwind-merge conflict resolution (e.g. `cn("p-4", "p-2")` should yield just `"p-2"`).

2. `web-modern/src/lib/utils/money.ts` (32 lines) — money formatting (AMD dram). Test: integer dram amounts, amounts with decimals (rounding), amounts with `null`/`undefined` (fallback), negative numbers, the locale string format (Armenian or default).

3. `web-modern/src/lib/rbac/role.ts` (46 lines) — role-based access checks. Test: each role enum value, the `can()` / `requireRole()` function, the deny-by-default behavior, the role-hierarchy (e.g. owner > operator > viewer), throw vs return on insufficient permissions.

These are pure modules — no fetch, no router, no DB. jsdom environment (default).

## Per-test rules (from project conventions)

- Use vitest (already configured; default jsdom for non-api modules).
- Place tests adjacent to source: `<name>.test.ts` for each module.
- Test **behavior**, not implementation details. No mock-heavy test scaffolding needed — these are pure functions.
- Use `describe/it/expect`, follow the existing test style (look at `inventory-risk.test.ts` for the agent pattern, `schemas.test.ts` for the zod pattern).
- Armenian-first labels: use Armenian strings only if the source under test uses them — do not invent new i18n keys.
- No `console.log` or debug statements left in tests.
- Do not modify the source files — only add tests.

## Workflow (per module)

1. Read the source file to understand its exported API surface.
2. Write 4-10 tests covering: happy path, error cases, edge cases (empty input, boundary values, null/undefined).
3. Run `npm --prefix web-modern test -- <path-glob>` after each addition (vitest path filter).
4. Fix until green. Do not skip or `.todo()` tests — every test must pass.
5. Commit per module: `git add -A && git commit -m "test(lib): <module-name> coverage"`.
6. Move to next module.

## Final steps

1. Run the full test suite: `npm --prefix web-modern test`.
2. Run coverage: `npx --prefix web-modern vitest run --coverage`.
3. Confirm all tests pass and your three modules are at >= 80% line/branch coverage.
4. `npm --prefix web-modern run typecheck` — must be clean.
5. Push the branch (do NOT push to main): `git push -u ant {branch_name}`.
6. Write a handoff to {handoff_file} with:
   - Modules tested (list)
   - Test count delta (X → Y)
   - Final coverage % for each module (line + branch)
   - Anything you noticed but didn't fix
7. Mark {status_file} as: `state=done, completed=<iso timestamp>`.

## Constraints (HARD)

- **Do NOT modify any source files in `src/lib/utils/` or `src/lib/rbac/`** — only add tests.
- **Do NOT push to `ant/main`** — the orchestrator merges to `main`, then we push to `ant` once reviewed.
- **Do NOT push to `origin`** (if it exists) — only to `ant`.
- Do not spawn subagents for the test writing — do it inline, this is a focused task.
- The 5 existing test files on main MUST still pass.
- Report results in your final response. The launcher captures that response automatically.
## Completion
Do not spawn subagents or external agents for this task.
Report results in your final response.
The worker launcher captures your response in `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase3-web-modern-tests/lib-utils-rbac/handoff.md` automatically.
The worker launcher updates `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase3-web-modern-tests/lib-utils-rbac/status.md` automatically.
## Tag to Ship
When done, push tag `phase3-lib-utils-rbac-v1` to remote `ant`:
```bash
git push ant phase3-lib-utils-rbac-v1
```
