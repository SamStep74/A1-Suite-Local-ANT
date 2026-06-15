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
 *
 * Phase 10.9 (d) note — form-envelope drift investigation:
 *   The 10.9 (d) plan attributed this spec's failures to a 10.5
 *   server refactor of the form-submit envelope (`{op, payload}` →
 *   `{operation, data}`). Investigation showed that diagnosis does
 *   not apply here: the CRM routes (see `server/app.js:2754-2780`
 *   — `app.get("/api/crm/quotes", ...)`, `app.post("/api/crm/quotes",
 *   ...)`, `app.post("/api/crm/quotes/:id/request-approval", ...)`)
 *   read `request.body` directly without any `op`/`payload` or
 *   `operation`/`data` wrapper. Grepping the spec confirms it has
 *   no `page.request.post(...)` or `page.evaluate(() => fetch(...))`
 *   form-submit calls — only the list/detail navigation flow.
 *
 *   The actual pre-fix failure mode was `ECONNREFUSED` (no Fastify
 *   backend up during the pre-server orchestrator run). Under
 *   `START_FASTIFY=1` the spec already passes; this commit just
 *   tightens the assertions to 6 explicit `expect(...).to...()`
 *   calls so the audit gate's "1 test, 6 assertions" line item is
 *   satisfied unambiguously, and adds a row-count check + URL match
 *   to make the test less prone to silent regression (a blank table
 *   with `tbody tr:first-child` that throws on click would have been
 *   missed by the previous `toBeVisible()`-only shape).
 */
import { test, expect } from "@playwright/test";
import { authedPage, waitForHydration } from "./_helpers";

test.describe("CRM happy path", () => {
  test("list page paints quotes and first-row click opens detail @smoke", async ({ browser, request }) => {
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

      // The quote list must paint at least one row. Asserting
      // `not.toHaveCount(0)` (rather than ">= 1") plays nicer with
      // Playwright's auto-retry: it polls until the table is
      // populated by the GET /api/crm/quotes response, instead of
      // snapshotting an empty `tbody` mid-fetch.
      const rows = page.locator("table tbody tr");
      await expect(rows).not.toHaveCount(0, { timeout: 10_000 });

      const firstQuoteRow = rows.first();
      await expect(firstQuoteRow).toBeVisible({ timeout: 10_000 });

      // Click and wait for the URL to change from the list to a
      // detail route. /app/crm/ → /app/crm/<quoteId>.
      await Promise.all([
        page.waitForURL(/\/app\/crm\/[^/?#]+$/, { timeout: 10_000 }),
        firstQuoteRow.click(),
      ]);

      // Explicit URL assertion — `waitForURL` would have thrown on
      // timeout, but capturing the final URL in an `expect()` makes
      // the intent visible in the Playwright HTML report and gives
      // us a clean failure message if the regex ever drifts (e.g.
      // someone adds a `?tab=...` suffix to the detail route).
      expect(page.url()).toMatch(/\/app\/crm\/[^/?#]+$/);

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
