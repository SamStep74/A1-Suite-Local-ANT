/**
 * /app/projects — route-level tests for the Projects workspace (index).
 *
 * Pattern A: mock the three layers (Router, Query, API client), then
 * drive the public component surface. We assert:
 *
 *  - page shell (title, Armenian subtitle, monogram)
 *  - validateSearch (default view, fallback for unknown values)
 *  - ViewSwitcher (5 tabs, role=tablist, current selection)
 *  - each view:
 *      - loading state
 *      - error state
 *      - empty / populated data render
 *      - entity marker
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state ────────── */

const mocks = vi.hoisted(() => ({
  search: { view: "projects" as string },
  list: null as unknown,
  detail: null as unknown,
  billing: null as unknown,
  profitability: null as unknown,
  loading: { list: false, detail: false, billing: false, profitability: false },
  error: { list: false, detail: false, billing: false, profitability: false },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    useParams: () => ({}),
    useSearch: () => mocks.search,
    useNavigate: () => vi.fn(),
    options: cfg,
  }),
  Link: ({
    children,
    to,
    search,
    params,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
    search?: Record<string, unknown>;
    params?: Record<string, unknown>;
  } & Record<string, unknown>) => (
    <a
      data-href={to}
      data-search={JSON.stringify(search ?? {})}
      data-params={JSON.stringify(params ?? {})}
      href={to}
      {...rest}
    >
      {children}
    </a>
  ),
  notFound: () => {
    throw new Error("notFound() called");
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      const key = String(queryKey[0] ?? "");
      if (key === "projects-list") {
        return {
          data: mocks.list,
          isLoading: mocks.loading.list,
          isError: mocks.error.list,
        };
      }
      if (key === "project-detail") {
        return {
          data: mocks.detail,
          isLoading: mocks.loading.detail,
          isError: mocks.error.detail,
        };
      }
      if (key === "project-billing-preview") {
        return {
          data: mocks.billing,
          isLoading: mocks.loading.billing,
          isError: mocks.error.billing,
        };
      }
      if (key === "project-profitability") {
        return {
          data: mocks.profitability,
          isLoading: mocks.loading.profitability,
          isError: mocks.error.profitability,
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

/* ────────── import under test ────────── */

import { Route } from "./index";

/* ────────── helpers ────────── */

function renderRoute() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Component = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}

const PROJECTS_LIST = {
  projects: [
    {
      id: "p-1",
      name: "Alpha",
      status: "active",
      customerId: "c-1",
      dealId: null,
      startDate: "2026-01-01",
      dueDate: "2026-06-30",
      updatedAt: "2026-06-09T10:00:00Z",
      taskTotal: 10,
      taskDone: 5,
      milestoneTotal: 4,
      milestoneReached: 2,
      totalMinutes: 480,
    },
    {
      id: "p-2",
      name: "Bravo",
      status: "planning",
      customerId: null,
      dealId: null,
      startDate: "2026-02-01",
      dueDate: "2026-08-30",
      updatedAt: "2026-06-08T10:00:00Z",
      taskTotal: 0,
      taskDone: 0,
      milestoneTotal: 0,
      milestoneReached: 0,
      totalMinutes: 0,
    },
  ],
};

const DETAIL = {
  project: {
    id: "p-1",
    name: "Alpha",
    status: "active",
    customerId: "c-1",
    dealId: null,
    startDate: "2026-01-01",
    dueDate: "2026-06-30",
    updatedAt: "2026-06-09T10:00:00Z",
    taskTotal: 3,
    taskDone: 1,
    milestoneTotal: 2,
    milestoneReached: 1,
    totalMinutes: 240,
    timeEntryCount: 4,
    tasks: [
      { id: "t-1", title: "Do A", status: "done", assigneeEmployeeId: null, dueDate: null, updatedAt: "2026-06-01", blocking: [{ id: "t-3", title: "Do C", status: "in-progress" }] },
      { id: "t-2", title: "Do B", status: "todo", assigneeEmployeeId: null, dueDate: null, updatedAt: "2026-06-01" },
      { id: "t-3", title: "Do C", status: "in-progress", assigneeEmployeeId: null, dueDate: null, updatedAt: "2026-06-01", blockedBy: [{ id: "t-1", title: "Scope approval", status: "done" }] },
    ],
    milestones: [
      { id: "m-1", title: "Kickoff", dueDate: "2026-06-15", reached: 1, updatedAt: "2026-06-01" },
      { id: "m-2", title: "Final", dueDate: "2026-06-30", reached: 0, updatedAt: "2026-06-01" },
    ],
  },
};

const BILLING = {
  preview: {
    projectId: "p-1",
    customerId: "c-1",
    unbilledMinutes: 240,
    unbilledEntries: 4,
    hours: 4,
    hourlyRate: 25000,
    subtotal: 100000,
    vat: 20000,
    total: 120000,
    vatRate: 20,
    currency: "AMD",
  },
};

const PROFITABILITY = {
  profitability: {
    projectId: "p-1",
    customerId: "c-1",
    currency: "AMD",
    hourlyRate: 25000,
    billedMinutes: 360,
    billedEntries: 3,
    unbilledMinutes: 240,
    unbilledEntries: 4,
    totalMinutes: 600,
    totalEntries: 7,
    billedRevenue: 150000,
    unbilledRevenue: 100000,
    totalRevenue: 250000,
    costTotal: 143750,
    grossProfit: 106250,
    grossMarginPct: 42,
    invoiceCount: 1,
    invoices: [
      {
        id: "inv-1",
        number: "INV-2026-001",
        status: "issued",
        total: 150000,
        subtotal: 125000,
        vat: 25000,
        issueDate: "2026-06-10",
        dueDate: "2026-06-25",
      },
    ],
  },
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = { view: "projects" };
  mocks.list = null;
  mocks.detail = null;
  mocks.billing = null;
  mocks.profitability = null;
  mocks.loading = { list: false, detail: false, billing: false, profitability: false };
  mocks.error = { list: false, detail: false, billing: false, profitability: false };
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("Projects — page shell", () => {
  it("renders the page title", () => {
    renderRoute();
    expect(screen.getByRole("heading", { name: "Projects", level: 1 })).toBeInTheDocument();
  });
  it("renders the Armenian subtitle", () => {
    renderRoute();
    expect(
      screen.getByText(/Հաճախորդների նախագծեր · Առաջադրանքներ · Հիմնարար կետեր · Ժամային մուտքեր/),
    ).toBeInTheDocument();
  });
  it("renders the PROJECTS monogram badge", () => {
    renderRoute();
    expect(screen.getByText("PROJECTS")).toBeInTheDocument();
  });
});

/* ────────── validateSearch ────────── */

describe("Projects — validateSearch", () => {
  const fn = Route.options.validateSearch as (raw: Record<string, unknown>) => unknown;
  it("defaults to projects", () => {
    expect(fn({})).toEqual({ view: "projects" });
  });
  it("accepts each known view", () => {
    expect(fn({ view: "projects" })).toEqual({ view: "projects" });
    expect(fn({ view: "tasks" })).toEqual({ view: "tasks" });
    expect(fn({ view: "milestones" })).toEqual({ view: "milestones" });
    expect(fn({ view: "time" })).toEqual({ view: "time" });
    expect(fn({ view: "billing" })).toEqual({ view: "billing" });
  });
  it("falls back to projects for unknown values", () => {
    expect(fn({ view: "kanban" })).toEqual({ view: "projects" });
    expect(fn({ view: 42 })).toEqual({ view: "projects" });
  });
});

/* ────────── ViewSwitcher ────────── */

describe("Projects — ViewSwitcher", () => {
  it("renders 5 tabs with role=tablist", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: "View" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(5);
  });
  it("renders the 5 expected tab labels", () => {
    renderRoute();
    expect(screen.getByRole("tab", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Milestones" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Time" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Billing" })).toBeInTheDocument();
  });
  it("marks the URL view as the selected tab", () => {
    mocks.search = { view: "billing" };
    renderRoute();
    expect(screen.getByRole("tab", { name: "Billing" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "false");
  });
});

/* ────────── Projects view ────────── */

describe("Projects — Projects view", () => {
  it("shows the loading state", () => {
    mocks.loading.list = true;
    renderRoute();
    expect(screen.getByText(/Loading projects/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.list = true;
    renderRoute();
    expect(screen.getByText(/Failed to load projects/i)).toBeInTheDocument();
  });
  it("renders KPIs and entity marker when populated", () => {
    mocks.list = PROJECTS_LIST;
    renderRoute();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    const marker = document.querySelector('[data-entity="projects-project"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("2");
  });
});

/* ────────── Tasks view ────────── */

describe("Projects — Tasks view", () => {
  beforeEach(() => {
    mocks.search = { view: "tasks" };
    mocks.list = PROJECTS_LIST;
  });
  it("shows the loading state", () => {
    mocks.loading.list = true;
    renderRoute();
    expect(screen.getByText(/Loading tasks/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.list = true;
    renderRoute();
    expect(screen.getByText(/Failed to load tasks/i)).toBeInTheDocument();
  });
  it("renders tasks from the top project's detail", () => {
    mocks.detail = DETAIL;
    renderRoute();
    expect(screen.getByText("Do A")).toBeInTheDocument();
    expect(screen.getByText("Do B")).toBeInTheDocument();
    expect(screen.getByText("Do C")).toBeInTheDocument();
  });
  it("renders blocked-by dependency evidence", () => {
    mocks.detail = DETAIL;
    renderRoute();
    const marker = document.querySelector('[data-entity="projects-task"]');
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/Do C/);
    expect(rows[0].textContent).toMatch(/Scope approval/);
  });
});

/* ────────── Milestones view ────────── */

describe("Projects — Milestones view", () => {
  beforeEach(() => {
    mocks.search = { view: "milestones" };
    mocks.list = PROJECTS_LIST;
  });
  it("shows the loading state", () => {
    mocks.loading.list = true;
    renderRoute();
    expect(screen.getByText(/Loading milestones/i)).toBeInTheDocument();
  });
  it("renders milestones sorted by dueDate asc", () => {
    mocks.detail = DETAIL;
    renderRoute();
    const marker = document.querySelector('[data-entity="projects-milestone"]');
    expect(marker).not.toBeNull();
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/Kickoff/);
    expect(rows[1].textContent).toMatch(/Final/);
  });
});

/* ────────── Time view ────────── */

describe("Projects — Time view", () => {
  beforeEach(() => {
    mocks.search = { view: "time" };
  });
  it("shows the loading state", () => {
    mocks.loading.list = true;
    renderRoute();
    expect(screen.getByText(/Loading time/i)).toBeInTheDocument();
  });
  it("renders the time table with project rows", () => {
    mocks.list = PROJECTS_LIST;
    renderRoute();
    const marker = document.querySelector('[data-entity="projects-time-entry"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("2");
  });
});

/* ────────── Billing view ────────── */

describe("Projects — Billing view", () => {
  beforeEach(() => {
    mocks.search = { view: "billing" };
    mocks.list = PROJECTS_LIST;
  });
  it("shows the loading state", () => {
    mocks.loading.billing = true;
    renderRoute();
    expect(screen.getByText(/Loading billing/i)).toBeInTheDocument();
  });
  it("shows the loading state while profitability loads", () => {
    mocks.billing = BILLING;
    mocks.loading.profitability = true;
    renderRoute();
    expect(screen.getByText(/Loading billing/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.billing = true;
    renderRoute();
    expect(screen.getByText(/Failed to load billing preview/i)).toBeInTheDocument();
  });
  it("shows the error state when profitability fails", () => {
    mocks.billing = BILLING;
    mocks.error.profitability = true;
    renderRoute();
    expect(screen.getByText(/Failed to load billing preview/i)).toBeInTheDocument();
  });
  it("renders the billing preview with the project name", () => {
    mocks.billing = BILLING;
    renderRoute();
    const marker = document.querySelector('[data-entity="projects-billing-preview"]');
    expect(marker).not.toBeNull();
    expect(marker?.textContent).toMatch(/Alpha/);
  });
  it("renders the profitability panel with invoice evidence", () => {
    mocks.billing = BILLING;
    mocks.profitability = PROFITABILITY;
    renderRoute();
    const marker = document.querySelector('[data-entity="projects-profitability"]');
    expect(marker).not.toBeNull();
    expect(marker).toHaveAttribute("data-count", "1");
    expect(marker).toHaveTextContent(/Profitability - Alpha/);
    expect(within(marker as HTMLElement).getByText("Billed revenue")).toBeInTheDocument();
    expect(within(marker as HTMLElement).getByText("Unbilled estimate")).toBeInTheDocument();
    expect(within(marker as HTMLElement).getByText("Gross profit")).toBeInTheDocument();
    expect(within(marker as HTMLElement).getByText("Gross margin")).toBeInTheDocument();
    expect(within(marker as HTMLElement).getByText("42%")).toBeInTheDocument();
    expect(within(marker as HTMLElement).getByText("INV-2026-001")).toBeInTheDocument();
    expect(within(marker as HTMLElement).getByText("2026-06-10")).toBeInTheDocument();
  });
  it("shows the empty state when no project", () => {
    mocks.list = { projects: [] };
    renderRoute();
    expect(screen.getByText(/No project to bill/i)).toBeInTheDocument();
  });
});

/* ────────── back link ────────── */

describe("Projects — back link", () => {
  it("renders a 'Today' link to /app", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Today/ });
    expect(back).toBeInTheDocument();
    expect(back.getAttribute("data-href")).toBe("/app");
  });
});
