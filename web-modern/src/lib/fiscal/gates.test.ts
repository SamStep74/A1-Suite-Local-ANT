/**
 * gates.test.ts — pure-function coverage for `lib/fiscal/gates.ts`.
 *
 * No React, no DOM. Vitest's `node` environment for `src/lib/**` is
 * the default in `vitest.config.ts`; this file is colocated with
 * the unit under test, so the `environmentMatchGlobs` rule still
 * applies and we get the lean node runtime.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GateAction, GateStatus, type FiscalGate } from "./schemas";
import {
  VIEW_KEYS,
  applyGateMutation,
  applyView,
  currentPeriod,
  formatAmount,
  isAwaitingCustomer,
  isOverdue,
  seedDefaultTriageViews,
  seedGatesForPeriod,
} from "./gates";
import { __clearForTests } from "../components/savedViewsStore";

/* ────────── fixtures ────────── */

const PERIOD = "2026-06";
const FUTURE_PERIOD = "2027-01";

const nowAt = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

beforeEach(() => {
  __clearForTests("fiscal-gates");
});

afterEach(() => {
  __clearForTests("fiscal-gates");
});

/* ────────── seedGatesForPeriod ────────── */

describe("seedGatesForPeriod", () => {
  it("returns 10 gates for a given period", () => {
    const out = seedGatesForPeriod(PERIOD, nowAt("2026-06-15"));
    expect(out).toHaveLength(10);
  });

  it("every gate carries the requested period", () => {
    const out = seedGatesForPeriod(PERIOD, nowAt("2026-06-15"));
    for (const g of out) {
      expect(g.period).toBe(PERIOD);
    }
  });

  it("computes dueDate as `${period}-${defaultDueDay}`", () => {
    const out = seedGatesForPeriod(PERIOD, nowAt("2026-06-15"));
    const vat = out.find((g) => g.kind === "vat-monthly");
    expect(vat?.dueDate).toBe("2026-06-20");
  });

  it("flips a gate to Overdue when the due date is in the past", () => {
    // Period is 2026-06, today is 2026-07-15: every gate's dueDate
    // is in the past → all Overdue.
    const out = seedGatesForPeriod(PERIOD, nowAt("2026-07-15"));
    for (const g of out) {
      expect(g.status).toBe(GateStatus.Overdue);
    }
  });

  it("leaves a gate Pending when the due date is in the future", () => {
    // Period is 2027-01, today is 2026-06-15: every gate's dueDate
    // is in the future → all Pending.
    const out = seedGatesForPeriod(FUTURE_PERIOD, nowAt("2026-06-15"));
    for (const g of out) {
      expect(g.status).toBe(GateStatus.Pending);
    }
  });
});

/* ────────── currentPeriod ────────── */

describe("currentPeriod", () => {
  it("returns YYYY-MM for a known date", () => {
    expect(currentPeriod(nowAt("2026-06-01"))).toBe("2026-06");
    expect(currentPeriod(nowAt("2025-12-31"))).toBe("2025-12");
    expect(currentPeriod(nowAt("2024-01-01"))).toBe("2024-01");
  });
});

/* ────────── applyGateMutation ────────── */

describe("applyGateMutation", () => {
  const baseGates: ReadonlyArray<FiscalGate> = [
    {
      id: "a",
      kind: "vat-monthly",
      category: "vat" as const,
      period: PERIOD,
      dueDate: "2026-06-20",
      status: GateStatus.Pending,
      amount: 1000,
      awaitingCustomer: false,
      note: "",
    },
    {
      id: "b",
      kind: "payroll-tax-monthly",
      category: "payroll_tax" as const,
      period: PERIOD,
      dueDate: "2026-06-15",
      status: GateStatus.Overdue,
      amount: 2000,
      awaitingCustomer: false,
      note: "",
    },
    {
      id: "c",
      kind: "withholding-monthly",
      category: "withholding" as const,
      period: PERIOD,
      dueDate: "2026-06-15",
      status: GateStatus.Acknowledged,
      amount: 3000,
      awaitingCustomer: true,
      note: "",
    },
  ];

  it("is immutable (returns a new array, original unchanged)", () => {
    const out = applyGateMutation(baseGates, ["a"], GateAction.Acknowledge);
    expect(out).not.toBe(baseGates);
    expect(baseGates[0]?.status).toBe(GateStatus.Pending);
    expect(out[0]?.status).toBe(GateStatus.Acknowledged);
  });

  it("Acknowledge: pending → acknowledged (idempotent on non-pending)", () => {
    const out = applyGateMutation(baseGates, ["a"], GateAction.Acknowledge);
    expect(out[0]?.status).toBe(GateStatus.Acknowledged);
    // "b" is Overdue, not Pending → Acknowledge is a no-op for it.
    expect(out[1]?.status).toBe(GateStatus.Overdue);
  });

  it("MarkFiled: any → filed (no-op on already-filed)", () => {
    const out = applyGateMutation(baseGates, ["a", "b", "c"], GateAction.MarkFiled);
    expect(out[0]?.status).toBe(GateStatus.Filed);
    expect(out[1]?.status).toBe(GateStatus.Filed);
    expect(out[2]?.status).toBe(GateStatus.Filed);
  });

  it("Escalate: any → escalated (no-op on already-escalated)", () => {
    const out = applyGateMutation(baseGates, ["a"], GateAction.Escalate);
    expect(out[0]?.status).toBe(GateStatus.Escalated);
  });

  it("leaves untouched ids unchanged", () => {
    const out = applyGateMutation(baseGates, ["a"], GateAction.MarkFiled);
    expect(out[1]).toBe(baseGates[1]);
    expect(out[2]).toBe(baseGates[2]);
  });

  it("empty ids list is a no-op (still returns a fresh array)", () => {
    const out = applyGateMutation(baseGates, [], GateAction.MarkFiled);
    expect(out).toHaveLength(baseGates.length);
    expect(out[0]).toBe(baseGates[0]);
  });
});

/* ────────── isOverdue + isAwaitingCustomer ────────── */

describe("isOverdue + isAwaitingCustomer", () => {
  const make = (over: Partial<FiscalGate>): FiscalGate => ({
    id: "x",
    kind: "vat-monthly",
    category: "vat" as const,
    period: PERIOD,
    dueDate: "2026-06-20",
    status: GateStatus.Pending,
    amount: 0,
    awaitingCustomer: false,
    note: "",
    ...over,
  });

  it("isOverdue: true when past due and not yet Filed", () => {
    expect(isOverdue(make({ dueDate: "2026-06-10" }), nowAt("2026-06-15"))).toBe(true);
  });

  it("isOverdue: false when in the future", () => {
    expect(isOverdue(make({ dueDate: "2026-06-25" }), nowAt("2026-06-15"))).toBe(false);
  });

  it("isOverdue: false when already Filed", () => {
    expect(
      isOverdue(
        make({ dueDate: "2026-06-10", status: GateStatus.Filed }),
        nowAt("2026-06-15"),
      ),
    ).toBe(false);
  });

  it("isAwaitingCustomer: true when awaiting + not Filed", () => {
    expect(isAwaitingCustomer(make({ awaitingCustomer: true }))).toBe(true);
  });

  it("isAwaitingCustomer: false when Filed (filed clears the wait)", () => {
    expect(
      isAwaitingCustomer(make({ awaitingCustomer: true, status: GateStatus.Filed })),
    ).toBe(false);
  });

  it("isAwaitingCustomer: false when not awaiting", () => {
    expect(isAwaitingCustomer(make({ awaitingCustomer: false }))).toBe(false);
  });
});

/* ────────── applyView ────────── */

describe("applyView", () => {
  // Seeded gates for an Overdue-everything period.
  const overdueAll = seedGatesForPeriod(PERIOD, nowAt("2026-07-15"));
  // Seeded gates for a Pending-everything future period.
  const pendingAll = seedGatesForPeriod(FUTURE_PERIOD, nowAt("2026-06-15"));

  it("CurrentPeriod: filters to the period matching currentPeriod(now)", () => {
    // overdueAll is seeded for PERIOD (2026-06) with now=2026-07-15.
    // currentPeriod(2026-07-15) = 2026-07, but overdueAll's period
    // is 2026-06 → no rows match the current period → 0 rows.
    const out = applyView(overdueAll, VIEW_KEYS.CurrentPeriod, nowAt("2026-07-15"));
    expect(out).toHaveLength(0);

    // When now matches period, all 10 should be included.
    const samePeriod = seedGatesForPeriod(PERIOD, nowAt("2026-06-15"));
    const out2 = applyView(samePeriod, VIEW_KEYS.CurrentPeriod, nowAt("2026-06-15"));
    expect(out2).toHaveLength(10);
  });

  it("AllOverdue: filters to past-due, not-yet-filed gates", () => {
    const out = applyView(overdueAll, VIEW_KEYS.AllOverdue, nowAt("2026-07-15"));
    expect(out).toHaveLength(10); // every gate is overdue
    const out2 = applyView(pendingAll, VIEW_KEYS.AllOverdue, nowAt("2026-06-15"));
    expect(out2).toHaveLength(0); // future period, nothing overdue
  });

  it("AwaitingCustomer: filters to gates awaiting a third party and not yet filed", () => {
    const out = applyView(overdueAll, VIEW_KEYS.AwaitingCustomer, nowAt("2026-07-15"));
    // 3 of 10 default-awaiting gates: withholding, excise, customs
    expect(out).toHaveLength(3);
    for (const g of out) {
      expect(g.awaitingCustomer).toBe(true);
    }
  });

  it("never mutates the input array", () => {
    const copy = [...overdueAll];
    applyView(overdueAll, VIEW_KEYS.AllOverdue, nowAt("2026-07-15"));
    expect(overdueAll).toEqual(copy);
  });
});

/* ────────── formatAmount ────────── */

describe("formatAmount", () => {
  it("formats a number with the dram suffix and a thousands-grouped number", () => {
    // The exact grouping character depends on the host ICU: Node
    // uses U+00A0 (NBSP) for ru-RU, while the browser often
    // returns U+0020. We assert the suffix + the digit pattern
    // rather than the exact separator.
    expect(formatAmount(1_250_000)).toMatch(/^1[\s ]250[\s ]000 ֏$/);
    expect(formatAmount(0)).toBe("0 ֏");
    expect(formatAmount(999)).toBe("999 ֏");
  });

  it("returns the em-dash placeholder for null", () => {
    expect(formatAmount(null)).toBe("—");
  });
});

/* ────────── seedDefaultTriageViews ────────── */

describe("seedDefaultTriageViews", () => {
  it("inserts exactly 3 default views on first call", () => {
    const seeded = seedDefaultTriageViews("fiscal-gates");
    expect(seeded).toHaveLength(3);
  });

  it("is idempotent — second call does not duplicate", () => {
    seedDefaultTriageViews("fiscal-gates");
    const seeded2 = seedDefaultTriageViews("fiscal-gates");
    expect(seeded2).toHaveLength(3);
  });
});
