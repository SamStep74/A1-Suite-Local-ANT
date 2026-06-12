/**
 * FinanceReportsPanel — colocated test for the 3 read-only report sub-panels
 * migrated from web/src/finance.jsx (TrialBalance, Statements, Vat).
 *
 * Mirrors the procurement test pattern: `vi.hoisted()` for shared mocks,
 * then `vi.mock()` for the API client + a thin router mock. Real
 * QueryClient (with retry disabled) is wired into the render helper.
 *
 * Coverage (3 cases per sub-panel × 3 sub-panels = 9 minimum):
 *   - Loading skeleton
 *   - Error state
 *   - Success with data
 *
 * Plus a smoke test that the tab strip switches between the three
 * sub-views, and one happy-path test for the "File return" mutation.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── shared mock state (hoisted) ────────── */

const mocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
}));

/* ────────── router mock — we don't need a real router for a leaf panel ─── */

vi.mock("@tanstack/react-router", () => ({
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
}));

/* ────────── api client mock — every fetch goes through getJson/postJson ─── */

vi.mock("../../../../../lib/api/client", () => ({
  getJson: mocks.getJson,
  postJson: mocks.postJson,
  postVoid: vi.fn().mockResolvedValue(undefined),
  patchJson: vi.fn().mockResolvedValue(undefined),
}));

/* ────────── SUT ────────── */

import FinanceReportsPanel, { VatReturnResponseSchema } from "../FinanceReportsPanel";
import { FinancialStatementsResponseSchema } from "../../../../../lib/api/schemas";

/* ────────── helpers ────────── */

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderPanel() {
  const qc = makeClient();
  return render(
    <QueryClientProvider client={qc}>
      <FinanceReportsPanel />
    </QueryClientProvider>,
  );
}

/* ────────── fixtures ────────── */

const TRIAL_BALANCE_OK = {
  rows: [
    {
      code: "1010",
      name: "Cash on hand",
      type: "asset",
      debit: 1500000,
      credit: 0,
      balance: 1500000,
    },
    {
      code: "2010",
      name: "Accounts payable",
      type: "liability",
      debit: 0,
      credit: 1500000,
      balance: -1500000,
    },
  ],
  totalDebit: 1500000,
  totalCredit: 1500000,
  balanced: true,
};

const STATEMENTS_OK = {
  incomeStatement: {
    income: [
      { id: "i1", code: "4010", name: "Sales revenue", amount: 3000000 },
    ],
    expense: [
      { id: "e1", code: "5010", name: "Cost of goods sold", amount: 2000000 },
    ],
    totalIncome: 3000000,
    totalExpense: 2000000,
    netProfit: 1000000,
  },
  balanceSheet: {
    assets: [
      { id: "a1", code: "1010", name: "Cash", amount: 5000000 },
    ],
    liabilities: [
      { id: "l1", code: "2010", name: "Accounts payable", amount: 2000000 },
    ],
    equity: [
      { id: "eq1", code: "3010", name: "Owner's equity", amount: 2000000 },
    ],
    totalAssets: 5000000,
    totalLiabilities: 2000000,
    totalEquity: 2000000,
    retainedEarnings: 1000000,
    totalEquityAndLiabilities: 5000000,
    balanced: true,
  },
  cashFlow: {
    cashIn: 3000000,
    cashOut: 2000000,
    netCashChange: 1000000,
  },
};

const VAT_REPORT_OK = {
  periodKey: "2026-06",
  currency: "AMD",
  outputVat: 600000,
  inputVat: 200000,
  netVatPayable: 400000,
  note: "Indicative VAT from posted ledger entries.",
};

const VAT_RETURN_OK = {
  kind: "armenian-vat-return",
  periodKey: "2026-06",
  currency: "AMD",
  standardVatRate: 0.2,
  source: "posted-ledger",
  taxableSales: 3000000,
  taxablePurchases: 1000000,
  outputVat: 600000,
  inputVat: 200000,
  net: 400000,
  payable: 400000,
  creditCarried: 0,
  sales: { lineCount: 1, taxableBase: 3000000, outputVat: 600000 },
  purchases: { lineCount: 1, taxableBase: 1000000, inputVat: 200000 },
  note: "Computed from posted ledger entries as Armenian VAT return figures.",
};

/**
 * Wire up the default success responses for every endpoint the panel
 * will call. Per-test overrides can swap individual impls.
 */
function installDefaultSuccess() {
  mocks.getJson.mockImplementation((path: string) => {
    if (path === "/api/finance/trial-balance") return Promise.resolve(TRIAL_BALANCE_OK);
    if (path === "/api/finance/statements")
      return Promise.resolve(FinancialStatementsResponseSchema.parse(STATEMENTS_OK));
    if (path === "/api/finance/vat-report") return Promise.resolve(VAT_REPORT_OK);
    if (path === "/api/finance/vat-return") return Promise.resolve(VAT_RETURN_OK);
    return Promise.reject(new Error(`Unexpected getJson path: ${path}`));
  });
  mocks.postJson.mockResolvedValue({
    ok: true as const,
    vatReturn: { id: "vret-1", periodKey: "2026-06" },
  });
}

beforeEach(() => {
  mocks.getJson.mockReset();
  mocks.postJson.mockReset();
  installDefaultSuccess();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ═══════════════════════════════════════════════════════════════════════
 * Shell + tab strip
 * ═══════════════════════════════════════════════════════════════════════ */

describe("FinanceReportsPanel shell", () => {
  it("renders the root panel with the HayHashvapah Finance section label", async () => {
    renderPanel();
    const root = await screen.findByTestId("finance-reports-panel");
    expect(root).toBeInTheDocument();
    // Legacy section label pattern is preserved 1:1.
    expect(screen.getAllByText(/HayHashvapah Finance/).length).toBeGreaterThan(0);
  });

  it("renders three tabs (Trial balance, Financial statements, VAT report)", async () => {
    renderPanel();
    expect(await screen.findByTestId("finance-reports-tab-trial-balance")).toBeInTheDocument();
    expect(screen.getByTestId("finance-reports-tab-statements")).toBeInTheDocument();
    expect(screen.getByTestId("finance-reports-tab-vat")).toBeInTheDocument();
  });

  it("defaults to the Trial balance tab", async () => {
    renderPanel();
    const trialTab = await screen.findByTestId("finance-reports-tab-trial-balance");
    expect(trialTab.getAttribute("data-active")).toBe("true");
  });

  it("switches to the VAT report tab on click", async () => {
    renderPanel();
    const vatTab = await screen.findByTestId("finance-reports-tab-vat");
    fireEvent.click(vatTab);
    expect(vatTab.getAttribute("data-active")).toBe("true");
    expect(
      screen.getByTestId("finance-reports-tab-trial-balance").getAttribute("data-active"),
    ).toBe("false");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * Trial balance sub-panel
 * ═══════════════════════════════════════════════════════════════════════ */

describe("FinanceReportsPanel — Trial balance", () => {
  it("shows a loading skeleton while the request is in flight", async () => {
    let resolve!: (v: unknown) => void;
    mocks.getJson.mockImplementation(
      (path: string) =>
        path === "/api/finance/trial-balance"
          ? new Promise((r) => (resolve = r))
          : Promise.resolve({}),
    );
    renderPanel();
    expect(await screen.findByTestId("finance-trial-balance-loading")).toBeInTheDocument();
    resolve(TRIAL_BALANCE_OK);
  });

  it("shows an error state when the request rejects", async () => {
    mocks.getJson.mockImplementation((path: string) => {
      if (path === "/api/finance/trial-balance")
        return Promise.reject(new Error("Network down"));
      return Promise.resolve({});
    });
    renderPanel();
    const err = await screen.findByTestId("finance-trial-balance-error");
    expect(err).toBeInTheDocument();
    expect(err.textContent ?? "").toMatch(/Network down/);
  });

  it("renders account rows + totals when data arrives", async () => {
    renderPanel();
    const table = await screen.findByTestId("finance-trial-balance-table");
    expect(table).toBeInTheDocument();
    // Two account rows from the fixture
    expect(screen.getByTestId("finance-trial-balance-row-1010")).toBeInTheDocument();
    expect(screen.getByTestId("finance-trial-balance-row-2010")).toBeInTheDocument();
    // Totals row renders at the bottom
    const totals = screen.getByTestId("finance-trial-balance-totals");
    expect(totals).toBeInTheDocument();
    // Hits the right URL with no schema (the panel uses raw `getJson` for
    // the local trial-balance type — there is no Zod schema in
    // schemas.ts for this response). Actual signature is
    // `getJson(path, undefined, signal)`.
    await waitFor(() =>
      expect(mocks.getJson).toHaveBeenCalledWith(
        "/api/finance/trial-balance",
        undefined,
        expect.anything(),
      ),
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * Financial statements sub-panel
 * ═══════════════════════════════════════════════════════════════════════ */

describe("FinanceReportsPanel — Financial statements", () => {
  beforeEach(() => {
    // Land on the statements tab.
    // We use a small effect-free click in each test rather than
    // seeding search state, to keep the test focused on the panel's
    // own behaviour.
  });

  it("shows a loading skeleton when the statements tab is opened", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("finance-reports-tab-statements"));
    expect(await screen.findByTestId("finance-statements-loading")).toBeInTheDocument();
  });

  it("shows an error state when the statements request rejects", async () => {
    mocks.getJson.mockImplementation((path: string) => {
      if (path === "/api/finance/statements")
        return Promise.reject(new Error("Accounting engine offline"));
      return Promise.resolve({});
    });
    renderPanel();
    fireEvent.click(await screen.findByTestId("finance-reports-tab-statements"));
    const err = await screen.findByTestId("finance-statements-error");
    expect(err.textContent ?? "").toMatch(/Accounting engine offline/);
  });

  it("renders P&L, balance sheet, and cash flow when data arrives", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("finance-reports-tab-statements"));
    expect(await screen.findByTestId("finance-statements-table")).toBeInTheDocument();
    // Three collapsible sections — one per statement.
    expect(screen.getByTestId("finance-statements-section-pl")).toBeInTheDocument();
    expect(screen.getByTestId("finance-statements-section-bs")).toBeInTheDocument();
    expect(screen.getByTestId("finance-statements-section-cf")).toBeInTheDocument();
    // P&L shows the net profit number from the fixture.
    expect(
      screen.getByTestId("finance-statements-pl-net-profit").textContent ?? "",
    ).toMatch(/1,000,000|1\s000\s000/);
    // Balance sheet badge reflects balanced=true.
    expect(screen.getByTestId("finance-statements-bs-badge").textContent ?? "").toMatch(
      /Balanced/,
    );
    // Validated against the Zod schema in schemas.ts.
    await waitFor(() =>
      expect(mocks.getJson).toHaveBeenCalledWith(
        "/api/finance/statements",
        FinancialStatementsResponseSchema,
        expect.anything(),
      ),
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * VAT report sub-panel
 * ═══════════════════════════════════════════════════════════════════════ */

describe("FinanceReportsPanel — VAT report", () => {
  it("shows a loading skeleton when the VAT tab is opened", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("finance-reports-tab-vat"));
    expect(await screen.findByTestId("finance-vat-loading")).toBeInTheDocument();
  });

  it("shows an error state when the VAT report request rejects", async () => {
    mocks.getJson.mockImplementation((path: string) => {
      if (path === "/api/finance/vat-report" || path === "/api/finance/vat-return")
        return Promise.reject(new Error("Period not found"));
      return Promise.resolve({});
    });
    renderPanel();
    fireEvent.click(await screen.findByTestId("finance-reports-tab-vat"));
    const err = await screen.findByTestId("finance-vat-error");
    expect(err.textContent ?? "").toMatch(/Period not found/);
  });

  it("renders output/input/net VAT + period + File return button", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("finance-reports-tab-vat"));
    const summary = await screen.findByTestId("finance-vat-summary");
    expect(summary).toBeInTheDocument();
    expect(summary.textContent ?? "").toMatch(/2026-06/);
    // Three KPI cards from the legacy panel.
    expect(screen.getByTestId("finance-vat-output").textContent ?? "").toMatch(/600,000|600\s000/);
    expect(screen.getByTestId("finance-vat-input").textContent ?? "").toMatch(/200,000|200\s000/);
    expect(screen.getByTestId("finance-vat-net").textContent ?? "").toMatch(/400,000|400\s000/);
    // Both endpoints consumed. Signatures are `getJson(path, undefined, signal)`.
    await waitFor(() =>
      expect(mocks.getJson).toHaveBeenCalledWith(
        "/api/finance/vat-report",
        undefined,
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(mocks.getJson).toHaveBeenCalledWith(
        "/api/finance/vat-return",
        VatReturnResponseSchema,
        expect.anything(),
      ),
    );
    // File-return button renders and is clickable.
    const fileBtn = screen.getByTestId("finance-vat-file-return");
    expect(fileBtn).toBeInTheDocument();
  });

  it("posts to /api/finance/vat-returns when the File return button is clicked", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("finance-reports-tab-vat"));
    const fileBtn = await screen.findByTestId("finance-vat-file-return");
    fireEvent.click(fileBtn);
    // The mutation calls `postJson(path, body)` — no schema, no signal.
    await waitFor(() =>
      expect(mocks.postJson).toHaveBeenCalledWith(
        "/api/finance/vat-returns",
        expect.objectContaining({ periodKey: "2026-06" }),
      ),
    );
  });
});
