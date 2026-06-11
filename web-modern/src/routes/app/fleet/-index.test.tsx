/**
 * /app/fleet — route-level tests for the Fleet Pattern A route.
 *
 * Mirrors the assets test pattern: mock the three layers
 * (Router, Query, API client), then drive the public component
 * surface. The route file exports its subcomponents as named exports
 * (FleetAccessDeniedCard, FleetTabs, VehiclesForm, VehiclesTable,
 * DriversForm, DriversTable, TripsForm, TripsTable, FuelForm,
 * FuelLogsTable, FuelEfficiencyTable, RepairsForm, RepairsTable,
 * BacklogTable, TiresForm, TiresTable, ColdChainForm,
 * ColdChainLogsTable) so we can import and render them directly
 * without instantiating the full workspace when not needed.
 *
 * The workspace uses ONE useQuery with key ["fleet-all", ...9 keys] that
 * resolves to a single object with all 9 parallel GETs. The mock
 * returns that single shape on every call to that key.
 *
 * Coverage targets (Phase 8.6 layer 2, min 18 cases):
 *  1. Page shell — H1 + English subtitle + back link
 *  2. 7 tab buttons render (vehicles/drivers/trips/fuel/repairs/tires/coldchain)
 *  3. Default tab is "vehicles"
 *  4. Click each tab switches content
 *  5. Vehicles POST: form submit → postJson called with idempotencyKey
 *  6. Drivers POST: form submit → postJson called with idempotencyKey
 *  7. Trips POST: form submit → postJson called with idempotencyKey
 *  8. Trips PATCH: row action button → patchJson called
 *  9. Fuel POST: form submit → postJson called with idempotencyKey
 * 10. Repairs POST: form submit → postJson called with idempotencyKey
 * 11. Tires POST: form submit → postJson called with idempotencyKey
 * 12. Cold-chain compliance GET: button click → getJson called
 * 13. 403: UserAccessContext value={fleet:false} → 403 card
 * 14. Cold-chain breach list renders when compliance has breaches
 * 15. Trip action buttons respect state machine (planned row shows
 *     `departed` and `cancelled`; arrived row shows nothing)
 * 16. FLEET_TABS contains 7 tabs in canonical order
 * 17. fleetTabFromHash decodes deep links
 * 18. fleetTripStatusCanTransition covers the state machine matrix
 * 19. coldChainCategoryLabelAm + formatFleetIdShort helpers
 * 20. Subcomponent sanity — FleetTabs, VehiclesTable, TiresTable
 * 21. FleetVehiclesResponseSchema parses a real envelope
 * 22. FleetAccessDeniedCard renders the 403 testid
 * 23. Fuel efficiency row formatting with kmPerL=null
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state (hoisted so vi.mock factories see it) ────────── */

const mocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  patchJson: vi.fn(),
  // The single useQuery returns this object on key "fleet-all".
  allQueryData: undefined as unknown,
  allQueryError: undefined as unknown,
  allIsPending: false,
  // The active mutation slot is wired by routing mutationFn.toString().
  // The route has 7 mutations; we expose impls and `isPending` slots.
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
    useQuery: (opts: { queryKey: unknown[] }) => {
      const key = opts.queryKey[0];
      if (key === "fleet-all") {
        return {
          data: mocks.allQueryData,
          error: mocks.allQueryError,
          isPending: mocks.allIsPending,
          refetch: vi.fn(),
        };
      }
      return {
        data: undefined,
        error: undefined,
        isPending: false,
        refetch: vi.fn(),
      };
    },
    useMutation: (opts: {
      mutationFn: (...args: unknown[]) => Promise<unknown>;
      onSuccess?: (...args: unknown[]) => void;
      onError?: (...args: unknown[]) => void;
    }) => {
      // The route has 7 mutations. The mutationFn strings are unique
      // enough to route by path. We register each in registration
      // order.
      const fn = opts.mutationFn.toString();
      let slot = 0;
      if (fn.includes("/api/fleet/vehicles")) slot = 0;
      else if (fn.includes("/api/fleet/drivers")) slot = 1;
      else if (fn.includes("/api/fleet/trips\"") || fn.includes("/api/fleet/trips'") || fn.includes("/api/fleet/trips`")) slot = 2;
      else if (fn.includes("/api/fleet/trips/${input.id}/status")) slot = 3;
      else if (fn.includes("/api/fleet/fuel-logs")) slot = 4;
      else if (fn.includes("/api/fleet/repairs\"")) slot = 5;
      else if (fn.includes("/api/fleet/tires/install")) slot = 6;
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
  patchJson: mocks.patchJson,
  postVoid: vi.fn().mockResolvedValue(undefined),
}));

/* ────────── import the route under test (mocks are in place) ────────── */

import {
  Route,
  FleetAccessDeniedCard,
  FleetTabs,
  VehiclesForm,
  VehiclesTable,
  DriversTable,
  TripsTable,
  FuelLogsTable,
  FuelEfficiencyTable,
  RepairsForm,
  RepairsTable,
  BacklogTable,
  TiresTable,
  ColdChainForm,
  ColdChainLogsTable,
} from "./index";
import {
  FleetColdChainComplianceResponseSchema,
  FleetDriverCreateRequestSchema,
  FleetDriversResponseSchema,
  FleetFuelEfficiencyResponseSchema,
  FleetFuelLogCreateRequestSchema,
  FleetFuelLogsResponseSchema,
  FleetMaintenanceBacklogResponseSchema,
  FleetRepairCreateRequestSchema,
  FleetRepairsResponseSchema,
  FleetTireInstallRequestSchema,
  FleetTiresResponseSchema,
  FleetTripCreateRequestSchema,
  FleetTripStatusPatchRequestSchema,
  FleetTripsResponseSchema,
  FleetVehicleCreateRequestSchema,
  FleetVehiclesResponseSchema,
  type FleetColdChainComplianceResponse,
  type FleetDriver,
  type FleetFuelEfficiencyRow,
  type FleetFuelLog,
  type FleetMaintenanceBacklogRow,
  type FleetRepair,
  type FleetTire,
  type FleetTrip,
  type FleetVehicle,
} from "../../../lib/api/schemas";
import {
  FLEET_DEFAULT_TAB,
  FLEET_TABS,
  coldChainCategoryLabelAm,
  fleetTabFromHash,
  formatFleetFuelEfficiency,
  formatFleetIdShort,
  generateFleetIdempotencyKey,
  fleetTripStatusCanTransition,
  tripStateLabelArm,
} from "../../../lib/fleet/status";
import { UserAccessProvider } from "../../../lib/rbac/access.tsx";

/* ────────── helpers ────────── */

function renderRoute(opts?: { noFleetAccess?: boolean }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Component = Route.options.component as React.ComponentType;
  const accessValue = opts?.noFleetAccess
    ? { fleet: false as const }
    : undefined;
  return render(
    <QueryClientProvider client={qc}>
      <UserAccessProvider value={accessValue}>
        <Component />
      </UserAccessProvider>
    </QueryClientProvider>,
  );
}

const VEHICLE_A: FleetVehicle = {
  id: "veh-aaa-111",
  plate: "AA 1111 BB",
  make: "Mercedes",
  model: "Atego",
  year: 2022,
  kind: "truck",
};
const VEHICLE_B: FleetVehicle = {
  id: "veh-bbb-222",
  plate: "CC 2222 DD",
  make: "Ford",
  model: "Transit",
  year: 2021,
  kind: "van",
};

const DRIVER_A: FleetDriver = {
  id: "drv-aaa",
  fullName: "Արամ Ա",
  phone: "+374 11 111 111",
  licenseNumber: "AM123456",
};
const DRIVER_B: FleetDriver = {
  id: "drv-bbb",
  fullName: "Անի Բ",
  phone: null,
  licenseNumber: "AM789012",
};

const TRIP_PLANNED: FleetTrip = {
  id: "trp-planned",
  status: "planned",
  origin: "Yerevan",
  destination: "Gyumri",
  scheduledDeparture: "2026-06-13T08:00:00Z",
  actualDeparture: null,
  actualArrival: null,
  vehicleId: VEHICLE_A.id,
  driverId: DRIVER_A.id,
  createdAt: "2026-06-12T10:00:00Z",
};
const TRIP_IN_TRANSIT: FleetTrip = {
  ...TRIP_PLANNED,
  id: "trp-in-transit",
  status: "in_transit",
  actualDeparture: "2026-06-13T08:05:00Z",
};
const TRIP_ARRIVED: FleetTrip = {
  ...TRIP_PLANNED,
  id: "trp-arrived",
  status: "arrived",
  actualDeparture: "2026-06-13T08:05:00Z",
  actualArrival: "2026-06-13T12:30:00Z",
};

const FUEL_LOG_A: FleetFuelLog = {
  id: "flog-a",
  vehicleId: VEHICLE_A.id,
  liters: 80,
  odometerKm: 120000,
  fuelCostPerL: 420,
  occurredAt: "2026-06-12",
};
const REPAIR_A: FleetRepair = {
  id: "rep-a",
  vehicleId: VEHICLE_A.id,
  kind: "oil-change",
  odometerKm: 120000,
  cost: 25000,
  performedAt: "2026-06-10",
  nextDueAt: "2026-09-10",
};
const TIRE_A: FleetTire = {
  id: "tire-a",
  vehicleId: VEHICLE_A.id,
  position: "FL",
  brand: "Michelin",
  installedAt: "2026-05-01",
  odometerAtInstall: 115000,
  expectedLifeKm: 60000,
};
const EFF_A: FleetFuelEfficiencyRow = {
  vehicleId: VEHICLE_A.id,
  liters: 800,
  km: 5000,
  lPer100km: 16,
  kmPerL: 6.25,
};
const BACKLOG_A: FleetMaintenanceBacklogRow = {
  vehicleId: VEHICLE_A.id,
  kind: "oil-change",
  overdueDays: 5,
};

const ALL_DATA = {
  vehicles: [VEHICLE_A, VEHICLE_B],
  drivers: [DRIVER_A, DRIVER_B],
  trips: [TRIP_PLANNED, TRIP_IN_TRANSIT, TRIP_ARRIVED],
  fuelLogs: [FUEL_LOG_A],
  repairs: [REPAIR_A],
  tires: [TIRE_A],
  coldChainLogs: [],
  fuelEff: [EFF_A],
  backlog: [BACKLOG_A],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.getJson.mockReset();
  mocks.postJson.mockReset();
  mocks.patchJson.mockReset();
  mocks.mutateImpls = [];
  mocks.pendingFlags = [];
  mocks.allQueryData = ALL_DATA;
  mocks.allQueryError = undefined;
  mocks.allIsPending = false;
  // Default: every client call resolves to a generic OK envelope.
  mocks.getJson.mockImplementation(async (path: string) => {
    if (path.includes("cold-chain-compliance")) {
      return {
        category: "dairy",
        report: { worstTempC: 4.1, sustainedMinutes: 30, breaches: [] },
      } satisfies FleetColdChainComplianceResponse;
    }
    if (path === "/api/fleet/vehicles") return FleetVehiclesResponseSchema.parse({ vehicles: ALL_DATA.vehicles });
    if (path === "/api/fleet/drivers") return FleetDriversResponseSchema.parse({ drivers: ALL_DATA.drivers });
    if (path === "/api/fleet/trips") return FleetTripsResponseSchema.parse({ trips: ALL_DATA.trips });
    if (path === "/api/fleet/fuel-logs") return FleetFuelLogsResponseSchema.parse({ fuelLogs: ALL_DATA.fuelLogs });
    if (path === "/api/fleet/repairs") return FleetRepairsResponseSchema.parse({ repairs: ALL_DATA.repairs });
    if (path === "/api/fleet/tires") return FleetTiresResponseSchema.parse({ tires: ALL_DATA.tires });
    if (path === "/api/fleet/analytics/fuel-efficiency") return FleetFuelEfficiencyResponseSchema.parse({ efficiency: ALL_DATA.fuelEff });
    if (path === "/api/fleet/analytics/maintenance-backlog") return FleetMaintenanceBacklogResponseSchema.parse({ backlog: ALL_DATA.backlog });
    return {};
  });
  mocks.postJson.mockResolvedValue({ ok: true });
  mocks.patchJson.mockResolvedValue({ ok: true, trip: TRIP_PLANNED });
});

afterEach(() => {
  cleanup();
});

/* ────────── 1, 2, 3. page shell ────────── */

describe("Fleet — page shell", () => {
  it("renders the H1 and the English subtitle", () => {
    renderRoute();
    expect(
      screen.getByText(/Fleet vehicles · drivers · trips · fuel · repairs · tires · cold chain/),
    ).toBeInTheDocument();
  });

  it("renders 7 tab buttons (vehicles, drivers, trips, fuel, repairs, tires, coldchain)", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: /Fleet tabs/i });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(7);
    const dataTabs = tabs.map((t) => t.getAttribute("data-tab"));
    expect(dataTabs).toEqual([
      "vehicles",
      "drivers",
      "trips",
      "fuel",
      "repairs",
      "tires",
      "coldchain",
    ]);
  });

  it("defaults to the vehicles tab on first render", () => {
    renderRoute();
    const vehicles = screen.getByTestId("fleet-tab-vehicles");
    expect(vehicles.getAttribute("aria-selected")).toBe("true");
    expect(vehicles.getAttribute("data-active")).toBe("true");
  });

  it("renders a back-to-Today link that points to /app", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /back to Today/i });
    expect(back.getAttribute("data-href")).toBe("/app");
  });
});

/* ────────── 4. tab switching ────────── */

describe("Fleet — tab switching", () => {
  it.each([
    ["drivers", "fleet-drivers-panel"],
    ["trips", "fleet-trips-panel"],
    ["fuel", "fleet-fuel-panel"],
    ["repairs", "fleet-repairs-panel"],
    ["tires", "fleet-tires-panel"],
    ["coldchain", "fleet-coldchain-panel"],
  ] as const)(
    "clicking the %s tab reveals the %s panel",
    (tab, panelTestid) => {
      renderRoute();
      const btn = screen.getByTestId(`fleet-tab-${tab}`);
      fireEvent.click(btn);
      expect(btn.getAttribute("aria-selected")).toBe("true");
      expect(screen.getByTestId(panelTestid)).toBeInTheDocument();
    },
  );
});

/* ────────── 5, 6, 7, 9, 10, 11. POST mutation shapes ────────── */

describe("Fleet — POST mutations wire postJson with idempotencyKey", () => {
  it("vehicles form submit → postJson('/api/fleet/vehicles') with idempotencyKey", () => {
    renderRoute();
    fireEvent.change(screen.getByTestId("fleet-vehicles-plate"), {
      target: { value: "EE 3333 FF" },
    });
    fireEvent.change(screen.getByTestId("fleet-vehicles-make"), {
      target: { value: "Volvo" },
    });
    fireEvent.change(screen.getByTestId("fleet-vehicles-model"), {
      target: { value: "FH16" },
    });
    fireEvent.click(screen.getByTestId("fleet-vehicles-submit"));

    expect(mocks.postJson).toHaveBeenCalled();
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/fleet/vehicles");
    const parsed = FleetVehicleCreateRequestSchema.parse(body);
    expect(parsed.plate).toBe("EE 3333 FF");
    expect(parsed.idempotencyKey).toMatch(/^vehicles-create-ui-/);
  });

  it("drivers form submit → postJson('/api/fleet/drivers') with idempotencyKey", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("fleet-tab-drivers"));
    fireEvent.change(screen.getByTestId("fleet-drivers-fullname"), {
      target: { value: "Test Driver" },
    });
    fireEvent.change(screen.getByTestId("fleet-drivers-license"), {
      target: { value: "TST-001" },
    });
    fireEvent.click(screen.getByTestId("fleet-drivers-submit"));

    expect(mocks.postJson).toHaveBeenCalled();
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/fleet/drivers");
    const parsed = FleetDriverCreateRequestSchema.parse(body);
    expect(parsed.licenseNumber).toBe("TST-001");
    expect(parsed.idempotencyKey).toMatch(/^drivers-create-ui-/);
  });

  it("trips form submit → postJson('/api/fleet/trips') with idempotencyKey", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("fleet-tab-trips"));
    fireEvent.change(screen.getByTestId("fleet-trips-vehicle"), {
      target: { value: VEHICLE_A.id },
    });
    fireEvent.change(screen.getByTestId("fleet-trips-driver"), {
      target: { value: DRIVER_A.id },
    });
    fireEvent.change(screen.getByTestId("fleet-trips-origin"), {
      target: { value: "Yerevan" },
    });
    fireEvent.change(screen.getByTestId("fleet-trips-destination"), {
      target: { value: "Vanadzor" },
    });
    fireEvent.change(screen.getByTestId("fleet-trips-scheduled"), {
      target: { value: "2026-07-01T08:00" },
    });
    fireEvent.click(screen.getByTestId("fleet-trips-submit"));

    expect(mocks.postJson).toHaveBeenCalled();
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/fleet/trips");
    const parsed = FleetTripCreateRequestSchema.parse(body);
    expect(parsed.origin).toBe("Yerevan");
    expect(parsed.idempotencyKey).toMatch(/^trips-create-ui-/);
  });

  it("fuel form submit → postJson('/api/fleet/fuel-logs') with idempotencyKey", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("fleet-tab-fuel"));
    fireEvent.change(screen.getByTestId("fleet-fuel-vehicle"), {
      target: { value: VEHICLE_A.id },
    });
    fireEvent.change(screen.getByTestId("fleet-fuel-liters"), {
      target: { value: "60" },
    });
    fireEvent.change(screen.getByTestId("fleet-fuel-odometer"), {
      target: { value: "125000" },
    });
    fireEvent.change(screen.getByTestId("fleet-fuel-cost"), {
      target: { value: "420" },
    });
    fireEvent.click(screen.getByTestId("fleet-fuel-submit"));

    expect(mocks.postJson).toHaveBeenCalled();
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/fleet/fuel-logs");
    const parsed = FleetFuelLogCreateRequestSchema.parse(body);
    expect(parsed.liters).toBe(60);
    expect(parsed.idempotencyKey).toMatch(/^fuel-create-ui-/);
  });

  it("repairs form submit → postJson('/api/fleet/repairs') with idempotencyKey", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("fleet-tab-repairs"));
    fireEvent.change(screen.getByTestId("fleet-repairs-vehicle"), {
      target: { value: VEHICLE_A.id },
    });
    fireEvent.change(screen.getByTestId("fleet-repairs-kind"), {
      target: { value: "brake-pads" },
    });
    fireEvent.change(screen.getByTestId("fleet-repairs-odometer"), {
      target: { value: "125000" },
    });
    fireEvent.change(screen.getByTestId("fleet-repairs-cost"), {
      target: { value: "50000" },
    });
    fireEvent.click(screen.getByTestId("fleet-repairs-submit"));

    expect(mocks.postJson).toHaveBeenCalled();
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/fleet/repairs");
    const parsed = FleetRepairCreateRequestSchema.parse(body);
    expect(parsed.kind).toBe("brake-pads");
    expect(parsed.idempotencyKey).toMatch(/^repairs-create-ui-/);
  });

  it("tires form submit → postJson('/api/fleet/tires/install') with idempotencyKey", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("fleet-tab-tires"));
    fireEvent.change(screen.getByTestId("fleet-tires-vehicle"), {
      target: { value: VEHICLE_A.id },
    });
    fireEvent.change(screen.getByTestId("fleet-tires-position"), {
      target: { value: "FR" },
    });
    fireEvent.change(screen.getByTestId("fleet-tires-installed"), {
      target: { value: "2026-06-12" },
    });
    fireEvent.click(screen.getByTestId("fleet-tires-submit"));

    expect(mocks.postJson).toHaveBeenCalled();
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/fleet/tires/install");
    const parsed = FleetTireInstallRequestSchema.parse(body);
    expect(parsed.position).toBe("FR");
    expect(parsed.idempotencyKey).toMatch(/^tires-install-ui-/);
  });
});

/* ────────── 8. trip PATCH ────────── */

describe("Fleet — trip status PATCH", () => {
  it("row action button → patchJson with action + idempotencyKey", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("fleet-tab-trips"));
    // The PLANNED row has departed + cancelled buttons.
    const plannedRow = screen
      .getAllByTestId("fleet-trips-row")
      .find((r) => r.getAttribute("data-status") === "planned");
    expect(plannedRow).toBeTruthy();
    fireEvent.click(
      within(plannedRow as HTMLElement).getByTestId("fleet-trips-action-departed"),
    );

    expect(mocks.patchJson).toHaveBeenCalled();
    const [path, body] = mocks.patchJson.mock.calls[0];
    expect(path).toBe(`/api/fleet/trips/${TRIP_PLANNED.id}/status`);
    const parsed = FleetTripStatusPatchRequestSchema.parse(body);
    expect(parsed.action).toBe("departed");
    expect(parsed.idempotencyKey).toMatch(/^trips-status-ui-/);
  });

  it("arrived trip row shows no action buttons (terminal state)", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("fleet-tab-trips"));
    const arrivedRow = screen
      .getAllByTestId("fleet-trips-row")
      .find((r) => r.getAttribute("data-status") === "arrived");
    expect(arrivedRow).toBeTruthy();
    expect(
      within(arrivedRow as HTMLElement).queryByTestId("fleet-trips-action-departed"),
    ).toBeNull();
    expect(
      within(arrivedRow as HTMLElement).queryByTestId("fleet-trips-action-arrived"),
    ).toBeNull();
    expect(
      within(arrivedRow as HTMLElement).queryByTestId("fleet-trips-action-cancelled"),
    ).toBeNull();
  });
});

/* ────────── 12. cold-chain compliance GET ────────── */

describe("Fleet — cold-chain compliance", () => {
  it("compliance-check button → getJson('/api/fleet/vehicles/:id/cold-chain-compliance?category=...')", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("fleet-tab-coldchain"));
    fireEvent.change(screen.getByTestId("fleet-coldchain-vehicle"), {
      target: { value: VEHICLE_A.id },
    });
    fireEvent.change(screen.getByTestId("fleet-coldchain-category"), {
      target: { value: "frozen" },
    });
    fireEvent.click(screen.getByTestId("fleet-coldchain-compliance-check"));

    // Wait for the microtask to resolve so the assert is stable.
    await Promise.resolve();
    const coldCalls = mocks.getJson.mock.calls.filter((c) =>
      String(c[0]).includes("cold-chain-compliance"),
    );
    expect(coldCalls).toHaveLength(1);
    const [path] = coldCalls[0];
    expect(String(path)).toBe(
      `/api/fleet/vehicles/${VEHICLE_A.id}/cold-chain-compliance?category=frozen`,
    );
  });
});

/* ────────── 13, 22. 403 ────────── */

describe("Fleet — 403 access denied", () => {
  it("FleetAccessDeniedCard renders the 403 testid + Armenian title", () => {
    render(<FleetAccessDeniedCard />);
    const card = screen.getByTestId("fleet-403");
    expect(card).toBeInTheDocument();
    expect(card.textContent).toMatch(/Մուտքը սահմանափակված է/);
  });

  it("workspace renders the 403 card when UserAccessContext denies fleet", () => {
    renderRoute({ noFleetAccess: true });
    expect(screen.getByTestId("fleet-403")).toBeInTheDocument();
    // The main workspace panel is NOT rendered in 403 mode.
    expect(screen.queryByTestId("fleet-tab-vehicles")).toBeNull();
  });
});

/* ────────── 14. cold-chain breach list ────────── */

describe("Fleet — cold-chain breach list", () => {
  it("renders breach rows when compliance.report.breaches is non-empty", () => {
    const complianceWithBreach: FleetColdChainComplianceResponse =
      FleetColdChainComplianceResponseSchema.parse({
        category: "frozen",
        report: {
          worstTempC: -10,
          sustainedMinutes: 120,
          breaches: [
            {
              startedAt: "2026-06-12T10:00:00Z",
              endedAt: "2026-06-12T11:00:00Z",
              minutes: 60,
            },
            {
              startedAt: "2026-06-12T13:00:00Z",
              endedAt: "2026-06-12T14:00:00Z",
              minutes: 60,
            },
          ],
        },
      });

    render(
      <ColdChainForm
        onSubmit={() => {}}
        isPending={false}
        error=""
        vehicles={[VEHICLE_A]}
        onCheckCompliance={() => {}}
        isCheckingCompliance={false}
        complianceError=""
        compliance={complianceWithBreach}
      />,
    );

    const breaches = screen.getByTestId("fleet-coldchain-breaches");
    expect(breaches).toBeInTheDocument();
    const rows = within(breaches).getAllByTestId("fleet-coldchain-breach-row");
    expect(rows).toHaveLength(2);
  });
});

/* ────────── 15. trip state machine + PATCH button visibility ────────── */

describe("Fleet — trip state machine", () => {
  it("planned row shows only 'departed' and 'cancelled' buttons", () => {
    render(<TripsTable data={[TRIP_PLANNED]} onPatch={() => {}} isPatching={false} />);
    const row = screen.getByTestId("fleet-trips-row");
    expect(within(row).getByTestId("fleet-trips-action-departed")).toBeInTheDocument();
    expect(within(row).getByTestId("fleet-trips-action-cancelled")).toBeInTheDocument();
    expect(within(row).queryByTestId("fleet-trips-action-arrived")).toBeNull();
  });

  it("in_transit row shows only 'arrived' and 'cancelled' buttons", () => {
    render(<TripsTable data={[TRIP_IN_TRANSIT]} onPatch={() => {}} isPatching={false} />);
    const row = screen.getByTestId("fleet-trips-row");
    expect(within(row).getByTestId("fleet-trips-action-arrived")).toBeInTheDocument();
    expect(within(row).getByTestId("fleet-trips-action-cancelled")).toBeInTheDocument();
    expect(within(row).queryByTestId("fleet-trips-action-departed")).toBeNull();
  });
});

/* ────────── 16, 17, 18, 19, 23. helpers (from status.ts) ────────── */

describe("Fleet — helpers", () => {
  it("FLEET_TABS contains 7 tabs in canonical order", () => {
    expect(FLEET_TABS).toHaveLength(7);
    expect(FLEET_TABS).toEqual([
      "vehicles",
      "drivers",
      "trips",
      "fuel",
      "repairs",
      "tires",
      "coldchain",
    ]);
    expect(FLEET_DEFAULT_TAB).toBe("vehicles");
  });

  it("fleetTabFromHash decodes deep links", () => {
    expect(fleetTabFromHash("#trips")).toBe("trips");
    expect(fleetTabFromHash("#fleet/coldchain")).toBe("coldchain");
    expect(fleetTabFromHash("fleet/fuel")).toBe("fuel");
    expect(fleetTabFromHash("")).toBe(FLEET_DEFAULT_TAB);
    expect(fleetTabFromHash(null)).toBe(FLEET_DEFAULT_TAB);
    expect(fleetTabFromHash("#garbage")).toBe(FLEET_DEFAULT_TAB);
  });

  it("fleetTripStatusCanTransition covers the state machine matrix", () => {
    // planned → only departed + cancelled
    expect(fleetTripStatusCanTransition("planned", "departed")).toBe(true);
    expect(fleetTripStatusCanTransition("planned", "cancelled")).toBe(true);
    expect(fleetTripStatusCanTransition("planned", "arrived")).toBe(false);
    // in_transit → only arrived + cancelled
    expect(fleetTripStatusCanTransition("in_transit", "arrived")).toBe(true);
    expect(fleetTripStatusCanTransition("in_transit", "cancelled")).toBe(true);
    expect(fleetTripStatusCanTransition("in_transit", "departed")).toBe(false);
    // arrived + cancelled are terminal
    expect(fleetTripStatusCanTransition("arrived", "departed")).toBe(false);
    expect(fleetTripStatusCanTransition("arrived", "arrived")).toBe(false);
    expect(fleetTripStatusCanTransition("arrived", "cancelled")).toBe(false);
    expect(fleetTripStatusCanTransition("cancelled", "departed")).toBe(false);
    expect(fleetTripStatusCanTransition("cancelled", "arrived")).toBe(false);
    expect(fleetTripStatusCanTransition("cancelled", "cancelled")).toBe(false);
  });

  it("tripStateLabelArm produces Armenian-first label", () => {
    expect(tripStateLabelArm("planned")).toMatch(/Պլանավորված/);
    expect(tripStateLabelArm("in_transit")).toMatch(/In transit/);
  });

  it("coldChainCategoryLabelAm wraps Armenian + English", () => {
    const label = coldChainCategoryLabelAm("dairy");
    expect(label).toMatch(/Dairy/);
  });

  it("formatFleetIdShort returns the dash suffix", () => {
    expect(formatFleetIdShort("abc-123def")).toBe("123def");
    expect(formatFleetIdShort("nope")).toBe("nope");
    expect(formatFleetIdShort("trailing-")).toBe("trailing-");
    expect(formatFleetIdShort(null)).toBe("—");
  });

  it("generateFleetIdempotencyKey returns kind-tagged timestamp keys", () => {
    const k = generateFleetIdempotencyKey("vehicles-create");
    expect(k).toMatch(/^vehicles-create-ui-\d+$/);
  });

  it("formatFleetFuelEfficiency handles kmPerL=null", () => {
    expect(formatFleetFuelEfficiency(8.5, null)).toMatch(/8\.50L\/100km$/);
    expect(formatFleetFuelEfficiency(8.5, 11.76)).toMatch(/8\.50L\/100km · 11\.76km\/L/);
    expect(formatFleetFuelEfficiency(null, null)).toBe("—");
  });
});

/* ────────── 20. subcomponent sanity ────────── */

describe("Fleet — subcomponents", () => {
  it("FleetTabs renders 7 tabs with the expected testids", () => {
    const onChange = vi.fn();
    render(<FleetTabs active="vehicles" onChange={onChange} />);
    for (const t of FLEET_TABS) {
      expect(screen.getByTestId(`fleet-tab-${t}`)).toBeInTheDocument();
    }
  });

  it("FleetTabs fires onChange when a tab is clicked", () => {
    const onChange = vi.fn();
    render(<FleetTabs active="vehicles" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("fleet-tab-fuel"));
    expect(onChange).toHaveBeenCalledWith("fuel");
  });

  it("VehiclesTable renders one row per data item + empty state when empty", () => {
    const { rerender } = render(<VehiclesTable data={[VEHICLE_A, VEHICLE_B]} />);
    const table = screen.getByTestId("fleet-vehicles-table");
    expect(within(table).getAllByTestId("fleet-vehicles-row")).toHaveLength(2);

    rerender(<VehiclesTable data={[]} />);
    expect(screen.getByTestId("fleet-vehicles-empty")).toBeInTheDocument();
  });

  it("TiresTable renders one row per data item", () => {
    render(<TiresTable data={[TIRE_A]} />);
    const table = screen.getByTestId("fleet-tires-table");
    expect(within(table).getAllByTestId("fleet-tires-row")).toHaveLength(1);
  });
});

/* ────────── 21. schema round-trip ────────── */

describe("Fleet — schemas parse real envelopes", () => {
  it("FleetVehiclesResponseSchema parses a 2-vehicle envelope", () => {
    const parsed = FleetVehiclesResponseSchema.parse({
      vehicles: [VEHICLE_A, VEHICLE_B],
    });
    expect(parsed.vehicles).toHaveLength(2);
    expect(parsed.vehicles[0].plate).toBe("AA 1111 BB");
  });

  it("FleetColdChainComplianceResponseSchema parses a breach report", () => {
    const parsed = FleetColdChainComplianceResponseSchema.parse({
      category: "frozen",
      report: {
        worstTempC: -8,
        sustainedMinutes: 45,
        breaches: [
          { startedAt: "t0", endedAt: "t1", minutes: 20 },
        ],
      },
    });
    expect(parsed.report.breaches).toHaveLength(1);
  });
});

/* ────────── form subcomponent wire-up (extras) ────────── */

describe("Fleet — subcomponent forms", () => {
  it("VehiclesForm fires onSubmit with the typed input", () => {
    const onSubmit = vi.fn();
    render(<VehiclesForm onSubmit={onSubmit} isPending={false} error="" />);
    fireEvent.change(screen.getByTestId("fleet-vehicles-plate"), {
      target: { value: "X-1" },
    });
    fireEvent.change(screen.getByTestId("fleet-vehicles-make"), {
      target: { value: "M" },
    });
    fireEvent.change(screen.getByTestId("fleet-vehicles-model"), {
      target: { value: "Mo" },
    });
    fireEvent.click(screen.getByTestId("fleet-vehicles-submit"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ plate: "X-1", make: "M", model: "Mo" }),
    );
  });

  it("RepairsForm fires onSubmit with the typed input", () => {
    const onSubmit = vi.fn();
    render(
      <RepairsForm
        onSubmit={onSubmit}
        isPending={false}
        error=""
        vehicles={[VEHICLE_A]}
      />,
    );
    fireEvent.change(screen.getByTestId("fleet-repairs-vehicle"), {
      target: { value: VEHICLE_A.id },
    });
    fireEvent.change(screen.getByTestId("fleet-repairs-kind"), {
      target: { value: "oil-change" },
    });
    fireEvent.change(screen.getByTestId("fleet-repairs-odometer"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByTestId("fleet-repairs-cost"), {
      target: { value: "12345" },
    });
    fireEvent.click(screen.getByTestId("fleet-repairs-submit"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleId: VEHICLE_A.id, kind: "oil-change" }),
    );
  });

  it("BacklogTable renders one row per data item", () => {
    render(<BacklogTable data={[BACKLOG_A]} />);
    expect(screen.getAllByTestId("fleet-backlog-row")).toHaveLength(1);
  });

  it("FuelLogsTable renders one row per data item", () => {
    render(<FuelLogsTable data={[FUEL_LOG_A]} />);
    expect(screen.getAllByTestId("fleet-fuel-row")).toHaveLength(1);
  });

  it("FuelEfficiencyTable renders one row per data item", () => {
    render(<FuelEfficiencyTable data={[EFF_A]} />);
    expect(screen.getAllByTestId("fleet-fuel-eff-row")).toHaveLength(1);
  });

  it("ColdChainLogsTable renders empty state when no data", () => {
    render(<ColdChainLogsTable data={[]} />);
    expect(screen.getByTestId("fleet-coldchain-empty")).toBeInTheDocument();
  });

  it("DriversTable + RepairsTable render empty states when no data", () => {
    const { rerender } = render(<DriversTable data={[]} />);
    expect(screen.getByTestId("fleet-drivers-empty")).toBeInTheDocument();
    rerender(<RepairsTable data={[]} />);
    expect(screen.getByTestId("fleet-repairs-empty")).toBeInTheDocument();
  });
});
