/**
 * /app/projects — Projects workspace: projects | tasks | milestones |
 * time-entries | billing | recurring | templates.
 *
 * Mirrors cfo/ pattern (Pattern A from the plan §3.5). The home
 * route is a ViewSwitcher over seven surfaces:
 *
 *   - **Projects** — list of all client projects with task/milestone
 *     progress and total minutes
 *   - **Tasks** — aggregated view of all tasks across projects
 *   - **Milestones** — aggregated view of all milestones
 *   - **Time** — aggregated view of all time entries (counts/minutes
 *     only — the project list already exposes per-project totals)
 *   - **Billing** — billing preview for the most recently updated
 *     project (the route is read-only; finance-gated POST /bill-time
 *     stays in the server API)
 *   - **Recurring** — recurring task rules for the most recently updated
 *     project
 *   - **Templates** — reusable project templates with task/milestone
 *     hierarchy evidence
 *
 * URL state:
 *   ?view=projects | tasks | milestones | time | billing | recurring | templates
 *
 * Data (all require app=projects access):
 *   - GET /api/projects
 *   - GET /api/projects/:id
 *   - GET /api/projects/:id/billing-preview
 *   - GET /api/projects/:id/recurring-tasks
 *   - GET /api/project-templates
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Banknote,
  ChevronLeft,
  CircleSlash,
  Clock3,
  Folder,
} from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  ProjectsListResponseSchema,
  ProjectDetailResponseSchema,
  ProjectBillingPreviewResponseSchema,
  ProjectProfitabilityResponseSchema,
  ProjectRecurringTasksResponseSchema,
  ProjectTemplatesResponseSchema,
  type ProjectListItem,
  type ProjectTask,
  type ProjectMilestone,
  type ProjectDetail,
  type ProjectBillingPreview,
  type ProjectProfitability,
  type ProjectRecurringTask,
  type ProjectTemplate,
  type ProjectTemplateMilestone,
  type ProjectTemplateTask,
} from "../../../lib/api/schemas";
import { ViewSwitcher } from "../../../components/view-switcher/ViewSwitcher";
import { cn } from "../../../lib/utils/cn";
import {
  classifyProjectStatus,
  classifyTaskStatus,
  compareProjectsByUpdatedAtDesc,
  compareTasksByStatusOrder,
  compareMilestonesByDueDateAsc,
  projectProgressPct,
  milestoneReachedPct,
  totalMinutes,
  billingGrossAmd,
  billingTotalAmd,
  formatCurrency,
  formatPercent,
  formatProjectDurationHours,
  type ProjectTone,
  type TaskTone,
} from "../../../lib/projects/status";

/* ────────── typed URL search ────────── */

type View =
  | "projects"
  | "tasks"
  | "milestones"
  | "time"
  | "billing"
  | "recurring"
  | "templates";

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "projects", label: "Projects" },
  { value: "tasks", label: "Tasks" },
  { value: "milestones", label: "Milestones" },
  { value: "time", label: "Time" },
  { value: "billing", label: "Billing" },
  { value: "recurring", label: "Recurring" },
  { value: "templates", label: "Templates" },
];

export const Route = createFileRoute("/app/projects/")({
  validateSearch: (raw) => {
    const v: View =
      raw.view === "tasks" ||
      raw.view === "milestones" ||
      raw.view === "time" ||
      raw.view === "billing" ||
      raw.view === "recurring" ||
      raw.view === "templates"
        ? raw.view
        : "projects";
    return { view: v };
  },
  component: ProjectsWorkspace,
});

/* ────────── tones ────────── */

const PROJECT_TONE: Record<ProjectTone, { bg: string; fg: string; label: string }> = {
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

function taskHierarchyLabel(task: ProjectTask | ProjectTemplateTask) {
  const parts: string[] = [];
  const parentLabel = task.parentTask?.title ?? task.parentTaskId ?? null;
  const subtasks = task.subtasks ?? [];

  if (parentLabel) parts.push(`Parent: ${parentLabel}`);
  if (subtasks.length === 1) parts.push(`Subtask: ${subtasks[0].title}`);
  if (subtasks.length > 1) parts.push(`Subtasks: ${subtasks[0].title} +${subtasks.length - 1}`);

  return parts.length > 0 ? parts.join(" | ") : null;
}

function taskHierarchyTitle(task: ProjectTask | ProjectTemplateTask) {
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

function compareTemplatesByUpdatedAtDesc(
  a: Pick<ProjectTemplate, "updatedAt">,
  b: Pick<ProjectTemplate, "updatedAt">,
) {
  const aT = a.updatedAt ?? "";
  const bT = b.updatedAt ?? "";
  if (aT === bT) return 0;
  return aT < bT ? 1 : -1;
}

function compareBySortOrder<T extends { sortOrder?: number; title: string }>(a: T, b: T) {
  const aOrder = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const bOrder = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return a.title.localeCompare(b.title);
}

function dueOffsetLabel(days: number | null | undefined) {
  if (days == null) return "—";
  if (days === 0) return "Day 0";
  return `Day ${days}`;
}

function isRecurringTaskActive(rule: ProjectRecurringTask) {
  return rule.active === true || rule.active === 1;
}

function recurringIntervalLabel(rule: ProjectRecurringTask) {
  const unit = String(rule.intervalUnit || "period").toLowerCase();
  const normalizedUnit =
    unit === "weekly"
      ? rule.intervalEvery === 1
        ? "week"
        : "weeks"
      : unit === "monthly"
        ? rule.intervalEvery === 1
          ? "month"
          : "months"
        : unit;
  return `Every ${rule.intervalEvery} ${normalizedUnit}`;
}

/* ────────── root component ────────── */

function ProjectsWorkspace() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view: View = search.view;
  const setView = (next: View) => navigate({ search: { view: next }, replace: true });

  const projectsQ = useQuery({
    queryKey: ["projects-list"],
    queryFn: async () => {
      const raw = await getJson("/api/projects");
      return ProjectsListResponseSchema.parse(raw);
    },
  });

  const projects = projectsQ.data?.projects ?? [];
  const topProject = projects.slice().sort(compareProjectsByUpdatedAtDesc)[0];

  const detailQ = useQuery({
    queryKey: ["project-detail", topProject?.id ?? null],
    queryFn: async () => {
      const raw = await getJson(`/api/projects/${encodeURIComponent(topProject!.id)}`);
      return ProjectDetailResponseSchema.parse(raw);
    },
    enabled: Boolean(topProject?.id),
  });

  const billingQ = useQuery({
    queryKey: ["project-billing-preview", topProject?.id ?? null],
    queryFn: async () => {
      const raw = await getJson(
        `/api/projects/${encodeURIComponent(topProject!.id)}/billing-preview`,
      );
      return ProjectBillingPreviewResponseSchema.parse(raw);
    },
    enabled: Boolean(topProject?.id),
  });

  const profitabilityQ = useQuery({
    queryKey: ["project-profitability", topProject?.id ?? null],
    queryFn: async () => {
      const raw = await getJson(
        `/api/projects/${encodeURIComponent(topProject!.id)}/profitability`,
      );
      return ProjectProfitabilityResponseSchema.parse(raw);
    },
    enabled: Boolean(topProject?.id),
  });

  const templatesQ = useQuery({
    queryKey: ["project-templates-list"],
    queryFn: async () => {
      const raw = await getJson("/api/project-templates");
      return ProjectTemplatesResponseSchema.parse(raw);
    },
    enabled: view === "templates",
  });

  const recurringQ = useQuery({
    queryKey: ["project-recurring-tasks", topProject?.id ?? null],
    queryFn: async () => {
      const raw = await getJson(
        `/api/projects/${encodeURIComponent(topProject!.id)}/recurring-tasks`,
      );
      return ProjectRecurringTasksResponseSchema.parse(raw);
    },
    enabled: view === "recurring" && Boolean(topProject?.id),
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

      {view === "projects" && (
        <ProjectsView
          data={projects}
          loading={projectsQ.isLoading}
          error={projectsQ.isError}
        />
      )}
      {view === "tasks" && (
        <TasksView
          detail={detailQ.data?.project}
          loading={projectsQ.isLoading || detailQ.isLoading}
          error={projectsQ.isError || detailQ.isError}
        />
      )}
      {view === "milestones" && (
        <MilestonesView
          detail={detailQ.data?.project}
          loading={projectsQ.isLoading || detailQ.isLoading}
          error={projectsQ.isError || detailQ.isError}
        />
      )}
      {view === "time" && (
        <TimeView
          projects={projects}
          detail={detailQ.data?.project}
          loading={projectsQ.isLoading}
          error={projectsQ.isError}
        />
      )}
      {view === "billing" && (
        <BillingView
          project={topProject}
          preview={billingQ.data?.preview}
          profitability={profitabilityQ.data?.profitability}
          loading={billingQ.isLoading || profitabilityQ.isLoading}
          error={billingQ.isError || profitabilityQ.isError}
        />
      )}
      {view === "templates" && (
        <TemplatesView
          templates={templatesQ.data?.templates ?? []}
          loading={templatesQ.isLoading}
          error={templatesQ.isError}
        />
      )}
      {view === "recurring" && (
        <RecurringTasksView
          project={topProject}
          recurringTasks={
            recurringQ.data?.recurringTasks ?? detailQ.data?.project.recurringTasks ?? []
          }
          loading={projectsQ.isLoading || recurringQ.isLoading}
          error={projectsQ.isError || recurringQ.isError}
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
        <Folder className="size-3" />
        PROJECTS
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">Projects</h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Հաճախորդների նախագծեր · Առաջադրանքներ · Հիմնարար կետեր · Ժամային մուտքեր
      </p>
    </header>
  );
}

/* ────────── KPI card ────────── */

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

/* ────────── Projects view ────────── */

function ProjectsView({
  data,
  loading,
  error,
}: {
  data: ProjectListItem[];
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading projects…</p>;
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load projects.
      </p>
    );
  }

  const projects = data.slice().sort(compareProjectsByUpdatedAtDesc);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Projects" value={String(projects.length)} hint="Ընդհանուր նախագծեր" />
        <KpiCard
          label="Active"
          value={String(
            projects.filter((p) => classifyProjectStatus(p) === "active").length,
          )}
          hint="Ակտիվ"
          tone="positive"
        />
        <KpiCard
          label="Total minutes"
          value={formatProjectDurationHours(
            projects.reduce((s, p) => s + totalMinutes(p), 0),
          )}
          hint="Ընդհանուր ժամանակ"
        />
        <KpiCard
          label="Completed"
          value={String(
            projects.filter((p) => classifyProjectStatus(p) === "completed").length,
          )}
          hint="Ավարտված"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="projects-project"
        data-count={String(projects.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Project
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Status
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Tasks
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Milestones
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Time
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Due
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {projects.map((p) => {
              const tone = PROJECT_TONE[classifyProjectStatus(p)];
              const progress = projectProgressPct(p);
              return (
                <tr key={p.id} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2">
                    <Link
                      to="/app/projects/$projectId"
                      params={{ projectId: p.id }}
                      className="font-mono text-[var(--color-ink)] hover:underline"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                        tone.bg,
                        tone.fg,
                      )}
                    >
                      {tone.label}
                    </span>
                    {progress > 0 && progress < 100 && (
                      <span className="ml-2 font-mono text-[10px] text-[var(--color-muted)]">
                        {progress}%
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                    {p.taskDone ?? 0}/{p.taskTotal ?? 0}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                    {p.milestoneReached ?? 0}/{p.milestoneTotal ?? 0}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-muted)]">
                    {formatProjectDurationHours(totalMinutes(p))}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{p.dueDate ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ────────── Tasks view (aggregated from top project detail) ────────── */

function TasksView({
  detail,
  loading,
  error,
}: {
  detail: ProjectDetail | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading tasks…</p>;
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load tasks.
      </p>
    );
  }
  const tasks: ProjectTask[] = (detail?.tasks ?? []).slice().sort(compareTasksByStatusOrder);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Tasks" value={String(tasks.length)} hint="Առաջադրանքներ" />
        <KpiCard
          label="In progress"
          value={String(
            tasks.filter((t) => classifyTaskStatus(t) === "in-progress").length,
          )}
          hint="Ընթացքի մեջ"
          tone="positive"
        />
        <KpiCard
          label="Done"
          value={String(tasks.filter((t) => classifyTaskStatus(t) === "done").length)}
          hint="Ավարտված"
        />
        <KpiCard
          label="To do"
          value={String(tasks.filter((t) => classifyTaskStatus(t) === "todo").length)}
          hint="Սպասվող"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="projects-task"
        data-count={String(tasks.length)}
      >
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
            {tasks.map((t) => {
              const tone = TASK_TONE[classifyTaskStatus(t)];
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
                        tone.bg,
                        tone.fg,
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
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ────────── Milestones view ────────── */

function MilestonesView({
  detail,
  loading,
  error,
}: {
  detail: ProjectDetail | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading milestones…</p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load milestones.
      </p>
    );
  }
  const milestones: ProjectMilestone[] = (detail?.milestones ?? [])
    .slice()
    .sort(compareMilestonesByDueDateAsc);
  const reached = milestones.filter((m) => m.reached > 0).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Milestones" value={String(milestones.length)} hint="Հիմնարար կետեր" />
        <KpiCard
          label="Reached"
          value={`${reached}/${milestones.length}`}
          hint="Հաստատված"
          tone="positive"
        />
        <KpiCard
          label="Progress"
          value={String(milestoneReachedPct({ milestoneTotal: milestones.length, milestoneReached: reached })) + "%"}
          hint="Ընդհանուր առաջընթաց"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="projects-milestone"
        data-count={String(milestones.length)}
      >
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
            {milestones.map((m) => (
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
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ────────── Time view ────────── */

function TimeView({
  projects,
  detail,
  loading,
  error,
}: {
  projects: ProjectListItem[];
  detail: ProjectDetail | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading time…</p>;
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">Failed to load time data.</p>
    );
  }

  const totalMins = projects.reduce((s, p) => s + totalMinutes(p), 0);
  const topProjectMinutes = totalMinutes({
    totalMinutes: detail?.totalMinutes ?? 0,
  } as ProjectListItem);
  const topProjectEntries = detail?.timeEntryCount ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Total minutes"
          value={formatProjectDurationHours(totalMins)}
          hint="Ընդհանուր ժամանակ"
        />
        <KpiCard
          label="Top project minutes"
          value={formatProjectDurationHours(topProjectMinutes)}
          hint="Առաջին նախագծի ժամանակ"
        />
        <KpiCard
          label="Top project entries"
          value={String(topProjectEntries)}
          hint="Առաջին նախագծի մուտքեր"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="projects-time-entry"
        data-count={String(projects.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Project
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Minutes
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Hours
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {projects.map((p) => {
              const mins = totalMinutes(p);
              return (
                <tr key={p.id} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2 text-[var(--color-ink)]">{p.name}</td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                    {mins}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-muted)]">
                    {formatProjectDurationHours(mins)}
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

/* ────────── Templates view ────────── */

function TemplatesView({
  templates,
  loading,
  error,
}: {
  templates: ProjectTemplate[];
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading templates…</p>;
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load project templates.
      </p>
    );
  }

  const sorted = templates.slice().sort(compareTemplatesByUpdatedAtDesc);
  const taskTotal = sorted.reduce((sum, template) => sum + template.taskCount, 0);
  const milestoneTotal = sorted.reduce((sum, template) => sum + template.milestoneCount, 0);
  const hierarchyTotal = sorted.reduce(
    (sum, template) =>
      sum +
      template.tasks.filter(
        (task) =>
          Boolean(task.parentTaskId || task.parentTask) || (task.subtasks ?? []).length > 0,
      ).length,
    0,
  );

  if (sorted.length === 0) {
    return <EmptyState message="No project templates available." />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Templates" value={String(sorted.length)} hint="Կաղապարներ" />
        <KpiCard label="Template tasks" value={String(taskTotal)} hint="Առաջադրանքներ" />
        <KpiCard label="Milestones" value={String(milestoneTotal)} hint="Հիմնարար կետեր" />
        <KpiCard
          label="Hierarchy links"
          value={String(hierarchyTotal)}
          hint="Parent/subtask evidence"
          tone={hierarchyTotal > 0 ? "positive" : "default"}
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="projects-template"
        data-count={String(sorted.length)}
      >
        <table className="w-full table-fixed text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="w-[26%] px-3 py-2 text-left font-semibold">
                Template
              </th>
              <th scope="col" className="w-[12%] px-3 py-2 text-left font-semibold">
                Status
              </th>
              <th scope="col" className="w-[28%] px-3 py-2 text-left font-semibold">
                Tasks
              </th>
              <th scope="col" className="w-[22%] px-3 py-2 text-left font-semibold">
                Milestones
              </th>
              <th scope="col" className="w-[12%] px-3 py-2 text-left font-semibold">
                Updated
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {sorted.map((template) => {
              const tone = PROJECT_TONE[classifyProjectStatus(template)];
              const tasks = template.tasks.slice().sort(compareBySortOrder).slice(0, 3);
              const milestones = template.milestones.slice().sort(compareBySortOrder).slice(0, 3);
              return (
                <tr key={template.id} className="align-top hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2">
                    <div className="min-w-0">
                      <span className="block truncate font-mono text-[var(--color-ink)]">
                        {template.name}
                      </span>
                      <span
                        className="mt-0.5 block truncate text-[11px] text-[var(--color-muted)]"
                        title={template.description}
                      >
                        {template.description}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                        tone.bg,
                        tone.fg,
                      )}
                    >
                      {tone.label}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <TemplateTaskEvidence tasks={tasks} total={template.taskCount} />
                  </td>
                  <td className="px-3 py-2">
                    <TemplateMilestoneEvidence
                      milestones={milestones}
                      total={template.milestoneCount}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-[var(--color-muted)]">
                    {template.updatedAt ?? "—"}
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

function TemplateTaskEvidence({
  tasks,
  total,
}: {
  tasks: ProjectTemplateTask[];
  total: number;
}) {
  if (total === 0) return <span className="text-[var(--color-muted)]">0 tasks</span>;

  return (
    <div className="space-y-1">
      <p className="font-mono text-[11px] text-[var(--color-muted)]">{total} tasks</p>
      {tasks.map((task) => {
        const hierarchyLabel = taskHierarchyLabel(task);
        const hierarchyTitle = taskHierarchyTitle(task);
        return (
          <div key={task.id} className="min-w-0">
            <span className="block truncate text-[var(--color-ink)]" title={task.title}>
              {task.title}
              <span className="ml-1 font-mono text-[10px] text-[var(--color-muted)]">
                {dueOffsetLabel(task.dueOffsetDays)}
              </span>
            </span>
            {hierarchyLabel && (
              <span
                className="block truncate text-[11px] text-[var(--color-muted)]"
                title={hierarchyTitle || undefined}
              >
                {hierarchyLabel}
              </span>
            )}
          </div>
        );
      })}
      {total > tasks.length && (
        <p className="font-mono text-[10px] text-[var(--color-muted)]">
          +{total - tasks.length} more
        </p>
      )}
    </div>
  );
}

function TemplateMilestoneEvidence({
  milestones,
  total,
}: {
  milestones: ProjectTemplateMilestone[];
  total: number;
}) {
  if (total === 0) return <span className="text-[var(--color-muted)]">0 milestones</span>;

  return (
    <div className="space-y-1">
      <p className="font-mono text-[11px] text-[var(--color-muted)]">{total} milestones</p>
      {milestones.map((milestone) => (
        <div key={milestone.id} className="min-w-0">
          <span className="block truncate text-[var(--color-ink)]" title={milestone.title}>
            {milestone.title}
            <span className="ml-1 font-mono text-[10px] text-[var(--color-muted)]">
              {dueOffsetLabel(milestone.dueOffsetDays)}
            </span>
          </span>
        </div>
      ))}
      {total > milestones.length && (
        <p className="font-mono text-[10px] text-[var(--color-muted)]">
          +{total - milestones.length} more
        </p>
      )}
    </div>
  );
}

/* ────────── Recurring tasks view ────────── */

function RecurringTasksView({
  project,
  recurringTasks,
  loading,
  error,
}: {
  project: ProjectListItem | undefined;
  recurringTasks: ProjectRecurringTask[];
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading recurring tasks…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load recurring tasks.
      </p>
    );
  }
  if (!project) {
    return <EmptyState message="No project available for recurring tasks." />;
  }

  const rules = recurringTasks
    .slice()
    .sort((a, b) => (a.nextDueDate ?? "9999-12-31").localeCompare(b.nextDueDate ?? "9999-12-31"));
  const activeCount = rules.filter(isRecurringTaskActive).length;
  const nextDueCount = rules.filter((rule) => Boolean(rule.nextDueDate)).length;

  if (rules.length === 0) {
    return <EmptyState message="No recurring task rules for the most recent project." />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Rules" value={String(rules.length)} hint={project.name} />
        <KpiCard
          label="Active"
          value={`${activeCount}/${rules.length}`}
          hint="Enabled recurrence rules"
          tone={activeCount > 0 ? "positive" : "default"}
        />
        <KpiCard label="Next due dates" value={String(nextDueCount)} hint="Scheduled rules" />
        <KpiCard
          label="Last task links"
          value={String(rules.filter((rule) => Boolean(rule.lastCreatedTaskId)).length)}
          hint="Created-task evidence"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="projects-recurring-task"
        data-count={String(rules.length)}
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
          <Clock3 className="size-4 text-[var(--color-muted)]" />
          <p className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
            Recurring tasks - <span className="font-mono">{project.name}</span>
          </p>
        </div>
        <table className="w-full table-fixed text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="w-[26%] px-3 py-2 text-left font-semibold">
                Rule
              </th>
              <th scope="col" className="w-[12%] px-3 py-2 text-left font-semibold">
                Active
              </th>
              <th scope="col" className="w-[18%] px-3 py-2 text-left font-semibold">
                Interval
              </th>
              <th scope="col" className="w-[16%] px-3 py-2 text-left font-semibold">
                Next due
              </th>
              <th scope="col" className="w-[12%] px-3 py-2 text-left font-semibold">
                Status
              </th>
              <th scope="col" className="w-[16%] px-3 py-2 text-left font-semibold">
                Last task
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {rules.map((rule) => {
              const active = isRecurringTaskActive(rule);
              return (
                <tr key={rule.id} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2">
                    <div className="min-w-0">
                      <span className="block truncate text-[var(--color-ink)]" title={rule.title}>
                        {rule.title}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-[var(--color-muted)]">
                        {rule.id}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                        active
                          ? "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] text-[var(--color-tag-green)]"
                          : "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)] text-[var(--color-muted)]",
                      )}
                    >
                      {active ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[var(--color-ink)]">
                    {recurringIntervalLabel(rule)}
                  </td>
                  <td className="px-3 py-2 font-mono text-[var(--color-muted)]">
                    {rule.nextDueDate ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    <span className="block truncate" title={rule.status}>
                      {rule.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[var(--color-muted)]">
                    {rule.lastCreatedTaskId ?? "—"}
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

/* ────────── Billing view ────────── */

function BillingView({
  project,
  preview,
  profitability,
  loading,
  error,
}: {
  project: ProjectListItem | undefined;
  preview: ProjectBillingPreview | undefined;
  profitability: ProjectProfitability | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading billing…</p>;
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load billing preview.
      </p>
    );
  }
  if (!project) {
    return <EmptyState message="No project to bill." />;
  }
  if (!preview) {
    return <EmptyState message="No billing preview available for the most recent project." />;
  }

  const gross = billingGrossAmd(preview);
  const marginLabel =
    profitability?.grossMarginPct == null
      ? "—"
      : formatPercent(profitability.grossMarginPct);
  const hasCostBreakdown =
    profitability?.costRate != null ||
    profitability?.laborCostTotal != null ||
    profitability?.productCostTotal != null ||
    profitability?.fieldVisitCostTotal != null;
  const taskProfitability = profitability?.taskProfitability ?? [];
  const productCostEvidence = profitability?.productCostEvidence ?? [];
  const fieldVisitCostEvidence = profitability?.fieldVisitCostEvidence ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Unbilled hours"
          value={`${preview.hours} ժ`}
          hint="Չհաշվառված ժամեր"
        />
        <KpiCard
          label="Hourly rate"
          value={formatCurrency(preview.hourlyRate, preview.currency)}
          hint="ժամավարձույք"
        />
        <KpiCard
          label="Subtotal (AMD)"
          value={formatCurrency(gross, preview.currency)}
          hint="Ենթագումար"
        />
        <KpiCard
          label="Total (AMD)"
          value={formatCurrency(billingTotalAmd(preview), preview.currency)}
          hint="Ընդհանուր"
          tone="positive"
        />
      </div>

      {profitability && (
        <section
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
          data-entity="projects-profitability"
          data-count={String(profitability.invoiceCount)}
        >
          <div className="flex items-center gap-2">
            <Banknote className="size-4 text-[var(--color-muted)]" />
            <p className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              Profitability - <span className="font-mono">{project.name}</span>
            </p>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Billed revenue"
              value={formatCurrency(profitability.billedRevenue, profitability.currency)}
              hint={`${profitability.billedEntries} entries`}
            />
            <KpiCard
              label="Unbilled estimate"
              value={formatCurrency(profitability.unbilledRevenue, profitability.currency)}
              hint={`${profitability.unbilledMinutes} min at current rate`}
            />
            <KpiCard
              label="Gross profit"
              value={formatCurrency(profitability.grossProfit, profitability.currency)}
              hint={`Cost ${formatCurrency(profitability.costTotal, profitability.currency)}`}
              tone={profitability.grossProfit >= 0 ? "positive" : "negative"}
            />
            <KpiCard
              label="Gross margin"
              value={marginLabel}
              hint={`${profitability.totalEntries} total entries`}
              tone={(profitability.grossMarginPct ?? 0) >= 0 ? "positive" : "negative"}
            />
          </div>

          {hasCostBreakdown && (
            <div
              className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
              data-entity="projects-cost-breakdown"
            >
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                  Cost rate
                </p>
                <p className="mt-1 font-mono text-[var(--text-sm)] text-[var(--color-ink)]">
                  {profitability.costRate == null
                    ? "—"
                    : `${formatCurrency(profitability.costRate, profitability.currency)}/h`}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                  Labor cost
                </p>
                <p className="mt-1 font-mono text-[var(--text-sm)] text-[var(--color-ink)]">
                  {formatCurrency(profitability.laborCostTotal, profitability.currency)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                  Product cost
                </p>
                <p className="mt-1 font-mono text-[var(--text-sm)] text-[var(--color-ink)]">
                  {formatCurrency(profitability.productCostTotal, profitability.currency)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                  Field visit cost
                </p>
                <p className="mt-1 font-mono text-[var(--text-sm)] text-[var(--color-ink)]">
                  {formatCurrency(profitability.fieldVisitCostTotal, profitability.currency)}
                </p>
              </div>
            </div>
          )}

          {profitability.taskProfitability !== undefined && (
            <div
              className="mt-4"
              data-entity="projects-task-profitability"
              data-count={String(taskProfitability.length)}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[var(--text-xs)] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Task cost basis
                </p>
                <p className="font-mono text-[11px] text-[var(--color-muted)]">
                  {taskProfitability.length} tasks
                </p>
              </div>
              <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--color-line)]">
                <table className="min-w-[760px] w-full text-[var(--text-sm)]" role="table">
                  <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">
                        Task
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Minutes
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Revenue
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Labor
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Profit
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Margin
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-line)]">
                    {taskProfitability.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-3 text-center text-[var(--color-muted)]">
                          No task cost basis yet.
                        </td>
                      </tr>
                    ) : (
                      taskProfitability.map((task, index) => (
                        <tr
                          key={task.taskId ?? `${task.taskTitle}-${index}`}
                          className="hover:bg-[var(--color-surface-soft)]"
                        >
                          <td className="px-3 py-2 text-[var(--color-ink)]">
                            <span className="block max-w-[18rem] truncate" title={task.taskTitle}>
                              {task.taskTitle}
                            </span>
                            <span className="block text-[11px] text-[var(--color-muted)]">
                              {task.taskStatus || "No status"} · {task.entries} entries
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[var(--color-muted)]">
                            <span className="block text-[var(--color-ink)]">
                              {task.totalMinutes}
                            </span>
                            <span className="block text-[11px]">
                              {task.billedMinutes} billed / {task.unbilledMinutes} open
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                            {formatCurrency(task.revenue, profitability.currency)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                            {formatCurrency(task.laborCost, profitability.currency)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                            {formatCurrency(task.grossProfit, profitability.currency)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                            {formatPercent(task.grossMarginPct)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {profitability.productCostEvidence !== undefined && (
            <div
              className="mt-4"
              data-entity="projects-product-cost-evidence"
              data-count={String(productCostEvidence.length)}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[var(--text-xs)] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Product cost evidence
                </p>
                <p className="font-mono text-[11px] text-[var(--color-muted)]">
                  {productCostEvidence.length} lines
                </p>
              </div>
              <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--color-line)]">
                <table className="min-w-[820px] w-full text-[var(--text-sm)]" role="table">
                  <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">
                        Quote
                      </th>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">
                        Item
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Qty
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Revenue
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Cost
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Profit
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Margin
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-line)]">
                    {productCostEvidence.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-3 text-center text-[var(--color-muted)]">
                          No product cost evidence yet.
                        </td>
                      </tr>
                    ) : (
                      productCostEvidence.map((line, index) => {
                        const itemLabel = line.catalogName || line.catalogSku || line.catalogItemId;
                        const quoteLabel = line.quoteNumber || line.quoteId;
                        return (
                          <tr
                            key={`${line.quoteId}-${line.catalogItemId}-${line.catalogItemVariantId ?? index}`}
                            className="hover:bg-[var(--color-surface-soft)]"
                          >
                            <td className="px-3 py-2 text-[var(--color-ink)]">
                              <span className="block font-mono">{quoteLabel}</span>
                              <span className="block text-[11px] text-[var(--color-muted)]">
                                {line.quoteStatus || "No status"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-[var(--color-ink)]">
                              <span className="block max-w-[18rem] truncate" title={itemLabel}>
                                {itemLabel}
                              </span>
                              <span className="block font-mono text-[11px] text-[var(--color-muted)]">
                                {line.variantSku || line.catalogSku || line.catalogItemId}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                              {line.quantity}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                              {formatCurrency(line.revenue, profitability.currency)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[var(--color-muted)]">
                              <span className="block text-[var(--color-ink)]">
                                {formatCurrency(line.cost, profitability.currency)}
                              </span>
                              <span className="block text-[11px]">
                                {formatCurrency(line.unitCost, profitability.currency)} each
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                              {formatCurrency(line.grossProfit, profitability.currency)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                              {formatPercent(line.grossMarginPct)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {profitability.fieldVisitCostEvidence !== undefined && (
            <div
              className="mt-4"
              data-entity="projects-field-visit-cost-evidence"
              data-count={String(fieldVisitCostEvidence.length)}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[var(--text-xs)] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Field visit cost evidence
                </p>
                <p className="font-mono text-[11px] text-[var(--color-muted)]">
                  {fieldVisitCostEvidence.length} visits
                </p>
              </div>
              <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--color-line)]">
                <table className="min-w-[760px] w-full text-[var(--text-sm)]" role="table">
                  <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">
                        Visit
                      </th>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">
                        Technician
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Minutes
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Labor
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Travel
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Materials
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-line)]">
                    {fieldVisitCostEvidence.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-3 text-center text-[var(--color-muted)]">
                          No field visit cost evidence yet.
                        </td>
                      </tr>
                    ) : (
                      fieldVisitCostEvidence.map((visit, index) => {
                        const visitLabel = visit.subject || visit.caseNumber || visit.visitId;
                        const materialStatus = (visit.ledgerMappings ?? []).find(
                          mapping => mapping.bucket === "materials",
                        )?.status;
                        const materialStatusLabel = typeof materialStatus === "string"
                          ? `materials ${materialStatus}`
                          : null;
                        return (
                          <tr
                            key={`${visit.visitId}-${index}`}
                            className="hover:bg-[var(--color-surface-soft)]"
                          >
                            <td className="px-3 py-2 text-[var(--color-ink)]">
                              <span className="block max-w-[18rem] truncate" title={visitLabel}>
                                {visitLabel}
                              </span>
                              <span className="block font-mono text-[11px] text-[var(--color-muted)]">
                                {visit.caseNumber || visit.caseId}
                              </span>
                              {materialStatusLabel && (
                                <span className="mt-1 inline-flex rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                                  {materialStatusLabel}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-[var(--color-ink)]">
                              <span className="block max-w-[12rem] truncate" title={visit.assignedUserName || visit.assignedUserId || "Unassigned"}>
                                {visit.assignedUserName || visit.assignedUserId || "Unassigned"}
                              </span>
                              <span className="block font-mono text-[11px] text-[var(--color-muted)]">
                                {visit.scheduledStartAt}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[var(--color-muted)]">
                              <span className="block text-[var(--color-ink)]">
                                {visit.scheduledMinutes}
                              </span>
                              <span className="block text-[11px]">
                                {visit.laborMinutes} labor
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                              {formatCurrency(visit.laborCost, profitability.currency)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                              {formatCurrency(visit.travelCost, profitability.currency)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                              {formatCurrency(visit.materialCost, profitability.currency)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                              {formatCurrency(visit.totalCost, profitability.currency)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-4" data-entity="projects-invoice-evidence">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[var(--text-xs)] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                Invoice evidence
              </p>
              <p className="font-mono text-[11px] text-[var(--color-muted)]">
                {profitability.invoices.length} invoices
              </p>
            </div>
            <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--color-line)]">
              <table className="min-w-[520px] w-full text-[var(--text-sm)]" role="table">
                <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Invoice
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Issue date
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {profitability.invoices.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-3 text-center text-[var(--color-muted)]">
                        No billed invoice evidence yet.
                      </td>
                    </tr>
                  ) : (
                    profitability.invoices.map((invoice) => (
                      <tr key={invoice.id} className="hover:bg-[var(--color-surface-soft)]">
                        <td className="px-3 py-2 text-[var(--color-ink)]">
                          {invoice.number || invoice.id}
                        </td>
                        <td className="px-3 py-2 font-mono text-[var(--color-muted)]">
                          {invoice.issueDate || "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                          {formatCurrency(invoice.total, profitability.currency)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section
        className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
        data-entity="projects-billing-preview"
        data-count="1"
      >
        <div className="flex items-center gap-2">
          <Banknote className="size-4 text-[var(--color-muted)]" />
          <p className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
            Billing preview — <span className="font-mono">{project.name}</span>
          </p>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
              Unbilled minutes
            </p>
            <p className="mt-1 font-mono text-[var(--text-sm)] text-[var(--color-ink)]">
              {preview.unbilledMinutes}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
              Unbilled entries
            </p>
            <p className="mt-1 font-mono text-[var(--text-sm)] text-[var(--color-ink)]">
              {preview.unbilledEntries}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
              VAT rate
            </p>
            <p className="mt-1 font-mono text-[var(--text-sm)] text-[var(--color-ink)]">
              {preview.vatRate}%
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
              VAT amount
            </p>
            <p className="mt-1 font-mono text-[var(--text-sm)] text-[var(--color-ink)]">
              {formatCurrency(preview.vat, preview.currency)}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-[var(--color-muted)]">
          <Clock3 className="mr-1 inline-block size-3" />
          Հաշվարկը կատարվում է ընթացիկ ժամավարձույքով և ԱԱՀ դրույքաչափով (default 20%)։
        </p>
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
