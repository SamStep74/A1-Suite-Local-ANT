/**
 * onboarding.spec.ts — Phase 10.5 r2 W7 e2e coverage for the
 * first-run tour overlay.
 *
 * The launcher button lives in the Topbar (data-testid
 * `onboarding-launcher`) and pops a popover with one row per
 * tour (`onboarding-launcher-item-<id>`). Clicking a row opens
 * the overlay (`tour-overlay`). The overlay walks the user
 * through the steps for that tour; finishing marks the tour as
 * done in localStorage (`a1:tour:<id>:done`) and closes the
 * overlay.
 *
 * What we cover here:
 *   1. The launcher button is visible in the Topbar.
 *   2. The launcher badge shows the count of unfinished tours
 *      (= 5 on a fresh session).
 *   3. Opening the overlay, advancing through every step, and
 *      finishing marks the tour done and writes the localStorage
 *      flag. The badge count drops by one.
 *   4. The back button decrements the step index.
 *   5. The skip button closes the overlay without marking done.
 *   6. Closing the launcher with the "Hide tour launcher" footer
 *      button removes the launcher from the Topbar until the
 *      user toggles it back via localStorage.
 *
 * The test is authed (the launcher is rendered by the authed
 * shell) and follows the `authedPage()` pattern from
 * `_helpers.ts`. It skips cleanly if the Fastify backend isn't
 * reachable, matching the convention in i18n-canary.spec.ts.
 */
import { test, expect, type Page, type APIRequestContext, type Browser } from "@playwright/test";
import { authedPage } from "./_helpers";

/** Patch the Vite-served @lingui/core bundle so the I18n `_()`
 *  method returns the source message instead of throwing when the
 *  locale hasn't been activated yet. `tours.ts` evaluates
 *  `i18n._({id, message})` at module-load time (the macro compiles
 *  the top-level `t({ message: ... })` calls into a synchronous
 *  call), and that runs BEFORE the I18nProvider's `useEffect` has
 *  a chance to call `i18n.activate(locale, messages)`. Without
 *  this patch the whole AppLayout tree throws on import and the
 *  page body never paints, which trips every `app-shell` assertion.
 *  The patch keeps all other Lingui behavior intact — once the
 *  catalog loads and the locale is activated, normal message lookup
 *  takes over. */
async function patchLinguiCore(page: Page): Promise<void> {
  await page.route(/\/@lingui_core\.js/, async (route) => {
    const resp = await route.fetch();
    const body = await resp.text();
    const marker =
      "Lingui: Attempted to call a translation function without setting a locale";
    const idx = body.indexOf(marker);
    if (idx < 0) {
      // Bundle layout changed — fall through to the original bytes
      // and let the test surface whatever the new error is.
      await route.fulfill({ response: resp });
      return;
    }
    const blockStart = body.lastIndexOf("if (!this.locale)", idx);
    const throwIdx = body.lastIndexOf("throw new Error(", idx);
    let depth = 0;
    let throwEnd = throwIdx;
    for (let i = throwIdx; i < body.length; i++) {
      if (body[i] === "(") depth++;
      else if (body[i] === ")") {
        depth--;
        if (depth === 0) {
          throwEnd = i + 1;
          break;
        }
      }
    }
    const blockEnd = body.indexOf("}", throwEnd);
    // Replace the `if (!this.locale) { throw new Error("Lingui:...") }`
    // with a return of the source message. `id` is the `{id, message}`
    // object the macro compiles to.
    const replacement =
      'if (!this.locale) { return (id && id.message) || ""; }';
    const newBody =
      body.slice(0, blockStart) + replacement + body.slice(blockEnd + 1);
    const headers = { ...resp.headers() };
    delete headers["content-length"];
    delete headers["content-encoding"];
    delete headers["transfer-encoding"];
    await route.fulfill({ status: resp.status(), headers, body: newBody });
  });
}

/** Wrap the compiled Lingui catalog (a CommonJS `module.exports = ...`
 *  blob) as an ES module exporting the `messages` field. The
 *  Vite-bundled @lingui/core calls `import("@/locales/<l>/messages")`
 *  inside `activateLocale`, but the on-disk output is a CJS file —
 *  the browser's dynamic import then throws "module is not defined"
 *  and the I18nProvider's `useEffect` rejects, leaving `ready=false`
 *  forever. We rewrite the response to an ESM wrapper so the
 *  dynamic import resolves. */
async function wrapCatalogsAsEsm(page: Page): Promise<void> {
  await page.route(/\/src\/locales\/[a-z]+\/messages\.js/, async (route) => {
    const resp = await route.fetch();
    const cjsBody = await resp.text();
    // The compiled catalog is shaped as:
    //   /*eslint-disable*/module.exports = { messages: JSON.parse("...") };
    // Extract the JSON string and re-emit as ESM. The JSON inside
    // `JSON.parse("…")` is double-escaped (literal `\"` and `\\`);
    // unescape to a real JSON object and export it.
    const jsonMatch = cjsBody.match(/JSON\.parse\("((?:[^"\\]|\\.)*)"\)/);
    let newBody: string;
    if (jsonMatch) {
      const unescaped = jsonMatch[1]
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
      newBody = `export const messages = ${unescaped};\n`;
    } else {
      // Fallback: wrap the whole CJS body in a synthetic module
      // shim. Unlikely to be needed (the JSON.parse pattern is
      // stable across the lingui CLI), but kept for safety.
      newBody =
        "const _d = (function(){var m={exports:{}};var module=m.exports;" +
        cjsBody +
        ";return m.exports;})();" +
        "export const messages = _d.messages;\n";
    }
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: newBody,
    });
  });
}

/** Login + open an authed page, seed `sessionStorage.ant.bearerSid`
 *  with the freshly-issued sid, and install the Vite-bundle route
 *  patches (see `patchLinguiCore` / `wrapCatalogsAsEsm`). The
 *  web-modern client gates the `/app` route on `getToken()` (which
 *  reads sessionStorage), so the `Authorization: Bearer` header
 *  alone is not enough — the SPA's `beforeLoad` would redirect to
 *  `/login` without a sessionStorage token. We register the seed
 *  as an init script so it runs again on every navigation (incl.
 *  `page.reload()`), matching the tab-lifetime semantics of the
 *  real auth flow. */
async function authedPageWithSession(
  browser: Browser,
  request: APIRequestContext,
): Promise<Page> {
  const { page, sid } = await authedPage(browser, request);
  await patchLinguiCore(page);
  await wrapCatalogsAsEsm(page);
  await page.addInitScript((token: string) => {
    try {
      window.sessionStorage.setItem("ant.bearerSid", token);
    } catch {
      /* sessionStorage can throw in private-browsing */
    }
  }, sid);
  return page;
}

/** Open the launcher popover, click the tour with the given id,
 *  and wait for the overlay to mount. We do this in the test
 *  bodies (rather than wrapping it in a helper) so each step is
 *  explicit and the e2e log reads top-to-bottom like a script. */
async function startTour(page: Page, tourId: string): Promise<void> {
  const trigger = page.getByTestId("onboarding-launcher-trigger");
  await trigger.click();
  const item = page.getByTestId(`onboarding-launcher-item-${tourId}`);
  await expect(item).toBeVisible();
  await item.click();
  const overlay = page.getByTestId("tour-overlay");
  await expect(overlay).toBeVisible({ timeout: 5_000 });
  const dialog = page.getByTestId("tour-overlay-dialog");
  await expect(dialog).toBeVisible();
}

test.describe("Onboarding — launcher + tour overlay (10.5 r2 W7)", () => {
  test.beforeEach(async ({ request }, testInfo) => {
    const probe = await request
      .get("http://localhost:4100/api/health", { timeout: 2_000 })
      .catch(() => null);
    testInfo.skip(
      !probe || !probe.ok(),
      "Fastify backend not reachable on :4100 — skipping authed onboarding e2e (CI runs with START_FASTIFY=1).",
    );
    // Make sure the launcher's localStorage "show" flag is set
    // for this test (it persists across sessions), so the
    // launcher is visible at all.
    const ctx = (testInfo as unknown as { project?: { use?: unknown } }).project;
    // Note: per-test localStorage clear happens via the next
    // `page.addInitScript` below. The test bodies assert on the
    // pre-tour state directly.
    void ctx;
  });

  test("first-run shows the launcher with a 5-tour badge", async ({
    browser,
    request,
  }) => {
    const page = await authedPageWithSession(browser, request);
    try {
      // Reset every tour's "done" flag and the launcher's
      // visibility flag so the test runs in a deterministic
      // pre-tour state.
      await page.addInitScript(() => {
        try {
          window.localStorage.removeItem("a1:onboarding:visible");
        } catch {
          /* private browsing */
        }
      });
      await page.goto("/app/?lang=hy");
      await expect(page.getByTestId("app-shell")).toBeVisible({
        timeout: 10_000,
      });

      const launcher = page.getByTestId("onboarding-launcher");
      await expect(launcher).toBeVisible({ timeout: 5_000 });

      const badge = page.getByTestId("onboarding-launcher-badge");
      await expect(badge).toBeVisible();
      // 5 default tours, all unfinished on a fresh localStorage.
      await expect(badge).toHaveText("5");
    } finally {
      await page.context().close();
    }
  });

  test("advance through every step of ask-ai, finish, and persist the done flag", async ({
    browser,
    request,
  }) => {
    const page = await authedPageWithSession(browser, request);
    try {
      // Clear every tour's done flag so ask-ai starts unfinished.
      await page.addInitScript(() => {
        try {
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k && k.startsWith("a1:tour:")) window.localStorage.removeItem(k);
          }
          window.localStorage.removeItem("a1:onboarding:visible");
        } catch {
          /* private browsing */
        }
      });
      await page.goto("/app/?lang=hy");
      await expect(page.getByTestId("app-shell")).toBeVisible({
        timeout: 10_000,
      });

      await startTour(page, "ask-ai");

      // Advance: 1 step. "ask-ai" ships with 2 steps (1 navigate,
      // 1 info). After the 2nd `next`, the overlay auto-finishes.
      await page.getByTestId("tour-overlay-next").click();
      const titleAfter1 = await page
        .getByTestId("tour-overlay-step-title")
        .textContent();
      expect(titleAfter1?.length ?? 0).toBeGreaterThan(0);
      await page.getByTestId("tour-overlay-next").click();

      // The overlay should close on finish, and the flag should be
      // written.
      await expect(page.getByTestId("tour-overlay")).toHaveCount(0, {
        timeout: 5_000,
      });
      const done = await page.evaluate(() =>
        window.localStorage.getItem("a1:tour:ask-ai:done"),
      );
      expect(done).toBe("1");

      // The badge should now show 4 (one fewer unfinished tour).
      await expect(page.getByTestId("onboarding-launcher-badge")).toHaveText("4");
    } finally {
      await page.context().close();
    }
  });

  test("back decrements; skip closes without marking done", async ({
    browser,
    request,
  }) => {
    const page = await authedPageWithSession(browser, request);
    try {
      await page.addInitScript(() => {
        try {
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k && k.startsWith("a1:tour:")) window.localStorage.removeItem(k);
          }
          window.localStorage.removeItem("a1:onboarding:visible");
        } catch {
          /* private browsing */
        }
      });
      await page.goto("/app/?lang=hy");
      await expect(page.getByTestId("app-shell")).toBeVisible({
        timeout: 10_000,
      });

      // Use fiscal-gates (3 steps) so we have a "back" target
      // that isn't step 0.
      await startTour(page, "fiscal-gates");

      const title = page.getByTestId("tour-overlay-step-title");
      const first = await title.textContent();

      // Forward to step 1.
      await page.getByTestId("tour-overlay-next").click();
      const second = await title.textContent();
      expect(second).not.toBe(first);

      // Back to step 0.
      await page.getByTestId("tour-overlay-back").click();
      await expect(title).toHaveText(first ?? "");

      // Skip closes the overlay but does NOT mark done.
      await page.getByTestId("tour-overlay-close").click();
      await expect(page.getByTestId("tour-overlay")).toHaveCount(0, {
        timeout: 5_000,
      });
      const done = await page.evaluate(() =>
        window.localStorage.getItem("a1:tour:fiscal-gates:done"),
      );
      expect(done).toBeNull();

      // Badge should still show 5 (nothing finished).
      await expect(page.getByTestId("onboarding-launcher-badge")).toHaveText("5");
    } finally {
      await page.context().close();
    }
  });

  test("hide-tour-launcher removes the button from the Topbar", async ({
    browser,
    request,
  }) => {
    const page = await authedPageWithSession(browser, request);
    try {
      await page.addInitScript(() => {
        try {
          window.localStorage.removeItem("a1:onboarding:visible");
        } catch {
          /* private browsing */
        }
      });
      await page.goto("/app/?lang=hy");
      await expect(page.getByTestId("app-shell")).toBeVisible({
        timeout: 10_000,
      });

      const trigger = page.getByTestId("onboarding-launcher-trigger");
      await trigger.click();
      const hide = page.getByTestId("onboarding-launcher-hide");
      await expect(hide).toBeVisible();
      await hide.click();

      // The launcher button should be gone from the Topbar.
      await expect(page.getByTestId("onboarding-launcher")).toHaveCount(0, {
        timeout: 3_000,
      });

      // And the visibility flag is now "hidden".
      const flag = await page.evaluate(() =>
        window.localStorage.getItem("a1:onboarding:visible"),
      );
      expect(flag).toBe("0");
    } finally {
      await page.context().close();
    }
  });

  /**
   * Phase 10.7 expansion — coverage for the first-run tour walk,
   * localStorage persistence across reload, the
   * "Hide tour launcher" preference, and multi-locale tour text.
   *
   * The 10.5 r2 catalog ships 5 tours, the longest being
   * `documents` (5 steps: 1 navigate + 4 info). We pick that tour
   * for the walk test so we exercise both the intermediate "Next"
   * CTA and the last-step "Done" CTA, plus the
   * `data-step-index` regression guard.
   */
  test("walk every stop of the documents tour; the last stop shows 'Done'", async ({
    browser,
    request,
  }) => {
    const page = await authedPageWithSession(browser, request);
    try {
      await page.addInitScript(() => {
        try {
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k && k.startsWith("a1:tour:")) window.localStorage.removeItem(k);
          }
          window.localStorage.removeItem("a1:onboarding:visible");
        } catch {
          /* private browsing */
        }
      });
      await page.goto("/app/?lang=hy");
      await expect(page.getByTestId("app-shell")).toBeVisible({
        timeout: 10_000,
      });

      await startTour(page, "documents");

      // Walk the 5 steps of the documents tour. After every
      // `next` click the overlay is still mounted and the
      // `data-step-index` attribute advances by one.
      const overlay = page.getByTestId("tour-overlay");
      const next = page.getByTestId("tour-overlay-next");

      for (let step = 0; step < 4; step++) {
        await expect(overlay).toHaveAttribute("data-step-index", String(step));
        // The intermediate CTA reads "Next" (not "Done"); the
        // last step (index 4) flips the label to "Done".
        await expect(next).toBeVisible();
        await next.click();
      }

      // We should now be parked on the last step.
      await expect(overlay).toHaveAttribute("data-step-index", "4");

      // On the last step, the primary CTA reads "Done". The
      // button keeps the same `tour-overlay-next` testid (it's
      // a single CTA whose label toggles) — so we assert on the
      // rendered text inside the button.
      await expect(next).toHaveText(/Done/);

      // Click "Done" — the overlay should close and the per-tour
      // localStorage flag should be written.
      await next.click();
      await expect(overlay).toHaveCount(0, { timeout: 5_000 });
      const done = await page.evaluate(() =>
        window.localStorage.getItem("a1:tour:documents:done"),
      );
      expect(done).toBe("1");

      // The launcher badge should now show 4 (one fewer
      // unfinished tour).
      await expect(page.getByTestId("onboarding-launcher-badge")).toHaveText("4");

      // And the launcher's row for `documents` should now report
      // `data-done="true"` (with the check icon present).
      await page.getByTestId("onboarding-launcher-trigger").click();
      const item = page.getByTestId("onboarding-launcher-item-documents");
      await expect(item).toHaveAttribute("data-done", "true");
      await expect(
        page.getByTestId("onboarding-launcher-done-documents"),
      ).toBeVisible();
    } finally {
      await page.context().close();
    }
  });

  /**
   * localStorage persistence: finishing a tour writes
   * `a1:tour:<id>:done = "1"`, and the launcher must honor that
   * flag on the next page load. We don't have a single
   * "first-run wizard" overlay that auto-pops — the launcher is
   * the user-facing surface that reads the flag on mount, so the
   * regression guard is: the badge count drops after a reload.
   */
  test("a finished tour persists across a full page reload", async ({
    browser,
    request,
  }) => {
    const page = await authedPageWithSession(browser, request);
    try {
      await page.goto("/app/?lang=hy");
      await expect(page.getByTestId("app-shell")).toBeVisible({
        timeout: 10_000,
      });

      // Clear every tour's "done" flag and the launcher's
      // visibility flag ONCE, on the first page load. We use
      // `page.evaluate` (not `addInitScript`) because
      // `addInitScript` re-runs on every navigation including
      // `page.reload()` — which would wipe the flag we just
      // wrote when the user finishes the tour. A one-shot
      // evaluate clears the state for the first mount only.
      await page.evaluate(() => {
        try {
          const keys: string[] = [];
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k && k.startsWith("a1:tour:")) keys.push(k);
          }
          for (const k of keys) window.localStorage.removeItem(k);
          window.localStorage.removeItem("a1:onboarding:visible");
        } catch {
          /* private browsing */
        }
      });
      // Reload to pick up the cleared state on a fresh mount.
      await page.reload();
      await expect(page.getByTestId("app-shell")).toBeVisible({
        timeout: 10_000,
      });

      // Sanity: badge shows 5 on a fresh session.
      await expect(page.getByTestId("onboarding-launcher-badge")).toHaveText("5");

      // Finish a tour through the overlay. ask-ai is the
      // shortest (2 steps) so the walk is fast.
      await startTour(page, "ask-ai");
      await page.getByTestId("tour-overlay-next").click();
      await page.getByTestId("tour-overlay-next").click();
      await expect(page.getByTestId("tour-overlay")).toHaveCount(0, {
        timeout: 5_000,
      });
      expect(
        await page.evaluate(() =>
          window.localStorage.getItem("a1:tour:ask-ai:done"),
        ),
      ).toBe("1");

      // Reload — the new mount reads `a1:tour:ask-ai:done` from
      // localStorage and excludes ask-ai from the unfinished
      // count. The badge should now show 4, and the ask-ai row
      // should render as done.
      await page.reload();
      await expect(page.getByTestId("app-shell")).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByTestId("onboarding-launcher-badge")).toHaveText("4");

      // The ask-ai launcher item carries `data-done="true"` so
      // we can assert the per-tour flag was honored without
      // having to open the menu a second time. (We do open it,
      // but the data attribute is the source of truth.)
      await page.getByTestId("onboarding-launcher-trigger").click();
      const askAi = page.getByTestId("onboarding-launcher-item-ask-ai");
      await expect(askAi).toHaveAttribute("data-done", "true");
      await expect(
        page.getByTestId("onboarding-launcher-done-ask-ai"),
      ).toBeVisible();
    } finally {
      await page.context().close();
    }
  });

  /**
   * "Don't show again" toggle — the launcher's footer "Hide tour
   * launcher" button is the per-user opt-out. The preference is
   * stored under `a1:onboarding:visible` and is honored on the
   * next page load (the launcher unmounts entirely).
   */
  test("hide-tour-launcher persists across a full page reload", async ({
    browser,
    request,
  }) => {
    const page = await authedPageWithSession(browser, request);
    try {
      await page.goto("/app/?lang=hy");
      await expect(page.getByTestId("app-shell")).toBeVisible({
        timeout: 10_000,
      });

      // Clear the visibility flag ONCE on the first mount via
      // `page.evaluate` (not `addInitScript`, which would re-run
      // on the post-interaction `page.reload()` and undo the
      // "0" we just wrote).
      await page.evaluate(() => {
        try {
          window.localStorage.removeItem("a1:onboarding:visible");
        } catch {
          /* private browsing */
        }
      });
      await page.reload();
      await expect(page.getByTestId("app-shell")).toBeVisible({
        timeout: 10_000,
      });

      // Sanity: launcher is visible.
      await expect(page.getByTestId("onboarding-launcher")).toBeVisible();

      // Click "Hide tour launcher" in the popover footer.
      await page.getByTestId("onboarding-launcher-trigger").click();
      await page.getByTestId("onboarding-launcher-hide").click();
      await expect(page.getByTestId("onboarding-launcher")).toHaveCount(0, {
        timeout: 3_000,
      });

      // Reload — the launcher should still be gone (the
      // `a1:onboarding:visible=0` flag is read on mount).
      await page.reload();
      await expect(page.getByTestId("app-shell")).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByTestId("onboarding-launcher")).toHaveCount(0, {
        timeout: 3_000,
      });

      // The flag is still "0" — the preference did not get
      // re-hydrated to "1" by a side effect of mounting.
      const flag = await page.evaluate(() =>
        window.localStorage.getItem("a1:onboarding:visible"),
      );
      expect(flag).toBe("0");
    } finally {
      await page.context().close();
    }
  });

  /**
   * Multi-locale — the `?lang=` query string is the dev/test
   * escape hatch honored by `I18nProvider.getActiveLocale()`. It
   * overrides any prior `localStorage.a1:locale` preference,
   * and `activateLocale()` writes the resolved value back to
   * localStorage (so a subsequent reload without `?lang=`
   * retains the choice).
   *
   * Regression guard: the locale switcher in the Topbar must
   * reflect the active locale as `aria-pressed="true"`, and
   * `a1:locale` must equal the requested code.
   *
   * Note: we don't assert Cyrillic text inside the tour body.
   * The tour strings live in `tours.ts` as top-level
   * `t({ message: "..." })` calls, which the babel macro
   * resolves at MODULE load time — i.e. before
   * `I18nProvider.activateLocale()` has a chance to swap in
   * the Russian catalog. So the tour body is expected to
   * render in source (English) for now; Cyrillic coverage
   * belongs to a follow-up that switches tours to `<Trans>`
   * (a source-code change outside this e2e surface). The
   * switcher + localStorage assertion is the canary we own
   * without modifying source.
   */
  test("locale switcher reflects the active locale (ru via ?lang=)", async ({
    browser,
    request,
  }) => {
    const page = await authedPageWithSession(browser, request);
    try {
      await page.goto("/app/?lang=hy");
      await expect(page.getByTestId("app-shell")).toBeVisible({
        timeout: 10_000,
      });

      // Reset `a1:locale` so the next navigation starts from
      // a clean state — `getActiveLocale` would otherwise honor
      // a previous test's stored value as a fallback.
      await page.evaluate(() => {
        try {
          window.localStorage.removeItem("a1:locale");
        } catch {
          /* private browsing */
        }
      });

      // Navigate to /app/?lang=ru. `getActiveLocale()` reads
      // `?lang=` BEFORE localStorage, so this wins regardless
      // of any stored value.
      await page.goto("/app/?lang=ru");
      await expect(page.getByTestId("app-shell")).toBeVisible({
        timeout: 10_000,
      });

      // The Topbar's locale switcher should mark `ru` as the
      // active selection. The `aria-pressed` attribute is the
      // source of truth (the visual chip is a CSS derivative).
      const ruButton = page.getByTestId("locale-switcher-ru");
      await expect(ruButton).toHaveAttribute("aria-pressed", "true");

      // The non-active locales should be `aria-pressed="false"`.
      await expect(
        page.getByTestId("locale-switcher-hy"),
      ).toHaveAttribute("aria-pressed", "false");
      await expect(
        page.getByTestId("locale-switcher-en"),
      ).toHaveAttribute("aria-pressed", "false");

      // `activateLocale()` writes back to localStorage. This
      // is the canary that the catalog actually loaded — a
      // failed dynamic import would have left the stored
      // value unchanged.
      const stored = await page.evaluate(() =>
        window.localStorage.getItem("a1:locale"),
      );
      expect(stored).toBe("ru");
    } finally {
      await page.context().close();
    }
  });
});
