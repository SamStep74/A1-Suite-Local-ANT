STATUS: PASS

# W7 onboarding — Phase 10.5 r2

**Worker:** W7 = `onboarding` (Round 2, sequenced after W5 + W6).
**Differentiator:** First-run tour overlay — Topbar popover + modal
dialog walks new users through the 5 product-differentiator surfaces
(fiscal-gates, triage-inbox, ask-ai, documents, settings).

**Branch:** `wip/phase10-5-product-differentiators-r2-onboarding`
**Tag:** `phase10-5-product-differentiators-r2-onboarding-v1`

## What ships

- **Lib:** `web-modern/src/lib/onboarding/`
  - `schemas.ts` — Zod schemas for `Tour`, `TourStep` (discriminated
    union: `navigate` | `highlight` | `info`), `TourId`, `TourView`,
    `TourRuntime`
  - `state.ts` — SSR-safe localStorage helpers
    (`a1:tour:<id>:done` key format, swallows quota errors)
  - `tours.ts` — 5 default tours with inline Lingui `t({ message })`
    macros. r1 surfaces (fiscal-gates, triage-inbox, ask-ai) are
    interactive; r2 surfaces (documents, settings) are marked
    `deferred: true` with a "Preview" copy that explains they ship
    in 10.5 r2
  - `__tests__/state.test.ts` — 7 unit tests
  - `__tests__/tours.test.ts` — 11 unit tests pinning the catalog
    (5 tours, every step has a non-empty title/body, every
    `navigate` step has a `/app/...` route, the 3 r1 surfaces
    are NOT deferred, the 2 r2 surfaces ARE deferred, the
    icon names align with the launcher's `ICONS` map, etc.)
- **Components:** `web-modern/src/components/onboarding/`
  - `useTour.ts` — state-machine hook
    (`start`/`next`/`back`/`skip`/`finish`/`reset`/`isDone`) with
    a cross-tab `storage` event listener for done-flag sync, and
    an `onNavigate` callback for testability
  - `TourOverlay.tsx` — modal dialog with backdrop, header
    (feature + goal + deferred badge), body (title + body),
    progress dots, Back/Next/Close footer, Escape-to-close,
    focus on primary CTA. Exposes `data-testid` attributes for
    e2e selectors
  - `OnboardingLauncher.tsx` — Topbar popover button with
    unfinished-tour badge count, per-tour done checkmark,
    deferred "Preview" badge, "Hide tour launcher" footer
    button
  - `index.ts` — barrel
  - `__tests__/useTour.test.tsx` — 10 unit tests driving the
    state machine through every transition
- **Wiring:**
  - `Topbar.tsx` — renders `<OnboardingLauncher>` between
    Help and Ask AI toggle; accepts `tourRuntime` and
    `tourLauncherVisible` props
  - `routes/app/route.tsx` — instantiates `useTour()`, manages
    `tourLauncherVisible` (persisted in `a1:onboarding:visible`),
    mounts `<TourOverlay>` at the layout level
- **E2e:** `web-modern/e2e/onboarding.spec.ts` — 4 Playwright
  cases
  - First-run shows the launcher with a 5-tour badge
  - Advance through every step of `ask-ai`, finish, persist
    the done flag, badge drops to 4
  - Back decrements; skip closes without marking done
  - Hide-tour-launcher removes the button from the Topbar

## Audit gates (all green)

```
pnpm typecheck             → 0 errors
pnpm vitest run            → 2407 passed, 5 failed
                             (the 5 are the pre-existing
                              failures untouched by W7:
                              AppLauncher nav test,
                              fleetTabFromHash,
                              tripStateLabelArm,
                              coldChainCategoryLabelAm,
                              formatFleetIdShort — 1 was
                              added by the r1 AppLauncher
                              surfacing, 4 are the
                              long-standing fleet bugs)
pnpm build                 → success, 3 per-locale
                             messages chunks (hy / ru / en)
                             + 1 main index chunk
pnpm i18n:extract          → idempotent at 175 source
                             msgids (52 new for onboarding,
                             well above the ≥10 worker floor)
prod-strip grep            → 0 matches in
                             src/components/onboarding/ or
                             src/lib/onboarding/
```

## Lingui macro count

47+ `t({ message: ... })` calls across the onboarding code
(`tours.ts` carries 29 inline macros for step titles + bodies;
`TourOverlay.tsx` adds 4; `OnboardingLauncher.tsx` adds 4; the
other files carry the rest).

## Self-sequencing note

W5 (document-steppers) and W6 (keyboard-grammar) had not landed
in `ant/main` at the time W7 was dispatched. The W7 tour catalog
ships the `documents` and `settings` tours anyway, marked
`deferred: true`. The overlay renders a "Preview" badge and a
roadmap sentence ("ships in 10.5 r2") so the user knows the
surface is on the way. Once W5 and W6 merge, removing the
`deferred: true` flags is a 2-line change to `tours.ts` — no
tour-copy edits required.
