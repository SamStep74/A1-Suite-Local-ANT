/**
 * /app/analytics — route-level tests for the Analytics workspace (index).
 *
 * Pattern A: mock the three layers (Router, Query, API client), then
 * drive the public component surface. We assert:
 *
 *  - page shell (title, Armenian subtitle, monogram)
 *  - validateSearch (default view, fallback for unknown values)
 *  - ViewSwitcher (5 tabs, role=tablist, current selection)
 *  - each view: loading / error / entity marker / data render
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── Lingui passthrough mocks ────────── */

/**
 * The route file (Phase 10.3) wraps every user-facing string in
 * <Trans> / t`` so the production tree needs an I18nProvider. The
 * test environment mocks the i18n module out instead, which:
 *   - keeps the existing assertions stable (Trans renders children
 *     verbatim, t`` returns its argument as a string),
 *   - avoids having to dynamically import the compiled hy/messages
 *     catalog from a test (which depends on `lingui compile` having
 *     run; the canary unit test should not require build steps).
 * The companion `I18nProvider.test.tsx` exercises the real
 * provider shape (dynamic import, localStorage, ?lang=).
 */
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
    <>{children ?? id ?? null}</>
  ),
  useLingui: () => ({
    t: (s: string | TemplateStringsArray) => (Array.isArray(s) ? s[0] : s),
    i18n: { _: (s: string) => s, locale: "hy" },
  }),
}));

/* ────────── mock state ────────── */

const mocks = vi.hoisted(() => ({
  search: { view: "dashboard" as string },
  data: {
    dashboard: null as unknown,
    receivables: null as unknown,
    metrics: null as unknown,
    snapshots: null as unknown,
    reports: null as unknown,
  },
  loading: {
    dashboard: false,
    receivables: false,
    metrics: false,
    snapshots: false,
    reports: false,
  },
  error: {
    dashboard: false,
    receivables: false,
    metrics: false,
    snapshots: false,
    reports: false,
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
      if (key === "analytics-role-dashboard") {
        return {
          data: mocks.data.dashboard,
          isLoading: mocks.loading.dashboard,
          isError: mocks.error.dashboard,
        };
      }
      if (key === "analytics-receivables-aging") {
        return {
          data: mocks.data.receivables,
          isLoading: mocks.loading.receivables,
          isError: mocks.error.receivables,
        };
      }
      if (key === "analytics-semantic-metrics") {
        return {
          data: mocks.data.metrics,
          isLoading: mocks.loading.metrics,
          isError: mocks.error.metrics,
        };
      }
      if (key === "analytics-semantic-snapshots") {
        return {
          data: mocks.data.snapshots,
          isLoading: mocks.loading.snapshots,
          isError: mocks.error.snapshots,
        };
      }
      if (key === "analytics-reports") {
        return {
          data: mocks.data.reports,
          isLoading: mocks.loading.reports,
          isError: mocks.error.reports,
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

const DASHBOARD = {
  role: "Owner",
  dashboardId: "owner-default",
  title: "Owner dashboard",
  generatedAt: "2026-06-10T00:00:00Z",
  apps: [
    { id: "analytics", name: "Analytics", category: "Insight" },
    { id: "finance", name: "HayHashvapah Finance", category: "Finance" },
  ],
  semanticLayerVersion: "v3",
  primaryMetricIds: ["pipeline-value"],
  summaryCards: [
    {
      id: "pipeline-value",
      label: "Tube value",
      value: 1_000_000,
      unit: "AMD",
      recordCount: 12,
      sourceApps: ["Armosphera CRM"],
      formula: "Sum open CRM deal value",
      definition: "Total AMD value of non-won CRM deals.",
      drilldownUrl: "/api/analytics/semantic-metrics/pipeline-value/drilldown",
      ownerRole: "Salesperson",
    },
  ],
  permissions: {
    canCaptureSnapshots: true,
    canCreateOwnerReport: true,
    canCreateAccountantReport: false,
    canReadReports: true,
  },
  nextActions: [
    { actionKey: "capture-snapshots", label: "Capture snapshots", description: "Snapshot the current metrics" },
  ],
};

const RECEIVABLES = {
  currency: "AMD",
  reportDate: "2026-06-10",
  summary: {
    totalOpen: 1_000_000,
    overdue: 250_000,
    current: 750_000,
    invoiceCount: 10,
    overdueInvoiceCount: 3,
    customerCount: 5,
  },
  buckets: [
    { key: "current", label: "Current", total: 750_000, invoiceCount: 7, customerCount: 3 },
    { key: "0-30", label: "0-30", total: 150_000, invoiceCount: 2, customerCount: 2 },
    { key: "31-60", label: "31-60", total: 100_000, invoiceCount: 1, customerCount: 1 },
  ],
};

const METRICS = {
  semanticLayerVersion: "v3",
  reportDate: "2026-06-10",
  generatedAt: "2026-06-10T00:00:00Z",
  metrics: [
    {
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
    {
      id: "overdue-exposure",
      label: "Overdue exposure",
      value: 250_000,
      unit: "AMD",
      formula: "Open invoice total where due date < report date",
      definition: "AMD exposure from overdue invoices.",
      sourceApps: ["HayHashvapah Finance"],
      refreshCadence: "daily",
      ownerRole: "Accountant",
      recordCount: 3,
      drilldownUrl: "/api/analytics/semantic-metrics/overdue-exposure/drilldown",
    },
  ],
};

const SNAPSHOTS = {
  semanticLayerVersion: "v3",
  snapshots: [],
  series: [
    {
      metricId: "pipeline-value",
      label: "Tube value",
      unit: "AMD",
      sourceApps: ["Armosphera CRM"],
      points: [
        { reportDate: "2026-01-01", value: 800_000, recordCount: 10 },
        { reportDate: "2026-02-01", value: 900_000, recordCount: 11 },
        { reportDate: "2026-03-01", value: 1_000_000, recordCount: 12 },
      ],
    },
  ],
};

const REPORTS = {
  reports: [
    {
      id: "r-1",
      reportType: "owner",
      periodKey: "2026-06",
      format: "json",
      status: "ready",
      metricCount: 8,
      snapshotCount: 24,
      createdByName: "Alice",
      createdAt: "2026-06-09T10:00:00Z",
    },
    {
      id: "r-2",
      reportType: "accountant",
      periodKey: "2026-05",
      format: "json",
      status: "ready",
      metricCount: 6,
      snapshotCount: 18,
      createdByName: "Bob",
      createdAt: "2026-06-08T10:00:00Z",
    },
  ],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = { view: "dashboard" };
  mocks.data = { dashboard: null, receivables: null, metrics: null, snapshots: null, reports: null };
  mocks.loading = { dashboard: false, receivables: false, metrics: false, snapshots: false, reports: false };
  mocks.error = { dashboard: false, receivables: false, metrics: false, snapshots: false, reports: false };
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("Analytics — page shell", () => {
  it("renders the page title", () => {
    renderRoute();
    expect(screen.getByRole("heading", { name: "Analytics", level: 1 })).toBeInTheDocument();
  });
  it("renders the Armenian subtitle", () => {
    renderRoute();
    expect(
      screen.getByText(/Վահանակ · Դեբիտորական պարտքեր · Սեմանտիկ չափորոշիչներ · Պատկերացումներ · Հաշվետվություններ/),
    ).toBeInTheDocument();
  });
  it("renders the ANALYTICS monogram badge", () => {
    renderRoute();
    expect(screen.getByText("ANALYTICS")).toBeInTheDocument();
  });
});

/* ────────── validateSearch ────────── */

describe("Analytics — validateSearch", () => {
  const fn = Route.options.validateSearch as (raw: Record<string, unknown>) => unknown;
  it("defaults to dashboard", () => {
    expect(fn({})).toEqual({ view: "dashboard" });
  });
  it("accepts each known view", () => {
    expect(fn({ view: "dashboard" })).toEqual({ view: "dashboard" });
    expect(fn({ view: "receivables" })).toEqual({ view: "receivables" });
    expect(fn({ view: "metrics" })).toEqual({ view: "metrics" });
    expect(fn({ view: "snapshots" })).toEqual({ view: "snapshots" });
    expect(fn({ view: "reports" })).toEqual({ view: "reports" });
  });
  it("falls back to dashboard for unknown values", () => {
    expect(fn({ view: "kanban" })).toEqual({ view: "dashboard" });
    expect(fn({ view: 7 })).toEqual({ view: "dashboard" });
  });
});

/* ────────── ViewSwitcher ────────── */

describe("Analytics — ViewSwitcher", () => {
  it("renders 5 tabs with role=tablist", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: "View" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(5);
  });
  it("renders the 5 expected tab labels", () => {
    renderRoute();
    expect(screen.getByRole("tab", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Receivables" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Metrics" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Snapshots" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Reports" })).toBeInTheDocument();
  });
  it("marks the URL view as the selected tab", () => {
    mocks.search = { view: "snapshots" };
    renderRoute();
    expect(screen.getByRole("tab", { name: "Snapshots" })).toHaveAttribute("aria-selected", "true");
  });
});

/* ────────── Dashboard view ────────── */

describe("Analytics — Dashboard view", () => {
  it("shows the loading state", () => {
    mocks.loading.dashboard = true;
    renderRoute();
    expect(screen.getByText(/Loading dashboard/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.dashboard = true;
    renderRoute();
    expect(screen.getByText(/Failed to load role dashboard/i)).toBeInTheDocument();
  });
  it("renders role KPIs and summary card table when populated", () => {
    mocks.data.dashboard = DASHBOARD;
    renderRoute();
    // "Owner" appears as both the role header value and a table column header.
    expect(screen.getAllByText("Owner").length).toBeGreaterThan(0);
    expect(screen.getByText(/Tube value/)).toBeInTheDocument();
    const marker = document.querySelector('[data-entity="analytics-summary-card"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("1");
  });
  it("renders the next-actions list when provided", () => {
    mocks.data.dashboard = DASHBOARD;
    renderRoute();
    expect(screen.getByText(/Capture snapshots/)).toBeInTheDocument();
  });
});

/* ────────── Receivables view ────────── */

describe("Analytics — Receivables view", () => {
  beforeEach(() => {
    mocks.search = { view: "receivables" };
  });
  it("shows the loading state", () => {
    mocks.loading.receivables = true;
    renderRoute();
    expect(screen.getByText(/Loading receivables/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.receivables = true;
    renderRoute();
    expect(screen.getByText(/Failed to load receivables aging/i)).toBeInTheDocument();
  });
  it("renders the 5-column DataTable + 3 bucket rows from the new shared primitive", () => {
    mocks.data.receivables = RECEIVABLES;
    renderRoute();
    // The route renders AnalyticsReceivablesTableView (Phase 10.4 C1),
    // which is a <DataTable> with columns Bucket | Label | Total |
    // Invoices | Customers. Assert on the table surface, not on the
    // legacy KPI cards (those live on the re-exported legacy
    // AnalyticsReceivablesView, which the route no longer mounts).
    const table = document.querySelector(
      '[data-entity="data-table"][data-table-id="analytics-receivables-buckets"]',
    );
    expect(table).not.toBeNull();
    expect(table?.getAttribute("data-row-count")).toBe("3");
    // Header row carries the 5 column titles.
    const headerRow = table?.querySelector("thead tr");
    expect(headerRow).not.toBeNull();
    const headerCells = Array.from(headerRow?.querySelectorAll("th") ?? []);
    const headerLabels = headerCells.map((th) => th.textContent?.trim() ?? "");
    // Index 0 is the select-all cell, then 5 data columns.
    expect(headerLabels).toEqual([
      "", // select-all checkbox (no label)
      "Bucket",
      "Label",
      "Total",
      "Invoices",
      "Customers",
    ]);
    // 3 bucket rows — one per aging bucket, sorted by total desc.
    const rows = table?.querySelectorAll("tbody tr") ?? [];
    expect(rows.length).toBe(3);
    // The 3 bucket keys (rendered in <span class="font-mono">) appear
    // in the Bucket column (2nd td, after the select-all checkbox).
    // Other columns also use .font-mono for numeric formatting, so we
    // scope the assertion to the first data cell of each row.
    const keyCells = table?.querySelectorAll("tbody tr td:nth-child(2)") ?? [];
    const keyTexts = Array.from(keyCells).map((c) => c.textContent?.trim() ?? "");
    expect(keyTexts).toEqual(["current", "0-30", "31-60"]);
  });
});

/* ────────── Metrics view ────────── */

describe("Analytics — Metrics view", () => {
  beforeEach(() => {
    mocks.search = { view: "metrics" };
  });
  it("shows the loading state", () => {
    mocks.loading.metrics = true;
    renderRoute();
    expect(screen.getByText(/Loading metrics/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.metrics = true;
    renderRoute();
    expect(screen.getByText(/Failed to load semantic metrics/i)).toBeInTheDocument();
  });
  it("renders the top-metric callout and metric table", () => {
    mocks.data.metrics = METRICS;
    renderRoute();
    const topMarker = document.querySelector('[data-entity="analytics-top-metric"]');
    expect(topMarker).not.toBeNull();
    const marker = document.querySelector('[data-entity="analytics-metric"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("2");
  });
});

/* ────────── Snapshots view ────────── */

describe("Analytics — Snapshots view", () => {
  beforeEach(() => {
    mocks.search = { view: "snapshots" };
  });
  it("shows the loading state", () => {
    mocks.loading.snapshots = true;
    renderRoute();
    expect(screen.getByText(/Loading snapshots/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.snapshots = true;
    renderRoute();
    expect(screen.getByText(/Failed to load snapshots/i)).toBeInTheDocument();
  });
  it("renders the series table with point counts and trend glyph", () => {
    mocks.data.snapshots = SNAPSHOTS;
    renderRoute();
    const marker = document.querySelector('[data-entity="analytics-snapshot-series"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("1");
    // 3 points for the trend → "↑"
    expect(screen.getByText("↑")).toBeInTheDocument();
  });
});

/* ────────── Reports view ────────── */

describe("Analytics — Reports view", () => {
  beforeEach(() => {
    mocks.search = { view: "reports" };
  });
  it("shows the loading state", () => {
    mocks.loading.reports = true;
    renderRoute();
    expect(screen.getByText(/Loading reports/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.reports = true;
    renderRoute();
    expect(screen.getByText(/Failed to load reports/i)).toBeInTheDocument();
  });
  it("renders the reports table with 2 rows", () => {
    mocks.data.reports = REPORTS;
    renderRoute();
    const marker = document.querySelector('[data-entity="analytics-report"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("2");
  });
  it("renders report-type pills (Owner/Accountant)", () => {
    mocks.data.reports = REPORTS;
    renderRoute();
    // "Owner"/"Accountant" appear as both KPI role labels and report-type pills.
    expect(screen.getAllByText("Owner").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Accountant").length).toBeGreaterThan(0);
  });
});

/* ────────── back link ────────── */

describe("Analytics — back link", () => {
  it("renders a 'Today' link to /app", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Today/ });
    expect(back).toBeInTheDocument();
    expect(back.getAttribute("data-href")).toBe("/app");
  });
});

/* ────────── i18n canary (Phase 10.3) ────────── */

/**
 * The Lingui mock at the top of this file makes <Trans> a
 * passthrough, so the assertions below don't have to wrap with
 * a real I18nProvider. The real provider path is exercised in
 * `I18nProvider.test.tsx` and `web-modern/e2e/i18n-canary.spec.ts`.
 * What we lock in here is the shape of the canary route: every
 * tab label, the back link, and the page header render as text
 * content (not as raw `{t\`Dashboard\`}` template-literal nodes
 * or compiled `_()` calls leaking into the DOM).
 */
describe("Analytics — i18n canary (10.3)", () => {
  it("renders the 5 tab labels as plain text (not raw t() templates)", () => {
    renderRoute();
    // The mock renders Trans children directly, so the tab text
    // content is the source string. A regression that removes the
    // Trans wrapper would still pass this — what catches the
    // *opposite* bug (someone re-introduces a raw t() result
    // outside Trans) is the absence of "[object Object]" / function
    // text in the DOM.
    const tablist = screen.getByRole("tablist", { name: "View" });
    const tabs = within(tablist).getAllByRole("tab");
    for (const tab of tabs) {
      expect(tab.textContent).toBeTruthy();
      expect(tab.textContent).not.toMatch(/^\[object /);
    }
  });
  it("renders the back link text 'Today' as a plain text node", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Today/ });
    expect(back.textContent).toBe("Today");
  });
  it("the canary route uses the Lingui macro module (regression guard)", async () => {
    // Read the file content and assert the @lingui/react/macro
    // import survives future refactors. If a future worker
    // removes the import in favour of plain strings, the
    // lingui extract step would no longer pick this route up —
    // and the next phase's i18n expansion would silently miss it.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = await fs.readFile(
      path.resolve(__dirname, "index.tsx"),
      "utf8",
    );
    expect(file).toMatch(/from\s+["']@lingui\/react\/macro["']/);
    // At least one Trans or t`` use site in the file
    expect(file).toMatch(/<Trans>|t`/);
  });
});
