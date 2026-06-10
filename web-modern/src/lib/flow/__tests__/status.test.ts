/**
 * status.test.ts — unit tests for the Flow (workflow automation) pure helpers.
 *
 * Mirrors web-modern/src/lib/cfo/__tests__/status.test.ts pattern.
 */
import { describe, it, expect } from "vitest";
import {
  classifyApprovalStatus,
  classifyRiskLevel,
  classifyRunStatus,
  compareApprovalsByRiskThenDateDesc,
  compareVersionsByNumberDesc,
  compareRulesByNameAsc,
  compareRunsByStartedAtDesc,
  pendingApprovalCount,
  approvedCount,
  rejectedCount,
  executedCount,
  failedRunCount,
  succeededRunCount,
  enabledRuleCount,
  approvalRequiredRuleCount,
  ruleEnabledTone,
  formatRelativeDate,
  formatRiskLabel,
  formatStatusLabel,
  type ApprovalTone,
  type RiskTone,
  type RunTone,
  type RuleEnabledTone,
} from "../status";

/* ────────── fixtures ────────── */

const APPROVALS = [
  { id: "ap-1", riskLevel: "legal", createdAt: "2026-06-10T08:00:00Z", status: "pending" },
  { id: "ap-2", riskLevel: "financial", createdAt: "2026-06-10T09:00:00Z", status: "pending" },
  { id: "ap-3", riskLevel: "operational", createdAt: "2026-06-10T07:00:00Z", status: "approved" },
  { id: "ap-4", riskLevel: "legal", createdAt: "2026-06-09T08:00:00Z", status: "executed" },
  { id: "ap-5", riskLevel: "legal", createdAt: "2026-06-08T08:00:00Z", status: "rejected" },
];

const VERSIONS = [
  { id: "v1", versionNumber: 1 },
  { id: "v3", versionNumber: 3 },
  { id: "v2", versionNumber: 2 },
];

const RULES = [
  { id: "r1", name: "Auto invoice" },
  { id: "r3", name: "Lead nurture" },
  { id: "r2", name: "Onboarding" },
];

const RUNS = [
  { id: "rn-1", startedAt: "2026-06-10T10:00:00Z", status: "succeeded" },
  { id: "rn-2", startedAt: "2026-06-10T11:00:00Z", status: "failed" },
  { id: "rn-3", startedAt: "2026-06-09T10:00:00Z", status: "succeeded" },
  { id: "rn-4", startedAt: "2026-06-08T10:00:00Z", status: "running" },
];

/* ────────── classifyApprovalStatus ────────── */

describe("classifyApprovalStatus", () => {
  it("maps known statuses", () => {
    expect(classifyApprovalStatus({ status: "pending" })).toBe<ApprovalTone>("pending");
    expect(classifyApprovalStatus({ status: "approved" })).toBe<ApprovalTone>("approved");
    expect(classifyApprovalStatus({ status: "rejected" })).toBe<ApprovalTone>("rejected");
    expect(classifyApprovalStatus({ status: "executed" })).toBe<ApprovalTone>("executed");
  });
  it("falls back to unknown for unrecognized values", () => {
    expect(classifyApprovalStatus({ status: "garbage" })).toBe<ApprovalTone>("unknown");
    expect(classifyApprovalStatus({})).toBe<ApprovalTone>("unknown");
    expect(classifyApprovalStatus(null)).toBe<ApprovalTone>("unknown");
  });
});

/* ────────── classifyRiskLevel ────────── */

describe("classifyRiskLevel", () => {
  it("maps known risk levels", () => {
    expect(classifyRiskLevel({ riskLevel: "legal" })).toBe<RiskTone>("legal");
    expect(classifyRiskLevel({ riskLevel: "financial" })).toBe<RiskTone>("financial");
    expect(classifyRiskLevel({ riskLevel: "operational" })).toBe<RiskTone>("operational");
  });
  it("falls back to unknown", () => {
    expect(classifyRiskLevel({ riskLevel: "low" })).toBe<RiskTone>("unknown");
    expect(classifyRiskLevel({})).toBe<RiskTone>("unknown");
    expect(classifyRiskLevel(null)).toBe<RiskTone>("unknown");
  });
});

/* ────────── classifyRunStatus ────────── */

describe("classifyRunStatus", () => {
  it("maps known run statuses", () => {
    expect(classifyRunStatus({ status: "running" })).toBe<RunTone>("running");
    expect(classifyRunStatus({ status: "succeeded" })).toBe<RunTone>("succeeded");
    expect(classifyRunStatus({ status: "failed" })).toBe<RunTone>("failed");
    expect(classifyRunStatus({ status: "cancelled" })).toBe<RunTone>("cancelled");
  });
  it("falls back to unknown", () => {
    expect(classifyRunStatus({ status: "in-progress" })).toBe<RunTone>("unknown");
    expect(classifyRunStatus({})).toBe<RunTone>("unknown");
  });
});

/* ────────── ordering ────────── */

describe("compareApprovalsByRiskThenDateDesc", () => {
  it("sorts by risk rank (legal → financial → operational), then createdAt desc", () => {
    const out = APPROVALS.slice().sort(compareApprovalsByRiskThenDateDesc).map((a) => a.id);
    // legal first (ap-1 06-10 > ap-4 06-09 > ap-5 06-08), then financial (ap-2), then operational (ap-3)
    expect(out).toEqual(["ap-1", "ap-4", "ap-5", "ap-2", "ap-3"]);
  });
});

describe("compareVersionsByNumberDesc", () => {
  it("sorts versions by versionNumber descending", () => {
    const out = VERSIONS.slice().sort(compareVersionsByNumberDesc).map((v) => v.id);
    expect(out).toEqual(["v3", "v2", "v1"]);
  });
});

describe("compareRulesByNameAsc", () => {
  it("sorts rules by name ascending", () => {
    const out = RULES.slice().sort(compareRulesByNameAsc).map((r) => r.id);
    expect(out).toEqual(["r1", "r3", "r2"]);
  });
});

describe("compareRunsByStartedAtDesc", () => {
  it("sorts runs by startedAt descending", () => {
    const out = RUNS.slice().sort(compareRunsByStartedAtDesc).map((r) => r.id);
    expect(out).toEqual(["rn-2", "rn-1", "rn-3", "rn-4"]);
  });
});

/* ────────── counts ────────── */

describe("approval counts", () => {
  it("counts pending, approved, rejected, executed", () => {
    expect(pendingApprovalCount(APPROVALS)).toBe(2);
    expect(approvedCount(APPROVALS)).toBe(1);
    expect(rejectedCount(APPROVALS)).toBe(1);
    expect(executedCount(APPROVALS)).toBe(1);
  });
  it("returns 0 for empty", () => {
    expect(pendingApprovalCount([])).toBe(0);
    expect(approvedCount([])).toBe(0);
  });
});

describe("run counts", () => {
  it("counts failed and succeeded", () => {
    expect(failedRunCount(RUNS)).toBe(1);
    expect(succeededRunCount(RUNS)).toBe(2);
  });
  it("returns 0 for empty", () => {
    expect(failedRunCount([])).toBe(0);
    expect(succeededRunCount([])).toBe(0);
  });
});

describe("rule counts", () => {
  it("counts enabled rules", () => {
    const rules = [
      { id: "r1", enabled: true },
      { id: "r2", enabled: false },
      { id: "r3", enabled: true },
    ];
    expect(enabledRuleCount(rules)).toBe(2);
  });
  it("counts approval-required rules", () => {
    const rules = [
      { id: "r1", approvalRequired: true },
      { id: "r2", approvalRequired: false },
      { id: "r3", approvalRequired: true },
    ];
    expect(approvalRequiredRuleCount(rules)).toBe(2);
  });
  it("returns 0 for empty", () => {
    expect(enabledRuleCount([])).toBe(0);
    expect(approvalRequiredRuleCount([])).toBe(0);
  });
});

/* ────────── ruleEnabledTone ────────── */

describe("ruleEnabledTone", () => {
  it("returns enabled / disabled / unknown", () => {
    expect(ruleEnabledTone({ enabled: true })).toBe<RuleEnabledTone>("enabled");
    expect(ruleEnabledTone({ enabled: false })).toBe<RuleEnabledTone>("disabled");
    expect(ruleEnabledTone({ enabled: null })).toBe<RuleEnabledTone>("unknown");
    expect(ruleEnabledTone({})).toBe<RuleEnabledTone>("unknown");
    expect(ruleEnabledTone(null)).toBe<RuleEnabledTone>("unknown");
  });
});

/* ────────── formatting ────────── */

describe("formatRelativeDate", () => {
  const NOW = new Date("2026-06-10T12:00:00Z");
  it("returns 'just now' for < 45s", () => {
    expect(formatRelativeDate("2026-06-10T11:59:30Z", NOW)).toBe("just now");
  });
  it("returns Nm ago for < 60m", () => {
    expect(formatRelativeDate("2026-06-10T11:55:00Z", NOW)).toBe("5m ago");
  });
  it("returns Nh ago for < 24h", () => {
    expect(formatRelativeDate("2026-06-10T09:00:00Z", NOW)).toBe("3h ago");
  });
  it("returns Nd ago for < 7d", () => {
    expect(formatRelativeDate("2026-06-08T12:00:00Z", NOW)).toBe("2d ago");
  });
  it("returns ISO date for older than 7d", () => {
    expect(formatRelativeDate("2026-01-15T12:00:00Z", NOW)).toBe("2026-01-15");
  });
  it("returns — for null/empty/invalid", () => {
    expect(formatRelativeDate(null, NOW)).toBe("—");
    expect(formatRelativeDate("", NOW)).toBe("—");
    expect(formatRelativeDate("not a date", NOW)).toBe("—");
  });
});

describe("formatRiskLabel", () => {
  it("capitalizes known risk levels", () => {
    expect(formatRiskLabel("legal")).toBe("Legal");
    expect(formatRiskLabel("financial")).toBe("Financial");
    expect(formatRiskLabel("operational")).toBe("Operational");
  });
  it("returns 'Unknown' for unrecognized / null", () => {
    expect(formatRiskLabel("low")).toBe("Unknown");
    expect(formatRiskLabel(null)).toBe("Unknown");
    expect(formatRiskLabel("")).toBe("Unknown");
  });
});

describe("formatStatusLabel", () => {
  it("capitalizes the first letter", () => {
    expect(formatStatusLabel("pending")).toBe("Pending");
    expect(formatStatusLabel("approved")).toBe("Approved");
    expect(formatStatusLabel("succeeded")).toBe("Succeeded");
  });
  it("returns 'Unknown' for empty / null", () => {
    expect(formatStatusLabel("")).toBe("Unknown");
    expect(formatStatusLabel(null)).toBe("Unknown");
  });
});
