/**
 * cabinet.spec.ts — e2e coverage for the Phase 8.2 Pattern A
 * Document Cabinet route (/app/cabinet).
 *
 * What this asserts (the must-haves for "the cabinet skeleton works"):
 *   - GET /app/cabinet returns 2xx (route resolves, auth works)
 *   - H1 "Document Cabinet" is visible
 *   - The Armenian subtitle is present (contains
 *     "Փաստաթղթաշրջանառություն") — bilingual routes in the suite
 *     render an English H1 with an Armenian label below it
 *   - The cabinet panel (data-testid="cabinet-panel") is visible
 *   - The filter controls (direction select, status select, search
 *     input) are present
 *   - The create form fields (title input, direction select, docType
 *     select, linkedId input, body textarea, submit button) are
 *     present and visible
 *   - The back-link points back to /app
 *
 * Why a dedicated spec: this is the Phase 8.2 cabinet migration
 * e2e, separate from the broader apps smoke loop. The contract
 * parity is locked at the server tier by
 * test/cabinet-modern-parity.test.js; this spec confirms the
 * modern route wires the same shape into the UI.
 *
 * NOT asserted here (deferred to 8.2b–8.2f sub-plans):
 *   - AI sidebar controls
 *   - eSign envelope flow
 *   - OCR trigger button
 *   - FTS search box
 * The route file does not render those yet; the e2e would be
 * premature and would block the 8.2 ship gate.
 */
import { test, expect } from "@playwright/test";
import { authedPage, waitForHydration } from "./_helpers";

test.describe("Cabinet — Phase 8.2 Pattern A skeleton", () => {
  test("loads, renders the filter bar, create form, and back-link", async ({
    browser,
    request,
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      const response = await page.goto("/app/cabinet");
      expect(
        response,
        `expected /app/cabinet to respond (got ${response?.status()})`,
      ).not.toBeNull();
      expect([200, 304]).toContain(response!.status());

      await waitForHydration(page);

      // H1 — the screen header. The Pattern A cabinet route renders
      // "Document Cabinet" (matches the legacy web/src/cabinet.jsx
      // H1 verbatim so the e2e is stable across the migration).
      await expect(
        page.getByRole("heading", { level: 1, name: /Document Cabinet/i }),
      ).toBeVisible();

      // Armenian subtitle — the bilingual routes in the suite
      // (desk, cfo, crm) all render an Armenian label line below
      // the H1. The cabinet label is "Փաստաթղթաշրջանառություն"
      // (lit. "document circulation", the legacy H2 string).
      // Scope to a <p> element to avoid the strict-mode collision
      // with the H1 "Document Cabinet" (both contain English text,
      // so a single getByText resolves to two nodes).
      const panel = page.getByTestId("cabinet-panel");
      await expect(panel).toBeVisible();
      await expect(
        panel.locator("p", { hasText: /Փաստաթղթաշրջանառություն/ }),
      ).toBeVisible();

      // Filter bar — direction select, status select, search input.
      // The route uses the same `data-entity` convention as the
      // other Pattern A apps; assert on a stable label that the
      // filter controls expose. The filter-bar selects are scoped
      // via the "Filter by" aria-label prefix so they don't collide
      // with the create-form "Direction" / "DocType" selects below.
      await expect(
        panel.getByRole("combobox", { name: /Filter by direction/i }),
      ).toBeVisible();
      await expect(
        panel.getByRole("combobox", { name: /Filter by status/i }),
      ).toBeVisible();
      const search = panel.getByRole("searchbox", { name: /search/i });
      await expect(search).toBeVisible();

      // Create form — title input, direction select, docType select,
      // linkedId input, body textarea, submit button. The route
      // mirrors the legacy web/src/cabinet.jsx form, which uses
      // a single combined <form data-testid="cabinet-create-form">.
      const createForm = panel.getByTestId("cabinet-create-form");
      await expect(createForm).toBeVisible();
      await expect(
        createForm.getByRole("textbox", { name: /title/i }),
      ).toBeVisible();
      await expect(
        createForm.getByRole("combobox", { name: /direction/i }),
      ).toBeVisible();
      await expect(
        createForm.getByRole("combobox", { name: /Document type/i }),
      ).toBeVisible();
      await expect(
        createForm.getByRole("textbox", { name: /linked.?id/i }),
      ).toBeVisible();
      await expect(
        createForm.getByRole("textbox", { name: /body/i }),
      ).toBeVisible();
      const submit = createForm.getByRole("button", { name: /create|save|add/i });
      await expect(submit).toBeVisible();

      // Back-link — every Pattern A app has a ChevronLeft link
      // pointing to /app (the Today hub). The legacy module
      // used "← back to Today" so the HREF is the most stable
      // assertion.
      const back = page.getByRole("link", { name: /back to Today/i });
      await expect(back).toBeVisible();
      await expect(back).toHaveAttribute("href", "/app");
    } finally {
      await page.context().close();
    }
  });
});
