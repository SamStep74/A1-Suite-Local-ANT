# Phase 10.5 r2 — product differentiators round 2 (3 workers, sequenced)

## Goal

Ship the 3 product differentiators that are sequenced after r1 closes.
Each composes the 10.4 shared primitives + the r1 surfaces (fiscal-gates,
triage-inbox, ask-ai in ant/main).

## Workers (sequenced)

W5 = `document-steppers` — Multi-step form wizard for invoices + POs.
  - New components: `web-modern/src/components/wizard/{Stepper,StepperShell}.tsx`
  - New route: `web-modern/src/routes/app/documents/invoice-create/`
  - New lib: `web-modern/src/lib/wizard/{state,schemas}.ts`
  - Lingui macros for every label + tooltip
  - e2e: walk the 4-step invoice-create flow, back/forward, validation
  - Pure form, no 10.4 primitive dep
  - Can start immediately after r1 closes (no other r2 dep)

W6 = `keyboard-grammar` — Cross-feature keymap (cmd-K, esc-to-close, etc).
  - New lib: `web-modern/src/lib/keyboard/{registry,grammar,shortcuts,schemas}.ts`
  - New components: `web-modern/src/components/keyboard/{KeyHandler,ShortcutCheatsheet}.tsx`
  - Mounts KeyHandler in app shell (after W5 has the wizard, can test step nav keys)
  - Lingui for the cheatsheet strings
  - e2e: open cheatsheet, see shortcuts grouped by feature
  - Needs W5 to be merged (so step-nav keys can be tested in the invoice-create flow)

W7 = `onboarding` — First-run tour overlay.
  - New components: `web-modern/src/components/onboarding/{TourOverlay,useTour,OnboardingLauncher}.{tsx,hook}`
  - New lib: `web-modern/src/lib/onboarding/{tours,state,schemas}.ts`
  - 5 default tours (fiscal-gates, triage-inbox, ask-ai, documents, settings)
  - Lingui for every step copy
  - e2e: first-run launches the tour, user can advance/back/skip
  - Needs W1-W3 + W5 + W6 in ant/main (5 tours reference the new surfaces)

## Lingui tie-in

Same as r1: every user-facing string via `<Trans>` or `t\``. The 123 hy msgids
grow to ~150-160 after r2. ru/en catalogs grow in msgid count too (placeholders
stay empty until 10.5-translation-pass worker fills them).

## Pre-existing carry-over (must remain green)

- 4 pre-existing fleet test failures + 1 AppLauncher = 5 pre-existing (all
  pre-existing on ant/main @ 30ef2ca, do NOT touch)
- pnpm (not npm), `pnpm-lock.yaml` canonical
- Lingui macros, dev-only banner, hasTranslation() gate unchanged
- 10.3 locale switcher + 10.5-pre translations-in-progress banner: do NOT
  re-introduce; they were intentionally left in production-stripped

## Worker invariants (same as r1)

- `pnpm typecheck` → 0 errors
- `pnpm vitest run` → 2349+N passed, 5 pre-existing failures (4 fleet + 1 AppLauncher)
- `pnpm build` → success, 3 per-locale chunks
- `pnpm i18n:extract` → idempotent
- Lingui macro count ≥ 10 (varies by differentiator)
- prod-strip grep = 0 matches
- Commit: no literal "verify" substring
- Status: `.orchestration/phase10-5-product-differentiators-r2/<worker>/status.md` with `STATUS: PASS`

## Branch / commit / push

- Branch: `wip/phase10-5-product-differentiators-r2/<worker>` (slash preserved)
- Commit: `feat(<worker>): Phase 10.5 r2 <worker> surface`
- Tag (worker): `phase10-5-product-differentiators-r2-<worker>-v1`

## Merge order (orchestrator-side)

```
document-steppers → keyboard-grammar → onboarding
```

Sequenced because W6 needs W5 in ant/main to test step-nav, and W7 needs
W5+W6 to tour the surfaces.

The orchestrator can dispatch all 3 worktrees in --execute and the workers
self-sequence (each worker polls ant/main for its pre-req merge before
writing code). This is the pattern used in 10.2 and 10.3 cross-worker
sequencing.

## Base ref

`ant/main @ d20ef02` (post-10.5-r1, W1+W2+W3 merged).
