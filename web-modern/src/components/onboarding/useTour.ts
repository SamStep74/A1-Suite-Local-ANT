/**
 * useTour — React hook driving the first-run tour overlay state.
 *
 * Owns three things:
 *   1. The current view (`closed` | `open` at a step index).
 *   2. The per-tour "done" flag set, hydrated from localStorage on
 *      mount and synced back on every transition.
 *   3. The `start` / `next` / `back` / `skip` / `finish` / `reset`
 *      action surface that TourOverlay and OnboardingLauncher both
 *      consume via `useTour()`.
 *
 * Why a custom hook (vs. Context + Provider):
 *   - The overlay is mounted in exactly one place (Topbar / root
 *     layout). A custom hook with module-scoped state would work,
 *     but the React mental model is "provider at the top, hook
 *     anywhere below". We use React.useState + useEffect to keep
 *     the state in the hook's caller (Topbar), which is also the
 *     single owner of the overlay.
 *   - SSR-safe: every read goes through the helpers in
 *     `lib/onboarding/state.ts`, which guard `typeof window`.
 *
 * State invariants:
 *   - `view.kind === "open"` ⇒ `view.stepIndex` is always
 *     `0 <= stepIndex < tours[i].steps.length`.
 *   - `view.kind === "open"` ⇒ `view.tourId` always resolves to a
 *     known tour via `DEFAULT_TOURS_BY_ID`.
 *   - Calling `next` on the last step marks the tour done and
 *     closes the overlay (same as `finish`).
 *   - Calling `skip` does NOT mark the tour done — the launcher
 *     will re-offer it next session.
 */
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_TOURS, DEFAULT_TOURS_BY_ID } from "../../lib/onboarding/tours";
import { readAllDone, writeDone } from "../../lib/onboarding/state";
import type { TourId, TourRuntime, TourView } from "../../lib/onboarding/schemas";

const CLOSED: TourView = { kind: "closed" };

/**
 * Drives the overlay state. Returns a `TourRuntime` that's stable
 * across renders (the action callbacks are memoized via
 * `useCallback`).
 *
 * @param onNavigate  optional callback fired when a `navigate`
 *   step becomes the active step. TourOverlay wires this to the
 *   router (`navigate({ to: step.routePath })`). Keeping it a
 *   callback (not a direct router import) keeps the hook unit-
 *   testable without a router context.
 */
export function useTour(options?: {
  onNavigate?: (path: string) => void;
}): TourRuntime {
  const onNavigate = options?.onNavigate;
  const [view, setView] = useState<TourView>(CLOSED);
  // Stored as a plain object so the `isDone` callback closes over
  // a stable reference. The `useState` setter writes a new object
  // on every change so React's `===` re-render trigger fires.
  const [doneMap, setDoneMap] = useState<Record<TourId, boolean>>(() =>
    readAllDone(DEFAULT_TOURS.map((t) => t.id)),
  );

  // Cross-tab consistency: if another tab finishes a tour, mirror
  // the flag here. We don't listen for `view` changes — only the
  // done flags, because the overlay itself is per-tab UX.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !e.key.startsWith("a1:tour:") || !e.key.endsWith(":done")) {
        return;
      }
      // Re-read every flag (cheap — 5 keys).
      setDoneMap(readAllDone(DEFAULT_TOURS.map((t) => t.id)));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /** Memoized lookup — the function is referentially stable so
   *  the launcher's `isDone(id)` checks don't cause a re-render. */
  const isDone = useCallback(
    (tourId: TourId): boolean => doneMap[tourId] === true,
    [doneMap],
  );

  const start = useCallback(
    (tourId: TourId) => {
      const tour = DEFAULT_TOURS_BY_ID[tourId];
      if (!tour || tour.steps.length === 0) return;
      const firstStep = tour.steps[0];
      setView({ kind: "open", tourId, stepIndex: 0 });
      // If the first step is a `navigate` step, push the route.
      if (firstStep.kind === "navigate") {
        onNavigate?.(firstStep.routePath);
      }
    },
    [onNavigate],
  );

  const finish = useCallback(() => {
    setView((prev) => {
      if (prev.kind !== "open") return prev;
      // Mark the tour as done; close the overlay.
      writeDone(prev.tourId, true);
      setDoneMap((m) => ({ ...m, [prev.tourId]: true }));
      return CLOSED;
    });
  }, []);

  const skip = useCallback(() => {
    setView(CLOSED);
  }, []);

  const next = useCallback(() => {
    setView((prev) => {
      if (prev.kind !== "open") return prev;
      const tour = DEFAULT_TOURS_BY_ID[prev.tourId];
      if (!tour) return CLOSED;
      const lastIndex = tour.steps.length - 1;
      if (prev.stepIndex >= lastIndex) {
        // Last step — finish instead of advancing.
        writeDone(prev.tourId, true);
        setDoneMap((m) => ({ ...m, [prev.tourId]: true }));
        return CLOSED;
      }
      const nextIndex = prev.stepIndex + 1;
      const nextStep = tour.steps[nextIndex];
      if (nextStep.kind === "navigate") {
        onNavigate?.(nextStep.routePath);
      }
      return { kind: "open", tourId: prev.tourId, stepIndex: nextIndex };
    });
  }, [onNavigate]);

  const back = useCallback(() => {
    setView((prev) => {
      if (prev.kind !== "open" || prev.stepIndex === 0) return prev;
      return { ...prev, stepIndex: prev.stepIndex - 1 };
    });
  }, []);

  const reset = useCallback((tourId: TourId) => {
    writeDone(tourId, false);
    setDoneMap((m) => ({ ...m, [tourId]: false }));
  }, []);

  return {
    tours: DEFAULT_TOURS,
    view,
    isDone,
    start,
    next,
    back,
    skip,
    finish,
    reset,
  };
}
