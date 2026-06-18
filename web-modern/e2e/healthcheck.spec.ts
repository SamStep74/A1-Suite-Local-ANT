/**
 * healthcheck.spec.ts — e2e coverage for the Pattern A healthcheck
 * skeleton (the smallest Pattern A app in the suite).
 *
 * What this asserts (the must-haves for "the skeleton works"):
 *   - GET /app/healthcheck returns 2xx (route resolves, auth works)
 *   - H1 "Healthcheck" is visible
 *   - The Armenian subtitle is present (contains "ստուգում" or "Pattern A")
 *   - The input has the default value "skeleton"
 *   - Clicking Ping causes a result section to appear with text
 *     containing "echo:" and the message
 *   - The healthcheck panel (data-testid="healthcheck-panel") exists
 *
 * Why a dedicated spec: /app/healthcheck is a Pattern A skeleton,
 * separate from the full apps smoke loop. This spec confirms the
 * skeleton round-trips through the dev server.
 */
import { test, expect } from "@playwright/test";
import { authedPage, waitForHydration } from "./_helpers";

test.describe("Healthcheck — Pattern A skeleton", () => {
  test("loads, defaults the input, and Pings back the message", async ({
    browser,
    request,
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      const response = await page.goto("/app/healthcheck");
      expect(
        response,
        `expected /app/healthcheck to respond (got ${response?.status()})`,
      ).not.toBeNull();
      expect([200, 304]).toContain(response!.status());

      await waitForHydration(page);

      // H1 — the screen header.
      await expect(
        page.getByRole("heading", { level: 1, name: /Healthcheck/i }),
      ).toBeVisible();

      // Armenian subtitle (contains "Pattern A" or the Armenian word).
      const panel = page.getByTestId("healthcheck-panel");
      await expect(panel).toBeVisible();
      await expect(
        page.locator("main").getByText(/Pattern A|ստուգում/),
      ).toBeVisible();

      // Input has the default value "skeleton".
      const input = panel.getByRole("textbox");
      await expect(input).toHaveValue("skeleton");

      // Click Ping and wait for the result section to appear with the
      // echo of the message.
      const pingButton = panel.getByRole("button", { name: /Ping/i });
      await pingButton.click();
      const result = panel.locator("[data-testid='healthcheck-result']");
      await expect(result).toBeVisible();
      await expect(result).toContainText(/echo:/);
      await expect(result).toContainText("skeleton");
    } finally {
      await page.context().close();
    }
  });
});
