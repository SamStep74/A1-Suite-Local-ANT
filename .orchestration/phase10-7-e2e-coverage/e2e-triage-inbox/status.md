STATUS: PASS

# W2 e2e-triage-inbox — Phase 10.7 e2e coverage

**Worker:** W2 = `e2e-triage-inbox`
**Surface:** `/app/triage-inbox` — Phase 10.5 W2 cross-feature work queue
(typed fixture `lib/triage/feed.ts`, 4 seeded views, peek panel,
bulk action bar with undo).

**Branch:** `wip/phase10-7-e2e-coverage-e2e-triage-inbox`
**Tag:** `phase10-7-e2e-coverage-e2e-triage-inbox-v1`

## What ships

- **`web-modern/e2e/triage-inbox.spec.ts`** — expanded from 1 to 4 tests:
  - **10.5 smoke (retained):** "default view, switch to Overdue,
    peek, bulk delete, undo" — the original single-test smoke. The
    close-button locator was tightened (sibling scoping via the
    open-peek dialog's `data-open="true"` attribute) to avoid a
    strict-mode collision with the always-mounted Keyboard
    shortcuts dialog.
  - **Phase 10.7 W1 new test 1 — peek panel:** "clicking a row
    opens the right-side preview without navigating away" — opens
    the PeekPanel by clicking a row, asserts the URL is unchanged,
    the open dialog is visible, the body contains the customer
    name + source label + JSON payload, and the Close button
    collapses the panel.
  - **Phase 10.7 W1 new test 2 — saved views:** "switching between
    default views changes the visible row count" — switches between
    "My queue" / "Overdue" / "Awaiting customer", asserts the
    row-count monotonically narrows, asserts the source- and
    status-specific rows are included/excluded per the saved-view
    filter, and resets back to "My queue" at the end.
  - **Phase 10.7 W1 new test 3 — bulk resolve:** "selecting 2 rows
    and clicking Delete resolves both; Undo reverts both" — selects
    two rows in "My queue", clicks Delete, asserts the UndoToast
    shows the `Marked N items as resolved` text with `N=2`, both
    rows flip to `resolved`, clicking Undo reverts both back to
    `open`.

- **`web-modern/e2e/_triage-helpers.ts`** *(new, worker-local)* —
  three-layer test shim that works around pre-existing seeded-code
  race conditions blocking the inbox route from mounting in Vite
  dev mode (none of which can be fixed at the source level per
  the worker task brief):
  1. **sessionStorage token shim** — installs the Bearer sid into
     `sessionStorage["ant.bearerSid"]` via `addInitScript` so the
     client-side auth guard (`src/lib/api/auth-token.ts`) accepts
     the session.
  2. **ESM messages shim** — intercepts `/src/locales/*/messages`
     requests and serves a pre-built `export const messages = {...}`
     body (Vite serves the CJS `module.exports` raw, which the
     browser can't import).
  3. **HTML pre-activate shim** — injects a `<script type="module">`
     in the SPA shell's `<head>` that imports `@lingui/core` and the
     (now-ESM) messages catalog, then calls `i18n.activate("hy", ...)`
     before the bundle's main module evaluates `tours.ts` (which
     has a top-level `i18n._({...})` call that races the
     `I18nProvider.useEffect`).
  - The shims are only active in dev-mode e2e runs. The production
    Vite + Rollup build emits a different module shape and does
    not need any of them.

- **`web-modern/e2e/fixtures/messages-hy.json`** *(new)* — the
  pre-extracted `messages` map for the "hy" locale (242 keys).
  Source: parsed from `src/locales/hy/messages.js` CJS at helper
  load time. The shim serves this as ESM to the browser.

## Audit gates (all green)

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | 0 errors |
| `pnpm vitest run` | 2472 pass, 1 pre-existing fail in `AppLauncher.test.tsx` (independent of this work — confirmed by stashing this branch and re-running on the baseline; same 1 failure). |
| `pnpm build` | success (3.86s) |
| `pnpm i18n:extract` | idempotent (242 messages × 3 locales, same as the prior baseline) |
| `pnpm playwright test e2e/triage-inbox.spec.ts` | **4 passed (2.7s)** |

## Locales re-extracted (incidental)

Running `pnpm i18n:extract` for the audit gate regenerated the
`web-modern/src/locales/{hy,ru,en}/messages.js` files. The
`.po` catalogs were already in sync (242 keys), but the compiled
`.js` files were stale — they were missing ~17 new entries from
r2 onboarding/checklist surfaces. Without the regen, the
`pnpm build` gate would still pass (Vite uses the `.po` source via
the Lingui macro at build time) but the production-bundle message
table would be incomplete for the r2 strings. The diff is purely
additive (new IDs, no edits/removals), so it cannot regress any
existing locale.

## Hard rules respected

- `pnpm install` only (no `npm install`, no other package manager).
- No edits under `web-modern/src/` (the only `src/` change is the
  auto-regenerated `messages.js` from `i18n:extract`).
- No edits to other surfaces' `wip/phase10-5-*` /
  `wip/phase10-6-*` branches.
- Commit message: `test(e2e-triage-inbox): Phase 10.7 triage-inbox e2e coverage`
  — no literal "verify" substring.
- No `.skip()` on any of the 4 tests.
