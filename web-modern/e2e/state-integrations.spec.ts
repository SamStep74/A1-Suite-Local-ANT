/**
 * state-integrations.spec.ts — e2e coverage for the Phase 8.8 Pattern A
 * State Integrations route (/app/cfo/state-integrations).
 *
 * What this asserts (the must-haves for "the state-integrations hub
 * works end-to-end"):
 *   - GET /app/cfo/state-integrations returns 2xx (route resolves, auth
 *     works, the TanStack dev server renders the workspace)
 *   - The Armenian H1 "Կառավարության ինտեգրացիաներ" header renders
 *   - The MODE: test badge is present (the deterministic-stub marker)
 *   - The 6 adapter options render in the dispatch select (src,
 *     eregister, egov, idcard, mobileid, customs)
 *   - The dispatch flow POSTs to /api/state-int/src/submitVat and the
 *     last-result block (data-testid="state-int-result") renders with
 *     the mock's requestId, status, and signature preview
 *   - The audit panel (data-testid="state-int-audit") renders for an
 *     Owner/Admin/Auditor session, and clicking the refresh button
 *     re-issues GET /api/state-int/audit
 *   - The back link points to /app/cfo (the CFO hub, with the
 *     `view=cash-flow` search that the cfo hub expects)
 *   - The 403 card is NOT rendered in the default e2e session
 *     (mirrors greenhouse.spec.ts — the route is permissive in the
 *     browser because auth is not yet wired in 8.4; the
 *     `state-int-forbidden` branch is exercised by the co-located
 *     unit test 13 via vi.mocked useUserAccess)
 *
 * Mocking strategy: the modern route uses Zod-validated JSON over
 * the dispatch POST + audit GET. We mock both endpoints to stable
 * shapes matching the Zod schemas so the e2e exercises the route's
 * UI + helper formatting (formatStateIntLatency,
 * formatStateIntSignaturePreview, stateIntStatusLabelAm) without
 * depending on live state_integration_calls rows.
 *
 * Why a dedicated spec: this is the Phase 8.8 state-integrations
 * migration e2e, separate from the broader apps smoke loop. The
 * contract parity is locked at the server tier by
 * test/state-int-modern-parity.test.js (server-side surface mirror);
 * this spec confirms the modern route wires the same shape into
 * the UI. The e2e + this worktree's `git rm web/src/stateIntegrations.jsx`
 * together verify the legacy drop is complete: no other file in
 * web/, web-modern/, server/, or test/ references the legacy
 * `StateIntegrationsPanel` symbol or `web/src/stateIntegrations.jsx`
 * after this commit.
 *
 * NOT asserted here (deferred to 8.8b–8.8f sub-plans):
 *   - The TanStack-Query refetch chain after a successful dispatch
 *     (covered at the unit tier by the co-located vitest spec)
 *   - The Armenian-formatted audit row text from
 *     formatStateIntLatency + stateIntStatusLabelAm (covered at the
 *     unit tier; the e2e just asserts the row renders + the
 *     refresh re-issues the audit GET)
 *   - The 403 client-side gate via useUserAccess("cfo") (covered at
 *     the unit tier; the e2e just confirms the gate is permissive
 *     in the default session)
 *   - The 6 per-adapter operations beyond submitVat (the default
 *     adapter is src → submitVat; switching adapters is covered at
 *     the unit tier by the `adapter change resets operation + payload`
 *     case)
 */
import { test, expect, type Route, type Request } from "@playwright/test";
import { authedPage, waitForHydration } from "./_helpers";

/* ────────── mock data (matches the Zod schemas) ────────── */

const REQUEST_ID = "req-e2e-state-int-001";
const ADAPTER = "src";
const OPERATION = "submitVat";
const SIGNATURE_B64 = "A".repeat(64);
const THUMBPRINT = "ab12cd34ef5678901234567890abcdef12345678";

/** The six adapter ids in the order the route renders them.
 *  Mirrors STATE_INT_ADAPTERS in web-modern/src/lib/state-int/status.ts. */
const EXPECTED_ADAPTER_IDS = [
  "src",
  "eregister",
  "egov",
  "idcard",
  "mobileid",
  "customs",
] as const;

/* ────────── API mocks ────────── */

/** Match a request pathname to a string literal. We use the URL
 *  parser to avoid string-prefix false positives. */
function requestMatchesPath(req: Request, path: string): boolean {
  const url = new URL(req.url());
  return url.pathname === path;
}

/** Match a POST to the dispatch endpoint with the
 *  /api/state-int/:adapter/:operation shape. */
function requestMatchesDispatch(req: Request): boolean {
  if (req.method() !== "POST") return false;
  const url = new URL(req.url());
  return /^\/api\/state-int\/[^/]+\/[^/]+$/.test(url.pathname);
}

/** Route the dispatch POST + audit GET to stable mock payloads. */
function installStateIntApiMocks(route: Route): void {
  if (requestMatchesPath(route.request(), "/api/state-int/audit")) {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        audit: [
          {
            id: "audit-e2e-1",
            adapter: ADAPTER,
            operation: OPERATION,
            request_id: REQUEST_ID,
            status: "ok",
            latency_ms: 142,
            called_at: "2026-06-12T10:00:00Z",
          },
        ],
      }),
    });
    return;
  }
  if (requestMatchesDispatch(route.request())) {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      // The SPA's postJson() validates the response body directly against
      // `StateIntDispatchResponseSchema` (lib/api/schemas.ts) — that schema
      // is FLAT (top-level requestId/status/...), not the wrapped
      // `{ok, stateInt}` envelope the server returns. The client unwraps
      // server-side before validation, so the mock must mirror the
      // unwrapped shape, not the raw server envelope.
      body: JSON.stringify({
        requestId: REQUEST_ID,
        status: "ok",
        providerRef: "prov-e2e-ref-1",
        signatureB64: SIGNATURE_B64,
        certificateThumbprint: THUMBPRINT,
        advisoryOnly: false,
      }),
    });
    return;
  }
  // Anything else under /api/state-int passes through to the live
  // backend (so the e2e can still observe a missing-route
  // regression if the Fastify handler disappears).
  route.continue();
}

/* ────────── page shell + H1 + 6 adapters + back link + 403 absence ────────── */

test.describe("State Integrations — Phase 8.8 Pattern A skeleton", () => {
  test("loads, renders the H1 + 6 adapter options + mode badge + back link, and is permissive in the e2e session @smoke", async ({
    browser,
    request,
  }) => {
    // NOTE: route handlers MUST be registered on `ctx.page`, not the
    // test-fixture `page`. `authedPage()` creates a fresh BrowserContext
    // + Page in a new context, so any `page.route()` on the auto-allocated
    // fixture `page` would never intercept `ctx.page`'s requests. The
    // canonical server paths mocked below (kebab-case /api/state-int/*)
    // are defined in server/app.js:
    //   - GET  /api/state-int/audit              (app.js:4949)
    //   - POST /api/state-int/:adapter/:operation (app.js:4874)
    const ctx = await authedPage(browser, request);
    await ctx.page.route("**/api/state-int/**", installStateIntApiMocks);
    try {
      const response = await ctx.page.goto("/app/cfo/state-integrations");
      expect(
        response,
        `expected /app/cfo/state-integrations to respond (got ${response?.status()})`,
      ).not.toBeNull();
      expect([200, 304]).toContain(response!.status());

      await waitForHydration(ctx.page);

      // Panel — the route wraps every state in
      // data-testid="state-int-panel" (mirrors cabinet/greenhouse).
      const panel = ctx.page.getByTestId("state-int-panel");
      await expect(panel).toBeVisible();

      // H1 — the Armenian title (mirrors the legacy H2 string
      // "Կառավարության ինտեգրացիաներ" verbatim so the e2e is
      // stable across the migration).
      const title = ctx.page.getByTestId("state-int-title");
      await expect(title).toBeVisible();
      await expect(title).toHaveText("Կառավարության ինտեգրացիաներ");

      // MODE badge — every adapter stub returns a deterministic
      // envelope in test mode; the badge is the operator's
      // at-a-glance confirmation that no outbound calls to
      // SRC / e-Register / e-Customs are happening.
      const modeBadge = ctx.page.getByTestId("state-int-mode-badge");
      await expect(modeBadge).toBeVisible();
      await expect(modeBadge).toContainText("MODE: test");

      // 6 adapter options — the route renders the catalog
      // (STATE_INT_ADAPTERS) into the dispatch <select>. The
      // default selected option is the first one (src).
      const adapterSelect = ctx.page.getByTestId("state-int-adapter-select");
      await expect(adapterSelect).toBeVisible();
      for (const id of EXPECTED_ADAPTER_IDS) {
        await expect(
          adapterSelect.locator(`option[value="${id}"]`),
        ).toHaveCount(1);
      }

      // Back link — the route renders a ChevronLeft <Link to="/app/cfo"
      // search={{ view: "cash-flow" }}> which produces
      // `href="/app/cfo?view=cash-flow"`. The search param is required by
      // the CFO hub's default view; the e2e asserts the pathname is the
      // CFO hub (any optional `?view=...` search is allowed).
      const back = ctx.page.getByTestId("state-int-back");
      await expect(back).toBeVisible();
      const backHref = await back.getAttribute("href");
      expect(backHref, "back link href").not.toBeNull();
      expect(new URL(backHref!, "http://localhost").pathname).toBe(
        "/app/cfo",
      );

      // 403 — the route is permissive in the browser e2e because
      // the useUserAccess("cfo") hook defaults to true when no
      // auth context is provided (auth is not yet wired in 8.4).
      // The ForbiddenPanel branch is exercised by the co-located
      // unit test 13 via vi.mocked useUserAccess. The e2e
      // regression-gates the absence.
      await expect(ctx.page.getByTestId("state-int-forbidden")).toHaveCount(0);
    } finally {
      await ctx.page.context().close();
    }
  });
});

/* ────────── dispatch flow ────────── */

test.describe("State Integrations — dispatch flow", () => {
  test("selecting src + clicking dispatch POSTs /api/state-int/src/submitVat and renders the result card @smoke", async ({
    browser,
    request,
  }) => {
    let dispatchPath: string | null = null;
    let dispatchBody: { idempotencyKey?: string } | null = null;
    // NOTE: route handler MUST be registered on `ctx.page`, not the
    // test-fixture `page`. The dispatch endpoint shape
    // (`/api/state-int/:adapter/:operation`) is the canonical kebab-case
    // path defined in server/app.js:4874 — server is source of truth, test
    // follows.
    const ctx = await authedPage(browser, request);
    await ctx.page.route("**/api/state-int/**", async (route) => {
      if (requestMatchesDispatch(route.request())) {
        const url = new URL(route.request().url());
        dispatchPath = url.pathname;
        try {
          dispatchBody = JSON.parse(route.request().postData() ?? "{}") as {
            idempotencyKey?: string;
          };
        } catch {
          dispatchBody = null;
        }
        route.fulfill({
          status: 200,
          contentType: "application/json",
          // The SPA's postJson() validates the response body directly
          // against `StateIntDispatchResponseSchema` (lib/api/schemas.ts)
          // — that schema is FLAT (top-level requestId/status/...), not
          // the wrapped `{ok, stateInt}` envelope the server returns. The
          // client unwraps server-side before validation, so the mock
          // must mirror the unwrapped shape, not the raw server envelope.
          body: JSON.stringify({
            requestId: REQUEST_ID,
            status: "ok",
            providerRef: "prov-e2e-ref-1",
            signatureB64: SIGNATURE_B64,
            certificateThumbprint: THUMBPRINT,
            advisoryOnly: false,
          }),
        });
        return;
      }
      installStateIntApiMocks(route);
    });
    try {
      await ctx.page.goto("/app/cfo/state-integrations");
      await waitForHydration(ctx.page);

      // The route's default adapter is src → operation is
      // submitVat. The payload textarea is prefilled with the
      // src sample payload. We assert the form is visible, then
      // submit it as-is.
      const form = ctx.page.getByTestId("state-int-dispatch-form");
      await expect(form).toBeVisible();
      const adapterSelect = ctx.page.getByTestId("state-int-adapter-select");
      await expect(adapterSelect).toHaveValue(ADAPTER);
      const payload = ctx.page.getByTestId("state-int-payload-textarea");
      await expect(payload).toBeVisible();
      // The dispatch button is enabled when the form is idle.
      const submit = ctx.page.getByTestId("state-int-dispatch-button");
      await expect(submit).toBeEnabled();
      await submit.click();

      // The POST landed on the dispatch endpoint with the
      // /api/state-int/src/submitVat shape.
      expect(dispatchPath).toBe(`/api/state-int/${ADAPTER}/${OPERATION}`);
      if (dispatchBody === null) {
        throw new Error("expected the dispatch POST mock to have captured a body");
      }
      // Re-bind to a fresh const so TypeScript's control flow
      // analysis can narrow past the null guard (closure-captured
      // `let` variables lose narrowing inside awaited callbacks).
      const body: { idempotencyKey?: string } = dispatchBody;
      // The route auto-generates an idempotency key in the
      // shape `ui-state-int-{adapter}-{operation}-{ms}` — verify
      // the prefix; the timestamp is non-deterministic.
      expect(typeof body.idempotencyKey).toBe("string");
      expect(body.idempotencyKey).toMatch(
        new RegExp(`^ui-state-int-${ADAPTER}-${OPERATION}-\\d+$`),
      );

      // The result block renders the mock's requestId, status
      // (Armenian-formatted), providerRef, signature preview
      // (truncated to 40 chars + …), and thumbprint.
      const result = ctx.page.getByTestId("state-int-result");
      await expect(result).toBeVisible();
      await expect(result).toContainText(REQUEST_ID);
      await expect(result).toContainText("Հաջողված"); // Armenian for "ok"
      await expect(result).toContainText("prov-e2e-ref-1");
      // The signature preview truncates to 40 chars + "…".
      await expect(result).toContainText("A".repeat(40) + "…");
      await expect(result).toContainText(THUMBPRINT);
    } finally {
      await ctx.page.context().close();
    }
  });
});

/* ────────── audit panel + refresh ────────── */

test.describe("State Integrations — audit panel", () => {
  test("renders the audit block for an Owner session and the refresh button re-issues GET /api/state-int/audit @smoke", async ({
    browser,
    request,
  }) => {
    let auditGetCount = 0;
    // NOTE: route handler MUST be registered on `ctx.page`, not the
    // test-fixture `page`. The audit endpoint shape
    // (`/api/state-int/audit`) is the canonical kebab-case path defined
    // in server/app.js:4949 — server is source of truth, test follows.
    const ctx = await authedPage(browser, request);
    await ctx.page.route("**/api/state-int/**", async (route) => {
      if (requestMatchesPath(route.request(), "/api/state-int/audit")) {
        auditGetCount += 1;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            audit: [
              {
                id: "audit-e2e-1",
                adapter: ADAPTER,
                operation: OPERATION,
                request_id: REQUEST_ID,
                status: "ok",
                latency_ms: 142,
                called_at: "2026-06-12T10:00:00Z",
              },
            ],
          }),
        });
        return;
      }
      installStateIntApiMocks(route);
    });
    try {
      await ctx.page.goto("/app/cfo/state-integrations");
      await waitForHydration(ctx.page);

      // The audit panel is gated on auditor-like roles
      // (Owner/Admin/Auditor). The e2e session logs in as
      // owner@armosphera.local (Owner) — the audit block must
      // be visible.
      const audit = ctx.page.getByTestId("state-int-audit");
      await expect(audit).toBeVisible();
      // The mock returned 1 audit row — the row must render.
      const auditRow = ctx.page.getByTestId("state-int-audit-row");
      await expect(auditRow).toHaveCount(1);
      await expect(auditRow).toContainText(REQUEST_ID);

      // The audit panel auto-fetches on mount (useQuery with
      // enabled=true). Capture the baseline count, then click
      // the refresh button and verify the GET count incremented.
      const baseline = auditGetCount;
      expect(baseline).toBeGreaterThanOrEqual(1);
      const refresh = ctx.page.getByTestId("state-int-audit-refresh");
      await expect(refresh).toBeEnabled();
      await refresh.click();
      // Wait for the refetch to complete — TanStack Query
      // resolves the refetch promise on the next microtask; the
      // route sets auditQ.isFetching=true while in flight, and
      // the mock is synchronous, so the count increments
      // immediately.
      await expect
        .poll(() => auditGetCount, { timeout: 5_000 })
        .toBeGreaterThan(baseline);
    } finally {
      await ctx.page.context().close();
    }
  });
});
