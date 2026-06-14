/**
 * triage-inbox.spec.ts — Phase 10.5 W2 cross-feature work queue e2e.
 *
 * Asserts the inbox surface end-to-end against the live Vite dev
 * server. The feed is a typed fixture (lib/triage/feed.ts), so this
 * spec is independent of Fastify: no `route.intercept` mocking.
 *
 *   - GET /app/triage-inbox returns 2xx and the H1 "Triage inbox" paints
 *   - The default view is "My queue" (the first seed)
 *   - Switching to "Overdue" narrows the rows to overdue invoices
 *   - Clicking a row opens the PeekPanel with the detail body
 *   - The PeekPanel close button collapses the panel
 *   - Bulk-action Delete on a selected row shows the UndoToast
 *   - Clicking Undo restores the original status
 *
 * Why a dedicated spec: the 10.5 W2 surface is a new route, distinct
 * from any of the 10.4 list surfaces. The pattern is the same (data
 * table + saved views + peek + bulk + undo), so the spec stays short
 * — most of the heavy lifting is in the existing primitives' unit
 * tests. This spec verifies the *glue*: that the route actually
 * renders, the saved-views menu is wired to the filter, and the bulk
 * action + undo cycle goes through.
 */
import { test, expect } from "@playwright/test";
import { authedPage, waitForHydration } from "./_helpers";

test.describe("triage inbox — cross-feature work queue", () => {
  test("default view, switch to Overdue, peek, bulk delete, undo", async ({
    browser,
    request,
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      const response = await page.goto("/app/triage-inbox");
      expect(response, "triage-inbox route should respond").not.toBeNull();
      const status = response!.status();
      expect([200, 304]).toContain(status);

      await waitForHydration(page);
      // Page wrapper + H1 visible
      await expect(page.getByTestId("triage-inbox-page")).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 1, name: /Triage inbox/i }),
      ).toBeVisible();

      // The default seeded view's first row should be the "My queue" set
      // — owner "me", status open. The fixture's inv-1042-overdue is
      // status=open / assignee=me, so it must be present.
      await expect(
        page.getByTestId("data-table-row-inv-1042-overdue"),
      ).toBeVisible();
      // The unassigned inv-1051-due-soon is NOT in "My queue".
      await expect(
        page.getByTestId("data-table-row-inv-1051-due-soon"),
      ).toHaveCount(0);

      // Switch to "Overdue" via the SavedViews menu.
      await page.getByTestId("saved-views-trigger").click();
      // The Overdue saved-view-load button has the literal label "Overdue".
      await page.getByRole("option", { name: "Overdue" }).click();

      // The Overdue filter matches source=invoice + status=open +
      // query="overdue" (substring). inv-1042-overdue satisfies all
      // three; inv-1051-due-soon does not. The tax-gate row is
      // source=tax-gate so it is excluded.
      await expect(
        page.getByTestId("data-table-row-inv-1042-overdue"),
      ).toBeVisible();
      await expect(
        page.getByTestId("data-table-row-tg-2026-q1-vat"),
      ).toHaveCount(0);

      // Reset to My queue so the bulk-action test has > 1 row to
      // choose from. Use the explicit reset button so the test
      // does not depend on saved-view ordering.
      await page.getByTestId("triage-inbox-reset-view").click();

      // Open the PeekPanel by clicking the overdue invoice row.
      await page.getByTestId("data-table-row-inv-1042-overdue").click();
      await expect(page.getByTestId("triage-inbox-peek")).toBeVisible();
      // The detail body shows the customer name.
      await expect(page.getByTestId("triage-inbox-peek")).toContainText(
        /Acme Logistics/,
      );
      // Close the PeekPanel.
      await page.getByTestId("peek-panel-close").click();
      await expect(page.getByTestId("triage-inbox-peek")).toHaveCount(0);

      // Select 1 row, then click Delete in the BulkActionBar.
      await page
        .getByTestId("data-table-row-select-inv-1042-overdue")
        .check();
      await expect(page.getByTestId("bulk-action-bar")).toBeVisible();
      await expect(page.getByTestId("bulk-action-bar")).toHaveAttribute(
        "data-count",
        "1",
      );
      await page.getByTestId("bulk-action-delete").click();
      // Undo toast appears.
      await expect(page.getByTestId("undo-toast")).toBeVisible();

      // Status flips to "resolved".
      await expect(
        page.getByTestId("triage-inbox-status-inv-1042-overdue"),
      ).toContainText(/resolved/i);

      // Click Undo — status returns to open.
      await page.getByTestId("undo-toast-action").click();
      await expect(
        page.getByTestId("triage-inbox-status-inv-1042-overdue"),
      ).toContainText(/open/i);
    } finally {
      await page.context().close();
    }
  });
});
