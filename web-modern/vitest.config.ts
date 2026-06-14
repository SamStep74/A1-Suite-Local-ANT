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
 *
 * Lingui macros
 * ─────────────
 * We intentionally do NOT include `babel-plugin-macros` in the
 * test plugin chain (unlike `vite.config.ts` which does for
 * `pnpm dev` and `pnpm build`). With the macro plugin enabled in
 * tests, every component that calls `useLingui()` resolves to
 * the real Lingui hook — which throws
 *   "useLingui hook was used without I18nProvider"
 * unless the test tree mounts an `<I18nProvider>`. Retrofitting
 * the 100+ existing tests with that wrapper is out of scope for a
 * single feature (W7 onboarding), so tests that import Lingui
 * macros at module load (e.g. `lib/onboarding/tours.ts`) mock
 * `@lingui/macro` / `@lingui/react/macro` per-file with a tiny
 * `vi.mock` that returns the source message text. Production
 * `pnpm dev` and `pnpm build` are unaffected — those still go
 * through the babel plugin pipeline.
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    react(),
  ],
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
