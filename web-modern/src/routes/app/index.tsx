/**
 * /app — the Today / Exceptions feed.
 *
 * Per the plan §3.2 pattern #1, this is the new home of the app, NOT
 * "recent items". Phase 0 ships an empty-state placeholder. Phase 1
 * fills it with: overdue invoices, stockouts, pending approvals,
 * expiring contracts, dropped margins, plus a "Decisions awaiting my
 * approval" widget.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { APPS, type AppId } from "../../lib/apps";
import { cn } from "../../lib/utils/cn";

export const Route = createFileRoute("/app/")({
  component: TodayFeed,
});

function TodayFeed() {
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

      <div className="grid gap-3 md:grid-cols-3">
        <ExceptionCard
          icon={AlertTriangle}
          label="Exceptions"
          count={0}
          hint="Overdue invoices, stockouts, low margins — none right now."
        />
        <ExceptionCard
          icon={Clock}
          label="Awaiting your approval"
          count={0}
          hint="No decisions need you right now."
        />
        <ExceptionCard
          icon={CheckCircle2}
          label="Completed today"
          count={0}
          hint="Agents have not finished any tasks yet."
        />
      </div>

      <section
        className={cn(
          "rounded-[var(--radius-xl)] border border-dashed border-[var(--color-line)]",
          "bg-[var(--color-surface)] p-8 text-center",
        )}
      >
        <Sparkles className="mx-auto mb-2 size-6 text-[var(--color-agent)]" />
        <h2 className="text-[var(--text-md)] font-semibold text-[var(--color-ink)]">
          Today feed lands in Phase 1
        </h2>
        <p className="mx-auto mt-1 max-w-md text-[var(--text-sm)] text-[var(--color-muted)]">
          Once the agentic layer is wired, this page will surface overdue invoices,
          stockouts, pending approvals, and dropped margins — sorted by what needs
          your attention first.
        </p>
        <p className="mt-3 text-[var(--text-xs)] text-[var(--color-muted)]">
          Press <Kbd>⌘K</Kbd> to ask the AI, or click an app in the left rail to
          start working.
        </p>
      </section>

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

function ExceptionCard({
  icon: Icon,
  label,
  count,
  hint,
}: {
  icon: typeof AlertTriangle;
  label: string;
  count: number;
  hint: string;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 text-[var(--color-muted)]">
        <Icon className="size-4" />
        <span className="text-[var(--text-xs)] font-semibold uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="mt-2 text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
        {count}
      </div>
      <p className="mt-1 text-[var(--text-xs)] text-[var(--color-muted)]">{hint}</p>
    </div>
  );
}

function AppQuickLink({ id }: { id: AppId }) {
  const meta = APPS[id];
  const Icon = meta.icon;
  return (
    <Link
      to="/app/$appId"
      params={{ appId: id }}
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

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-[var(--color-line)] bg-[var(--color-canvas)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-ink)]">
      {children}
    </kbd>
  );
}
