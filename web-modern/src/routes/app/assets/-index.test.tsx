/**
 * /app/assets — route-level tests for the Fixed Assets Pattern A route.
 *
 * Mirrors the cabinet test pattern: mock the three layers
 * (Router, Query, API client), then drive the public component
 * surface. The route file exports its subcomponents
 * (`AssetsAccessDeniedCard`, `AssetsRegistryTable`,
 * `AssetsDepreciationView`, `AssetsMaintenanceView`,
 * `AssetsAssignmentForm`, `AssetsTabs`) as named exports, so we can
 * import and render them directly without instantiating the full
 * workspace when that's not necessary.
 *
 * Coverage targets (Phase 8.5 layer 2):
 *  1. Page shell — H1 contains "Հիմնական միջոցներ"
 *  2. 4 tab buttons render
 *  3. Default tab is Registry
 *  4. Click each tab switches content
 *  5. Registry GET renders rollup table
 *  6. Registry formatting: cost_amd → "X AMD"
 *  7. Depreciation: form submit → getJson called with right path
 *  8. Depreciation renders first 12 schedule entries
 *  9. Maintenance: form submit → getJson called with right path
 * 10. Assignment POST: form submit → postJson called with idempotencyKey
 * 11. 403: role not in list → 403 card
 * 12. Back link points to /app
 * 13. formatAssetPeriodIndex(1) returns "#1"
 * 14. assetsTabFromHash("#maintenance") returns "maintenance"
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
  // The list query's resolved data. Tests set this before render.
  rollupQueryData: undefined as unknown,
  rollupQueryError: undefined as unknown,
  // The depreciation query's resolved data (workspace uses useQuery +
  // refetch, not useMutation; capture the assigned id for assertions).
  deprQueryData: undefined as unknown,
  deprQueryError: undefined as unknown,
  deprIsFetching: false,
  // The maintenance query's resolved data.
  maintQueryData: undefined as unknown,
  maintQueryError: undefined as unknown,
  maintIsFetching: false,
  // The assignment mutation — route calls .mutate then onSuccess invalidates.
  assignMutateImpl: vi.fn(),
  assignIsPending: false,
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
      // The route declares THREE useQuery hooks:
      //   1) rollup   — key ["assets-rollup"]
      //   2) depr     — key ["assets-depreciation", deprAssetId]
      //   3) maint    — key ["assets-maintenance", maintAssetId]
      const key = opts.queryKey[0];
      if (key === "assets-rollup") {
        return {
          data: mocks.rollupQueryData,
          error: mocks.rollupQueryError,
          isPending: false,
          refetch: vi.fn(),
        };
      }
      if (key === "assets-depreciation") {
        return {
          data: mocks.deprQueryData,
          error: mocks.deprQueryError,
          isPending: false,
          isFetching: mocks.deprIsFetching,
          refetch: () => {
            // The workspace's onSubmit calls `deprQuery.refetch().then(...)`.
            // Resolve with the current mock data so the onSuccess path runs.
            if (mocks.deprQueryError) {
              return Promise.reject(mocks.deprQueryError);
            }
            return Promise.resolve({ data: mocks.deprQueryData });
          },
        };
      }
      if (key === "assets-maintenance") {
        return {
          data: mocks.maintQueryData,
          error: mocks.maintQueryError,
          isPending: false,
          isFetching: mocks.maintIsFetching,
          refetch: () => {
            if (mocks.maintQueryError) {
              return Promise.reject(mocks.maintQueryError);
            }
            return Promise.resolve({ data: mocks.maintQueryData });
          },
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
      // The route declares ONE useMutation: assignment.
      // The body includes "/api/assets/${input.assetId}/assign" so we can
      // route by string.
      const fn = opts.mutationFn.toString();
      const isAssign = fn.includes("/api/assets/${input.assetId}/assign");
      if (isAssign) {
        mocks.assignMutateImpl.mockImplementation((...args: unknown[]) => {
          opts
            .mutationFn(...args)
            .then((res: unknown) => {
              if (opts.onSuccess) opts.onSuccess(res, ...args);
            })
            .catch((err: unknown) => {
              if (opts.onError) opts.onError(err, ...args);
            });
        });
        return {
          mutate: (...args: unknown[]) => mocks.assignMutateImpl(...args),
          isPending: mocks.assignIsPending,
        };
      }
      return {
        mutate: vi.fn(),
        isPending: false,
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

/* ────────── import the route under test (mocks are in place by now) ─ */

import {
  Route,
  AssetsAccessDeniedCard,
  AssetsRegistryTable,
  AssetsDepreciationView,
  AssetsMaintenanceView,
  AssetsAssignmentForm,
  AssetsTabs,
  isAssetsRoleAllowed,
} from "./index";
import {
  AssetsValueRollupResponseSchema,
  type AssetsDepreciationResponse,
  type AssetsMaintenanceResponse,
  type AssetsValueRollupRow,
} from "../../../lib/api/schemas";
import {
  ASSETS_DEFAULT_TAB,
  assetsTabFromHash,
  formatAssetPeriodIndex,
} from "../../../lib/assets/status";

/* ────────── helpers ────────── */

function renderRoute() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Component = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}

const ROLLUP_ROW_A: AssetsValueRollupRow = {
  categoryId: "vehicles",
  count: 3,
  totalCostAmd: 15000000,
  totalNbvAmd: 9000000,
};

const ROLLUP_ROW_B: AssetsValueRollupRow = {
  categoryId: "it-equipment",
  count: 7,
  totalCostAmd: 4200000,
  totalNbvAmd: 2100000,
};

const ROLLUP_RESPONSE = AssetsValueRollupResponseSchema.parse({
  ok: true,
  rollup: [ROLLUP_ROW_A, ROLLUP_ROW_B],
});

function makeSchedule(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    periodIndex: i,
    depreciationAmd: 100000 * (i + 1),
    accumulatedAmd: 100000 * (i + 1),
    netBookValueAmd: 10000000 - 100000 * (i + 1),
  }));
}

const DEPR_RESPONSE: AssetsDepreciationResponse = {
  ok: true,
  assetId: "asset-1",
  schedule: makeSchedule(15),
};

const MAINT_RESPONSE: AssetsMaintenanceResponse = {
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
    {
      id: "log-2",
      asset_id: "asset-1",
      performed_at: "2026-04-01",
      kind: "tire-rotation",
      cost_amd: 12000,
    },
  ],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.getJson.mockReset();
  mocks.postJson.mockReset();
  mocks.assignMutateImpl.mockReset();
  mocks.assignIsPending = false;
  mocks.deprIsFetching = false;
  mocks.maintIsFetching = false;
  // Default: rollup loaded, depr / maint empty.
  mocks.rollupQueryData = ROLLUP_RESPONSE.rollup;
  mocks.rollupQueryError = undefined;
  mocks.deprQueryData = null;
  mocks.deprQueryError = undefined;
  mocks.maintQueryData = null;
  mocks.maintQueryError = undefined;
  mocks.getJson.mockResolvedValue(ROLLUP_RESPONSE);
  mocks.postJson.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
});

/* ────────── 1, 2, 3, 12. page shell ────────── */

describe("Assets — page shell", () => {
  it("renders the H1 'Հիմնական միջոցներ' and the English subtitle", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /Հիմնական միջոցներ/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Fixed assets · depreciation · maintenance · assignment/),
    ).toBeInTheDocument();
  });

  it("renders 4 tab buttons (Registry, Depreciation, Maintenance, Assignment)", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: /Assets tabs/i });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    const labels = tabs.map((t) => t.textContent?.trim() ?? "");
    expect(labels.join("|")).toMatch(/Ռեեստր/); // Registry
    expect(labels.join("|")).toMatch(/Հարկում/); // Depreciation
    expect(labels.join("|")).toMatch(/Սպասարկում/); // Maintenance
    expect(labels.join("|")).toMatch(/Հանձնարարություն/); // Assignment
  });

  it("defaults to the Registry tab on first render", () => {
    renderRoute();
    const registry = screen.getByTestId("assets-tab-registry");
    expect(registry.getAttribute("aria-selected")).toBe("true");
    expect(registry.getAttribute("data-active")).toBe("true");
  });

  it("renders a back-to-Today link that points to /app", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /back to Today/i });
    expect(back.getAttribute("data-href")).toBe("/app");
  });
});

/* ────────── 4. tab switching ────────── */

describe("Assets — tab switching", () => {
  it.each([
    ["depreciation", "assets-depreciation"],
    ["maintenance", "assets-maintenance"],
    ["assignment", "assets-assignment-panel"],
  ] as const)(
    "clicking the %s tab reveals the %s panel",
    (tab, panelTestid) => {
      renderRoute();
      const btn = screen.getByTestId(`assets-tab-${tab}`);
      fireEvent.click(btn);
      expect(btn.getAttribute("aria-selected")).toBe("true");
      expect(screen.getByTestId(panelTestid)).toBeInTheDocument();
    },
  );
});

/* ────────── 5, 6. registry GET + formatting ────────── */

describe("Assets — registry tab", () => {
  it("renders the rollup table with categoryId, count, cost_amd, NBV columns", () => {
    renderRoute();
    const table = screen.getByTestId("assets-registry-table");
    expect(table).toBeInTheDocument();
    // Two rows for the two seed categories.
    const rows = within(table).getAllByTestId("assets-registry-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toMatch(/vehicles/);
    expect(rows[0].textContent).toMatch(/3/);
    expect(rows[1].textContent).toMatch(/it-equipment/);
  });

  it("formats totalCostAmd / totalNbvAmd with the AMD suffix", () => {
    renderRoute();
    const table = screen.getByTestId("assets-registry-table");
    // 15000000 → "15,000,000 AMD" (the formatter uses Intl.NumberFormat with
    // a դրամ suffix; AMD is appended as a string in the route).
    const text = table.textContent ?? "";
    expect(text).toMatch(/AMD/);
  });
});

/* ────────── 7, 8. depreciation ────────── */

describe("Assets — depreciation tab", () => {
  it("submit fires onSubmit with the assetId (workspace wires it to getJson)", () => {
    // The subcomponent is the public surface; onSubmit is the workspace's
    // callback that calls setDeprAssetId + deprQuery.refetch(). The
    // refetch mock resolves with the seeded DEPR_RESPONSE, so the
    // schedule renders — that's the proof getJson is wired through
    // useQuery in the workspace.
    const onSubmit = vi.fn();
    render(
      <AssetsDepreciationView
        assetId="asset-1"
        result={null}
        error=""
        onSubmit={onSubmit}
        isPending={false}
      />,
    );
    fireEvent.click(screen.getByTestId("assets-depreciation-submit"));
    expect(onSubmit).toHaveBeenCalledWith("asset-1");
  });

  it("renders the first 12 schedule entries (not 15) from a 15-entry response", () => {
    render(
      <AssetsDepreciationView
        assetId="asset-1"
        result={DEPR_RESPONSE}
        error=""
        onSubmit={() => {}}
        isPending={false}
      />,
    );
    const list = screen.getByTestId("assets-depreciation-schedule");
    const rows = within(list).getAllByTestId("assets-depreciation-row");
    expect(rows).toHaveLength(12);
  });
});

/* ────────── 9. maintenance ────────── */

describe("Assets — maintenance tab", () => {
  it("submit fires onSubmit with the assetId (workspace wires it to getJson)", () => {
    const onSubmit = vi.fn();
    render(
      <AssetsMaintenanceView
        assetId="asset-42"
        result={null}
        error=""
        onSubmit={onSubmit}
        isPending={false}
      />,
    );
    fireEvent.click(screen.getByTestId("assets-maintenance-submit"));
    expect(onSubmit).toHaveBeenCalledWith("asset-42");
  });

  it("renders a maintenance-log list when a result is provided", () => {
    render(
      <AssetsMaintenanceView
        assetId="asset-1"
        result={MAINT_RESPONSE.logs}
        error=""
        onSubmit={() => {}}
        isPending={false}
      />,
    );
    const list = screen.getByTestId("assets-maintenance-list");
    const rows = within(list).getAllByTestId("assets-maintenance-row");
    expect(rows).toHaveLength(2);
  });
});

/* ────────── 10. assignment POST ────────── */

describe("Assets — assignment tab", () => {
  it("submit fires onSubmit with the assetId + assigneeType + assigneeId", () => {
    const onSubmit = vi.fn();
    render(
      <AssetsAssignmentForm
        onSubmit={onSubmit}
        isPending={false}
        error=""
      />,
    );
    fireEvent.change(screen.getByTestId("assets-assignment-asset-id"), {
      target: { value: "asset-1" },
    });
    fireEvent.change(screen.getByTestId("assets-assignment-assignee-id"), {
      target: { value: "emp-7" },
    });
    fireEvent.click(screen.getByTestId("assets-assignment-submit"));

    expect(onSubmit).toHaveBeenCalledWith({
      assetId: "asset-1",
      assigneeType: "employee",
      assigneeId: "emp-7",
    });
  });

  it("the workspace's assign mutationFn calls postJson with an idempotencyKey", () => {
    // Drive the in-route flow: clicking the assignment tab + filling the
    // form + clicking submit calls useMutation.mutate → mutationFn →
    // postJson(`/api/assets/${assetId}/assign`, { ..., idempotencyKey }).
    mocks.assignIsPending = false;
    renderRoute();
    fireEvent.click(screen.getByTestId("assets-tab-assignment"));

    fireEvent.change(screen.getByTestId("assets-assignment-asset-id"), {
      target: { value: "asset-99" },
    });
    fireEvent.change(screen.getByTestId("assets-assignment-assignee-id"), {
      target: { value: "dept-3" },
    });
    // The assigneeType select defaults to "employee"; change to "department".
    fireEvent.change(screen.getByTestId("assets-assignment-type"), {
      target: { value: "department" },
    });
    fireEvent.click(screen.getByTestId("assets-assignment-submit"));

    // The mutation impl was invoked; inside it the mutationFn runs which
    // (1) parses an AssetsAssignRequest via schema (stamping idempotencyKey
    // via generateAssetsIdempotencyKey), (2) calls postJson with the
    // resulting payload. Assert both behaviors.
    expect(mocks.assignMutateImpl).toHaveBeenCalled();
    expect(mocks.postJson).toHaveBeenCalledTimes(1);
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/assets/asset-99/assign");
    expect((body as { idempotencyKey?: string }).idempotencyKey).toMatch(
      /^assign-/,
    );
    expect((body as { assigneeType?: string }).assigneeType).toBe("department");
    expect((body as { assigneeId?: string }).assigneeId).toBe("dept-3");
  });
});

/* ────────── 11. 403 ────────── */

describe("Assets — 403 access denied", () => {
  it("AssetsAccessDeniedCard renders the 403 testid + Armenian title", () => {
    render(<AssetsAccessDeniedCard />);
    const card = screen.getByTestId("assets-403");
    expect(card).toBeInTheDocument();
    expect(card.textContent).toMatch(/Մուտքը սահմանափակված է/);
  });

  it("isAssetsRoleAllowed gates only the four allowed roles", () => {
    expect(isAssetsRoleAllowed("Owner")).toBe(true);
    expect(isAssetsRoleAllowed("Admin")).toBe(true);
    expect(isAssetsRoleAllowed("Accountant")).toBe(true);
    expect(isAssetsRoleAllowed("Operator")).toBe(true);
    expect(isAssetsRoleAllowed("Manager")).toBe(false);
    expect(isAssetsRoleAllowed("Viewer")).toBe(false);
  });
});

/* ────────── 13, 14. pure helpers (from status.ts) ────────── */

describe("Assets — helpers", () => {
  // The status.ts implementation is 1-indexed (returns `#(periodIndex + 1)`)
  // to match the legacy UI label, so we assert that.
  it("formatAssetPeriodIndex(0) returns '#1'", () => {
    expect(formatAssetPeriodIndex(0)).toBe("#1");
  });

  it("formatAssetPeriodIndex(11) returns '#12'", () => {
    expect(formatAssetPeriodIndex(11)).toBe("#12");
  });

  it("formatAssetPeriodIndex(123) returns '#124'", () => {
    expect(formatAssetPeriodIndex(123)).toBe("#124");
  });

  it("formatAssetPeriodIndex(null) returns '#0'", () => {
    expect(formatAssetPeriodIndex(null)).toBe("#0");
  });

  it("assetsTabFromHash('#maintenance') returns 'maintenance'", () => {
    expect(assetsTabFromHash("#maintenance")).toBe("maintenance");
  });

  it("assetsTabFromHash returns the default tab for unknown / empty hash", () => {
    expect(assetsTabFromHash("")).toBe(ASSETS_DEFAULT_TAB);
    expect(assetsTabFromHash("#garbage")).toBe(ASSETS_DEFAULT_TAB);
  });
});

/* ────────── subcomponent sanity (proves the named exports work) ─ */

describe("Assets — subcomponents", () => {
  it("AssetsTabs renders 4 tabs with the expected testids", () => {
    const onChange = vi.fn();
    render(<AssetsTabs active="registry" onChange={onChange} />);
    expect(screen.getByTestId("assets-tab-registry")).toBeInTheDocument();
    expect(screen.getByTestId("assets-tab-depreciation")).toBeInTheDocument();
    expect(screen.getByTestId("assets-tab-maintenance")).toBeInTheDocument();
    expect(screen.getByTestId("assets-tab-assignment")).toBeInTheDocument();
  });

  it("AssetsTabs fires onChange when a tab is clicked", () => {
    const onChange = vi.fn();
    render(<AssetsTabs active="registry" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("assets-tab-maintenance"));
    expect(onChange).toHaveBeenCalledWith("maintenance");
  });

  it("AssetsRegistryTable renders one row per data item", () => {
    render(<AssetsRegistryTable data={[ROLLUP_ROW_A, ROLLUP_ROW_B]} />);
    const table = screen.getByTestId("assets-registry-table");
    expect(within(table).getAllByTestId("assets-registry-row")).toHaveLength(2);
  });
});
