# Phase 10.6 — e2e coverage + hasTranslation cleanup (7 workers, parallel)

## Goal

Two themes in one phase, both pre-staged in the STATE.md 10.5 close:

1. **(a) e2e happy-path flows** — turn the 7 product-differentiator
   surfaces from "feature exists + smoke test" into "feature flows
   end-to-end with undo / save / locale / persistence". The 10.4
   primitives (DataTable, SavedViews, PeekPanel, UndoToast,
   BulkActionBar) are already exercised in unit tests; the e2e tier
   proves the user journey works.

2. **(b) hasTranslation() refactor** — the `TRANSLATED_LOCALES`
   allowlist was a temporary gate during 10.5. With all 3 locales
   (`hy`, `ru`, `en`) GA, the gate can be deleted along with the
   surrounding TODO comment, the `hasTranslation` export, and the
   "translations in progress" banner code that the test suite
   pinned. This is the cleanup that 10.5 STATE.md said "10.6+
   refactor".

**Theme (c) real LLM backend for ask-ai is DEFERRED** to a later
phase pending vendor decision (Anthropic? OpenAI? local Ollama?).
The ask-ai stub stays as-is for 10.6 — the e2e tests cover the
stub response shape, not real LLM output.

## Strategy

- Theme (a) → 6 worker worktrees, one per e2e spec expansion. All
  run in parallel. Each adds ~50-150 lines of test coverage to its
  existing `web-modern/e2e/<surface>.spec.ts` file (or creates a new
  file for locale-switching).
- Theme (b) → 1 worker worktree. Touches only the i18n surface
  (`lingui.ts`, `I18nProvider.tsx`, `I18nProvider.test.tsx`).

All 7 workers branch off `ant/main @ 6041c2c` (post-10.5 STATE.md
close). The orchestrator (me) merges them in declaration order,
fast-forwards to `ant/main`, and tags the result
`phase10-6-e2e-coverage-v1`.

## Worker dispatch

### Round 1 (parallel, 7 worktrees)

W1 = `e2e-fiscal-gates` ← expand: undo flow + saved view switch + bulk action
W2 = `e2e-triage-inbox` ← expand: peek panel + saved view + bulk resolve
W3 = `e2e-ask-ai` ← expand: stub question/answer + citation verification
W4 = `e2e-documents` ← expand: 4-step wizard full path (counterparty → line items → tax → review)
W5 = `e2e-onboarding` ← expand: tour walk + localStorage persistence across reload
W6 = `e2e-locale-switching` ← NEW spec: locale switch in Topbar, verify hy/ru/en render
W7 = `remove-hasTranslation` ← refactor: delete TRANSLATED_LOCALES, hasTranslation export, banner block

All 7 branch off `ant/main @ 6041c2c` (the current `ant/main` tip).
File-isolated per worker (each owns one spec file or one refactor
slice). No cross-worker conflicts.

## Lingui tie-in (carry from 10.5)

- `web-modern/src/locales/{hy,ru,en}/messages.po` — all 225 msgids filled, idempotent extract
- `web-modern/src/locales/{hy,ru,en}/messages.js` — 3 per-locale chunks
- `web-modern/src/i18n/lingui.ts` — `TRANSLATED_LOCALES = { hy: true, ru: true, en: true }` (post-translation-pass; W7 will delete)
- `web-modern/src/i18n/I18nProvider.tsx` — no banner (post-translation-pass; W7 will verify)

## Pre-existing carry-over (must remain green)

- 5 pre-existing test failures (1 AppLauncher + 4 fleet) — out of scope since 10.0
- `web-modern` uses pnpm (not npm) — `pnpm-lock.yaml` is the canonical lockfile
- `web-modern/vite.config.ts` must keep `babel-plugin-macros` for Lingui macros
- `web-modern/playwright.config.ts` — dev server on :4173, Fastify on :4100, e2e specs in `web-modern/e2e/`
- e2e auth pattern: `POST /api/login` returns sid, inject as `Authorization: Bearer <sid>`
- Pre-existing 4 fleet + 1 AppLauncher failures: do NOT touch

## Worker invariants (per 10.4 playbook, same for all 7)

- `pnpm typecheck` → 0 errors
- `pnpm vitest run` → 2458+N passed, 5 pre-existing failed (1 AppLauncher + 4 fleet)
- `pnpm build` → success, 3 per-locale chunks (`hy` / `ru` / `en`)
- `pnpm i18n:extract` → idempotent
- `pnpm playwright test e2e/<spec>.spec.ts` → all green (for W1-W6)
- `grep -rE 'i18n-translations-in-progress' web-modern/src/` → 0 (W7 enforces)
- `grep -rE 'hasTranslation|TRANSLATED_LOCALES' web-modern/src/` → 0 (W7 enforces)
- Pre-existing 5 failures: do NOT touch
- Commit message: no literal "verify" substring (block-no-verify hook)
- Status file: `.orchestration/phase10-6-e2e-coverage/<worker>/status.md` with `STATUS: PASS` at the top

## Branch / commit / push

- Branch: `wip/phase10-6-e2e-coverage-<worker>` (dashes preserved, not slashes — flat names per 10.5 lesson about branch flattening)
- Commit: `test(<worker>): Phase 10.6 <worker> coverage` (W1-W6) or `refactor(i18n): Phase 10.6 remove hasTranslation gate` (W7)
- Tag (worker): `phase10-6-e2e-coverage-<worker>-v1` (pushed by worker)
- Tag (orchestrator): `phase10-6-e2e-coverage-v1` (pushed at end of phase, after the last worker merges)

## Merge order (orchestrator-side)

```
e2e-fiscal-gates → e2e-triage-inbox → e2e-ask-ai → e2e-documents
                  → e2e-onboarding → e2e-locale-switching → remove-hasTranslation
```

Each merge: fast-forward from worker branch, push to `ant/main` via
the refspec, drop the orchestrator integration tag at the end.

W7 (remove-hasTranslation) merges LAST because it depends on W1-W6
having shipped e2e tests that pin the current behavior — so when
W7's refactor lands, the test failures prove whether the refactor
broke anything.

## Hazards (anticipated)

- **e2e dev server flakiness** — Fastify :4100 + Vite :4173 race on startup. Mitigation: `webServer.reuseExistingServer: true` in playwright.config.ts is already set; if a spec flakes, retry once.
- **Lingui `messages.js` is gitignored in some configs** — verify `.gitignore` doesn't exclude the compiled catalog. The 10.5 translation-pass already committed them, so this is checked.
- **Pre-existing test failures cross-contaminate** — vitest `--reporter verbose` shows file:line for each failure; filter out the 5 known. If new failures appear in i18n/, that's a W7 regression and gets reverted.
- **W7 banner-removal regression** — W7's edit could remove too much (e.g. the `LinguiProvider` wrapper). The existing 11 i18n unit tests are the safety net; they assert the provider still renders.
- **Branch flattening** — `git worktree add -b wip/foo/bar` creates `wip/foo-bar` (the second slash gets flattened). Use dashes for the worker name in the branch.

## Next concrete step (post-10.6)

- 10.7 (TBD) — likely "real LLM backend for ask-ai" (option c) or "performance + observability" depending on user pick
- 8.13 CRM Tube (M3 agents) — still in flight, out of scope for orchestrator
- 8.12 delete legacy `web/` — unblocked since 10.2, awaiting dedicated worker

## File ownership (per worker)

W1 e2e-fiscal-gates:
- `web-modern/e2e/fiscal-gates.spec.ts` (expand)
- (no new source files)

W2 e2e-triage-inbox:
- `web-modern/e2e/triage-inbox.spec.ts` (expand)
- (no new source files)

W3 e2e-ask-ai:
- `web-modern/e2e/ask-ai.spec.ts` (expand)
- (no new source files)

W4 e2e-documents:
- `web-modern/e2e/document-steppers.spec.ts` (expand)
- (no new source files)

W5 e2e-onboarding:
- `web-modern/e2e/onboarding.spec.ts` (expand)
- (no new source files)

W6 e2e-locale-switching (NEW):
- `web-modern/e2e/locale-switching.spec.ts` (new file)
- (no new source files)

W7 remove-hasTranslation:
- `web-modern/src/i18n/lingui.ts` (delete `TRANSLATED_LOCALES`, `hasTranslation` export, surrounding TODO)
- `web-modern/src/i18n/I18nProvider.tsx` (verify banner block fully gone, no unused imports)
- `web-modern/src/i18n/I18nProvider.test.tsx` (delete the 3 `hasTranslation` test cases — they're now testing a deleted export)
