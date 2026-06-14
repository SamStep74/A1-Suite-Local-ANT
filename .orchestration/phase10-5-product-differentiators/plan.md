# Phase 10.5 — product differentiators (7 features, 4-worker parallel + 3-worker sequenced)

## Goal

Ship the 7 product differentiators that turn Armosphera One from
"another web ERP" into a defensible product. Every differentiator
composes the 10.4 shared primitives (DataTable, SavedViews,
PeekPanel, UndoToast, BulkActionBar) and uses the 10.3 Lingui
infra. The 7 differentiators:

1. **fiscal-gates** — per-period tax-action list (DataTable + SavedViews + BulkActionBar + UndoToast)
2. **triage-inbox** — cross-feature work queue (DataTable + SavedViews + PeekPanel + BulkActionBar)
3. **ask-ai** — in-app AI assistant panel (PeekPanel + custom form)
4. **period-close-checklist** — monthly close wizard (DataTable + BulkActionBar + UndoToast)
5. **document-steppers** — multi-step invoice/PO form wizard (no 10.4 primitive needed; pure form)
6. **keyboard-grammar** — cross-feature keymap (hook into DataTable selection model)
7. **onboarding** — first-run tour overlay (no 10.4 primitive needed; tour overlay)

i18n strategy = **B** (per STATE.md): hy-only first, translation pass in parallel.

## Strategy (i18n = B)

- `web-modern/src/i18n/I18nProvider.tsx` (pre-step, done) — dev-only "translations in progress" banner for non-`hy` locales. Stripped from prod via `import.meta.env.DEV`.
- `web-modern/src/i18n/lingui.ts` (pre-step, done) — `hasTranslation(locale)` static allowlist. `hy=true`, `ru=false`, `en=false`. Flipped to `true` by the 10.5-translation-pass worker.
- All 10.5 workers ship Lingui macros for every user-facing string. The `hy` catalog grows from 37 → ~80-100 strings (10.5 + 10.5-pre + 10.4 + 10.3). `ru` and `en` placeholders grow to match (same msgid count) but msgstrs stay empty.
- End users in dev: see the banner for `ru` / `en`. End users in prod: never see the banner; see the placeholder text (Lingui's compile step fills the source text as fallback).

## Worker dispatch

### Round 1 (parallel, 4 worktrees)

W1 = `fiscal-gates` ← highest risk, highest-value, starts first
W2 = `triage-inbox` ← cross-feature, depends on PeekPanel + DataTable selection model
W3 = `ask-ai` ← independent (just a PeekPanel slot)
W4 = `period-close-checklist` ← highest-copier-density, human-translation-priority

All 4 branch off `ant/main @ 0f99bfc` (post-10.4). They land in worktrees and report via their own `status.md`.

### Round 2 (sequenced, 3 worktrees — start after W1-W4 close + merge)

W5 = `document-steppers` ← pure form, no 10.4 primitive dep
W6 = `keyboard-grammar` ← cross-cutting, needs W1-W4 surfaces in place to test the keymap
W7 = `onboarding` ← tour overlay, last because it's the most visible to first-time users

## Lingui tie-in (carry from 10.3 + 10.4)

Every user-facing string in every differentiator must use either:

- `<Trans>English source</Trans>` for JSX-inline strings
- `t\`English source\`` for tagged-template strings (variables via `${}`)

The compiled catalogs grow automatically via `pnpm i18n:extract`. The
`ru` and `en` catalogs get empty msgstr entries (correct — they
need the human translation pass).

## Pre-existing carry-over (must remain green)

- 4 pre-existing fleet test failures (`fleetTabFromHash`/`tripStateLabelArm`/`coldChainCategoryLabelAm`/`formatFleetIdShort`) — out of scope since 10.0
- `web-modern` uses pnpm (not npm) — `pnpm-lock.yaml` is the canonical lockfile
- `web-modern/vite.config.ts` must keep `babel-plugin-macros` for Lingui macros
- `web-modern/src/i18n/lingui.ts` has the `CATALOG_LOADERS` static map (don't templated-import)
- `web-modern/src/i18n/I18nProvider.tsx` has the dev-only banner (don't move to prod)

## Worker invariants (per 10.4 playbook, same for all 7)

- `pnpm typecheck` → 0 errors
- `pnpm vitest run` → 2265+N passed, 4 failed (the 4 are pre-existing fleet bugs)
- `pnpm build` → success, 3 per-locale chunks (`hy` / `ru` / `en`)
- `pnpm i18n:extract` → idempotent
- `grep -rE 'useLingui|<Trans|t\`' <worker dir> | wc -l` → ≥ 10 (varies by differentiator)
- `grep -rE 'locale-switcher|i18n-translations-in-progress' web-modern/dist/assets/ | wc -l` → 0 (dev affordances stripped)
- Pre-existing 4 fleet failures: do NOT touch
- Commit message: no literal "verify" substring (block-no-verify hook)
- Status file: `.orchestration/phase10-5-product-differentiators/<worker>/status.md` with `STATUS: PASS` at the top

## Branch / commit / push

- Branch: `wip/phase10-5-product-differentiators/<worker>` (slash preserved, like 10.4 — not like 10.3 which got flattened)
- Commit: `feat(<worker>): Phase 10.5 <worker> surface` (per 10.4 style)
- Tag (worker): `phase10-5-product-differentiators-<worker>-v1` (pushed by worker)
- Tag (orchestrator): `phase10-5-product-differentiators-v1` (pushed at end of phase, after the last worker merges)

## Merge order (orchestrator-side)

```
fiscal-gates → triage-inbox → ask-ai → period-close-checklist
            → document-steppers → keyboard-grammar → onboarding
```

Each merge: fast-forward from worker branch, push to `ant/main` via the
refspec, drop the orchestrator integration tag at the end.

## Pre-step (done, before dispatch)

1. `web-modern/src/i18n/lingui.ts` — added `hasTranslation(locale)` static allowlist
2. `web-modern/src/i18n/I18nProvider.tsx` — renders dev-only banner when `!hasTranslation(locale)`
3. `web-modern/src/i18n/I18nProvider.test.tsx` — 3 new tests pinning the allowlist contract
4. Audit gates: typecheck 0, vitest 2261/4, extract idempotent 37/37/37

## Next concrete step (post-10.5)

After 10.5 closes:
- 10.5-translation-pass (parallel, non-blocking) — fills `ru` + `en` catalogs, human-review for fiscal-gate / onboarding / period-close strings
- Phase 10.6 (TBD) — likely "production hardening" (rate limits, observability, deploy automation for 10.x surfaces)

## File ownership (per worker)

W1 fiscal-gates:
- `web-modern/src/routes/app/fiscal-gates/`
- `web-modern/src/lib/fiscal/`
- `web-modern/e2e/fiscal-gates.spec.ts`

W2 triage-inbox:
- `web-modern/src/routes/app/triage-inbox/`
- `web-modern/src/lib/triage/`
- `web-modern/e2e/triage-inbox.spec.ts`

W3 ask-ai:
- `web-modern/src/components/ai/AskAiPanel.tsx`
- `web-modern/src/routes/app/ask-ai/`
- `web-modern/src/lib/ai/`
- `web-modern/e2e/ask-ai.spec.ts`
- (1-line Topbar trigger — keep this minimal)

W4 period-close-checklist:
- `web-modern/src/routes/app/period-close/`
- `web-modern/src/lib/close/`
- `web-modern/e2e/period-close.spec.ts`

W5 document-steppers:
- `web-modern/src/components/forms/Stepper.tsx` (+ test)
- `web-modern/src/routes/app/invoices/new.tsx` (wires the stepper for invoice creation)
- `web-modern/src/routes/app/purchase-orders/new.tsx` (wires for PO creation)
- `web-modern/e2e/document-steppers.spec.ts`

W6 keyboard-grammar:
- `web-modern/src/lib/keyboard/grammar.ts` (the keymap; ~20 bindings)
- `web-modern/src/components/shell/KeyboardShortcutsDialog.tsx` (the cheat-sheet modal)
- `web-modern/e2e/keyboard-grammar.spec.ts`

W7 onboarding:
- `web-modern/src/components/onboarding/TourOverlay.tsx` (the overlay)
- `web-modern/src/components/onboarding/useTour.ts` (the state machine)
- `web-modern/src/lib/onboarding/tours.ts` (5 default tours: first invoice, first contact, first report, first close, first tax gate)
- `web-modern/e2e/onboarding.spec.ts`
