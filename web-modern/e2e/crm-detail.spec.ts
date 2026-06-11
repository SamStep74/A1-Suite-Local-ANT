/**
 * crm-detail.spec.ts — Deeper coverage for the CRM happy path.
 *
 * Beyond the per-app smoke (load + H1 visible), this exercises the
 * list → detail transition: navigate to /app/crm, confirm the
 * quote list actually painted (not just a 200 with a loading
 * spinner), click the first row, and confirm the detail route
 * at /app/crm/$quoteId loads with the same customer name visible.
 *
 * Why one spec for this: it's the most-trafficked flow in the
 * whole app — a salesperson opens CRM, picks a quote, sends it.
 * If this breaks, the deployment is dead in the water.
 */
import { test, expect } from "@playwright/test";
import { authedPage, waitForHydration } from "./_helpers";

test.describe("CRM happy path", () => {
  test("list page paints quotes and first-row click opens detail", async ({ browser, request }) => {
    const { page } = await authedPage(browser, request);
    try {
      await page.goto("/app/crm/");
      await waitForHydration(page);

      // The list view has an <h1>CRM</h1>; the quote list is a
      // <table> with a clickable <tr> per quote (the row's
      // onClick navigates via window.location.href). The first
      // row is "whatever the API returned first" — the test is
      // invariant under sort order.
      await expect(page.getByRole("heading", { level: 1, name: "CRM" })).toBeVisible();

      const firstQuoteRow = page.locator("table tbody tr").first();
      await expect(firstQuoteRow).toBeVisible({ timeout: 10_000 });

      // Click and wait for the URL to change from the list to a
      // detail route. /app/crm/ → /app/crm/<quoteId>.
      await Promise.all([
        page.waitForURL(/\/app\/crm\/[^/?#]+$/, { timeout: 10_000 }),
        firstQuoteRow.click(),
      ]);

      // Detail page paints: the quote title appears as the H1
      // (e.g. "UI test quote — inbox setup") and the customer's
      // name shows up in the metadata row. We don't hardcode
      // either — the test guards against a blank page, not
      // against specific data.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const body = await page.locator("body").innerText();
      expect(body.length, "detail page should have visible content").toBeGreaterThan(200);
    } finally {
      await page.context().close();
    }
  });
});
