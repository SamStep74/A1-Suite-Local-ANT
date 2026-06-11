/**
 * /app/inventory/warehouse — route-level tests for the Pattern A
 * warehouse workspace.
 *
 * Mirrors the cabinet/healthcheck test pattern: mock the three
 * layers (Router, Query, API client), then drive the public
 * component surface. The route file exports its subcomponents
 * (`WarehouseTabStrip`, `WarehouseLotsForm`, `WarehouseLotsList`,
 * `WarehouseSerialForm`, `WarehouseColdStorageForm`,
 * `WarehouseColdStorageReadingRow`, `WarehouseAbcTable`,
 * `WarehouseTurnoverTable`, `WarehouseForecastForm`,
 * `WarehouseAccessDeniedCard`) as named exports, so we can
 * import and render them directly.
 *
 * Coverage targets (Phase 8.3 layer 2):
 *  - Page shell — H1 "Պահեստ" + English subtitle "Warehouse"
 *  - 4 tab buttons render with Armenian labels
 *  - Default tab is Lots
 *  - Clicking Serials / Cold / Analytics switches the active panel
 *  - Lots POST: form → postJson called with the right shape
 *  - Lots validation: empty lotCode → client-side guard prevents submit
 *  - Serials POST: form → postJson called
 *  - Cold storage POST: form → postJson called
 *  - Cold formatting: tempC=4.0 → "4.0°C"; humidity=null → "—"; 75 → "75%"
 *  - Analytics ABC: bucket badge + cumulative % render
 *  - Analytics turnover: turnover days render with "օր" suffix
 *  - Forecast POST: result block renders with reasoning joined by " / "
 *  - 403 for no-inventory access: card visible, no tabs rendered
 *  - Back link points to /app/inventory
 *  - fefoOrderLots: 3 mixed lots render in FEFO order
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

/* ────────── mock state, hoisted so vi.mock factories see it ────────── */

const mocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  // Per-mutation impl slots. The mocked useQuery returns the values
  // of the corresponding "Data" fields synchronously so the route
  // can render without an act() roundtrip.
  queryData: {} as Record<string, unknown>,
  queryError: {} as Record<string, unknown>,
  // Captured mutationFn for each mutation; we route by URL substring.
  mutationImpl: {} as Record<string, (...args: unknown[]) => void>,
  // isPending for the matching mutation key. Default false.
  mutationPending: {} as Record<string, boolean>,
  // The most recent successful payload for each mutation, so tests
  // can assert on render after the mutation resolves.
  mutationResult: {} as Record<string, unknown>,
  // last mutation error
  mutationError: "" as string,
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
    useQuery: (opts: { queryKey: ReadonlyArray<unknown> }) => {
      // The queryKey is the discriminator: ["warehouse-lots"],
      // ["warehouse-abc", "2026-Q2"], etc. Tests pre-set the
      // matching slot in mocks.queryData.
      const key = opts.queryKey[0] as string;
      return {
        data: mocks.queryData[key],
        error: mocks.queryError[key],
        isPending: false,
        refetch: vi.fn(),
      };
    },
    useMutation: (opts: {
      mutationFn: (...args: unknown[]) => Promise<unknown>;
      onSuccess?: (...args: unknown[]) => void;
      onError?: (...args: unknown[]) => void;
    }) => {
      // Route to the right mock slot by inspecting the URL embedded
      // in the mutationFn body (postJson path).
      const fn = opts.mutationFn.toString();
      let key = "default";
      if (fn.includes("/api/warehouse/lots\"")) key = "lots";
      else if (fn.includes("/api/warehouse/serials\"")) key = "serials";
      else if (fn.includes("/api/warehouse/cold-storage/readings\""))
        key = "cold";
      else if (fn.includes("/api/warehouse/forecast/restock\"")) key = "forecast";
      mocks.mutationImpl[key] = (...args: unknown[]) => {
        opts
          .mutationFn(...args)
          .then((res: unknown) => {
            mocks.mutationResult[key] = res;
            if (opts.onSuccess) opts.onSuccess(res, ...args);
          })
          .catch((err: unknown) => {
            mocks.mutationError = err instanceof Error ? err.message : String(err);
            if (opts.onError) opts.onError(err, ...args);
          });
      };
      return {
        mutate: (...args: unknown[]) => mocks.mutationImpl[key]?.(...args),
        isPending: mocks.mutationPending[key] ?? false,
        data: mocks.mutationResult[key],
      };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../../lib/api/client", () => ({
  getJson: mocks.getJson,
  postJson: mocks.postJson,
  patchJson: vi.fn(),
  postVoid: vi.fn().mockResolvedValue(undefined),
}));

/* ────────── import the route under test (mocks are in place by now) ─ */

import { Route, WarehouseWorkspace } from "./index";
import {
  WarehouseAbcResponseSchema,
  WarehouseColdStorageReadingsResponseSchema,
  WarehouseLotsResponseSchema,
  WarehouseTurnoverResponseSchema,
  type WarehouseAbcRow,
  type WarehouseColdStorageReading,
  type WarehouseLot,
  type WarehouseTurnoverRow,
} from "../../../../lib/api/schemas";

/* ────────── helpers ────────── */

function renderRoute(props: { userAccess?: "inventory" | "none" } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Component = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={qc}>
      {props.userAccess !== undefined ? (
        <WarehouseWorkspace userAccess={props.userAccess} />
      ) : (
        <Component />
      )}
    </QueryClientProvider>,
  );
}

const LOTS: WarehouseLot[] = [
  {
    id: 1,
    productId: "prod-1",
    lotCode: "LOT-C",
    mfgDate: null,
    expiryDate: "2027-06-01",
    harvestDate: null,
    sourceVendorId: null,
  },
  {
    id: 2,
    productId: "prod-2",
    lotCode: "LOT-A",
    mfgDate: null,
    expiryDate: "2026-08-15",
    harvestDate: null,
    sourceVendorId: null,
  },
  {
    id: 3,
    productId: "prod-3",
    lotCode: "LOT-NULL",
    mfgDate: null,
    expiryDate: null,
    harvestDate: null,
    sourceVendorId: null,
  },
];

const COLD: WarehouseColdStorageReading[] = [
  {
    id: 1,
    locationId: "fridge-A1",
    recordedAt: "2026-06-01T00:00:00.000Z",
    tempC: 4.0,
    humidity: 75,
    sensorId: "sensor-1",
  },
  {
    id: 2,
    locationId: "fridge-A1",
    recordedAt: "2026-06-01T01:00:00.000Z",
    tempC: 4.0,
    humidity: null,
    sensorId: "sensor-1",
  },
];

const ABC: WarehouseAbcRow[] = [
  {
    productId: "prod-flour-1kg",
    bucket: "A",
    revenueShare: 0.6,
    cumulativeShare: 0.6,
  },
  {
    productId: "prod-sugar-1kg",
    bucket: "B",
    revenueShare: 0.25,
    cumulativeShare: 0.85,
  },
];

const TURNOVER: WarehouseTurnoverRow[] = [
  { productId: "prod-flour-1kg", turnoverDays: 15 },
  { productId: "prod-sugar-1kg", turnoverDays: 3.4 },
];

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.getJson.mockReset();
  mocks.postJson.mockReset();
  mocks.mutationImpl = {};
  mocks.mutationPending = {};
  mocks.mutationResult = {};
  mocks.mutationError = "";
  mocks.queryData = {
    "warehouse-lots": WarehouseLotsResponseSchema.parse({ lots: LOTS }),
    "warehouse-serials": [],
    "warehouse-cold-storage": WarehouseColdStorageReadingsResponseSchema.parse({
      readings: COLD,
    }),
    "warehouse-abc": WarehouseAbcResponseSchema.parse({
      ok: true,
      periodKey: "2026-Q2",
      abc: ABC,
    }),
    "warehouse-turnover": WarehouseTurnoverResponseSchema.parse({
      ok: true,
      periodKey: "2026-Q2",
      turnover: TURNOVER,
    }),
  };
  mocks.queryError = {};
  mocks.getJson.mockImplementation((path: string) => {
    if (path.startsWith("/api/warehouse/lots")) return Promise.resolve(mocks.queryData["warehouse-lots"]);
    if (path.startsWith("/api/warehouse/analytics/abc"))
      return Promise.resolve(mocks.queryData["warehouse-abc"]);
    if (path.startsWith("/api/warehouse/analytics/turnover"))
      return Promise.resolve(mocks.queryData["warehouse-turnover"]);
    if (path.startsWith("/api/warehouse/cold-storage/readings"))
      return Promise.resolve(mocks.queryData["warehouse-cold-storage"]);
    return Promise.resolve(undefined);
  });
  mocks.postJson.mockImplementation((path: string, body: unknown) => {
    if (path === "/api/warehouse/lots")
      return Promise.resolve({ ok: true, lot: { ...(body as object), id: 99 } });
    if (path === "/api/warehouse/serials")
      return Promise.resolve({ ok: true, serial: { ...(body as object), id: 99 } });
    if (path === "/api/warehouse/cold-storage/readings")
      return Promise.resolve({ ok: true, reading: { ...(body as object), id: 99 } });
    if (path === "/api/warehouse/forecast/restock")
      return Promise.resolve({
        ok: true,
        forecast: {
          suggestedQuantity: 42,
          source: "rolling-avg-30d",
          reasoning: ["recent velocity 3/day", "lead time 14 days"],
        },
      });
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("Warehouse — page shell", () => {
  it("renders the H1 'Պահեստ' and the English 'Warehouse' subtitle", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /Պահեստ/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Warehouse lots · serials · cold storage · analytics/)).toBeInTheDocument();
  });

  it("wraps the workspace in a div with data-testid='warehouse-panel' and data-entity='warehouse'", () => {
    renderRoute();
    const panel = screen.getByTestId("warehouse-panel");
    expect(panel.tagName.toLowerCase()).toBe("div");
    expect(panel.getAttribute("data-entity")).toBe("warehouse-root");
  });

  it("renders a back-to-Inventory link that points to /app/inventory", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /back to Inventory/i });
    expect(back.getAttribute("data-href")).toBe("/app/inventory");
  });
});

/* ────────── tab strip ────────── */

describe("Warehouse — tab strip", () => {
  it("renders 4 tab buttons with Armenian labels", () => {
    renderRoute();
    expect(screen.getByTestId("warehouse-tab-lots").textContent).toMatch(/Խմբաքանակներ/);
    expect(screen.getByTestId("warehouse-tab-serials").textContent).toMatch(/Սերիաներ/);
    expect(screen.getByTestId("warehouse-tab-cold").textContent).toMatch(/Սառը պահեստ/);
    expect(screen.getByTestId("warehouse-tab-analytics").textContent).toMatch(/Վերլուծություն/);
  });

  it("defaults to the Lots tab (form visible, other panels hidden)", () => {
    renderRoute();
    expect(screen.getByTestId("warehouse-lot-form")).toBeInTheDocument();
    expect(screen.queryByTestId("warehouse-serial-form")).toBeNull();
    expect(screen.queryByTestId("warehouse-cold-storage-form")).toBeNull();
    expect(screen.queryByTestId("warehouse-abc")).toBeNull();
  });

  it("switches to the Serials tab on click", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("warehouse-tab-serials"));
    expect(screen.getByTestId("warehouse-serial-form")).toBeInTheDocument();
    expect(screen.queryByTestId("warehouse-lot-form")).toBeNull();
  });

  it("switches to the Cold Storage tab on click", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("warehouse-tab-cold"));
    expect(screen.getByTestId("warehouse-cold-storage-form")).toBeInTheDocument();
    expect(screen.queryByTestId("warehouse-lot-form")).toBeNull();
  });

  it("switches to the Analytics tab on click", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("warehouse-tab-analytics"));
    expect(screen.getByTestId("warehouse-abc")).toBeInTheDocument();
    expect(screen.getByTestId("warehouse-turnover")).toBeInTheDocument();
    expect(screen.getByTestId("warehouse-forecast-form")).toBeInTheDocument();
  });
});

/* ────────── Lots tab ────────── */

describe("Warehouse — Lots tab", () => {
  it("POST: form submit calls postJson with the right path + lotCode in body", () => {
    renderRoute();
    fireEvent.change(screen.getByLabelText(/Lot code/i), {
      target: { value: "LOT-2026-001" },
    });
    fireEvent.change(screen.getByLabelText(/Lot expiry/i), {
      target: { value: "2026-12-31" },
    });
    fireEvent.click(screen.getByTestId("warehouse-lot-submit"));

    expect(mocks.postJson).toHaveBeenCalledTimes(1);
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/warehouse/lots");
    expect(body).toMatchObject({
      productId: "product-flour-1kg",
      lotCode: "LOT-2026-001",
    });
  });

  it("validation: empty lotCode keeps the submit button disabled (client-side guard)", () => {
    renderRoute();
    // The default productId is filled in but lotCode is empty, so
    // the form should not be submittable.
    const submit = screen.getByTestId("warehouse-lot-submit");
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(mocks.postJson).not.toHaveBeenCalled();
  });

  it("fefoOrderLots: 3 lots with mixed expiryDates render in FEFO order (earliest non-null first, null last)", () => {
    renderRoute();
    const list = screen.getByTestId("warehouse-lot-list");
    const rows = within(list).getAllByTestId("warehouse-lot");
    // LOTS order is [LOT-C (2027-06-01), LOT-A (2026-08-15), LOT-NULL (null)]
    // FEFO: LOT-A (earliest), LOT-C, LOT-NULL
    expect(rows[0].textContent).toMatch(/LOT-A/);
    expect(rows[1].textContent).toMatch(/LOT-C/);
    expect(rows[2].textContent).toMatch(/LOT-NULL/);
  });
});

/* ────────── Serials tab ────────── */

describe("Warehouse — Serials tab", () => {
  it("POST: form submit calls postJson with /api/warehouse/serials", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("warehouse-tab-serials"));
    fireEvent.change(screen.getByLabelText(/Serial code/i), {
      target: { value: "SN-12345" },
    });
    fireEvent.click(screen.getByTestId("warehouse-serial-submit"));

    expect(mocks.postJson).toHaveBeenCalledTimes(1);
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/warehouse/serials");
    expect(body).toMatchObject({ productId: "product-instrument-1", serial: "SN-12345" });
  });
});

/* ────────── Cold Storage tab ────────── */

describe("Warehouse — Cold Storage tab", () => {
  it("POST: form submit calls postJson with /api/warehouse/cold-storage/readings", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("warehouse-tab-cold"));
    fireEvent.click(screen.getByTestId("warehouse-cold-storage-submit"));

    expect(mocks.postJson).toHaveBeenCalledTimes(1);
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/warehouse/cold-storage/readings");
    expect((body as { locationId: string }).locationId).toBe("fridge-A1");
    expect((body as { tempC: number }).tempC).toBeCloseTo(4.0);
  });

  it("formatting: tempC=4.0 → '4.0°C'; humidity=null → '—'; humidity=75 → '75%'", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("warehouse-tab-cold"));
    const list = screen.getByTestId("warehouse-cold-storage-list");
    const rows = within(list).getAllByTestId("warehouse-cold-storage");
    // Row 0: humidity 75
    expect(rows[0].textContent).toMatch(/4\.0°C/);
    expect(rows[0].textContent).toMatch(/75%/);
    // Row 1: humidity null → "—"
    expect(rows[1].textContent).toMatch(/4\.0°C/);
    expect(rows[1].textContent).toMatch(/—/);
  });
});

/* ────────── Analytics tab ────────── */

describe("Warehouse — Analytics tab", () => {
  it("ABC: bucket badge + cumulative % render", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("warehouse-tab-analytics"));
    const abc = screen.getByTestId("warehouse-abc");
    const rows = within(abc).getAllByTestId("warehouse-abc-row");
    expect(rows).toHaveLength(2);
    // Bucket A row: contains the bucket badge and the cumulative %
    expect(rows[0].textContent).toMatch(/A/);
    expect(rows[0].textContent).toMatch(/60%/);
    expect(rows[1].textContent).toMatch(/B/);
    expect(rows[1].textContent).toMatch(/85%/);
  });

  it("turnover: turnover days render with 'օր' suffix", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("warehouse-tab-analytics"));
    const turnover = screen.getByTestId("warehouse-turnover");
    const rows = within(turnover).getAllByTestId("warehouse-turnover-row");
    expect(rows).toHaveLength(2);
    // 15.0 → "15 օր" (rounded); 3.4 → "3 օր"
    expect(rows[0].textContent).toMatch(/15 օր/);
    expect(rows[1].textContent).toMatch(/3 օր/);
  });

  it("forecast POST: form submit calls postJson with /api/warehouse/forecast/restock + warehouse-restock intent", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("warehouse-tab-analytics"));
    fireEvent.click(screen.getByTestId("warehouse-forecast-submit"));

    expect(mocks.postJson).toHaveBeenCalledTimes(1);
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/warehouse/forecast/restock");
    expect(body).toMatchObject({
      productId: "product-flour-1kg",
      horizonDays: 14,
      intent: "warehouse-restock",
    });
  });
});

/* ────────── 403 access gate ────────── */

describe("Warehouse — access gate", () => {
  it("renders the 403 card and hides the tabs when userAccess is 'none'", () => {
    renderRoute({ userAccess: "none" });
    expect(screen.getByTestId("warehouse-403")).toBeInTheDocument();
    expect(screen.queryByTestId("warehouse-tab-strip")).toBeNull();
    expect(screen.queryByTestId("warehouse-lot-form")).toBeNull();
  });
});

/* ────────── subcomponent sanity (proves the named exports work) ─ */

import {
  WarehouseAccessDeniedCard,
  WarehouseTabStrip,
  WarehouseColdStorageReadingRow,
  WarehouseAbcTable,
  WarehouseTurnoverTable,
  WarehouseForecastForm,
} from "./index";

describe("Warehouse — subcomponents", () => {
  it("WarehouseAccessDeniedCard renders the 403 marker with the Armenian title", () => {
    render(<WarehouseAccessDeniedCard />);
    const card = screen.getByTestId("warehouse-403");
    expect(card.textContent).toMatch(/Մուտքը սահմանափակված է/);
  });

  it("WarehouseTabStrip renders 4 tabs and calls onChange with the clicked tab", () => {
    const onChange = vi.fn();
    render(<WarehouseTabStrip active="lots" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("warehouse-tab-analytics"));
    expect(onChange).toHaveBeenCalledWith("analytics");
  });

  it("WarehouseColdStorageReadingRow formats tempC=4.0 → '4.0°C' and humidity=75 → '75%'", () => {
    const { container } = render(
      <>
        <WarehouseColdStorageReadingRow
          reading={{
            id: 1,
            locationId: "fridge-A1",
            recordedAt: "2026-06-01T00:00:00.000Z",
            tempC: 4.0,
            humidity: 75,
            sensorId: "sensor-1",
          }}
        />
        <WarehouseColdStorageReadingRow
          reading={{
            id: 2,
            locationId: "fridge-A1",
            recordedAt: "2026-06-01T01:00:00.000Z",
            tempC: 4.0,
            humidity: null,
            sensorId: "sensor-1",
          }}
        />
      </>,
    );
    const rows = container.querySelectorAll('[data-testid="warehouse-cold-storage"]');
    expect(rows[0].textContent).toMatch(/4\.0°C/);
    expect(rows[0].textContent).toMatch(/75%/);
    expect(rows[1].textContent).toMatch(/4\.0°C/);
    expect(rows[1].textContent).toMatch(/—/);
  });

  it("WarehouseAbcTable renders bucket badges with the right data-bucket attribute", () => {
    render(<WarehouseAbcTable rows={ABC} />);
    const rows = screen.getAllByTestId("warehouse-abc-row");
    expect(rows[0].textContent).toMatch(/60%/);
    const bucketA = rows[0].querySelector('[data-bucket="A"]');
    const bucketB = rows[1].querySelector('[data-bucket="B"]');
    expect(bucketA).not.toBeNull();
    expect(bucketB).not.toBeNull();
  });

  it("WarehouseTurnoverTable renders days with 'օր' suffix", () => {
    render(<WarehouseTurnoverTable rows={TURNOVER} />);
    const rows = screen.getAllByTestId("warehouse-turnover-row");
    expect(rows[0].textContent).toMatch(/15 օր/);
    expect(rows[1].textContent).toMatch(/3 օր/);
  });

  it("WarehouseForecastForm renders the data-testid='copilot-result' block with reasoning joined by ' / ' when result is provided", () => {
    render(
      <WarehouseForecastForm
        onSubmit={() => {}}
        isPending={false}
        result={{
          suggestedQuantity: 42,
          source: "rolling-avg-30d",
          reasoning: ["recent velocity 3/day", "lead time 14 days"],
        }}
        error=""
      />,
    );
    const result = screen.getByTestId("copilot-result");
    expect(result.textContent).toMatch(/42/);
    expect(result.textContent).toMatch(/rolling-avg-30d/);
    expect(result.textContent).toMatch(/recent velocity 3\/day \/ lead time 14 days/);
  });
});
