/**
 * /app/cfo/$loanId — route-level tests for the loan amortization detail
 * surface.
 *
 * Mirrors docs/$documentId pattern. Coverage:
 *
 *  - Loading state ("Loading loan…")
 *  - Not-found (no data envelope, empty schedule)
 *  - Error state
 *  - Header (title, loanId)
 *  - KPIs: periods, total principal, total interest
 *  - Schedule table: rows + entity marker with count
 *  - Back-link to /app/cfo
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
  params: { loanId: "loan-1" as string },
  schedule: null as unknown,
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
      if (queryKey[0] === "cfo-loan-schedule") {
        return {
          data: mocks.schedule,
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

import { Route } from "./$loanId";

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

const SCHEDULE = {
  ok: true,
  loanId: "loan-1",
  schedule: [
    { periodKey: "2026-01", principalDue: 100_000, interestDue: 25_000, balanceAfter: 900_000 },
    { periodKey: "2026-02", principalDue: 100_000, interestDue: 22_500, balanceAfter: 800_000 },
    { periodKey: "2026-03", principalDue: 100_000, interestDue: 20_000, balanceAfter: 700_000 },
  ],
};

const ZERO_BALANCE_SCHEDULE = {
  ok: true,
  loanId: "loan-2",
  schedule: [
    { periodKey: "2026-01", principalDue: 100_000, interestDue: 0, balanceAfter: 0 },
  ],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.params = { loanId: "loan-1" };
  mocks.schedule = { ...SCHEDULE };
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── loading / not-found / error ────────── */

describe("LoanDetail — loading / not-found / error", () => {
  it("shows the loading message while the query is in-flight", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading loan/i)).toBeInTheDocument();
  });
  it("shows the 'no schedule' message when data is missing", () => {
    mocks.schedule = null;
    renderRoute();
    expect(screen.getByText(/No amortization schedule/i)).toBeInTheDocument();
  });
  it("shows the 'no schedule' message when schedule is empty", () => {
    mocks.schedule = { ok: true, loanId: "loan-1", schedule: [] };
    renderRoute();
    expect(screen.getByText(/No amortization schedule/i)).toBeInTheDocument();
  });
  it("shows the 'failed' message when the query errors", () => {
    mocks.error = true;
    mocks.schedule = null;
    renderRoute();
    expect(screen.getByText(/Failed to load loan schedule/i)).toBeInTheDocument();
  });
});

/* ────────── header ────────── */

describe("LoanDetail — header", () => {
  it("renders the page title as a level-1 heading", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: /Վարկի մարման գրաֆիկ/, level: 1 }),
    ).toBeInTheDocument();
  });
  it("renders the loanId in the subtitle", () => {
    renderRoute();
    expect(screen.getByText(/loan-1/)).toBeInTheDocument();
  });
  it("renders the CFO · Loan monogram badge", () => {
    renderRoute();
    expect(screen.getByText(/CFO · Loan/)).toBeInTheDocument();
  });
});

/* ────────── KPIs ────────── */

describe("LoanDetail — KPIs", () => {
  it("renders periods, total principal, total interest", () => {
    renderRoute();
    expect(screen.getByText("Periods")).toBeInTheDocument();
    expect(screen.getByText(/Total principal/)).toBeInTheDocument();
    expect(screen.getByText(/Total interest/)).toBeInTheDocument();
  });
  it("shows 3 periods for the standard fixture", () => {
    renderRoute();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

/* ────────── schedule table ────────── */

describe("LoanDetail — schedule table", () => {
  it("renders the period rows from the schedule", () => {
    renderRoute();
    expect(screen.getByText("2026-01")).toBeInTheDocument();
    expect(screen.getByText("2026-02")).toBeInTheDocument();
    expect(screen.getByText("2026-03")).toBeInTheDocument();
  });
  it("renders a hidden cfo-loan-schedule-row entity marker with the count", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="cfo-loan-schedule-row"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("3");
  });
  it("renders a zero-balance row in green and zero-interest in muted", () => {
    mocks.schedule = ZERO_BALANCE_SCHEDULE;
    renderRoute();
    const marker = document.querySelector('[data-entity="cfo-loan-schedule-row"]');
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/2026-01/);
    // balanceAfter column should render 0 (the helper formats it as "0 ֏")
    expect(rows[0].textContent).toMatch(/0/);
  });
});

/* ────────── back link ────────── */

describe("LoanDetail — back link", () => {
  it("renders a 'Back to CFO' link to /app/cfo with view=treasury", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Back to CFO/ });
    expect(back).toBeInTheDocument();
    expect(back.getAttribute("data-href")).toBe("/app/cfo");
    expect(back.getAttribute("data-search")).toContain("treasury");
  });
});
