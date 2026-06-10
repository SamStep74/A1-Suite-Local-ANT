/**
 * /app/inventory/$itemId (detail route) — first route-level test.
 *
 * Same mocking pattern as `index.test.tsx`. Drives the route through
 * its public `Route` export:
 *
 *   - `Route.options.validateSearch` for the tab-coercion logic.
 *   - `Route.options.component` for the rendered UI (header, tabs,
 *     panels, right-rail metadata, agent context wiring).
 *
 * The detail page hits three TanStack Query endpoints and reads
 * `Route.useParams()` for the `itemId` param. We drive that param
 * through the hoisted `mocks` object as well, and use a single
 * `invalidateQueries` stub on the mock QueryClient.
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
  search: { tab: "overview" as "overview" | "stock" | "moves" | "post" },
  params: { itemId: "ci-1" },
  catalog: null as unknown,
  stock: null as unknown,
  moves: null as unknown,
  loading: false,
  error: false,
  fullPath: "/app/inventory/$itemId",
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown; validateSearch: unknown }) => ({
    fullPath: mocks.fullPath,
    useSearch: () => mocks.search,
    useParams: () => mocks.params,
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

import { Route } from "./$itemId";

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
      variants: [
        {
          id: "v-1",
          sku: "EQ-CHAIR-BLK",
          name: "Black",
          listPrice: 620000,
        },
      ],
      variantCount: 1,
      trackStock: true,
      trackLots: false,
      fiscalReceiptRequired: true,
      createdAt: "2026-01-15T08:00:00.000Z",
      updatedAt: "2026-06-09T08:00:00.000Z",
      createdByName: "Owner",
      vatMode: "inclusive",
    },
  ],
  categories: [],
  unitsOfMeasure: [],
  marginRules: [],
  priceLists: [
    {
      id: "pl-1",
      code: "STANDARD",
      name: "Standard",
      items: [
        {
          id: "pl-i-1",
          priceListId: "pl-1",
          catalogItemId: "ci-1",
          listPrice: 600000,
          netPrice: 600000,
          standardCost: 400000,
          marginStatus: "ok",
          marginPercent: 33.3,
        },
        {
          id: "pl-i-2",
          priceListId: "pl-1",
          catalogItemId: "ci-1",
          listPrice: 540000,
          netPrice: 540000,
          standardCost: 400000,
          marginStatus: "below_minimum",
          marginPercent: 8,
        },
      ],
    },
  ],
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
      quantity: 20,
      reservedQuantity: 0,
      availableQuantity: 20,
      averageCost: 400000,
    },
  ],
  locations: [
    { id: "loc-1", code: "WH/STOCK", name: "Main Warehouse", locationType: "internal" },
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
      reason: "Vendor delivery",
      reference: "PO-2026-007",
      createdAt: "2026-06-09T10:00:00.000Z",
    },
  ],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = { tab: "overview" };
  mocks.params = { itemId: "ci-1" };
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
 * validateSearch — the tab URL-param coercion. The route maps an
 * invalid `?tab=` to 'overview'; valid values are 'stock', 'moves',
 * 'post'.
 * ──────────────────────────────────────────────────────────────────── */

describe("Route.options.validateSearch", () => {
  it("defaults tab to 'overview' on empty input", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({});
    expect(r).toEqual({ tab: "overview" });
  });

  it("accepts 'stock' as a tab", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ tab: "stock" });
    expect(r).toEqual({ tab: "stock" });
  });

  it("accepts 'moves' as a tab", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ tab: "moves" });
    expect(r).toEqual({ tab: "moves" });
  });

  it("accepts 'post' as a tab", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ tab: "post" });
    expect(r).toEqual({ tab: "post" });
  });

  it("falls back to 'overview' for an unknown tab", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ tab: "garbage" });
    expect(r).toEqual({ tab: "overview" });
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * ItemDetail — root component rendering. We assert on the inline
 * sub-components (`ItemHeader`, `TabBar`, `OverviewPanel`,
 * `StockPanel`, `MovesPanel`, `ItemMetadata`, …) through the rendered
 * tree.
 * ──────────────────────────────────────────────────────────────────── */

describe("ItemDetail — view states", () => {
  it("shows the loading message when any query is loading", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading item/i)).toBeInTheDocument();
  });

  it("shows the error alert when any query errors", () => {
    mocks.error = true;
    renderRoute();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Could not load the catalog item/i,
    );
  });

  it("calls notFound() when the itemId does not match any catalog item", () => {
    mocks.params = { itemId: "does-not-exist" };
    expect(() => renderRoute()).toThrow(/notFound/);
  });
});

describe("ItemDetail — overview tab (default)", () => {
  beforeEach(() => {
    mocks.search = { tab: "overview" };
  });

  it("renders the item's SKU and name in the header", () => {
    renderRoute();
    // The ItemHeader shows the SKU as a monospace caption and the
    // name as the H1. The SKU also appears in the VariantsPanel as a
    // different element, so we assert the SKU is present (it shows
    // up at least once) and the name appears as the H1.
    expect(screen.getAllByText("EQ-CHAIR").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole("heading", { level: 1, name: /Treatment chair/i }),
    ).toBeInTheDocument();
  });

  it("renders the four tabs with the right labels", () => {
    renderRoute();
    const tabs = screen.getAllByRole("tab");
    const labels = tabs.map((t) => t.textContent ?? "");
    expect(labels.some((l) => l.includes("Overview"))).toBe(true);
    expect(labels.some((l) => l.includes("Stock"))).toBe(true);
    expect(labels.some((l) => l.includes("Moves"))).toBe(true);
    expect(labels.some((l) => l.includes("Post move"))).toBe(true);
  });

  it("marks the Overview tab as selected by default", () => {
    renderRoute();
    const tabs = screen.getAllByRole("tab");
    const overview = tabs.find((t) => (t.textContent ?? "").includes("Overview"));
    expect(overview).toHaveAttribute("aria-selected", "true");
  });

  it("renders the VariantsPanel when the item has variants", () => {
    renderRoute();
    // VariantsPanel renders a heading "Variants" and one <li> per
    // variant with the variant SKU inside.
    const heading = screen.getByRole("heading", { name: /^Variants$/i });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText("EQ-CHAIR-BLK")).toBeInTheDocument();
  });

  it("renders the price list entries with margin percentages", () => {
    renderRoute();
    // The two seeded entries render in a single price list section.
    // 33.3% is rounded to 1 decimal place by the page; 8% likewise.
    expect(screen.getByText("33.3%")).toBeInTheDocument();
    expect(screen.getByText("8.0%")).toBeInTheDocument();
  });

  it("renders the right-rail ItemMetadata with 'Created' and 'Owner'", () => {
    renderRoute();
    // The ItemMetadata aside is the second child of the right-rail.
    // It renders a 'Details' heading and <Row>s for Created/Owner.
    // The "Owner" string appears as both the <dt> label AND the
    // <dd> value (since the seed item has createdByName='Owner'),
    // so we use the AllByText variant.
    expect(screen.getAllByText("Created").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Owner").length).toBeGreaterThanOrEqual(1);
  });
});

describe("ItemDetail — stock tab", () => {
  beforeEach(() => {
    mocks.search = { tab: "stock" };
  });

  it("renders the StockPanel header 'Stock by location' when balances exist", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: /Stock by location/i }),
    ).toBeInTheDocument();
  });

  it("shows the empty-state copy when there are no balances for this item", () => {
    mocks.stock = { stock: [], locations: [] };
    renderRoute();
    expect(
      screen.getByText(/No stock on hand for this item/i),
    ).toBeInTheDocument();
  });

  it("renders a Healthy StockHealthPill when balance is above threshold", () => {
    renderRoute();
    // The ItemHeader also renders a stock-health pill in its right
    // column, so "Healthy" appears at least twice (header + table).
    // The table pill has the pill class (uppercase tracking-wide);
    // the header pill uses a slightly different class. We just need
    // to confirm the row pill is in the table.
    const table = screen.getByRole("table");
    const pills = within(table).getAllByText("Healthy");
    expect(pills.length).toBeGreaterThanOrEqual(1);
  });
});

describe("ItemDetail — moves tab", () => {
  beforeEach(() => {
    mocks.search = { tab: "moves" };
  });

  it("renders the 'Recent moves' panel header", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: /Recent moves/i }),
    ).toBeInTheDocument();
  });

  it("renders the move's moveType label", () => {
    renderRoute();
    // The detail MovesPanel prints the raw move type (lower-case),
    // not the uppercase pill.
    expect(screen.getByText("receipt")).toBeInTheDocument();
  });

  it("shows the empty-state copy when there are no moves for this item", () => {
    mocks.moves = { moves: [] };
    renderRoute();
    expect(
      screen.getByText(/No stock moves for this item yet/i),
    ).toBeInTheDocument();
  });
});
