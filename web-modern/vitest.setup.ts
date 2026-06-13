/**
 * Vitest setup — runs before every test file.
 *
 * Imported via `test.setupFiles` in `vitest.config.ts`. One concern
 * here: pull in the jest-dom matchers so `toBeInTheDocument`,
 * `toHaveTextContent`, etc. are defined. Without this they are
 * "Invalid Chai property" errors.
 *
 * Lingui i18n activation is intentionally NOT done at the global
 * level. We rely on per-file `vi.mock("@lingui/macro", ...)` calls
 * (or `vi.mock("@lingui/react/macro", ...)`) in the test files
 * that need Lingui macro behavior, which keeps the 100+
 * pre-existing tests that use `useLingui()` passing without
 * needing an `I18nProvider` wrapper in their render trees.
 */
import "@testing-library/jest-dom/vitest";
