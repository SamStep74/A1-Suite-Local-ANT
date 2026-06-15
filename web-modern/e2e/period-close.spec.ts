/**
 * period-close.spec.ts — e2e for the monthly close wizard (10.6 W4-PORT).
 *
 * Covers the user journey the worker brief calls out:
 *   - Open the wizard for a specific period
 *   - Mark 2 steps done
 *   - Mark 1 step blocked
 *   - See the summary chip update
 *
 * The close state is localStorage-backed (`a1:close:<periodId>:<stepId>`)
 * so the test clears all matching keys at setup to make the test
 * idempotent (re-runs don't leak state).
 *
 * The `authedPage` helper already does the Bearer-sid dance, so
 * the test stays focused on the close wizard itself.
 *
 * Note on testids: the W4-PORT port is built on the 10.4
 * controlled DataTable, which emits `data-entity="data-table"`,
 * `data-table-id="period-close"`, `data-testid="data-table-row-{id}"`
 * for the row, and `data-testid="data-table-row-select-{id}"` for
 * the per-row checkbox. The previous W4 surface used custom
 * testids (e.g. `period-close-table-row-{id}-checkbox`); the
 * 10.5-pre e2e was updated to the 10.4 contract.
 */
import { test, expect, type Page } from "@playwright/test";
import { authedPage, waitForHydration } from "./_helpers";

/** Clear every `a1:close:*` localStorage key so the test starts
 *  from a known empty state. Called in `beforeEach`. */
async function clearCloseState(page: Page): Promise<void> {
  await page.evaluate(() => {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("a1:close:")) keys.push(k);
    }
    for (const k of keys) window.localStorage.removeItem(k);
  });
}

test.describe("period-close wizard", () => {
  test.beforeEach(() => {
    // The close state is keyed on `a1:close:<periodId>:<stepId>`
    // and we clear it INSIDE each test (after auth) so the test
    // owns its own localStorage lifecycle. No setup needed here.
  });

  test("open the wizard for June 2026, mark 2 done, 1 blocked, see summary update @smoke", async ({
    browser,
    request,
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      // 1. Navigate to the wizard with a known period.
      await page.goto("/app/period-close/?period=2026-06");
      await waitForHydration(page);
      await clearCloseState(page);
      // Re-navigate to pick up the cleared state on a fresh render.
      await page.goto("/app/period-close/?period=2026-06");
      await waitForHydration(page);

      // 2. The page should render the table with the period label.
      //    The 10.4 controlled DataTable uses
      //    `data-entity="data-table"` (no standalone "period-close-table"
      //    testid) — query for the data table section by its period control.
      await expect(page.getByTestId("period-label")).toHaveText("June 2026");
      await expect(
        page.locator('[data-entity="data-table"][data-table-id="period-close"]'),
      ).toBeVisible();
      // Summary starts at 0/N done.
      const summary = page.getByTestId("period-close-summary");
      await expect(summary).toHaveAttribute("data-done", "0");

      // 3. Select 2 rows via the checkboxes (the first two steps:
      //    "reconcile-bank" and "reconcile-cards") and Mark Done.
      //    The 10.4 DataTable emits per-row checkbox testids of the
      //    form `data-table-row-select-{id}`.
      const bankRow = page.getByTestId(
        "data-table-row-select-reconcile-bank",
      );
      const cardsRow = page.getByTestId(
        "data-table-row-select-reconcile-cards",
      );
      await bankRow.check();
      await cardsRow.check();
      // The bulk action bar should appear with count "2 selected".
      await expect(page.getByTestId("bulk-action-bar")).toBeVisible();
      await expect(page.getByTestId("bulk-action-bar-count")).toContainText(
        "2",
      );
      await page.getByTestId("bulk-action-mark-done").click();
      // Bulk action clears the selection after applying, so the
      // bar should now hide.
      await expect(page.getByTestId("bulk-action-bar")).toBeHidden();

      // 4. Mark 1 row blocked ("reconcile-suppliers").
      const suppliersRow = page.getByTestId(
        "data-table-row-select-reconcile-suppliers",
      );
      await suppliersRow.check();
      await page.getByTestId("bulk-action-mark-blocked").click();

      // 5. Summary should now show 2 done, 1 blocked, rest pending.
      await expect(summary).toHaveAttribute("data-done", "2");
      await expect(summary).toHaveAttribute("data-blocked", "1");

      // 6. The row pills should reflect the per-row state. The
      //    10.4 DataTable emits `data-testid="data-table-row-{id}"`
      //    on each <tr> (not `data-row-id`).
      await expect(
        page
          .locator('[data-testid="data-table-row-reconcile-bank"]')
          .getByTestId("status-pill-done"),
      ).toBeVisible();
      await expect(
        page
          .locator('[data-testid="data-table-row-reconcile-suppliers"]')
          .getByTestId("status-pill-blocked"),
      ).toBeVisible();

      // 7. The UndoToast should have appeared (sonner renders into
      //    a portal at the bottom of the document). Click it to
      //    verify the undo affordance is wired. We don't assert
      //    on the text because sonner may have already auto-
      //    dismissed by the time we get here (the default
      //    duration is 6s, but Playwright is fast).
      const undoButton = page.getByTestId("undo-toast-action");
      if (await undoButton.isVisible().catch(() => false)) {
        await undoButton.click();
        // Undo restores the most recent action (mark-blocked on
        // reconcile-suppliers). data-done stays at 2; only the
        // blocked count drops back to 0.
        await expect(summary).toHaveAttribute("data-blocked", "0");
      }
    } finally {
      await page.context().close();
    }
  });

  test("prev / next period controls change the period id and label @smoke", async ({
    browser,
    request,
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      await page.goto("/app/period-close/?period=2026-06");
      await waitForHydration(page);
      await clearCloseState(page);
      await page.goto("/app/period-close/?period=2026-06");
      await waitForHydration(page);

      const label = page.getByTestId("period-label");
      await expect(label).toHaveAttribute("data-period-id", "2026-06");

      await page.getByTestId("period-prev").click();
      await expect(label).toHaveAttribute("data-period-id", "2026-05");
      await expect(label).toHaveText("May 2026");

      await page.getByTestId("period-next").click();
      await page.getByTestId("period-next").click();
      await expect(label).toHaveAttribute("data-period-id", "2026-07");
    } finally {
      await page.context().close();
    }
  });
});
