/**
 * triage-inbox.spec.ts — Phase 10.5 W2 cross-feature work queue e2e
 * + Phase 10.7 e2e coverage expansion.
 *
 * Asserts the inbox surface end-to-end against the live Vite dev
 * server. The feed is a typed fixture (lib/triage/feed.ts), so this
 * spec is independent of Fastify: no `route.intercept` mocking.
 *
 * Phase 10.5 smoke (one test, retained verbatim):
 *   - GET /app/triage-inbox returns 2xx and the H1 "Triage inbox" paints
 *   - The default view is "My queue" (the first seed)
 *   - Switching to "Overdue" narrows the rows to overdue invoices
 *   - Clicking a row opens the PeekPanel with the detail body
 *   - The PeekPanel close button collapses the panel
 *   - Bulk-action Delete on a selected row shows the UndoToast
 *   - Clicking Undo restores the original status
 *
 * Phase 10.7 expansion (three additional tests):
 *   - PeekPanel: clicking a row opens the right-side panel without
 *     navigating away, renders the email-style body, and exposes a
 *     Close button that collapses it.
 *   - Saved views: switching between the three seeded default views
 *     (My queue / Overdue / Awaiting customer) changes the visible
 *     row count accordingly.
 *   - Bulk resolve: selecting two rows and clicking Delete in the
 *     BulkActionBar transitions BOTH rows to "resolved" status and
 *     the UndoToast catches the change; clicking Undo reverts both.
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
import { waitForHydration } from "./_helpers";
import {
  authedTriagePage,
  gotoTriageInbox,
} from "./_triage-helpers";

test.describe("triage inbox — cross-feature work queue", () => {
  test("default view, switch to Overdue, peek, bulk delete, undo", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedTriagePage(browser, request);
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
      // Close the PeekPanel. The data-testid="peek-panel-close"
      // appears in BOTH the inbox PeekPanel and the global Keyboard
      // shortcuts dialog, so a flat getByTestId collides in strict
      // mode. Scope to the OPEN peek dialog via its data-open
      // attribute (the cheatsheet's dialog is data-open="false").
      await page
        .locator('[data-testid="peek-panel"][data-open="true"]')
        .getByTestId("peek-panel-close")
        .click();
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
      await context.close();
    }
  });
});

test.describe("triage inbox — Phase 10.7 e2e coverage expansion", () => {
  test.beforeEach(async ({ request }, testInfo) => {
    const probe = await request
      .get("http://localhost:4100/api/health", { timeout: 2_000 })
      .catch(() => null);
    testInfo.skip(
      !probe || !probe.ok(),
      "Fastify backend not reachable on :4100 — skipping authed canary render (CI runs with START_FASTIFY=1).",
    );
  });

  test("peek panel: clicking a row opens the right-side preview without navigating away", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedTriagePage(browser, request);
    try {
      await gotoTriageInbox(page);

      // The URL must stay on the inbox route — peek is a side drawer,
      // not a navigation. Capture the URL before the click so we can
      // compare after.
      const urlBefore = page.url();

      // Click the overdue invoice row to open the PeekPanel.
      const row = page.getByTestId("data-table-row-inv-1042-overdue");
      await expect(row).toBeVisible();
      await row.click();

      // The native <dialog> wrapper (peek-panel) is mounted, the
      // route's renderContent wrapper (triage-inbox-peek) is also
      // visible, and the URL is unchanged.
      //
      // The `data-testid="peek-panel"` is shared with the global
      // Keyboard shortcuts dialog (which is permanently mounted but
      // `data-open="false"`). Filter to the open panel via
      // `data-open="true"` to avoid the strict-mode collision.
      const openPeekPanel = page.locator(
        '[data-testid="peek-panel"][data-open="true"]',
      );
      await expect(openPeekPanel).toBeVisible();
      await expect(page.getByTestId("triage-inbox-peek")).toBeVisible();
      expect(page.url()).toBe(urlBefore);

      // The peek body shows the source label, subtitle (which
      // contains the customer name), and the JSON payload dump.
      const peek = page.getByTestId("triage-inbox-peek");
      await expect(peek).toContainText(/Acme Logistics/);
      await expect(peek).toContainText(/invoice/);
      await expect(peek).toContainText(/open/);
      // The payload JSON is rendered in a <pre> with the
      // invoiceId key, so the user can see the deep-link data
      // without leaving the inbox.
      await expect(peek).toContainText(/invoiceId/);

      // The PeekPanel exposes a Close button. Clicking it should
      // collapse the panel back to the inbox-only state. Scope
      // the close button to the OPEN peek panel via data-open —
      // the bare data-testid="peek-panel-close" collides with
      // the global Keyboard shortcuts dialog's close button.
      const closeBtn = page
        .locator('[data-testid="peek-panel"][data-open="true"]')
        .getByTestId("peek-panel-close");
      await expect(closeBtn).toBeVisible();
      await closeBtn.click();
      await expect(page.getByTestId("triage-inbox-peek")).toHaveCount(0);
      // The row is still in the table (we did not delete it).
      await expect(row).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("saved views: switching between default views changes the visible row count", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedTriagePage(browser, request);
    try {
      await gotoTriageInbox(page);

      // The default view is "My queue" (status=open, assignee=me).
      // We expect 4+ rows here — the fixture has inv-1042-overdue,
      // tg-2026-q1-vat, ap-22-quote-approval, po-gr-557 (all
      // open + assignee=me). Assert that the set is non-empty and
      // contains the expected id.
      const allRows = page.locator('[data-testid^="data-table-row-"]');
      const myQueueCount = await allRows.count();
      expect(myQueueCount).toBeGreaterThan(0);
      await expect(
        page.getByTestId("data-table-row-inv-1042-overdue"),
      ).toBeVisible();
      // Unassigned open rows (inv-1051-due-soon, cr-thread-118) are
      // excluded from "My queue" but exist in the fixture, so they
      // should NOT be visible.
      await expect(
        page.getByTestId("data-table-row-inv-1051-due-soon"),
      ).toHaveCount(0);

      // Helper: open the SavedViews menu, click the option with
      // the given literal label, then wait for the menu to close
      // and the table to repaint.
      const switchView = async (label: string): Promise<void> => {
        await page.getByTestId("saved-views-trigger").click();
        const menu = page.getByTestId("saved-views-menu");
        await expect(menu).toBeVisible();
        await page.getByRole("option", { name: label }).click();
        await expect(menu).toBeHidden();
        // Let the table repaint; the saved-view filter is decoded
        // synchronously, but DOM mutation is microtask-delayed.
        await page.waitForTimeout(100);
      };

      // Switch to "Overdue" — narrower filter (source=invoice,
      // query="overdue"). Expect a strictly smaller count.
      await switchView("Overdue");
      const overdueCount = await page
        .locator('[data-testid^="data-table-row-"]')
        .count();
      expect(overdueCount).toBeGreaterThan(0);
      expect(overdueCount).toBeLessThan(myQueueCount);
      await expect(
        page.getByTestId("data-table-row-inv-1042-overdue"),
      ).toBeVisible();
      // Tax-gate rows are NOT in "Overdue" (source mismatch).
      await expect(
        page.getByTestId("data-table-row-tg-2026-q1-vat"),
      ).toHaveCount(0);

      // Switch to "Awaiting customer" — status=open, source
      // in [customer-reply, approval]. The fixture has
      // ap-22-quote-approval and cr-thread-118 that match.
      await switchView("Awaiting customer");
      const awaitingCount = await page
        .locator('[data-testid^="data-table-row-"]')
        .count();
      expect(awaitingCount).toBeGreaterThan(0);
      // The overdue invoice row is NOT in this view.
      await expect(
        page.getByTestId("data-table-row-inv-1042-overdue"),
      ).toHaveCount(0);
      // At least one of the two source-matched rows should be visible.
      const awaitingVisible =
        (await page.getByTestId("data-table-row-ap-22-quote-approval").count()) +
        (await page.getByTestId("data-table-row-cr-thread-118").count());
      expect(awaitingVisible).toBeGreaterThan(0);

      // Reset to "My queue" so we leave the test in the same
      // state every other test starts from.
      await page.getByTestId("triage-inbox-reset-view").click();
      await page.waitForTimeout(100);
      const afterResetCount = await page
        .locator('[data-testid^="data-table-row-"]')
        .count();
      expect(afterResetCount).toBe(myQueueCount);
    } finally {
      await context.close();
    }
  });

  test("bulk resolve: selecting 2 rows and clicking Delete resolves both; Undo reverts both", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedTriagePage(browser, request);
    try {
      await gotoTriageInbox(page);

      // Pick two rows in "My queue": the overdue invoice and the
      // Q1 VAT tax gate. Both are status=open, assignee=me, so
      // both are visible in the default view.
      const id1 = "inv-1042-overdue";
      const id2 = "tg-2026-q1-vat";
      const row1 = page.getByTestId(`data-table-row-${id1}`);
      const row2 = page.getByTestId(`data-table-row-${id2}`);
      await expect(row1).toBeVisible();
      await expect(row2).toBeVisible();

      // Select both via the row checkboxes.
      await page.getByTestId(`data-table-row-select-${id1}`).check();
      await page.getByTestId(`data-table-row-select-${id2}`).check();

      // The bulk bar mounts with count=2.
      const bar = page.getByTestId("bulk-action-bar");
      await expect(bar).toBeVisible();
      await expect(bar).toHaveAttribute("data-count", "2");
      // The count text reads "2 selected" (Lingui macro).
      await expect(page.getByTestId("bulk-action-bar-count")).toContainText(
        /2.*selected/,
      );

      // Click Delete in the BulkActionBar. The triage-inbox maps
      // the delete action to a "resolved" status transition
      // (see routes/app/triage-inbox/index.tsx handleBulkAction),
      // so the visible effect is both rows flipping to "resolved".
      await page.getByTestId("bulk-action-delete").click();

      // UndoToast appears with the "Marked N items as resolved"
      // message. The route passes ids.length to the message
      // interpolator, so the toast text contains "2".
      const undo = page.getByTestId("undo-toast");
      await expect(undo).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId("undo-toast-message")).toContainText(/2/);

      // Both rows now have status=resolved.
      await expect(
        page.getByTestId(`triage-inbox-status-${id1}`),
      ).toContainText(/resolved/i);
      await expect(
        page.getByTestId(`triage-inbox-status-${id2}`),
      ).toContainText(/resolved/i);

      // Click Undo. Both rows must revert to their pre-delete
      // status. Both were status=open in the fixture.
      await page.getByTestId("undo-toast-action").click();
      await expect(undo).toBeHidden({ timeout: 5_000 });
      await expect(
        page.getByTestId(`triage-inbox-status-${id1}`),
      ).toContainText(/open/i);
      await expect(
        page.getByTestId(`triage-inbox-status-${id2}`),
      ).toContainText(/open/i);
    } finally {
      await context.close();
    }
  });
});
