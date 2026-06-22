/**
 * /app/pos — route-level tests for the POS cash-session spine.
 *
 * Covers Slice 420 frontend behavior:
 *   - loading and error states for /api/pos/workspace
 *   - opening a cash session via POST /api/pos/cash-sessions
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
      const slot = fn.includes("/:id/close") || fn.includes("${input.sessionId}/close")
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
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
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
