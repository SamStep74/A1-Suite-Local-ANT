/**
 * PeopleHrOpsPanel — colocated Vitest test (Phase 10.2b W1, hr-ops).
 *
 * Mocks the API client and TanStack Query so we can deterministically
 * drive the 3 sub-panels (Contracts, Leave, Trips) through their
 * loading + success-with-data states.
 *
 * Per task spec: ≥2 cases per sub-panel (loading, success-with-data).
 * The Contracts sub-panel additionally exercises an error state because
 * it owns 2 queries (employees + templates) and we want to verify the
 * error fallback.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, within } from "@testing-library/react";
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

/* Intercept TanStack Query hooks so tests can drive the
 * loading / success / error states deterministically. */
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
  CircleAlert: ({ className }: { className?: string }) => (
    <span data-testid="icon-circle-alert" className={className} />
  ),
  FileText: ({ className }: { className?: string }) => (
    <span data-testid="icon-file-text" className={className} />
  ),
  Loader2: ({ className }: { className?: string }) => (
    <span data-testid="icon-loader" className={className} />
  ),
  Plane: ({ className }: { className?: string }) => (
    <span data-testid="icon-plane" className={className} />
  ),
  Wallet: ({ className }: { className?: string }) => (
    <span data-testid="icon-wallet" className={className} />
  ),
}));

/* ────────── Component under test ────────── */
import PeopleHrOpsPanel from "../PeopleHrOpsPanel";

/* ────────── Fixtures ────────── */

const employeesPayload = {
  employees: [
    {
      id: "emp-1",
      fullName: "Anahit Sargsyan",
      taxId: "001234567",
      position: "Accountant",
      department: "Finance",
      grossSalary: 350000,
      employmentStatus: "active",
      hireDate: "2024-03-01",
      email: "anahit@example.com",
      updatedAt: "2026-05-12T10:00:00Z",
    },
    {
      id: "emp-2",
      fullName: "Hayk Mkrtchyan",
      taxId: "001234568",
      position: "Sales",
      department: "Sales",
      grossSalary: 280000,
      employmentStatus: "active",
      hireDate: "2025-01-15",
      email: "hayk@example.com",
      updatedAt: "2026-05-12T10:00:00Z",
    },
  ],
};

const contractTemplatesPayload = {
  templates: [
    { code: "permanent", label: "Անժամկետ" },
    { code: "fixed-term", label: "Որոշակի ժամկետ" },
    { code: "part-time", label: "Մասնակի զբաղվածություն" },
  ],
};

const contractResponsePayload = {
  contract: {
    id: "ct-9001",
    employeeId: "emp-1",
    templateCode: "permanent",
    position: "Senior Accountant",
    startDate: "2026-07-01",
    endDate: null,
    grossSalary: 420000,
    bodyMd:
      "# Employment contract\n\nThis is a stub contract body used by the test. It should appear inside a <pre> block in the result section so the user can review the generated terms before printing or downloading.",
    status: "draft" as const,
  },
};

const leaveResponsePayload = {
  leaveRequest: {
    id: "lr-21",
    employeeId: "emp-1",
    kind: "annual" as const,
    startDate: "2026-07-01",
    endDate: "2026-07-10",
    days: 10,
    reason: "Family vacation",
    status: "pending" as const,
    approverId: null,
  },
};

const tripResponsePayload = {
  trip: {
    id: "tr-77",
    employeeId: "emp-2",
    destination: "Gyumri",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    allowance: {
      perDiem: 10000,
      days: 3,
      transportation: 5000,
      total: 35000,
    },
  },
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
  reset: () => void;
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
  reset: vi.fn(),
  ...overrides,
});

/* Drives useQuery calls in invocation order. The component calls
 * useQuery for employees + (templates on contracts tab) and the
 * mock factory indexes into a fixed array per call. */
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

describe("PeopleHrOpsPanel", () => {
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
    it("renders the panel with the correct testid and a 3-tab list", () => {
      /* Employees query is loading; default tab is contracts, so the
       * templates query is also loading; mutation is idle. */
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isLoading: true }),
          makeQueryState({ isLoading: true }),
        ]),
      );
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByTestId, getByRole } = renderWithQueryClient(<PeopleHrOpsPanel />);
      expect(getByTestId("people-hr-ops-panel")).toBeTruthy();
      const tablist = getByRole("tablist", { name: "People HR-ops sub-tabs" });
      expect(tablist.querySelectorAll('[role="tab"]').length).toBe(3);
    });

    it("switches sub-panels when a tab is clicked", () => {
      /* Leave / Trips need only an employees query; provide 3 buffered
       * query states (employees + templates for default tab, then
       * employees-only for the next click). */
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isLoading: true }),
          makeQueryState({ isLoading: true }),
          makeQueryState({ isLoading: true }),
        ]),
      );
      mockUseMutation.mockImplementation(
        makeMutationMock([makeMutationState(), makeMutationState()]),
      );

      const { getByRole, getByText } = renderWithQueryClient(<PeopleHrOpsPanel />);

      /* Default tab is "Contracts" — loading message references both
       * employees and templates. */
      expect(getByText("Loading employees and templates")).toBeTruthy();

      /* Click "Leave" — should show the leave-specific loading. */
      fireEvent.click(getByRole("tab", { name: "Leave" }));
      expect(getByText("Loading employees")).toBeTruthy();
    });
  });

  describe("Contracts sub-panel", () => {
    it("shows a loading state while employees + templates queries are pending", () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isLoading: true }),
          makeQueryState({ isLoading: true }),
        ]),
      );
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByTestId, getByText } = renderWithQueryClient(<PeopleHrOpsPanel />);
      expect(getByTestId("hr-contracts-subpanel")).toBeTruthy();
      expect(getByText("Loading employees and templates")).toBeTruthy();
    });

    it("renders the form with employees + templates dropdowns when data resolves", () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isSuccess: true, data: employeesPayload }),
          makeQueryState({ isSuccess: true, data: contractTemplatesPayload }),
        ]),
      );
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByTestId, getByText, getAllByText } = renderWithQueryClient(<PeopleHrOpsPanel />);

      const form = getByTestId("hr-contracts-form");
      expect(form).toBeTruthy();

      /* Active employees appear in the dropdown. */
      const employeeSelect = getByTestId("hr-contract-employee") as HTMLSelectElement;
      expect(employeeSelect).toBeTruthy();
      const employeeOptions = Array.from(employeeSelect.querySelectorAll("option")).map(
        (o) => o.textContent,
      );
      expect(employeeOptions).toContain("Anahit Sargsyan");
      expect(employeeOptions).toContain("Hayk Mkrtchyan");

      /* Template labels appear in the template dropdown. The Armenian
       * labels also appear in <option> + panel header, so use getAll. */
      const templateSelect = getByTestId("hr-contract-template") as HTMLSelectElement;
      const templateOptions = Array.from(templateSelect.querySelectorAll("option")).map(
        (o) => o.textContent,
      );
      expect(templateOptions).toContain("Անժամկետ");
      expect(templateOptions).toContain("Որոշակի ժամկետ");

      /* The active-employees badge in the panel header. */
      expect(getAllByText("2 active").length).toBeGreaterThan(0);
      /* The submit button. */
      expect(getByText("Ստեղծել")).toBeTruthy();
    });

    it("falls back to FALLBACK_TEMPLATES when the server returns an empty template list", () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isSuccess: true, data: employeesPayload }),
          makeQueryState({ isSuccess: true, data: { templates: [] } }),
        ]),
      );
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByTestId } = renderWithQueryClient(<PeopleHrOpsPanel />);
      const templateSelect = getByTestId("hr-contract-template") as HTMLSelectElement;
      const options = Array.from(templateSelect.querySelectorAll("option")).map(
        (o) => o.textContent,
      );
      /* The 6 fallback labels should all be present. */
      expect(options).toContain("Անժամկետ");
      expect(options).toContain("Որոշակի ժամկետ");
      expect(options).toContain("Մասնակի զբաղվածություն");
      expect(options).toContain("Պրակտիկա");
      expect(options).toContain("Հեռավար");
      expect(options).toContain("Վերագրում");
    });

    it("renders an error state when the employees query rejects", () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isError: true, error: new Error("employees-fail") }),
          makeQueryState({ isSuccess: true, data: contractTemplatesPayload }),
        ]),
      );
      mockUseMutation.mockImplementation(makeMutationMock([makeMutationState()]));

      const { getByTestId, getByText } = renderWithQueryClient(<PeopleHrOpsPanel />);
      expect(getByTestId("error")).toBeTruthy();
      expect(getByText("employees-fail")).toBeTruthy();
    });

    it("renders the success result block after a contract is created", () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isSuccess: true, data: employeesPayload }),
          makeQueryState({ isSuccess: true, data: contractTemplatesPayload }),
        ]),
      );
      mockUseMutation.mockImplementation(
        makeMutationMock([
          makeMutationState({ isSuccess: true, data: contractResponsePayload }),
        ]),
      );

      const { getByTestId } = renderWithQueryClient(<PeopleHrOpsPanel />);
      const result = getByTestId("hr-contract-result");
      expect(result).toBeTruthy();
      expect(result.textContent).toContain("ct-9001");
      expect(result.textContent).toContain("draft");
    });
  });

  describe("Leave sub-panel", () => {
    const clickLeaveTab = () => {
      /* contracts tab fires 2 queries (employees + templates); leave
       * tab fires 1 (employees). The mock factory uses the LAST state
       * once we exhaust the array, so the rest are inert. */
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isSuccess: true, data: employeesPayload }),
          makeQueryState({ isSuccess: true, data: contractTemplatesPayload }),
          makeQueryState({ isSuccess: true, data: employeesPayload }),
        ]),
      );
      mockUseMutation.mockImplementation(
        makeMutationMock([makeMutationState(), makeMutationState()]),
      );
      const result = renderWithQueryClient(<PeopleHrOpsPanel />);
      fireEvent.click(result.getByRole("tab", { name: "Leave" }));
      return result;
    };

    it("shows a loading state while the employees query is pending", () => {
      /* After the default contracts tab queries settle, the leave tab
       * query mounts in loading state. */
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isLoading: true }),
          makeQueryState({ isLoading: true }),
          makeQueryState({ isLoading: true }),
        ]),
      );
      mockUseMutation.mockImplementation(
        makeMutationMock([makeMutationState(), makeMutationState()]),
      );

      const { getByRole, getByText } = renderWithQueryClient(<PeopleHrOpsPanel />);
      fireEvent.click(getByRole("tab", { name: "Leave" }));
      expect(getByText("Loading employees")).toBeTruthy();
    });

    it("renders the leave form with employees and kind dropdowns when data resolves", () => {
      const { getByTestId, getByText } = clickLeaveTab();
      const form = getByTestId("hr-leave-form");
      expect(form).toBeTruthy();

      /* The TODO note about the approval queue is rendered. */
      expect(getByText(/Approval is handled by the dedicated approval queue/)).toBeTruthy();

      /* The 3 kind options are present. */
      const kindSelect = getByTestId("hr-leave-kind") as HTMLSelectElement;
      const kindOptions = Array.from(kindSelect.querySelectorAll("option")).map(
        (o) => o.textContent,
      );
      expect(kindOptions).toContain("Տարեկան հիմնական");
      expect(kindOptions).toContain("Հիվանդության");
      expect(kindOptions).toContain("Անարձակուրդ");
    });

    it("renders the success result block after a leave request is filed", () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isSuccess: true, data: employeesPayload }),
          makeQueryState({ isSuccess: true, data: contractTemplatesPayload }),
          makeQueryState({ isSuccess: true, data: employeesPayload }),
        ]),
      );
      mockUseMutation.mockImplementation(
        makeMutationMock([
          makeMutationState(),
          makeMutationState({ isSuccess: true, data: leaveResponsePayload }),
        ]),
      );

      const { getByRole, getByTestId } = renderWithQueryClient(<PeopleHrOpsPanel />);
      fireEvent.click(getByRole("tab", { name: "Leave" }));

      const result = getByTestId("hr-leave-result");
      expect(result).toBeTruthy();
      expect(result.textContent).toContain("lr-21");
      expect(result.textContent).toContain("pending");
      /* Scope to the result block — the panel also contains "10.4" in
       * the approval-queue TODO note, which would confuse getByText. */
      expect(within(result).getByText("10")).toBeTruthy();
    });
  });

  describe("Trips sub-panel", () => {
    const clickTripsTab = () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isSuccess: true, data: employeesPayload }),
          makeQueryState({ isSuccess: true, data: contractTemplatesPayload }),
          makeQueryState({ isSuccess: true, data: employeesPayload }),
        ]),
      );
      mockUseMutation.mockImplementation(
        makeMutationMock([makeMutationState(), makeMutationState()]),
      );
      const result = renderWithQueryClient(<PeopleHrOpsPanel />);
      fireEvent.click(result.getByRole("tab", { name: "Trips" }));
      return result;
    };

    it("shows a loading state while the employees query is pending", () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isLoading: true }),
          makeQueryState({ isLoading: true }),
          makeQueryState({ isLoading: true }),
        ]),
      );
      mockUseMutation.mockImplementation(
        makeMutationMock([makeMutationState(), makeMutationState()]),
      );

      const { getByRole, getByText } = renderWithQueryClient(<PeopleHrOpsPanel />);
      fireEvent.click(getByRole("tab", { name: "Trips" }));
      expect(getByText("Loading employees")).toBeTruthy();
    });

    it("renders the trip form with employees, destination, dates, per-diem, transport when data resolves", () => {
      const { getByTestId, getByText } = clickTripsTab();
      const form = getByTestId("hr-trips-form");
      expect(form).toBeTruthy();

      /* Employee dropdown is populated. */
      const employeeSelect = getByTestId("hr-trip-employee") as HTMLSelectElement;
      const empOptions = Array.from(employeeSelect.querySelectorAll("option")).map(
        (o) => o.textContent,
      );
      expect(empOptions).toContain("Anahit Sargsyan");
      expect(empOptions).toContain("Hayk Mkrtchyan");

      /* The submit button text. */
      expect(getByText("Ստեղծել")).toBeTruthy();
    });

    it("renders the success result block with the computed allowance after a trip is created", () => {
      mockUseQuery.mockImplementation(
        makeQueryMock([
          makeQueryState({ isSuccess: true, data: employeesPayload }),
          makeQueryState({ isSuccess: true, data: contractTemplatesPayload }),
          makeQueryState({ isSuccess: true, data: employeesPayload }),
        ]),
      );
      mockUseMutation.mockImplementation(
        makeMutationMock([
          makeMutationState(),
          makeMutationState({ isSuccess: true, data: tripResponsePayload }),
        ]),
      );

      const { getByRole, getByTestId, getByText } = renderWithQueryClient(<PeopleHrOpsPanel />);
      fireEvent.click(getByRole("tab", { name: "Trips" }));

      const result = getByTestId("hr-trip-result");
      expect(result).toBeTruthy();
      expect(result.textContent).toContain("tr-77");
      /* 35,000 AMD is the total allowance: 10000 × 3 + 5000.
       * The component formats via toLocaleString("hy-AM"), which uses
       * a non-breaking space (U+00A0) as the thousands separator
       * (so "35 000", not "35,000"). Use a regex to match any
       * whitespace character. */
      expect(result.textContent).toMatch(/35\s*000/);
      expect(getByText(/3d/)).toBeTruthy();
    });
  });
});
