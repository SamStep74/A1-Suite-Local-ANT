/**
 * state — localStorage persistence for the onboarding tour overlay.
 *
 * Why a separate "done" flag per tour (vs. one shared `a1:tours:done`):
 *   - The launcher shows all 5 tours in its menu with a checkmark
 *     for completed ones. One shared flag would force "did the
 *     user complete ANY tour" semantics, which loses the per-tour
 *     "Restart" affordance the plan calls for.
 *   - Per-key storage is the same pattern as `a1:locale` and the
 *     `a1:savedView:<key>` pattern from lib/components/savedViewsStore.
 *
 * Key shape: `a1:tour:<tourId>:done` (the `:done` suffix lets us
 * add `:step` / `:viewedAt` siblings later without bumping the
 * reader's namespace).
 *
 * The "1" sentinel matches what the legacy onboarding flow wrote
 * (so users who already finished a tour before this rewrite see
 * the checkmark immediately on first paint).
 */
import type { TourId } from "./schemas";

/** localStorage key for the per-tour "done" flag. */
export const doneKey = (tourId: TourId): string => `a1:tour:${tourId}:done`;

/** The sentinel value we write when a tour is completed.
 *  Kept as a named constant so the test can assert against it. */
export const DONE_VALUE = "1";

/** SSR-safe read. Returns `false` outside the browser. */
export const readDone = (tourId: TourId): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(doneKey(tourId)) === DONE_VALUE;
  } catch {
    // localStorage can throw in private-browsing or quota-exceeded
    // modes. Treat as "not done" — the worst case is the launcher
    // re-offers a finished tour.
    return false;
  }
};

/** SSR-safe write. No-op outside the browser. */
export const writeDone = (tourId: TourId, done: boolean): void => {
  if (typeof window === "undefined") return;
  try {
    if (done) {
      window.localStorage.setItem(doneKey(tourId), DONE_VALUE);
    } else {
      window.localStorage.removeItem(doneKey(tourId));
    }
  } catch {
    // Same swallow policy as readDone — we don't want a quota
    // hiccup to brick the launcher.
  }
};

/** Read every stored done flag at once. Used by the launcher on
 *  mount to render the per-tour checkmarks in one pass instead of
 *  hitting localStorage 5 times during render. */
export const readAllDone = (
  tourIds: ReadonlyArray<TourId>,
): Record<TourId, boolean> => {
  const out = {} as Record<TourId, boolean>;
  for (const id of tourIds) {
    out[id] = readDone(id);
  }
  return out;
};
