/**
 * /app/cfo — CFO workspace: cash-flow | treasury | budget | calendar |
 * fx | loans.
 *
 * Mirrors finance/ purchase/ people/ docs/ pattern (Pattern A from
 * the plan §3.5). The home route is a ViewSwitcher over six
 * surfaces:
 *
 *   - **Cash flow** — week-by-week inflow/outflow + opening/closing
 *   - **Treasury** — multi-currency cash position
 *   - **Budget** — budgets + variance per account
 *   - **Calendar** — AR/AP/loan payment calendar
 *   - **FX** — currency exposure + hedge suggestion
 *   - **Loans** — active loans + amortization schedules
 *
 * URL state:
 *   ?view=cash-flow | treasury | budget | calendar | fx | loans
 *
 * Data (all require app=cfo access):
 *   - GET  /api/cfo/cash-flow?periodKey=YYYY-MM
 *   - GET  /api/cfo/treasury/positions
 *   - GET  /api/cfo/budgets/:id/variance
 *   - GET  /api/cfo/payment-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   - GET  /api/cfo/fx/exposure
 *   - GET  /api/cfo/loans/:id/schedule
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Banknote,
  Building2,
  ChevronLeft,
  CircleSlash,
  FileText,
  Globe,
  Printer,
} from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  CfoCashFlowResponseSchema,
  CfoFxExposureResponseSchema,
  CfoPaymentCalendarResponseSchema,
  CfoTreasuryResponseSchema,
  ProductionReadinessResponseSchema,
  type CfoCashFlow,
  type CfoFxExposure,
  type CfoPaymentCalendar,
  type CfoTreasuryPosition,
} from "../../../lib/api/schemas";
import { ViewSwitcher } from "../../../components/view-switcher/ViewSwitcher";
import { cn } from "../../../lib/utils/cn";
import {
  calendarTotalsByKind,
  cashFlowClosingDelta,
  cashFlowNetTotal,
  compareCalendarsByDate,
  compareFxByAbsExposureDesc,
  compareTreasuryByBalanceDesc,
  formatCurrency,
  fxHedgeClass,
  fxHedgeSuggestion,
  type FxHedgeClass,
} from "../../../lib/cfo/status";
import { ProductionReadinessPanel } from "../../../lib/compliance/ProductionReadinessPanel";
// canReadProductionReadiness would short-circuit the query for users
// whose role would 403 from the server. Auth isn't wired in 8.10 (see
// Phase 8.4 roadmap), so we always fire the GET; the server is the
// source of truth for the 5-role RBAC. When it 403s, React Query
// marks the query as errored, `complianceQ.data` stays undefined,
// and the panel renders as null — same UX as the legacy null-return.

/* ────────── typed URL search ────────── */

type View = "cash-flow" | "treasury" | "calendar" | "fx";

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "cash-flow", label: "Cash flow" },
  { value: "treasury", label: "Treasury" },
  { value: "calendar", label: "Payment calendar" },
  { value: "fx", label: "FX exposure" },
];

export const Route = createFileRoute("/app/cfo/")({
  validateSearch: (raw) => {
    const v: View =
      raw.view === "treasury" || raw.view === "calendar" || raw.view === "fx"
        ? raw.view
        : "cash-flow";
    return { view: v };
  },
  component: CfoWorkspace,
});

/* ────────── tones ────────── */

const HEDGE_CLASS: Record<FxHedgeClass, { bg: string; fg: string; label: string }> = {
  none: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "OK",
  },
  info: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
    label: "Watch",
  },
  warning: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
    label: "Hedge",
  },
};

/* ────────── root component ────────── */

function CfoWorkspace() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view: View = search.view;
  const setView = (next: View) => navigate({ search: { view: next }, replace: true });

  const cashFlowQ = useQuery({
    queryKey: ["cfo-cash-flow", "2026-06"],
    queryFn: async () => {
      const raw = await getJson("/api/cfo/cash-flow?periodKey=2026-06");
      return CfoCashFlowResponseSchema.parse(raw);
    },
  });
  const treasuryQ = useQuery({
    queryKey: ["cfo-treasury"],
    queryFn: async () => {
      const raw = await getJson("/api/cfo/treasury/positions");
      return CfoTreasuryResponseSchema.parse(raw);
    },
  });
  const calendarQ = useQuery({
    queryKey: ["cfo-calendar", "2026-06-01", "2026-06-30"],
    queryFn: async () => {
      const raw = await getJson("/api/cfo/payment-calendar?from=2026-06-01&to=2026-06-30");
      return CfoPaymentCalendarResponseSchema.parse(raw);
    },
  });
  const fxQ = useQuery({
    queryKey: ["cfo-fx"],
    queryFn: async () => {
      const raw = await getJson("/api/cfo/fx/exposure");
      return CfoFxExposureResponseSchema.parse(raw);
    },
  });
  // Compliance co-panel: production-readiness roll-up. The 5-role
  // RBAC gate on the server (server/app.js#requireProductionReadinessReader)
  // mirrors canReadProductionReadiness(). We always fire the GET;
  // a non-allowlisted user will see the panel render as null and
  // the server's 403 will be swallowed by React Query (the panel
  // is best-effort UX, not a gate).
  const complianceQ = useQuery({
    queryKey: ["cfo-compliance-production-readiness"],
    queryFn: async () => {
      const raw = await getJson("/api/compliance/production-readiness");
      return ProductionReadinessResponseSchema.parse(raw);
    },
    retry: false,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader />

      <div data-testid="cfo-toolbar" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ViewSwitcher options={VIEW_OPTIONS} value={view} onChange={setView} />
        <div className="flex items-center gap-3">
          <Link
            to="/app/cfo/reports"
            search={{ period: "2026-06", statement: "p-and-l" }}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-line)]"
          >
            <Printer className="size-3.5" />
            Reports
          </Link>
          <Link
            to="/app/cfo/state-integrations"
            data-testid="cfo-toolbar-state-integrations"
            data-entity="cfo-toolbar-state-integrations"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-line)]"
          >
            <Building2 className="size-3.5" />
            Կառավարության ինտեգրացիաներ
          </Link>
          <Link
            to="/app/cfo/export-docs"
            data-testid="cfo-toolbar-export-docs"
            data-entity="cfo-toolbar-export-docs"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-line)]"
          >
            <FileText className="size-3.5" />
            Արտահանման փաստաթղթեր
          </Link>
          <Link
            to="/app"
            className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            <ChevronLeft className="size-3.5" />
            Today
          </Link>
        </div>
      </div>

      {/*
        Compliance co-panel — production-readiness roll-up. Visible
        across all CFO sub-views (cash-flow / treasury / calendar /
        fx) so a blocker doesn't get hidden behind a tab. The server
        enforces the 5-role RBAC allowlist; if the current user's
        role is outside it, the GET 403s, the query stays data-less,
        and the panel renders as null (the legacy behavior).
      */}
      <ProductionReadinessPanel data={complianceQ.data?.readiness ?? null} />

      {view === "cash-flow" && (
        <CashFlowView data={cashFlowQ.data} loading={cashFlowQ.isLoading} error={cashFlowQ.isError} />
      )}
      {view === "treasury" && (
        <TreasuryView
          data={treasuryQ.data}
          loading={treasuryQ.isLoading}
          error={treasuryQ.isError}
        />
      )}
      {view === "calendar" && (
        <CalendarView
          data={calendarQ.data}
          loading={calendarQ.isLoading}
          error={calendarQ.isError}
        />
      )}
      {view === "fx" && (
        <FxView data={fxQ.data} loading={fxQ.isLoading} error={fxQ.isError} />
      )}
    </div>
  );
}

/* ────────── page header ────────── */

function PageHeader() {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <Banknote className="size-3" />
        CFO
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">CFO</h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Կանխիկի հոսք · Գանձապետարան · Բյուջե · Վճարային օրացույց
      </p>
    </header>
  );
}

/* ────────── KPI block ────────── */

function KpiCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? "text-[var(--color-tag-green)]"
      : tone === "negative"
        ? "text-[var(--color-tag-red)]"
        : "text-[var(--color-ink)]";
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className={cn("mt-1 font-mono text-[var(--text-lg)]", toneClass)}>{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

/* ────────── Cash flow view ────────── */

function CashFlowView({
  data,
  loading,
  error,
}: {
  data: { cashFlow: CfoCashFlow } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading cash flow…</p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load cash flow.
      </p>
    );
  }

  const cf = data?.cashFlow;
  if (!cf) {
    return <EmptyState message="No cash flow data for this period." />;
  }

  const net = cashFlowNetTotal(cf);
  const closingDelta = cashFlowClosingDelta(cf);
  const weeks = cf.weekly ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Opening (AMD)"
          value={formatCurrency(cf.openingAmd)}
          hint="Բացման մնացորդ"
        />
        <KpiCard
          label="Net this period"
          value={formatCurrency(net)}
          tone={net >= 0 ? "positive" : "negative"}
          hint="Զուտ փոփոխություն"
        />
        <KpiCard
          label="Closing (AMD)"
          value={formatCurrency(cf.closingAmd)}
          hint="Փակման մնացորդ"
        />
        <KpiCard
          label="Closing delta"
          value={formatCurrency(closingDelta)}
          tone={closingDelta >= 0 ? "positive" : "negative"}
          hint="Փակում − Բացում"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="cfo-cash-flow-week"
        data-count={String(weeks.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Week
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Inflow
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Outflow
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Net
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Closing
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {weeks.map((w) => (
              <tr key={w.weekKey} className="hover:bg-[var(--color-surface-soft)]">
                <td className="px-3 py-2 font-mono text-[var(--color-ink)]">{w.weekKey}</td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-tag-green)]">
                  {formatCurrency(w.inflow)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-tag-red)]">
                  {formatCurrency(w.outflow)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right font-mono",
                    w.net >= 0 ? "text-[var(--color-tag-green)]" : "text-[var(--color-tag-red)]",
                  )}
                >
                  {formatCurrency(w.net)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                  {formatCurrency(w.closing)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ────────── Treasury view ────────── */

function TreasuryView({
  data,
  loading,
  error,
}: {
  data: { treasury: CfoTreasuryPosition[] } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading treasury…</p>;
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load treasury.
      </p>
    );
  }

  const positions = (data?.treasury ?? []).slice().sort(compareTreasuryByBalanceDesc);
  const totalAccounts = positions.reduce((s, p) => s + p.accountCount, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Currencies" value={String(positions.length)} hint="Արժույթներ" />
        <KpiCard label="Accounts" value={String(totalAccounts)} hint="Հաշիվներ" />
        <KpiCard
          label="Top currency"
          value={positions[0]?.currency ?? "—"}
          hint={positions[0] ? formatCurrency(positions[0].balance) : undefined}
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="cfo-treasury-position"
        data-count={String(positions.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Currency
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Balance
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Accounts
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {positions.map((p) => (
              <tr key={p.currency} className="hover:bg-[var(--color-surface-soft)]">
                <td className="px-3 py-2 font-mono text-[var(--color-ink)]">
                  {p.currency}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right font-mono",
                    p.balance >= 0 ? "text-[var(--color-ink)]" : "text-[var(--color-tag-red)]",
                  )}
                >
                  {formatCurrency(p.balance, p.currency)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-muted)]">
                  {p.accountCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ────────── Calendar view ────────── */

function CalendarView({
  data,
  loading,
  error,
}: {
  data: { calendar: CfoPaymentCalendar } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading calendar…</p>;
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load payment calendar.
      </p>
    );
  }

  const cal = data?.calendar;
  const entries = (cal?.entries ?? []).slice().sort(compareCalendarsByDate);
  const totals = calendarTotalsByKind({ entries });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="AR expected"
          value={formatCurrency(totals.arAmd)}
          hint="Հաճախորդներից սպասվող"
          tone="positive"
        />
        <KpiCard
          label="AP due"
          value={formatCurrency(totals.apAmd)}
          hint="Մատակարարներին վճարման"
          tone="negative"
        />
        <KpiCard
          label="Loan service"
          value={formatCurrency(totals.loanAmd)}
          hint="Վարկային սպասարկում"
          tone="negative"
        />
        <KpiCard
          label="Net"
          value={formatCurrency(totals.arAmd - totals.apAmd - totals.loanAmd)}
          hint="Զուտ դիրք"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="cfo-payment-calendar-entry"
        data-count={String(entries.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Date
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Kind
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Source
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {entries.map((e, i) => (
              <tr key={`${e.date}-${i}`} className="hover:bg-[var(--color-surface-soft)]">
                <td className="px-3 py-2 font-mono text-[var(--color-ink)]">{e.date}</td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                      e.kind === "ar"
                        ? "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] text-[var(--color-tag-green)]"
                        : e.kind === "ap"
                          ? "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)] text-[var(--color-tag-red)]"
                          : "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)] text-[var(--color-tag-orange)]",
                    )}
                  >
                    {e.kind.toUpperCase()}
                  </span>
                </td>
                <td className="px-3 py-2 text-[var(--color-muted)]">{e.source ?? "—"}</td>
                <td
                  className={cn(
                    "px-3 py-2 text-right font-mono",
                    e.kind === "ar"
                      ? "text-[var(--color-tag-green)]"
                      : "text-[var(--color-ink)]",
                  )}
                >
                  {formatCurrency(e.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ────────── FX view ────────── */

function FxView({
  data,
  loading,
  error,
}: {
  data: { exposure: CfoFxExposure } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading FX…</p>;
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load FX exposure.
      </p>
    );
  }

  const exposure = data?.exposure;
  const rows = (exposure?.byCurrency ?? []).slice().sort(compareFxByAbsExposureDesc);
  const suggestion = fxHedgeSuggestion({ hedgeSuggestion: exposure?.hedgeSuggestion ?? null });

  return (
    <div className="space-y-4">
      {suggestion && (
        <div
          className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-tag-orange)_40%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-tag-orange)_8%,var(--color-surface))] p-3"
          role="note"
        >
          <p className="inline-flex items-center gap-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
            <Globe className="size-3.5" />
            Հեջավորման առաջարկ
          </p>
          <p className="mt-1 text-[var(--text-sm)] text-[var(--color-ink)]">{suggestion}</p>
        </div>
      )}

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="cfo-fx-exposure-row"
        data-count={String(rows.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Currency
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Net (foreign)
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Net (AMD)
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Hedge
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {rows.map((r) => {
              const hedge = HEDGE_CLASS[fxHedgeClass(r)];
              return (
                <tr key={r.currency} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2 font-mono text-[var(--color-ink)]">
                    {r.currency}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-muted)]">
                    {formatCurrency(r.net, r.currency)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-mono",
                      r.netAmd >= 0
                        ? "text-[var(--color-tag-green)]"
                        : "text-[var(--color-tag-red)]",
                    )}
                  >
                    {formatCurrency(r.netAmd)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                        hedge.bg,
                        hedge.fg,
                      )}
                    >
                      {hedge.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ────────── empty state ────────── */

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
      <CircleSlash className="mx-auto mb-2 size-5 opacity-50" />
      {message}
    </div>
  );
}
