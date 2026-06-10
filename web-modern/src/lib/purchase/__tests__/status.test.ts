/**
 * status.test.ts — unit tests for the Purchase pure helpers.
 *
 * Pattern mirrors web-modern/src/lib/people/__tests__/status.test.ts.
 * All numbers use the same AMD currency, all dates are YYYY-MM-DD.
 */
import { describe, it, expect } from "vitest";
import {
  classifyVendor,
  classifyOrderStatus,
  compareOrdersByStatusThenDate,
  compareVendorsByName,
  orderTotals,
  orderProgress,
  lineRemainingQuantity,
  sumAllValue,
  sumOpenValue,
  sumBilledValue,
  vendorPerformanceScore,
  priceCoverage,
  formatCurrency,
  formatPercent,
  AM_SHORT_MONTHS,
  type VendorTone,
  type OrderTone,
} from "../status";

/* ────────── fixtures ────────── */

const VENDORS = {
  active: { status: "active" },
  inactive: { status: "inactive" },
  blocked: { status: "blocked" },
  unknown: { status: "garbage" },
  missing: { status: undefined as unknown as string },
};

const ORDERS = {
  draft: { id: "o-1", status: "draft", orderDate: "2026-06-01", total: 1000 },
  confirmed: { id: "o-2", status: "confirmed", orderDate: "2026-06-02", total: 2000 },
  partial: { id: "o-3", status: "partial", orderDate: "2026-06-03", total: 1500 },
  received: { id: "o-4", status: "received", orderDate: "2026-06-04", total: 500 },
  billed: { id: "o-5", status: "billed", orderDate: "2026-06-05", total: 800 },
  cancelled: { id: "o-6", status: "cancelled", orderDate: "2026-06-06", total: 700 },
  garbage: { id: "o-7", status: "garbage", orderDate: "2026-06-07", total: 50 },
};

/* ────────── classifyVendor ────────── */

describe("classifyVendor", () => {
  it("maps known statuses", () => {
    expect(classifyVendor(VENDORS.active)).toBe<VendorTone>("active");
    expect(classifyVendor(VENDORS.inactive)).toBe<VendorTone>("inactive");
    expect(classifyVendor(VENDORS.blocked)).toBe<VendorTone>("blocked");
  });
  it("falls back to unknown for unrecognized values", () => {
    expect(classifyVendor(VENDORS.unknown)).toBe<VendorTone>("unknown");
    expect(classifyVendor(VENDORS.missing)).toBe<VendorTone>("unknown");
  });
});

/* ────────── classifyOrderStatus ────────── */

describe("classifyOrderStatus", () => {
  it("maps known statuses", () => {
    expect(classifyOrderStatus(ORDERS.draft)).toBe<OrderTone>("draft");
    expect(classifyOrderStatus(ORDERS.confirmed)).toBe<OrderTone>("confirmed");
    expect(classifyOrderStatus(ORDERS.partial)).toBe<OrderTone>("partial");
    expect(classifyOrderStatus(ORDERS.received)).toBe<OrderTone>("received");
    expect(classifyOrderStatus(ORDERS.billed)).toBe<OrderTone>("billed");
    expect(classifyOrderStatus(ORDERS.cancelled)).toBe<OrderTone>("cancelled");
  });
  it("falls back to unknown for unrecognized values", () => {
    expect(classifyOrderStatus(ORDERS.garbage)).toBe<OrderTone>("unknown");
  });
});

/* ────────── compareOrdersByStatusThenDate ────────── */

describe("compareOrdersByStatusThenDate", () => {
  it("sorts draft/confirmed/partial before received/billed/cancelled", () => {
    const out = [
      ORDERS.billed,
      ORDERS.draft,
      ORDERS.partial,
      ORDERS.received,
      ORDERS.confirmed,
    ]
      .slice()
      .sort(compareOrdersByStatusThenDate)
      .map((o) => o.status);
    expect(out).toEqual(["draft", "confirmed", "partial", "received", "billed"]);
  });

  it("within a status, sorts by date desc", () => {
    const a = { status: "draft", orderDate: "2026-01-01" };
    const b = { status: "draft", orderDate: "2026-06-01" };
    const c = { status: "draft", orderDate: "2026-03-01" };
    const out = [a, b, c].sort(compareOrdersByStatusThenDate);
    expect(out.map((o) => o.orderDate)).toEqual(["2026-06-01", "2026-03-01", "2026-01-01"]);
  });

  it("unknown sorts last", () => {
    const out = [ORDERS.garbage, ORDERS.draft].sort(compareOrdersByStatusThenDate);
    expect(out[0].status).toBe("draft");
  });

  it("is stable for equal status + date", () => {
    const a = { status: "draft", orderDate: "2026-06-01" };
    const b = { status: "draft", orderDate: "2026-06-01" };
    expect(compareOrdersByStatusThenDate(a, b)).toBe(0);
  });
});

/* ────────── compareVendorsByName ────────── */

describe("compareVendorsByName", () => {
  it("sorts by name case-insensitively", () => {
    const out = [{ name: "Beta" }, { name: "alpha" }, { name: "Gamma" }]
      .slice()
      .sort(compareVendorsByName)
      .map((v) => v.name);
    expect(out).toEqual(["alpha", "Beta", "Gamma"]);
  });
});

/* ────────── orderTotals ────────── */

describe("orderTotals", () => {
  it("returns all three values", () => {
    expect(orderTotals({ subtotal: 100, vat: 20, total: 120 })).toEqual({
      subtotal: 100,
      vat: 20,
      total: 120,
    });
  });
  it("zero-fills missing values", () => {
    expect(
      orderTotals(
        { subtotal: null, vat: null, total: null } as unknown as Parameters<typeof orderTotals>[0],
      ),
    ).toEqual({
      subtotal: 0,
      vat: 0,
      total: 0,
    });
  });
});

/* ────────── orderProgress ────────── */

describe("orderProgress", () => {
  it("returns null when nothing ordered", () => {
    expect(orderProgress({ orderedQuantity: 0, receivedQuantity: 0 })).toBeNull();
  });
  it("returns 0 when nothing received", () => {
    expect(orderProgress({ orderedQuantity: 100, receivedQuantity: 0 })).toBe(0);
  });
  it("returns 1 when fully received", () => {
    expect(orderProgress({ orderedQuantity: 100, receivedQuantity: 100 })).toBe(1);
  });
  it("clamps over-receipt at 1", () => {
    expect(orderProgress({ orderedQuantity: 100, receivedQuantity: 150 })).toBe(1);
  });
  it("returns the ratio in between", () => {
    expect(orderProgress({ orderedQuantity: 100, receivedQuantity: 25 })).toBe(0.25);
  });
  it("null safe", () => {
    expect(orderProgress({ orderedQuantity: null, receivedQuantity: null })).toBeNull();
  });
});

/* ────────── lineRemainingQuantity ────────── */

describe("lineRemainingQuantity", () => {
  it("prefers server-computed remainingQuantity", () => {
    expect(
      lineRemainingQuantity({
        remainingQuantity: 5,
        quantity: 100,
        receivedQuantity: 95,
      }),
    ).toBe(5);
  });
  it("derives from quantity-received when not provided", () => {
    expect(
      lineRemainingQuantity({
        remainingQuantity: undefined,
        quantity: 100,
        receivedQuantity: 60,
      }),
    ).toBe(40);
  });
  it("clamps to >= 0", () => {
    expect(
      lineRemainingQuantity({
        remainingQuantity: undefined,
        quantity: 10,
        receivedQuantity: 15,
      }),
    ).toBe(0);
  });
});

/* ────────── aggregates ────────── */

describe("aggregate value helpers", () => {
  it("sumAllValue sums all orders regardless of status", () => {
    expect(sumAllValue([ORDERS.draft, ORDERS.billed])).toBe(1800);
  });
  it("sumOpenValue counts only draft/confirmed/partial", () => {
    const orders = [ORDERS.draft, ORDERS.confirmed, ORDERS.partial, ORDERS.received, ORDERS.billed, ORDERS.cancelled];
    expect(sumOpenValue(orders)).toBe(1000 + 2000 + 1500);
  });
  it("sumBilledValue counts only billed", () => {
    expect(sumBilledValue([ORDERS.draft, ORDERS.billed])).toBe(800);
  });
  it("empty arrays → 0", () => {
    expect(sumAllValue([])).toBe(0);
    expect(sumOpenValue([])).toBe(0);
    expect(sumBilledValue([])).toBe(0);
  });
});

/* ────────── vendorPerformanceScore ────────── */

describe("vendorPerformanceScore", () => {
  it("returns 0 when there are no orders and no value", () => {
    expect(vendorPerformanceScore({ orderCount: 0, totalValue: 0, onTimeReceiptPercent: null })).toBe(0);
  });
  it("uses on-time receipt (70%) + volume (30%)", () => {
    const score = vendorPerformanceScore({
      orderCount: 10,
      totalValue: 1_000_000,
      onTimeReceiptPercent: 100,
    });
    // 1.0 * 0.7 + volume * 0.3; log10(1_000_000) / 6 = 6 / 6 = 1.0
    expect(score).toBeCloseTo(1.0, 3);
  });
  it("uses neutral 0.5 receipt when null is passed", () => {
    const score = vendorPerformanceScore({
      orderCount: 5,
      totalValue: 100_000,
      onTimeReceiptPercent: null,
    });
    // 0.5 * 0.7 + volume * 0.3; log10(100_000)/6 ≈ 0.833
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(0.7);
  });
  it("clamps receipt percent at 0..100", () => {
    const score = vendorPerformanceScore({
      orderCount: 1,
      totalValue: 10,
      onTimeReceiptPercent: 200,
    });
    expect(score).toBeLessThanOrEqual(1);
  });
});

/* ────────── priceCoverage ────────── */

describe("priceCoverage", () => {
  it("returns null when no lines", () => {
    expect(priceCoverage(0, 0)).toBeNull();
  });
  it("returns 1 when all lines are priced", () => {
    expect(priceCoverage(10, 10)).toBe(1);
  });
  it("returns the ratio in between", () => {
    expect(priceCoverage(10, 5)).toBe(0.5);
  });
  it("clamps at 0..1", () => {
    expect(priceCoverage(5, 10)).toBe(1);
  });
});

/* ────────── formatting ────────── */

describe("formatCurrency", () => {
  it("formats with Armenian digit grouping", () => {
    // 1 250 000 ֏ — thin spaces, ֏ glyph
    const out = formatCurrency(1_250_000);
    expect(out).toMatch(/1\s*250\s*000/);
  });
  it("returns — for null/NaN", () => {
    expect(formatCurrency(null)).toBe("—");
    expect(formatCurrency(NaN)).toBe("—");
  });
  it("accepts a currency override", () => {
    const out = formatCurrency(100, "USD");
    expect(out).toMatch(/100/);
  });
});

describe("formatPercent", () => {
  it("multiplies by 100 and appends %", () => {
    expect(formatPercent(0.5)).toBe("50%");
    expect(formatPercent(0.1234, 2)).toBe("12.34%");
  });
  it("returns — for null/NaN", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(NaN)).toBe("—");
  });
});

/* ────────── AM_SHORT_MONTHS ────────── */

describe("AM_SHORT_MONTHS", () => {
  it("has 12 entries", () => {
    expect(AM_SHORT_MONTHS).toHaveLength(12);
  });
  it("starts with Հունվարի abbreviation Հնվ", () => {
    expect(AM_SHORT_MONTHS[0]).toBe("Հնվ");
  });
  it("ends with Դեկտեմբերի abbreviation Դեկ", () => {
    expect(AM_SHORT_MONTHS[11]).toBe("Դեկ");
  });
});
