/**
 * /app/purchase/procurement — Pattern A route test
 *
 * Mirrors the cabinet test pattern. Mocks the three layers
 * (Router, Query, API client), then exercises the public
 * surface: 5 tabs, 5 POST flows, the 403 access gate, the
 * back link, and the route-local hash helpers.
 *
 * Coverage (Phase 8.4 layer 2):
 *  1.  Page shell — H2 contains Armenian title
 *  2.  Five tab buttons render in the strip
 *  3.  Default tab is Requisition
 *  4.  Tab switching reveals the matching form
 *  5.  Requisition form posts to /api/procurement/requisitions
 *  6.  RFQ form posts to /api/procurement/rfqs (when enabled)
 *  7.  Quote form posts to /api/procurement/quotes (when enabled)
 *  8.  PO form posts to /api/procurement/purchase-orders (when enabled)
 *  9.  Receipt form posts to /api/procurement/receipts (when enabled)
 * 10.  RFQ form is disabled until a requisition id exists
 * 11.  Quote form is disabled until an RFQ id exists
 * 12.  PO form is disabled until a quote id exists
 * 13.  Receipt form is disabled until a PO id exists
 * 14.  Cross-tab flow: requisitionId → rfqId → quoteId → poId → receiptId
 * 15.  procurementRouteTabFromHash('#quote') returns 'quote'; nullish safe
 * 16.  403 branch: userAccess='none' renders the access-denied card
 * 17.  Back link points to /app/purchase
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
  },
  // isPending flags, one per mutation.
  pendingFlags: {
    requisition: false,
    rfq: false,
    quote: false,
    po: false,
    receipt: false,
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
    search: _search,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
    search?: unknown;
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
      // Differentiate which form this mutation backs by inspecting
      // the path string baked into the mutationFn body. The route
      // bakes a literal path per form, so the substring is enough.
      const fn = opts.mutationFn.toString();
      const which: keyof typeof mocks.mutateImpls | null = fn.includes(
        "/api/procurement/requisitions",
      )
        ? "requisition"
        : fn.includes("/api/procurement/rfqs")
          ? "rfq"
          : fn.includes("/api/procurement/quotes")
            ? "quote"
            : fn.includes("/api/procurement/purchase-orders")
              ? "po"
              : fn.includes("/api/procurement/receipts")
                ? "receipt"
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
const RFQ_ID = "rfq-xyz-002";
const QUOTE_ID = "quote-def-003";
const PO_ID = "po-ghi-004";
const RECEIPT_ID = "receipt-jkl-005";

/** Pretend postJson succeeded with the right envelope for a given path. */
function installPostJsonByPath() {
  mocks.postJson.mockImplementation((path: string) => {
    if (path === "/api/procurement/requisitions") {
      return Promise.resolve({
        ok: true as const,
        requisition: { id: REQUISITION_ID },
      });
    }
    if (path === "/api/procurement/rfqs") {
      return Promise.resolve({
        ok: true as const,
        rfq: { id: RFQ_ID },
      });
    }
    if (path === "/api/procurement/quotes") {
      return Promise.resolve({
        ok: true as const,
        quote: { id: QUOTE_ID },
      });
    }
    if (path === "/api/procurement/purchase-orders") {
      return Promise.resolve({
        ok: true as const,
        purchaseOrder: { id: PO_ID },
      });
    }
    if (path === "/api/procurement/receipts") {
      return Promise.resolve({
        ok: true as const,
        receipt: { id: RECEIPT_ID },
      });
    }
    return Promise.reject(new Error(`Unexpected postJson path: ${path}`));
  });
}

beforeEach(() => {
  installPostJsonByPath();
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
      /Procurement requisitions.*RFQs.*quotes.*POs.*receipts/,
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
  it("renders all 5 tab buttons in the strip", () => {
    renderRoute();
    const strip = screen.getByTestId("procurement-tab-strip");
    expect(strip).toBeInTheDocument();
    const tabs: ProcurementRouteTab[] = [
      "requisition",
      "rfq",
      "quote",
      "po",
      "receipt",
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
  });
});

describe("procurement mutations (POST flows)", () => {
  it("requisition form posts to /api/procurement/requisitions with idempotency key", async () => {
    renderRoute();
    fireEvent.change(
      screen.getByTestId("procurement-requisition-neededBy"),
      { target: { value: "2026-07-01" } },
    );
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
    expect(typeof body.idempotencyKey).toBe("string");
    expect((body.idempotencyKey as string).length).toBeGreaterThan(0);
  });

  it("RFQ form posts to /api/procurement/rfqs when requisition id is set", async () => {
    renderWorkspaceWithAccess("purchase");
    // Seed the requisition id by going through the form
    fireEvent.change(
      screen.getByTestId("procurement-requisition-neededBy"),
      { target: { value: "2026-07-01" } },
    );
    fireEvent.click(screen.getByTestId("procurement-requisition-submit"));
    await waitFor(() => {
      expect(
        screen
          .getByTestId("procurement-requisition-id-pill")
          .getAttribute("data-state"),
      ).toBe("ready");
    });
    // Now switch to RFQ tab
    fireEvent.click(screen.getByTestId("procurement-tab-rfq"));
    fireEvent.change(
      screen.getByTestId("procurement-rfq-neededBy"),
      { target: { value: "2026-07-15" } },
    );
    fireEvent.click(screen.getByTestId("procurement-rfq-submit"));
    await waitFor(() => {
      expect(mocks.mutateImpls.rfq).toHaveBeenCalled();
    });
    const call = mocks.postJson.mock.calls.find(
      ([path]: unknown[]) => path === "/api/procurement/rfqs",
    );
    expect(call).toBeDefined();
  });

  it("quote form posts to /api/procurement/quotes when RFQ id is set", async () => {
    renderWorkspaceWithAccess("purchase");
    fireEvent.change(
      screen.getByTestId("procurement-requisition-neededBy"),
      { target: { value: "2026-07-01" } },
    );
    fireEvent.click(screen.getByTestId("procurement-requisition-submit"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("procurement-requisition-id-pill")
          .getAttribute("data-state"),
      ).toBe("ready"),
    );
    fireEvent.click(screen.getByTestId("procurement-tab-rfq"));
    fireEvent.change(
      screen.getByTestId("procurement-rfq-neededBy"),
      { target: { value: "2026-07-15" } },
    );
    fireEvent.click(screen.getByTestId("procurement-rfq-submit"));
    await waitFor(() =>
      expect(
        screen.getByTestId("procurement-rfq-id-pill").getAttribute("data-state"),
      ).toBe("ready"),
    );
    fireEvent.click(screen.getByTestId("procurement-tab-quote"));
    fireEvent.change(screen.getByTestId("procurement-quote-rfqId"), {
      target: { value: RFQ_ID },
    });
    fireEvent.change(screen.getByTestId("procurement-quote-amount"), {
      target: { value: "100000" },
    });
    fireEvent.click(screen.getByTestId("procurement-quote-submit"));
    await waitFor(() => expect(mocks.mutateImpls.quote).toHaveBeenCalled());
    const call = mocks.postJson.mock.calls.find(
      ([path]: unknown[]) => path === "/api/procurement/quotes",
    );
    expect(call).toBeDefined();
  });

  it("PO form posts to /api/procurement/purchase-orders when quote id is set", async () => {
    renderWorkspaceWithAccess("purchase");
    // Drive the chain to quote: requisition → rfq → quote
    fireEvent.change(
      screen.getByTestId("procurement-requisition-neededBy"),
      { target: { value: "2026-07-01" } },
    );
    fireEvent.click(screen.getByTestId("procurement-requisition-submit"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("procurement-requisition-id-pill")
          .getAttribute("data-state"),
      ).toBe("ready"),
    );
    fireEvent.click(screen.getByTestId("procurement-tab-rfq"));
    fireEvent.change(
      screen.getByTestId("procurement-rfq-neededBy"),
      { target: { value: "2026-07-15" } },
    );
    fireEvent.click(screen.getByTestId("procurement-rfq-submit"));
    await waitFor(() =>
      expect(
        screen.getByTestId("procurement-rfq-id-pill").getAttribute("data-state"),
      ).toBe("ready"),
    );
    fireEvent.click(screen.getByTestId("procurement-tab-quote"));
    fireEvent.change(screen.getByTestId("procurement-quote-rfqId"), {
      target: { value: RFQ_ID },
    });
    fireEvent.change(screen.getByTestId("procurement-quote-amount"), {
      target: { value: "100000" },
    });
    fireEvent.click(screen.getByTestId("procurement-quote-submit"));
    await waitFor(() =>
      expect(
        screen.getByTestId("procurement-quote-id-pill").getAttribute("data-state"),
      ).toBe("ready"),
    );
    fireEvent.click(screen.getByTestId("procurement-tab-po"));
    fireEvent.change(screen.getByTestId("procurement-po-quoteId"), {
      target: { value: QUOTE_ID },
    });
    fireEvent.click(screen.getByTestId("procurement-po-submit"));
    await waitFor(() => expect(mocks.mutateImpls.po).toHaveBeenCalled());
    const call = mocks.postJson.mock.calls.find(
      ([path]: unknown[]) => path === "/api/procurement/purchase-orders",
    );
    expect(call).toBeDefined();
  });

  it("receipt form posts to /api/procurement/receipts when PO id is set", async () => {
    renderWorkspaceWithAccess("purchase");
    // Drive the chain to PO: requisition → rfq → quote → po
    fireEvent.change(
      screen.getByTestId("procurement-requisition-neededBy"),
      { target: { value: "2026-07-01" } },
    );
    fireEvent.click(screen.getByTestId("procurement-requisition-submit"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("procurement-requisition-id-pill")
          .getAttribute("data-state"),
      ).toBe("ready"),
    );
    fireEvent.click(screen.getByTestId("procurement-tab-rfq"));
    fireEvent.change(
      screen.getByTestId("procurement-rfq-neededBy"),
      { target: { value: "2026-07-15" } },
    );
    fireEvent.click(screen.getByTestId("procurement-rfq-submit"));
    await waitFor(() =>
      expect(
        screen.getByTestId("procurement-rfq-id-pill").getAttribute("data-state"),
      ).toBe("ready"),
    );
    fireEvent.click(screen.getByTestId("procurement-tab-quote"));
    fireEvent.change(screen.getByTestId("procurement-quote-rfqId"), {
      target: { value: RFQ_ID },
    });
    fireEvent.change(screen.getByTestId("procurement-quote-amount"), {
      target: { value: "100000" },
    });
    fireEvent.click(screen.getByTestId("procurement-quote-submit"));
    await waitFor(() =>
      expect(
        screen.getByTestId("procurement-quote-id-pill").getAttribute("data-state"),
      ).toBe("ready"),
    );
    fireEvent.click(screen.getByTestId("procurement-tab-po"));
    fireEvent.change(screen.getByTestId("procurement-po-quoteId"), {
      target: { value: QUOTE_ID },
    });
    fireEvent.click(screen.getByTestId("procurement-po-submit"));
    await waitFor(() =>
      expect(
        screen.getByTestId("procurement-po-id-pill").getAttribute("data-state"),
      ).toBe("ready"),
    );
    fireEvent.click(screen.getByTestId("procurement-tab-receipt"));
    fireEvent.change(screen.getByTestId("procurement-receipt-poId"), {
      target: { value: PO_ID },
    });
    fireEvent.click(screen.getByTestId("procurement-receipt-submit"));
    await waitFor(() => expect(mocks.mutateImpls.receipt).toHaveBeenCalled());
    const call = mocks.postJson.mock.calls.find(
      ([path]: unknown[]) => path === "/api/procurement/receipts",
    );
    expect(call).toBeDefined();
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

  it("PO form is disabled until a quote id exists", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("procurement-tab-po"));
    const fieldset = screen
      .getByTestId("procurement-po-form")
      .querySelector("fieldset");
    expect(fieldset?.hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("procurement-po-disabled")).toBeInTheDocument();
  });

  it("receipt form is disabled until a PO id exists", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("procurement-tab-receipt"));
    const fieldset = screen
      .getByTestId("procurement-receipt-form")
      .querySelector("fieldset");
    expect(fieldset?.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByTestId("procurement-receipt-disabled"),
    ).toBeInTheDocument();
  });
});

describe("cross-tab id flow", () => {
  it("chains requisitionId → rfqId → quoteId → poId → receiptId", async () => {
    renderWorkspaceWithAccess("purchase");

    // Step 1: requisition
    fireEvent.change(
      screen.getByTestId("procurement-requisition-neededBy"),
      { target: { value: "2026-07-01" } },
    );
    fireEvent.click(screen.getByTestId("procurement-requisition-submit"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("procurement-requisition-id-pill")
          .getAttribute("data-state"),
      ).toBe("ready"),
    );
    expect(
      screen.getByTestId("procurement-requisition-id-pill").textContent,
    ).toContain(REQUISITION_ID);

    // Step 2: rfq
    fireEvent.click(screen.getByTestId("procurement-tab-rfq"));
    fireEvent.change(
      screen.getByTestId("procurement-rfq-neededBy"),
      { target: { value: "2026-07-15" } },
    );
    fireEvent.click(screen.getByTestId("procurement-rfq-submit"));
    await waitFor(() =>
      expect(
        screen.getByTestId("procurement-rfq-id-pill").getAttribute("data-state"),
      ).toBe("ready"),
    );
    expect(
      screen.getByTestId("procurement-rfq-id-pill").textContent,
    ).toContain(RFQ_ID);

    // Step 3: quote
    fireEvent.click(screen.getByTestId("procurement-tab-quote"));
    fireEvent.change(screen.getByTestId("procurement-quote-rfqId"), {
      target: { value: RFQ_ID },
    });
    fireEvent.change(screen.getByTestId("procurement-quote-amount"), {
      target: { value: "100000" },
    });
    fireEvent.click(screen.getByTestId("procurement-quote-submit"));
    await waitFor(() =>
      expect(
        screen.getByTestId("procurement-quote-id-pill").getAttribute("data-state"),
      ).toBe("ready"),
    );
    expect(
      screen.getByTestId("procurement-quote-id-pill").textContent,
    ).toContain(QUOTE_ID);

    // Step 4: po
    fireEvent.click(screen.getByTestId("procurement-tab-po"));
    fireEvent.change(screen.getByTestId("procurement-po-quoteId"), {
      target: { value: QUOTE_ID },
    });
    fireEvent.click(screen.getByTestId("procurement-po-submit"));
    await waitFor(() =>
      expect(
        screen.getByTestId("procurement-po-id-pill").getAttribute("data-state"),
      ).toBe("ready"),
    );
    expect(
      screen.getByTestId("procurement-po-id-pill").textContent,
    ).toContain(PO_ID);

    // Step 5: receipt
    fireEvent.click(screen.getByTestId("procurement-tab-receipt"));
    fireEvent.change(screen.getByTestId("procurement-receipt-poId"), {
      target: { value: PO_ID },
    });
    fireEvent.click(screen.getByTestId("procurement-receipt-submit"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("procurement-receipt-id-pill")
          .getAttribute("data-state"),
      ).toBe("ready"),
    );
    expect(
      screen.getByTestId("procurement-receipt-id-pill").textContent,
    ).toContain(RECEIPT_ID);
  });
});

describe("route-local hash helpers", () => {
  it("procurementRouteTabFromHash('#quote') returns 'quote'", () => {
    expect(procurementRouteTabFromHash("#quote")).toBe("quote");
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
  it("exports the 5 form components as named exports", () => {
    expect(typeof ProcurementRequisitionForm).toBe("function");
    expect(typeof ProcurementRfqForm).toBe("function");
    expect(typeof ProcurementQuoteForm).toBe("function");
    expect(typeof ProcurementPoForm).toBe("function");
    expect(typeof ProcurementReceiptForm).toBe("function");
  });
});
