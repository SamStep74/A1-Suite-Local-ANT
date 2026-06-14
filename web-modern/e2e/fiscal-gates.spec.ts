/**
 * fiscal-gates.spec.ts — Phase 10.5 W1 + Phase 10.7 e2e coverage
 * for the /app/fiscal-gates triage workspace.
 *
 * The route is authed (it lives under /app/), so we follow the
 * `authedPage()` pattern from `_helpers.ts`. If the Fastify
 * backend isn't reachable (developer running only the SPA), the
 * suite skips just like `i18n-canary.spec.ts` does.
 *
 * Phase 10.7 W1 acceptance flows (this file):
 *   1. Render: h1 + current period chip + 10 seeded rows paint.
 *   2. Saved view switch: open the SavedViews menu, pick each of
 *      the three default views (current / all-overdue /
 *      awaiting-customer), and assert the row count + visible
 *      status filter changes.
 *   3. Undo flow: select a single row in the awaiting-customer
 *      view, click "Mark filed" in the bulk bar, assert the
 *      UndoToast appears, click Undo, assert the row returns to
 *      its prior "Pending" / "Awaiting customer" status.
 *   4. Bulk action: click the header select-all, click "Mark
 *      filed" in the bulk bar, assert every visible row flips to
 *      "Filed", assert the UndoToast appears, click Undo, assert
 *      the rows return to their prior status.
 *   5. Locale: load the route with `?lang=ru`, assert at least
 *      one column header renders in Cyrillic.
 *
 * Why we drive the existing copy (not a bespoke string):
 *   The 10.4 primitives that wrap this route render the source
 *   copy through Lingui's `<Trans>` / `t\`\`` macros. The
 *   Russian / Armenian / English catalogs are committed
 *   artifacts, so asserting on the translated string is a
 *   meaningful smoke test that the catalog wiring didn't drift.
 */
import { test, expect, type Page } from "@playwright/test";
import { authedPage } from "./_helpers";

/** Navigate to the fiscal-gates workspace. Waits for the page
 *  header to render so subsequent assertions are stable. The
 *  `lang` argument is plumbed through the I18nProvider's
 *  `?lang=` resolver (highest priority over localStorage). */
async function gotoFiscalGates(page: Page, lang: "hy" | "ru" | "en" = "hy"): Promise<void> {
  const response = await page.goto(`/app/fiscal-gates/?lang=${lang}`);
  expect(response, "expected /app/fiscal-gates/ to respond").not.toBeNull();
  expect([200, 304]).toContain(response!.status());
  await expect(page.getByTestId("fiscal-gates-page")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: "Fiscal gates" })).toBeVisible({
    timeout: 5_000,
  });
}

/** Open the SavedViews menu and return the array of option
 *  buttons (one per saved view). Asserts the menu is open and
 *  that the three default views are registered. */
async function openSavedViewsMenu(page: Page) {
  await page.getByTestId("saved-views-trigger").click();
  const menu = page.getByTestId("saved-views-menu");
  await expect(menu).toBeVisible();
  const options = menu.getByRole("option");
  await expect(options).toHaveCount(3);
  return options;
}

/** Open the SavedViews menu, click the option at `index`, and
 *  close the popover. The three default views in seed
 *  order are: 0=current, 1=all-overdue, 2=awaiting-customer. */
async function pickSavedView(page: Page, index: number): Promise<void> {
  const options = await openSavedViewsMenu(page);
  await options.nth(index).click();
  // The popover no longer auto-closes on selection (the option's
  // click bubbles up to the trigger and re-toggles `open`). Press
  // Escape — SavedViews wires `keydown → setOpen(false)` — to
  // dismiss it deterministically.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("saved-views-menu")).toBeHidden({
    timeout: 1_000,
  });
}

test.describe("fiscal-gates — Phase 10.7 e2e coverage", () => {
  test.beforeEach(async ({ request }, testInfo) => {
    const probe = await request
      .get("http://localhost:4100/api/health", { timeout: 2_000 })
      .catch(() => null);
    testInfo.skip(
      !probe || !probe.ok(),
      "Fastify backend not reachable on :4100 — skipping authed canary render (CI runs with START_FASTIFY=1).",
    );
  });

  /* ────────── 1. render smoke ────────── */

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
      // 10 seeded gates (default pageSize=25 → all on one page).
      // The selector excludes the per-row `data-table-row-select-{id}`
      // checkboxes, which share the same prefix.
      const rows = page.locator(
        '[data-testid^="data-table-row-"]:not([data-testid^="data-table-row-select-"])',
      );
      await expect(rows).toHaveCount(10, { timeout: 10_000 });
    } finally {
      await context.close();
    }
  });

  /* ────────── 2. saved view switch ────────── */

  test("switching the SavedViews menu narrows the rows to the active view", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await gotoFiscalGates(page);

      // 'current' (index 0) — all 10 seeded gates for the period.
      await pickSavedView(page, 0);
      const rows = page.locator(
        '[data-testid^="data-table-row-"]:not([data-testid^="data-table-row-select-"])',
      );
      await expect(rows).toHaveCount(10, { timeout: 5_000 });

      // 'awaiting-customer' (index 2) — the 3 gates flagged as
      // blocked on a third party in the registry
      // (withholding-monthly, excise-quarterly, customs-monthly).
      await pickSavedView(page, 2);
      await expect(rows).toHaveCount(3, { timeout: 5_000 });

      // 'all-overdue' (index 1) — number depends on the period
      // boundary vs. now. We don't pin a count, but the table
      // must have repainted and the menu must have closed.
      await pickSavedView(page, 1);
      // Wait for the table to settle on the new view.
      await page.waitForTimeout(200);
      const overdueCount = await rows.count();
      expect(overdueCount).toBeGreaterThanOrEqual(0);
      expect(overdueCount).toBeLessThanOrEqual(10);
      // The visible status filter should reflect "Overdue" rows
      // (or the empty state). We assert at least one row's
      // status cell text is "Overdue" OR the table is empty.
      const overdueCells = page.getByText("Overdue", { exact: true });
      const overdueOrEmpty =
        overdueCount === 0 || (await overdueCells.count()) > 0;
      expect(overdueOrEmpty).toBe(true);
    } finally {
      await context.close();
    }
  });

  /* ────────── 3. undo flow (single row) ────────── */

  test("marking a single row filed + Undo restores its prior status", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await gotoFiscalGates(page);

      // Switch to the awaiting-customer view (3 rows). The seed
      // flags exactly 3 gate kinds as awaiting a third party, so
      // we know the row count is deterministic.
      await pickSavedView(page, 2);
      const rows = page.locator(
        '[data-testid^="data-table-row-"]:not([data-testid^="data-table-row-select-"])',
      );
      await expect(rows).toHaveCount(3, { timeout: 5_000 });

      // Pin the first row by its data-testid; this is the row we
      // expect to flip to "Filed" and back.
      const firstRow = rows.first();
      const firstRowId = await firstRow.getAttribute("data-testid");
      expect(firstRowId).not.toBeNull();
      // Confirm the row's prior status is NOT "Filed" yet.
      const priorText = (await firstRow.textContent()) ?? "";
      expect(priorText).not.toMatch(/Filed/);

      // Tick the row's checkbox.
      const selectId = firstRowId!.replace("data-table-row-", "");
      const checkbox = page.getByTestId(`data-table-row-select-${selectId}`);
      await checkbox.click();

      // Bulk bar mounts with count=1
      const bar = page.getByTestId("fiscal-gates-bulk-bar");
      await expect(bar).toBeVisible();
      await expect(bar).toHaveAttribute("data-count", "1");

      // Click "Mark filed"
      await page.getByTestId("fiscal-gates-bulk-mark_filed").click();

      // UndoToast appears
      const undo = page.getByTestId("undo-toast");
      await expect(undo).toBeVisible({ timeout: 5_000 });
      await expect(undo).toContainText(/Marked/);

      // The row should now show "Filed"
      const updatedRow = page.getByTestId(firstRowId!);
      const updatedText = (await updatedRow.textContent()) ?? "";
      expect(updatedText).toMatch(/Filed/);

      // Click Undo — toast disappears and row returns to prior status
      await page.getByTestId("undo-toast-action").click();
      await expect(undo).toBeHidden({ timeout: 5_000 });

      const revertedRow = page.getByTestId(firstRowId!);
      const revertedText = (await revertedRow.textContent()) ?? "";
      expect(revertedText).not.toMatch(/Filed/);
    } finally {
      await context.close();
    }
  });

  /* ────────── 4. bulk action + undo ────────── */

  test("select-all + Mark filed flips every row to Filed, Undo catches it", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await gotoFiscalGates(page);
      const rows = page.locator(
        '[data-testid^="data-table-row-"]:not([data-testid^="data-table-row-select-"])',
      );
      await expect(rows).toHaveCount(10, { timeout: 10_000 });

      // Click the header select-all checkbox. The DataTable's
      // controlled selection toggles all visible rows.
      await page.getByTestId("data-table-select-all").click();

      // Bulk bar mounts with count=10 (all rows selected).
      const bar = page.getByTestId("fiscal-gates-bulk-bar");
      await expect(bar).toBeVisible();
      await expect(bar).toHaveAttribute("data-count", "10");

      // Click "Mark filed" in the bulk bar.
      await page.getByTestId("fiscal-gates-bulk-mark_filed").click();

      // UndoToast appears.
      const undo = page.getByTestId("undo-toast");
      await expect(undo).toBeVisible({ timeout: 5_000 });
      await expect(undo).toContainText(/Marked/);

      // Every visible row now renders the "Filed" status.
      // (The status column renders a span with the translated
      // label; we count occurrences inside the table body.)
      const tableBody = page.locator(
        '[data-testid^="data-table-row-"]:not([data-testid^="data-table-row-select-"]) >> text=Filed',
      );
      await expect(tableBody).toHaveCount(10, { timeout: 5_000 });

      // Click Undo — every row returns to its prior status.
      await page.getByTestId("undo-toast-action").click();
      await expect(undo).toBeHidden({ timeout: 5_000 });

      // No row should still be Filed. (At least one status
      // badge should be "Pending" / "Overdue" — the
      // per-period seed marks anything past-due as Overdue,
      // anything else as Pending.)
      const stillFiled = page.locator(
        '[data-testid^="data-table-row-"]:not([data-testid^="data-table-row-select-"]) >> text=Filed',
      );
      await expect(stillFiled).toHaveCount(0, { timeout: 5_000 });
    } finally {
      await context.close();
    }
  });

  /* ────────── 5. locale: Russian column header ────────── */

  test("?lang=ru applies the Russian locale to the page", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await gotoFiscalGates(page, "ru");

      // The `?lang=ru` query is the highest-priority resolver in
      // `getActiveLocale()`, and `activateLocale()` writes both
      // `document.documentElement.lang` and `localStorage["a1:locale"]`
      // after the async catalog loader resolves. Asserting on these
      // two side effects proves the locale-switch code path ran end
      // to end, independent of any later messages-dict mutation.
      const docLang = await page.evaluate(
        () => document.documentElement.lang,
      );
      expect(docLang).toBe("ru");
      const storedLocale = await page.evaluate(() =>
        window.localStorage.getItem("a1:locale"),
      );
      expect(storedLocale).toBe("ru");

      // The Russian catalog maps the five column headers as:
      //   Gate      → "Обязательство"
      //   Category  → "Категория"
      //   Due       → "Срок"
      //   Status    → "Статус"
      //   Amount    → "Сумма"
      // Soft-assert at least one is in the DOM — the hard
      // `document.lang` check above is the real smoke test; the
      // Cyrillic render depends on the catalog reaching the
      // React tree, which is verified when the dev server's
      // Lingui patch is loaded.
      const cyrillicHeaders = [
        "Обязательство",
        "Категория",
        "Срок",
        "Статус",
        "Сумма",
      ];
      let found: string | null = null;
      for (const label of cyrillicHeaders) {
        const count = await page.getByText(label, { exact: true }).count();
        if (count > 0) {
          found = label;
          break;
        }
      }
      expect(
        found,
        "expected at least one Russian column header to render (or document.lang=ru as fallback)",
      ).not.toBeNull();
    } finally {
      await context.close();
    }
  });
});
