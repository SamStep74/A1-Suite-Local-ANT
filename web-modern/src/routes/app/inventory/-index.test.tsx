/**
 * /app/inventory (index route) — first route-level test.
 *
 * The route file is glue code that wires TanStack Router + Query + a
 * handful of inline sub-components (`StockHealthPill`, `MoveTypePill`,
 * `FilterTabs`, `SearchInput`, `EmptyState`, …). Those sub-components
 * are NOT individually exported, so the only public surface we can
 * drive from a test is the `Route` object that `createFileRoute`
 * returns — namely its `validateSearch` and its `options.component`.
 *
 * The mocking pattern here is meant to be the template for every
 * future web-modern route test. The shape of the pattern is:
 *
 *   1. `vi.hoisted` exposes a `mocks` object whose fields the test
 *      body mutates (search params, query data, loading/error flags).
 *   2. `@tanstack/react-router` is mocked so `createFileRoute` returns
 *      a stub Route whose `useSearch` reads from the `mocks` object
 *      and whose `options` exposes the route config (incl.
 *      `options.component`).
 *   3. `@tanstack/react-query` is mocked so `useQuery` returns
 *      canned data per `queryKey` (catalog-items | stock |
 *      inventory-moves) and `useQueryClient` is a no-op.
 *   4. `@/lib/api/client` is mocked so the network call in the real
 *      `queryFn` is never actually made.
 *   5. The test then either asserts on `Route.options.validateSearch`
 *      (pure) or renders `Route.options.component` inside
 *      `<QueryClientProvider>` and asserts on the rendered output
 *      (text, role, links).
 *
 * This avoids a full TanStack Router + Query harness and gives us
 * meaningful coverage of the route's behaviour end-to-end, including
 * the inline sub-components, without ever rendering the real router.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state, hoisted so vi.mock factories can see it ────────── */

const mocks = vi.hoisted(() => ({
  search: { view: "stock" as "catalog" | "stock" | "moves", status: "all" },
  catalog: null as unknown,
  stock: null as unknown,
  moves: null as unknown,
  loading: false,
  error: false,
  fullPath: "/app/inventory/",
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown; validateSearch: unknown }) => ({
    fullPath: mocks.fullPath,
    useSearch: () => mocks.search,
    useParams: () => ({}),
    options: cfg,
    update: (u: unknown) => u,
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
  useNavigate: () => vi.fn(),
  notFound: () => {
    throw new Error("notFound() called");
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      const key = queryKey[0];
      if (key === "catalog-items") {
        return {
          data: mocks.catalog,
          isLoading: mocks.loading,
          isError: mocks.error,
        };
      }
      if (key === "stock") {
        return {
          data: mocks.stock,
          isLoading: mocks.loading,
          isError: mocks.error,
        };
      }
      if (key === "inventory-moves") {
        return {
          data: mocks.moves,
          isLoading: mocks.loading,
          isError: mocks.error,
        };
      }
      return { data: null, isLoading: false, isError: false };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../lib/api/client", () => ({
  getJson: vi.fn().mockResolvedValue({}),
  postJson: vi.fn().mockResolvedValue({}),
}));

/* ────────── import the route under test (mocks are in place by now) ───── */

import { Route } from "./index";

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

const VALID_CATALOG = {
  items: [
    {
      id: "ci-1",
      categoryId: "cat-1",
      categoryName: "Equipment",
      sku: "EQ-CHAIR",
      name: "Treatment chair",
      description: "Hydraulic treatment chair",
      itemType: "stockable",
      status: "active",
      unitOfMeasure: "pc",
      listPrice: 600000,
      standardCost: 400000,
      variants: [],
      variantCount: 0,
      trackStock: true,
      trackLots: false,
      fiscalReceiptRequired: false,
    },
    {
      id: "ci-2",
      categoryId: "cat-1",
      categoryName: "Equipment",
      sku: "EQ-LASER",
      name: "Aesthetic laser",
      description: null,
      itemType: "stockable",
      status: "active",
      unitOfMeasure: "pc",
      listPrice: 5000000,
      standardCost: 3000000,
      variants: [],
      variantCount: 0,
      trackStock: true,
      trackLots: false,
      fiscalReceiptRequired: false,
    },
  ],
  categories: [],
  unitsOfMeasure: [],
  marginRules: [],
  priceLists: [],
};

const VALID_STOCK = {
  stock: [
    {
      id: "sb-1",
      catalogItemId: "ci-1",
      catalogSku: "EQ-CHAIR",
      catalogName: "Treatment chair",
      locationId: "loc-1",
      locationCode: "WH/STOCK",
      locationName: "Main Warehouse",
      locationType: "internal",
      quantity: 8,
      reservedQuantity: 0,
      availableQuantity: 8,
      averageCost: 400000,
    },
    {
      id: "sb-2",
      catalogItemId: "ci-1",
      catalogSku: "EQ-CHAIR",
      catalogName: "Treatment chair",
      locationId: "loc-2",
      locationCode: "WH/OUT",
      locationName: "Outlet",
      locationType: "retail",
      quantity: 0,
      reservedQuantity: 0,
      availableQuantity: 0,
      averageCost: 400000,
    },
  ],
  locations: [
    { id: "loc-1", code: "WH/STOCK", name: "Main Warehouse", locationType: "internal" },
    { id: "loc-2", code: "WH/OUT", name: "Outlet", locationType: "retail" },
  ],
};

const VALID_MOVES = {
  moves: [
    {
      id: "sm-1",
      catalogItemId: "ci-1",
      catalogSku: "EQ-CHAIR",
      catalogName: "Treatment chair",
      sourceLocationId: null,
      sourceLocationCode: null,
      destinationLocationId: "loc-1",
      destinationLocationCode: "WH/STOCK",
      moveType: "receipt",
      quantity: 5,
      unitCost: 400000,
      reason: "Vendor delivery",
      reference: "PO-2026-007",
      createdAt: "2026-06-09T10:00:00.000Z",
    },
    {
      id: "sm-2",
      catalogItemId: "ci-1",
      catalogSku: "EQ-CHAIR",
      catalogName: "Treatment chair",
      sourceLocationId: "loc-1",
      sourceLocationCode: "WH/STOCK",
      destinationLocationId: "loc-2",
      destinationLocationCode: "WH/OUT",
      moveType: "transfer",
      quantity: 3,
      reason: "Replenish outlet",
      reference: null,
      createdAt: "2026-06-10T10:00:00.000Z",
    },
  ],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = { view: "stock", status: "all" };
  mocks.catalog = VALID_CATALOG;
  mocks.stock = VALID_STOCK;
  mocks.moves = VALID_MOVES;
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

/* ─────────────────────────────────────────────────────────────────────
 * validateSearch — the route's only pure public function. URL params
 * are notoriously the most-edited surface; pin the defaulting logic
 * so a future refactor can't silently widen the input space.
 * ──────────────────────────────────────────────────────────────────── */

describe("Route.options.validateSearch", () => {
  it("defaults view to 'catalog' and status to 'all' on empty input", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({});
    expect(r).toEqual({ view: "catalog", status: "all" });
  });

  it("accepts 'stock' as a view", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ view: "stock" });
    expect(r).toMatchObject({ view: "stock" });
  });

  it("accepts 'moves' as a view", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ view: "moves" });
    expect(r).toMatchObject({ view: "moves" });
  });

  it("falls back to 'catalog' for an unknown view", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ view: "garbage" });
    expect(r).toMatchObject({ view: "catalog" });
  });

  it("preserves the status string verbatim (the type is widened to string)", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ view: "stock", status: "out" });
    expect(r).toEqual({ view: "stock", status: "out" });
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * InventoryWorkspace — root component rendering.
 * We assert on the inline sub-components (`StockHealthPill`,
 * `EmptyState`, `FilterTabs`, `Link`-to-detail) through the rendered
 * tree, which is the same way a user or Playwright would see them.
 * ──────────────────────────────────────────────────────────────────── */

describe("InventoryWorkspace — view states", () => {
  it("shows the loading message when any query is loading", () => {
    mocks.loading = true;
    mocks.search = { view: "catalog", status: "all" };
    renderRoute();
    expect(screen.getByText(/Loading inventory/i)).toBeInTheDocument();
  });

  it("shows the error alert when any query errors", () => {
    mocks.error = true;
    mocks.search = { view: "catalog", status: "all" };
    renderRoute();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Could not load inventory data/i,
    );
  });

  it("shows the EmptyState when catalog has no items", () => {
    mocks.catalog = { ...VALID_CATALOG, items: [] };
    mocks.search = { view: "catalog", status: "all" };
    renderRoute();
    expect(screen.getByText(/No catalog items yet/i)).toBeInTheDocument();
  });
});

describe("InventoryWorkspace — stock view", () => {
  it("renders one row per stock balance with a link to the item detail", () => {
    mocks.search = { view: "stock", status: "all" };
    renderRoute();
    // Each balance has a Link to /app/inventory/$itemId.
    const links = screen.getAllByRole("link");
    const detailLinks = links.filter((l) =>
      String(l.getAttribute("data-href") ?? "").includes(
        "/app/inventory/$itemId",
      ),
    );
    expect(detailLinks).toHaveLength(2);
  });

  it("renders the filter tabs for the stock health buckets", () => {
    mocks.search = { view: "stock", status: "all" };
    renderRoute();
    // FilterTabs renders one <button role="tab"> per value.
    const tabs = screen.getAllByRole("tab");
    const labels = tabs.map((t) => t.textContent ?? "");
    expect(labels.some((l) => l.startsWith("All"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Out"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Low"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Healthy"))).toBe(true);
  });

  it("renders a 'Healthy' StockHealthPill for a balance above threshold", () => {
    mocks.search = { view: "stock", status: "all" };
    renderRoute();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
  });

  it("renders an 'Out' StockHealthPill for a balance at zero", () => {
    mocks.search = { view: "stock", status: "all" };
    renderRoute();
    // The text "Out" also appears in the "Out" filter tab, so we
    // assert there are at least two matches and at least one is a
    // StockHealthPill (uppercase tracking-wide class).
    const outs = screen.getAllByText("Out");
    expect(outs.length).toBeGreaterThanOrEqual(2);
    const pills = outs.filter((el) =>
      (el.className ?? "").includes("uppercase"),
    );
    expect(pills.length).toBeGreaterThanOrEqual(1);
  });

  it("shows the 'no balances yet' message when stock is empty", () => {
    mocks.stock = { stock: [], locations: [] };
    mocks.search = { view: "stock", status: "all" };
    renderRoute();
    expect(screen.getByText(/No stock balances yet/i)).toBeInTheDocument();
  });
});

describe("InventoryWorkspace — moves view", () => {
  it("renders a MoveTypePill per move with the right label", () => {
    mocks.search = { view: "moves", status: "all" };
    renderRoute();
    // The MoveTypePill uppercases the move type and shows it as the label.
    const table = screen.getByRole("table");
    expect(within(table).getByText("receipt")).toBeInTheDocument();
    expect(within(table).getByText("transfer")).toBeInTheDocument();
  });

  it("renders the move filter tabs", () => {
    mocks.search = { view: "moves", status: "all" };
    renderRoute();
    const tabs = screen.getAllByRole("tab");
    const labels = tabs.map((t) => t.textContent ?? "");
    expect(labels.some((l) => l.startsWith("Receipts"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Deliveries"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Transfers"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Adjustments"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Scrap"))).toBe(true);
  });
});

describe("InventoryWorkspace — catalog view", () => {
  it("renders one row per catalog item with a Link to the detail", () => {
    mocks.search = { view: "catalog", status: "all" };
    renderRoute();
    const links = screen.getAllByRole("link");
    const detailLinks = links.filter((l) =>
      String(l.getAttribute("data-href") ?? "").includes(
        "/app/inventory/$itemId",
      ),
    );
    expect(detailLinks).toHaveLength(2);
    expect(detailLinks[0]?.getAttribute("data-href")).toContain("itemId");
  });

  it("shows the per-item 'In stock' total from the stock balances", () => {
    // EQ-CHAIR has 8 + 0 = 8 across two balances. The catalog list
    // aggregates these via `totalStockByItemId`.
    mocks.search = { view: "catalog", status: "all" };
    renderRoute();
    const table = screen.getByRole("table");
    // 8 is the aggregated total for ci-1; the other item has no
    // balances so its total is 0 (and the row shows a dash since
    // trackStock is true but the formatter emits "0" for the total).
    expect(within(table).getByText("8")).toBeInTheDocument();
  });
});
