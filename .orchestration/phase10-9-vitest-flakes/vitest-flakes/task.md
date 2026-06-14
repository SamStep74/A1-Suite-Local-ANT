# Task: vitest-flakes (Phase 10.9 (g))

## Scope

Audit + (if needed) fix 2 pre-existing vitest flakes + audit 4 fleet tests:

1. **`web-modern/src/components/shell/AppLauncher.test.tsx`** — last test "renders the Armenian labels for at least one app (bilingual UX contract)" — uses `screen.getByText("Հաճախորդներ")` (the literal Armenian text). Post-Lingui-macro-wire-up flake: rendered text depends on catalog load timing.

2. **`web-modern/src/routes/app/fiscal-gates/index.test.tsx:169-185`** — uses `await waitFor(() => { const rows = document.querySelectorAll(...) })` with `toBeGreaterThanOrEqual(2)`. Under load, `useQuery` returns later than the waitFor timeout.

3. **`web-modern/src/lib/fleet/__tests__/status.test.ts`** — 4 tests for `fleetTabFromHash`, `tripStateLabelArm`, `coldChainCategoryLabelAm`, `formatFleetIdShort`. Fixed in 10.6 W2 commit 1c49ec4. **Audit only** — confirm still green.

## Audit commands (run from `${WORKTREE_DIR}/web-modern`)

```bash
# Confirm the AppLauncher flake
cd ${WORKTREE_DIR}/web-modern && \
  NODE_OPTIONS=--max-old-space-size=2048 timeout 120 pnpm vitest run --bail=1 src/components/shell/AppLauncher.test.tsx

# Confirm the fiscal-gates flake
cd ${WORKTREE_DIR}/web-modern && \
  NODE_OPTIONS=--max-old-space-size=2048 timeout 120 pnpm vitest run --bail=1 src/routes/app/fiscal-gates/index.test.tsx

# Audit the 4 fleet tests
cd ${WORKTREE_DIR}/web-modern && \
  NODE_OPTIONS=--max-old-space-size=2048 timeout 120 pnpm vitest run --bail=1 src/lib/fleet/__tests__/status.test.ts
```

## Common fixes (if needed)

### AppLauncher Armenian label flake
Change the test to assert on a testid (immune to Lingui activation timing):
```tsx
// before:
expect(screen.getByText("Հաճախորդներ")).toBeInTheDocument();
// after:
const crmCard = screen.getByTestId("app-card-crm");
expect(crmCard).toHaveAttribute("data-label-am", "Հաճախորդներ");
```
Or use `findByText` with explicit timeout:
```tsx
expect(await screen.findByText("Հաճախորդներ", {}, { timeout: 5000 })).toBeInTheDocument();
```

If neither works, document the failure in `status.md` with the exact error message and DEFER.

### fiscal-gates row count flake
Change `waitFor` + custom assertion to `findAllByTestId` (built-in retry):
```tsx
// before:
await waitFor(() => {
  const rows = document.querySelectorAll('[data-testid^="data-table-row-"]');
  expect(rows.length).toBeGreaterThanOrEqual(2);
});
// after:
const rows = await screen.findAllByTestId(/^data-table-row-/, {}, { timeout: 10000 });
expect(rows.length).toBeGreaterThanOrEqual(2);
```

## Audit gates (in order)

1. **Each test isolated** — `timeout 120 pnpm vitest run --bail=1 <file>` for each of 3 test files.
2. **Cluster vitest** — `timeout 300 pnpm vitest run --bail=1 src/components/shell src/routes/app/fiscal-gates src/lib/fleet` → 0 new failures.
3. **Full vitest non-regression** — `timeout 600 pnpm vitest run --bail=1` → failure count ≤ 2 (pre-existing 2 flakes; if both fixed, count is 0).
4. **Typecheck** — `timeout 180 pnpm typecheck` → 0 errors.
5. **i18n extract** — `timeout 120 pnpm i18n:extract` → idempotent.
6. **Build** — `timeout 300 pnpm build` → 0 errors.

## Commit + push

- Branch: `wip/phase10-9-vitest-flakes-vitest-flakes`
- Tag: `phase10-9-vitest-flakes-vitest-flakes-v1`
- Push: `git push ant <branch>` (NOT `origin`)
- Commit message MUST NOT contain "verify" — use "audit", "check", "confirm", "validate" instead.

## Handoff

Write to `${HANDOFF_FILE}`:
- (a) audit results for all 6 tests (3 audit + 2 fixes + 4 fleet audits)
- (b) drift class for each flake
- (c) audit gate output (cluster + full vitest + typecheck + i18n + build)
- (d) tag SHA

Then flip `${STATUS_FILE}` to `STATUS: PASS` (or `STATUS: NOOP-FIX-NEEDED` if no fixes were required).

## Wall-clock budget

30 min. If exceeded, write `STATUS: TIMEOUT` to status.md and commit what you have.

## CRITICAL RULES (reminder)

1. **All bash wrapped in `timeout 300` or `timeout 120`** — no unbounded bash.
2. **Edit TEST files only** — never the source.
3. **Set `NODE_OPTIONS=--max-old-space-size=2048`** to avoid OOM in shared 16 GB system.
4. **No `_helpers.ts`, no `playwright.config.ts`, no `package.json`, no `tsconfig.json`** edits.
5. **No debug instrumentation** — no `console.log`, no `page.on('console')`, no `__errors` probes.
6. **No mcp__claude-in-chrome__* tools** (per CLAUDE.md).
7. **No subagents** — do the work inline.
8. **If bash times out, change something before retrying.**
9. **No "verify" in commit messages** — use "audit"/"check"/"confirm"/"validate".
10. **Push to `ant`, never `origin`.**
