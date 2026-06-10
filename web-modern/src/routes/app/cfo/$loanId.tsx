/**
 * /app/cfo/$loanId — loan amortization detail route.
 *
 * Drills into a single loan from the CFO workspace. Fetches
 * `/api/cfo/loans/:id/schedule` and renders a month-by-month
 * amortization table (period, principal, interest, balance after)
 * with three KPIs at the top.
 *
 * The back-link returns to /app/cfo with the loans view selected
 * (note: the current CFO index exposes cash-flow | treasury |
 * calendar | fx, so we use treasury as the closest "drill back"
 * surface — Phase 4 will add a dedicated loans view).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, CircleSlash, Landmark } from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  CfoLoanScheduleResponseSchema,
  type CfoLoanScheduleResponse,
  type CfoLoanScheduleRow,
} from "../../../lib/api/schemas";
import { cn } from "../../../lib/utils/cn";
import { formatCurrency } from "../../../lib/cfo/status";

/* ────────── typed URL search ────────── */

export const Route = createFileRoute("/app/cfo/$loanId")({
  validateSearch: () => ({}),
  component: LoanDetail,
});

/* ────────── root component ────────── */

function LoanDetail() {
  const { loanId } = Route.useParams();

  const q = useQuery({
    queryKey: ["cfo-loan-schedule", loanId],
    queryFn: async () => {
      const raw = await getJson(`/api/cfo/loans/${encodeURIComponent(loanId)}/schedule`);
      return CfoLoanScheduleResponseSchema.parse(raw) as CfoLoanScheduleResponse;
    },
    enabled: Boolean(loanId),
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
        <PageHeader loanId={loanId} />
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading loan…</p>
      </div>
    );
  }

  if (q.isError || !q.data || q.data.schedule.length === 0) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
        <PageHeader loanId={loanId} />
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          <CircleSlash className="mx-auto mb-2 size-5 opacity-50" />
          {q.isError
            ? "Failed to load loan schedule."
            : "No amortization schedule for this loan."}
        </div>
        <BackLink />
      </div>
    );
  }

  const schedule = q.data.schedule;
  const totals = computeTotals(schedule);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader loanId={loanId} />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Periods" value={String(schedule.length)} hint="Ամսաթվեր" />
        <KpiCard
          label="Total principal"
          value={formatCurrency(totals.principalAmd)}
          hint="Ընդհանուր մարման գումար"
        />
        <KpiCard
          label="Total interest"
          value={formatCurrency(totals.interestAmd)}
          hint="Ընդհանուր տոկոսագումար"
        />
      </section>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="cfo-loan-schedule-row"
        data-count={String(schedule.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Period
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Principal
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Interest
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Balance after
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {schedule.map((row) => (
              <tr key={row.periodKey} className="hover:bg-[var(--color-surface-soft)]">
                <td className="px-3 py-2 font-mono text-[var(--color-ink)]">{row.periodKey}</td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                  {formatCurrency(row.principalDue)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right font-mono",
                    row.interestDue > 0
                      ? "text-[var(--color-tag-orange)]"
                      : "text-[var(--color-muted)]",
                  )}
                >
                  {formatCurrency(row.interestDue)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right font-mono",
                    row.balanceAfter === 0
                      ? "text-[var(--color-tag-green)]"
                      : "text-[var(--color-ink)]",
                  )}
                >
                  {formatCurrency(row.balanceAfter)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <BackLink />
    </div>
  );
}

/* ────────── page header ────────── */

function PageHeader({ loanId }: { loanId: string }) {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <Landmark className="size-3" />
        CFO · Loan
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
        Վարկի մարման գրաֆիկ
      </h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Loan schedule for <span className="font-mono">{loanId}</span>
      </p>
    </header>
  );
}

/* ────────── KPI card ────────── */

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className="mt-1 font-mono text-[var(--text-lg)] text-[var(--color-ink)]">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

/* ────────── back link ────────── */

function BackLink() {
  return (
    <Link
      to="/app/cfo"
      search={{ view: "treasury" }}
      className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
    >
      <ChevronLeft className="size-3.5" />
      Back to CFO
    </Link>
  );
}

/* ────────── pure helpers ────────── */

function computeTotals(schedule: ReadonlyArray<CfoLoanScheduleRow>): {
  principalAmd: number;
  interestAmd: number;
} {
  let principalAmd = 0;
  let interestAmd = 0;
  for (const row of schedule) {
    principalAmd += row.principalDue ?? 0;
    interestAmd += row.interestDue ?? 0;
  }
  return { principalAmd, interestAmd };
}
