/**
 * FinanceReportsPanel — 3 read-only report sub-panels migrated 1:1 from
 * web/src/finance.jsx (lines 14–89):
 *   - Trial balance     (uses local TrialBalance types, GET /api/finance/trial-balance)
 *   - Financial statements (GET /api/finance/statements, validated with
 *                            FinancialStatementsResponseSchema)
 *   - VAT report        (GET /api/finance/vat-report + /vat-return, plus
 *                        POST /api/finance/vat-returns via the File return button)
 *
 * Visual style matches the legacy `className="panel finance-*-panel"`
 * + "section-label" pattern, re-skinned with the design-system CSS
 * variables (--color-surface / --color-line / --color-muted / etc).
 *
 * Worker-fi-readonly-reports owns this file. Do not touch
 * `routes/app/finance/index.tsx`, `server/app.js`, or `lib/api/schemas.ts`.
 */
import * as React from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { getJson, postJson, type ApiError } from "../../../../lib/api/client";
import { FinancialStatementsResponseSchema } from "../../../../lib/api/schemas";
import { money } from "../../../../lib/utils/money";

/* ────────── local types (do NOT add to schemas.ts) ────────── */

/**
 * Mirrors the live response shape of
 *   server/ledger.js → trialBalance(db, orgId)
 * plus what the legacy frontend reads (`rows[]`, `balanced`).
 * `code` and `name` are the actual server field names — the legacy
 * aliases `accountCode`/`accountName` are normalised at render time.
 */
interface TrialBalanceRow {
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
}

interface TrialBalanceResponse {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

interface VatReportResponse {
  periodKey: string;
  currency?: string;
  outputVat: number;
  inputVat: number;
  netVatPayable: number;
  note?: string;
}

/**
 * Mirrors `buildFinanceVatReturn` in server/app.js. Schema is local
 * because schemas.ts does not (yet) export it.
 */
export const VatReturnResponseSchema = z.object({
  kind: z.string(),
  periodKey: z.string(),
  currency: z.string().optional(),
  standardVatRate: z.number().optional(),
  source: z.string().optional(),
  taxableSales: z.number().optional(),
  taxablePurchases: z.number().optional(),
  outputVat: z.number(),
  inputVat: z.number(),
  net: z.number(),
  payable: z.number().optional(),
  creditCarried: z.number().optional(),
  sales: z
    .object({
      lineCount: z.number(),
      taxableBase: z.number(),
      outputVat: z.number(),
    })
    .optional(),
  purchases: z
    .object({
      lineCount: z.number(),
      taxableBase: z.number(),
      inputVat: z.number(),
    })
    .optional(),
  note: z.string().optional(),
});
type VatReturnResponse = z.infer<typeof VatReturnResponseSchema>;

interface VatFileReturnRequest extends Record<string, unknown> {
  periodKey: string;
  note?: string;
}

/* ────────── query keys (stable) ────────── */

const QK = {
  trialBalance: ["finance", "trial-balance"] as const,
  statements: ["finance", "statements"] as const,
  vatReport: ["finance", "vat-report"] as const,
  vatReturn: ["finance", "vat-return"] as const,
};

/* ────────── root panel ────────── */

type TabId = "trial-balance" | "statements" | "vat";

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "trial-balance", label: "Trial balance" },
  { id: "statements", label: "Financial statements" },
  { id: "vat", label: "VAT report" },
];

export default function FinanceReportsPanel(): React.ReactElement {
  const [tab, setTab] = useState<TabId>("trial-balance");

  return (
    <section
      data-testid="finance-reports-panel"
      className="panel finance-reports-panel overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]"
    >
      <header className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3">
        <h2 className="section-label text-sm font-semibold text-[var(--color-ink)]">
          HayHashvapah Finance — Reports
        </h2>
        <span className="text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
          read-only
        </span>
      </header>

      {/* Tab strip */}
      <nav
        role="tablist"
        aria-label="Finance reports"
        className="flex border-b border-[var(--color-line)]"
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`finance-reports-tab-${t.id}`}
              data-active={active ? "true" : "false"}
              onClick={() => setTab(t.id)}
              className={[
                "px-4 py-2 text-[var(--text-sm)] font-medium",
                active
                  ? "border-b-2 border-[var(--color-brand)] text-[var(--color-ink)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-ink)]",
              ].join(" ")}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === "trial-balance" ? <TrialBalanceSubPanel /> : null}
        {tab === "statements" ? <StatementsSubPanel /> : null}
        {tab === "vat" ? <VatSubPanel /> : null}
      </div>
    </section>
  );
}

/* ────────── shared skeleton / error ────────── */

function LoadingSkeleton({ testId }: { testId: string }): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className="space-y-2"
      role="status"
      aria-live="polite"
    >
      <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--color-surface-soft)]" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--color-surface-soft)]" />
      <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--color-surface-soft)]" />
    </div>
  );
}

function ErrorState({
  testId,
  error,
}: {
  testId: string;
  error: unknown;
}): React.ReactElement {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ((): string => {
            // ApiError shape from lib/api/client.ts carries a `message`.
            if (error && typeof error === "object" && "message" in error) {
              const m = (error as { message?: unknown }).message;
              return typeof m === "string" ? m : "Request failed";
            }
            return "Request failed";
          })();
  return (
    <div
      data-testid={testId}
      role="alert"
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3 text-[var(--text-sm)] text-[var(--color-ink)]"
    >
      <span className="font-semibold">Couldn’t load report:</span> {message}
    </div>
  );
}

/* ────────── trial balance ────────── */

function TrialBalanceSubPanel(): React.ReactElement {
  const q = useQuery({
    queryKey: QK.trialBalance,
    queryFn: ({ signal }) =>
      getJson<TrialBalanceResponse>(
        "/api/finance/trial-balance",
        undefined,
        signal,
      ),
  });

  if (q.isLoading) return <LoadingSkeleton testId="finance-trial-balance-loading" />;
  if (q.isError) return <ErrorState testId="finance-trial-balance-error" error={q.error} />;
  if (!q.data) return <EmptyState message="No trial balance data." />;

  const { rows, totalDebit, totalCredit, balanced } = q.data;
  return (
    <div data-testid="finance-trial-balance-table" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          Trial balance
        </h3>
        <BalanceBadge balanced={balanced} />
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-line)]">
        <table className="min-w-full text-[var(--text-sm)]">
          <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] text-left text-[var(--text-xs)] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Debit</th>
              <th className="px-3 py-2 text-right">Credit</th>
              <th className="px-3 py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {rows.map((r) => (
              <tr
                key={r.code}
                data-testid={`finance-trial-balance-row-${r.code}`}
                className="hover:bg-[var(--color-surface-soft)]"
              >
                <td className="px-3 py-2">
                  <div className="font-mono text-[var(--text-xs)] text-[var(--color-muted)]">
                    {r.code}
                  </div>
                  <div className="text-[var(--color-ink)]">{r.name}</div>
                </td>
                <td className="px-3 py-2 capitalize text-[var(--color-muted)]">
                  {r.type}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(r.debit)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(r.credit)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(r.balance)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot data-testid="finance-trial-balance-totals">
            <tr className="border-t border-[var(--color-line)] bg-[var(--color-surface-soft)] font-semibold text-[var(--color-ink)]">
              <td className="px-3 py-2" colSpan={2}>
                Totals
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {money(totalDebit)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {money(totalCredit)}
              </td>
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ────────── financial statements ────────── */

function StatementsSubPanel(): React.ReactElement {
  const q = useQuery({
    queryKey: QK.statements,
    queryFn: ({ signal }) =>
      getJson(
        "/api/finance/statements",
        FinancialStatementsResponseSchema,
        signal,
      ),
  });

  if (q.isLoading) return <LoadingSkeleton testId="finance-statements-loading" />;
  if (q.isError) return <ErrorState testId="finance-statements-error" error={q.error} />;
  if (!q.data) return <EmptyState message="No statements available." />;

  const d = q.data;
  return (
    <div data-testid="finance-statements-table" className="space-y-3">
      <CollapsibleSection
        testId="finance-statements-section-pl"
        title="Profit & loss"
        defaultOpen
      >
        <PlSection data={d.incomeStatement} />
      </CollapsibleSection>
      <CollapsibleSection
        testId="finance-statements-section-bs"
        title="Balance sheet"
        defaultOpen
      >
        <BalanceSheetSection data={d.balanceSheet} />
      </CollapsibleSection>
      <CollapsibleSection
        testId="finance-statements-section-cf"
        title="Cash flow"
        defaultOpen={false}
      >
        <CashFlowSection data={d.cashFlow} />
      </CollapsibleSection>
    </div>
  );
}

function PlSection({
  data,
}: {
  data: {
    income: ReadonlyArray<{ id: string; code: string; name: string; amount: number }>;
    expense: ReadonlyArray<{ id: string; code: string; name: string; amount: number }>;
    totalIncome: number;
    totalExpense: number;
    netProfit: number;
  };
}): React.ReactElement {
  return (
    <div className="space-y-3">
      <StatementLineGroup
        title="Income"
        rows={data.income}
        total={data.totalIncome}
        testId="finance-statements-pl-income"
      />
      <StatementLineGroup
        title="Expense"
        rows={data.expense}
        total={data.totalExpense}
        testId="finance-statements-pl-expense"
      />
      <div
        data-testid="finance-statements-pl-net-profit"
        className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2 text-[var(--text-sm)] font-semibold"
      >
        <span>Net profit</span>
        <span className="tabular-nums">{money(data.netProfit)}</span>
      </div>
    </div>
  );
}

function BalanceSheetSection({
  data,
}: {
  data: {
    assets: ReadonlyArray<{ id: string; code: string; name: string; amount: number }>;
    liabilities: ReadonlyArray<{ id: string; code: string; name: string; amount: number }>;
    equity: ReadonlyArray<{ id: string; code: string; name: string; amount: number }>;
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    retainedEarnings: number;
    totalEquityAndLiabilities: number;
    balanced: boolean;
  };
}): React.ReactElement {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <BalanceBadge
          balanced={data.balanced}
          testId="finance-statements-bs-badge"
        />
      </div>
      <StatementLineGroup
        title="Assets"
        rows={data.assets}
        total={data.totalAssets}
      />
      <StatementLineGroup
        title="Liabilities"
        rows={data.liabilities}
        total={data.totalLiabilities}
      />
      <StatementLineGroup
        title="Equity"
        rows={data.equity}
        total={data.totalEquity}
      />
      <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2 text-[var(--text-sm)] font-semibold">
        <span>Total equity & liabilities</span>
        <span className="tabular-nums">{money(data.totalEquityAndLiabilities)}</span>
      </div>
    </div>
  );
}

function CashFlowSection({
  data,
}: {
  data: { cashIn: number; cashOut: number; netCashChange: number };
}): React.ReactElement {
  return (
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <CashFlowCell label="Cash in" value={data.cashIn} />
      <CashFlowCell label="Cash out" value={data.cashOut} />
      <CashFlowCell label="Net change" value={data.netCashChange} />
    </dl>
  );
}

function CashFlowCell({
  label,
  value,
}: {
  label: string;
  value: number;
}): React.ReactElement {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2">
      <div className="text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
      <div className="text-[var(--text-sm)] font-semibold tabular-nums text-[var(--color-ink)]">
        {money(value)}
      </div>
    </div>
  );
}

function StatementLineGroup({
  title,
  rows,
  total,
  testId,
}: {
  title: string;
  rows: ReadonlyArray<{ id: string; code: string; name: string; amount: number }>;
  total: number;
  testId?: string;
}): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-line)]"
    >
      <table className="min-w-full text-[var(--text-sm)]">
        <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] text-left text-[var(--text-xs)] font-medium uppercase tracking-wide text-[var(--color-muted)]">
          <tr>
            <th className="px-3 py-2">{title}</th>
            <th className="px-3 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-[var(--color-surface-soft)]">
              <td className="px-3 py-2">
                <span className="mr-2 font-mono text-[var(--text-xs)] text-[var(--color-muted)]">
                  {r.code}
                </span>
                {r.name}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {money(r.amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--color-line)] bg-[var(--color-surface-soft)] font-semibold text-[var(--color-ink)]">
            <td className="px-3 py-2">Total {title.toLowerCase()}</td>
            <td className="px-3 py-2 text-right tabular-nums">
              {money(total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ────────── VAT report ────────── */

function VatSubPanel(): React.ReactElement {
  const qc = useQueryClient();

  const report = useQuery({
    queryKey: QK.vatReport,
    queryFn: ({ signal }) =>
      getJson<VatReportResponse>("/api/finance/vat-report", undefined, signal),
  });

  const vatReturn = useQuery({
    queryKey: QK.vatReturn,
    queryFn: ({ signal }) =>
      getJson(
        "/api/finance/vat-return",
        VatReturnResponseSchema,
        signal,
      ),
  });

  const fileReturn = useMutation<
    { ok: true; vatReturn: { id: string; periodKey: string } },
    ApiError,
    VatFileReturnRequest
  >({
    mutationFn: (body) =>
      postJson("/api/finance/vat-returns", body) as Promise<{
        ok: true;
        vatReturn: { id: string; periodKey: string };
      }>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.vatReturn });
      void qc.invalidateQueries({ queryKey: QK.vatReport });
    },
  });

  if (report.isLoading || vatReturn.isLoading)
    return <LoadingSkeleton testId="finance-vat-loading" />;
  if (report.isError || vatReturn.isError)
    return (
      <ErrorState
        testId="finance-vat-error"
        error={report.error ?? vatReturn.error}
      />
    );
  if (!report.data) return <EmptyState message="No VAT data." />;

  const r = report.data;
  return (
    <div data-testid="finance-vat-summary" className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          VAT return — period {r.periodKey}
        </h3>
        <button
          type="button"
          data-testid="finance-vat-file-return"
          disabled={fileReturn.isPending}
          onClick={() => {
            fileReturn.mutate({ periodKey: r.periodKey, note: r.note });
          }}
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-brand)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {fileReturn.isPending ? "Filing…" : "File return"}
        </button>
      </div>

      {fileReturn.isError ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3 text-[var(--text-sm)]"
        >
          {fileReturn.error instanceof Error
            ? fileReturn.error.message
            : "Couldn’t file the return."}
        </div>
      ) : null}

      {fileReturn.isSuccess ? (
        <div
          role="status"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3 text-[var(--text-sm)]"
        >
          Filed VAT return{" "}
          <span className="font-mono">{fileReturn.data.vatReturn.id}</span> for{" "}
          {fileReturn.data.vatReturn.periodKey}.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <VatKpi
          testId="finance-vat-output"
          label="Output VAT"
          value={r.outputVat}
        />
        <VatKpi
          testId="finance-vat-input"
          label="Input VAT"
          value={r.inputVat}
        />
        <VatKpi
          testId="finance-vat-net"
          label="Net VAT payable"
          value={r.netVatPayable}
        />
      </div>

      {vatReturn.data ? (
        <VatReturnBreakdown data={vatReturn.data} />
      ) : null}

      {r.note ? (
        <p className="text-[var(--text-xs)] italic text-[var(--color-muted)]">
          {r.note}
        </p>
      ) : null}
    </div>
  );
}

function VatKpi({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId: string;
}): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3"
    >
      <div className="text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
      <div className="text-[var(--text-2xl)] font-semibold tabular-nums text-[var(--color-ink)]">
        {money(value)}
      </div>
    </div>
  );
}

function VatReturnBreakdown({
  data,
}: {
  data: VatReturnResponse;
}): React.ReactElement {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-line)]">
      <table className="min-w-full text-[var(--text-sm)]">
        <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] text-left text-[var(--text-xs)] font-medium uppercase tracking-wide text-[var(--color-muted)]">
          <tr>
            <th className="px-3 py-2">Bucket</th>
            <th className="px-3 py-2 text-right">Taxable base</th>
            <th className="px-3 py-2 text-right">VAT</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {data.sales ? (
            <tr>
              <td className="px-3 py-2">Sales ({data.sales.lineCount})</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {money(data.sales.taxableBase)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {money(data.sales.outputVat)}
              </td>
            </tr>
          ) : null}
          {data.purchases ? (
            <tr>
              <td className="px-3 py-2">Purchases ({data.purchases.lineCount})</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {money(data.purchases.taxableBase)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {money(data.purchases.inputVat)}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/* ────────── shared bits ────────── */

function BalanceBadge({
  balanced,
  testId,
}: {
  balanced: boolean;
  testId?: string;
}): React.ReactElement {
  return (
    <span
      data-testid={testId}
      className={[
        "aging-badge inline-flex items-center rounded-full px-2 py-0.5 text-[var(--text-xs)] font-medium",
        balanced
          ? "bg-[var(--color-tag-good-bg)] text-[var(--color-tag-good-ink)]"
          : "bg-[var(--color-tag-bad-bg)] text-[var(--color-tag-bad-ink)]",
      ].join(" ")}
    >
      {balanced ? "Balanced" : "Out of balance"}
    </span>
  );
}

function EmptyState({ message }: { message: string }): React.ReactElement {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] p-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
      {message}
    </div>
  );
}

function CollapsibleSection({
  title,
  testId,
  defaultOpen,
  children,
}: {
  title: string;
  testId: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      data-testid={testId}
      className="rounded-[var(--radius-md)] border border-[var(--color-line)]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2 text-left text-[var(--text-sm)] font-semibold text-[var(--color-ink)]"
      >
        <span>{title}</span>
        <span aria-hidden className="text-[var(--color-muted)]">
          {open ? "−" : "+"}
        </span>
      </button>
      {open ? <div className="p-3">{children}</div> : null}
    </section>
  );
}
