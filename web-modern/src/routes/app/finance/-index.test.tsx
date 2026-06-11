/**
 * /app/finance (index route) — route-level test for the Finance
 * workspace.
 *
 * Mirrors the crm/index.test.tsx pattern: mock the three layers we
 * can't reach in a jsdom test (TanStack Router, TanStack Query,
 * @/lib/api/client), then drive the public component surface.
 *
 * Coverage targets:
 *  - validateSearch (defaulting + view/status coercion)
 *  - Page header (Finance title, Armenian subtitle)
 *  - ViewSwitcher tabs (Invoices | Periods | Payments)
 *  - Invoices view: table rows, status pills, totals formatting
 *  - Status filter (URL state narrows the table)
 *  - Periods view: rows render with Armenian month label
 *  - Payments view: rows render
 *  - ForecastTotals (right rail): receivables, VAT, overdue, aging
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

type View = "invoices" | "periods" | "payments";
type Status = string;

const mocks = vi.hoisted(() => ({
  search: { view: "invoices" as View, status: "all" as Status },
  invoices: null as unknown,
  periods: null as unknown,
  payments: null as unknown,
  loading: false,
  fullPath: "/app/finance/",
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
      if (key === "finance-draft-invoices") {
        return { data: mocks.invoices, isLoading: mocks.loading, isError: false };
      }
      if (key === "finance-periods") {
        return { data: mocks.periods, isLoading: mocks.loading, isError: false };
      }
      if (key === "finance-payments") {
        return { data: mocks.payments, isLoading: mocks.loading, isError: false };
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

const VALID_INVOICES = {
  draftInvoices: [
    {
      id: "inv-1",
      customerId: "c-1",
      customerName: "Nare Clinic",
      dealId: "d-1",
      dealTitle: "Patient retention",
      number: "INV-001",
      status: "draft",
      subtotal: 1000000,
      vat: 200000,
      total: 1200000,
      currency: "AMD",
      issueDate: "2026-06-01",
      dueDate: "2026-07-01",
      periodKey: "2026-06",
      sourceKey: "deal:d-1",
      createdByName: "Samvel Owner",
      createdAt: "2026-06-01T10:00:00.000Z",
      updatedAt: "2026-06-01T10:00:00.000Z",
    },
    {
      id: "inv-2",
      customerId: "c-2",
      customerName: "Ani Beauty",
      dealId: null,
      dealTitle: null,
      number: "INV-002",
      status: "posted",
      subtotal: 500000,
      vat: 100000,
      total: 600000,
      currency: "AMD",
      issueDate: "2026-05-15",
      dueDate: "2026-05-25", // 16 days overdue relative to 2026-06-10
      periodKey: "2026-05",
      sourceKey: null,
      createdByName: "Operator",
      createdAt: "2026-05-15T10:00:00.000Z",
      updatedAt: "2026-05-15T10:00:00.000Z",
    },
    {
      id: "inv-3",
      customerId: "c-3",
      customerName: "Vanadzor Tour",
      dealId: null,
      dealTitle: null,
      number: "INV-003",
      status: "posted",
      subtotal: 800000,
      vat: 160000,
      total: 960000,
      currency: "AMD",
      issueDate: "2026-06-05",
      dueDate: "2026-07-05", // future
      periodKey: "2026-06",
      sourceKey: null,
      createdByName: "Operator",
      createdAt: "2026-06-05T10:00:00.000Z",
      updatedAt: "2026-06-05T10:00:00.000Z",
    },
  ],
};

const VALID_PERIODS = {
  periods: [
    {
      id: "p-1",
      periodKey: "2026-06",
      startsOn: "2026-06-01",
      endsOn: "2026-06-30",
      status: "open",
      closedAt: null,
      closedByUserId: null,
      closedByName: null,
      reason: null,
    },
    {
      id: "p-2",
      periodKey: "2026-05",
      startsOn: "2026-05-01",
      endsOn: "2026-05-31",
      status: "closed",
      closedAt: "2026-06-02T10:00:00.000Z",
      closedByUserId: "user-owner",
      closedByName: "Samvel Owner",
      reason: "Month-end close",
    },
    {
      id: "p-3",
      periodKey: "2026-12",
      startsOn: "2026-12-01",
      endsOn: "2026-12-31",
      status: "open",
      closedAt: null,
      closedByUserId: null,
      closedByName: null,
      reason: null,
    },
  ],
};

const VALID_PAYMENTS = {
  payments: [
    {
      id: "pay-1",
      customerId: "c-1",
      customerName: "Nare Clinic",
      invoiceId: "inv-100",
      invoiceNumber: "INV-100",
      amount: 1200000,
      currency: "AMD",
      paidAt: "2026-06-08T10:00:00.000Z",
      method: "Bank transfer",
      reference: "TX-2026-001",
      periodKey: "2026-06",
      sourceKey: null,
      createdByName: "Operator",
      createdAt: "2026-06-08T10:00:00.000Z",
    },
  ],
};

/* ────────── per-test reset ────────── */

/** Frozen "today" for the days-until-due / overdue math. The Finance
 *  route calls `new Date()` directly in its render path (no
 *  clock injection), so we pin the system clock here to make
 *  "Ani Beauty 16 days late" deterministic regardless of when
 *  the suite runs. The fixture's `dueDate: "2026-05-25"` is then
 *  exactly 16 days before this frozen date. */
const FROZEN_TODAY = new Date("2026-06-10T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_TODAY);
  mocks.search = { view: "invoices", status: "all" };
  mocks.invoices = VALID_INVOICES;
  mocks.periods = VALID_PERIODS;
  mocks.payments = VALID_PAYMENTS;
  mocks.loading = false;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/* ────────── validateSearch ────────── */

describe("Route.options.validateSearch", () => {
  it("defaults view to 'invoices' and status to 'all' on empty input", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({});
    expect(r).toEqual({ view: "invoices", status: "all" });
  });

  it("accepts 'periods' as a view", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ view: "periods" });
    expect(r).toMatchObject({ view: "periods" });
  });

  it("accepts 'payments' as a view", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ view: "payments" });
    expect(r).toMatchObject({ view: "payments" });
  });

  it("falls back to 'invoices' for an unknown view", () => {
    const r = (
      Route.options.validateSearch as (raw: Record<string, unknown>) => unknown
    )({ view: "garbage" });
    expect(r).toMatchObject({ view: "invoices" });
  });

  it("accepts every known invoice status string", () => {
    const fn = Route.options.validateSearch as (
      raw: Record<string, unknown>,
    ) => unknown;
    for (const s of ["draft", "posted", "overdue", "paid"]) {
      expect(fn({ status: s })).toMatchObject({ status: s });
    }
  });
});

/* ────────── page shell ────────── */

describe("FinanceWorkspace — page shell", () => {
  it("shows the loading message while invoices are loading", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading invoices/i)).toBeInTheDocument();
  });

  it("renders the header with title 'Finance' and the Armenian subtitle", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Finance", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Հաշիվներ · Հարկում · Ժամանակահատվածներ/),
    ).toBeInTheDocument();
  });

  it("renders the 'Today' back-link to /app", () => {
    renderRoute();
    const backLinks = screen.getAllByRole("link");
    const todayLink = backLinks.find((l) => l.textContent === "Today");
    expect(todayLink).toBeDefined();
    expect(todayLink?.getAttribute("data-href")).toBe("/app");
  });

  it("renders the ViewSwitcher with three tabs", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: /View/ });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0].textContent).toMatch(/Invoices/);
    expect(tabs[1].textContent).toMatch(/Periods/);
    expect(tabs[2].textContent).toMatch(/Payments/);
  });
});

/* ────────── InvoicesView (list) ────────── */

describe("FinanceWorkspace — invoices list view", () => {
  it("renders one row per invoice in the table", () => {
    renderRoute();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // 1 header row + 3 data rows
    expect(rows).toHaveLength(4);
  });

  it("renders a hidden finance-invoice entity marker for smoke / E2E", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="finance-invoice"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("3");
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
    expect(labels.some((l) => l.startsWith("Draft"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Posted"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Overdue"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Paid"))).toBe(true);
  });

  it("renders the overdue tone on the Ani Beauty row (16 days late)", () => {
    renderRoute();
    // The 'Overdue' status label appears both in the filter tab and on
    // the row. Scope to the table to assert the row pill + the
    // days-late chip are both present.
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("Ani Beauty").length).toBeGreaterThan(0);
    // Sanity: 16 days late (due 2026-05-25, today 2026-06-10)
    expect(within(table).getByText("16d late")).toBeInTheDocument();
  });

  it("renders the pipeline forecast totals on the right rail", () => {
    renderRoute();
    const pipeline = screen.getByRole("heading", { name: /Pipeline/ });
    expect(pipeline).toBeInTheDocument();
    // Three totals cards: Receivables, VAT, Overdue
    expect(screen.getByText("Receivables (AMD)")).toBeInTheDocument();
    expect(screen.getByText("VAT (AMD)")).toBeInTheDocument();
    expect(screen.getByText("Overdue (AMD)")).toBeInTheDocument();
  });

  it("renders the aging bands on the right rail", () => {
    renderRoute();
    // The aging <ul> lists 5 bands inside the Pipeline aside. We
    // scope to the aside to avoid colliding with the PERIOD_FILTER_TABS
    // "Current" tab and the period status pill.
    const aside = screen.getByLabelText("Pipeline");
    expect(within(aside).getByText(/^current$/i)).toBeInTheDocument();
    expect(within(aside).getByText(/^1-30$/)).toBeInTheDocument();
  });

  it("shows the empty-state copy when there are no invoices", () => {
    mocks.invoices = { draftInvoices: [] };
    renderRoute();
    expect(screen.getByText(/No invoices in this view/i)).toBeInTheDocument();
  });
});

/* ────────── Status filtering ────────── */

describe("FinanceWorkspace — invoice status filter", () => {
  it("filters the table to only 'overdue' invoices when status=overdue", () => {
    mocks.search = { view: "invoices", status: "overdue" };
    renderRoute();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // 1 header + 1 overdue row (Ani Beauty)
    expect(rows).toHaveLength(2);
    expect(within(table).getByText("Ani Beauty")).toBeInTheDocument();
    expect(within(table).queryByText("Nare Clinic")).toBeNull();
  });

  it("pins the 'Overdue' tab as the active tab when status=overdue", () => {
    mocks.search = { view: "invoices", status: "overdue" };
    renderRoute();
    const nav = screen.getByRole("navigation", {
      name: /Filter by status/i,
    });
    const overdueTab = within(nav)
      .getAllByRole("button")
      .find((b) => (b.textContent ?? "").startsWith("Overdue"));
    expect(overdueTab?.getAttribute("aria-current")).toBe("page");
  });
});

/* ────────── Periods view ────────── */

describe("FinanceWorkspace — periods view", () => {
  it("renders the periods view without throwing when view=periods", () => {
    mocks.search = { view: "periods", status: "all" };
    expect(() => renderRoute()).not.toThrow();
  });

  it("renders one row per period in the periods list", () => {
    mocks.search = { view: "periods", status: "all" };
    renderRoute();
    // The periods list is a <ul>. Each <li> is a row.
    const marker = document.querySelector('[data-entity="finance-period"]');
    expect(marker?.getAttribute("data-count")).toBe("3");
  });

  it("renders the Armenian month label for the June 2026 period", () => {
    mocks.search = { view: "periods", status: "all" };
    renderRoute();
    expect(screen.getByText("Հունիս 2026")).toBeInTheDocument();
    expect(screen.getByText("Մայիս 2026")).toBeInTheDocument();
    expect(screen.getByText("Դեկտեմբեր 2026")).toBeInTheDocument();
  });

  it("renders the 'Closed' tone on the May 2026 row", () => {
    mocks.search = { view: "periods", status: "all" };
    renderRoute();
    const matches = screen.getAllByText("Closed");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("filters the periods to only 'current' when status=current", () => {
    mocks.search = { view: "periods", status: "current" };
    renderRoute();
    // Only the June 2026 period is current as of 2026-06-10.
    expect(screen.getByText("Հունիս 2026")).toBeInTheDocument();
    expect(screen.queryByText("Մայիս 2026")).toBeNull();
    expect(screen.queryByText("Դեկտեմբեր 2026")).toBeNull();
  });
});

/* ────────── Payments view ────────── */

describe("FinanceWorkspace — payments view", () => {
  it("renders one row per payment in the payments list", () => {
    mocks.search = { view: "payments", status: "all" };
    renderRoute();
    const marker = document.querySelector('[data-entity="finance-payment"]');
    expect(marker?.getAttribute("data-count")).toBe("1");
  });

  it("renders the customer name and method on the payment row", () => {
    mocks.search = { view: "payments", status: "all" };
    renderRoute();
    expect(screen.getByText("Nare Clinic")).toBeInTheDocument();
    expect(screen.getByText(/Bank transfer/)).toBeInTheDocument();
  });

  it("shows the empty-state copy when there are no payments", () => {
    mocks.payments = { payments: [] };
    mocks.search = { view: "payments", status: "all" };
    renderRoute();
    expect(screen.getByText(/No payments yet/i)).toBeInTheDocument();
  });
});
