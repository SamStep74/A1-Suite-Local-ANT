/**
 * FinanceMasterDataPanel — Phase 10.2c W1 (fi-crud-masterdata).
 *
 * Migrates 5 legacy panels from web/src/finance.jsx into a single modern
 * React surface, presented as 4 internal sub-panels (the "Opening
 * Balances" list + form are one sub-panel — the legacy code has them
 * as two exports but they share state):
 *
 *   1. **Tax Rates**             — table + add-rate form
 *                                 (legacy lines 91–124, 538–610)
 *   2. **Chart of Accounts**     — class rollup + operating-code list
 *                                 (legacy lines 126–169)
 *   3. **Localization Tools**    — 5 most-requested RA tools (HVHH,
 *                                 phone, payroll, VAT, e-invoice)
 *                                 (legacy lines 171–349)
 *   4. **Opening Balances**     — list + add-line form
 *                                 (legacy lines 538–610)
 *
 * Server endpoints (all READ-ONLY or READ+CRUD, all already exist):
 *   - GET  /api/finance/tax-rates
 *   - POST /api/finance/tax-rates  (gated by accountant/owner review)
 *   - GET  /api/finance/chart-of-accounts
 *   - GET  /api/finance/opening-balances
 *   - POST /api/finance/opening-balances
 *   - GET  /api/localization/hvhh?value=
 *   - GET  /api/localization/phone?value=
 *   - POST /api/finance/payroll/compute
 *   - POST /api/finance/vat-return/compute
 *   - POST /api/finance/einvoice/build
 *
 * Tax-rate POST and opening-balance POST are gated on the server side
 * (requireFinanceOperator / requirePilotAccountantReviewWriter). The
 * UI is permissive — it doesn't pre-validate the role.
 *
 * This file is file-isolated: it does NOT modify web-modern/src/routes/
 * app/finance/index.tsx. The orchestrator wires it into the
 * ViewSwitcher in a post-merge step.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Loader2, Plus } from "lucide-react";
import { getJson, postJson, type JsonBody } from "../../../../lib/api/client";
import {
  FinanceChartOfAccountsResponseSchema,
  FinanceTaxRatesResponseSchema,
  type FinanceChartAccount,
  type FinanceTaxRate,
  type FinanceTaxRatesResponse,
  type FinanceChartOfAccountsResponse,
} from "../../../../lib/api/schemas";
import { cn } from "../../../../lib/utils/cn";

/* ────────── local types (intentionally not in schemas.ts — 10.4) ───── */

type OpeningBalanceEntry = {
  code: string;
  name?: string;
  side?: "debit" | "credit";
  amount: number;
  date?: string;
};

type OpeningBalancesResponse = {
  openingEquity?: number;
  entries?: OpeningBalanceEntry[];
};

/* Shape returned by /api/finance/payroll/compute (RA engine). */
type PayrollComputeResponse = {
  incomeTax?: number;
  pension?: number;
  stampDuty?: number;
  healthInsurance?: number;
  net?: number;
  [k: string]: unknown;
};

/* Shape returned by /api/finance/vat-return/compute (RA engine). */
type VatReturnFormLine = {
  base?: number;
  vat?: number;
  payable?: number;
  recoverable?: number;
};
type VatReturnFormResponse = {
  summary?: { payable?: number; [k: string]: unknown };
  form?: Record<string, VatReturnFormLine>;
  formSource?: { orderNumber?: string; sourceUrl?: string; titleHy?: string };
  formLineDefinitions?: Record<string, { labelHy?: string }>;
};

/* Hvhh + phone localization GETs. */
type HvhhResponse = { ok?: boolean; normalized?: string; error?: string };
type PhoneResponse = {
  valid?: boolean;
  e164?: string;
  formatted?: string;
};

/* E-invoice XML response is raw text (server sets content-type xml). */
type EInvoiceBuildResult = { xml: string };

/* ────────── constants ────────── */

type SubTab = "tax-rates" | "chart-of-accounts" | "localization" | "opening-balances";

const SUB_TABS: { value: SubTab; label: string }[] = [
  { value: "tax-rates", label: "Tax rates" },
  { value: "chart-of-accounts", label: "Chart of accounts" },
  { value: "localization", label: "Localization tools" },
  { value: "opening-balances", label: "Opening balances" },
];

/* The 5 most-requested RA localization tools (per the task spec) are
 * implemented as inlined UI rows below: HVHH, phone, payroll, VAT form,
 * and e-invoice. They share state via React.useState in this sub-panel. */

/* Default chart-of-accounts operating-code list — mirrors the legacy
 * `operatingCodes` array in web/src/finance.jsx:160-169. The server
 * returns a superset; we filter to the operating subset. */
const OPERATING_CODES = [
  "221", "226", "251", "252", "521", "524", "525", "611", "711", "714",
];

/* Default opening-balance accounts when the server's chart-of-accounts
 * doesn't supply a per-org opening-balance list. Mirrors the legacy
 * `OPENING_BALANCE_ACCOUNTS` constant in finance.jsx:497-513. */
const FALLBACK_OPENING_ACCOUNTS: ReadonlyArray<{
  code: string;
  name: string;
  side: "debit" | "credit";
}> = [
  { code: "221", name: "Դեբիտորական պարտքեր գնումների գծով", side: "debit" },
  { code: "226", name: "Առևտրական պարտքեր", side: "debit" },
  { code: "251", name: "Արժեթղթերի ձեռքբերման արժեք", side: "debit" },
  { code: "252", name: "Հիմնական միջոցներ", side: "debit" },
  { code: "521", name: "Կրեդիտորական պարտքեր գնումների գծով", side: "credit" },
  { code: "524", name: "Պարտքեր հարկերի և այլ պարտադիր վճարների գծով", side: "credit" },
  { code: "525", name: "Պարտքեր պարտադիր սոցիալական ապահովության գծով", side: "credit" },
];

/* ────────── helpers ────────── */

const fmtPct = (rate: number | null | undefined): string => {
  if (typeof rate !== "number") return "—";
  const isInteger = rate * 100 % 1 === 0;
  return `${(rate * 100).toFixed(isInteger ? 0 : 2)}%`;
};

const fmtAmd = (value: number | null | undefined): string => {
  const n = Number(value || 0);
  return `${n.toLocaleString("hy-AM")} AMD`;
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const numericInput = (raw: string | number): number => {
  const n = typeof raw === "number" ? raw : Math.round(Number(raw) || 0);
  return n;
};

/* ────────── root component ────────── */

export default function FinanceMasterDataPanel() {
  const [tab, setTab] = React.useState<SubTab>("tax-rates");

  return (
    <section
      data-testid="finance-masterdata-panel"
      className="space-y-4"
      aria-label="Finance master data"
    >
      <SubTabs value={tab} onChange={setTab} />

      {tab === "tax-rates" && <TaxRatesSubPanel />}
      {tab === "chart-of-accounts" && <ChartOfAccountsSubPanel />}
      {tab === "localization" && <LocalizationToolsSubPanel />}
      {tab === "opening-balances" && <OpeningBalancesSubPanel />}
    </section>
  );
}

/* ────────── sub-tabs ────────── */

function SubTabs({
  value,
  onChange,
}: {
  value: SubTab;
  onChange: (next: SubTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Finance master data sub-tabs"
      className="flex flex-wrap gap-1 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1"
    >
      {SUB_TABS.map((opt) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-[var(--radius-md)] px-3 py-1.5 text-[var(--text-sm)] font-medium transition",
              isActive
                ? "bg-[var(--color-brand)] text-[var(--color-on-brand)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ────────── sub-panel: Tax Rates ────────── */

function TaxRatesSubPanel() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["finance-tax-rates"],
    queryFn: () => getJson<FinanceTaxRatesResponse>("/api/finance/tax-rates", FinanceTaxRatesResponseSchema),
  });

  const create = useMutation({
    mutationFn: (body: { kind: string; rate: number; effectiveDate: string; note?: string }) =>
      postJson<unknown>("/api/finance/tax-rates", body as JsonBody, undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-tax-rates"] }),
  });

  const rates: ReadonlyArray<FinanceTaxRate> = query.data?.taxRates ?? [];
  const today = todayIso();
  const currentVat = rates
    .filter((r) => r.kind === "vat" && typeof r.effectiveDate === "string" && r.effectiveDate <= today)
    .sort((a, b) => (b.effectiveDate ?? "").localeCompare(a.effectiveDate ?? ""))[0];

  if (query.isLoading) {
    return <LoadingState message="Loading tax rates" />;
  }
  if (query.isError) {
    return <ErrorState error={query.error} />;
  }

  return (
    <PanelFrame title="Tax rates" subtitle="Հարկային դրույքներ">
      <PanelHeader label="HayHashvapah Finance" badge={currentVat ? `VAT ${fmtPct(currentVat.rate)}` : null} />

      {rates.length === 0 ? (
        <EmptyState message="No tax rates set" />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]">
          <table className="w-full text-[var(--text-sm)]">
            <thead>
              <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] text-left text-[var(--text-xs)] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Rate</th>
                <th className="px-3 py-2 font-medium">Effective from</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r, i) => {
                const isCurrent = currentVat && r.kind === currentVat.kind && r.effectiveDate === currentVat.effectiveDate;
                const scheduled = typeof r.effectiveDate === "string" && r.effectiveDate > today;
                return (
                  <tr key={`${r.kind}:${r.effectiveDate ?? ""}:${i}`} className="border-b border-[var(--color-line)] last:border-b-0 hover:bg-[var(--color-surface-soft)]">
                    <td className="px-3 py-2 font-medium text-[var(--color-ink)]">{r.kind === "vat" ? "ԱԱՀ · VAT" : r.kind}</td>
                    <td className="px-3 py-2 font-mono text-[var(--color-ink)]">{fmtPct(r.rate)}</td>
                    <td className="px-3 py-2 text-[var(--color-ink)]">{r.effectiveDate ?? "—"}</td>
                    <td className="px-3 py-2 text-[var(--text-xs)] text-[var(--color-muted)]">
                      {isCurrent ? "current" : scheduled ? "scheduled" : "past"}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">{r.note ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AddTaxRateForm
        busy={create.isPending}
        error={create.isError ? (create.error as Error).message : null}
        onSubmit={(payload) => create.mutate(payload)}
      />
    </PanelFrame>
  );
}

function AddTaxRateForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (payload: { kind: string; rate: number; effectiveDate: string; note?: string }) => void;
}) {
  const [kind, setKind] = React.useState("vat");
  const [ratePct, setRatePct] = React.useState("20");
  const [effectiveDate, setEffectiveDate] = React.useState(todayIso());
  const [note, setNote] = React.useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const rate = numericInput(ratePct) / 100;
    if (rate <= 0) return;
    onSubmit({ kind, rate, effectiveDate, note: note.trim() || undefined });
    setRatePct("");
    setNote("");
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3" data-testid="add-tax-rate-form">
      <Field label="Kind">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="form-input">
          <option value="vat">ԱԱՀ · VAT</option>
          <option value="income">Income tax</option>
          <option value="pension">Pension</option>
          <option value="stamp">Stamp duty</option>
        </select>
      </Field>
      <Field label="Rate (%)">
        <input
          type="number"
          step="0.01"
          min="0"
          value={ratePct}
          onChange={(e) => setRatePct(e.target.value)}
          className="form-input w-24"
          inputMode="decimal"
        />
      </Field>
      <Field label="Effective date">
        <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="form-input" />
      </Field>
      <Field label="Note" className="min-w-[12rem] flex-1">
        <input value={note} onChange={(e) => setNote(e.target.value)} className="form-input w-full" placeholder="optional" />
      </Field>
      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-on-brand)] hover:opacity-90 disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        Add rate
      </button>
      {error && <p className="w-full text-[var(--text-xs)] text-[var(--color-tag-red)]">{error}</p>}
    </form>
  );
}

/* ────────── sub-panel: Chart of Accounts ────────── */

function ChartOfAccountsSubPanel() {
  const query = useQuery({
    queryKey: ["finance-chart-of-accounts"],
    queryFn: () => getJson<FinanceChartOfAccountsResponse>("/api/finance/chart-of-accounts", FinanceChartOfAccountsResponseSchema),
  });

  if (query.isLoading) return <LoadingState message="Loading chart of accounts" />;
  if (query.isError) return <ErrorState error={query.error} />;

  const accounts: ReadonlyArray<FinanceChartAccount> = query.data?.accounts ?? [];
  const classes: ReadonlyArray<{ digit: string; hy: string }> = (query.data as { classes?: ReadonlyArray<{ digit: string; hy: string }> } | undefined)?.classes ?? [];
  const source = (query.data as { source?: { accountCount?: number; publisher?: string; sourceUrl?: string } } | undefined)?.source ?? {};

  const byClass = accounts.reduce<Record<string, number>>((counts, account) => {
    const key = String(account.code || "").slice(0, 1);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const accountCount = source.accountCount ?? accounts.length;
  const publisher = source.publisher || "ՀՀ ֆինանսների նախարարություն";
  const sourceUrl = source.sourceUrl || "official source";

  return (
    <PanelFrame title="RA chart of accounts" subtitle="Հաշվային պլան">
      <PanelHeader label="HayHashvapah Finance" badge={`${accountCount} accounts`} />

      <div className="space-y-1">
        {classes.map((item) => (
          <div key={item.digit} className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[var(--text-sm)]">
            <span className="text-[var(--color-ink)]">{item.digit} · {item.hy}</span>
            <strong className="font-mono text-[var(--color-ink)]">{byClass[String(item.digit)] || 0}</strong>
          </div>
        ))}
        {classes.length === 0 && <EmptyState message="No account classes returned" />}
      </div>

      <div className="flex items-center justify-between text-[var(--text-xs)] text-[var(--color-muted)]">
        <span>{publisher}</span>
        <span>{sourceUrl}</span>
      </div>

      <div className="space-y-1">
        {OPERATING_CODES.map((code) => byCode.get(code))
          .filter((a): a is FinanceChartAccount => Boolean(a))
          .map((account) => (
            <div key={account.code} className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[var(--text-sm)]">
              <span className="text-[var(--color-ink)]">{account.code} · {account.name}</span>
              <strong className="text-[var(--text-xs)] text-[var(--color-muted)]">{account.type ?? ""}</strong>
            </div>
          ))}
      </div>
    </PanelFrame>
  );
}

/* ────────── sub-panel: Localization Tools ────────── */

function LocalizationToolsSubPanel() {
  /* Tool 1: HVHH validator. */
  const [hvhh, setHvhh] = React.useState("00123456");
  const hvhhQuery = useQuery({
    queryKey: ["loc-hvhh", hvhh],
    queryFn: () => getJson<HvhhResponse>(`/api/localization/hvhh?value=${encodeURIComponent(hvhh)}`, undefined),
    enabled: false,
  });

  /* Tool 2: phone formatter. */
  const [phone, setPhone] = React.useState("+374 91 123456");
  const phoneQuery = useQuery({
    queryKey: ["loc-phone", phone],
    queryFn: () => getJson<PhoneResponse>(`/api/localization/phone?value=${encodeURIComponent(phone)}`, undefined),
    enabled: false,
  });

  /* Tool 3: payroll compute. */
  const [gross, setGross] = React.useState("600000");
  const payrollMutation = useMutation({
    mutationFn: (amount: number) => postJson<PayrollComputeResponse>(
      "/api/finance/payroll/compute",
      { gross: amount, monthGross: amount } as JsonBody,
      undefined,
    ),
  });

  /* Tool 4: VAT form summary. */
  const [salesNet, setSalesNet] = React.useState("1000000");
  const [purchaseNet, setPurchaseNet] = React.useState("300000");
  const vatMutation = useMutation({
    mutationFn: (body: { sales: unknown[]; purchases: unknown[] }) =>
      postJson<VatReturnFormResponse>("/api/finance/vat-return/compute", body as unknown as JsonBody, undefined),
  });

  /* Tool 5: e-invoice build. */
  const [invoiceNumber, setInvoiceNumber] = React.useState("A1-LOC-001");
  const [invoiceBuyerHvhh, setInvoiceBuyerHvhh] = React.useState("00987654");
  const [invoiceNet, setInvoiceNet] = React.useState("250000");
  const einvoiceMutation = useMutation({
    mutationFn: (body: unknown) => postJson<EInvoiceBuildResult>(
      "/api/finance/einvoice/build",
      body as JsonBody,
      undefined,
    ),
  });

  return (
    <PanelFrame
      title="RA localization tools"
      subtitle="Հայտնաբերում · Payroll · VAT · E-invoice"
      testId="localization-tools"
    >
      <PanelHeader label="HayHashvapah Finance" badge="local" />

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Field label="ՀՎՀՀ">
          <input value={hvhh} onChange={(e) => setHvhh(e.target.value)} className="form-input w-full" placeholder="ՀՎՀՀ" />
        </Field>
        <Field label="Հեռախոս">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="form-input w-full" placeholder="Հեռախոս" />
        </Field>
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => hvhhQuery.refetch()}
            disabled={hvhhQuery.isFetching}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] disabled:opacity-50"
          >
            {hvhhQuery.isFetching ? "Checking" : "Check ՀՎՀՀ"}
          </button>
          <button
            type="button"
            onClick={() => phoneQuery.refetch()}
            disabled={phoneQuery.isFetching}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] disabled:opacity-50"
          >
            {phoneQuery.isFetching ? "Checking" : "Normalize phone"}
          </button>
        </div>
      </div>

      {(hvhhQuery.data || phoneQuery.data) && (
        <div className="space-y-1">
          {hvhhQuery.data && (
            <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[var(--text-sm)]">
              <span className="text-[var(--color-ink)]">ՀՎՀՀ · {hvhhQuery.data.normalized || "—"}</span>
              <strong className="text-[var(--text-xs)] text-[var(--color-muted)]">{hvhhQuery.data.ok ? "valid" : hvhhQuery.data.error || "invalid"}</strong>
            </div>
          )}
          {phoneQuery.data && (
            <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[var(--text-sm)]">
              <span className="text-[var(--color-ink)]">Phone · {phoneQuery.data.formatted || "—"}</span>
              <strong className="text-[var(--text-xs)] text-[var(--color-muted)]">{phoneQuery.data.valid ? phoneQuery.data.e164 : "invalid"}</strong>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <Field label="Համախառն աշխատավարձ (AMD)">
          <input value={gross} onChange={(e) => setGross(e.target.value)} className="form-input w-full" inputMode="numeric" />
        </Field>
        <Field label="Վաճառք առանց ԱԱՀ">
          <input value={salesNet} onChange={(e) => setSalesNet(e.target.value)} className="form-input w-full" inputMode="numeric" />
        </Field>
        <Field label="Գնում առանց ԱԱՀ">
          <input value={purchaseNet} onChange={(e) => setPurchaseNet(e.target.value)} className="form-input w-full" inputMode="numeric" />
        </Field>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => payrollMutation.mutate(numericInput(gross))}
            disabled={payrollMutation.isPending}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] disabled:opacity-50"
          >
            {payrollMutation.isPending ? "Computing" : "Payroll preview"}
          </button>
          <button
            type="button"
            onClick={() => {
              const sales = numericInput(salesNet) > 0 ? [{ netAmount: numericInput(salesNet), vatRate: 20 }] : [];
              const purchases = numericInput(purchaseNet) > 0 ? [{ netAmount: numericInput(purchaseNet), vatRate: 20, source: "domestic" }] : [];
              vatMutation.mutate({ sales, purchases });
            }}
            disabled={vatMutation.isPending}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] disabled:opacity-50"
          >
            {vatMutation.isPending ? "Computing" : "VAT form preview"}
          </button>
        </div>
      </div>

      {(payrollMutation.data || vatMutation.data) && (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {payrollMutation.data && (
            <>
              <Metric label="income tax" value={fmtAmd(payrollMutation.data.incomeTax)} />
              <Metric label="pension" value={fmtAmd(payrollMutation.data.pension)} />
              <Metric label="stamp duty" value={fmtAmd(payrollMutation.data.stampDuty)} />
              <Metric label="health insurance" value={fmtAmd(payrollMutation.data.healthInsurance)} />
              <Metric label="net salary" value={fmtAmd(payrollMutation.data.net)} />
            </>
          )}
          {vatMutation.data?.summary && <Metric label="VAT payable" value={fmtAmd(vatMutation.data.summary.payable)} />}
        </div>
      )}

      {vatMutation.data?.form && (
        <div className="space-y-1">
          {["7", "16", "18", "21", "23"].map((line) => {
            const item = vatMutation.data!.form![line] || {};
            const def = vatMutation.data!.formLineDefinitions?.[line]?.labelHy || "VAT form line";
            return (
              <div key={line} className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[var(--text-sm)]">
                <span className="text-[var(--color-ink)]">{line} · {def}</span>
                <strong className="font-mono text-[var(--color-ink)]">
                  {line === "23"
                    ? `${fmtAmd(item.payable)} / ${fmtAmd(item.recoverable)}`
                    : line === "21"
                      ? fmtAmd(item.vat)
                      : `${fmtAmd(item.base)} / ${fmtAmd(item.vat)}`}
                </strong>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <Field label="Invoice number">
          <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="form-input w-full" />
        </Field>
        <Field label="Buyer ՀՎՀՀ">
          <input value={invoiceBuyerHvhh} onChange={(e) => setInvoiceBuyerHvhh(e.target.value)} className="form-input w-full" />
        </Field>
        <Field label="Line net (AMD)">
          <input value={invoiceNet} onChange={(e) => setInvoiceNet(e.target.value)} className="form-input w-full" inputMode="numeric" />
        </Field>
        <button
          type="button"
          onClick={() => {
            einvoiceMutation.mutate({
              number: invoiceNumber.trim() || "A1-LOC-001",
              issueDate: todayIso(),
              creationDate: todayIso(),
              transactionType: "1",
              supplier: { name: "Armosphera Demo Clinic", hvhh: "00123456", vatId: "00123456", address: "Yerevan" },
              buyer: { name: "Preview buyer", hvhh: invoiceBuyerHvhh.trim() || "00987654", address: "Yerevan" },
              lines: [{ description: "RA localization services", quantity: 1, netAmount: numericInput(invoiceNet), vatRate: 20 }],
            });
          }}
          disabled={einvoiceMutation.isPending}
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] disabled:opacity-50"
        >
          {einvoiceMutation.isPending ? "Building" : "E-invoice XML"}
        </button>
      </div>

      {einvoiceMutation.data && (
        <div className="space-y-1">
          <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[var(--text-sm)]">
            <span className="text-[var(--color-ink)]">E-invoice XML · {invoiceNumber || "A1-LOC-001"}</span>
            <strong className="font-mono text-[var(--color-ink)]">
              {einvoiceMutation.data.xml.match(/<TotalAmount>([^<]+)<\/TotalAmount>/)?.[1] || ""}
            </strong>
          </div>
          <pre className="max-h-48 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3 text-[var(--text-xs)] text-[var(--color-ink)]">
            {einvoiceMutation.data.xml.split("\n").slice(0, 10).join("\n")}
          </pre>
        </div>
      )}

      {(hvhhQuery.error || phoneQuery.error || payrollMutation.error || vatMutation.error || einvoiceMutation.error) && (
        <p className="text-[var(--text-xs)] text-[var(--color-tag-red)]">
          {(hvhhQuery.error || phoneQuery.error || payrollMutation.error || vatMutation.error || einvoiceMutation.error) instanceof Error
            ? ((hvhhQuery.error || phoneQuery.error || payrollMutation.error || vatMutation.error || einvoiceMutation.error) as Error).message
            : "Localization request failed"}
        </p>
      )}
    </PanelFrame>
  );
}

/* ────────── sub-panel: Opening Balances ────────── */

function OpeningBalancesSubPanel() {
  const qc = useQueryClient();
  const chartQuery = useQuery({
    queryKey: ["finance-chart-of-accounts"],
    queryFn: () => getJson<{ accounts: ReadonlyArray<FinanceChartAccount> }>(
      "/api/finance/chart-of-accounts",
      FinanceChartOfAccountsResponseSchema,
    ),
  });

  const query = useQuery({
    queryKey: ["finance-opening-balances"],
    queryFn: () => getJson<OpeningBalancesResponse>("/api/finance/opening-balances", undefined),
  });

  const post = useMutation({
    mutationFn: (body: { asOf?: string; entries: ReadonlyArray<{ code: string; amount: number; side: "debit" | "credit" }> }) =>
      postJson<unknown>("/api/finance/opening-balances", body as JsonBody, undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-opening-balances"] }),
  });

  if (query.isLoading) return <LoadingState message="Loading opening balances" />;
  if (query.isError) return <ErrorState error={query.error} />;

  const entries: ReadonlyArray<OpeningBalanceEntry> = query.data?.entries ?? [];
  const openingEquity = query.data?.openingEquity ?? 0;

  return (
    <PanelFrame title="Opening balances" subtitle="Բացման մնացորդներ">
      <PanelHeader label="HayHashvapah Finance" badge={openingEquity ? `${fmtAmd(openingEquity)} equity` : null} />

      {entries.length === 0 ? (
        <EmptyState message="No opening balances set" />
      ) : (
        <div className="space-y-1">
          {entries.map((entry) => (
            <div
              key={`${entry.code}-${entry.date ?? ""}`}
              className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[var(--text-sm)]"
            >
              <span className="text-[var(--color-ink)]">
                {entry.code} · {entry.name ?? "—"} · {entry.side === "credit" ? "credit" : "debit"}
              </span>
              <strong className="font-mono text-[var(--color-ink)]">
                {entry.side === "credit" ? `(${fmtAmd(entry.amount)})` : fmtAmd(entry.amount)}
              </strong>
            </div>
          ))}
        </div>
      )}

      <OpeningBalanceForm
        chartAccounts={chartQuery.data?.accounts ?? []}
        busy={post.isPending}
        error={post.isError ? (post.error as Error).message : null}
        onSubmit={(payload) => post.mutate(payload)}
      />
    </PanelFrame>
  );
}

function OpeningBalanceForm({
  chartAccounts,
  busy,
  error,
  onSubmit,
}: {
  chartAccounts: ReadonlyArray<FinanceChartAccount>;
  busy: boolean;
  error: string | null;
  onSubmit: (payload: { asOf?: string; entries: ReadonlyArray<{ code: string; amount: number; side: "debit" | "credit" }> }) => void;
}) {
  /* Build the option list: prefer server's accounts (filter to the operating
   * codes), fall back to the FALLBACK_OPENING_ACCOUNTS list. */
  const options = React.useMemo(() => {
    const byCode = new Map(chartAccounts.map((a) => [a.code, a]));
    const fromChart = OPERATING_CODES
      .map((code) => byCode.get(code))
      .filter((a): a is FinanceChartAccount => Boolean(a))
      .map((a) => ({ code: a.code, name: a.name, side: "debit" as const }));
    if (fromChart.length > 0) return fromChart;
    return FALLBACK_OPENING_ACCOUNTS.map((o) => ({ code: o.code, name: o.name, side: o.side }));
  }, [chartAccounts]);

  const [asOf, setAsOf] = React.useState("");
  const [code, setCode] = React.useState(options[0]?.code ?? "");
  const [amount, setAmount] = React.useState("");
  const [lines, setLines] = React.useState<ReadonlyArray<{ code: string; amount: number; side: "debit" | "credit" }>>([]);

  /* If the option list changes (chart loaded late), sync the selected code. */
  React.useEffect(() => {
    if (code === "" && options[0]) setCode(options[0].code);
  }, [options, code]);

  const nameByCode = React.useMemo(
    () => Object.fromEntries(options.map((o) => [o.code, o.name])),
    [options],
  );
  const sideByCode = React.useMemo(
    () => Object.fromEntries(options.map((o) => [o.code, o.side])),
    [options],
  );

  const addLine = () => {
    const value = numericInput(amount);
    if (value <= 0) return;
    setLines((prev) => {
      const filtered = prev.filter((line) => line.code !== code);
      return [...filtered, { code, amount: value, side: (sideByCode[code] as "debit" | "credit") || "debit" }];
    });
    setAmount("");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (lines.length === 0) return;
    onSubmit({ asOf: asOf || undefined, entries: lines });
    setLines([]);
  };

  return (
    <form onSubmit={submit} className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3" data-testid="opening-balance-form">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Ամսաթիվ">
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="form-input" />
        </Field>
        <Field label="Account">
          <select value={code} onChange={(e) => setCode(e.target.value)} className="form-input">
            {options.map((o) => (
              <option key={o.code} value={o.code}>{o.code} · {o.name} · {o.side === "credit" ? "credit" : "debit"}</option>
            ))}
          </select>
        </Field>
        <Field label="Գումար (AMD)">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} className="form-input w-32" inputMode="numeric" />
        </Field>
        <button
          type="button"
          onClick={addLine}
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
        >
          Add line
        </button>
      </div>

      {lines.length > 0 && (
        <div className="space-y-1">
          {lines.map((line) => (
            <div key={line.code} className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2 text-[var(--text-sm)]">
              <span className="text-[var(--color-ink)]">{line.code} · {nameByCode[line.code] ?? "—"} · {line.side}</span>
              <strong className="font-mono text-[var(--color-ink)]">
                {line.side === "credit" ? `(${fmtAmd(line.amount)})` : fmtAmd(line.amount)}
              </strong>
            </div>
          ))}
        </div>
      )}

      <button
        type="submit"
        disabled={busy || lines.length === 0}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-on-brand)] hover:opacity-90 disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        Post opening balances
      </button>
      {error && <p className="text-[var(--text-xs)] text-[var(--color-tag-red)]">{error}</p>}
    </form>
  );
}

/* ────────── shared presentational helpers ────────── */

function PanelFrame({
  title,
  subtitle,
  testId,
  children,
}: {
  title: string;
  subtitle?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <article
      className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
      data-testid={testId}
    >
      <header>
        <h2 className="text-[var(--text-lg)] font-semibold text-[var(--color-ink)]">{title}</h2>
        {subtitle && <p className="text-[var(--text-xs)] text-[var(--color-muted)]">{subtitle}</p>}
      </header>
      {children}
    </article>
  );
}

function PanelHeader({ label, badge }: { label: string; badge?: string | null }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-line)] pb-2">
      <span className="text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">{label}</span>
      {badge && <strong className="text-[var(--text-xs)] text-[var(--color-muted)]">{badge}</strong>}
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1 text-[var(--text-xs)] text-[var(--color-muted)]", className)}>
      <span className="font-medium uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[var(--text-xs)]">
      <span className="uppercase tracking-wide text-[var(--color-muted)]">{label}</span>
      <strong className="font-mono text-[var(--text-sm)] text-[var(--color-ink)]">{value}</strong>
    </div>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-[var(--text-sm)] text-[var(--color-muted)]" data-testid="loading">
      <Loader2 className="size-3.5 animate-spin" />
      {message}
    </div>
  );
}

function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Failed to load";
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-tag-red)] bg-[var(--color-surface)] p-4 text-[var(--text-sm)] text-[var(--color-tag-red)]" data-testid="error">
      <CircleAlert className="size-3.5" />
      {message}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
      {message}
    </div>
  );
}
