/**
 * fiscal-gates.spec.ts — Phase 10.5 W1 e2e coverage for the
 * /app/fiscal-gates triage workspace.
 *
 * The route is authed (it lives under /app/), so we follow the
 * `authedPage()` pattern from `_helpers.ts`. If the Fastify
 * backend isn't reachable (developer running only the SPA), the
 * suite skips just like `i18n-canary.spec.ts` does.
 *
 * The test exercises the W1 acceptance flow:
 *   1. Open /app/fiscal-gates
 *   2. Assert the "Fiscal gates" h1 and the current-period chip
 *   3. Switch to the "All overdue" saved view (3rd default view)
 *   4. Select the first row's checkbox
 *   5. Click "Mark filed" in the bulk bar
 *   6. Assert the UndoToast appears
 *   7. Click Undo
 *   8. Assert the row returns to "Pending" / "Overdue" (NOT "Filed")
 */
import { test, expect, type Page } from "@playwright/test";
import { authedPage } from "./_helpers";

/** Navigate to the fiscal-gates workspace. Waits for the page
 *  header to render so subsequent assertions are stable. */
async function gotoFiscalGates(page: Page): Promise<void> {
  const response = await page.goto("/app/fiscal-gates/?lang=hy");
  expect(response, "expected /app/fiscal-gates/ to respond").not.toBeNull();
  expect([200, 304]).toContain(response!.status());
  await expect(page.getByTestId("fiscal-gates-page")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: "Fiscal gates" })).toBeVisible({
    timeout: 5_000,
  });
}

test.describe("fiscal-gates — Phase 10.5 W1 surface", () => {
  test.beforeEach(async ({ request }, testInfo) => {
    const probe = await request
      .get("http://localhost:4100/api/health", { timeout: 2_000 })
      .catch(() => null);
    testInfo.skip(
      !probe || !probe.ok(),
      "Fastify backend not reachable on :4100 — skipping authed canary render (CI runs with START_FASTIFY=1).",
    );
  });

  test("renders the page header + current period chip + 10 seeded rows", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await gotoFiscalGates(page);
      const period = page.getByTestId("fiscal-gates-current-period");
      await expect(period).toBeVisible();
      await expect(period).toContainText(/Current period/);
      await expect(period).toContainText(/20\d{2}-\d{2}/);
      // 10 seeded gates (default pageSize=25 → all on one page)
      const rows = page.locator('[data-testid^="data-table-row-"]');
      await expect(rows).toHaveCount(10, { timeout: 10_000 });
    } finally {
      await context.close();
    }
  });

  test("switching to the 'All overdue' view + Mark filed + Undo reverts the row", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await gotoFiscalGates(page);

      // Open the SavedViews menu and pick the 3rd entry (All overdue).
      // The seed registers exactly 3 default views; the 3rd is the
      // "All overdue" view per DEFAULT_TRIAGE_VIEWS order in
      // lib/fiscal/gates.ts. (SavedView name keys are
      // `fiscal.view.current`, `fiscal.view.all-overdue`, and
      // `fiscal.view.awaiting-customer` — but the menu renders the
      // human label, so we click by index to be label-agnostic.)
      await page.getByTestId("saved-views-trigger").click();
      const menu = page.getByTestId("saved-views-menu");
      await expect(menu).toBeVisible();
      const viewButtons = menu.getByRole("option");
      const optionCount = await viewButtons.count();
      expect(optionCount).toBe(3);
      // index 2 = "All overdue" (the 3rd default view)
      await viewButtons.nth(2).click();
      await expect(menu).toBeHidden();

      // Wait for the table to repaint with the new view.
      // We don't know how many gates are "overdue" for the current
      // period (depends on `now` vs the period), so just wait for
      // at least one row OR the empty state to settle.
      await page.waitForTimeout(200);

      // Select the first visible row's checkbox
      const firstRow = page.locator('[data-testid^="data-table-row-"]').first();
      await expect(firstRow).toBeVisible();
      const firstRowId = await firstRow.getAttribute("data-testid");
      expect(firstRowId).not.toBeNull();
      // The DataTable renders a separate checkbox inside the row
      // with id `data-table-row-select-<id>`.
      const selectId = firstRowId!.replace("data-table-row-", "");
      const checkbox = page.getByTestId(`data-table-row-select-${selectId}`);
      await checkbox.click();

      // Bulk bar should mount with count=1
      const bar = page.getByTestId("fiscal-gates-bulk-bar");
      await expect(bar).toBeVisible();
      await expect(bar).toHaveAttribute("data-count", "1");

      // Click "Mark filed"
      await page.getByTestId("fiscal-gates-bulk-mark_filed").click();

      // UndoToast should appear
      const undo = page.getByTestId("undo-toast");
      await expect(undo).toBeVisible({ timeout: 5_000 });
      await expect(undo).toContainText(/Marked/);

      // Click Undo
      await page.getByTestId("undo-toast-action").click();

      // Undo should disappear
      await expect(undo).toBeHidden({ timeout: 5_000 });

      // The row that was "Mark filed" should now be back to its
      // prior status. We assert the row's text does NOT contain
      // "Filed" anymore.
      const revertedRow = page.getByTestId(firstRowId!);
      const rowText = (await revertedRow.textContent()) ?? "";
      // The status badge would render "Filed" — make sure it
      // doesn't. (Some other fields like "filed by" would also
      // match, but the lib doesn't add any, so this is safe.)
      expect(rowText).not.toMatch(/Filed/);
    } finally {
      await context.close();
    }
  });
});
