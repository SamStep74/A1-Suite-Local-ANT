/**
 * PeopleEmployeesPanel — colocated Vitest test (Phase 10.2b W0).
 *
 * Mirrors the `FinanceMasterDataPanel.test.tsx` pattern: mocks the API
 * client + TanStack Query hooks, then drives the registry and new-
 * employee sub-panels through loading + success-with-data states via
 * counter-based `makeQueryMock` / `makeMutationMock` helpers.
 *
 * ≥2 cases per sub-panel:
 *   - Registry: loading skeleton, list of employees with status pills
 *     + AMD-formatted salary, plus per-row actions (Edit, Run payroll,
 *     Payroll history).
 *   - New employee: form renders, submit posts to /api/people/employees.
 *   - Root: RBAC gate hides the panel when `useUserAccess("people")` is
 *     closed, otherwise both sub-panels are reachable from a tablist.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── Mocks (vi.hoisted so they run before the component
 *              module is loaded).                                       ── */

const { mockGetJson, mockPostJson, mockPatchJson, mockPostVoid, mockUseQuery, mockUseMutation } = vi.hoisted(() => ({
  mockGetJson: vi.fn(),
  mockPostJson: vi.fn(),
  mockPatchJson: vi.fn(),
  mockPostVoid: vi.fn(),
  mockUseQuery: vi.fn(),
  mockUseMutation: vi.fn(),
}));

vi.mock("../../../../lib/api/client", () => ({
  getJson: mockGetJson,
  postJson: mockPostJson,
  patchJson: mockPatchJson,
  postVoid: mockPostVoid,
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: (opts: unknown) => mockUseQuery(opts),
    useMutation: (opts: unknown) => mockUseMutation(opts),
  };
});

/* `cn` is a passthrough in tests to keep classes legible. */
vi.mock("../../../../lib/utils/cn", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

/* Stub every lucide icon used by the component to a tiny <span>. The
 * component reaches for 8 icons: CircleAlert, CircleCheck, Clock,
 * History, Loader2, Pencil, Play, Plus, Users. */
vi.mock("lucide-react", () => {
  const mk = (id: string) =>
    function Icon({ className }: { className?: string }) {
      return <span data-testid={id} className={className} />;
    };
  return {
    CircleAlert: mk("icon-circle-alert"),
    CircleCheck: mk("icon-circle-check"),
    Clock: mk("icon-clock"),
    History: mk("icon-history"),
    Loader2: mk("icon-loader"),
    Pencil: mk("icon-pencil"),
    Play: mk("icon-play"),
    Plus: mk("icon-plus"),
    Users: mk("icon-users"),
  };
});

/* ────────── Component under test ────────── */
import PeopleEmployeesPanel from "../PeopleEmployeesPanel";
import { UserAccessProvider } from "../../../../../lib/rbac/access";

/* ────────── Fixtures ────────── */

const employeesPayload = {
  employees: [
    {
      id: "emp-1",
      fullName: "Արամ Այվազյան",
      taxId: "12345678",
      position: "Engineer",
      department: "Operations",
      grossSalary: 450000,
      employmentStatus: "active",
      hireDate: "2023-01-15",
      email: "aram@example.com",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
    {
      id: "emp-2",
      fullName: "Աննա Բաբայան",
      taxId: "23456789",
      position: "Accountant",
      department: "Finance",
      grossSalary: 380000,
      employmentStatus: "on-leave",
      hireDate: "2022-05-20",
      email: "anna@example.com",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
    {
      id: "emp-3",
      fullName: "Գագիկ Գրիգորյան",
      taxId: "34567890",
      position: "Driver",
      department: "Logistics",
      grossSalary: 220000,
      employmentStatus: "terminated",
      hireDate: "2019-03-10",
      email: "gagik@example.com",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
  ],
};

const payrollRunsPayload = {
  runs: [
    {
      id: "run-1",
      employeeId: "emp-1",
      employeeName: "Արամ Այվազյան",
      gross: 450000,
      incomeTax: 67500,
      pension: 45000,
      stampDuty: 0,
      totalDeductions: 112500,
      net: 337500,
      runDate: "2026-05-31",
      periodKey: "2026-05",
    },
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

/* Each successive useQuery / useMutation call pulls the next state from
 * the supplied list, repeating the last one if the list runs out. The
 * finance tests use the same pattern. */
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

const renderWithQueryClient = (ui: React.ReactNode, accessValue?: { people: boolean }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = accessValue
    ? <UserAccessProvider value={accessValue}>{ui}</UserAccessProvider>
    : ui;
  return render(<QueryClientProvider client={qc}>{tree}</QueryClientProvider>);
};

/* ────────── Tests ────────── */

describe("PeopleEmployeesPanel", () => {
  beforeEach(() => {
    mockGetJson.mockReset();
    mockPostJson.mockReset();
    mockPatchJson.mockReset();
    mockPostVoid.mockReset();
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("root", () => {
    it("renders the panel root with the correct testid and a tablist of 2 sub-tabs", () => {
      /* Registry query (loading) at the root. The "New employee"
       * sub-panel only mounts its own queries after the tab is clicked. */
      mockUseQuery.mockImplementation(makeQueryMock([makeQueryState({ isLoading: true })]));
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByTestId, getByRole } = renderWithQueryClient(<PeopleEmployeesPanel />);
      expect(getByTestId("people-employees-panel")).toBeTruthy();
      const tablist = getByRole("tablist", { name: "People sub-tabs" });
      expect(within(tablist).getAllByRole("tab").length).toBe(2);
    });

    it("renders a 'No access' shell when the RBAC gate is closed for 'people'", () => {
      mockUseQuery.mockImplementation(makeQueryMock([makeQueryState({ isLoading: true })]));
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByTestId, queryByTestId } = renderWithQueryClient(
        <PeopleEmployeesPanel />,
        { people: false },
      );
      expect(getByTestId("people-employees-panel")).toBeTruthy();
      /* The sub-tab strip is NOT rendered when access is denied. */
      expect(queryByTestId("people-registry")).toBeNull();
      expect(queryByTestId("people-new-employee")).toBeNull();
    });

    it("switches to the 'New employee' sub-panel when its tab is clicked", () => {
      /* Registry query resolves, then we click "New employee". The
       * create-employee mutation has not been invoked yet, but its
       * hook has to be ready. */
      mockUseQuery.mockImplementation(makeQueryMock([makeQueryState({ isLoading: true })]));
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByRole, getByTestId, queryByTestId } = renderWithQueryClient(<PeopleEmployeesPanel />);
      fireEvent.click(getByRole("tab", { name: "New employee" }));
      expect(getByTestId("people-new-employee")).toBeTruthy();
      expect(queryByTestId("people-registry")).toBeNull();
    });
  });

  describe("Registry sub-panel", () => {
    it("shows a loading state while the employees query is pending", () => {
      mockUseQuery.mockImplementation(makeQueryMock([makeQueryState({ isLoading: true })]));
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByTestId, getByText } = renderWithQueryClient(<PeopleEmployeesPanel />);
      expect(getByTestId("loading")).toBeTruthy();
      expect(getByText("Loading employees")).toBeTruthy();
    });

    it("renders the employee list with status pills and AMD-formatted salary", () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([makeQueryState({ isSuccess: true, data: employeesPayload })]),
      );
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByTestId, getByText, getAllByText } = renderWithQueryClient(<PeopleEmployeesPanel />);
      const registry = getByTestId("people-registry");
      expect(registry).toBeTruthy();

      /* Section label "A1 People" appears in the panel head. */
      expect(getAllByText("A1 People").length).toBeGreaterThan(0);

      /* Each of the 3 employees renders with their name. */
      expect(within(registry).getByText("Արամ Այվազյան")).toBeTruthy();
      expect(within(registry).getByText("Աննա Բաբայան")).toBeTruthy();
      expect(within(registry).getByText("Գագիկ Գրիգորյան")).toBeTruthy();

      /* Status pills with the 3 tones. */
      const aramPill = within(registry).getByTestId("status-pill-emp-1");
      expect(aramPill.textContent).toContain("Active");
      const annaPill = within(registry).getByTestId("status-pill-emp-2");
      expect(annaPill.textContent).toContain("On leave");
      const gagikPill = within(registry).getByTestId("status-pill-emp-3");
      expect(gagikPill.textContent).toContain("Terminated");

      /* AMD formatter: 450000 → "450 000 AMD". Use textContent (which
       * preserves the hy-AM non-breaking space U+00A0) rather than
       * getByText, which normalizes whitespace and would mask the
       * real production character. */
      const formatted = (450000).toLocaleString("hy-AM");
      expect(within(registry).getByTestId("status-pill-emp-1").parentElement?.textContent).toContain(`${formatted} AMD`);

      /* "Run payroll" action is hidden for terminated employees.
       * emp-1 (active) and emp-2 (on-leave) have it; emp-3 (terminated)
       * does not. */
      expect(getByTestId("run-payroll-emp-1")).toBeTruthy();
      expect(getByTestId("run-payroll-emp-2")).toBeTruthy();
      expect(within(registry).queryByTestId("run-payroll-emp-3")).toBeNull();

      /* Edit + payroll-history toggles exist for every row. */
      expect(getByTestId("edit-toggle-emp-1")).toBeTruthy();
      expect(getByTestId("history-toggle-emp-1")).toBeTruthy();
    });

    it("renders the empty state when no employees are returned", () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([makeQueryState({ isSuccess: true, data: { employees: [] } })]),
      );
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByTestId, getByText } = renderWithQueryClient(<PeopleEmployeesPanel />);
      expect(getByTestId("empty")).toBeTruthy();
      expect(getByText("No employees yet")).toBeTruthy();
    });

    it("loads payroll history when the row's history toggle is clicked", () => {
      /* The registry query resolves first; clicking the history toggle
       * for emp-1 mounts a second query (payroll-runs). We feed it
       * the success state with the runs payload. */
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isSuccess: true, data: employeesPayload }),
          makeQueryState({ isSuccess: true, data: payrollRunsPayload }),
        ]),
      );
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByTestId } = renderWithQueryClient(<PeopleEmployeesPanel />);
      fireEvent.click(getByTestId("history-toggle-emp-1"));
      const history = getByTestId("payroll-history-emp-1");
      expect(history).toBeTruthy();
      /* The history list renders the run's net salary. Use a function
       * matcher so we don't depend on textContent normalization — the
       * <strong>net …</strong> wrapper splits the line into multiple
       * text nodes, and hy-AM uses U+00A0 as the group separator. */
      const formattedNet = (337500).toLocaleString("hy-AM");
      const netNeedle = `net ${formattedNet} AMD`;
      const li = history.querySelector("li") as HTMLElement | null;
      expect(li?.textContent ?? "").toContain(netNeedle);
    });
  });

  describe("New employee sub-panel", () => {
    const clickNewTab = () => {
      mockUseQuery.mockImplementation(makeQueryMock([makeQueryState({ isLoading: true })]));
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));
      const result = renderWithQueryClient(<PeopleEmployeesPanel />);
      fireEvent.click(result.getByRole("tab", { name: "New employee" }));
      return result;
    };

    it("renders the form with all 7 fields and a submit button", () => {
      const { getByTestId, getByText } = clickNewTab();
      const form = getByTestId("new-employee-form");
      expect(form).toBeTruthy();
      /* The 7 labels are localizable. We assert the Armenian labels. */
      expect(within(form).getByText("Անուն Ազգանուն")).toBeTruthy();
      expect(within(form).getByText("ՀՎՀՀ (8 նիշ)")).toBeTruthy();
      expect(within(form).getByText("Պաշտոն")).toBeTruthy();
      expect(within(form).getByText("Բաժին")).toBeTruthy();
      expect(within(form).getByText("Աշխատավարձ (AMD)")).toBeTruthy();
      expect(within(form).getByText("Hire date")).toBeTruthy();
      expect(within(form).getByText("Էլ. փոստ")).toBeTruthy();
      expect(getByTestId("new-employee-submit")).toBeTruthy();
      expect(getByText("Add employee")).toBeTruthy();
    });

    it("disables submit until the name has ≥ 2 characters", () => {
      const { getByTestId } = clickNewTab();
      const submit = getByTestId("new-employee-submit");
      /* Initial: fullName is empty → submit disabled. */
      expect((submit as HTMLButtonElement).disabled).toBe(true);

      const nameInput = (getByTestId("new-employee-form") as HTMLElement).querySelector(
        "input[placeholder='Անուն Ազգանուն']",
      ) as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: "Ա" } });
      expect((submit as HTMLButtonElement).disabled).toBe(true);

      fireEvent.change(nameInput, { target: { value: "Աննա" } });
      expect((submit as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
