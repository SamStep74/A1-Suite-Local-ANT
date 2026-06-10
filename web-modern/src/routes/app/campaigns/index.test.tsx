/**
 * /app/campaigns — route-level tests for the Campaigns workspace.
 *
 * Pattern A: mock the three layers (Router, Query, API client), then
 * drive the public component surface. We assert:
 *
 *  - page shell (title, Armenian subtitle, monogram)
 *  - validateSearch (default view, fallback for unknown values)
 *  - ViewSwitcher (4 tabs, role=tablist, current selection)
 *  - each view:
 *      - loading state
 *      - error state
 *      - empty state
 *      - data render (KPIs, tables, entity markers)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state ────────── */

const mocks = vi.hoisted(() => ({
  search: { view: "overview" as string },
  data: { performance: null as unknown },
  loading: { performance: false },
  error: { performance: false },
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
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
  } & Record<string, unknown>) => (
    <a data-href={to} href={to} {...rest}>
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
      if (key === "campaigns-performance") {
        return {
          data: mocks.data.performance,
          isLoading: mocks.loading.performance,
          isError: mocks.error.performance,
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

const PERFORMANCE_DATA = {
  ok: true,
  summary: {
    campaignCount: 3,
    totalSpend: 1_700_000,
    leadCount: 70,
    customerCount: 19,
    influencedPipeline: 3_100_000,
    acceptedRevenue: 550_000,
    paidRevenue: 3_650_000,
    roiPercent: 115,
  },
  campaigns: [
    {
      id: "cmp-1",
      name: "Summer push",
      channel: "paid-ads",
      status: "active",
      spend: 1_000_000,
      paidRevenue: 3_500_000,
      acceptedRevenue: 500_000,
      influencedPipeline: 2_000_000,
      leadCount: 42,
      customerCount: 12,
      dealCount: 4,
      quoteCount: 3,
      roiPercent: 250,
      attributions: [],
    },
    {
      id: "cmp-2",
      name: "Newsletter",
      channel: "email",
      status: "paused",
      spend: 200_000,
      paidRevenue: 150_000,
      acceptedRevenue: 50_000,
      influencedPipeline: 300_000,
      leadCount: 10,
      customerCount: 4,
      dealCount: 1,
      quoteCount: 1,
      roiPercent: -25,
      attributions: [],
    },
    {
      id: "cmp-3",
      name: "LinkedIn",
      channel: "social",
      status: "active",
      spend: 500_000,
      paidRevenue: 0,
      acceptedRevenue: 0,
      influencedPipeline: 800_000,
      leadCount: 18,
      customerCount: 3,
      dealCount: 0,
      quoteCount: 0,
      roiPercent: -100,
      attributions: [],
    },
  ],
  attributions: [],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = { view: "overview" };
  mocks.data = { performance: null };
  mocks.loading = { performance: false };
  mocks.error = { performance: false };
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("Campaigns — page shell", () => {
  it("renders the page title", () => {
    renderRoute();
    expect(screen.getByRole("heading", { name: "Campaigns", level: 1 })).toBeInTheDocument();
  });
  it("renders the Armenian subtitle", () => {
    renderRoute();
    expect(screen.getByText(/Արշավներ · Վճարումներ · Հաճախորդներ · ROI/)).toBeInTheDocument();
  });
  it("renders the Campaigns monogram badge", () => {
    renderRoute();
    expect(screen.getAllByText(/^Campaigns$/)).toHaveLength(2);
  });
});

/* ────────── validateSearch ────────── */

describe("Campaigns — validateSearch", () => {
  const fn = Route.options.validateSearch as (raw: Record<string, unknown>) => unknown;
  it("defaults to overview", () => {
    expect(fn({})).toEqual({ view: "overview" });
  });
  it("accepts each known view", () => {
    expect(fn({ view: "overview" })).toEqual({ view: "overview" });
    expect(fn({ view: "channels" })).toEqual({ view: "channels" });
    expect(fn({ view: "budget" })).toEqual({ view: "budget" });
    expect(fn({ view: "performance" })).toEqual({ view: "performance" });
  });
  it("falls back to overview for unknown values", () => {
    expect(fn({ view: "calendar" })).toEqual({ view: "overview" });
    expect(fn({ view: 99 })).toEqual({ view: "overview" });
  });
});

/* ────────── ViewSwitcher ────────── */

describe("Campaigns — ViewSwitcher", () => {
  it("renders 4 tabs with role=tablist", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: "View" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(4);
  });
  it("renders the 4 expected tab labels", () => {
    renderRoute();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Channels" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Budget" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Performance" })).toBeInTheDocument();
  });
  it("marks overview as the default selected tab", () => {
    renderRoute();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });
  it("marks the URL view as the selected tab", () => {
    mocks.search = { view: "channels" };
    renderRoute();
    expect(screen.getByRole("tab", { name: "Channels" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "false");
  });
});

/* ────────── Overview view ────────── */

describe("Campaigns — Overview view", () => {
  it("shows the loading state", () => {
    mocks.loading.performance = true;
    renderRoute();
    expect(screen.getByText(/Loading campaigns/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.performance = true;
    renderRoute();
    expect(screen.getByText(/Failed to load campaigns/i)).toBeInTheDocument();
  });
  it("shows the empty state when data is missing", () => {
    mocks.data.performance = null;
    renderRoute();
    expect(screen.getByText(/No campaign data available/i)).toBeInTheDocument();
  });
  it("renders 4 KPIs and a campaign table for a populated response", () => {
    mocks.data.performance = PERFORMANCE_DATA;
    renderRoute();
    expect(screen.getByText(/Total spend/)).toBeInTheDocument();
    expect(screen.getByText(/Paid revenue/)).toBeInTheDocument();
    expect(screen.getAllByText(/^ROI$/).length).toBeGreaterThan(0);
    // Campaign rows
    expect(screen.getByText("Summer push")).toBeInTheDocument();
    expect(screen.getByText("Newsletter")).toBeInTheDocument();
    expect(screen.getByText("LinkedIn")).toBeInTheDocument();
  });
  it("renders the campaigns-performance-row entity marker with count", () => {
    mocks.data.performance = PERFORMANCE_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="campaigns-performance-row"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("3");
  });
  it("sorts campaigns by spend desc (Summer push, LinkedIn, Newsletter)", () => {
    mocks.data.performance = PERFORMANCE_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="campaigns-performance-row"]');
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/Summer push/);
    expect(rows[1].textContent).toMatch(/LinkedIn/);
    expect(rows[2].textContent).toMatch(/Newsletter/);
  });
  it("renders status pills (Active / Paused)", () => {
    mocks.data.performance = PERFORMANCE_DATA;
    renderRoute();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Paused").length).toBeGreaterThan(0);
  });
});

/* ────────── Channels view ────────── */

describe("Campaigns — Channels view", () => {
  beforeEach(() => {
    mocks.search = { view: "channels" };
  });
  it("shows the loading state", () => {
    mocks.loading.performance = true;
    renderRoute();
    expect(screen.getByText(/Loading channels/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.performance = true;
    renderRoute();
    expect(screen.getByText(/Failed to load channels/i)).toBeInTheDocument();
  });
  it("renders 5 channel groups (paid | email | social | events | other)", () => {
    mocks.data.performance = PERFORMANCE_DATA;
    renderRoute();
    expect(screen.getByText(/Paid ads/)).toBeInTheDocument();
    expect(screen.getByText(/^Email$/)).toBeInTheDocument();
    expect(screen.getByText(/^Social$/)).toBeInTheDocument();
    expect(screen.getByText(/^Events$/)).toBeInTheDocument();
    expect(screen.getByText(/^Other$/)).toBeInTheDocument();
  });
  it("renders the campaigns-channel-group entity marker with count 5", () => {
    mocks.data.performance = PERFORMANCE_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="campaigns-channel-group"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("5");
  });
  it("shows the empty-in-group message for groups with no campaigns", () => {
    mocks.data.performance = PERFORMANCE_DATA;
    renderRoute();
    // events and other groups have 0 campaigns → empty message
    expect(screen.getAllByText(/Այս խմբում արշավներ չկան/).length).toBeGreaterThan(0);
  });
});

/* ────────── Budget view ────────── */

describe("Campaigns — Budget view", () => {
  beforeEach(() => {
    mocks.search = { view: "budget" };
  });
  it("shows the loading state", () => {
    mocks.loading.performance = true;
    renderRoute();
    expect(screen.getByText(/Loading budget/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.performance = true;
    renderRoute();
    expect(screen.getByText(/Failed to load budget/i)).toBeInTheDocument();
  });
  it("renders 3 KPIs and a budget table for populated data", () => {
    mocks.data.performance = PERFORMANCE_DATA;
    renderRoute();
    expect(screen.getByText(/Total budget/)).toBeInTheDocument();
    expect(screen.getByText(/Top ROI/)).toBeInTheDocument();
    expect(screen.getByText(/Active campaigns/)).toBeInTheDocument();
  });
  it("renders the campaigns-budget-row entity marker with count", () => {
    mocks.data.performance = PERFORMANCE_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="campaigns-budget-row"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("3");
  });
  it("sorts by ROI desc (Summer push +250, Newsletter -25, LinkedIn -100)", () => {
    mocks.data.performance = PERFORMANCE_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="campaigns-budget-row"]');
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/Summer push/);
    expect(rows[1].textContent).toMatch(/Newsletter/);
    expect(rows[2].textContent).toMatch(/LinkedIn/);
  });
});

/* ────────── Performance view ────────── */

describe("Campaigns — Performance view", () => {
  beforeEach(() => {
    mocks.search = { view: "performance" };
  });
  it("shows the loading state", () => {
    mocks.loading.performance = true;
    renderRoute();
    expect(screen.getByText(/Loading performance/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.performance = true;
    renderRoute();
    expect(screen.getByText(/Failed to load performance/i)).toBeInTheDocument();
  });
  it("renders 4 KPIs and a funnel table for populated data", () => {
    mocks.data.performance = PERFORMANCE_DATA;
    renderRoute();
    expect(screen.getAllByText(/^Leads$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Customers$/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Influenced pipeline/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Attributions$/).length).toBeGreaterThan(0);
  });
  it("renders the campaigns-performance-funnel-row entity marker with count", () => {
    mocks.data.performance = PERFORMANCE_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="campaigns-performance-funnel-row"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("3");
  });
});

/* ────────── back link ────────── */

describe("Campaigns — back link", () => {
  it("renders a 'Today' link to /app", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Today/ });
    expect(back).toBeInTheDocument();
    expect(back.getAttribute("data-href")).toBe("/app");
  });
});
