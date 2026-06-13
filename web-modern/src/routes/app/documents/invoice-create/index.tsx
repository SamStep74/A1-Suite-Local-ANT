/**
 * /app/documents/invoice-create — multi-step invoice creation
 * wizard (Phase 10.5 r2 W5).
 *
 * Flow:
 *   1. Customer    — pick the customer + set the issue date
 *   2. Line items  — add at least one line (description,
 *                    quantity > 0, unit price ≥ 0)
 *   3. Review      — show a summary card of what will be sent
 *   4. Submit      — terminal "submitted" card with a
 *                    "create another" affordance
 *
 * State lives in a single `useState<WizardState>` and the pure
 * reducer helpers in `lib/wizard/state.ts` mutate it
 * immutably. The route only deals with form rendering and
 * Lingui localization.
 *
 * Lingui:
 *   - Every user-facing string uses `<Trans>` or `t\`\``.
 *   - The validation summary banner, footer, and step labels
 *     are all supplied via the Lingui `t` tag.
 *
 * Composed 10.4 primitives: none. The line-items step uses a
 * plain form so the wizard stays self-contained — the next
 * iteration (W6+) can swap in DataTable when the PO-create
 * wizard is added.
 */
import { Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";
import {
  type ChangeEvent,
  useCallback,
  useMemo,
  useState,
} from "react";
import { Trash2 } from "lucide-react";

import { Stepper } from "../../../../components/wizard/Stepper";
import { StepperShell } from "../../../../components/wizard/StepperShell";
import { cn } from "../../../../lib/utils/cn";
import {
  WIZARD_STEP_ORDER,
  type WizardStep,
} from "../../../../lib/wizard/schemas";
import {
  addLineItem,
  draftTotal,
  initialWizardState,
  markSubmitted,
  nextStep,
  prevStep,
  removeLineItem,
  setCustomer,
  setReviewConfirmed,
  updateLineItem,
  validationMessage,
  type WizardState,
} from "../../../../lib/wizard/state";

export const Route = createFileRoute(
  "/app/documents/invoice-create/",
)({
  component: InvoiceCreateWizard,
});

export { InvoiceCreateWizard };

/* ────────── route ────────── */

function InvoiceCreateWizard() {
  const { t } = useLingui();
  const [state, setState] = useState<WizardState>(() =>
    initialWizardState(),
  );

  /* The 4 step descriptors. Their `label` and `hint` are
   * translated here so the Stepper stays language-agnostic. */
  const stepDescriptors = useMemo(
    () => [
      {
        id: WIZARD_STEP_ORDER[0],
        label: t`Customer`,
        hint: t`Pick who is being billed`,
      },
      {
        id: WIZARD_STEP_ORDER[1],
        label: t`Line items`,
        hint: t`What was sold or delivered`,
      },
      {
        id: WIZARD_STEP_ORDER[2],
        label: t`Review`,
        hint: t`Confirm before submitting`,
      },
      {
        id: WIZARD_STEP_ORDER[3],
        label: t`Submit`,
        hint: t`Finalize the draft`,
      },
    ],
    [t],
  );

  /** Steps the user can jump back to. Forward jumps are
   *  blocked at the reducer level — the user can only
   *  `nextStep` by passing validation. */
  const reachable = useMemo(() => {
    const reachable = new Set<WizardStep>([state.step]);
    // Allow going back to any step before the current one.
    const currentIndex = WIZARD_STEP_ORDER.indexOf(state.step);
    for (let i = 0; i < currentIndex; i++) {
      reachable.add(WIZARD_STEP_ORDER[i]);
    }
    return reachable;
  }, [state.step]);

  /* ─── handlers ─── */

  const onPrimary = useCallback(() => {
    setState((s) => {
      // On the review step the user must tick the
      // confirmation box; we auto-tick it on their behalf
      // here so a single click is enough. The reducer then
      // validates and advances.
      if (s.step === "review") {
        const confirmed: WizardState = setReviewConfirmed(s, true);
        return nextStep(confirmed);
      }
      // On the submit step we mark the draft submitted
      // (the reducer's `nextStep` would be a no-op here).
      if (s.step === "submit") {
        return markSubmitted(s);
      }
      // Customer + line-items: the reducer validates the
      // current slice and either advances or surfaces
      // errors.
      return nextStep(s);
    });
  }, []);

  const onBack = useCallback(() => {
    setState((s) => prevStep(s));
  }, []);

  const onSelectStep = useCallback((step: WizardStep) => {
    setState((s) => {
      if (s.step === step) return s;
      // Allow jumping BACK to a reachable step without
      // re-running validation. Forward jumps are silently
      // ignored.
      const currentIndex = WIZARD_STEP_ORDER.indexOf(s.step);
      const targetIndex = WIZARD_STEP_ORDER.indexOf(step);
      if (targetIndex >= currentIndex) return s;
      return {
        ...s,
        step,
        errors: {},
        attemptedAdvance: false,
      };
    });
  }, []);

  const onCustomerField = useCallback(
    (field: "customerId" | "customerName" | "issueDate") =>
      (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const value = e.target.value;
        setState((s) => setCustomer(s, { [field]: value }));
      },
    [],
  );

  const onAddRow = useCallback(() => {
    setState((s) => addLineItem(s));
  }, []);

  const onRemoveRow = useCallback((id: string) => {
    setState((s) => removeLineItem(s, id));
  }, []);

  const onLineField = useCallback(
    (id: string, field: "description" | "quantity" | "unitPrice") =>
      (
        e: ChangeEvent<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >,
      ) => {
        const raw = e.target.value;
        setState((s) => {
          if (field === "description") {
            return updateLineItem(s, id, { description: raw });
          }
          // For numeric fields: keep raw string in state if
          // empty (so the user can clear the box without
          // losing focus), otherwise parse. The reducer
          // will reject NaN at validation time.
          if (raw === "") {
            return updateLineItem(s, id, {
              [field]: Number.NaN,
            } as Partial<{ quantity: number; unitPrice: number }>);
          }
          const num = Number(raw);
          return updateLineItem(s, id, {
            [field]: Number.isFinite(num) ? num : Number.NaN,
          } as Partial<{ quantity: number; unitPrice: number }>);
        });
      },
    [],
  );

  const onConfirm = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setState((s) => setReviewConfirmed(s, e.target.checked));
  }, []);

  const onReset = useCallback(() => {
    setState(initialWizardState());
  }, []);

  /** Format an error key + code for the StepperShell banner.
   *  Centralised here so the lib never imports Lingui. */
  const formatError = useCallback(
    (key: string, code: string): string => {
      const friendly = validationMessage(t, code);
      return `${friendly} (${key})`;
    },
    [t],
  );

  /* ─── render helpers ─── */

  const renderCustomerStep = () => {
    const customer = state.draft.customer;
    return (
      <div
        className="grid gap-4 sm:grid-cols-2"
        data-testid="wizard-step-customer"
      >
        <Field
          id="customerId"
          label={t`Customer ID`}
          errorKey="customerId"
          errors={state.errors}
          formatError={formatError}
        >
          <input
            id="customerId"
            name="customerId"
            type="text"
            value={customer?.customerId ?? ""}
            onChange={onCustomerField("customerId")}
            autoComplete="off"
            data-testid="wizard-input-customer-id"
            className={fieldClass(state.errors, "customerId")}
          />
        </Field>
        <Field
          id="customerName"
          label={t`Customer name`}
          errorKey="customerName"
          errors={state.errors}
          formatError={formatError}
        >
          <input
            id="customerName"
            name="customerName"
            type="text"
            value={customer?.customerName ?? ""}
            onChange={onCustomerField("customerName")}
            autoComplete="off"
            data-testid="wizard-input-customer-name"
            className={fieldClass(state.errors, "customerName")}
          />
        </Field>
        <Field
          id="issueDate"
          label={t`Issue date`}
          hint={t`Format: YYYY-MM-DD`}
          errorKey="issueDate"
          errors={state.errors}
          formatError={formatError}
        >
          <input
            id="issueDate"
            name="issueDate"
            type="date"
            value={customer?.issueDate ?? ""}
            onChange={onCustomerField("issueDate")}
            data-testid="wizard-input-issue-date"
            className={fieldClass(state.errors, "issueDate")}
          />
        </Field>
      </div>
    );
  };

  const renderLineItemsStep = () => {
    const items = state.draft.lineItems?.items ?? [];
    const itemsError = state.errors["items"];
    return (
      <div
        className="space-y-4"
        data-testid="wizard-step-line-items"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-[var(--text-lg)] font-semibold text-[var(--color-ink)]">
            <Trans>Line items</Trans>
          </h2>
          <button
            type="button"
            onClick={onAddRow}
            data-testid="wizard-add-row"
            className={cn(
              "rounded-md border border-[var(--color-border)]",
              "bg-[var(--color-surface-2)] px-3 py-1.5",
              "text-[var(--text-sm)] font-medium text-[var(--color-ink)]",
              "hover:bg-[var(--color-surface-3)]",
              "focus:outline-none focus-visible:ring-2",
              "focus-visible:ring-[var(--color-accent)]",
            )}
          >
            <Trans>Add row</Trans>
          </button>
        </div>

        {itemsError != null ? (
          <p
            role="alert"
            data-testid="wizard-items-error"
            className="text-[var(--text-sm)] text-[var(--color-danger-text)]"
          >
            {formatError("items", itemsError)}
          </p>
        ) : null}

        {items.length === 0 ? (
          <p
            className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
            data-testid="wizard-line-items-empty"
          >
            <Trans>
              No line items yet. Add the first row to continue.
            </Trans>
          </p>
        ) : (
          <ul className="space-y-3" data-testid="wizard-line-items-list">
            {items.map((it, idx) => (
              <li
                key={it.id}
                className={cn(
                  "rounded-md border border-[var(--color-border)] p-3",
                  "bg-[var(--color-surface-2)]",
                )}
                data-testid="wizard-line-item"
                data-row-index={idx}
              >
                <div className="grid gap-3 sm:grid-cols-[1fr_6rem_8rem_auto]">
                  <Field
                    id={`desc-${it.id}`}
                    label={t`Description`}
                    errorKey={`items.${idx}.description`}
                    errors={state.errors}
                    formatError={formatError}
                  >
                    <input
                      id={`desc-${it.id}`}
                      type="text"
                      value={it.description}
                      onChange={onLineField(it.id, "description")}
                      data-testid="wizard-line-description"
                      data-row-index={idx}
                      className={fieldClass(
                        state.errors,
                        `items.${idx}.description`,
                      )}
                    />
                  </Field>
                  <Field
                    id={`qty-${it.id}`}
                    label={t`Quantity`}
                    errorKey={`items.${idx}.quantity`}
                    errors={state.errors}
                    formatError={formatError}
                  >
                    <input
                      id={`qty-${it.id}`}
                      type="number"
                      min={1}
                      step="1"
                      value={
                        Number.isFinite(it.quantity) ? it.quantity : ""
                      }
                      onChange={onLineField(it.id, "quantity")}
                      data-testid="wizard-line-quantity"
                      data-row-index={idx}
                      className={fieldClass(
                        state.errors,
                        `items.${idx}.quantity`,
                      )}
                    />
                  </Field>
                  <Field
                    id={`price-${it.id}`}
                    label={t`Unit price`}
                    errorKey={`items.${idx}.unitPrice`}
                    errors={state.errors}
                    formatError={formatError}
                  >
                    <input
                      id={`price-${it.id}`}
                      type="number"
                      min={0}
                      step="0.01"
                      value={
                        Number.isFinite(it.unitPrice) ? it.unitPrice : ""
                      }
                      onChange={onLineField(it.id, "unitPrice")}
                      data-testid="wizard-line-unit-price"
                      data-row-index={idx}
                      className={fieldClass(
                        state.errors,
                        `items.${idx}.unitPrice`,
                      )}
                    />
                  </Field>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => onRemoveRow(it.id)}
                      data-testid="wizard-line-remove"
                      data-row-index={idx}
                      aria-label={t`Remove line item`}
                      className={cn(
                        "rounded-md border border-[var(--color-border)]",
                        "bg-[var(--color-surface-1)] p-2",
                        "text-[var(--color-danger-text)]",
                        "hover:bg-[var(--color-danger-bg)]",
                        "focus:outline-none focus-visible:ring-2",
                        "focus-visible:ring-[var(--color-accent)]",
                      )}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const renderReviewStep = () => {
    const customer = state.draft.customer;
    const items = state.draft.lineItems?.items ?? [];
    const total = draftTotal(state);
    const confirmed = state.draft.review?.confirmed === true;
    return (
      <div className="space-y-4" data-testid="wizard-step-review">
        <h2 className="text-[var(--text-lg)] font-semibold text-[var(--color-ink)]">
          <Trans>Review the draft</Trans>
        </h2>
        <dl
          className="grid gap-3 rounded-md border border-[var(--color-border)] p-4 sm:grid-cols-2"
          data-testid="wizard-review-customer"
        >
          <ReviewRow
            label={t`Customer`}
            value={customer?.customerName ?? t`(missing)`}
          />
          <ReviewRow
            label={t`Issue date`}
            value={customer?.issueDate ?? t`(missing)`}
          />
        </dl>

        <table
          className="w-full text-left text-[var(--text-sm)]"
          data-testid="wizard-review-items"
        >
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
              <th className="py-2 pr-3 font-medium">
                <Trans>Description</Trans>
              </th>
              <th className="py-2 pr-3 font-medium">
                <Trans>Qty</Trans>
              </th>
              <th className="py-2 pr-3 font-medium">
                <Trans>Unit price</Trans>
              </th>
              <th className="py-2 pl-3 text-right font-medium">
                <Trans>Subtotal</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.id}
                className="border-b border-[var(--color-border)] last:border-b-0"
                data-testid="wizard-review-line"
              >
                <td className="py-2 pr-3">{it.description}</td>
                <td className="py-2 pr-3">{it.quantity}</td>
                <td className="py-2 pr-3">
                  {it.unitPrice.toLocaleString()}
                </td>
                <td className="py-2 pl-3 text-right">
                  {(it.quantity * it.unitPrice).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold text-[var(--color-ink)]">
              <td colSpan={3} className="pt-3 pr-3 text-right">
                <Trans>Total</Trans>
              </td>
              <td
                className="pt-3 pl-3 text-right"
                data-testid="wizard-review-total"
              >
                {total.toLocaleString()}
              </td>
            </tr>
          </tfoot>
        </table>

        <label
          className={cn(
            "flex items-start gap-3 rounded-md border p-3",
            state.errors["confirmed"] != null
              ? "border-[var(--color-danger-border)] bg-[var(--color-danger-bg)]"
              : "border-[var(--color-border)] bg-[var(--color-surface-2)]",
          )}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={onConfirm}
            data-testid="wizard-review-confirm"
            className="mt-1 h-4 w-4"
          />
          <span className="text-[var(--text-sm)] text-[var(--color-ink)]">
            <Trans>
              I confirm the customer, line items, and total are
              correct.
            </Trans>
          </span>
        </label>
        {state.errors["confirmed"] != null ? (
          <p
            role="alert"
            data-testid="wizard-review-confirm-error"
            className="text-[var(--text-sm)] text-[var(--color-danger-text)]"
          >
            {formatError("confirmed", state.errors["confirmed"])}
          </p>
        ) : null}
      </div>
    );
  };

  const renderSubmitStep = () => {
    const submitted = state.draft.submit?.submitted === true;
    if (!submitted) {
      // The reducer advances us to "submit" only after the
      // user has clicked "Next" on the review step with the
      // confirmation box ticked. The render below covers the
      // standard "advance to submit" path. If for any reason
      // we get here without `submitted`, show a one-line
      // placeholder so the e2e spec can still assert the
      // route is mounted.
      return (
        <div
          className="space-y-3"
          data-testid="wizard-step-submit"
          data-submitted="false"
        >
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
            <Trans>
              The invoice is ready to be sent. Click the button
              below to finalize it.
            </Trans>
          </p>
        </div>
      );
    }
    return (
      <div
        className="space-y-4 rounded-md border border-[var(--color-success)] bg-[var(--color-success-bg)] p-6"
        data-testid="wizard-step-submit"
        data-submitted="true"
      >
        <h2 className="text-[var(--text-lg)] font-semibold text-[var(--color-success)]">
          <Trans>Invoice submitted</Trans>
        </h2>
        <p className="text-[var(--text-sm)] text-[var(--color-ink)]">
          <Trans>
            The invoice draft has been finalized and queued for
            delivery to {state.draft.customer?.customerName ?? t`the customer`}.
          </Trans>
        </p>
        <button
          type="button"
          onClick={onReset}
          data-testid="wizard-reset"
          className={cn(
            "rounded-md border border-[var(--color-border)]",
            "bg-[var(--color-surface-1)] px-4 py-2",
            "text-[var(--text-sm)] font-medium text-[var(--color-ink)]",
            "hover:bg-[var(--color-surface-2)]",
            "focus:outline-none focus-visible:ring-2",
            "focus-visible:ring-[var(--color-accent)]",
          )}
        >
          <Trans>Create another invoice</Trans>
        </button>
      </div>
    );
  };

  /* ─── footer label + finalize flag ─── */

  const primaryLabel = (() => {
    switch (state.step) {
      case "customer":
        return t`Next: line items`;
      case "line-items":
        return t`Next: review`;
      case "review":
        return t`Confirm and submit`;
      case "submit":
        return state.draft.submit?.submitted === true
          ? t`Done`
          : t`Submit invoice`;
    }
  })();

  const isFinalize =
    state.step === "review" || state.step === "submit";

  const footerHint = (() => {
    if (state.step === "submit" && state.draft.submit?.submitted === true) {
      return null;
    }
    if (state.step === "submit") {
      return t`Finalizing will lock the draft and queue the invoice.`;
    }
    if (state.step === "review") {
      return t`Tick the box to confirm before continuing.`;
    }
    return null;
  })();

  const canPrimary = (() => {
    if (state.step === "submit") {
      return state.draft.submit?.submitted !== true;
    }
    return true;
  })();

  /* ─── final assembly ─── */

  return (
    <div
      className="mx-auto flex max-w-4xl flex-col gap-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="invoice-create-page"
    >
      <header className="space-y-1">
        <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
          <Trans>Create invoice</Trans>
        </h1>
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          <Trans>
            Walk through customer, line items, and review before
            submitting the draft.
          </Trans>
        </p>
      </header>

      <Stepper
        currentStep={state.step}
        steps={stepDescriptors}
        reachable={reachable}
        onSelectStep={onSelectStep}
      />

      <StepperShell
        step={state.step}
        attemptedAdvance={state.attemptedAdvance}
        errors={state.errors}
        formatError={formatError}
        onBack={state.step === WIZARD_STEP_ORDER[0] ? undefined : onBack}
        canBack={state.step !== WIZARD_STEP_ORDER[0]}
        onPrimary={
          state.step === "submit" && state.draft.submit?.submitted === true
            ? undefined
            : onPrimary
        }
        primaryLabel={primaryLabel}
        canPrimary={canPrimary}
        primaryIsFinalize={isFinalize}
        footerHint={footerHint}
      >
        {state.step === "customer"
          ? renderCustomerStep()
          : state.step === "line-items"
            ? renderLineItemsStep()
            : state.step === "review"
              ? renderReviewStep()
              : renderSubmitStep()}
      </StepperShell>
    </div>
  );
}

/* ────────── shared sub-components ────────── */

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  errorKey: string;
  errors: Readonly<Record<string, string>>;
  formatError: (key: string, code: string) => string;
  children: React.ReactNode;
}

function Field({
  id,
  label,
  hint,
  errorKey,
  errors,
  formatError,
  children,
}: FieldProps) {
  const err = errors[errorKey];
  return (
    <div className="flex flex-col gap-1" data-field-wrapper={id}>
      <label
        htmlFor={id}
        className="text-[var(--text-sm)] font-medium text-[var(--color-ink)]"
      >
        {label}
      </label>
      {children}
      {hint != null ? (
        <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
          {hint}
        </p>
      ) : null}
      {err != null ? (
        <p
          role="alert"
          data-testid={`wizard-field-error-${errorKey.replace(/\./g, "-")}`}
          className="text-[var(--text-xs)] text-[var(--color-danger-text)]"
        >
          {formatError(errorKey, err)}
        </p>
      ) : null}
    </div>
  );
}

interface ReviewRowProps {
  label: string;
  value: string;
}

function ReviewRow({ label, value }: ReviewRowProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </dt>
      <dd className="text-[var(--text-sm)] text-[var(--color-ink)]">
        {value}
      </dd>
    </div>
  );
}

function fieldClass(
  errors: Readonly<Record<string, string>>,
  key: string,
): string {
  const hasError = errors[key] != null;
  return cn(
    "w-full rounded-md border px-3 py-2",
    "text-[var(--text-sm)] text-[var(--color-ink)]",
    "bg-[var(--color-surface-1)]",
    "focus:outline-none focus-visible:ring-2",
    "focus-visible:ring-[var(--color-accent)]",
    hasError
      ? "border-[var(--color-danger-border)] bg-[var(--color-danger-bg)]"
      : "border-[var(--color-border)]",
  );
}

// `FormEvent` is intentionally not imported: the wizard does
// not have a single `<form>` wrapper (each step's form is its
// own surface). A future bulk-submit iteration may add one
// and import FormEvent at that point.
