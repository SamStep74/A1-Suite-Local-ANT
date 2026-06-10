/**
 * status.test.ts — unit tests for the Projects pure helpers.
 *
 * Mirrors web-modern/src/lib/cfo/__tests__/status.test.ts pattern.
 * All amounts are integer AMD or minutes.
 */
import { describe, it, expect } from "vitest";
import {
  classifyProjectStatus,
  classifyTaskStatus,
  compareProjectsByUpdatedAtDesc,
  compareTasksByStatusOrder,
  compareMilestonesByDueDateAsc,
  projectProgressPct,
  milestoneReachedPct,
  totalTaskCount,
  doneTaskCount,
  totalMilestoneCount,
  reachedMilestoneCount,
  totalMinutes,
  taskCount,
  milestoneCount,
  timeEntryCount,
  billingHoursFromMinutes,
  billingGrossAmd,
  billingVatAmountAmd,
  billingTotalAmd,
  isProjectBillable,
  formatProjectDurationHours,
  formatCurrency,
  formatPercent,
  type ProjectTone,
  type TaskTone,
} from "../status";

/* ────────── fixtures ────────── */

const PROJECTS = [
  {
    id: "p-1",
    name: "Alpha",
    status: "active",
    customerId: "c-1",
    dealId: null,
    startDate: "2026-01-01",
    dueDate: "2026-06-30",
    updatedAt: "2026-06-09T10:00:00Z",
    taskTotal: 10,
    taskDone: 5,
    milestoneTotal: 4,
    milestoneReached: 2,
    totalMinutes: 480,
  },
  {
    id: "p-2",
    name: "Bravo",
    status: "planning",
    customerId: null,
    dealId: null,
    startDate: "2026-02-01",
    dueDate: "2026-08-30",
    updatedAt: "2026-06-08T10:00:00Z",
    taskTotal: 0,
    taskDone: 0,
    milestoneTotal: 0,
    milestoneReached: 0,
    totalMinutes: 0,
  },
  {
    id: "p-3",
    name: "Charlie",
    status: "completed",
    customerId: "c-2",
    dealId: null,
    startDate: "2025-09-01",
    dueDate: "2025-12-31",
    updatedAt: "2026-06-07T10:00:00Z",
    taskTotal: 8,
    taskDone: 8,
    milestoneTotal: 3,
    milestoneReached: 3,
    totalMinutes: 1440,
  },
];

const TASKS = [
  { id: "t-1", title: "Do A", status: "done", assigneeEmployeeId: null, dueDate: null, updatedAt: "2026-06-01" },
  { id: "t-2", title: "Do B", status: "todo", assigneeEmployeeId: null, dueDate: null, updatedAt: "2026-06-01" },
  { id: "t-3", title: "Do C", status: "in-progress", assigneeEmployeeId: null, dueDate: null, updatedAt: "2026-06-01" },
];

const MILESTONES = [
  { id: "m-1", title: "Kickoff", dueDate: "2026-06-15", reached: 1, updatedAt: "2026-06-01" },
  { id: "m-2", title: "Mid-point", dueDate: "2026-06-30", reached: 0, updatedAt: "2026-06-01" },
  { id: "m-3", title: "Final", dueDate: "", reached: 0, updatedAt: "2026-06-01" },
];

const DETAIL = {
  ...PROJECTS[0],
  description: "Test",
  createdAt: "2026-01-01T00:00:00Z",
  tasks: TASKS,
  milestones: MILESTONES,
  timeEntryCount: 6,
};

const PREVIEW = {
  projectId: "p-1",
  customerId: "c-1",
  unbilledMinutes: 240,
  unbilledEntries: 4,
  hours: 4,
  hourlyRate: 25000,
  subtotal: 100000,
  vat: 20000,
  total: 120000,
  vatRate: 20,
  currency: "AMD",
};

/* ────────── classifyProjectStatus ────────── */

describe("classifyProjectStatus", () => {
  it("maps known statuses", () => {
    expect(classifyProjectStatus({ status: "planning" })).toBe<ProjectTone>("planning");
    expect(classifyProjectStatus({ status: "active" })).toBe<ProjectTone>("active");
    expect(classifyProjectStatus({ status: "on-hold" })).toBe<ProjectTone>("on-hold");
    expect(classifyProjectStatus({ status: "completed" })).toBe<ProjectTone>("completed");
    expect(classifyProjectStatus({ status: "cancelled" })).toBe<ProjectTone>("cancelled");
  });
  it("falls back to unknown for unrecognized values", () => {
    expect(classifyProjectStatus({ status: "archived" })).toBe<ProjectTone>("unknown");
    expect(classifyProjectStatus({ status: undefined as unknown as string })).toBe<ProjectTone>("unknown");
    expect(classifyProjectStatus(null)).toBe<ProjectTone>("unknown");
  });
});

/* ────────── classifyTaskStatus ────────── */

describe("classifyTaskStatus", () => {
  it("maps known task statuses", () => {
    expect(classifyTaskStatus({ status: "todo" })).toBe<TaskTone>("todo");
    expect(classifyTaskStatus({ status: "in-progress" })).toBe<TaskTone>("in-progress");
    expect(classifyTaskStatus({ status: "done" })).toBe<TaskTone>("done");
  });
  it("falls back to unknown for unrecognized values", () => {
    expect(classifyTaskStatus({ status: "blocked" })).toBe<TaskTone>("unknown");
    expect(classifyTaskStatus({ status: "" })).toBe<TaskTone>("unknown");
    expect(classifyTaskStatus({})).toBe<TaskTone>("unknown");
  });
});

/* ────────── ordering ────────── */

describe("compareProjectsByUpdatedAtDesc", () => {
  it("sorts by updatedAt descending (most recent first)", () => {
    const out = PROJECTS.slice()
      .sort(compareProjectsByUpdatedAtDesc)
      .map((p) => p.id);
    expect(out).toEqual(["p-1", "p-2", "p-3"]);
  });
});

describe("compareTasksByStatusOrder", () => {
  it("sorts tasks in-progress → todo → done", () => {
    const out = TASKS.slice().sort(compareTasksByStatusOrder).map((t) => t.id);
    expect(out).toEqual(["t-3", "t-2", "t-1"]);
  });
});

describe("compareMilestonesByDueDateAsc", () => {
  it("sorts milestones by due date ascending, empty dates last", () => {
    const out = MILESTONES.slice().sort(compareMilestonesByDueDateAsc).map((m) => m.id);
    expect(out).toEqual(["m-1", "m-2", "m-3"]);
  });
});

/* ────────── aggregates ────────── */

describe("projectProgressPct", () => {
  it("returns 50% for 5/10 done", () => {
    expect(projectProgressPct({ taskTotal: 10, taskDone: 5 })).toBe(50);
  });
  it("returns 100% when fully done", () => {
    expect(projectProgressPct({ taskTotal: 8, taskDone: 8 })).toBe(100);
  });
  it("returns 0% when no tasks", () => {
    expect(projectProgressPct({ taskTotal: 0, taskDone: 0 })).toBe(0);
  });
  it("returns 0% when none done", () => {
    expect(projectProgressPct({ taskTotal: 10, taskDone: 0 })).toBe(0);
  });
  it("clamps at 100% when done > total (defensive)", () => {
    expect(projectProgressPct({ taskTotal: 5, taskDone: 7 })).toBe(100);
  });
});

describe("milestoneReachedPct", () => {
  it("returns 50% for 2/4 reached", () => {
    expect(milestoneReachedPct({ milestoneTotal: 4, milestoneReached: 2 })).toBe(50);
  });
  it("returns 0% when no milestones", () => {
    expect(milestoneReachedPct({ milestoneTotal: 0, milestoneReached: 0 })).toBe(0);
  });
});

describe("counters", () => {
  it("totalTaskCount / doneTaskCount", () => {
    expect(totalTaskCount(PROJECTS[0])).toBe(10);
    expect(doneTaskCount(PROJECTS[0])).toBe(5);
  });
  it("totalMilestoneCount / reachedMilestoneCount", () => {
    expect(totalMilestoneCount(PROJECTS[0])).toBe(4);
    expect(reachedMilestoneCount(PROJECTS[0])).toBe(2);
  });
  it("totalMinutes", () => {
    expect(totalMinutes(PROJECTS[0])).toBe(480);
  });
  it("taskCount / milestoneCount / timeEntryCount from detail", () => {
    expect(taskCount(DETAIL)).toBe(3);
    expect(milestoneCount(DETAIL)).toBe(3);
    expect(timeEntryCount(DETAIL)).toBe(6);
  });
  it("returns 0 when arrays are missing", () => {
    expect(taskCount({ tasks: undefined as unknown as never })).toBe(0);
    expect(milestoneCount({ milestones: undefined as unknown as never })).toBe(0);
    expect(timeEntryCount({ timeEntryCount: undefined as unknown as number })).toBe(0);
  });
});

/* ────────── billing ────────── */

describe("billingHoursFromMinutes", () => {
  it("converts 60 minutes → 1 hour", () => {
    expect(billingHoursFromMinutes(60)).toBe(1);
  });
  it("converts 90 minutes → 1.5 hours", () => {
    expect(billingHoursFromMinutes(90)).toBe(1.5);
  });
  it("converts 240 minutes → 4 hours", () => {
    expect(billingHoursFromMinutes(240)).toBe(4);
  });
  it("returns 0 for 0 / negative / NaN", () => {
    expect(billingHoursFromMinutes(0)).toBe(0);
    expect(billingHoursFromMinutes(-5)).toBe(0);
    expect(billingHoursFromMinutes(NaN)).toBe(0);
  });
});

describe("billingGrossAmd", () => {
  it("multiplies hours by hourlyRate (rounded)", () => {
    expect(billingGrossAmd({ hours: 4, hourlyRate: 25_000 })).toBe(100_000);
  });
  it("returns 0 for missing inputs", () => {
    expect(billingGrossAmd({ hours: 0, hourlyRate: 25_000 })).toBe(0);
    expect(billingGrossAmd({ hours: 4, hourlyRate: 0 })).toBe(0);
  });
});

describe("billingVatAmountAmd / billingTotalAmd", () => {
  it("returns the vat and total from the preview", () => {
    expect(billingVatAmountAmd(PREVIEW)).toBe(20_000);
    expect(billingTotalAmd(PREVIEW)).toBe(120_000);
  });
  it("defaults to 0 when missing", () => {
    expect(billingVatAmountAmd({ vat: undefined as unknown as number })).toBe(0);
    expect(billingTotalAmd({ total: undefined as unknown as number })).toBe(0);
  });
});

describe("isProjectBillable", () => {
  it("true when unbilled minutes and rate are positive", () => {
    expect(isProjectBillable({ unbilledMinutes: 60, hourlyRate: 25_000 })).toBe(true);
  });
  it("false when no unbilled minutes", () => {
    expect(isProjectBillable({ unbilledMinutes: 0, hourlyRate: 25_000 })).toBe(false);
  });
  it("false when hourly rate is 0", () => {
    expect(isProjectBillable({ unbilledMinutes: 60, hourlyRate: 0 })).toBe(false);
  });
});

/* ────────── formatting ────────── */

describe("formatProjectDurationHours", () => {
  it("formats 60 minutes as '1 ժ'", () => {
    expect(formatProjectDurationHours(60)).toMatch(/1\s*ժ/);
  });
  it("formats 90 minutes as '1.5 ժ'", () => {
    expect(formatProjectDurationHours(90)).toMatch(/1\.5\s*ժ/);
  });
  it("returns '—' for null/NaN", () => {
    expect(formatProjectDurationHours(null)).toBe("—");
    expect(formatProjectDurationHours(NaN)).toBe("—");
  });
});

describe("formatCurrency (re-exported)", () => {
  it("formats with Armenian digit grouping and ֏ glyph", () => {
    expect(formatCurrency(1_000_000)).toMatch(/1\s*000\s*000/);
  });
  it("returns '—' for null", () => {
    expect(formatCurrency(null)).toBe("—");
  });
});

describe("formatPercent (re-exported)", () => {
  it("appends % to number", () => {
    expect(formatPercent(50)).toBe("50%");
  });
});
