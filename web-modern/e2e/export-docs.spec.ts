/**
 * export-docs.spec.ts — e2e coverage for the Phase 8.9 Pattern A
 * Export Documentation wizard route (/app/cfo/export-docs).
 *
 * What this asserts (the must-haves for "the wizard skeleton works"):
 *   - GET /app/cfo/export-docs returns 2xx (route resolves, auth works)
 *   - H1 "Արտահանման փաստաթղթեր" (Armenian title) is visible
 *   - The English subtitle ("Export documentation wizard") is present
 *   - The 4-step wizard step indicators render (1/2/3/4) and the
 *     default step is 1
 *   - The Next button on step 1 is DISABLED until a template is chosen
 *   - Step 1 → step 2: choosing a template and clicking Next
 *     POSTs to /api/export-docs/ai/auto-fill and renders the draft
 *   - Step 2 → step 3: clicking Validate GETs
 *     /api/export-docs/ai/country-check and renders the validation
 *   - Step 3 → step 4: clicking Finalize POSTs to /api/export-docs
 *     (create) and /api/export-docs/{id}/finalize (finalize) and
 *     renders the "finalized" panel
 *   - Step 4 "Start new" resets the wizard back to step 1
 *   - The back link points to /app/cfo (the CFO hub, with the
 *     `view=cash-flow` search that the cfo hub expects)
 *   - The 403 card is NOT rendered in the default e2e session
 *     (mirrors state-integrations.spec.ts — auth is not yet wired
 *     in 8.x; the `export-docs-forbidden` branch is exercised by
 *     the co-located unit test 13 via vi.mocked useUserAccess)
 *
 * Mocking strategy: the modern route uses Zod-validated JSON over
 * the two AI endpoints + the create + finalize POSTs. We mock all
 * four endpoints to stable shapes matching the Zod schemas so the
 * e2e exercises the route's UI + helper formatting
 * (formatExportDocLinePreview, formatExportDocRequiredCertificates,
 * formatExportDocStatusLabelAm) without depending on live
 * export_documents rows. The route reads `response.draft` /
 * `response.exportDoc` from structural casts, so the mocks only
 * need to ship the fields the route actually consumes.
 *
 * Why a dedicated spec: this is the Phase 8.9 export-docs migration
 * e2e, separate from the broader apps smoke loop. The contract
 * parity is locked at the server tier by the exportDocs engine
 * (server/exportDocs.js); this spec confirms the modern route wires
 * the same shape into the UI. The e2e + this worktree's
 * `git rm web/src/exportDocs.jsx` together verify the legacy drop
 * is complete: no other file in web/, web-modern/, server/, or
 * test/ references the legacy `ExportDocsPanel` symbol or
 * `web/src/exportDocs.jsx` after this commit.
 *
 * NOT asserted here (deferred to 8.9b–8.9f sub-plans):
 *   - The 6 destination country options are exhaustively listed
 *     (covered at the unit tier by EXPORT_DOC_DESTINATIONS)
 *   - The Armenian-formatted required certificates join
 *     (covered at the unit tier; the e2e just asserts the row
 *     renders)
 *   - The 403 client-side gate via useUserAccess("cfo") (covered
 *     at the unit tier; the e2e just confirms the gate is
 *     permissive in the default session)
 *   - The deep-link hash round-trip (exportDocStepFromHash /
 *     exportDocStepToHash) — covered at the unit tier
 */
import { test, expect, type Route, type Request } from "@playwright/test";
import { authedPage, waitForHydration } from "./_helpers";

/* ────────── mock data (matches the Zod schemas) ────────── */

const TEMPLATE_KIND = "invoice" as const;
const COUNTRY = "RU" as const;
const PRODUCT_ID = "demo-tomato";

const DRAFT = {
  destinationCountry: COUNTRY,
  incoterm: "CIF",
  currency: "USD",
  lines: [
    {
      description: "Tomatoes (Cherry)",
      hsCode: "0702",
      quantity: 1000,
      uom: "kg",
    },
  ],
};

const VALIDATION = {
  destinationCountry: COUNTRY,
  pack: {
    requiredCertificates: ["COO", "Phyto"],
  },
  hsNote: "HS 0702 — Tomatoes, fresh or chilled.",
};

const EXPORT_DOC_ID = "expdoc-e2e-001";
const FINALIZED_AT = "2026-06-12T10:00:00Z";

/* ────────── API mocks ────────── */

/** Match a request pathname to a string literal. We use the URL
 *  parser to avoid string-prefix false positives. */
function requestMatchesPath(req: Request, path: string): boolean {
  const url = new URL(req.url());
  const normalized = url.pathname.replace(/\/$/, "") || "/";
  return normalized === path;
}

/** Match a POST to the finalize endpoint with the
 *  /api/export-docs/:id/finalize shape. */
function requestMatchesFinalize(req: Request): boolean {
  if (req.method() !== "POST") return false;
  const url = new URL(req.url());
  return /^\/api\/export-docs\/[^/]+\/finalize$/.test(url.pathname);
}

/** Route the two AI endpoints + the create + finalize endpoints to
 *  stable mock payloads. */
async function installExportDocsApiMocks(route: Route): Promise<void> {
  if (
    requestMatchesPath(route.request(), "/api/export-docs/ai/auto-fill") &&
    route.request().method() === "POST"
  ) {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, draft: DRAFT }),
    });
    return;
  }
  if (
    requestMatchesPath(route.request(), "/api/export-docs/ai/country-check") &&
    route.request().method() === "GET"
  ) {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(VALIDATION),
    });
    return;
  }
  if (
    requestMatchesPath(route.request(), "/api/export-docs") &&
    route.request().method() === "POST"
  ) {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        exportDoc: {
          id: EXPORT_DOC_ID,
          kind: TEMPLATE_KIND,
          destinationCountry: COUNTRY,
          incoterm: DRAFT.incoterm,
          currency: DRAFT.currency,
          status: "draft",
          lines: DRAFT.lines,
          createdAt: FINALIZED_AT,
        },
      }),
    });
    return;
  }
  if (requestMatchesFinalize(route.request())) {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        exportDocId: EXPORT_DOC_ID,
        status: "finalized",
        finalizedAt: FINALIZED_AT,
      }),
    });
    return;
  }
  // Anything else under /api/export-docs passes through to the live
  // backend (so the e2e can still observe a missing-route
  // regression if the Fastify handler disappears).
  await route.continue();
}

/* ────────── page shell + H1 + 4 steps + back link + 403 absence ────────── */

test.describe("Export Docs — Phase 8.9 Pattern A skeleton", () => {
  test("loads, renders the H1 + English subtitle + 4 steps + back link, and is permissive in the e2e session", async ({
    browser,
    request,
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      const response = await page.goto("/app/cfo/export-docs");
      expect(
        response,
        `expected /app/cfo/export-docs to respond (got ${response?.status()})`,
      ).not.toBeNull();
      expect([200, 304]).toContain(response!.status());

      await waitForHydration(page);

      // Panel — the route wraps every state in
      // data-testid="export-docs-panel" (mirrors cabinet/state-int).
      const panel = page.getByTestId("export-docs-panel");
      await expect(panel).toBeVisible();

      // H1 — the Armenian title (mirrors the legacy H2 string
      // "Արտահանման փաստաթղթեր" verbatim so the e2e is
      // stable across the migration).
      const title = page.getByTestId("export-docs-title");
      await expect(title).toBeVisible();
      await expect(title).toHaveText("Արտահանման փաստաթղթեր");

      // English subtitle — every Pattern A app renders an English
      // subtitle under the H1. The export-docs subtitle is "Export
      // documentation wizard" (matches the legacy H2 string).
      await expect(
        panel.getByText(/Export documentation wizard/),
      ).toBeVisible();

      // 4 step indicators — the wizard has a 4-step state machine
      // (select → auto-fill → validation → done). Each step is
      // marked with a numbered <li data-testid="export-docs-step-N">.
      for (const n of [1, 2, 3, 4]) {
        await expect(
          page.getByTestId(`export-docs-step-${n}`),
        ).toHaveCount(1);
      }

      // Default step is 1 — the StepIndicator marks the current
      // step with `aria-current="step"`. Only step 1 should be
      // marked on a fresh page load.
      await expect(
        page.getByTestId("export-docs-step-1"),
      ).toHaveAttribute("aria-current", "step");
      for (const n of [2, 3, 4]) {
        await expect(
          page.getByTestId(`export-docs-step-${n}`),
        ).not.toHaveAttribute("aria-current", "step");
      }

      // Step 1 is visible by default (the SelectStep panel renders
      // the template + country selects + a disabled Next button).
      const step1 = page.getByTestId("export-docs-step-1-panel");
      await expect(step1).toBeVisible();
      const templateSelect = page.getByTestId("export-docs-template-select");
      await expect(templateSelect).toBeVisible();
      const countrySelect = page.getByTestId("export-docs-country-select");
      await expect(countrySelect).toBeVisible();

      // Next button is DISABLED until a template is chosen.
      const nextButton = page.getByTestId("export-docs-next-button");
      await expect(nextButton).toBeVisible();
      await expect(nextButton).toBeDisabled();

      // Back link — the route renders a ChevronLeft link to
      // /app/cfo with the `view=cash-flow` search that the CFO
      // hub uses. We assert the visible label + the href.
      const back = page.getByTestId("export-docs-back");
      await expect(back).toBeVisible();
      await expect(back).toHaveAttribute("href", "/app/cfo?view=cash-flow");

      // 403 — the route is permissive in the browser e2e because
      // the useUserAccess("cfo") hook defaults to true when no
      // auth context is provided (auth is not yet wired in 8.x).
      // The ForbiddenPanel branch is exercised by the co-located
      // unit test 13 via vi.mocked useUserAccess. The e2e
      // regression-gates the absence.
      await expect(page.getByTestId("export-docs-forbidden")).toHaveCount(0);
    } finally {
      await page.context().close();
    }
  });
});

/* ────────── 4-step wizard flow ────────── */

test.describe("Export Docs — 4-step wizard flow", () => {
  test("selecting a template, validating, finalizing, and starting new walks the full 4-step state machine", async ({
    browser,
    request,
  }) => {
    let autoFillBody: { destinationCountry?: string } | null = null;
    let countryCheckUrl: string | null = null;
    let createBody: { kind?: string; idempotencyKey?: string } | null = null;
    let finalizePath: string | null = null;

    const ctx = await authedPage(browser, request);
    await ctx.page.route("**/api/export-docs**", async (route) => {
      const req = route.request();

      // Capture the auto-fill POST body for the destinationCountry
      // assertion (it must echo the country the user picked).
      if (
        requestMatchesPath(req, "/api/export-docs/ai/auto-fill") &&
        req.method() === "POST"
      ) {
        try {
          autoFillBody = JSON.parse(req.postData() ?? "{}") as {
            destinationCountry?: string;
          };
        } catch {
          autoFillBody = null;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, draft: DRAFT }),
        });
        return;
      }

      // Capture the country-check GET URL for the query-string
      // assertion (must include both country + productId).
      if (
        requestMatchesPath(req, "/api/export-docs/ai/country-check") &&
        req.method() === "GET"
      ) {
        countryCheckUrl = req.url();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(VALIDATION),
        });
        return;
      }

      // Capture the create POST body for the kind + idempotency
      // assertions.
      if (
        requestMatchesPath(req, "/api/export-docs") &&
        req.method() === "POST"
      ) {
        try {
          createBody = JSON.parse(req.postData() ?? "{}") as {
            kind?: string;
            idempotencyKey?: string;
          };
        } catch {
          createBody = null;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            exportDoc: {
              id: EXPORT_DOC_ID,
              kind: TEMPLATE_KIND,
              destinationCountry: COUNTRY,
              incoterm: DRAFT.incoterm,
              currency: DRAFT.currency,
              status: "draft",
              lines: DRAFT.lines,
              createdAt: FINALIZED_AT,
            },
          }),
        });
        return;
      }

      // Capture the finalize POST path for the {id} assertion.
      if (requestMatchesFinalize(req)) {
        finalizePath = new URL(req.url()).pathname;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            exportDocId: EXPORT_DOC_ID,
            status: "finalized",
            finalizedAt: FINALIZED_AT,
          }),
        });
        return;
      }

      await installExportDocsApiMocks(route);
    });

    try {
      await ctx.page.goto("/app/cfo/export-docs");
      await waitForHydration(ctx.page);

      /* ── step 1: pick template → Next ──────────────────────── */
      const templateSelect = ctx.page.getByTestId(
        "export-docs-template-select",
      );
      await expect(templateSelect).toBeVisible();
      await templateSelect.selectOption(TEMPLATE_KIND);

      // The Next button is enabled once a template is chosen.
      const nextButton = ctx.page.getByTestId("export-docs-next-button");
      await expect(nextButton).toBeEnabled();
      await nextButton.click();

      // The auto-fill POST landed on the AI endpoint with the
      // user's selected country echoed in the body.
      expect(autoFillBody).not.toBeNull();
      const autoFill: { destinationCountry?: string } = autoFillBody!;
      expect(autoFill.destinationCountry).toBe(COUNTRY);

      /* ── step 2: draft + Validate ──────────────────────────── */
      // The wizard advances to step 2 and renders the auto-filled
      // draft. The StepIndicator marks step 2 as current.
      const step2 = ctx.page.getByTestId("export-docs-step-2-panel");
      await expect(step2).toBeVisible();
      await expect(
        ctx.page.getByTestId("export-docs-step-2"),
      ).toHaveAttribute("aria-current", "step");
      const draft = ctx.page.getByTestId("export-docs-draft");
      await expect(draft).toBeVisible();
      // The draft preview renders the destinationCountry +
      // incoterm + currency in the form expected by the helper.
      await expect(draft).toContainText(COUNTRY);
      await expect(draft).toContainText("CIF");
      await expect(draft).toContainText("USD");

      const validateButton = ctx.page.getByTestId(
        "export-docs-validate-button",
      );
      await expect(validateButton).toBeEnabled();
      await validateButton.click();

      // The country-check GET landed with the country + productId
      // in the query string.
      expect(countryCheckUrl).not.toBeNull();
      const checkUrl = new URL(countryCheckUrl!);
      expect(checkUrl.pathname).toBe("/api/export-docs/ai/country-check");
      expect(checkUrl.searchParams.get("country")).toBe(COUNTRY);
      expect(checkUrl.searchParams.get("productId")).toBe(PRODUCT_ID);

      /* ── step 3: validation + Finalize ─────────────────────── */
      const step3 = ctx.page.getByTestId("export-docs-step-3-panel");
      await expect(step3).toBeVisible();
      await expect(
        ctx.page.getByTestId("export-docs-step-3"),
      ).toHaveAttribute("aria-current", "step");
      const validation = ctx.page.getByTestId("export-docs-validation");
      await expect(validation).toBeVisible();
      // The validation block renders the destinationCountry +
      // the required-certificates list + the optional hsNote.
      await expect(validation).toContainText(COUNTRY);
      await expect(validation).toContainText("COO");
      await expect(validation).toContainText("Phyto");
      await expect(validation).toContainText("HS 0702");

      const finalizeButton = ctx.page.getByTestId(
        "export-docs-finalize-button",
      );
      await expect(finalizeButton).toBeEnabled();
      await finalizeButton.click();

      // The create POST landed on /api/export-docs with the
      // expected kind + idempotency-key prefix.
      await expect.poll(() => createBody).not.toBeNull();
      const create: { kind?: string; idempotencyKey?: string } = createBody!;
      expect(create.kind).toBe(TEMPLATE_KIND);
      expect(typeof create.idempotencyKey).toBe("string");
      expect(create.idempotencyKey).toMatch(/^ui-create-\d+$/);

      // The finalize POST landed on /api/export-docs/{id}/finalize
      // with the created exportDoc's id.
      await expect
        .poll(() => finalizePath)
        .toBe(`/api/export-docs/${EXPORT_DOC_ID}/finalize`);

      /* ── step 4: finalized + Start new ─────────────────────── */
      const step4 = ctx.page.getByTestId("export-docs-step-4-panel");
      await expect(step4).toBeVisible();
      await expect(
        ctx.page.getByTestId("export-docs-step-4"),
      ).toHaveAttribute("aria-current", "step");
      const finalized = ctx.page.getByTestId("export-docs-finalized");
      await expect(finalized).toBeVisible();
      // The finalized panel renders the created document id +
      // the Armenian-formatted status label.
      await expect(finalized).toContainText(EXPORT_DOC_ID);
      // The Armenian status label for "finalized" is "Ավարտված".
      await expect(finalized).toContainText("Ավարտված");

      // Start new — the wizard resets to step 1, the draft /
      // validation / finalized panels all disappear, and the
      // template select is back to the empty placeholder.
      const startNew = ctx.page.getByTestId("export-docs-start-new");
      await expect(startNew).toBeEnabled();
      await startNew.click();
      await expect(
        ctx.page.getByTestId("export-docs-step-1-panel"),
      ).toBeVisible();
      await expect(
        ctx.page.getByTestId("export-docs-step-1"),
      ).toHaveAttribute("aria-current", "step");
      await expect(
        ctx.page.getByTestId("export-docs-draft"),
      ).toHaveCount(0);
      await expect(
        ctx.page.getByTestId("export-docs-validation"),
      ).toHaveCount(0);
      await expect(
        ctx.page.getByTestId("export-docs-finalized"),
      ).toHaveCount(0);
    } finally {
      await ctx.page.context().close();
    }
  });
});
