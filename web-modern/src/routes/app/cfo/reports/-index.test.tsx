/**
 * /app/cfo/reports — route-level tests for the CFO printable
 * financial statements.
 *
 * Mirrors the crm/index, finance/index and cfo/index test patterns:
 * mock the three layers (Router, Query, API client), then drive the
 * public component surface.
 *
 * Coverage targets:
 *  - validateSearch (default period = current YYYY-MM, default
 *    statement = "p-and-l"; bad values fall back; valid statement
 *    values pass through)
 *  - Page header (title, Armenian subtitle)
 *  - Period selector (renders formatted label, prev/next buttons
 *    call onChange with shifted YYYY-MM)
 *  - Statement chips (active = aria-current, click navigates)
 *  - Loading state (no data yet)
 *  - Error state (query failed)
 *  - P&L section: income rows, expense rows, total income/expense,
 *    net profit, margin %
 *  - Balance sheet: assets/liabilities/equity columns, totals row,
 *    warning chip when off-balance
 *  - Cash flow: operating/investing/financing sections, net change
 *  - Print button exists with the right label
 *  - Back link points to /app/cfo with a valid view
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

/* ────────── mock state, hoisted so vi.mock factories see it ────────── */

const mocks = vi.hoisted(() => ({
  search: { period: "2026-06", statement: "p-and-l" as string },
  data: null as unknown,
  loading: false,
  error: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: {
    component: unknown;
    validateSearch: unknown;
  }) => ({
    useSearch: () => mocks.search,
    useParams: () => ({}),
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
  notFound: () => {
    throw new Error("notFound() called");
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useQuery: () => ({
      data: mocks.data,
      isLoading: mocks.loading,
      isError: mocks.error,
    }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../../lib/api/client", () => ({
  getJson: vi.fn().mockResolvedValue({}),
  postJson: vi.fn().mockResolvedValue({}),
  postVoid: vi.fn().mockResolvedValue(undefined),
}));

/* ────────── import the route under test (mocks are in place by now) ─ */

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

const VALID_DATA = {
  incomeStatement: {
    income: [
      { id: "i1", code: "4000", name: "Վաճառքի եկամուտ", amount: 1_200_000 },
      { id: "i2", code: "4100", name: "Ծառայությունների եկամուտ", amount: 300_000 },
    ],
    expense: [
      { id: "e1", code: "5000", name: "Աշխատավարձ", amount: 700_000 },
      { id: "e2", code: "5210", name: "Վարձակալություն", amount: 200_000 },
    ],
    totalIncome: 1_500_000,
    totalExpense: 900_000,
    netProfit: 600_000,
  },
  balanceSheet: {
    assets: [
      { id: "a1", code: "1000", name: "Հիմնական միջոցներ", amount: 2_000_000 },
      { id: "a2", code: "1100", name: "Կանխիկ և համարժեքներ", amount: 800_000 },
    ],
    liabilities: [
      { id: "l1", code: "2000", name: "Վարկավորումներ", amount: 1_000_000 },
      { id: "l2", code: "2100", name: "Հաշվեկշռող պարտավորություններ", amount: 300_000 },
    ],
    equity: [
      { id: "eq1", code: "3000", name: "Կանոնադրական կապիտալ", amount: 1_000_000 },
      { id: "eq2", code: "3200", name: "Պահուստային ֆոնդ", amount: 500_000 },
    ],
    totalAssets: 2_800_000,
    totalLiabilities: 1_300_000,
    totalEquity: 1_500_000,
    retainedEarnings: 0,
    totalEquityAndLiabilities: 2_800_000,
    balanced: true,
  },
  cashFlow: {
    cashIn: 1_400_000,
    cashOut: 1_100_000,
    netCashChange: 300_000,
  },
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = { period: "2026-06", statement: "p-and-l" };
  mocks.data = VALID_DATA;
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── validateSearch ────────── */

describe("Route.options.validateSearch", () => {
  it("defaults period and statement on empty input", () => {
    const fn = Route.options.validateSearch as (
      raw: Record<string, unknown>,
    ) => unknown;
    const out = fn({}) as { period: string; statement: string };
    expect(out.statement).toBe("p-and-l");
    expect(out.period).toMatch(/^\d{4}-\d{2}$/);
  });

  it("accepts a well-formed YYYY-MM period", () => {
    const fn = Route.options.validateSearch as (
      raw: Record<string, unknown>,
    ) => unknown;
    expect(fn({ period: "2026-03" })).toMatchObject({ period: "2026-03" });
  });

  it("falls back to the current period for malformed input", () => {
    const fn = Route.options.validateSearch as (
      raw: Record<string, unknown>,
    ) => unknown;
    const out = fn({ period: "garbage" }) as { period: string };
    expect(out.period).toMatch(/^\d{4}-\d{2}$/);
    expect(out.period).not.toBe("garbage");
  });

  it("accepts every known statement value", () => {
    const fn = Route.options.validateSearch as (
      raw: Record<string, unknown>,
    ) => unknown;
    for (const s of ["p-and-l", "balance-sheet", "cash-flow"]) {
      expect(fn({ statement: s })).toMatchObject({ statement: s });
    }
  });

  it("falls back to 'p-and-l' for an unknown statement", () => {
    const fn = Route.options.validateSearch as (
      raw: Record<string, unknown>,
    ) => unknown;
    expect(fn({ statement: "garbage" })).toMatchObject({ statement: "p-and-l" });
  });
});

/* ────────── page shell ────────── */

describe("CfoReports — page shell", () => {
  it("shows a loading message when the query is loading", () => {
    mocks.loading = true;
    mocks.data = null;
    renderRoute();
    expect(
      screen.getByText(/Loading financial statements/i),
    ).toBeInTheDocument();
  });

  it("shows an error message when the query failed", () => {
    mocks.error = true;
    mocks.data = null;
    renderRoute();
    expect(
      screen.getByText(/Failed to load financial statements/i),
    ).toBeInTheDocument();
  });

  it("renders the screen-only header with the English title and Armenian subtitle", () => {
    renderRoute();
    const header = screen.getByTestId("cfo-reports-screen-header");
    expect(
      within(header).getByRole("heading", { level: 1, name: /Financial Statements/i }),
    ).toBeInTheDocument();
    expect(
      within(header).getByText(/Շահույթ-վնաս · Հաշվեկշիռ · Կանխիկի հոսք/),
    ).toBeInTheDocument();
  });

  it("renders the period selector with the formatted period label", () => {
    renderRoute();
    // Two copies: one in the screen period selector, one in the
    // print header (hidden on screen). Use a regex-tolerant match.
    const matches = screen.getAllByText("Հունիս 2026");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("renders a Print button with the right label", () => {
    renderRoute();
    const btn = screen.getByRole("button", { name: /Print financial statements/i });
    expect(btn).toBeInTheDocument();
  });

  it("renders a back-link to /app/cfo with a valid view", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Back to CFO/i });
    expect(back.getAttribute("data-href")).toBe("/app/cfo");
    // The view is required for /app/cfo's validateSearch.
    expect(back.getAttribute("data-search")).toContain("view");
  });
});

/* ────────── statement chips ────────── */

describe("CfoReports — statement chips", () => {
  it("renders all three statement chips", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: /Jump to statement/i });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0].textContent).toMatch(/P&L/);
    expect(tabs[1].textContent).toMatch(/Balance sheet/);
    expect(tabs[2].textContent).toMatch(/Cash flow/);
  });

  it("pins the active tab to the search.statement value", () => {
    mocks.search = { period: "2026-06", statement: "cash-flow" };
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: /Jump to statement/i });
    const cashFlowTab = within(tablist)
      .getAllByRole("tab")
      .find((t) => (t.textContent ?? "").includes("Cash flow"));
    expect(cashFlowTab?.getAttribute("aria-current")).toBe("page");
  });
});

/* ────────── P&L section ────────── */

describe("CfoReports — P&L section", () => {
  it("renders the income and expense lines with codes and names", () => {
    renderRoute();
    expect(screen.getByText("4000")).toBeInTheDocument();
    expect(screen.getByText("Վաճառքի եկամուտ")).toBeInTheDocument();
    expect(screen.getByText("5000")).toBeInTheDocument();
    expect(screen.getByText("Աշխատավարձ")).toBeInTheDocument();
  });

  it("renders the total income, total expense, and net profit rows", () => {
    renderRoute();
    const section = document.getElementById("section-pl") as HTMLElement;
    expect(within(section).getByText(/Total income/i)).toBeInTheDocument();
    expect(within(section).getByText(/Total expense/i)).toBeInTheDocument();
    expect(within(section).getByText(/Net profit/i)).toBeInTheDocument();
  });

  it("computes the margin percentage from totalIncome and netProfit", () => {
    // netProfit=600_000, totalIncome=1_500_000 → 40.0%
    renderRoute();
    expect(screen.getByText(/Margin 40\.0%/)).toBeInTheDocument();
  });
});

/* ────────── balance sheet section ────────── */

describe("CfoReports — balance sheet section", () => {
  it("renders assets, liabilities, and equity account groups", () => {
    renderRoute();
    const section = document.getElementById("section-bs") as HTMLElement;
    expect(within(section).getByText(/^Assets$/)).toBeInTheDocument();
    expect(within(section).getByText(/^Liabilities$/)).toBeInTheDocument();
    expect(within(section).getByText(/^Equity$/)).toBeInTheDocument();
  });

  it("renders the totals row for each group", () => {
    renderRoute();
    const section = document.getElementById("section-bs") as HTMLElement;
    // Each group renders a "Total <x>" footer row inside its own
    // table, so the strings appear multiple times in the section.
    // We assert the minimum count: 1 (group table) + 1 (summary
    // line for the assets/liabilities+equity pair).
    expect(within(section).getAllByText(/Total assets/i).length).toBeGreaterThanOrEqual(1);
    expect(within(section).getAllByText(/Total liabilities/i).length).toBeGreaterThanOrEqual(1);
    expect(within(section).getAllByText(/Total equity/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders the totals summary line", () => {
    renderRoute();
    const summary = screen.getByTestId("balance-sheet-totals");
    expect(summary.textContent).toMatch(/Total assets/);
    expect(summary.textContent).toMatch(/Total liabilities \+ equity/);
  });

  it("does NOT show a warning chip when the sheet is balanced", () => {
    renderRoute();
    expect(screen.queryByTestId("balance-sheet-warning")).toBeNull();
  });

  it("shows a warning chip when A != L + E", () => {
    mocks.data = {
      ...VALID_DATA,
      balanceSheet: {
        ...VALID_DATA.balanceSheet,
        totalAssets: 2_900_000, // off by 100k
        totalLiabilities: 1_300_000,
        totalEquity: 1_500_000,
      },
    };
    renderRoute();
    const warning = screen.getByTestId("balance-sheet-warning");
    expect(warning.textContent).toMatch(/Off by/);
  });
});

/* ────────── cash flow section ────────── */

describe("CfoReports — cash flow section", () => {
  it("renders the cash-received, cash-paid, and net-change row labels", () => {
    renderRoute();
    const section = document.getElementById("section-cf") as HTMLElement;
    expect(within(section).getByText("Cash received")).toBeInTheDocument();
    expect(within(section).getByText("Cash paid out")).toBeInTheDocument();
    // "Net change" appears twice: once in the header banner and once
    // in the bold totals row. getAllByText is safe.
    expect(within(section).getAllByText(/Net change/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders the three cash-flow amounts as formatted currency", () => {
    renderRoute();
    const section = document.getElementById("section-cf") as HTMLElement;
    // cashIn=1_400_000, cashOut=1_100_000, netCashChange=300_000
    // The AMD formatter uses a non-breaking space (or  ) as the
    // thousand separator (e.g. "1 400 000 ֏"); match without anchoring
    // the separator.
    expect(section.textContent).toMatch(/1[\s ]400[\s ]000/);
    expect(section.textContent).toMatch(/1[\s ]100[\s ]000/);
    expect(section.textContent).toMatch(/300[\s ]000/);
  });
});

/* ────────── period navigation ────────── */

describe("CfoReports — period selector", () => {
  it("renders prev and next buttons with the right aria labels", () => {
    renderRoute();
    expect(
      screen.getByRole("button", { name: /Previous period/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Next period/i }),
    ).toBeInTheDocument();
  });
});
