/**
 * i18n-canary.spec.ts — Phase 10.3 e2e coverage for the Lingui
 * pipeline.
 *
 * This spec asserts the *canary contract*: the analytics workspace
 * route (`/app/analytics`) renders correctly under each of the
 * three supported locales (hy / ru / en), and that the locale is
 * driven by the `?lang=` query string (the dev/test escape hatch
 * that the I18nProvider honours over localStorage).
 *
 *   - `?lang=hy` (the source locale) renders the source strings.
 *   - `?lang=en` renders the source strings as well, since the en
 *     catalog starts empty in this phase. Phase 10.5+ will fill
 *     it; this spec is the regression guard that the *pipeline*
 *     works, not that translations exist yet.
 *   - `?lang=ru` renders without throwing; the ru catalog is also
 *     a placeholder in this phase. The page must still mount and
 *     the heading `<h1>Analytics</h1>` must be present.
 *
 * Auth: /app/analytics needs a session. We follow the
 * `authedPage()` pattern from `_helpers.ts`. If the Fastify
 * backend isn't reachable (developer running only the SPA), the
 * suite skips just like `spa-mode.spec.ts` does.
 */
import { test, expect } from "@playwright/test";
import { authedPage, FASTIFY_URL } from "./_helpers";

test.describe("i18n canary — analytics route under each locale (10.3)", () => {
  test.beforeEach(async ({ request }, testInfo) => {
    const probe = await request
      .get(`${FASTIFY_URL}/api/health`, { timeout: 2_000 })
      .catch(() => null);
    testInfo.skip(
      !probe || !probe.ok(),
      `Fastify backend not reachable at ${FASTIFY_URL} — skipping authed canary render (CI runs with START_FASTIFY=1).`,
    );
  });

  test("?lang=en — analytics route renders the source strings (en catalog is a placeholder) @smoke", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      const response = await page.goto("/app/analytics/?lang=en");
      expect(response, "expected /app/analytics/ to respond").not.toBeNull();
      expect([200, 304]).toContain(response!.status());
      // The page header H1 is "Analytics" in the source catalog.
      // Even with the en catalog empty, Lingui's fallback path
      // returns the source string — which is what we assert.
      await expect(
        page.getByRole("heading", { name: "Analytics", level: 1 }),
      ).toBeVisible({ timeout: 10_000 });
      // The 5 tab labels are all extracted messages; all 5
      // tabs should be in the tablist.
      const tablist = page.getByRole("tablist", { name: "View" });
      const tabs = await tablist.getByRole("tab").all();
      expect(tabs.length).toBe(5);
      // The page should be live (html lang is set by I18nProvider).
      const htmlLang = await page.evaluate(() => document.documentElement.lang);
      expect(htmlLang).toBe("en");
    } finally {
      await context.close();
    }
  });

  test("?lang=hy — analytics route renders under the source locale @smoke", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      const response = await page.goto("/app/analytics/?lang=hy");
      expect(response, "expected /app/analytics/ to respond").not.toBeNull();
      expect([200, 304]).toContain(response!.status());
      await expect(
        page.getByRole("heading", { name: "Analytics", level: 1 }),
      ).toBeVisible({ timeout: 10_000 });
      // The Armenian subtitle is hard-coded Armenian in the source
      // route file (see AnalyticsPageHeader); the i18n canary
      // doesn't translate it yet — it asserts the page mounts
      // without throwing under the source locale.
      const subtitle = page.getByText(/Վահանակ/);
      await expect(subtitle).toBeVisible({ timeout: 5_000 });
      const htmlLang = await page.evaluate(() => document.documentElement.lang);
      expect(htmlLang).toBe("hy");
    } finally {
      await context.close();
    }
  });

  test("?lang=ru — analytics route mounts without throwing (ru catalog is a placeholder) @smoke", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      const response = await page.goto("/app/analytics/?lang=ru");
      expect(response, "expected /app/analytics/ to respond").not.toBeNull();
      expect([200, 304]).toContain(response!.status());
      // The page must hydrate and the page header must be visible.
      // This catches a missing compiled catalog (the dynamic import
      // would reject) as a real failure rather than a silent
      // translation gap.
      await expect(
        page.getByRole("heading", { name: "Analytics", level: 1 }),
      ).toBeVisible({ timeout: 10_000 });
      const htmlLang = await page.evaluate(() => document.documentElement.lang);
      expect(htmlLang).toBe("ru");
    } finally {
      await context.close();
    }
  });
});
