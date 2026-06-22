/**
 * shared-components-canary.spec.ts — Phase 10.4 e2e coverage for the
 * five shared list primitives on the analytics Receivables tab.
 *
 * This is the *canary contract* for the 10.4 worker: every list
 * surface in the web-modern SPA should compose the same five
 * primitives, so a single smoke run on the new analytics table
 * proves the wiring works for every future consumer.
 *
 *   - DataTable     → rows render with `data-testid=data-table-row-<id>`
 *   - SavedViews    → toolbar slot mounts a trigger button
 *   - BulkActionBar → appears only when at least 1 row is selected
 *   - PeekPanel     → row click opens the right-anchored drawer
 *
 * Auth: /app/analytics needs a session. We follow the `authedPage()`
 * pattern from `_helpers.ts`. If the Fastify backend isn't reachable
 * (developer running only the SPA), the suite skips just like
 * `spa-mode.spec.ts` does.
 */
import { test, expect, type Page } from "@playwright/test";
import { authenticatePage, authedPage, FASTIFY_URL } from "./_helpers";

/** Navigate to the Receivables tab; waits for the data table to
 *  render so the row count is stable before each assertion. */
async function gotoReceivables(page: Page): Promise<void> {
  const response = await page.goto("/app/analytics/?view=receivables&lang=hy");
  expect(response, "expected /app/analytics/ to respond").not.toBeNull();
  expect([200, 304]).toContain(response!.status());
  // Wait for the table to mount — at least one row OR the empty
  // state should be visible.
  await expect(page.locator('[data-testid^="data-table-row-"]').first())
    .toBeVisible({ timeout: 10_000 })
    .catch(async () => {
      await expect(page.getByText("No buckets in this period")).toBeVisible({
        timeout: 1_000,
      });
    });
}

test.describe("shared-components canary — analytics Receivables tab (10.4)", () => {
  test.beforeEach(async ({ request }, testInfo) => {
    const probe = await request
      .get(`${FASTIFY_URL}/api/health`, { timeout: 2_000 })
      .catch(() => null);
    testInfo.skip(
      !probe || !probe.ok(),
      `Fastify backend not reachable at ${FASTIFY_URL} — skipping authed canary render (CI runs with START_FASTIFY=1).`,
    );
  });

  test("DataTable + SavedViews mount on the Receivables tab @smoke", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await gotoReceivables(page);
      // SavedViews injects its trigger into the DataTable toolbar slot.
      await expect(page.getByTestId("saved-views-trigger")).toBeVisible();
      // The page-summary footer is part of DataTable's built-in chrome.
      await expect(page.getByTestId("data-table-page-summary")).toBeVisible();
      // At least one row should be present for the seeded AR buckets.
      const rowCount = await page
        .locator('[data-testid^="data-table-row-"]')
        .count();
      expect(rowCount).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  test("selecting a row reveals the BulkActionBar", async ({
    page,
    request,
  }) => {
    await authenticatePage(page, request);
    await gotoReceivables(page);
    // BulkActionBar must NOT be present before selection.
    await expect(page.getByTestId("bulk-action-bar")).toHaveCount(0);
    // Click the first row's checkbox.
    const firstRowSelect = page
      .locator('[data-testid^="data-table-row-select-"]')
      .first();
    await firstRowSelect.evaluate((el: HTMLInputElement) => el.click());
    // Now BulkActionBar should mount with a count of 1.
    const bar = page.getByTestId("bulk-action-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("data-count", "1");
    // The default actions (delete / export / tag) should be present.
    await expect(page.getByTestId("bulk-action-delete")).toBeVisible();
    await expect(page.getByTestId("bulk-action-export")).toBeVisible();
    await expect(page.getByTestId("bulk-action-tag")).toBeVisible();
  });

  test("clicking a row body opens the PeekPanel; the X button closes it", async ({
    page,
    request,
  }) => {
    await authenticatePage(page, request);
    await gotoReceivables(page);
    // Click the first row (any cell that isn't the checkbox).
    const firstRow = page
      .locator('[data-testid^="data-table-row-"]')
      .first();
    await firstRow.evaluate((el: HTMLElement) => el.click());
    // PeekPanel mounts inside a native <dialog> with this testid.
    const panel = page.locator('[data-testid="peek-panel"][open]');
    await expect(panel).toBeVisible();
    // The close button has data-testid="peek-panel-close".
    await panel.getByTestId("peek-panel-close").evaluate((el: HTMLElement) => el.click());
    await expect
      .poll(() =>
        page.evaluate(
          () => document.querySelectorAll('dialog[data-testid="peek-panel"][open]').length,
        ),
      )
      .toBe(0);
  });
});
