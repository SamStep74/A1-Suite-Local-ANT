# Handoff: vitest-flakes (Phase 10.9 (g))

- State: complete
- Worker: vitest-flakes
- Branch: `wip/phase10-9-vitest-flakes-vitest-flakes`
- Tag: `phase10-9-vitest-flakes-vitest-flakes-v1` @ `793a974`

## Verdict: NOOP-FIX-NEEDED

All 3 isolated tests passed cleanly on a single fresh run, and the full vitest non-regression run
showed 0 failures across 124 files / 2470 tests. Neither flake was reproducible in the current
build, so no source/test edits were required.

## (a) Audit results

### 1. `web-modern/src/components/shell/AppLauncher.test.tsx` (audit)
- Last test "renders the Armenian labels for at least one app (bilingual UX contract)" — passes
  cleanly. Lingui catalog is already pre-loaded by `vitest.setup.tsx` (`I18nProvider` import
  triggers the macro bundle), so `screen.getByText("Հաճախորդներ")` resolves synchronously.
- Result: **12/12 passed in 216 ms**.
- Drift class: **none observed** (flake did not reproduce).

### 2. `web-modern/src/routes/app/fiscal-gates/index.test.tsx` (audit)
- The `await waitFor(() => { const rows = document.querySelectorAll(...) })` block at
  `index.test.tsx:169-185` resolved within the default 1 s window.
- Result: **6/6 passed in 214 ms**.
- Drift class: **none observed** (flake did not reproduce). The seeded MSW handlers and the
  QueryClient defaults are stable; if this flakes again in CI under cold-start pressure, the
  recommended fix from the task brief (`findAllByTestId` with a 10 s timeout) is still the
  lowest-risk rewrite and would be the first thing to apply.

### 3. `web-modern/src/lib/fleet/__tests__/status.test.ts` (audit only)
- Covers `fleetTabFromHash`, `tripStateLabelArm`, `coldChainCategoryLabelAm`, `formatFleetIdShort`
  (and friends — file has 45 tests total, the 4 named helpers being a subset of those).
- Result: **45/45 passed in 6 ms**.
- Drift class: **none observed** (10.6 W2 fix at `1c49ec4` still holds).

## (b) Fixes applied

None. **Drift class: NOOP** — no flake reproduced in this environment, so the
`<testid>` / `findAllByTestId` / `findByText` rewrites prescribed in the task were not needed.

## (c) Audit gates

| # | Gate | Command | Result |
|---|------|---------|--------|
| 1 | Isolated AppLauncher | `pnpm test src/components/shell/AppLauncher.test.tsx` | 12/12 PASS (216 ms) |
| 1 | Isolated fiscal-gates | `pnpm test src/routes/app/fiscal-gates/index.test.tsx` | 6/6 PASS (214 ms) |
| 1 | Isolated fleet status | `pnpm test src/lib/fleet/__tests__/status.test.ts` | 45/45 PASS (6 ms) |
| 2 | Cluster vitest | `pnpm test src/components/shell src/routes/app/fiscal-gates src/lib/fleet` | 6 files, 97/97 PASS |
| 3 | Full vitest non-regression | `pnpm test` | 124 files, 2470/2470 PASS (54 s) |
| 4 | Typecheck | `pnpm typecheck` | 0 errors |
| 5 | i18n extract | `pnpm i18n:extract` | idempotent (242 hy source, 17 missing in en/ru, no source churn) |
| 6 | Build | `pnpm build` | 0 errors (dist 1.70 MB JS, 82 kB CSS) |

`pnpm i18n:extract` produced no catalog diffs — confirms no test or source change touched a
translatable string. The only untracked file in the worktree is the top-level `pnpm-lock.yaml`
which is not part of the audit scope (and was never tracked in this branch).

## (d) Tag SHA

- Tag: `phase10-9-vitest-flakes-vitest-flakes-v1`
- SHA: `793a974b70d4b8597afb1d46c35a14e67df2c102`
- Branch: `wip/phase10-9-vitest-flakes-vitest-flakes` (pushed to `ant`)

## Notes for the next worker

If either flake resurfaces in CI / fresh-clone environment:

- **AppLauncher Armenian label flake** — prefer the `getByTestId("app-card-crm")` rewrite from
  the task brief. Lingui macro ordering is sensitive to bundler/import-graph order; a
  `data-label-am` attribute is immune to catalog load timing.
- **fiscal-gates row count flake** — switch the `waitFor` block at `index.test.tsx:169-185` to
  `await screen.findAllByTestId(/^data-table-row-/, {}, { timeout: 10000 })`. The current
  selector chain is correct; the issue is the waitFor timeout under load.
