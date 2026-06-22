/**
 * /app/projects — route-level tests for the Projects workspace (index).
 *
 * Pattern A: mock the three layers (Router, Query, API client), then
 * drive the public component surface. We assert:
 *
 *  - page shell (title, Armenian subtitle, monogram)
 *  - validateSearch (default view, fallback for unknown values)
 *  - ViewSwitcher (7 tabs, role=tablist, current selection)
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
  recurring: null as unknown,
  templates: null as unknown,
  loading: {
    list: false,
    detail: false,
    billing: false,
    profitability: false,
    recurring: false,
    templates: false,
  },
  error: {
    list: false,
    detail: false,
    billing: false,
    profitability: false,
    recurring: false,
    templates: false,
  },
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
      if (key === "project-recurring-tasks") {
        return {
          data: mocks.recurring,
          isLoading: mocks.loading.recurring,
          isError: mocks.error.recurring,
        };
      }
      if (key === "project-templates-list") {
        return {
          data: mocks.templates,
          isLoading: mocks.loading.templates,
          isError: mocks.error.templates,
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
      { id: "t-1", title: "Do A", status: "done", assigneeEmployeeId: null, dueDate: null, updatedAt: "2026-06-01", subtasks: [{ id: "t-3", title: "Do C", status: "in-progress" }], blocking: [{ id: "t-3", title: "Do C", status: "in-progress" }] },
      { id: "t-2", title: "Do B", status: "todo", assigneeEmployeeId: null, dueDate: null, updatedAt: "2026-06-01" },
      { id: "t-3", title: "Do C", status: "in-progress", assigneeEmployeeId: null, dueDate: null, updatedAt: "2026-06-01", parentTaskId: "t-1", parentTask: { id: "t-1", title: "Do A", status: "done" }, blockedBy: [{ id: "t-1", title: "Scope approval", status: "done" }] },
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
    costRate: 8750,
    laborCostTotal: 87500,
    productCostTotal: 56250,
    grossProfit: 106250,
    grossMarginPct: 42,
    invoiceCount: 1,
    taskProfitability: [
      {
        taskId: "task-1",
        taskTitle: "Implementation",
        taskStatus: "in-progress",
        billedMinutes: 180,
        unbilledMinutes: 60,
        totalMinutes: 240,
        entries: 3,
        revenue: 100000,
        laborCost: 35000,
        grossProfit: 65000,
        grossMarginPct: 65,
      },
      {
        taskId: null,
        taskTitle: "Unassigned time",
        taskStatus: null,
        billedMinutes: 180,
        unbilledMinutes: 180,
        totalMinutes: 360,
        entries: 4,
        revenue: 150000,
        laborCost: 52500,
        grossProfit: 97500,
        grossMarginPct: null,
      },
    ],
    productCostEvidence: [
      {
        quoteId: "quote-1",
        quoteNumber: "Q-2026-007",
        quoteStatus: "accepted",
        catalogItemId: "cat-1",
        catalogSku: "IMPL-BASE",
        catalogName: "Implementation pack",
        catalogItemVariantId: "variant-1",
        variantSku: "IMPL-BASE-PRO",
        quantity: 2,
        revenue: 120000,
        unitCost: 18000,
        cost: 36000,
        grossProfit: 84000,
        grossMarginPct: 70,
      },
    ],
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

const RECURRING = {
  recurringTasks: [
    {
      id: "rt-1",
      projectId: "p-1",
      title: "Weekly client check-in",
      status: "todo",
      intervalUnit: "weekly",
      intervalEvery: 1,
      nextDueDate: "2026-06-29",
      active: 1,
      lastCreatedTaskId: "t-99",
      updatedAt: "2026-06-22T08:00:00Z",
    },
    {
      id: "rt-2",
      projectId: "p-1",
      title: "Monthly status report",
      status: "scheduled",
      intervalUnit: "monthly",
      intervalEvery: 2,
      nextDueDate: null,
      active: false,
      lastCreatedTaskId: null,
      updatedAt: "2026-06-20T08:00:00Z",
    },
  ],
};

const TEMPLATES = {
  templates: [
    {
      id: "tpl-1",
      name: "ERP rollout",
      description: "Default project launch plan",
      status: "active",
      taskCount: 4,
      milestoneCount: 2,
      updatedAt: "2026-06-10T10:00:00Z",
      tasks: [
        {
          id: "tt-1",
          title: "Discovery",
          status: "done",
          dueOffsetDays: 0,
          sortOrder: 1,
          subtasks: [{ id: "tt-2", title: "Stakeholder map", status: "todo" }],
        },
        {
          id: "tt-2",
          title: "Stakeholder map",
          status: "todo",
          parentTaskId: "tt-1",
          parentTask: { id: "tt-1", title: "Discovery", status: "done" },
          dueOffsetDays: 3,
          sortOrder: 2,
        },
        {
          id: "tt-3",
          title: "Implementation",
          status: "in-progress",
          dueOffsetDays: 10,
          sortOrder: 3,
        },
      ],
      milestones: [
        { id: "tm-1", title: "Kickoff", dueOffsetDays: 0, sortOrder: 1 },
        { id: "tm-2", title: "Go live", dueOffsetDays: 30, sortOrder: 2 },
      ],
    },
  ],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = { view: "projects" };
  mocks.list = null;
  mocks.detail = null;
  mocks.billing = null;
  mocks.profitability = null;
  mocks.recurring = null;
  mocks.templates = null;
  mocks.loading = {
    list: false,
    detail: false,
    billing: false,
    profitability: false,
    recurring: false,
    templates: false,
  };
  mocks.error = {
    list: false,
    detail: false,
    billing: false,
    profitability: false,
    recurring: false,
    templates: false,
  };
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
    expect(fn({ view: "recurring" })).toEqual({ view: "recurring" });
    expect(fn({ view: "templates" })).toEqual({ view: "templates" });
  });
  it("falls back to projects for unknown values", () => {
    expect(fn({ view: "kanban" })).toEqual({ view: "projects" });
    expect(fn({ view: 42 })).toEqual({ view: "projects" });
  });
});

/* ────────── ViewSwitcher ────────── */

describe("Projects — ViewSwitcher", () => {
  it("renders 7 tabs with role=tablist", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: "View" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(7);
  });
  it("renders the 7 expected tab labels", () => {
    renderRoute();
    expect(screen.getByRole("tab", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Milestones" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Time" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Recurring" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Templates" })).toBeInTheDocument();
  });
  it("marks the URL view as the selected tab", () => {
    mocks.search = { view: "billing" };
    renderRoute();
    expect(screen.getByRole("tab", { name: "Billing" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "false");
  });
  it("marks recurring as selected from the search param", () => {
    mocks.search = { view: "recurring" };
    renderRoute();
    expect(screen.getByRole("tab", { name: "Recurring" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
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
  it("renders parent and subtask hierarchy evidence", () => {
    mocks.detail = DETAIL;
    renderRoute();
    const marker = document.querySelector('[data-entity="projects-task"]');
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/Parent: Do A/);
    expect(rows[2].textContent).toMatch(/Subtask: Do C/);
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

/* ────────── Recurring view ────────── */

describe("Projects — Recurring view", () => {
  beforeEach(() => {
    mocks.search = { view: "recurring" };
    mocks.list = PROJECTS_LIST;
  });

  it("shows the loading state", () => {
    mocks.loading.recurring = true;
    renderRoute();
    expect(screen.getByText(/Loading recurring tasks/i)).toBeInTheDocument();
  });

  it("shows the loading state while projects load", () => {
    mocks.loading.list = true;
    renderRoute();
    expect(screen.getByText(/Loading recurring tasks/i)).toBeInTheDocument();
  });

  it("shows the error state", () => {
    mocks.error.recurring = true;
    renderRoute();
    expect(screen.getByText(/Failed to load recurring tasks/i)).toBeInTheDocument();
  });

  it("shows the error state when projects fail", () => {
    mocks.error.list = true;
    renderRoute();
    expect(screen.getByText(/Failed to load recurring tasks/i)).toBeInTheDocument();
  });

  it("shows the empty state when no project is available", () => {
    mocks.list = { projects: [] };
    renderRoute();
    expect(screen.getByText(/No project available for recurring tasks/i)).toBeInTheDocument();
  });

  it("shows the empty state when the top project has no recurring task rules", () => {
    mocks.recurring = { recurringTasks: [] };
    renderRoute();
    expect(screen.getByText(/No recurring task rules/i)).toBeInTheDocument();
  });

  it("renders recurring task evidence for the top project", () => {
    mocks.recurring = RECURRING;
    renderRoute();
    const marker = document.querySelector('[data-entity="projects-recurring-task"]');
    expect(marker).not.toBeNull();
    expect(marker).toHaveAttribute("data-count", "2");
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(marker).toHaveTextContent(/Recurring tasks - Alpha/);
    expect(marker).toHaveTextContent(/Weekly client check-in/);
    expect(marker).toHaveTextContent(/Every 1 week/);
    expect(marker).toHaveTextContent(/2026-06-29/);
    expect(marker).toHaveTextContent(/todo/);
    expect(marker).toHaveTextContent(/t-99/);
    expect(marker).toHaveTextContent(/Monthly status report/);
    expect(marker).toHaveTextContent(/Every 2 months/);
  });
});

/* ────────── Templates view ────────── */

describe("Projects — Templates view", () => {
  beforeEach(() => {
    mocks.search = { view: "templates" };
  });
  it("marks templates as the selected tab from the search param", () => {
    renderRoute();
    expect(screen.getByRole("tab", { name: "Templates" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
  it("shows the loading state", () => {
    mocks.loading.templates = true;
    renderRoute();
    expect(screen.getByText(/Loading templates/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.templates = true;
    renderRoute();
    expect(screen.getByText(/Failed to load project templates/i)).toBeInTheDocument();
  });
  it("renders template count, task and milestone evidence", () => {
    mocks.templates = TEMPLATES;
    renderRoute();
    const marker = document.querySelector('[data-entity="projects-template"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("1");
    expect(marker).toHaveTextContent(/ERP rollout/);
    expect(marker).toHaveTextContent(/4 tasks/);
    expect(marker).toHaveTextContent(/2 milestones/);
    expect(marker).toHaveTextContent(/Discovery/);
    expect(marker).toHaveTextContent(/Kickoff/);
  });
  it("renders parent and subtask hierarchy evidence", () => {
    mocks.templates = TEMPLATES;
    renderRoute();
    const marker = document.querySelector('[data-entity="projects-template"]');
    expect(marker).toHaveTextContent(/Subtask: Stakeholder map/);
    expect(marker).toHaveTextContent(/Parent: Discovery/);
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
    expect(within(marker as HTMLElement).getByText("Cost rate")).toBeInTheDocument();
    expect(within(marker as HTMLElement).getByText("Labor cost")).toBeInTheDocument();
    expect(within(marker as HTMLElement).getByText("Product cost")).toBeInTheDocument();
    const taskMarker = marker?.querySelector('[data-entity="projects-task-profitability"]');
    expect(taskMarker).not.toBeNull();
    expect(taskMarker).toHaveAttribute("data-count", "2");
    expect(within(taskMarker as HTMLElement).getByText("Task cost basis")).toBeInTheDocument();
    expect(within(taskMarker as HTMLElement).getByText("Implementation")).toBeInTheDocument();
    expect(within(taskMarker as HTMLElement).getByText("Unassigned time")).toBeInTheDocument();
    expect(within(taskMarker as HTMLElement).getByText("65%")).toBeInTheDocument();
    const productMarker = marker?.querySelector('[data-entity="projects-product-cost-evidence"]');
    expect(productMarker).not.toBeNull();
    expect(productMarker).toHaveAttribute("data-count", "1");
    expect(within(productMarker as HTMLElement).getByText("Product cost evidence")).toBeInTheDocument();
    expect(within(productMarker as HTMLElement).getByText("Q-2026-007")).toBeInTheDocument();
    expect(within(productMarker as HTMLElement).getByText("Implementation pack")).toBeInTheDocument();
    expect(within(productMarker as HTMLElement).getByText("IMPL-BASE-PRO")).toBeInTheDocument();
    expect(within(productMarker as HTMLElement).getByText("70%")).toBeInTheDocument();
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
