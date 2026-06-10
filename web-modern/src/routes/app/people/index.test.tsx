/**
 * /app/people (index route) — route-level test for the People
 * workspace.
 *
 * Mirrors the finance/index.test.tsx pattern: mock the three layers we
 * can't reach in a jsdom test (TanStack Router, TanStack Query,
 * @/lib/api/client), then drive the public component surface.
 *
 * Coverage targets:
 *  - validateSearch (defaulting + view/status coercion)
 *  - Page header (People title, Armenian subtitle)
 *  - ViewSwitcher tabs (Employees | Payroll runs)
 *  - Employees view: table rows, status filter, status pills
 *  - Status filter (URL state narrows the table)
 *  - Right rail: Workforce + Monthly payroll totals
 *  - Runs view: placeholder copy
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

type View = "employees" | "runs";
type Status = "all" | "active" | "on-leave" | "terminated";

const mocks = vi.hoisted(() => ({
  search: { view: "employees" as View, status: "all" as Status },
  employees: null as unknown,
  loading: false,
  fullPath: "/app/people/",
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: {
    component: unknown;
    validateSearch: unknown;
  }) => ({
    fullPath: mocks.fullPath,
    useSearch: () => mocks.search,
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
    options: cfg,
    update: (u: unknown) => u,
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
        return { data: mocks.employees, isLoading: mocks.loading, isError: false };
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

import { Route } from "./index";

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

const VALID_EMPLOYEES = {
  employees: [
    {
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
    },
    {
      id: "emp-2",
      fullName: "Mariam Petrosyan",
      taxId: null,
      position: "Sales Manager",
      department: "Sales",
      grossSalary: 500000,
      employmentStatus: "active",
      hireDate: "2023-01-15",
      email: null,
      updatedAt: "2026-05-15T10:00:00.000Z",
    },
    {
      id: "emp-3",
      fullName: "Zara Stepanyan",
      taxId: null,
      position: "Intern",
      department: "Operations",
      grossSalary: 150000,
      employmentStatus: "on-leave",
      hireDate: "2025-09-01",
      email: null,
      updatedAt: "2026-05-30T10:00:00.000Z",
    },
    {
      id: "emp-4",
      fullName: "Lilit Ohanyan",
      taxId: null,
      position: "Driver",
      department: "Logistics",
      grossSalary: 250000,
      employmentStatus: "terminated",
      hireDate: "2022-06-01",
      email: null,
      updatedAt: "2025-12-01T10:00:00.000Z",
    },
  ],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = { view: "employees", status: "all" };
  mocks.employees = VALID_EMPLOYEES;
  mocks.loading = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── validateSearch ────────── */

describe("Route.options.validateSearch", () => {
  it("defaults view to 'employees' and status to 'all' on empty input", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({});
    expect(r).toEqual({ view: "employees", status: "all" });
  });

  it("accepts 'runs' as a view", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ view: "runs" });
    expect(r).toMatchObject({ view: "runs" });
  });

  it("falls back to 'employees' for an unknown view", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ view: "garbage" });
    expect(r).toMatchObject({ view: "employees" });
  });

  it("accepts every known employment status string", () => {
    const fn = Route.options.validateSearch as (
      raw: Record<string, unknown>,
    ) => unknown;
    for (const s of ["all", "active", "on-leave", "terminated"]) {
      expect(fn({ status: s })).toMatchObject({ status: s });
    }
  });

  it("falls back to 'all' for an unknown status", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ status: "garbage" });
    expect(r).toMatchObject({ status: "all" });
  });
});

/* ────────── page shell ────────── */

describe("PeopleWorkspace — page shell", () => {
  it("shows the loading message while employees are loading", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading employees/i)).toBeInTheDocument();
  });

  it("renders the header with title 'People' and the Armenian subtitle", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "People", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Աշխատակազմ · Աշխատավարձ/),
    ).toBeInTheDocument();
  });

  it("renders the 'Today' back-link to /app", () => {
    renderRoute();
    const backLinks = screen.getAllByRole("link");
    const todayLink = backLinks.find((l) => l.textContent === "Today");
    expect(todayLink).toBeDefined();
    expect(todayLink?.getAttribute("data-href")).toBe("/app");
  });

  it("renders the ViewSwitcher with two tabs", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: /View/ });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0].textContent).toMatch(/Employees/);
    expect(tabs[1].textContent).toMatch(/Payroll runs/);
  });
});

/* ────────── EmployeesView (list) ────────── */

describe("PeopleWorkspace — employees list view", () => {
  it("renders one row per employee in the table", () => {
    renderRoute();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // 1 header row + 4 data rows
    expect(rows).toHaveLength(5);
  });

  it("renders a hidden people-employee entity marker for smoke / E2E", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="people-employee"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("4");
  });

  it("renders the status filter tabs with their counts", () => {
    renderRoute();
    const nav = screen.getByRole("navigation", {
      name: /Filter by status/i,
    });
    const labels = within(nav)
      .getAllByRole("button")
      .map((b) => b.textContent ?? "");
    expect(labels.some((l) => l.startsWith("All"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Active"))).toBe(true);
    expect(labels.some((l) => l.startsWith("On leave"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Terminated"))).toBe(true);
  });

  it("renders the 'Active' tone pill on the Anna Hovhannisyan row", () => {
    renderRoute();
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("Anna Hovhannisyan").length).toBeGreaterThan(0);
    // The status pill for the active row should render 'Active' as its label.
    expect(within(table).getAllByText("Active").length).toBeGreaterThan(0);
  });

  it("renders the workforce overview on the right rail", () => {
    renderRoute();
    const aside = screen.getByLabelText("People overview");
    expect(within(aside).getByText(/Workforce/i)).toBeInTheDocument();
    // Total = 4
    expect(within(aside).getByText("4")).toBeInTheDocument();
    // Active count
    expect(within(aside).getByText("2")).toBeInTheDocument();
  });

  it("renders the monthly payroll total on the right rail", () => {
    renderRoute();
    const aside = screen.getByLabelText("People overview");
    expect(within(aside).getByText(/Monthly payroll/i)).toBeInTheDocument();
    // 350k + 500k + 150k + 250k = 1,250,000 AMD — Intl.NumberFormat("hy-AM")
    // renders as "1 250 000 ֏" (Armenian dram symbol with thin spaces).
    expect(within(aside).getByText(/1\s*250\s*000/)).toBeInTheDocument();
  });

  it("shows the empty-state copy when there are no employees", () => {
    mocks.employees = { employees: [] };
    renderRoute();
    expect(screen.getByText(/No employees match this filter/i)).toBeInTheDocument();
  });
});

/* ────────── Status filtering ────────── */

describe("PeopleWorkspace — employment status filter", () => {
  it("filters the table to only 'active' employees when status=active", () => {
    mocks.search = { view: "employees", status: "active" };
    renderRoute();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // 1 header + 2 active rows
    expect(rows).toHaveLength(3);
    expect(within(table).getByText("Anna Hovhannisyan")).toBeInTheDocument();
    expect(within(table).getByText("Mariam Petrosyan")).toBeInTheDocument();
    expect(within(table).queryByText("Zara Stepanyan")).toBeNull();
  });

  it("filters the table to only 'terminated' employees when status=terminated", () => {
    mocks.search = { view: "employees", status: "terminated" };
    renderRoute();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // 1 header + 1 terminated row
    expect(rows).toHaveLength(2);
    expect(within(table).getByText("Lilit Ohanyan")).toBeInTheDocument();
    expect(within(table).queryByText("Anna Hovhannisyan")).toBeNull();
  });

  it("pins the 'Active' tab as the active tab when status=active", () => {
    mocks.search = { view: "employees", status: "active" };
    renderRoute();
    const nav = screen.getByRole("navigation", {
      name: /Filter by status/i,
    });
    const activeTab = within(nav)
      .getAllByRole("button")
      .find((b) => (b.textContent ?? "").startsWith("Active"));
    expect(activeTab?.getAttribute("aria-current")).toBe("page");
  });
});

/* ────────── Runs view ────────── */

describe("PeopleWorkspace — payroll runs view", () => {
  it("renders the runs view without throwing when view=runs", () => {
    mocks.search = { view: "runs", status: "all" };
    expect(() => renderRoute()).not.toThrow();
  });

  it("shows the placeholder copy pointing to employees", () => {
    mocks.search = { view: "runs", status: "all" };
    renderRoute();
    expect(
      screen.getByText(/Pick an employee to view their payroll runs/i),
    ).toBeInTheDocument();
  });
});
