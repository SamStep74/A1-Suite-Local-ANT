/**
 * schemas — Zod + inferred TypeScript types for the document
 * stepper wizard (Phase 10.5 r2 W5).
 *
 * What this file owns:
 *   - The four step-id enum + per-step payload schemas for the
 *     invoice-create flow (`customer` → `line-items` → `review`
 *     → `submit`).
 *   - The composite `InvoiceDraftSchema` that the wizard's
 *     reducer accumulates step-by-step (every step contributes
 *     its slice to the same draft object).
 *   - The `StepValidationResult` discriminated union surfaced
 *     to the UI: `{ ok: true }` lets the user advance, while
 *     `{ ok: false; errors }` is the field-keyed map the form
 *     renders inline.
 *
 * Why Zod and not hand-rolled types:
 *   - Each step's payload is partially-known mid-wizard; the
 *     route validates the *current* slice on "Next" with
 *     `safeParse` so we get the same per-field error format
 *     regardless of step.
 *   - The line-items step uses a min-length refinement (at least
 *     one row, each with positive quantity + non-empty
 *     description). Zod's `.refine()` is the cleanest spot for
 *     that invariant — no React, no Lingui, purely data.
 *   - The reducer (state.ts) and the route share the same
 *     inferred types, so the wizard state and the form fields
 *     stay in lockstep.
 *
 * Lingui:
 *   The schemas carry *message ids* (the keys the route renders
 *   into a `<Trans>` or `t\`\`` macro). They never carry
 *   raw user-facing strings; localization happens at the render
 *   site. The error code returned by `safeParse` is a stable
 *   enum (`required`, `min`, `positive`, …) that the route maps
 *   to a Lingui message via `validationMessage()` in state.ts.
 */
import { z } from "zod";

/* ────────── step ids ────────── */

/** The four steps of the invoice-create wizard. Ordering matters:
 *  `WIZARD_STEP_ORDER` below preserves it for `nextStep` /
 *  `prevStep` traversal. */
export const WizardStep = {
  Customer: "customer",
  LineItems: "line-items",
  Review: "review",
  Submit: "submit",
} as const;

export const WizardStepSchema = z.enum([
  WizardStep.Customer,
  WizardStep.LineItems,
  WizardStep.Review,
  WizardStep.Submit,
]);
export type WizardStep = z.infer<typeof WizardStepSchema>;

/** Canonical traversal order. The Stepper renders dots in this
 *  order and the reducer uses the index to decide `nextStep` /
 *  `prevStep` transitions. */
export const WIZARD_STEP_ORDER: ReadonlyArray<WizardStep> = [
  WizardStep.Customer,
  WizardStep.LineItems,
  WizardStep.Review,
  WizardStep.Submit,
] as const;

/* ────────── per-step payload schemas ────────── */

/** Step 1 — pick the customer + invoice metadata.
 *  The customer is identified by a stable id (e.g. selected from
 *  a typeahead); the route stamps the display name for the review
 *  step but only the id round-trips to the server.
 *
 *  `issueDate` is an ISO YYYY-MM-DD string so the wizard state
 *  serializes cleanly (no Date instances in storage).
 *
 *  The `z.string({ message: "required" })` form is what Zod v4
 *  needs to surface `required` when the field is *missing*
 *  (`undefined`); the `.min(1, { message: "required" })` form
 *  only fires for the empty-string case. Both code paths land on
 *  the same stable code. */
export const CustomerStepSchema = z.object({
  customerId: z
    .string({ message: "required" })
    .min(1, { message: "required" }),
  customerName: z
    .string({ message: "required" })
    .min(1, { message: "required" }),
  issueDate: z
    .string({ message: "required" })
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "date-format" }),
});
export type CustomerStep = z.infer<typeof CustomerStepSchema>;

/** A single line item on the invoice. */
export const LineItemSchema = z.object({
  id: z.string(),
  description: z
    .string({ message: "required" })
    .min(1, { message: "required" }),
  quantity: z
    .number({ message: "required" })
    .positive({ message: "positive" })
    .finite(),
  unitPrice: z
    .number({ message: "required" })
    .nonnegative({ message: "nonnegative" })
    .finite(),
});
export type LineItem = z.infer<typeof LineItemSchema>;

/** Step 2 — line items. At least one row is required. */
export const LineItemsStepSchema = z.object({
  items: z
    .array(LineItemSchema)
    .min(1, { message: "min-one-line" }),
});
export type LineItemsStep = z.infer<typeof LineItemsStepSchema>;

/** Step 3 — review. Carries no extra fields, but the explicit
 *  schema lets `validateStep` give the user a "everything looks
 *  good" verdict without re-checking earlier steps. */
export const ReviewStepSchema = z.object({
  confirmed: z.literal(true, {
    message: "confirm-required",
  }),
});
export type ReviewStep = z.infer<typeof ReviewStepSchema>;

/** Step 4 — submit. The wizard sets `submitted: true` once the
 *  route's submit handler returns; the UI uses that to render
 *  the success card. */
export const SubmitStepSchema = z.object({
  submitted: z.boolean(),
});
export type SubmitStep = z.infer<typeof SubmitStepSchema>;

/* ────────── composite draft ────────── */

/** The full in-flight invoice draft. The reducer keeps every
 *  field optional so we can serialize partial state when the
 *  user backs out mid-wizard (no "form was reset" surprise on
 *  step navigation).
 *
 *  When the route hits Submit it builds the full payload from
 *  this draft and ships it; until then the optionality is a
 *  feature, not a bug. */
export const InvoiceDraftSchema = z.object({
  customer: CustomerStepSchema.optional(),
  lineItems: LineItemsStepSchema.optional(),
  review: ReviewStepSchema.optional(),
  submit: SubmitStepSchema.optional(),
});
export type InvoiceDraft = z.infer<typeof InvoiceDraftSchema>;

/* ────────── per-step validation result ────────── */

/** Stable per-field validation code. The route maps it to a
 *  Lingui message in `validationMessage()`; the schema returns
 *  it verbatim from `.safeParse()` via the `message` argument
 *  passed above. */
export const ValidationCode = {
  Required: "required",
  DateFormat: "date-format",
  Positive: "positive",
  Nonnegative: "nonnegative",
  MinOneLine: "min-one-line",
  ConfirmRequired: "confirm-required",
} as const;

export type ValidationCode =
  (typeof ValidationCode)[keyof typeof ValidationCode];

/** Per-field error map: dot-notation field path → stable error
 *  code. `items.0.quantity` is the path for the quantity of the
 *  first line item. */
export type StepErrors = Readonly<Record<string, ValidationCode>>;

/** Tagged result of validating one step's slice. The
 *  `errors` map is non-empty when `ok` is false. */
export type StepValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: StepErrors };
