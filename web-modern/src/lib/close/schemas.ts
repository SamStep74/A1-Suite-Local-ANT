/**
 * schemas.ts — Zod types for the period-close checklist.
 *
 * The wizard works on three concepts:
 *   - `ClosePeriod`     — the calendar period being closed
 *   - `CloseStep`       — a single check item ("reconcile bank", …)
 *   - `CloseStepStatus` — what the user has done with the step
 *
 * The schema is the single source of truth: the localStorage
 * adapter `state.ts` parses through these on read (a user with a
 * stale schema must not crash the route), and the React state in
 * the route derives its types via `z.infer<typeof X>`.
 *
 * The status enum is intentionally a closed 4-value union:
 *   - `pending`  — not done (the default; rendered as a checkbox)
 *   - `done`     — completed (rendered green, ✓)
 *   - `blocked`  — couldn't be done; user flagged why (rendered amber, !)
 *   - `skipped`  — explicitly not applicable (rendered muted, –)
 *
 * Why not "in_progress"? — the close wizard is not a workflow;
 * each step is one click. The four states above are the only
 * outcomes.
 *
 * The `note` field is free text; the close wizard exposes it via
 * a small inline editor for `blocked` rows. We deliberately keep
 * the schema narrow: a 12-15 step checklist should not need a
 * full audit log on the type level.
 */
import { z } from "zod";

/* ────────── CloseStepStatus ────────── */

/** A closed union — adding a value is a type error at every
 *  call site, which is exactly what we want for a 4-state
 *  workflow. */
export const CloseStepStatusSchema = z.enum([
  "pending",
  "done",
  "blocked",
  "skipped",
]);
export type CloseStepStatus = z.infer<typeof CloseStepStatusSchema>;

/** A "completed" status is `done`. `blocked` and `skipped` are
 *  terminal in the same way but counted as incomplete in the
 *  progress summary. `pending` is the only non-terminal state. */
export const isTerminalStatus = (s: CloseStepStatus): boolean =>
  s === "done" || s === "blocked" || s === "skipped";

/** A "counted as done" status — only `done` qualifies. Used by
 *  the progress bar (e.g. "8 / 12 done"). */
export const isCountedAsDone = (s: CloseStepStatus): boolean =>
  s === "done";

/* ────────── CloseStep ────────── */

/**
 * A single check item. The `id` is stable across renders and
 * sessions (used as the React key and as the localStorage subkey).
 *
 * `category` is a free-form tag for grouping in the UI ("Reconcile",
 * "Post", "Reports", "Tax", "Lock"). The UI doesn't enforce a
 * closed set — new categories are added by the `checklist.ts`
 * seed.
 */
export const CloseStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  /** Sort order inside its category. 1-based; lower = earlier. */
  order: z.number().int().min(1),
  /** A short helper that hints at who owns the step. Free text
   *  because the user is the human and the next-line helper
   *  ("accountant" / "owner" / "auditor") varies. */
  owner: z.string().optional(),
});
export type CloseStep = z.infer<typeof CloseStepSchema>;

/* ────────── CloseStepState (the per-period runtime row) ────────── */

/**
 * What the user has done with a given step in a given period.
 * Stored at `a1:close:<periodId>:<stepId>` in localStorage.
 *
 * `updatedAt` is an ISO-8601 string (we deliberately don't use
 * `Date` in the persisted form — `JSON.stringify(new Date())`
 * silently loses timezone info on some browsers).
 */
export const CloseStepStateSchema = z.object({
  stepId: z.string().min(1),
  status: CloseStepStatusSchema,
  /** Free-text note. Only meaningful for `blocked` rows but the
   *  schema doesn't enforce that — the route does. */
  note: z.string().optional(),
  /** ISO-8601 timestamp of the last status change. */
  updatedAt: z.string().datetime().optional(),
});
export type CloseStepState = z.infer<typeof CloseStepStateSchema>;

/* ────────── ClosePeriod ────────── */

/**
 * A calendar period in YYYY-MM form (e.g. "2026-06"). The same
 * shape the rest of the app uses for fiscal periods (see
 * `cfo/reports.ts#currentPeriodKey`).
 */
export const ClosePeriodSchema = z.object({
  id: z.string().regex(/^\d{4}-\d{2}$/),
  /** Human-friendly label (e.g. "June 2026" / "Հունիս 2026"). */
  label: z.string().min(1),
  /** ISO date of the first day of the period. */
  startsAt: z.string().datetime(),
  /** ISO date of the last day of the period (inclusive). */
  endsAt: z.string().datetime(),
});
export type ClosePeriod = z.infer<typeof ClosePeriodSchema>;

/* ────────── CloseSummary (derived view-model) ────────── */

/**
 * Computed counts for the summary chip ("8 / 12 done, 1 blocked,
 * 1 skipped"). Derived in the route; not stored.
 */
export interface CloseSummary {
  total: number;
  done: number;
  blocked: number;
  skipped: number;
  /** Number of pending steps (`total - done - blocked - skipped`). */
  pending: number;
  /** `done / total` as a fraction (0..1). Returns 0 if total is 0. */
  doneRatio: number;
}
