/**
 * components/onboarding — barrel exports.
 *
 * The 5 default tours (lib/onboarding/tours.ts) are surfaced via
 * the Topbar's `OnboardingLauncher` button; the `TourOverlay`
 * modal renders the active tour. The `useTour` hook is the
 * single source of truth for tour state and is consumed by both
 * the launcher and the overlay.
 *
 * Barrel: every component consumer imports from this single
 * path. The same pattern used by `components/shared/index.ts`.
 */
export { TourOverlay } from "./TourOverlay";
export { OnboardingLauncher } from "./OnboardingLauncher";
export { useTour } from "./useTour";
export type { TourRuntime } from "../../lib/onboarding/schemas";
