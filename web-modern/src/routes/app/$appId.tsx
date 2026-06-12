/**
 * /app/$appId — per-app catch-all.
 *
 * Phase 8 done: most appId routes are thin wrappers around the migrated
 * module UIs at /app/<module>/... See lib/<module>/ for the panel
 * components. This file remains as the catch-all for any app whose
 * dedicated subroute has not been migrated yet — the rendered body is
 * a "this module is on the way" stub (see the placeholder below).
 */
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChevronLeft, Sparkles } from "lucide-react";
import { APPS, APP_IDS, type AppId } from "../../lib/apps";

export const Route = createFileRoute("/app/$appId")({
  validateSearch: () => ({}),
  beforeLoad: ({ params }) => {
    if (!APP_IDS.includes(params.appId as AppId)) {
      throw notFound();
    }
  },
  component: AppPage,
});

function AppPage() {
  const { appId } = Route.useParams();
  const meta = APPS[appId as AppId];
  const Icon = meta.icon;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <Link
        to="/app"
        className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        Today
      </Link>

      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
          <Icon className="size-5" />
        </span>
        <div>
          <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
            {meta.label}
          </h1>
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
            {meta.labelAm} — {meta.tagline}
          </p>
        </div>
      </header>

      <div
        className={cn(
          "rounded-[var(--radius-xl)] border border-dashed border-[var(--color-line)]",
          "bg-[var(--color-surface)] p-8 text-center",
          "border-dashed",
        )}
      >
        <Sparkles className="mx-auto mb-2 size-6 text-[var(--color-agent)]" />
        <h2 className="text-[var(--text-md)] font-semibold text-[var(--color-ink)]">
          {meta.label} UI lands in Phase {phaseFor(appId as AppId)}
        </h2>
        <p className="mx-auto mt-1 max-w-md text-[var(--text-sm)] text-[var(--color-muted)]">
          The shell is up; this module's list / kanban / detail views and its
          right-rail AI Action Panel will be built in their phase.
        </p>
      </div>
    </div>
  );
}

function phaseFor(id: AppId): 1 | 2 | 3 | 4 {
  if (id === "desk") return 1;
  if (id === "crm" || id === "inventory") return 2;
  if (
    id === "finance" ||
    id === "people" ||
    id === "purchase" ||
    id === "docs" ||
    id === "cfo"
  )
    return 3;
  return 4;
}

// Tiny cn used for the dashed border consistency.
function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
