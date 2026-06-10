/**
 * Vitest config — jsdom for component tests, node for schema tests.
 *
 * Vitest's default `vite.config.ts` discovery picks up this file
 * because we name it `vitest.config.ts` (Vitest looks for that name
 * FIRST, before falling back to `vite.config.ts`).
 *
 * The `environmentMatchGlobs` option routes tests in `src/lib/api/` to
 * the `node` environment (no DOM needed for Zod schema tests) and
 * everything else to `jsdom` (where React Testing Library needs the
 * DOM).
 *
 * The `setupFiles` import adds `@testing-library/jest-dom` matchers
 * (toBeInTheDocument, toHaveTextContent, etc.) — without this
 * `toBeInTheDocument` is just "Invalid Chai property".
 */
import { defineConfig } from "vitest/config";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsConfigPaths()],
  test: {
    environmentMatchGlobs: [
      ["src/lib/api/**", "node"],
    ],
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
