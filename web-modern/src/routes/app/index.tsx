/**
 * /app — the Today / Exceptions feed.
 *
 * Per the plan §3.2 pattern #1, this is the new home of the app, NOT
 * "recent items". Surfaces three things, ordered by what needs the
 * user's attention first:
 *
 *   1. EXCEPTIONS — service cases that are SLA-at-risk or breached, plus
 *      any other high-priority unowned work. Tappable → Desk detail.
 *   2. AWAITING APPROVAL — workflow approvals from the deterministic
 *      layer (Salesforce-style "AI prepared → human approved → executed"
 *      state machine). Each row is a quick approve/reject handle.
 *   3. COMPLETED TODAY — cases resolved in the last 24h, so the user
 *      sees what the system (and the agents) just finished.
 *
 * Data source: /api/service/console (server/app.js:4612). One round-trip
 * powers all three widgets + the Desk module, since the response carries
 * `cases`, `approvals`, and `runs` in one envelope.
 *
 * The /api/* call uses the Bearer-sid from sessionStorage (see
 * lib/api/client.ts) — the same token the Desk module uses.
 *
 * No new agent framework is needed for Phase 1.1. The "AI prepared" half
 * of the human-in-the-loop is a placeholder row in the approvals widget;
 * the agent layer lands in Phase 1.2 (Mission Control) and 1.3 (AI
 * Action Panel). Today just shows the deterministic data the user
 * already needs to act on.
 */
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronRight,
  Sparkles,
  Timer,
  Inbox,
} from "lucide-react";
import { APPS, appLinkTo, type AppId } from "../../lib/apps";
import { getJson } from "../../lib/api/client";
import { ServiceConsoleSchema, type ServiceCase } from "../../lib/api/schemas";
import { cn } from "../../lib/utils/cn";
import { Kbd } from "../../components/ui/Kbd";
import { HybridBadge } from "../../components/ui/HybridBadge";

export const Route = createFileRoute("/app/")({
  component: TodayFeed,
});

/* ────────────── derivations ────────────── */

/** Cases that need attention NOW: open/in-progress/waiting, NOT on-track. */
function exceptionsFrom(cases: readonly ServiceCase[]): ServiceCase[] {
  return cases
    .filter((c) => c.status !== "resolved" && c.status !== "closed")
    .filter((c) => c.slaStatus === "at-risk" || c.slaStatus === "breached" || c.priority === "high")
    .slice(0, 5);
}

/** Resolved in the last 24h, most recent first. */
function completedTodayFrom(cases: readonly ServiceCase[]): ServiceCase[] {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return cases
    .filter((c) => c.status === "resolved" || c.status === "closed")
    .filter((c) => c.updatedAt && new Date(c.updatedAt).getTime() >= dayAgo)
    .slice(0, 5);
}

/* ────────────── component ────────────── */

function TodayFeed() {
  // /api/service/console carries everything Today needs. TanStack Query
  // gives us loading + error + cached refetch on focus for free.
  const consoleQuery = useQuery({
    queryKey: ["service", "console"],
    queryFn: () => getJson("/api/service/console", ServiceConsoleSchema),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const cases = consoleQuery.data?.cases ?? [];
  const approvals = consoleQuery.data?.approvals ?? [];
  const exceptions = exceptionsFrom(cases);
  const completedToday = completedTodayFrom(cases);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <header>
        <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
          Today
        </h1>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Exceptions, decisions waiting for you, and what the agents are doing.
        </p>
      </header>

      {/* Three counter cards — the "headline" of the feed. */}
      <div className="grid gap-3 md:grid-cols-3">
        <ExceptionCard
          icon={AlertTriangle}
          label="Exceptions"
          count={exceptions.length}
          loading={consoleQuery.isLoading}
          tone={exceptions.length > 0 ? "warn" : "ok"}
          hint={
            exceptions.length > 0
              ? "SLA at-risk or high-priority unowned cases."
              : "No SLA breaches or high-priority unowned cases."
          }
        />
        <ExceptionCard
          icon={Clock}
          label="Awaiting your approval"
          count={approvals.filter((a) => a.status === "pending").length}
          loading={consoleQuery.isLoading}
          tone="info"
          hint={
            approvals.length > 0
              ? "Workflow rules staged for human sign-off."
              : "No decisions need you right now."
          }
        />
        <ExceptionCard
          icon={CheckCircle2}
          label="Completed today"
          count={completedToday.length}
          loading={consoleQuery.isLoading}
          tone="ok"
          hint={
            completedToday.length > 0
              ? "Cases resolved in the last 24 hours."
              : "No cases resolved yet today."
          }
        />
      </div>

      {/* EXCEPTIONS widget — the highest-priority feed. Deep-links to Desk. */}
      <TodaySection
        icon={AlertTriangle}
        title="Exceptions"
        loading={consoleQuery.isLoading}
        error={consoleQuery.error}
        isEmpty={exceptions.length === 0}
        emptyState={<EmptyState icon={Inbox} text="Nothing on fire. Carry on." />}
        seeAllHref="/app/desk?status=open"
        seeAllLabel="Open all in Desk"
      >
        <ul className="divide-y divide-[var(--color-line)]">
          {exceptions.map((c) => (
            <li key={c.id}>
              <CaseRow case={c} />
            </li>
          ))}
        </ul>
      </TodaySection>

      {/* APPROVALS widget — the deterministic half of human-in-the-loop. */}
      <TodaySection
        icon={Clock}
        title="Awaiting your approval"
        badge={<HybridBadge kind="rule" />}
        loading={consoleQuery.isLoading}
        error={consoleQuery.error}
        isEmpty={approvals.length === 0}
        emptyState={
          <EmptyState
            icon={CheckCircle2}
            text="No workflow rules are waiting on you."
          />
        }
      >
        <ul className="divide-y divide-[var(--color-line)]">
          {approvals.slice(0, 5).map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--color-surface-soft)]"
            >
              <Sparkles className="size-3.5 shrink-0 text-[var(--color-agent)]" aria-hidden />
              <span className="flex-1 truncate text-[var(--text-sm)] text-[var(--color-ink)]">
                {labelForApproval(a)}
              </span>
              <HybridBadge kind="rule" />
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                {a.status}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 px-3 text-[11px] text-[var(--color-muted)]">
          The <Kbd>agent</Kbd> + <Kbd>rule</Kbd> badges mark the hybrid
          split. Agent rows are AI-prepared, rule rows are deterministic
          workflow steps. Both need your sign-off.
        </p>
      </TodaySection>

      {/* COMPLETED widget — what just happened. */}
      <TodaySection
        icon={CheckCircle2}
        title="Completed today"
        loading={consoleQuery.isLoading}
        error={consoleQuery.error}
        isEmpty={completedToday.length === 0}
        emptyState={<EmptyState icon={Timer} text="No resolutions in the last 24 hours." />}
        seeAllHref="/app/desk?status=resolved"
        seeAllLabel="All resolved"
      >
        <ul className="divide-y divide-[var(--color-line)]">
          {completedToday.map((c) => (
            <li key={c.id}>
              <CaseRow case={c} dimmed />
            </li>
          ))}
        </ul>
      </TodaySection>

      {/* Quick links — same grid as the App Launcher, smaller. */}
      <section>
        <h2 className="mb-2 text-[var(--text-md)] font-semibold text-[var(--color-ink)]">
          Or jump to an app
        </h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {Object.values(APPS).map((app) => (
            <AppQuickLink key={app.id} id={app.id} />
          ))}
        </div>
      </section>
    </div>
  );
}

/* ────────────── subcomponents ────────────── */

function ExceptionCard({
  icon: Icon,
  label,
  count,
  hint,
  loading,
  tone,
}: {
  icon: typeof AlertTriangle;
  label: string;
  count: number;
  hint: string;
  loading?: boolean;
  tone?: "warn" | "info" | "ok";
}) {
  // Tone maps to the 3 status colors. The exception card uses
  // copper (warn) when there are items, muted (ok) when there aren't.
  // Approval card always blue (info), completed always green.
  const accent =
    tone === "warn"
      ? "text-[var(--color-copper)]"
      : tone === "info"
        ? "text-[var(--color-blue)]"
        : "text-[var(--color-success)]";
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 text-[var(--color-muted)]">
        <Icon className={cn("size-4", accent)} aria-hidden />
        <span className="text-[var(--text-xs)] font-semibold uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div
        className={cn(
          "mt-2 text-[var(--text-2xl)] font-semibold",
          loading ? "text-[var(--color-muted)]" : "text-[var(--color-ink)]",
        )}
      >
        {loading ? "—" : count}
      </div>
      <p className="mt-1 text-[var(--text-xs)] text-[var(--color-muted)]">{hint}</p>
    </div>
  );
}

function TodaySection({
  icon: Icon,
  title,
  badge,
  loading,
  error,
  isEmpty,
  emptyState,
  seeAllHref,
  seeAllLabel,
  children,
}: {
  icon: typeof AlertTriangle;
  title: string;
  badge?: React.ReactNode;
  loading?: boolean;
  error?: Error | null;
  isEmpty: boolean;
  emptyState: React.ReactNode;
  seeAllHref?: string;
  seeAllLabel?: string;
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
        {seeAllHref && seeAllLabel && !isEmpty && (
          <Link
            to={seeAllHref}
            className="inline-flex items-center gap-1 text-[var(--text-xs)] text-[var(--color-muted)] hover:text-[var(--color-brand)]"
          >
            {seeAllLabel}
            <ChevronRight className="size-3" />
          </Link>
        )}
      </header>
      <div className="p-2">
        {error ? (
          <p className="px-3 py-4 text-[var(--text-sm)] text-[var(--color-ruby)]">
            Couldn't load: {error.message}
          </p>
        ) : loading ? (
          <p className="px-3 py-4 text-[var(--text-sm)] text-[var(--color-muted)]">Loading…</p>
        ) : isEmpty ? (
          emptyState
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function CaseRow({ case: c, dimmed }: { case: ServiceCase; dimmed?: boolean }) {
  // Tone the status chip using the 8-color tag palette.
  // Priority is a small conditional chip (only shown for "high") so it
  // doesn't need a full lookup table here.
  const statusTone = STATUS_TONE[c.status];
  return (
    <Link
      to={appLinkTo("desk").to}
      params={appLinkTo("desk").params}
      search={{ case: c.id }}
      className={cn(
        "flex items-center gap-3 px-3 py-2",
        "hover:bg-[var(--color-surface-soft)]",
        dimmed && "opacity-70",
      )}
    >
      <span className="font-mono text-[11px] text-[var(--color-muted)]">
        {c.caseNumber}
      </span>
      <span className="flex-1 truncate text-[var(--text-sm)] text-[var(--color-ink)]">
        {c.subject}
        <span className="ml-2 text-[var(--color-muted)]">· {c.customerName}</span>
      </span>
      <HybridBadge kind={dimmed ? "resolved" : "agent"} />
      {c.priority === "high" && (
        <span
          className={cn(
            "rounded-[var(--radius-sm)] px-1.5 py-0.5",
            "text-[10px] font-semibold uppercase tracking-wider",
            "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
            "text-[var(--color-tag-red)]",
          )}
        >
          {c.priority}
        </span>
      )}
      <span
        className={cn(
          "rounded-[var(--radius-sm)] px-1.5 py-0.5",
          "text-[10px] font-semibold uppercase tracking-wider",
          statusTone.bg,
          statusTone.fg,
        )}
      >
        {c.status}
      </span>
      {c.slaStatus && c.slaStatus !== "on-track" && (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5",
            "text-[10px] font-semibold uppercase tracking-wider",
            c.slaStatus === "breached"
              ? "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)] text-[var(--color-tag-red)]"
              : "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)] text-[var(--color-tag-orange)]",
          )}
          title={`SLA ${c.slaStatus}`}
        >
          <Timer className="size-2.5" aria-hidden />
          {c.slaStatus}
        </span>
      )}
    </Link>
  );
}

function EmptyState({ icon: Icon, text }: { icon: typeof Inbox; text: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-3 py-6 text-center">
      <Icon className="size-5 text-[var(--color-muted)]" aria-hidden />
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">{text}</p>
    </div>
  );
}

function AppQuickLink({ id }: { id: AppId }) {
  const meta = APPS[id];
  if (!meta) throw notFound();
  const Icon = meta.icon;
  return (
    <Link
      to={appLinkTo(id).to}
      params={appLinkTo(id).params}
      className={cn(
        "group flex items-center gap-2 rounded-[var(--radius-lg)]",
        "border border-[var(--color-line)] bg-[var(--color-surface)] p-3",
        "hover:border-[var(--color-brand)] hover:bg-[var(--color-surface-soft)]",
        "transition-colors",
      )}
    >
      <Icon className="size-4 text-[var(--color-brand)]" />
      <span className="text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        {meta.label}
      </span>
    </Link>
  );
}

/* ────────────── helpers ────────────── */

const STATUS_TONE: Record<
  string,
  { bg: string; fg: string }
> = {
  open: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
  },
  "in-progress": {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-violet)_15%,transparent)]",
    fg: "text-[var(--color-tag-violet)]",
  },
  "waiting-customer": {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-yellow)_15%,transparent)]",
    fg: "text-[var(--color-tag-yellow)]",
  },
  escalated: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
  },
  resolved: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
  },
  closed: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-teal)_15%,transparent)]",
    fg: "text-[var(--color-tag-teal)]",
  },
};

/** Loose label for an approval row. The backend schema is rich but the
 *  Today widget only needs a short preview. */
function labelForApproval(a: { id: string; status: string; [k: string]: unknown }): string {
  // The backend stores ruleId / subjectType / etc. We pick the most
  // human-friendly field available.
  const candidate =
    (a.title as string | undefined) ??
    (a.subject as string | undefined) ??
    (a.summary as string | undefined) ??
    (a.ruleId as string | undefined) ??
    a.id;
  return typeof candidate === "string" ? candidate : a.id;
}
