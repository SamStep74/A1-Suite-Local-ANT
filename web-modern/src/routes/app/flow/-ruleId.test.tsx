/**
 * /app/flow/$ruleId — route-level tests for the rule version history
 * detail surface.
 *
 * Coverage:
 *  - Loading state ("Loading rule…")
 *  - Not-found (no data envelope, empty versions)
 *  - Error state
 *  - Header (title, ruleId)
 *  - KPIs: current version, status, total versions, last dry-run
 *  - Rule meta: trigger, action
 *  - Version table: rows + entity marker with count
 *  - Back-link to /app/flow
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
  params: { ruleId: "rule-1" as string },
  data: null as unknown,
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
      if (queryKey[0] === "flow-rule-versions") {
        return {
          data: mocks.data,
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

import { Route } from "./$ruleId";

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

const VERSIONS_DATA = {
  ok: true,
  rule: {
    id: "rule-1",
    name: "Auto invoice on quote accept",
    trigger: "quote.accepted",
    action: "finance.invoice.propose",
    enabled: true,
    currentVersion: 3,
    approvalRequired: true,
    lastDryRun: { id: "dr-1", createdAt: "2026-06-10T08:00:00Z", status: "succeeded" },
  },
  versions: [
    {
      id: "v3",
      ruleId: "rule-1",
      versionNumber: 3,
      changeType: "modify",
      reason: "Tightened guardrails after Q2 review",
      changedByName: "Lilit",
      changedAt: "2026-06-08T11:00:00Z",
    },
    {
      id: "v2",
      ruleId: "rule-1",
      versionNumber: 2,
      changeType: "modify",
      reason: "Switched approval to Owner-only",
      changedByName: "Lilit",
      changedAt: "2026-05-20T11:00:00Z",
    },
    {
      id: "v1",
      ruleId: "rule-1",
      versionNumber: 1,
      changeType: "create",
      reason: "Initial rollout",
      changedByName: "Lilit",
      changedAt: "2026-04-15T11:00:00Z",
    },
  ],
};

const DISABLED_DATA = {
  ok: true,
  rule: {
    id: "rule-2",
    name: "Lead nurture",
    trigger: "lead.created",
    action: "crm.task.create",
    enabled: false,
    currentVersion: 1,
    approvalRequired: false,
    lastDryRun: null,
  },
  versions: [
    {
      id: "v1b",
      ruleId: "rule-2",
      versionNumber: 1,
      changeType: "create",
      reason: "Pilot",
      changedByName: "Aram",
      changedAt: "2026-05-01T11:00:00Z",
    },
  ],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.params = { ruleId: "rule-1" };
  mocks.data = JSON.parse(JSON.stringify(VERSIONS_DATA));
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── loading / not-found / error ────────── */

describe("RuleDetail — loading / not-found / error", () => {
  it("shows the loading message while the query is in-flight", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading rule/i)).toBeInTheDocument();
  });
  it("shows the 'no versions' message when data is missing", () => {
    mocks.data = null;
    renderRoute();
    expect(screen.getByText(/No versions for this rule/i)).toBeInTheDocument();
  });
  it("shows the 'no versions' message when versions and rule are empty", () => {
    mocks.data = { ok: true, rule: null, versions: [] };
    renderRoute();
    expect(screen.getByText(/No versions for this rule/i)).toBeInTheDocument();
  });
  it("shows the 'failed' message when the query errors", () => {
    mocks.error = true;
    mocks.data = null;
    renderRoute();
    expect(screen.getByText(/Failed to load rule/i)).toBeInTheDocument();
  });
});

/* ────────── header ────────── */

describe("RuleDetail — header", () => {
  it("renders the page title as a level-1 heading", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", {
        name: /Կանոնի տարբերակների պատմություն/,
        level: 1,
      }),
    ).toBeInTheDocument();
  });
  it("renders the ruleId in the subtitle", () => {
    renderRoute();
    expect(screen.getByText(/rule-1/)).toBeInTheDocument();
  });
  it("renders the Flow · Rule monogram badge", () => {
    renderRoute();
    expect(screen.getByText(/Flow · Rule/)).toBeInTheDocument();
  });
});

/* ────────── KPIs ────────── */

describe("RuleDetail — KPIs", () => {
  it("renders current version, status, total versions, last dry-run", () => {
    renderRoute();
    expect(screen.getByText(/Current version/)).toBeInTheDocument();
    expect(screen.getByText(/^Status$/)).toBeInTheDocument();
    expect(screen.getByText(/Total versions/)).toBeInTheDocument();
    expect(screen.getByText(/Last dry-run/)).toBeInTheDocument();
  });
  it("shows currentVersion=3 and totalVersions=3 for the standard fixture", () => {
    renderRoute();
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
  });
  it("shows 'Enabled' status for an enabled rule", () => {
    renderRoute();
    expect(screen.getAllByText("Enabled").length).toBeGreaterThan(0);
  });
  it("shows 'Disabled' status for a disabled rule", () => {
    mocks.data = DISABLED_DATA;
    renderRoute();
    expect(screen.getAllByText("Disabled").length).toBeGreaterThan(0);
  });
  it("shows 'Never' for last dry-run when none", () => {
    mocks.data = DISABLED_DATA;
    renderRoute();
    expect(screen.getByText("Never")).toBeInTheDocument();
  });
});

/* ────────── rule meta ────────── */

describe("RuleDetail — rule meta", () => {
  it("renders the rule name + trigger + action", () => {
    renderRoute();
    expect(screen.getByText("Auto invoice on quote accept")).toBeInTheDocument();
    expect(screen.getByText("quote.accepted")).toBeInTheDocument();
    expect(screen.getByText("finance.invoice.propose")).toBeInTheDocument();
  });
  it("renders the flow-rule-meta entity marker", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="flow-rule-meta"]');
    expect(marker).not.toBeNull();
  });
});

/* ────────── version table ────────── */

describe("RuleDetail — version table", () => {
  it("renders the version rows from the schedule", () => {
    renderRoute();
    expect(screen.getByText(/v3/)).toBeInTheDocument();
    expect(screen.getByText(/v2/)).toBeInTheDocument();
    expect(screen.getByText(/v1/)).toBeInTheDocument();
  });
  it("renders the change-type and reason", () => {
    renderRoute();
    expect(screen.getAllByText("modify").length).toBeGreaterThan(0);
    expect(screen.getAllByText("create").length).toBeGreaterThan(0);
    expect(screen.getByText(/Tightened guardrails after Q2 review/)).toBeInTheDocument();
  });
  it("renders a hidden flow-rule-version entity marker with the count", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="flow-rule-version"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("3");
  });
  it("sorts versions by versionNumber desc (v3 → v2 → v1)", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="flow-rule-version"]');
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/v3/);
    expect(rows[1].textContent).toMatch(/v2/);
    expect(rows[2].textContent).toMatch(/v1/);
  });
  it("falls back to italic '(no reason)' when reason is missing", () => {
    mocks.data = {
      ok: true,
      rule: VERSIONS_DATA.rule,
      versions: [
        {
          id: "v0",
          ruleId: "rule-1",
          versionNumber: 1,
          changeType: "create",
          reason: null,
          changedByName: "Sys",
          changedAt: "2026-04-01T11:00:00Z",
        },
      ],
    };
    renderRoute();
    expect(screen.getByText(/\(no reason\)/)).toBeInTheDocument();
  });
});

/* ────────── back link ────────── */

describe("RuleDetail — back link", () => {
  it("renders a 'Back to Flow' link to /app/flow with view=rules", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Back to Flow/ });
    expect(back).toBeInTheDocument();
    expect(back.getAttribute("data-href")).toBe("/app/flow");
    expect(back.getAttribute("data-search")).toContain("rules");
  });
});
