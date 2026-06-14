/**
 * checklist.ts — the canonical 12-15 step monthly close checklist.
 *
 * This is a *seed* — the list is intentionally a single source of
 * truth, hard-coded in the front-end, because the close wizard
 * is a deterministic workflow that the same Armenian accounting
 * practice runs every month. There's no per-tenant override, no
 * drag-to-reorder; the same 13 steps appear in the same order for
 * every period.
 *
 * The original 13 steps (per typical Armenian SMB close):
 *
 *   Reconcile (4)
 *     1. Reconcile bank accounts
 *     2. Reconcile card settlements
 *     3. Reconcile supplier statements (3 largest)
 *     4. Reconcile customer balances (3 largest)
 *
 *   Post (3)
 *     5. Post accruals (utilities, rent, subscriptions)
 *     6. Post depreciation
 *     7. Post payroll
 *
 *   Reports (3)
 *     8. Run trial balance
 *     9. Run P&L + balance sheet
 *    10. Run cash-flow statement
 *
 *   Tax (2)
 *    11. File VAT return draft
 *    12. Review income tax provision
 *
 *   Lock (1)
 *    13. Lock the period
 *
 * We choose 13 (not 12, not 15) so the categories render as
 * 4 + 3 + 3 + 2 + 1 — a nice "4-3-3-2-1" rhythm that fits on a
 * laptop screen without scrolling.
 *
 * String content is English (the source locale for Lingui). The
 * Armenian translations are auto-extracted by `lingui extract`
 * and filled in by the 10.5-translation-pass worker.
 */
import type { CloseStep, ClosePeriod } from "./schemas";

/**
 * The canonical checklist. Order is significant: `sortSteps`
 * preserves the input order, and the wizard renders in array
 * order. Insert a new step? Append it; do not re-number.
 */
export const CHECKLIST_STEPS: readonly CloseStep[] = [
  /* ──── Reconcile (1..4) ──── */
  {
    id: "reconcile-bank",
    title: "Reconcile bank accounts",
    description:
      "Match every bank statement line to a journal entry. Flag any unreconciled items for follow-up.",
    category: "Reconcile",
    order: 1,
    owner: "Accountant",
  },
  {
    id: "reconcile-cards",
    title: "Reconcile card settlements",
    description:
      "Tie card processor payouts to the day's sales. Note chargebacks and refunds that landed after period end.",
    category: "Reconcile",
    order: 2,
    owner: "Accountant",
  },
  {
    id: "reconcile-suppliers",
    title: "Reconcile supplier statements (top 3)",
    description:
      "Confirm supplier balances for the three largest vendors. Record any missing invoices as accruals.",
    category: "Reconcile",
    order: 3,
    owner: "Accountant",
  },
  {
    id: "reconcile-customers",
    title: "Reconcile customer balances (top 3)",
    description:
      "Confirm outstanding receivables for the three largest customers. Note any disputes or expected delays.",
    category: "Reconcile",
    order: 4,
    owner: "Accountant",
  },

  /* ──── Post (5..7) ──── */
  {
    id: "post-accruals",
    title: "Post accruals",
    description:
      "Accrue utilities, rent, subscriptions, and any service received but not yet invoiced.",
    category: "Post",
    order: 5,
    owner: "Accountant",
  },
  {
    id: "post-depreciation",
    title: "Post depreciation",
    description:
      "Run the depreciation schedule and post the monthly depreciation entry for all fixed assets.",
    category: "Post",
    order: 6,
    owner: "Accountant",
  },
  {
    id: "post-payroll",
    title: "Post payroll",
    description:
      "Post the final payroll for the period and any employer tax accruals.",
    category: "Post",
    order: 7,
    owner: "Owner",
  },

  /* ──── Reports (8..10) ──── */
  {
    id: "report-trial-balance",
    title: "Run trial balance",
    description:
      "Generate the trial balance and confirm total debits equal total credits.",
    category: "Reports",
    order: 8,
    owner: "Accountant",
  },
  {
    id: "report-pl-bs",
    title: "Run P&L and balance sheet",
    description:
      "Generate the income statement and balance sheet. Review the bottom line and balance-sheet sanity check (A = L + E).",
    category: "Reports",
    order: 9,
    owner: "Accountant",
  },
  {
    id: "report-cash-flow",
    title: "Run cash-flow statement",
    description:
      "Generate the cash-flow statement. Cross-check the ending cash balance against the bank reconciliation.",
    category: "Reports",
    order: 10,
    owner: "Accountant",
  },

  /* ──── Tax (11..12) ──── */
  {
    id: "tax-vat-draft",
    title: "File VAT return draft",
    description:
      "Generate the VAT return draft for the period. Review output VAT vs input VAT before submission.",
    category: "Tax",
    order: 11,
    owner: "Accountant",
  },
  {
    id: "tax-income-provision",
    title: "Review income tax provision",
    description:
      "Compute the income tax provision and confirm it matches the P&L tax line.",
    category: "Tax",
    order: 12,
    owner: "Accountant",
  },

  /* ──── Lock (13) ──── */
  {
    id: "lock-period",
    title: "Lock the period",
    description:
      "Once all steps above are done, lock the period so no further journal entries can be posted.",
    category: "Lock",
    order: 13,
    owner: "Owner",
  },
] as const;

/**
 * Total step count. Test-asserted; if you add a step, this
 * constant still returns the same value (it's computed, not
 * hard-coded) — but the type system will catch the new step.
 */
export const CHECKLIST_TOTAL_STEPS: number = CHECKLIST_STEPS.length;

/**
 * Sort a list of steps into the canonical order. `checklist.ts`
 * already returns the canonical order, but the wizard receives
 * rows from localStorage merged with the seed; the merge helper
 * in `state.ts` calls this to keep stable render order.
 */
export const sortSteps = <T extends { order: number } | { step: { order: number } }>(
  rows: readonly T[],
): T[] => {
  const getOrder = (r: T): number =>
    "order" in r ? r.order : r.step.order;
  return [...rows].sort((a, b) => getOrder(a) - getOrder(b));
};

/**
 * Group a list of steps by category. Returns the categories in
 * the order of their first appearance (Reconcile → Post →
 * Reports → Tax → Lock).
 *
 * The category labels are *not* translated here — the UI
 * receives a `Record<string, CloseStep[]>` and renders each key
 * via Lingui. The seed values are stable English identifiers
 * ("Reconcile", "Post", …) so the i18n catalog has fixed msgids.
 */
export const groupByCategory = (
  steps: readonly CloseStep[],
): Record<string, CloseStep[]> => {
  const out: Record<string, CloseStep[]> = {};
  for (const s of steps) {
    if (!out[s.category]) out[s.category] = [];
    out[s.category]!.push(s);
  }
  return out;
};

/**
 * Compute a period id from a Date. Returns YYYY-MM in UTC.
 * Mirrors `cfo/reports.ts#currentPeriodKey` so the close wizard
 * and the CFO reports surface agree on what "this month" means.
 */
export const periodIdFromDate = (d: Date = new Date()): string => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};

/**
 * Build a ClosePeriod from a YYYY-MM id. The label is a stable
 * English label so the persisted form doesn't depend on the
 * active locale (a user who switches locale mid-close should
 * see the same period name).
 */
export const periodFromId = (id: string): ClosePeriod => {
  const m = /^(\d{4})-(\d{2})$/.exec(id);
  if (!m) {
    throw new Error(`Invalid period id: ${id}`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const startsAt = new Date(Date.UTC(year, month - 1, 1));
  // Day 0 of next month = last day of this month.
  const endsAt = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return {
    id,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  };
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
