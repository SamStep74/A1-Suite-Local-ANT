/**
 * ask-ai.spec.ts — Phase 10.5 e2e coverage for the Ask AI surface.
 *
 * Exercises the full UX loop:
 *   1. Open /app/finance (any /app/* route works; finance has a
 *      known entity shape so the stub returns a citation).
 *   2. Click the Topbar "Ask AI" toggle.
 *   3. The panel mounts (data-testid="ask-ai-panel", data-state="open").
 *   4. Type a question into the textarea, click submit.
 *   5. Wait for the streamed answer to land in the DOM.
 *   6. Click a citation chip; the panel closes and we navigate to
 *      the cited route.
 *   7. Re-open the panel and click the toggle a second time — the
 *      panel unmounts.
 *
 * Auth: /app/* needs a session. We use the standard `authedPage()`
 * helper and skip the test cleanly if the Fastify backend is not
 * reachable (matches the convention in i18n-canary.spec.ts and
 * spa-mode.spec.ts).
 */
import { test, expect } from "@playwright/test";
import { authedPage } from "./_helpers";

test.describe("Ask AI — Topbar toggle + panel + citation (10.5)", () => {
  test.beforeEach(async ({ request }, testInfo) => {
    const probe = await request
      .get("http://localhost:4100/api/health", { timeout: 2_000 })
      .catch(() => null);
    testInfo.skip(
      !probe || !probe.ok(),
      "Fastify backend not reachable on :4100 — skipping authed ask-ai e2e (CI runs with START_FASTIFY=1).",
    );
  });

  test("opens the panel, submits a question, drills via citation, closes", async ({
    browser,
    request,
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      // /app/finance has a real topbar + left rail. The page can
      // also accept any /app/* route; finance/invoices gives us
      // a known entity in the route context.
      await page.goto("/app/finance");
      // Wait for the app shell + topbar to mount.
      await expect(page.getByTestId("app-shell")).toBeVisible();
      const toggle = page.getByTestId("topbar-ask-ai-toggle");
      await expect(toggle).toBeVisible();

      // 1. Click the toggle → panel mounts.
      await toggle.click();
      const panel = page.getByTestId("ask-ai-panel");
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute("data-state", "open");

      // 2. Type a question and submit.
      const input = page.getByTestId("ask-ai-input");
      await input.fill("test question");
      await page.getByTestId("ask-ai-submit").click();

      // 3. The stub answer streams in (800ms latency in the
      //    default client; the e2e timeout is generous).
      const answer = page.getByTestId("ask-ai-answer");
      await expect(answer).toBeVisible();
      await expect(answer).toContainText(/stub/i, { timeout: 15_000 });

      // 4. Click a citation chip — should navigate to the cited
      //    route and close the panel.
      const chip = page.getByTestId("ask-ai-citation-chip").first();
      await expect(chip).toBeVisible();
      // Capture the route *before* we click so we can assert the
      // navigation went somewhere meaningful.
      await chip.click();
      // The panel closes on citation click; the testid is gone.
      await expect(page.getByTestId("ask-ai-panel")).toHaveCount(0, {
        timeout: 5_000,
      });
      // We should now be on a non-/app/finance URL. The stub
      // returns /app/finance/invoices for the finance route.
      await page.waitForURL((url) => !url.pathname.startsWith("/app/finance") || url.pathname.includes("/invoices"), {
        timeout: 5_000,
      });

      // 5. Re-open and close via the toggle itself.
      await page.getByTestId("topbar-ask-ai-toggle").click();
      await expect(page.getByTestId("ask-ai-panel")).toBeVisible();
      await page.getByTestId("topbar-ask-ai-toggle").click();
      await expect(page.getByTestId("ask-ai-panel")).toHaveCount(0, {
        timeout: 5_000,
      });
    } finally {
      await page.context().close();
    }
  });
});
