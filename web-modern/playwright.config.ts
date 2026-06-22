/**
 * Playwright config — web-modern e2e smoke suite.
 *
 * Architecture under test:
 *   Fastify backend : http://localhost:4100 (the "A1 Suite" server)
 *   Web-modern dev  : http://localhost:4173 (Vite, proxies /api/* to :4100)
 *   Web-modern SPA  : http://localhost:3000 (static dist/, scripts/serve-spa.mjs)
 *
 * Two run modes:
 *   DEV (default) : tests run against http://localhost:4173, which the
 *                   developer started with `pnpm dev`. `webServer` only
 *                   manages the Fastify backend if `START_FASTIFY=1` is
 *                   set. (Same as before the D1 flip.)
 *
 *   SPA (opt-in)  : set `RUN_AGAINST_SPA=1` to have Playwright build the
 *                   SPA (vite build → web-modern/dist/) and serve it via
 *                   scripts/serve-spa.mjs on port 3000. This is what CI
 *                   runs — it verifies the prod artifact, not the dev
 *                   HMR path.
 *
 * Auth: tests log in via the smoke pattern (POST /api/login) and inject
 * the returned sid as `Authorization: Bearer <sid>` on the browser
 * context. This mirrors how the web-modern app authenticates in
 * production (see web-modern/src/lib/api/auth-token.ts).
 */
import { defineConfig, devices } from "@playwright/test";

const FASTIFY_PORT = Number(process.env.FASTIFY_PORT ?? 4100);
const SPA_PORT = Number(process.env.SPA_PORT ?? 3000);
const RUN_AGAINST_SPA = process.env.RUN_AGAINST_SPA === "1";
const BASE_URL = process.env.BASE_URL ?? (RUN_AGAINST_SPA ? `http://localhost:${SPA_PORT}` : "http://localhost:4173");

export default defineConfig({
  testDir: "./e2e",
  /** Mirror vitest's directory-exclude convention: ignore unit tests. */
  testIgnore: ["**/node_modules/**", "**/src/**", "**/coverage/**", "**/dist/**"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /**
   * webServer — two opt-in knobs:
   *
   *   START_FASTIFY=1      : boot the Fastify backend for you (DEV mode).
   *   RUN_AGAINST_SPA=1    : build the SPA and boot scripts/serve-spa.mjs.
   *                          The `pretest:e2e`-style build is achieved by
   *                          chaining `vite build` and the static server
   *                          via a single shell command.
   *
   * Default (no env) : Playwright doesn't manage any server. The dev
   *                    workflow expects the developer to start Vite on
   *                    4173 and Fastify on 4100 in separate terminals.
   */
  webServer: RUN_AGAINST_SPA
    ? {
        // Build the SPA then boot the static server in one shell. The
        // `&&` makes Playwright wait for the build to finish before
        // listening for the SPA_PORT. `reuseExistingServer: true`
        // means if a developer is already running the SPA on 3000
        // (e.g. `pnpm start` in a second terminal), Playwright
        // reuses it instead of trying to bind.
        command: `pnpm run build && node ./scripts/serve-spa.mjs`,
        port: SPA_PORT,
        reuseExistingServer: true,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      }
    : process.env.START_FASTIFY
      ? {
          command: "node server/index.js",
          port: FASTIFY_PORT,
          reuseExistingServer: true,
          timeout: 30_000,
          stdout: "pipe",
          stderr: "pipe",
        }
      : undefined,
});
