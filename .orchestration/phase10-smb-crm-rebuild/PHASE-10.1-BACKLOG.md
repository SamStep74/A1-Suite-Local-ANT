# Phase 10.1 — Pre-existing Regression Backlog

Captured at the end of Phase 10 (`phase10-smb-crm-v1` shipped on `ant/main`).
These are **not caused by Phase 10** — they pre-existed on the pre-Phase-10 baseline
(`ant/main` at `b774600` and earlier, `origin/main` at `fae01a5` and earlier).

The next push that triggers a full test suite + typecheck will surface these as
"new" failures and make the next diff look worse than it is. Fix or quarantine
them before starting Phase 11.

---

## A. ANT (`A1-Suite-Local-ANT`) — 5 test failures on `ant/main`

### A.1 `src/routes/app/fleet/-index.test.tsx` — 4 failures in `helpers` describe

All 4 are the same root cause: the helper functions (`formatFleetIdShort`,
`tripStateLabelArm`, `coldChainCategoryLabelAm`, `fleetTabFromHash`) return
**substring values** of what the test expects — the **Edit tool's Armenian
corruption pattern** (U+0530..U+0556 + U+0561..U+0586 mixed-byte insertion of the
string `Delays` mid-text; see agent memory entry "Edit tool gotcha").

Example (from `formatFleetIdShort` test):
```
expected: 'trailing-'
received: 'iling-'    // prefix swallowed
```

The `fleetTabFromHash` test uses Armenian input that's already in the source —
so this is *not* the Edit tool, it's a *pre-existing* test vs impl mismatch where
the test fixture was written against a *different* implementation than what's now
on `ant/main` (the impl was updated during Phase 8 fleet re-architecture; the test
was never updated).

**Fix:** either (a) rewrite the 4 tests to assert the *current* impl behavior, or
(b) use heredoc + python byte-level replacement to fix the Armenian input strings
in the source.

### A.2 `src/components/shell/AppLauncher.test.tsx` — 1 failure

```
"navigates to /app/<id> and closes the launcher when an app card is clicked"
```

Assertion: clicking a card should call `useNavigate({ to: '/app/<id>' })` and
`onClose()`. The mock's `useNavigate` returns `vi.fn()` — the test passes a real
card-click handler. The failure is the mock `Link` component (from
`@tanstack/react-router`) not propagating the click.

**Likely cause:** recent TanStack Router upgrade (probably the 1.168 bump in
Phase 8) changed the `Link` API. The mock at the top of the test file stubs
`Link` as an `<a>` — and the `<a>` doesn't get the `Link`-specific navigation
handler. Fix: render with the real `Link` and a real test router, or update
the mock to call `navigate` and `onClose` on click.

**NOT caused by my `smb-crm` APP_IDS addition** — `APP_IDS.length` increased from
18 → 19, but the test uses the live `APP_IDS` array (line: `for (const id of APP_IDS)`),
so the count adjusts automatically. The single failure is the click-handler
one, not a count assertion.

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

1. **A.2 first (15 min)** — one-line mock fix. Unblocks the full test suite
   run. Then `vitest run` from `ant/main` will go from "5 pre-existing fails"
   to "1 pre-existing fail" (the 4 fleet ones).
2. **A.1 (30 min)** — rewrite 4 fleet test fixtures to match current impl
   (or use heredoc to fix the Armenian in source). Same goal: `vitest run` clean.
3. **B.1 (1-2 hours)** — either restore enum values OR refactor to string
   union. The string-union refactor is the longer-lived fix.
4. **B.2 (30 min, if still present)** — audit `apps/erp` cross-imports.

After all 4 steps:
- `vitest run` from `ant/main` should be green (modulo whatever pre-existing
  fleet feature tests exist that we haven't documented yet).
- `npm run typecheck --workspaces` from MAX should be green.

---

## What this backlog does NOT cover

- A1-Platform, A1-Suite-Local-EXTENDED, A1-SMB-CRM-HY-Max regressions — those
  repos have their own backlogs independent of this Phase 10 work.
- The "V1 vs V2" cut (real-time WebSocket chat, Ollama, PDF, mobile push) is
  in the Phase 10 contract §4 and is intentionally NOT in this backlog.
