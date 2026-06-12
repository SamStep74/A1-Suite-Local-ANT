/**
 * PeopleHrOpsPanel — Phase 10.2b W1 (hr-ops).
 *
 * Migrates 3 legacy HR-ops panels from web/src/people.jsx into a single
 * modern React surface, presented as 3 internal sub-tabs:
 *
 *   1. **Contracts** — form to generate an employment contract.
 *      (legacy lines 153–204, HrContractsPanel)
 *   2. **Leave**     — form to request leave.
 *      (legacy lines 206–243, HrLeavePanel)
 *   3. **Trips**     — form to file a business trip.
 *      (legacy lines 245–284, HrTripsPanel)
 *
 * Server endpoints (all already exist in server/app.js):
 *   - GET  /api/hr/contracts/templates
 *   - POST /api/hr/contracts
 *   - POST /api/hr/leave-requests
 *   - POST /api/hr/leave-requests/:id/approve   (NOT exposed in 10.2b —
 *         the legacy `onApprove` lives in web/src/main.jsx, not in the
 *         panels themselves. Surfaced as a TODO note here for 10.4.)
 *   - GET  /api/hr/leave-balances
 *   - POST /api/hr/business-trips
 *   - POST /api/hr/equipment/assign
 *
 * The "Approve" flow is intentionally NOT in this panel — the legacy
 * HrLeavePanel accepts an onApprove callback that main.jsx wires to the
 * approval queue. The orchestrator wires the approval queue as a
 * separate panel in 10.4.
 *
 * Trip days / allowance is calculated locally using the same shape as
 * server/hr.js#computeTripAllowance (perDiem × days + transport).
 *
 * This file is file-isolated: it does NOT modify
 * web-modern/src/routes/app/people/index.tsx. The orchestrator wires it
 * into the ViewSwitcher in a post-merge step.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, FileText, Loader2, Plane, Wallet } from "lucide-react";
import { getJson, postJson, type JsonBody } from "../../../../lib/api/client";
import {
  HrBusinessTripResponseSchema,
  HrContractResponseSchema,
  HrLeaveRequestResponseSchema,
  PeopleEmployeesResponseSchema,
  type HrBusinessTripResponse,
  type HrContractResponse,
  type HrLeaveRequestResponse,
  type PeopleEmployee,
  type PeopleEmployeesResponse,
} from "../../../../lib/api/schemas";
import { cn } from "../../../../lib/utils/cn";

/* ────────── local types (intentionally not in schemas.ts — 10.4) ───── */

type HrContractTemplate = {
  code: string;
  label?: string;
};

type HrContractTemplatesResponse = {
  templates: ReadonlyArray<HrContractTemplate>;
};

/* ────────── constants ────────── */

type SubTab = "contracts" | "leave" | "trips";

const SUB_TABS: { value: SubTab; label: string }[] = [
  { value: "contracts", label: "Contracts" },
  { value: "leave", label: "Leave" },
  { value: "trips", label: "Trips" },
];

/* The 6 contract templates — mirrors web/src/people.jsx:182-189.
 * Used as the dropdown default and as a fallback if the server doesn't
 * supply a /api/hr/contracts/templates response. */
const FALLBACK_TEMPLATES: ReadonlyArray<HrContractTemplate> = [
  { code: "permanent", label: "Անժամկետ" },
  { code: "fixed-term", label: "Որոշակի ժամկետ" },
  { code: "part-time", label: "Մասնակի զբաղվածություն" },
  { code: "intern", label: "Պրակտիկա" },
  { code: "remote", label: "Հեռավար" },
  { code: "secondment", label: "Վերագրում" },
];

/* ────────── helpers ────────── */

const fmtAmd = (value: number | null | undefined): string => {
  const n = Number(value || 0);
  return `${n.toLocaleString("hy-AM")} AMD`;
};

const numericInput = (raw: string | number): number => {
  const n = typeof raw === "number" ? raw : Math.round(Number(raw) || 0);
  return Math.max(0, n);
};

/* Local copy of server/hr.js#computeTripAllowance. We don't POST `days`
 * explicitly — the server derives days from start/end dates. We compute
 * a preview here so the user sees the expected total before submit. */
function previewTripAllowance(
  perDiem: number,
  days: number,
  transport: number,
): { perDiem: number; days: number; transportation: number; total: number } {
  return {
    perDiem,
    days,
    transportation: transport,
    total: perDiem * days + transport,
  };
}

/* Days between two YYYY-MM-DD dates (inclusive end - inclusive start).
 * Mirrors what the server derives for the leave request. */
function daysBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.valueOf()) || Number.isNaN(e.valueOf())) return 0;
  const ms = e.valueOf() - s.valueOf();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(0, days);
}

/* ────────── root component ────────── */

export default function PeopleHrOpsPanel() {
  const [tab, setTab] = React.useState<SubTab>("contracts");

  return (
    <section
      data-testid="people-hr-ops-panel"
      className="space-y-4"
      aria-label="People HR operations"
    >
      <SubTabs value={tab} onChange={setTab} />

      {tab === "contracts" && <ContractsSubPanel />}
      {tab === "leave" && <LeaveSubPanel />}
      {tab === "trips" && <TripsSubPanel />}
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
      aria-label="People HR-ops sub-tabs"
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

/* ────────── shared: employees list ────────── */

function useActiveEmployees() {
  return useQuery({
    queryKey: ["people-employees-for-hr-ops"],
    queryFn: async () => {
      const raw = await getJson("/api/people/employees");
      return PeopleEmployeesResponseSchema.parse(raw) as PeopleEmployeesResponse;
    },
  });
}

/* ────────── sub-panel: Contracts ────────── */

function ContractsSubPanel() {
  const employeesQuery = useActiveEmployees();
  const templatesQuery = useQuery({
    queryKey: ["hr-contract-templates"],
    queryFn: () =>
      getJson<HrContractTemplatesResponse>(
        "/api/hr/contracts/templates",
        undefined,
      ),
    /* The server may return a hardcoded list (per the task spec) — we
     * tolerate it being empty. The dropdown falls back to
     * FALLBACK_TEMPLATES below. */
  });

  const create = useMutation({
    mutationFn: (body: JsonBody) =>
      postJson<HrContractResponse>("/api/hr/contracts", body, HrContractResponseSchema),
  });

  const employees: ReadonlyArray<PeopleEmployee> = employeesQuery.data?.employees ?? [];
  const serverTemplates: ReadonlyArray<HrContractTemplate> = templatesQuery.data?.templates ?? [];
  const templates: ReadonlyArray<HrContractTemplate> = serverTemplates.length > 0 ? serverTemplates : FALLBACK_TEMPLATES;
  const activeEmployees = employees.filter((e) => e.employmentStatus === "active");

  return (
    <PanelFrame
      title="Employment contracts"
      subtitle="Աշխատանքային պայմանագիր"
      testId="hr-contracts-subpanel"
    >
      <PanelHeader label="A1 People / HR" badge={`${activeEmployees.length} active`} />

      {employeesQuery.isLoading || templatesQuery.isLoading ? (
        <LoadingState message="Loading employees and templates" />
      ) : employeesQuery.isError ? (
        <ErrorState error={employeesQuery.error} />
      ) : (
        <ContractForm
          employees={activeEmployees}
          templates={templates}
          busy={create.isPending}
          error={create.isError ? (create.error as Error).message : null}
          result={create.data}
          onSubmit={(payload) => create.mutate(payload as JsonBody)}
          onReset={() => create.reset()}
        />
      )}
    </PanelFrame>
  );
}

function ContractForm({
  employees,
  templates,
  busy,
  error,
  result,
  onSubmit,
  onReset,
}: {
  employees: ReadonlyArray<PeopleEmployee>;
  templates: ReadonlyArray<HrContractTemplate>;
  busy: boolean;
  error: string | null;
  result: HrContractResponse | undefined;
  onSubmit: (payload: {
    employeeId: string;
    templateCode: string;
    position: string;
    startDate: string;
    endDate?: string;
    grossSalary: number;
    idempotencyKey: string;
  }) => void;
  onReset: () => void;
}) {
  const [employeeId, setEmployeeId] = React.useState(employees[0]?.id ?? "");
  const [templateCode, setTemplateCode] = React.useState(templates[0]?.code ?? "permanent");
  const [position, setPosition] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [grossSalary, setGrossSalary] = React.useState("");

  /* If the employee list loads after the form mounts, sync the
   * dropdown to the first available employee. */
  React.useEffect(() => {
    if (!employeeId && employees[0]) setEmployeeId(employees[0].id);
  }, [employees, employeeId]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!employeeId || !position.trim() || !startDate) return;
    onSubmit({
      employeeId,
      templateCode,
      position: position.trim(),
      startDate,
      endDate: endDate || undefined,
      grossSalary: numericInput(grossSalary),
      idempotencyKey: `ui-ct-${Date.now()}`,
    });
    setPosition("");
    setStartDate("");
    setEndDate("");
    setGrossSalary("");
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
      data-testid="hr-contracts-form"
    >
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Աշխատակից">
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="form-input"
            data-testid="hr-contract-employee"
          >
            {employees.length === 0 && <option value="">No active employees</option>}
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Տեսակ">
          <select
            value={templateCode}
            onChange={(e) => setTemplateCode(e.target.value)}
            className="form-input"
            data-testid="hr-contract-template"
          >
            {templates.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label ?? t.code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Պաշտոն">
          <input
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            className="form-input w-40"
            placeholder="Պաշտոն"
            data-testid="hr-contract-position"
          />
        </Field>
        <Field label="Սկիզբ">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="form-input"
            data-testid="hr-contract-start"
          />
        </Field>
        <Field label="Վերջ (ընտրովի)">
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="form-input"
            data-testid="hr-contract-end"
          />
        </Field>
        <Field label="Աշխատավարձ (AMD)">
          <input
            value={grossSalary}
            onChange={(e) => setGrossSalary(e.target.value)}
            className="form-input w-36"
            inputMode="numeric"
            placeholder="Աշխատավարձ (AMD)"
            data-testid="hr-contract-salary"
          />
        </Field>
        <button
          type="submit"
          disabled={busy || !employeeId || !position.trim() || !startDate}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-on-brand)] hover:opacity-90 disabled:opacity-50"
          data-testid="hr-contract-submit"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
          {busy ? "Պատրաստվում է" : "Ստեղծել"}
        </button>
      </div>

      {error && <p className="text-[var(--text-xs)] text-[var(--color-tag-red)]">{error}</p>}

      {result && (
        <div className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3" data-testid="hr-contract-result">
          <p className="text-[var(--text-sm)] text-[var(--color-ink)]">
            Պայմանագիր #{result.contract.id}
            <span className="ml-2 inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-tag-blue)]">
              {result.contract.status}
            </span>
          </p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.8em" }} className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 text-[var(--color-ink)]">
            {result.contract.bodyMd.slice(0, 600)}…
          </pre>
          <button
            type="button"
            onClick={onReset}
            className="text-[var(--text-xs)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            Reset
          </button>
        </div>
      )}
    </form>
  );
}

/* ────────── sub-panel: Leave ────────── */

function LeaveSubPanel() {
  const employeesQuery = useActiveEmployees();
  const qc = useQueryClient();

  const request = useMutation({
    mutationFn: (body: JsonBody) =>
      postJson<HrLeaveRequestResponse>("/api/hr/leave-requests", body, HrLeaveRequestResponseSchema),
  });

  const employees: ReadonlyArray<PeopleEmployee> = employeesQuery.data?.employees ?? [];
  const activeEmployees = employees.filter((e) => e.employmentStatus === "active");

  return (
    <PanelFrame
      title="Leave requests"
      subtitle="Արձակուրդի հայտ"
      testId="hr-leave-subpanel"
    >
      <PanelHeader label="A1 People / HR" badge="pending queue" />

      {employeesQuery.isLoading ? (
        <LoadingState message="Loading employees" />
      ) : employeesQuery.isError ? (
        <ErrorState error={employeesQuery.error} />
      ) : (
        <LeaveForm
          employees={activeEmployees}
          busy={request.isPending}
          error={request.isError ? (request.error as Error).message : null}
          result={request.data}
          onSubmit={(payload) => request.mutate(payload as JsonBody)}
          onReset={() => {
            request.reset();
            qc.invalidateQueries({ queryKey: ["hr-leave-balances"] });
          }}
        />
      )}

      <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
        {/* TODO (Phase 10.4): wire the Approve action. The legacy HrLeavePanel
            exposed `onApprove` which main.jsx wired to the approval queue.
            For 10.2b the orchestrator leaves approval as a separate
            surface; this panel is request-only. */}
        Approval is handled by the dedicated approval queue (coming in 10.4).
      </p>
    </PanelFrame>
  );
}

function LeaveForm({
  employees,
  busy,
  error,
  result,
  onSubmit,
  onReset,
}: {
  employees: ReadonlyArray<PeopleEmployee>;
  busy: boolean;
  error: string | null;
  result: HrLeaveRequestResponse | undefined;
  onSubmit: (payload: {
    employeeId: string;
    kind: "annual" | "sick" | "unpaid";
    startDate: string;
    endDate: string;
    reason?: string;
    idempotencyKey: string;
  }) => void;
  onReset: () => void;
}) {
  const [employeeId, setEmployeeId] = React.useState(employees[0]?.id ?? "");
  const [kind, setKind] = React.useState<"annual" | "sick" | "unpaid">("annual");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [reason, setReason] = React.useState("");

  React.useEffect(() => {
    if (!employeeId && employees[0]) setEmployeeId(employees[0].id);
  }, [employees, employeeId]);

  const previewDays = daysBetween(startDate, endDate);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!employeeId || !startDate || !endDate) return;
    onSubmit({
      employeeId,
      kind,
      startDate,
      endDate,
      reason: reason.trim() || undefined,
      idempotencyKey: `ui-lr-${Date.now()}`,
    });
    setStartDate("");
    setEndDate("");
    setReason("");
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
      data-testid="hr-leave-form"
    >
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Աշխատակից">
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="form-input"
            data-testid="hr-leave-employee"
          >
            {employees.length === 0 && <option value="">No active employees</option>}
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Տեսակ">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "annual" | "sick" | "unpaid")}
            className="form-input"
            data-testid="hr-leave-kind"
          >
            <option value="annual">Տարեկան հիմնական</option>
            <option value="sick">Հիվանդության</option>
            <option value="unpaid">Անարձակուրդ</option>
          </select>
        </Field>
        <Field label="Սկիզբ">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="form-input"
            data-testid="hr-leave-start"
          />
        </Field>
        <Field label="Վերջ">
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="form-input"
            data-testid="hr-leave-end"
          />
        </Field>
        <Field label="Պատճառ" className="min-w-[12rem] flex-1">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="form-input w-full"
            placeholder="Պատճառ"
            data-testid="hr-leave-reason"
          />
        </Field>
        <button
          type="submit"
          disabled={busy || !employeeId || !startDate || !endDate}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-on-brand)] hover:opacity-90 disabled:opacity-50"
          data-testid="hr-leave-submit"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wallet className="size-3.5" />}
          {busy ? "Ուղարկվում է" : "Հայտ ներկայացնել"}
        </button>
      </div>

      {previewDays > 0 && (
        <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
          Preview: {previewDays} day{previewDays === 1 ? "" : "s"}
        </p>
      )}

      {error && <p className="text-[var(--text-xs)] text-[var(--color-tag-red)]">{error}</p>}

      {result && (
        <div className="space-y-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3" data-testid="hr-leave-result">
          <p className="text-[var(--text-sm)] text-[var(--color-ink)]">
            Հայտ #{result.leaveRequest.id}
            <span className="ml-2 inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-tag-orange)]">
              {result.leaveRequest.status}
            </span>
          </p>
          <p className="text-[var(--text-sm)] text-[var(--color-ink)]">
            Օրեր՝ <strong>{result.leaveRequest.days}</strong>
          </p>
          <button
            type="button"
            onClick={onReset}
            className="text-[var(--text-xs)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            Reset
          </button>
        </div>
      )}
    </form>
  );
}

/* ────────── sub-panel: Trips ────────── */

function TripsSubPanel() {
  const employeesQuery = useActiveEmployees();

  const create = useMutation({
    mutationFn: (body: JsonBody) =>
      postJson<HrBusinessTripResponse>("/api/hr/business-trips", body, HrBusinessTripResponseSchema),
  });

  const employees: ReadonlyArray<PeopleEmployee> = employeesQuery.data?.employees ?? [];
  const activeEmployees = employees.filter((e) => e.employmentStatus === "active");

  return (
    <PanelFrame
      title="Business trips"
      subtitle="Գործուղում"
      testId="hr-trips-subpanel"
    >
      <PanelHeader label="A1 People / HR" badge="per-diem + transport" />

      {employeesQuery.isLoading ? (
        <LoadingState message="Loading employees" />
      ) : employeesQuery.isError ? (
        <ErrorState error={employeesQuery.error} />
      ) : (
        <TripForm
          employees={activeEmployees}
          busy={create.isPending}
          error={create.isError ? (create.error as Error).message : null}
          result={create.data}
          onSubmit={(payload) => create.mutate(payload as JsonBody)}
          onReset={() => create.reset()}
        />
      )}
    </PanelFrame>
  );
}

function TripForm({
  employees,
  busy,
  error,
  result,
  onSubmit,
  onReset,
}: {
  employees: ReadonlyArray<PeopleEmployee>;
  busy: boolean;
  error: string | null;
  result: HrBusinessTripResponse | undefined;
  onSubmit: (payload: {
    employeeId: string;
    destination: string;
    startDate: string;
    endDate: string;
    perDiemAmd: number;
    transportationAmd: number;
    idempotencyKey: string;
  }) => void;
  onReset: () => void;
}) {
  const [employeeId, setEmployeeId] = React.useState(employees[0]?.id ?? "");
  const [destination, setDestination] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [perDiem, setPerDiem] = React.useState("");
  const [transport, setTransport] = React.useState("");

  React.useEffect(() => {
    if (!employeeId && employees[0]) setEmployeeId(employees[0].id);
  }, [employees, employeeId]);

  const previewDays = daysBetween(startDate, endDate);
  const preview = previewTripAllowance(
    numericInput(perDiem),
    previewDays,
    numericInput(transport),
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!employeeId || !destination.trim() || !startDate || !endDate) return;
    onSubmit({
      employeeId,
      destination: destination.trim(),
      startDate,
      endDate,
      perDiemAmd: numericInput(perDiem),
      transportationAmd: numericInput(transport),
      idempotencyKey: `ui-trip-${Date.now()}`,
    });
    setDestination("");
    setStartDate("");
    setEndDate("");
    setPerDiem("");
    setTransport("");
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
      data-testid="hr-trips-form"
    >
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Աշխատակից">
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="form-input"
            data-testid="hr-trip-employee"
          >
            {employees.length === 0 && <option value="">No active employees</option>}
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Վայր">
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className="form-input w-40"
            placeholder="Վայր"
            data-testid="hr-trip-destination"
          />
        </Field>
        <Field label="Սկիզբ">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="form-input"
            data-testid="hr-trip-start"
          />
        </Field>
        <Field label="Վերջ">
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="form-input"
            data-testid="hr-trip-end"
          />
        </Field>
        <Field label="Օրապարգենային (AMD)">
          <input
            value={perDiem}
            onChange={(e) => setPerDiem(e.target.value)}
            className="form-input w-36"
            inputMode="numeric"
            placeholder="Օրապարգենային (AMD)"
            data-testid="hr-trip-perdiem"
          />
        </Field>
        <Field label="Տրանսպորտ (AMD)">
          <input
            value={transport}
            onChange={(e) => setTransport(e.target.value)}
            className="form-input w-36"
            inputMode="numeric"
            placeholder="Տրանսպորտ (AMD)"
            data-testid="hr-trip-transport"
          />
        </Field>
        <button
          type="submit"
          disabled={busy || !employeeId || !destination.trim() || !startDate || !endDate}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-on-brand)] hover:opacity-90 disabled:opacity-50"
          data-testid="hr-trip-submit"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plane className="size-3.5" />}
          {busy ? "Հաշվարկվում է" : "Ստեղծել"}
        </button>
      </div>

      {previewDays > 0 && (
        <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
          Preview: {preview.days} day{preview.days === 1 ? "" : "s"} · {fmtAmd(preview.perDiem)} × {preview.days} + {fmtAmd(preview.transportation)} = <strong>{fmtAmd(preview.total)}</strong>
        </p>
      )}

      {error && <p className="text-[var(--text-xs)] text-[var(--color-tag-red)]">{error}</p>}

      {result && (
        <div className="space-y-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3" data-testid="hr-trip-result">
          <p className="text-[var(--text-sm)] text-[var(--color-ink)]">
            Գործուղում #{result.trip.id}
          </p>
          <p className="text-[var(--text-sm)] text-[var(--color-ink)]">
            Ընդհանուր՝ <strong>{fmtAmd(result.trip.allowance.total)}</strong>
            <span className="ml-2 text-[var(--text-xs)] text-[var(--color-muted)]">
              ({result.trip.allowance.days}d · per-diem {fmtAmd(result.trip.allowance.perDiem)} · transport {fmtAmd(result.trip.allowance.transportation)})
            </span>
          </p>
          <button
            type="button"
            onClick={onReset}
            className="text-[var(--text-xs)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            Reset
          </button>
        </div>
      )}
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

function LoadingState({ message }: { message: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-[var(--text-sm)] text-[var(--color-muted)]"
      data-testid="loading"
    >
      <Loader2 className="size-3.5 animate-spin" />
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
