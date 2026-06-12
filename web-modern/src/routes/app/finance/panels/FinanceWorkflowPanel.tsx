/**
 * FinanceWorkflowPanel — migrates 7 legacy finance panels from
 * web/src/finance.jsx (lines 350-498 and 612-678) into a single
 * modern surface with 5 internal tabs.
 *
 * Legacy panels collapsed into this surface:
 *   - FinanceExpenseForm      (line 350)  → Expenses tab form
 *   - FinanceExpenseListPanel (line 612)  → Expenses tab list
 *   - LegalSearchPanel        (line 381)  → Legal Search tab
 *   - FinanceBillForm         (line 430)  → Bills tab form
 *   - FinanceBillListPanel    (line 635)  → Bills tab list (+ Pay button)
 *   - FinancePayrollForm      (line 456)  → Payroll tab form
 *   - FinancePayrollRunsPanel (line 658)  → Payroll tab list
 *   - FinancePayablesPanel    (line 478)  → Payables tab (AP aging)
 *
 * Endpoints consumed (all exist in server/app.js — no new server work):
 *   - GET    /api/finance/expenses
 *   - POST   /api/finance/expenses
 *   - GET    /api/finance/bills
 *   - POST   /api/finance/bills
 *   - POST   /api/finance/bills/:id/pay
 *   - GET    /api/finance/payables
 *   - GET    /api/payroll/runs
 *   - POST   /api/payroll/calculate   (preview)
 *   - POST   /api/payroll/run
 *   - GET    /api/legal/law-search    (used by Legal Search tab)
 *
 * Why local types: the 10.2c plan says do NOT add to schemas.ts (10.4 work).
 * This panel owns the shape locally; orchestrator will not modify the file.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, AlertCircle, Loader2 } from "lucide-react";
import { ApiError, getJson, postJson, type JsonBody } from "../../../../lib/api/client";
import { money } from "../../../../lib/utils/money";
import { cn } from "../../../../lib/utils/cn";
import {
  agingBucket,
  summarizeAging,
  type AgingBucket,
} from "../../../../lib/finance/status";

/* ────────── local types ────────── */

type Expense = {
  id: string;
  description: string;
  vendor: string | null;
  subtotal: number;
  vat: number;
  total: number;
  incurredOn: string;
  periodKey?: string | null;
};

type Bill = {
  id: string;
  supplier: string;
  description?: string | null;
  subtotal: number;
  vat: number;
  total: number;
  billDate: string;
  dueDate?: string | null;
  status: "open" | "partial" | "paid";
  periodKey?: string | null;
};

type PayablesResponse = {
  openBills: Bill[];
  totalBilled: number;
  totalOutstanding: number;
  overdueOutstanding: number;
  aging: {
    current: number;
    days1To30: number;
    days31To60: number;
    days61To90: number;
    over90: number;
  };
};

type PayrollRun = {
  id: string;
  employeeId?: string | null;
  employeeName: string;
  gross: number;
  incomeTax: number;
  pension: number;
  stampDuty: number;
  totalDeductions: number;
  net: number;
  runDate: string;
  periodKey: string;
};

type LegalSearchResult = {
  id: string;
  lawTitle: string;
  article: string;
  text: string;
  score: number;
};

type LegalSearchResponse = {
  ready: boolean;
  query: string;
  results: LegalSearchResult[];
};

type WorkflowTab = "expenses" | "bills" | "payables" | "payroll" | "legal";

const WORKFLOW_TABS: { value: WorkflowTab; label: string; armenian: string }[] = [
  { value: "expenses", label: "Expenses", armenian: "Ծախսեր" },
  { value: "bills", label: "Bills", armenian: "Հաշիվներ" },
  { value: "payables", label: "Payables", armenian: "Պարտքեր" },
  { value: "payroll", label: "Payroll", armenian: "Աշխատավարձ" },
  { value: "legal", label: "Legal search", armenian: "Իրավունք" },
];

const AGING_LABELS: { key: keyof PayablesResponse["aging"]; label: AgingBucket }[] = [
  { key: "current", label: "current" },
  { key: "days1To30", label: "1-30" },
  { key: "days31To60", label: "31-60" },
  { key: "days61To90", label: "61-90" },
  { key: "over90", label: "90+" },
];

/* ────────── root component ────────── */

export default function FinanceWorkflowPanel() {
  const [tab, setTab] = useState<WorkflowTab>("expenses");

  return (
    <section
      data-testid="finance-workflow-panel"
      data-entity="finance-workflow"
      data-tab={tab}
      className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 [data-density=compact]:p-2"
    >
      <div
        role="tablist"
        aria-label="Finance workflow tabs"
        data-testid="finance-workflow-tabs"
        data-entity="finance-workflow-tabs"
        className="flex flex-wrap gap-2"
      >
        {WORKFLOW_TABS.map((t) => {
          const active = tab === t.value;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              data-testid={`finance-workflow-tab-${t.value}`}
              data-entity={`finance-workflow-tab-${t.value}`}
              data-active={active ? "true" : "false"}
              onClick={() => setTab(t.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border px-3 py-1.5 text-sm transition-colors",
                active
                  ? "border-[var(--color-brand)] bg-[color-mix(in_srgb,var(--color-brand)_10%,transparent)] text-[var(--color-ink)]"
                  : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)]",
              )}
            >
              <span className="font-medium">{t.label}</span>
              <span className="text-[var(--text-xs)] opacity-70">{t.armenian}</span>
            </button>
          );
        })}
      </div>

      {tab === "expenses" && <ExpensesTab />}
      {tab === "bills" && <BillsTab />}
      {tab === "payables" && <PayablesTab />}
      {tab === "payroll" && <PayrollTab />}
      {tab === "legal" && <LegalSearchTab />}
    </section>
  );
}

/* ────────── Expenses tab ────────── */

function ExpensesTab() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["finance-expenses"],
    queryFn: () => getJson<{ expenses: Expense[] }>("/api/finance/expenses"),
  });

  const create = useMutation({
    mutationFn: (body: JsonBody) =>
      postJson<{ expense: Expense }>("/api/finance/expenses", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-expenses"] }),
  });

  return (
    <div
      data-testid="finance-expenses-tab"
      data-entity="finance-expenses"
      className="grid gap-4 lg:grid-cols-[1fr_320px]"
    >
      <PanelSection
        title="Expenses · Ծախսեր"
        count={query.data?.expenses.length}
        loading={query.isLoading}
        error={query.error}
      >
        <ExpenseList expenses={query.data?.expenses ?? []} />
      </PanelSection>
      <ExpenseForm
        busy={create.isPending}
        onSubmit={(payload) => create.mutate(payload)}
      />
    </div>
  );
}

function ExpenseList({ expenses }: { expenses: Expense[] }) {
  if (expenses.length === 0) {
    return <EmptyRow>No expenses recorded</EmptyRow>;
  }
  const total = expenses.reduce((sum, e) => sum + (Number(e.total) || 0), 0);
  return (
    <>
      <ul className="divide-y divide-[var(--color-line)]" data-testid="finance-expense-list">
        {expenses.map((item) => (
          <li
            key={item.id}
            data-testid={`finance-expense-row-${item.id}`}
            className="flex items-center justify-between gap-3 p-2 text-sm"
          >
            <span className="truncate text-[var(--color-ink)]">
              <span className="text-[var(--color-muted)]">
                {(item.incurredOn || "").slice(0, 10) || "—"}
              </span>
              {" · "}
              {item.description || "—"}
              {item.vendor ? ` · ${item.vendor}` : ""}
            </span>
            <strong className="font-medium tabular-nums text-[var(--color-ink)]">
              {money(item.total)}
            </strong>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between border-t border-[var(--color-line)] p-2 text-sm font-medium">
        <span className="text-[var(--color-muted)]">Total</span>
        <span className="tabular-nums text-[var(--color-ink)]" data-testid="finance-expense-total">
          {money(total)}
        </span>
      </div>
    </>
  );
}

function ExpenseForm({
  onSubmit,
  busy,
}: {
  onSubmit: (body: { description: string; subtotal: number; vat: number }) => void;
  busy: boolean;
}) {
  const [description, setDescription] = useState("");
  const [subtotal, setSubtotal] = useState("");
  const [vat, setVat] = useState("");

  function handleSubmit() {
    const net = Math.round(Number(subtotal) || 0);
    if (net <= 0) return;
    onSubmit({ description, subtotal: net, vat: Math.round(Number(vat) || 0) });
    setDescription("");
    setSubtotal("");
    setVat("");
  }

  return (
    <PanelSection title="Quick expense" subtitle="HayHashvapah Finance">
      <form
        data-testid="finance-expense-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="flex flex-col gap-2"
      >
        <Field
          label="Նկարագրություն"
          value={description}
          onChange={setDescription}
          placeholder="Description"
        />
        <Field
          label="Զուտ (AMD)"
          value={subtotal}
          onChange={setSubtotal}
          placeholder="Net"
          inputMode="numeric"
        />
        <Field
          label="ԱԱՀ (AMD)"
          value={vat}
          onChange={setVat}
          placeholder="VAT"
          inputMode="numeric"
        />
        <button
          type="submit"
          data-testid="finance-expense-submit"
          disabled={busy}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-sm text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,white)] disabled:opacity-50"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {busy ? "Posting" : "Post expense"}
        </button>
      </form>
    </PanelSection>
  );
}

/* ────────── Bills tab ────────── */

function BillsTab() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["finance-bills"],
    queryFn: () => getJson<{ bills: Bill[] }>("/api/finance/bills"),
  });

  const create = useMutation({
    mutationFn: (body: JsonBody) =>
      postJson<{ bill: Bill }>("/api/finance/bills", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-bills"] }),
  });

  const pay = useMutation({
    mutationFn: (id: string) =>
      postJson<{ bill: Bill }>(`/api/finance/bills/${id}/pay`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-bills"] });
      qc.invalidateQueries({ queryKey: ["finance-payables"] });
    },
  });

  return (
    <div
      data-testid="finance-bills-tab"
      data-entity="finance-bills"
      className="grid gap-4 lg:grid-cols-[1fr_320px]"
    >
      <PanelSection
        title="Supplier bills · Մատակարարների հաշիվներ"
        count={query.data?.bills.length}
        loading={query.isLoading}
        error={query.error}
      >
        <BillList
          bills={query.data?.bills ?? []}
          onPay={(id) => pay.mutate(id)}
          payingId={pay.isPending ? pay.variables : null}
        />
      </PanelSection>
      <BillForm
        busy={create.isPending}
        onSubmit={(payload) => create.mutate(payload)}
      />
    </div>
  );
}

function BillList({
  bills,
  onPay,
  payingId,
}: {
  bills: Bill[];
  onPay: (id: string) => void;
  payingId: string | null;
}) {
  if (bills.length === 0) {
    return <EmptyRow>No supplier bills</EmptyRow>;
  }
  const total = bills.reduce((sum, b) => sum + (Number(b.total) || 0), 0);
  return (
    <>
      <ul className="divide-y divide-[var(--color-line)]" data-testid="finance-bill-list">
        {bills.map((item) => (
          <li
            key={item.id}
            data-testid={`finance-bill-row-${item.id}`}
            className="flex items-center justify-between gap-3 p-2 text-sm"
          >
            <div className="min-w-0 flex-1">
              <span className="truncate text-[var(--color-ink)]">
                <span className="text-[var(--color-muted)]">
                  {(item.billDate || "").slice(0, 10) || "—"}
                </span>
                {" · "}
                {item.supplier || "—"}
                {" · "}
                <StatusPill status={item.status} />
                {item.dueDate ? ` · due ${item.dueDate.slice(0, 10)}` : ""}
              </span>
              <span className="ml-2 text-[var(--text-xs)] text-[var(--color-muted)]">
                {item.dueDate
                  ? `bucket: ${agingBucket({ dueDate: item.dueDate })}`
                  : null}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <strong className="font-medium tabular-nums text-[var(--color-ink)]">
                {money(item.total)}
              </strong>
              {item.status !== "paid" && (
                <button
                  type="button"
                  data-testid={`finance-bill-pay-${item.id}`}
                  disabled={payingId === item.id}
                  onClick={() => onPay(item.id)}
                  className="inline-flex h-7 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] disabled:opacity-50"
                >
                  {payingId === item.id ? "Paying…" : "Pay"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between border-t border-[var(--color-line)] p-2 text-sm font-medium">
        <span className="text-[var(--color-muted)]">Total</span>
        <span className="tabular-nums text-[var(--color-ink)]" data-testid="finance-bill-total">
          {money(total)}
        </span>
      </div>
    </>
  );
}

function StatusPill({ status }: { status: Bill["status"] }) {
  const tone =
    status === "paid"
      ? "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] text-[var(--color-tag-green)]"
      : status === "partial"
      ? "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)] text-[var(--color-tag-orange)]"
      : "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)] text-[var(--color-tag-blue)]";
  return (
    <span
      data-testid={`finance-bill-status-${status}`}
      className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[var(--text-xs)] font-medium", tone)}
    >
      {status}
    </span>
  );
}

function BillForm({
  onSubmit,
  busy,
}: {
  onSubmit: (body: {
    supplier: string;
    subtotal: number;
    vat: number;
    dueDate?: string;
  }) => void;
  busy: boolean;
}) {
  const [supplier, setSupplier] = useState("");
  const [subtotal, setSubtotal] = useState("");
  const [vat, setVat] = useState("");
  const [dueDate, setDueDate] = useState("");

  function handleSubmit() {
    const net = Math.round(Number(subtotal) || 0);
    if (net <= 0) return;
    onSubmit({
      supplier,
      subtotal: net,
      vat: Math.round(Number(vat) || 0),
      dueDate: dueDate || undefined,
    });
    setSupplier("");
    setSubtotal("");
    setVat("");
    setDueDate("");
  }

  return (
    <PanelSection title="New supplier bill" subtitle="HayHashvapah Finance">
      <form
        data-testid="finance-bill-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="flex flex-col gap-2"
      >
        <Field
          label="Մատակարար"
          value={supplier}
          onChange={setSupplier}
          placeholder="Supplier"
        />
        <Field
          label="Զուտ (AMD)"
          value={subtotal}
          onChange={setSubtotal}
          placeholder="Net"
          inputMode="numeric"
        />
        <Field
          label="ԱԱՀ (AMD)"
          value={vat}
          onChange={setVat}
          placeholder="VAT"
          inputMode="numeric"
        />
        <Field
          label="Վճարման ժ. (YYYY-MM-DD)"
          value={dueDate}
          onChange={setDueDate}
          placeholder="Due date"
          type="date"
        />
        <button
          type="submit"
          data-testid="finance-bill-submit"
          disabled={busy}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-sm text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,white)] disabled:opacity-50"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {busy ? "Posting" : "Post bill"}
        </button>
      </form>
    </PanelSection>
  );
}

/* ────────── Payables (AP aging) tab ────────── */

function PayablesTab() {
  const query = useQuery({
    queryKey: ["finance-payables"],
    queryFn: () => getJson<PayablesResponse>("/api/finance/payables"),
  });

  const data = query.data;

  // Reuse the aging helper: we compute a derived bucket count from the
  // openBills list as a sanity check against the server's aggregate
  // (the server pre-aggregates, but `summarizeAging` lets us show a
  // per-bucket count next to the totals without adding a new endpoint).
  const derived = data?.openBills
    ? summarizeAging(
        data.openBills.map((b) => ({ total: b.total, dueDate: b.dueDate })),
      )
    : null;

  return (
    <div
      data-testid="finance-payables-tab"
      data-entity="finance-payables"
      data-count={data?.openBills.length ?? 0}
    >
      <PanelSection
        title="Payables · AP aging"
        subtitle="HayHashvapah Finance"
        count={data?.openBills.length}
        loading={query.isLoading}
        error={query.error}
        rightSlot={
          data ? (
            <span className="inline-flex items-center rounded-full bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)] px-2 py-0.5 text-[var(--text-xs)] font-medium text-[var(--color-tag-blue)]">
              {data.openBills.length} open
            </span>
          ) : null
        }
      >
        {data && (
          <>
            <div
              data-testid="finance-payables-summary"
              className="grid gap-3 p-3 sm:grid-cols-3"
            >
              <Metric label="billed" value={money(data.totalBilled)} />
              <Metric label="outstanding" value={money(data.totalOutstanding)} />
              <Metric label="overdue" value={money(data.overdueOutstanding)} />
            </div>
            <ul
              data-testid="finance-payables-aging"
              className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]"
            >
              {AGING_LABELS.map(({ key, label }) => (
                <li
                  key={key}
                  data-testid={`finance-payables-bucket-${label}`}
                  className="flex items-center justify-between p-2 text-sm"
                >
                  <span className="text-[var(--color-ink)]">
                    {label}
                    {derived && (
                      <span className="ml-2 text-[var(--text-xs)] text-[var(--color-muted)]">
                        ({derived[label].count})
                      </span>
                    )}
                  </span>
                  <strong className="tabular-nums text-[var(--color-ink)]">
                    {money(data.aging[key])}
                  </strong>
                </li>
              ))}
            </ul>
          </>
        )}
      </PanelSection>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div
      data-testid={`finance-payables-metric-${label}`}
      className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3"
    >
      <span className="text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </span>
      <strong className="text-lg font-semibold tabular-nums text-[var(--color-ink)]">
        {value}
      </strong>
    </div>
  );
}

/* ────────── Payroll tab ────────── */

function PayrollTab() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["payroll-runs"],
    queryFn: () => getJson<{ runs: PayrollRun[] }>("/api/payroll/runs"),
  });

  const [preview, setPreview] = useState<{
    gross: number;
    incomeTax: number;
    pension: number;
    stampDuty: number;
    totalDeductions: number;
    net: number;
  } | null>(null);

  const calculate = useMutation({
    mutationFn: (body: JsonBody) =>
      postJson<{
        gross: number;
        incomeTax: number;
        pension: number;
        stampDuty: number;
        totalDeductions: number;
        net: number;
      }>("/api/payroll/calculate", body),
    onSuccess: (data) => setPreview(data),
  });

  const run = useMutation({
    mutationFn: (body: JsonBody) =>
      postJson<{ payrollRun: PayrollRun }>("/api/payroll/run", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll-runs"] });
      setPreview(null);
    },
  });

  return (
    <div
      data-testid="finance-payroll-tab"
      data-entity="finance-payroll"
      className="grid gap-4 lg:grid-cols-[1fr_320px]"
    >
      <PanelSection
        title="Payroll runs · Աշխատավարձի հաշվարկներ"
        count={query.data?.runs.length}
        loading={query.isLoading}
        error={query.error}
      >
        <PayrollRuns runs={query.data?.runs ?? []} />
      </PanelSection>
      <PayrollForm
        busy={calculate.isPending || run.isPending}
        preview={preview}
        onPreview={(body) => calculate.mutate(body)}
        onSubmit={(body) => run.mutate(body)}
      />
    </div>
  );
}

function PayrollRuns({ runs }: { runs: PayrollRun[] }) {
  if (runs.length === 0) {
    return <EmptyRow>No payroll runs</EmptyRow>;
  }
  const totalNet = runs.reduce((sum, r) => sum + (Number(r.net) || 0), 0);
  return (
    <>
      <ul className="divide-y divide-[var(--color-line)]" data-testid="finance-payroll-runs">
        {runs.map((item) => (
          <li
            key={item.id}
            data-testid={`finance-payroll-row-${item.id}`}
            className="flex items-center justify-between gap-3 p-2 text-sm"
          >
            <span className="truncate text-[var(--color-ink)]">
              <span className="text-[var(--color-muted)]">
                {(item.runDate || "").slice(0, 10) || "—"}
              </span>
              {" · "}
              {item.employeeName || "—"}
              {" · gross "}
              {money(item.gross)}
              {" − tax/pension/stamp "}
              {money(item.totalDeductions)}
            </span>
            <strong className="font-medium tabular-nums text-[var(--color-ink)]">
              {money(item.net)}
            </strong>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between border-t border-[var(--color-line)] p-2 text-sm font-medium">
        <span className="text-[var(--color-muted)]">Total net paid</span>
        <span className="tabular-nums text-[var(--color-ink)]" data-testid="finance-payroll-total">
          {money(totalNet)}
        </span>
      </div>
    </>
  );
}

function PayrollForm({
  onSubmit,
  onPreview,
  busy,
  preview,
}: {
  onSubmit: (body: { employeeName: string; gross: number }) => void;
  onPreview: (body: { employeeName: string; gross: number }) => void;
  busy: boolean;
  preview: PayrollRun | null | {
    gross: number;
    incomeTax: number;
    pension: number;
    stampDuty: number;
    totalDeductions: number;
    net: number;
  };
}) {
  const [employeeName, setEmployeeName] = useState("");
  const [gross, setGross] = useState("");

  function handleSubmit() {
    const value = Math.round(Number(gross) || 0);
    if (value <= 0) return;
    onSubmit({ employeeName, gross: value });
    setEmployeeName("");
    setGross("");
  }

  function handlePreview() {
    const value = Math.round(Number(gross) || 0);
    if (value <= 0) return;
    onPreview({ employeeName, gross: value });
  }

  return (
    <PanelSection title="Run payroll" subtitle="HayHashvapah Finance">
      <form
        data-testid="finance-payroll-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="flex flex-col gap-2"
      >
        <Field
          label="Աշխատող"
          value={employeeName}
          onChange={setEmployeeName}
          placeholder="Employee"
        />
        <Field
          label="Համախառն (AMD)"
          value={gross}
          onChange={setGross}
          placeholder="Gross"
          inputMode="numeric"
        />
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="finance-payroll-preview"
            disabled={busy}
            onClick={handlePreview}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] disabled:opacity-50"
          >
            Preview
          </button>
          <button
            type="submit"
            data-testid="finance-payroll-submit"
            disabled={busy}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-sm text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,white)] disabled:opacity-50"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {busy ? "Running" : "Run payroll"}
          </button>
        </div>
        {preview && (
          <div
            data-testid="finance-payroll-preview-card"
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-2 text-[var(--text-xs)]"
          >
            <div className="mb-1 font-medium uppercase tracking-wide text-[var(--color-muted)]">
              Preview
            </div>
            <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[var(--color-ink)]">
              <dt>gross</dt>
              <dd className="text-right tabular-nums">{money(preview.gross)}</dd>
              <dt>income tax</dt>
              <dd className="text-right tabular-nums">{money(preview.incomeTax)}</dd>
              <dt>pension</dt>
              <dd className="text-right tabular-nums">{money(preview.pension)}</dd>
              <dt>stamp duty</dt>
              <dd className="text-right tabular-nums">{money(preview.stampDuty)}</dd>
              <dt className="font-medium">total deductions</dt>
              <dd className="text-right tabular-nums font-medium">
                {money(preview.totalDeductions)}
              </dd>
              <dt className="font-semibold">net</dt>
              <dd className="text-right tabular-nums font-semibold">
                {money(preview.net)}
              </dd>
            </dl>
          </div>
        )}
      </form>
    </PanelSection>
  );
}

/* ────────── Legal search tab ────────── */

function LegalSearchTab() {
  const [query, setQuery] = useState("");
  const search = useMutation({
    mutationFn: (q: string) =>
      getJson<LegalSearchResponse>(
        `/api/legal/law-search?q=${encodeURIComponent(q)}`,
      ),
  });

  return (
    <div
      data-testid="finance-legal-search-tab"
      data-entity="finance-legal-search"
      className="space-y-3"
    >
      <PanelSection
        title="Law search"
        subtitle="Armenian law · RAG"
      >
        <form
          data-testid="finance-legal-search-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) search.mutate(query.trim());
          }}
          className="flex flex-col gap-2"
        >
          <Field
            label="Հարցում (օր. ԱԱՀ դրույքաչափ)"
            value={query}
            onChange={setQuery}
            placeholder="Search query"
          />
          <button
            type="submit"
            data-testid="finance-legal-search-submit"
            disabled={search.isPending || !query.trim()}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-sm text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,white)] disabled:opacity-50"
          >
            {search.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Search className="size-3.5" aria-hidden />
            )}
            {search.isPending ? "Searching" : "Search"}
          </button>
        </form>
        {search.data && (
          <div
            data-testid="finance-legal-search-results"
            data-ready={String(search.data.ready)}
            data-count={search.data.results.length}
            className="mt-2 border-t border-[var(--color-line)]"
          >
            {search.data.results.length === 0 ? (
              <EmptyRow>
                {search.data.ready === false
                  ? "Legal KB not installed"
                  : "No matches"}
              </EmptyRow>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {search.data.results.map((row, idx) => (
                  <li
                    key={`${row.id}-${idx}`}
                    data-testid={`finance-legal-search-row-${idx}`}
                    className="p-2 text-sm"
                  >
                    <div className="font-medium text-[var(--color-ink)]">
                      {row.lawTitle} · {row.article}
                    </div>
                    <p className="mt-0.5 text-[var(--text-xs)] text-[var(--color-muted)]">
                      {String(row.text).replace(/\s+/g, " ").trim().slice(0, 240)}
                    </p>
                    <div className="mt-1 text-[var(--text-xs)] text-[var(--color-muted)]">
                      score {row.score.toFixed(3)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {search.error && (
          <ErrorBox
            error={search.error}
            fallbackMessage="Legal search failed"
          />
        )}
      </PanelSection>
    </div>
  );
}

/* ────────── shared building blocks ────────── */

function PanelSection({
  title,
  subtitle,
  count,
  loading,
  error,
  rightSlot,
  children,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  loading?: boolean;
  error?: unknown;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article
      data-testid={`finance-panel-section`}
      data-loading={loading ? "true" : "false"}
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] p-3">
        <div>
          {subtitle && (
            <span className="text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
              {subtitle}
            </span>
          )}
          <h3 className="text-sm font-semibold text-[var(--color-ink)]">
            {title}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {rightSlot}
          {typeof count === "number" && (
            <span
              data-testid="finance-panel-count"
              className="inline-flex items-center rounded-full bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)] px-2 py-0.5 text-[var(--text-xs)] font-medium text-[var(--color-tag-blue)]"
            >
              {count}
            </span>
          )}
        </div>
      </header>
      <div className="p-3">
        {loading && (
          <div
            data-testid="finance-panel-loading"
            className="flex items-center gap-2 text-sm text-[var(--color-muted)]"
          >
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Loading…
          </div>
        )}
        {error ? <ErrorBox error={error} /> : null}
        {!loading && !error && children}
      </div>
    </article>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  inputMode?: "numeric" | "text";
  type?: "text" | "date";
}) {
  return (
    <label className="flex flex-col gap-1 text-[var(--text-sm)]">
      <span className="text-[var(--text-xs)] font-medium uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="h-8 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-brand)] focus:outline-none"
      />
    </label>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-testid="finance-panel-empty"
      className="rounded-[var(--radius-md)] bg-[var(--color-surface-soft)] p-3 text-sm text-[var(--color-muted)]"
    >
      {children}
    </div>
  );
}

function ErrorBox({
  error,
  fallbackMessage,
}: {
  error: unknown;
  fallbackMessage?: string;
}) {
  const message =
    error instanceof ApiError
      ? `${error.status} ${error.message}`
      : error instanceof Error
      ? error.message
      : fallbackMessage ?? "Request failed";
  return (
    <div
      role="alert"
      data-testid="finance-panel-error"
      className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-ruby)] bg-[color-mix(in_srgb,var(--color-ruby)_8%,transparent)] p-3 text-sm text-[var(--color-ruby)]"
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

