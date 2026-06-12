/**
 * spa-mode.spec.ts — Phase 10.0 D1 SPA-mode smoke.
 *
 * Locks in the invariants of the static-SPA flip (D1). Every check
 * here is a regression guard:
 *
 *   1. GET /                returns 200 + the SPA shell HTML.
 *   2. data-spa-hydrated    shows up within 5 s of first paint,
 *                           proving the React tree committed.
 *   3. /app/cfo             renders the CFO toolbar (proves at
 *                           least one TanStack Router route
 *                           resolves client-side in SPA mode).
 *   4. window.armospheraApp is undefined on the SPA (proves the
 *                           legacy web/ bundle is no longer loaded
 *                           alongside the new app).
 *
 * Why these matter:
 *   - (1)+(2) are the "is it a real SPA" check. If either fails,
 *     we accidentally re-introduced SSR or broke the build.
 *   - (3) is the "is the route tree intact" check. The cfo
 *     toolbar testid is intentionally a top-level div, not a
 *     leaf, so this catches both render failures and pure-JSX
 *     regressions.
 *   - (4) is the "is it ONLY the new app" check. The legacy
 *     web/src/main.jsx exposes `window.armospheraApp`; if the SPA
 *     is serving the legacy bundle by mistake, the assertion
 *     fails.
 *
 * Auth: tests 1, 2, and 4 don't need a session (the shell + the
 * hydration flag appear before any data is fetched). Test 3
 * logs in so the cfo toolbar can fetch its (auth-required) data.
 */
import { test, expect } from "@playwright/test";
import { authedPage } from "./_helpers";

test.describe("SPA mode — D1 invariants", () => {
  test("GET / returns the SPA shell with a title", async ({ page }) => {
    const response = await page.goto("/");
    expect(response, "expected / to respond").not.toBeNull();
    // 200 (or 304 for a cached SPA shell) — anything else means
    // the static server short-circuited the request or returned
    // an error page.
    expect([200, 304]).toContain(response!.status());
    // The <title> is set in web-modern/index.html. If a future
    // refactor removes it, the SPA still works visually but SEO
    // and the apps smoke test (which also reads the title)
    // would silently drift.
    await expect(page).toHaveTitle(/A1 Suite/);
  });

  test("JS hydrates within 5 s (data-spa-hydrated appears)", async ({ page }) => {
    await page.goto("/");
    // The flag is set in src/main.tsx inside a `useEffect`, so it
    // fires after React's first commit. 5 s is generous for a cold
    // load; if it takes longer the dev server's HMR (or prod
    // cache) is broken.
    //
    // We wait with `state: "attached"` (not the default `visible`)
    // because the attribute lives on the <html> element, which
    // Playwright's visibility heuristic doesn't treat as a
    // "visible element" in the usual sense — there's no bounding
    // box. `attached` is the right semantic: the flag exists.
    await page.waitForSelector("[data-spa-hydrated]", {
      state: "attached",
      timeout: 5_000,
    });
    // Sanity: the flag is on the <html> element, so once it
    // appears we can read it back via getAttribute.
    const attr = await page.evaluate(() => document.documentElement.getAttribute("data-spa-hydrated"));
    expect(attr, "expected data-spa-hydrated on <html>").not.toBeNull();
  });

  test("/app/cfo renders the CFO toolbar (proves route tree intact)", async ({
    browser,
    request,
  }) => {
    // Probes the Fastify backend first so the SPA smoke can pass
    // in a dev environment that has the SPA but not the API server
    // running. Without this probe, a missing backend aborts the
    // test with ECONNREFUSED on the login call — which is a real
    // failure in CI (where START_FASTIFY=1 brings up the API) but
    // a false negative when a developer is iterating on the SPA
    // shell alone. The pre-existing apps.spec.ts has the same
    // coupling; we mirror its skip behaviour here.
    const probe = await request.get("http://localhost:4100/api/health", {
      timeout: 2_000,
    }).catch(() => null);
    test.skip(
      !probe || !probe.ok(),
      "Fastify backend not reachable on :4100 — skipping authed route render (CI runs with START_FASTIFY=1).",
    );

    const { page, context } = await authedPage(browser, request);
    try {
      const response = await page.goto("/app/cfo/");
      expect(response, "expected /app/cfo/ to respond").not.toBeNull();
      expect([200, 304]).toContain(response!.status());
      // The toolbar testid is on the top flex row of the cfo
      // workspace (see src/routes/app/cfo/index.tsx). If the
      // route renders at all, this selector will match.
      await expect(page.locator("[data-testid='cfo-toolbar']")).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await context.close();
    }
  });

  test("window.armospheraApp is undefined (legacy bundle NOT loaded)", async ({
    page,
  }) => {
    await page.goto("/");
    // The legacy web/src/main.jsx attaches `window.armospheraApp`
    // to expose its app instance. The new web-modern SPA does
    // not set that global — this assertion fails if the legacy
    // bundle is being served (or if a future change accidentally
    // pulls in the old entry script).
    const legacyType = await page.evaluate(
      () => typeof (window as unknown as { armospheraApp?: unknown }).armospheraApp,
    );
    expect(legacyType, "legacy web/ bundle should NOT be loaded in SPA mode").toBe(
      "undefined",
    );
  });
});
