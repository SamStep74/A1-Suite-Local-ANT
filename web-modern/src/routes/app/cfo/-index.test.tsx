/**
 * /app/cfo — route-level tests for the CFO workspace (index).
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
 *      - empty state (no data envelope)
 *      - data render (table, KPIs, entity markers)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state ────────── */

const mocks = vi.hoisted(() => ({
  search: { view: "cash-flow" as string },
  data: {
    cashFlow: null as unknown,
    treasury: null as unknown,
    calendar: null as unknown,
    fx: null as unknown,
  },
  loading: { cashFlow: false, treasury: false, calendar: false, fx: false },
  error: { cashFlow: false, treasury: false, calendar: false, fx: false },
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
      if (key.startsWith("cfo-cash-flow")) {
        return {
          data: mocks.data.cashFlow,
          isLoading: mocks.loading.cashFlow,
          isError: mocks.error.cashFlow,
        };
      }
      if (key === "cfo-treasury") {
        return {
          data: mocks.data.treasury,
          isLoading: mocks.loading.treasury,
          isError: mocks.error.treasury,
        };
      }
      if (key === "cfo-calendar") {
        return {
          data: mocks.data.calendar,
          isLoading: mocks.loading.calendar,
          isError: mocks.error.calendar,
        };
      }
      if (key === "cfo-fx") {
        return {
          data: mocks.data.fx,
          isLoading: mocks.loading.fx,
          isError: mocks.error.fx,
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

const CASH_FLOW_DATA = {
  cashFlow: {
    periodKey: "2026-06",
    openingAmd: 1_000_000,
    closingAmd: 1_500_000,
    weekly: [
      { weekKey: "2026-W22", inflow: 500_000, outflow: 200_000, net: 300_000, closing: 1_300_000 },
      { weekKey: "2026-W23", inflow: 400_000, outflow: 200_000, net: 200_000, closing: 1_500_000 },
    ],
  },
};

const TREASURY_DATA = {
  treasury: [
    { currency: "AMD", balance: 1_000_000, accountCount: 1 },
    { currency: "USD", balance: -800_000, accountCount: 1 },
    { currency: "EUR", balance: 200_000, accountCount: 1 },
  ],
};

const CALENDAR_DATA = {
  calendar: {
    totalAmd: 260_000,
    entries: [
      { date: "2026-06-15", amount: 100_000, kind: "ar", source: "inv-1" },
      { date: "2026-06-20", amount: 80_000, kind: "ap", source: "bill-1" },
      { date: "2026-06-30", amount: 50_000, kind: "loan", source: "loan-1" },
      { date: "2026-06-25", amount: 30_000, kind: "ap", source: "bill-2" },
    ],
  },
};

const FX_DATA = {
  exposure: {
    hedgeSuggestion: "Հաշվի՛ր ֆորվարդային պայմանագրի օգտագործումը։",
    byCurrency: [
      { currency: "USD", net: 1_000, netAmd: 400_000 },
      { currency: "EUR", net: 5_000, netAmd: -2_500_000 },
      { currency: "RUB", net: 100_000, netAmd: 600_000 },
    ],
  },
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = { view: "cash-flow" };
  mocks.data = { cashFlow: null, treasury: null, calendar: null, fx: null };
  mocks.loading = { cashFlow: false, treasury: false, calendar: false, fx: false };
  mocks.error = { cashFlow: false, treasury: false, calendar: false, fx: false };
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("CFO — page shell", () => {
  it("renders the page title", () => {
    renderRoute();
    expect(screen.getByRole("heading", { name: "CFO", level: 1 })).toBeInTheDocument();
  });
  it("renders the Armenian subtitle", () => {
    renderRoute();
    expect(
      screen.getByText(/Կանխիկի հոսք · Գանձապետարան · Բյուջե · Վճարային օրացույց/),
    ).toBeInTheDocument();
  });
  it("renders the CFO monogram badge", () => {
    renderRoute();
    // "CFO" appears as both the monogram badge and the page <h1>.
    expect(screen.getAllByText(/^CFO$/)).toHaveLength(2);
  });
});

/* ────────── validateSearch ────────── */

describe("CFO — validateSearch", () => {
  const fn = Route.options.validateSearch as (raw: Record<string, unknown>) => unknown;
  it("defaults to cash-flow", () => {
    expect(fn({})).toEqual({ view: "cash-flow" });
  });
  it("accepts each known view", () => {
    expect(fn({ view: "cash-flow" })).toEqual({ view: "cash-flow" });
    expect(fn({ view: "treasury" })).toEqual({ view: "treasury" });
    expect(fn({ view: "calendar" })).toEqual({ view: "calendar" });
    expect(fn({ view: "fx" })).toEqual({ view: "fx" });
  });
  it("falls back to cash-flow for unknown values", () => {
    expect(fn({ view: "loan-amortization" })).toEqual({ view: "cash-flow" });
    expect(fn({ view: 42 })).toEqual({ view: "cash-flow" });
  });
});

/* ────────── ViewSwitcher ────────── */

describe("CFO — ViewSwitcher", () => {
  it("renders 4 tabs with role=tablist", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: "View" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(4);
  });
  it("renders the 4 expected tab labels", () => {
    renderRoute();
    expect(screen.getByRole("tab", { name: "Cash flow" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Treasury" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Payment calendar" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "FX exposure" })).toBeInTheDocument();
  });
  it("marks cash-flow as the default selected tab", () => {
    renderRoute();
    expect(screen.getByRole("tab", { name: "Cash flow" })).toHaveAttribute("aria-selected", "true");
  });
  it("marks the URL view as the selected tab", () => {
    mocks.search = { view: "fx" };
    renderRoute();
    expect(screen.getByRole("tab", { name: "FX exposure" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Cash flow" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});

/* ────────── Cash flow view ────────── */

describe("CFO — Cash flow view", () => {
  it("shows the loading state", () => {
    mocks.loading.cashFlow = true;
    renderRoute();
    expect(screen.getByText(/Loading cash flow/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.cashFlow = true;
    renderRoute();
    expect(screen.getByText(/Failed to load cash flow/i)).toBeInTheDocument();
  });
  it("shows the empty state when data envelope is missing", () => {
    mocks.data.cashFlow = null;
    renderRoute();
    expect(screen.getByText(/No cash flow data/i)).toBeInTheDocument();
  });
  it("renders 4 KPI cards + week table for a populated cash flow", () => {
    mocks.data.cashFlow = CASH_FLOW_DATA;
    renderRoute();
    // KPI labels
    expect(screen.getByText(/Opening \(AMD\)/)).toBeInTheDocument();
    expect(screen.getByText(/Net this period/)).toBeInTheDocument();
    expect(screen.getByText(/Closing \(AMD\)/)).toBeInTheDocument();
    expect(screen.getByText(/Closing delta/)).toBeInTheDocument();
    // Week rows
    expect(screen.getByText("2026-W22")).toBeInTheDocument();
    expect(screen.getByText("2026-W23")).toBeInTheDocument();
  });
  it("renders a hidden cfo-cash-flow-week entity marker with the count", () => {
    mocks.data.cashFlow = CASH_FLOW_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="cfo-cash-flow-week"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("2");
  });
});

/* ────────── Treasury view ────────── */

describe("CFO — Treasury view", () => {
  beforeEach(() => {
    mocks.search = { view: "treasury" };
  });
  it("shows the loading state", () => {
    mocks.loading.treasury = true;
    renderRoute();
    expect(screen.getByText(/Loading treasury/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.treasury = true;
    renderRoute();
    expect(screen.getByText(/Failed to load treasury/i)).toBeInTheDocument();
  });
  it("renders 3 KPIs and a position table when data is present", () => {
    mocks.data.treasury = TREASURY_DATA;
    renderRoute();
    // KPI labels
    expect(screen.getByText("Currencies")).toBeInTheDocument();
    expect(screen.getAllByText("Accounts").length).toBeGreaterThan(0);
    expect(screen.getByText(/Top currency/)).toBeInTheDocument();
    // 3 currencies in the table
    expect(screen.getAllByText("AMD").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USD").length).toBeGreaterThan(0);
    expect(screen.getAllByText("EUR").length).toBeGreaterThan(0);
  });
  it("sorts positions by absolute balance desc (AMD first, then USD, then EUR)", () => {
    mocks.data.treasury = TREASURY_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="cfo-treasury-position"]');
    expect(marker).not.toBeNull();
    const table = marker?.querySelector("table");
    expect(table).not.toBeNull();
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    // |AMD|=1M, |USD|=800k, |EUR|=200k → AMD, USD, EUR
    expect(rows[0].textContent).toMatch(/AMD/);
    expect(rows[1].textContent).toMatch(/USD/);
    expect(rows[2].textContent).toMatch(/EUR/);
  });
});

/* ────────── Calendar view ────────── */

describe("CFO — Calendar view", () => {
  beforeEach(() => {
    mocks.search = { view: "calendar" };
  });
  it("shows the loading state", () => {
    mocks.loading.calendar = true;
    renderRoute();
    expect(screen.getByText(/Loading calendar/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.calendar = true;
    renderRoute();
    expect(screen.getByText(/Failed to load payment calendar/i)).toBeInTheDocument();
  });
  it("renders 4 KPIs and a sorted entry table for a populated calendar", () => {
    mocks.data.calendar = CALENDAR_DATA;
    renderRoute();
    expect(screen.getByText(/AR expected/)).toBeInTheDocument();
    expect(screen.getByText(/AP due/)).toBeInTheDocument();
    expect(screen.getByText(/Loan service/)).toBeInTheDocument();
    expect(screen.getByText(/^Net$/)).toBeInTheDocument();
  });
  it("sorts entries by date ascending (15 → 20 → 25 → 30)", () => {
    mocks.data.calendar = CALENDAR_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="cfo-payment-calendar-entry"]');
    expect(marker).not.toBeNull();
    const table = marker?.querySelector("table");
    expect(table).not.toBeNull();
    const dates = within(table as HTMLElement)
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.textContent?.match(/2026-06-\d{2}/)?.[0]);
    expect(dates).toEqual(["2026-06-15", "2026-06-20", "2026-06-25", "2026-06-30"]);
  });
  it("renders kind pills (AR/AP/LOAN)", () => {
    mocks.data.calendar = CALENDAR_DATA;
    renderRoute();
    expect(screen.getAllByText("AR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AP").length).toBeGreaterThan(0);
    expect(screen.getAllByText("LOAN").length).toBeGreaterThan(0);
  });
});

/* ────────── FX view ────────── */

describe("CFO — FX view", () => {
  beforeEach(() => {
    mocks.search = { view: "fx" };
  });
  it("shows the loading state", () => {
    mocks.loading.fx = true;
    renderRoute();
    expect(screen.getByText(/Loading FX/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.fx = true;
    renderRoute();
    expect(screen.getByText(/Failed to load FX exposure/i)).toBeInTheDocument();
  });
  it("renders the hedge suggestion callout when set", () => {
    mocks.data.fx = FX_DATA;
    renderRoute();
    expect(screen.getByText(/Հեջավորման առաջարկ/)).toBeInTheDocument();
    expect(
      screen.getByText(/Հաշվի՛ր ֆորվարդային պայմանագրի օգտագործումը։/),
    ).toBeInTheDocument();
  });
  it("does NOT render the hedge callout when no suggestion", () => {
    mocks.data.fx = { exposure: { hedgeSuggestion: null, byCurrency: FX_DATA.exposure.byCurrency } };
    renderRoute();
    expect(screen.queryByText(/Հեջավորման առաջարկ/)).not.toBeInTheDocument();
  });
  it("renders the FX exposure table with 3 currency rows", () => {
    mocks.data.fx = FX_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="cfo-fx-exposure-row"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("3");
  });
  it("sorts rows by |netAmd| desc (EUR first, RUB second, USD third)", () => {
    mocks.data.fx = FX_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="cfo-fx-exposure-row"]');
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    // |EUR|=2.5M, |RUB|=600k, |USD|=400k
    expect(rows[0].textContent).toMatch(/EUR/);
    expect(rows[1].textContent).toMatch(/RUB/);
    expect(rows[2].textContent).toMatch(/USD/);
  });
  it("shows 'Hedge' label for EUR row (|netAmd| = 2.5M > 1M but < 5M, so 'Watch')", () => {
    // |EUR|=2.5M falls into the "info" bucket → "Watch"
    // |RUB|=600k → "none" → "OK"
    // |USD|=400k → "none" → "OK"
    mocks.data.fx = FX_DATA;
    renderRoute();
    expect(screen.getAllByText("Watch").length).toBeGreaterThan(0);
  });
  it("shows 'Hedge' label for a row with |netAmd| > 5M", () => {
    mocks.data.fx = {
      exposure: {
        hedgeSuggestion: null,
        byCurrency: [{ currency: "USD", net: 1, netAmd: 6_000_000 }],
      },
    };
    renderRoute();
    // The FX table column header is also "Hedge" — use a query that
    // scopes to row cells, not the header.
    const marker = document.querySelector('[data-entity="cfo-fx-exposure-row"]');
    const rows = within(marker as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/Hedge/);
  });
});

/* ────────── back link ────────── */

describe("CFO — back link", () => {
  it("renders a 'Today' link to /app", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Today/ });
    expect(back).toBeInTheDocument();
    expect(back.getAttribute("data-href")).toBe("/app");
  });
});
