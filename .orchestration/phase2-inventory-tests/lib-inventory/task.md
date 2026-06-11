# Worker Task: lib-inventory
- Session: `phase2-inventory-tests`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase2-inventory-tests-lib-inventory`
- Branch: `wip/phase2-inventory-lib-inventory`
- Launcher status file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase2-inventory-tests/lib-inventory/status.md`
- Launcher handoff file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase2-inventory-tests/lib-inventory/handoff.md`
- Tag to ship: `phase2-inventory-lib-v1`
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
You are a test-writing agent for the A1 Suite web-modern app at /Users/samvelstepanyan/dev/A1-Suite-Local-ANT. Your goal is to push `web-modern/src/lib/inventory/` to 100% line AND 100% branch coverage by closing the three untaken branch-coverage gaps in `web-modern/src/lib/inventory/status.ts`, working in a clean git worktree.

Worktree: {worktree_path}
Branch:   {branch_name}
Typecheck runner: `npm --prefix web-modern run typecheck`
Test runner:     `npm --prefix web-modern test`
Coverage:        `npx --prefix web-modern vitest run --coverage`

## Setup (do these FIRST, in order)

1. `cd {worktree_path}`
2. `npm --prefix web-modern install` (uses web-modern/.npmrc with legacy-peer-deps=true; takes 2-3 min on first run).
3. `npm --prefix web-modern test` to confirm the existing 14 inventory tests in `web-modern/src/lib/inventory/__tests__/status.test.ts` all pass.
4. `npx --prefix web-modern vitest run --coverage web-modern/src/lib/inventory/` to see the current coverage baseline. Expect:
   - Lines: 100%
   - Branches: 83.87% (3 untaken branches)

## Context — what already exists in the worktree (seeded from canonical)

The following inventory files are NEW (untracked on canonical main) and have been copied into your worktree via the seed overlay — you will see them as **untracked** when you `git status`:

- `web-modern/src/lib/inventory/status.ts` (93 lines, 4 pure functions)
- `web-modern/src/lib/inventory/__tests__/status.test.ts` (164 lines, 14 tests, already covers the 4 happy-path cases per function)

Existing test patterns you can mirror:
- `web-modern/src/lib/agents/inventory-risk.test.ts` — agent pattern (input/output pairs, boundary conditions)
- `web-modern/src/lib/api/schemas.test.ts` — zod schema pattern (large `describe.each` tables)

## Scope — the THREE untaken branch coverage gaps

Read `web-modern/src/lib/inventory/status.ts` end-to-end. Identify the three untaken branches (per the lib-tests handoff, they are at status.ts lines 51, 74, 89). For each, add 1-3 tests to `__tests__/status.test.ts` that exercise the branch.

For each branch:
1. Read the surrounding source to understand which input / state triggers it.
2. Write a focused test (or two) that hits that exact branch. Use the **smallest input** that exercises the path (no over-fitting).
3. If the branch is a defensive guard (e.g. `if (!Number.isFinite(x)) return x`), the test should pass a value that **is** non-finite or otherwise falls through the guard. Look at how `status.test.ts` already exercises `non-finite quantity` — mirror that style for the other branches.
4. Run the targeted test: `npm --prefix web-modern test -- web-modern/src/lib/inventory/__tests__/status.test.ts`
5. Verify the branch coverage counter ticks up.

## Per-test rules (from project conventions)

- Use vitest (already configured; jsdom for non-api modules).
- Place new tests in the **existing** `__tests__/status.test.ts` — do NOT create a new test file. Extend the existing `describe`/`it` blocks for the relevant function.
- Test **behavior**, not implementation details. No mock-heavy test scaffolding — these are pure functions, no fetch, no router, no DB.
- Do not invent new helper modules. The 4 exports are pure; tests should call them directly.
- Armenian-first labels: the source under test uses NO user-facing strings, so this is N/A. Do not invent any i18n keys.
- No `console.log` or debug statements left in tests.
- Do not modify `status.ts` — only add tests. If you find a real bug while writing tests, write the failing test, then STOP and note it in the handoff. Do not fix the source.

## Workflow (per branch)

1. Read the source line and surrounding context.
2. Identify the minimal input that takes the branch.
3. Add 1-2 tests to the relevant `describe` block in `__tests__/status.test.ts`.
4. Run the file-targeted test: `npm --prefix web-modern test -- web-modern/src/lib/inventory/__tests__/status.test.ts`
5. Re-run coverage on this subtree: `npx --prefix web-modern vitest run --coverage web-modern/src/lib/inventory/`
6. If branch coverage is still <100%, repeat. Do not declare done with gaps remaining.
7. Commit per branch (or per test group): `git add -A && git commit -m "test(inventory): cover <branch-name> in status.ts"`.

## Final steps

1. Run the full test suite: `npm --prefix web-modern test`.
2. Run coverage: `npx --prefix web-modern vitest run --coverage web-modern/src/lib/inventory/`
3. Confirm: **lines 100%, branches 100%** for `web-modern/src/lib/inventory/`.
4. `npm --prefix web-modern run typecheck` — must be clean.
5. Push the branch (do NOT push to main): `git push -u ant {branch_name}`.
6. Write a handoff to {handoff_file} with:
   - Branches closed (list with source-line refs)
   - Tests added (count + brief description of each)
   - Final coverage % (line + branch) for `src/lib/inventory/`
   - Anything you noticed but didn't fix (e.g. unused exports, naming concerns)
7. Mark {status_file} as: `state=done, completed=<iso timestamp>`.

## Constraints (HARD)

- **Do NOT modify `status.ts`** — only add tests.
- **Do NOT push to `ant/main`** — the orchestrator merges to `main`, then we push to `ant` once reviewed.
- **Do NOT push to `origin`** (if it exists) — only to `ant`.
- Do not spawn subagents for the test writing — do it inline, this is a focused task.
- The 14 existing tests in `__tests__/status.test.ts` MUST still pass.
- Report results in your final response. The launcher captures that response automatically.
## Completion
Do not spawn subagents or external agents for this task.
Report results in your final response.
The worker launcher captures your response in `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase2-inventory-tests/lib-inventory/handoff.md` automatically.
The worker launcher updates `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase2-inventory-tests/lib-inventory/status.md` automatically.
## Tag to Ship
When done, push tag `phase2-inventory-lib-v1` to remote `ant`:
```bash
git push ant phase2-inventory-lib-v1
```
