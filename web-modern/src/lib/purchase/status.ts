/**
 * Pure helpers for the Purchase workspace.
 *
 * Source of truth for shapes: server/app.js (formatPurchaseVendor /
 * formatPurchaseOrder / formatPurchaseOrderLine). These helpers are
 * UI-pure: no React, no I/O, no i18n. They are unit-tested in
 * __tests__/status.test.ts.
 *
 * Public surface:
 *  - classifyVendorStatus  → "active" | "inactive" | "blocked" | "unknown"
 *  - classifyOrderStatus   → "draft" | "confirmed" | "partial" | "received" | "billed" | "cancelled" | "unknown"
 *  - compareOrdersByStatusThenDate
 *  - compareVendorsByName
 *  - orderTotal            → safe subtotal/vat/total
 *  - orderProgress         → 0..1 received/ordered (null when ordered == 0)
 *  - sumOpenValue / sumBilledValue / sumAllValue
 *  - vendorPerformanceScore → aggregated 0..1 score
 *  - priceCoverage         → priced lines / total lines
 *  - formatCurrency         → "1 250 000 ֏" via Intl
 *  - AM_SHORT_MONTHS
 */
import type {
  PurchaseVendor,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
} from "../api/schemas";

/* ────────── types ────────── */

export type VendorTone = "active" | "inactive" | "blocked" | "unknown";
export type OrderTone =
  | "draft"
  | "confirmed"
  | "partial"
  | "received"
  | "billed"
  | "cancelled"
  | "unknown";

/** First-class subset of purchase orders used for vendor score calc. */
export interface VendorScoreInput {
  orderCount: number;
  totalValue: number;
  onTimeReceiptPercent: number | null;
}

export const AM_SHORT_MONTHS = [
  "Հնվ", "Փտվ", "Մար", "Ապր", "Մյս", "Հնս",
  "Հլս", "Օգս", "Սպտ", "Հոկ", "Նոյ", "Դեկ",
] as const;

/* ────────── vendor classification ────────── */

export function classifyVendor(vendor: Pick<PurchaseVendor, "status">): VendorTone {
  const s = (vendor.status ?? "").toString().toLowerCase();
  if (s === "active") return "active";
  if (s === "inactive") return "inactive";
  if (s === "blocked") return "blocked";
  return "unknown";
}

export function compareVendorsByName(
  a: Pick<PurchaseVendor, "name">,
  b: Pick<PurchaseVendor, "name">,
): number {
  return (a.name ?? "").localeCompare(b.name ?? "", "en", { sensitivity: "base" });
}

/* ────────── order classification ────────── */

const ORDER_STATUSES: ReadonlySet<PurchaseOrderStatus> = new Set([
  "draft",
  "confirmed",
  "partial",
  "received",
  "billed",
  "cancelled",
]);

export function classifyOrderStatus(order: Pick<PurchaseOrder, "status">): OrderTone {
  const s = (order.status ?? "").toString().toLowerCase();
  if (ORDER_STATUSES.has(s as PurchaseOrderStatus)) return s as OrderTone;
  return "unknown";
}

/** Sort: actionable first (draft/confirmed/partial), then by date desc. */
export function compareOrdersByStatusThenDate(
  a: Pick<PurchaseOrder, "status" | "orderDate">,
  b: Pick<PurchaseOrder, "status" | "orderDate">,
): number {
  const ta = orderToneRank(classifyOrderStatus(a));
  const tb = orderToneRank(classifyOrderStatus(b));
  if (ta !== tb) return ta - tb;
  return (b.orderDate ?? "").localeCompare(a.orderDate ?? "");
}

function orderToneRank(tone: OrderTone): number {
  switch (tone) {
    case "draft":
      return 0;
    case "confirmed":
      return 1;
    case "partial":
      return 2;
    case "received":
      return 3;
    case "billed":
      return 4;
    case "cancelled":
      return 5;
    default:
      return 6;
  }
}

/* ────────── order math ────────── */

export interface OrderTotals {
  subtotal: number;
  vat: number;
  total: number;
}

export function orderTotals(order: Pick<PurchaseOrder, "subtotal" | "vat" | "total">): OrderTotals {
  return {
    subtotal: order.subtotal ?? 0,
    vat: order.vat ?? 0,
    total: order.total ?? 0,
  };
}

/** 0..1 progress. Returns null if there is nothing ordered. */
export function orderProgress(order: Pick<PurchaseOrder, "orderedQuantity" | "receivedQuantity">): number | null {
  const o = order.orderedQuantity ?? 0;
  const r = order.receivedQuantity ?? 0;
  if (o <= 0) return null;
  if (r <= 0) return 0;
  if (r >= o) return 1;
  return r / o;
}

/** Sum of line remaining quantity — useful for backlog cards. */
export function lineRemainingQuantity(
  line: Pick<PurchaseOrderLine, "remainingQuantity" | "quantity" | "receivedQuantity">,
): number {
  if (line.remainingQuantity != null) return line.remainingQuantity;
  const o = line.quantity ?? 0;
  const r = line.receivedQuantity ?? 0;
  return Math.max(0, o - r);
}

/* ────────── aggregate math ────────── */

export function sumAllValue(orders: ReadonlyArray<Pick<PurchaseOrder, "total">>): number {
  return orders.reduce((acc, o) => acc + (o.total ?? 0), 0);
}

export function sumOpenValue(orders: ReadonlyArray<PurchaseOrder>): number {
  return orders
    .filter((o) => {
      const t = classifyOrderStatus(o);
      return t === "draft" || t === "confirmed" || t === "partial";
    })
    .reduce((acc, o) => acc + (o.total ?? 0), 0);
}

export function sumBilledValue(orders: ReadonlyArray<PurchaseOrder>): number {
  return orders
    .filter((o) => classifyOrderStatus(o) === "billed")
    .reduce((acc, o) => acc + (o.total ?? 0), 0);
}

/** 0..1 — combined reliability score for a vendor from analytics. */
export function vendorPerformanceScore(input: VendorScoreInput): number {
  const { orderCount, totalValue, onTimeReceiptPercent } = input;
  if (orderCount <= 0 && totalValue <= 0) return 0;
  const receipt = onTimeReceiptPercent == null ? 0.5 : Math.max(0, Math.min(1, onTimeReceiptPercent / 100));
  const volume = Math.max(0, Math.min(1, Math.log10(Math.max(1, totalValue)) / 6));
  return Number((receipt * 0.7 + volume * 0.3).toFixed(3));
}

/** 0..1 — price coverage = priced lines / total lines. Null if no lines. */
export function priceCoverage(
  lineCount: number,
  pricedLineCount: number,
): number | null {
  if (lineCount <= 0) return null;
  return Math.max(0, Math.min(1, pricedLineCount / lineCount));
}

/* ────────── formatting ────────── */

export function formatCurrency(value: number | null | undefined, currency = "AMD"): string {
  if (value == null || Number.isNaN(value)) return "—";
  try {
    return new Intl.NumberFormat("hy-AM", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value} ֏`;
  }
}

export function formatPercent(value: number | null | undefined, fractionDigits = 0): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(fractionDigits)}%`;
}
