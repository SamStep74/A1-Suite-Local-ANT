/**
 * PeopleHrPerformancePanel — Phase 10.2b W2 (hr-perf).
 *
 * Migrates 3 legacy HR-performance panels from web/src/people.jsx
 * into a single modern React surface, presented as 3 internal sub-panels
 * (one tab each):
 *
 *   1. **Timesheets**   — log a single timesheet entry
 *                         (legacy lines 286–320,  HrTimesheetPanel)
 *   2. **KPI**          — manage KPI targets / actuals / score
 *                         (legacy lines 322–367,  HrKpiPanel)
 *   3. **Recruitment**  — create pipeline + add candidate
 *                         (legacy lines 369–413,  HrRecruitmentPanel)
 *
 * Server endpoints (all already exist, no new wiring required):
 *   - POST /api/hr/timesheets/bulk
 *   - GET  /api/hr/timesheets/report
 *   - POST /api/hr/kpis/targets
 *   - POST /api/hr/kpis/actuals
 *   - GET  /api/hr/kpis/score
 *   - POST /api/hr/recruitment/pipelines
 *   - POST /api/hr/recruitment/candidates
 *
 * RBAC: HR is Owner/Admin only at the server tier. The legacy code has
 * no per-panel gate, so we mirror that — the per-app
 * `useUserAccess("people")` gate is enforced upstream by the orchestrator
 * that mounts this surface.
 *
 * This file is file-isolated: it does NOT modify
 * web-modern/src/routes/app/people/index.tsx. The orchestrator wires it
 * into the ViewSwitcher in a post-merge step.
 */
import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { getJson, postJson, type JsonBody } from "../../../../lib/api/client";
import {
  HrKpiScoreResponseSchema,
  HrRecruitmentPipelineResponseSchema,
  HrRecruitmentCandidateResponseSchema,
  HrTimesheetBulkResponseSchema,
  HrTimesheetReportSchema,
  type HrKpiScoreResponse,
  type HrRecruitmentPipelineResponse,
  type HrRecruitmentCandidateResponse,
  type HrTimesheetBulkResponse,
  type HrTimesheetReport,
} from "../../../../lib/api/schemas";
import { cn } from "../../../../lib/utils/cn";

/* ────────── local types ────────── */

/** Minimal employee shape used by the employee picker. Mirrors
 *  `PeopleEmployee` but we only need a couple of fields. The parent
 *  page supplies this list (same as the legacy `employees` prop). */
export interface HrPerformanceEmployee {
  id: string;
  fullName: string;
}

/** POST /api/hr/timesheets/bulk request body. */
interface TimesheetBulkRequest {
  employeeId: string;
  entries: ReadonlyArray<{ workDate: string; hours: number; projectId: string }>;
  idempotencyKey: string;
}

/** POST /api/hr/kpis/targets request body. */
interface KpiTargetsRequest {
  employeeId: string;
  periodKey: string;
  targets: ReadonlyArray<{ metric: string; target: number; weight: number }>;
  idempotencyKey: string;
}

/** POST /api/hr/kpis/actuals request body. */
interface KpiActualsRequest {
  employeeId: string;
  periodKey: string;
  actuals: ReadonlyArray<{ metric: string; actual: number }>;
  idempotencyKey: string;
}

/** POST /api/hr/recruitment/pipelines request body. */
interface RecruitmentPipelineRequest {
  name: string;
  stages: ReadonlyArray<string>;
  idempotencyKey: string;
}

/** POST /api/hr/recruitment/candidates request body. */
interface RecruitmentCandidateRequest {
  pipelineId: string;
  fullName: string;
  email?: string;
  stage: string;
  idempotencyKey: string;
}

/* ────────── constants ────────── */

type SubTab = "timesheets" | "kpi" | "recruitment";

const SUB_TABS: ReadonlyArray<{ value: SubTab; label: string }> = [
  { value: "timesheets", label: "Timesheets" },
  { value: "kpi", label: "KPI" },
  { value: "recruitment", label: "Recruitment" },
];

/* Mirrors the legacy default stages string in web/src/people.jsx:371.
 * Splitting on comma is the legacy behavior; we preserve the default
 * here so the panel is usable out of the box. */
const DEFAULT_RECRUITMENT_STAGES = "applied,screen,interview,offer,hired";

/* ────────── helpers ────────── */

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const currentPeriodKey = (): string => new Date().toISOString().slice(0, 7);

/** Generate a UI-unique idempotency key per submission. The server uses
 *  this to deduplicate retries, so it must be stable-per-submission but
 *  unique across retries. We mirror the legacy `ui-…-${Date.now()}`
 *  pattern from web/src/people.jsx. */
const idempotencyKey = (kind: "ts" | "kpit" | "kpia" | "pipe" | "cand"): string =>
  `ui-${kind}-${Date.now()}`;

/* ────────── root component ────────── */

export interface PeopleHrPerformancePanelProps {
  /** Employee list used to populate the picker. The orchestrator
   *  passes this from the existing employees query. */
  employees?: ReadonlyArray<HrPerformanceEmployee>;
}

export default function PeopleHrPerformancePanel({
  employees = [],
}: PeopleHrPerformancePanelProps) {
  const [tab, setTab] = React.useState<SubTab>("timesheets");

  return (
    <section
      data-testid="people-hr-perf-panel"
      className="space-y-4"
      aria-label="People HR performance"
    >
      <SubTabs value={tab} onChange={setTab} />

      {tab === "timesheets" && <TimesheetsSubPanel employees={employees} />}
      {tab === "kpi" && <KpiSubPanel employees={employees} />}
      {tab === "recruitment" && <RecruitmentSubPanel />}
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
      aria-label="People HR performance sub-tabs"
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

/* ────────── sub-panel: Timesheets ────────── */

function TimesheetsSubPanel({
  employees,
}: {
  employees: ReadonlyArray<HrPerformanceEmployee>;
}) {
  /* Local form state — mirrors the legacy HrTimesheetPanel */
  const firstEmployeeId = employees[0]?.id ?? "";
  const [employeeId, setEmployeeId] = React.useState(firstEmployeeId);
  const [projectId, setProjectId] = React.useState("p1");
  const [hours, setHours] = React.useState("8");
  const [workDate, setWorkDate] = React.useState(todayIso());

  /* When the employees list arrives after the form mounts, sync the
   * picker to the first id (mirrors the legacy component behavior). */
  React.useEffect(() => {
    if (!employeeId && firstEmployeeId) setEmployeeId(firstEmployeeId);
  }, [firstEmployeeId, employeeId]);

  const bulk = useMutation({
    mutationFn: (body: TimesheetBulkRequest) =>
      postJson<HrTimesheetBulkResponse>("/api/hr/timesheets/bulk", body as unknown as JsonBody, HrTimesheetBulkResponseSchema),
  });

  /* After the bulk insert, fetch the report for the same period.
   * Legacy code reads `result.report.totalHours` from the bulk response
   * itself; we additionally refresh against /report for consistency. */
  const workPeriod = workDate.slice(0, 7);
  const reportQuery = useQuery({
    queryKey: ["hr-timesheet-report", workPeriod],
    queryFn: () => {
      const reportEnvelope = zReportEnvelope(
        getJson<{ report: HrTimesheetReport; periodKey: string }>(
          `/api/hr/timesheets/report?periodKey=${encodeURIComponent(workPeriod)}`,
          undefined,
        ),
      );
      return reportEnvelope;
    },
    enabled: bulk.isSuccess,
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!employeeId || !workDate || !hours) return;
    const parsed = Number(hours);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    bulk.mutate({
      employeeId,
      entries: [{ workDate, hours: parsed, projectId }],
      idempotencyKey: idempotencyKey("ts"),
    });
  };

  return (
    <PanelFrame title="Timesheets" subtitle="Ժամային հաշվետվություն" testId="hr-timesheets">
      <PanelHeader label="A1 People / HR" />

      <form
        onSubmit={submit}
        className="flex flex-wrap items-end gap-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
        data-testid="hr-timesheet-form"
      >
        <Field label="Աշխատակից">
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="form-input"
          >
            {employees.length === 0 && <option value="">—</option>}
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ամսաթիվ">
          <input
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
            className="form-input"
          />
        </Field>
        <Field label="Ժամեր">
          <input
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            inputMode="numeric"
            className="form-input w-24"
            placeholder="Ժամեր"
          />
        </Field>
        <Field label="Նախագիծ">
          <input
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="form-input"
            placeholder="Նախագիծ"
          />
        </Field>
        <button
          type="submit"
          disabled={bulk.isPending}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-on-brand)] hover:opacity-90 disabled:opacity-50"
        >
          {bulk.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Ավելացնել
        </button>
      </form>

      {bulk.isError && (
        <p className="text-[var(--text-xs)] text-[var(--color-tag-red)]" data-testid="hr-timesheet-error">
          {(bulk.error as Error).message}
        </p>
      )}

      {bulk.isSuccess && bulk.data && (
        <div
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="hr-timesheet-result"
        >
          <p>
            Ավելացվել է <strong>{bulk.data.inserted}</strong> գրառում, ընդհանուր{" "}
            <strong>{bulk.data.report.totalHours}</strong> ժամ
          </p>
        </div>
      )}

      {reportQuery.isSuccess && reportQuery.data && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Metric
            label="Ընդհանուր ժամեր (period)"
            value={`${reportQuery.data.report.totalHours}`}
          />
          <Metric
            label="Փուլ"
            value={reportQuery.data.periodKey}
          />
          <Metric
            label="Նախագծեր"
            value={String(Object.keys(reportQuery.data.report.byProject ?? {}).length)}
          />
        </div>
      )}
    </PanelFrame>
  );
}

/* Tiny inline wrapper to read the report envelope with a schema on the
 * resolved query, so reportQuery.data is typed. We construct the
 * queryFn to return the parsed envelope. */
async function zReportEnvelope(
  promise: Promise<{ report: HrTimesheetReport; periodKey: string }>,
): Promise<{ report: HrTimesheetReport; periodKey: string }> {
  const raw = await promise;
  return { report: HrTimesheetReportSchema.parse(raw.report), periodKey: raw.periodKey };
}

/* ────────── sub-panel: KPI ────────── */

function KpiSubPanel({ employees }: { employees: ReadonlyArray<HrPerformanceEmployee> }) {
  const firstEmployeeId = employees[0]?.id ?? "";
  const [employeeId, setEmployeeId] = React.useState(firstEmployeeId);
  const [periodKey, setPeriodKey] = React.useState(currentPeriodKey());
  const [metric, setMetric] = React.useState("revenue");
  const [target, setTarget] = React.useState("");
  const [actual, setActual] = React.useState("");
  const [weight, setWeight] = React.useState("1");

  React.useEffect(() => {
    if (!employeeId && firstEmployeeId) setEmployeeId(firstEmployeeId);
  }, [firstEmployeeId, employeeId]);

  const setTargets = useMutation({
    mutationFn: (body: KpiTargetsRequest) =>
      postJson<{ ok: boolean; targets: number }>(
        "/api/hr/kpis/targets",
        body as unknown as JsonBody,
        undefined,
      ),
  });
  const setActuals = useMutation({
    mutationFn: (body: KpiActualsRequest) =>
      postJson<{ ok: boolean; actuals: number }>(
        "/api/hr/kpis/actuals",
        body as unknown as JsonBody,
        undefined,
      ),
  });
  const getScore = useMutation({
    mutationFn: ({ employeeId: eid, periodKey: pk }: { employeeId: string; periodKey: string }) =>
      postJson<HrKpiScoreResponse>(
        `/api/hr/kpis/score?employeeId=${encodeURIComponent(eid)}&periodKey=${encodeURIComponent(pk)}`,
        null as unknown as JsonBody,
        HrKpiScoreResponseSchema,
      ),
  });

  const submitTargets = (event: React.FormEvent) => {
    event.preventDefault();
    if (!employeeId || !metric || !target) return;
    setTargets.mutate({
      employeeId,
      periodKey,
      targets: [{ metric, target: Number(target), weight: Number(weight) || 0 }],
      idempotencyKey: idempotencyKey("kpit"),
    });
  };
  const submitActuals = (event: React.FormEvent) => {
    event.preventDefault();
    if (!employeeId || !metric || !actual) return;
    setActuals.mutate({
      employeeId,
      periodKey,
      actuals: [{ metric, actual: Number(actual) }],
      idempotencyKey: idempotencyKey("kpia"),
    });
  };
  const fetchScore = () => {
    if (!employeeId || !periodKey) return;
    getScore.mutate({ employeeId, periodKey });
  };

  const result = setTargets.data ?? setActuals.data ?? getScore.data;

  return (
    <PanelFrame title="KPI management" subtitle="KPI կառավարում" testId="hr-kpi">
      <PanelHeader label="A1 People / HR" />

      <form
        className="flex flex-wrap items-end gap-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
        data-testid="hr-kpi-form"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field label="Աշխատակից">
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="form-input"
          >
            {employees.length === 0 && <option value="">—</option>}
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Փուլ (YYYY-MM)">
          <input
            value={periodKey}
            onChange={(e) => setPeriodKey(e.target.value)}
            className="form-input w-28"
            placeholder="YYYY-MM"
          />
        </Field>
        <Field label="Ցուցանիշ">
          <input
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="form-input"
            placeholder="Ցուցանիշ"
          />
        </Field>
        <Field label="Նպատային">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            inputMode="numeric"
            className="form-input w-24"
            placeholder="Նպատային"
          />
        </Field>
        <Field label="Փաստացի">
          <input
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            inputMode="numeric"
            className="form-input w-24"
            placeholder="Փաստացի"
          />
        </Field>
        <Field label="Կշիռ">
          <input
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            inputMode="numeric"
            className="form-input w-20"
            placeholder="Կշիռ"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={submitTargets}
            disabled={setTargets.isPending}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] disabled:opacity-50"
          >
            Նպատակ
          </button>
          <button
            type="button"
            onClick={submitActuals}
            disabled={setActuals.isPending}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] disabled:opacity-50"
          >
            Փաստացի
          </button>
          <button
            type="button"
            onClick={fetchScore}
            disabled={getScore.isPending}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] disabled:opacity-50"
            data-testid="hr-kpi-score-button"
          >
            Հաշվել միավորը
          </button>
        </div>
      </form>

      {(setTargets.isError || setActuals.isError || getScore.isError) && (
        <p className="text-[var(--text-xs)] text-[var(--color-tag-red)]" data-testid="hr-kpi-error">
          {((setTargets.error ?? setActuals.error ?? getScore.error) as Error)?.message}
        </p>
      )}

      {result && (
        <div
          className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
          data-testid="hr-kpi-result"
        >
          {getScore.data?.score && (
            <div className="grid gap-2 sm:grid-cols-3">
              <Metric label="Կշռված միավոր" value={`${getScore.data.score.weighted}`} />
              {getScore.data.score.breakdown && getScore.data.score.breakdown.length > 0 && (
                <Metric
                  label="Ցուցանիշներ"
                  value={String(getScore.data.score.breakdown.length)}
                />
              )}
            </div>
          )}
          {setTargets.data && (
            <p className="text-[var(--text-sm)] text-[var(--color-ink)]">
              Նպատակներ պահպանվեցին՝ {setTargets.data.targets}
            </p>
          )}
          {setActuals.data && (
            <p className="text-[var(--text-sm)] text-[var(--color-ink)]">
              Փաստացիներ պահպանվեցին՝ {setActuals.data.actuals}
            </p>
          )}
        </div>
      )}
    </PanelFrame>
  );
}

/* ────────── sub-panel: Recruitment ────────── */

function RecruitmentSubPanel() {
  const [pipelineName, setPipelineName] = React.useState("Engineering Q3");
  const [stages, setStages] = React.useState(DEFAULT_RECRUITMENT_STAGES);
  const [pipelineId, setPipelineId] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [stage, setStage] = React.useState("applied");

  const createPipeline = useMutation({
    mutationFn: (body: RecruitmentPipelineRequest) =>
      postJson<HrRecruitmentPipelineResponse>(
        "/api/hr/recruitment/pipelines",
        body as unknown as JsonBody,
        HrRecruitmentPipelineResponseSchema,
      ),
    onSuccess: (data) => {
      if (data?.pipeline?.id) setPipelineId(data.pipeline.id);
    },
  });

  const addCandidate = useMutation({
    mutationFn: (body: RecruitmentCandidateRequest) =>
      postJson<HrRecruitmentCandidateResponse>(
        "/api/hr/recruitment/candidates",
        body as unknown as JsonBody,
        HrRecruitmentCandidateResponseSchema,
      ),
  });

  const submitPipeline = (event: React.FormEvent) => {
    event.preventDefault();
    if (!pipelineName) return;
    const stageList = stages
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (stageList.length === 0) return;
    createPipeline.mutate({
      name: pipelineName,
      stages: stageList,
      idempotencyKey: idempotencyKey("pipe"),
    });
  };

  const submitCandidate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!pipelineId || !fullName) return;
    addCandidate.mutate({
      pipelineId,
      fullName,
      email: email.trim() || undefined,
      stage: stage || "applied",
      idempotencyKey: idempotencyKey("cand"),
    });
  };

  return (
    <PanelFrame
      title="Recruitment pipeline"
      subtitle="Հավաքագրման խողովակ"
      testId="hr-recruitment"
    >
      <PanelHeader label="A1 People / HR" />

      <form
        onSubmit={submitPipeline}
        className="flex flex-wrap items-end gap-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
        data-testid="hr-recruitment-pipeline-form"
      >
        <Field label="Խողովակի անուն" className="min-w-[12rem] flex-1">
          <input
            value={pipelineName}
            onChange={(e) => setPipelineName(e.target.value)}
            className="form-input w-full"
            placeholder="Խողովակի անուն"
          />
        </Field>
        <Field label="Փուլեր (ստորակետով)" className="min-w-[16rem] flex-1">
          <input
            value={stages}
            onChange={(e) => setStages(e.target.value)}
            className="form-input w-full"
            placeholder="Փուլեր (ստորակետով)"
          />
        </Field>
        <button
          type="submit"
          disabled={createPipeline.isPending}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-on-brand)] hover:opacity-90 disabled:opacity-50"
        >
          {createPipeline.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Ստեղծել խողովակ
        </button>
      </form>

      <form
        onSubmit={submitCandidate}
        className="flex flex-wrap items-end gap-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
        data-testid="hr-recruitment-candidate-form"
      >
        <Field label="Խողովակի ID">
          <input
            value={pipelineId}
            onChange={(e) => setPipelineId(e.target.value)}
            className="form-input w-40"
            placeholder="Խողովակի ID"
          />
        </Field>
        <Field label="Անուն Ազգանուն" className="min-w-[12rem] flex-1">
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="form-input w-full"
            placeholder="Անուն Ազգանուն"
          />
        </Field>
        <Field label="Էլ. փոստ" className="min-w-[12rem] flex-1">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="form-input w-full"
            placeholder="Էլ. փոստ"
          />
        </Field>
        <Field label="Փուլ">
          <input
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="form-input w-32"
            placeholder="Փուլ"
          />
        </Field>
        <button
          type="submit"
          disabled={addCandidate.isPending}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] disabled:opacity-50"
        >
          {addCandidate.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Ավելացնել թեկնածու
        </button>
      </form>

      {(createPipeline.isError || addCandidate.isError) && (
        <p className="text-[var(--text-xs)] text-[var(--color-tag-red)]" data-testid="hr-recruitment-error">
          {((createPipeline.error ?? addCandidate.error) as Error)?.message}
        </p>
      )}

      {createPipeline.data && (
        <div
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="hr-recruitment-pipeline-result"
        >
          Խողովակ #{createPipeline.data.pipeline.id}: {createPipeline.data.pipeline.stages.length} փուլ
        </div>
      )}

      {addCandidate.data && (
        <div
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="hr-recruitment-candidate-result"
        >
          Թեկնածու #{addCandidate.data.candidate.id}: {addCandidate.data.candidate.fullName} (
          {addCandidate.data.candidate.stage})
        </div>
      )}
    </PanelFrame>
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

function PanelHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-line)] pb-2">
      <span className="text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">{label}</span>
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
