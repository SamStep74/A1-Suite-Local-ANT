/**
 * document-steppers.spec.ts — Phase 10.5 r2 W5 e2e coverage
 * for the /app/documents/invoice-create multi-step wizard.
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
 *  mirrors the r1 surfaces. */
async function gotoInvoiceWizard(page: Page): Promise<void> {
  const response = await page.goto(
    "/app/documents/invoice-create/?lang=hy",
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
});
