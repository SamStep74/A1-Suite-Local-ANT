/**
 * Playwright config — web-modern e2e smoke suite.
 *
 * Architecture under test:
 *   Fastify backend  : http://localhost:4100 (the "A1 Suite" server)
 *   Web-modern dev   : http://localhost:4173 (Vite, proxies /api/* to :4100)
 *
 * Tests run against the dev server (4173) because:
 *   - HMR + the Vite `apiProxy` plugin are the only paths exercised
 *     during interactive QA — that's what real users hit
 *   - The TanStack Start prod build (.output/) is verified by `pnpm build`
 *     + the existing 933 node:test unit tests; a prod-only e2e tier
 *     can be added later by passing `BASE_URL=http://localhost:3000`
 *     and skipping `webServer`.
 *
 * Auth: tests log in via the smoke pattern (POST /api/login) and inject
 * the returned sid as `Authorization: Bearer <sid>` on the browser
 * context. This mirrors how the web-modern app authenticates in
 * production (see web-modern/src/lib/api/auth-token.ts).
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.FASTIFY_PORT ?? 4100);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:4173";

export default defineConfig({
  testDir: "./e2e",
  // Keep discovery scoped to e2e/. Broad "**/src/**" ignores this
  // whole checkout when it lives under ~/dev/armosphera/src/.
  testIgnore: ["**/node_modules/**"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",
  // The Vite dev server is slow to hydrate on the first request
  // (it does a full module crawl before the page is interactive).
  // 60s gives the multi-step wizard specs enough headroom to
  // finish without false failures; per-call `expect` timeouts
  // remain tight below.
  timeout: 60_000,
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

  /** We only manage the Fastify backend — Vite is expected to be
   *  running on 4173 because its HMR overhead makes Playwright's
   *  `webServer` cold-start flaky in this repo. Run `pnpm --prefix
   *  web-modern dev` in a second terminal before `pnpm e2e`, or set
   *  START_FASTIFY=1 to have Playwright boot the backend for you. */
  webServer: process.env.START_FASTIFY
    ? {
        command: "node server/index.js",
        port: PORT,
        reuseExistingServer: true,
        timeout: 30_000,
        stdout: "pipe",
        stderr: "pipe",
      }
    : undefined,
});
