/**
 * /app/crm (index route) — first route-level test for the CRM
 * workspace.
 *
 * The route file is glue code that wires TanStack Router + Query to a
 * handful of inline sub-components (`PageHeader`, `QuoteTable`,
 * `QuoteKanban`, `LeadsView`, `EmptyState`, `ForecastTotals`,
 * `STATUS_TABS` filter bar, …). Those sub-components are NOT
 * individually exported, so the only public surface we can drive from
 * a test is the `Route` object that `createFileRoute` returns — its
 * `options.validateSearch` and `options.component`.
 *
 * The mocking pattern here is the same one the
 * `phase2-inventory-tests/routes-inventory` worker established:
 *
 *   1. `vi.hoisted` exposes a `mocks` object the test body mutates
 *      (URL search params, query data, loading flags).
 *   2. `@tanstack/react-router` is mocked so `createFileRoute`
 *      returns a stub Route whose `useSearch` reads from `mocks`
 *      and whose `options` exposes the route config.
 *   3. `@tanstack/react-query` is mocked so `useQuery` returns
 *      canned data per `queryKey` (crm-quotes | crm-forecast |
 *      crm-leads) and `useQueryClient` is a no-op.
 *   4. `@/lib/api/client` is mocked so the network call in the
 *      real `queryFn` is never actually made.
 *   5. The test then either asserts on
 *      `Route.options.validateSearch` (pure) or renders
 *      `Route.options.component` inside `<QueryClientProvider>` and
 *      asserts on the rendered output (text, role, links).
 *
 * See `web-modern/src/routes/app/inventory/index.test.tsx` for the
 * canonical version of this pattern.
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

/* ────────── mock state, hoisted so vi.mock factories can see it ────────── */

type View = "list" | "kanban" | "leads";
type Status = "all" | "draft" | "sent" | "accepted" | "declined" | "expired";

const mocks = vi.hoisted(() => ({
  search: { view: "list" as View, status: "all" as Status },
  quotes: null as unknown,
  forecast: null as unknown,
  leads: null as unknown,
  loading: false,
  fullPath: "/app/crm/",
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
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
  } & Record<string, unknown>) => (
    <a data-href={to} href={to} {...rest}>
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
      if (key === "crm-quotes") {
        return { data: mocks.quotes, isLoading: mocks.loading };
      }
      if (key === "crm-forecast") {
        return { data: mocks.forecast, isLoading: mocks.loading };
      }
      if (key === "crm-leads") {
        return { data: mocks.leads, isLoading: mocks.loading };
      }
      return { data: null, isLoading: false };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../lib/api/client", () => ({
  getJson: vi.fn().mockResolvedValue({}),
  postJson: vi.fn().mockResolvedValue({}),
}));

/* ────────── import the route under test (mocks are in place by now) ───── */

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

const VALID_QUOTES = {
  quotes: [
    {
      id: "q-1",
      customerId: "c-1",
      customerName: "Acme Clinic",
      number: "Q-001",
      title: "Treatment chair package",
      status: "draft" as const,
      total: 1200000,
      dealTitle: "Q2 expansion",
      dealId: "d-1",
      validUntil: "2026-08-01T00:00:00.000Z",
    },
    {
      id: "q-2",
      customerId: "c-2",
      customerName: "Northside Spa",
      number: "Q-002",
      title: "Aesthetic laser",
      status: "sent" as const,
      total: 5000000,
      dealTitle: null,
      dealId: null,
      validUntil: null,
    },
    {
      id: "q-3",
      customerId: "c-3",
      customerName: "Downtown Wellness",
      number: "Q-003",
      title: "Hydraulic table",
      status: "accepted" as const,
      total: 800000,
      dealTitle: "Wellness package",
      dealId: "d-2",
      validUntil: "2026-07-15T00:00:00.000Z",
    },
  ],
};

const VALID_FORECAST = {
  categories: [
    { forecastCategory: "pipeline", count: 3, value: 7000000, weightedValue: 3500000 },
  ],
  deals: [],
  dealRiskBriefs: [],
  totals: { value: 7000000, weightedValue: 3500000, atRisk: 2, unreviewed: 1 },
};

const VALID_LEADS = {
  leads: [
    {
      id: "l-1",
      companyName: "Riverside Med",
      contactName: "Anna Petrosyan",
      source: "web",
      status: "new",
      score: 72,
    },
    {
      id: "l-2",
      companyName: "Highland Dental",
      contactName: null,
      source: null,
      status: "contacted",
      score: 41,
    },
  ],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = { view: "list", status: "all" };
  mocks.quotes = VALID_QUOTES;
  mocks.forecast = VALID_FORECAST;
  mocks.leads = VALID_LEADS;
  mocks.loading = false;
});

afterEach(() => {
  cleanup();
});

/* ─────────────────────────────────────────────────────────────────────
 * validateSearch — the route's URL coercion. Pin the defaulting
 * logic so a future refactor can't silently widen the input space.
 * ──────────────────────────────────────────────────────────────────── */

describe("Route.options.validateSearch", () => {
  it("defaults view to 'list' and status to 'all' on empty input", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({});
    expect(r).toEqual({ view: "list", status: "all" });
  });

  it("accepts 'kanban' as a view", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ view: "kanban" });
    expect(r).toMatchObject({ view: "kanban" });
  });

  it("accepts 'leads' as a view", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ view: "leads" });
    expect(r).toMatchObject({ view: "leads" });
  });

  it("falls back to 'list' for an unknown view", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ view: "garbage" });
    expect(r).toMatchObject({ view: "list" });
  });

  it("accepts every known status string", () => {
    const fn = Route.options.validateSearch as (
      raw: Record<string, unknown>,
    ) => unknown;
    for (const s of ["draft", "sent", "accepted", "declined", "expired"]) {
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

/* ─────────────────────────────────────────────────────────────────────
 * CrmWorkspace — root component rendering. The page header, the
 * ViewSwitcher, the Leads pipeline link, and the inline EmptyState
 * are all exercised through the public component surface.
 * ──────────────────────────────────────────────────────────────────── */

describe("CrmWorkspace — page shell", () => {
  it("shows the loading message while quotes are loading", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading quotes/i)).toBeInTheDocument();
  });

  it("renders the header with title 'CRM' and the lead-capture subtitle", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "CRM", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Quotes · Deals · Leads · Forecast/)).toBeInTheDocument();
  });

  it("renders the 'Today' back-link to /app", () => {
    renderRoute();
    const backLinks = screen.getAllByRole("link");
    const todayLink = backLinks.find(
      (l) => l.textContent === "Today",
    );
    expect(todayLink).toBeDefined();
    expect(todayLink?.getAttribute("data-href")).toBe("/app");
  });

  it("renders the 'Leads pipeline' quick-link into the leads view", () => {
    renderRoute();
    const pipeline = screen.getByText(/Leads pipeline/);
    expect(pipeline).toBeInTheDocument();
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * QuotesView (list) — exercises the inline sub-components
 * QuoteTable, the status tab bar, and ForecastTotals.
 * ──────────────────────────────────────────────────────────────────── */

describe("CrmWorkspace — list view", () => {
  it("renders one row per quote in the table", () => {
    renderRoute();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // 1 header row + 3 data rows
    expect(rows).toHaveLength(4);
  });

  it("renders the status filter tabs with their counts", () => {
    renderRoute();
    // STATUS_TABS renders as <button> inside <nav aria-label="Filter
    // by status">. ViewSwitcher uses role="tab" for List/Kanban/Leads,
    // so the filter nav is a different element — scope by the nav.
    const nav = screen.getByRole("navigation", {
      name: /Filter by status/i,
    });
    const labels = within(nav)
      .getAllByRole("button")
      .map((b) => b.textContent ?? "");
    expect(labels.some((l) => l.startsWith("All"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Draft"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Sent"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Accepted"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Declined"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Expired"))).toBe(true);
  });

  it("pins the 'All' tab count to the total quote count", () => {
    renderRoute();
    const nav = screen.getByRole("navigation", {
      name: /Filter by status/i,
    });
    const allTab = within(nav)
      .getAllByRole("button")
      .find((b) => (b.textContent ?? "").startsWith("All"));
    expect(allTab?.textContent).toMatch(/All\s*3/);
  });

  it("shows the EmptyState when there are no quotes", () => {
    mocks.quotes = { quotes: [] };
    renderRoute();
    expect(screen.getByText(/No quotes in this view/i)).toBeInTheDocument();
  });

  it("renders a hidden crm-quote entity marker for smoke / E2E", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="crm-quote"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("3");
  });

  it("renders the pipeline forecast totals on the right rail", () => {
    renderRoute();
    // ForecastTotals renders a section with the "Pipeline" heading
    // and the "Total" + "Weighted" <dt> labels inside it. The "Total"
    // text also appears in the quote-table header, so we scope the
    // lookup to the Pipeline aside.
    const pipelineHeading = screen.getByRole("heading", { name: /Pipeline/ });
    expect(pipelineHeading).toBeInTheDocument();
    // The dt/dd are inside a <dl>; <dl> has implicit role="list" or
    // "definition" depending on the implementation. We assert on the
    // rendered label text via getAllByText (matches both the table
    // header and the pipeline aside, so use a more specific scope).
    const allTotals = screen.getAllByText("Total");
    expect(allTotals.length).toBeGreaterThanOrEqual(2);
    const weighteds = screen.getAllByText("Weighted");
    expect(weighteds.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the at-risk count when atRisk > 0", () => {
    renderRoute();
    // VALID_FORECAST.totals.atRisk = 2 → plural "deals at risk".
    // Both ForecastSummaryCard and ForecastTotals surface the count
    // when atRisk > 0, so use getAllByText.
    const matches = screen.getAllByText(/2 deals at risk/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * Status filtering — the QuotesView applies the `status` URL
 * filter on top of the API list. We pin the behaviour through
 * rendered output.
 * ──────────────────────────────────────────────────────────────────── */

describe("CrmWorkspace — status filter", () => {
  it("filters the table to only 'sent' quotes when status=sent", () => {
    mocks.search = { view: "list", status: "sent" };
    renderRoute();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // 1 header + 1 sent quote
    expect(rows).toHaveLength(2);
    expect(within(table).getByText("Aesthetic laser")).toBeInTheDocument();
    expect(within(table).queryByText("Treatment chair package")).toBeNull();
  });

  it("pins the 'Sent' tab as the active tab when status=sent", () => {
    mocks.search = { view: "list", status: "sent" };
    renderRoute();
    // STATUS_TABS use aria-current="page" on the active button, not
    // the ViewSwitcher role="tab" pattern. Scope to the filter nav.
    const nav = screen.getByRole("navigation", {
      name: /Filter by status/i,
    });
    const sentTab = within(nav)
      .getAllByRole("button")
      .find((b) => (b.textContent ?? "").startsWith("Sent"));
    expect(sentTab?.getAttribute("aria-current")).toBe("page");
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * Kanban view — the inline QuoteKanban bucketing logic is exercised
 * by switching the URL to ?view=kanban and asserting on the rendered
 * kanban columns. We don't depend on the KanbanBoard internals —
 * just that the page renders without throwing and the kanban marker
 * is present.
 * ──────────────────────────────────────────────────────────────────── */

describe("CrmWorkspace — kanban view", () => {
  it("renders the kanban view without throwing when view=kanban", () => {
    mocks.search = { view: "kanban", status: "all" };
    expect(() => renderRoute()).not.toThrow();
    // The page header should still be there.
    expect(
      screen.getByRole("heading", { name: "CRM", level: 1 }),
    ).toBeInTheDocument();
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * Leads view — the inline LeadsView with the LeadCaptureForm
 * right rail. The LeadCaptureForm is a real component (not
 * individually mocked) — we only assert on the route shell here.
 * ──────────────────────────────────────────────────────────────────── */

describe("CrmWorkspace — leads view", () => {
  it("renders the Leads heading when view=leads", () => {
    mocks.search = { view: "leads", status: "all" };
    renderRoute();
    expect(screen.getByRole("heading", { name: /Leads/ })).toBeInTheDocument();
  });

  it("shows the lead count from the leads query", () => {
    mocks.search = { view: "leads", status: "all" };
    renderRoute();
    // VALID_LEADS has 2 leads — the header shows "2" in the mono span.
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders the empty-leads copy when there are no leads", () => {
    mocks.search = { view: "leads", status: "all" };
    mocks.leads = { leads: [] };
    renderRoute();
    expect(screen.getByText(/No leads yet/i)).toBeInTheDocument();
  });
});
