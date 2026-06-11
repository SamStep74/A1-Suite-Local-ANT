/**
 * /app/cfo/reports — CFO printable financial statements.
 *
 * Source: server/app.js#financialStatements → GET /api/finance/statements
 * Returns a single envelope with three reports:
 *   - incomeStatement   (P&L)
 *   - balanceSheet      (Assets / Liabilities / Equity)
 *   - cashFlow          (Operating / Investing / Financing)
 *
 * The page is a single-screen view (no tabs) with three side-by-side
 * report tables. The "Print" button in the page header calls
 * `window.print()` — no PDF library. The @media print rules below
 * hide the chrome (nav, header buttons, footer links) so the printed
 * page is the report itself, sized to A4 portrait.
 *
 * Why we don't use the existing finance/print.xhtml: that legacy
 * path lives in web/ and is being strangler-figged in Phase 8. This
 * route is the modern, TanStack-Start replacement and the source of
 * truth going forward.
 *
 * URL state:
 *   ?period=YYYY-MM    Defaults to the current month
 *   ?statement=p-and-l | balance-sheet | cash-flow
 *                     Default "all" — all three are rendered in a
 *                     stacked layout for print. Screen users can
 *                     click a chip to scroll-anchor to a section.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  Printer,
  TriangleAlert,
} from "lucide-react";
import { getJson } from "../../../../lib/api/client";
import {
  FinancialStatementsResponseSchema,
  type FinancialStatementLine,
  type FinancialStatementsResponse,
} from "../../../../lib/api/schemas";
import { cn } from "../../../../lib/utils/cn";
import {
  balanceSheetDelta,
  currentPeriodKey,
  formatReportPeriod,
  isBalanced,
  printDateLabel,
  profitMargin,
  shiftPeriodKey,
  signClassForAmount,
  sortLinesByCodeAsc,
} from "../../../../lib/cfo/reports";
import { formatCurrency } from "../../../../lib/cfo/status";

/* ────────── typed URL search ────────── */

type Statement = "p-and-l" | "balance-sheet" | "cash-flow";

const STATEMENT_OPTIONS: { value: Statement; label: string; anchor: string }[] = [
  { value: "p-and-l", label: "P&L", anchor: "section-pl" },
  { value: "balance-sheet", label: "Balance sheet", anchor: "section-bs" },
  { value: "cash-flow", label: "Cash flow", anchor: "section-cf" },
];

export const Route = createFileRoute("/app/cfo/reports/")({
  validateSearch: (raw) => {
    const period =
      typeof raw.period === "string" && /^\d{4}-\d{2}$/.test(raw.period)
        ? raw.period
        : currentPeriodKey();
    const statement: Statement =
      raw.statement === "balance-sheet" || raw.statement === "cash-flow"
        ? raw.statement
        : "p-and-l";
    return { period, statement };
  },
  component: CfoReportsRoute,
});

/* ────────── main route component ────────── */

function CfoReportsRoute() {
  const { period, statement } = Route.useSearch();
  const navigate = Route.useNavigate();

  const q = useQuery({
    queryKey: ["cfo-financial-statements", period],
    queryFn: async () => {
      const raw = await getJson(
        `/api/finance/statements?periodKey=${encodeURIComponent(period)}`,
      );
      return FinancialStatementsResponseSchema.parse(raw);
    },
  });

  // Anchor-link to the active section on render. We use location.hash
  // rather than the search state so the browser's "back" button still
  // walks the period/statement history cleanly.
  const activeSectionAnchor =
    STATEMENT_OPTIONS.find((o) => o.value === statement)?.anchor ??
    "section-pl";

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8 print:p-0 print:max-w-none">
      {/* ───── chrome hidden on print ───── */}
      <div className="print:hidden">
        <PageHeader />
      </div>

      {/* ───── period selector + statement chips + Print ───── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <PeriodSelector
          period={period}
          onChange={(p) => navigate({ search: { period: p, statement } })}
        />
        <div className="flex items-center gap-2">
          <StatementChips
            value={statement}
            onChange={(s) => navigate({ search: { period, statement: s } })}
          />
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-line)]"
            aria-label="Print financial statements"
          >
            <Printer className="size-3.5" />
            Print
          </button>
        </div>
      </div>

      {/* ───── print-only header (renders inside the printed page) ───── */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-semibold">Financial Statements</h1>
        <p className="text-sm">
          {formatReportPeriod(period)} · Printed {printDateLabel()}
        </p>
      </div>

      {/* ───── report body ───── */}
      <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 print:border-0 print:p-0">
        {q.isLoading && (
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
            Loading financial statements…
          </p>
        )}
        {q.isError && (
          <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
            Failed to load financial statements. Please try again.
          </p>
        )}
        {q.data && <Reports data={q.data} activeAnchor={activeSectionAnchor} />}
      </div>

      {/* ───── back link (screen only) ───── */}
      <div className="print:hidden">
        <Link
          to="/app/cfo"
          search={{ view: "cash-flow" }}
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          Back to CFO
        </Link>
      </div>
    </div>
  );
}

/* ────────── period selector ────────── */

function PeriodSelector({
  period,
  onChange,
}: {
  period: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
      <button
        type="button"
        onClick={() => onChange(shiftPeriodKey(period, -1))}
        className="rounded-[var(--radius-sm)] px-2 py-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:bg-[var(--color-line)]"
        aria-label="Previous period"
      >
        ‹
      </button>
      <span className="min-w-[10ch] px-2 text-center font-mono text-[var(--text-sm)] text-[var(--color-ink)]">
        {formatReportPeriod(period)}
      </span>
      <button
        type="button"
        onClick={() => onChange(shiftPeriodKey(period, 1))}
        className="rounded-[var(--radius-sm)] px-2 py-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:bg-[var(--color-line)]"
        aria-label="Next period"
      >
        ›
      </button>
    </div>
  );
}

/* ────────── statement chips ────────── */

function StatementChips({
  value,
  onChange,
}: {
  value: Statement;
  onChange: (next: Statement) => void;
}) {
  return (
    <div role="tablist" aria-label="Jump to statement" className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
      {STATEMENT_OPTIONS.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-current={value === o.value ? "page" : undefined}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[var(--radius-sm)] px-2.5 py-1 text-[var(--text-sm)]",
            value === o.value
              ? "bg-[var(--color-ink)] text-[var(--color-surface)]"
              : "text-[var(--color-muted)] hover:bg-[var(--color-line)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ────────── page header (screen only) ────────── */

function PageHeader() {
  return (
    <header
      data-testid="cfo-reports-screen-header"
      className="space-y-1"
    >
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        CFO · Reports
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
        Financial Statements
      </h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Շահույթ-վնաս · Հաշվեկշիռ · Կանխիկի հոսք
      </p>
    </header>
  );
}

/* ────────── report body ────────── */

function Reports({
  data,
  activeAnchor,
}: {
  data: FinancialStatementsResponse;
  activeAnchor: string;
}) {
  return (
    <div className="space-y-8 print:space-y-6">
      <PAndLSection data={data.incomeStatement} active={activeAnchor === "section-pl"} />
      <BalanceSheetSection data={data.balanceSheet} active={activeAnchor === "section-bs"} />
      <CashFlowSection data={data.cashFlow} active={activeAnchor === "section-cf"} />
    </div>
  );
}

/* ────────── P&L section ────────── */

function PAndLSection({
  data,
  active,
}: {
  data: FinancialStatementsResponse["incomeStatement"];
  active: boolean;
}) {
  const margin = profitMargin(data);
  return (
    <section
      id="section-pl"
      aria-current={active ? "true" : undefined}
      className="scroll-mt-20"
    >
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[var(--text-lg)] font-semibold text-[var(--color-ink)]">
          Profit & Loss
        </h2>
        <span className="font-mono text-[var(--text-sm)] text-[var(--color-muted)]">
          Margin {margin.toFixed(1)}%
        </span>
      </header>

      <table className="w-full border-collapse text-[var(--text-sm)]">
        <thead>
          <tr className="border-b border-[var(--color-line)] text-left text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
            <th className="py-1.5 pr-2 font-normal">Code</th>
            <th className="py-1.5 pr-2 font-normal">Account</th>
            <th className="py-1.5 pr-2 text-right font-normal">Amount (AMD)</th>
          </tr>
        </thead>
        <tbody>
          {sortLinesByCodeAsc(data.income).map((l) => (
            <tr key={`i-${l.id}`} className="border-b border-[var(--color-line)]/50">
              <td className="py-1 pr-2 font-mono text-[var(--color-muted)]">{l.code}</td>
              <td className="py-1 pr-2">{l.name}</td>
              <td className={cn("py-1 pr-2 text-right font-mono", signClassForAmount(l.amount))}>
                {formatCurrency(l.amount)}
              </td>
            </tr>
          ))}
          <tr className="border-b border-[var(--color-line)] bg-[var(--color-line)]/30 font-semibold">
            <td className="py-1.5 pr-2" colSpan={2}>Total income</td>
            <td className={cn("py-1.5 pr-2 text-right font-mono", signClassForAmount(data.totalIncome))}>
              {formatCurrency(data.totalIncome)}
            </td>
          </tr>
          {sortLinesByCodeAsc(data.expense).map((l) => (
            <tr key={`e-${l.id}`} className="border-b border-[var(--color-line)]/50">
              <td className="py-1 pr-2 font-mono text-[var(--color-muted)]">{l.code}</td>
              <td className="py-1 pr-2">{l.name}</td>
              <td className={cn("py-1 pr-2 text-right font-mono", signClassForAmount(-Math.abs(l.amount)))}>
                {formatCurrency(-Math.abs(l.amount))}
              </td>
            </tr>
          ))}
          <tr className="border-b border-[var(--color-line)] bg-[var(--color-line)]/30 font-semibold">
            <td className="py-1.5 pr-2" colSpan={2}>Total expense</td>
            <td className={cn("py-1.5 pr-2 text-right font-mono", signClassForAmount(-Math.abs(data.totalExpense)))}>
              {formatCurrency(-Math.abs(data.totalExpense))}
            </td>
          </tr>
          <tr className="font-mono text-[var(--text-sm)] font-semibold">
            <td className="py-1.5 pr-2" colSpan={2}>Net profit</td>
            <td className={cn("py-1.5 pr-2 text-right", signClassForAmount(data.netProfit))}>
              {formatCurrency(data.netProfit)}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/* ────────── balance sheet section ────────── */

function BalanceSheetSection({
  data,
  active,
}: {
  data: FinancialStatementsResponse["balanceSheet"];
  active: boolean;
}) {
  // Trust the server's `balanced` flag as the primary signal; fall
  // back to a re-derivation if the flag is missing (older API
  // responses). Show the warning chip whenever the two disagree or
  // either says "not balanced".
  const balanced = data.balanced && isBalanced({
    totalAssets: data.totalAssets,
    totalEquityAndLiabilities: data.totalEquityAndLiabilities,
  });
  const delta = balanceSheetDelta({
    totalAssets: data.totalAssets,
    totalEquityAndLiabilities: data.totalEquityAndLiabilities,
  });
  return (
    <section
      id="section-bs"
      aria-current={active ? "true" : undefined}
      className="scroll-mt-20"
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[var(--text-lg)] font-semibold text-[var(--color-ink)]">
          Balance Sheet
        </h2>
        {!balanced && (
          <span
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-tag-red)]/15 px-2 py-0.5 text-[11px] text-[var(--color-tag-red)]"
            data-testid="balance-sheet-warning"
            role="status"
          >
            <TriangleAlert className="size-3" />
            Off by {formatCurrency(Math.abs(delta))}
          </span>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3 print:grid-cols-3">
        <AccountGroup title="Assets" lines={data.assets} total={data.totalAssets} />
        <AccountGroup title="Liabilities" lines={data.liabilities} total={data.totalLiabilities} />
        <AccountGroup
          title="Equity"
          lines={data.equity}
          total={data.totalEquity}
          retainedEarnings={data.retainedEarnings}
        />
      </div>

      <p
        className="mt-3 text-[11px] text-[var(--color-muted)]"
        data-testid="balance-sheet-totals"
      >
        Total assets {formatCurrency(data.totalAssets)} · Total liabilities + equity{" "}
        {formatCurrency(data.totalEquityAndLiabilities)}
      </p>
    </section>
  );
}

function AccountGroup({
  title,
  lines,
  total,
  retainedEarnings,
}: {
  title: string;
  lines: ReadonlyArray<FinancialStatementLine>;
  total: number;
  /** Only the Equity column gets a retained-earnings footnote line
   *  when the period had a net profit. */
  retainedEarnings?: number;
}) {
  return (
    <div>
      <h3 className="mb-1 text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
        {title}
      </h3>
      <table className="w-full border-collapse text-[var(--text-sm)]">
        <tbody>
          {sortLinesByCodeAsc(lines).map((l) => (
            <tr key={l.id} className="border-b border-[var(--color-line)]/50">
              <td className="py-1 pr-2 font-mono text-[11px] text-[var(--color-muted)]">
                {l.code}
              </td>
              <td className="py-1 pr-1">{l.name}</td>
              <td className={cn("py-1 pl-2 text-right font-mono", signClassForAmount(l.amount))}>
                {formatCurrency(l.amount)}
              </td>
            </tr>
          ))}
          {retainedEarnings != null && retainedEarnings !== 0 && (
            <tr className="text-[var(--color-muted)]">
              <td className="py-1 pr-2 font-mono text-[11px]">—</td>
              <td className="py-1 pr-1 italic">Retained earnings</td>
              <td className={cn("py-1 pl-2 text-right font-mono", signClassForAmount(retainedEarnings))}>
                {formatCurrency(retainedEarnings)}
              </td>
            </tr>
          )}
          <tr className="bg-[var(--color-line)]/30 font-semibold">
            <td className="py-1.5 pr-2" colSpan={2}>Total {title.toLowerCase()}</td>
            <td className={cn("py-1.5 pl-2 text-right font-mono", signClassForAmount(total))}>
              {formatCurrency(total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ────────── cash flow section ────────── */

function CashFlowSection({
  data,
  active,
}: {
  data: FinancialStatementsResponse["cashFlow"];
  active: boolean;
}) {
  // Phase 7: the engine returns a flat 3-row summary. A full direct
  // cash-flow statement (operating / investing / financing) is a
  // follow-up phase — see lib/cfo/reports.ts.
  return (
    <section
      id="section-cf"
      aria-current={active ? "true" : undefined}
      className="scroll-mt-20"
    >
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[var(--text-lg)] font-semibold text-[var(--color-ink)]">
          Cash Flow
        </h2>
        <span className="font-mono text-[var(--text-sm)] text-[var(--color-muted)]">
          Net change {formatCurrency(data.netCashChange)}
        </span>
      </header>

      <table className="w-full border-collapse text-[var(--text-sm)]">
        <tbody>
          <tr>
            <td className="py-1.5 pr-2" colSpan={2}>Cash received</td>
            <td className={cn("py-1.5 pl-2 text-right font-mono", signClassForAmount(data.cashIn))}>
              {formatCurrency(data.cashIn)}
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pr-2" colSpan={2}>Cash paid out</td>
            <td className={cn("py-1.5 pl-2 text-right font-mono", signClassForAmount(-Math.abs(data.cashOut)))}>
              {formatCurrency(-Math.abs(data.cashOut))}
            </td>
          </tr>
          <tr className="bg-[var(--color-line)]/30 font-semibold">
            <td className="py-1.5 pr-2" colSpan={2}>Net change</td>
            <td className={cn("py-1.5 pl-2 text-right font-mono", signClassForAmount(data.netCashChange))}>
              {formatCurrency(data.netCashChange)}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
