/**
 * StepperShell — the wizard chrome that wraps every step in
 * the document-steppers flow (Phase 10.5 r2 W5).
 *
 * Renders:
 *   - the `Stepper` progress dots
 *   - the active step's body (a slot the route fills with a
 *     form, a review card, a success card, …)
 *   - a validation summary banner above the body when the
 *     user has clicked "Next" with an invalid form
 *   - a footer with `Back` / `Next` / `Submit` buttons — the
 *     label and onClick are driven by the caller
 *
 * Why a shell:
 *   - The chrome is identical across every step. Only the
 *     `children` and the footer wiring change. Centralising
 *     the layout in one component keeps the wizard route
 *     focused on form state.
 *   - The shell owns ZERO copy directly. The route calls
 *     `useLingui()` and supplies the labels for each step
 *     (the labels change shape — "Next" → "Submit" — so
 *     they don't fit cleanly into a single `t` macro per
 *     component). The error summary and the "Fix the
 *     highlighted fields" hint, however, ARE static and
 *     live here.
 *   - The shell is intentionally dumb about validation. It
 *     just renders the `errors` prop the caller hands it
 *     (a `StepErrors` map). The route is responsible for
 *     converting Zod issues into per-field messages via
 *     `validationMessage(t, code)` from lib/wizard/state.
 */
import { Trans, useLingui } from "@lingui/react/macro";
import {
  type ReactNode,
  useId,
} from "react";

import {
  type StepErrors,
  type WizardStep,
} from "../../lib/wizard/schemas";
import { cn } from "../../lib/utils/cn";

/* ────────── props ────────── */

export interface StepperShellProps {
  /** The step currently rendered. Drives the
   *  `data-current-step` attribute on the wrapper. */
  step: WizardStep;
  /** The body to render between header and footer. */
  children: ReactNode;
  /** True when the user has clicked "Next" at least once on
   *  the current step. Controls whether the validation
   *  summary banner is visible. */
  attemptedAdvance: boolean;
  /** Per-field error map for the current step. The shell
   *  formats each entry via `formatError`, so the caller can
   *  pass already-translated strings. */
  errors: StepErrors;
  /** Convert a single error key (e.g. `items.0.quantity`) +
   *  code into a localized message. The route supplies this
   *  so the lib has no Lingui dependency. */
  formatError: (key: string, code: string) => string;
  /** Back button. Hidden on the first step. */
  onBack?: () => void;
  /** When false, the Back button is rendered disabled. */
  canBack?: boolean;
  /** Footer primary action. The route swaps the label via
   *  `primaryLabel` so "Next" / "Submit" can share the same
   *  slot. */
  onPrimary?: () => void;
  primaryLabel: ReactNode;
  /** When false, the primary button is rendered disabled. */
  canPrimary?: boolean;
  /** True on the terminal (Submit) step — visually emphasizes
   *  the primary button as the "finalize" action. */
  primaryIsFinalize?: boolean;
  /** Optional helper line above the footer. */
  footerHint?: ReactNode;
  className?: string;
}

/* ────────── component ────────── */

export function StepperShell({
  step,
  children,
  attemptedAdvance,
  errors,
  formatError,
  onBack,
  canBack = true,
  onPrimary,
  primaryLabel,
  canPrimary = true,
  primaryIsFinalize = false,
  footerHint,
  className,
}: StepperShellProps) {
  const { t } = useLingui();
  const errorListId = useId();

  const errorEntries = Object.entries(errors);
  const showSummary = attemptedAdvance && errorEntries.length > 0;

  return (
    <section
      className={cn(
        "flex w-full flex-col gap-6",
        "rounded-[var(--radius-lg)]",
        "border border-[var(--color-border)]",
        "bg-[var(--color-surface-1)]",
        "p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8",
        className,
      )}
      data-testid="wizard-shell"
      data-current-step={step}
      data-attempted-advance={attemptedAdvance ? "true" : "false"}
    >
      {showSummary ? (
        <div
          role="alert"
          aria-live="polite"
          aria-describedby={errorListId}
          data-testid="wizard-error-summary"
          className={cn(
            "rounded-md border border-[var(--color-danger-border)]",
            "bg-[var(--color-danger-bg)] p-4",
            "text-[var(--color-danger-text)]",
          )}
        >
          <p className="text-[var(--text-sm)] font-semibold">
            <Trans>Please fix the highlighted fields</Trans>
          </p>
          <ul id={errorListId} className="mt-2 list-disc pl-5 text-[var(--text-sm)]">
            {errorEntries.map(([key, code]) => (
              <li
                key={key}
                data-field={key}
                className="text-[var(--color-danger-text)]"
              >
                {formatError(key, code)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex-1" data-testid="wizard-step-body">
        {children}
      </div>

      <footer
        className={cn(
          "flex flex-wrap items-center justify-between gap-3",
          "border-t border-[var(--color-border)] pt-4",
        )}
        data-testid="wizard-footer"
      >
        <div className="flex items-center gap-3">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              disabled={!canBack}
              data-testid="wizard-back"
              className={cn(
                "rounded-md border border-[var(--color-border)]",
                "bg-[var(--color-surface-2)] px-4 py-2",
                "text-[var(--text-sm)] font-medium text-[var(--color-ink)]",
                "transition-colors hover:bg-[var(--color-surface-3)]",
                "focus:outline-none focus-visible:ring-2",
                "focus-visible:ring-[var(--color-accent)]",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <Trans>Back</Trans>
            </button>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col items-end gap-1">
          {footerHint ? (
            <p
              className="text-[var(--text-xs)] text-[var(--color-muted)]"
              data-testid="wizard-footer-hint"
            >
              {footerHint}
            </p>
          ) : null}
          {onPrimary ? (
            <button
              type="button"
              onClick={onPrimary}
              disabled={!canPrimary}
              data-testid="wizard-primary"
              data-primary-kind={primaryIsFinalize ? "submit" : "next"}
              className={cn(
                "rounded-md px-4 py-2",
                "text-[var(--text-sm)] font-semibold",
                "transition-colors",
                "focus:outline-none focus-visible:ring-2",
                "focus-visible:ring-[var(--color-accent)]",
                "disabled:cursor-not-allowed disabled:opacity-50",
                primaryIsFinalize
                  ? "bg-[var(--color-success)] text-[var(--color-on-accent)] hover:bg-[var(--color-success-hover,var(--color-success))]"
                  : "bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover,var(--color-accent))]",
              )}
              aria-label={
                primaryIsFinalize
                  ? t`Submit invoice draft`
                  : t`Go to the next step`
              }
            >
              {primaryLabel}
            </button>
          ) : null}
        </div>
      </footer>
    </section>
  );
}
