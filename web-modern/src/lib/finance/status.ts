/**
 * Pure helpers for the Finance workspace.
 *
 * Mirrors the lib/inventory/status.ts pattern: no React, no router,
 * no fetch. Just data-in, data-out, designed for unit tests and for
 * reuse by the Mission Control widgets (Phase 2.6+).
 *
 * The Finance module wraps accounting primitives. The Phase 1
 * surfaces (invoices, periods, payments) are derived in
 * #formatFinanceDraftInvoice / #formatFinancePeriod / #formatFinancePayment
 * on the server — these helpers add the *display-layer* logic
 * (status tones, aging buckets, period naming) that the route file
 * and the right-rail AI Action Panel both consume.
 */

import type {
  FinanceDraftInvoice,
  FinancePeriod,
  FinancePayment,
} from "../api/schemas";

/* ────────── period helpers ────────── */

export type PeriodTone = "open" | "current" | "closed" | "future";

/** Classify a period row for the ViewSwitcher / period table.
 *  - "current" = today's date is inside [startsOn, endsOn]
 *  - "open"    = status === 'open' but not the current period
 *  - "closed"  = status === 'closed'
 *  - "future"  = period hasn't started yet
 *
 *  The function tolerates missing startsOn/endsOn (legacy seeds and
 *  manually-inserted periods may lack them). */
export function classifyPeriod(
  p: Pick<FinancePeriod, "periodKey" | "status" | "startsOn" | "endsOn">,
  today: Date = new Date(),
): PeriodTone {
  if (p.status === "closed") return "closed";
  const start = p.startsOn ? new Date(p.startsOn) : null;
  const end = p.endsOn ? new Date(p.endsOn) : null;
  if (start && !Number.isNaN(start.valueOf()) && start > today) return "future";
  if (start && end && !Number.isNaN(start.valueOf()) && !Number.isNaN(end.valueOf())) {
    if (today >= start && today <= end) return "current";
  }
  return "open";
}

/** Convert YYYY-MM period key to a human-readable Armenian label.
 *  e.g. "2026-06" → "Հունիս 2026".
 *
 *  Mirrors the legacy web/src/finance.jsx period-label rendering. */
const AM_MONTHS = [
  "Հունվար", "Փետրվար", "Մարտ", "Ապրիլ", "Մայիս", "Հունիս",
  "Հուլիս", "Օգոստոս", "Սեպտեմբեր", "Հոկտեմբեր", "Նոյեմբեր", "Դեկտեմբեր",
] as const;

export function periodLabel(periodKey: string | null | undefined): string {
  if (!periodKey) return "—";
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) return periodKey;
  const year = m[1];
  const monthIdx = Number(m[2]) - 1;
  if (monthIdx < 0 || monthIdx >= 12) return periodKey;
  return `${AM_MONTHS[monthIdx]} ${year}`;
}

/** Stable sort comparator: newest period first. */
export function comparePeriodKeysDesc(a: string, b: string): number {
  return b.localeCompare(a);
}

/* ────────── invoice helpers ────────── */

export type InvoiceStatusTone =
  | "draft"
  | "posted"
  | "cancelled"
  | "paid"
  | "overdue"
  | "unknown";

/** Days between today and the due date. Negative = overdue.
 *  Returns null when the invoice is missing a due date. */
export function daysUntilDue(
  invoice: Pick<FinanceDraftInvoice, "dueDate">,
  today: Date = new Date(),
): number | null {
  if (!invoice.dueDate) return null;
  const due = new Date(invoice.dueDate);
  if (Number.isNaN(due.valueOf())) return null;
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((due.valueOf() - today.valueOf()) / msPerDay);
}

/** Classify a draft invoice for the status pill + filter tabs.
 *  "paid" is detected when the route's caller (the parent) passes a
 *  `paidAmount` total that meets/exceeds `total`. Without that hint
 *  the function falls back to the raw status field. */
export function classifyInvoice(
  invoice: Pick<FinanceDraftInvoice, "status" | "dueDate"> & {
    paidAmount?: number | null;
  },
  today: Date = new Date(),
): InvoiceStatusTone {
  const status = (invoice.status ?? "").toLowerCase();
  if (status === "cancelled") return "cancelled";
  if (typeof invoice.paidAmount === "number" && invoice.paidAmount > 0) {
    return "paid";
  }
  if (status === "draft") return "draft";
  if (status === "posted") {
    const days = daysUntilDue(invoice, today);
    if (days != null && days < 0) return "overdue";
    return "posted";
  }
  return "unknown";
}

/** Sum the totals of a list of invoices. Skips nulls. */
export function sumInvoiceTotals(
  invoices: ReadonlyArray<Pick<FinanceDraftInvoice, "total">>,
): number {
  let total = 0;
  for (const i of invoices) {
    if (typeof i.total === "number" && Number.isFinite(i.total)) total += i.total;
  }
  return total;
}

/** Sum the VAT across a list of invoices. */
export function sumInvoiceVat(
  invoices: ReadonlyArray<Pick<FinanceDraftInvoice, "vat">>,
): number {
  let total = 0;
  for (const i of invoices) {
    if (typeof i.vat === "number" && Number.isFinite(i.vat)) total += i.vat;
  }
  return total;
}

/* ────────── aging buckets ────────── */

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

/** Bucket an invoice into an AR aging band. Uses absolute-value days
 *  (negative days = overdue). */
export function agingBucket(
  invoice: Pick<FinanceDraftInvoice, "dueDate">,
  today: Date = new Date(),
): AgingBucket {
  const days = daysUntilDue(invoice, today);
  if (days == null) return "current";
  const overdue = Math.max(0, -days);
  if (overdue <= 0) return "current";
  if (overdue <= 30) return "1-30";
  if (overdue <= 60) return "31-60";
  if (overdue <= 90) return "61-90";
  return "90+";
}

/** Group invoices by aging bucket. Returns totals + counts. */
export function summarizeAging(
  invoices: ReadonlyArray<Pick<FinanceDraftInvoice, "total" | "dueDate">>,
  today: Date = new Date(),
): Record<AgingBucket, { count: number; total: number }> {
  const out: Record<AgingBucket, { count: number; total: number }> = {
    current: { count: 0, total: 0 },
    "1-30": { count: 0, total: 0 },
    "31-60": { count: 0, total: 0 },
    "61-90": { count: 0, total: 0 },
    "90+": { count: 0, total: 0 },
  };
  for (const inv of invoices) {
    const bucket = agingBucket(inv, today);
    out[bucket].count += 1;
    if (typeof inv.total === "number" && Number.isFinite(inv.total)) {
      out[bucket].total += inv.total;
    }
  }
  return out;
}

/* ────────── payment helpers ────────── */

/** Group payments by currency so the totals card can show one line per
 *  currency. The legacy finance UI does this inline. */
export function groupPaymentsByCurrency(
  payments: ReadonlyArray<Pick<FinancePayment, "amount" | "currency">>,
): Record<string, { count: number; total: number }> {
  const out: Record<string, { count: number; total: number }> = {};
  for (const p of payments) {
    const cur = p.currency ?? "AMD";
    if (!out[cur]) out[cur] = { count: 0, total: 0 };
    out[cur].count += 1;
    if (typeof p.amount === "number" && Number.isFinite(p.amount)) {
      out[cur].total += p.amount;
    }
  }
  return out;
}
