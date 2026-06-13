/**
 * close.test.ts — unit tests for the period-close library.
 *
 * Coverage target: 100% line + branch for the three modules in
 * `lib/close/` (schemas, checklist, state).
 *
 * Pattern A: pure-helper tests (no React, no fetch, no router).
 * We do exercise the localStorage adapter via the in-memory shim
 * so the JSON serialization path is hit without needing jsdom's
 * `localStorage` global.
 */
import { describe, expect, it } from "vitest";
import {
  CHECKLIST_STEPS,
  CHECKLIST_TOTAL_STEPS,
  groupByCategory,
  periodFromId,
  periodIdFromDate,
  sortSteps,
} from "../checklist";
import {
  ClosePeriodSchema,
  CloseStepSchema,
  CloseStepStateSchema,
  CloseStepStatusSchema,
  isCountedAsDone,
  isTerminalStatus,
} from "../schemas";
import {
  STORAGE_PREFIX,
  clearStepState,
  inMemoryStorage,
  periodPrefix,
  readPeriodState,
  readStepState,
  setStatusForSteps,
  stepKey,
  summarize,
  writeStepState,
  type KeyValueStorage,
} from "../state";

/* ────────── schemas.ts ────────── */

describe("schemas", () => {
  it("CloseStepStatusSchema accepts the four canonical states", () => {
    expect(CloseStepStatusSchema.parse("pending")).toBe("pending");
    expect(CloseStepStatusSchema.parse("done")).toBe("done");
    expect(CloseStepStatusSchema.parse("blocked")).toBe("blocked");
    expect(CloseStepStatusSchema.parse("skipped")).toBe("skipped");
  });

  it("CloseStepStatusSchema rejects unknown values", () => {
    expect(() => CloseStepStatusSchema.parse("complete")).toThrow();
    expect(() => CloseStepStatusSchema.parse("")).toThrow();
  });

  it("isTerminalStatus matches the documented 3", () => {
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("done")).toBe(true);
    expect(isTerminalStatus("blocked")).toBe(true);
    expect(isTerminalStatus("skipped")).toBe(true);
  });

  it("isCountedAsDone is only true for `done`", () => {
    expect(isCountedAsDone("done")).toBe(true);
    expect(isCountedAsDone("blocked")).toBe(false);
    expect(isCountedAsDone("skipped")).toBe(false);
    expect(isCountedAsDone("pending")).toBe(false);
  });

  it("CloseStepSchema rejects empty title/description", () => {
    expect(() =>
      CloseStepSchema.parse({
        id: "x",
        title: "",
        description: "d",
        category: "c",
        order: 1,
      }),
    ).toThrow();
  });

  it("CloseStepStateSchema round-trips an updatedAt", () => {
    const s = CloseStepStateSchema.parse({
      stepId: "x",
      status: "done",
      updatedAt: "2026-06-13T12:00:00.000Z",
    });
    expect(s.status).toBe("done");
    expect(s.updatedAt).toBe("2026-06-13T12:00:00.000Z");
  });

  it("CloseStepStateSchema accepts missing updatedAt", () => {
    const s = CloseStepStateSchema.parse({ stepId: "x", status: "pending" });
    expect(s.updatedAt).toBeUndefined();
  });

  it("ClosePeriodSchema enforces YYYY-MM id", () => {
    expect(ClosePeriodSchema.parse(periodFromId("2026-06")).id).toBe(
      "2026-06",
    );
    expect(() =>
      ClosePeriodSchema.parse({
        id: "06-2026",
        label: "Jun 2026",
        startsAt: new Date().toISOString(),
        endsAt: new Date().toISOString(),
      }),
    ).toThrow();
  });
});

/* ────────── checklist.ts ────────── */

describe("checklist", () => {
  it("exposes 12-15 canonical steps (currently 13)", () => {
    expect(CHECKLIST_STEPS.length).toBeGreaterThanOrEqual(12);
    expect(CHECKLIST_STEPS.length).toBeLessThanOrEqual(15);
    expect(CHECKLIST_TOTAL_STEPS).toBe(CHECKLIST_STEPS.length);
  });

  it("every step has a unique id", () => {
    const ids = new Set<string>();
    for (const s of CHECKLIST_STEPS) {
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
    }
  });

  it("orders are globally contiguous (1..N)", () => {
    const orders = CHECKLIST_STEPS.map((s) => s.order).sort((a, b) => a - b);
    for (let i = 0; i < orders.length; i += 1) {
      expect(orders[i]).toBe(i + 1);
    }
  });

  it("groupByCategory preserves first-appearance order", () => {
    const grouped = groupByCategory(CHECKLIST_STEPS);
    const keys = Object.keys(grouped);
    expect(keys[0]).toBe("Reconcile");
    expect(keys).toContain("Post");
    expect(keys).toContain("Reports");
    expect(keys).toContain("Tax");
    expect(keys[keys.length - 1]).toBe("Lock");
  });

  it("sortSteps sorts ascending by order", () => {
    const shuffled = [...CHECKLIST_STEPS].reverse();
    const sorted = sortSteps(shuffled);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i - 1]!.order).toBeLessThanOrEqual(sorted[i]!.order);
    }
  });

  it("periodIdFromDate returns YYYY-MM", () => {
    const d = new Date(Date.UTC(2026, 5, 13));
    expect(periodIdFromDate(d)).toBe("2026-06");
  });

  it("periodFromId rejects garbage", () => {
    expect(() => periodFromId("not-a-period")).toThrow();
  });

  it("periodFromId round-trips a fresh period", () => {
    const p = periodFromId("2026-06");
    expect(p.id).toBe("2026-06");
    expect(p.label).toBe("June 2026");
    expect(p.startsAt.startsWith("2026-06-01")).toBe(true);
    expect(p.endsAt.startsWith("2026-06-")).toBe(true);
  });
});

/* ────────── state.ts ────────── */

describe("state", () => {
  const period = periodFromId("2026-06");
  const step = CHECKLIST_STEPS[0]!;

  const newStorage = (): KeyValueStorage => inMemoryStorage();

  it("stepKey format matches a1:close:<periodId>:<stepId>", () => {
    expect(stepKey("2026-06", "reconcile-bank")).toBe(
      "a1:close:2026-06:reconcile-bank",
    );
  });

  it("periodPrefix ends with a colon", () => {
    expect(periodPrefix("2026-06")).toBe("a1:close:2026-06:");
  });

  it("STORAGE_PREFIX is stable (don't bump without migration)", () => {
    expect(STORAGE_PREFIX).toBe("a1:close:");
  });

  it("readStepState defaults to pending on missing key", () => {
    const s = readStepState(newStorage(), period.id, step);
    expect(s.status).toBe("pending");
  });

  it("readStepState falls back to pending on corrupt JSON", () => {
    const storage = newStorage();
    storage.setItem(stepKey(period.id, step.id), "{not json");
    const s = readStepState(storage, period.id, step);
    expect(s.status).toBe("pending");
  });

  it("readStepState falls back to pending on a Zod validation failure", () => {
    const storage = newStorage();
    storage.setItem(
      stepKey(period.id, step.id),
      JSON.stringify({ stepId: "wrong-id", status: "done" }),
    );
    const s = readStepState(storage, period.id, step);
    expect(s.status).toBe("pending");
  });

  it("readStepState parses a valid stored state", () => {
    const storage = newStorage();
    writeStepState(storage, period.id, {
      stepId: step.id,
      status: "done",
      updatedAt: "2026-06-13T00:00:00.000Z",
    });
    const s = readStepState(storage, period.id, step);
    expect(s.status).toBe("done");
    expect(s.updatedAt).toBe("2026-06-13T00:00:00.000Z");
  });

  it("setStatusForSteps writes all and returns the written states", () => {
    const storage = newStorage();
    const ids = [CHECKLIST_STEPS[0]!.id, CHECKLIST_STEPS[1]!.id];
    const written = setStatusForSteps(storage, period.id, ids, "done");
    expect(written).toHaveLength(2);
    for (const w of written) {
      const s = readStepState(storage, period.id, { ...step, id: w.stepId });
      expect(s.status).toBe("done");
    }
  });

  it("setStatusForSteps includes a note when provided", () => {
    const storage = newStorage();
    const id = CHECKLIST_STEPS[0]!.id;
    setStatusForSteps(storage, period.id, [id], "blocked", "bank site down");
    const s = readStepState(storage, period.id, { ...step, id });
    expect(s.status).toBe("blocked");
    expect(s.note).toBe("bank site down");
  });

  it("clearStepState removes the key", () => {
    const storage = newStorage();
    writeStepState(storage, period.id, {
      stepId: step.id,
      status: "done",
    });
    clearStepState(storage, period.id, step.id);
    const s = readStepState(storage, period.id, step);
    expect(s.status).toBe("pending");
  });

  it("readPeriodState returns one row per seed step in canonical order", () => {
    const storage = newStorage();
    const rows = readPeriodState(storage, period);
    expect(rows).toHaveLength(CHECKLIST_STEPS.length);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1]!.step.order).toBeLessThanOrEqual(rows[i]!.step.order);
    }
  });

  it("summarize computes counts and doneRatio", () => {
    const storage = newStorage();
    // Mark 3 done, 1 blocked, 1 skipped.
    setStatusForSteps(storage, period.id, [
      CHECKLIST_STEPS[0]!.id,
      CHECKLIST_STEPS[1]!.id,
      CHECKLIST_STEPS[2]!.id,
    ], "done");
    setStatusForSteps(storage, period.id, [CHECKLIST_STEPS[3]!.id], "blocked");
    setStatusForSteps(storage, period.id, [CHECKLIST_STEPS[4]!.id], "skipped");
    const rows = readPeriodState(storage, period);
    const s = summarize(rows);
    expect(s.total).toBe(CHECKLIST_STEPS.length);
    expect(s.done).toBe(3);
    expect(s.blocked).toBe(1);
    expect(s.skipped).toBe(1);
    expect(s.pending).toBe(CHECKLIST_STEPS.length - 5);
    expect(s.doneRatio).toBeCloseTo(3 / CHECKLIST_STEPS.length, 5);
  });

  it("summarize handles an empty row list without dividing by zero", () => {
    const s = summarize([]);
    expect(s.doneRatio).toBe(0);
    expect(s.total).toBe(0);
  });

  it("keysWithPrefix enumerates only the requested period", () => {
    const storage = newStorage();
    setStatusForSteps(storage, "2026-06", [CHECKLIST_STEPS[0]!.id], "done");
    setStatusForSteps(storage, "2026-05", [CHECKLIST_STEPS[0]!.id], "done");
    const keys = storage.keysWithPrefix(periodPrefix("2026-06"));
    expect(keys).toHaveLength(1);
    expect(keys[0]!.startsWith("a1:close:2026-06:")).toBe(true);
  });
});
