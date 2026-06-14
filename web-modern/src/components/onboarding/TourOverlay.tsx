/**
 * TourOverlay — the modal chrome for a running tour.
 *
 * Layout:
 *   - Centered card on a dimmed backdrop.
 *   - Header: feature · goal (1 line) — provides context for
 *     users who jumped into a tour mid-flow.
 *   - Body: the current step's title + body.
 *   - Footer: progress dots (1 per step) + Back / Next / Skip
 *     buttons. The Next button is the primary CTA; the last step
 *     renames it to "Done" and triggers `finish()`.
 *   - Close (×) icon in the top-right; same as Skip (does not
 *     mark the tour done).
 *
 * Why controlled mode (parent owns the runtime):
 *   - TourOverlay is a pure function of `runtime` from `useTour()`.
 *     The parent (Topbar / OnboardingLauncher host) decides when
 *     the overlay is mounted; the overlay never owns its own open
 *     state. This matches the controlled-component convention used
 *     by `PeekPanel` and `AskAiPanel`.
 *   - Tests can pass a `runtime` with `view: { kind: "closed" }`
 *     and the overlay renders `null` — no extra mocking needed for
 *     the "no tour running" baseline.
 *
 * Lingui:
 *   The chrome (button labels, step counter, deferred badge) is
 *   fully i18n'd via the React `Trans` / `useLingui` macros. The
 *   step body copy comes from the tour definition (already
 *   translated via `t({ message: ... })` at module load).
 *
 * Accessibility:
 *   - role="dialog" + aria-modal="true" on the card.
 *   - aria-labelledby points at the title heading.
 *   - Escape key closes (via the parent's `skip`) — handled in
 *     useEffect below.
 *   - The primary CTA is the only initially-focused element;
 *     Tab order stays natural (Back → Next → Close).
 */
import { useEffect, useRef } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronLeft, ChevronRight, X, Circle } from "lucide-react";
import { cn } from "../../lib/utils/cn";
import { Button } from "../ui/Button";
import { DEFAULT_TOURS_BY_ID } from "../../lib/onboarding/tours";
import type { TourRuntime, TourStep } from "../../lib/onboarding/schemas";

interface Props {
  runtime: TourRuntime;
}

/** The step that the overlay should show. Derived inside the
 *  component so tests can change the step index without
 *  re-rendering the whole runtime. */
function pickStep(runtime: TourRuntime): TourStep | null {
  if (runtime.view.kind !== "open") return null;
  const tour = DEFAULT_TOURS_BY_ID[runtime.view.tourId];
  if (!tour) return null;
  return tour.steps[runtime.view.stepIndex] ?? null;
}

export function TourOverlay({ runtime }: Props) {
  const { t } = useLingui();
  const step = pickStep(runtime);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  // Pull the parent tour + step for header/footer copy.
  const tour =
    runtime.view.kind === "open"
      ? DEFAULT_TOURS_BY_ID[runtime.view.tourId]
      : null;
  const stepIndex = runtime.view.kind === "open" ? runtime.view.stepIndex : 0;
  const totalSteps = tour?.steps.length ?? 0;
  const isLastStep = stepIndex === totalSteps - 1;
  const isFirstStep = stepIndex === 0;

  // Close on Escape. `skip` is referentially stable (memoized in
  // the hook) so we don't need to depend on the runtime prop.
  useEffect(() => {
    if (runtime.view.kind !== "open") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        runtime.skip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runtime.view.kind, runtime]);

  // Focus the primary CTA when the dialog opens (or the step
  // changes). The primary CTA is the only initially-focused
  // element so the screen-reader announces the dialog title
  // before the user can tab away.
  useEffect(() => {
    if (runtime.view.kind === "open") {
      primaryRef.current?.focus();
    }
  }, [runtime.view.kind, stepIndex]);

  if (runtime.view.kind !== "open" || !tour || !step) {
    return null;
  }

  return (
    <div
      data-testid="tour-overlay"
      data-tour-id={tour.id}
      data-step-index={stepIndex}
      data-step-kind={step.kind}
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      role="presentation"
    >
      {/* Backdrop — click to skip (does not mark done). */}
      <button
        type="button"
        aria-label={t({ message: "Close tour" })}
        onClick={runtime.skip}
        data-testid="tour-overlay-backdrop"
        className="absolute inset-0 bg-black/40"
        tabIndex={-1}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-overlay-title"
        data-testid="tour-overlay-dialog"
        className={cn(
          "relative z-10 w-full max-w-md mx-4",
          "rounded-[var(--radius-lg)] border border-[var(--color-line)]",
          "bg-[var(--color-surface)] text-[var(--color-ink)]",
          "shadow-2xl",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
              {tour.feature as string}
              {tour.deferred ? (
                <span
                  data-testid="tour-overlay-deferred-badge"
                  className="ml-2 inline-block rounded-[var(--radius-sm)] bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-amber-900"
                >
                  <Trans>Preview · ships in 10.5 r2</Trans>
                </span>
              ) : null}
            </div>
            <h2
              id="tour-overlay-title"
              className="mt-0.5 text-[var(--text-md)] font-semibold leading-tight"
            >
              {tour.goal as string}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={runtime.skip}
            aria-label={t({ message: "Close tour" })}
            data-testid="tour-overlay-close"
            className="!p-1"
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <h3
            data-testid="tour-overlay-step-title"
            className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]"
          >
            {step.title as string}
          </h3>
          <p
            data-testid="tour-overlay-step-body"
            className="mt-1.5 text-[var(--text-sm)] leading-relaxed text-[var(--color-muted)]"
          >
            {step.body as string}
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 pb-4">
          <div
            data-testid="tour-overlay-progress"
            className="flex items-center gap-1"
            aria-label={t({
              message: "Step {step} of {total}",
            }).replace("{step}", String(stepIndex + 1)).replace("{total}", String(totalSteps))}
          >
            {tour.steps.map((_, i) => (
              <Circle
                key={i}
                aria-hidden="true"
                data-testid={`tour-overlay-dot-${i}`}
                data-active={i === stepIndex}
                className={cn(
                  "size-1.5 transition-colors",
                  i === stepIndex
                    ? "fill-[var(--color-brand)] text-[var(--color-brand)]"
                    : "fill-[var(--color-line)] text-[var(--color-line)]",
                )}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={runtime.back}
              disabled={isFirstStep}
              data-testid="tour-overlay-back"
              className="!px-2"
            >
              <ChevronLeft className="size-3.5" />
              <Trans>Back</Trans>
            </Button>
            <Button
              ref={primaryRef}
              variant="primary"
              size="sm"
              onClick={runtime.next}
              data-testid="tour-overlay-next"
            >
              {isLastStep ? (
                <Trans>Done</Trans>
              ) : (
                <>
                  <Trans>Next</Trans>
                  <ChevronRight className="size-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
