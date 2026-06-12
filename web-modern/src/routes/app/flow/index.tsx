/**
 * /app/flow — Flow (workflow automation) workspace:
 * rules | approvals | runs.
 *
 * Mirrors finance/ purchase/ people/ docs/ pattern (Pattern A from
 * the plan §3.5). The home route is a ViewSwitcher over three
 * surfaces:
 *
 *   - **Rules**      — automation rules (trigger/action, enabled, last dry-run)
 *   - **Approvals**  — pending/approved/rejected/executed approval queue
 *   - **Runs**       — workflow run history
 *
 * URL state:
 *   ?view=rules | approvals | runs
 *
 * Data (requires app=flow access):
 *   - GET /api/workflow/rules
 *   - GET /api/workflow/approvals
 *   - GET /api/workflow/runs
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Workflow, ChevronLeft, CircleSlash, Plug } from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  AutomationRulesResponseSchema,
  WorkflowApprovalsResponseSchema,
  WorkflowRunsResponseSchema,
  type AutomationRule,
  type AutomationRulesResponse,
  type WorkflowApproval,
  type WorkflowApprovalsResponse,
  type WorkflowRun,
  type WorkflowRunsResponse,
} from "../../../lib/api/schemas";
import { ViewSwitcher } from "../../../components/view-switcher/ViewSwitcher";
import { cn } from "../../../lib/utils/cn";
import {
  approvedCount,
  approvalRequiredRuleCount,
  classifyApprovalStatus,
  classifyRiskLevel,
  classifyRunStatus,
  compareApprovalsByRiskThenDateDesc,
  compareRulesByNameAsc,
  compareRunsByStartedAtDesc,
  enabledRuleCount,
  executedCount,
  failedRunCount,
  formatRelativeDate,
  formatRiskLabel,
  formatStatusLabel,
  pendingApprovalCount,
  rejectedCount,
  ruleEnabledTone,
  succeededRunCount,
  type ApprovalTone,
  type RiskTone,
  type RuleEnabledTone,
  type RunTone,
} from "../../../lib/flow/status";

/* ────────── typed URL search ────────── */

type View = "rules" | "approvals" | "runs";

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "rules", label: "Rules" },
  { value: "approvals", label: "Approvals" },
  { value: "runs", label: "Runs" },
];

export const Route = createFileRoute("/app/flow/")({
  validateSearch: (raw) => {
    const v: View =
      raw.view === "approvals" || raw.view === "runs" ? raw.view : "rules";
    return { view: v };
  },
  component: FlowWorkspace,
});

/* ────────── tones ────────── */

const APPROVAL_TONE: Record<ApprovalTone, { bg: string; fg: string }> = {
  pending: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
  },
  approved: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
  },
  rejected: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
  },
  executed: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
  },
};

const RISK_TONE: Record<RiskTone, { bg: string; fg: string }> = {
  legal: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
  },
  financial: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
  },
  operational: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
  },
};

const RUN_TONE: Record<RunTone, { bg: string; fg: string }> = {
  running: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
  },
  succeeded: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
  },
  failed: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
  },
  cancelled: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
  },
};

const RULE_TONE: Record<RuleEnabledTone, { bg: string; fg: string; label: string }> = {
  enabled: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Enabled",
  },
  disabled: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "Disabled",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "Unknown",
  },
};

/* ────────── root component ────────── */

function FlowWorkspace() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view: View = search.view;
  const setView = (next: View) => navigate({ search: { view: next }, replace: true });

  const rulesQ = useQuery({
    queryKey: ["flow-rules"],
    queryFn: async () => {
      const raw = await getJson("/api/workflow/rules");
      return AutomationRulesResponseSchema.parse(raw) as AutomationRulesResponse;
    },
  });
  const approvalsQ = useQuery({
    queryKey: ["flow-approvals"],
    queryFn: async () => {
      const raw = await getJson("/api/workflow/approvals");
      return WorkflowApprovalsResponseSchema.parse(raw) as WorkflowApprovalsResponse;
    },
  });
  const runsQ = useQuery({
    queryKey: ["flow-runs"],
    queryFn: async () => {
      const raw = await getJson("/api/workflow/runs");
      return WorkflowRunsResponseSchema.parse(raw) as WorkflowRunsResponse;
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ViewSwitcher options={VIEW_OPTIONS} value={view} onChange={setView} />
        <div className="flex items-center gap-3">
          <Link
            to="/app/flow/integrations"
            search={{ view: "connectors" }}
            data-testid="flow-manage-integrations-link"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
          >
            <Plug className="size-3.5" />
            Manage integrations
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

      {view === "rules" && (
        <RulesView
          data={rulesQ.data}
          loading={rulesQ.isLoading}
          error={rulesQ.isError}
        />
      )}
      {view === "approvals" && (
        <ApprovalsView
          data={approvalsQ.data}
          loading={approvalsQ.isLoading}
          error={approvalsQ.isError}
        />
      )}
      {view === "runs" && (
        <RunsView
          data={runsQ.data}
          loading={runsQ.isLoading}
          error={runsQ.isError}
        />
      )}
    </div>
  );
}

/* ────────── page header ────────── */

function PageHeader() {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <Workflow className="size-3" />
        Flow
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">Flow</h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Կանոններ · Հաստատումներ · Գործարկումներ
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

/* ────────── pill helper ────────── */

function Pill({
  label,
  tone,
}: {
  label: string;
  tone: { bg: string; fg: string };
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        tone.bg,
        tone.fg,
      )}
    >
      {label}
    </span>
  );
}

/* ────────── helpers to read data ────────── */

function readRules(data: { rules?: AutomationRule[] } | undefined): AutomationRule[] {
  return data?.rules ?? [];
}
function readApprovals(data: { approvals?: WorkflowApproval[] } | undefined): WorkflowApproval[] {
  return data?.approvals ?? [];
}
function readRuns(data: { runs?: WorkflowRun[] } | undefined): WorkflowRun[] {
  return data?.runs ?? [];
}

/* ────────── Rules view ────────── */

function RulesView({
  data,
  loading,
  error,
}: {
  data: { rules?: AutomationRule[] } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading rules…</p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load rules.
      </p>
    );
  }

  const rules = readRules(data).slice().sort(compareRulesByNameAsc);
  if (rules.length === 0) {
    return <EmptyState message="No automation rules yet." />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Total rules" value={String(rules.length)} hint="Ընդհանուր կանոններ" />
        <KpiCard
          label="Enabled"
          value={String(enabledRuleCount(rules))}
          hint="Միացված"
          tone="positive"
        />
        <KpiCard
          label="Approval required"
          value={String(approvalRequiredRuleCount(rules))}
          hint="Հաստատման կարիք"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="flow-automation-rule"
        data-count={String(rules.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Name</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Trigger</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Action</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Status</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Last dry-run</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {rules.map((r) => {
              const tone = ruleEnabledTone(r);
              return (
                <tr key={r.id} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2">
                    <Link
                      to="/app/flow/$ruleId"
                      params={{ ruleId: r.id }}
                      className="text-[var(--color-ink)] hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-[var(--color-muted)]">{r.trigger ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[var(--color-muted)]">{r.action ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Pill label={RULE_TONE[tone].label} tone={{ bg: RULE_TONE[tone].bg, fg: RULE_TONE[tone].fg }} />
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {r.lastDryRun
                      ? formatRelativeDate(r.lastDryRun.createdAt)
                      : "—"}
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

/* ────────── Approvals view ────────── */

function ApprovalsView({
  data,
  loading,
  error,
}: {
  data: { approvals?: WorkflowApproval[] } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading approvals…</p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load approvals.
      </p>
    );
  }

  const approvals = readApprovals(data).slice().sort(compareApprovalsByRiskThenDateDesc);
  if (approvals.length === 0) {
    return <EmptyState message="No approval requests." />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Pending"
          value={String(pendingApprovalCount(approvals))}
          hint="Սպասող"
          tone="negative"
        />
        <KpiCard
          label="Approved"
          value={String(approvedCount(approvals))}
          hint="Հաստատված"
          tone="positive"
        />
        <KpiCard
          label="Executed"
          value={String(executedCount(approvals))}
          hint="Կատարված"
        />
        <KpiCard
          label="Rejected"
          value={String(rejectedCount(approvals))}
          hint="Մերժված"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="flow-approval"
        data-count={String(approvals.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Title</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Risk</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Status</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Customer</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Requested</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {approvals.map((a) => {
              const aTone = classifyApprovalStatus(a);
              const rTone = classifyRiskLevel(a);
              return (
                <tr key={a.id} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2 text-[var(--color-ink)]">{a.title ?? a.actionKey ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Pill label={formatRiskLabel(a.riskLevel)} tone={RISK_TONE[rTone]} />
                  </td>
                  <td className="px-3 py-2">
                    <Pill label={formatStatusLabel(a.status)} tone={APPROVAL_TONE[aTone]} />
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{a.customerName ?? "—"}</td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {formatRelativeDate(a.createdAt)}
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

/* ────────── Runs view ────────── */

function RunsView({
  data,
  loading,
  error,
}: {
  data: { runs?: WorkflowRun[] } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading runs…</p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load runs.
      </p>
    );
  }

  const runs = readRuns(data).slice().sort(compareRunsByStartedAtDesc);
  if (runs.length === 0) {
    return <EmptyState message="No workflow runs yet." />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Total runs" value={String(runs.length)} hint="Ընդհանուր գործարկումներ" />
        <KpiCard
          label="Succeeded"
          value={String(succeededRunCount(runs))}
          hint="Հաջողված"
          tone="positive"
        />
        <KpiCard
          label="Failed"
          value={String(failedRunCount(runs))}
          hint="Ձախողված"
          tone="negative"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="flow-run"
        data-count={String(runs.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Action</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Status</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Customer</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Started</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Completed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {runs.map((r) => {
              const tone = classifyRunStatus(r);
              return (
                <tr key={r.id} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2 font-mono text-[var(--color-ink)]">{r.actionKey ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Pill label={formatStatusLabel(r.status)} tone={RUN_TONE[tone]} />
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{r.customerName ?? "—"}</td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{formatRelativeDate(r.startedAt)}</td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{formatRelativeDate(r.completedAt)}</td>
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
