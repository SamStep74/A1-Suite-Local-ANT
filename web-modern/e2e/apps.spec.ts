/**
 * apps.spec.ts — Web-modern e2e smoke suite.
 *
 * One assertion per app: navigate to /app/<id>/ (or /app/<id> for the
 * fallback route used by apps without their own index), confirm the
 * page paints the app's expected H1.
 *
 * Why this matters:
 *   - 1203 vitest assertions verify component logic in jsdom
 *   - 933 node:test assertions verify the Fastify API contract
 *   - But nothing was verifying the glue: that the route actually
 *     resolves, the auth header gets through, the React tree mounts,
 *     the TanStack Query calls actually return 2xx, and the
 *     `meta.label` H1 is visible
 *
 * This spec is intentionally cheap (one DOM assertion per app) so
 * it runs in seconds and gates every PR.
 */
import { test, expect } from "@playwright/test";
import { APP_IDS, APPS, type AppId } from "../src/lib/apps";
import { authedPage, waitForHydration } from "./_helpers";

/** Most apps have a nested `index.tsx` that REPLACES the parent
 *  stub at `/app/$appId`. The ones that DON'T (e.g. `desk` which
 *  was Phase 1'd before the nested-route convention) use the
 *  fallback route directly. */
const APPS_USING_FALLBACK: ReadonlySet<AppId> = new Set<AppId>(["desk"]);

test.describe("apps smoke — every registered app loads and shows its H1", () => {
  for (const appId of APP_IDS) {
    const meta = APPS[appId];
    const path = APPS_USING_FALLBACK.has(appId) ? `/app/${appId}` : `/app/${appId}/`;

    test(`${appId} → ${path} renders "${meta.label}"`, async ({ browser, request }) => {
      const { page } = await authedPage(browser, request);
      try {
        const response = await page.goto(path);
        // Some TanStack routes issue a redirect to canonicalize trailing
        // slashes; both 200 and 200-after-redirect are "loaded". A 401/403
        // would mean the Bearer header didn't propagate; a 404 would mean
        // the route tree is broken. Anything else is a real failure.
        expect(
          response,
          `expected ${path} to respond (got ${response?.status()})`,
        ).not.toBeNull();
        const status = response!.status();
        expect([200, 304]).toContain(status);

        await waitForHydration(page);
        await expect(page.getByRole("heading", { level: 1, name: meta.label })).toBeVisible();
      } finally {
        await page.context().close();
      }
    });
  }
});
