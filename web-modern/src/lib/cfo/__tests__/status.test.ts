/**
 * status.test.ts — unit tests for the CFO pure helpers.
 *
 * Mirrors web-modern/src/lib/docs/__tests__/status.test.ts pattern.
 * All amounts are integer AMD.
 */
import { describe, it, expect } from "vitest";
import {
  classifyBudgetStatus,
  compareCalendarsByDate,
  compareFxByAbsExposureDesc,
  compareTreasuryByBalanceDesc,
  cashFlowNetTotal,
  cashFlowClosingDelta,
  budgetVarianceLabel,
  budgetUtilizationClass,
  calendarTotalsByKind,
  fxHedgeClass,
  fxHedgeSuggestion,
  formatCurrency,
  formatPercent,
  AM_SHORT_MONTHS,
  type BudgetTone,
} from "../status";

/* ────────── fixtures ────────── */

const BUDGETS = {
  active: { status: "active" },
  draft: { status: "draft" },
  closed: { status: "closed" },
  archived: { status: "archived" },
  garbage: { status: "garbage" },
  missing: { status: undefined as unknown as string },
};

const CASH_FLOW = {
  openingAmd: 1_000_000,
  closingAmd: 1_500_000,
  weekly: [
    { weekKey: "2026-W22", inflow: 500_000, outflow: 200_000, net: 300_000, closing: 1_300_000 },
    { weekKey: "2026-W23", inflow: 400_000, outflow: 200_000, net: 200_000, closing: 1_500_000 },
  ],
};

const CALENDAR = {
  entries: [
    { date: "2026-06-15", amount: 100_000, kind: "ar", source: "inv-1" },
    { date: "2026-06-20", amount: 80_000, kind: "ap", source: "bill-1" },
    { date: "2026-06-30", amount: 50_000, kind: "loan", source: "loan-1" },
    { date: "2026-06-25", amount: 30_000, kind: "ap", source: "bill-2" },
  ],
  totalAmd: 260_000,
};

const FX_ROWS = [
  { currency: "USD", net: 1_000, netAmd: 400_000 },
  { currency: "EUR", net: 5_000, netAmd: -2_500_000 },
  { currency: "RUB", net: 100_000, netAmd: 600_000 },
];

/* ────────── classifyBudgetStatus ────────── */

describe("classifyBudgetStatus", () => {
  it("maps known statuses", () => {
    expect(classifyBudgetStatus(BUDGETS.active)).toBe<BudgetTone>("active");
    expect(classifyBudgetStatus(BUDGETS.draft)).toBe<BudgetTone>("draft");
    expect(classifyBudgetStatus(BUDGETS.closed)).toBe<BudgetTone>("closed");
    expect(classifyBudgetStatus(BUDGETS.archived)).toBe<BudgetTone>("archived");
  });
  it("falls back to unknown for unrecognized values", () => {
    expect(classifyBudgetStatus(BUDGETS.garbage)).toBe<BudgetTone>("unknown");
    expect(classifyBudgetStatus(BUDGETS.missing)).toBe<BudgetTone>("unknown");
  });
});

/* ────────── compareCalendarsByDate ────────── */

describe("compareCalendarsByDate", () => {
  it("sorts by date ascending", () => {
    const out = CALENDAR.entries.slice().sort(compareCalendarsByDate).map((e) => e.date);
    expect(out).toEqual(["2026-06-15", "2026-06-20", "2026-06-25", "2026-06-30"]);
  });
});

/* ────────── compareFxByAbsExposureDesc ────────── */

describe("compareFxByAbsExposureDesc", () => {
  it("sorts FX rows by absolute netAmd descending", () => {
    const out = FX_ROWS.slice().sort(compareFxByAbsExposureDesc).map((r) => r.currency);
    // |EUR|=2.5M, |RUB|=600k, |USD|=400k
    expect(out).toEqual(["EUR", "RUB", "USD"]);
  });
});

/* ────────── compareTreasuryByBalanceDesc ────────── */

describe("compareTreasuryByBalanceDesc", () => {
  it("sorts treasury positions by absolute balance desc", () => {
    const rows = [
      { currency: "AMD", balance: 1_000_000, accountCount: 1 },
      { currency: "USD", balance: -800_000, accountCount: 1 },
      { currency: "EUR", balance: 200_000, accountCount: 1 },
    ];
    const out = rows.slice().sort(compareTreasuryByBalanceDesc).map((r) => r.currency);
    expect(out).toEqual(["AMD", "USD", "EUR"]);
  });
});

/* ────────── cashFlow helpers ────────── */

describe("cashFlowNetTotal", () => {
  it("sums all weekly nets", () => {
    expect(cashFlowNetTotal(CASH_FLOW)).toBe(500_000);
  });
  it("returns 0 for empty weeks", () => {
    expect(cashFlowNetTotal({ weekly: [] })).toBe(0);
  });
});

describe("cashFlowClosingDelta", () => {
  it("computes closing - opening", () => {
    expect(cashFlowClosingDelta(CASH_FLOW)).toBe(500_000);
  });
});

/* ────────── budget variance ────────── */

describe("budgetVarianceLabel", () => {
  it("returns 'Over' when actual > planned", () => {
    expect(budgetVarianceLabel({ planned: 100, variance: 10 })).toBe("Over");
  });
  it("returns 'Under' when actual < planned", () => {
    expect(budgetVarianceLabel({ planned: 100, variance: -10 })).toBe("Under");
  });
  it("returns 'On target' when variance = 0", () => {
    expect(budgetVarianceLabel({ planned: 100, variance: 0 })).toBe("On target");
  });
  it("treats zero planned as 'Over' if any variance", () => {
    expect(budgetVarianceLabel({ planned: 0, variance: 0 })).toBe("On target");
    expect(budgetVarianceLabel({ planned: 0, variance: 50 })).toBe("Over");
  });
});

describe("budgetUtilizationClass", () => {
  it("red when utilization > 110", () => {
    expect(budgetUtilizationClass({ utilizationPct: 130 })).toBe("red");
  });
  it("green when utilization 90..110", () => {
    expect(budgetUtilizationClass({ utilizationPct: 95 })).toBe("green");
    expect(budgetUtilizationClass({ utilizationPct: 110 })).toBe("green");
  });
  it("amber when utilization 70..89", () => {
    expect(budgetUtilizationClass({ utilizationPct: 80 })).toBe("amber");
  });
  it("red when utilization < 70", () => {
    expect(budgetUtilizationClass({ utilizationPct: 50 })).toBe("red");
  });
});

/* ────────── calendar totals ────────── */

describe("calendarTotalsByKind", () => {
  it("sums entries by kind", () => {
    expect(calendarTotalsByKind(CALENDAR)).toEqual({
      arAmd: 100_000,
      apAmd: 110_000,
      loanAmd: 50_000,
    });
  });
  it("returns zeros for empty calendar", () => {
    expect(calendarTotalsByKind({ entries: [] })).toEqual({ arAmd: 0, apAmd: 0, loanAmd: 0 });
  });
});

/* ────────── FX hedge classification ────────── */

describe("fxHedgeClass", () => {
  it("warning when |netAmd| > 5M", () => {
    expect(fxHedgeClass({ netAmd: 6_000_000 })).toBe("warning");
    expect(fxHedgeClass({ netAmd: -6_000_000 })).toBe("warning");
  });
  it("info when |netAmd| in 1M..5M", () => {
    expect(fxHedgeClass({ netAmd: 2_000_000 })).toBe("info");
  });
  it("none when |netAmd| <= 1M", () => {
    expect(fxHedgeClass({ netAmd: 500_000 })).toBe("none");
  });
});

describe("fxHedgeSuggestion", () => {
  it("returns the suggestion string when set", () => {
    expect(
      fxHedgeSuggestion({
        hedgeSuggestion: "Հաշվի՛ր ֆորվարդային պայմանագրի օգտագործումը։",
      }),
    ).toBe("Հաշվի՛ր ֆորվարդային պայմանագրի օգտագործումը։");
  });
  it("returns null when missing", () => {
    expect(fxHedgeSuggestion({ hedgeSuggestion: undefined as unknown as string })).toBeNull();
    expect(fxHedgeSuggestion({})).toBeNull();
  });
});

/* ────────── formatting ────────── */

describe("formatCurrency", () => {
  it("formats with Armenian digit grouping and ֏ glyph", () => {
    const out = formatCurrency(1_250_000);
    expect(out).toMatch(/1\s*250\s*000/);
  });
  it("returns '—' for null/NaN", () => {
    expect(formatCurrency(null)).toBe("—");
    expect(formatCurrency(NaN)).toBe("—");
  });
  it("accepts a currency override", () => {
    const out = formatCurrency(100, "USD");
    expect(out).toMatch(/100/);
  });
});

describe("formatPercent", () => {
  it("appends % to number", () => {
    expect(formatPercent(95)).toBe("95%");
    expect(formatPercent(95.5, 1)).toBe("95.5%");
  });
  it("returns '—' for null/NaN", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(NaN)).toBe("—");
  });
});

/* ────────── AM_SHORT_MONTHS ────────── */

describe("AM_SHORT_MONTHS", () => {
  it("has 12 entries", () => {
    expect(AM_SHORT_MONTHS).toHaveLength(12);
  });
  it("starts with Հնվ and ends with Դեկ", () => {
    expect(AM_SHORT_MONTHS[0]).toBe("Հնվ");
    expect(AM_SHORT_MONTHS[11]).toBe("Դեկ");
  });
});
