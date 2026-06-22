/**
 * /app/pos — route-level tests for the POS cash-session spine.
 *
 * Covers POS frontend behavior:
 *   - loading and error states for /api/pos/workspace
 *   - opening a cash session via POST /api/pos/cash-sessions
 *   - posting a one-line sale via POST /api/pos/cash-sessions/:id/sales
 *   - closing the current cash session via POST /api/pos/cash-sessions/:id/close
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
      const slot = fn.includes("receipt-packet")
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
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
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
      ledgerPosting: "not-posted",
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
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["pos", "workspace"],
    });
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
