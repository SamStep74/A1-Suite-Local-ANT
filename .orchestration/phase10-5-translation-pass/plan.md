# Phase 10.5 translation pass — fill `ru` and `en` Lingui catalogs

## Goal

End-state of the **i18n = B** strategy: `ru` and `en` catalogs are
fully translated; the dev-only "translations in progress" banner is
removed; `hasTranslation()` allowlist flips to all-true; the locale
switcher in production no longer shows a placeholder fallback.

## Why a separate worker (not a r1/r2 worker)

- Translation pass is **non-merging** — it does not change code paths or routes.
- The 6 differentiator workers (W1-W3 already merged, W5-W7 in flight) add ~100 strings to each catalog. Translating in lockstep with each differentiator worker would slow them down. Translating once after r2 closes is faster and avoids race conditions on the catalog files.
- This is a single-worker dispatch (`mergeOrder: ["translation-pass"]`) — runs in its own worktree, merges after r2 closes.

## Pre-conditions

- ant/main is post-r2 (W5+W6+W7 merged) — strings 124 → ~150+
- All 10.5-r1 + 10.5-r2 strings exist in `messages.po` (no diff vs. `pnpm i18n:extract`)
- r2 has shipped: `document-steppers`, `keyboard-grammar`, `onboarding`

## Scope

1. **Fill `ru/messages.po`**: every `msgstr ""` becomes a Russian translation. Respect the Lingui plural forms (`msgstr[0]` / `msgstr[1]`). For strings with `${variable}` interpolation, keep the variable in the right position.
2. **Fill `en/messages.po`**: every `msgstr ""` becomes a clean English translation. The source `msgid` is already in English, so this is mostly copy-paste-with-polish (proper casing, punctuation, idioms).
3. **Flip `hasTranslation` allowlist**: `web-modern/src/i18n/lingui.ts` — change `ru: false, en: false` to `ru: true, en: true`. Remove the surrounding "TODO/once both are flipped" comment.
4. **Remove the dev banner**: `web-modern/src/i18n/I18nProvider.tsx` — delete the `{import.meta.env.DEV && !hasTranslation(locale) ? <div ...>...</div> : null}` block. Also remove the dead `hasTranslation` import and the `Trans` import (if no other use).
5. **Update `I18nProvider.test.tsx`**: 3 tests pinned the "translations in progress" banner behavior. Update them to assert the banner is **not** rendered in any locale, and that the previous i18n loading contract still works.
6. **No code-path changes**: do not rename routes, do not touch the locale switcher, do not modify the dynamic import in `activateLocale`. Just translate + delete banner.

## Hard rules

- pnpm install only
- Lingui v5 — use `pnpm i18n:extract` only if the catalogs drift (idempotency check). The worker should *fill* the catalogs, not re-extract.
- 5 pre-existing failures (4 fleet + 1 AppLauncher): do NOT touch
- `pnpm typecheck` 0 errors
- `pnpm vitest run` 2400+N passed / 5 pre-existing
- `pnpm build` success, 3 per-locale chunks
- Commit message: no literal "verify" substring (block-no-verify hook)
- Status file: `.orchestration/phase10-5-translation-pass/translation-pass/status.md` with `STATUS: PASS`

## Translation guidance

- Use formal Russian (no slang). Currency / tax terms in their standard Russian form (e.g. "НДС", "Счёт-фактура", "Клиент", "Поставщик").
- Use idiomatic US English for `en` (no British spelling; "customer" not "client" — match the source msgid "Customer").
- For long Lingui strings with `${var}`, keep the variable in the same grammatical position. Example:
  - source: `${count} items selected`
  - ru: `Выбрано элементов: ${count}` (or `Выбрано: ${count}` if plural-form is provided)
  - en: `${count} items selected` (or `${count} selected` for compactness)
- For empty msgstrs that already match the source, that's still a valid translation (don't over-edit).
- **Do not translate technical terms** that are product names: "Armosphera", "Lingui", "TanStack", "Zod", "Vite". Keep them as-is.

## Branch / commit / push

- Branch: `wip/phase10-5-translation-pass/translation-pass`
- Commit: `feat(translation-pass): Phase 10.5 fill ru/en catalogs, remove dev banner`
- Tag (worker): `phase10-5-translation-pass-v1`
- Tag (orchestrator): `phase10-5-product-differentiators-v1` (covers r1+r2+translation-pass)

## Merge order

`translation-pass` is the only worker; it merges after r2 closes. The orchestrator pushes via refspec to `ant/main` after this worker closes.

## Pre-existing carry-over (must remain green)

- 4 pre-existing fleet test failures (out of scope since 10.0)
- 1 pre-existing AppLauncher test failure (out of scope)
- `web-modern` uses pnpm (not npm)
- `web-modern/vite.config.ts` must keep `babel-plugin-macros`
- `web-modern/src/i18n/lingui.ts` has the `CATALOG_LOADERS` static map
- Do not touch M3 agents' Phase 8.13 CRM Tube work on `wip/phase8-healthcheck` / `wip/phase8-tube-*`

## Post-translation-pass

After merge:
1. Drop the orchestrator integration tag `phase10-5-product-differentiators-v1`
2. Close STATE.md with the i18n = B → i18n = GA milestone
3. Tear down all 10.5 worktrees
4. Open 10.6 phase (likely production hardening)
