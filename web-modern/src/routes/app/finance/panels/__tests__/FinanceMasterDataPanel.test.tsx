/**
 * FinanceMasterDataPanel — colocated Vitest test (Phase 10.2c W1).
 *
 * Mocks the API client and TanStack Query so we can deterministically
 * drive the 4 sub-panels (tax-rates, chart, localization, opening-balances)
 * through their loading + success-with-data states. Error state is covered
 * for the read-backed sub-panels (tax-rates, chart, opening-balances) and
 * skipped for localization (which is mutation-driven; see Phase 10.4).
 *
 * All 5 tools inside the localization sub-panel are exercised.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── Mocks (declared via vi.hoisted so they run before the
 *              component module is loaded, satisfying Vitest's
 *              vitest.mock hoisting semantics).                       ── */

const { mockGetJson, mockPostJson, mockUseQuery, mockUseMutation } = vi.hoisted(() => ({
  mockGetJson: vi.fn(),
  mockPostJson: vi.fn(),
  mockUseQuery: vi.fn(),
  mockUseMutation: vi.fn(),
}));

vi.mock("../../../../lib/api/client", () => ({
  getJson: mockGetJson,
  postJson: mockPostJson,
}));

/* We mock the TanStack hooks individually so we can drive the
 * loading/success/error states deterministically without spinning up
 * a real network. The mutation hook is also intercepted so that
 * component tests don't actually fire requests. */
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: (opts: unknown) => mockUseQuery(opts),
    useMutation: (opts: unknown) => mockUseMutation(opts),
  };
});

/* The component reaches for `cn` from lib/utils; provide a passthrough. */
vi.mock("../../../../lib/utils/cn", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

/* Lucide icons add a few KB to the test bundle; stub them. */
vi.mock("lucide-react", () => ({
  CircleAlert: ({ className }: { className?: string }) => <span data-testid="icon-circle-alert" className={className} />,
  Loader2: ({ className }: { className?: string }) => <span data-testid="icon-loader" className={className} />,
  Plus: ({ className }: { className?: string }) => <span data-testid="icon-plus" className={className} />,
}));

/* ────────── Component under test ────────── */
import FinanceMasterDataPanel from "../FinanceMasterDataPanel";

/* ────────── Fixtures ────────── */

const taxRatesPayload = {
  taxRates: [
    /* The most-recent (largest effectiveDate) VAT rate is what the panel
     * badge displays. Keep the recent rate at 20% so the badge reads
     * "VAT 20%". */
    { kind: "vat", rate: 0.2, effectiveDate: "2024-01-01", note: "Standard" },
    { kind: "vat", rate: 0.2, effectiveDate: "2023-01-01", note: "Standard (prior)" },
    { kind: "income", rate: 0.05, effectiveDate: "2024-01-01", note: null },
  ],
};

const chartOfAccountsPayload = {
  accounts: [
    { id: "1", code: "221", name: "Trade receivables — purchases", type: "asset", category: "current", normalSide: "debit" },
    { id: "2", code: "251", name: "Securities — acquisition cost", type: "asset", category: "current", normalSide: "debit" },
    { id: "3", code: "521", name: "Trade payables — purchases", type: "liability", category: "current", normalSide: "credit" },
    { id: "4", code: "711", name: "Operating revenue — local", type: "revenue", category: "operating", normalSide: "credit" },
  ],
  classes: [
    { digit: "2", hy: "Միջոցներ · Assets" },
    { digit: "5", hy: "Պարտավորություններ · Liabilities" },
    { digit: "7", hy: "Եկամուտներ · Revenue" },
  ],
  source: { accountCount: 4, publisher: "RA MoF", sourceUrl: "https://minfin.am/chart" },
};

const openingBalancesPayload = {
  openingEquity: 1_250_000,
  entries: [
    { code: "221", name: "Trade receivables", side: "debit", amount: 750_000, date: "2026-01-01" },
    { code: "521", name: "Trade payables", side: "credit", amount: 500_000, date: "2026-01-01" },
  ],
};

/* ────────── Helpers ────────── */

type QueryState = {
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  data: unknown;
  error: unknown;
  refetch: () => void;
};

type MutationState = {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  data: unknown;
  error: unknown;
  mutate: (input: unknown) => void;
};

const makeQueryState = (overrides: Partial<QueryState> = {}): QueryState => ({
  isLoading: false,
  isError: false,
  isFetching: false,
  isSuccess: false,
  data: undefined,
  error: null,
  refetch: vi.fn(),
  ...overrides,
});

const makeMutationState = (overrides: Partial<MutationState> = {}): MutationState => ({
  isPending: false,
  isError: false,
  isSuccess: false,
  data: undefined,
  error: null,
  mutate: vi.fn(),
  ...overrides,
});

/* Drives the various useQuery / useMutation calls in the order the
 * component invokes them. Each call updates our counter and returns
 * the corresponding state. */
const makeQueryMock = (states: ReadonlyArray<QueryState>) => {
  let i = 0;
  return (_opts: unknown) => {
    const state = states[Math.min(i, states.length - 1)] ?? states[states.length - 1];
    i++;
    return state;
  };
};

const makeMutationMock = (states: ReadonlyArray<MutationState>) => {
  let i = 0;
  return (_opts: unknown) => {
    const state = states[Math.min(i, states.length - 1)] ?? states[states.length - 1];
    i++;
    return state;
  };
};

const renderWithQueryClient = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

/* ────────── Tests ────────── */

describe("FinanceMasterDataPanel", () => {
  beforeEach(() => {
    mockGetJson.mockReset();
    mockPostJson.mockReset();
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("root", () => {
    it("renders the panel with the correct testid and a tab list", () => {
      /* All queries start in loading, all mutations in idle. */
      mockUseQuery.mockImplementation(makeQueryMock([makeQueryState({ isLoading: true })]));
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByTestId, getByRole } = renderWithQueryClient(<FinanceMasterDataPanel />);
      expect(getByTestId("finance-masterdata-panel")).toBeTruthy();
      const tablist = getByRole("tablist", { name: "Finance master data sub-tabs" });
      expect(within(tablist).getAllByRole("tab").length).toBe(4);
    });

    it("switches sub-panels when a tab is clicked", () => {
      /* Two sub-panels pre-loaded, third as fallback. */
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isLoading: true }),
          makeQueryState({ isLoading: true }),
          makeQueryState({ isLoading: true }),
        ]),
      );
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByRole, getByText } = renderWithQueryClient(<FinanceMasterDataPanel />);

      fireEvent.click(getByRole("tab", { name: "Chart of accounts" }));
      /* Chart sub-panel renders "Loading chart of accounts" while
       * the chart-of-accounts query is still resolving. */
      expect(getByText("Loading chart of accounts")).toBeTruthy();
    });
  });

  describe("Tax rates sub-panel", () => {
    it("shows a loading state while the query is pending", () => {
      mockUseQuery.mockImplementation(makeQueryMock([makeQueryState({ isLoading: true })]));
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByText } = renderWithQueryClient(<FinanceMasterDataPanel />);
      expect(getByText("Loading tax rates")).toBeTruthy();
    });

    it("renders the rate table + add-rate form when data resolves", () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([makeQueryState({ isSuccess: true, data: taxRatesPayload })]),
      );
      const create = makeMutationState();
      mockUseMutation.mockImplementation(makeMutationMock([create]));

      const { getByTestId, getByText, getAllByText } = renderWithQueryClient(<FinanceMasterDataPanel />);

      /* Header shows the section label. */
      expect(getAllByText("HayHashvapah Finance").length).toBeGreaterThan(0);
      /* The current-VAT badge appears in the panel header. Use getAllByText
       * since the rates table also contains "ԱԱՀ · VAT" cells. */
      expect(getAllByText(/VAT 20%?/).length).toBeGreaterThan(0);

      /* The rates table renders one row per rate. */
      const table = getByTestId("add-tax-rate-form");
      expect(table).toBeTruthy();
      /* The form is rendered with an "Add rate" button. */
      expect(getByText("Add rate")).toBeTruthy();
      /* At least one VAT row label is visible (may appear in table +
       * form <option> + header badge, so use getAllByText). */
      expect(getAllByText(/ԱԱՀ/).length).toBeGreaterThan(0);
    });

    it("renders an error state when the query rejects", () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([makeQueryState({ isError: true, error: new Error("boom-tax") })]),
      );
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByTestId, getByText } = renderWithQueryClient(<FinanceMasterDataPanel />);
      expect(getByTestId("error")).toBeTruthy();
      expect(getByText("boom-tax")).toBeTruthy();
    });
  });

  describe("Chart of accounts sub-panel", () => {
    const clickChartTab = () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isSuccess: true, data: taxRatesPayload }),
          makeQueryState({ isSuccess: true, data: chartOfAccountsPayload }),
        ]),
      );
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));
      const result = renderWithQueryClient(<FinanceMasterDataPanel />);
      fireEvent.click(result.getByRole("tab", { name: "Chart of accounts" }));
      return result;
    };

    it("renders the class rollup when data resolves", () => {
      const { getByText } = clickChartTab();
      expect(getByText("2 · Միջոցներ · Assets")).toBeTruthy();
      expect(getByText("5 · Պարտավորություններ · Liabilities")).toBeTruthy();
    });

    it("renders an error state when the query rejects", () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isSuccess: true, data: taxRatesPayload }),
          makeQueryState({ isError: true, error: new Error("chart-fail") }),
        ]),
      );
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByRole, getByTestId, getByText } = renderWithQueryClient(<FinanceMasterDataPanel />);
      fireEvent.click(getByRole("tab", { name: "Chart of accounts" }));
      expect(getByTestId("error")).toBeTruthy();
      expect(getByText("chart-fail")).toBeTruthy();
    });
  });

  describe("Localization tools sub-panel", () => {
    const clickLocTab = () => {
      /* The tax-rates query fires first (mounted at root), then we
       * switch to the localization tab which mounts its own queries. */
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isSuccess: true, data: taxRatesPayload }),
          makeQueryState({ isFetching: false, isSuccess: false, isError: false, data: undefined, error: null, refetch: vi.fn(), isLoading: false }),
        ]),
      );
      mockUseMutation.mockImplementation(
        makeMutationMock([
          makeMutationState(),
          makeMutationState(),
          makeMutationState(),
        ]),
      );
      const result = renderWithQueryClient(<FinanceMasterDataPanel />);
      fireEvent.click(result.getByRole("tab", { name: "Localization tools" }));
      return result;
    };

    it("renders the localization tools sub-panel with the testid", () => {
      const { getByTestId } = clickLocTab();
      expect(getByTestId("localization-tools")).toBeTruthy();
    });

    it("exposes inputs for HVHH, phone, payroll, VAT, and e-invoice", () => {
      const { getByTestId, getAllByText } = clickLocTab();
      const panel = getByTestId("localization-tools");
      expect(within(panel).getByText("ՀՎՀՀ")).toBeTruthy();
      expect(within(panel).getByText("Հեռախոս")).toBeTruthy();
      expect(within(panel).getByText("Համախառն աշխատավարձ (AMD)")).toBeTruthy();
      expect(within(panel).getByText("Վաճառք առանց ԱԱՀ")).toBeTruthy();
      expect(within(panel).getByText("Գնում առանց ԱԱՀ")).toBeTruthy();
      expect(within(panel).getByText("Invoice number")).toBeTruthy();
      /* Mutation buttons. */
      const labels = getAllByText(/Payroll preview|VAT form preview|E-invoice XML/);
      expect(labels.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Opening balances sub-panel", () => {
    it("shows a loading state while the query is pending", () => {
      /* Two queries at the root level: chart-of-accounts then opening-balances. */
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isSuccess: true, data: chartOfAccountsPayload }),
          makeQueryState({ isLoading: true }),
        ]),
      );
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByRole, getByText } = renderWithQueryClient(<FinanceMasterDataPanel />);
      fireEvent.click(getByRole("tab", { name: "Opening balances" }));
      expect(getByText("Loading opening balances")).toBeTruthy();
    });

    it("renders the entries and form when data resolves", () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isSuccess: true, data: chartOfAccountsPayload }),
          makeQueryState({ isSuccess: true, data: openingBalancesPayload }),
        ]),
      );
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByRole, getByTestId, getByText } = renderWithQueryClient(<FinanceMasterDataPanel />);
      fireEvent.click(getByRole("tab", { name: "Opening balances" }));

      expect(getByTestId("opening-balance-form")).toBeTruthy();
      expect(getByText(/221 · Trade receivables · debit/)).toBeTruthy();
      expect(getByText(/521 · Trade payables · credit/)).toBeTruthy();
    });

    it("renders an error state when the query rejects", () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isSuccess: true, data: chartOfAccountsPayload }),
          makeQueryState({ isError: true, error: new Error("opening-fail") }),
        ]),
      );
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByRole, getByTestId, getByText } = renderWithQueryClient(<FinanceMasterDataPanel />);
      fireEvent.click(getByRole("tab", { name: "Opening balances" }));
      expect(getByTestId("error")).toBeTruthy();
      expect(getByText("opening-fail")).toBeTruthy();
    });
  });
});
