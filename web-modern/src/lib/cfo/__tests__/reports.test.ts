/**
 * reports.test.ts — unit tests for the CFO printable statements helpers.
 *
 * Mirrors web-modern/src/lib/cfo/__tests__/status.test.ts: no DOM, no
 * router — just data-in, data-out. All amounts are integer AMD.
 */
import { describe, it, expect } from "vitest";
import {
  balanceSheetDelta,
  cashFlowNet,
  currentPeriodKey,
  formatReportPeriod,
  isBalanced,
  lineTotalOf,
  printDateLabel,
  profitMargin,
  shiftPeriodKey,
  signClassForAmount,
  sortLinesByCodeAsc,
} from "../reports";

/* ────────── period helpers ────────── */

describe("currentPeriodKey", () => {
  it("formats a UTC date as YYYY-MM", () => {
    expect(currentPeriodKey(new Date("2026-06-10T12:00:00.000Z"))).toBe("2026-06");
    expect(currentPeriodKey(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01");
    expect(currentPeriodKey(new Date("2026-12-31T23:59:59.000Z"))).toBe("2026-12");
  });

  it("pads single-digit months to two digits", () => {
    expect(currentPeriodKey(new Date("2026-03-15T00:00:00.000Z"))).toBe("2026-03");
  });
});

describe("shiftPeriodKey", () => {
  it("advances by N months within the same year", () => {
    expect(shiftPeriodKey("2026-03", 2)).toBe("2026-05");
  });

  it("rolls into the next year without producing 2026-13", () => {
    expect(shiftPeriodKey("2026-12", 1)).toBe("2027-01");
  });

  it("rolls back into the previous year", () => {
    expect(shiftPeriodKey("2026-01", -1)).toBe("2025-12");
  });

  it("is a no-op for non-conforming keys", () => {
    expect(shiftPeriodKey("garbage", 3)).toBe("garbage");
    expect(shiftPeriodKey("", 3)).toBe("");
  });
});

describe("formatReportPeriod", () => {
  it("renders an Armenian month label for YYYY-MM keys", () => {
    expect(formatReportPeriod("2026-06")).toBe("Հունիս 2026");
    expect(formatReportPeriod("2026-01")).toBe("Հունվար 2026");
    expect(formatReportPeriod("2026-12")).toBe("Դեկտեմբեր 2026");
  });

  it("returns an em-dash for null / empty", () => {
    expect(formatReportPeriod(null)).toBe("—");
    expect(formatReportPeriod(undefined)).toBe("—");
    expect(formatReportPeriod("")).toBe("—");
  });

  it("returns the input verbatim for malformed keys", () => {
    expect(formatReportPeriod("2026-13")).toBe("2026-13");
    expect(formatReportPeriod("foo-bar")).toBe("foo-bar");
  });
});

describe("printDateLabel", () => {
  it("renders an Armenian long date for the footer", () => {
    expect(printDateLabel(new Date("2026-06-10T12:00:00.000Z"))).toBe("10 Հունիս 2026");
    expect(printDateLabel(new Date("2026-12-31T00:00:00.000Z"))).toBe("31 Դեկտեմբեր 2026");
  });
});

/* ────────── line aggregations ────────── */

describe("lineTotalOf", () => {
  it("sums the amounts in a list of statement lines", () => {
    expect(
      lineTotalOf([
        { amount: 1000 },
        { amount: 2000 },
        { amount: 3000 },
      ]),
    ).toBe(6000);
  });

  it("skips non-finite and null amounts", () => {
    expect(
      lineTotalOf([
        { amount: 1000 },
        { amount: NaN as unknown as number },
        { amount: 2000 },
        { amount: Number.POSITIVE_INFINITY as unknown as number },
      ]),
    ).toBe(3000);
  });

  it("returns 0 for an empty list", () => {
    expect(lineTotalOf([])).toBe(0);
  });
});

describe("sortLinesByCodeAsc", () => {
  it("sorts statement lines by their account code", () => {
    const sorted = sortLinesByCodeAsc([
      { id: "c", code: "1100", name: "Կանխիկ", amount: 100 },
      { id: "a", code: "1000", name: "Հիմնական միջոցներ", amount: 500 },
      { id: "b", code: "1050", name: "Բանկ", amount: 200 },
    ]);
    expect(sorted.map((l) => l.code)).toEqual(["1000", "1050", "1100"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      { id: "b", code: "2000", name: "x", amount: 0 },
      { id: "a", code: "1000", name: "y", amount: 0 },
    ];
    const before = input.map((l) => l.code).join(",");
    sortLinesByCodeAsc(input);
    const after = input.map((l) => l.code).join(",");
    expect(after).toBe(before);
  });
});

/* ────────── income statement ────────── */

describe("profitMargin", () => {
  it("computes the margin as a percentage", () => {
    expect(profitMargin({ totalIncome: 1_000_000, netProfit: 250_000 })).toBe(25);
  });

  it("returns 0 when totalIncome is 0 (avoid divide-by-zero)", () => {
    expect(profitMargin({ totalIncome: 0, netProfit: 0 })).toBe(0);
    expect(profitMargin({ totalIncome: 0, netProfit: -100 })).toBe(0);
  });

  it("handles a negative net profit (loss)", () => {
    expect(profitMargin({ totalIncome: 1_000_000, netProfit: -250_000 })).toBe(-25);
  });
});

/* ────────── balance sheet ────────── */

describe("isBalanced / balanceSheetDelta", () => {
  it("is balanced when A == L + E + RE", () => {
    const bs = { totalAssets: 5_000_000, totalEquityAndLiabilities: 5_000_000 };
    expect(isBalanced(bs)).toBe(true);
    expect(balanceSheetDelta(bs)).toBe(0);
  });

  it("is balanced within a 1-AMD tolerance (rounding)", () => {
    const bs = { totalAssets: 5_000_001, totalEquityAndLiabilities: 5_000_000 };
    expect(isBalanced(bs)).toBe(true);
    expect(isBalanced(bs, 0)).toBe(false);
  });

  it("is not balanced when A != L + E + RE", () => {
    const bs = { totalAssets: 5_000_000, totalEquityAndLiabilities: 4_500_000 };
    expect(isBalanced(bs)).toBe(false);
    expect(balanceSheetDelta(bs)).toBe(500_000);
  });
});

/* ────────── cash flow ────────── */

describe("cashFlowNet", () => {
  it("computes cashIn − cashOut", () => {
    expect(cashFlowNet({ cashIn: 1_000_000, cashOut: 200_000 })).toBe(800_000);
  });

  it("tolerates zero values", () => {
    expect(cashFlowNet({ cashIn: 0, cashOut: 0 })).toBe(0);
  });

  it("treats cashOut as an absolute value (engine returns positive number for outflows)", () => {
    // The engine stores cashOut as a positive number for the magnitude
    // of outflows; cashFlowNet takes |cashOut| to match.
    expect(cashFlowNet({ cashIn: 100, cashOut: 50 })).toBe(50);
  });
});

/* ────────── sign class ────────── */

describe("signClassForAmount", () => {
  it("uses emerald tones for positive amounts", () => {
    expect(signClassForAmount(1)).toContain("emerald");
  });

  it("uses rose tones for negative amounts", () => {
    expect(signClassForAmount(-1)).toContain("rose");
  });

  it("uses muted tones for zero / null / NaN", () => {
    expect(signClassForAmount(0)).toContain("muted");
    expect(signClassForAmount(null)).toContain("muted");
    expect(signClassForAmount(undefined)).toContain("muted");
    expect(signClassForAmount(NaN)).toContain("muted");
  });
});
