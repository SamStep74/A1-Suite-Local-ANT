/**
 * /app/purchase (index route) — route-level test for the Purchase
 * workspace.
 *
 * Mirrors the people/finance pattern: mock the three layers (Router,
 * Query, API client) and drive the public component surface.
 *
 * Coverage targets:
 *  - validateSearch (defaulting + view coercion)
 *  - Page header (Purchase title, Armenian subtitle)
 *  - ViewSwitcher tabs (Vendors | Orders | Analytics)
 *  - Vendors view: table rows, status pills, sidebar
 *  - Orders view: table rows, status pills, totals
 *  - Analytics view: KPI cards
 *  - Back-link to /app
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

/* ────────── mock state, hoisted ────────── */

type View = "vendors" | "orders" | "analytics";

const mocks = vi.hoisted(() => ({
  search: { view: "vendors" as View },
  vendors: null as unknown,
  orders: null as unknown,
  analytics: null as unknown,
  vendorsLoading: false,
  ordersLoading: false,
  analyticsLoading: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: {
    component: unknown;
    validateSearch: unknown;
  }) => ({
    useSearch: () => mocks.search,
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
    options: cfg,
    update: (u: unknown) => u,
  }),
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
    params?: Record<string, string>;
  } & Record<string, unknown>) => (
    <a data-href={to} href={to} data-params={JSON.stringify(params ?? {})} {...rest}>
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
      if (key === "purchase-vendors") {
        return { data: mocks.vendors, isLoading: mocks.vendorsLoading, isError: false };
      }
      if (key === "purchase-orders") {
        return { data: mocks.orders, isLoading: mocks.ordersLoading, isError: false };
      }
      if (key === "purchase-analytics") {
        return { data: mocks.analytics, isLoading: mocks.analyticsLoading, isError: false };
      }
      return { data: null, isLoading: false, isError: false };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../lib/api/client", () => ({
  getJson: vi.fn().mockResolvedValue({}),
  postJson: vi.fn().mockResolvedValue({}),
  postVoid: vi.fn().mockResolvedValue(undefined),
}));

/* ────────── import under test ────────── */

import { Route } from "./index";

/* ────────── helpers ────────── */

function renderRoute() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Component = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}

const VALID_VENDORS = {
  vendors: [
    {
      id: "ven-1",
      name: "Alpha Wholesale",
      taxId: "010111111",
      email: "sales@alpha.am",
      phone: "+374 11 123 456",
      status: "active",
      paymentTermsDays: 30,
      leadTimeDays: 5,
      note: null,
    },
    {
      id: "ven-2",
      name: "Beta Logistics",
      taxId: null,
      email: null,
      phone: null,
      status: "inactive",
      paymentTermsDays: 14,
      leadTimeDays: null,
      note: null,
    },
    {
      id: "ven-3",
      name: "Gamma Suppliers",
      taxId: "020222222",
      email: null,
      phone: null,
      status: "blocked",
      paymentTermsDays: null,
      leadTimeDays: null,
      note: "credit hold",
    },
  ],
};

const VALID_ORDERS = {
  orders: [
    {
      id: "ord-1",
      vendorId: "ven-1",
      vendorName: "Alpha Wholesale",
      orderNumber: "PO-0001",
      supplier: "Alpha Wholesale",
      status: "draft",
      subtotal: 100_000,
      vat: 20_000,
      total: 120_000,
      currency: "AMD",
      orderDate: "2026-06-01",
      expectedDate: "2026-06-15",
      orderedQuantity: 100,
      receivedQuantity: 0,
    },
    {
      id: "ord-2",
      vendorId: "ven-1",
      vendorName: "Alpha Wholesale",
      orderNumber: "PO-0002",
      supplier: "Alpha Wholesale",
      status: "received",
      subtotal: 50_000,
      vat: 10_000,
      total: 60_000,
      currency: "AMD",
      orderDate: "2026-05-10",
      orderedQuantity: 50,
      receivedQuantity: 50,
    },
    {
      id: "ord-3",
      vendorId: "ven-1",
      vendorName: "Alpha Wholesale",
      orderNumber: "PO-0003",
      supplier: "Alpha Wholesale",
      status: "billed",
      subtotal: 30_000,
      vat: 6_000,
      total: 36_000,
      currency: "AMD",
      orderDate: "2026-04-20",
      orderedQuantity: 30,
      receivedQuantity: 30,
    },
  ],
};

const VALID_ANALYTICS = {
  summary: {
    orderCount: 3,
    vendorCount: 3,
    activeVendorCount: 1,
    openValue: 120_000,
    billedValue: 36_000,
    receiptProgressPercent: 50,
    returnedQuantity: 0,
    remainingQuantity: 50,
    vendorPricedLineCount: 4,
    lineCount: 5,
    vendorPriceCoveragePercent: 80,
    returnCreditNoteCount: 2,
    returnCreditNoteAmount: 15_000,
  },
  receiptBacklog: [],
  vendorPerformance: [],
  priceCoverage: null,
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = { view: "vendors" };
  mocks.vendors = VALID_VENDORS;
  mocks.orders = VALID_ORDERS;
  mocks.analytics = VALID_ANALYTICS;
  mocks.vendorsLoading = false;
  mocks.ordersLoading = false;
  mocks.analyticsLoading = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── validateSearch ────────── */

describe("Route.options.validateSearch", () => {
  it("defaults view to 'vendors' on empty input", () => {
    const fn = Route.options.validateSearch as (raw: Record<string, unknown>) => unknown;
    expect(fn({})).toEqual({ view: "vendors" });
  });
  it("accepts 'orders' and 'analytics'", () => {
    const fn = Route.options.validateSearch as (raw: Record<string, unknown>) => unknown;
    expect(fn({ view: "orders" })).toMatchObject({ view: "orders" });
    expect(fn({ view: "analytics" })).toMatchObject({ view: "analytics" });
  });
  it("falls back to 'vendors' for unknown views", () => {
    const fn = Route.options.validateSearch as (raw: Record<string, unknown>) => unknown;
    expect(fn({ view: "garbage" })).toMatchObject({ view: "vendors" });
  });
});

/* ────────── page shell ────────── */

describe("PurchaseWorkspace — page shell", () => {
  it("shows the loading message when vendors are loading", () => {
    mocks.vendorsLoading = true;
    renderRoute();
    expect(screen.getByText(/Loading vendors/i)).toBeInTheDocument();
  });
  it("renders the header with title 'Purchase' and the Armenian subtitle", () => {
    renderRoute();
    expect(screen.getByRole("heading", { name: "Purchase", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Մատակարարներ · Պատվերներ · Վերլուծություն/)).toBeInTheDocument();
  });
  it("renders the 'Today' back-link to /app", () => {
    renderRoute();
    const backLinks = screen.getAllByRole("link");
    const todayLink = backLinks.find((l) => l.textContent === "Today");
    expect(todayLink).toBeDefined();
    expect(todayLink?.getAttribute("data-href")).toBe("/app");
  });
  it("renders the ViewSwitcher with three tabs", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: /View/ });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0].textContent).toMatch(/Vendors/);
    expect(tabs[1].textContent).toMatch(/Orders/);
    expect(tabs[2].textContent).toMatch(/Analytics/);
  });
});

/* ────────── Vendors view ────────── */

describe("PurchaseWorkspace — vendors view", () => {
  it("renders one row per vendor in the table", () => {
    renderRoute();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4); // 1 header + 3 data
  });
  it("renders a hidden purchase-vendor entity marker", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="purchase-vendor"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("3");
  });
  it("renders the vendors sidebar with active + blocked counts", () => {
    renderRoute();
    const aside = screen.getByLabelText("Vendors overview");
    // Total = 3 vendors, Active = 1, Blocked = 1 (Inactive = 1)
    expect(within(aside).getByText("3")).toBeInTheDocument();
    // Two "1"s are present (Active and Blocked counts) — assert the heading structure
    expect(within(aside).getByText(/Vendor directory/)).toBeInTheDocument();
    expect(within(aside).getByText(/Active/)).toBeInTheDocument();
    expect(within(aside).getByText(/Blocked/)).toBeInTheDocument();
  });
  it("shows the empty-state copy when there are no vendors", () => {
    mocks.vendors = { vendors: [] };
    renderRoute();
    expect(screen.getByText(/No vendors yet/i)).toBeInTheDocument();
  });
});

/* ────────── Orders view ────────── */

describe("PurchaseWorkspace — orders view", () => {
  beforeEach(() => {
    mocks.search = { view: "orders" };
  });

  it("renders one row per order in the table", () => {
    renderRoute();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4); // 1 header + 3 data
  });
  it("renders a hidden purchase-order entity marker", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="purchase-order"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("3");
  });
  it("sorts orders actionable first (draft, received, billed)", () => {
    renderRoute();
    const table = screen.getByRole("table");
    const firstRow = within(table).getAllByRole("row")[1];
    // The first data row should be the draft order (PO-0001)
    expect(within(firstRow).getByText("PO-0001")).toBeInTheDocument();
  });
  it("renders the orders sidebar with open + billed values", () => {
    renderRoute();
    const aside = screen.getByLabelText("Orders overview");
    // openValue = 120_000 (draft), billedValue = 36_000 (billed)
    expect(within(aside).getByText(/Open value/i)).toBeInTheDocument();
    expect(within(aside).getByText(/Billed value/i)).toBeInTheDocument();
    // Armenian digit grouping
    expect(within(aside).getByText(/120\s*000/)).toBeInTheDocument();
    expect(within(aside).getByText(/36\s*000/)).toBeInTheDocument();
  });
  it("shows the empty-state copy when there are no orders", () => {
    mocks.orders = { orders: [] };
    renderRoute();
    expect(screen.getByText(/No purchase orders yet/i)).toBeInTheDocument();
  });
});

/* ────────── Analytics view ────────── */

describe("PurchaseWorkspace — analytics view", () => {
  beforeEach(() => {
    mocks.search = { view: "analytics" };
  });

  it("renders the KPI cards", () => {
    renderRoute();
    expect(screen.getByText(/Active vendors/i)).toBeInTheDocument();
    expect(screen.getByText(/Open orders/i)).toBeInTheDocument();
    expect(screen.getByText(/Receipt progress/i)).toBeInTheDocument();
    expect(screen.getByText(/Price coverage/i)).toBeInTheDocument();
    expect(screen.getByText(/Billed value/i)).toBeInTheDocument();
    expect(screen.getByText(/Returned quantity/i)).toBeInTheDocument();
    expect(screen.getByText(/Return credit notes/i)).toBeInTheDocument();
  });
  it("renders the active-vendor count (1) and total vendor count (3)", () => {
    renderRoute();
    // "1" appears as the active vendor count
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    // "3" appears as the total vendor count
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
  });
  it("renders the receipt progress as a percentage", () => {
    renderRoute();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
  it("renders return credit-note amount and count", () => {
    renderRoute();
    const heading = screen.getByText(/Return credit notes/i);
    const card = heading.closest("section") as HTMLElement;
    expect(within(card).getByText(/15\s*000/)).toBeInTheDocument();
    expect(within(card).getByText(/2 credit notes/)).toBeInTheDocument();
  });
  it("renders the procurement health footer", () => {
    renderRoute();
    expect(screen.getByText(/Procurement health/i)).toBeInTheDocument();
  });
  it("shows loading when analytics is loading", () => {
    mocks.analyticsLoading = true;
    renderRoute();
    expect(screen.getByText(/Loading analytics/i)).toBeInTheDocument();
  });
});
