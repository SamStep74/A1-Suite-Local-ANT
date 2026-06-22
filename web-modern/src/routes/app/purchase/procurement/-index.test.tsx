/**
 * /app/purchase/procurement — Pattern A route test
 *
 * Mirrors the cabinet test pattern. Mocks the three layers
 * (Router, Query, API client), then exercises the public
 * surface: 7 tabs, 5 POST flows, blanket coverage, replenishment queue, the
 * 403 access gate, the back link, and the route-local hash helpers.
 *
 * Coverage (Phase 8.4 layer 2):
 *  1.  Page shell — H2 contains Armenian title
 *  2.  Seven tab buttons render in the strip
 *  3.  Default tab is Requisition
 *  4.  Tab switching reveals the matching form
 *  5.  Requisition form posts to /api/procurement/requisitions
 *  6.  RFQ form posts to /api/procurement/requisitions/:id/convert-to-rfq
 *  7.  Quote form posts to /api/procurement/rfqs/:id/quotes
 *  8.  Award form posts to /api/procurement/rfqs/:id/award
 *  9.  Receipt tab stays deferred to purchase-order receiving
 * 10.  Blanket form posts to /api/procurement/blanket-orders
 * 11.  Blanket coverage lookup fetches by catalog item id
 * 12.  RFQ form is disabled until a requisition id exists
 * 13.  Quote form is disabled until an RFQ id exists
 * 14.  Award form is disabled until a quote id exists
 * 15.  Receipt tab explains that receiving is deferred
 * 16.  Cross-tab flow: requisitionId → rfqId → quoteId → draftPoId
 * 17.  procurementRouteTabFromHash('#quote') returns 'quote'; nullish safe
 * 18.  403 branch: userAccess='none' renders the access-denied card
 * 19.  Back link points to /app/purchase
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
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state, hoisted so vi.mock factories see it ────────── */

const mocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  patchJson: vi.fn(),
  // One mutate impl per route so the test can drive each form
  // independently. Indexed by the tab it backs.
  mutateImpls: {
    requisition: vi.fn(),
    rfq: vi.fn(),
    quote: vi.fn(),
    po: vi.fn(),
    receipt: vi.fn(),
    blanket: vi.fn(),
  },
  // isPending flags, one per mutation.
  pendingFlags: {
    requisition: false,
    rfq: false,
    quote: false,
    po: false,
    receipt: false,
    blanket: false,
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (cfg: { component: unknown }) => ({
      useSearch: () => ({}),
      useParams: () => ({}),
      useNavigate: () => vi.fn(),
      options: cfg,
    }),
  Link: ({
    children,
    to,
    params,
    search: _search,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
    params?: Record<string, string>;
    search?: unknown;
  } & Record<string, unknown>) => (
    <a data-href={to} data-params={JSON.stringify(params ?? {})} href={to} {...rest}>
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
      // Differentiate which form this mutation backs by inspecting
      // the path string baked into the mutationFn body. The route
      // bakes a literal path per form, so the substring is enough.
      const fn = opts.mutationFn.toString();
      const which: keyof typeof mocks.mutateImpls | null = fn.includes(
        "/convert-to-rfq",
      )
        ? "rfq"
        : fn.includes("/quotes")
          ? "quote"
          : fn.includes("/award")
            ? "po"
            : fn.includes("/api/procurement/requisitions")
              ? "requisition"
              : fn.includes("/api/procurement/blanket-orders")
                ? "blanket"
                : null;
      if (which === null) {
        throw new Error("Unknown procurement mutation in test mock");
      }
      const impl = mocks.mutateImpls[which];
      impl.mockImplementation((...args: unknown[]) => {
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
        mutate: (...args: unknown[]) => impl(...args),
        isPending: mocks.pendingFlags[which],
      };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../../lib/api/client", () => ({
  getJson: mocks.getJson,
  postJson: mocks.postJson,
  patchJson: mocks.patchJson,
  postVoid: vi.fn().mockResolvedValue(undefined),
}));

/* ────────── import the route under test (mocks are in place by now) ─ */

import {
  Route,
  ProcurementAccessDeniedCard,
  ProcurementHeader,
  ProcurementIdPill,
  ProcurementRequisitionForm,
  ProcurementRfqForm,
  ProcurementQuoteForm,
  ProcurementPoForm,
  ProcurementReceiptForm,
  ProcurementBlanketCoveragePanel,
  ProcurementTabStrip,
  ProcurementWorkspace,
  procurementRouteTabFromHash,
  procurementRouteTabToHash,
  type ProcurementRouteTab,
} from "./index";

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

function renderWorkspaceWithAccess(access: "purchase" | "none") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ProcurementWorkspace userAccess={access} />
    </QueryClientProvider>,
  );
}

const REQUISITION_ID = "req-abc-001";
const REQUISITION_LINE_ID = "prl-abc-001";
const RFQ_ID = "rfq-xyz-002";
const QUOTE_ID = "quote-def-003";
const PO_ID = "po-ghi-004";
const VENDOR_ID = "vendor-yerevan-001";
const BLANKET_ID = "bo-mno-006";
const BLANKET_CATALOG_ITEM_ID = "catitem-blanket-001";

/** Pretend postJson succeeded with the right envelope for a given path. */
function installPostJsonByPath() {
  mocks.postJson.mockImplementation((path: string) => {
    if (path === "/api/procurement/requisitions") {
      return Promise.resolve({
        ok: true as const,
        requisition: {
          id: REQUISITION_ID,
          neededBy: "2026-07-01",
          justification: "",
          status: "open",
          createdAt: "2026-06-22T00:00:00.000Z",
          lines: [
            {
              id: REQUISITION_LINE_ID,
              catalogItemId: BLANKET_CATALOG_ITEM_ID,
              quantity: 5,
              uom: "հատ",
              estUnitPrice: 95000,
              suggestedVendorId: VENDOR_ID,
            },
          ],
        },
      });
    }
    if (path === `/api/procurement/requisitions/${REQUISITION_ID}/convert-to-rfq`) {
      return Promise.resolve({
        ok: true as const,
        rfq: {
          id: RFQ_ID,
          requisitionId: REQUISITION_ID,
          sentAt: "2026-06-22T00:00:00.000Z",
          dueAt: "2026-07-15",
          status: "open",
          shortlistedVendors: [
            {
              vendorId: VENDOR_ID,
              name: "Yerevan Hardware Supply",
              score: 1,
              avgPrice: 90000,
            },
          ],
        },
      });
    }
    if (path === `/api/procurement/rfqs/${RFQ_ID}/quotes`) {
      return Promise.resolve({
        ok: true as const,
        quote: {
          id: QUOTE_ID,
          rfqId: RFQ_ID,
          vendorId: VENDOR_ID,
          requisitionLineId: REQUISITION_LINE_ID,
          unitPrice: 90000,
          currency: "AMD",
          validUntil: "2026-06-30",
          createdAt: "2026-06-22T00:00:00.000Z",
        },
      });
    }
    if (path === `/api/procurement/rfqs/${RFQ_ID}/award`) {
      return Promise.resolve({
        ok: true as const,
        purchaseOrder: {
          id: PO_ID,
          orderNumber: "PO-RFQ-XYZ-002",
          status: "rfq",
          vendorId: VENDOR_ID,
          total: 0,
        },
      });
    }
    if (path === "/api/procurement/blanket-orders") {
      return Promise.resolve({
        ok: true as const,
        blanket: {
          id: BLANKET_ID,
          vendorId: "vendor-yerevan-001",
          catalogItemId: BLANKET_CATALOG_ITEM_ID,
          startDate: "2026-07-01",
          endDate: "2026-12-31",
          committedQty: 100,
          unitPrice: 25000,
          currency: "AMD",
          createdAt: "2026-06-22T00:00:00.000Z",
        },
      });
    }
    return Promise.reject(new Error(`Unexpected postJson path: ${path}`));
  });
}

function makeBlanketCoverageResponse(
  blanketOrders: Array<Record<string, unknown>> = [
    {
      id: BLANKET_ID,
      vendorId: "vendor-yerevan-001",
      vendorName: "Yerevan Hardware Supply",
      catalogItemId: BLANKET_CATALOG_ITEM_ID,
      sku: "POS-SCAN-001",
      name: "POS barcode scanner",
      startDate: "2026-07-01",
      endDate: "2026-12-31",
      committedQty: 100,
      consumedQty: 25,
      remainingQty: 75,
      unitPrice: 25000,
      currency: "AMD",
      createdAt: "2026-06-22T00:00:00.000Z",
    },
  ],
) {
  return {
    ok: true,
    coverage: {
      committedQty: blanketOrders.reduce(
        (sum, order) => sum + Number(order.committedQty ?? 0),
        0,
      ),
      openPoQty: 25,
      remainingQty: 75,
      uncoveredOpenPoQty: 0,
      blanketOrderCount: blanketOrders.length,
      blanketOrders,
    },
  };
}

function fillRequisitionForm(neededBy = "2026-07-01") {
  fireEvent.change(screen.getByTestId("procurement-requisition-neededBy"), {
    target: { value: neededBy },
  });
  fireEvent.change(
    screen.getByTestId("procurement-requisition-catalogItemId"),
    { target: { value: BLANKET_CATALOG_ITEM_ID } },
  );
  fireEvent.change(screen.getByTestId("procurement-requisition-quantity"), {
    target: { value: "5" },
  });
  fireEvent.change(screen.getByTestId("procurement-requisition-estUnitPrice"), {
    target: { value: "95000" },
  });
  fireEvent.change(
    screen.getByTestId("procurement-requisition-suggestedVendorId"),
    { target: { value: VENDOR_ID } },
  );
}

async function createRequisitionFromVisibleForm() {
  fillRequisitionForm();
  fireEvent.click(screen.getByTestId("procurement-requisition-submit"));
  await waitFor(() =>
    expect(
      screen
        .getByTestId("procurement-requisition-id-pill")
        .getAttribute("data-state"),
    ).toBe("ready"),
  );
}

async function convertVisibleRequisitionToRfq() {
  fireEvent.click(screen.getByTestId("procurement-tab-rfq"));
  fireEvent.change(screen.getByTestId("procurement-rfq-dueAt"), {
    target: { value: "2026-07-15" },
  });
  fireEvent.click(screen.getByTestId("procurement-rfq-submit"));
  await waitFor(() =>
    expect(
      screen.getByTestId("procurement-rfq-id-pill").getAttribute("data-state"),
    ).toBe("ready"),
  );
}

async function recordQuoteFromVisibleRfq() {
  fireEvent.click(screen.getByTestId("procurement-tab-quote"));
  fireEvent.change(screen.getByTestId("procurement-quote-vendorId"), {
    target: { value: VENDOR_ID },
  });
  fireEvent.change(screen.getByTestId("procurement-quote-unitPrice"), {
    target: { value: "90000" },
  });
  fireEvent.change(screen.getByTestId("procurement-quote-validUntil"), {
    target: { value: "2026-06-30" },
  });
  fireEvent.click(screen.getByTestId("procurement-quote-submit"));
  await waitFor(() =>
    expect(
      screen.getByTestId("procurement-quote-id-pill").getAttribute("data-state"),
    ).toBe("ready"),
  );
}

async function awardVisibleRfq() {
  fireEvent.click(screen.getByTestId("procurement-tab-po"));
  fireEvent.change(screen.getByTestId("procurement-po-vendorId"), {
    target: { value: VENDOR_ID },
  });
  fireEvent.click(screen.getByTestId("procurement-po-submit"));
  await waitFor(() =>
    expect(
      screen.getByTestId("procurement-po-id-pill").getAttribute("data-state"),
    ).toBe("ready"),
  );
}

beforeEach(() => {
  window.location.hash = "";
  installPostJsonByPath();
  mocks.getJson.mockResolvedValue({
    ok: true,
    summary: {
      suggestionCount: 0,
      suggestedQty: 0,
      salesDemandQty: 0,
      openPurchaseQty: 0,
      stockoutCount: 0,
    },
    suggestions: [],
  });
  Object.values(mocks.mutateImpls).forEach((fn) => fn.mockReset());
  Object.values(mocks.mutateImpls).forEach((fn) =>
    fn.mockImplementation(() => {
      // Default to calling the real mutationFn if a test forgets to
      // override. Most tests override, but this keeps logging clean.
      return Promise.resolve();
    }),
  );
  (Object.keys(mocks.pendingFlags) as Array<
    keyof typeof mocks.pendingFlags
  >).forEach((k) => {
    mocks.pendingFlags[k] = false;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ────────── tests ────────── */

describe("procurement page shell", () => {
  it("renders the panel with an Armenian H2 title", () => {
    renderRoute();
    const panel = screen.getByTestId("procurement-panel");
    expect(panel).toBeInTheDocument();
    const title = screen.getByTestId("procurement-title");
    // Armenian title is required by the procurement spec — the
    // test only asserts that the H2 has Armenian content (the "Գ"
    // character from the procurement vocabulary).
    expect(title.textContent ?? "").toMatch(/Գ/);
  });

  it("renders the English subtitle and the shopping cart header", () => {
    renderRoute();
    const subtitle = screen.getByTestId("procurement-subtitle");
    expect(subtitle.textContent ?? "").toMatch(
      /Procurement requisitions.*RFQs.*quotes.*awards.*blanket coverage.*replenishment/,
    );
    expect(screen.getByTestId("procurement-header")).toBeInTheDocument();
  });

  it("renders a back link to /app/purchase", () => {
    renderRoute();
    const back = screen.getByTestId("procurement-back-link");
    expect(back.getAttribute("data-href")).toBe("/app/purchase");
  });
});

describe("procurement tab strip", () => {
  it("renders all 7 tab buttons in the strip", () => {
    renderRoute();
    const strip = screen.getByTestId("procurement-tab-strip");
    expect(strip).toBeInTheDocument();
    const tabs: ProcurementRouteTab[] = [
      "requisition",
      "rfq",
      "quote",
      "po",
      "receipt",
      "blanket",
      "replenishment",
    ];
    for (const t of tabs) {
      expect(screen.getByTestId(`procurement-tab-${t}`)).toBeInTheDocument();
    }
  });

  it("defaults to the requisition tab and shows its form", () => {
    renderRoute();
    const reqTab = screen.getByTestId("procurement-tab-requisition");
    expect(reqTab.getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("procurement-requisition-form")).toBeInTheDocument();
  });

  it("initializes from the replenishment hash", async () => {
    window.location.hash = "#replenishment";
    renderRoute();
    const replenishmentTab = screen.getByTestId("procurement-tab-replenishment");
    expect(replenishmentTab.getAttribute("data-active")).toBe("true");
    await waitFor(() => {
      expect(screen.getByTestId("procurement-replenishment-empty")).toBeInTheDocument();
    });
  });

  it("initializes from the blanket hash", () => {
    window.location.hash = "#blanket";
    renderRoute();
    const blanketTab = screen.getByTestId("procurement-tab-blanket");
    expect(blanketTab.getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("procurement-blanket-form")).toBeInTheDocument();
    expect(screen.getByTestId("procurement-blanket-coverage-idle")).toBeInTheDocument();
  });

  it("switches tabs when a tab button is clicked", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("procurement-tab-rfq"));
    expect(
      screen.getByTestId("procurement-tab-rfq").getAttribute("data-active"),
    ).toBe("true");
    expect(
      screen.getByTestId("procurement-tab-requisition").getAttribute(
        "data-active",
      ),
    ).toBe("false");
    expect(screen.getByTestId("procurement-rfq-form")).toBeInTheDocument();
    expect(window.location.hash).toBe("#rfq");
  });
});

describe("procurement replenishment queue", () => {
  it("fetches and renders replenishment suggestions from the analytics endpoint", async () => {
    mocks.getJson.mockResolvedValueOnce({
      ok: true,
      summary: {
        suggestionCount: 1,
        suggestedQty: 40,
        salesDemandQty: 40,
        openPurchaseQty: 10,
        stockoutCount: 1,
      },
      suggestions: [
        {
          catalogItemId: "catitem-pos-barcode-scanner",
          sku: "POS-SCAN-001",
          name: "POS barcode scanner",
          onHand: 0,
          openPoQty: 10,
          salesQuoteDemand: 40,
          suggestedQty: 40,
          leadTimeDays: 2,
          recommendedVendorName: "Yerevan Hardware Supply",
          reasoning: ["sales demand 40"],
        },
      ],
    });

    renderRoute();
    fireEvent.click(screen.getByTestId("procurement-tab-replenishment"));

    await waitFor(() => {
      expect(mocks.getJson).toHaveBeenCalledWith("/api/procurement/analytics/replenishment");
      expect(screen.getByTestId("procurement-replenishment-table")).toBeInTheDocument();
    });

    expect(screen.getByText("POS-SCAN-001")).toBeInTheDocument();
    expect(screen.getByText("POS barcode scanner")).toBeInTheDocument();
    expect(screen.getByText("Yerevan Hardware Supply")).toBeInTheDocument();
    expect(screen.getAllByText("40").length).toBeGreaterThan(0);
    const link = screen.getByText("POS-SCAN-001").closest("a");
    expect(link?.getAttribute("data-href")).toBe("/app/inventory/$itemId");
    expect(link?.getAttribute("data-params")).toContain("catitem-pos-barcode-scanner");
  });

  it("renders an empty replenishment state", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("procurement-tab-replenishment"));

    await waitFor(() => {
      expect(screen.getByTestId("procurement-replenishment-empty")).toBeInTheDocument();
    });
  });

  it("renders loading while replenishment suggestions are pending", () => {
    mocks.getJson.mockReturnValueOnce(new Promise(() => undefined));
    renderRoute();
    fireEvent.click(screen.getByTestId("procurement-tab-replenishment"));
    expect(screen.getByTestId("procurement-replenishment-loading")).toBeInTheDocument();
  });

  it("renders an error when replenishment suggestions fail", async () => {
    mocks.getJson.mockRejectedValueOnce(new Error("network down"));
    renderRoute();
    fireEvent.click(screen.getByTestId("procurement-tab-replenishment"));

    await waitFor(() => {
      expect(screen.getByTestId("procurement-replenishment-error")).toBeInTheDocument();
    });
  });

  it("does not fetch replenishment for the 403 branch", () => {
    renderWorkspaceWithAccess("none");
    expect(screen.getByTestId("procurement-403")).toBeInTheDocument();
    expect(mocks.getJson).not.toHaveBeenCalled();
  });
});

describe("procurement blanket coverage", () => {
  it("posts a blanket order and seeds the created id pill", async () => {
    mocks.getJson.mockResolvedValueOnce(makeBlanketCoverageResponse());
    renderRoute();
    fireEvent.click(screen.getByTestId("procurement-tab-blanket"));

    fireEvent.change(screen.getByTestId("procurement-blanket-vendorId"), {
      target: { value: "vendor-yerevan-001" },
    });
    fireEvent.change(screen.getByTestId("procurement-blanket-catalogItemId"), {
      target: { value: BLANKET_CATALOG_ITEM_ID },
    });
    fireEvent.change(screen.getByTestId("procurement-blanket-startDate"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByTestId("procurement-blanket-endDate"), {
      target: { value: "2026-12-31" },
    });
    fireEvent.change(screen.getByTestId("procurement-blanket-committedQty"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByTestId("procurement-blanket-unitPrice"), {
      target: { value: "25000" },
    });
    fireEvent.change(screen.getByTestId("procurement-blanket-currency"), {
      target: { value: "amd" },
    });
    fireEvent.click(screen.getByTestId("procurement-blanket-submit"));

    await waitFor(() => {
      expect(mocks.mutateImpls.blanket).toHaveBeenCalled();
      expect(
        screen.getByTestId("procurement-blanket-id-pill").getAttribute("data-state"),
      ).toBe("ready");
    });

    const call = mocks.postJson.mock.calls.find(
      ([path]: unknown[]) => path === "/api/procurement/blanket-orders",
    );
    expect(call).toBeDefined();
    const [, body] = call as [string, Record<string, unknown>];
    expect(body.vendorId).toBe("vendor-yerevan-001");
    expect(body.catalogItemId).toBe(BLANKET_CATALOG_ITEM_ID);
    expect(body.committedQty).toBe(100);
    expect(body.unitPrice).toBe(25000);
    expect(body.currency).toBe("AMD");
    expect(typeof body.idempotencyKey).toBe("string");
  });

  it("fetches and renders blanket coverage by catalog item id", async () => {
    mocks.getJson.mockResolvedValueOnce(makeBlanketCoverageResponse());
    renderRoute();
    fireEvent.click(screen.getByTestId("procurement-tab-blanket"));
    fireEvent.change(
      screen.getByTestId("procurement-blanket-coverage-catalogItemId"),
      { target: { value: BLANKET_CATALOG_ITEM_ID } },
    );
    fireEvent.click(screen.getByTestId("procurement-blanket-coverage-submit"));

    await waitFor(() => {
      expect(mocks.getJson).toHaveBeenCalledWith(
        `/api/procurement/blanket-orders/coverage?productId=${BLANKET_CATALOG_ITEM_ID}`,
      );
      expect(screen.getByTestId("procurement-blanket-coverage-table")).toBeInTheDocument();
    });

    expect(screen.getByText(BLANKET_ID)).toBeInTheDocument();
    expect(screen.getByText("Yerevan Hardware Supply")).toBeInTheDocument();
    expect(screen.getByText("POS-SCAN-001")).toBeInTheDocument();
    expect(screen.getByText("vendor-yerevan-001")).toBeInTheDocument();
    expect(screen.getByText(/25 consumed/)).toBeInTheDocument();
    expect(screen.getByText("AMD 25,000")).toBeInTheDocument();
  });

  it("renders an empty blanket coverage state", async () => {
    mocks.getJson.mockResolvedValueOnce(makeBlanketCoverageResponse([]));
    renderRoute();
    fireEvent.click(screen.getByTestId("procurement-tab-blanket"));
    fireEvent.change(
      screen.getByTestId("procurement-blanket-coverage-catalogItemId"),
      { target: { value: BLANKET_CATALOG_ITEM_ID } },
    );
    fireEvent.click(screen.getByTestId("procurement-blanket-coverage-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("procurement-blanket-coverage-empty")).toBeInTheDocument();
    });
  });

  it("renders loading while blanket coverage is pending", () => {
    mocks.getJson.mockReturnValueOnce(new Promise(() => undefined));
    renderRoute();
    fireEvent.click(screen.getByTestId("procurement-tab-blanket"));
    fireEvent.change(
      screen.getByTestId("procurement-blanket-coverage-catalogItemId"),
      { target: { value: BLANKET_CATALOG_ITEM_ID } },
    );
    fireEvent.click(screen.getByTestId("procurement-blanket-coverage-submit"));
    expect(screen.getByTestId("procurement-blanket-coverage-loading")).toBeInTheDocument();
  });

  it("renders an error when blanket coverage fails", async () => {
    mocks.getJson.mockRejectedValueOnce(new Error("coverage down"));
    renderRoute();
    fireEvent.click(screen.getByTestId("procurement-tab-blanket"));
    fireEvent.change(
      screen.getByTestId("procurement-blanket-coverage-catalogItemId"),
      { target: { value: BLANKET_CATALOG_ITEM_ID } },
    );
    fireEvent.click(screen.getByTestId("procurement-blanket-coverage-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("procurement-blanket-coverage-error")).toBeInTheDocument();
    });
  });
});

describe("procurement mutations (POST flows)", () => {
  it("requisition form posts to /api/procurement/requisitions with a non-empty line", async () => {
    renderRoute();
    fillRequisitionForm();
    fireEvent.click(screen.getByTestId("procurement-requisition-submit"));
    await waitFor(() => {
      expect(mocks.mutateImpls.requisition).toHaveBeenCalled();
    });
    const call = mocks.postJson.mock.calls.find(
      ([path]: unknown[]) => path === "/api/procurement/requisitions",
    );
    expect(call).toBeDefined();
    const [, body] = call as [string, Record<string, unknown>];
    expect(body.neededBy).toBe("2026-07-01");
    expect(body.lines).toEqual([
      {
        catalogItemId: BLANKET_CATALOG_ITEM_ID,
        quantity: 5,
        uom: "հատ",
        estUnitPrice: 95000,
        suggestedVendorId: VENDOR_ID,
      },
    ]);
    expect(typeof body.idempotencyKey).toBe("string");
    expect((body.idempotencyKey as string).length).toBeGreaterThan(0);
  });

  it("RFQ form posts to the nested convert-to-rfq endpoint", async () => {
    renderWorkspaceWithAccess("purchase");
    await createRequisitionFromVisibleForm();
    await convertVisibleRequisitionToRfq();
    await waitFor(() => {
      expect(mocks.mutateImpls.rfq).toHaveBeenCalled();
    });
    const call = mocks.postJson.mock.calls.find(
      ([path]: unknown[]) =>
        path === `/api/procurement/requisitions/${REQUISITION_ID}/convert-to-rfq`,
    );
    expect(call).toBeDefined();
    const [, body] = call as [string, Record<string, unknown>];
    expect(body.dueAt).toBe("2026-07-15");
  });

  it("quote form posts to the nested RFQ quotes endpoint", async () => {
    renderWorkspaceWithAccess("purchase");
    await createRequisitionFromVisibleForm();
    await convertVisibleRequisitionToRfq();
    await recordQuoteFromVisibleRfq();
    await waitFor(() => expect(mocks.mutateImpls.quote).toHaveBeenCalled());
    const call = mocks.postJson.mock.calls.find(
      ([path]: unknown[]) => path === `/api/procurement/rfqs/${RFQ_ID}/quotes`,
    );
    expect(call).toBeDefined();
    const [, body] = call as [string, Record<string, unknown>];
    expect(body.vendorId).toBe(VENDOR_ID);
    expect(body.requisitionLineId).toBe(REQUISITION_LINE_ID);
    expect(body.unitPrice).toBe(90000);
    expect(body.currency).toBe("AMD");
    expect(body.validUntil).toBe("2026-06-30");
  });

  it("Award form posts to the nested RFQ award endpoint", async () => {
    renderWorkspaceWithAccess("purchase");
    await createRequisitionFromVisibleForm();
    await convertVisibleRequisitionToRfq();
    await recordQuoteFromVisibleRfq();
    await awardVisibleRfq();
    await waitFor(() => expect(mocks.mutateImpls.po).toHaveBeenCalled());
    const call = mocks.postJson.mock.calls.find(
      ([path]: unknown[]) => path === `/api/procurement/rfqs/${RFQ_ID}/award`,
    );
    expect(call).toBeDefined();
    const [, body] = call as [string, Record<string, unknown>];
    expect(body.vendorId).toBe(VENDOR_ID);
  });

  it("receipt tab is deferred and does not post a tender receipt", async () => {
    renderWorkspaceWithAccess("purchase");
    await createRequisitionFromVisibleForm();
    await convertVisibleRequisitionToRfq();
    await recordQuoteFromVisibleRfq();
    await awardVisibleRfq();
    fireEvent.click(screen.getByTestId("procurement-tab-receipt"));
    expect(screen.getByTestId("procurement-receipt-deferred")).toHaveTextContent(
      /existing purchase order receiving screen/,
    );
    expect(
      mocks.postJson.mock.calls.some(
        ([path]: unknown[]) => path === "/api/procurement/receipts",
      ),
    ).toBe(false);
  });
});

describe("disabled-until-prior-id guards", () => {
  it("RFQ form is disabled until a requisition id exists", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("procurement-tab-rfq"));
    const fieldset = screen
      .getByTestId("procurement-rfq-form")
      .querySelector("fieldset");
    expect(fieldset?.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByTestId("procurement-rfq-disabled"),
    ).toBeInTheDocument();
  });

  it("quote form is disabled until an RFQ id exists", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("procurement-tab-quote"));
    const fieldset = screen
      .getByTestId("procurement-quote-form")
      .querySelector("fieldset");
    expect(fieldset?.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByTestId("procurement-quote-disabled"),
    ).toBeInTheDocument();
  });

  it("Award form is disabled until a quote id exists", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("procurement-tab-po"));
    const fieldset = screen
      .getByTestId("procurement-po-form")
      .querySelector("fieldset");
    expect(fieldset?.hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("procurement-po-disabled")).toBeInTheDocument();
  });

  it("receipt tab explains receiving is deferred", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("procurement-tab-receipt"));
    expect(
      screen.getByTestId("procurement-receipt-deferred"),
    ).toBeInTheDocument();
  });
});

describe("cross-tab id flow", () => {
  it("chains requisitionId → rfqId → quoteId → draftPoId", async () => {
    renderWorkspaceWithAccess("purchase");

    // Step 1: requisition
    await createRequisitionFromVisibleForm();
    expect(
      screen.getByTestId("procurement-requisition-id-pill").textContent,
    ).toContain(REQUISITION_ID);

    // Step 2: rfq
    await convertVisibleRequisitionToRfq();
    expect(
      screen.getByTestId("procurement-rfq-id-pill").textContent,
    ).toContain(RFQ_ID);

    // Step 3: quote
    await recordQuoteFromVisibleRfq();
    expect(
      screen.getByTestId("procurement-quote-id-pill").textContent,
    ).toContain(QUOTE_ID);

    // Step 4: award creates the draft PO id
    await awardVisibleRfq();
    expect(
      screen.getByTestId("procurement-po-id-pill").textContent,
    ).toContain(PO_ID);

    // Step 5: receiving is intentionally deferred in this tender slice.
    fireEvent.click(screen.getByTestId("procurement-tab-receipt"));
    expect(
      screen.getByTestId("procurement-receipt-deferred"),
    ).toBeInTheDocument();
  });
});

describe("route-local hash helpers", () => {
  it("procurementRouteTabFromHash('#quote') returns 'quote'", () => {
    expect(procurementRouteTabFromHash("#quote")).toBe("quote");
  });
  it("procurementRouteTabFromHash('#blanket') returns 'blanket'", () => {
    expect(procurementRouteTabFromHash("#blanket")).toBe("blanket");
  });
  it("procurementRouteTabFromHash('') returns 'requisition' (default)", () => {
    expect(procurementRouteTabFromHash("")).toBe("requisition");
  });
  it("procurementRouteTabFromHash(null) returns 'requisition' (default)", () => {
    expect(procurementRouteTabFromHash(null)).toBe("requisition");
  });
  it("procurementRouteTabFromHash(undefined) returns 'requisition' (default)", () => {
    expect(procurementRouteTabFromHash(undefined)).toBe("requisition");
  });
  it("procurementRouteTabFromHash('#bogus') returns 'requisition' (default)", () => {
    expect(procurementRouteTabFromHash("#bogus")).toBe("requisition");
  });
  it("procurementRouteTabToHash('po') returns '#po'", () => {
    expect(procurementRouteTabToHash("po")).toBe("#po");
  });
  it("procurementRouteTabToHash('blanket') returns '#blanket'", () => {
    expect(procurementRouteTabToHash("blanket")).toBe("#blanket");
  });
});

describe("403 access gate", () => {
  it("renders the access-denied card when userAccess='none'", () => {
    renderWorkspaceWithAccess("none");
    expect(screen.getByTestId("procurement-403")).toBeInTheDocument();
    expect(screen.queryByTestId("procurement-tab-strip")).toBeNull();
  });
  it("renders the access-denied card has a back link to /app/purchase", () => {
    renderWorkspaceWithAccess("none");
    const back = screen.getByTestId("procurement-403-back");
    expect(back.getAttribute("data-href")).toBe("/app/purchase");
  });
});

describe("named subcomponents export", () => {
  it("exports ProcurementAccessDeniedCard as a named export", () => {
    expect(typeof ProcurementAccessDeniedCard).toBe("function");
  });
  it("exports ProcurementHeader as a named export", () => {
    expect(typeof ProcurementHeader).toBe("function");
  });
  it("exports ProcurementIdPill as a named export", () => {
    expect(typeof ProcurementIdPill).toBe("function");
  });
  it("exports ProcurementTabStrip as a named export", () => {
    expect(typeof ProcurementTabStrip).toBe("function");
  });
  it("exports the form components as named exports", () => {
    expect(typeof ProcurementRequisitionForm).toBe("function");
    expect(typeof ProcurementRfqForm).toBe("function");
    expect(typeof ProcurementQuoteForm).toBe("function");
    expect(typeof ProcurementPoForm).toBe("function");
    expect(typeof ProcurementReceiptForm).toBe("function");
    expect(typeof ProcurementBlanketCoveragePanel).toBe("function");
  });
});
