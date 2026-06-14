/**
 * Vitest setup — runs before every test file.
 *
 * Imported via `test.setupFiles` in `vitest.config.ts`. One concern
 * here: pull in the jest-dom matchers so `toBeInTheDocument`,
 * `toHaveTextContent`, etc. are defined. Without this they are
 * "Invalid Chai property" errors.
 *
 * Global Lingui mocks (added 2026-06-14): when a test file imports a
 * component that uses `useLingui()` or `<Trans>` from `@lingui/macro`
 * or `@lingui/react/macro` (the babel-macro variants), vitest's import
 * analyzer fails because the babel macros are NOT registered in the
 * vitest plugin chain (see `vitest.config.ts` docstring for why).
 *
 * Per-file `vi.mock(...)` is the documented pattern, but as of Phase 10.5/10.6
 * the test count grew past 100 and 15 files are now broken by this. The
 * global mocks below provide a safety net — they mirror the per-file mock
 * shape used in the working files (e.g. `src/components/shell/Topbar.test.tsx`).
 * Test files with their own `vi.mock` still win (vi.mock replaces).
 */
import "@testing-library/jest-dom/vitest";

// Vite's resolve.alias maps every @lingui/* spec to
// src/test-utils/lingui-stub.ts. That stub exports `i18n`,
// `useLingui`, `Trans`, `t`, `defineMessage`, `I18nProvider`.
//
// Don't add global `vi.mock(...)` calls here for the same spec
// strings: vi.mock registers a per-spec factory that REPLACES
// the resolved module's exports, so a factory that doesn't
// include `i18n` will shadow the stub's `i18n` export and
// crash any SUT that does `import { i18n } from "@lingui/core"`.
// The SUTs that need a richer mock (e.g. tours.test.ts) add
// their own per-file vi.mock — those win because they target
// the same spec string.
//
// The 15 file breakages Phase 10.5 introduced were because the
// alias wasn't in place. With the alias + stub + tMessage
// transform in `schemas.ts`, all the Lingui import sites resolve
// cleanly without any global vi.mock.
