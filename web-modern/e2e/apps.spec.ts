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

    test(`${appId} → ${path} loads`, async ({ browser, request }) => {
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

        // Wait for the per-app panel testid (e.g. "greenhouse-panel",
        // "assets-panel"). Every Pattern A route exposes one; if this
        // never appears, the route tree is broken or auth failed.
        const panel = page.getByTestId(`${appId}-panel`);
        await expect(panel).toBeVisible({ timeout: 15_000 });

        // The H1 inside the panel — routes render either the
        // Armenian label (e.g. assets: "Հիմնական միջոցներ") or
        // the English label (e.g. greenhouse: "Greenhouse"). Accept
        // either, in either order — the panel is the load signal,
        // the H1 is just a smoke check.
        const h1Am = panel.getByRole("heading", { level: 1, name: meta.labelAm });
        const h1En = panel.getByRole("heading", { level: 1, name: meta.label });
        const h1Visible = await Promise.race([
          h1Am.waitFor({ state: "visible", timeout: 2_000 }).then(() => true).catch(() => false),
          h1En.waitFor({ state: "visible", timeout: 2_000 }).then(() => true).catch(() => false),
        ]);
        expect(
          h1Visible,
          `expected H1 with "${meta.label}" or "${meta.labelAm}" inside ${appId}-panel`,
        ).toBe(true);
      } finally {
        await page.context().close();
      }
    });
  }
});
