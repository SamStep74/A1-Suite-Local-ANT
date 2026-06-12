/**
 * /app/finance — Finance workspace: invoices | periods | payments
 *                       | reports | masterdata | workflow.
 *
 * Mirrors the inventory/crm pattern (Pattern A from the plan §3.4).
 * The home route is a ViewSwitcher over six surfaces:
 *
 *   - **Invoices** — every draft invoice with a status column that
 *     buckets each row as draft / posted / overdue / paid. Click a
 *     row → /app/finance/$invoiceId (the per-invoice detail page
 *     with its right-rail AI Action Panel).
 *   - **Periods** — the month-close list. Each row shows the
 *     period key (Armenian-rendered), its status, and a tone pill
 *     (open / current / closed / future). Open/current periods are
 *     tappable; closed periods show a lock icon.
 *   - **Payments** — every recorded payment, newest first. Read-only
 *     for now (record-payment lives on the invoice detail page,
 *     Phase 2.5 follow-up).
 *   - **Reports** — read-only financial reports (Trial balance,
 *     Financial statements, VAT report). Phase 10.2c W0.
 *   - **Master data** — tax rates, chart of accounts, localization
 *     tools, opening balances. Phase 10.2c W1.
 *   - **Workflow** — expenses, bills, payables, payroll, legal search.
 *     Phase 10.2c W2.
 *
 * URL state:
 *   ?view=invoices | periods | payments | reports | masterdata | workflow
 *   ?status=…   (per-view filter — see STATUS_TABS)
 *
 * Data:
 *   - /api/finance/draft-invoices
 *   - /api/finance/periods
 *   - /api/finance/payments
 *   - /api/finance/{trial-balance,statements,vat-report,vat-returns,tax-rates,
 *     chart-of-accounts,opening-balances,expenses,bills,payables,payroll/*,
 *     legal-search}
 *
 * The same Fastify proxy as the rest of the workspace.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Coins,
  ListChecks,
  Lock,
  Receipt,
} from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  FinanceDraftInvoicesResponseSchema,
  FinancePaymentsResponseSchema,
  FinancePeriodsResponseSchema,
  type FinanceDraftInvoice,
  type FinancePayment,
  type FinancePeriod,
} from "../../../lib/api/schemas";
import { ViewSwitcher } from "../../../components/view-switcher/ViewSwitcher";
import { money, numberShort } from "../../../lib/utils/money";
import { cn } from "../../../lib/utils/cn";
import {
  classifyInvoice,
  classifyPeriod,
  comparePeriodKeysDesc,
  groupPaymentsByCurrency,
  periodLabel,
  sumInvoiceTotals,
  sumInvoiceVat,
  summarizeAging,
  type InvoiceStatusTone,
  type PeriodTone,
} from "../../../lib/finance/status";
import FinanceReportsPanel from "./panels/FinanceReportsPanel";
import FinanceMasterDataPanel from "./panels/FinanceMasterDataPanel";
import FinanceWorkflowPanel from "./panels/FinanceWorkflowPanel";

/* ────────── typed URL search ────────── */

type View = "invoices" | "periods" | "payments" | "reports" | "masterdata" | "workflow";
type InvoiceFilter = "all" | "draft" | "posted" | "overdue" | "paid";
type PeriodFilter = "all" | PeriodTone;
type PaymentFilter = "all" | string; // payment has no enum-style states; placeholder
const VIEW_VALUES: readonly View[] = [
  "invoices",
  "periods",
  "payments",
  "reports",
  "masterdata",
  "workflow",
] as const;

const INVOICE_TABS = ["all", "draft", "posted", "overdue", "paid"] as const;
const PERIOD_TABS = ["all", "current", "open", "closed", "future"] as const;

export const Route = createFileRoute("/app/finance/")({
  validateSearch: (raw) => {
    const v: View = (VIEW_VALUES as readonly string[]).includes(raw.view as string)
      ? (raw.view as View)
      : "invoices";
    const s: InvoiceFilter | PeriodFilter | PaymentFilter =
      typeof raw.status === "string" ? raw.status : "all";
    return { view: v, status: s };
  },
  component: FinanceWorkspace,
});

/* ────────── constants ────────── */

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "invoices", label: "Invoices" },
  { value: "periods", label: "Periods" },
  { value: "payments", label: "Payments" },
  { value: "reports", label: "Reports" },
  { value: "masterdata", label: "Master data" },
  { value: "workflow", label: "Workflow" },
];

const INVOICE_FILTER_TABS: { value: InvoiceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "posted", label: "Posted" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
];

const PERIOD_FILTER_TABS: { value: PeriodFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "current", label: "Current" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "future", label: "Future" },
];

const PAYMENT_FILTER_TABS: { value: PaymentFilter; label: string }[] = [
  { value: "all", label: "All" },
];

/* ────────── filter coercion ────────── */

function coerceInvoiceFilter(s: string): InvoiceFilter {
  return (INVOICE_TABS as readonly string[]).includes(s)
    ? (s as InvoiceFilter)
    : "all";
}

function coercePeriodFilter(s: string): PeriodFilter {
  return (PERIOD_TABS as readonly string[]).includes(s)
    ? (s as PeriodFilter)
    : "all";
}

function coercePaymentFilter(s: string): PaymentFilter {
  return s === "all" ? s : "all";
}

/* ────────── tone maps ────────── */

const INVOICE_TONE: Record<InvoiceStatusTone, { bg: string; fg: string; label: string }> = {
  draft: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
    label: "Draft",
  },
  posted: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
    label: "Posted",
  },
  overdue: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
    label: "Overdue",
  },
  paid: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Paid",
  },
  cancelled: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-violet)_15%,transparent)]",
    fg: "text-[var(--color-tag-violet)]",
    label: "Cancelled",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "—",
  },
};

const PERIOD_TONE: Record<PeriodTone, { bg: string; fg: string; label: string }> = {
  current: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Current",
  },
  open: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
    label: "Open",
  },
  closed: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-violet)_15%,transparent)]",
    fg: "text-[var(--color-tag-violet)]",
    label: "Closed",
  },
  future: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
    label: "Future",
  },
};

/* ────────── root component ────────── */

function FinanceWorkspace() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const view = search.view;
  const status = search.status;

  const setView = (next: View) =>
    navigate({ search: { view: next, status: "all" }, replace: true });
  const setStatus = (next: InvoiceFilter | PeriodFilter | PaymentFilter) =>
    navigate({ search: { view, status: next }, replace: true });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ViewSwitcher options={VIEW_OPTIONS} value={view} onChange={setView} />
        <Link
          to="/app/finance"
          search={{ view: "periods", status: "current" }}
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <Calendar className="size-3.5" />
          Current period
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div>
          {view === "invoices" && (
            <InvoicesView
              filter={coerceInvoiceFilter(status as string)}
              setFilter={setStatus}
            />
          )}
          {view === "periods" && (
            <PeriodsView
              filter={coercePeriodFilter(status as string)}
              setFilter={setStatus}
            />
          )}
          {view === "payments" && (
            <PaymentsView
              filter={coercePaymentFilter(status as string)}
              setFilter={setStatus}
            />
          )}
          {view === "reports" && <FinanceReportsPanel />}
          {view === "masterdata" && <FinanceMasterDataPanel />}
          {view === "workflow" && <FinanceWorkflowPanel />}
        </div>
        <ForecastTotals />
      </div>
    </div>
  );
}

/* ────────── header ────────── */

function PageHeader() {
  return (
    <header>
      <Link
        to="/app"
        className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        Today
      </Link>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
            <Coins className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
              Finance
            </h1>
            <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
              Հաշիվներ · Հարկում · Ժամանակահատվածներ · Invoices · Periods · Payments
            </p>
          </div>
        </div>
        <div className="hidden text-right text-[var(--text-xs)] text-[var(--color-muted)] sm:block">
          <div>HayHashvapah · Armosphera</div>
          <div>AMD · hy-AM</div>
        </div>
      </div>
    </header>
  );
}

/* ────────── InvoicesView (list) ────────── */

function InvoicesView({
  filter,
  setFilter,
}: {
  filter: InvoiceFilter;
  setFilter: (next: InvoiceFilter | PeriodFilter | PaymentFilter) => void;
}) {
  const invoicesQuery = useQuery({
    queryKey: ["finance-draft-invoices"],
    queryFn: () =>
      getJson("/api/finance/draft-invoices", FinanceDraftInvoicesResponseSchema),
  });

  const invoices: ReadonlyArray<FinanceDraftInvoice> =
    invoicesQuery.data?.draftInvoices ?? [];

  const today = new Date();
  const filtered = useMemo(() => {
    if (filter === "all") return invoices;
    return invoices.filter((inv) => classifyInvoice(inv, today) === filter);
  }, [invoices, filter, today]);

  if (invoicesQuery.isLoading) {
    return <Loading message="Loading invoices" armenian="Հաշիվները բեռնվում են" />;
  }

  return (
    <div className="space-y-3" data-entity="finance-invoice" data-count={invoices.length}>
      <FilterTabs
        ariaLabel="Filter by status"
        tabs={INVOICE_FILTER_TABS}
        counts={countBy(invoices, (i) => classifyInvoice(i, today))}
        value={filter}
        onChange={(v) => setFilter(v)}
      />

      {filtered.length === 0 ? (
        <EmptyState message="No invoices in this view" armenian="Հաշիվներ չկան այս տեսքում" />
      ) : (
        <InvoiceTable invoices={filtered} today={today} />
      )}
    </div>
  );
}

function InvoiceTable({
  invoices,
  today,
}: {
  invoices: ReadonlyArray<FinanceDraftInvoice>;
  today: Date;
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <table className="w-full text-[var(--text-sm)]">
        <thead>
          <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] text-left text-[var(--text-xs)] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            <th className="px-3 py-2 font-medium">Number</th>
            <th className="px-3 py-2 font-medium">Customer</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium text-right">Total</th>
            <th className="px-3 py-2 font-medium text-right">VAT</th>
            <th className="px-3 py-2 font-medium">Due</th>
            <th className="px-3 py-2 font-medium" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const tone = INVOICE_TONE[classifyInvoice(inv, today)];
            const days = daysUntilDue(inv, today);
            return (
              <tr
                key={inv.id}
                className="border-b border-[var(--color-line)] last:border-b-0 hover:bg-[var(--color-surface-soft)]"
              >
                <td className="px-3 py-2 font-mono text-[var(--text-xs)] text-[var(--color-ink)]">
                  <Link
                    to="/app/finance/$invoiceId"
                    params={{ invoiceId: inv.id }}
                    className="hover:underline"
                  >
                    {inv.number ?? <span className="text-[var(--color-muted)]">—</span>}
                  </Link>
                </td>
                <td className="px-3 py-2 text-[var(--color-ink)]">
                  {inv.customerName}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[var(--text-xs)] font-medium",
                      tone.bg,
                      tone.fg,
                    )}
                  >
                    {tone.label === "Overdue" ? (
                      <CircleAlert className="size-3" />
                    ) : tone.label === "Paid" ? (
                      <CircleCheck className="size-3" />
                    ) : null}
                    {tone.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                  {money(inv.total)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-muted)]">
                  {money(inv.vat)}
                </td>
                <td className="px-3 py-2 text-[var(--text-xs)] text-[var(--color-muted)]">
                  {dueCellLabel(inv.dueDate, days)}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    to="/app/finance/$invoiceId"
                    params={{ invoiceId: inv.id }}
                    className="inline-flex items-center gap-1 text-[var(--text-xs)] text-[var(--color-brand)] hover:underline"
                  >
                    Open
                    <ChevronRight className="size-3" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ────────── PeriodsView ────────── */

function PeriodsView({
  filter,
  setFilter,
}: {
  filter: PeriodFilter;
  setFilter: (next: InvoiceFilter | PeriodFilter | PaymentFilter) => void;
}) {
  const periodsQuery = useQuery({
    queryKey: ["finance-periods"],
    queryFn: () =>
      getJson("/api/finance/periods", FinancePeriodsResponseSchema),
  });

  const periods: ReadonlyArray<FinancePeriod> = useMemo(
    () => (periodsQuery.data?.periods ?? []).slice().sort((a, b) => comparePeriodKeysDesc(a.periodKey, b.periodKey)),
    [periodsQuery.data],
  );

  const today = new Date();
  const filtered = useMemo(() => {
    if (filter === "all") return periods;
    return periods.filter((p) => classifyPeriod(p, today) === filter);
  }, [periods, filter, today]);

  if (periodsQuery.isLoading) {
    return <Loading message="Loading periods" armenian="Շրջանները բեռնվում են" />;
  }

  return (
    <div className="space-y-3" data-entity="finance-period" data-count={periods.length}>
      <FilterTabs
        ariaLabel="Filter by period status"
        tabs={PERIOD_FILTER_TABS}
        counts={countBy(periods, (p) => classifyPeriod(p, today))}
        value={filter}
        onChange={(v) => setFilter(v)}
      />

      {filtered.length === 0 ? (
        <EmptyState message="No periods in this view" armenian="Շրջաններ չկան այս տեսքում" />
      ) : (
        <PeriodsList periods={filtered} today={today} />
      )}
    </div>
  );
}

function PeriodsList({
  periods,
  today,
}: {
  periods: ReadonlyArray<FinancePeriod>;
  today: Date;
}) {
  return (
    <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      {periods.map((p) => {
        const tone = PERIOD_TONE[classifyPeriod(p, today)];
        const isLocked = p.status === "closed";
        return (
          <li
            key={p.id}
            className="flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--color-surface-soft)]"
          >
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-muted)]",
                isLocked ? "bg-[var(--color-surface-soft)]" : "bg-[var(--color-brand)]/10 text-[var(--color-brand)]",
              )}
            >
              {isLocked ? <Lock className="size-3.5" /> : <Calendar className="size-3.5" />}
            </span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
                  {periodLabel(p.periodKey)}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    tone.bg,
                    tone.fg,
                  )}
                >
                  {tone.label}
                </span>
              </div>
              <p className="text-[11px] text-[var(--color-muted)]">
                {p.startsOn ?? "—"} → {p.endsOn ?? "—"}
                {p.closedByName ? ` · closed by ${p.closedByName}` : ""}
              </p>
            </div>
            <span className="font-mono text-[11px] text-[var(--color-muted)]">{p.periodKey}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ────────── PaymentsView ────────── */

function PaymentsView({
  filter,
  setFilter,
}: {
  filter: PaymentFilter;
  setFilter: (next: InvoiceFilter | PeriodFilter | PaymentFilter) => void;
}) {
  const paymentsQuery = useQuery({
    queryKey: ["finance-payments"],
    queryFn: () =>
      getJson("/api/finance/payments", FinancePaymentsResponseSchema),
  });

  const payments: ReadonlyArray<FinancePayment> =
    paymentsQuery.data?.payments ?? [];

  if (paymentsQuery.isLoading) {
    return <Loading message="Loading payments" armenian="Վճարումները բեռնվում են" />;
  }

  // The payment filter is a placeholder for now (no enum-style states
  // are surfaced to the user). We render a single "All" tab to keep
  // the layout consistent with the other two views.
  return (
    <div className="space-y-3" data-entity="finance-payment" data-count={payments.length}>
      <FilterTabs
        ariaLabel="Filter payments"
        tabs={PAYMENT_FILTER_TABS}
        counts={{ all: payments.length }}
        value={filter}
        onChange={(v) => setFilter(v)}
      />

      {payments.length === 0 ? (
        <EmptyState message="No payments yet" armenian="Վճարումներ դեռ չկան" />
      ) : (
        <PaymentsList payments={payments} />
      )}
    </div>
  );
}

function PaymentsList({ payments }: { payments: ReadonlyArray<FinancePayment> }) {
  return (
    <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      {payments.map((p) => (
        <li
          key={p.id}
          className="flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--color-surface-soft)]"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-brand)]/10 text-[var(--color-brand)]">
            <Receipt className="size-3.5" />
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
                {p.customerName}
              </span>
              <span className="text-[11px] text-[var(--color-muted)]">
                #{p.invoiceNumber ?? p.invoiceId}
              </span>
            </div>
            <p className="text-[11px] text-[var(--color-muted)]">
              {p.method ?? "—"}
              {p.reference ? ` · ${p.reference}` : ""}
              {p.paidAt ? ` · ${p.paidAt.slice(0, 10)}` : ""}
            </p>
          </div>
          <span className="font-mono text-[var(--text-sm)] text-[var(--color-ink)]">
            {money(p.amount, p.currency ? { compact: false } : undefined)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ────────── ForecastTotals (right rail) ────────── */

function ForecastTotals() {
  const invoicesQuery = useQuery({
    queryKey: ["finance-draft-invoices"],
    queryFn: () =>
      getJson("/api/finance/draft-invoices", FinanceDraftInvoicesResponseSchema),
  });
  const paymentsQuery = useQuery({
    queryKey: ["finance-payments"],
    queryFn: () =>
      getJson("/api/finance/payments", FinancePaymentsResponseSchema),
  });

  const invoices: ReadonlyArray<FinanceDraftInvoice> =
    invoicesQuery.data?.draftInvoices ?? [];
  const payments: ReadonlyArray<FinancePayment> =
    paymentsQuery.data?.payments ?? [];

  const today = new Date();
  const aging = summarizeAging(invoices, today);
  const byCurrency = groupPaymentsByCurrency(payments);
  const overdueInvoices = invoices.filter(
    (i) => classifyInvoice(i, today) === "overdue",
  );
  const overdueTotal = sumInvoiceTotals(overdueInvoices);
  const vatTotal = sumInvoiceVat(invoices);

  return (
    <aside
      className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
      aria-labelledby="finance-forecast-heading"
    >
      <h2 id="finance-forecast-heading" className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        Pipeline
      </h2>
      <dl className="space-y-2 text-[var(--text-xs)]">
        <div className="flex items-center justify-between">
          <dt className="text-[var(--color-muted)]">Receivables (AMD)</dt>
          <dd className="font-mono text-[var(--color-ink)]">
            {money(sumInvoiceTotals(invoices), { compact: true })}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[var(--color-muted)]">VAT (AMD)</dt>
          <dd className="font-mono text-[var(--color-ink)]">
            {money(vatTotal, { compact: true })}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[var(--color-muted)]">Overdue (AMD)</dt>
          <dd className="font-mono text-[var(--color-tag-red)]">
            {money(overdueTotal, { compact: true })}
          </dd>
        </div>
      </dl>

      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Aging
        </h3>
        <ul className="mt-1.5 space-y-1 text-[var(--text-xs)]">
          {(["current", "1-30", "31-60", "61-90", "90+"] as const).map((b) => (
            <li key={b} className="flex items-center justify-between">
              <span className="text-[var(--color-muted)]">{b}</span>
              <span className="font-mono text-[var(--color-ink)]">
                {aging[b].count} · {money(aging[b].total, { compact: true })}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {Object.keys(byCurrency).length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Payments
          </h3>
          <ul className="mt-1.5 space-y-1 text-[var(--text-xs)]">
            {Object.entries(byCurrency).map(([cur, info]) => (
              <li key={cur} className="flex items-center justify-between">
                <span className="text-[var(--color-muted)]">{cur}</span>
                <span className="font-mono text-[var(--color-ink)]">
                  {info.count} · {money(info.total, { compact: true })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {invoices.length > 0 && (
        <p className="text-[11px] text-[var(--color-muted)]">
          {invoices.length} invoices · {numberShort(vatTotal)} VAT · {overdueInvoices.length} overdue
        </p>
      )}
    </aside>
  );
}

/* ────────── shared bits ────────── */

function FilterTabs<T extends string>({
  ariaLabel,
  tabs,
  counts,
  value,
  onChange,
}: {
  ariaLabel: string;
  tabs: { value: T; label: string }[];
  counts: Record<T, number>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <nav aria-label={ariaLabel} className="flex flex-wrap gap-1">
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onChange(t.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] border px-2.5 text-[var(--text-xs)] font-medium transition-colors",
              active
                ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10 text-[var(--color-brand)]"
                : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]",
            )}
          >
            <span>{t.label}</span>
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] font-semibold leading-4",
                active
                  ? "bg-[var(--color-brand)]/15 text-[var(--color-brand)]"
                  : "bg-[var(--color-surface-soft)] text-[var(--color-muted)]",
              )}
            >
              {counts[t.value] ?? 0}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function Loading({ message, armenian }: { message: string; armenian: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
      <Clock className="mx-auto size-4 animate-pulse" />
      <span>
        {message}… <span className="text-[var(--text-xs)]">({armenian})</span>
      </span>
    </div>
  );
}

function EmptyState({ message, armenian }: { message: string; armenian: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-center">
      <ListChecks className="size-5 text-[var(--color-muted)]" />
      <p className="text-[var(--text-sm)] text-[var(--color-ink)]">{message}</p>
      <p className="text-[var(--text-xs)] text-[var(--color-muted)]">{armenian}</p>
    </div>
  );
}

function countBy<T>(items: ReadonlyArray<T>, key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function daysUntilDue(
  invoice: Pick<FinanceDraftInvoice, "dueDate">,
  today: Date,
): number | null {
  if (!invoice.dueDate) return null;
  const due = new Date(invoice.dueDate);
  if (Number.isNaN(due.valueOf())) return null;
  return Math.ceil((due.valueOf() - today.valueOf()) / (1000 * 60 * 60 * 24));
}

function dueCellLabel(
  dueDate: string | null | undefined,
  days: number | null,
): string {
  if (!dueDate) return "—";
  if (days == null) return dueDate.slice(0, 10);
  if (days < 0) return `${Math.abs(days)}d late`;
  if (days === 0) return "today";
  return `in ${days}d`;
}
