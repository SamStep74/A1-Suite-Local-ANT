/**
 * state — pure-function wizard state machine (Phase 10.5 r2 W5).
 *
 * The lib owns:
 *   - `initialWizardState()`         — empty wizard at step 0
 *   - `validateStep(state, step)`    — Zod-backed verdict for the
 *                                       current step's slice
 *   - `nextStep(state)`              — advance if the current step
 *                                       validates; otherwise return
 *                                       the same state with the
 *                                       errors map populated
 *   - `prevStep(state)`              — back up one step, clearing
 *                                       transient errors
 *   - `setCustomer(state, payload)`  — typed setter per step
 *   - `setLineItems(state, payload)` — ditto
 *   - `addLineItem(state)` / `removeLineItem(state, id)` — small
 *      helpers the line-items step calls so the route doesn't have
 *      to know the row shape
 *   - `setReviewConfirmed(state, confirmed)`
 *   - `markSubmitted(state)`
 *   - `validationMessage(t, code)`   — single mapping from the
 *      stable `ValidationCode` enum to a Lingui-translated string
 *
 * Why a pure lib (no React, no hooks):
 *   - The route can hold the state in a `useState<WizardState>` and
 *     get cheap updates by passing the result of each helper back
 *     into the setter — no `useReducer` ceremony.
 *   - Unit tests don't need RTL or a render — pure inputs, pure
 *     outputs. Matches the fiscal-gates lib pattern.
 *   - The same helpers can be reused by the future PO-create
 *     wizard (the schema is invoice-specific, but the state-shape
 *     and traversal are generic over `WIZARD_STEP_ORDER`).
 *
 * Lingui:
 *   The lib NEVER returns user-facing strings. `validationMessage()`
 *   is the only function that takes a `t` (the Lingui tag template
 *   tag returned by `useLingui().t`) and turns a stable code into
 *   localized copy at render time. Everything else returns plain
 *   data.
 */
import { useLingui } from "@lingui/react/macro";
import {
  CustomerStepSchema,
  type CustomerStep,
  InvoiceDraftSchema,
  type InvoiceDraft,
  type LineItem,
  LineItemsStepSchema,
  type LineItemsStep,
  ReviewStepSchema,
  type StepErrors,
  type StepValidationResult,
  ValidationCode,
  WIZARD_STEP_ORDER,
  WizardStep,
} from "./schemas";

/* ────────── state shape ────────── */

/** The full wizard state the route holds.
 *
 *  - `step`   : the active step id (drives the Stepper highlight
 *               and which slot StepperShell renders).
 *  - `draft`  : the per-step payloads collected so far. Each slice
 *               is optional so the user can navigate back and
 *               re-edit without losing work.
 *  - `errors` : the most recent `validateStep` failure for the
 *               active step. Cleared on `prevStep` / step changes /
 *               successful `nextStep`.
 *  - `attemptedAdvance`: true once the user has clicked "Next" on
 *               the current step. The UI uses this to decide
 *               whether to render the "fix the errors" summary
 *               banner above the form. */
export interface WizardState {
  readonly step: WizardStep;
  readonly draft: InvoiceDraft;
  readonly errors: StepErrors;
  readonly attemptedAdvance: boolean;
}

/* ────────── helpers ────────── */

const EMPTY_ERRORS: StepErrors = Object.freeze({});

/** Build the initial wizard state. The first step is always
 *  `WIZARD_STEP_ORDER[0]` (customer) and the draft is empty. */
export function initialWizardState(): WizardState {
  return {
    step: WIZARD_STEP_ORDER[0],
    draft: {},
    errors: EMPTY_ERRORS,
    attemptedAdvance: false,
  };
}

/** Generate a stable line-item id. Uses `crypto.randomUUID` when
 *  available; falls back to a Math.random hex for jsdom (and
 *  older browsers) so the test suite doesn't blow up. */
export function newLineItemId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `li-${Math.random().toString(36).slice(2, 10)}`;
}

/** A fresh, empty line item ready to render in the form. */
export function emptyLineItem(): LineItem {
  return {
    id: newLineItemId(),
    description: "",
    quantity: 1,
    unitPrice: 0,
  };
}

/* ────────── validation ────────── */

/** Convert a Zod v4 `safeParse` failure into our `StepErrors`
 *  map. Each issue's `path` is joined with `.` so nested fields
 *  (e.g. `items.0.quantity`) become a single string key the form
 *  renderer can look up. `message` is the stable code we passed
 *  to Zod via `{ message: "…" }`; anything unrecognized falls
 *  back to `required`.
 *
 *  An empty `path` (a root-level issue, e.g. the review step's
 *  `z.literal(true)` failing on the whole record) is mapped to
 *  a special `_form` key so the UI can render it above the
 *  form rather than on a specific field.
 *
 *  Zod v4 types `path` as `PropertyKey[]` (which includes
 *  `symbol`); in practice schema-validation issues only ever
 *  carry string / number paths, but we narrow defensively
 *  rather than coerce via `String()`. */
function issuesToErrors(
  issues: ReadonlyArray<{
    path: ReadonlyArray<PropertyKey>;
    message: string;
  }>,
): StepErrors {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key =
      issue.path.length === 0
        ? "_form"
        : issue.path
            .map((p) => (typeof p === "symbol" ? String(p) : p))
            .join(".");
    // Only keep the FIRST error for a given path — the user only
    // needs one message per field, and Zod sometimes emits both a
    // type error and a refinement on the same path.
    if (!(key in out)) {
      out[key] = issue.message;
    }
  }
  return out as StepErrors;
}

/** Validate the slice of the draft that the current step owns. */
export function validateStep(
  state: WizardState,
  step: WizardStep = state.step,
): StepValidationResult {
  switch (step) {
    case WizardStep.Customer: {
      const parsed = CustomerStepSchema.safeParse(state.draft.customer ?? {});
      if (parsed.success) return { ok: true };
      return { ok: false, errors: issuesToErrors(parsed.error.issues) };
    }
    case WizardStep.LineItems: {
      const parsed = LineItemsStepSchema.safeParse(
        state.draft.lineItems ?? { items: [] },
      );
      if (parsed.success) return { ok: true };
      return { ok: false, errors: issuesToErrors(parsed.error.issues) };
    }
    case WizardStep.Review: {
      const parsed = ReviewStepSchema.safeParse(state.draft.review ?? {});
      if (parsed.success) return { ok: true };
      return { ok: false, errors: issuesToErrors(parsed.error.issues) };
    }
    case WizardStep.Submit:
      // The submit step is a terminal state — nothing to validate.
      return { ok: true };
  }
}

/* ────────── traversal ────────── */

function indexOfStep(step: WizardStep): number {
  return WIZARD_STEP_ORDER.indexOf(step);
}

/** Advance to the next step iff the current step validates.
 *  Otherwise return the same state with `errors` populated and
 *  `attemptedAdvance` flipped so the UI can show the summary. */
export function nextStep(state: WizardState): WizardState {
  const verdict = validateStep(state);
  if (!verdict.ok) {
    return {
      ...state,
      errors: verdict.errors,
      attemptedAdvance: true,
    };
  }
  const i = indexOfStep(state.step);
  if (i < 0 || i >= WIZARD_STEP_ORDER.length - 1) {
    // Already at the terminal step — no-op.
    return { ...state, errors: EMPTY_ERRORS, attemptedAdvance: false };
  }
  return {
    ...state,
    step: WIZARD_STEP_ORDER[i + 1],
    errors: EMPTY_ERRORS,
    attemptedAdvance: false,
  };
}

/** Step back one entry in `WIZARD_STEP_ORDER`. Errors are cleared
 *  so the user lands on a clean form (Review-step errors don't
 *  belong on the Customer screen). */
export function prevStep(state: WizardState): WizardState {
  const i = indexOfStep(state.step);
  if (i <= 0) return state;
  return {
    ...state,
    step: WIZARD_STEP_ORDER[i - 1],
    errors: EMPTY_ERRORS,
    attemptedAdvance: false,
  };
}

/* ────────── per-step setters ────────── */

export function setCustomer(
  state: WizardState,
  payload: Partial<CustomerStep>,
): WizardState {
  const existing = state.draft.customer;
  // Build the merged record without dropping fields the caller
  // didn't supply.
  const merged: Partial<CustomerStep> = {
    customerId: existing?.customerId ?? "",
    customerName: existing?.customerName ?? "",
    issueDate: existing?.issueDate ?? "",
    ...payload,
  };
  return {
    ...state,
    draft: {
      ...state.draft,
      customer: merged as CustomerStep,
    },
    // Re-typing in the field clears the corresponding error so
    // the user sees instant feedback when they fix it.
    errors: clearTouchedErrors(state.errors, Object.keys(payload)),
  };
}

export function setLineItems(
  state: WizardState,
  items: ReadonlyArray<LineItem>,
): WizardState {
  const payload: LineItemsStep = { items: [...items] };
  return {
    ...state,
    draft: { ...state.draft, lineItems: payload },
    errors: EMPTY_ERRORS,
  };
}

/** Append a fresh empty row to the line-items list. */
export function addLineItem(state: WizardState): WizardState {
  const existing = state.draft.lineItems?.items ?? [];
  return setLineItems(state, [...existing, emptyLineItem()]);
}

/** Remove a single row by id. No-op if the id is unknown. */
export function removeLineItem(state: WizardState, id: string): WizardState {
  const existing = state.draft.lineItems?.items ?? [];
  const next = existing.filter((it) => it.id !== id);
  return setLineItems(state, next);
}

/** Update a single field on a single line item. */
export function updateLineItem(
  state: WizardState,
  id: string,
  patch: Partial<Omit<LineItem, "id">>,
): WizardState {
  const existing = state.draft.lineItems?.items ?? [];
  const next = existing.map((it) =>
    it.id === id ? { ...it, ...patch } : it,
  );
  return setLineItems(state, next);
}

export function setReviewConfirmed(
  state: WizardState,
  confirmed: boolean,
): WizardState {
  return {
    ...state,
    draft: {
      ...state.draft,
      review: confirmed ? { confirmed: true } : undefined,
    },
    errors: EMPTY_ERRORS,
  };
}

export function markSubmitted(state: WizardState): WizardState {
  return {
    ...state,
    draft: {
      ...state.draft,
      submit: { submitted: true },
    },
    errors: EMPTY_ERRORS,
  };
}

/* ────────── full-draft validation (review step) ────────── */

/** Validate the WHOLE draft. Used on the review step so the user
 *  can't slip past a missing customer / line item if they
 *  somehow navigated forward without going through `nextStep`. */
export function validateFullDraft(state: WizardState): StepValidationResult {
  const parsed = InvoiceDraftSchema.required({
    customer: true,
    lineItems: true,
  }).safeParse(state.draft);
  if (parsed.success) return { ok: true };
  return { ok: false, errors: issuesToErrors(parsed.error.issues) };
}

/** Sum of `quantity * unitPrice` over the current line items.
 *  Returns 0 if the line-items step has nothing yet. */
export function draftTotal(state: WizardState): number {
  const items = state.draft.lineItems?.items ?? [];
  return items.reduce(
    (sum, it) => sum + it.quantity * it.unitPrice,
    0,
  );
}

/* ────────── error helpers ────────── */

/** When the user edits a field, clear only that field's error
 *  (and any errors whose path starts with one of the touched
 *  keys, e.g. `items.0.quantity` when the user re-typed in row
 *  0). The rest of the errors map is preserved so other invalid
 *  fields stay flagged. */
function clearTouchedErrors(
  errors: StepErrors,
  touchedKeys: ReadonlyArray<string>,
): StepErrors {
  if (touchedKeys.length === 0) return errors;
  const out: Record<string, ValidationCode> = {};
  for (const [key, code] of Object.entries(errors)) {
    const cleared = touchedKeys.some(
      (t) => key === t || key.startsWith(`${t}.`),
    );
    if (!cleared) out[key] = code;
  }
  return out as StepErrors;
}

/* ────────── Lingui validation messages ────────── */

/** Map a stable `ValidationCode` to a localized message. Called
 *  by the route at render time with the Lingui `t` tag from
 *  `useLingui()`. */
export function validationMessage(
  t: ReturnType<typeof useLingui>["t"],
  code: ValidationCode | string,
): string {
  switch (code) {
    case ValidationCode.Required:
      return t`This field is required`;
    case ValidationCode.DateFormat:
      return t`Use YYYY-MM-DD`;
    case ValidationCode.Positive:
      return t`Must be greater than zero`;
    case ValidationCode.Nonnegative:
      return t`Cannot be negative`;
    case ValidationCode.MinOneLine:
      return t`Add at least one line item`;
    case ValidationCode.ConfirmRequired:
      return t`Confirm the draft before submitting`;
    default:
      return t`Invalid value`;
  }
}
