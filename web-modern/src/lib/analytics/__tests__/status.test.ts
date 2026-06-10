/**
 * status.test.ts — unit tests for the Analytics pure helpers.
 *
 * Mirrors web-modern/src/lib/cfo/__tests__/status.test.ts pattern.
 */
import { describe, it, expect } from "vitest";
import {
  classifyMetricUnit,
  classifyMetricTone,
  classifyReportType,
  classifyRolePermission,
  classifyDrilldownRecord,
  compareMetricsByValueDesc,
  compareSnapshotsByReportDateAsc,
  compareSeriesByPointCountDesc,
  compareReportsByCreatedAtDesc,
  compareBucketsByTotalDesc,
  overdueRatioPct,
  invoiceOverdueRatioPct,
  customerOverdueRatioPct,
  topMetric,
  seriesLatestPoint,
  seriesValueRange,
  seriesTrendDirection,
  formatCurrency,
  formatPercent,
  type MetricUnitClass,
  type MetricTone,
  type ReportTypeClass,
  type RolePermissionClass,
  type TrendDirection,
} from "../status";

/* ────────── fixtures ────────── */

const METRICS = [
  {
    id: "pipeline-value",
    label: "Tube value",
    value: 1_000_000,
    unit: "AMD",
    sourceApps: ["Armosphera CRM"],
    recordCount: 12,
  },
  {
    id: "campaign-roi",
    label: "Campaign ROI",
    value: 35,
    unit: "percent",
    sourceApps: ["Campaigns"],
    recordCount: 4,
  },
  {
    id: "overdue-exposure",
    label: "Overdue exposure",
    value: 250_000,
    unit: "AMD",
    sourceApps: ["HayHashvapah Finance"],
    recordCount: 3,
  },
  {
    id: "ticket-backlog",
    label: "Ticket backlog",
    value: 0,
    unit: "count",
    sourceApps: ["Armosphera Desk"],
    recordCount: 0,
  },
];

const SUMMARY = {
  totalOpen: 1_000_000,
  overdue: 250_000,
  current: 750_000,
  invoiceCount: 10,
  overdueInvoiceCount: 3,
  customerCount: 5,
};

const BUCKETS = [
  { key: "current", label: "Current", total: 750_000, invoiceCount: 7, customerCount: 3 },
  { key: "0-30", label: "0-30", total: 150_000, invoiceCount: 2, customerCount: 2 },
  { key: "31-60", label: "31-60", total: 100_000, invoiceCount: 1, customerCount: 1 },
];

const SERIES = {
  metricId: "pipeline-value",
  label: "Tube value",
  unit: "AMD",
  sourceApps: ["Armosphera CRM"],
  points: [
    { reportDate: "2026-01-01", value: 800_000, recordCount: 10, capturedAt: "2026-01-02T00:00:00Z" },
    { reportDate: "2026-02-01", value: 900_000, recordCount: 11, capturedAt: "2026-02-02T00:00:00Z" },
    { reportDate: "2026-03-01", value: 1_000_000, recordCount: 12, capturedAt: "2026-03-02T00:00:00Z" },
  ],
};

const REPORTS = [
  { id: "r-1", reportType: "owner", createdAt: "2026-06-09T10:00:00Z" },
  { id: "r-2", reportType: "accountant", createdAt: "2026-06-08T10:00:00Z" },
];

/* ────────── classifyMetricUnit ────────── */

describe("classifyMetricUnit", () => {
  it("maps currency codes", () => {
    expect(classifyMetricUnit({ unit: "AMD" })).toBe<MetricUnitClass>("currency");
    expect(classifyMetricUnit({ unit: "USD" })).toBe<MetricUnitClass>("currency");
    expect(classifyMetricUnit({ unit: "EUR" })).toBe<MetricUnitClass>("currency");
  });
  it("maps percent", () => {
    expect(classifyMetricUnit({ unit: "percent" })).toBe<MetricUnitClass>("percent");
  });
  it("maps count / status-count", () => {
    expect(classifyMetricUnit({ unit: "count" })).toBe<MetricUnitClass>("count");
    expect(classifyMetricUnit({ unit: "status-count" })).toBe<MetricUnitClass>("status-count");
  });
  it("falls back to unknown", () => {
    expect(classifyMetricUnit({ unit: "frob" })).toBe<MetricUnitClass>("unknown");
    expect(classifyMetricUnit({ unit: "" })).toBe<MetricUnitClass>("unknown");
    expect(classifyMetricUnit(null)).toBe<MetricUnitClass>("unknown");
  });
});

/* ────────── classifyMetricTone ────────── */

describe("classifyMetricTone", () => {
  it("returns 'critical' for overdue-exposure with value > 0", () => {
    expect(
      classifyMetricTone({ id: "overdue-exposure", value: 250_000, unit: "AMD" }),
    ).toBe<MetricTone>("critical");
  });
  it("returns 'positive' for overdue-exposure with value 0", () => {
    expect(
      classifyMetricTone({ id: "overdue-exposure", value: 0, unit: "AMD" }),
    ).toBe<MetricTone>("positive");
  });
  it("returns 'critical' for sla-risk / ticket-backlog with value > 0", () => {
    expect(classifyMetricTone({ id: "sla-risk", value: 5, unit: "count" })).toBe<MetricTone>("critical");
    expect(classifyMetricTone({ id: "ticket-backlog", value: 1, unit: "count" })).toBe<MetricTone>("critical");
  });
  it("returns 'positive' for sla-risk / ticket-backlog with value 0", () => {
    expect(classifyMetricTone({ id: "sla-risk", value: 0, unit: "count" })).toBe<MetricTone>("positive");
  });
  it("returns 'positive' for pipeline / forecast / receivables with value > 0", () => {
    expect(classifyMetricTone({ id: "pipeline-value", value: 1_000_000, unit: "AMD" })).toBe<MetricTone>("positive");
    expect(classifyMetricTone({ id: "forecast-weighted", value: 500_000, unit: "AMD" })).toBe<MetricTone>("positive");
  });
  it("returns 'warning' for pipeline / forecast with value < 0", () => {
    expect(classifyMetricTone({ id: "pipeline-value", value: -1, unit: "AMD" })).toBe<MetricTone>("warning");
  });
  it("returns 'positive' for roi / readiness", () => {
    expect(classifyMetricTone({ id: "campaign-roi", value: 35, unit: "percent" })).toBe<MetricTone>("positive");
  });
  it("returns 'neutral' for unknown metric id", () => {
    expect(classifyMetricTone({ id: "mystery", value: 10, unit: "count" })).toBe<MetricTone>("neutral");
  });
  it("returns 'unknown' for null or non-finite value", () => {
    expect(classifyMetricTone(null)).toBe<MetricTone>("unknown");
    expect(classifyMetricTone({ id: "x", value: NaN, unit: "AMD" })).toBe<MetricTone>("unknown");
  });
});

/* ────────── classifyReportType ────────── */

describe("classifyReportType", () => {
  it("maps owner / accountant", () => {
    expect(classifyReportType({ reportType: "owner" })).toBe<ReportTypeClass>("owner");
    expect(classifyReportType({ reportType: "accountant" })).toBe<ReportTypeClass>("accountant");
  });
  it("maps other / unknown", () => {
    expect(classifyReportType({ reportType: "auditor" })).toBe<ReportTypeClass>("other");
    expect(classifyReportType({ reportType: "" })).toBe<ReportTypeClass>("unknown");
    expect(classifyReportType({})).toBe<ReportTypeClass>("unknown");
  });
});

/* ────────── classifyRolePermission ────────── */

describe("classifyRolePermission", () => {
  it("captures when canCaptureSnapshots", () => {
    expect(
      classifyRolePermission({ permissions: { canCaptureSnapshots: true } }),
    ).toBe<RolePermissionClass>("captures");
  });
  it("owner when canCreateOwnerReport", () => {
    expect(
      classifyRolePermission({
        permissions: { canCreateOwnerReport: true, canCaptureSnapshots: false },
      }),
    ).toBe<RolePermissionClass>("owner");
  });
  it("accountant when canCreateAccountantReport", () => {
    expect(
      classifyRolePermission({
        permissions: { canCreateAccountantReport: true },
      }),
    ).toBe<RolePermissionClass>("accountant");
  });
  it("none when no permissions", () => {
    expect(classifyRolePermission({ permissions: {} })).toBe<RolePermissionClass>("none");
    expect(classifyRolePermission(null)).toBe<RolePermissionClass>("none");
  });
});

/* ────────── classifyDrilldownRecord ────────── */

describe("classifyDrilldownRecord", () => {
  it("returns 'positive' for closed/paid/done/resolved status", () => {
    expect(classifyDrilldownRecord({ status: "closed" })).toBe("positive");
    expect(classifyDrilldownRecord({ status: "paid" })).toBe("positive");
    expect(classifyDrilldownRecord({ status: "done" })).toBe("positive");
    expect(classifyDrilldownRecord({ status: "resolved" })).toBe("positive");
  });
  it("returns 'critical' for overdue / breach / at-risk", () => {
    expect(classifyDrilldownRecord({ status: "overdue" })).toBe("critical");
    expect(classifyDrilldownRecord({ status: "SLA-breach" })).toBe("critical");
    expect(classifyDrilldownRecord({ status: "at-risk" })).toBe("critical");
  });
  it("returns 'critical' when overdueDays > 0", () => {
    expect(classifyDrilldownRecord({ overdueDays: 5 })).toBe("critical");
    expect(classifyDrilldownRecord({ daysOverdue: 1 })).toBe("critical");
  });
  it("returns 'neutral' for open / pending / active", () => {
    expect(classifyDrilldownRecord({ status: "open" })).toBe("neutral");
    expect(classifyDrilldownRecord({ status: "pending" })).toBe("neutral");
    expect(classifyDrilldownRecord({ status: "active" })).toBe("neutral");
  });
  it("returns 'unknown' for null and 'neutral' for empty record", () => {
    expect(classifyDrilldownRecord(null)).toBe("unknown");
    expect(classifyDrilldownRecord({})).toBe("neutral");
  });
});

/* ────────── ordering ────────── */

describe("compareMetricsByValueDesc", () => {
  it("sorts by |value| desc", () => {
    const out = METRICS.slice().sort(compareMetricsByValueDesc).map((m) => m.id);
    // |pipeline|=1M, |overdue|=250k, |roi|=35, |backlog|=0
    expect(out).toEqual(["pipeline-value", "overdue-exposure", "campaign-roi", "ticket-backlog"]);
  });
});

describe("compareSnapshotsByReportDateAsc", () => {
  it("sorts by reportDate ascending", () => {
    const pts = SERIES.points.slice().reverse();
    const out = pts.slice().sort(compareSnapshotsByReportDateAsc).map((p) => p.reportDate);
    expect(out).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });
});

describe("compareSeriesByPointCountDesc", () => {
  it("sorts series by point count desc", () => {
    const series = [
      { metricId: "a", points: [{}] as Array<{ reportDate: string; value: number }> },
      { metricId: "b", points: [{}, {}, {}] as Array<{ reportDate: string; value: number }> },
      { metricId: "c", points: [] as Array<{ reportDate: string; value: number }> },
    ];
    const out = series.slice().sort(compareSeriesByPointCountDesc).map((s) => s.metricId);
    expect(out).toEqual(["b", "a", "c"]);
  });
});

describe("compareReportsByCreatedAtDesc", () => {
  it("sorts by createdAt desc (most recent first)", () => {
    const out = REPORTS.slice().sort(compareReportsByCreatedAtDesc).map((r) => r.id);
    expect(out).toEqual(["r-1", "r-2"]);
  });
});

describe("compareBucketsByTotalDesc", () => {
  it("sorts by |total| desc", () => {
    const out = BUCKETS.slice().sort(compareBucketsByTotalDesc).map((b) => b.key);
    expect(out).toEqual(["current", "0-30", "31-60"]);
  });
});

/* ────────── aggregates ────────── */

describe("overdueRatioPct", () => {
  it("250/1000 = 25%", () => {
    expect(overdueRatioPct(SUMMARY)).toBe(25);
  });
  it("returns 0 when total is 0", () => {
    expect(overdueRatioPct({ overdue: 0, totalOpen: 0 })).toBe(0);
  });
  it("returns 0 when no overdue", () => {
    expect(overdueRatioPct({ overdue: 0, totalOpen: 1000 })).toBe(0);
  });
  it("clamps to 100% when overdue > total", () => {
    expect(overdueRatioPct({ overdue: 2000, totalOpen: 1000 })).toBe(100);
  });
});

describe("invoiceOverdueRatioPct", () => {
  it("3/10 = 30%", () => {
    expect(invoiceOverdueRatioPct(SUMMARY)).toBe(30);
  });
  it("returns 0 when invoiceCount is 0", () => {
    expect(
      invoiceOverdueRatioPct({ overdueInvoiceCount: 0, invoiceCount: 0 }),
    ).toBe(0);
  });
});

describe("customerOverdueRatioPct", () => {
  it("sums non-current customer counts and divides by total", () => {
    // 0-30: 2, 31-60: 1 = 3 / 5 = 60%
    expect(customerOverdueRatioPct(SUMMARY, BUCKETS)).toBe(60);
  });
  it("returns 0 when total customers is 0", () => {
    expect(
      customerOverdueRatioPct({ customerCount: 0 }, BUCKETS),
    ).toBe(0);
  });
});

/* ────────── topMetric ────────── */

describe("topMetric", () => {
  it("returns the highest-|value| metric", () => {
    expect(topMetric(METRICS)?.id).toBe("pipeline-value");
  });
  it("returns null for empty", () => {
    expect(topMetric([])).toBeNull();
  });
});

/* ────────── series helpers ────────── */

describe("seriesLatestPoint", () => {
  it("returns the most-recent point", () => {
    const p = seriesLatestPoint(SERIES);
    expect(p?.reportDate).toBe("2026-03-01");
  });
  it("returns null for empty points", () => {
    expect(seriesLatestPoint({ points: [] })).toBeNull();
  });
});

describe("seriesValueRange", () => {
  it("computes min and max over the points", () => {
    expect(seriesValueRange(SERIES)).toEqual({ min: 800_000, max: 1_000_000 });
  });
  it("returns 0/0 for empty", () => {
    expect(seriesValueRange({ points: [] })).toEqual({ min: 0, max: 0 });
  });
});

describe("seriesTrendDirection", () => {
  it("returns 'up' when last > first", () => {
    expect(seriesTrendDirection(SERIES)).toBe<TrendDirection>("up");
  });
  it("returns 'down' when last < first", () => {
    const down = {
      ...SERIES,
      points: [
        { reportDate: "2026-01-01", value: 1000 },
        { reportDate: "2026-02-01", value: 500 },
      ],
    };
    expect(seriesTrendDirection(down)).toBe<TrendDirection>("down");
  });
  it("returns 'flat' when last = first", () => {
    const flat = {
      ...SERIES,
      points: [
        { reportDate: "2026-01-01", value: 500 },
        { reportDate: "2026-02-01", value: 500 },
      ],
    };
    expect(seriesTrendDirection(flat)).toBe<TrendDirection>("flat");
  });
  it("returns 'unknown' for fewer than 2 points", () => {
    expect(seriesTrendDirection({ points: [] })).toBe<TrendDirection>("unknown");
    expect(
      seriesTrendDirection({
        points: [{ reportDate: "2026-01-01", value: 1 }],
      }),
    ).toBe<TrendDirection>("unknown");
  });
});

/* ────────── format re-exports ────────── */

describe("formatCurrency (re-exported)", () => {
  it("formats with Armenian digit grouping", () => {
    expect(formatCurrency(1_000_000)).toMatch(/1\s*000\s*000/);
  });
  it("returns '—' for null", () => {
    expect(formatCurrency(null)).toBe("—");
  });
});

describe("formatPercent (re-exported)", () => {
  it("appends % to number", () => {
    expect(formatPercent(35)).toBe("35%");
  });
});
