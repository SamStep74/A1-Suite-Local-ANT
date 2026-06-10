/**
 * /app/people/$employeeId (detail route) — route-level test for the
 * employee detail surface.
 *
 * Mirrors the finance/$invoiceId.test.tsx pattern: mock the three
 * layers (Router, Query, API client), then drive the public surface.
 *
 * Coverage targets:
 *  - Loading state ("Loading employee…")
 *  - notFound() when the employee id is missing
 *  - Header: full name, position, department, hire date
 *  - Employment block: gross salary, hire date, email, tax ID
 *  - Payroll history: empty state, table rows, totals row
 *  - Action panel: tone varies by employment status
 *  - Metadata: id, email, tax id, updated date
 *  - Back-link to /app/people
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state, hoisted so vi.mock factories can see it ───── */

const mocks = vi.hoisted(() => ({
  params: { employeeId: "emp-1" as string },
  employees: null as unknown,
  runs: null as unknown,
  employeesLoading: false,
  runsLoading: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    useParams: () => mocks.params,
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
    options: cfg,
  }),
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
    params?: Record<string, string>;
  } & Record<string, unknown>) => (
    <a data-href={to} href={to} data-params={JSON.stringify(params ?? {})} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  notFound: () => {
    throw new Error("notFound() called");
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      const key = queryKey[0];
      if (key === "people-employees") {
        return {
          data: mocks.employees,
          isLoading: mocks.employeesLoading,
          isError: false,
        };
      }
      if (key === "people-payroll-runs") {
        return {
          data: mocks.runs,
          isLoading: mocks.runsLoading,
          isError: false,
        };
      }
      return { data: null, isLoading: false, isError: false };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../lib/api/client", () => ({
  getJson: vi.fn().mockResolvedValue({}),
  postJson: vi.fn().mockResolvedValue({}),
  postVoid: vi.fn().mockResolvedValue(undefined),
}));

/* ────────── import the route under test (mocks are in place by now) ─ */

import { Route } from "./$employeeId";

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

const ACTIVE_EMPLOYEE = {
  id: "emp-1",
  fullName: "Anna Hovhannisyan",
  taxId: "12345678",
  position: "Accountant",
  department: "Finance",
  grossSalary: 350000,
  employmentStatus: "active",
  hireDate: "2024-03-01",
  email: "anna@example.am",
  updatedAt: "2026-06-01T10:00:00.000Z",
};

const TERMINATED_EMPLOYEE = {
  ...ACTIVE_EMPLOYEE,
  id: "emp-9",
  fullName: "Lilit Ohanyan",
  position: "Driver",
  department: "Logistics",
  employmentStatus: "terminated",
};

const VALID_RUNS = [
  {
    id: "run-1",
    employeeId: "emp-1",
    employeeName: "Anna Hovhannisyan",
    gross: 350000,
    incomeTax: 35000,
    pension: 22500,
    stampDuty: 0,
    totalDeductions: 57500,
    net: 292500,
    runDate: "2026-05-31",
    periodKey: "2026-05",
  },
  {
    id: "run-2",
    employeeId: "emp-1",
    employeeName: "Anna Hovhannisyan",
    gross: 350000,
    incomeTax: 35000,
    pension: 22500,
    stampDuty: 0,
    totalDeductions: 57500,
    net: 292500,
    runDate: "2026-04-30",
    periodKey: "2026-04",
  },
];

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.params = { employeeId: "emp-1" };
  mocks.employees = [ACTIVE_EMPLOYEE];
  mocks.runs = VALID_RUNS;
  mocks.employeesLoading = false;
  mocks.runsLoading = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── loading / not-found ────────── */

describe("EmployeeDetail — loading + not-found", () => {
  it("shows the loading message while employees are loading", () => {
    mocks.employeesLoading = true;
    renderRoute();
    expect(screen.getByText(/Loading employee/i)).toBeInTheDocument();
  });

  it("throws notFound() when the employee id is missing", () => {
    mocks.employees = [];
    expect(() => renderRoute()).toThrow(/notFound\(\) called/);
  });
});

/* ────────── header + employment block ────────── */

describe("EmployeeDetail — header", () => {
  it("renders the full name as a level-1 heading", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Anna Hovhannisyan", level: 1 }),
    ).toBeInTheDocument();
  });

  it("renders the position, department, and hire date in the header meta line", () => {
    renderRoute();
    expect(screen.getByText(/Accountant/)).toBeInTheDocument();
    expect(screen.getByText(/Finance/)).toBeInTheDocument();
    expect(screen.getByText(/Hired 2024-03-01/)).toBeInTheDocument();
  });

  it("renders the 'Active' status pill", () => {
    renderRoute();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
  });
});

describe("EmployeeDetail — employment block", () => {
  it("renders the gross salary in the employment block", () => {
    renderRoute();
    // 350,000 AMD → "350 000 ֏" — appears in both the employment block
    // and the payroll-run table, so scope to the block.
    const dt = screen.getByText("Gross salary");
    const block = dt.closest("dl") ?? document.body;
    expect(within(block as HTMLElement).getByText(/350\s*000/)).toBeInTheDocument();
  });

  it("renders the email and tax ID", () => {
    renderRoute();
    // "Email" and "Tax ID" appear as <dt>s in both the employment
    // block and the metadata sidebar. Scope to the first occurrence
    // (the employment block) using getAllByText.
    const emailDt = screen.getAllByText("Email")[0];
    const emailBlock = emailDt.closest("dl") ?? document.body;
    expect(within(emailBlock as HTMLElement).getByText(/anna@example\.am/)).toBeInTheDocument();
    // Tax ID is unique to the employment block (no taxId in metadata).
    expect(within(emailBlock as HTMLElement).getByText(/12345678/)).toBeInTheDocument();
  });
});

/* ────────── payroll history ────────── */

describe("EmployeeDetail — payroll history", () => {
  it("shows the empty state when there are no runs", () => {
    mocks.runs = [];
    renderRoute();
    expect(screen.getByText(/No payroll runs yet/i)).toBeInTheDocument();
  });

  it("renders a hidden people-payroll-run entity marker", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="people-payroll-run"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("2");
  });

  it("renders one row per payroll run", () => {
    renderRoute();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // 1 header + 2 data rows
    expect(rows).toHaveLength(3);
  });

  it("renders the run totals row (gross + net)", () => {
    renderRoute();
    // "2 runs · gross X · net Y" — only the totals row talks about "runs";
    // the per-row cells use the formatted AMD amount.
    const totals = screen.getByText(/2 runs/);
    expect(totals.textContent).toMatch(/gross/);
    expect(totals.textContent).toMatch(/net/);
  });

  it("hides the 'Run payroll' button for terminated employees", () => {
    mocks.employees = [TERMINATED_EMPLOYEE];
    mocks.params = { employeeId: "emp-9" };
    renderRoute();
    expect(screen.queryByText(/Run payroll/i)).toBeNull();
  });

  it("shows the 'Run payroll' button for active employees", () => {
    renderRoute();
    expect(screen.getByRole("button", { name: /Run payroll/i })).toBeInTheDocument();
  });
});

/* ────────── action panel + metadata ────────── */

describe("EmployeeDetail — right rail", () => {
  it("renders the suggested-actions panel header", () => {
    renderRoute();
    expect(screen.getByText(/Suggested actions/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Առաջարկվող գործողություններ/),
    ).toBeInTheDocument();
  });

  it("renders the 'Run this month's payroll' action for an active employee", () => {
    renderRoute();
    expect(screen.getByText(/Run this month's payroll/i)).toBeInTheDocument();
  });

  it("renders the 'Issue final settlement' action for a terminated employee", () => {
    mocks.employees = [TERMINATED_EMPLOYEE];
    mocks.params = { employeeId: "emp-9" };
    renderRoute();
    expect(screen.getByText(/Issue final settlement/i)).toBeInTheDocument();
  });

  it("renders the metadata panel with the employee id, email, tax id, and updated date", () => {
    renderRoute();
    // The metadata <h2> "Metadata" — scoped to the right-rail aside
    // because "Metadata" could otherwise collide with section headings.
    const aside = screen.getAllByLabelText("Metadata")[0];
    expect(within(aside).getByText("emp-1")).toBeInTheDocument();
  });
});

/* ────────── back link ────────── */

describe("EmployeeDetail — back link", () => {
  it("renders a 'People' back link to /app/people", () => {
    renderRoute();
    const backLinks = screen.getAllByRole("link");
    const peopleLink = backLinks.find(
      (l) => (l.textContent ?? "").trim() === "People",
    );
    expect(peopleLink).toBeDefined();
    expect(peopleLink?.getAttribute("data-href")).toBe("/app/people");
  });
});
