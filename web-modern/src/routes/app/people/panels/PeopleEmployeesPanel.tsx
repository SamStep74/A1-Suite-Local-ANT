/**
 * PeopleEmployeesPanel — Phase 10.2b W0 (hr-people).
 *
 * Migrates 2 legacy panels from `web/src/people.jsx` into a single modern
 * React surface, presented as 2 internal sub-views (tabbed) inside the
 * `PeopleEmployeesPanel` shell:
 *
 *   1. **Employees (registry)** — `web/src/people.jsx:94–151`
 *      (`PeopleRegistryPanel`).
 *      List of employees with: name, position, department, employment
 *      status pill, gross salary. Each row has 3 actions:
 *        - Edit     → toggles an inline editor for status / salary / position
 *        - Run payroll → disabled for terminated employees
 *        - Payroll history → loads the list of payroll runs for that
 *          employee (GET /api/people/employees/:id/payroll-runs)
 *
 *   2. **New employee** — `web/src/people.jsx:5–43` (`PeopleEmployeeForm`).
 *      Form with fields: fullName, taxId (8-digit HVHH validation),
 *      position, department, grossSalary (AMD), hireDate, email.
 *      Submit posts to `POST /api/people/employees`. On success the form
 *      clears and the employees list refetches.
 *
 * The two sub-views live as internal tabs of a single default-exported
 * component. The file is file-isolated: it does NOT modify
 * `web-modern/src/routes/app/people/index.tsx`. The orchestrator wires
 * the panel into the ViewSwitcher in a post-merge step.
 *
 * RBAC: a top-level `useUserAccess("people")` gate hides the panel
 * behind a "No access" message when the user is not allowed to see
 * the People workspace.
 *
 * Server endpoints (all READ-ONLY or READ+CRUD, all already exist):
 *   - GET    /api/people/employees
 *   - POST   /api/people/employees
 *   - PATCH  /api/people/employees/:id
 *   - POST   /api/people/employees/:id/run-payroll
 *   - GET    /api/people/employees/:id/payroll-runs
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  CircleCheck,
  Clock,
  History,
  Loader2,
  Pencil,
  Play,
  Plus,
  Users,
} from "lucide-react";
import {
  getJson,
  patchJson,
  postJson,
  postVoid,
  type JsonBody,
} from "../../../../lib/api/client";
import {
  PeopleEmployeesResponseSchema,
  PeoplePayrollRunsResponseSchema,
  type PeopleEmployee,
  type PeoplePayrollRun,
  type PeoplePayrollRunsResponse,
} from "../../../../lib/api/schemas";
import { useUserAccess } from "../../../../lib/rbac/access";
import { cn } from "../../../../lib/utils/cn";
import {
  classifyEmployment,
  compareEmployeesByStatusThenName,
  countByEmployment,
  isValidTaxId,
  sumGrossSalary,
  type EmploymentTone,
} from "../../../../lib/people/status";

/* ────────── local types (intentionally not in schemas.ts — 10.4) ───── */

/* Shape of the create-employee payload. Matches the server's
 * /api/people/employees POST body. */
type CreateEmployeeInput = {
  fullName: string;
  taxId: string;
  position: string;
  department: string;
  grossSalary: number;
  hireDate: string;
  email: string;
};

/* Shape of the inline editor's PATCH body. */
type UpdateEmployeeInput = {
  employmentStatus: string;
  grossSalary: number;
  position: string;
};

/* Response shape of the create / update endpoints. The server returns
 * the persisted employee, but we don't model its full envelope — we
 * only refetch the list on success. */
type EmployeeMutationResponse = { employee?: PeopleEmployee; [k: string]: unknown };

/* ────────── constants ────────── */

type SubTab = "registry" | "new";

const SUB_TABS: { value: SubTab; label: string }[] = [
  { value: "registry", label: "Employees" },
  { value: "new", label: "New employee" },
];

const EMPLOYMENT_STATUSES = ["active", "on-leave", "terminated"] as const;

/* Armenian-locale AMD formatter. Mirrors the legacy `amd` helper at
 * `web/src/people.jsx:3`. Integer AMD (no fractional tetri). */
const amd = (value: number | null | undefined): string => {
  const n = Number(value || 0);
  return `${n.toLocaleString("hy-AM")} AMD`;
};

/* Numeric input parser: rounds to int and clamps to ≥ 0. Mirrors the
 * legacy form's `Math.max(0, Math.round(Number(grossSalary) || 0))`. */
const numericInput = (raw: string | number): number => {
  const n = typeof raw === "number" ? raw : Math.round(Number(raw) || 0);
  return Math.max(0, n);
};

/* Tone map for the employment-status pill. 3 tones per task spec:
 * active=brand, on-leave=amber, terminated=muted, plus a fallback
 * for unknown strings. */
const TONE: Record<EmploymentTone, { bg: string; fg: string; label: string; icon: React.ReactNode }> = {
  active: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Active",
    icon: <CircleCheck className="size-3" />,
  },
  "on-leave": {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
    label: "On leave",
    icon: <Clock className="size-3" />,
  },
  terminated: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "Terminated",
    icon: null,
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "—",
    icon: null,
  },
};

/* ────────── root component ────────── */

export default function PeopleEmployeesPanel() {
  /* RBAC gate: the panel is a no-op shell when the user has no People
   * access. Mirrors the legacy `useAppAccess` check in `web/src/main.jsx`. */
  const hasAccess = useUserAccess("people");
  const [tab, setTab] = React.useState<SubTab>("registry");

  if (!hasAccess) {
    return (
      <section
        data-testid="people-employees-panel"
        className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
        aria-label="People"
      >
        No access
      </section>
    );
  }

  return (
    <section
      data-testid="people-employees-panel"
      className="space-y-4"
      aria-label="People employees"
    >
      <SubTabs value={tab} onChange={setTab} />
      {tab === "registry" && <RegistrySubPanel />}
      {tab === "new" && <NewEmployeeSubPanel onCreated={() => setTab("registry")} />}
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
      aria-label="People sub-tabs"
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

/* ────────── sub-panel: Registry ────────── */

function RegistrySubPanel() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["people-employees"],
    queryFn: async () => {
      const raw = await getJson("/api/people/employees");
      return PeopleEmployeesResponseSchema.parse(raw);
    },
  });

  if (query.isLoading) return <LoadingState message="Loading employees" />;
  if (query.isError) return <ErrorState error={query.error} />;

  const employees: ReadonlyArray<PeopleEmployee> = query.data?.employees ?? [];
  const sorted = [...employees].sort(compareEmployeesByStatusThenName);
  const counts = countByEmployment(employees);
  const activeCount = counts.active;
  const totalGross = sumGrossSalary(employees);

  return (
    <article
      className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
      data-testid="people-registry"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] pb-2">
        <span className="inline-flex items-center gap-1.5 text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
          A1 People
        </span>
        <div className="flex items-center gap-3 text-[var(--text-xs)] text-[var(--color-muted)]">
          <span>
            <strong className="font-mono text-[var(--color-ink)]">{activeCount}</strong> active
          </span>
          <span>
            gross <strong className="font-mono text-[var(--color-ink)]">{amd(totalGross)}</strong>
          </span>
        </div>
      </header>

      {sorted.length === 0 ? (
        <EmptyState message="No employees yet" />
      ) : (
        <ul className="divide-y divide-[var(--color-line)]" data-entity="people-employee" data-count={String(sorted.length)}>
          {sorted.map((employee) => (
            <EmployeeRow key={employee.id} employee={employee} qc={qc} />
          ))}
        </ul>
      )}
    </article>
  );
}

function EmployeeRow({
  employee,
  qc,
}: {
  employee: PeopleEmployee;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const tone = TONE[classifyEmployment(employee)];
  const isTerminated = employee.employmentStatus === "terminated";

  /* Only one row's editor / history is open at a time. Identical to
   * the legacy `editingId` / `historyId` state in `PeopleRegistryPanel`. */
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [historyId, setHistoryId] = React.useState<string | null>(null);
  const isEditing = editingId === employee.id;
  const isHistoryOpen = historyId === employee.id;

  return (
    <li className="space-y-2 py-2" data-employee-id={employee.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 text-[var(--text-sm)]">
          <span className="font-medium text-[var(--color-ink)]">{employee.fullName}</span>
          <span className="text-[var(--color-muted)]"> · {employee.position || "—"} · {employee.department || "—"}</span>
          <span
            className={cn(
              "ml-2 inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              tone.bg,
              tone.fg,
            )}
            data-testid={`status-pill-${employee.id}`}
          >
            {tone.icon}
            {tone.label}
          </span>
          <span className="ml-2 font-mono text-[var(--color-ink)]">{amd(employee.grossSalary ?? null)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setEditingId(isEditing ? null : employee.id)}
            className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-[var(--text-xs)] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
            data-testid={`edit-toggle-${employee.id}`}
          >
            <Pencil className="size-3" />
            {isEditing ? "Close" : "Edit"}
          </button>
          {!isTerminated && (
            <RunPayrollButton employeeId={employee.id} qc={qc} />
          )}
          <button
            type="button"
            onClick={() => setHistoryId(isHistoryOpen ? null : employee.id)}
            className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-[var(--text-xs)] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
            data-testid={`history-toggle-${employee.id}`}
          >
            <History className="size-3" />
            {isHistoryOpen ? "Hide history" : "Payroll history"}
          </button>
        </div>
      </div>

      {isEditing && (
        <EmployeeEditor
          employee={employee}
          onDone={() => setEditingId(null)}
          qc={qc}
        />
      )}
      {isHistoryOpen && (
        <PayrollHistory employeeId={employee.id} />
      )}
    </li>
  );
}

function RunPayrollButton({
  employeeId,
  qc,
}: {
  employeeId: string;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const run = useMutation({
    mutationFn: () => postVoid(`/api/people/employees/${employeeId}/run-payroll`, {}),
    onSuccess: () => {
      /* Invalidate both the list (in case status changed) and the
       * per-employee payroll history (a new run was created). */
      qc.invalidateQueries({ queryKey: ["people-employees"] });
      qc.invalidateQueries({ queryKey: ["people-payroll-runs", employeeId] });
    },
  });
  return (
    <button
      type="button"
      disabled={run.isPending}
      onClick={() => run.mutate()}
      className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-2 py-1 text-[var(--text-xs)] font-medium text-[var(--color-on-brand)] hover:opacity-90 disabled:opacity-50"
      data-testid={`run-payroll-${employeeId}`}
    >
      {run.isPending ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
      {run.isPending ? "Running" : "Run payroll"}
    </button>
  );
}

function EmployeeEditor({
  employee,
  onDone,
  qc,
}: {
  employee: PeopleEmployee;
  onDone: () => void;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [status, setStatus] = React.useState(employee.employmentStatus);
  const [grossSalary, setGrossSalary] = React.useState(String(employee.grossSalary ?? 0));
  const [position, setPosition] = React.useState(employee.position ?? "");

  const update = useMutation({
    mutationFn: () => {
      const body: UpdateEmployeeInput = {
        employmentStatus: status,
        grossSalary: numericInput(grossSalary),
        position: position.trim(),
      };
      return patchJson<EmployeeMutationResponse>(
        `/api/people/employees/${employee.id}`,
        body as JsonBody,
        undefined,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people-employees"] });
      onDone();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate();
      }}
      className="flex flex-wrap items-end gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-2"
      data-testid={`edit-form-${employee.id}`}
    >
      <Field label="Status">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="form-input"
        >
          {EMPLOYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Gross (AMD)">
        <input
          value={grossSalary}
          onChange={(e) => setGrossSalary(e.target.value)}
          inputMode="numeric"
          className="form-input w-32"
        />
      </Field>
      <Field label="Position">
        <input
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          className="form-input w-48"
        />
      </Field>
      <button
        type="submit"
        disabled={update.isPending}
        className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-on-brand)] hover:opacity-90 disabled:opacity-50"
      >
        {update.isPending ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
        Save
      </button>
      {update.isError && (
        <p className="w-full text-[var(--text-xs)] text-[var(--color-tag-red)]">
          {(update.error as Error).message}
        </p>
      )}
    </form>
  );
}

function PayrollHistory({ employeeId }: { employeeId: string }) {
  const query = useQuery({
    queryKey: ["people-payroll-runs", employeeId],
    queryFn: async () => {
      const raw = await getJson(`/api/people/employees/${employeeId}/payroll-runs`);
      return PeoplePayrollRunsResponseSchema.parse(raw) as PeoplePayrollRunsResponse;
    },
  });

  if (query.isLoading) {
    return (
      <p
        className="rounded-[var(--radius-md)] bg-[var(--color-surface-soft)] p-2 text-[11px] text-[var(--color-muted)]"
        data-testid={`payroll-history-${employeeId}`}
      >
        Loading payroll history…
      </p>
    );
  }
  if (query.isError) {
    return (
      <p
        className="rounded-[var(--radius-md)] bg-[var(--color-surface-soft)] p-2 text-[11px] text-[var(--color-tag-red)]"
        data-testid={`payroll-history-${employeeId}`}
      >
        {(query.error as Error).message}
      </p>
    );
  }

  const runs: ReadonlyArray<PeoplePayrollRun> = query.data?.runs ?? [];

  if (runs.length === 0) {
    return (
      <p
        className="rounded-[var(--radius-md)] bg-[var(--color-surface-soft)] p-2 text-[11px] text-[var(--color-muted)]"
        data-testid={`payroll-history-${employeeId}`}
      >
        No payroll runs yet
      </p>
    );
  }

  return (
    <ul
      className="space-y-0.5 rounded-[var(--radius-md)] border-l-2 border-[var(--color-line)] bg-[var(--color-surface-soft)] p-2 text-[11px]"
      data-testid={`payroll-history-${employeeId}`}
    >
      {runs.map((run) => (
        <li key={run.id} className="text-[var(--color-ink)]">
          · {run.periodKey || run.runDate} — gross {amd(run.gross)} · deductions {amd(run.totalDeductions)} ·{" "}
          <strong>net {amd(run.net)}</strong>
        </li>
      ))}
    </ul>
  );
}

/* ────────── sub-panel: New employee ────────── */

function NewEmployeeSubPanel({ onCreated }: { onCreated: () => void }) {
  const qc = useQueryClient();
  const [fullName, setFullName] = React.useState("");
  const [taxId, setTaxId] = React.useState("");
  const [position, setPosition] = React.useState("");
  const [department, setDepartment] = React.useState("");
  const [grossSalary, setGrossSalary] = React.useState("");
  const [hireDate, setHireDate] = React.useState("");
  const [email, setEmail] = React.useState("");

  const create = useMutation({
    mutationFn: () => {
      const body: CreateEmployeeInput = {
        fullName: fullName.trim(),
        taxId: taxId.trim(),
        position: position.trim(),
        department: department.trim(),
        grossSalary: numericInput(grossSalary),
        hireDate,
        email: email.trim(),
      };
      return postJson<EmployeeMutationResponse>(
        "/api/people/employees",
        body as JsonBody,
        undefined,
      );
    },
    onSuccess: () => {
      /* Refetch the employees list and switch to the registry tab so
       * the user immediately sees their new hire. */
      qc.invalidateQueries({ queryKey: ["people-employees"] });
      setFullName("");
      setTaxId("");
      setPosition("");
      setDepartment("");
      setGrossSalary("");
      setHireDate("");
      setEmail("");
      onCreated();
    },
  });

  /* Pre-flight client-side check — the legacy form silently no-ops on
   * invalid input. We surface a soft warning instead so the user knows
   * why the button didn't fire. The 8-digit tax-id rule is unit-tested
   * separately in `web-modern/src/lib/people/__tests__/status.test.ts`. */
  const trimmedName = fullName.trim();
  const taxIdInvalid = taxId.trim().length > 0 && !isValidTaxId(taxId.trim());
  const canSubmit = trimmedName.length >= 2 && !taxIdInvalid && !create.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    create.mutate();
  };

  return (
    <article
      className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
      data-testid="people-new-employee"
    >
      <header className="border-b border-[var(--color-line)] pb-2">
        <span className="text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
          A1 People
        </span>
        <h2 className="text-[var(--text-lg)] font-semibold text-[var(--color-ink)]">New employee</h2>
      </header>

      <form
        onSubmit={submit}
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="new-employee-form"
      >
        <Field label="Անուն Ազգանուն" className="lg:col-span-1">
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Անուն Ազգանուն"
            className="form-input w-full"
          />
        </Field>
        <Field label="ՀՎՀՀ (8 նիշ)">
          <input
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            inputMode="numeric"
            placeholder="ՀՎՀՀ (8 նիշ)"
            className={cn("form-input w-full", taxIdInvalid && "border-[var(--color-tag-red)]")}
          />
        </Field>
        <Field label="Պաշտոն">
          <input
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder="Պաշտոն"
            className="form-input w-full"
          />
        </Field>
        <Field label="Բաժին">
          <input
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="Բաժին"
            className="form-input w-full"
          />
        </Field>
        <Field label="Աշխատավարձ (AMD)">
          <input
            value={grossSalary}
            onChange={(e) => setGrossSalary(e.target.value)}
            inputMode="numeric"
            placeholder="Աշխատավարձ (AMD)"
            className="form-input w-full"
          />
        </Field>
        <Field label="Hire date">
          <input
            type="date"
            value={hireDate}
            onChange={(e) => setHireDate(e.target.value)}
            className="form-input w-full"
          />
        </Field>
        <Field label="Էլ. փոստ" className="lg:col-span-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Էլ. փոստ"
            className="form-input w-full"
          />
        </Field>

        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-on-brand)] hover:opacity-90 disabled:opacity-50"
            data-testid="new-employee-submit"
          >
            {create.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {create.isPending ? "Saving" : "Add employee"}
          </button>
          {taxIdInvalid && (
            <span className="text-[var(--text-xs)] text-[var(--color-tag-red)]">
              ՀՎՀՀ must be 8 digits
            </span>
          )}
        </div>
        {create.isError && (
          <p className="text-[var(--text-xs)] text-[var(--color-tag-red)] sm:col-span-2 lg:col-span-3">
            {(create.error as Error).message}
          </p>
        )}
      </form>
    </article>
  );
}

/* ────────── shared presentational helpers ────────── */

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

function LoadingState({ message }: { message: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-[var(--text-sm)] text-[var(--color-muted)]"
      data-testid="loading"
    >
      <Loader2 className="size-3.5 animate-spin" />
      <Users className="size-3.5" />
      {message}
    </div>
  );
}

function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Failed to load";
  return (
    <div
      className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-tag-red)] bg-[var(--color-surface)] p-4 text-[var(--text-sm)] text-[var(--color-tag-red)]"
      data-testid="error"
    >
      <CircleAlert className="size-3.5" />
      {message}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      data-testid="empty"
    >
      {message}
    </div>
  );
}
