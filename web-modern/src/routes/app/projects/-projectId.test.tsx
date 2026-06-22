/**
 * /app/projects/$projectId — route-level tests for the project detail
 * surface.
 *
 * Mirrors cfo/$loanId pattern. Coverage:
 *
 *  - Loading state ("Loading project…")
 *  - Not-found (no data envelope)
 *  - Error state
 *  - Header (title, monogram, projectId)
 *  - KPIs: progress, tasks done, milestones, total minutes
 *  - Tasks table (sorted in-progress → todo → done) + entity marker
 *  - Milestones table (sorted by dueDate asc) + entity marker
 *  - Back-link to /app/projects with view=projects
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

/* ────────── mock state ────────── */

const mocks = vi.hoisted(() => ({
  params: { projectId: "p-1" as string },
  detail: null as unknown,
  loading: false,
  error: false,
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
    search,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
    search?: Record<string, unknown>;
  } & Record<string, unknown>) => (
    <a
      data-href={to}
      href={to}
      data-search={JSON.stringify(search ?? {})}
      {...rest}
    >
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
      if (queryKey[0] === "project-detail") {
        return {
          data: mocks.detail,
          isLoading: mocks.loading,
          isError: mocks.error,
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

import { Route } from "./$projectId";

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

const DETAIL = {
  project: {
    id: "p-1",
    name: "Alpha",
    description: "Test project",
    status: "active",
    customerId: "c-1",
    dealId: null,
    startDate: "2026-01-01",
    dueDate: "2026-06-30",
    updatedAt: "2026-06-09T10:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    taskTotal: 3,
    taskDone: 1,
    milestoneTotal: 2,
    milestoneReached: 1,
    totalMinutes: 240,
    timeEntryCount: 4,
    tasks: [
      { id: "t-1", title: "Do A", status: "done", assigneeEmployeeId: "e-1", dueDate: null, updatedAt: "2026-06-01", subtasks: [{ id: "t-3", title: "Do C", status: "in-progress" }], blocking: [{ id: "t-3", title: "Do C", status: "in-progress" }] },
      { id: "t-2", title: "Do B", status: "todo", assigneeEmployeeId: null, dueDate: null, updatedAt: "2026-06-01" },
      { id: "t-3", title: "Do C", status: "in-progress", assigneeEmployeeId: null, dueDate: null, updatedAt: "2026-06-01", parentTaskId: "t-1", parentTask: { id: "t-1", title: "Do A", status: "done" }, blockedBy: [{ id: "t-1", title: "Scope approval", status: "done" }] },
    ],
    milestones: [
      { id: "m-1", title: "Kickoff", dueDate: "2026-06-15", reached: 1, updatedAt: "2026-06-01" },
      { id: "m-2", title: "Final", dueDate: "2026-06-30", reached: 0, updatedAt: "2026-06-01" },
    ],
  },
};

const ZERO_TASK_DETAIL = {
  project: {
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
    timeEntryCount: 0,
    tasks: [],
    milestones: [],
  },
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.params = { projectId: "p-1" };
  mocks.detail = { ...DETAIL };
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── loading / not-found / error ────────── */

describe("ProjectDetail — loading / not-found / error", () => {
  it("shows the loading message while the query is in-flight", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading project/i)).toBeInTheDocument();
  });
  it("shows the 'no project' message when data is missing", () => {
    mocks.detail = null;
    renderRoute();
    expect(screen.getByText(/No project data/i)).toBeInTheDocument();
  });
  it("shows the 'failed' message when the query errors", () => {
    mocks.error = true;
    mocks.detail = null;
    renderRoute();
    expect(screen.getByText(/Failed to load project/i)).toBeInTheDocument();
  });
});

/* ────────── header ────────── */

describe("ProjectDetail — header", () => {
  it("renders the project name as a level-1 heading", () => {
    renderRoute();
    expect(screen.getByRole("heading", { name: "Alpha", level: 1 })).toBeInTheDocument();
  });
  it("renders the projectId in the monogram badge", () => {
    renderRoute();
    expect(screen.getByText(/PROJECTS · p-1/)).toBeInTheDocument();
  });
});

/* ────────── KPIs ────────── */

describe("ProjectDetail — KPIs", () => {
  it("renders progress, tasks, milestones, total time labels", () => {
    renderRoute();
    // KPI labels duplicate tab labels (e.g. "Tasks" tab + "Tasks" KPI),
    // so use getAllByText and assert at least one match per label.
    const all = screen.getAllByText;
    expect(all(/^Progress$/).length).toBeGreaterThan(0);
    expect(all(/^Tasks$/).length).toBeGreaterThan(0);
    expect(all(/^Milestones$/).length).toBeGreaterThan(0);
    expect(all(/Total time/).length).toBeGreaterThan(0);
  });
  it("shows 33% progress (1/3 done)", () => {
    renderRoute();
    expect(screen.getByText("33%")).toBeInTheDocument();
  });
});

/* ────────── tasks table ────────── */

describe("ProjectDetail — tasks table", () => {
  it("renders all 3 task rows", () => {
    renderRoute();
    expect(screen.getByText("Do A")).toBeInTheDocument();
    expect(screen.getByText("Do B")).toBeInTheDocument();
    expect(screen.getByText("Do C")).toBeInTheDocument();
  });
  it("sorts tasks in-progress → todo → done", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="projects-task"]');
    expect(marker).not.toBeNull();
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/Do C/);
    expect(rows[1].textContent).toMatch(/Do B/);
    expect(rows[2].textContent).toMatch(/Do A/);
  });
  it("renders the entity marker with the count", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="projects-task"]');
    expect(marker?.getAttribute("data-count")).toBe("3");
  });
  it("renders blocked-by dependency evidence", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="projects-task"]');
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/Do C/);
    expect(rows[0].textContent).toMatch(/Scope approval/);
  });
  it("renders parent and subtask hierarchy evidence", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="projects-task"]');
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/Parent: Do A/);
    expect(rows[2].textContent).toMatch(/Subtask: Do C/);
  });
  it("shows 'No tasks yet' when empty", () => {
    mocks.detail = ZERO_TASK_DETAIL;
    renderRoute();
    expect(screen.getByText(/No tasks yet/i)).toBeInTheDocument();
  });
});

/* ────────── milestones table ────────── */

describe("ProjectDetail — milestones table", () => {
  it("sorts milestones by dueDate asc", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="projects-milestone"]');
    expect(marker).not.toBeNull();
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/Kickoff/);
    expect(rows[1].textContent).toMatch(/Final/);
  });
  it("renders the entity marker with the count", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="projects-milestone"]');
    expect(marker?.getAttribute("data-count")).toBe("2");
  });
});

/* ────────── back link ────────── */

describe("ProjectDetail — back link", () => {
  it("renders a 'Back to Projects' link to /app/projects with view=projects", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Back to Projects/ });
    expect(back).toBeInTheDocument();
    expect(back.getAttribute("data-href")).toBe("/app/projects");
    expect(back.getAttribute("data-search")).toContain("projects");
  });
});
