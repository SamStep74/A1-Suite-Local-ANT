# Phase 10.10 — CI smoke/full split

**Created:** 2026-06-15 04:30 UTC
**Base ref:** `879165b` (= `ant/main` = `ant/integration/phase10-9-d`)
**Approach:** Single-orchestrator, inline, no tmux workers
**Wall-clock budget:** 30-45 min total (mostly waiting on `pnpm playwright test`)

## Why

The 110-test e2e suite has 66 known-failing tests at the 4f6e17c base (per the wave-4 audit at STATE.md:1300). Running the full suite in CI is expensive (~10-15 min wall-clock) and produces a confusing signal — green/red based on 44 vs 110 with no granularity.

Splitting into `smoke` (the 44 currently-passing tests + the 5 wave-1 fixed specs) and `full` (all 110) gives:
- A clear "smoke green = safe to merge" signal on every PR
- A "full" diagnostic run on a nightly cron that doesn't block merges
- A per-spec audit trail of what the 66 known-failures actually need

## Why now

The 10.9 (d) wave-N e2e content fix approach has hit 3+ consecutive NOOP/INFRA-CLOSED waves (wave-3 partial, wave-4 0/3 NOOP, wave-5 0/2 INFRA). Per the `wave-n-worker-death-pattern` memory, the wave-N approach is now STOPPED. 10.10 is the natural pivot: orthogonal to failing tests, configuration + docs work, single-orchestrator pass.

## What changes

| File | Change | Risk |
|------|--------|------|
| `web-modern/playwright.config.ts` | Add `@smoke` tag handling, expose grep knob | Low — additive, doesn't change test logic |
| `web-modern/e2e/**/*.spec.ts` (~50 files) | Add `@smoke` annotation to passing specs | Very low — comment-only changes |
| `web-modern/package.json` | Add `test:e2e:smoke` + `test:e2e:full` scripts | Low — additive |
| `.github/workflows/ci.yml` | Split: smoke on PR, full on nightly cron | Low — CI config only |
| `.orchestration/phase10-10-ci-smoke-full-split/known-failures.md` | NEW: per-spec root-cause + deferral status for 66 failing tests | Zero — docs only |

## What does NOT change

- No test source code edits
- No test helper edits (`_helpers.ts`, etc.)
- No `vite.config.ts`, `tsconfig.json`, or vitest config
- No app source code

## Tasks (sequential, single orchestrator)

1. **Audit runtime** (~10-15 min) — run `pnpm playwright test --reporter=line` at 879165b, log to `audit-runtime.md`. Confirm 44/110 baseline still holds. ⚠️ **Currently running in background (task ID banv0y8ax)**
2. **Tag smoke specs** (~5-10 min) — add `@smoke` to ~50 passing specs based on audit data
3. **Add scripts** (~1-2 min) — `test:e2e:smoke` (uses `--grep @smoke`), `test:e2e:full` (no grep)
4. **Split CI** (~5-10 min) — PR job uses smoke, nightly cron uses full
5. **Document known failures** (~5-10 min) — write `known-failures.md` from audit + STATE.md postmortem data
6. **Verify** (~20-25 min) — run smoke + full locally, confirm split works

## Audit gates

| # | Gate | Command | Expected |
|---|------|---------|----------|
| 1 | Baseline audit | `pnpm playwright test --reporter=line` | 44/110 pass (matches wave-4 baseline) |
| 2 | Smoke passes | `pnpm test:e2e:smoke` | 50/50 pass |
| 3 | Full matches baseline | `pnpm test:e2e:full` | 44/110 pass (no regression from tagging) |
| 4 | Typecheck clean | `pnpm typecheck` | 0 errors |
| 5 | Build clean | `pnpm build` | 0 errors |

## Branch + tag + push

- Branch: `wip/phase10-10-ci-smoke-full-split`
- Tag: `phase10-10-ci-smoke-full-split-v1`
- Push: `git push ant <branch>` and `git push ant <tag>`
- Integration: `git push ant main:refs/heads/ant/integration/phase10-9-d` (after merge to main)
- Main: `git push ant main:refs/heads/ant/main` (per the standing refspec rule)

## Outputs

- `.orchestration/phase10-10-ci-smoke-full-split/plan.json` ✅
- `.orchestration/phase10-10-ci-smoke-full-split/plan.md` ✅ (this file)
- `.orchestration/phase10-10-ci-smoke-full-split/audit-runtime.md` (after task 1)
- `.orchestration/phase10-10-ci-smoke-full-split/known-failures.md` (after task 5)
- `.orchestration/phase10-10-ci-smoke-full-split/handoff.md` (final)

## Postponed

- 10.9 (d) wave-6+ (3+ consecutive NOOP waves → STOPPED)
- 10.9 (e) shared helpers refactor (not in this session's scope)
- Vitest flakes (separate phase, 10.9 (g) already closed NOOP)

## Related

- `wave-n-worker-death-pattern` memory
- `two-remote-workflow` memory (push only to `ant`, refspec for main/integration)
- `kill-idle-workers` memory (tmux server died for wave-5; no worktrees to reap here)

## Cleanup proposal (for user approval, NOT executed)

13 stale phase10-9 worktrees from waves 2/3/4/5 with no commits ahead of base:

| Wave | Worktree | Branch | Last commit | Uncommitted |
|------|----------|--------|-------------|-------------|
| w2 | apps | orchestrator-phase10-9-e2e-content-fixes-w2-apps | 1b4f49b | 0 |
| w2 | comm-ai-big | orchestrator-…-w2-comm-ai-big | 1b4f49b | 0 |
| w2 | comm-ai-small | orchestrator-…-w2-comm-ai-small | 1b4f49b | 0 |
| w2 | docs-2 | orchestrator-…-w2-docs-2 | 1b4f49b | 0 |
| w2 | finance | orchestrator-…-w2-finance | 6af1b66 | 0 |
| w2 | fleet-greens-2 | orchestrator-…-w2-fleet-greens-2 | 1b4f49b | 0 |
| w3 | apps-spa-warehouse | orchestrator-…-w3-apps-spa-warehouse | 8c7ce8e | 0 |
| w3 | comm-ai-rest | orchestrator-…-w3-comm-ai-rest | 40c78d4 | 0 |
| w3 | docs-misc-rest | wip/phase10-9-e2e-content-fixes-w3-docs-misc-rest | b526113 | 0 |
| w3 | finance-rest | orchestrator-…-w3-finance-rest | dc6c939 | 0 |
| w3 | fleet-greens-rest | orchestrator-…-w3-fleet-greens-rest | 40c78d4 | 0 |
| w5 | locale-spa-rest | wip/phase10-9-e2e-content-fixes-w5-locale-spa-rest | 203445e | 1 (pnpm-lock.yaml, gitignored) |
| w5 | procurement-canary-rest | wip/phase10-9-e2e-content-fixes-w5-procurement-canary-rest | 203445e | 1 (pnpm-lock.yaml, gitignored) |

All 13 have 0 uncommitted tracked files. The 2 wave-5 worktrees have only `pnpm-lock.yaml` uncommitted (which is gitignored). Safe to remove.

**Cleanup command** (pending user approval):
```bash
for wt in /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-queue-phase10-9-e2e-content-fixes-w{2,3,4,5}-*; do
  git worktree remove --force "$wt" 2>/dev/null && echo "removed: $wt"
done
```

This will also remove the 3 wave-4 worktrees not in the table above (they have the same `w4-` prefix).
