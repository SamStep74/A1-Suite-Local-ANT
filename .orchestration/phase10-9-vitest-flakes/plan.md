# Phase 10.9 (g) — Vitest flakes cleanup (AppLauncher + fiscal-gates + fleet audit)

> **Theme (g)** of the 10.9 close-out: clean the pre-existing vitest flakes carried since 10.0. Theme (d) (e2e content fixes) is in wave-3 (5 workers running). Theme (a) (CI audit gates) is folded into (d). Theme (b) (real LLM backend) is gated on M3. Theme (c) (Lingui activation) closed in 10.8 (a).
>
> **Last update:** 2026-06-14 17:55 UTC (21:55 local) — plan drafted while 10.9 (d) wave-3 workers run.

## Background

Two pre-existing vitest flakes have been carried since 10.0 typecheck cleanup:

1. **`AppLauncher.test.tsx`** — "renders the Armenian labels for at least one app (bilingual UX contract)" test. Asserts on the literal `Հաճախորդներ` (CRM's `labelAm`). This flake is **post-Lingui-macro-wire-up**: when `t({...})` macros are active (post-10.8 (a) fix), the rendered output goes through `i18n._(msgid)`, and the displayed text in non-default locales depends on catalog load timing. The test passes in isolation but flakes in full-suite runs (Lingui activation race re-appeared as a different shape).

2. **`fiscal-gates/index.test.tsx:169-185`** — "renders the fiscal-gates route with seed data" test. Uses `await waitFor(() => { const rows = document.querySelectorAll(...) })` with a `toBeGreaterThanOrEqual(2)` assertion. Under load, the `useQuery` hook returns slightly later than the waitFor timeout (2s default), and the test flakes with "expected ≥2 rows, got 0".

3. **4 fleet tests** (`fleetTabFromHash`, `tripStateLabelArm`, `coldChainCategoryLabelAm`, `formatFleetIdShort`) — were broken before 10.6 W2 (commit `1c49ec4`). Audit: confirm the fix is still in place and the tests pass on main.

## Base ref

`40c78d4` (orchestrator STATE.md body-correction close, on top of `ec4fbe5` 10.9 (d) integration close). Workers branch from `40c78d4`. The wave-3 workers are ALSO branching from `40c78d4`; this is a separate plan so file-disjoint ownership holds (10.9 (g) owns vitest files; 10.9 (d) wave-3 owns e2e spec files).

`ant/main @ b6a059f` is AHEAD of local main (parallel automation's port of A1-Platform backup-restore). The 10.9 (g) close will need to merge ant/main's head into local main before pushing the integration. Tag `phase10-9-vitest-flakes-v1` will be created at close.

## Scope (this wave)

**1 worker** (very bounded — 3 audit + 2 optional fixes):

| # | Worker | Test files | Tests | Action |
|---|--------|-----------|-------|--------|
| W1 | `vitest-flakes` | `web-modern/src/components/shell/AppLauncher.test.tsx` (1) + `web-modern/src/routes/app/fiscal-gates/index.test.tsx` (1) + `web-modern/src/lib/fleet/__tests__/status.test.ts` (4 audit only) | 6 | Audit + 2 optional fixes |

### File ownership rules (HARD)

- W1 may ONLY add/edit files under `web-modern/src/components/shell/AppLauncher.test.tsx`, `web-modern/src/routes/app/fiscal-gates/index.test.tsx`, and the new sibling `web-modern/src/components/shell/AppLauncher-helpers.ts` (if needed).
- W1 may also add a new `web-modern/src/routes/app/fiscal-gates/index-helpers.ts` sibling.
- **No** edits to `web-modern/src/components/shell/AppLauncher.tsx`, `web-modern/src/routes/app/fiscal-gates/index.tsx`, `web-modern/src/lib/fleet/panels/index.tsx`, or any source file.
- **No** edits to `_helpers.ts`, `playwright.config.ts`, `package.json`, `tsconfig.json`, `vite.config.ts`.
- **No** edits to server (`server/**`).

### Audit gates (every worker, in this order)

1. **Audit**: run `timeout 60 pnpm vitest run --bail=1 web-modern/src/components/shell/AppLauncher.test.tsx` to confirm the AppLauncher flake. Run `timeout 60 pnpm vitest run --bail=1 web-modern/src/routes/app/fiscal-gates/index.test.tsx` to confirm the fiscal-gates flake. Run `timeout 60 pnpm vitest run --bail=1 web-modern/src/lib/fleet/__tests__/status.test.ts` to confirm the 4 fleet tests are still green.
2. **Document the audit** in `status.md` — for each test: did it fail in isolation? In a `--run` 3x loop? The orchestrator will read the audit to decide if a fix is needed.
3. **If a fix is needed**: edit the test (NOT the source). Common patterns:
   - **AppLauncher Armenian label flake**: change `getByText("Հաճախորդներ")` to `findByText` with a `timeout: 5000` (waits for Lingui to settle). Or assert on a testid like `data-testid="app-crm"` and `toHaveAttribute("data-label-am", "Հաճախորդներ")` (avoids the rendered text race entirely).
   - **fiscal-gates row count flake**: change `await waitFor(() => { expect(rows.length).toBeGreaterThanOrEqual(2) })` to `await screen.findAllByTestId(/^data-table-row-/, {}, { timeout: 10000 })` (uses the testing-library's built-in retry + longer timeout).
4. **Cluster gate**: `timeout 300 pnpm vitest run --bail=1 web-modern/src/components/shell web-modern/src/routes/app/fiscal-gates web-modern/src/lib/fleet` → 0 new failures.
5. **Full vitest non-regression**: `timeout 600 pnpm vitest run --bail=1` → failure count ≤ 2 (the pre-existing 2 flakes; if both fixed, count is 0).
6. **Typecheck**: `timeout 180 pnpm typecheck` → 0 errors.
7. **i18n extract**: `timeout 120 pnpm i18n:extract` → idempotent.
8. **Build**: `timeout 300 pnpm build` → 0 errors.
9. **Commit message hygiene**: no "verify" substring (the `block-no-verify@1.1.2` hook scans the entire bash command line). Use "audit", "check", "confirm", "validate" instead.
10. **Push**: `git push ant <branch>` (NOT `origin`). Tag the close commit with `phase10-9-vitest-flakes-v1`.
11. **Handoff**: write `.orchestration/phase10-9-vitest-flakes/vitest-flakes/handoff.md` with: (a) audit results for all 6 tests, (b) drift class for each flake, (c) audit gate output, (d) tag SHA. Then flip `status.md` to `STATUS: PASS` (or `STATUS: NOOP-FIX-NEEDED` if no fixes are required).

## Merge order (orchestrator does this after worker reports)

After W1 reports PASS or NOOP:
- Run full audit gates: `pnpm typecheck`, `pnpm vitest run`, `pnpm i18n:extract`, `pnpm build`.
- Refspec push: `git push ant main:refs/heads/ant/integration/phase10-9-g` (NOT `ant/main`).
- Move integration tag `phase10-9-vitest-flakes-v1` to the new integration commit.
- Update `.orchestration/STATE.md` with 10.9 (g) close.

## Risks

- **Lingui activation race returns** — the 10.8 (a) fix was a complete fix. If AppLauncher's Armenian label test still flakes, the fix is to assert on a testid (NOT the rendered text), which is immune to Lingui activation timing.
- **fiscal-gates row count is a real flake** — needs `findAllByTestId` (built-in retry) instead of `waitFor` + custom assertion.
- **System load contention** — wave-3 workers are using 10 GB of RAM and ~50% CPU. Running vitest in parallel with them is slow but safe. Worker should set `NODE_OPTIONS=--max-old-space-size=2048` to avoid OOM in 16 GB shared system.
- **NOOP outcome is acceptable** — if all 6 tests are already green, the worker reports `STATUS: NOOP-FIX-NEEDED` and the integration is just an audit-only commit. This is a real, valuable contribution.

## Follow-ups (carry into 10.10+)

- 10.10 — Playwright HTML report upload to e2e CI job (already drafted in 10.10 plan on `wip/phase10-9-e2e-content-fixes-w3-plan` branch, commit 338d42b).
- 10.11 — Investigate Lingui macro activation race in `tours.ts` (10.8 (a) closed the route-handler race; the activation-order race for `i18n.activate(locale)` is still a possible footgun for any test that asserts on rendered text in non-default locales).
