# Phase 10.1 — Pre-existing Regression Backlog

Captured at the end of Phase 10 (`phase10-smb-crm-v1` shipped on `ant/main`).
These are **not caused by Phase 10** — they pre-existed on the pre-Phase-10 baseline
and have been carried forward through Phase 10.5 + 10.6.

The next push that triggers a full test suite + typecheck will surface these as
"new" failures. Fix or quarantine them before starting Phase 11.

---

## A. ANT (`A1-Suite-Local-ANT`) — test environment broken on `ant/main` (HEAD = `de16a1a`)

### A.1 All component tests fail with `ReferenceError: document is not defined`

```
$ npx vitest run src/routes/app/fleet/-index.test.tsx
Test Files  1 failed (1)
Tests       35 failed | 10 passed (45)

$ npx vitest run src/components/shell/AppLauncher.test.tsx
Test Files  1 failed (1)
Tests       12 failed (12)
```

Both test files render React components via `@testing-library/react`, which
requires a DOM. The error is:
```
ReferenceError: document is not defined
  at Proxy.render @testing-library/react/dist/pure.js:256
```

**Root cause:** vitest's `environmentMatchGlobs` config (in
`web-modern/vitest.config.ts`) is supposed to route component tests to
`jsdom`, but at least some test files are running in `node` env instead.
This is a **vitest config regression** — when running a single test file
in isolation, 35+ tests run correctly (when env is correctly jsdom); when
running via the full suite, the env match doesn't trigger.

**Evidence:** Running just `src/components/shell/AppLauncher.test.tsx` shows
12 failures (the dialog never renders because there's no document). But the
test file does NOT have any per-file `// @vitest-environment` pragma — so
the env should come from the config default (`jsdom`).

The previously working runs (Phase 9 rbac, Phase 10.5, Phase 10.6) added
new tests that may have shifted the env-match cache. Most likely:
- A test file under `src/lib/api/` with `.test.tsx` (or similar) was added
- This `environmentMatchGlobs` path now matches something it shouldn't
- Or the glob pattern was too broad

**Fix (recommended):** add a per-file pragma to the two affected test files:
```ts
// @vitest-environment jsdom
```

Or audit `web-modern/vitest.config.ts`:
```ts
environmentMatchGlobs: [
  ["src/lib/api/**", "node"],
],
```
The `src/lib/api/**` pattern is too greedy if a React test in that
subtree was added recently.

**NOT a code regression.** Zero changes to the test files would fix this.

### A.2 MAX `apps/erp` cross-package break (legacy, still present)

From the Phase 9 handoff (not re-verified today, but referenced in the
MAX typecheck failure below):

- `apps/erp/src/index.ts` references a missing `./idempotency` module path
- `work-orders.ts` / `work-orders-v1.ts` had field renames (`refType`,
  `minutes`) that didn't propagate to the test mocks

**NOT caused by Phase 10.**

---

## B. MAX (`A1-Suite-Local-MAX`) — auth typecheck failure on `main`

### B.1 `packages/auth/src/rbac.ts` — 20+ `Type '"X"' is not assignable to type 'Action' / 'Resource'` errors

The `Action` and `Resource` enums (declared in `packages/auth/src/rbac.ts`
itself, OR imported from `packages/erp/src/...`) are **missing 12+ values**
that `rbac.ts` references:

- Missing `Action` values: `rotate`, `release`, `complete`, `reverse`, `send`, `accept`, `invite`, `revoke`, `revoke_any`
- Missing `Resource` values: `fiscal_device`, `work_order_labor`, `mrp_suggestion`, `contact_list_member`

This blocks `@a1/auth`'s `npm run typecheck`, which blocks the `auth → erp`
cross-package import chain (`auth/src/index.ts:29` imports from `erp/src/index.ts:37`),
which breaks **all** downstream packages that depend on `@a1/auth`.

**Not caused by Phase 10** (Phase 10 didn't touch MAX at all).

**Fix:** either
- (a) Restore the missing enum values to `packages/auth/src/rbac.ts` (or
  wherever `Action` / `Resource` are defined).
- (b) Refactor `rbac.ts` to use string literal union types instead of enums —
  this lets it accept any string and forward-compat to erp's new actions.

The string-union refactor is what the ANT RBAC pattern uses
(`web-modern/src/lib/rbac/permissions.ts` — 29 string-literal codes, no enums).
This is the "ANT pattern, applied to MAX" work that was supposed to happen
in a separate sync — see also the RBAC parity test in
`A1-Suite-Local-ANT-phase9-rbac-ant/test/rbac.test.js`.

### B.2 `apps/erp` pre-existing break (from earlier handoff — not re-verified today)

From the Phase 9 handoff (still in effect):

- `apps/erp/src/index.ts` references a missing `./idempotency` module path
  (or similar) — needs `git log` audit to find the right location.
- `work-orders.ts` / `work-orders-v1.ts` had field renames (`refType`,
  `minutes`) that didn't propagate to the test mocks.

If B.1 is fixed first, B.2 may auto-resolve (or surface new errors). Run
`npm run typecheck --workspaces` after fixing B.1.

---

## Recommended fix order

1. **A.1 (10 min)** — add `// @vitest-environment jsdom` pragma to
   `src/routes/app/fleet/-index.test.tsx` and
   `src/components/shell/AppLauncher.test.tsx`. Or, better, audit
   `web-modern/vitest.config.ts` for the too-greedy `src/lib/api/**` glob.
   This is the single highest-leverage fix — it unblocks 47 broken tests
   and reveals the actual fleet feature state.

2. **A.2 (30 min)** — audit `apps/erp` cross-imports (or in MAX, the
   equivalent).

3. **B.1 (1-2 hours)** — either restore enum values OR refactor to string
   union. The string-union refactor is the longer-lived fix.

4. **B.2 (30 min, if still present)** — audit `apps/erp` cross-imports.

After all 4 steps:
- `vitest run` from `ant/main` should be green (modulo whatever
  feature-level test debt the fleet + AppLauncher test suites had).
- `npm run typecheck --workspaces` from MAX should be green.

---

## What this backlog does NOT cover

- A1-Platform, A1-Suite-Local-EXTENDED, A1-SMB-CRM-HY-Max regressions — those
  repos have their own backlogs independent of this Phase 10 work.
- The "V1 vs V2" cut (real-time WebSocket chat, Ollama, PDF, mobile push) is
  in the Phase 10 contract §4 and is intentionally NOT in this backlog.
- The Phase 10.5 + 10.6 work that shipped on `ant/main` between Phase 10
  and this backlog — those were integrated cleanly and the v1 + v6 tags
  are on remote.
