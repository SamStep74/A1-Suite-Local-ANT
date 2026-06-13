/**
 * Stepper — the visual progress bar for the document-steppers
 * wizard (Phase 10.5 r2 W5).
 *
 * Renders a horizontal row of "step dots" — one per entry in
 * `WIZARD_STEP_ORDER` — with a connector line between them.
 * The active step is filled; earlier steps show a check icon;
 * future steps stay hollow. Each dot is keyboard-focusable so
 * the user can jump back to a completed step (the
 * `onSelectStep` callback decides whether selection is
 * allowed).
 *
 * Why a dedicated component:
 *   - The visual vocabulary (dot, connector, current, complete)
 *     is consistent across surfaces. Triage-inbox + period-close
 *     both have similar concepts but each rolled their own
 *     ad-hoc markup. The wizard needs a single source of truth.
 *   - The dot is its own button so it can carry a
 *     `data-step` attribute the e2e spec can target without
 *     going through label-text lookups.
 *   - It owns ZERO copy directly. Step labels are passed in as
 *     already-translated `ReactNode` values so the caller (the
 *     route) can colocate its `useLingui().t` calls.
 */
import { Check } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
} from "react";

import { WIZARD_STEP_ORDER, type WizardStep } from "../../lib/wizard/schemas";
import { cn } from "../../lib/utils/cn";

/* ────────── props ────────── */

export interface StepperStepDescriptor {
  /** Stable id — must match a `WizardStep` value. */
  id: WizardStep;
  /** Already-translated label. */
  label: ReactNode;
  /** Optional secondary line (e.g. the count of line items
   *  collected so far). Render-only — does not affect a11y. */
  hint?: ReactNode;
}

export interface StepperProps {
  /** The step the wizard is currently on. */
  currentStep: WizardStep;
  /** All step descriptors in display order. The wizard's
   *  `WIZARD_STEP_ORDER` is the source of truth, but the
   *  caller supplies the localized labels. */
  steps: ReadonlyArray<StepperStepDescriptor>;
  /** Steps the user may jump back to. Forward jumps are
   *  blocked at the reducer level so the Stepper doesn't
   *  need to filter them — the caller passes the set of
   *  currently-reachable steps. */
  reachable: ReadonlySet<WizardStep>;
  onSelectStep: (step: WizardStep) => void;
  className?: string;
}

/* ────────── helpers ────────── */

function isComplete(
  order: ReadonlyArray<WizardStep>,
  current: WizardStep,
  candidate: WizardStep,
): boolean {
  return order.indexOf(candidate) < order.indexOf(current);
}

function isLast(
  order: ReadonlyArray<WizardStep>,
  candidate: WizardStep,
): boolean {
  return order.indexOf(candidate) === order.length - 1;
}

/* ────────── component ────────── */

export function Stepper({
  currentStep,
  steps,
  reachable,
  onSelectStep,
  className,
}: StepperProps) {
  const currentIndex = WIZARD_STEP_ORDER.indexOf(currentStep);

  const handleKey = useCallback(
    (
      e: KeyboardEvent<HTMLButtonElement>,
      step: WizardStep,
    ) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelectStep(step);
      }
    },
    [onSelectStep],
  );

  return (
    <ol
      className={cn(
        "flex w-full items-stretch gap-0",
        className,
      )}
      data-testid="wizard-stepper"
      data-current-step={currentStep}
      aria-label="Wizard progress"
    >
      {steps.map((step) => {
        const stepIndex = WIZARD_STEP_ORDER.indexOf(step.id);
        const isCurrent = step.id === currentStep;
        const complete = isComplete(WIZARD_STEP_ORDER, currentStep, step.id);
        const last = isLast(WIZARD_STEP_ORDER, step.id);
        const clickable = reachable.has(step.id);

        return (
          <li
            key={step.id}
            className={cn(
              "flex flex-1 items-center",
              "min-w-0",
            )}
            data-step={step.id}
            data-state={
              isCurrent ? "current" : complete ? "complete" : "upcoming"
            }
            data-reachable={clickable ? "true" : "false"}
          >
            <button
              type="button"
              className={cn(
                "group flex w-full items-center gap-3 px-2 py-2",
                "rounded-md text-left",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
                clickable
                  ? "cursor-pointer hover:bg-[var(--color-surface-2)]"
                  : "cursor-default",
              )}
              onClick={clickable ? () => onSelectStep(step.id) : undefined}
              onKeyDown={clickable ? (e) => handleKey(e, step.id) : undefined}
              aria-current={isCurrent ? "step" : undefined}
              aria-disabled={!clickable}
              tabIndex={clickable ? 0 : -1}
              data-testid={`wizard-step-${step.id}`}
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  "border-2 text-[var(--text-sm)] font-semibold",
                  "transition-colors",
                  isCurrent &&
                    "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-on-accent)]",
                  complete &&
                    "border-[var(--color-success)] bg-[var(--color-success)] text-[var(--color-on-accent)]",
                  !isCurrent &&
                    !complete &&
                    "border-[var(--color-border)] bg-[var(--color-surface-1)] text-[var(--color-muted)]",
                )}
                aria-hidden="true"
              >
                {complete ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <span>{stepIndex + 1}</span>
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  className={cn(
                    "truncate text-[var(--text-sm)] font-medium",
                    isCurrent
                      ? "text-[var(--color-ink)]"
                      : complete
                        ? "text-[var(--color-ink)]"
                        : "text-[var(--color-muted)]",
                  )}
                >
                  {step.label}
                </span>
                {step.hint != null ? (
                  <span
                    className={cn(
                      "truncate text-[var(--text-xs)]",
                      "text-[var(--color-muted)]",
                    )}
                  >
                    {step.hint}
                  </span>
                ) : null}
              </span>
            </button>
            {!last ? (
              <span
                className={cn(
                  "mx-1 h-px flex-1",
                  stepIndex < currentIndex
                    ? "bg-[var(--color-success)]"
                    : "bg-[var(--color-border)]",
                )}
                aria-hidden="true"
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
