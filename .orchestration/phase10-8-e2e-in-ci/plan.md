# Phase 10.8 (e) — e2e in CI (refresh + validate post-10.8-a)

> **Theme (e)** of the 10.7 close-out: harden the existing e2e GitHub Actions lane after the 10.8 (a) unblock. Theme (b) (10.2a pilot) is still gated on M3. Theme (c) (real LLM backend) is pending vendor. Theme (d) (delete legacy `web/`) is in flight as `phase10-12-legacy-delete`.

## Background

The CI workflow at `.github/workflows/ci.yml` already has a 3-job structure (`server`, `web-modern`, `e2e`) and the e2e job is configured to run the full `playwright test` suite on push to `main`, PR to `main`, and manual dispatch. The e2e job:

- timeout: 12 minutes
- installs `web-modern` deps + Playwright chromium
- resets `data/` for the seeded credentials
- starts Vite dev server on `:4173` as a background process
- runs `npm run test:e2e` (with `START_FASTIFY=1` so Playwright boots the Fastify backend on `:4100`)

What needs to change post-10.8 (a):

1. **Stale comment**: line 6 still says `E2E (Playwright smoke (15 tests, full stack))` — but the suite has grown to 92 `test()` invocations across 26 specs (the 6 expanded specs from 10.7 + 20 more). The 8 specs that 10.8 (a) unblocked alone contribute 27 tests (fiscal-gates 5, triage-inbox 4, ask-ai 4, document-steppers 9, onboarding 8, locale-switching 3, apps 20, i18n-canary 3).
2. **Tight timeout**: 12 minutes for 92 tests with `workers: 2` + `retries: 2` (per `playwright.config.ts` CI overrides) is borderline. The 8-spec subset from 10.8 (a) runs in 1.1m locally, but the full 26-spec suite on a fresh CI runner (cold install, cold `node_modules`, Vite + Fastify boot) will be slower. Bump to 15m.
3. **Broken `!ant` filter**: the push trigger uses `branches: ["**", "!ant"]` which excludes the literal branch name `ant` but does NOT exclude `ant/main` (the orchestrator's integration ref). The orchestrator's `git push ant main:refs/heads/ant/main` creates pushes to `ant/main`, which the current filter does not match. The comment at line 24-28 says "Workflows only fire on pushes to the same-repo ref, so this is belt-and-suspenders" — but the `!ant` glob is too narrow. Fix to `!ant/**` (or `!ant/*` to match one level).
4. **No CI-verified pass after 10.8 (a)**: the orchestrator's integration merge at `76e4d65` will not have a CI-validated green check until the next push to `main` on the public repo. The worker should locally validate that the full e2e suite passes against `ant/main @ a6010ce` (the close-out of 10.8 a) before committing the CI changes.

## Scope (single file)

The plan touches exactly one file: `.github/workflows/ci.yml`. No `src/`, no `e2e/`, no `package.json` change. The diff is:

1. Update the e2e job header comment (line 6, plus surrounding context) to reflect 92 tests / 26 specs.
2. Bump `timeout-minutes: 12` → `timeout-minutes: 15` for the `e2e` job.
3. Fix the `!ant` filter to `!ant/**` so it actually catches the orchestrator's `ant/main` integration pushes.
4. Update the trigger-filter comment (lines 24-28) to document the fix.

That's it. ~10-15 lines of diff.

## What is OUT of scope

- Adding new e2e specs (none added since 10.7).
- Splitting the e2e job into `smoke` (fast) + `full` (slow) lanes. The current single-lane is fine; with 92 tests in 15m it's well under the 30m GitHub-hosted default.
- Adding matrix testing (chromium + firefox + webkit). Out of scope; can be a 10.9+ if/when needed.
- Adding CI for the `e2e/_helpers.ts` test infra (the helper file is e2e code; not unit-testable in isolation).
- Migrating the e2e CI to a different provider (Vercel build, etc.). GitHub Actions is the existing lane; the e2e job is already there.

## Worker

| # | Worker name | File ownership | Verify |
|---|-------------|----------------|--------|
| W1 | `e2e-in-ci` | `.github/workflows/ci.yml` (single file, ~10-15 line diff) | (1) `pnpm playwright test` (full, all 26 specs) green locally; (2) yaml lint via `actionlint` if available, else `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`; (3) commit + push + tag `phase10-8-e2e-in-ci-v1`. |

## Audit gates (all must pass before merge)

1. `cd web-modern && pnpm playwright test` → all 26 specs, 92 tests, green
2. `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` → no parse error
3. `grep -E "timeout-minutes: 15" .github/workflows/ci.yml` → hit (confirms bump)
4. `grep -E '!ant' .github/workflows/ci.yml` → hit on the `!ant/**` form (not the broken `!ant`)
5. `git diff` on the branch shows ONLY `.github/workflows/ci.yml` modified
6. Commit message: `ci(github): Phase 10.8 (e) bump e2e timeout + fix ant push filter + refresh stale comment — 92 tests across 26 specs`
7. Pushed to `ant` via refspec (worker tag at the worker's commit, integration tag at the merge commit on `ant/main`)

## Risks

- **CI green in 15m on GitHub-hosted runner**: the e2e suite is bigger now. If the timeout is still too tight, escalate to 20m in a follow-up. 15m is a safe +50% margin over the current 12m, and the 10.8 (a) worker's local 1.1m for 8 specs suggests the full 26-spec suite on a fresh runner will be 5-10m. If 15m is hit, the next stop is splitting smoke/full lanes (out of scope for this PR).
- **`!ant/**` filter side effects**: changing the filter could change which pushes trigger CI. Test on a feature branch first (the worker's worktree is on `wip/phase10-8-e2e-in-ci-e2e-in-ci`, not on `ant/main` directly). Once merged, the orchestrator's `ant/main` pushes will no longer trigger CI, which is the desired behavior.
- **Orphaned branch artifact**: after merge, the worker branch `wip/phase10-8-e2e-in-ci-e2e-in-ci` should be deleted (teardown step). Preserve the tag.

## Follow-ups (carry into 10.9+)

- Split e2e into `smoke` (1m, `apps.spec.ts` + `i18n-canary.spec.ts`) and `full` (15m, all 26) lanes if the 15m timeout starts hitting. Until then, the single lane is fine.
- Add CI step to upload Playwright HTML report (the existing `playwright-report/` upload in the `web-modern` job is a leftover; the e2e job should own the report).
- Add status badge to README.
