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
import { vi } from "vitest";

vi.mock("@lingui/core", () => ({
  i18n: { _: (s: string) => s, activate: () => {}, load: async () => {} },
}));

vi.mock("@lingui/core/macro", () => ({
  t: (s: { message: string } | string) =>
    typeof s === "string" ? s : s.message,
  defineMessage: (s: { message: string }) => s,
  // Defensive: if vitest's mock resolver routes `@lingui/core`'s
  // `import { i18n }` to this mock (it can, when both `@lingui/core` and
  // `@lingui/core/macro` mocks are hoisted in the same setup), having
  // `i18n` here too keeps the SUT (e.g. `lingui.ts:35`) from throwing
  // "No 'i18n' export is defined on the mock". See also `@lingui/macro`
  // and `@lingui/react/macro` below for the same defensive export.
  i18n: { _: (s: string) => s, activate: () => {}, load: async () => {} },
}));

vi.mock("@lingui/macro", () => ({
  useLingui: () => ({
    t: (s: { message: string } | string) =>
      typeof s === "string" ? s : s.message,
    i18n: { _: (s: string) => s, activate: () => {}, load: async () => {} },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  t: (s: { message: string } | string) =>
    typeof s === "string" ? s : s.message,
  // Defensive: see `@lingui/core/macro` comment above.
  i18n: { _: (s: string) => s, activate: () => {}, load: async () => {} },
}));

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (s: { message: string } | string) =>
      typeof s === "string" ? s : s.message,
    i18n: { _: (s: string) => s, activate: () => {}, load: async () => {} },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  t: (s: { message: string } | string) =>
    typeof s === "string" ? s : s.message,
  // Defensive: see `@lingui/core/macro` comment above. The error we
  // hit on 2026-06-14 was `No "i18n" export is defined on the
  // "@lingui/react/macro" mock` from `lingui.ts:35` — vitest's mock
  // resolver had applied THIS mock to a `@lingui/core` import. With
  // `i18n` exported at the top level here, that import works
  // regardless of which mock wins the resolver race.
  i18n: { _: (s: string) => s, activate: () => {}, load: async () => {} },
}));
