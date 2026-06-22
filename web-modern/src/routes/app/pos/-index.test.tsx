/**
 * /app/pos — route-level tests for the POS cash-session spine.
 *
 * Covers POS frontend behavior:
 *   - loading and error states for /api/pos/workspace
 *   - opening a cash session via POST /api/pos/cash-sessions
 *   - posting a one-line sale via POST /api/pos/cash-sessions/:id/sales
 *   - posting split-payment sale evidence through the sale capture surface
 *   - recording full-sale refund evidence via POST /api/pos/sales/:id/refund
 *   - closing the current cash session via POST /api/pos/cash-sessions/:id/close
 *   - posting closed-session terminal settlement evidence
 *   - app-tier 403 via UserAccessProvider
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

const mocks = vi.hoisted(() => ({
  workspace: undefined as unknown,
  loading: false,
  error: null as Error | null,
  postJson: vi.fn(),
  mutateImpls: [] as Array<ReturnType<typeof vi.fn>>,
  pendingFlags: [] as boolean[],
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
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
    useQuery: () => ({
      data: mocks.workspace,
      isLoading: mocks.loading,
      error: mocks.error,
    }),
    useMutation: (opts: {
      mutationFn: (...args: unknown[]) => Promise<unknown>;
      onSuccess?: (...args: unknown[]) => void;
      onError?: (...args: unknown[]) => void;
    }) => {
      const fn = opts.mutationFn.toString();
      const slot = fn.includes("terminal-settlements")
        ? 5
        : fn.includes("/void")
        ? 6
        : fn.includes("/refund")
        ? 4
        : fn.includes("receipt-packet")
        ? 3
        : fn.includes("/sales")
        ? 2
        : fn.includes("/:id/close") || fn.includes("${input.sessionId}/close")
          ? 1
          : 0;

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

      return {
        mutate: (...args: unknown[]) => mocks.mutateImpls[slot](...args),
        isPending: !!mocks.pendingFlags[slot],
        error: null,
      };
    },
    useQueryClient: () => ({
      invalidateQueries: mocks.invalidateQueries,
      setQueryData: mocks.setQueryData,
    }),
  };
});

vi.mock("../../../lib/api/client", () => ({
  getJson: vi.fn(),
  postJson: mocks.postJson,
}));

import { Route, PosAccessDeniedCard } from "./index";
import { UserAccessProvider } from "../../../lib/rbac/access.tsx";

const OPEN_SESSION = {
  id: "pos-session-1",
  status: "open",
  cashierUserId: "user-1",
  cashierName: "Ani Petrosyan",
  stockLocationId: "loc-pos-1",
  stockLocationName: "Retail counter",
  openingCash: 50000,
  expectedCash: 50000,
  countedCash: null,
  cashDifference: null,
  currency: "AMD",
  openedAt: "2026-06-22T08:00:00.000Z",
  closedAt: null,
  fiscalDeviceId: null,
  zReportNumber: null,
  receiptRangeStart: null,
  receiptRangeEnd: null,
  closeNote: null,
  createdAt: "2026-06-22T08:00:00.000Z",
  updatedAt: "2026-06-22T08:00:00.000Z",
};

const CLOSED_SESSION = {
  ...OPEN_SESSION,
  id: "pos-session-0",
  status: "closed",
  expectedCash: 72000,
  countedCash: 72000,
  cashDifference: 0,
  closedAt: "2026-06-21T18:00:00.000Z",
  fiscalDeviceId: "FISCAL-01",
  zReportNumber: "ZR-2026-0001",
  receiptRangeStart: "10001",
  receiptRangeEnd: "10075",
  closeNote: "Matched count.",
  updatedAt: "2026-06-21T18:00:00.000Z",
};

const WORKSPACE_NO_OPEN = {
  openSession: null,
  sessions: [CLOSED_SESSION],
  catalogItems: [
    {
      id: "catitem-pos-scanner",
      categoryId: "catcat-hardware",
      categoryName: "POS hardware",
      sku: "POS-SCANNER",
      name: "POS barcode scanner",
      itemType: "stockable",
      status: "active",
      unitOfMeasure: "pc",
      listPrice: 25000,
      standardCost: 16000,
      fiscalReceiptRequired: true,
    },
  ],
  stockLocations: [
    {
      id: "loc-pos-1",
      code: "STORE/POS",
      name: "Retail counter",
      locationType: "retail",
      status: "active",
    },
  ],
  fiscalCloseoutLabels: {
    fiscalDeviceId: "Fiscal device",
    zReportNumber: "Z-report number",
    receiptRange: "Receipt range",
  },
};

const VALID_SALE_RESPONSE = {
  ok: true,
  sale: {
    id: "pos-sale-1",
    cashSessionId: "pos-session-1",
    receiptNumber: "R-2026-0002",
    status: "posted",
    paymentMethod: "card",
    currency: "AMD",
    subtotal: 50000,
    vat: 0,
    total: 50000,
    lineCount: 1,
    soldAt: "2026-06-22T09:30:00.000Z",
    cashierUserId: "user-1",
    stockLocationId: "loc-pos-1",
    postings: {
      salePosting: "posted",
      inventoryPosting: "posted",
      ledgerPosting: "posted",
      ledgerPostingIds: ["ledger-pos-sale-net", "ledger-pos-sale-vat"],
      ledgerPostingCount: 2,
    },
    lines: [
      {
        id: "pos-sale-line-1",
        catalogItemId: "catitem-pos-scanner",
        catalogItemVariantId: null,
        sku: "POS-SCANNER",
        name: "POS barcode scanner",
        quantity: 2,
        unitPrice: 25000,
        subtotal: 50000,
        vat: 0,
        total: 50000,
        vatMode: "exempt",
        fiscalReceiptRequired: true,
        stockMoveId: "stock-move-1",
      },
    ],
    createdAt: "2026-06-22T09:30:01.000Z",
  },
  session: {
    ...OPEN_SESSION,
    expectedCash: 100000,
  },
};

const SPLIT_PAYMENT_SALE_RESPONSE = {
  ...VALID_SALE_RESPONSE,
  sale: {
    ...VALID_SALE_RESPONSE.sale,
    id: "pos-sale-split-1",
    receiptNumber: "R-2026-0003",
    paymentMethod: "cash",
    payments: [
      { paymentMethod: "cash", amount: 20000 },
      { paymentMethod: "card", amount: 25000 },
      { paymentMethod: "bank-transfer", amount: 5000 },
    ],
    paymentCount: 3,
    paidCash: 20000,
    paidCard: 25000,
    paidBankTransfer: 5000,
  },
  session: {
    ...OPEN_SESSION,
    expectedCash: 70000,
  },
};

const VALID_RECEIPT_PACKET_RESPONSE = {
  ok: true,
  receiptPacket: {
    id: "pos-receipt-packet-1",
    saleId: "pos-sale-1",
    cashSessionId: "pos-session-1",
    receiptNumber: "R-2026-0002",
    fiscalDeviceId: "FISCAL-OPEN-01",
    status: "prepared",
    checksum: "fiscal-packet-checksum-123",
    createdAt: "2026-06-22T09:31:00.000Z",
  },
  sale: VALID_SALE_RESPONSE.sale,
};

const VALID_REFUND_RESPONSE = {
  ok: true,
  idempotent: false,
  refund: {
    id: "pos-sale-refund-1",
    saleId: "pos-sale-1",
    cashSessionId: "pos-session-1",
    refundReference: "RF-CASH-001",
    sourceKey: "pos-refund-ui-pos-sale-1-1782113400000",
    reason: "Customer returned sealed scanner.",
    refundMethod: "cash",
    refundedTotal: 50000,
    cashAdjustment: 50000,
    status: "posted",
    inventoryPostingStatus: "posted",
    ledgerPostingStatus: "posted",
    postings: {
      refundPosting: "posted",
      inventoryPosting: "posted",
      ledgerPosting: "posted",
      ledgerPostingIds: ["ledger-pos-refund-net", "ledger-pos-refund-vat"],
      ledgerPostingCount: 2,
    },
    refundedAt: "2026-06-22T10:00:00.000Z",
    lineCount: 1,
    lines: [
      {
        id: "pos-sale-refund-line-1",
        saleLineId: "pos-sale-line-1",
        catalogItemId: "catitem-pos-scanner",
        catalogItemVariantId: null,
        sku: "POS-SCANNER",
        name: "POS barcode scanner",
        description: "",
        quantity: 2,
        unitPrice: 25000,
        subtotal: 50000,
        vat: 0,
        total: 50000,
        vatMode: "exempt",
        fiscalReceiptRequired: true,
        sourceStockMoveId: "stock-move-1",
        returnStockMoveId: "stock-move-return-1",
        createdAt: "2026-06-22T10:00:01.000Z",
      },
    ],
    createdByUserId: "user-1",
    createdByName: "Ani Petrosyan",
    createdAt: "2026-06-22T10:00:01.000Z",
  },
  sale: {
    ...VALID_SALE_RESPONSE.sale,
    status: "refunded_full",
  },
  session: {
    ...OPEN_SESSION,
    expectedCash: 50000,
  },
};

const VALID_PARTIAL_REFUND_RESPONSE = {
  ...VALID_REFUND_RESPONSE,
  refund: {
    ...VALID_REFUND_RESPONSE.refund,
    id: "pos-sale-refund-partial-1",
    refundReference: "RF-PARTIAL-001",
    sourceKey: "pos-refund-ui-pos-sale-1-1782113400000",
    reason: "Partial goodwill refund.",
    refundedTotal: 20000,
    cashAdjustment: 20000,
    inventoryPostingStatus: "not-posted",
    postings: {
      ...VALID_REFUND_RESPONSE.refund.postings,
      inventoryPosting: "not-posted",
    },
    lines: [
      {
        ...VALID_REFUND_RESPONSE.refund.lines[0],
        id: "pos-sale-refund-line-partial-1",
        subtotal: 20000,
        total: 20000,
        returnStockMoveId: null,
      },
    ],
  },
  sale: {
    ...VALID_SALE_RESPONSE.sale,
    status: "refunded",
  },
  session: {
    ...OPEN_SESSION,
    expectedCash: 80000,
  },
};

const VALID_VOID_RESPONSE = {
  ok: true,
  idempotent: false,
  void: {
    id: "pos-sale-void-1",
    saleId: "pos-sale-1",
    cashSessionId: "pos-session-1",
    voidReference: "VOID-CASH-001",
    sourceKey: "pos-void-ui-pos-sale-1-1782113400000",
    reason: "Cashier caught the receipt before fiscal handoff.",
    voidedTotal: 50000,
    cashAdjustment: 50000,
    status: "posted",
    inventoryPostingStatus: "posted",
    ledgerPostingStatus: "posted",
    postings: {
      voidPosting: "posted",
      inventoryPosting: "posted",
      ledgerPosting: "posted",
      ledgerPostingIds: ["ledger-pos-void-net", "ledger-pos-void-vat"],
      ledgerPostingCount: 2,
    },
    voidedAt: "2026-06-22T10:15:00.000Z",
    lineCount: 1,
    lines: [
      {
        id: "pos-sale-void-line-1",
        saleLineId: "pos-sale-line-1",
        catalogItemId: "catitem-pos-scanner",
        catalogItemVariantId: null,
        sku: "POS-SCANNER",
        name: "POS barcode scanner",
        description: "",
        quantity: 2,
        unitPrice: 25000,
        subtotal: 50000,
        vat: 0,
        total: 50000,
        vatMode: "exempt",
        fiscalReceiptRequired: true,
        sourceStockMoveId: "stock-move-1",
        returnStockMoveId: "stock-move-void-return-1",
        createdAt: "2026-06-22T10:15:01.000Z",
      },
    ],
    createdByUserId: "user-1",
    createdByName: "Ani Petrosyan",
    createdAt: "2026-06-22T10:15:01.000Z",
  },
  sale: {
    ...VALID_SALE_RESPONSE.sale,
    status: "voided",
  },
  session: {
    ...OPEN_SESSION,
    expectedCash: 50000,
  },
};

const VALID_TERMINAL_SETTLEMENT_PREVIEW = {
  cashSessionId: CLOSED_SESSION.id,
  sessionStatus: "closed",
  paymentMethod: "card",
  clearingAccountCode: "255",
  bankAccountCode: "252",
  cardSalesTotal: 60000,
  cardSalesCount: 1,
  cardRefundsTotal: 0,
  cardRefundsCount: 0,
  settledTotal: 0,
  processorFeeTotal: 0,
  processorFeeAccountCode: "711",
  clearedTotal: 0,
  settlementCount: 0,
  netCardClearing: 60000,
  outstandingAmount: 60000,
  ready: true,
  recentSettlements: [],
};

const VALID_TERMINAL_SETTLEMENT_RESPONSE = {
  ok: true,
  idempotent: false,
  settlement: {
    id: "pos-terminal-settlement-1",
    cashSessionId: CLOSED_SESSION.id,
    settlementReference: "TERM-BATCH-001",
    sourceKey: "pos-terminal-settlement-test-1",
    provider: "Acba POS",
    paymentMethod: "card",
    expectedTotal: 60000,
    settledTotal: 55000,
    processorFee: 5000,
    processorFeeAccountCode: "711",
    clearedTotal: 60000,
    outstandingAfterSettledAndFee: 0,
    difference: 0,
    clearingAccountCode: "255",
    bankAccountCode: "252",
    status: "posted",
    ledgerPostingStatus: "posted",
    postings: {
      settlementPosting: "posted",
      ledgerPosting: "posted",
      ledgerPostingIds: ["ledger-pos-terminal-settlement-1", "ledger-pos-terminal-settlement-fee-1"],
      ledgerPostingCount: 2,
      totalLedgerPostingCount: 2,
      processorFeeLedgerPosting: "posted",
      processorFeeLedgerPostingCount: 1,
    },
    settledAt: "2026-06-22T19:00:00.000Z",
    note: "Settlement posted from Acba batch.",
    createdByUserId: "user-1",
    createdByName: "Ani Petrosyan",
    createdAt: "2026-06-22T19:00:01.000Z",
  },
  preview: {
    ...VALID_TERMINAL_SETTLEMENT_PREVIEW,
    settledTotal: 55000,
    processorFeeTotal: 5000,
    clearedTotal: 60000,
    settlementCount: 1,
    outstandingAmount: 0,
    ready: false,
    recentSettlements: [],
  },
  session: CLOSED_SESSION,
};

function renderRoute(opts?: { noPosAccess?: boolean }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Component = Route.options.component as React.ComponentType;
  const accessValue = opts?.noPosAccess ? { pos: false as const } : undefined;
  return render(
    <QueryClientProvider client={qc}>
      <UserAccessProvider value={accessValue}>
        <Component />
      </UserAccessProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.workspace = WORKSPACE_NO_OPEN;
  mocks.loading = false;
  mocks.error = null;
  mocks.postJson.mockReset();
  mocks.postJson.mockResolvedValue({ session: OPEN_SESSION });
  mocks.mutateImpls = [];
  mocks.pendingFlags = [];
  mocks.invalidateQueries.mockReset();
  mocks.setQueryData.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("POS route", () => {
  it("renders the loading state", () => {
    mocks.loading = true;
    mocks.workspace = undefined;

    renderRoute();

    expect(screen.getByTestId("pos-loading")).toHaveTextContent(/Loading POS workspace/);
  });

  it("renders the workspace error state", () => {
    mocks.workspace = undefined;
    mocks.error = new Error("server 503");

    renderRoute();

    expect(screen.getByRole("alert")).toHaveTextContent(/Could not load POS workspace/);
    expect(screen.getByTestId("pos-error")).toHaveTextContent(/server 503/);
  });

  it("keeps sale capture unavailable until a cash session is open", () => {
    renderRoute();

    expect(screen.getByTestId("pos-open-form")).toBeInTheDocument();
    expect(screen.queryByTestId("pos-sale-form")).toBeNull();
    expect(screen.queryByTestId("pos-receipt-packet-form")).toBeNull();
    expect(screen.queryByTestId("pos-receipt-packet-success")).toBeNull();
    expect(screen.queryByTestId("pos-refund-panel")).toBeNull();
  });

  it("keeps receipt packet handoff hidden until a sale succeeds", () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_SESSION],
    };

    renderRoute();

    expect(screen.getByTestId("pos-sale-form")).toBeInTheDocument();
    expect(screen.queryByTestId("pos-receipt-packet-form")).toBeNull();
    expect(screen.queryByTestId("pos-receipt-packet-success")).toBeNull();
    expect(screen.queryByTestId("pos-refund-panel")).toBeNull();
  });

  it("opens a cash session with stock location, opening cash, and optional openedAt", async () => {
    renderRoute();

    expect(screen.getByTestId("pos-open-form")).toBeInTheDocument();
    expect(screen.getByText("POS barcode scanner")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("pos-open-opening-cash"), {
      target: { value: "60000" },
    });
    fireEvent.change(screen.getByTestId("pos-open-register-code"), {
      target: { value: "POS-RETAIL-1" },
    });
    fireEvent.change(screen.getByTestId("pos-open-opened-at"), {
      target: { value: "2026-06-22T08:15" },
    });
    fireEvent.click(screen.getByTestId("pos-open-submit"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    const [path, body] = mocks.postJson.mock.calls[0]!;
    expect(path).toBe("/api/pos/cash-sessions");
    expect(body).toEqual({
      stockLocationId: "loc-pos-1",
      registerCode: "POS-RETAIL-1",
      openingCash: 60000,
      openedAt: "2026-06-22T08:15",
    });
  });

  it("posts a one-line sale to the open cash session and renders success", async () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_SESSION],
    };
    mocks.postJson.mockResolvedValueOnce(VALID_SALE_RESPONSE);

    renderRoute();

    expect(screen.getByTestId("pos-sale-form")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("pos-sale-quantity"), {
      target: { value: "2" },
    });
    expect(screen.getByTestId("pos-sale-total-preview")).toHaveTextContent(/50/);
    fireEvent.change(screen.getByTestId("pos-sale-receipt-number"), {
      target: { value: "R-2026-0002" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-payment-method"), {
      target: { value: "card" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-sold-at"), {
      target: { value: "2026-06-22T09:30" },
    });
    fireEvent.click(screen.getByTestId("pos-sale-submit"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    const [path, body] = mocks.postJson.mock.calls[0]!;
    expect(path).toBe("/api/pos/cash-sessions/pos-session-1/sales");
    expect(body).toEqual({
      receiptNumber: "R-2026-0002",
      paymentMethod: "card",
      soldAt: "2026-06-22T09:30",
      idempotencyKey: expect.stringMatching(/^pos-sale-ui-\d+$/),
      lines: [
        {
          catalogItemId: "catitem-pos-scanner",
          quantity: 2,
        },
      ],
    });
    expect(mocks.mutateImpls[2]).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByTestId("pos-sale-success")).toHaveTextContent(/pos-sale-1/);
    });
    expect(screen.getByTestId("pos-sale-success")).toHaveTextContent(/R-2026-0002/);
    expect(screen.getByTestId("pos-sale-success")).toHaveTextContent(
      /ledger posted \(2 journals\)/,
    );
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["pos", "workspace"],
    });
  });

  it("posts a split-payment sale and renders posted payment evidence", async () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_SESSION],
    };
    mocks.postJson.mockResolvedValueOnce(SPLIT_PAYMENT_SALE_RESPONSE);

    renderRoute();

    fireEvent.change(screen.getByTestId("pos-sale-quantity"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-receipt-number"), {
      target: { value: "R-2026-0003" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-split-cash"), {
      target: { value: "20000" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-split-card"), {
      target: { value: "25000" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-split-bank-transfer"), {
      target: { value: "5000" },
    });

    expect(screen.queryByTestId("pos-sale-split-error")).toBeNull();
    expect(screen.getByTestId("pos-sale-split-total")).toHaveTextContent(/50/);
    fireEvent.click(screen.getByTestId("pos-sale-submit"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    const [path, body] = mocks.postJson.mock.calls[0]!;
    expect(path).toBe("/api/pos/cash-sessions/pos-session-1/sales");
    expect(body).toEqual({
      receiptNumber: "R-2026-0003",
      paymentMethod: "cash",
      idempotencyKey: expect.stringMatching(/^pos-sale-ui-\d+$/),
      payments: [
        { paymentMethod: "cash", amount: 20000 },
        { paymentMethod: "card", amount: 25000 },
        { paymentMethod: "bank-transfer", amount: 5000 },
      ],
      lines: [
        {
          catalogItemId: "catitem-pos-scanner",
          quantity: 2,
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByTestId("pos-sale-success")).toHaveTextContent(/pos-sale-split-1/);
    });
    const evidence = screen.getByTestId("pos-sale-payment-evidence");
    expect(evidence).toHaveTextContent(/Payment method\s*Cash/);
    expect(evidence).toHaveTextContent(/Payment count\s*3/);
    expect(evidence).toHaveTextContent(/Cash\s*20[,\s]000 ֏/);
    expect(evidence).toHaveTextContent(/Card\s*25[,\s]000 ֏/);
    expect(evidence).toHaveTextContent(/Bank transfer\s*5[,\s]000 ֏/);
    expect(evidence).toHaveTextContent(/Paid cash\s*20[,\s]000 ֏/);
  });

  it("prepares fiscal receipt evidence for the last posted sale", async () => {
    const openSessionWithDevice = {
      ...OPEN_SESSION,
      fiscalDeviceId: "FISCAL-OPEN-01",
    };
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: openSessionWithDevice,
      sessions: [openSessionWithDevice, CLOSED_SESSION],
    };
    mocks.postJson
      .mockResolvedValueOnce(VALID_SALE_RESPONSE)
      .mockResolvedValueOnce(VALID_RECEIPT_PACKET_RESPONSE);

    renderRoute();

    fireEvent.change(screen.getByTestId("pos-sale-quantity"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-receipt-number"), {
      target: { value: "R-2026-0002" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-payment-method"), {
      target: { value: "card" },
    });
    fireEvent.click(screen.getByTestId("pos-sale-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("pos-receipt-packet-form")).toBeInTheDocument();
    });
    expect(screen.getByTestId("pos-receipt-packet-fiscal-device-id")).toHaveValue(
      "FISCAL-OPEN-01",
    );

    fireEvent.click(screen.getByTestId("pos-receipt-packet-submit"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(2);
    });
    const [path, body] = mocks.postJson.mock.calls[1]!;
    expect(path).toBe("/api/pos/sales/pos-sale-1/receipt-packet");
    expect(body).toEqual({
      fiscalDeviceId: "FISCAL-OPEN-01",
    });
    expect(mocks.mutateImpls[3]).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByTestId("pos-receipt-packet-success")).toHaveTextContent(
        /prepared/,
      );
    });
    expect(screen.getByTestId("pos-receipt-packet-success")).toHaveTextContent(
      /fiscal-packet-checksum-123/,
    );
  });

  it("records full-sale refund evidence for the last posted sale", async () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_SESSION],
    };
    mocks.postJson
      .mockResolvedValueOnce(VALID_SALE_RESPONSE)
      .mockResolvedValueOnce(VALID_REFUND_RESPONSE);

    renderRoute();

    fireEvent.change(screen.getByTestId("pos-sale-quantity"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-receipt-number"), {
      target: { value: "R-2026-0002" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-payment-method"), {
      target: { value: "cash" },
    });
    fireEvent.click(screen.getByTestId("pos-sale-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("pos-refund-form")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("pos-refund-reference"), {
      target: { value: " rf-cash-001 " },
    });
    fireEvent.change(screen.getByTestId("pos-refund-method"), {
      target: { value: "cash" },
    });
    fireEvent.change(screen.getByTestId("pos-refund-reason"), {
      target: { value: " Customer returned sealed scanner. " },
    });
    fireEvent.click(screen.getByTestId("pos-refund-submit"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(2);
    });
    const [path, body] = mocks.postJson.mock.calls[1]!;
    expect(path).toBe("/api/pos/sales/pos-sale-1/refund");
    expect(body).toEqual({
      idempotencyKey: expect.stringMatching(/^pos-refund-ui-pos-sale-1-\d+$/),
      refundReference: "rf-cash-001",
      refundMethod: "cash",
      reason: "Customer returned sealed scanner.",
    });
    expect(mocks.mutateImpls[4]).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByTestId("pos-refund-success")).toHaveTextContent(
        /Refund evidence posted/,
      );
    });
    expect(screen.getByTestId("pos-sale-success")).toHaveTextContent(/Refunded sale/);
    expect(screen.getByTestId("pos-sale-success")).toHaveTextContent(
      /status refunded_full/,
    );
    expect(screen.getByTestId("pos-refund-success")).toHaveTextContent(/Cash/);
    expect(screen.getByTestId("pos-refund-success")).toHaveTextContent(/posted/);
    expect(screen.getByTestId("pos-refund-success")).toHaveTextContent(
      /Return stock moves\s*1/,
    );
    expect(screen.getByTestId("pos-refund-success")).toHaveTextContent(
      /Ledger journals\s*posted \(2 journals\)/,
    );
    expect(screen.getByTestId("pos-refund-success")).toHaveTextContent(
      /Ledger reversal journals are posted; fiscal refunds and receipt printing remain deferred/,
    );
    expect(screen.queryByTestId("pos-refund-form")).toBeNull();
    expect(screen.queryByTestId("pos-receipt-packet-form")).toBeNull();
    expect(mocks.setQueryData).toHaveBeenCalledWith(
      ["pos", "workspace"],
      expect.any(Function),
    );
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["pos", "workspace"],
    });
  });

  it("records a single partial refund amount and renders returned status evidence", async () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_SESSION],
    };
    mocks.postJson
      .mockResolvedValueOnce(VALID_SALE_RESPONSE)
      .mockResolvedValueOnce(VALID_PARTIAL_REFUND_RESPONSE);

    renderRoute();

    fireEvent.change(screen.getByTestId("pos-sale-quantity"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-receipt-number"), {
      target: { value: "R-2026-0002" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-payment-method"), {
      target: { value: "cash" },
    });
    fireEvent.click(screen.getByTestId("pos-sale-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("pos-refund-form")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("pos-refund-reference"), {
      target: { value: " rf-partial-001 " },
    });
    fireEvent.change(screen.getByTestId("pos-refund-refunded-total"), {
      target: { value: "20000" },
    });
    fireEvent.change(screen.getByTestId("pos-refund-reason"), {
      target: { value: " Partial goodwill refund. " },
    });
    fireEvent.click(screen.getByTestId("pos-refund-submit"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(2);
    });
    const [path, body] = mocks.postJson.mock.calls[1]!;
    expect(path).toBe("/api/pos/sales/pos-sale-1/refund");
    expect(body).toEqual({
      idempotencyKey: expect.stringMatching(/^pos-refund-ui-pos-sale-1-\d+$/),
      refundReference: "rf-partial-001",
      refundMethod: "cash",
      refundedTotal: 20000,
      reason: "Partial goodwill refund.",
    });

    await waitFor(() => {
      expect(screen.getByTestId("pos-refund-success")).toHaveTextContent(
        /Refund evidence posted/,
      );
    });
    expect(screen.getByTestId("pos-sale-success")).toHaveTextContent(/Refunded sale/);
    expect(screen.getByTestId("pos-sale-success")).toHaveTextContent(/status refunded/);
    expect(screen.getByTestId("pos-refund-success")).toHaveTextContent(
      /Sale status\s*refunded/,
    );
    expect(screen.getByTestId("pos-refund-success")).toHaveTextContent(
      /Refunded total\s*20[,\s]000 ֏/,
    );
    expect(screen.getByTestId("pos-refund-success")).toHaveTextContent(
      /Cash adjustment\s*20[,\s]000 ֏/,
    );
    expect(screen.getByTestId("pos-refund-success")).toHaveTextContent(
      /Refund amount evidence is recorded without stock return moves/,
    );
  });

  it("records pre-receipt void evidence for the last posted sale", async () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_SESSION],
    };
    mocks.postJson
      .mockResolvedValueOnce(VALID_SALE_RESPONSE)
      .mockResolvedValueOnce(VALID_VOID_RESPONSE);

    renderRoute();

    fireEvent.change(screen.getByTestId("pos-sale-quantity"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-receipt-number"), {
      target: { value: "R-2026-0002" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-payment-method"), {
      target: { value: "cash" },
    });
    fireEvent.click(screen.getByTestId("pos-sale-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("pos-void-form")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("pos-void-reference"), {
      target: { value: " void-cash-001 " },
    });
    fireEvent.change(screen.getByTestId("pos-void-reason"), {
      target: { value: " Cashier caught the receipt before fiscal handoff. " },
    });
    fireEvent.change(screen.getByTestId("pos-void-voided-at"), {
      target: { value: "2026-06-22T10:15" },
    });
    fireEvent.click(screen.getByTestId("pos-void-submit"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(2);
    });
    const [path, body] = mocks.postJson.mock.calls[1]!;
    expect(path).toBe("/api/pos/sales/pos-sale-1/void");
    expect(body).toEqual({
      idempotencyKey: expect.stringMatching(/^pos-void-ui-pos-sale-1-\d+$/),
      voidReference: "void-cash-001",
      reason: "Cashier caught the receipt before fiscal handoff.",
      voidedAt: "2026-06-22T10:15",
    });
    expect(mocks.mutateImpls[6]).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByTestId("pos-void-success")).toHaveTextContent(
        /Void evidence posted/,
      );
    });
    expect(screen.getByTestId("pos-sale-success")).toHaveTextContent(/Voided sale/);
    expect(screen.getByTestId("pos-sale-success")).toHaveTextContent(/status voided/);
    expect(screen.getByTestId("pos-void-success")).toHaveTextContent(
      /Reference\s*VOID-CASH-001/,
    );
    expect(screen.getByTestId("pos-void-success")).toHaveTextContent(
      /Cash adjustment\s*50[,\s]000 ֏/,
    );
    expect(screen.getByTestId("pos-void-success")).toHaveTextContent(
      /Return stock moves\s*1/,
    );
    expect(screen.getByTestId("pos-void-success")).toHaveTextContent(
      /Ledger journals\s*posted \(2 journals\)/,
    );
    expect(screen.queryByTestId("pos-void-form")).toBeNull();
    expect(screen.queryByTestId("pos-refund-form")).toBeNull();
    expect(screen.queryByTestId("pos-receipt-packet-form")).toBeNull();
    expect(screen.getByTestId("pos-refund-locked")).toHaveTextContent(
      /Refund or void evidence is already recorded/,
    );
    expect(mocks.setQueryData).toHaveBeenCalledWith(
      ["pos", "workspace"],
      expect.any(Function),
    );
  });

  it("closes the current cash session with fiscal closeout evidence", async () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_SESSION],
    };
    mocks.postJson.mockResolvedValue({ session: { ...OPEN_SESSION, status: "closed" } });

    renderRoute();

    expect(screen.getByTestId("pos-current-session")).toHaveTextContent(/Current cash session/);
    fireEvent.change(screen.getByTestId("pos-close-counted-cash"), {
      target: { value: "74000" },
    });
    fireEvent.change(screen.getByTestId("pos-close-fiscal-device-id"), {
      target: { value: "FISCAL-01" },
    });
    fireEvent.change(screen.getByTestId("pos-close-z-report-number"), {
      target: { value: "ZR-2026-0002" },
    });
    fireEvent.change(screen.getByTestId("pos-close-receipt-range-start"), {
      target: { value: "10076" },
    });
    fireEvent.change(screen.getByTestId("pos-close-receipt-range-end"), {
      target: { value: "10120" },
    });
    fireEvent.change(screen.getByTestId("pos-close-note"), {
      target: { value: "Count verified by shift lead." },
    });
    fireEvent.click(screen.getByTestId("pos-close-submit"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    const [path, body] = mocks.postJson.mock.calls[0]!;
    expect(path).toBe("/api/pos/cash-sessions/pos-session-1/close");
    expect(body).toEqual({
      countedCash: 74000,
      fiscalDeviceId: "FISCAL-01",
      zReportNumber: "ZR-2026-0002",
      receiptRangeStart: "10076",
      receiptRangeEnd: "10120",
      closeNote: "Count verified by shift lead.",
    });
  });

  it("posts terminal settlement for a closed card-clearing preview and renders ledger evidence", async () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      terminalSettlementPreviews: [VALID_TERMINAL_SETTLEMENT_PREVIEW],
      terminalSettlement: VALID_TERMINAL_SETTLEMENT_PREVIEW,
    };
    mocks.postJson.mockResolvedValueOnce(VALID_TERMINAL_SETTLEMENT_RESPONSE);

    renderRoute();

    expect(screen.getByTestId("pos-terminal-settlement-preview")).toHaveTextContent(
      /Outstanding/,
    );
    expect(screen.getByTestId("pos-terminal-settlement-preview")).toHaveTextContent(
      /255/,
    );
    fireEvent.change(screen.getByTestId("pos-terminal-settlement-reference"), {
      target: { value: " term-batch-001 " },
    });
    fireEvent.change(screen.getByTestId("pos-terminal-settlement-provider"), {
      target: { value: " Acba POS " },
    });
    fireEvent.change(screen.getByTestId("pos-terminal-settlement-settled-total"), {
      target: { value: "55000" },
    });
    fireEvent.change(screen.getByTestId("pos-terminal-settlement-processor-fee"), {
      target: { value: "5000" },
    });
    expect(screen.getByTestId("pos-terminal-settlement-calculation")).toHaveTextContent(
      /Cleared total/,
    );
    expect(screen.getByTestId("pos-terminal-settlement-calculation")).toHaveTextContent(
      /Outstanding after\s*0/,
    );
    fireEvent.change(screen.getByTestId("pos-terminal-settlement-settled-at"), {
      target: { value: "2026-06-22T19:00" },
    });
    fireEvent.change(screen.getByTestId("pos-terminal-settlement-note"), {
      target: { value: " Settlement posted from Acba batch. " },
    });
    fireEvent.click(screen.getByTestId("pos-terminal-settlement-submit"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    const [path, body] = mocks.postJson.mock.calls[0]!;
    expect(path).toBe("/api/pos/cash-sessions/pos-session-0/terminal-settlements");
    expect(body).toEqual({
      idempotencyKey: expect.stringMatching(
        /^pos-terminal-settlement-ui-pos-session-0-\d+$/,
      ),
      settlementReference: "term-batch-001",
      provider: "Acba POS",
      settledTotal: 55000,
      processorFee: 5000,
      processorFeeAccountCode: "711",
      settledAt: "2026-06-22T19:00",
      note: "Settlement posted from Acba batch.",
    });
    expect(mocks.mutateImpls[5]).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByTestId("pos-terminal-settlement-success")).toHaveTextContent(
        /TERM-BATCH-001/,
      );
    });
    expect(screen.getByTestId("pos-terminal-settlement-success")).toHaveTextContent(
      /Acba POS/,
    );
    expect(screen.getByTestId("pos-terminal-settlement-success")).toHaveTextContent(
      /Processor fee\s*5[,\s]000 ֏ · 711/,
    );
    expect(screen.getByTestId("pos-terminal-settlement-success")).toHaveTextContent(
      /Cleared total\s*60[,\s]000 ֏/,
    );
    expect(screen.getByTestId("pos-terminal-settlement-success")).toHaveTextContent(
      /Outstanding after\s*0/,
    );
    expect(screen.getByTestId("pos-terminal-settlement-success")).toHaveTextContent(
      /Clearing account\s*255/,
    );
    expect(screen.getByTestId("pos-terminal-settlement-success")).toHaveTextContent(
      /Bank account\s*252/,
    );
    expect(screen.getByTestId("pos-terminal-settlement-success")).toHaveTextContent(
      /Ledger journals\s*posted \(2 journals\)/,
    );
    expect(screen.getByTestId("pos-terminal-settlement-success")).toHaveTextContent(
      /Fee journals\s*posted \(1 journal\)/,
    );
    expect(mocks.setQueryData).toHaveBeenCalledWith(
      ["pos", "workspace"],
      expect.any(Function),
    );
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["pos", "workspace"],
    });
  });

  it("renders the app-tier 403 card when POS access is denied", () => {
    renderRoute({ noPosAccess: true });

    expect(screen.getByTestId("pos-403")).toBeInTheDocument();
    expect(screen.queryByTestId("pos-open-form")).toBeNull();
  });

  it("exports PosAccessDeniedCard as a named component", () => {
    render(<PosAccessDeniedCard />);

    expect(screen.getByTestId("pos-403")).toBeInTheDocument();
  });
});
