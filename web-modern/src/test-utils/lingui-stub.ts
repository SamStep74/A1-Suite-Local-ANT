/**
 * Stub for the Lingui packages under vitest.
 *
 * Why this exists: Lingui ships its runtime as a babel macro
 * (`@lingui/macro`, `@lingui/react/macro`) plus a non-macro runtime
 * (`@lingui/core`). The babel macros are NOT registered in the
 * vitest plugin chain (see `vitest.config.ts` docstring for why —
 * adding the babel macros would force every component test to
 * mount an `<I18nProvider>`).
 *
 * For tests that need to import a component which uses `useLingui()`
 * or `<Trans>` from the babel macro, vitest's `vi.mock` in the test
 * file's setup block does NOT help: the mock is registered AFTER the
 * SUT is transformed, so the import resolution still fails.
 *
 * The fix: a real file in the repo that the import resolves to. We
 * alias `@lingui/core`, `@lingui/macro`, and `@lingui/react/macro`
 * to this stub in `vitest.config.ts` via `resolve.alias`, and we
 * point the same specifiers at this file in `tsconfig.json#paths`
 * so tsc resolves them too. The stub is intentionally permissive —
 * anything that needs Lingui at runtime in a test gets a no-op.
 *
 * Note: Lingui's `t` macro accepts BOTH call-style
 * (`t({ message: "..." })`) AND tagged-template-literal style
 * (`` t`Hello ${name}` ``). This stub supports both — the overload
 * below lets `t` be called with no args, with a `{ message }`
 * object, with a string, or as a tagged template. For template
 * literals we just return the raw strings array (lossy but enough
 * for the test to import the SUT without a typecheck error).
 */
import React from "react";

export const i18n = {
  _: (s: string) => s,
  // Lingui's real `activate` is typed `(locale, catalog?) => void`.
  // We accept any args so call sites that pass a messages object
  // (as `i18n.activate("en", { Hello: "Hello" })`) still typecheck.
  activate: (..._args: unknown[]) => {},
  loadAndActivate: (..._args: unknown[]) => {},
  load: async (..._args: unknown[]) => {},
};

export function useLingui() {
  return {
    t: tImpl,
    i18n: { _: (s: string) => s },
  };
}

function tImpl(...args: unknown[]): string {
  const arg = args[0];
  if (arg === undefined) return "";
  if (typeof arg === "string") return arg;
  if (Array.isArray(arg)) {
    // Tagged-template call: t`Hello ${name}` → ["Hello ", ""]
    return arg.join("");
  }
  if (typeof arg === "object" && arg !== null && "message" in arg) {
    return (arg as { message: string }).message;
  }
  return String(arg);
}

// `t` supports all four call shapes: () , (msg) , (string) , template.
export const t = tImpl as unknown as {
  (): string;
  (msg: { message: string }): string;
  (msg: string): string;
  (strings: TemplateStringsArray, ...values: unknown[]): string;
};

export const Trans = ({ children }: { children?: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children);

export const defineMessage = (msg: { message: string }) => msg;

// Real Lingui exports `I18nProvider` from `@lingui/react`. The test
// for I18nProvider itself mounts a real one; the rest of the suite
// renders components that *consume* it, and the I18nProvider.test
// does the integration. We export a passthrough so any consumer
// that accidentally destructures `I18nProvider` from `@lingui/react`
// at module load (e.g. for a `ThemeProvider` wrapper) still resolves.
export const I18nProvider = ({
  children,
}: {
  children?: React.ReactNode;
  i18n?: unknown;
}) => React.createElement(React.Fragment, null, children);
