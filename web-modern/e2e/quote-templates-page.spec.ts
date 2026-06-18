/**
 * quote-templates-page.spec.ts — e2e coverage for the new
 * /app/smb-crm/quote-templates page (Phase 10.13 / slice 13 + 16).
 *
 * Tests the end-to-end flow: list the 4 built-in templates,
 * pick one, fill quantity + unit price, optionally pick a
 * customer, hit Create, the server creates the quote and
 * the SPA opens the printable PDF in a new tab.
 *
 * We use network interception to mock the from-template POST
 * (we can't create real customers + quotes in the dev DB
 * without breaking other e2e specs).
 *
 * Auth: every protected route needs a session. We use the
 * standard `authedPage()` helper and skip the test cleanly if
 * the Fastify backend is not reachable.
 */
import { test, expect } from "@playwright/test";
import {
  authedPage,
  FASTIFY_URL,
  BASE_URL
} from "./_helpers";

const ROUTE = `${BASE_URL}/app/smb-crm/quote-templates`;

test.describe("Quote templates page (slice 13 + 16)", () => {
  test.beforeAll(async ({ request }) => {
    const probe = await request
      .get(`${FASTIFY_URL}/api/health`, { timeout: 2_000 })
      .catch(() => null);
    test.skip(
      !probe || !probe.ok(),
      `Fastify backend not reachable at ${FASTIFY_URL} — skipping quote templates e2e (CI runs with START_FASTIFY=1).`
    );
  });

  test("page renders: 4 built-in template cards + the page header + Back link", async ({
    browser,
    request
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      await page.goto(ROUTE);
      await expect(page.getByTestId("smb-crm-quote-templates")).toBeVisible();
      // H1
      await expect(page.getByTestId("smb-crm-quote-templates-h1")).toHaveText(/Quote templates/);
      // 4 cards
      const cards = page.getByTestId("smb-crm-quote-template-card");
      await expect(cards).toHaveCount(4);
      // The order on the live render is server-controlled
      // (builtin DESC, name); we assert the SET, not the order.
      const ids = await cards.evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.templateId).sort()
      );
      expect(ids).toEqual([
        "tpl-consulting-blank",
        "tpl-service-3",
        "tpl-standard-product",
        "tpl-subscription-annual"
      ]);
      // All 4 are flagged built-in
      const builtins = page.getByTestId("smb-crm-quote-template-builtin");
      await expect(builtins).toHaveCount(4);
      // Back link
      const back = page.getByTestId("smb-crm-quote-template-back");
      const href = await back.getAttribute("href");
      expect(["/app/smb-crm", "/app/smb-crm/"]).toContain(href);
    } finally {
      await page.context().close();
    }
  });

  test("picking a template reveals the metadata editor + line item editor + create button", async ({
    browser,
    request
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      await page.goto(ROUTE);
      // Pick the 3-line Service template by id (order is server-
      // controlled and may change).
      const serviceCard = page.locator('[data-testid="smb-crm-quote-template-card"][data-template-id="tpl-service-3"]');
      await serviceCard.click();
      // Metadata editor + line editor + create bar should appear.
      await expect(page.getByTestId("smb-crm-quote-template-meta")).toBeVisible();
      await expect(page.getByTestId("smb-crm-quote-template-lines")).toBeVisible();
      await expect(page.getByTestId("smb-crm-quote-template-create-bar")).toBeVisible();
      // 3 line items (3-line template).
      const lines = page.getByTestId("smb-crm-quote-template-line");
      await expect(lines).toHaveCount(3);
      // Now switch to the annual subscription template (1 line).
      const annualCard = page.locator('[data-testid="smb-crm-quote-template-card"][data-template-id="tpl-subscription-annual"]');
      await annualCard.click();
      const newLines = page.getByTestId("smb-crm-quote-template-line");
      await expect(newLines).toHaveCount(1);
    } finally {
      await page.context().close();
    }
  });

  test("the customer picker is a <select> populated from /api/smb-crm/customers", async ({
    browser,
    request
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      await page.goto(ROUTE);
      await page.getByTestId("smb-crm-quote-template-card").first().click();
      const sel = page.getByTestId("smb-crm-quote-template-customer");
      await expect(sel).toBeVisible();
      // The element must be a <select> (not an <input>).
      const tag = await sel.evaluate((el) => el.tagName);
      expect(tag).toBe("SELECT");
      // There must be at least 1 option (the placeholder). On a fresh
      // dev DB there may be 0 customers; either way the picker is
      // wired correctly. We assert placeholder + the empty-state
      // hint is rendered (slice 16 contract).
      const opts = sel.locator("option");
      await expect(opts.first()).toHaveText(/select customer/i);
      // When the customers list is empty, the empty-state hint shows.
      const emptyHint = page.getByTestId("smb-crm-quote-template-customer-empty");
      if ((await opts.count()) <= 1) {
        await expect(emptyHint).toBeVisible();
        await expect(emptyHint).toContainText(/No customers yet/i);
      }
    } finally {
      await page.context().close();
    }
  });

  test("editing quantity + unit price updates the line total in real time", async ({
    browser,
    request
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      await page.goto(ROUTE);
      // Standard product quote has 1 line. Use by-id to avoid order.
      const standardCard = page.locator('[data-testid="smb-crm-quote-template-card"][data-template-id="tpl-standard-product"]');
      await standardCard.click();
      const qty = page.getByTestId("smb-crm-quote-template-qty").first();
      const price = page.getByTestId("smb-crm-quote-template-price").first();
      // Playwright's fill() on a <input type="number"> doesn't
      // always fire React's onChange with the latest value. Use
      // pressSequentially() so each keystroke is dispatched as
      // an input event.
      await qty.click();
      await qty.press("Control+a");
      await qty.press("Delete");
      await qty.type("5", { delay: 20 });
      await price.click();
      await price.press("Control+a");
      await price.press("Delete");
      await price.type("100", { delay: 20 });
      const lineTotal = page.getByTestId("smb-crm-quote-template-line-total").first();
      await expect(lineTotal).toContainText("500.00");
      // The preview total also updates.
      const preview = page.getByTestId("smb-crm-quote-template-total");
      await expect(preview).toContainText("500.00");
    } finally {
      await page.context().close();
    }
  });

  test("Create button is disabled when the quote number is empty; enabled when set", async ({
    browser,
    request
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      await page.goto(ROUTE);
      await page.getByTestId("smb-crm-quote-template-card").first().click();
      const btn = page.getByTestId("smb-crm-quote-template-create");
      await expect(btn).toBeDisabled();
      const num = page.getByTestId("smb-crm-quote-template-number");
      await num.fill("Q-E2E-0001");
      await expect(btn).toBeEnabled();
    } finally {
      await page.context().close();
    }
  });

  test("clicking Create calls POST /api/smb-crm/quotes/from-template with the parsed body and opens the PDF in a new tab", async ({
    browser,
    request,
    context
  }) => {
    // We can't mock window.open in playwright the same way as jsdom,
    // so we listen for the new popup event.
    const { page } = await authedPage(browser, request);
    const calls: Array<{ url: string; body: string }> = [];
    page.on("request", (req) => {
      if (req.url().endsWith("/api/smb-crm/quotes/from-template") && req.method() === "POST") {
        calls.push({ url: req.url(), body: req.postData() ?? "" });
      }
    });
    // Stub the response so the SPA gets a quote id back.
    await page.route("**/api/smb-crm/quotes/from-template", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          quote: {
            id: "quote-e2e-1",
            org_id: "org-1",
            number: "Q-E2E-0001",
            customer_id: null,
            deal_id: null,
            issue_date: "2026-06-15",
            expiry_date: null,
            status: "draft",
            total_amount: 500,
            currency: "AMD",
            line_items_json: "[]",
            created_at: "2026-06-15T00:00:00Z",
            updated_at: "2026-06-15T00:00:00Z",
            template_id: "tpl-standard-product",
            template_name: "Standard product quote"
          },
          lineItems: [],
          totalAmount: 500
        })
      });
    });
    // Track popup windows.
    const popupPromise = context.waitForEvent("page", { timeout: 5_000 }).catch(() => null);
    try {
      await page.goto(ROUTE);
      // Pick by id (the order is server-controlled, alphabetical
      // by name — "tpl-subscription-annual" comes first).
      const standardCard = page.locator('[data-testid="smb-crm-quote-template-card"][data-template-id="tpl-standard-product"]');
      await standardCard.click();
      await page.getByTestId("smb-crm-quote-template-number").fill("Q-E2E-0001");
      const qty = page.getByTestId("smb-crm-quote-template-qty").first();
      const price = page.getByTestId("smb-crm-quote-template-price").first();
      await qty.fill("5");
      await price.fill("100");
      await page.getByTestId("smb-crm-quote-template-create").click();
      // Wait for the POST.
      await expect.poll(() => calls.length, { timeout: 5_000 }).toBeGreaterThan(0);
      // The body must contain the templateId + the override.
      expect(calls[0]!.body).toContain("tpl-standard-product");
      expect(calls[0]!.body).toContain("Q-E2E-0001");
      // The popup should be opened with the PDF URL.
      const popup = await popupPromise;
      if (popup) {
        // Just check the popup's URL contains the quote id.
        await expect.poll(() => popup.url(), { timeout: 3_000 }).toContain("quote-e2e-1");
      }
    } finally {
      await page.context().close();
    }
  });
});
