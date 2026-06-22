/**
 * /app/pos — route-level tests for the POS cash-session spine.
 *
 * Covers POS frontend behavior:
 *   - loading and error states for /api/pos/workspace
 *   - opening a cash session via POST /api/pos/cash-sessions
 *   - posting a one-line sale via POST /api/pos/cash-sessions/:id/sales
 *   - posting split-payment sale evidence through the sale capture surface
 *   - preparing local receipt packet and print-preview evidence
 *   - recording full-sale refund evidence via POST /api/pos/sales/:id/refund
 *   - closing the current cash session via POST /api/pos/cash-sessions/:id/close
 *   - posting closed-session terminal settlement evidence
 *   - queueing and marking local offline replay readiness evidence
 *   - persisting, retrying, and auto-replaying browser-local sale drafts
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
  offlineReplayItems: { items: [] } as unknown,
  loading: false,
  offlineReplayLoading: false,
  error: null as Error | null,
  offlineReplayError: null as Error | null,
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
    useQuery: (opts: { queryKey?: readonly unknown[] }) => {
      const key = opts.queryKey ?? [];
      if (key[0] === "pos" && key[1] === "offline-replay-items") {
        return {
          data: mocks.offlineReplayItems,
          isLoading: mocks.offlineReplayLoading,
          error: mocks.offlineReplayError,
        };
      }
      return {
        data: mocks.workspace,
        isLoading: mocks.loading,
        error: mocks.error,
      };
    },
    useMutation: (opts: {
      mutationFn: (...args: unknown[]) => Promise<unknown>;
      onSuccess?: (...args: unknown[]) => void;
      onError?: (...args: unknown[]) => void;
    }) => {
      const fn = opts.mutationFn.toString();
      const slot = fn.includes("mark-replayed")
        ? 9
        : fn.includes("offline-replay-items")
        ? 8
        : fn.includes("terminal-settlements")
        ? 5
        : fn.includes("/void")
        ? 6
        : fn.includes("/refund")
        ? 4
        : fn.includes("receipt-print")
        ? 7
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
  ApiError: class ApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
      public readonly details?: unknown,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
  getJson: vi.fn(),
  postJson: mocks.postJson,
}));

import { Route, PosAccessDeniedCard } from "./index";
import { ApiError } from "../../../lib/api/client";
import { UserAccessProvider } from "../../../lib/rbac/access.tsx";

const POS_LOCAL_SALE_DRAFTS_STORAGE_KEY = "a1:pos:local-sale-drafts:v1";

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

const POS_CUSTOMERS = [
  { id: "cust-retail-1", name: "Ararat Market" },
  { id: "cust-retail-2", name: "Vanadzor Retail" },
];

const WORKSPACE_NO_OPEN = {
  openSession: null,
  sessions: [CLOSED_SESSION],
  capabilityStatus: {
    offlineReplay: "local-queue",
  },
  recentOfflineReplayItems: [],
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
  customers: POS_CUSTOMERS,
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

const CUSTOMER_SALE_RESPONSE = {
  ...VALID_SALE_RESPONSE,
  sale: {
    ...VALID_SALE_RESPONSE.sale,
    customerId: "cust-retail-1",
    customerName: "Ararat Market",
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

const VALID_RECEIPT_PRINT = {
  id: "pos-receipt-packet-1:receipt-print",
  receiptPacketId: "pos-receipt-packet-1",
  saleId: "pos-sale-1",
  cashSessionId: "pos-session-1",
  receiptNumber: "R-2026-0002",
  status: "previewed",
  printStatus: "previewed",
  printMode: "local-preview",
  printFormat: "receipt-preview-json-v1",
  copyCount: 1,
  checksum: "receipt-print-checksum-456",
  previewLines: [
    "Armosphera One POS receipt preview",
    "Receipt R-2026-0002",
    "2 x POS barcode scanner = 50000 AMD",
    "Total 50000 AMD",
    "Local preview only - no printer or fiscal device command",
  ],
  evidenceMode: "local-preview-only",
  liveFiscalSubmission: false,
  physicalPrinterCommand: false,
  deviceSubmissionStatus: "not-submitted",
  submittedToDevice: false,
  printedAt: "2026-06-22T09:32:00.000Z",
};

const VALID_RECEIPT_PRINT_RESPONSE = {
  ok: true,
  idempotent: false,
  receiptPrint: VALID_RECEIPT_PRINT,
  receiptPacket: {
    ...VALID_RECEIPT_PACKET_RESPONSE.receiptPacket,
    receiptPrint: VALID_RECEIPT_PRINT,
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
    customerId: "cust-retail-1",
    customerName: "Ararat Market",
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
    lineCount: 0,
    lines: [],
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

const VALID_LINE_REFUND_RESPONSE = {
  ...VALID_REFUND_RESPONSE,
  refund: {
    ...VALID_REFUND_RESPONSE.refund,
    id: "pos-sale-refund-line-return-1",
    refundReference: "RF-LINE-001",
    sourceKey: "pos-refund-ui-pos-sale-1-1782113400000",
    reason: "Customer returned one scanner.",
    refundedTotal: 25000,
    cashAdjustment: 25000,
    inventoryPostingStatus: "posted",
    lineCount: 1,
    lines: [
      {
        ...VALID_REFUND_RESPONSE.refund.lines[0],
        id: "pos-sale-refund-line-return-1",
        quantity: 1,
        subtotal: 25000,
        total: 25000,
        returnStockMoveId: "stock-move-return-line-1",
      },
    ],
  },
  sale: {
    ...VALID_SALE_RESPONSE.sale,
    status: "refunded",
  },
  session: {
    ...OPEN_SESSION,
    expectedCash: 75000,
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

const VALID_OFFLINE_REPLAY_ITEM = {
  id: "pos-offline-replay-1",
  actionType: "pos.sale.local-evidence",
  sourceKey: "pos-offline-replay-test-1",
  payload: {
    evidenceMode: "local-readiness-only",
    browserOfflineExecution: false,
    fiscalSubmission: false,
    terminalSubmission: false,
  },
  cashSessionId: OPEN_SESSION.id,
  saleId: "pos-sale-1",
  replayStatus: "queued",
  note: "Queued from a local readiness check.",
  queuedAt: "2026-06-22T12:00:00.000Z",
  createdAt: "2026-06-22T12:00:00.000Z",
};

const VALID_OFFLINE_REPLAY_QUEUE_RESPONSE = {
  ok: true,
  item: {
    ...VALID_OFFLINE_REPLAY_ITEM,
    id: "pos-offline-replay-new",
    actionType: "sale",
    sourceKey: "pos-offline-replay-ui-pos-session-1-1782139200000",
    saleId: null,
    note: "Local offline replay readiness evidence from POS UI.",
    queuedAt: "2026-06-22T12:10:00.000Z",
    createdAt: "2026-06-22T12:10:00.000Z",
  },
};

const VALID_OFFLINE_REPLAY_MARK_RESPONSE = {
  ok: true,
  item: {
    ...VALID_OFFLINE_REPLAY_ITEM,
    replayStatus: "replayed",
    note: "Marked replayed from POS local readiness panel.",
    replayedAt: "2026-06-22T12:12:00.000Z",
    updatedAt: "2026-06-22T12:12:00.000Z",
  },
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

function readStoredSaleDrafts(): Array<Record<string, unknown>> {
  return JSON.parse(
    localStorage.getItem(POS_LOCAL_SALE_DRAFTS_STORAGE_KEY) ?? "[]",
  ) as Array<Record<string, unknown>>;
}

function writeStoredSaleDrafts(drafts: Array<Record<string, unknown>>): void {
  localStorage.setItem(POS_LOCAL_SALE_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
}

function storedSaleDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const receiptNumber = String(overrides.receiptNumber ?? "R-AUTO-REPLAY-1");
  const idempotencyKey = String(
    overrides.idempotencyKey ?? "pos-sale-auto-replay-1",
  );
  return {
    id: `pos-sale-draft-${idempotencyKey}`,
    cashSessionId: "pos-session-1",
    queuedAt: "2026-06-22T11:00:00.000Z",
    queueReason: "post-failed",
    autoReplayStatus: "queued",
    autoReplayAttemptCount: 0,
    lastError: "Failed to fetch",
    payload: {
      receiptNumber,
      paymentMethod: "card",
      idempotencyKey,
      lines: [{ catalogItemId: "catitem-pos-scanner", quantity: 2 }],
    },
    evidence: {
      receiptNumber,
      customerLabel: "Ararat Market",
      paymentLabel: "Card",
      lineLabel: "2 x POS-SCANNER",
      quantity: 2,
      total: 50000,
    },
    ...overrides,
  };
}

beforeEach(() => {
  mocks.workspace = WORKSPACE_NO_OPEN;
  mocks.offlineReplayItems = { items: [] };
  mocks.loading = false;
  mocks.offlineReplayLoading = false;
  mocks.error = null;
  mocks.offlineReplayError = null;
  mocks.postJson.mockReset();
  mocks.postJson.mockResolvedValue({ session: OPEN_SESSION });
  mocks.mutateImpls = [];
  mocks.pendingFlags = [];
  mocks.invalidateQueries.mockReset();
  mocks.setQueryData.mockReset();
  localStorage.removeItem(POS_LOCAL_SALE_DRAFTS_STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(POS_LOCAL_SALE_DRAFTS_STORAGE_KEY);
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
    mocks.postJson.mockResolvedValueOnce(CUSTOMER_SALE_RESPONSE);

    renderRoute();

    expect(screen.getByTestId("pos-sale-form")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("pos-sale-quantity"), {
      target: { value: "2" },
    });
    expect(screen.getByTestId("pos-sale-total-preview")).toHaveTextContent(/50/);
    fireEvent.change(screen.getByTestId("pos-sale-receipt-number"), {
      target: { value: "R-2026-0002" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-customer"), {
      target: { value: "cust-retail-1" },
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
      customerId: "cust-retail-1",
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
    expect(screen.getByTestId("pos-sale-payment-evidence")).toHaveTextContent(
      /Customer\s*Ararat Market/,
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

  it("persists a browser-local sale draft when sale posting fails", async () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_SESSION],
    };
    mocks.postJson.mockRejectedValueOnce(new Error("network offline"));

    renderRoute();

    fireEvent.change(screen.getByTestId("pos-sale-quantity"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-receipt-number"), {
      target: { value: "R-LOCAL-FAIL-1" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-customer"), {
      target: { value: "cust-retail-1" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-payment-method"), {
      target: { value: "card" },
    });
    fireEvent.click(screen.getByTestId("pos-sale-submit"));

    await waitFor(() => {
      expect(readStoredSaleDrafts()).toHaveLength(1);
    });
    expect(mocks.postJson).toHaveBeenCalledTimes(1);
    const [, postedBody] = mocks.postJson.mock.calls[0]!;
    const [draft] = readStoredSaleDrafts() as Array<{
      cashSessionId: string;
      queueReason: string;
      lastError: string;
      payload: Record<string, unknown>;
      evidence: Record<string, unknown>;
    }>;

    expect(draft.cashSessionId).toBe("pos-session-1");
    expect(draft.queueReason).toBe("post-failed");
    expect(draft.lastError).toBe("network offline");
    expect(draft.payload).toEqual(postedBody);
    expect(draft.evidence).toMatchObject({
      receiptNumber: "R-LOCAL-FAIL-1",
      customerLabel: "Ararat Market",
      paymentLabel: "Card",
      total: 50000,
    });
    expect(screen.getByTestId("pos-local-sale-drafts")).toHaveTextContent(
      /R-LOCAL-FAIL-1/,
    );
    expect(screen.getByTestId("pos-local-sale-drafts")).toHaveTextContent(
      /Ararat Market/,
    );
    expect(screen.getByTestId("pos-local-sale-drafts")).toHaveTextContent(/Card/);
    expect(screen.getByTestId("pos-local-sale-draft-queue-success")).toHaveTextContent(
      /Queued after post failed/,
    );
  });

  it("does not queue business validation sale failures as offline drafts", async () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_SESSION],
    };
    mocks.postJson.mockRejectedValueOnce(new Error("finance period 2026-06 is closed"));

    renderRoute();

    fireEvent.change(screen.getByTestId("pos-sale-quantity"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-receipt-number"), {
      target: { value: "R-BUSINESS-FAIL-1" },
    });
    fireEvent.click(screen.getByTestId("pos-sale-submit"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    expect(readStoredSaleDrafts()).toHaveLength(0);
    expect(screen.queryByTestId("pos-local-sale-draft")).toBeNull();
    expect(screen.getByTestId("pos-local-sale-draft-panel")).toHaveTextContent(
      /No browser-local sale drafts queued/,
    );
  });

  it("queues a sale locally on operator action and retries the same payload", async () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_SESSION],
    };

    renderRoute();

    fireEvent.change(screen.getByTestId("pos-sale-quantity"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-receipt-number"), {
      target: { value: "R-LOCAL-QUEUE-1" },
    });
    fireEvent.change(screen.getByTestId("pos-sale-customer"), {
      target: { value: "cust-retail-2" },
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
    fireEvent.click(screen.getByTestId("pos-sale-queue-local"));

    await waitFor(() => {
      expect(readStoredSaleDrafts()).toHaveLength(1);
    });
    expect(mocks.postJson).not.toHaveBeenCalled();
    const [storedDraft] = readStoredSaleDrafts() as Array<{
      payload: Record<string, unknown>;
      evidence: Record<string, unknown>;
    }>;
    const storedPayload = storedDraft.payload;

    expect(storedDraft.evidence).toMatchObject({
      receiptNumber: "R-LOCAL-QUEUE-1",
      customerLabel: "Vanadzor Retail",
      total: 50000,
    });
    expect(String(storedDraft.evidence.paymentLabel)).toMatch(
      /Cash 20[,\s]000\s*֏ \/ Card 25[,\s]000\s*֏ \/ Bank transfer 5[,\s]000\s*֏/,
    );
    expect(storedPayload).toMatchObject({
      customerId: "cust-retail-2",
      receiptNumber: "R-LOCAL-QUEUE-1",
      paymentMethod: "cash",
      payments: [
        { paymentMethod: "cash", amount: 20000 },
        { paymentMethod: "card", amount: 25000 },
        { paymentMethod: "bank-transfer", amount: 5000 },
      ],
      idempotencyKey: expect.stringMatching(/^pos-sale-ui-\d+$/),
      lines: [{ catalogItemId: "catitem-pos-scanner", quantity: 2 }],
    });
    expect(screen.getByTestId("pos-local-sale-drafts")).toHaveTextContent(
      /R-LOCAL-QUEUE-1/,
    );
    expect(screen.getByTestId("pos-local-sale-drafts")).toHaveTextContent(
      /Vanadzor Retail/,
    );
    expect(screen.getByTestId("pos-local-sale-drafts")).toHaveTextContent(
      /Cash 20[,\s]000 ֏ \/ Card 25[,\s]000 ֏ \/ Bank transfer 5[,\s]000 ֏/,
    );

    mocks.postJson.mockResolvedValueOnce({
      ...VALID_SALE_RESPONSE,
      sale: {
        ...VALID_SALE_RESPONSE.sale,
        id: "pos-sale-local-retry-1",
        receiptNumber: "R-LOCAL-QUEUE-1",
        customerId: "cust-retail-2",
        customerName: "Vanadzor Retail",
      },
    });
    fireEvent.click(screen.getByTestId("pos-local-sale-draft-retry"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    const [path, retryBody] = mocks.postJson.mock.calls[0]!;
    expect(path).toBe("/api/pos/cash-sessions/pos-session-1/sales");
    expect(retryBody).toEqual(storedPayload);

    await waitFor(() => {
      expect(readStoredSaleDrafts()).toHaveLength(0);
    });
    expect(screen.getByTestId("pos-local-sale-draft-retry-success")).toHaveTextContent(
      /local draft removed/,
    );
    expect(screen.queryByTestId("pos-local-sale-draft")).toBeNull();
    expect(screen.getByTestId("pos-sale-success")).toHaveTextContent(
      /pos-sale-local-retry-1/,
    );
  });

  it("auto-replays a stored post-failed sale draft with the same payload", async () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_SESSION],
    };
    const draft = storedSaleDraft();
    writeStoredSaleDrafts([draft]);
    mocks.postJson.mockResolvedValueOnce({
      ...VALID_SALE_RESPONSE,
      sale: {
        ...VALID_SALE_RESPONSE.sale,
        id: "pos-sale-auto-replayed-1",
        receiptNumber: "R-AUTO-REPLAY-1",
      },
    });

    renderRoute();

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    const [path, retryBody] = mocks.postJson.mock.calls[0]!;
    expect(path).toBe("/api/pos/cash-sessions/pos-session-1/sales");
    expect(retryBody).toEqual((draft.payload as Record<string, unknown>));

    await waitFor(() => {
      expect(readStoredSaleDrafts()).toHaveLength(0);
    });
    expect(screen.getByTestId("pos-local-sale-draft-auto-success")).toHaveTextContent(
      /Auto-replayed sale draft pos-sale-draft-pos-sale-auto-replay-1/,
    );
    expect(screen.getByTestId("pos-sale-success")).toHaveTextContent(
      /pos-sale-auto-replayed-1/,
    );
  });

  it("keeps operator-queued local sale drafts manual on load", async () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_SESSION],
    };
    writeStoredSaleDrafts([{ ...storedSaleDraft(), queueReason: "manual" }]);

    renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId("pos-local-sale-drafts")).toHaveTextContent(
        /Manual retry/,
      );
    });
    expect(mocks.postJson).not.toHaveBeenCalled();
    expect(readStoredSaleDrafts()).toHaveLength(1);
  });

  it("marks automatic replay conflicts as needs-review instead of retrying forever", async () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_SESSION],
    };
    writeStoredSaleDrafts([storedSaleDraft()]);
    mocks.postJson.mockRejectedValueOnce(
      new ApiError(409, "POS_SESSION_CLOSED", "POS cash session is closed"),
    );

    renderRoute();

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      const [storedDraft] = readStoredSaleDrafts();
      expect(storedDraft?.autoReplayStatus).toBe("conflict-ready");
      expect(storedDraft?.autoReplayBlockReason).toBe("closed-session");
      expect(storedDraft?.autoReplayAttemptCount).toBe(1);
    });
    expect(screen.getByTestId("pos-local-sale-drafts")).toHaveTextContent(
      /Needs review/,
    );
    expect(screen.getByTestId("pos-local-sale-drafts")).toHaveTextContent(
      /Closed cash session/,
    );
    expect(screen.getByTestId("pos-local-sale-draft-last-error")).toHaveTextContent(
      /POS cash session is closed/,
    );
  });

  it("prepares fiscal receipt and local print-preview evidence for the last posted sale", async () => {
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
      .mockResolvedValueOnce(VALID_RECEIPT_PACKET_RESPONSE)
      .mockResolvedValueOnce(VALID_RECEIPT_PRINT_RESPONSE);

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
    expect(screen.getByTestId("pos-receipt-print-panel")).toHaveTextContent(
      /Local print preview only/,
    );

    fireEvent.click(screen.getByTestId("pos-receipt-print-submit"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(3);
    });
    const [printPath, printBody] = mocks.postJson.mock.calls[2]!;
    expect(printPath).toBe("/api/pos/sales/pos-sale-1/receipt-print");
    expect(printBody).toEqual({
      copyCount: 1,
      printMode: "local-preview",
      printFormat: "receipt-preview-json-v1",
    });
    expect(mocks.mutateImpls[7]).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByTestId("pos-receipt-print-success")).toHaveTextContent(
        /previewed/,
      );
    });
    expect(screen.getByTestId("pos-receipt-print-success")).toHaveTextContent(
      /receipt-print-checksum-456/,
    );
    expect(screen.getByTestId("pos-receipt-print-success")).toHaveTextContent(
      /not-submitted/,
    );
    expect(screen.getByTestId("pos-receipt-print-preview")).toHaveTextContent(
      /Receipt R-2026-0002/,
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
      /Customer\s*Ararat Market/,
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

  it("records a partial line return refund and renders stock-return evidence", async () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_SESSION],
    };
    mocks.postJson
      .mockResolvedValueOnce(VALID_SALE_RESPONSE)
      .mockResolvedValueOnce(VALID_LINE_REFUND_RESPONSE);

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
      target: { value: " rf-line-001 " },
    });
    fireEvent.change(screen.getByTestId("pos-refund-line-quantity-pos-sale-line-1"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByTestId("pos-refund-reason"), {
      target: { value: " Customer returned one scanner. " },
    });

    expect(screen.getByTestId("pos-refund-line-return-total")).toHaveTextContent(
      /Line return total\s*25[,\s]000 ֏/,
    );
    fireEvent.click(screen.getByTestId("pos-refund-submit"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(2);
    });
    const [path, body] = mocks.postJson.mock.calls[1]!;
    expect(path).toBe("/api/pos/sales/pos-sale-1/refund");
    expect(body).toEqual({
      idempotencyKey: expect.stringMatching(/^pos-refund-ui-pos-sale-1-\d+$/),
      refundReference: "rf-line-001",
      refundMethod: "cash",
      reason: "Customer returned one scanner.",
      lines: [{ saleLineId: "pos-sale-line-1", quantity: 1 }],
    });

    await waitFor(() => {
      expect(screen.getByTestId("pos-refund-success")).toHaveTextContent(
        /Refund evidence posted/,
      );
    });
    expect(screen.getByTestId("pos-sale-success")).toHaveTextContent(/status refunded/);
    expect(screen.getByTestId("pos-refund-success")).toHaveTextContent(
      /Refunded total\s*25[,\s]000 ֏/,
    );
    expect(screen.getByTestId("pos-refund-success")).toHaveTextContent(
      /Return stock moves\s*1/,
    );
    expect(screen.getByTestId("pos-refund-line-evidence")).toHaveTextContent(
      /returned 1 \/ sold 2/,
    );
    expect(screen.getByTestId("pos-refund-success")).toHaveTextContent(
      /Return stock evidence is recorded for tracked lines/,
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

  it("queues sample local offline replay readiness evidence", async () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_SESSION],
    };
    mocks.postJson.mockResolvedValueOnce(VALID_OFFLINE_REPLAY_QUEUE_RESPONSE);

    renderRoute();

    expect(screen.getByTestId("pos-offline-replay-panel")).toHaveTextContent(
      /local-queue/,
    );
    expect(screen.getByTestId("pos-offline-replay-panel")).toHaveTextContent(
      /Local readiness\/evidence only/,
    );

    fireEvent.click(screen.getByTestId("pos-offline-replay-submit"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    const [path, body] = mocks.postJson.mock.calls[0]!;
    expect(path).toBe("/api/pos/offline-replay-items");
    expect(body).toEqual({
      actionType: "sale",
      sourceKey: expect.stringMatching(/^pos-offline-replay-ui-pos-session-1-\d+$/),
      payload: {
        evidenceMode: "local-readiness-only",
        actionType: "sale",
        browserOfflineExecution: false,
        fiscalSubmission: false,
        terminalSubmission: false,
        route: "/app/pos",
        cashSessionId: "pos-session-1",
        saleId: null,
        queuedAt: expect.any(String),
      },
      cashSessionId: "pos-session-1",
      note: "Local offline replay readiness evidence from POS UI.",
    });
    expect(mocks.mutateImpls[8]).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByTestId("pos-offline-replay-success")).toHaveTextContent(
        /Queued local readiness evidence pos-offline-replay-new/,
      );
    });
    expect(screen.getByTestId("pos-offline-replay-success")).toHaveTextContent(
      /status queued/,
    );
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["pos", "offline-replay-items"],
    });
  });

  it("marks a queued offline replay item as replayed", async () => {
    mocks.workspace = {
      ...WORKSPACE_NO_OPEN,
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_SESSION],
      recentOfflineReplayItems: [VALID_OFFLINE_REPLAY_ITEM],
    };
    mocks.offlineReplayItems = { items: [VALID_OFFLINE_REPLAY_ITEM] };
    mocks.postJson.mockResolvedValueOnce(VALID_OFFLINE_REPLAY_MARK_RESPONSE);

    renderRoute();

    expect(screen.getByTestId("pos-offline-replay-items")).toHaveTextContent(
      /pos.sale.local-evidence/,
    );
    fireEvent.click(screen.getByTestId("pos-offline-replay-mark-replayed"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    const [path, body] = mocks.postJson.mock.calls[0]!;
    expect(path).toBe(
      "/api/pos/offline-replay-items/pos-offline-replay-1/mark-replayed",
    );
    expect(body).toEqual({
      replayStatus: "replayed",
      note: "Marked replayed from POS local readiness panel.",
    });
    expect(mocks.mutateImpls[9]).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByTestId("pos-offline-replay-mark-success")).toHaveTextContent(
        /marked replayed/,
      );
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["pos", "offline-replay-items"],
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
