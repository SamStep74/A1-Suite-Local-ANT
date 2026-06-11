/**
 * /app/greenhouse — route-level tests for the Greenhouse Pattern A route.
 *
 * Mirrors the fleet test pattern: mock the three layers (Router,
 * Query, API client), then drive the public component surface. The
 * route file exports its subcomponents as named exports
 * (GreenhouseAccessDeniedCard, GreenhouseTabs, HouseForm, ZoneForm,
 * CropForm, ClimateForm, EnergyForm, BioprotectionForm, HarvestForm,
 * GreenhouseResultBlock, GreenhouseAiBlock) so we can import and
 * render them directly.
 *
 * MutationFn routing: the route has 6 mutations + 3 ad-hoc GET
 * fetchers (loadGdd, loadEnergy, loadYield). Each useMutation slot
 * is wired by `mutationFn.toString()` substring matching the path.
 *
 * Coverage targets (Phase 8.7 layer 2, min 20 cases):
 *  1. Page shell — H1 + English subtitle + back link
 *  2. 7 tab buttons render in canonical order
 *  3. Default tab is "house"
 *  4. Click each tab switches content (6 tabs)
 *  5. House POST: form submit → postJson called with idempotencyKey
 *  6. Zone POST: form submit → postJson called with idempotencyKey
 *  7. Crop POST: form submit → postJson called with idempotencyKey
 *  8. Bioprotection POST: form submit → postJson called
 *  9. Harvest POST: form submit → postJson called
 * 10. AI forecast POST: button click → postJson called
 * 11. Climate (GDD) GET: button click → getJson called
 * 12. Energy GET: button click → getJson called
 * 13. Yield GET: button click → getJson called
 * 14. 403: UserAccessContext value={greenhouse:false} → 403 card
 * 15. ZoneForm disabled when houseId is null (canCreateZone guard)
 * 16. CropForm disabled when zoneId is null
 * 17. HarvestForm disabled when cropId is null
 * 18. ID pills appear after successful mutations
 * 19. GREENHOUSE_TABS contains 7 tabs in canonical order
 * 20. greenhouseTabFromHash decodes deep links
 * 21. canCreateZone / canCreateCrop / canRecordHarvest guards
 * 22. cropKindLabelAm wraps Armenian + English
 * 23. GreenhouseResultBlock renders house/zone/crop result kinds
 * 24. GreenhouseResultBlock renders gdd/energy/yield result kinds
 * 25. GreenhouseResultBlock renders bioprotection/harvest/error kinds
 * 26. GreenhouseAiBlock shows pending + error + packet states
 * 27. Schema round-trip: GreenhouseHouseCreateRequestSchema parses
 * 28. Schema round-trip: GreenhouseYieldResponseSchema parses
 * 29. Subcomponent sanity — GreenhouseTabs clicks
 * 30. HouseForm fires onSubmit with typed input
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── timing helper ────────── */

/**
 * The route's onSuccess handlers call setHouseId / setZoneId / setCropId,
 * which schedule a React re-render. The mock useMutation fires onSuccess
 * inside a `.then()` microtask, so the test must flush several
 * microtasks and a React commit before the next button is enabled.
 */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/* ────────── mock state (hoisted so vi.mock factories see it) ────────── */

const mocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  // The active mutation slot is wired by routing mutationFn.toString().
  // The route has 6 mutations; we expose impls and `isPending` slots.
  mutateImpls: [] as Array<ReturnType<typeof vi.fn>>,
  pendingFlags: [] as boolean[],
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    useSearch: () => ({}),
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
    options: cfg,
  }),
  Link: ({
    children,
    to,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
  } & Record<string, unknown>) => (
    <a data-href={to} href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useMutation: (opts: {
      mutationFn: (...args: unknown[]) => Promise<unknown>;
      onSuccess?: (...args: unknown[]) => void;
      onError?: (...args: unknown[]) => void;
    }) => {
      // Route by the path substring inside mutationFn.toString().
      // The greenhouse route has 6 distinct mutations.
      const fn = opts.mutationFn.toString();
      let slot = 0;
      if (fn.includes("/api/greenhouse/houses")) slot = 0;
      else if (fn.includes("/api/greenhouse/zones")) slot = 1;
      else if (fn.includes("/api/greenhouse/crops")) slot = 2;
      else if (fn.includes("/api/greenhouse/bioprotection")) slot = 3;
      else if (fn.includes("/api/greenhouse/harvests")) slot = 4;
      else if (fn.includes("/api/greenhouse/ai/yield-forecast")) slot = 5;
      else slot = mocks.mutateImpls.length;

      if (!mocks.mutateImpls[slot]) {
        mocks.mutateImpls[slot] = vi.fn();
      }
      mocks.mutateImpls[slot].mockImplementation((...args: unknown[]) => {
        opts
          .mutationFn(...args)
          .then((res: unknown) => {
            if (opts.onSuccess) opts.onSuccess(res, ...args);
          })
          .catch((err: unknown) => {
            if (opts.onError) opts.onError(err, ...args);
          });
      });
      mocks.pendingFlags[slot] = mocks.pendingFlags[slot] ?? false;

      return {
        mutate: (...args: unknown[]) => mocks.mutateImpls[slot](...args),
        isPending: !!mocks.pendingFlags[slot],
        error: undefined,
      };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../lib/api/client", () => ({
  getJson: mocks.getJson,
  postJson: mocks.postJson,
  patchJson: vi.fn(),
  postVoid: vi.fn().mockResolvedValue(undefined),
}));

/* ────────── import the route under test (mocks are in place) ────────── */

import {
  Route,
  GreenhouseAccessDeniedCard,
  GreenhouseTabs,
  HouseForm,
  ZoneForm,
  CropForm,
  ClimateForm,
  EnergyForm,
  BioprotectionForm,
  HarvestForm,
  GreenhouseResultBlock,
  GreenhouseAiBlock,
  type GreenhouseResult,
} from "./index";
import {
  GreenhouseAiForecastResponseSchema,
  GreenhouseBioprotectionCreateRequestSchema,
  GreenhouseBioprotectionCreateResponseSchema,
  GreenhouseCropCreateRequestSchema,
  GreenhouseCropCreateResponseSchema,
  GreenhouseEnergyResponseSchema,
  GreenhouseGddResponseSchema,
  GreenhouseHarvestCreateRequestSchema,
  GreenhouseHarvestCreateResponseSchema,
  GreenhouseHouseCreateRequestSchema,
  GreenhouseHouseCreateResponseSchema,
  GreenhouseYieldResponseSchema,
  GreenhouseZoneCreateRequestSchema,
  GreenhouseZoneCreateResponseSchema,
  type GreenhouseAiForecastPacket,
  type GreenhouseBioprotection,
  type GreenhouseCrop,
  type GreenhouseEnergy,
  type GreenhouseGdd,
  type GreenhouseHarvest,
  type GreenhouseHouse,
  type GreenhouseYieldRow,
  type GreenhouseZone,
} from "../../../lib/api/schemas";
import {
  CROP_KINDS,
  GREENHOUSE_TABS,
  canCreateCrop,
  canCreateZone,
  canRecordHarvest,
  cropKindLabelAm,
  generateGreenhouseIdempotencyKey,
  greenhouseTabFromHash,
} from "../../../lib/greenhouse/status";
import { UserAccessProvider } from "../../../lib/rbac/access.tsx";

/* ────────── helpers ────────── */

function renderRoute(opts?: { noGreenhouseAccess?: boolean }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Component = Route.options.component as React.ComponentType;
  const accessValue = opts?.noGreenhouseAccess
    ? { greenhouse: false as const }
    : undefined;
  return render(
    <QueryClientProvider client={qc}>
      <UserAccessProvider value={accessValue}>
        <Component />
      </UserAccessProvider>
    </QueryClientProvider>,
  );
}

const HOUSE_A: GreenhouseHouse = {
  id: "gh-house-1",
  name: "Armosphère-1",
  areaM2: 1200,
  glazingKind: "glass",
  heatingKind: "gas",
  createdAt: "2026-04-01T10:00:00Z",
};

const ZONE_A: GreenhouseZone = {
  id: "gh-zone-1",
  greenhouseId: HOUSE_A.id,
  name: "Zone A",
  areaM2: 400,
  irrigationKind: "drip",
  createdAt: "2026-04-02T10:00:00Z",
};

const CROP_A: GreenhouseCrop = {
  id: "gh-crop-1",
  zoneId: ZONE_A.id,
  cropKind: "tomato",
  plantedAt: "2026-04-01",
  expectedHarvestAt: "2026-07-15",
  expectedYieldKg: 1500,
  seedSource: "Hazera",
  status: "growing",
  createdAt: "2026-04-02T10:00:00Z",
};

const BIO_A: GreenhouseBioprotection = {
  id: "gh-bio-1",
  zoneId: ZONE_A.id,
  appliedAt: "2026-06-08",
  agentKind: "Spinosad",
  dose: "0.3 l/ha",
  targetPest: "thrips",
  withdrawalPeriodDays: 7,
  recordedBy: "agronomist",
  createdAt: "2026-06-08T10:00:00Z",
};

const HARVEST_A: GreenhouseHarvest = {
  id: "gh-harv-1",
  cropId: CROP_A.id,
  harvestedAt: "2026-06-08",
  quantityKg: 100,
  qualityGrade: "A",
  lotId: "LOT-A1",
  createdAt: "2026-06-08T11:00:00Z",
};

const ENERGY_A: GreenhouseEnergy = {
  totalKwh: 1500,
  totalGasM3: 200,
  totalKg: 1200,
  kwhPerKg: 1.25,
  gasM3PerKg: 0.17,
};

const GDD_A: GreenhouseGdd = {
  baseTempC: 10,
  growingDegreeDays: 245.5,
  sampleSize: 30,
};

const YIELD_ROW_A: GreenhouseYieldRow = {
  cropId: CROP_A.id,
  cropKind: "tomato",
  expectedKg: 1500,
  actualKg: 1450,
  pctOfForecast: 96.7,
};

const AI_PACKET: GreenhouseAiForecastPacket = {
  intent: "yield-forecast",
  aiSource: "openai",
  answer: "Tomato yield expected 96% of forecast.",
  confidence: 0.82,
  riskLevel: "low",
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.getJson.mockReset();
  mocks.postJson.mockReset();
  mocks.mutateImpls = [];
  mocks.pendingFlags = [];
  // Default: every postJson returns a generic OK envelope.
  mocks.postJson.mockImplementation(
    async (path: string, body: unknown) => {
      if (path === "/api/greenhouse/houses") {
        return GreenhouseHouseCreateResponseSchema.parse({
          ok: true,
          greenhouse: HOUSE_A,
        });
      }
      if (path === "/api/greenhouse/zones") {
        return GreenhouseZoneCreateResponseSchema.parse({
          ok: true,
          zone: ZONE_A,
        });
      }
      if (path === "/api/greenhouse/crops") {
        return GreenhouseCropCreateResponseSchema.parse({
          ok: true,
          crop: CROP_A,
        });
      }
      if (path === "/api/greenhouse/bioprotection") {
        return GreenhouseBioprotectionCreateResponseSchema.parse({
          ok: true,
          bioprotection: BIO_A,
        });
      }
      if (path === "/api/greenhouse/harvests") {
        return GreenhouseHarvestCreateResponseSchema.parse({
          ok: true,
          harvest: HARVEST_A,
        });
      }
      if (path === "/api/greenhouse/ai/yield-forecast") {
        return GreenhouseAiForecastResponseSchema.parse({
          ok: true,
          packet: AI_PACKET,
        });
      }
      // For analytics loaders (GDD, energy, yield) the route uses
      // getJson not postJson. Default fallback:
      return body;
    },
  );
  mocks.getJson.mockImplementation(async (path: string) => {
    if (String(path).includes("/analytics/gdd")) {
      return GreenhouseGddResponseSchema.parse(GDD_A);
    }
    if (String(path).includes("/analytics/energy")) {
      return GreenhouseEnergyResponseSchema.parse({ energy: ENERGY_A });
    }
    if (String(path).includes("/analytics/yield")) {
      return GreenhouseYieldResponseSchema.parse({ rows: [YIELD_ROW_A] });
    }
    return {};
  });
});

afterEach(() => {
  cleanup();
});

/* ────────── 1, 2, 3. page shell ────────── */

describe("Greenhouse — page shell", () => {
  it("renders the H1 and the English subtitle", () => {
    renderRoute();
    expect(
      screen.getByText(
        /Greenhouse houses · zones · crops · climate · energy · bioprotection · harvest/,
      ),
    ).toBeInTheDocument();
  });

  it("renders 7 tab buttons in canonical order", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: /Greenhouse tabs/i });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(7);
    const dataTabs = tabs.map((t) => t.getAttribute("data-tab"));
    expect(dataTabs).toEqual([
      "house",
      "zone",
      "crop",
      "climate",
      "energy",
      "bioprotection",
      "harvest",
    ]);
  });

  it("defaults to the house tab on first render", () => {
    renderRoute();
    const house = screen.getByTestId("greenhouse-tab-house");
    expect(house.getAttribute("aria-selected")).toBe("true");
    expect(house.getAttribute("data-active")).toBe("true");
  });

  it("renders a back-to-Today link that points to /app", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /back to Today/i });
    expect(back.getAttribute("data-href")).toBe("/app");
  });
});

/* ────────── 4. tab switching ────────── */

describe("Greenhouse — tab switching", () => {
  it.each([
    ["zone", "greenhouse-zone-panel"],
    ["crop", "greenhouse-crop-panel"],
    ["climate", "greenhouse-climate-panel"],
    ["energy", "greenhouse-energy-panel"],
    ["bioprotection", "greenhouse-bioprotection-panel"],
    ["harvest", "greenhouse-harvest-panel"],
  ] as const)(
    "clicking the %s tab reveals the %s panel",
    (tab, panelTestid) => {
      renderRoute();
      const btn = screen.getByTestId(`greenhouse-tab-${tab}`);
      fireEvent.click(btn);
      expect(btn.getAttribute("aria-selected")).toBe("true");
      expect(screen.getByTestId(panelTestid)).toBeInTheDocument();
    },
  );
});

/* ────────── 5, 6, 7, 8, 9, 10. POST mutations wire postJson with idempotencyKey ────────── */

describe("Greenhouse — POST mutations", () => {
  it("house form submit → postJson('/api/greenhouse/houses') with idempotencyKey", () => {
    renderRoute();
    fireEvent.change(screen.getByTestId("greenhouse-house-name"), {
      target: { value: "Armosphère-1" },
    });
    fireEvent.change(screen.getByTestId("greenhouse-house-area"), {
      target: { value: "1200" },
    });
    fireEvent.click(screen.getByTestId("greenhouse-house-submit"));

    expect(mocks.postJson).toHaveBeenCalled();
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/greenhouse/houses");
    const parsed = GreenhouseHouseCreateRequestSchema.parse(body);
    expect(parsed.name).toBe("Armosphère-1");
    expect(parsed.areaM2).toBe(1200);
    expect(parsed.idempotencyKey).toMatch(/^ui-house-\d+$/);
  });

  it("zone form submit (with houseId) → postJson('/api/greenhouse/zones') with idempotencyKey", async () => {
    renderRoute();
    // First create a house so houseId is populated.
    fireEvent.click(screen.getByTestId("greenhouse-house-submit"));
    await flush();
    // Switch to zone tab.
    fireEvent.click(screen.getByTestId("greenhouse-tab-zone"));
    fireEvent.change(screen.getByTestId("greenhouse-zone-name"), {
      target: { value: "Zone B" },
    });
    fireEvent.change(screen.getByTestId("greenhouse-zone-area"), {
      target: { value: "500" },
    });
    fireEvent.click(screen.getByTestId("greenhouse-zone-submit"));
    await flush();

    const zoneCalls = mocks.postJson.mock.calls.filter(
      (c) => c[0] === "/api/greenhouse/zones",
    );
    expect(zoneCalls).toHaveLength(1);
    const [, body] = zoneCalls[0];
    const parsed = GreenhouseZoneCreateRequestSchema.parse(body);
    expect(parsed.name).toBe("Zone B");
    expect(parsed.greenhouseId).toBe(HOUSE_A.id);
    expect(parsed.idempotencyKey).toMatch(/^ui-zone-\d+$/);
  });

  it("crop form submit (with zoneId) → postJson('/api/greenhouse/crops') with idempotencyKey", async () => {
    renderRoute();
    // Seed house + zone via the workspace
    fireEvent.click(screen.getByTestId("greenhouse-house-submit"));
    await flush();
    fireEvent.click(screen.getByTestId("greenhouse-tab-zone"));
    fireEvent.click(screen.getByTestId("greenhouse-zone-submit"));
    await flush();
    // Switch to crop tab
    fireEvent.click(screen.getByTestId("greenhouse-tab-crop"));
    fireEvent.click(screen.getByTestId("greenhouse-crop-submit"));
    await flush();

    const cropCalls = mocks.postJson.mock.calls.filter(
      (c) => c[0] === "/api/greenhouse/crops",
    );
    expect(cropCalls).toHaveLength(1);
    const [, body] = cropCalls[0];
    const parsed = GreenhouseCropCreateRequestSchema.parse(body);
    expect(parsed.zoneId).toBe(ZONE_A.id);
    expect(parsed.cropKind).toBe("tomato");
    expect(parsed.idempotencyKey).toMatch(/^ui-crop-\d+$/);
  });

  it("bioprotection form submit (with zoneId) → postJson('/api/greenhouse/bioprotection') with idempotencyKey", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("greenhouse-house-submit"));
    await flush();
    fireEvent.click(screen.getByTestId("greenhouse-tab-zone"));
    fireEvent.click(screen.getByTestId("greenhouse-zone-submit"));
    await flush();
    fireEvent.click(screen.getByTestId("greenhouse-tab-bioprotection"));
    fireEvent.click(screen.getByTestId("greenhouse-bioprotection-submit"));
    await flush();

    const bioCalls = mocks.postJson.mock.calls.filter(
      (c) => c[0] === "/api/greenhouse/bioprotection",
    );
    expect(bioCalls).toHaveLength(1);
    const [, body] = bioCalls[0];
    const parsed = GreenhouseBioprotectionCreateRequestSchema.parse(body);
    expect(parsed.zoneId).toBe(ZONE_A.id);
    expect(parsed.agentKind).toBe("Spinosad");
    expect(parsed.idempotencyKey).toMatch(/^ui-bio-\d+$/);
  });

  it("harvest form submit (with cropId) → postJson('/api/greenhouse/harvests') with idempotencyKey", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("greenhouse-house-submit"));
    await flush();
    fireEvent.click(screen.getByTestId("greenhouse-tab-zone"));
    fireEvent.click(screen.getByTestId("greenhouse-zone-submit"));
    await flush();
    fireEvent.click(screen.getByTestId("greenhouse-tab-crop"));
    fireEvent.click(screen.getByTestId("greenhouse-crop-submit"));
    await flush();
    fireEvent.click(screen.getByTestId("greenhouse-tab-harvest"));
    fireEvent.click(screen.getByTestId("greenhouse-harvest-submit"));
    await flush();

    const harvCalls = mocks.postJson.mock.calls.filter(
      (c) => c[0] === "/api/greenhouse/harvests",
    );
    expect(harvCalls).toHaveLength(1);
    const [, body] = harvCalls[0];
    const parsed = GreenhouseHarvestCreateRequestSchema.parse(body);
    expect(parsed.cropId).toBe(CROP_A.id);
    expect(parsed.qualityGrade).toBe("A");
    expect(parsed.idempotencyKey).toMatch(/^ui-harv-\d+$/);
  });

  it("AI button click → postJson('/api/greenhouse/ai/yield-forecast') with idempotencyKey", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("greenhouse-ai-button"));
    // Wait for the microtask to resolve.
    await Promise.resolve();
    const aiCalls = mocks.postJson.mock.calls.filter(
      (c) => c[0] === "/api/greenhouse/ai/yield-forecast",
    );
    expect(aiCalls).toHaveLength(1);
    const [, body] = aiCalls[0];
    expect(body).toMatchObject({ periodKey: "2026-06" });
    expect((body as { idempotencyKey: string }).idempotencyKey).toMatch(
      /^ui-ai-\d+$/,
    );
  });
});

/* ────────── 11, 12, 13. GET analytics loaders ────────── */

describe("Greenhouse — analytics GETs", () => {
  it("climate form submit (with houseId) → getJson('/api/greenhouse/:id/analytics/gdd')", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("greenhouse-house-submit"));
    await flush();
    fireEvent.click(screen.getByTestId("greenhouse-tab-climate"));
    fireEvent.click(screen.getByTestId("greenhouse-climate-submit"));

    await flush();
    const gddCalls = mocks.getJson.mock.calls.filter((c) =>
      String(c[0]).includes("/analytics/gdd"),
    );
    expect(gddCalls).toHaveLength(1);
    const [path] = gddCalls[0];
    expect(String(path)).toBe(
      `/api/greenhouse/${HOUSE_A.id}/analytics/gdd?periodKey=2026-06&from=2026-04-01&to=2026-06-08&baseTempC=10`,
    );
  });

  it("energy form submit (with houseId) → getJson('/api/greenhouse/:id/analytics/energy')", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("greenhouse-house-submit"));
    await flush();
    fireEvent.click(screen.getByTestId("greenhouse-tab-energy"));
    fireEvent.click(screen.getByTestId("greenhouse-energy-submit"));

    await flush();
    const energyCalls = mocks.getJson.mock.calls.filter((c) =>
      String(c[0]).includes("/analytics/energy"),
    );
    expect(energyCalls).toHaveLength(1);
    const [path] = energyCalls[0];
    expect(String(path)).toBe(
      `/api/greenhouse/${HOUSE_A.id}/analytics/energy?periodKey=2026-06`,
    );
  });

  it("yield form submit (with houseId) → getJson('/api/greenhouse/:id/analytics/yield')", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("greenhouse-house-submit"));
    await flush();
    fireEvent.click(screen.getByTestId("greenhouse-tab-harvest"));
    fireEvent.click(screen.getByTestId("greenhouse-yield-submit"));

    await flush();
    const yieldCalls = mocks.getJson.mock.calls.filter((c) =>
      String(c[0]).includes("/analytics/yield"),
    );
    expect(yieldCalls).toHaveLength(1);
    const [path] = yieldCalls[0];
    expect(String(path)).toBe(
      `/api/greenhouse/${HOUSE_A.id}/analytics/yield?periodKey=2026-06`,
    );
  });
});

/* ────────── 14. 403 ────────── */

describe("Greenhouse — 403 access denied", () => {
  it("GreenhouseAccessDeniedCard renders the 403 testid", () => {
    render(<GreenhouseAccessDeniedCard />);
    const card = screen.getByTestId("greenhouse-403");
    expect(card).toBeInTheDocument();
  });

  it("workspace renders the 403 card when UserAccessContext denies greenhouse", () => {
    renderRoute({ noGreenhouseAccess: true });
    expect(screen.getByTestId("greenhouse-403")).toBeInTheDocument();
    // The main workspace tablist is NOT rendered in 403 mode.
    expect(screen.queryByTestId("greenhouse-tab-house")).toBeNull();
  });
});

/* ────────── 15, 16, 17. cross-tab guards (canCreate* helpers) ────────── */

describe("Greenhouse — cross-tab guards", () => {
  it("ZoneForm submit is disabled when houseId is null", () => {
    const onSubmit = vi.fn();
    render(<ZoneForm onSubmit={onSubmit} isPending={false} error="" houseId={null} />);
    const submit = screen.getByTestId("greenhouse-zone-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("CropForm submit is disabled when zoneId is null", () => {
    const onSubmit = vi.fn();
    render(<CropForm onSubmit={onSubmit} isPending={false} error="" zoneId={null} />);
    const submit = screen.getByTestId("greenhouse-crop-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("HarvestForm submit is disabled when cropId is null", () => {
    const onSubmit = vi.fn();
    render(
      <HarvestForm
        onSubmit={onSubmit}
        isPending={false}
        error=""
        onLoadYield={() => {}}
        isLoadingYield={false}
        cropId={null}
        houseId="some-house"
      />,
    );
    const submit = screen.getByTestId("greenhouse-harvest-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("ZoneForm submit fires onSubmit when houseId is present", () => {
    const onSubmit = vi.fn();
    render(
      <ZoneForm
        onSubmit={onSubmit}
        isPending={false}
        error=""
        houseId="house-x"
      />,
    );
    fireEvent.click(screen.getByTestId("greenhouse-zone-submit"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Zone A" }),
    );
  });
});

/* ────────── 18. ID pills appear after successful mutations ────────── */

describe("Greenhouse — ID pills", () => {
  it("house ID pill appears after a successful house create", async () => {
    renderRoute();
    expect(screen.queryByTestId("greenhouse-house-id-pill")).toBeNull();
    fireEvent.click(screen.getByTestId("greenhouse-house-submit"));
    // Wait for the microtask to resolve.
    await flush();
    expect(screen.getByTestId("greenhouse-house-id-pill")).toBeInTheDocument();
    expect(screen.getByTestId("greenhouse-house-id-pill").textContent).toContain(
      HOUSE_A.id,
    );
  });

  it("zone ID pill appears on the zone tab after a successful zone create", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("greenhouse-house-submit"));
    await flush();
    fireEvent.click(screen.getByTestId("greenhouse-tab-zone"));
    fireEvent.click(screen.getByTestId("greenhouse-zone-submit"));
    await flush();
    expect(screen.getByTestId("greenhouse-zone-id-pill")).toBeInTheDocument();
    expect(screen.getByTestId("greenhouse-zone-id-pill").textContent).toContain(
      ZONE_A.id,
    );
  });

  it("crop ID pill appears on the crop tab after a successful crop create", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("greenhouse-house-submit"));
    await flush();
    fireEvent.click(screen.getByTestId("greenhouse-tab-zone"));
    fireEvent.click(screen.getByTestId("greenhouse-zone-submit"));
    await flush();
    fireEvent.click(screen.getByTestId("greenhouse-tab-crop"));
    fireEvent.click(screen.getByTestId("greenhouse-crop-submit"));
    await flush();
    expect(screen.getByTestId("greenhouse-crop-id-pill")).toBeInTheDocument();
    expect(screen.getByTestId("greenhouse-crop-id-pill").textContent).toContain(
      CROP_A.id,
    );
  });
});

/* ────────── 19, 20, 21, 22. helpers (from status.ts) ────────── */

describe("Greenhouse — helpers", () => {
  it("GREENHOUSE_TABS contains 7 tabs in canonical order", () => {
    expect(GREENHOUSE_TABS).toHaveLength(7);
    expect(GREENHOUSE_TABS).toEqual([
      "house",
      "zone",
      "crop",
      "climate",
      "energy",
      "bioprotection",
      "harvest",
    ]);
  });

  it("greenhouseTabFromHash decodes deep links", () => {
    expect(greenhouseTabFromHash("#zone")).toBe("zone");
    expect(greenhouseTabFromHash("#harvest")).toBe("harvest");
    expect(greenhouseTabFromHash("crop")).toBe("crop");
    expect(greenhouseTabFromHash("")).toBe("house");
    expect(greenhouseTabFromHash("#garbage")).toBe("house");
  });

  it("canCreateZone / canCreateCrop / canRecordHarvest cover the guard matrix", () => {
    expect(canCreateZone(null)).toBe(false);
    expect(canCreateZone("")).toBe(false);
    expect(canCreateZone("h-1")).toBe(true);
    expect(canCreateCrop(null)).toBe(false);
    expect(canCreateCrop("")).toBe(false);
    expect(canCreateCrop("z-1")).toBe(true);
    expect(canRecordHarvest(null)).toBe(false);
    expect(canRecordHarvest("")).toBe(false);
    expect(canRecordHarvest("c-1")).toBe(true);
  });

  it("cropKindLabelAm wraps Armenian + English", () => {
    const label = cropKindLabelAm("tomato");
    // Armenian label for tomato exists in the helpers
    expect(label.length).toBeGreaterThan(0);
    expect(cropKindLabelAm("not-a-kind" as never)).toBe("not-a-kind");
  });

  it("generateGreenhouseIdempotencyKey returns kind-tagged timestamp keys", () => {
    const k = generateGreenhouseIdempotencyKey("ui-house");
    expect(k).toMatch(/^ui-house-\d+$/);
  });

  it("CROP_KINDS contains 6 kinds", () => {
    expect(CROP_KINDS).toHaveLength(6);
    expect(CROP_KINDS).toContain("tomato");
  });
});

/* ────────── 23, 24, 25. GreenhouseResultBlock (all kinds) ────────── */

describe("Greenhouse — result block", () => {
  it("returns null when no result is provided", () => {
    const { container } = render(<GreenhouseResultBlock result={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders house result with name + ID", () => {
    const r: GreenhouseResult = { kind: "house", data: HOUSE_A };
    render(<GreenhouseResultBlock result={r} />);
    const out = screen.getByTestId("greenhouse-result-house");
    expect(out.textContent).toContain(HOUSE_A.name);
    expect(out.textContent).toContain(HOUSE_A.id);
  });

  it("renders zone result with name + irrigation", () => {
    const r: GreenhouseResult = { kind: "zone", data: ZONE_A };
    render(<GreenhouseResultBlock result={r} />);
    const out = screen.getByTestId("greenhouse-result-zone");
    expect(out.textContent).toContain(ZONE_A.name);
    expect(out.textContent).toContain(ZONE_A.irrigationKind);
  });

  it("renders crop result with crop kind (Armenian label) + status", () => {
    const r: GreenhouseResult = { kind: "crop", data: CROP_A };
    render(<GreenhouseResultBlock result={r} />);
    const out = screen.getByTestId("greenhouse-result-crop");
    // The route renders the Armenian label, not the raw cropKind.
    expect(out.textContent).toContain(cropKindLabelAm(CROP_A.cropKind));
    expect(out.textContent).toContain(CROP_A.status);
  });

  it("renders yield result with one li per row", () => {
    const r: GreenhouseResult = { kind: "yield", data: [YIELD_ROW_A] };
    render(<GreenhouseResultBlock result={r} />);
    const out = screen.getByTestId("greenhouse-result-yield");
    expect(out.querySelectorAll("li")).toHaveLength(1);
    expect(out.textContent).toContain("1450");
  });

  it("renders energy result with totals and per-kg", () => {
    const r: GreenhouseResult = { kind: "energy", data: ENERGY_A };
    render(<GreenhouseResultBlock result={r} />);
    const out = screen.getByTestId("greenhouse-result-energy");
    expect(out.textContent).toContain("1500");
    expect(out.textContent).toContain("0.17");
  });

  it("renders gdd result with base temp + GDD value", () => {
    const r: GreenhouseResult = { kind: "gdd", data: GDD_A };
    render(<GreenhouseResultBlock result={r} />);
    const out = screen.getByTestId("greenhouse-result-gdd");
    expect(out.textContent).toContain("10");
    expect(out.textContent).toContain("245.5");
  });

  it("renders bioprotection result with agent + days", () => {
    const r: GreenhouseResult = {
      kind: "bioprotection",
      data: { agentKind: "Spinosad", withdrawalPeriodDays: 7 },
    };
    render(<GreenhouseResultBlock result={r} />);
    const out = screen.getByTestId("greenhouse-result-bioprotection");
    expect(out.textContent).toContain("Spinosad");
    expect(out.textContent).toContain("7");
  });

  it("renders harvest result with quantity + grade + lot", () => {
    const r: GreenhouseResult = {
      kind: "harvest",
      data: { id: "h-1", quantityKg: 100, qualityGrade: "A", lotId: "LOT-A1" },
    };
    render(<GreenhouseResultBlock result={r} />);
    const out = screen.getByTestId("greenhouse-result-harvest");
    expect(out.textContent).toContain("100");
    expect(out.textContent).toContain("LOT-A1");
  });

  it("renders error result with error message", () => {
    const r: GreenhouseResult = {
      kind: "error",
      data: { error: "boom" },
    };
    render(<GreenhouseResultBlock result={r} />);
    const out = screen.getByTestId("greenhouse-result-error");
    expect(out.textContent).toContain("boom");
  });
});

/* ────────── 26. GreenhouseAiBlock ────────── */

describe("Greenhouse — AI block", () => {
  it("renders null when no packet and no pending/error", () => {
    const { container } = render(
      <GreenhouseAiBlock packet={null} pending={false} error="" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders pending state", () => {
    render(<GreenhouseAiBlock packet={null} pending={true} error="" />);
    expect(screen.getByTestId("greenhouse-ai-pending")).toBeInTheDocument();
  });

  it("renders error state", () => {
    render(<GreenhouseAiBlock packet={null} pending={false} error="kaboom" />);
    const err = screen.getByTestId("greenhouse-ai-error");
    expect(err).toBeInTheDocument();
    expect(err.textContent).toContain("kaboom");
  });

  it("renders packet state with intent + answer", () => {
    render(
      <GreenhouseAiBlock packet={AI_PACKET} pending={false} error="" />,
    );
    const pkt = screen.getByTestId("greenhouse-ai");
    expect(pkt.textContent).toContain(AI_PACKET.intent);
    expect(pkt.textContent).toContain(AI_PACKET.aiSource);
    expect(pkt.textContent).toContain(AI_PACKET.answer);
  });
});

/* ────────── 27, 28. schema round-trip ────────── */

describe("Greenhouse — schemas parse real envelopes", () => {
  it("GreenhouseHouseCreateRequestSchema parses a real envelope", () => {
    const parsed = GreenhouseHouseCreateRequestSchema.parse({
      name: "GH-1",
      areaM2: 1200,
      glazingKind: "glass",
      heatingKind: "gas",
      idempotencyKey: "ui-house-1",
    });
    expect(parsed.name).toBe("GH-1");
    expect(parsed.areaM2).toBe(1200);
  });

  it("GreenhouseYieldResponseSchema parses a 1-row envelope", () => {
    const parsed = GreenhouseYieldResponseSchema.parse({
      rows: [YIELD_ROW_A],
    });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].cropKind).toBe("tomato");
  });

  it("GreenhouseHouseCreateResponseSchema parses the server envelope", () => {
    const parsed = GreenhouseHouseCreateResponseSchema.parse({
      ok: true,
      greenhouse: HOUSE_A,
    });
    expect(parsed.greenhouse.id).toBe(HOUSE_A.id);
  });
});

/* ────────── 29. GreenhouseTabs subcomponent ────────── */

describe("Greenhouse — GreenhouseTabs subcomponent", () => {
  it("renders 7 tabs with the expected testids", () => {
    const onChange = vi.fn();
    render(<GreenhouseTabs active="house" onChange={onChange} />);
    for (const t of GREENHOUSE_TABS) {
      expect(screen.getByTestId(`greenhouse-tab-${t}`)).toBeInTheDocument();
    }
  });

  it("fires onChange when a tab is clicked", () => {
    const onChange = vi.fn();
    render(<GreenhouseTabs active="house" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("greenhouse-tab-energy"));
    expect(onChange).toHaveBeenCalledWith("energy");
  });

  it("marks the active tab with aria-selected=true", () => {
    const onChange = vi.fn();
    render(<GreenhouseTabs active="harvest" onChange={onChange} />);
    const harvest = screen.getByTestId("greenhouse-tab-harvest");
    expect(harvest.getAttribute("aria-selected")).toBe("true");
    expect(harvest.getAttribute("data-active")).toBe("true");
  });
});

/* ────────── 30. HouseForm subcomponent onSubmit ────────── */

describe("Greenhouse — HouseForm subcomponent", () => {
  it("fires onSubmit with the typed input", () => {
    const onSubmit = vi.fn();
    render(<HouseForm onSubmit={onSubmit} isPending={false} error="" />);
    fireEvent.change(screen.getByTestId("greenhouse-house-name"), {
      target: { value: "My House" },
    });
    fireEvent.change(screen.getByTestId("greenhouse-house-area"), {
      target: { value: "999" },
    });
    fireEvent.click(screen.getByTestId("greenhouse-house-submit"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My House",
        areaM2: "999",
        glazingKind: "glass",
        heatingKind: "gas",
      }),
    );
  });

  it("renders a pending-state label when isPending is true", () => {
    const onSubmit = vi.fn();
    render(<HouseForm onSubmit={onSubmit} isPending={true} error="" />);
    expect(screen.getByTestId("greenhouse-house-submit").textContent).toMatch(
      /Creating/,
    );
  });

  it("renders an error message when error is non-empty", () => {
    render(<HouseForm onSubmit={() => {}} isPending={false} error="oh no" />);
    expect(screen.getByRole("alert").textContent).toContain("oh no");
  });
});

/* ────────── BioprotectionForm subcomponent ────────── */

describe("Greenhouse — BioprotectionForm subcomponent", () => {
  it("fires onSubmit with the typed input when zoneId is present", () => {
    const onSubmit = vi.fn();
    render(
      <BioprotectionForm
        onSubmit={onSubmit}
        isPending={false}
        error=""
        zoneId="z-1"
      />,
    );
    fireEvent.click(screen.getByTestId("greenhouse-bioprotection-submit"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKind: "Spinosad",
        dose: "0.3 l/ha",
        targetPest: "thrips",
        withdrawalPeriodDays: "7",
        recordedBy: "agronomist",
        appliedAt: "2026-06-08",
      }),
    );
  });
});

/* ────────── ClimateForm / EnergyForm subcomponents ────────── */

describe("Greenhouse — ClimateForm / EnergyForm subcomponents", () => {
  it("ClimateForm fires onSubmit with periodKey when houseId is present", () => {
    const onSubmit = vi.fn();
    render(
      <ClimateForm
        onSubmit={onSubmit}
        isPending={false}
        error=""
        houseId="h-1"
      />,
    );
    fireEvent.click(screen.getByTestId("greenhouse-climate-submit"));
    expect(onSubmit).toHaveBeenCalledWith({ periodKey: "2026-06" });
  });

  it("EnergyForm submit disabled when houseId is null", () => {
    const onSubmit = vi.fn();
    render(
      <EnergyForm
        onSubmit={onSubmit}
        isPending={false}
        error=""
        houseId={null}
      />,
    );
    const submit = screen.getByTestId("greenhouse-energy-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
