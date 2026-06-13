/**
 * gates — typed gate definitions + seed data for the fiscal-gates
 * surface.
 *
 * What this file owns:
 *   - The `GATE_DEFINITIONS` registry: the list of obligations that
 *     recur every period (VAT, payroll tax, withholding, social
 *     contributions, …). Each definition is *static* — same every
 *     month — and is the source of truth for the gate's category,
 *     default amount, and the i18n key the route uses for the
 *     display label.
 *   - `seedGatesForPeriod(period, now)`: derives the actual gate
 *     list for a given month by stamping each definition with the
 *     period's due date and computing a deterministic status from
 *     "now". Used by the route as the initial dataset (the route
 *     owns the in-memory mutations; this file is read-only).
 *   - Pure helpers used by the route's reducer: `applyGateMutation`
 *     (immutable update), `isOverdue`, `partitionByStatus`, and the
 *     SavedViews preset keys (`VIEW_KEYS`).
 *
 * Why seed data instead of a real fetch:
 *   The fiscal-gates surface is the first piece of the product to
 *   lean on the shared primitives (DataTable / SavedViews / Bulk /
 *   Undo). The backend `/api/fiscal/gates` is owned by the W2
 *   triage-inbox worker (it touches the same data shape). Seeding
 *   here lets W1 ship the UI + interactions in isolation; swapping
 *   `seedGatesForPeriod` for a `useQuery` later is a one-line
 *   change. The pure helpers in this file are reused by the route
 *   regardless of data source.
 *
 * Lingui:
 *   - The `labelKey` and `descriptionKey` are i18n message ids, not
 *     raw strings. The route's `labels.ts` maps them to `<Trans>` /
 *     `t\`\`` calls so the compiler picks them up.
 *   - User-facing copy in this file is limited to status / category
 *     names, which the route translates at the render site.
 */
import {
  type FiscalGate,
  FiscalGateSchema,
  GateAction,
  GateCategory,
  GateStatus,
} from "./schemas";

/* ────────── types for the definition registry ────────── */

export interface GateDefinition {
  /** Stable id of the *kind* of gate (not period-specific). E.g.
   *  `"vat-monthly"`. The per-period gate id is derived as
   *  `${kind}-${period}`. */
  kind: string;
  category: GateCategory;
  /** i18n message id for the human-readable label. */
  labelKey: string;
  /** i18n message id for the tooltip / detail line. */
  descriptionKey: string;
  /** Day-of-month the gate is due when no other schedule applies. */
  defaultDueDay: number;
  /** Estimated amount in AMD. `null` for non-monetary gates. */
  defaultAmount: number | null;
  /** Whether this gate is normally blocked on a third party
   *  (customer, supplier, bank) before the user can file. */
  awaitingCustomerByDefault: boolean;
}

/* ────────── the registry (10 seeded gates) ────────── */

export const GATE_DEFINITIONS: ReadonlyArray<GateDefinition> = [
  {
    kind: "vat-monthly",
    category: GateCategory.Vat,
    labelKey: "fiscal.gate.vat-monthly",
    descriptionKey: "fiscal.gate.vat-monthly.desc",
    defaultDueDay: 20,
    defaultAmount: 1_250_000,
    awaitingCustomerByDefault: false,
  },
  {
    kind: "payroll-tax-monthly",
    category: GateCategory.PayrollTax,
    labelKey: "fiscal.gate.payroll-tax-monthly",
    descriptionKey: "fiscal.gate.payroll-tax-monthly.desc",
    defaultDueDay: 15,
    defaultAmount: 480_000,
    awaitingCustomerByDefault: false,
  },
  {
    kind: "withholding-monthly",
    category: GateCategory.Withholding,
    labelKey: "fiscal.gate.withholding-monthly",
    descriptionKey: "fiscal.gate.withholding-monthly.desc",
    defaultDueDay: 15,
    defaultAmount: 95_000,
    awaitingCustomerByDefault: true,
  },
  {
    kind: "social-contribution-monthly",
    category: GateCategory.SocialContribution,
    labelKey: "fiscal.gate.social-contribution-monthly",
    descriptionKey: "fiscal.gate.social-contribution-monthly.desc",
    defaultDueDay: 15,
    defaultAmount: 365_000,
    awaitingCustomerByDefault: false,
  },
  {
    kind: "pension-quarterly",
    category: GateCategory.Pension,
    labelKey: "fiscal.gate.pension-quarterly",
    descriptionKey: "fiscal.gate.pension-quarterly.desc",
    defaultDueDay: 25,
    defaultAmount: 210_000,
    awaitingCustomerByDefault: false,
  },
  {
    kind: "statistical-monthly",
    category: GateCategory.Statistical,
    labelKey: "fiscal.gate.statistical-monthly",
    descriptionKey: "fiscal.gate.statistical-monthly.desc",
    defaultDueDay: 10,
    defaultAmount: null,
    awaitingCustomerByDefault: false,
  },
  {
    kind: "excise-quarterly",
    category: GateCategory.Excise,
    labelKey: "fiscal.gate.excise-quarterly",
    descriptionKey: "fiscal.gate.excise-quarterly.desc",
    defaultDueDay: 28,
    defaultAmount: 75_000,
    awaitingCustomerByDefault: true,
  },
  {
    kind: "environmental-annual",
    category: GateCategory.Environmental,
    labelKey: "fiscal.gate.environmental-annual",
    descriptionKey: "fiscal.gate.environmental-annual.desc",
    defaultDueDay: 1,
    defaultAmount: 55_000,
    awaitingCustomerByDefault: false,
  },
  {
    kind: "customs-monthly",
    category: GateCategory.Customs,
    labelKey: "fiscal.gate.customs-monthly",
    descriptionKey: "fiscal.gate.customs-monthly.desc",
    defaultDueDay: 25,
    defaultAmount: null,
    awaitingCustomerByDefault: true,
  },
  {
    kind: "income-tax-annual",
    category: GateCategory.Other,
    labelKey: "fiscal.gate.income-tax-annual",
    descriptionKey: "fiscal.gate.income-tax-annual.desc",
    defaultDueDay: 20,
    defaultAmount: 320_000,
    awaitingCustomerByDefault: false,
  },
];

/* ────────── SavedViews preset keys ────────── */

/** The three default saved views the fiscal-gates page exposes.
 *  Keys are stable so they can be deep-linked (`?view=current`).
 *  The route registers these names against `SavedViews` for
 *  one-click selection. */
export const VIEW_KEYS = {
  CurrentPeriod: "current",
  AllOverdue: "overdue",
  AwaitingCustomer: "awaiting_customer",
} as const;
export type ViewKey = (typeof VIEW_KEYS)[keyof typeof VIEW_KEYS];

/* ────────── helpers ────────── */

/** Stamp a definition into a per-period `FiscalGate` with a
 *  deterministic status from "now". A gate is `Overdue` if its due
 *  date is strictly before today, otherwise `Pending`. `Filed` /
 *  `Acknowledged` start as `null` in the seed; the route's reducer
 *  applies the user's mutations. */
export const seedGatesForPeriod = (
  period: string,
  now: Date = new Date(0),
): ReadonlyArray<FiscalGate> => {
  const todayUtc = now.toISOString().slice(0, 10);
  return GATE_DEFINITIONS.map<FiscalGate>((def) => {
    const dueDate = `${period}-${String(def.defaultDueDay).padStart(2, "0")}`;
    const status: GateStatus =
      dueDate < todayUtc ? GateStatus.Overdue : GateStatus.Pending;
    const gate: FiscalGate = {
      id: `${def.kind}-${period}`,
      kind: def.kind,
      category: def.category,
      period,
      dueDate,
      status,
      amount: def.defaultAmount,
      awaitingCustomer: def.awaitingCustomerByDefault,
      note: "",
    };
    return FiscalGateSchema.parse(gate);
  });
};

/** Returns the current calendar period as `YYYY-MM` in the local
 *  timezone. Pinned to the first of the month so the seed is stable
 *  inside a single test run; production callers can pass an
 *  explicit `now` if they want to test edge cases (last-day-of-
 *  month, leap year, …). */
export const currentPeriod = (now: Date = new Date(0)): string => {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};

/** Immutable update — applies a `GateAction` to a single gate and
 *  returns a new array. Used by the route's reducer for both single-
 *  row click and bulk-bar dispatches. */
export const applyGateMutation = (
  gates: ReadonlyArray<FiscalGate>,
  ids: ReadonlyArray<string>,
  action: GateAction,
): FiscalGate[] => {
  const idSet = new Set(ids);
  return gates.map<FiscalGate>((g) => {
    if (!idSet.has(g.id)) return g;
    switch (action) {
      case GateAction.Acknowledge:
        return g.status === GateStatus.Pending
          ? { ...g, status: GateStatus.Acknowledged }
          : g;
      case GateAction.MarkFiled:
        return g.status === GateStatus.Filed
          ? g
          : { ...g, status: GateStatus.Filed };
      case GateAction.Escalate:
        return g.status === GateStatus.Escalated
          ? g
          : { ...g, status: GateStatus.Escalated };
    }
  });
};

/** True when the gate is past its due date and not yet filed. */
export const isOverdue = (g: FiscalGate, now: Date = new Date(0)): boolean => {
  if (g.status === GateStatus.Filed) return false;
  return g.dueDate < now.toISOString().slice(0, 10);
};

/** True when the gate is blocked on a third party. */
export const isAwaitingCustomer = (g: FiscalGate): boolean =>
  g.awaitingCustomer && g.status !== GateStatus.Filed;

/* ────────── filter / partition helpers (used by SavedViews) ────────── */

export const filterByPeriod = (
  gates: ReadonlyArray<FiscalGate>,
  period: string,
): FiscalGate[] => gates.filter((g) => g.period === period);

export const filterOverdue = (
  gates: ReadonlyArray<FiscalGate>,
  now: Date = new Date(0),
): FiscalGate[] => gates.filter((g) => isOverdue(g, now));

export const filterAwaitingCustomer = (
  gates: ReadonlyArray<FiscalGate>,
): FiscalGate[] => gates.filter(isAwaitingCustomer);

/** Convenience: apply a `ViewKey` to a flat gate list. Returns a
 *  new array — never mutates input. */
export const applyView = (
  gates: ReadonlyArray<FiscalGate>,
  view: ViewKey,
  now: Date = new Date(0),
): FiscalGate[] => {
  switch (view) {
    case VIEW_KEYS.CurrentPeriod:
      return filterByPeriod(gates, currentPeriod(now));
    case VIEW_KEYS.AllOverdue:
      return filterOverdue(gates, now);
    case VIEW_KEYS.AwaitingCustomer:
      return filterAwaitingCustomer(gates);
  }
};

/* ────────── SavedViews preset seed ────────── */

import { saveView, loadViews, type SavedViewState } from "../components/savedViewsStore";

/** The three default triage views, in the order they should appear
 *  in the SavedViews menu. The names are stable English keys — the
 *  route translates them at the render site via `<Trans>`. */
export const DEFAULT_TRIAGE_VIEWS: ReadonlyArray<{
  key: ViewKey;
  nameKey: string;
}> = [
  { key: VIEW_KEYS.CurrentPeriod, nameKey: "fiscal.view.current" },
  { key: VIEW_KEYS.AllOverdue, nameKey: "fiscal.view.all-overdue" },
  { key: VIEW_KEYS.AwaitingCustomer, nameKey: "fiscal.view.awaiting-customer" },
];

const viewKeyToSavedState = (view: ViewKey): SavedViewState => ({
  sort: null,
  filter: view,
  page: 0,
  pageSize: 25,
  columns: [],
});

/** One-shot seed: registers the three default triage views against
 *  the fiscal-gates DataTable if the user hasn't saved anything yet
 *  (i.e. the localStorage slot is empty). Idempotent — running it
 *  twice in a row does not duplicate the rows. Returns the rows
 *  that exist after the call (useful for tests). The route calls
 *  this from a `useEffect` on mount. */
export const seedDefaultTriageViews = (tableId: string): ReadonlyArray<unknown> => {
  if (typeof window === "undefined") return loadViews(tableId);
  const existing = loadViews(tableId);
  if (existing.length > 0) return existing;
  for (const def of DEFAULT_TRIAGE_VIEWS) {
    saveView(tableId, def.nameKey, viewKeyToSavedState(def.key));
  }
  return loadViews(tableId);
};

/* ────────── formatter helpers (no Lingui — pure formatting) ────────── */

/** Format an AMD amount as `1 250 000 ֏` (space-thousands, dram
 *  suffix). Falls back to `—` for null. */
export const formatAmount = (amount: number | null): string => {
  if (amount === null) return "—";
  return `${amount.toLocaleString("ru-RU").replace(/,/g, " ")} ֏`;
};
