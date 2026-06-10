/**
 * /app/people/$employeeId — employee detail with payroll history.
 *
 * Mirrors the finance/$invoiceId pattern (right-rail AI Action Panel
 * + inline metadata). The right rail is intentionally deterministic —
 * Finance's `AgentContext` type doesn't include `people.employee` yet
 * (no agents are registered for it). The PeopleActionPanel instead
 * surfaces inline suggestions: "run payroll", "edit", etc. Phase 2.5+
 * can swap this for a proper AgentActionPanel once a People agent is
 * registered.
 *
 *   - Header: full name, position, department, status pill, hire-date
 *   - Cohort block: gross salary, employment status, hire date
 *   - Contact block: email, tax ID
 *   - Payroll history table: every run sorted newest first
 *   - Right rail: PeopleActionPanel + inline metadata
 *
 * The list endpoint returns all employees; we filter here. A future
 * Phase 2.5 can add a GET /api/people/employees/:id route and switch
 * to it.
 */
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  Building2,
  Calendar,
  ChevronLeft,
  CircleCheck,
  CircleX,
  Clock,
  Mail,
  Play,
  Users,
} from "lucide-react";
import { getJson, postVoid } from "../../../lib/api/client";
import {
  PeoplePayrollRunsResponseSchema,
  type PeopleEmployee,
} from "../../../lib/api/schemas";
import { money } from "../../../lib/utils/money";
import { cn } from "../../../lib/utils/cn";
import {
  classifyEmployment,
  comparePayrollRunsDesc,
  daysSinceRun,
  periodLabel,
  sumPayrollGross,
  sumPayrollNet,
  type EmploymentTone,
} from "../../../lib/people/status";

/* ────────── route definition ────────── */

export const Route = createFileRoute("/app/people/$employeeId")({
  component: EmployeeDetail,
});

/* ────────── tone map ────────── */

const STATUS_TONE: Record<EmploymentTone, { bg: string; fg: string; label: string }> = {
  active: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Active",
  },
  "on-leave": {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
    label: "On leave",
  },
  terminated: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
    label: "Terminated",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "—",
  },
};

/* ────────── root component ────────── */

function EmployeeDetail() {
  const { employeeId } = Route.useParams();
  const qc = useQueryClient();

  const employeesQ = useQuery({
    queryKey: ["people-employees"],
    queryFn: async () => {
      const raw = await getJson("/api/people/employees");
      return (raw as { employees?: PeopleEmployee[] }).employees ?? [];
    },
  });
  const runsQ = useQuery({
    queryKey: ["people-payroll-runs", employeeId],
    queryFn: async () => {
      const raw = await getJson(`/api/people/employees/${employeeId}/payroll-runs`);
      return PeoplePayrollRunsResponseSchema.parse(raw).runs;
    },
  });

  if (employeesQ.isLoading) {
    return (
      <p className="mx-auto max-w-6xl p-6 text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading employee…
      </p>
    );
  }
  if (employeesQ.isError || !employeesQ.data) {
    return notFound();
  }

  const employee = employeesQ.data.find((e) => e.id === employeeId);
  if (!employee) {
    return notFound();
  }

  const today = new Date();
  const tone = STATUS_TONE[classifyEmployment(employee)];
  const runs = (runsQ.data ?? []).slice().sort(comparePayrollRunsDesc);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <Link
        to="/app/people"
        search={{ view: "employees", status: "all" }}
        className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        People
      </Link>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <EmployeeHeader employee={employee} tone={tone} />
          <EmploymentBlock employee={employee} />
          <PayrollHistory
            employee={employee}
            runs={runs}
            loading={runsQ.isLoading}
            onAfterRun={async () => {
              await qc.invalidateQueries({
                queryKey: ["people-payroll-runs", employee.id],
              });
            }}
          />
        </div>

        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <PeopleActionPanel employee={employee} today={today} />
          <EmployeeMetadata employee={employee} />
        </aside>
      </div>
    </div>
  );
}

/* ────────── header ────────── */

function EmployeeHeader({
  employee,
  tone,
}: {
  employee: PeopleEmployee;
  tone: { bg: string; fg: string; label: string };
}) {
  return (
    <header className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            <Users className="size-3" />
            {employee.id.slice(0, 8)}
          </span>
          <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
            {employee.fullName}
          </h1>
          <p className="inline-flex flex-wrap items-center gap-3 text-[var(--text-sm)] text-[var(--color-muted)]">
            {employee.position && (
              <span className="inline-flex items-center gap-1">
                <Briefcase className="size-3" />
                {employee.position}
              </span>
            )}
            {employee.department && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="size-3" />
                {employee.department}
              </span>
            )}
            {employee.hireDate && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="size-3" />
                Hired {employee.hireDate.slice(0, 10)}
              </span>
            )}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
            tone.bg,
            tone.fg,
          )}
        >
          {tone.label === "Active" ? (
            <CircleCheck className="size-3" />
          ) : tone.label === "Terminated" ? (
            <CircleX className="size-3" />
          ) : tone.label === "On leave" ? (
            <Clock className="size-3" />
          ) : null}
          {tone.label}
        </span>
      </div>
    </header>
  );
}

/* ────────── employment block ────────── */

function EmploymentBlock({ employee }: { employee: PeopleEmployee }) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2">
        <h2 className="text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
          Employment
        </h2>
      </header>
      <dl className="grid grid-cols-1 gap-2 px-3 py-2 text-[var(--text-sm)] sm:grid-cols-2">
        <div>
          <dt className="text-[var(--text-xs)] text-[var(--color-muted)]">Gross salary</dt>
          <dd className="font-mono text-[var(--text-md)] text-[var(--color-ink)]">
            {money(employee.grossSalary ?? null)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-xs)] text-[var(--color-muted)]">Hire date</dt>
          <dd className="font-mono text-[var(--color-ink)]">
            {employee.hireDate ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-xs)] text-[var(--color-muted)]">Email</dt>
          <dd className="text-[var(--color-ink)]">
            {employee.email ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-xs)] text-[var(--color-muted)]">Tax ID</dt>
          <dd className="font-mono text-[var(--color-ink)]">
            {employee.taxId ?? "—"}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/* ────────── payroll history ────────── */

function PayrollHistory({
  employee,
  runs,
  loading,
  onAfterRun,
}: {
  employee: PeopleEmployee;
  runs: ReturnType<typeof PeoplePayrollRunsResponseSchema.parse>["runs"];
  loading: boolean;
  onAfterRun: () => Promise<void>;
}) {
  const isTerminated = classifyEmployment(employee) === "terminated";
  const totalNet = sumPayrollNet(runs);
  const totalGross = sumPayrollGross(runs);

  return (
    <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <header className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2">
        <div>
          <h2 className="text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
            Payroll history
          </h2>
          <p className="text-[11px] text-[var(--color-muted)]">
            {runs.length} run{runs.length === 1 ? "" : "s"} · gross {money(totalGross)} · net {money(totalNet)}
          </p>
        </div>
        {!isTerminated && (
          <button
            type="button"
            disabled={loading}
            onClick={async () => {
              await postVoid(`/api/people/employees/${employee.id}/run-payroll`, {});
              await onAfterRun();
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-[var(--text-sm)] font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            <Play className="size-3.5" />
            Run payroll
          </button>
        )}
      </header>

      {loading ? (
        <p className="px-3 py-4 text-[var(--text-sm)] text-[var(--color-muted)]">
          Loading payroll history…
        </p>
      ) : runs.length === 0 ? (
        <p
          className="px-3 py-4 text-[var(--text-sm)] text-[var(--color-muted)]"
          data-entity="people-payroll-run"
          data-count="0"
        >
          No payroll runs yet.
        </p>
      ) : (
        <table
          className="w-full text-[var(--text-sm)]"
          role="table"
          data-entity="people-payroll-run"
          data-count={String(runs.length)}
        >
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Period
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Run date
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Gross
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Deductions
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Net
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {runs.map((run) => {
              const days = daysSinceRun(run);
              return (
                <tr key={run.id} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2 text-[var(--color-ink)]">
                    {periodLabel(run.periodKey)}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {run.runDate?.slice(0, 10) ?? "—"}
                    {days != null && days >= 0 && (
                      <span className="ml-1 text-[10px] text-[var(--color-muted)]">
                        ({days}d ago)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                    {money(run.gross)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-tag-red)]">
                    {money(run.totalDeductions)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-[var(--color-ink)]">
                    {money(run.net)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ────────── right rail: deterministic PeopleActionPanel ────────── */

interface PanelAction {
  id: string;
  title: string;
  reason: string;
  tone: "primary" | "secondary" | "danger";
  /** Optional hint — when present, the action is rendered as a disabled
   *  button with a "Phase 2.5" hint. */
  hint?: string;
}

function deriveActions(
  employee: PeopleEmployee,
  _today: Date,
): PanelAction[] {
  const out: PanelAction[] = [];
  const tone = classifyEmployment(employee);

  if (tone === "active" || tone === "on-leave") {
    out.push({
      id: "run-payroll",
      title: "Run this month's payroll",
      reason: "Post the current month's gross, deductions, and net to the ledger.",
      tone: "primary",
    });
  }
  if (tone === "on-leave") {
    out.push({
      id: "backfill-payroll",
      title: "Backfill missed runs",
      reason: "On-leave employees can still need a pro-rated payroll run during their absence.",
      tone: "secondary",
      hint: "Phase 2.5",
    });
  }
  if (tone === "terminated") {
    out.push({
      id: "final-payroll",
      title: "Issue final settlement",
      reason: "Terminated employees need a one-time final pay + payout of unused leave.",
      tone: "danger",
      hint: "Phase 2.5",
    });
  }
  if (out.length === 0) {
    out.push({
      id: "noop",
      title: "No action needed",
      reason: "This employee is in a steady state.",
      tone: "secondary",
    });
  }
  return out;
}

function PeopleActionPanel({
  employee,
  today,
}: {
  employee: PeopleEmployee;
  today: Date;
}) {
  const actions = deriveActions(employee, today);

  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
      aria-labelledby="people-action-heading"
    >
      <h2 id="people-action-heading" className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        Suggested actions
      </h2>
      <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
        Առաջարկվող գործողություններ
      </p>

      <ul className="mt-3 space-y-2">
        {actions.map((a) => (
          <li
            key={a.id}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--text-xs)] font-semibold text-[var(--color-ink)]">
                {a.title}
              </span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                  a.tone === "primary"
                    ? "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] text-[var(--color-tag-green)]"
                    : a.tone === "danger"
                      ? "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)] text-[var(--color-tag-red)]"
                      : "bg-[var(--color-surface)] text-[var(--color-muted)]",
                )}
              >
                {a.tone === "primary" ? "recommended" : a.tone === "danger" ? "alert" : "info"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-[var(--color-muted)]">{a.reason}</p>
            {a.hint && (
              <p className="mt-1 text-[10px] italic text-[var(--color-muted)]">{a.hint}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ────────── inline metadata ────────── */

function EmployeeMetadata({ employee }: { employee: PeopleEmployee }) {
  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-[var(--text-xs)] text-[var(--color-muted)]"
      aria-labelledby="people-meta-heading"
    >
      <h2 id="people-meta-heading" className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        Metadata
      </h2>
      <dl className="mt-2 space-y-1">
        <div className="flex justify-between">
          <dt>ID</dt>
          <dd className="font-mono text-[var(--color-ink)]">{employee.id}</dd>
        </div>
        {employee.email && (
          <div className="flex justify-between gap-2">
            <dt>Email</dt>
            <dd className="inline-flex items-center gap-1 truncate font-mono text-[var(--color-ink)]">
              <Mail className="size-3" />
              {employee.email}
            </dd>
          </div>
        )}
        {employee.taxId && (
          <div className="flex justify-between">
            <dt>Tax ID</dt>
            <dd className="font-mono text-[var(--color-ink)]">{employee.taxId}</dd>
          </div>
        )}
        {employee.updatedAt && (
          <div className="flex justify-between">
            <dt>Updated</dt>
            <dd className="font-mono text-[var(--color-ink)]">
              {employee.updatedAt.slice(0, 10)}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
