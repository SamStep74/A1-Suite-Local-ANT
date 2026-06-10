/**
 * status.test.ts — pure-helper coverage for the Finance workspace.
 *
 * Mirrors the inventory/status.test.ts pattern: write tests first,
 * then derive every branch deterministically. No React, no fetch,
 * no mocks — the helpers are pure data-in/data-out.
 *
 * Coverage targets:
 *  - classifyPeriod  (current / open / closed / future)
 *  - periodLabel     (Armenian month rendering, malformed input)
 *  - comparePeriodKeysDesc (sort)
 *  - daysUntilDue    (today / future / past / missing)
 *  - classifyInvoice (draft / posted / overdue / paid / cancelled)
 *  - sumInvoiceTotals / sumInvoiceVat (sums, skips nulls)
 *  - agingBucket / summarizeAging (banding math)
 *  - groupPaymentsByCurrency
 */
import { describe, it, expect } from "vitest";
import {
  agingBucket,
  classifyInvoice,
  classifyPeriod,
  comparePeriodKeysDesc,
  daysUntilDue,
  groupPaymentsByCurrency,
  periodLabel,
  sumInvoiceTotals,
  sumInvoiceVat,
  summarizeAging,
} from "../status";

const TODAY = new Date("2026-06-10T12:00:00.000Z");

/* ────────── classifyPeriod ────────── */

describe("classifyPeriod", () => {
  it("classifies status='closed' as 'closed' regardless of dates", () => {
    expect(
      classifyPeriod(
        { periodKey: "2026-01", status: "closed", startsOn: "2026-01-01", endsOn: "2026-01-31" },
        TODAY,
      ),
    ).toBe("closed");
  });

  it("classifies the current month as 'current' when today is inside the range", () => {
    expect(
      classifyPeriod(
        { periodKey: "2026-06", status: "open", startsOn: "2026-06-01", endsOn: "2026-06-30" },
        TODAY,
      ),
    ).toBe("current");
  });

  it("classifies past months as 'open' (they were active, status is 'open')", () => {
    expect(
      classifyPeriod(
        { periodKey: "2026-01", status: "open", startsOn: "2026-01-01", endsOn: "2026-01-31" },
        TODAY,
      ),
    ).toBe("open");
  });

  it("classifies future months as 'future' before the period starts", () => {
    expect(
      classifyPeriod(
        { periodKey: "2026-12", status: "open", startsOn: "2026-12-01", endsOn: "2026-12-31" },
        TODAY,
      ),
    ).toBe("future");
  });

  it("falls back to 'open' when startsOn / endsOn are missing", () => {
    expect(
      classifyPeriod({ periodKey: "2026-06", status: "open" }, TODAY),
    ).toBe("open");
  });

  it("falls back to 'open' when startsOn is malformed", () => {
    expect(
      classifyPeriod(
        { periodKey: "2026-06", status: "open", startsOn: "garbage", endsOn: "garbage" },
        TODAY,
      ),
    ).toBe("open");
  });
});

/* ────────── periodLabel ────────── */

describe("periodLabel", () => {
  it("renders YYYY-MM as Armenian month + year", () => {
    expect(periodLabel("2026-06")).toBe("Հունիս 2026");
    expect(periodLabel("2026-01")).toBe("Հունվար 2026");
    expect(periodLabel("2026-12")).toBe("Դեկտեմբեր 2026");
  });

  it("returns '—' for null / undefined", () => {
    expect(periodLabel(null)).toBe("—");
    expect(periodLabel(undefined)).toBe("—");
    expect(periodLabel("")).toBe("—");
  });

  it("returns the input verbatim when the format is unknown", () => {
    expect(periodLabel("Q2-2026")).toBe("Q2-2026");
  });

  it("returns the input verbatim when the month component is out of range", () => {
    expect(periodLabel("2026-13")).toBe("2026-13");
  });
});

/* ────────── comparePeriodKeysDesc ────────── */

describe("comparePeriodKeysDesc", () => {
  it("sorts YYYY-MM keys newest first", () => {
    const keys = ["2026-01", "2025-12", "2026-06", "2025-08"];
    expect([...keys].sort(comparePeriodKeysDesc)).toEqual([
      "2026-06",
      "2026-01",
      "2025-12",
      "2025-08",
    ]);
  });

  it("is stable for equal keys (returns 0)", () => {
    expect(comparePeriodKeysDesc("2026-06", "2026-06")).toBe(0);
  });
});

/* ────────── daysUntilDue ────────── */

describe("daysUntilDue", () => {
  it("returns positive days for a future due date", () => {
    expect(daysUntilDue({ dueDate: "2026-06-20" }, TODAY)).toBe(10);
  });

  it("returns negative days for a past due date", () => {
    expect(daysUntilDue({ dueDate: "2026-06-05" }, TODAY)).toBe(-5);
  });

  it("returns null for missing dueDate", () => {
    expect(daysUntilDue({ dueDate: null }, TODAY)).toBeNull();
  });

  it("returns null for malformed dueDate", () => {
    expect(daysUntilDue({ dueDate: "garbage" }, TODAY)).toBeNull();
  });
});

/* ────────── classifyInvoice ────────── */

describe("classifyInvoice", () => {
  it("classifies status='draft' as 'draft'", () => {
    expect(classifyInvoice({ status: "draft", dueDate: "2026-06-20" }, TODAY)).toBe("draft");
  });

  it("classifies status='posted' with future dueDate as 'posted'", () => {
    expect(classifyInvoice({ status: "posted", dueDate: "2026-06-20" }, TODAY)).toBe("posted");
  });

  it("classifies status='posted' with past dueDate as 'overdue'", () => {
    expect(classifyInvoice({ status: "posted", dueDate: "2026-06-05" }, TODAY)).toBe("overdue");
  });

  it("classifies status='cancelled' as 'cancelled' even with a dueDate", () => {
    expect(classifyInvoice({ status: "cancelled", dueDate: "2026-06-05" }, TODAY)).toBe("cancelled");
  });

  it("promotes a posted invoice with paidAmount>0 to 'paid'", () => {
    expect(
      classifyInvoice(
        { status: "posted", dueDate: "2026-06-20", paidAmount: 100000 },
        TODAY,
      ),
    ).toBe("paid");
  });

  it("returns 'unknown' for a blank status", () => {
    expect(classifyInvoice({ status: "", dueDate: null }, TODAY)).toBe("unknown");
  });
});

/* ────────── sumInvoiceTotals / sumInvoiceVat ────────── */

describe("sumInvoiceTotals", () => {
  it("sums finite totals and skips nulls", () => {
    expect(
      sumInvoiceTotals([
        { total: 100 },
        { total: 50 },
        { total: null },
        { total: 25 },
      ] as any),
    ).toBe(175);
  });

  it("returns 0 for an empty list", () => {
    expect(sumInvoiceTotals([])).toBe(0);
  });
});

describe("sumInvoiceVat", () => {
  it("sums finite vats and skips nulls", () => {
    expect(
      sumInvoiceVat([
        { vat: 20 },
        { vat: 10 },
        { vat: null },
      ] as any),
    ).toBe(30);
  });
});

/* ────────── agingBucket / summarizeAging ────────── */

describe("agingBucket", () => {
  it("classifies an invoice due today as 'current'", () => {
    expect(agingBucket({ dueDate: "2026-06-10" }, TODAY)).toBe("current");
  });

  it("classifies a 5-day overdue invoice as '1-30'", () => {
    expect(agingBucket({ dueDate: "2026-06-05" }, TODAY)).toBe("1-30");
  });

  it("classifies a 45-day overdue invoice as '31-60'", () => {
    expect(agingBucket({ dueDate: "2026-04-26" }, TODAY)).toBe("31-60");
  });

  it("classifies a 75-day overdue invoice as '61-90'", () => {
    expect(agingBucket({ dueDate: "2026-03-27" }, TODAY)).toBe("61-90");
  });

  it("classifies a 120-day overdue invoice as '90+'", () => {
    expect(agingBucket({ dueDate: "2026-02-10" }, TODAY)).toBe("90+");
  });

  it("returns 'current' when dueDate is missing", () => {
    expect(agingBucket({ dueDate: null }, TODAY)).toBe("current");
  });
});

describe("summarizeAging", () => {
  it("groups invoices by bucket and sums totals", () => {
    const summary = summarizeAging(
      [
        { total: 100, dueDate: "2026-06-15" }, // current
        { total: 200, dueDate: "2026-06-05" }, // 1-30
        { total: 300, dueDate: "2026-04-26" }, // 31-60
        { total: 400, dueDate: "2026-03-27" }, // 61-90
        { total: 500, dueDate: "2026-02-10" }, // 90+
        { total: null, dueDate: null }, // current (missing date)
      ] as any,
      TODAY,
    );

    expect(summary.current).toEqual({ count: 2, total: 100 });
    expect(summary["1-30"]).toEqual({ count: 1, total: 200 });
    expect(summary["31-60"]).toEqual({ count: 1, total: 300 });
    expect(summary["61-90"]).toEqual({ count: 1, total: 400 });
    expect(summary["90+"]).toEqual({ count: 1, total: 500 });
  });

  it("returns zeroed buckets for an empty list", () => {
    expect(summarizeAging([], TODAY)).toEqual({
      current: { count: 0, total: 0 },
      "1-30": { count: 0, total: 0 },
      "31-60": { count: 0, total: 0 },
      "61-90": { count: 0, total: 0 },
      "90+": { count: 0, total: 0 },
    });
  });
});

/* ────────── groupPaymentsByCurrency ────────── */

describe("groupPaymentsByCurrency", () => {
  it("groups payments by currency and sums amounts", () => {
    const out = groupPaymentsByCurrency([
      { amount: 100, currency: "AMD" },
      { amount: 50, currency: "AMD" },
      { amount: 10, currency: "USD" },
    ]);
    expect(out.AMD).toEqual({ count: 2, total: 150 });
    expect(out.USD).toEqual({ count: 1, total: 10 });
  });

  it("defaults missing currency to 'AMD'", () => {
    const out = groupPaymentsByCurrency([
      { amount: 100, currency: null },
      { amount: 50 },
    ] as any);
    expect(out.AMD).toEqual({ count: 2, total: 150 });
  });

  it("returns an empty object for an empty list", () => {
    expect(groupPaymentsByCurrency([])).toEqual({});
  });
});
