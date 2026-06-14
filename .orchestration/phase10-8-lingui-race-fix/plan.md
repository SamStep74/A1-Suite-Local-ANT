# Phase 10.8 (a) — fix Lingui activation race in `tours.ts` (1 worker, single-file)

> **Theme (a)** of the 10.7 close-out: unblock the full `pnpm playwright test` suite by fixing the pre-existing Lingui activation race. Theme (c) (real LLM backend) is unrelated and remains deferred. Theme (b) (10.2a pilot) is still gated on M3. Theme (d) (8.12 delete legacy `web/`) is unblocked but not actionable in this session.

## Background

The Phase 10.7 W1 e2e-fiscal-gates worker hit a pre-existing source bug that blocks the React tree from mounting on every route, which means **every Playwright spec in the suite fails 100%**, including the 6 expanded/added specs from 10.7 and the long-standing `apps.spec.ts` / `i18n-canary.spec.ts`.

The root cause: `web-modern/src/lib/onboarding/tours.ts` declares a `RAW_TOURS: ReadonlyArray<Tour>` at module scope. Every step's `title` and `body` is wrapped in `t({ message: "..." })` (the Lingui macro). The macro compiles to `i18n._({ id: hash, message: "..." })` and **fires at module-evaluation time** — *before* `I18nProvider`'s `useEffect` calls `activateLocale(...)` (a dynamic-import async that loads the per-locale catalog chunk).

Error observed in every Playwright run:

```
PAGEERROR: Lingui: Attempted to call a translation function without setting a locale.
  at I18n._ (@lingui/core:1520)
  at lib/onboarding/tours.ts:5
```

Effect: `#root` stays empty on every route; no `data-testid` ever paints. Confirmed: `apps.spec.ts` and the 6 expanded specs from 10.7 all fail the same way. The onboarding surface is in the hard-rules list ("Do NOT touch the 10.5 / 10.6 surfaces' source") so e2e workers cannot fix it.

## Fix design

The cleanest single-file fix is to **arm the `i18n` instance with a safe `message`-fallback at module load**, *before* any other module that uses `t` is imported. With the i18n instance already activated, `i18n._({ id, message })` returns the source `message` text instead of throwing. The async `activateLocale()` in `I18nProvider`'s `useEffect` then loads the real catalog and swaps in the proper translations on the next render.

Concretely, in `web-modern/src/i18n/lingui.ts`, add a single top-level call right after the `i18n` import:

```ts
// Arm the i18n instance synchronously at module load so that any
// `t({ message: "..." })` macro evaluated at module-eval time (notably
// in `lib/onboarding/tours.ts` which builds a static const out of them)
// gets a safe `message`-fallback instead of throwing "Attempted to call
// a translation function without setting a locale". The async
// `activateLocale()` in I18nProvider's useEffect replaces the empty
// messages dict with the real per-locale catalog on the next tick.
i18n.activate(DEFAULT_LOCALE, {});
```

That's it. ~5 lines + a comment. The async activation path in `activateLocale` is unchanged. No consumer (`I18nProvider`, `useTour`, `TourOverlay`, `tours.test.ts`) needs to change.

### Why not the alternative (lazy `tours.ts` evaluation)?

The two options identified in the W1 handoff were:
1. Move the `t({ message: "..." })` calls in `tours.ts` from module scope into a getter or function body (lazy evaluation)
2. Activate the Lingui locale in `main.tsx` (or `lingui.ts`) BEFORE the router / tours module is evaluated

Option 1 is more invasive: it changes the `Tour` schema, all 4 consumers (`TourOverlay`, `useTour`, `tours.test.ts`, `useTour.test.tsx`) need to call the getter, and the static `DEFAULT_TOURS_BY_ID` map contract breaks. Option 2 is what this plan implements — but doing it in `lingui.ts` (the leaf module imported by everything) rather than `main.tsx` (the entry, but `tours.ts` may be imported transitively before `main.tsx` finishes its top-level `i18n.activate(...)` call if the import graph is shallow). `lingui.ts` is the safest anchor.

The babel-plugin-macros `t` macro is unaffected: it transforms `t({ message: "Fiscal gates" })` into `i18n._({ id: hash, message: "Fiscal gates" })` and the literal string is still in the AST, so `pnpm i18n:extract` continues to find all 242 source msgids. No re-extract required.

## Worker

| # | Worker name | File ownership | Verify |
|---|-------------|----------------|--------|
| W1 | `fix-lingui-race` | `web-modern/src/i18n/lingui.ts` (single file, ~5 lines added) | typecheck + vitest (i18n + tours suites) + build + i18n:extract idempotent + the 6 expanded 10.7 e2e specs pass under Playwright + existing `apps.spec.ts` + `i18n-canary.spec.ts` pass |

## Audit gates (all must pass before merge)

1. `pnpm typecheck` → 0 errors
2. `pnpm vitest run src/i18n src/lib/onboarding src/components/onboarding` → all green (i18n + tours + onboarding component suites)
3. `pnpm vitest run` (full) → 2469+ passed, 1 pre-existing AppLauncher failure (out of scope since 10.0)
4. `pnpm i18n:extract` → idempotent (no .po content changed, all 242 source msgids still present)
5. `pnpm build` → success, 3 per-locale chunks
6. `pnpm playwright test e2e/fiscal-gates.spec.ts e2e/triage-inbox.spec.ts e2e/ask-ai.spec.ts e2e/document-steppers.spec.ts e2e/onboarding.spec.ts e2e/locale-switching.spec.ts e2e/apps.spec.ts e2e/i18n-canary.spec.ts` → **all 8 specs pass** (this is the gate that was BLOCKED in 10.7 W1)
7. `grep -rE 'hasTranslation|TRANSLATED_LOCALES|i18n-translations-in-progress' web-modern/src` → 0 hits (carry forward from 10.7 W7)

## Risks

- **i18n reentrancy**: calling `i18n.activate(DEFAULT_LOCALE, {})` at module load then `i18n.activate(actualLocale, realMessages)` from the async path is the documented Lingui pattern for "warm" → "real" activation. No reentrancy issue.
- **First-frame flicker**: a single render of Armenian (source) text may flash on hard reload before the real catalog lands. This is identical to the current `I18nProvider` behavior (it returns `null` until `ready=true`, so the flash is hidden by the empty render). With this fix, the i18n instance returns the source `message` for any `t` call evaluated before activation completes — the same source text the user would have seen if the catalog never loaded. No regression.
- **Lingui version**: confirm `i18n.activate(locale, messages)` accepts an empty `{}` for messages. The existing `activateLocale` at line 93 already calls `i18n.activate(l, messages as unknown as string[])` with a populated dict, so the signature is supported. The empty-dict case is documented in the Lingui v5 API as "no translations available — fall back to source `message`".

## Out of scope

- Removing the `i18n.activate(DEFAULT_LOCALE, {})` call later if/when `tours.ts` is refactored to use lazy evaluation. That refactor is its own work item; this plan doesn't preempt it.
- 10.2a pilot pipeline (gated on M3)
- Real LLM backend for ask-ai (theme c, deferred)
- 8.12 delete legacy `web/` (theme d, unblocked)
- e2e in CI (theme e, depends on this fix landing — could be a 10.9 follow-up)
