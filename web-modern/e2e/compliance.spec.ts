/**
 * compliance.spec.ts — e2e coverage for the Phase 8.10 Pattern A
 * Compliance co-panel mounted inside the CFO dashboard
 * (/app/cfo).
 *
 * The co-panel calls GET /api/compliance/production-readiness on
 * mount, gated by the server's 5-role RBAC
 * (server/app.js#requireProductionReadinessReader:
 *   Owner, Admin, Accountant, Lawyer, Auditor). The default seeded
 * owner (see web-modern/e2e/_helpers.ts#DEFAULT_EMAIL) is in that
 * allowlist, so the panel renders with real data.
 *
 * What this asserts (the must-haves for "the co-panel works"):
 *   - GET /app/cfo returns 2xx (route resolves, auth works)
 *   - The H1 "CFO" is visible
 *   - The Compliance co-panel root (data-testid="compliance-readiness-panel")
 *     is visible inside the CFO workspace
 *   - The panel renders the Armenian-first H2
 *     ("Մասնագիտական վերանայման gate")
 *   - The three summary metrics (total / passed / blocked) are
 *     visible with numeric values
 *   - The status pill (data-testid="compliance-readiness-status")
 *     shows either "Ready" / "Blocked" with the matching Armenian
 *     gloss
 *   - The meta row exposes the "as of" date and the Armenian-first
 *     review flag ("production-ready" or "review required")
 *   - At least one gate row is rendered with a data-gate-key
 *     attribute and a pass/review badge
 *
 * Why a dedicated spec: the Compliance co-panel is mounted on the
 * CFO route (Pattern A), not its own sub-route. The CFO apps smoke
 * loop only checks the page shell; this spec confirms the
 * production-readiness data-testid contract holds end-to-end.
 */
import { test, expect } from "@playwright/test";
import { authedPage, waitForHydration } from "./_helpers";

test.describe("Compliance co-panel — production readiness on /app/cfo", () => {
  test("loads inside CFO, paints the panel, summary, status pill, and meta row", async ({
    browser,
    request,
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      const response = await page.goto("/app/cfo");
      expect(
        response,
        `expected /app/cfo to respond (got ${response?.status()})`,
      ).not.toBeNull();
      expect([200, 304]).toContain(response!.status());

      await waitForHydration(page);

      // H1 — the screen header. The CFO route renders the plain
      // "CFO" heading (matches the legacy web/src/cfo.jsx pattern).
      await expect(
        page.getByRole("heading", { level: 1, name: /^CFO$/ }),
      ).toBeVisible();

      // Panel root. data-testid="compliance-readiness-panel" is the
      // contract from web-modern/src/lib/compliance/ProductionReadinessPanel.tsx.
      const panel = page.getByTestId("compliance-readiness-panel");
      await expect(panel).toBeVisible();
      expect(panel.evaluate((el) => el.tagName.toLowerCase())).resolves.toBe(
        "article",
      );

      // Armenian-first H2 ("Professional review gate") with the
      // English gloss in parens.
      await expect(
        panel.getByRole("heading", {
          level: 2,
          name: /Մասնագիտական վերանայման gate/,
        }),
      ).toBeVisible();
      await expect(panel.getByText(/Professional review gate/)).toBeVisible();

      // Three summary metrics. The default seed has at least the
      // two rate gates (VAT + payroll); legal sources may be
      // missing — total can be 3 if all 3 legal sources are seeded
      // as missing, but the sum is always >= 2 (the two rate
      // gates). We assert the labels are present, not the exact
      // count, to keep the spec robust against seed changes.
      const total = panel.getByTestId("compliance-readiness-summary-total");
      const passed = panel.getByTestId("compliance-readiness-summary-passed");
      const blocked = panel.getByTestId("compliance-readiness-summary-blocked");
      await expect(total).toBeVisible();
      await expect(passed).toBeVisible();
      await expect(blocked).toBeVisible();
      // Each metric value should parse as a non-negative integer.
      const totalN = Number((await total.innerText()).match(/\d+/)?.[0] ?? "-1");
      const passedN = Number(
        (await passed.innerText()).match(/\d+/)?.[0] ?? "-1",
      );
      const blockedN = Number(
        (await blocked.innerText()).match(/\d+/)?.[0] ?? "-1",
      );
      expect(totalN).toBeGreaterThanOrEqual(2);
      expect(passedN).toBeGreaterThanOrEqual(0);
      expect(blockedN).toBeGreaterThanOrEqual(0);
      expect(passedN + blockedN).toBe(totalN);

      // Status pill. data-status is "ready" or "blocked" and the
      // pill contains the matching English + Armenian label.
      const status = panel.getByTestId("compliance-readiness-status");
      await expect(status).toBeVisible();
      const dataStatus = await status.getAttribute("data-status");
      expect(["ready", "blocked"]).toContain(dataStatus);
      if (dataStatus === "ready") {
        await expect(status).toContainText("Ready");
        await expect(status).toContainText("Պատրաստ է");
      } else {
        await expect(status).toContainText("Blocked");
        await expect(status).toContainText("Արգելափակված է");
      }

      // Meta row: "as of {date}" + Armenian-first review flag.
      const asOf = panel.getByTestId("compliance-readiness-as-of");
      await expect(asOf).toBeVisible();
      await expect(asOf).toContainText(/as of \d{4}-\d{2}-\d{2}/);

      const flag = panel.getByTestId("compliance-readiness-review-flag");
      await expect(flag).toBeVisible();
      if (dataStatus === "ready") {
        await expect(flag).toContainText("Արտադրական պատրաստ");
      } else {
        await expect(flag).toContainText("Վերանայում է պահանջվում");
      }

      // At least one gate row, with a data-gate-key matching the
      // seeded domain. The two tax-rate gates are the most
      // stable against seed churn, so we check for one of those
      // and a single, well-formed pass/review badge.
      const gateRow = panel
        .getByTestId("compliance-readiness-gate-row")
        .filter({ has: page.locator("[data-gate-key]") })
        .first();
      await expect(gateRow).toBeVisible();
      const gateKey = await gateRow.getAttribute("data-gate-key");
      expect(gateKey).toMatch(/^(tax-rate-vat-current|tax-rate-payroll-current|law-[a-z-]+)$/);
      const gatePass = await gateRow.getAttribute("data-pass");
      expect(["true", "false"]).toContain(gatePass);
    } finally {
      await page.context().close();
    }
  });
});
