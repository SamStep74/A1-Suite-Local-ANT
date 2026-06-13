/**
 * schemas — Zod + inferred TypeScript types for the first-run
 * onboarding tour overlay.
 *
 * Why a discriminated union for steps:
 *   - The 5 default tours (fiscal-gates / triage-inbox / ask-ai /
 *     documents / settings) need 3 distinct step shapes:
 *       * "navigate" — push the router to a route, no overlay copy
 *       * "highlight" — pin the overlay to a CSS selector (reserved
 *         for future spotlight pinning; not used in the r2 first cut)
 *       * "info"     — body of text only, no navigation
 *     A `kind` discriminant keeps the union exhaustive at the call
 *     site without `any`. The `navigate` variant doubles as the
 *     "deferred" surface case for r2 (W5 / W6) — we point the route
 *     at a path that may 404 today, and the overlay still renders
 *     the explanatory copy.
 *   - `deferred: true` on a tour (not on a step) is the explicit
 *     signal to the launcher that the tour is shipped but its
 *     target surface is on the r2 roadmap. The launcher can still
 *     let the user start it; the overlay will land on a 404 page
 *     and the body text explains what's coming. This matches the
 *     r2 W4 pattern (period-close-checklist ship-now / wire-later).
 *
 * Why a Zod schema (not just a `type`):
 *   - `DEFAULT_TOURS` is a static const that ships in the bundle;
 *     Zod gives us runtime validation at module load so a typo in
 *     a tour id or step order surfaces immediately in dev, not
 *     in production.
 *   - Tests can `tourSchema.parse(...)` to assert against the
 *     public shape without importing the inferred TS type.
 */
import { z } from "zod";

/* ────────── step discriminant ────────── */

/** What a single step in a tour does. */
export const stepKind = z.enum(["navigate", "highlight", "info"]);
export type StepKind = z.infer<typeof stepKind>;

/** A step that pushes the router to `routePath` before the body
 *  is shown. The `routePath` is an in-app route (e.g. "/app/fiscal-gates");
 *  for r2-deferred tours the path may 404 today. */
export const navigateStep = z.object({
  kind: z.literal("navigate"),
  routePath: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
});
export type NavigateStep = z.infer<typeof navigateStep>;

/** A step that pins the overlay to a CSS selector. Reserved for
 *  the spotlight-pinning follow-up — not used in the r2 first cut
 *  because cross-selector pinning across 5 different surfaces
 *  needs a stable testid convention that the r1 routes don't all
 *  ship yet. */
export const highlightStep = z.object({
  kind: z.literal("highlight"),
  selector: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
});
export type HighlightStep = z.infer<typeof highlightStep>;

/** A pure body-of-text step — the body explains what to look at
 *  on the current page; no navigation or selector pinning. */
export const infoStep = z.object({
  kind: z.literal("info"),
  title: z.string().min(1),
  body: z.string().min(1),
});
export type InfoStep = z.infer<typeof infoStep>;

/** Discriminated union of the three step kinds. */
export const tourStep = z.discriminatedUnion("kind", [
  navigateStep,
  highlightStep,
  infoStep,
]);
export type TourStep = z.infer<typeof tourStep>;

/* ────────── tour ────────── */

/** Stable, kebab-case id used for the `a1:tour:<id>:done`
 *  localStorage key. Changing an id resets the "done" flag for
 *  every user — keep ids stable. */
export const tourId = z
  .string()
  .min(1)
  .regex(/^[a-z0-9-]+$/, "tour ids must be kebab-case");
export type TourId = z.infer<typeof tourId>;

/** Full definition of a single tour. `deferred: true` means the
 *  target surface hasn't landed in ant/main yet (r2 W5 / W6);
 *  the tour is still shippable because the overlay gracefully
 *  shows the explanatory copy on a 404. */
export const tour = z.object({
  id: tourId,
  /** Short feature-area name (e.g. "Fiscal gates"). Shown in the
   *  launcher menu and as the overlay's first-step title prefix. */
  feature: z.string().min(1),
  /** The tour's one-line goal (e.g. "Mark a gate as filed").
   *  Shown in the launcher menu and as the overlay's first-step
   *  title prefix. */
  goal: z.string().min(1),
  /** Lucide icon name; resolved at render time. Stored as a
   *  string so DEFAULT_TOURS is plain JSON-serializable. */
  icon: z.string().min(1),
  /** When true, the target route may 404 in the current build.
   *  The launcher still shows the tour (the body explains
   *  "Coming soon"); the overlay doesn't block-redirect. */
  deferred: z.boolean().default(false),
  steps: z.array(tourStep).min(1).max(10),
});
export type Tour = z.infer<typeof tour>;

/** Parsed-and-validated DEFAULT_TOURS array. */
export const tours = z.array(tour).min(1);
export type Tours = z.infer<typeof tours>;

/* ────────── runtime state ────────── */

/** The current view inside the overlay. `closed` is the only
 *  state that doesn't render the modal; every other state opens
 *  the modal at the given step index. */
export type TourView =
  | { kind: "closed" }
  | { kind: "open"; tourId: TourId; stepIndex: number };

/** Pure data returned by `useTour` so the UI doesn't have to
 *  know about localStorage. */
export interface TourRuntime {
  /** All shippable tours (validated DEFAULT_TOURS). */
  tours: ReadonlyArray<Tour>;
  /** Currently open tour view (closed when no overlay is up). */
  view: TourView;
  /** Has the user completed `tourId` at least once? */
  isDone: (tourId: TourId) => boolean;
  /** Start a tour from step 0. Marks any in-flight tour as done. */
  start: (tourId: TourId) => void;
  /** Advance one step. If the tour is at the last step, calls
   *  `markDone` and closes the overlay. */
  next: () => void;
  /** Go back one step. No-op at step 0. */
  back: () => void;
  /** Skip the current tour (no completion recorded, just close). */
  skip: () => void;
  /** Mark the current tour as done and close. */
  finish: () => void;
  /** Reset completion flags for a single tour (used by the
   *  launcher's "Restart" action). */
  reset: (tourId: TourId) => void;
}
