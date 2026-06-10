/**
 * /app/flow — route-level tests for the Flow (workflow automation) workspace.
 *
 * Pattern A: mock the three layers (Router, Query, API client), then
 * drive the public component surface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state ────────── */

const mocks = vi.hoisted(() => ({
  search: { view: "rules" as string },
  data: { rules: null as unknown, approvals: null as unknown, runs: null as unknown },
  loading: { rules: false, approvals: false, runs: false },
  error: { rules: false, approvals: false, runs: false },
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
      if (key === "flow-rules") {
        return { data: mocks.data.rules, isLoading: mocks.loading.rules, isError: mocks.error.rules };
      }
      if (key === "flow-approvals") {
        return { data: mocks.data.approvals, isLoading: mocks.loading.approvals, isError: mocks.error.approvals };
      }
      if (key === "flow-runs") {
        return { data: mocks.data.runs, isLoading: mocks.loading.runs, isError: mocks.error.runs };
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

const RULES_DATA = {
  ok: true,
  rules: [
    {
      id: "rule-1",
      name: "Auto invoice on quote accept",
      trigger: "quote.accepted",
      action: "finance.invoice.propose",
      enabled: true,
      currentVersion: 3,
      approvalRequired: true,
      lastDryRun: { id: "dr-1", createdAt: "2026-06-10T08:00:00Z", status: "succeeded" },
    },
    {
      id: "rule-2",
      name: "Lead nurture",
      trigger: "lead.created",
      action: "crm.task.create",
      enabled: false,
      currentVersion: 1,
      approvalRequired: false,
      lastDryRun: null,
    },
  ],
};

const APPROVALS_DATA = {
  ok: true,
  approvals: [
    {
      id: "ap-1",
      title: "Refund customer ACME",
      actionKey: "finance.refund.issue",
      riskLevel: "financial",
      status: "pending",
      customerName: "ACME LLC",
      createdAt: "2026-06-10T08:00:00Z",
    },
    {
      id: "ap-2",
      title: "Send legal letter",
      actionKey: "legal.answer.approve",
      riskLevel: "legal",
      status: "pending",
      customerName: "Beta Co",
      createdAt: "2026-06-10T07:30:00Z",
    },
    {
      id: "ap-3",
      title: "Send follow-up task",
      actionKey: "crm.task.create",
      riskLevel: "operational",
      status: "approved",
      customerName: "Gamma",
      createdAt: "2026-06-09T08:00:00Z",
    },
  ],
};

const RUNS_DATA = {
  ok: true,
  runs: [
    {
      id: "rn-1",
      actionKey: "crm.task.create",
      status: "succeeded",
      customerName: "ACME LLC",
      startedAt: "2026-06-10T10:00:00Z",
      completedAt: "2026-06-10T10:01:00Z",
    },
    {
      id: "rn-2",
      actionKey: "finance.invoice.propose",
      status: "failed",
      customerName: "Beta Co",
      startedAt: "2026-06-10T09:00:00Z",
      completedAt: "2026-06-10T09:00:30Z",
    },
  ],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = { view: "rules" };
  mocks.data = { rules: null, approvals: null, runs: null };
  mocks.loading = { rules: false, approvals: false, runs: false };
  mocks.error = { rules: false, approvals: false, runs: false };
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("Flow — page shell", () => {
  it("renders the page title", () => {
    renderRoute();
    expect(screen.getByRole("heading", { name: "Flow", level: 1 })).toBeInTheDocument();
  });
  it("renders the Armenian subtitle", () => {
    renderRoute();
    expect(screen.getByText(/Կանոններ · Հաստատումներ · Գործարկումներ/)).toBeInTheDocument();
  });
  it("renders the Flow monogram badge", () => {
    renderRoute();
    expect(screen.getAllByText(/^Flow$/)).toHaveLength(2);
  });
});

/* ────────── validateSearch ────────── */

describe("Flow — validateSearch", () => {
  const fn = Route.options.validateSearch as (raw: Record<string, unknown>) => unknown;
  it("defaults to rules", () => {
    expect(fn({})).toEqual({ view: "rules" });
  });
  it("accepts each known view", () => {
    expect(fn({ view: "rules" })).toEqual({ view: "rules" });
    expect(fn({ view: "approvals" })).toEqual({ view: "approvals" });
    expect(fn({ view: "runs" })).toEqual({ view: "runs" });
  });
  it("falls back to rules for unknown values", () => {
    expect(fn({ view: "audit" })).toEqual({ view: "rules" });
    expect(fn({ view: 7 })).toEqual({ view: "rules" });
  });
});

/* ────────── ViewSwitcher ────────── */

describe("Flow — ViewSwitcher", () => {
  it("renders 3 tabs with role=tablist", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: "View" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
  });
  it("renders the 3 expected tab labels", () => {
    renderRoute();
    expect(screen.getByRole("tab", { name: "Rules" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Approvals" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Runs" })).toBeInTheDocument();
  });
  it("marks rules as the default selected tab", () => {
    renderRoute();
    expect(screen.getByRole("tab", { name: "Rules" })).toHaveAttribute("aria-selected", "true");
  });
  it("marks the URL view as the selected tab", () => {
    mocks.search = { view: "approvals" };
    renderRoute();
    expect(screen.getByRole("tab", { name: "Approvals" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Rules" })).toHaveAttribute("aria-selected", "false");
  });
});

/* ────────── Rules view ────────── */

describe("Flow — Rules view", () => {
  it("shows the loading state", () => {
    mocks.loading.rules = true;
    renderRoute();
    expect(screen.getByText(/Loading rules/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.rules = true;
    renderRoute();
    expect(screen.getByText(/Failed to load rules/i)).toBeInTheDocument();
  });
  it("shows the empty state when rules are missing", () => {
    mocks.data.rules = { rules: [] };
    renderRoute();
    expect(screen.getByText(/No automation rules yet/i)).toBeInTheDocument();
  });
  it("renders 3 KPIs and a rules table for populated data", () => {
    mocks.data.rules = RULES_DATA;
    renderRoute();
    expect(screen.getByText(/Total rules/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Enabled$/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Approval required/)).toBeInTheDocument();
  });
  it("renders the flow-automation-rule entity marker with count", () => {
    mocks.data.rules = RULES_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="flow-automation-rule"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("2");
  });
  it("renders Enabled / Disabled status pills", () => {
    mocks.data.rules = RULES_DATA;
    renderRoute();
    expect(screen.getAllByText("Enabled").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Disabled").length).toBeGreaterThan(0);
  });
  it("links each rule name to its detail route", () => {
    mocks.data.rules = RULES_DATA;
    renderRoute();
    const link = screen.getByRole("link", { name: "Auto invoice on quote accept" });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("data-href")).toBe("/app/flow/$ruleId");
    expect(link.getAttribute("data-params")).toContain("rule-1");
  });
});

/* ────────── Approvals view ────────── */

describe("Flow — Approvals view", () => {
  beforeEach(() => {
    mocks.search = { view: "approvals" };
  });
  it("shows the loading state", () => {
    mocks.loading.approvals = true;
    renderRoute();
    expect(screen.getByText(/Loading approvals/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.approvals = true;
    renderRoute();
    expect(screen.getByText(/Failed to load approvals/i)).toBeInTheDocument();
  });
  it("shows the empty state when approvals are missing", () => {
    mocks.data.approvals = { approvals: [] };
    renderRoute();
    expect(screen.getByText(/No approval requests/i)).toBeInTheDocument();
  });
  it("renders 4 KPIs and an approvals table for populated data", () => {
    mocks.data.approvals = APPROVALS_DATA;
    renderRoute();
    expect(screen.getAllByText(/^Pending$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Approved$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Executed$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Rejected$/).length).toBeGreaterThan(0);
  });
  it("renders the flow-approval entity marker with count", () => {
    mocks.data.approvals = APPROVALS_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="flow-approval"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("3");
  });
  it("sorts by risk rank then createdAt desc (legal → financial → operational)", () => {
    mocks.data.approvals = APPROVALS_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="flow-approval"]');
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    // legal first: ap-2; financial: ap-1; operational: ap-3
    expect(rows[0].textContent).toMatch(/Send legal letter/);
    expect(rows[1].textContent).toMatch(/Refund customer ACME/);
    expect(rows[2].textContent).toMatch(/Send follow-up task/);
  });
  it("renders risk + status pills", () => {
    mocks.data.approvals = APPROVALS_DATA;
    renderRoute();
    expect(screen.getAllByText("Legal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Financial").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Operational").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
  });
});

/* ────────── Runs view ────────── */

describe("Flow — Runs view", () => {
  beforeEach(() => {
    mocks.search = { view: "runs" };
  });
  it("shows the loading state", () => {
    mocks.loading.runs = true;
    renderRoute();
    expect(screen.getByText(/Loading runs/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.runs = true;
    renderRoute();
    expect(screen.getByText(/Failed to load runs/i)).toBeInTheDocument();
  });
  it("shows the empty state when runs are missing", () => {
    mocks.data.runs = { runs: [] };
    renderRoute();
    expect(screen.getByText(/No workflow runs yet/i)).toBeInTheDocument();
  });
  it("renders 3 KPIs and a runs table for populated data", () => {
    mocks.data.runs = RUNS_DATA;
    renderRoute();
    expect(screen.getByText(/Total runs/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Succeeded$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Failed$/).length).toBeGreaterThan(0);
  });
  it("renders the flow-run entity marker with count", () => {
    mocks.data.runs = RUNS_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="flow-run"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("2");
  });
  it("sorts runs by startedAt desc", () => {
    mocks.data.runs = RUNS_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="flow-run"]');
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    // rn-1 10:00, rn-2 09:00
    expect(rows[0].textContent).toMatch(/crm.task.create/);
    expect(rows[1].textContent).toMatch(/finance.invoice.propose/);
  });
  it("renders Succeeded and Failed pills", () => {
    mocks.data.runs = RUNS_DATA;
    renderRoute();
    expect(screen.getAllByText("Succeeded").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
  });
});

/* ────────── back link ────────── */

describe("Flow — back link", () => {
  it("renders a 'Today' link to /app", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Today/ });
    expect(back).toBeInTheDocument();
    expect(back.getAttribute("data-href")).toBe("/app");
  });
});
