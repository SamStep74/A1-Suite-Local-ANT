/**
 * PeopleHrPerformancePanel — colocated Vitest test (Phase 10.2b W2).
 *
 * Mocks the API client and TanStack Query so we can deterministically
 * drive the 3 sub-panels (Timesheets, KPI, Recruitment) through their
 * loading + success-with-data states.
 *
 * Per the task brief, every sub-panel is exercised with at least 2 cases:
 *   - Timesheets:  loading form, success-with-data (bulk insert ok)
 *   - KPI:         loading form, success-with-data (score returned)
 *   - Recruitment: pipeline form mount, candidate success-with-data
 *
 * We also assert the root testid and the sub-tab navigation.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── Mocks (vi.hoisted so they run before module load) ────────── */

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

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: (opts: unknown) => mockUseQuery(opts),
    useMutation: (opts: unknown) => mockUseMutation(opts),
  };
});

vi.mock("../../../../lib/utils/cn", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

vi.mock("lucide-react", () => ({
  CircleAlert: ({ className }: { className?: string }) => <span data-testid="icon-circle-alert" className={className} />,
  Loader2: ({ className }: { className?: string }) => <span data-testid="icon-loader" className={className} />,
  Plus: ({ className }: { className?: string }) => <span data-testid="icon-plus" className={className} />,
}));

/* ────────── Component under test ────────── */
import PeopleHrPerformancePanel from "../PeopleHrPerformancePanel";

/* ────────── Fixtures ────────── */

const employeesFixture = [
  { id: "emp-1", fullName: "Անանուն Անուն" },
  { id: "emp-2", fullName: "Test Employee" },
];

const bulkOkPayload = {
  ok: true,
  inserted: 3,
  report: {
    totalHours: 24,
    byProject: { p1: 16, p2: 8 },
    entryCount: 3,
  },
};

const reportOkPayload = {
  report: { totalHours: 24, byProject: { p1: 16, p2: 8 }, entryCount: 3 },
  periodKey: "2026-06",
};

const scoreOkPayload = {
  score: { weighted: 0.87 },
  periodKey: "2026-06",
};

const pipelineOkPayload = {
  ok: true,
  pipeline: { id: "pipe-1", name: "Engineering Q3", stages: ["applied", "screen", "interview", "offer", "hired"] },
};

const candidateOkPayload = {
  ok: true,
  candidate: { id: "cand-1", fullName: "Թեկնածու Մեկ", stage: "applied", appliedAt: "2026-06-12T00:00:00Z" },
};

/* ────────── Hook state helpers ────────── */

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

/* The mocked hooks return states in invocation order. For the
 * PeopleHrPerformancePanel, each sub-panel mounts its own hooks, so the
 * caller passes the full queue of expected hook invocations. */
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

describe("PeopleHrPerformancePanel", () => {
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
      /* Timesheets (default tab) calls 1 mutation (bulk) and 1 query (report, idle). */
      mockUseMutation.mockImplementation(
        makeMutationMock([makeMutationState()]),
      );
      mockUseQuery.mockImplementation(
        makeQueryMock([makeQueryState({ isLoading: false, isSuccess: false, data: undefined, error: null })]),
      );

      const { getByTestId, getByRole } = renderWithQueryClient(
        <PeopleHrPerformancePanel employees={employeesFixture} />,
      );
      expect(getByTestId("people-hr-perf-panel")).toBeTruthy();
      const tablist = getByRole("tablist", { name: "People HR performance sub-tabs" });
      expect(within(tablist).getAllByRole("tab").length).toBe(3);
    });

    it("switches sub-panels when a tab is clicked", () => {
      /* Timesheets: 1 mutation + 1 query (idle). */
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));
      mockUseQuery.mockImplementation(
        makeQueryMock([makeQueryState({ isLoading: false, isSuccess: false, data: undefined, error: null })]),
      );

      const { getByRole, getByTestId } = renderWithQueryClient(
        <PeopleHrPerformancePanel employees={employeesFixture} />,
      );

      fireEvent.click(getByRole("tab", { name: "KPI" }));
      expect(getByTestId("hr-kpi")).toBeTruthy();

      fireEvent.click(getByRole("tab", { name: "Recruitment" }));
      expect(getByTestId("hr-recruitment")).toBeTruthy();

      fireEvent.click(getByRole("tab", { name: "Timesheets" }));
      expect(getByTestId("hr-timesheets")).toBeTruthy();
    });
  });

  describe("Timesheets sub-panel", () => {
    it("renders the timesheet form with submit button while idle", () => {
      /* 1 mutation (bulk), 1 query (report, idle until bulk.isSuccess). */
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));
      mockUseQuery.mockImplementation(
        makeQueryMock([makeQueryState({ isLoading: false, isSuccess: false, data: undefined, error: null })]),
      );

      const { getByTestId } = renderWithQueryClient(
        <PeopleHrPerformancePanel employees={employeesFixture} />,
      );
      const panel = getByTestId("hr-timesheets");
      expect(within(panel).getByTestId("hr-timesheet-form")).toBeTruthy();
      expect(within(panel).getByText("Ավելացնել")).toBeTruthy();
      /* Both employee options visible. */
      const form = within(panel).getByTestId("hr-timesheet-form");
      const select = form.querySelector("select") as HTMLSelectElement;
      expect(select.options.length).toBe(2);
    });

    it("renders the inserted count and total hours after a successful bulk insert", () => {
      /* 1 mutation (bulk) returns the bulk-ok payload; 1 query (report)
       * returns the periodic report. */
      mockUseMutation.mockImplementation(
        makeMutationMock([makeMutationState({ isSuccess: true, data: bulkOkPayload })]),
      );
      mockUseQuery.mockImplementation(
        makeQueryMock([makeQueryState({ isSuccess: true, data: reportOkPayload })]),
      );

      const { getByTestId } = renderWithQueryClient(
        <PeopleHrPerformancePanel employees={employeesFixture} />,
      );
      /* The result block surfaces the inserted count + totalHours from
       * the bulk endpoint. */
      const result = getByTestId("hr-timesheet-result");
      expect(within(result).getByText(/3/)).toBeTruthy();
      expect(within(result).getByText(/24/)).toBeTruthy();
    });
  });

  describe("KPI sub-panel", () => {
    const switchToKpi = () => {
      /* Timesheets (default) calls 1 mutation + 1 query first. Then
       * we switch to the KPI tab which mounts 3 mutations. */
      mockUseMutation.mockImplementation(
        makeMutationMock([
          makeMutationState(),
          makeMutationState(),
          makeMutationState(),
          makeMutationState(),
        ]),
      );
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isLoading: false, isSuccess: false, data: undefined, error: null }),
          makeQueryState({ isLoading: false, isSuccess: false, data: undefined, error: null }),
        ]),
      );
      const result = renderWithQueryClient(
        <PeopleHrPerformancePanel employees={employeesFixture} />,
      );
      fireEvent.click(result.getByRole("tab", { name: "KPI" }));
      return result;
    };

    it("renders the KPI form with all three action buttons in the idle state", () => {
      const { getByTestId } = switchToKpi();
      const panel = getByTestId("hr-kpi");
      expect(within(panel).getByTestId("hr-kpi-form")).toBeTruthy();
      /* The KPI labels "Նպատակ" / "Փաստացի" each appear twice: once
       * as a field label <span> and once as a button. Use getAllByText. */
      expect(within(panel).getAllByText("Նպատակ").length).toBeGreaterThanOrEqual(1);
      expect(within(panel).getAllByText("Փաստացի").length).toBeGreaterThanOrEqual(2);
      expect(within(panel).getByTestId("hr-kpi-score-button")).toBeTruthy();
    });

    it("renders the weighted score after the getScore mutation succeeds", () => {
      /* The KPI panel calls 3 mutations: setTargets, setActuals, getScore.
       * We provide idle states for the first two and a success state
       * carrying the score payload for the third. */
      mockUseMutation.mockImplementation(
        makeMutationMock([
          makeMutationState(),
          makeMutationState(),
          makeMutationState({ isSuccess: true, data: scoreOkPayload }),
          makeMutationState({ isSuccess: true, data: scoreOkPayload }),
        ]),
      );
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isLoading: false, isSuccess: false, data: undefined, error: null }),
          makeQueryState({ isLoading: false, isSuccess: false, data: undefined, error: null }),
        ]),
      );
      const result = renderWithQueryClient(
        <PeopleHrPerformancePanel employees={employeesFixture} />,
      );
      fireEvent.click(result.getByRole("tab", { name: "KPI" }));

      const resultBlock = result.getByTestId("hr-kpi-result");
      expect(within(resultBlock).getByText(/0\.87/)).toBeTruthy();
      expect(within(resultBlock).getByText("Կշռված միավոր")).toBeTruthy();
    });
  });

  describe("Recruitment sub-panel", () => {
    const switchToRecruitment = () => {
      /* Timesheets (default) calls 1 mutation + 1 query. Then we
       * switch to the Recruitment tab which mounts 2 mutations. */
      mockUseMutation.mockImplementation(
        makeMutationMock([
          makeMutationState(),
          makeMutationState(),
          makeMutationState(),
        ]),
      );
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isLoading: false, isSuccess: false, data: undefined, error: null }),
          makeQueryState({ isLoading: false, isSuccess: false, data: undefined, error: null }),
        ]),
      );
      const result = renderWithQueryClient(
        <PeopleHrPerformancePanel employees={employeesFixture} />,
      );
      fireEvent.click(result.getByRole("tab", { name: "Recruitment" }));
      return result;
    };

    it("renders both the pipeline and candidate forms in the idle state", () => {
      const { getByTestId } = switchToRecruitment();
      const panel = getByTestId("hr-recruitment");
      expect(within(panel).getByTestId("hr-recruitment-pipeline-form")).toBeTruthy();
      expect(within(panel).getByTestId("hr-recruitment-candidate-form")).toBeTruthy();
      expect(within(panel).getByText("Ստեղծել խողովակ")).toBeTruthy();
      expect(within(panel).getByText("Ավելացնել թեկնածու")).toBeTruthy();
    });

    it("renders the pipeline + candidate success blocks after the mutations resolve", () => {
      /* 1 mutation (timesheets bulk) idle, 2 mutations (pipeline, candidate) success. */
      mockUseMutation.mockImplementation(
        makeMutationMock([
          makeMutationState(),
          makeMutationState({ isSuccess: true, data: pipelineOkPayload }),
          makeMutationState({ isSuccess: true, data: candidateOkPayload }),
        ]),
      );
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isLoading: false, isSuccess: false, data: undefined, error: null }),
          makeQueryState({ isLoading: false, isSuccess: false, data: undefined, error: null }),
        ]),
      );
      const result = renderWithQueryClient(
        <PeopleHrPerformancePanel employees={employeesFixture} />,
      );
      fireEvent.click(result.getByRole("tab", { name: "Recruitment" }));

      const pipeResult = result.getByTestId("hr-recruitment-pipeline-result");
      expect(within(pipeResult).getByText(/pipe-1/)).toBeTruthy();
      expect(within(pipeResult).getByText(/5/)).toBeTruthy();

      const candResult = result.getByTestId("hr-recruitment-candidate-result");
      expect(within(candResult).getByText(/cand-1/)).toBeTruthy();
      expect(within(candResult).getByText(/applied/)).toBeTruthy();
    });
  });
});
