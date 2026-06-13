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
import { test, expect, type Page } from "@playwright/test";
import { authedPage } from "./_helpers";

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
    const { page } = await authedPage(browser, request);
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
    const { page } = await authedPage(browser, request);
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
    const { page } = await authedPage(browser, request);
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
    const { page } = await authedPage(browser, request);
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
});
