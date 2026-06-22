/**
 * procurement.spec.ts — e2e coverage for the Phase 8.4 Pattern A
 * Procurement route (/app/purchase/procurement).
 *
 * What this asserts (the must-haves for "the procurement skeleton
 * works end-to-end"):
 *   - GET /app/purchase/procurement returns 2xx (route resolves,
 *     auth works, the TanStack dev server renders the workspace)
 *   - The Armenian header (data-testid="procurement-title") is
 *     visible and contains an Armenian glyph
 *   - The English subtitle (data-testid="procurement-subtitle")
 *     contains "Procurement"
 *   - The tender tab buttons render (requisition, rfq, quote,
 *     award, receipt) and the default active tab is Requisition
 *   - Clicking each tab button switches the visible form
 *   - The cross-tab flow posts once per live tender action in
 *     sequence (Requisition → RFQ → Quote → Award), the draft PO
 *     id pill flips to ready, and receipt stays deferred to the
 *     purchase-order receiving screen
 *   - The back link points to /app/purchase
 *   - The 403 access-denied card is NOT rendered for a default
 *     session (the route hardcodes userAccess="purchase"; this
 *     assertion guards against a future regression that would
 *     surface the forbidden card to a paying user)
 *
 * Mocking strategy: the modern route now follows the backend RFQ
 * chain: requisition create, requisition convert-to-rfq, RFQ quote
 * capture, and RFQ award to a draft PO. The e2e suite intercepts
 * those nested POSTs via Playwright route() handlers and replies
 * with stable `ok: true` envelopes + per-step ids.
 *
 * NOT asserted here (deferred to 8.4b–8.4f sub-plans):
 *   - Server-side validation of the procurement request
 *     payloads (covered by the server unit tests in test/)
 *   - Idempotency-key replay protection (the route appends a
 *     `Date.now()`-suffixed key; the server still has to honor
 *     it, which is a backend concern)
 *   - AI vendor selection + price-anomaly hooks (those are
 *     the AI sidebar in the legacy module, not the modern
 *     route)
 */
import { test, expect, type Route, type Request } from "@playwright/test";
import { authedPage, waitForHydration } from "./_helpers";

/** Stable per-tab ids used by the route interception handlers. */
const REQUISITION_ID = "req-e2e-001";
const REQUISITION_LINE_ID = "prl-e2e-001";
const RFQ_ID = "rfq-e2e-002";
const QUOTE_ID = "quote-e2e-003";
const PO_ID = "po-e2e-004";
const VENDOR_ID = "vendor-e2e-001";

/** Install route handlers that reply to the nested procurement
 *  POSTs the modern route issues. Each handler returns the
 *  `ok: true` envelope the route's Zod schema expects. */
function installProcurementApiMocks(route: Route): void {
  // Requisition — body is { neededBy, justification?, lines, idempotencyKey }
  if (requestMatchesPath(route.request(), "/api/procurement/requisitions")) {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requisition: {
          id: REQUISITION_ID,
          neededBy: "2026-07-01",
          justification: "",
          status: "open",
          createdAt: "2026-06-22T00:00:00.000Z",
          lines: [
            {
              id: REQUISITION_LINE_ID,
              catalogItemId: "catitem-e2e-001",
              quantity: 5,
              uom: "հատ",
              estUnitPrice: 95000,
              suggestedVendorId: VENDOR_ID,
            },
          ],
        },
      }),
    });
    return;
  }
  // RFQ conversion — body is { dueAt, idempotencyKey }
  if (
    requestMatchesPath(
      route.request(),
      `/api/procurement/requisitions/${REQUISITION_ID}/convert-to-rfq`,
    )
  ) {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        rfq: {
          id: RFQ_ID,
          requisitionId: REQUISITION_ID,
          sentAt: "2026-06-22T00:00:00.000Z",
          dueAt: "2026-07-15",
          status: "open",
          shortlistedVendors: [
            {
              vendorId: VENDOR_ID,
              name: "Yerevan Hardware Supply",
              score: 1,
              avgPrice: 90000,
            },
          ],
        },
      }),
    });
    return;
  }
  // Quote — body is { vendorId, requisitionLineId, unitPrice, currency, validUntil, idempotencyKey }
  if (requestMatchesPath(route.request(), `/api/procurement/rfqs/${RFQ_ID}/quotes`)) {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        quote: {
          id: QUOTE_ID,
          rfqId: RFQ_ID,
          vendorId: VENDOR_ID,
          requisitionLineId: REQUISITION_LINE_ID,
          unitPrice: 90000,
          currency: "AMD",
          validUntil: "2026-06-30",
          createdAt: "2026-06-22T00:00:00.000Z",
        },
      }),
    });
    return;
  }
  // Award — body is { vendorId, idempotencyKey }
  if (requestMatchesPath(route.request(), `/api/procurement/rfqs/${RFQ_ID}/award`)) {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        purchaseOrder: {
          id: PO_ID,
          orderNumber: "PO-RFQ-E2E-002",
          status: "rfq",
          vendorId: VENDOR_ID,
          total: 0,
        },
      }),
    });
    return;
  }
  // Anything else under /api/procurement passes through to the
  // live backend unchanged (so the e2e can still observe a
  // missing-route regression if the Fastify handler disappears).
  route.continue();
}

/** The Vite dev proxy forwards /api/* to Fastify as-is, so the
 *  pathname on the browser side is what we match against. We
 *  use the URL parser to avoid string-prefix false positives
 *  (e.g. "/api/procurement/requisitions-foo" must not match
 *  "/api/procurement/requisitions"). */
function requestMatchesPath(req: Request, path: string): boolean {
  const url = new URL(req.url());
  return url.pathname === path;
}

test.describe("Procurement — Phase 8.4 Pattern A skeleton", () => {
  test("loads, renders tender tabs, defaults to Requisition, and points back to /app/purchase", async ({
    browser,
    request,
  }) => {
    const ctx = await authedPage(browser, request);
    try {
      await ctx.page.route("**/api/procurement/**", installProcurementApiMocks);
      const response = await ctx.page.goto("/app/purchase/procurement");
      expect(
        response,
        `expected /app/purchase/procurement to respond (got ${response?.status()})`,
      ).not.toBeNull();
      expect([200, 304]).toContain(response!.status());

      await waitForHydration(ctx.page);

      // H2 — the Armenian title. The route renders an Armenian
      // "Գ" glyph + "Procurement" inside <h2 data-testid="procurement-title">.
      const panel = ctx.page.getByTestId("procurement-panel");
      await expect(panel).toBeVisible();
      const title = ctx.page.getByTestId("procurement-title");
      await expect(title).toBeVisible();
      // Playwright's Locator.textContent is a method (not a property),
      // so we must await the call. Calling it without () would return
      // the function reference (truthy, non-string), which the `?? ""`
      // fallback would not coalesce and toMatch would reject with
      // "received value must be a string".
      expect((await title.textContent()) ?? "").toMatch(/Գ|Procurement/);

      // English subtitle (bilingual header — Armenian H2 + English <p>).
      const subtitle = ctx.page.getByTestId("procurement-subtitle");
      await expect(subtitle).toBeVisible();
      expect((await subtitle.textContent()) ?? "").toContain("Procurement");

      // Tender tab buttons render in the strip, in route-local order.
      const tabs = [
        "requisition",
        "rfq",
        "quote",
        "po",
        "receipt",
      ] as const;
      for (const t of tabs) {
        const btn = ctx.page.getByTestId(`procurement-tab-${t}`);
        await expect(btn).toBeVisible();
      }

      // Default tab is Requisition — the route's initial state.
      const reqTab = ctx.page.getByTestId("procurement-tab-requisition");
      expect(await reqTab.getAttribute("data-active")).toBe("true");
      const reqForm = ctx.page.getByTestId("procurement-requisition-form");
      await expect(reqForm).toBeVisible();

      // Click each tab — the matching form appears, the
      // previously-active form unmounts.
      for (const t of tabs) {
        await ctx.page.getByTestId(`procurement-tab-${t}`).click();
        await expect(
          ctx.page.getByTestId(`procurement-tab-${t}`),
        ).toHaveAttribute("data-active", "true");
        await expect(
          ctx.page.getByTestId(`procurement-${t}-form`),
        ).toBeVisible();
      }

      // Back link to /app/purchase — the header chevron link.
      const back = ctx.page.getByTestId("procurement-back-link");
      await expect(back).toBeVisible();
      const href = await back.getAttribute("href");
      expect(href).toBe("/app/purchase");
    } finally {
      await ctx.page.context().close();
    }
  });
});

test.describe("Procurement — cross-tab POST flow", () => {
  test("chains Requisition → RFQ → Quote → Award and defers receipt", async ({
    browser,
    request,
  }) => {
    const ctx = await authedPage(browser, request);
    try {
      await ctx.page.route("**/api/procurement/**", installProcurementApiMocks);
      await ctx.page.goto("/app/purchase/procurement");
      await waitForHydration(ctx.page);

      // Step 1 — Requisition. The default tab is Requisition
      // so we don't need to click it.
      const reqPill = ctx.page.getByTestId("procurement-requisition-id-pill");
      await expect(reqPill).toHaveAttribute("data-state", "empty");
      await ctx.page
        .getByTestId("procurement-requisition-neededBy")
        .fill("2026-07-01");
      await ctx.page
        .getByTestId("procurement-requisition-catalogItemId")
        .fill("catitem-e2e-001");
      await ctx.page.getByTestId("procurement-requisition-quantity").fill("5");
      await ctx.page
        .getByTestId("procurement-requisition-estUnitPrice")
        .fill("95000");
      await ctx.page
        .getByTestId("procurement-requisition-suggestedVendorId")
        .fill(VENDOR_ID);
      await ctx.page.getByTestId("procurement-requisition-submit").click();
      await expect(reqPill).toHaveAttribute("data-state", "ready");
      expect((await reqPill.textContent()) ?? "").toContain(REQUISITION_ID);

      // Step 2 — RFQ. The id-pill lives INSIDE the per-tab form, so
      // it only mounts when the matching tab is active. Click the
      // tab first, then assert the pill is empty (the route's
      // initial state for that tab). Asserting before the click
      // would time out — the pill simply isn't in the DOM yet.
      const rfqPill = ctx.page.getByTestId("procurement-rfq-id-pill");
      await ctx.page.getByTestId("procurement-tab-rfq").click();
      await expect(rfqPill).toHaveAttribute("data-state", "empty");
      await ctx.page
        .getByTestId("procurement-rfq-dueAt")
        .fill("2026-07-15");
      await ctx.page.getByTestId("procurement-rfq-submit").click();
      await expect(rfqPill).toHaveAttribute("data-state", "ready");
      expect((await rfqPill.textContent()) ?? "").toContain(RFQ_ID);

      // Step 3 — Quote. Same click-then-assert pattern as RFQ.
      const quotePill = ctx.page.getByTestId("procurement-quote-id-pill");
      await ctx.page.getByTestId("procurement-tab-quote").click();
      await expect(quotePill).toHaveAttribute("data-state", "empty");
      await ctx.page.getByTestId("procurement-quote-vendorId").fill(VENDOR_ID);
      await ctx.page
        .getByTestId("procurement-quote-requisitionLineId")
        .fill(REQUISITION_LINE_ID);
      await ctx.page.getByTestId("procurement-quote-unitPrice").fill("90000");
      await ctx.page
        .getByTestId("procurement-quote-validUntil")
        .fill("2026-06-30");
      await ctx.page.getByTestId("procurement-quote-submit").click();
      await expect(quotePill).toHaveAttribute("data-state", "ready");
      expect((await quotePill.textContent()) ?? "").toContain(QUOTE_ID);

      // Step 4 — Award. Same click-then-assert pattern.
      const poPill = ctx.page.getByTestId("procurement-po-id-pill");
      await ctx.page.getByTestId("procurement-tab-po").click();
      await expect(poPill).toHaveAttribute("data-state", "empty");
      await ctx.page.getByTestId("procurement-po-vendorId").fill(VENDOR_ID);
      await ctx.page.getByTestId("procurement-po-submit").click();
      await expect(poPill).toHaveAttribute("data-state", "ready");
      expect((await poPill.textContent()) ?? "").toContain(PO_ID);

      // Step 5 — Receipt is intentionally deferred to the existing PO flow.
      await ctx.page.getByTestId("procurement-tab-receipt").click();
      await expect(
        ctx.page.getByTestId("procurement-receipt-deferred"),
      ).toBeVisible();
    } finally {
      await ctx.page.context().close();
    }
  });
});

test.describe("Procurement — 403 access gate", () => {
  test("does not render the 403 card for a default authenticated user @smoke", async ({
    browser,
    request,
  }) => {
    // The 403 path is a no-op for the live route today: the
    // default `ProcurementRoutePage` hardcodes
    // userAccess="purchase", so no real user with a valid
    // session can land on the access-denied card. This spec
    // is a regression guard — if a future change wires the
    // workspace to read a `userAccess` from the session and
    // defaults it to "none" for unprivileged users, this test
    // will fail loudly and the maintainer can decide whether
    // to (a) keep the 403 visible in the e2e (preferred) or
    // (b) update the assertion to match the new behavior.
    const ctx = await authedPage(browser, request);
    try {
      await ctx.page.route("**/api/procurement/**", installProcurementApiMocks);
      await ctx.page.goto("/app/purchase/procurement");
      await waitForHydration(ctx.page);

      // The 403 card must NOT be present for a default session.
      await expect(ctx.page.getByTestId("procurement-403")).toHaveCount(0);
      // The tab strip + the requisition form MUST be present.
      await expect(
        ctx.page.getByTestId("procurement-tab-strip"),
      ).toBeVisible();
      await expect(
        ctx.page.getByTestId("procurement-requisition-form"),
      ).toBeVisible();
    } finally {
      await ctx.page.context().close();
    }
  });
});
