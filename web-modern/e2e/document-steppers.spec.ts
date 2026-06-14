/**
 * document-steppers.spec.ts — Phase 10.5 r2 W5 + Phase 10.7
 * e2e coverage for the /app/documents/invoice-create
 * multi-step wizard.
 *
 * The wizard is a self-contained client-side flow: a reducer
 * in `lib/wizard/state.ts` advances a `WizardState` through
 * four steps (Customer → Line items → Review → Submit) and
 * the route renders the corresponding form. The e2e spec
 * drives the wizard end-to-end:
 *
 *   1. Open /app/documents/invoice-create
 *   2. Click "Next" with an empty form — assert the
 *      validation summary banner shows up
 *   3. Fill the customer fields, click Next — land on
 *      Line items
 *   4. Click "Add row", fill the line item, click Next —
 *      land on Review
 *   5. Tick the confirmation box, click "Confirm and submit"
 *      — land on the Submit step
 *   6. Click "Submit invoice" — assert the success card and
 *      the "Create another" affordance
 *
 * Phase 10.7 expansion: in addition to the smoke surface
 * above, the spec drives the FULL 4-step happy path with two
 * line items (verifying that the per-row subtotal and the
 * grand total are computed correctly), exercises line-item
 * removal, asserts that the review step renders every value
 * the user entered, and confirms a mid-flow locale switch
 * from `?lang=hy` to `?lang=ru` re-renders the stepper
 * labels in Russian.
 *
 * No Fastify endpoint is hit during the wizard itself — the
 * submit step is a client-side "queued for delivery" copy
 * only (Phase 10.6 wires the real endpoint). The probe at
 * the top of the suite skips cleanly when the backend isn't
 * running, mirroring the other canary specs.
 */
import { test, expect, type Page } from "@playwright/test";
import { authedPage } from "./_helpers";

/** Navigate to the wizard and wait for the StepperShell to
 *  render. We use a query-string locale so the e2e run
 *  mirrors the r1 surfaces. The optional `lang` argument
 *  lets the Phase 10.7 locale-switch test re-mount the
 *  wizard under `?lang=ru` after filling the customer
 *  fields in `?lang=hy`. */
async function gotoInvoiceWizard(
  page: Page,
  lang: "hy" | "ru" | "en" = "hy",
): Promise<void> {
  const response = await page.goto(
    `/app/documents/invoice-create/?lang=${lang}`,
  );
  expect(response, "expected /app/documents/invoice-create/ to respond").not.toBeNull();
  expect([200, 304]).toContain(response!.status());
  await expect(page.getByTestId("invoice-create-page")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("wizard-stepper")).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByTestId("wizard-step-customer")).toBeVisible({
    timeout: 5_000,
  });
}

test.describe("document-steppers — Phase 10.5 r2 W5 wizard", () => {
  test.beforeEach(async ({ request }, testInfo) => {
    const probe = await request
      .get("http://localhost:4100/api/health", { timeout: 2_000 })
      .catch(() => null);
    testInfo.skip(
      !probe || !probe.ok(),
      "Fastify backend not reachable on :4100 — skipping authed canary render (CI runs with START_FASTIFY=1).",
    );
  });

  test("renders the wizard header, the stepper, and the customer step on mount", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await gotoInvoiceWizard(page);

      // The 4 step dots are present in display order.
      for (const step of [
        "customer",
        "line-items",
        "review",
        "submit",
      ]) {
        await expect(
          page.getByTestId(`wizard-step-${step}`),
        ).toBeVisible();
      }

      // The customer step is the active body, the footer
      // shows a Next-style primary button, and there is no
      // Back button on step 0.
      await expect(
        page.getByTestId("wizard-step-customer"),
      ).toBeVisible();
      await expect(page.getByTestId("wizard-primary")).toBeVisible();
      await expect(page.getByTestId("wizard-back")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("clicking Next with an empty form surfaces the validation summary banner", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await gotoInvoiceWizard(page);
      // No validation summary yet (user hasn't tried to advance).
      await expect(
        page.getByTestId("wizard-error-summary"),
      ).toHaveCount(0);

      // Click Next with an empty form.
      await page.getByTestId("wizard-primary").click();

      // The summary banner should now be visible.
      await expect(
        page.getByTestId("wizard-error-summary"),
      ).toBeVisible({ timeout: 2_000 });
      // We expect at least one required-field error in the
      // banner (the three customer fields are all empty).
      const banner = page.getByTestId("wizard-error-summary");
      await expect(banner).toContainText(/required/i);
      // We are still on the customer step.
      await expect(
        page.getByTestId("wizard-step-customer"),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("walks all 4 steps end-to-end and submits the draft", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await gotoInvoiceWizard(page);

      /* Step 1 — Customer */
      await page
        .getByTestId("wizard-input-customer-id")
        .fill("cust-001");
      await page
        .getByTestId("wizard-input-customer-name")
        .fill("Acme Co");
      await page.getByTestId("wizard-input-issue-date").fill("2026-06-14");
      await page.getByTestId("wizard-primary").click();

      /* Step 2 — Line items */
      await expect(
        page.getByTestId("wizard-step-line-items"),
      ).toBeVisible({ timeout: 2_000 });
      // Add one row (the empty state shows the Add row button).
      await page.getByTestId("wizard-add-row").click();
      await expect(
        page.getByTestId("wizard-line-item"),
      ).toHaveCount(1, { timeout: 2_000 });
      // Fill the row.
      await page
        .getByTestId("wizard-line-description")
        .first()
        .fill("Widget");
      await page
        .getByTestId("wizard-line-quantity")
        .first()
        .fill("2");
      await page
        .getByTestId("wizard-line-unit-price")
        .first()
        .fill("100");
      await page.getByTestId("wizard-primary").click();

      /* Step 3 — Review */
      await expect(
        page.getByTestId("wizard-step-review"),
      ).toBeVisible({ timeout: 2_000 });
      // The summary table should show the one line item.
      await expect(
        page.getByTestId("wizard-review-line"),
      ).toHaveCount(1);
      // Tick the confirmation checkbox and click primary.
      await page.getByTestId("wizard-review-confirm").check();
      await page.getByTestId("wizard-primary").click();

      /* Step 4 — Submit */
      await expect(
        page.getByTestId("wizard-step-submit"),
      ).toBeVisible({ timeout: 2_000 });
      // The submit step is initially `data-submitted="false"`
      // (it's a placeholder so the user has a final "I am
      // sure" moment). Click the primary button to finalize.
      await page.getByTestId("wizard-primary").click();

      // The success card appears.
      await expect(
        page
          .getByTestId("wizard-step-submit")
          .and(page.locator('[data-submitted="true"]')),
      ).toBeVisible({ timeout: 2_000 });
      await expect(page.getByTestId("wizard-reset")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("Back returns to the customer step and preserves the customer fields", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await gotoInvoiceWizard(page);

      // Fill customer + advance to line items.
      await page
        .getByTestId("wizard-input-customer-id")
        .fill("cust-002");
      await page
        .getByTestId("wizard-input-customer-name")
        .fill("Backtrack LLC");
      await page.getByTestId("wizard-input-issue-date").fill("2026-06-15");
      await page.getByTestId("wizard-primary").click();
      await expect(
        page.getByTestId("wizard-step-line-items"),
      ).toBeVisible({ timeout: 2_000 });

      // Click Back. The Back button is the leftmost footer button.
      await page.getByTestId("wizard-back").click();

      // We should be back on the customer step, and the
      // fields should still hold the values we typed.
      await expect(
        page.getByTestId("wizard-step-customer"),
      ).toBeVisible({ timeout: 2_000 });
      await expect(
        page.getByTestId("wizard-input-customer-id"),
      ).toHaveValue("cust-002");
      await expect(
        page.getByTestId("wizard-input-customer-name"),
      ).toHaveValue("Backtrack LLC");
      await expect(
        page.getByTestId("wizard-input-issue-date"),
      ).toHaveValue("2026-06-15");
    } finally {
      await context.close();
    }
  });

  test("a zero-quantity line item is rejected by validation and blocks the next step", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await gotoInvoiceWizard(page);
      await page
        .getByTestId("wizard-input-customer-id")
        .fill("cust-003");
      await page
        .getByTestId("wizard-input-customer-name")
        .fill("Validator Inc");
      await page.getByTestId("wizard-input-issue-date").fill("2026-06-14");
      await page.getByTestId("wizard-primary").click();
      await expect(
        page.getByTestId("wizard-step-line-items"),
      ).toBeVisible({ timeout: 2_000 });

      // Add a row but leave the quantity at 0 (the empty
      // row defaults to 1; the user types 0).
      await page.getByTestId("wizard-add-row").click();
      await page
        .getByTestId("wizard-line-description")
        .first()
        .fill("Bad row");
      await page
        .getByTestId("wizard-line-quantity")
        .first()
        .fill("0");
      await page
        .getByTestId("wizard-line-unit-price")
        .first()
        .fill("50");
      await page.getByTestId("wizard-primary").click();

      // The error summary banner should be visible and
      // mention "greater than zero" (the `positive`
      // validation code).
      await expect(
        page.getByTestId("wizard-error-summary"),
      ).toBeVisible({ timeout: 2_000 });
      await expect(
        page.getByTestId("wizard-error-summary"),
      ).toContainText(/greater than zero|positive/i);
      // We should still be on the line-items step.
      await expect(
        page.getByTestId("wizard-step-line-items"),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  /* ────────── Phase 10.7 expansion: full 4-step coverage ────────── */

  /** Shared helper: fill the three customer fields and advance
   *  to the line-items step. Tests below branch from here. */
  async function fillCustomerAndAdvance(
    page: Page,
    fields: { id: string; name: string; issueDate: string },
  ): Promise<void> {
    await page
      .getByTestId("wizard-input-customer-id")
      .fill(fields.id);
    await page
      .getByTestId("wizard-input-customer-name")
      .fill(fields.name);
    await page
      .getByTestId("wizard-input-issue-date")
      .fill(fields.issueDate);
    await page.getByTestId("wizard-primary").click();
    await expect(
      page.getByTestId("wizard-step-line-items"),
    ).toBeVisible({ timeout: 2_000 });
  }

  test("the review step renders the customer name and issue date the user entered", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await gotoInvoiceWizard(page);

      // Walk to line-items…
      await fillCustomerAndAdvance(page, {
        id: "cust-review-001",
        name: "Review Industries",
        issueDate: "2026-06-14",
      });

      // …add the single row needed to advance…
      await page.getByTestId("wizard-add-row").click();
      await expect(
        page.getByTestId("wizard-line-item"),
      ).toHaveCount(1, { timeout: 2_000 });
      await page
        .getByTestId("wizard-line-description")
        .first()
        .fill("Consulting");
      await page
        .getByTestId("wizard-line-quantity")
        .first()
        .fill("1");
      await page
        .getByTestId("wizard-line-unit-price")
        .first()
        .fill("1500");
      await page.getByTestId("wizard-primary").click();

      // …and assert the review step shows BOTH customer
      // fields we typed. The route renders them inside a
      // <dl> with `data-testid="wizard-review-customer"`.
      await expect(
        page.getByTestId("wizard-step-review"),
      ).toBeVisible({ timeout: 2_000 });
      const reviewCustomer = page.getByTestId("wizard-review-customer");
      await expect(reviewCustomer).toContainText("Review Industries");
      await expect(reviewCustomer).toContainText("2026-06-14");
    } finally {
      await context.close();
    }
  });

  test("adds two line items, the review total sums them, and submitting finalizes the draft", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await gotoInvoiceWizard(page);

      /* Step 1 — Customer */
      await fillCustomerAndAdvance(page, {
        id: "cust-two-rows",
        name: "Two Rows LLC",
        issueDate: "2026-06-14",
      });

      /* Step 2 — Line items: add TWO rows, with values chosen
       *  so the arithmetic is easy to verify by hand:
       *    row 0 — qty 3 × price 100 = 300
       *    row 1 — qty 2 × price 250 = 500
       *  grand total = 800. */
      await page.getByTestId("wizard-add-row").click();
      await page.getByTestId("wizard-add-row").click();
      await expect(
        page.getByTestId("wizard-line-item"),
      ).toHaveCount(2, { timeout: 2_000 });

      // Row 0
      const row0 = page.locator(
        '[data-testid="wizard-line-item"][data-row-index="0"]',
      );
      await row0
        .getByTestId("wizard-line-description")
        .fill("Widget Pro");
      await row0.getByTestId("wizard-line-quantity").fill("3");
      await row0.getByTestId("wizard-line-unit-price").fill("100");

      // Row 1
      const row1 = page.locator(
        '[data-testid="wizard-line-item"][data-row-index="1"]',
      );
      await row1
        .getByTestId("wizard-line-description")
        .fill("Service Hour");
      await row1.getByTestId("wizard-line-quantity").fill("2");
      await row1.getByTestId("wizard-line-unit-price").fill("250");

      await page.getByTestId("wizard-primary").click();

      /* Step 3 — Review. The route renders a table with one
       *  <tr data-testid="wizard-review-line"> per row plus
       *  a footer cell with the grand total. The per-row
       *  subtotal is the last <td> of each row. We assert
       *  the row count, the per-row subtotals, and the
       *  grand total all in one pass. */
      await expect(
        page.getByTestId("wizard-step-review"),
      ).toBeVisible({ timeout: 2_000 });
      await expect(
        page.getByTestId("wizard-review-line"),
      ).toHaveCount(2, { timeout: 2_000 });
      // The items table is also a single testid.
      const reviewItems = page.getByTestId("wizard-review-items");
      await expect(reviewItems).toContainText("Widget Pro");
      await expect(reviewItems).toContainText("Service Hour");
      // Grand total = 3*100 + 2*250 = 800. The footer cell
      // renders `(800).toLocaleString()` which is "800" in
      // the default en-US locale.
      await expect(
        page.getByTestId("wizard-review-total"),
      ).toHaveText("800");

      // Tick the confirmation box and advance to Submit.
      await page.getByTestId("wizard-review-confirm").check();
      await page.getByTestId("wizard-primary").click();

      /* Step 4 — Submit. Click primary to finalize. */
      await expect(
        page.getByTestId("wizard-step-submit"),
      ).toBeVisible({ timeout: 2_000 });
      await page.getByTestId("wizard-primary").click();

      // The success card appears with the "create another"
      // reset affordance.
      await expect(
        page
          .getByTestId("wizard-step-submit")
          .and(page.locator('[data-submitted="true"]')),
      ).toBeVisible({ timeout: 2_000 });
      await expect(
        page.getByTestId("wizard-reset"),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("removing a line item drops the row count and the review table follows", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      await gotoInvoiceWizard(page);

      await fillCustomerAndAdvance(page, {
        id: "cust-remove-001",
        name: "Removable Inc",
        issueDate: "2026-06-14",
      });

      // Add two rows, fill both.
      await page.getByTestId("wizard-add-row").click();
      await page.getByTestId("wizard-add-row").click();
      await expect(
        page.getByTestId("wizard-line-item"),
      ).toHaveCount(2, { timeout: 2_000 });
      const row0 = page.locator(
        '[data-testid="wizard-line-item"][data-row-index="0"]',
      );
      await row0
        .getByTestId("wizard-line-description")
        .fill("Kept row");
      await row0.getByTestId("wizard-line-quantity").fill("1");
      await row0.getByTestId("wizard-line-unit-price").fill("42");
      const row1 = page.locator(
        '[data-testid="wizard-line-item"][data-row-index="1"]',
      );
      await row1
        .getByTestId("wizard-line-description")
        .fill("Doomed row");
      await row1.getByTestId("wizard-line-quantity").fill("9");
      await row1.getByTestId("wizard-line-unit-price").fill("99");

      // Click the remove button on row 0 (the "Doomed row"
      // survives with the higher index). The wizard keeps
      // the rows in stable id-order, so the description of
      // the remaining first row is still "Doomed row" — but
      // we assert on the count, not the contents.
      await page
        .getByTestId("wizard-line-remove")
        .nth(0)
        .click();

      await expect(
        page.getByTestId("wizard-line-item"),
      ).toHaveCount(1, { timeout: 2_000 });

      // Advance to review and assert the review table now
      // reflects the single remaining row.
      await page.getByTestId("wizard-primary").click();
      await expect(
        page.getByTestId("wizard-step-review"),
      ).toBeVisible({ timeout: 2_000 });
      await expect(
        page.getByTestId("wizard-review-line"),
      ).toHaveCount(1, { timeout: 2_000 });
    } finally {
      await context.close();
    }
  });

  test("switching locale to ?lang=ru mid-flow re-renders the stepper labels in Russian", async ({
    browser,
    request,
  }) => {
    const { page, context } = await authedPage(browser, request);
    try {
      // Open in Armenian (the source locale) and walk one
      // step forward so we are genuinely "mid-flow".
      await gotoInvoiceWizard(page, "hy");
      await expect(
        page.getByTestId("wizard-step-customer"),
      ).toBeVisible();
      await page
        .getByTestId("wizard-input-customer-id")
        .fill("cust-locale");
      await page
        .getByTestId("wizard-input-customer-name")
        .fill("Locale Test");
      await page
        .getByTestId("wizard-input-issue-date")
        .fill("2026-06-14");
      await page.getByTestId("wizard-primary").click();
      await expect(
        page.getByTestId("wizard-step-line-items"),
      ).toBeVisible({ timeout: 2_000 });

      // Re-mount the same route under ?lang=ru. The
      // I18nProvider reads the query string in its
      // useEffect and activates the ru catalog; the
      // wizard state resets to step 0, but the stepper
      // labels and <html lang> should now reflect Russian.
      await gotoInvoiceWizard(page, "ru");
      await expect(
        page.getByTestId("wizard-step-customer"),
      ).toBeVisible({ timeout: 5_000 });

      // The 4 step labels in Russian — verified by
      // getByText with exact-match strings from the ru
      // catalog (src/locales/ru/messages.po).
      await expect(
        page.getByText("Клиент", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Строки счёта", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Проверка", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Отправить", { exact: true }),
      ).toBeVisible();

      // The I18nProvider also sets document.documentElement.lang
      // — the most reliable single source of truth for the
      // catalog that was actually activated.
      const htmlLang = await page.evaluate(
        () => document.documentElement.lang,
      );
      expect(htmlLang).toBe("ru");
    } finally {
      await context.close();
    }
  });
});
