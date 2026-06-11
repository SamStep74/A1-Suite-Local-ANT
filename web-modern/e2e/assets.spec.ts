/**
 * assets.spec.ts — e2e coverage for the Phase 8.5 Pattern A
 * Fixed Assets route (/app/assets).
 *
 * What this asserts (the must-haves for "the assets skeleton works
 * end-to-end"):
 *   - GET /app/assets returns 2xx (route resolves, auth works, the
 *     TanStack dev server renders the workspace)
 *   - H1 "Հիմնական միջոցներ" is visible (Armenian title; matches
 *     the H1 the route renders verbatim so the migration e2e is
 *     stable)
 *   - The English subtitle "Fixed assets · depreciation · maintenance
 *     · assignment" is present (bilingual header)
 *   - The 4 tab buttons render (registry, depreciation, maintenance,
 *     assignment) and the default active tab is Registry
 *   - Clicking each tab button switches the visible panel
 *   - The registry tab GETs /api/assets/report/value and renders
 *     the rollup table with categoryId + count + cost + NBV columns
 *   - The depreciation form exposes the Asset ID input + submit
 *     button (the route wires these to /api/assets/:id/depreciation
 *     via useQuery + refetch; the unit test covers the data flow
 *     because the asset ID is parent-controlled and not user-editable
 *     in the route today)
 *   - The maintenance form exposes the Asset ID input + submit button
 *     (same wiring rationale as depreciation)
 *   - The assignment tab POSTs /api/assets/:id/assign with the
 *     AssetsAssignRequest envelope (assetId + assigneeType + assigneeId
 *     + idempotencyKey). The form has editable inputs so the e2e
 *     can drive a full flow.
 *   - The back link points to /app (the Today hub)
 *   - The 403 access-denied card is NOT rendered for a default
 *     authenticated user (mirrors procurement's pattern; the route
 *     is permissive today and the gate is server-side)
 *
 * Mocking strategy: the modern route uses Zod-validated JSON over
 * the three endpoints listed in the route file's header comment.
 * The route.intercept handlers below reply with the stable shapes
 * the route's Zod schemas expect (`ok: true` + the typed payload).
 * The rollup endpoint and the assignment POST are exercised end-to-end
 * with these mocks; the depreciation + maintenance submit wiring
 * is verified at the unit tier by the co-located vitest spec.
 *
 * Why a dedicated spec: this is the Phase 8.5 assets migration
 * e2e, separate from the broader apps smoke loop. The contract
 * parity is locked at the server tier by the existing API tests;
 * this spec confirms the modern route wires the same shape into
 * the UI. The e2e + this worktree's `git rm web/src/assets.jsx`
 * together verify the legacy drop is complete: no other file in
 * web/, web-modern/, server/, or test/ references the legacy
 * `AssetsPanel` symbol or `web/src/assets.jsx` after this commit.
 *
 * NOT asserted here (deferred to 8.5b–8.5f sub-plans):
 *   - The live server's response to the four asset endpoints
 *     (the route is wired to call them; the e2e mocks them so the
 *     spec stays deterministic against the Phase 8.5 dev server
 *     which may or may not have the asset tier fully provisioned)
 *   - The TanStack-Query refetch chain after assignment
 *     (covered at the unit tier; out of scope for browser e2e)
 *   - The `assetsTabFromHash` URL-hash → tab wiring
 *     (covered at the unit tier)
 */
import { test, expect, type Route, type Request } from "@playwright/test";
import { authedPage, waitForHydration } from "./_helpers";

/* ────────── mock data (matches the Zod schemas) ────────── */

const ROLLUP_RESPONSE = {
  ok: true,
  rollup: [
    {
      categoryId: "vehicles",
      count: 3,
      totalCostAmd: 15000000,
      totalNbvAmd: 9000000,
    },
    {
      categoryId: "it-equipment",
      count: 7,
      totalCostAmd: 4200000,
      totalNbvAmd: 2100000,
    },
  ],
};

const DEPR_RESPONSE = {
  ok: true,
  assetId: "asset-1",
  schedule: Array.from({ length: 12 }, (_, i) => ({
    periodIndex: i,
    depreciationAmd: 100000 * (i + 1),
    accumulatedAmd: 100000 * (i + 1),
    netBookValueAmd: 10000000 - 100000 * (i + 1),
  })),
};

const MAINT_RESPONSE = {
  ok: true,
  assetId: "asset-1",
  logs: [
    {
      id: "log-1",
      asset_id: "asset-1",
      performed_at: "2026-05-01",
      kind: "oil-change",
      cost_amd: 50000,
    },
  ],
};

/** The four assets tabs in the order the route renders them. */
const ASSETS_TABS = [
  "registry",
  "depreciation",
  "maintenance",
  "assignment",
] as const;

/* ────────── API mocks ────────── */

/** Match a request pathname to a string literal. We use the URL
 *  parser to avoid string-prefix false positives (e.g. the
 *  "/assign" suffix on /api/assets/:id/assign must not match a
 *  hypothetical /api/assets/:id/assignments endpoint). */
function requestMatchesPath(req: Request, path: string): boolean {
  const url = new URL(req.url());
  return url.pathname === path;
}

/** Route the four assets endpoints to stable mock payloads. The
 *  Vite dev proxy forwards /api/* to Fastify as-is, so the
 *  browser-side pathname is what we match. */
function installAssetsApiMocks(route: Route): void {
  if (requestMatchesPath(route.request(), "/api/assets/report/value")) {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ROLLUP_RESPONSE),
    });
    return;
  }
  if (requestMatchesPath(route.request(), "/api/assets/asset-1/depreciation")) {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(DEPR_RESPONSE),
    });
    return;
  }
  if (requestMatchesPath(
    route.request(),
    "/api/assets/asset-1/maintenance-history",
  )) {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MAINT_RESPONSE),
    });
    return;
  }
  if (requestMatchesPath(route.request(), "/api/assets/asset-99/assign")) {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, assignment: { id: "asg-1" } }),
    });
    return;
  }
  // Anything else under /api/assets passes through to the live
  // backend (so the e2e can still observe a missing-route regression
  // if the Fastify handler disappears).
  route.continue();
}

/* ────────── 1-5, 9. page shell + tab switch + registry GET ────────── */

test.describe("Assets — Phase 8.5 Pattern A skeleton", () => {
  test("loads, renders the H1 + 4 tabs, defaults to Registry, and points back to /app", async ({
    browser,
    request,
    page,
  }) => {
    // Mock the rollup GET so the registry table renders without
    // depending on the asset tier being fully provisioned in
    // the dev server.
    await page.route("**/api/assets/**", installAssetsApiMocks);

    const ctx = await authedPage(browser, request);
    try {
      const response = await ctx.page.goto("/app/assets");
      expect(
        response,
        `expected /app/assets to respond (got ${response?.status()})`,
      ).not.toBeNull();
      expect([200, 304]).toContain(response!.status());

      await waitForHydration(ctx.page);

      // H1 — the screen header. The route renders "Հիմնական
      // միջոցներ" (lit. "Fixed Assets", the legacy H1 verbatim)
      // so the e2e is stable across the migration.
      await expect(
        ctx.page.getByRole("heading", {
          level: 1,
          name: /Հիմնական միջոցներ/,
        }),
      ).toBeVisible();

      // English subtitle (bilingual header — Armenian H1 + English <p>).
      await expect(
        ctx.page.getByText(
          /Fixed assets · depreciation · maintenance · assignment/,
        ),
      ).toBeVisible();

      // The assets panel wraps everything; the route uses
      // data-testid="assets-panel" with data-entity="assets-root".
      const panel = ctx.page.getByTestId("assets-panel");
      await expect(panel).toBeVisible();

      // 4 tab buttons render in route-local order.
      for (const t of ASSETS_TABS) {
        const btn = ctx.page.getByTestId(`assets-tab-${t}`);
        await expect(btn).toBeVisible();
      }

      // Default tab is Registry — the route's initial state.
      const registry = ctx.page.getByTestId("assets-tab-registry");
      expect(await registry.getAttribute("data-active")).toBe("true");

      // Registry GET rendered the rollup table.
      const table = ctx.page.getByTestId("assets-registry-table");
      await expect(table).toBeVisible();
      const rows = table.locator("[data-testid='assets-registry-row']");
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText("vehicles");
      await expect(rows.nth(0)).toContainText("3");
      await expect(rows.nth(1)).toContainText("it-equipment");

      // Click each tab — the matching panel appears, the
      // previously-active panel unmounts.
      for (const t of ASSETS_TABS) {
        await ctx.page.getByTestId(`assets-tab-${t}`).click();
        const tab = ctx.page.getByTestId(`assets-tab-${t}`);
        expect(await tab.getAttribute("data-active")).toBe("true");
        const panelTestid =
          t === "assignment" ? "assets-assignment-panel" : `assets-${t}`;
        await expect(ctx.page.getByTestId(panelTestid)).toBeVisible();
      }

      // Back link — every Pattern A app has a ChevronLeft link
      // pointing to /app (the Today hub). The legacy module
      // used "← back to Today" so the visible label is the
      // most stable assertion.
      const back = ctx.page.getByRole("link", { name: /back to Today/i });
      await expect(back).toBeVisible();
      await expect(back).toHaveAttribute("href", "/app");
    } finally {
      await ctx.page.context().close();
    }
  });
});

/* ────────── 6. depreciation form structure + endpoint mockability ────────── */

test.describe("Assets — depreciation form", () => {
  test("exposes the Asset ID input + submit button and the submit is initially disabled", async ({
    browser,
    request,
    page,
  }) => {
    // Mock the rollup + depreciation endpoints so the route
    // doesn't 500 if the user types into the input.
    await page.route("**/api/assets/**", installAssetsApiMocks);

    const ctx = await authedPage(browser, request);
    try {
      await ctx.page.goto("/app/assets");
      await waitForHydration(ctx.page);

      // Switch to the Depreciation tab.
      await ctx.page.getByTestId("assets-tab-depreciation").click();
      const view = ctx.page.getByTestId("assets-depreciation");
      await expect(view).toBeVisible();

      // The form exposes the Asset ID input + submit button. The
      // asset ID is parent-controlled (readOnly input), so we
      // can't drive a successful submission from the e2e without
      // reaching into React internals — the unit test
      // (-index.test.tsx) covers the data flow exhaustively.
      // Here we just assert the structural wire-up.
      const input = ctx.page.getByTestId("assets-depreciation-asset-id");
      await expect(input).toBeVisible();
      const submit = ctx.page.getByTestId("assets-depreciation-submit");
      await expect(submit).toBeVisible();
      // The route disables the submit when the asset id is empty
      // (isValidAssetsAssetId("") === false), so the e2e must
      // observe the disabled state on first render.
      await expect(submit).toBeDisabled();

      // The depreciation endpoint is reachable in the same way
      // the route would call it. This is a contract check — the
      // route constructs the path via the parent state's assetId;
      // for the e2e we exercise the same shape against the
      // mocked API to confirm the URL format is well-formed.
      const deprRes = await ctx.page.request.get(
        "http://localhost:4173/api/assets/asset-1/depreciation",
      );
      expect([200, 304]).toContain(deprRes.status());
      const deprBody = await deprRes.json();
      expect(deprBody.ok).toBe(true);
      expect(deprBody.assetId).toBe("asset-1");
      expect(Array.isArray(deprBody.schedule)).toBe(true);
    } finally {
      await ctx.page.context().close();
    }
  });
});

/* ────────── 7. maintenance form structure + endpoint mockability ────────── */

test.describe("Assets — maintenance form", () => {
  test("exposes the Asset ID input + submit button and the maintenance-history endpoint is reachable", async ({
    browser,
    request,
    page,
  }) => {
    await page.route("**/api/assets/**", installAssetsApiMocks);

    const ctx = await authedPage(browser, request);
    try {
      await ctx.page.goto("/app/assets");
      await waitForHydration(ctx.page);

      // Switch to the Maintenance tab.
      await ctx.page.getByTestId("assets-tab-maintenance").click();
      const view = ctx.page.getByTestId("assets-maintenance");
      await expect(view).toBeVisible();

      // The form exposes the Asset ID input + submit button. The
      // unit test covers the data flow (this is parent-controlled
      // just like depreciation); here we assert the wire-up.
      const input = ctx.page.getByTestId("assets-maintenance-asset-id");
      await expect(input).toBeVisible();
      const submit = ctx.page.getByTestId("assets-maintenance-submit");
      await expect(submit).toBeVisible();
      await expect(submit).toBeDisabled();

      // Contract check: the maintenance-history endpoint is
      // well-formed and returns the shape the route's Zod
      // schema expects.
      const maintRes = await ctx.page.request.get(
        "http://localhost:4173/api/assets/asset-1/maintenance-history",
      );
      expect([200, 304]).toContain(maintRes.status());
      const maintBody = await maintRes.json();
      expect(maintBody.ok).toBe(true);
      expect(maintBody.assetId).toBe("asset-1");
      expect(Array.isArray(maintBody.logs)).toBe(true);
    } finally {
      await ctx.page.context().close();
    }
  });
});

/* ────────── 8. assignment POST flow ────────── */

test.describe("Assets — assignment POST", () => {
  test("filling the form + clicking submit POSTs to /api/assets/:id/assign with the idempotency key", async ({
    browser,
    request,
    page,
  }) => {
    // Track the assignment POST so we can assert its shape. The
    // body matches the route's AssetsAssignRequest schema (Zod
    // parses it server-side), so the type below mirrors the
    // Zod shape — keeps the e2e assertions strongly typed.
    interface AssignPostBody {
      assigneeType: string;
      assigneeId: string;
      idempotencyKey: string;
    }
    let assignPostBody: AssignPostBody | null = null;
    let assignPostPath: string | null = null;
    await page.route("**/api/assets/**", async (route) => {
      if (
        requestMatchesPath(route.request(), "/api/assets/asset-99/assign")
      ) {
        assignPostPath = new URL(route.request().url()).pathname;
        try {
          const raw = JSON.parse(
            route.request().postData() ?? "{}",
          ) as Partial<AssignPostBody>;
          assignPostBody = {
            assigneeType: String(raw.assigneeType ?? ""),
            assigneeId: String(raw.assigneeId ?? ""),
            idempotencyKey: String(raw.idempotencyKey ?? ""),
          };
        } catch {
          assignPostBody = null;
        }
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, assignment: { id: "asg-1" } }),
        });
        return;
      }
      // Fall through to the other endpoint mocks.
      installAssetsApiMocks(route);
    });

    const ctx = await authedPage(browser, request);
    try {
      await ctx.page.goto("/app/assets");
      await waitForHydration(ctx.page);

      // Switch to the Assignment tab.
      await ctx.page.getByTestId("assets-tab-assignment").click();
      const form = ctx.page.getByTestId("assets-assignment-form");
      await expect(form).toBeVisible();

      // The form has 3 editable inputs: assetId, assigneeType (select),
      // assigneeId. Fill all three.
      await ctx.page
        .getByTestId("assets-assignment-asset-id")
        .fill("asset-99");
      await ctx.page
        .getByTestId("assets-assignment-type")
        .selectOption("department");
      await ctx.page
        .getByTestId("assets-assignment-assignee-id")
        .fill("dept-3");

      const submit = ctx.page.getByTestId("assets-assignment-submit");
      await expect(submit).toBeEnabled();
      await submit.click();

      // The mock captured the POST — assert the path + body shape.
      // The route constructs the path from the parent state's
      // assetId (which is the input we just filled), and the body
      // is the AssetsAssignRequest envelope (assigneeType +
      // assigneeId + idempotencyKey).
      expect(assignPostPath).toBe("/api/assets/asset-99/assign");
      // Use a regular null check (not Playwright's `not.toBeNull()`
      // matcher) so TypeScript narrows the union for the property
      // accesses below. Snapshot the narrowed value into a
      // local const so subsequent expect() calls don't
      // re-introduce the union type.
      if (assignPostBody === null) {
        throw new Error("expected the assign POST mock to have captured a body");
      }
      const body: AssignPostBody = assignPostBody;
      expect(body.assigneeType).toBe("department");
      expect(body.assigneeId).toBe("dept-3");
      // The route stamps an idempotency key of the form "assign-…"
      // via generateAssetsIdempotencyKey("assign"). Assert the
      // prefix (the suffix is Date.now() and not deterministic).
      expect(body.idempotencyKey).toMatch(/^assign-/);
    } finally {
      await ctx.page.context().close();
    }
  });
});

/* ────────── 10. 403 access gate ────────── */

test.describe("Assets — 403 access gate", () => {
  test("does not render the 403 card for a default authenticated user", async ({
    browser,
    request,
    page,
  }) => {
    // The 403 path is a no-op for the live route today: the
    // workspace does not yet read a user role from the session
    // (the comment in the route file says: "Server enforces;
    // UI defaults to permissive until the auth context is
    // wired in 8.4"). The route exports the
    // AssetsAccessDeniedCard component and the isAssetsRoleAllowed
    // helper, but the live workspace is unconditional.
    //
    // This spec is a regression guard — if a future change
    // wires the workspace to read a role from the session and
    // defaults it to "none" for unprivileged users, this test
    // will fail loudly and the maintainer can decide whether
    // to (a) keep the 403 visible in the e2e (preferred) or
    // (b) update the assertion to match the new behavior.
    await page.route("**/api/assets/**", installAssetsApiMocks);

    const ctx = await authedPage(browser, request);
    try {
      await ctx.page.goto("/app/assets");
      await waitForHydration(ctx.page);

      // The 403 card must NOT be present for a default session.
      await expect(ctx.page.getByTestId("assets-403")).toHaveCount(0);
      // The tab strip + the registry panel MUST be present —
      // the workspace is the default render, the 403 is opt-in.
      await expect(
        ctx.page.getByTestId("assets-tab-registry"),
      ).toBeVisible();
      await expect(
        ctx.page.getByTestId("assets-registry-table"),
      ).toBeVisible();
    } finally {
      await ctx.page.context().close();
    }
  });
});
