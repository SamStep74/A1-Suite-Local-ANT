/**
 * /app/projects/$projectId — project detail route.
 *
 * Drills into a single project from the Projects workspace. Fetches
 * `/api/projects/:id` and renders:
 *   - header with project name + status + monogram
 *   - 3 KPI cards: progress, milestones reached, total minutes
 *   - tasks table (sorted in-progress → todo → done)
 *   - milestones table (sorted by dueDate asc)
 *
 * The back-link returns to /app/projects (no view selected — the
 * projects view is the default).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, CircleSlash, Folder } from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  ProjectDetailResponseSchema,
  type ProjectDetailResponse,
  type ProjectDetail,
  type ProjectTask,
  type ProjectMilestone,
} from "../../../lib/api/schemas";
import { cn } from "../../../lib/utils/cn";
import {
  classifyProjectStatus,
  classifyTaskStatus,
  compareMilestonesByDueDateAsc,
  compareTasksByStatusOrder,
  projectProgressPct,
  milestoneReachedPct,
  formatProjectDurationHours,
  type ProjectTone,
  type TaskTone,
} from "../../../lib/projects/status";

/* ────────── typed URL search ────────── */

export const Route = createFileRoute("/app/projects/$projectId")({
  validateSearch: () => ({}),
  component: ProjectDetailRoute,
});

/* ────────── tones ────────── */

const STATUS_TONE: Record<ProjectTone, { bg: string; fg: string; label: string }> = {
  planning: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
    label: "Planning",
  },
  active: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Active",
  },
  "on-hold": {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
    label: "On hold",
  },
  completed: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "Completed",
  },
  cancelled: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
    label: "Cancelled",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "Unknown",
  },
};

const TASK_TONE: Record<TaskTone, { bg: string; fg: string }> = {
  todo: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
  },
  "in-progress": {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
  },
  done: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
  },
};

function blockedByLabel(task: ProjectTask) {
  const blockers = task.blockedBy ?? [];
  if (blockers.length === 0) return "—";
  if (blockers.length === 1) return blockers[0].title;
  return `${blockers[0].title} +${blockers.length - 1}`;
}

function blockedByTitle(task: ProjectTask) {
  const blockers = task.blockedBy ?? [];
  return blockers.map((b) => `${b.title} (${b.status})`).join(", ");
}

function taskHierarchyLabel(task: ProjectTask) {
  const parts: string[] = [];
  const parentLabel = task.parentTask?.title ?? task.parentTaskId ?? null;
  const subtasks = task.subtasks ?? [];

  if (parentLabel) parts.push(`Parent: ${parentLabel}`);
  if (subtasks.length === 1) parts.push(`Subtask: ${subtasks[0].title}`);
  if (subtasks.length > 1) parts.push(`Subtasks: ${subtasks[0].title} +${subtasks.length - 1}`);

  return parts.length > 0 ? parts.join(" | ") : null;
}

function taskHierarchyTitle(task: ProjectTask) {
  const parts: string[] = [];
  const parent = task.parentTask;
  const subtasks = task.subtasks ?? [];

  if (parent) {
    parts.push(`Parent: ${parent.title} (${parent.status})`);
  } else if (task.parentTaskId) {
    parts.push(`Parent: ${task.parentTaskId}`);
  }
  if (subtasks.length > 0) {
    parts.push(
      `Subtasks: ${subtasks.map((subtask) => `${subtask.title} (${subtask.status})`).join(", ")}`,
    );
  }

  return parts.join(" | ");
}

/* ────────── root component ────────── */

function ProjectDetailRoute() {
  const { projectId } = Route.useParams();

  const q = useQuery({
    queryKey: ["project-detail", projectId],
    queryFn: async () => {
      const raw = await getJson(`/api/projects/${encodeURIComponent(projectId)}`);
      return ProjectDetailResponseSchema.parse(raw) as ProjectDetailResponse;
    },
    enabled: Boolean(projectId),
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
        <PageHeader projectId={projectId} name={null} tone={null} />
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading project…</p>
      </div>
    );
  }

  if (q.isError || !q.data || !q.data.project) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
        <PageHeader projectId={projectId} name={null} tone={null} />
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          <CircleSlash className="mx-auto mb-2 size-5 opacity-50" />
          {q.isError ? "Failed to load project." : "No project data for this id."}
        </div>
        <BackLink />
      </div>
    );
  }

  const project: ProjectDetail = q.data.project;
  const tone = STATUS_TONE[classifyProjectStatus(project)];
  const tasks: ProjectTask[] = (project.tasks ?? [])
    .slice()
    .sort(compareTasksByStatusOrder);
  const milestones: ProjectMilestone[] = (project.milestones ?? [])
    .slice()
    .sort(compareMilestonesByDueDateAsc);
  const progress = projectProgressPct(project);
  const msProgress = milestoneReachedPct(project);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader projectId={projectId} name={project.name} tone={tone} />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Progress" value={`${progress}%`} hint="Ընդհանուր առաջընթաց" />
        <KpiCard
          label="Tasks"
          value={`${project.taskDone ?? 0}/${project.taskTotal ?? 0}`}
          hint="Ավարտված / Ընդհանուր"
        />
        <KpiCard
          label="Milestones"
          value={`${project.milestoneReached ?? 0}/${project.milestoneTotal ?? 0}`}
          hint={`${msProgress}%`}
        />
        <KpiCard
          label="Total time"
          value={formatProjectDurationHours(project.totalMinutes ?? 0)}
          hint="Ընդհանուր ժամանակ"
        />
      </section>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="projects-task"
        data-count={String(tasks.length)}
      >
        <header className="border-b border-[var(--color-line)] px-3 py-2 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          Tasks
        </header>
        <table className="w-full table-fixed text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="w-[34%] px-3 py-2 text-left font-semibold">
                Title
              </th>
              <th scope="col" className="w-[16%] px-3 py-2 text-left font-semibold">
                Status
              </th>
              <th scope="col" className="w-[22%] px-3 py-2 text-left font-semibold">
                Blocked by
              </th>
              <th scope="col" className="w-[14%] px-3 py-2 text-left font-semibold">
                Assignee
              </th>
              <th scope="col" className="w-[14%] px-3 py-2 text-left font-semibold">
                Due
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {tasks.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-4 text-center text-[var(--color-muted)]"
                >
                  No tasks yet.
                </td>
              </tr>
            ) : (
              tasks.map((t) => {
                const ttone = TASK_TONE[classifyTaskStatus(t)];
                const hierarchyLabel = taskHierarchyLabel(t);
                const hierarchyTitle = taskHierarchyTitle(t);
                return (
                  <tr key={t.id} className="hover:bg-[var(--color-surface-soft)]">
                    <td className="px-3 py-2 text-[var(--color-ink)]">
                      <div className="min-w-0">
                        <span className="block truncate" title={t.title}>
                          {t.title}
                        </span>
                        {hierarchyLabel && (
                          <span
                            className="mt-0.5 block truncate text-[11px] text-[var(--color-muted)]"
                            title={hierarchyTitle || undefined}
                          >
                            {hierarchyLabel}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                          ttone.bg,
                          ttone.fg,
                        )}
                      >
                        {classifyTaskStatus(t)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">
                      <span className="block truncate" title={blockedByTitle(t) || undefined}>
                        {blockedByLabel(t)}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[var(--color-muted)]">
                      {t.assigneeEmployeeId ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">{t.dueDate ?? "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="projects-milestone"
        data-count={String(milestones.length)}
      >
        <header className="border-b border-[var(--color-line)] px-3 py-2 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          Milestones
        </header>
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Title
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Due
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Reached
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {milestones.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-3 py-4 text-center text-[var(--color-muted)]"
                >
                  No milestones yet.
                </td>
              </tr>
            ) : (
              milestones.map((m) => (
                <tr key={m.id} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2 text-[var(--color-ink)]">{m.title}</td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{m.dueDate ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {m.reached > 0 ? (
                      <span className="text-[var(--color-tag-green)]">Yes</span>
                    ) : (
                      <span className="text-[var(--color-muted)]">No</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <BackLink />
    </div>
  );
}

/* ────────── page header ────────── */

function PageHeader({
  projectId,
  name,
  tone,
}: {
  projectId: string;
  name: string | null;
  tone: { label: string; bg: string; fg: string } | null;
}) {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <Folder className="size-3" />
        PROJECTS · {projectId}
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
        {name ?? "Նախագիծ"}
      </h1>
      {tone && (
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          <span
            className={cn(
              "mr-1 inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              tone.bg,
              tone.fg,
            )}
          >
            {tone.label}
          </span>
          {name ? `· ${name}` : ""}
        </p>
      )}
    </header>
  );
}

/* ────────── KPI card ────────── */

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className="mt-1 font-mono text-[var(--text-lg)] text-[var(--color-ink)]">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

/* ────────── back link ────────── */

function BackLink() {
  return (
    <Link
      to="/app/projects"
      search={{ view: "projects" }}
      className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
    >
      <ChevronLeft className="size-3.5" />
      Back to Projects
    </Link>
  );
}
