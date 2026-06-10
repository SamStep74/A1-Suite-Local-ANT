/**
 * Pure helpers for the Projects workspace.
 *
 * Source of truth: server/app.js (getProject, /api/projects, /api/projects/:id,
 * /api/projects/:id/billing-preview). All amounts are integer AMD or
 * minutes, depending on context — we keep the AMD helpers here for
 * billing and use plain number math for everything else.
 *
 * These helpers are UI-pure: no React, no I/O. They re-implement small
 * derivations the engine already produces (totals, status classification)
 * and add UI-specific shaping (tone, sorting) without duplicating
 * the math.
 *
 * Public surface:
 *  - classifyProjectStatus    → "planning" | "active" | "on-hold" | "completed" | "cancelled" | "unknown"
 *  - classifyTaskStatus       → "todo" | "in-progress" | "done" | "unknown"
 *  - compareProjectsByUpdatedAtDesc
 *  - compareTasksByStatusOrder
 *  - compareMilestonesByDueDateAsc
 *  - projectProgressPct       → 0..100
 *  - milestoneReachedPct      → 0..100
 *  - billingHoursFromMinutes
 *  - billingGrossAmd          → AMD subtotal
 *  - billingVatAmountAmd
 *  - billingTotalAmd
 *  - isProjectBillable
 *  - formatProjectDurationHours
 *  - formatCurrency / formatPercent (re-exported)
 */
import type {
  ProjectDetail,
  ProjectListItem,
  ProjectStatus,
  ProjectTask,
  ProjectMilestone,
  ProjectBillingPreview,
  TaskStatus,
} from "../api/schemas";
import { formatCurrency, formatPercent } from "../cfo/status";

/* ────────── types ────────── */

export type ProjectTone =
  | "planning"
  | "active"
  | "on-hold"
  | "completed"
  | "cancelled"
  | "unknown";

export type TaskTone = "todo" | "in-progress" | "done" | "unknown";

const PROJECT_STATUSES: ReadonlySet<ProjectStatus> = new Set([
  "planning",
  "active",
  "on-hold",
  "completed",
  "cancelled",
]);

const TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "todo",
  "in-progress",
  "done",
]);

const TASK_STATUS_ORDER: Record<TaskStatus, number> = {
  "in-progress": 0,
  todo: 1,
  done: 2,
};

/* ────────── classification ────────── */

export function classifyProjectStatus(
  project: { status?: string | null } | null | undefined,
): ProjectTone {
  const s = (project?.status ?? "").toString().toLowerCase();
  if (PROJECT_STATUSES.has(s as ProjectStatus)) return s as ProjectTone;
  return "unknown";
}

export function classifyTaskStatus(
  task: { status?: string | null } | null | undefined,
): TaskTone {
  const s = (task?.status ?? "").toString().toLowerCase();
  if (TASK_STATUSES.has(s as TaskStatus)) return s as TaskTone;
  return "unknown";
}

/* ────────── ordering ────────── */

export function compareProjectsByUpdatedAtDesc(
  a: Pick<ProjectListItem, "updatedAt">,
  b: Pick<ProjectListItem, "updatedAt">,
): number {
  const aT = a.updatedAt ?? "";
  const bT = b.updatedAt ?? "";
  // ISO-8601 strings sort lexicographically; descending means reverse.
  if (aT === bT) return 0;
  return aT < bT ? 1 : -1;
}

export function compareTasksByStatusOrder(
  a: Pick<ProjectTask, "status">,
  b: Pick<ProjectTask, "status">,
): number {
  const aKey = (a.status ?? "").toString().toLowerCase() as TaskStatus;
  const bKey = (b.status ?? "").toString().toLowerCase() as TaskStatus;
  const aOrder = TASK_STATUS_ORDER[aKey] ?? 99;
  const bOrder = TASK_STATUS_ORDER[bKey] ?? 99;
  return aOrder - bOrder;
}

export function compareMilestonesByDueDateAsc(
  a: Pick<ProjectMilestone, "dueDate">,
  b: Pick<ProjectMilestone, "dueDate">,
): number {
  const aD = a.dueDate ?? "";
  const bD = b.dueDate ?? "";
  // Empty dueDates sort to the end so milestones with real dates appear first.
  if (aD === "" && bD === "") return 0;
  if (aD === "") return 1;
  if (bD === "") return -1;
  return aD.localeCompare(bD);
}

/* ────────── aggregates ────────── */

export function projectProgressPct(
  p: Pick<ProjectListItem, "taskTotal" | "taskDone">,
): number {
  const total = p.taskTotal ?? 0;
  const done = p.taskDone ?? 0;
  if (total <= 0) return 0;
  if (done <= 0) return 0;
  if (done >= total) return 100;
  return Math.round((done / total) * 100);
}

export function milestoneReachedPct(
  p: Pick<ProjectListItem, "milestoneTotal" | "milestoneReached">,
): number {
  const total = p.milestoneTotal ?? 0;
  const reached = p.milestoneReached ?? 0;
  if (total <= 0) return 0;
  if (reached <= 0) return 0;
  if (reached >= total) return 100;
  return Math.round((reached / total) * 100);
}

export function totalTaskCount(p: Pick<ProjectListItem, "taskTotal">): number {
  return p.taskTotal ?? 0;
}

export function doneTaskCount(p: Pick<ProjectListItem, "taskDone">): number {
  return p.taskDone ?? 0;
}

export function totalMilestoneCount(
  p: Pick<ProjectListItem, "milestoneTotal">,
): number {
  return p.milestoneTotal ?? 0;
}

export function reachedMilestoneCount(
  p: Pick<ProjectListItem, "milestoneReached">,
): number {
  return p.milestoneReached ?? 0;
}

export function totalMinutes(p: Pick<ProjectListItem, "totalMinutes">): number {
  return p.totalMinutes ?? 0;
}

export function taskCount(detail: Pick<ProjectDetail, "tasks">): number {
  return detail.tasks?.length ?? 0;
}

export function milestoneCount(detail: Pick<ProjectDetail, "milestones">): number {
  return detail.milestones?.length ?? 0;
}

export function timeEntryCount(
  detail: Pick<ProjectDetail, "timeEntryCount">,
): number {
  return detail.timeEntryCount ?? 0;
}

/* ────────── billing ────────── */

const MINUTES_PER_HOUR = 60;

export function billingHoursFromMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.round((minutes / MINUTES_PER_HOUR) * 100) / 100;
}

export function billingGrossAmd(
  preview: Pick<ProjectBillingPreview, "hours" | "hourlyRate">,
): number {
  const h = Number(preview.hours ?? 0);
  const r = Number(preview.hourlyRate ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(r)) return 0;
  return Math.round(h * r);
}

export function billingVatAmountAmd(
  preview: Pick<ProjectBillingPreview, "vat">,
): number {
  return preview.vat ?? 0;
}

export function billingTotalAmd(
  preview: Pick<ProjectBillingPreview, "total">,
): number {
  return preview.total ?? 0;
}

export function isProjectBillable(
  preview: Pick<ProjectBillingPreview, "unbilledMinutes" | "hourlyRate">,
): boolean {
  return (preview.unbilledMinutes ?? 0) > 0 && (preview.hourlyRate ?? 0) > 0;
}

/* ────────── formatting ────────── */

export function formatProjectDurationHours(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const hours = billingHoursFromMinutes(minutes);
  return `${hours.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ժ`;
}

export { formatCurrency, formatPercent };
