/**
 * locale-switching.spec.ts — Phase 10.7 e2e coverage for the
 * dev-only Topbar locale switcher (10.3).
 *
 * The Topbar's locale switcher lets the user pick hy / ru / en. The
 * selected locale is persisted to localStorage under `a1:locale`
 * and the `document.documentElement.lang` attribute is updated by
 * `activateLocale()` in `src/i18n/lingui.ts`.
 *
 * What we cover here:
 *   1. The switcher renders in the Topbar, and `hy` is the default
 *      active button (the source locale).
 *   2. Switching to `ru` re-renders the visible UI in Russian: the
 *      Analytics route's "Dashboard" tab label becomes "Сводка" (the
 *      real translation in `locales/ru/messages.po`), and
 *      `html[lang]` flips to `ru`. The LinguiProvider re-loads the
 *      Russian catalog and updates its i18n context — the DOM no
 *      longer shows stale Armenian/English strings.
 *   3. Switching to `en` re-renders the UI: html[lang] flips to
 *      `en`, the en button is `aria-pressed`, and the Ask AI
 *      button's aria-label (a topbar-level translation) stays
 *      consistent with the en catalog. (The en catalog is currently
 *      a placeholder copy of the source, so the en tab label and
 *      the source hy label are visually identical — we lean on
 *      html[lang] and aria-pressed as the Lingui integration
 *      signal here.)
 *   4. Switching back to `hy` restores the source-locale state
 *      (html[lang] = "hy", hy button pressed, localStorage
 *      `a1:locale` = "hy").
 *   5. Persistence: after switching to `en` and reloading, the
 *      locale is restored from `a1:locale` and the en button is
 *      still pressed.
 *
 * Auth: the Topbar is rendered by the authed AppLayout at
 * `/app/*`. We follow the `authedPage()` pattern from
 * `_helpers.ts` and skip cleanly if the Fastify backend isn't
 * reachable, matching the convention in i18n-canary.spec.ts and
 * onboarding.spec.ts.
 *
 * The route under test is `/app/analytics/?lang=hy` because it
 * has a `Trans`/`t`-extracted tablist — the strongest visible
 * signal that the LinguiProvider re-loaded its catalog.
 */
import { test, expect, type Page } from "@playwright/test";
import { authedPage, FASTIFY_URL } from "./_helpers";

/** Where the locale switcher lives in the Topbar (right side).
 *  Each button is a separate testid: `locale-switcher-{hy|ru|en}`. */
const SWITCHER = "locale-switcher";
const SWITCHER_HY = "locale-switcher-hy";
const SWITCHER_RU = "locale-switcher-ru";
const SWITCHER_EN = "locale-switcher-en";

/** Visit `/app/analytics/` with a known starting locale. We use
 *  the `?lang=` query-string escape hatch from `getActiveLocale()`
 *  so the test starts from a clean state regardless of any
 *  pre-existing localStorage in the browser context. */
async function visitAnalytics(page: Page, lang: "hy" | "ru" | "en"): Promise<void> {
  const response = await page.goto(`/app/analytics/?lang=${lang}`);
  expect(response, `expected /app/analytics/?lang=${lang} to respond`).not.toBeNull();
  expect([200, 304]).toContain(response!.status());
  // The Topbar (and therefore the locale switcher) is part of
  // the authed shell. Wait for the shell to mount.
  await expect(page.getByTestId(SWITCHER)).toBeVisible({ timeout: 10_000 });
  // The Analytics workspace also renders — the page header H1
  // "Analytics" is the source string and appears for every locale
  // (Lingui's fallback path returns the source when a translation
  // is missing).
  await expect(
    page.getByRole("heading", { name: "Analytics", level: 1 }),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe("Locale switching — Topbar dev switcher (10.7)", () => {
  test.beforeEach(async ({ request }, testInfo) => {
    const probe = await request
      .get(`${FASTIFY_URL}/api/health`, { timeout: 2_000 })
      .catch(() => null);
    testInfo.skip(
      !probe || !probe.ok(),
      `Fastify backend not reachable at ${FASTIFY_URL} — skipping authed locale-switching e2e (CI runs with START_FASTIFY=1).`,
    );
  });

  test("default locale is hy and the switcher is visible in the Topbar @smoke", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      // Force a clean slate: ?lang=hy wins over localStorage, so
      // we don't need to clear localStorage here.
      await visitAnalytics(page, "hy");

      // The switcher wrapper is on the right side of the Topbar.
      const switcher = page.getByTestId(SWITCHER);
      await expect(switcher).toBeVisible();
      // It is grouped as a single control with an a11y label.
      await expect(switcher).toHaveAttribute("role", "group");
      await expect(switcher).toHaveAttribute("aria-label", "Language (dev only)");

      // All three buttons are present.
      await expect(page.getByTestId(SWITCHER_HY)).toBeVisible();
      await expect(page.getByTestId(SWITCHER_RU)).toBeVisible();
      await expect(page.getByTestId(SWITCHER_EN)).toBeVisible();

      // `hy` is the default and starts pressed; the others are not.
      await expect(page.getByTestId(SWITCHER_HY)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByTestId(SWITCHER_RU)).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await expect(page.getByTestId(SWITCHER_EN)).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      // The Topbar's `activateLocale()` writes `document.documentElement.lang`
      // synchronously (see src/i18n/lingui.ts#activateLocale). Confirm
      // it matches the active locale.
      const htmlLang = await page.evaluate(
        () => document.documentElement.lang,
      );
      expect(htmlLang).toBe("hy");
    } finally {
      await context.close();
    }
  });

  test("switching to ru re-renders the UI in Russian (Dashboard tab → Сводка)", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await visitAnalytics(page, "hy");

      // Sanity: the Dashboard tab is the source string before the switch.
      const dashboardTab = page.getByRole("tab", { name: "Dashboard" });
      await expect(dashboardTab).toBeVisible();

      // Click the ru button in the Topbar switcher.
      await page.getByTestId(SWITCHER_RU).click();

      // The ru button is now pressed; hy is not.
      await expect(page.getByTestId(SWITCHER_RU)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByTestId(SWITCHER_HY)).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      // The Lingui catalog re-loaded: the Dashboard tab is now
      // "Сводка" (the real Russian translation in
      // locales/ru/messages.po). This is the visible proof that
      // the LinguiProvider picked up the new catalog — not a
      // stale Armenian/English frame.
      await expect(page.getByRole("tab", { name: "Сводка" })).toBeVisible({
        timeout: 5_000,
      });
      // The English source string is no longer rendered as the tab
      // name (the tab still exists with the right role, but the
      // text has changed).
      await expect(page.getByRole("tab", { name: "Dashboard" })).toHaveCount(
        0,
      );

      // documentElement.lang flips to "ru" (set inside
      // activateLocale on every call).
      const htmlLang = await page.evaluate(
        () => document.documentElement.lang,
      );
      expect(htmlLang).toBe("ru");

      // localStorage a1:locale is now "ru" — proves the side
      // effect that the persistence test below relies on.
      const stored = await page.evaluate(() =>
        window.localStorage.getItem("a1:locale"),
      );
      expect(stored).toBe("ru");
    } finally {
      await context.close();
    }
  });

  test("switching to en re-renders the UI: en is pressed and html[lang] is en @smoke", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await visitAnalytics(page, "hy");

      await page.getByTestId(SWITCHER_EN).click();

      // The en button is now pressed.
      await expect(page.getByTestId(SWITCHER_EN)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByTestId(SWITCHER_HY)).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await expect(page.getByTestId(SWITCHER_RU)).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      // The en catalog is currently a placeholder copy of the
      // source, so the visible tab label is identical to the hy
      // source. We assert the Lingui integration signals instead:
      //   - html[lang] = "en"
      //   - localStorage a1:locale = "en"
      //   - the Ask AI topbar button's aria-label is the en
      //     catalog value (same as the source here, but it
      //     came from the en catalog after the switch).
      const htmlLang = await page.evaluate(
        () => document.documentElement.lang,
      );
      expect(htmlLang).toBe("en");
      const stored = await page.evaluate(() =>
        window.localStorage.getItem("a1:locale"),
      );
      expect(stored).toBe("en");
      const askAi = page.getByTestId("topbar-ask-ai-toggle");
      await expect(askAi).toHaveAttribute(
        "aria-label",
        "Open the Ask AI assistant sidebar",
      );
    } finally {
      await context.close();
    }
  });

  test("switching back to hy restores the source locale state", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      // Start in ru so we can observe a round-trip back to hy.
      await visitAnalytics(page, "ru");
      // Confirm ru is active and the Russian label is rendered.
      await expect(page.getByRole("tab", { name: "Сводка" })).toBeVisible({
        timeout: 5_000,
      });

      // Click hy.
      await page.getByTestId(SWITCHER_HY).click();

      // hy is now pressed; ru is not.
      await expect(page.getByTestId(SWITCHER_HY)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByTestId(SWITCHER_RU)).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      // The Russian tab label is gone — the page is back on the
      // hy catalog, so the source string "Dashboard" is rendered
      // again (Lingui's fallback path returns the source when
      // the active catalog has no real translation, which is the
      // case for hy's own messages).
      await expect(page.getByRole("tab", { name: "Dashboard" })).toBeVisible({
        timeout: 5_000,
      });
      await expect(page.getByRole("tab", { name: "Сводка" })).toHaveCount(0);

      // html[lang] is hy again.
      const htmlLang = await page.evaluate(
        () => document.documentElement.lang,
      );
      expect(htmlLang).toBe("hy");
      // localStorage a1:locale is hy again.
      const stored = await page.evaluate(() =>
        window.localStorage.getItem("a1:locale"),
      );
      expect(stored).toBe("hy");
    } finally {
      await context.close();
    }
  });

  test("locale persists across reload via localStorage a1:locale @smoke", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      // Start in hy.
      await visitAnalytics(page, "hy");

      // Switch to en so the persistence round-trip is observable.
      await page.getByTestId(SWITCHER_EN).click();
      await expect(page.getByTestId(SWITCHER_EN)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      // Sanity: the storage key is set before reload.
      const beforeReload = await page.evaluate(() =>
        window.localStorage.getItem("a1:locale"),
      );
      expect(beforeReload).toBe("en");

      // Reload the page (drop the ?lang= override so localStorage
      // is the source of truth on the next page load — see
      // getActiveLocale()'s query-string-then-localStorage order).
      // `getActiveLocale()` runs synchronously from localStorage
      // on the new page and re-activates the en catalog before
      // the React tree mounts, so the Topbar's switcher state is
      // already correct by the time it appears.
      await page.goto("/app/analytics/");
      await expect(page.getByTestId(SWITCHER)).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByRole("heading", { name: "Analytics", level: 1 }),
      ).toBeVisible({ timeout: 10_000 });

      // The en button is still pressed after the reload — this
      // is the visible signal that `getActiveLocale()` restored
      // "en" from localStorage before the Topbar mounted. The
      // persistence requirement is satisfied at this point: the
      // selected locale survived a hard navigation.
      await expect(page.getByTestId(SWITCHER_EN)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByTestId(SWITCHER_HY)).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      // localStorage a1:locale is still en — confirms the
      // storage key (and therefore the user's preference)
      // survived the reload intact.
      const stored = await page.evaluate(() =>
        window.localStorage.getItem("a1:locale"),
      );
      expect(stored).toBe("en");
    } finally {
      await context.close();
    }
  });

  test("LinguiProvider integration: the DOM matches the new locale, not the old one", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      // Start in hy. The Dashboard tab is "Dashboard" (source).
      await visitAnalytics(page, "hy");
      const dashboardTab = page.getByRole("tab", { name: "Dashboard" });
      await expect(dashboardTab).toBeVisible();

      // Switch to ru. The LinguiProvider must re-render the
      // children with the new catalog. The dashboard tab label
      // is the strongest signal here: it changes from "Dashboard"
      // (source) to "Сводка" (ru). If the catalog was stale or
      // the i18n context didn't refresh, the page would still
      // show "Dashboard".
      await page.getByTestId(SWITCHER_RU).click();
      await expect(page.getByRole("tab", { name: "Сводка" })).toBeVisible({
        timeout: 5_000,
      });
      await expect(dashboardTab).toHaveCount(0);

      // Switch to en. The LinguiProvider must re-render again.
      // The en catalog is a placeholder, so the tab text is the
      // source string "Dashboard" — but it must come from the en
      // catalog now, not the old ru catalog. The strongest
      // signal that the catalog re-loaded is the html[lang] and
      // the active button.
      await page.getByTestId(SWITCHER_EN).click();
      await expect(page.getByTestId(SWITCHER_EN)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      const htmlLangEn = await page.evaluate(
        () => document.documentElement.lang,
      );
      expect(htmlLangEn).toBe("en");
      // The Russian tab label is gone (no leftover ru string).
      await expect(page.getByRole("tab", { name: "Сводка" })).toHaveCount(0);

      // The page is alive after two catalog switches — every
      // Tab is still rendered (Dashboard / Receivables / Metrics
      // / Snapshots / Reports) and the H1 is still visible.
      const tabs = await page.getByRole("tab").all();
      expect(tabs.length).toBe(5);
      await expect(
        page.getByRole("heading", { name: "Analytics", level: 1 }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
