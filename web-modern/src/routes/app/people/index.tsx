/**
 * /app/people — People workspace: employees | payroll-runs.
 *
 * Mirrors the finance/ inventory/ pattern (Pattern A from the plan
 * §3.4). The home route is a ViewSwitcher over two surfaces:
 *
 *   - **Employees** — the registry of every employee in the org.
 *     Each row shows name · position · department · employment-status
 *     pill · gross salary. Click a row → /app/people/$employeeId
 *     (the per-employee detail with their payroll-run history).
 *   - **Payroll runs** — every payroll run the current user is
 *     allowed to see, newest first. Read-only for now (running a
 *     payroll lives on the employee detail page).
 *
 * URL state:
 *   ?view=employees | runs
 *   ?status=…   (per-view filter — see STATUS_TABS)
 *
 * Data:
 *   - /api/people/employees
 *
 * The same Fastify proxy as the rest of the workspace.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  CircleCheck,
  CircleX,
  Clock,
  Users,
  Wallet,
} from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  PeopleEmployeesResponseSchema,
  type PeopleEmployee,
} from "../../../lib/api/schemas";
import { ViewSwitcher } from "../../../components/view-switcher/ViewSwitcher";
import { money } from "../../../lib/utils/money";
import { cn } from "../../../lib/utils/cn";
import {
  classifyEmployment,
  compareEmployeesByStatusThenName,
  countByEmployment,
  sumGrossSalary,
  type EmploymentTone,
} from "../../../lib/people/status";

/* ────────── typed URL search ────────── */

type View = "employees" | "runs";
type Status = "all" | EmploymentTone;

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "employees", label: "Employees" },
  { value: "runs", label: "Payroll runs" },
];

const STATUS_TABS = ["all", "active", "on-leave", "terminated"] as const;

export const Route = createFileRoute("/app/people/")({
  validateSearch: (raw) => {
    const v: View = raw.view === "runs" ? "runs" : "employees";
    const s: Status =
      typeof raw.status === "string" && (STATUS_TABS as readonly string[]).includes(raw.status)
        ? (raw.status as Status)
        : "all";
    return { view: v, status: s };
  },
  component: PeopleWorkspace,
});

/* ────────── constants ────────── */

const EMPLOYMENT_TONE: Record<EmploymentTone, { bg: string; fg: string; label: string }> = {
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

function PeopleWorkspace() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const view = search.view;
  const status = search.status;

  const setView = (next: View) =>
    navigate({ search: { view: next, status: "all" }, replace: true });
  const setStatus = (next: Status) =>
    navigate({ search: { view, status: next }, replace: true });

  const q = useQuery({
    queryKey: ["people-employees"],
    queryFn: async () => {
      const raw = await getJson("/api/people/employees");
      return PeopleEmployeesResponseSchema.parse(raw);
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ViewSwitcher options={VIEW_OPTIONS} value={view} onChange={setView} />
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          Today
        </Link>
      </div>

      {view === "employees" && (
        <EmployeesView
          data={q.data}
          loading={q.isLoading}
          error={q.isError}
          status={status}
          onStatusChange={setStatus}
        />
      )}
      {view === "runs" && <RunsView />}
    </div>
  );
}

/* ────────── page header ────────── */

function PageHeader() {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <Users className="size-3" />
        People
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
        People
      </h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Աշխատակազմ · Աշխատավարձ
      </p>
    </header>
  );
}

/* ────────── Employees view ────────── */

function EmployeesView({
  data,
  loading,
  error,
  status,
  onStatusChange,
}: {
  data: { employees: PeopleEmployee[] } | undefined;
  loading: boolean;
  error: boolean;
  status: Status;
  onStatusChange: (s: Status) => void;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading employees…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load employees.
      </p>
    );
  }

  const employees = data?.employees ?? [];
  const counts = countByEmployment(employees);
  const filtered =
    status === "all" ? employees : employees.filter((e) => classifyEmployment(e) === status);
  const sorted = [...filtered].sort(compareEmployeesByStatusThenName);
  const totalGross = sumGrossSalary(employees);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <StatusFilterTabs status={status} onChange={onStatusChange} counts={counts} />

        {sorted.length === 0 ? (
          <EmptyState message="No employees match this filter." />
        ) : (
          <div
            className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
            data-entity="people-employee"
            data-count={String(sorted.length)}
          >
            <table className="w-full text-[var(--text-sm)]" role="table">
              <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Name
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Position
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Department
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Gross
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {sorted.map((e) => (
                  <EmployeeRow key={e.id} employee={e} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PeopleForecast
        totalEmployees={employees.length}
        counts={counts}
        totalGross={totalGross}
      />
    </div>
  );
}

function EmployeeRow({ employee }: { employee: PeopleEmployee }) {
  const tone = EMPLOYMENT_TONE[classifyEmployment(employee)];
  return (
    <tr className="hover:bg-[var(--color-surface-soft)]">
      <td className="px-3 py-2">
        <Link
          to="/app/people/$employeeId"
          params={{ employeeId: employee.id }}
          className="font-medium text-[var(--color-ink)] hover:underline"
        >
          {employee.fullName}
        </Link>
        {employee.email && (
          <p className="text-[11px] text-[var(--color-muted)]">{employee.email}</p>
        )}
      </td>
      <td className="px-3 py-2 text-[var(--color-ink)]">
        {employee.position ?? "—"}
      </td>
      <td className="px-3 py-2 text-[var(--color-muted)]">
        {employee.department ?? "—"}
      </td>
      <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
        {money(employee.grossSalary ?? null)}
      </td>
      <td className="px-3 py-2">
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
      </td>
    </tr>
  );
}

function StatusFilterTabs({
  status,
  onChange,
  counts,
}: {
  status: Status;
  onChange: (s: Status) => void;
  counts: Record<EmploymentTone, number>;
}) {
  const items: { value: Status; label: string; count: number }[] = [
    { value: "all", label: "All", count: counts.active + counts["on-leave"] + counts.terminated + counts.unknown },
    { value: "active", label: "Active", count: counts.active },
    { value: "on-leave", label: "On leave", count: counts["on-leave"] },
    { value: "terminated", label: "Terminated", count: counts.terminated },
  ];
  return (
    <nav
      aria-label="Filter by status"
      className="flex flex-wrap items-center gap-1 border-b border-[var(--color-line)]"
    >
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          onClick={() => onChange(it.value)}
          aria-current={status === it.value ? "page" : undefined}
          className={cn(
            "rounded-t-[var(--radius-sm)] px-3 py-2 text-[var(--text-sm)] font-medium",
            status === it.value
              ? "border-b-2 border-[var(--color-brand)] text-[var(--color-ink)]"
              : "text-[var(--color-muted)] hover:text-[var(--color-ink)]",
          )}
        >
          {it.label} <span className="text-[11px] opacity-60">({it.count})</span>
        </button>
      ))}
    </nav>
  );
}

/* ────────── Payroll runs view ────────── */

function RunsView() {
  // The full payroll-runs list endpoint lives at /api/payroll/runs (server/app.js:5927).
  // We don't surface that here yet — the Phase 3 surface is the per-employee
  // payroll history (the RunsView is a placeholder that points to employees).
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-[var(--text-sm)] text-[var(--color-muted)]">
      <p>
        Pick an employee to view their payroll runs. The full org-wide payroll
        run ledger lives on each employee&apos;s detail page.
      </p>
      <p className="mt-2">
        <Link to="/app/people" search={{ view: "employees", status: "all" }} className="text-[var(--color-brand)] hover:underline">
          ← Back to employees
        </Link>
      </p>
    </div>
  );
}

/* ────────── right rail: cohort forecast ────────── */

function PeopleForecast({
  totalEmployees,
  counts,
  totalGross,
}: {
  totalEmployees: number;
  counts: Record<EmploymentTone, number>;
  totalGross: number;
}) {
  return (
    <aside
      className="space-y-3 lg:sticky lg:top-4 lg:self-start"
      aria-label="People overview"
    >
      <section className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
        <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          Workforce
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
          Աշխատակազմ
        </p>
        <dl className="mt-3 space-y-2 text-[var(--text-sm)]">
          <div className="flex items-center justify-between">
            <dt className="text-[var(--color-muted)]">Total</dt>
            <dd className="font-mono text-[var(--color-ink)]">{totalEmployees}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="inline-flex items-center gap-1 text-[var(--color-tag-green)]">
              <CircleCheck className="size-3" /> Active
            </dt>
            <dd className="font-mono text-[var(--color-ink)]">{counts.active}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="inline-flex items-center gap-1 text-[var(--color-tag-orange)]">
              <Clock className="size-3" /> On leave
            </dt>
            <dd className="font-mono text-[var(--color-ink)]">{counts["on-leave"]}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="inline-flex items-center gap-1 text-[var(--color-tag-red)]">
              <CircleX className="size-3" /> Terminated
            </dt>
            <dd className="font-mono text-[var(--color-ink)]">{counts.terminated}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
        <h2 className="inline-flex items-center gap-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          <Wallet className="size-3.5" /> Monthly payroll
        </h2>
        <p className="mt-1 text-[11px] text-[var(--color-muted)]">
          Sum of active employee gross salaries
        </p>
        <p className="mt-2 font-mono text-[var(--text-lg)] font-semibold text-[var(--color-ink)]">
          {money(totalGross)}
        </p>
      </section>
    </aside>
  );
}

/* ────────── empty state ────────── */

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
      {message}
    </div>
  );
}
