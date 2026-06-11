# Handoff: lib-api-edge

## Summary
- 3 modules tested with 36 fresh unit tests, 100% line/function/branch
  coverage on each.
- Pushed branch `wip/phase3-web-modern-lib-api-edge` and tag
  `phase3-lib-api-edge-v1` to `ant`.

## Files Changed

**Tests added (3 new files, 420 lines):**
- `web-modern/src/lib/api/auth-token.test.ts` — 12 tests across SSR +
  browser paths (commit 30fd03f)
- `web-modern/src/lib/api/queryClient.test.ts` — 9 tests pinning
  every default + the singleton guarantee (commit 9d62b60)
- `web-modern/src/lib/apps.test.ts` — 15 tests pinning the catalog
  contract (id uniqueness, field completeness, group balance, accent
  palette, `appHref`) (commit 66bb1ff)

**Dependency change (1 file, 2 commits):**
- `web-modern/package.json` + `web-modern/package-lock.json` —
  added `@vitest/coverage-v8@^3.2.6` as a devDependency so the
  `--coverage` flag the task asks for can resolve a reporter
  (commit a2d3fe2). The npm install with `--legacy-peer-deps` also
  re-sorted the manifest (paraglide-js / react-query moved up) and
  created the lockfile that didn't exist on `main` for this
  worktree.

**No source files touched.** Per the task constraint.

## Modules tested
| Module                         | Lines | Branches | Tests |
|--------------------------------|-------|----------|-------|
| `web-modern/src/lib/api/auth-token.ts`  | 100% | 100% | 12 |
| `web-modern/src/lib/api/queryClient.ts` | 100% | 100% |  9 |
| `web-modern/src/lib/apps.ts`            | 100% | 100% | 15 |

## Tests / Verification

- **Test runner:** `npm --prefix web-modern test` → 6/8 test files
  pass with 89 tests passing across them. The 2 failing files are
  pre-existing (not in this worker's scope):
  - `src/components/ui/HybridBadge.test.tsx` — needs
    `@testing-library/dom` as a peer dep, which is not in
    `package.json` (gap predates this branch).
  - `src/lib/inventory/__tests__/status.test.ts` — imports
    `../status` but `web-modern/src/lib/inventory/status.ts` is not
    on this branch. The source file lives on
    `64d7beb (test(inventory): close 3 untaken branches...)` only.
- **Typecheck:** `npm --prefix web-modern run typecheck` → clean
  for the 3 new test files. The 2 pre-existing errors (the same
  HybridBadge and status test files above) are not in this scope.
- **Coverage:** `npx --prefix web-modern vitest run --coverage
  src/lib/api/auth-token.test.ts src/lib/api/queryClient.test.ts
  src/lib/apps.test.ts` → 100% on all three modules (line /
  function / branch).
- **Test-count delta:** 53 → 89 tests (+36) across the web-modern
  suite.
- **Pushed:** branch + tag to `ant` (not `origin`).

## Follow-ups / things I noticed

1. **apps.ts has 14 entries, not 13.** The task description and
   `body.apps.length === 13` invariant in the server tests refer to
   13 apps, but `src/lib/apps.ts` currently has 14 (crm, finance,
   copilot, desk, campaigns, projects, inventory, purchase, people,
   docs, analytics, flow, forms, **cfo**). I did NOT add or remove
   entries per the hard constraint. My test asserts
   `Object.keys(APPS).length === APP_IDS.length` so it stays
   consistent with the source — please verify the 13/14 assumption
   in the orchestrator and the server tests before merge.
2. **`@vitest/coverage-v8` was missing from `package.json`.** I
   added it as `^3.2.6` to match vitest 3.2. Without this,
   `npx vitest run --coverage` fails with `MISSING DEPENDENCY
   Cannot find dependency '@vitest/coverage-v8'`.
3. **No `package-lock.json` existed on this branch.** I generated
   one via `npm install --legacy-peer-deps`. The lockfile is
   6300+ lines — the install was driven by react-start 1.168's
   peer dep on `vite >= 7.0.0`, which conflicts with the pinned
   `vite@^6.0.0` in `package.json`. Workaround was
   `--legacy-peer-deps`. Worth a follow-up: bump vite to ^7 or
   pin react-start to a version that allows vite 6.
4. **`vitest.config.ts` is on the deprecated `environmentMatchGlobs`
   option** (Vitest 3 emits a DEPRECATED warning at the start of
   every run). The replacement is `test.projects`. Pre-existing
   on `main`, not changed by me — just flagging.
5. **Pre-existing typecheck errors** in `HybridBadge.test.tsx` and
   `status.test.ts` (described above) are still there. Not in
   scope to fix from this branch.

## Final state
- Branch: `wip/phase3-web-modern-lib-api-edge`
- Tag: `phase3-lib-api-edge-v1`
- Commits ahead of `main`: 4 (3 tests + 1 chore)
- Push status: branch + tag live on `ant`
