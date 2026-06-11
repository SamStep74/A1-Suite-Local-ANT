# Worker Task: lib-api-edge
- Session: `phase3-web-modern-tests`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase3-web-modern-tests-lib-api-edge`
- Branch: `wip/phase3-web-modern-lib-api-edge`
- Launcher status file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase3-web-modern-tests/lib-api-edge/status.md`
- Launcher handoff file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase3-web-modern-tests/lib-api-edge/handoff.md`
- Tag to ship: `phase3-lib-api-edge-v1`
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
You are a test-writing agent for the A1 Suite web-modern app at /Users/samvelstepanyan/dev/A1-Suite-Local-ANT. Your goal is to add **fresh unit tests** to small, untested lib modules in `web-modern/src/lib/api/` and `web-modern/src/lib/`, working in a clean git worktree.

Worktree: {worktree_path}
Branch:   {branch_name}
Typecheck runner: `npm --prefix web-modern run typecheck`
Test runner:     `npm --prefix web-modern test`
Coverage:        `npx --prefix web-modern vitest run --coverage`

## Setup (do these FIRST, in order)

1. `cd {worktree_path}`
2. `npm --prefix web-modern install` (this is the first install in this worktree, so it takes 2-3 min; uses web-modern's existing package.json — no .npmrc needed because the package-lock.json is present in your worktree).
3. `npm --prefix web-modern test` to confirm the existing 5 test files on main pass: `lib/agents/inventory-risk.test.ts`, `lib/agents/sales-quote.test.ts`, `lib/api/schemas.test.ts`, `lib/inventory/__tests__/status.test.ts`, `components/ui/HybridBadge.test.tsx`.
4. `npx --prefix web-modern vitest run --coverage web-modern/src/lib/api/ web-modern/src/lib/apps.ts` to see the coverage baseline for your scope.

## Scope — THREE small modules to cover

You are writing **fresh** tests (these modules are currently untested):

1. `web-modern/src/lib/api/auth-token.ts` (48 lines) — session token storage/retrieval. The vitest config sends this to the `node` environment, so localStorage/IndexedDB do NOT exist; mock them via `vi.stubGlobal("localStorage", ...)` or by creating a fake storage object on `globalThis`. Test get/set/clear/empty-state behavior. Mirror the WIP's `api/auth-token.test.ts` pattern if you can find it via `git log --all -- web-modern/src/lib/api/auth-token.test.ts` in your worktree.

2. `web-modern/src/lib/api/queryClient.ts` (33 lines) — TanStack Query config defaults. Test the `QueryClient` instance is created with the expected defaults (`retry`, `refetchOnWindowFocus`, `staleTime`, etc.). This is a node-environment module.

3. `web-modern/src/lib/apps.ts` (213 lines) — the **13-apps list** that powers the app launcher. Per CLAUDE.md, this list stays at exactly 13 entries — do NOT add or remove. Read the file, then write tests that:
   - Confirm there are exactly 13 entries.
   - Each entry has the required fields (id, label, icon, route, etc.).
   - No two entries share the same id.
   - Required ids include the documented set (use the source — read what apps exist; do not invent names).
   This module is jsdom (the default).

## Per-test rules (from project conventions)

- Use vitest (already configured; `environmentMatchGlobs` sends `src/lib/api/**` to node, others to jsdom).
- Place tests adjacent to source: `<name>.test.ts` for each module.
- Test **behavior**, not implementation details. Mock external dependencies (`localStorage`, `window`) at the test boundary.
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
   - Anything you noticed but didn't fix (e.g. unused exports, naming concerns)
7. Mark {status_file} as: `state=done, completed=<iso timestamp>`.

## Constraints (HARD)

- **Do NOT modify any source files in `src/lib/`** — only add tests.
- **Do NOT add or remove entries from the 13-apps list in `lib/apps.ts`** — that breaks `body.apps.length === 13` invariants in server tests.
- **Do NOT push to `ant/main`** — the orchestrator merges to `main`, then we push to `ant` once reviewed.
- **Do NOT push to `origin`** (if it exists) — only to `ant`.
- Do not spawn subagents for the test writing — do it inline, this is a focused task.
- The 5 existing test files on main MUST still pass.
- Report results in your final response. The launcher captures that response automatically.
## Completion
Do not spawn subagents or external agents for this task.
Report results in your final response.
The worker launcher captures your response in `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase3-web-modern-tests/lib-api-edge/handoff.md` automatically.
The worker launcher updates `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase3-web-modern-tests/lib-api-edge/status.md` automatically.
## Tag to Ship
When done, push tag `phase3-lib-api-edge-v1` to remote `ant`:
```bash
git push ant phase3-lib-api-edge-v1
```
