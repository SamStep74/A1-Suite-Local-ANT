/**
 * /app/copilot — Agent Mission Control.
 *
 * Per the plan §3.2 pattern #3, this is the Creatio-style AI Command
 * Center: the operations dashboard for AI work. It replaced the legacy
 * "copilot" app (which was a basic chat surface) with a five-widget view
 * of the agentic layer.
 *
 * What it shows:
 *   - KPI cards: running agents, blocked, awaiting approval, done today,
 *     errors in the last 24h
 *   - Awaiting approval widget: the same approvals list as Today, but
 *     bigger and with inline approve/reject
 *   - Recent runs widget: the last 5 workflow executions with status pills
 *   - Active rules widget: which automation rules are enabled, last dry-run
 *
 * What it does NOT show (yet):
 *   - The actual agent framework. Phase 1.2 wires the *shell*. The
 *     Mission Control page is the destination for the agent framework
 *     that lands in Phase 4 (Agent Store + Agent Studio + Workflow
 *     Builder). Until then, the "agent" KPI card shows 0 and the
 *     "running/blocked/error" panels are derived from the deterministic
 *     workflow runs that the backend already records.
 *
 * Data source: /api/service/console (one round-trip).
 */
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertOctagon,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  KeyRound,
  Pause,
  Play,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { getJson } from "../../lib/api/client";
import {
  ServiceConsoleSchema,
  type WorkflowApproval,
  type WorkflowRule,
  type WorkflowRun,
} from "../../lib/api/schemas";
import { HybridBadge } from "../../components/ui/HybridBadge";
import { cn } from "../../lib/utils/cn";
import { appLinkTo } from "../../lib/apps";

export const Route = createFileRoute("/app/copilot")({
  component: MissionControl,
});

/* ────────────── derivations ────────────── */

function kpisFrom(data: { runs: WorkflowRun[]; approvals: WorkflowApproval[] } | null | undefined) {
  const runs = data?.runs ?? [];
  const approvals = data?.approvals ?? [];
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return {
    running: runs.filter((r) => r.status === "running" || r.status === "pending").length,
    blocked: runs.filter((r) => r.status === "failed").length,
    awaitingApproval: approvals.filter((a) => a.status === "pending").length,
    doneToday: runs.filter(
      (r) =>
        r.status === "completed" &&
        r.completedAt &&
        new Date(r.completedAt).getTime() >= dayAgo,
    ).length,
    errorsLast24h: runs.filter(
      (r) =>
        r.status === "failed" &&
        r.completedAt &&
        new Date(r.completedAt).getTime() >= dayAgo,
    ).length,
  };
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

/* ────────────── component ────────────── */

function MissionControl() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname !== "/app/copilot") {
    return <Outlet />;
  }

  const consoleQuery = useQuery({
    queryKey: ["service", "console"],
    queryFn: () => getJson("/api/service/console", ServiceConsoleSchema),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const data = consoleQuery.data;
  const kpis = kpisFrom(data);
  const approvals = data?.approvals ?? [];
  const recentRuns = [...(data?.runs ?? [])]
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))
    .slice(0, 5);
  const activeRules = (data?.rules ?? []).filter((r) => r.enabled);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-[var(--color-agent)]" aria-hidden />
            <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
              Mission Control
            </h1>
          </div>
          <Link
            to="/app/copilot/onboarding"
            data-testid="mission-control-onboarding-link"
            data-entity="copilot-mission-control-onboarding-link"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
          >
            <KeyRound className="size-3.5" aria-hidden />
            AI Provider setup
          </Link>
        </div>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          What the agents and rules are doing, what's waiting on you, and
          what's gone wrong. Updated live.
        </p>
      </header>

      {/* KPI strip — five counters, color-coded by health. */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <KpiCard
          icon={Activity}
          label="Running"
          value={kpis.running}
          tone="info"
          loading={consoleQuery.isLoading}
        />
        <KpiCard
          icon={Pause}
          label="Awaiting you"
          value={kpis.awaitingApproval}
          tone={kpis.awaitingApproval > 0 ? "warn" : "ok"}
          loading={consoleQuery.isLoading}
        />
        <KpiCard
          icon={CheckCircle2}
          label="Done today"
          value={kpis.doneToday}
          tone="ok"
          loading={consoleQuery.isLoading}
        />
        <KpiCard
          icon={AlertOctagon}
          label="Errors 24h"
          value={kpis.errorsLast24h}
          tone={kpis.errorsLast24h > 0 ? "danger" : "ok"}
          loading={consoleQuery.isLoading}
        />
        <KpiCard
          icon={Bot}
          label="Active rules"
          value={activeRules.length}
          tone="violet"
          loading={consoleQuery.isLoading}
        />
      </div>

      {/* Two-column layout on md+: Approvals + Recent Runs side by side. */}
      <div className="grid gap-4 md:grid-cols-2">
        <AwaitingApprovals
          loading={consoleQuery.isLoading}
          error={consoleQuery.error}
          approvals={approvals}
        />
        <RecentRuns loading={consoleQuery.isLoading} runs={recentRuns} />
      </div>

      <ActiveRules loading={consoleQuery.isLoading} rules={activeRules} />

      <p className="text-center text-[11px] text-[var(--color-muted)]">
        The agent framework lands in Phase 4. Until then, this page shows
        the deterministic workflow layer; agent KPIs reflect what
        <HybridBadge kind="agent" className="mx-1" /> +{" "}
        <HybridBadge kind="rule" className="mx-1" />
        rules have actually executed.
      </p>
    </div>
  );
}

/* ────────────── subcomponents ────────────── */

function KpiCard({
  icon: Icon,
  label,
  value,
  loading,
  tone = "ok",
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  loading?: boolean;
  tone?: "ok" | "warn" | "danger" | "info" | "violet";
}) {
  const toneClass = {
    ok: "text-[var(--color-success)]",
    warn: "text-[var(--color-copper)]",
    danger: "text-[var(--color-ruby)]",
    info: "text-[var(--color-blue)]",
    violet: "text-[var(--color-agent)]",
  }[tone];
  return (
    <div className="panel p-3">
      <div className="flex items-center gap-1.5 text-[var(--color-muted)]">
        <Icon className={cn("size-3.5", toneClass)} aria-hidden />
        <span className="text-[10px] font-semibold uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div
        className={cn(
          "mt-1.5 text-[var(--text-2xl)] font-semibold",
          loading ? "text-[var(--color-muted)]" : "text-[var(--color-ink)]",
        )}
      >
        {loading ? "—" : value}
      </div>
    </div>
  );
}

function AwaitingApprovals({
  loading,
  error,
  approvals,
}: {
  loading?: boolean;
  error?: Error | null;
  approvals: WorkflowApproval[];
}) {
  return (
    <Panel
      title="Awaiting your approval"
      icon={Clock}
      badge={<HybridBadge kind="rule" />}
      loading={loading}
      error={error}
      isEmpty={approvals.length === 0}
      empty="No decisions need you right now."
    >
      <ul className="divide-y divide-[var(--color-line)]">
        {approvals.slice(0, 6).map((a) => (
          <li
            key={a.id}
            className="flex items-start gap-3 px-3 py-2 hover:bg-[var(--color-surface-soft)]"
          >
            <Sparkles
              className="mt-0.5 size-3.5 shrink-0 text-[var(--color-agent)]"
              aria-hidden
            />
            <div className="flex-1 min-w-0">
              <p className="truncate text-[var(--text-sm)] text-[var(--color-ink)]">
                {labelFor(a)}
              </p>
              {reasonFor(a) && (
                <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                  {reasonFor(a)}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                title="Approve"
                aria-label="Approve"
                disabled
                className={cn(
                  "rounded-[var(--radius-sm)] p-1",
                  "border border-[color-mix(in_srgb,var(--color-success)_30%,transparent)]",
                  "text-[var(--color-success)]",
                  "disabled:opacity-50",
                )}
              >
                <Check className="size-3" />
              </button>
              <button
                type="button"
                title="Reject"
                aria-label="Reject"
                disabled
                className={cn(
                  "rounded-[var(--radius-sm)] p-1",
                  "border border-[color-mix(in_srgb,var(--color-ruby)_30%,transparent)]",
                  "text-[var(--color-ruby)]",
                  "disabled:opacity-50",
                )}
              >
                <X className="size-3" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="px-3 pb-1 pt-2 text-[10px] text-[var(--color-muted)]">
        Approve / reject wires up in Phase 1.4 (Decision Card).
      </p>
    </Panel>
  );
}

function RecentRuns({
  loading,
  runs,
}: {
  loading?: boolean;
  runs: WorkflowRun[];
}) {
  return (
    <Panel
      title="Recent runs"
      icon={Zap}
      badge={<HybridBadge kind="rule" />}
      loading={loading}
      isEmpty={runs.length === 0}
      empty="No workflow runs yet."
    >
      <ul className="divide-y divide-[var(--color-line)]">
        {runs.map((r) => (
          <li
            key={r.id}
            className="flex items-center gap-3 px-3 py-2"
          >
            <RunStatusIcon status={r.status} />
            <div className="flex-1 min-w-0">
              <p className="truncate text-[var(--text-sm)] text-[var(--color-ink)]">
                {r.actionKey}
                {r.customerName ? (
                  <span className="text-[var(--color-muted)]"> · {r.customerName}</span>
                ) : null}
              </p>
              <p className="text-[10px] text-[var(--color-muted)]">
                {timeAgo(r.startedAt)}
              </p>
            </div>
            <span
              className={cn(
                "rounded-[var(--radius-sm)] px-1.5 py-0.5",
                "text-[10px] font-semibold uppercase tracking-wider",
                runTone(r.status).bg,
                runTone(r.status).fg,
              )}
            >
              {r.status}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ActiveRules({
  loading,
  rules,
}: {
  loading?: boolean;
  rules: WorkflowRule[];
}) {
  return (
    <Panel
      title="Active automation rules"
      icon={Bot}
      loading={loading}
      isEmpty={rules.length === 0}
      empty="No automation rules are enabled."
    >
      <ul className="divide-y divide-[var(--color-line)]">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className="flex items-center gap-3 px-3 py-2"
          >
            <Play className="size-3.5 shrink-0 text-[var(--color-success)]" aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="truncate text-[var(--text-sm)] text-[var(--color-ink)]">
                {rule.name}
              </p>
              <p className="text-[10px] text-[var(--color-muted)]">
                <span className="font-mono">{rule.trigger}</span>
                <span className="mx-1">→</span>
                <span className="font-mono">{rule.action}</span>
                {rule.lastDryRun && typeof (rule.lastDryRun as { ranAt?: string }).ranAt === "string" && (
                  <span className="ml-2">
                    last dry-run {timeAgo((rule.lastDryRun as { ranAt: string }).ranAt)}
                  </span>
                )}
              </p>
            </div>
            {rule.approvalRequired && <HybridBadge kind="rule" />}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RunStatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="size-3.5 shrink-0 text-[var(--color-success)]" aria-hidden />;
  if (status === "failed") return <AlertOctagon className="size-3.5 shrink-0 text-[var(--color-ruby)]" aria-hidden />;
  if (status === "running" || status === "pending")
    return <Activity className="size-3.5 shrink-0 animate-pulse text-[var(--color-blue)]" aria-hidden />;
  return <Pause className="size-3.5 shrink-0 text-[var(--color-muted)]" aria-hidden />;
}

function Panel({
  title,
  icon: Icon,
  badge,
  loading,
  error,
  isEmpty,
  empty,
  children,
}: {
  title: string;
  icon: typeof Activity;
  badge?: React.ReactNode;
  loading?: boolean;
  error?: Error | null;
  isEmpty: boolean;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-[var(--radius-xl)] border border-[var(--color-line)]",
        "bg-[var(--color-surface)]",
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Icon className="size-3.5 text-[var(--color-muted)]" aria-hidden />
          <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
            {title}
          </h2>
          {badge}
        </div>
        <Link
          to={appLinkTo("copilot").to}
          params={appLinkTo("copilot").params}
          className="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-brand)]"
          aria-label={`See all ${title}`}
        >
          <ChevronRight className="size-3" />
        </Link>
      </header>
      <div className="p-2">
        {error ? (
          <p className="px-3 py-4 text-[var(--text-sm)] text-[var(--color-ruby)]">
            Couldn't load: {error.message}
          </p>
        ) : loading ? (
          <p className="px-3 py-4 text-[var(--text-sm)] text-[var(--color-muted)]">Loading…</p>
        ) : isEmpty ? (
          <p className="px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
            {empty}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/* ────────────── helpers ────────────── */

function labelFor(a: WorkflowApproval): string {
  const t = (a as { title?: unknown }).title;
  return typeof t === "string" && t.length > 0 ? t : a.id;
}

function reasonFor(a: WorkflowApproval): string | null {
  const r = (a as { reason?: unknown }).reason;
  return typeof r === "string" && r.length > 0 ? r : null;
}

function runTone(status: string): { bg: string; fg: string } {
  if (status === "completed")
    return {
      bg: "bg-[color-mix(in_srgb,var(--color-success)_15%,transparent)]",
      fg: "text-[var(--color-success)]",
    };
  if (status === "failed")
    return {
      bg: "bg-[color-mix(in_srgb,var(--color-ruby)_15%,transparent)]",
      fg: "text-[var(--color-ruby)]",
    };
  if (status === "running" || status === "pending")
    return {
      bg: "bg-[color-mix(in_srgb,var(--color-blue)_15%,transparent)]",
      fg: "text-[var(--color-blue)]",
    };
  return {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
  };
}
