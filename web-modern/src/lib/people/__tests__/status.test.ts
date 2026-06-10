/**
 * status.test.ts — pure-helper coverage for the People workspace.
 *
 * Mirrors the finance/status.test.ts pattern: write tests first,
 * then derive every branch deterministically. No React, no fetch,
 * no mocks — the helpers are pure data-in/data-out.
 *
 * Coverage targets:
 *  - classifyEmployment        (active / on-leave / terminated / unknown)
 *  - compareEmployeesByStatusThenName (stable sort)
 *  - countByEmployment         (cohort math)
 *  - sumGrossSalary            (skips null/negative/non-finite)
 *  - daysSinceRun              (today / future / past / missing)
 *  - sumPayrollNet / sumPayrollGross
 *  - comparePayrollRunsDesc    (sort)
 *  - periodLabel               (Armenian month, malformed input)
 *  - isValidTaxId              (8-digit Armenian SSN)
 */
import { describe, it, expect } from "vitest";
import {
  classifyEmployment,
  compareEmployeesByStatusThenName,
  comparePayrollRunsDesc,
  countByEmployment,
  daysSinceRun,
  isValidTaxId,
  periodLabel,
  sumGrossSalary,
  sumPayrollGross,
  sumPayrollNet,
} from "../status";

const TODAY = new Date("2026-06-10T00:00:00.000Z");

/* ────────── classifyEmployment ────────── */

describe("classifyEmployment", () => {
  it("classifies 'active' as 'active'", () => {
    expect(classifyEmployment({ employmentStatus: "active" })).toBe("active");
  });

  it("classifies 'on-leave' as 'on-leave'", () => {
    expect(classifyEmployment({ employmentStatus: "on-leave" })).toBe("on-leave");
  });

  it("classifies 'terminated' as 'terminated'", () => {
    expect(classifyEmployment({ employmentStatus: "terminated" })).toBe("terminated");
  });

  it("falls back to 'unknown' for an unrecognized status", () => {
    expect(classifyEmployment({ employmentStatus: "garden-leave" })).toBe("unknown");
  });

  it("falls back to 'unknown' for a missing status", () => {
    expect(classifyEmployment({ employmentStatus: "" })).toBe("unknown");
  });
});

/* ────────── compareEmployeesByStatusThenName ────────── */

describe("compareEmployeesByStatusThenName", () => {
  it("sorts active employees before on-leave and terminated", () => {
    const employees = [
      { employmentStatus: "terminated", fullName: "Zara Stepanyan" },
      { employmentStatus: "active", fullName: "Anna Hovhannisyan" },
      { employmentStatus: "on-leave", fullName: "Mariam Petrosyan" },
    ];
    const sorted = [...employees].sort(compareEmployeesByStatusThenName);
    expect(sorted.map((e) => e.fullName)).toEqual([
      "Anna Hovhannisyan",
      "Mariam Petrosyan",
      "Zara Stepanyan",
    ]);
  });

  it("sorts alphabetically within the same status", () => {
    const employees = [
      { employmentStatus: "active", fullName: "Zara" },
      { employmentStatus: "active", fullName: "Anna" },
      { employmentStatus: "active", fullName: "Mariam" },
    ];
    expect([...employees].sort(compareEmployeesByStatusThenName).map((e) => e.fullName)).toEqual([
      "Anna",
      "Mariam",
      "Zara",
    ]);
  });

  it("is stable for equal keys (returns 0)", () => {
    const a = { employmentStatus: "active", fullName: "Anna" };
    const b = { employmentStatus: "active", fullName: "Anna" };
    expect(compareEmployeesByStatusThenName(a, b)).toBe(0);
  });
});

/* ────────── countByEmployment ────────── */

describe("countByEmployment", () => {
  it("counts employees by tone", () => {
    const counts = countByEmployment([
      { employmentStatus: "active" },
      { employmentStatus: "active" },
      { employmentStatus: "on-leave" },
      { employmentStatus: "terminated" },
      { employmentStatus: "garden-leave" }, // → unknown
    ]);
    expect(counts).toEqual({
      active: 2,
      "on-leave": 1,
      terminated: 1,
      unknown: 1,
    });
  });

  it("returns zeroed counts for an empty list", () => {
    expect(countByEmployment([])).toEqual({
      active: 0,
      "on-leave": 0,
      terminated: 0,
      unknown: 0,
    });
  });
});

/* ────────── sumGrossSalary ────────── */

describe("sumGrossSalary", () => {
  it("sums finite positive salaries", () => {
    expect(
      sumGrossSalary([
        { grossSalary: 250000 },
        { grossSalary: 350000 },
      ] as any),
    ).toBe(600000);
  });

  it("skips nulls, zeros, and negatives", () => {
    expect(
      sumGrossSalary([
        { grossSalary: 250000 },
        { grossSalary: null },
        { grossSalary: 0 },
        { grossSalary: -100 }, // legacy corrupt seed — skip
        { grossSalary: 150000 },
      ] as any),
    ).toBe(400000);
  });

  it("returns 0 for an empty list", () => {
    expect(sumGrossSalary([])).toBe(0);
  });
});

/* ────────── daysSinceRun ────────── */

describe("daysSinceRun", () => {
  it("returns 0 for a run dated today", () => {
    expect(daysSinceRun({ runDate: "2026-06-10" }, TODAY)).toBe(0);
  });

  it("returns positive days for a past run", () => {
    expect(daysSinceRun({ runDate: "2026-06-05" }, TODAY)).toBe(5);
  });

  it("returns negative days for a future run", () => {
    expect(daysSinceRun({ runDate: "2026-06-15" }, TODAY)).toBe(-5);
  });

  it("returns null for a missing runDate", () => {
    expect(daysSinceRun({ runDate: null }, TODAY)).toBeNull();
  });

  it("returns null for a malformed runDate", () => {
    expect(daysSinceRun({ runDate: "garbage" }, TODAY)).toBeNull();
  });
});

/* ────────── sumPayrollNet / sumPayrollGross ────────── */

describe("sumPayrollNet", () => {
  it("sums finite net amounts", () => {
    expect(
      sumPayrollNet([
        { net: 180000 },
        { net: 220000 },
        { net: null as any },
      ]),
    ).toBe(400000);
  });

  it("returns 0 for an empty list", () => {
    expect(sumPayrollNet([])).toBe(0);
  });
});

describe("sumPayrollGross", () => {
  it("sums finite gross amounts", () => {
    expect(
      sumPayrollGross([
        { gross: 250000 },
        { gross: 350000 },
      ]),
    ).toBe(600000);
  });
});

/* ────────── comparePayrollRunsDesc ────────── */

describe("comparePayrollRunsDesc", () => {
  it("sorts runs newest first", () => {
    const runs = [
      { runDate: "2026-04-30" },
      { runDate: "2026-06-10" },
      { runDate: "2026-05-31" },
    ];
    expect([...runs].sort(comparePayrollRunsDesc).map((r) => r.runDate)).toEqual([
      "2026-06-10",
      "2026-05-31",
      "2026-04-30",
    ]);
  });

  it("puts missing dates at the end", () => {
    const runs = [
      { runDate: "2026-04-30" },
      { runDate: null },
      { runDate: "2026-06-10" },
    ];
    const sorted = [...runs].sort(comparePayrollRunsDesc);
    expect(sorted[0].runDate).toBe("2026-06-10");
    expect(sorted[2].runDate).toBeNull();
  });

  it("is stable for equal keys (returns 0)", () => {
    expect(comparePayrollRunsDesc({ runDate: "2026-06-10" }, { runDate: "2026-06-10" })).toBe(0);
  });
});

/* ────────── periodLabel ────────── */

describe("periodLabel", () => {
  it("renders YYYY-MM as Armenian month + year", () => {
    expect(periodLabel("2026-06")).toBe("Հունիս 2026");
    expect(periodLabel("2026-01")).toBe("Հունվար 2026");
    expect(periodLabel("2026-12")).toBe("Դեկտեմբեր 2026");
  });

  it("returns '—' for null / undefined / empty", () => {
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

/* ────────── isValidTaxId ────────── */

describe("isValidTaxId", () => {
  it("accepts an 8-digit tax ID", () => {
    expect(isValidTaxId("12345678")).toBe(true);
  });

  it("treats an empty / null tax ID as valid (optional field)", () => {
    expect(isValidTaxId("")).toBe(true);
    expect(isValidTaxId(null)).toBe(true);
    expect(isValidTaxId(undefined)).toBe(true);
  });

  it("rejects a tax ID with fewer than 8 digits", () => {
    expect(isValidTaxId("1234567")).toBe(false);
  });

  it("rejects a tax ID with more than 8 digits", () => {
    expect(isValidTaxId("123456789")).toBe(false);
  });

  it("rejects a tax ID with non-digit characters", () => {
    expect(isValidTaxId("1234567a")).toBe(false);
    expect(isValidTaxId("1234-678")).toBe(false);
  });

  it("trims whitespace before validating", () => {
    expect(isValidTaxId("  12345678  ")).toBe(true);
  });
});
