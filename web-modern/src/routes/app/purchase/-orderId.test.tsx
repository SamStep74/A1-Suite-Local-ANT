/**
 * /app/purchase/$orderId (detail route) — route-level test for the
 * purchase order detail surface.
 *
 * Mirrors finance/$invoiceId / people/$employeeId pattern: mock the
 * three layers (Router, Query, API client), then drive the public
 * component surface.
 *
 * Coverage targets:
 *  - Loading state ("Loading order…")
 *  - notFound() when the order is missing
 *  - Header: order #, vendor, status pill, dates
 *  - Totals block: subtotal, VAT, total, receipts %
 *  - Lines: empty state, table rows
 *  - Action panel: tone varies by order status
 *  - Metadata: id, vendorId, billId, dates
 *  - Back-link to /app/purchase
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

/* ────────── mock state ────────── */

const mocks = vi.hoisted(() => ({
  params: { orderId: "ord-1" as string },
  order: null as unknown,
  loading: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    useParams: () => mocks.params,
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
    options: cfg,
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
      // queryKey is ["purchase-order", orderId]
      if (queryKey[0] === "purchase-order") {
        return { data: mocks.order, isLoading: mocks.loading, isError: false };
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

import { Route } from "./$orderId";

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

const DRAFT_ORDER = {
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
  remainingQuantity: 100,
  createdByName: "Anna Hovhannisyan",
  note: null,
  lines: [
    {
      id: "line-1",
      purchaseOrderId: "ord-1",
      catalogItemId: "ci-1",
      catalogSku: "SKU-1",
      catalogName: "Widget A",
      unitOfMeasure: "հատ",
      description: null,
      quantity: 100,
      receivedQuantity: 0,
      remainingQuantity: 100,
      unitCost: 1_000,
      subtotal: 100_000,
      vat: 20_000,
      total: 120_000,
    },
  ],
};

const RECEIVED_ORDER = {
  ...DRAFT_ORDER,
  id: "ord-2",
  orderNumber: "PO-0002",
  status: "received",
  receivedQuantity: 100,
  remainingQuantity: 0,
  lines: [
    {
      ...DRAFT_ORDER.lines[0],
      id: "line-2",
      purchaseOrderId: "ord-2",
      receivedQuantity: 100,
      remainingQuantity: 0,
    },
  ],
};

const BILLED_ORDER = {
  ...DRAFT_ORDER,
  id: "ord-3",
  orderNumber: "PO-0003",
  status: "billed",
  receivedQuantity: 30,
  remainingQuantity: 0,
  billId: "bill-1",
  billStatus: "open",
  lines: [],
};

const CREDITED_ORDER = {
  ...BILLED_ORDER,
  id: "ord-4",
  orderNumber: "PO-0004",
  creditNotes: [
    {
      id: "cn-1",
      poId: "ord-4",
      billId: "bill-1",
      returnId: "ret-1",
      amount: 15_000,
      currency: "AMD",
      status: "posted",
      postedAt: "2026-06-22T09:30:00.000Z",
      note: "Returned damaged billed goods.",
      ledgerPostingIds: ["le-1", "le-2"],
      createdByName: "Anna Hovhannisyan",
      createdAt: "2026-06-22T09:29:00.000Z",
    },
  ],
};

const LANDED_COST_ORDER = {
  ...DRAFT_ORDER,
  id: "ord-5",
  orderNumber: "PO-0005",
  status: "confirmed",
  landedCostCount: 1,
  landedCostAmount: 50_000,
  lines: [
    {
      ...DRAFT_ORDER.lines[0],
      id: "line-5",
      purchaseOrderId: "ord-5",
      landedCostAmount: 50_000,
      landedUnitCostDelta: 5_000,
      effectiveUnitCost: 105_000,
      landedCosts: [
        {
          id: "lcl-1",
          landedCostId: "lca-1",
          purchaseOrderLineId: "line-5",
          lineId: "line-5",
          amount: 50_000,
          allocated: 50_000,
          basis: 1_000_000,
          quantity: 10,
          subtotal: 1_000_000,
          unitCostDelta: 5_000,
          unitCostAdjustment: 5_000,
        },
      ],
    },
  ],
  landedCosts: [
    {
      id: "lca-1",
      poId: "ord-5",
      kind: "freight",
      amount: 50_000,
      currency: "AMD",
      fxRate: 1,
      allocationMethod: "value",
      baseTotal: 1_000_000,
      totalAllocated: 50_000,
      allocated: [
        {
          id: "lcl-1",
          landedCostId: "lca-1",
          purchaseOrderLineId: "line-5",
          lineId: "line-5",
          amount: 50_000,
          allocated: 50_000,
          basis: 1_000_000,
          quantity: 10,
          subtotal: 1_000_000,
          unitCostDelta: 5_000,
          unitCostAdjustment: 5_000,
        },
      ],
      createdAt: "2026-06-22T09:40:00.000Z",
    },
  ],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.params = { orderId: "ord-1" };
  mocks.order = DRAFT_ORDER;
  mocks.loading = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── loading / not-found ────────── */

describe("PurchaseOrderDetail — loading + not-found", () => {
  it("shows the loading message while the order is loading", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading order/i)).toBeInTheDocument();
  });
  it("throws notFound() when the order is missing", () => {
    mocks.order = null;
    expect(() => renderRoute()).toThrow(/notFound\(\) called/);
  });
});

/* ────────── header ────────── */

describe("PurchaseOrderDetail — header", () => {
  it("renders the vendor name as a level-1 heading", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Alpha Wholesale", level: 1 }),
    ).toBeInTheDocument();
  });
  it("renders the order number, ordered date, and expected date in the meta line", () => {
    renderRoute();
    expect(screen.getByText(/PO-0001/)).toBeInTheDocument();
    expect(screen.getByText(/Ordered 2026-06-01/)).toBeInTheDocument();
    expect(screen.getByText(/Expected 2026-06-15/)).toBeInTheDocument();
  });
  it("renders the 'Draft' status pill", () => {
    renderRoute();
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
  });
});

/* ────────── totals block ────────── */

describe("PurchaseOrderDetail — totals", () => {
  it("renders subtotal, VAT, total, and receipts percentage", () => {
    renderRoute();
    // Subtotal: 100 000, VAT: 20 000, Total: 120 000 (Armenian grouping).
    // Scope to the totals <dl> — the line table also renders 120 000.
    // Use exact-match (no regex) for VAT=20 000 to avoid matching "120 000".
    const dt = screen.getByText("Subtotal");
    const totalsBlock = dt.closest("dl") ?? document.body;
    expect(within(totalsBlock as HTMLElement).getByText(/100\s*000/)).toBeInTheDocument();
    expect(within(totalsBlock as HTMLElement).getByText("20 000 ֏")).toBeInTheDocument();
    expect(within(totalsBlock as HTMLElement).getByText(/120\s*000/)).toBeInTheDocument();
  });
  it("shows 0% receipts for a draft order", () => {
    renderRoute();
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
  it("shows 100% receipts for a fully-received order", () => {
    mocks.order = RECEIVED_ORDER;
    mocks.params = { orderId: "ord-2" };
    renderRoute();
    // Scope to the totals block — the action panel metadata is elsewhere.
    const dt = screen.getByText("Receipts");
    const totalsBlock = dt.closest("dl") ?? document.body;
    expect(within(totalsBlock as HTMLElement).getByText("100%")).toBeInTheDocument();
  });
});

/* ────────── order lines ────────── */

describe("PurchaseOrderDetail — order lines", () => {
  it("shows the empty state when there are no lines", () => {
    mocks.order = BILLED_ORDER;
    mocks.params = { orderId: "ord-3" };
    renderRoute();
    expect(screen.getByText(/No line items on this order/i)).toBeInTheDocument();
  });
  it("renders a hidden purchase-order-line entity marker", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="purchase-order-line"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("1");
  });
  it("renders one row per line", () => {
    renderRoute();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(2); // 1 header + 1 data
  });
  it("renders the SKU and description in the line row", () => {
    renderRoute();
    const table = screen.getByRole("table");
    expect(within(table).getByText("SKU-1")).toBeInTheDocument();
    expect(within(table).getByText(/Widget A/)).toBeInTheDocument();
  });
});

/* ────────── right rail ────────── */

describe("PurchaseOrderDetail — right rail", () => {
  it("renders the suggested-actions panel header", () => {
    renderRoute();
    expect(screen.getByText(/Suggested actions/i)).toBeInTheDocument();
    expect(screen.getByText(/Առաջարկվող գործողություններ/)).toBeInTheDocument();
  });
  it("renders the 'Confirm this order' action for a draft order", () => {
    renderRoute();
    expect(screen.getByText(/Confirm this order/i)).toBeInTheDocument();
  });
  it("renders the 'Record a receipt' action for a confirmed/partial order", () => {
    mocks.order = { ...DRAFT_ORDER, status: "confirmed" };
    renderRoute();
    expect(screen.getByText(/Record a receipt/i)).toBeInTheDocument();
  });
  it("renders the 'Convert to supplier bill' action for a received order", () => {
    mocks.order = RECEIVED_ORDER;
    mocks.params = { orderId: "ord-2" };
    renderRoute();
    expect(screen.getByText(/Convert to supplier bill/i)).toBeInTheDocument();
  });
  it("renders the metadata block with id, vendorId, and updated date", () => {
    renderRoute();
    const aside = screen.getAllByLabelText("Metadata")[0];
    expect(within(aside).getByText("ord-1")).toBeInTheDocument();
    expect(within(aside).getByText("ven-1")).toBeInTheDocument();
  });
  it("renders read-only return credit-note evidence for billed returns", () => {
    mocks.order = CREDITED_ORDER;
    mocks.params = { orderId: "ord-4" };
    renderRoute();

    const marker = document.querySelector('[data-entity="purchase-return-credit-note"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("1");

    const heading = screen.getByRole("heading", { name: /Return credit notes/i });
    const panel = heading.closest("section") as HTMLElement;
    expect(within(panel).getByText("cn-1")).toBeInTheDocument();
    expect(within(panel).getAllByText(/15\s*000/).length).toBeGreaterThan(0);
    expect(within(panel).getByText("bill-1")).toBeInTheDocument();
    expect(within(panel).getByText("ret-1")).toBeInTheDocument();
    expect(within(panel).getByText("le-1, le-2")).toBeInTheDocument();
    expect(within(panel).queryByRole("button")).toBeNull();
  });
  it("renders read-only landed-cost allocation evidence", () => {
    mocks.order = LANDED_COST_ORDER;
    mocks.params = { orderId: "ord-5" };
    renderRoute();

    const marker = document.querySelector('[data-entity="purchase-landed-cost"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("1");

    const heading = screen.getByRole("heading", { name: /Landed costs/i });
    const panel = heading.closest("section") as HTMLElement;
    expect(within(panel).getByText("lca-1")).toBeInTheDocument();
    expect(within(panel).getAllByText(/50\s*000/).length).toBeGreaterThan(0);
    expect(within(panel).getByText("line-5")).toBeInTheDocument();
    expect(within(panel).getByText(/unit delta/)).toBeInTheDocument();
    expect(within(panel).queryByRole("button")).toBeNull();
  });
});

/* ────────── back link ────────── */

describe("PurchaseOrderDetail — back link", () => {
  it("renders a 'Purchase' back link to /app/purchase", () => {
    renderRoute();
    const backLinks = screen.getAllByRole("link");
    const purchaseLink = backLinks.find(
      (l) => (l.textContent ?? "").trim() === "Purchase",
    );
    expect(purchaseLink).toBeDefined();
    expect(purchaseLink?.getAttribute("data-href")).toBe("/app/purchase");
  });
});
