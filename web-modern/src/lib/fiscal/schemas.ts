/**
 * schemas — Zod + inferred TypeScript types for the fiscal-gates surface.
 *
 * The fiscal-gates page is a per-period tax-action list: a
 * `FilingPeriod` is a calendar period (e.g. 2026-06), a `FiscalGate`
 * is a single tax obligation inside that period (VAT filing, payroll
 * tax, withholding, social contributions, etc.), and a `GateStatus`
 * is the lifecycle state of that obligation. `GateAction` is the
 * dispatch type used by BulkActionBar and UndoToast to record what
 * the user just did.
 *
 * Why Zod and not a hand-rolled type alias:
 *   - The gate definitions are seeded from a JSON-shaped fixture
 *     (see `gates.ts`); Zod gives us runtime validation at the seam
 *     and a single source for both the type and the validator.
 *   - GateAction is the discriminant that the route's reducer and
 *     the BulkActionBar share — using a Zod enum keeps the wire
 *     format and the in-app type in lockstep.
 *
 * Lingui:
 *   - The user-visible status / action / category labels are NOT
 *     stored on the gate (that would defeat i18n). The seed gates
 *     carry an `id` (the stable key, e.g. `vat-monthly`) and the
 *     route translates the id into a display string via
 *     `lib/fiscal/labels.ts` (also covered by `<Trans>` / `t` ``).
 *   - The schemas below stay pure data — no JSX, no Lingui macros.
 */
import { z } from "zod";

/* ────────── status + action enums ────────── */

/** Lifecycle of a single tax obligation. */
export const GateStatus = {
  /** Nothing has been done yet — the period is open. */
  Pending: "pending",
  /** The user has acknowledged the gate but not yet filed. */
  Acknowledged: "acknowledged",
  /** The gate has been filed (or paid) for the period. */
  Filed: "filed",
  /** The gate is overdue and needs immediate attention. */
  Overdue: "overdue",
  /** The user has escalated the gate to a human (e.g. accountant). */
  Escalated: "escalated",
} as const;

export const GateStatusSchema = z.enum([
  GateStatus.Pending,
  GateStatus.Acknowledged,
  GateStatus.Filed,
  GateStatus.Overdue,
  GateStatus.Escalated,
]);
export type GateStatus = z.infer<typeof GateStatusSchema>;

/** Bulk-action dispatch keys used by the BulkActionBar + UndoToast. */
export const GateAction = {
  Acknowledge: "acknowledge",
  MarkFiled: "mark_filed",
  Escalate: "escalate",
} as const;

export const GateActionSchema = z.enum([
  GateAction.Acknowledge,
  GateAction.MarkFiled,
  GateAction.Escalate,
]);
export type GateAction = z.infer<typeof GateActionSchema>;

/** Stable, low-cardinality gate category — drives the saved-views
 *  grouping and the column header. */
export const GateCategory = {
  Vat: "vat",
  PayrollTax: "payroll_tax",
  Withholding: "withholding",
  SocialContribution: "social_contribution",
  Pension: "pension",
  Statistical: "statistical",
  Excise: "excise",
  Environmental: "environmental",
  Customs: "customs",
  Other: "other",
} as const;

export const GateCategorySchema = z.enum([
  GateCategory.Vat,
  GateCategory.PayrollTax,
  GateCategory.Withholding,
  GateCategory.SocialContribution,
  GateCategory.Pension,
  GateCategory.Statistical,
  GateCategory.Excise,
  GateCategory.Environmental,
  GateCategory.Customs,
  GateCategory.Other,
]);
export type GateCategory = z.infer<typeof GateCategorySchema>;

/* ────────── filing period ────────── */

/** `YYYY-MM` calendar period, e.g. `"2026-06"`. The Armenian
 *  rendering is done in the route via the existing period helpers
 *  (see `routes/app/finance/index.tsx`). */
export const FilingPeriodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "FilingPeriod must be YYYY-MM");
export type FilingPeriod = z.infer<typeof FilingPeriodSchema>;

/* ────────── single gate ────────── */

export interface FiscalGate {
  /** Stable id, e.g. `"vat-monthly-2026-06"`. Used as the DataTable
   *  row id and as the key for `useFiscalGate(id)`. */
  id: string;
  /** Stable, human-readable key for the gate definition itself (the
   *  same gate appears every period). E.g. `"vat-monthly"`. The
   *  route's i18n layer translates this into a localized label. */
  kind: string;
  category: GateCategory;
  /** The period the gate belongs to. */
  period: FilingPeriod;
  /** Filing deadline for the period (ISO date `YYYY-MM-DD`). */
  dueDate: string;
  status: GateStatus;
  /** Estimated amount in AMD (Armenian dram). `null` when the gate
   *  has no monetary component (e.g. statistical returns). */
  amount: number | null;
  /** True if the gate is waiting on a third party (e.g. customer
   *  invoice, supplier confirmation) before the user can file. */
  awaitingCustomer: boolean;
  /** Free-form note — usually the customer's TIN, a reference
   *  number, or a short justification. */
  note: string;
}

export const FiscalGateSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  category: GateCategorySchema,
  period: FilingPeriodSchema,
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD"),
  status: GateStatusSchema,
  amount: z.number().int().nonnegative().nullable(),
  awaitingCustomer: z.boolean(),
  note: z.string().max(280),
});

/* ────────── response envelope ────────── */

/** Shape returned by `getCurrentPeriodGates()` and friends. Mirrors
 *  the API response envelope from `lib/patterns.ts` (success/data/
 *  error) — but trimmed to the 2 fields this surface actually
 *  consumes. The route never reads `error`; the caller handles
 *  thrown exceptions. */
export interface FiscalGatesResponse {
  success: boolean;
  data: ReadonlyArray<FiscalGate>;
}

export const FiscalGatesResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(FiscalGateSchema),
});

/* ────────── typed mutation contract ────────── */

export interface GateMutationInput {
  ids: ReadonlyArray<string>;
  action: GateAction;
}

export const GateMutationInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "ids must be non-empty"),
  action: GateActionSchema,
});
