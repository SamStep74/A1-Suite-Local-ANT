/**
 * greenhouse.spec.ts — e2e coverage for the Phase 8.7 Pattern A
 * Greenhouse route (/app/greenhouse).
 *
 * What this asserts (the must-haves for "the greenhouse skeleton works
 * end-to-end"):
 *   - GET /app/greenhouse returns 2xx (route resolves, auth works, the
 *     TanStack dev server renders the workspace)
 *   - The Armenian H1 "Greenhouse" header renders (the suite uses
 *     English H1 + Armenian tab labels — the route renders English
 *     for the H1 and the tab strip uses greenhouseTabLabelAm())
 *   - The English subtitle lists all 7 surfaces (houses · zones ·
 *     crops · climate · energy · bioprotection · harvest)
 *   - The 7 tab buttons render (house, zone, crop, climate, energy,
 *     bioprotection, harvest) and the default active tab is House
 *   - Clicking each tab button switches the visible panel + form
 *   - The House POST posts to /api/greenhouse/houses and the
 *     houseId pill renders
 *   - The Zone POST (after House) posts to /api/greenhouse/zones
 *     with the parent greenhouseId and the zoneId pill renders
 *   - The Crop POST (after House + Zone) posts to /api/greenhouse/crops
 *     with the parent zoneId and the cropId pill renders
 *   - The Harvest POST (after House + Zone + Crop) posts to
 *     /api/greenhouse/harvests with the parent cropId
 *   - The Climate (GDD) GET posts the form and the GDD result block
 *     renders with the Armenian-formatted row text from
 *     formatGreenhouseGddRow
 *   - The Energy GET posts the form and the Energy result block
 *     renders with the Armenian-formatted row text from
 *     formatGreenhouseEnergyRow
 *   - The Yield GET posts the form and the Yield result block renders
 *     with the Armenian-formatted row text from formatGreenhouseYieldRow
 *   - The AI button POSTs to /api/greenhouse/ai/yield-forecast and
 *     the AI result block (data-testid="greenhouse-ai") renders
 *   - The back link points to /app (the Today hub)
 *   - The 403 access-denied card is NOT rendered for a default
 *     authenticated user (mirrors fleet + cabinet — the route is
 *     permissive today and the gate is server-side)
 *
 * Mocking strategy: the modern route uses Zod-validated JSON over
 * the 6 POST + 3 GET + 1 AI-POST endpoints. We mock the
 * mutation-bearing endpoints (houses, zones, crops, bioprotection,
 * harvests, ai) and the 3 analytics GETs (gdd, energy, yield) to
 * stable shapes matching the Zod schemas. The 3 analytics GETs
 * would otherwise hit the live SQL aggregation; mocking lets the
 * e2e exercise the route's UI + helper formatting without
 * depending on seeded climate/energy data.
 *
 * Why a dedicated spec: this is the Phase 8.7 greenhouse migration
 * e2e, separate from the broader apps smoke loop. The contract
 * parity is locked at the server tier by the worker's matched
 * server-side surface; this spec confirms the modern route wires
 * the same shape into the UI. The e2e + this worktree's
 * `git rm web/src/greenhouse.jsx` together verify the legacy drop
 * is complete: no other file in web/, web-modern/, server/, or
 * test/ references the legacy `GreenhousePanel` symbol or
 * `web/src/greenhouse.jsx` after this commit.
 *
 * NOT asserted here (deferred to 8.7b–8.7f sub-plans):
 *   - The Bioprotection POST + result block (the form is wired,
 *     but the harvest-blocked arm + state-machine for repeated
 *     applications is covered at the unit tier by the co-located
 *     vitest spec)
 *   - The TanStack-Query refetch chain after a successful POST
 *     (covered at the unit tier; out of scope for browser e2e)
 *   - The `greenhouseTabFromHash` URL-hash → tab wiring
 *     (covered at the unit tier)
 *   - The shared `periodKey` input on the climate tab
 *     (covered at the unit tier; e2e sticks to the form's own
 *     period input)
 */
import { test, expect, type Route, type Request } from "@playwright/test";
import { authedPage, waitForHydration } from "./_helpers";

/* ────────── mock data (matches the Zod schemas) ────────── */

const HOUSE_ID = "gh-e2e-001";
const ZONE_ID = "gz-e2e-002";
const CROP_ID = "gc-e2e-003";
const HARVEST_ID = "harv-e2e-004";
const BIO_ID = "bio-e2e-005";

/** The seven greenhouse tabs in the order the route renders them. */
const GREENHOUSE_TABS = [
  "house",
  "zone",
  "crop",
  "climate",
  "energy",
  "bioprotection",
  "harvest",
] as const;

/* ────────── API mocks ────────── */

/** Match a request pathname to a string literal. We use the URL
 *  parser to avoid string-prefix false positives (e.g. the
 *  "/:id/analytics/..." suffix must not match a hypothetical
 *  /:id/analytics-foo endpoint). */
function requestMatchesPath(req: Request, path: string): boolean {
  const url = new URL(req.url());
  return url.pathname === path;
}

/** Match a GET to the GDD/Energy/Yield analytics endpoints with
 *  a regex (the :id segment is the houseId we just created, so
 *  we can't match it literally). */
function requestMatchesAnalyticsGdd(req: Request): boolean {
  if (req.method() !== "GET") return false;
  const url = new URL(req.url());
  return /^\/api\/greenhouse\/[^/]+\/analytics\/gdd$/.test(url.pathname);
}
function requestMatchesAnalyticsEnergy(req: Request): boolean {
  if (req.method() !== "GET") return false;
  const url = new URL(req.url());
  return /^\/api\/greenhouse\/[^/]+\/analytics\/energy$/.test(url.pathname);
}
function requestMatchesAnalyticsYield(req: Request): boolean {
  if (req.method() !== "GET") return false;
  const url = new URL(req.url());
  return /^\/api\/greenhouse\/[^/]+\/analytics\/yield$/.test(url.pathname);
}

/** Route the 6 mutation POSTs + 3 analytics GETs + 1 AI POST
 *  to stable mock payloads. */
async function installGreenhouseApiMocks(route: Route): Promise<void> {
  if (requestMatchesPath(route.request(), "/api/greenhouse/houses")) {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          greenhouse: {
            id: HOUSE_ID,
            assetId: "asset-gh-1",
            name: "Armosphère-1",
            areaM2: 1200,
            glazingKind: "glass",
            heatingKind: "gas",
            createdAt: "2026-06-12T00:00:00Z",
          },
        }),
      });
      return;
    }
  }
  if (requestMatchesPath(route.request(), "/api/greenhouse/zones")) {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          zone: {
            id: ZONE_ID,
            greenhouseId: HOUSE_ID,
            name: "Zone A",
            areaM2: 400,
            irrigationKind: "drip",
            createdAt: "2026-06-12T00:00:00Z",
          },
        }),
      });
      return;
    }
  }
  if (requestMatchesPath(route.request(), "/api/greenhouse/crops")) {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          crop: {
            id: CROP_ID,
            zoneId: ZONE_ID,
            cropKind: "tomato",
            plantedAt: "2026-04-01",
            expectedHarvestAt: "2026-07-15",
            expectedYieldKg: 1500,
            seedSource: "Hazera",
            status: "growing",
            createdAt: "2026-06-12T00:00:00Z",
          },
        }),
      });
      return;
    }
  }
  if (requestMatchesPath(route.request(), "/api/greenhouse/bioprotection")) {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          bioprotection: {
            id: BIO_ID,
            zoneId: ZONE_ID,
            appliedAt: "2026-06-08",
            agentKind: "Spinosad",
            dose: "0.3 l/ha",
            targetPest: "thrips",
            withdrawalPeriodDays: 7,
            recordedBy: "agronomist",
            createdAt: "2026-06-12T00:00:00Z",
          },
        }),
      });
      return;
    }
  }
  if (requestMatchesPath(route.request(), "/api/greenhouse/harvests")) {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          harvest: {
            id: HARVEST_ID,
            cropId: CROP_ID,
            harvestedAt: "2026-06-08",
            quantityKg: 100,
            qualityGrade: "A",
            lotId: "LOT-GH-2026-001",
            createdAt: "2026-06-12T00:00:00Z",
          },
        }),
      });
      return;
    }
  }
  if (requestMatchesPath(route.request(), "/api/greenhouse/ai/yield-forecast")) {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          packet: {
            intent: "yield-forecast",
            aiSource: "rule-engine",
            answer: "Կանխատեսվում է 1.4-1.6 տ/հա բերք (mock)",
            confidence: 0.78,
            riskLevel: "low",
          },
        }),
      });
      return;
    }
  }
  if (requestMatchesAnalyticsGdd(route.request())) {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        baseTempC: 10,
        growingDegreeDays: 412,
        sampleSize: 28,
      }),
    });
    return;
  }
  if (requestMatchesAnalyticsEnergy(route.request())) {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        energy: {
          totalKwh: 1230,
          totalGasM3: 95,
          totalKg: 1500,
          kwhPerKg: 0.82,
          gasM3PerKg: 0.063,
        },
      }),
    });
    return;
  }
  if (requestMatchesAnalyticsYield(route.request())) {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [
          {
            cropId: CROP_ID,
            cropKind: "tomato",
            expectedKg: 1500,
            actualKg: 1480,
            pctOfForecast: 98.7,
          },
        ],
      }),
    });
    return;
  }
  // Anything else under /api/greenhouse passes through to the live
  // backend (so the e2e can still observe a missing-route
  // regression if the Fastify handler disappears).
  await route.continue();
}

/* ────────── page shell + tab switch ────────── */

test.describe("Greenhouse — Phase 8.7 Pattern A skeleton", () => {
  test("loads, renders the H1 + 7 tabs, defaults to House, and points back to /app", async ({
    browser,
    request,
  }) => {
    const ctx = await authedPage(browser, request);
    await ctx.page.route("**/api/greenhouse/**", installGreenhouseApiMocks);
    try {
      const response = await ctx.page.goto("/app/greenhouse");
      expect(
        response,
        `expected /app/greenhouse to respond (got ${response?.status()})`,
      ).not.toBeNull();
      expect([200, 304]).toContain(response!.status());

      await waitForHydration(ctx.page);

      // H1 — the screen header. The Pattern A greenhouse route
      // renders "Greenhouse" (English) + the Armenian tab labels
      // are sourced from greenhouseTabLabelAm() in the status
      // helpers. The bilingual header is below the H1.
      const panel = ctx.page.getByTestId("greenhouse-panel");
      await expect(panel).toBeVisible();
      const title = ctx.page.getByRole("heading", { level: 1, name: /Greenhouse/i });
      await expect(title).toBeVisible();

      // English subtitle lists all 7 surfaces (mirrors the
      // legacy file's "Greenhouse houses · zones · crops · ..."
      // descriptive line).
      await expect(panel).toContainText(/houses.*zones.*crops.*climate.*energy.*bioprotection.*harvest/);

      // 7 tab buttons render in route-local order. The
      // data-testid pattern mirrors fleet (fleet-tab-{tab}).
      for (const t of GREENHOUSE_TABS) {
        const btn = ctx.page.getByTestId(`greenhouse-tab-${t}`);
        await expect(btn).toBeVisible();
      }

      // Default tab is House — the route's initial state.
      const house = ctx.page.getByTestId("greenhouse-tab-house");
      expect(await house.getAttribute("data-active")).toBe("true");
      await expect(
        ctx.page.getByTestId("greenhouse-house-form"),
      ).toBeVisible();

      // Click each tab — the matching form/panel appears, the
      // previously-active form unmounts.
      for (const t of GREENHOUSE_TABS) {
        await ctx.page.getByTestId(`greenhouse-tab-${t}`).click();
        expect(
          await ctx.page.getByTestId(`greenhouse-tab-${t}`).getAttribute("data-active"),
        ).toBe("true");
        // The route uses greenhouse-{tab}-form for the form,
        // except climate/energy which use {tab}-form too, and
        // harvest which uses harvest-wrap. All of them render
        // a {tab}-panel wrapper (data-testid="greenhouse-{tab}-panel").
        await expect(ctx.page.getByTestId(`greenhouse-${t}-panel`)).toBeVisible();
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

/* ────────── House → Zone → Crop → Harvest sequential flow ────────── */

test.describe("Greenhouse — sequential create flow (House → Zone → Crop → Harvest)", () => {
  test("submitting each form in order POSTs the right envelope and renders the ID pill", async ({
    browser,
    request,
  }) => {
    interface HousePostBody {
      name: string;
      areaM2: number;
      glazingKind: string;
      heatingKind: string;
      idempotencyKey: string;
    }
    interface ZonePostBody {
      greenhouseId: string;
      name: string;
      areaM2: number;
      irrigationKind: string;
      idempotencyKey: string;
    }
    interface CropPostBody {
      zoneId: string;
      cropKind: string;
      plantedAt: string;
      expectedHarvestAt: string;
      expectedYieldKg: number;
      seedSource: string;
      idempotencyKey: string;
    }
    interface HarvestPostBody {
      cropId: string;
      harvestedAt: string;
      quantityKg: number;
      qualityGrade: string;
      idempotencyKey: string;
    }
    // Wrap captured bodies in mutable objects so TypeScript can
    // track property assignment through the route-handler closure
    // (a `let x: T | null` at outer scope won't narrow after an
    // assignment inside an awaited callback).
    const houseCapture: { body: HousePostBody | null } = { body: null };
    const zoneCapture: { body: ZonePostBody | null } = { body: null };
    const cropCapture: { body: CropPostBody | null } = { body: null };
    const harvestCapture: { body: HarvestPostBody | null } = { body: null };
    const ctx = await authedPage(browser, request);
    await ctx.page.route("**/api/greenhouse/**", async (route) => {
      if (
        requestMatchesPath(route.request(), "/api/greenhouse/houses") &&
        route.request().method() === "POST"
      ) {
        try {
          const raw = JSON.parse(route.request().postData() ?? "{}") as Partial<HousePostBody>;
          houseCapture.body = {
            name: String(raw.name ?? ""),
            areaM2: typeof raw.areaM2 === "number" ? raw.areaM2 : 0,
            glazingKind: String(raw.glazingKind ?? ""),
            heatingKind: String(raw.heatingKind ?? ""),
            idempotencyKey: String(raw.idempotencyKey ?? ""),
          };
        } catch {
          houseCapture.body = null;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            greenhouse: {
              id: HOUSE_ID,
              assetId: "asset-gh-1",
              name: "Armosphère-1",
              areaM2: 1200,
              glazingKind: "glass",
              heatingKind: "gas",
              createdAt: "2026-06-12T00:00:00Z",
            },
          }),
        });
        return;
      }
      if (
        requestMatchesPath(route.request(), "/api/greenhouse/zones") &&
        route.request().method() === "POST"
      ) {
        try {
          const raw = JSON.parse(route.request().postData() ?? "{}") as Partial<ZonePostBody>;
          zoneCapture.body = {
            greenhouseId: String(raw.greenhouseId ?? ""),
            name: String(raw.name ?? ""),
            areaM2: typeof raw.areaM2 === "number" ? raw.areaM2 : 0,
            irrigationKind: String(raw.irrigationKind ?? ""),
            idempotencyKey: String(raw.idempotencyKey ?? ""),
          };
        } catch {
          zoneCapture.body = null;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            zone: {
              id: ZONE_ID,
              greenhouseId: HOUSE_ID,
              name: "Zone A",
              areaM2: 400,
              irrigationKind: "drip",
              createdAt: "2026-06-12T00:00:00Z",
            },
          }),
        });
        return;
      }
      if (
        requestMatchesPath(route.request(), "/api/greenhouse/crops") &&
        route.request().method() === "POST"
      ) {
        try {
          const raw = JSON.parse(route.request().postData() ?? "{}") as Partial<CropPostBody>;
          cropCapture.body = {
            zoneId: String(raw.zoneId ?? ""),
            cropKind: String(raw.cropKind ?? ""),
            plantedAt: String(raw.plantedAt ?? ""),
            expectedHarvestAt: String(raw.expectedHarvestAt ?? ""),
            expectedYieldKg:
              typeof raw.expectedYieldKg === "number" ? raw.expectedYieldKg : 0,
            seedSource: String(raw.seedSource ?? ""),
            idempotencyKey: String(raw.idempotencyKey ?? ""),
          };
        } catch {
          cropCapture.body = null;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            crop: {
              id: CROP_ID,
              zoneId: ZONE_ID,
              cropKind: "tomato",
              plantedAt: "2026-04-01",
              expectedHarvestAt: "2026-07-15",
              expectedYieldKg: 1500,
              seedSource: "Hazera",
              status: "growing",
              createdAt: "2026-06-12T00:00:00Z",
            },
          }),
        });
        return;
      }
      if (
        requestMatchesPath(route.request(), "/api/greenhouse/harvests") &&
        route.request().method() === "POST"
      ) {
        try {
          const raw = JSON.parse(route.request().postData() ?? "{}") as Partial<HarvestPostBody>;
          harvestCapture.body = {
            cropId: String(raw.cropId ?? ""),
            harvestedAt: String(raw.harvestedAt ?? ""),
            quantityKg: typeof raw.quantityKg === "number" ? raw.quantityKg : 0,
            qualityGrade: String(raw.qualityGrade ?? ""),
            idempotencyKey: String(raw.idempotencyKey ?? ""),
          };
        } catch {
          harvestCapture.body = null;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            harvest: {
              id: HARVEST_ID,
              cropId: CROP_ID,
              harvestedAt: "2026-06-08",
              quantityKg: 100,
              qualityGrade: "A",
              lotId: "LOT-GH-2026-001",
              createdAt: "2026-06-12T00:00:00Z",
            },
          }),
        });
        return;
      }
      await installGreenhouseApiMocks(route);
    });
    try {
      await ctx.page.goto("/app/greenhouse");
      await waitForHydration(ctx.page);

      // The House tab is the default — no need to click it.
      await expect(
        ctx.page.getByTestId("greenhouse-house-form"),
      ).toBeVisible();

      // ── House POST ──
      // The form's defaults already match the test's intent
      // (Armosphère-1, 1200, glass, gas) — submit as-is.
      const houseSubmit = ctx.page.getByTestId("greenhouse-house-submit");
      await expect(houseSubmit).toBeEnabled();
      await houseSubmit.click();

      if (houseCapture.body === null) {
        throw new Error("expected the houses POST mock to have captured a body");
      }
      expect(houseCapture.body.name).toBe("Armosphère-1");
      expect(houseCapture.body.areaM2).toBe(1200);
      expect(houseCapture.body.glazingKind).toBe("glass");
      expect(houseCapture.body.heatingKind).toBe("gas");
      expect(houseCapture.body.idempotencyKey).toMatch(/^ui-house-/);
      // The houseId pill renders after a successful POST.
      const housePill = ctx.page.getByTestId("greenhouse-house-id-pill");
      await expect(housePill).toBeVisible();
      await expect(housePill).toContainText(HOUSE_ID);

      // ── Zone POST ──
      await ctx.page.getByTestId("greenhouse-tab-zone").click();
      await expect(ctx.page.getByTestId("greenhouse-zone-form")).toBeVisible();
      // The Zone form is gated on houseId — submit must be enabled.
      const zoneSubmit = ctx.page.getByTestId("greenhouse-zone-submit");
      await expect(zoneSubmit).toBeEnabled();
      await zoneSubmit.click();

      if (zoneCapture.body === null) {
        throw new Error("expected the zones POST mock to have captured a body");
      }
      // The parent greenhouseId is the ID the house POST returned.
      expect(zoneCapture.body.greenhouseId).toBe(HOUSE_ID);
      expect(zoneCapture.body.name).toBe("Zone A");
      expect(zoneCapture.body.areaM2).toBe(400);
      expect(zoneCapture.body.irrigationKind).toBe("drip");
      expect(zoneCapture.body.idempotencyKey).toMatch(/^ui-zone-/);
      const zonePill = ctx.page.getByTestId("greenhouse-zone-id-pill");
      await expect(zonePill).toBeVisible();
      await expect(zonePill).toContainText(ZONE_ID);

      // ── Crop POST ──
      await ctx.page.getByTestId("greenhouse-tab-crop").click();
      await expect(ctx.page.getByTestId("greenhouse-crop-form")).toBeVisible();
      const cropSubmit = ctx.page.getByTestId("greenhouse-crop-submit");
      await expect(cropSubmit).toBeEnabled();
      await cropSubmit.click();

      if (cropCapture.body === null) {
        throw new Error("expected the crops POST mock to have captured a body");
      }
      expect(cropCapture.body.zoneId).toBe(ZONE_ID);
      expect(cropCapture.body.cropKind).toBe("tomato");
      expect(cropCapture.body.plantedAt).toBe("2026-04-01");
      expect(cropCapture.body.expectedHarvestAt).toBe("2026-07-15");
      expect(cropCapture.body.expectedYieldKg).toBe(1500);
      expect(cropCapture.body.seedSource).toBe("Hazera");
      expect(cropCapture.body.idempotencyKey).toMatch(/^ui-crop-/);
      const cropPill = ctx.page.getByTestId("greenhouse-crop-id-pill");
      await expect(cropPill).toBeVisible();
      await expect(cropPill).toContainText(CROP_ID);

      // ── Harvest POST ──
      await ctx.page.getByTestId("greenhouse-tab-harvest").click();
      await expect(ctx.page.getByTestId("greenhouse-harvest-form")).toBeVisible();
      const harvestSubmit = ctx.page.getByTestId("greenhouse-harvest-submit");
      await expect(harvestSubmit).toBeEnabled();
      await harvestSubmit.click();

      if (harvestCapture.body === null) {
        throw new Error("expected the harvests POST mock to have captured a body");
      }
      expect(harvestCapture.body.cropId).toBe(CROP_ID);
      expect(harvestCapture.body.harvestedAt).toBe("2026-06-08");
      expect(harvestCapture.body.quantityKg).toBe(100);
      expect(harvestCapture.body.qualityGrade).toBe("A");
      expect(harvestCapture.body.idempotencyKey).toMatch(/^ui-harv-/);
      // The result block renders the harvest row.
      const harvestResult = ctx.page.getByTestId("greenhouse-result-harvest");
      await expect(harvestResult).toBeVisible();
      await expect(harvestResult).toContainText("100 kg");
      await expect(harvestResult).toContainText("A");
    } finally {
      await ctx.page.context().close();
    }
  });
});

/* ────────── Climate (GDD) GET ────────── */

test.describe("Greenhouse — Climate (GDD) GET", () => {
  test("submitting the climate form GETs /api/greenhouse/:id/analytics/gdd and renders the Armenian-formatted row", async ({
    browser,
    request,
  }) => {
    let gddPath: string | null = null;
    let gddPeriodKey: string | null = null;
    const ctx = await authedPage(browser, request);
    await ctx.page.route("**/api/greenhouse/**", async (route) => {
      if (requestMatchesAnalyticsGdd(route.request())) {
        const url = new URL(route.request().url());
        gddPath = url.pathname;
        gddPeriodKey = url.searchParams.get("periodKey");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            baseTempC: 10,
            growingDegreeDays: 412,
            sampleSize: 28,
          }),
        });
        return;
      }
      await installGreenhouseApiMocks(route);
    });
    try {
      await ctx.page.goto("/app/greenhouse");
      await waitForHydration(ctx.page);

      // Set up the cross-tab state — we need a houseId for
      // the climate form to be enabled. Use the Houses
      // mock to short-circuit: navigate to House, submit
      // (mock returns HOUSE_ID), then click Climate.
      await ctx.page.getByTestId("greenhouse-house-submit").click();
      const housePill = ctx.page.getByTestId("greenhouse-house-id-pill");
      await expect(housePill).toBeVisible();

      await ctx.page.getByTestId("greenhouse-tab-climate").click();
      await expect(ctx.page.getByTestId("greenhouse-climate-form")).toBeVisible();
      // The climate form is gated on houseId (re-uses
      // canCreateZone); submit must be enabled.
      const climateSubmit = ctx.page.getByTestId("greenhouse-climate-submit");
      await expect(climateSubmit).toBeEnabled();
      // The periodKey input has a default of "2026-06".
      await ctx.page.getByTestId("greenhouse-climate-period").fill("2026-06");
      await climateSubmit.click();

      expect(gddPath).toBe(`/api/greenhouse/${HOUSE_ID}/analytics/gdd`);
      expect(gddPeriodKey).toBe("2026-06");

      // The GDD result block renders the {baseTempC,
      // growingDegreeDays} pair.
      const gddResult = ctx.page.getByTestId("greenhouse-result-gdd");
      await expect(gddResult).toBeVisible();
      await expect(gddResult).toContainText("GDD");
      await expect(gddResult).toContainText("10");
      await expect(gddResult).toContainText("412");
    } finally {
      await ctx.page.context().close();
    }
  });
});

/* ────────── Energy GET ────────── */

test.describe("Greenhouse — Energy GET", () => {
  test("submitting the energy form GETs /api/greenhouse/:id/analytics/energy and renders the Armenian-formatted row", async ({
    browser,
    request,
  }) => {
    let energyPath: string | null = null;
    let energyPeriodKey: string | null = null;
    const ctx = await authedPage(browser, request);
    await ctx.page.route("**/api/greenhouse/**", async (route) => {
      if (requestMatchesAnalyticsEnergy(route.request())) {
        const url = new URL(route.request().url());
        energyPath = url.pathname;
        energyPeriodKey = url.searchParams.get("periodKey");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            energy: {
              totalKwh: 1230,
              totalGasM3: 95,
              totalKg: 1500,
              kwhPerKg: 0.82,
              gasM3PerKg: 0.063,
            },
          }),
        });
        return;
      }
      await installGreenhouseApiMocks(route);
    });
    try {
      await ctx.page.goto("/app/greenhouse");
      await waitForHydration(ctx.page);

      // Set up the cross-tab state — we need a houseId.
      await ctx.page.getByTestId("greenhouse-house-submit").click();
      const housePill = ctx.page.getByTestId("greenhouse-house-id-pill");
      await expect(housePill).toBeVisible();

      await ctx.page.getByTestId("greenhouse-tab-energy").click();
      await expect(ctx.page.getByTestId("greenhouse-energy-form")).toBeVisible();
      const energySubmit = ctx.page.getByTestId("greenhouse-energy-submit");
      await expect(energySubmit).toBeEnabled();
      await ctx.page.getByTestId("greenhouse-energy-period").fill("2026-06");
      await energySubmit.click();

      expect(energyPath).toBe(`/api/greenhouse/${HOUSE_ID}/analytics/energy`);
      expect(energyPeriodKey).toBe("2026-06");

      // The energy result block renders {totalKwh, totalGasM3,
      // totalKg, kwhPerKg, gasM3PerKg}.
      const energyResult = ctx.page.getByTestId("greenhouse-result-energy");
      await expect(energyResult).toBeVisible();
      await expect(energyResult).toContainText("1230");
      await expect(energyResult).toContainText("95");
      await expect(energyResult).toContainText("1500");
    } finally {
      await ctx.page.context().close();
    }
  });
});

/* ────────── Yield GET ────────── */

test.describe("Greenhouse — Yield GET", () => {
  test("submitting the yield form GETs /api/greenhouse/:id/analytics/yield and renders the Armenian-formatted row", async ({
    browser,
    request,
  }) => {
    let yieldPath: string | null = null;
    let yieldPeriodKey: string | null = null;
    const ctx = await authedPage(browser, request);
    await ctx.page.route("**/api/greenhouse/**", async (route) => {
      if (requestMatchesAnalyticsYield(route.request())) {
        const url = new URL(route.request().url());
        yieldPath = url.pathname;
        yieldPeriodKey = url.searchParams.get("periodKey");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            rows: [
              {
                cropId: CROP_ID,
                cropKind: "tomato",
                expectedKg: 1500,
                actualKg: 1480,
                pctOfForecast: 98.7,
              },
            ],
          }),
        });
        return;
      }
      await installGreenhouseApiMocks(route);
    });
    try {
      await ctx.page.goto("/app/greenhouse");
      await waitForHydration(ctx.page);

      // Set up the cross-tab state — we need a houseId.
      await ctx.page.getByTestId("greenhouse-house-submit").click();
      const housePill = ctx.page.getByTestId("greenhouse-house-id-pill");
      await expect(housePill).toBeVisible();

      await ctx.page.getByTestId("greenhouse-tab-harvest").click();
      await expect(ctx.page.getByTestId("greenhouse-harvest-wrap")).toBeVisible();
      // The yield form sits inside the harvest wrap.
      const yieldSubmit = ctx.page.getByTestId("greenhouse-yield-submit");
      await expect(yieldSubmit).toBeEnabled();
      await ctx.page.getByTestId("greenhouse-yield-period").fill("2026-06");
      await yieldSubmit.click();

      expect(yieldPath).toBe(`/api/greenhouse/${HOUSE_ID}/analytics/yield`);
      expect(yieldPeriodKey).toBe("2026-06");

      // The yield result block renders the {expectedKg → actualKg} rows.
      const yieldResult = ctx.page.getByTestId("greenhouse-result-yield");
      await expect(yieldResult).toBeVisible();
      await expect(yieldResult).toContainText("1500");
      await expect(yieldResult).toContainText("1480");
    } finally {
      await ctx.page.context().close();
    }
  });
});

/* ────────── AI forecast POST ────────── */

test.describe("Greenhouse — AI yield-forecast POST", () => {
  test("clicking the AI button POSTs to /api/greenhouse/ai/yield-forecast and renders the AI block", async ({
    browser,
    request,
  }) => {
    interface AiPostBody {
      periodKey: string;
      question: string;
      idempotencyKey: string;
    }
    const aiCapture: { body: AiPostBody | null } = { body: null };
    const ctx = await authedPage(browser, request);
    await ctx.page.route("**/api/greenhouse/**", async (route) => {
      if (
        requestMatchesPath(route.request(), "/api/greenhouse/ai/yield-forecast") &&
        route.request().method() === "POST"
      ) {
        try {
          const raw = JSON.parse(route.request().postData() ?? "{}") as Partial<AiPostBody>;
          aiCapture.body = {
            periodKey: String(raw.periodKey ?? ""),
            question: String(raw.question ?? ""),
            idempotencyKey: String(raw.idempotencyKey ?? ""),
          };
        } catch {
          aiCapture.body = null;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            packet: {
              intent: "yield-forecast",
              aiSource: "rule-engine",
              answer: "Կանխատեսվում է 1.4-1.6 տ/հա բերք (mock)",
              confidence: 0.78,
              riskLevel: "low",
            },
          }),
        });
        return;
      }
      await installGreenhouseApiMocks(route);
    });
    try {
      await ctx.page.goto("/app/greenhouse");
      await waitForHydration(ctx.page);

      // The AI button lives in the workspace footer (not on
      // any single tab) — it always uses the shared
      // `periodKey` state, defaulting to "2026-06".
      const aiButton = ctx.page.getByTestId("greenhouse-ai-button");
      await expect(aiButton).toBeVisible();
      await expect(aiButton).toBeEnabled();
      await aiButton.click();

      if (aiCapture.body === null) {
        throw new Error("expected the AI POST mock to have captured a body");
      }
      expect(aiCapture.body.periodKey).toBe("2026-06");
      expect(aiCapture.body.question).toContain("yield-forecast");
      expect(aiCapture.body.idempotencyKey).toMatch(/^ui-ai-/);

      // The AI block renders the packet's intent + answer.
      const aiBlock = ctx.page.getByTestId("greenhouse-ai");
      await expect(aiBlock).toBeVisible();
      await expect(aiBlock).toContainText("yield-forecast");
      await expect(aiBlock).toContainText("Կանխատեսվում է");
      await expect(aiBlock).toContainText("rule-engine");
    } finally {
      await ctx.page.context().close();
    }
  });
});

/* ────────── 403 access gate ────────── */

test.describe("Greenhouse — 403 access gate", () => {
  test("does not render the 403 card for a default authenticated user", async ({
    browser,
    request,
  }) => {
    // The 403 path is a no-op for the live route today: the
    // workspace does not yet read a `userAccess` from the
    // session (the plan says: "Server enforces; UI defaults
    // to permissive until the auth context is wired in 8.4").
    // The route exports a GreenhouseAccessDeniedCard component,
    // but the live workspace is unconditional. This spec is
    // a regression guard — if a future change wires the
    // workspace to read a role from the session and defaults
    // it to "none" for unprivileged users, this test will
    // fail loudly.
    const ctx = await authedPage(browser, request);
    await ctx.page.route("**/api/greenhouse/**", installGreenhouseApiMocks);
    try {
      await ctx.page.goto("/app/greenhouse");
      await waitForHydration(ctx.page);

      // The 403 card must NOT be present for a default session.
      await expect(ctx.page.getByTestId("greenhouse-403")).toHaveCount(0);
      // The tab strip + the house form MUST be present —
      // the workspace is the default render, the 403 is opt-in.
      await expect(
        ctx.page.getByTestId("greenhouse-tab-house"),
      ).toBeVisible();
      await expect(
        ctx.page.getByTestId("greenhouse-house-form"),
      ).toBeVisible();
    } finally {
      await ctx.page.context().close();
    }
  });
});
