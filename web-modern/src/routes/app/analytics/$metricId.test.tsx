/**
 * /app/analytics/$metricId — route-level tests for the metric drilldown
 * detail surface.
 *
 * Mirrors projects/$projectId pattern. Coverage:
 *
 *  - Loading state ("Loading metric…")
 *  - Not-found (no data envelope)
 *  - Error state
 *  - Header (label, monogram with metricId)
 *  - KPIs: Value, Records, AMD total
 *  - Meta section: Formula, Definition, Owner/Cadence/Sources
 *  - Drilldown records table (counted via entity marker)
 *  - Back-link to /app/analytics with view=metrics
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
  params: { metricId: "pipeline-value" as string },
  drilldown: null as unknown,
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
      if (queryKey[0] === "analytics-metric-drilldown") {
        return {
          data: mocks.drilldown,
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

import { Route } from "./$metricId";

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

const DRILLDOWN = {
  metric: {
    id: "pipeline-value",
    label: "Tube value",
    value: 1_000_000,
    unit: "AMD",
    formula: "Sum open CRM deal value",
    definition: "Total AMD value of non-won CRM deals.",
    sourceApps: ["Armosphera CRM"],
    refreshCadence: "live",
    ownerRole: "Salesperson",
    recordCount: 12,
    drilldownUrl: "/api/analytics/semantic-metrics/pipeline-value/drilldown",
  },
  totals: {
    recordCount: 12,
    amdTotal: 1_000_000,
  },
  records: [
    {
      sourceApp: "Armosphera CRM",
      customerName: "ACME",
      total: 600_000,
      status: "open",
    },
    {
      sourceApp: "Armosphera CRM",
      customerName: "Globex",
      total: 400_000,
      status: "open",
    },
  ],
};

const EMPTY_DRILLDOWN = {
  metric: {
    id: "no-records",
    label: "Empty metric",
    value: 0,
    unit: "count",
    formula: "COUNT(*)",
    definition: "Counts things.",
    sourceApps: ["HayHashvapah Finance"],
    refreshCadence: "daily",
    ownerRole: "Accountant",
    recordCount: 0,
    drilldownUrl: "/api/analytics/semantic-metrics/no-records/drilldown",
  },
  totals: { recordCount: 0, amdTotal: 0 },
  records: [],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.params = { metricId: "pipeline-value" };
  mocks.drilldown = { ...DRILLDOWN };
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── loading / not-found / error ────────── */

describe("MetricDetail — loading / not-found / error", () => {
  it("shows the loading message while the query is in-flight", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading metric/i)).toBeInTheDocument();
  });
  it("shows the 'no metric' message when data is missing", () => {
    mocks.drilldown = null;
    renderRoute();
    expect(screen.getByText(/No metric data/i)).toBeInTheDocument();
  });
  it("shows the 'failed' message when the query errors", () => {
    mocks.error = true;
    mocks.drilldown = null;
    renderRoute();
    expect(screen.getByText(/Failed to load metric drilldown/i)).toBeInTheDocument();
  });
});

/* ────────── header ────────── */

describe("MetricDetail — header", () => {
  it("renders the metric label as a level-1 heading", () => {
    renderRoute();
    expect(screen.getByRole("heading", { name: "Tube value", level: 1 })).toBeInTheDocument();
  });
  it("renders the metricId in the monogram badge", () => {
    renderRoute();
    expect(screen.getByText(/ANALYTICS · pipeline-value/)).toBeInTheDocument();
  });
  it("uses Armenian fallback heading when label is missing", () => {
    mocks.params = { metricId: "orphan" };
    mocks.drilldown = null;
    renderRoute();
    // The 404 state falls back to the Armenian placeholder heading
    expect(screen.getByRole("heading", { name: "Չափորոշիչ", level: 1 })).toBeInTheDocument();
  });
});

/* ────────── KPIs ────────── */

describe("MetricDetail — KPIs", () => {
  it("renders Value, Records, AMD total labels", () => {
    renderRoute();
    expect(screen.getByText(/^Value$/)).toBeInTheDocument();
    expect(screen.getByText(/^Records$/)).toBeInTheDocument();
    expect(screen.getByText(/AMD total/)).toBeInTheDocument();
  });
  it("uses intl currency formatting on AMD value (1,000,000 AMD)", () => {
    renderRoute();
    // Intl returns the AMD symbol; 1,000,000 appears in both the Value KPI
    // and the AMD total KPI, so we just check at least one match.
    expect(screen.getAllByText(/1\s000\s000/).length).toBeGreaterThan(0);
  });
  it("renders the Records KPI as 12", () => {
    renderRoute();
    expect(screen.getByText("12")).toBeInTheDocument();
  });
});

/* ────────── meta section ────────── */

describe("MetricDetail — meta section", () => {
  it("renders the Formula and Definition labels", () => {
    renderRoute();
    expect(screen.getByText(/^Formula$/)).toBeInTheDocument();
    expect(screen.getByText(/^Definition$/)).toBeInTheDocument();
  });
  it("renders the formula and definition content", () => {
    renderRoute();
    expect(screen.getByText(/Sum open CRM deal value/)).toBeInTheDocument();
    expect(screen.getByText(/Total AMD value of non-won CRM deals/)).toBeInTheDocument();
  });
  it("renders the owner / cadence / sources footer", () => {
    renderRoute();
    expect(screen.getByText(/Owner:/)).toBeInTheDocument();
    expect(screen.getByText(/Salesperson/)).toBeInTheDocument();
    expect(screen.getByText(/Cadence:/)).toBeInTheDocument();
    expect(screen.getByText(/live/)).toBeInTheDocument();
    expect(screen.getByText(/Sources:/)).toBeInTheDocument();
    // "Armosphera CRM" appears in the meta footer AND each drilldown row.
    expect(screen.getAllByText(/Armosphera CRM/).length).toBeGreaterThan(0);
  });
});

/* ────────── drilldown records table ────────── */

describe("MetricDetail — drilldown records table", () => {
  it("renders 2 customer rows (ACME, Globex)", () => {
    renderRoute();
    expect(screen.getByText("ACME")).toBeInTheDocument();
    expect(screen.getByText("Globex")).toBeInTheDocument();
  });
  it("renders the entity marker with the count", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="analytics-drilldown-record"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("2");
  });
  it("formats the per-row total as AMD currency", () => {
    renderRoute();
    // 600,000 and 400,000 both get AMD formatted with digit grouping
    expect(screen.getByText(/600\s000/)).toBeInTheDocument();
    expect(screen.getByText(/400\s000/)).toBeInTheDocument();
  });
  it("shows the empty-state message when there are no records", () => {
    mocks.drilldown = EMPTY_DRILLDOWN;
    renderRoute();
    expect(screen.getByText(/No drilldown records/i)).toBeInTheDocument();
  });
  it("uses the records count from the table (0 when empty)", () => {
    mocks.drilldown = EMPTY_DRILLDOWN;
    renderRoute();
    const marker = document.querySelector('[data-entity="analytics-drilldown-record"]');
    expect(marker?.getAttribute("data-count")).toBe("0");
  });
  it("renders the table header row", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="analytics-drilldown-record"]');
    const table = marker?.querySelector("table");
    const headers = within(table as HTMLElement).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "Source",
      "Customer / Subject",
      "Total",
      "Status",
    ]);
  });
});

/* ────────── back link ────────── */

describe("MetricDetail — back link", () => {
  it("renders a 'Back to Analytics' link to /app/analytics with view=metrics", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Back to Analytics/ });
    expect(back).toBeInTheDocument();
    expect(back.getAttribute("data-href")).toBe("/app/analytics");
    expect(back.getAttribute("data-search")).toContain("metrics");
  });
});
