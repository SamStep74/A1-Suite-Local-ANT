/**
 * Pure helpers for the Flow (workflow automation) workspace.
 *
 * Source of truth: server/app.js#formatAutomationRule (48830),
 * getAutomationRules (48817), formatAutomationRuleVersion (60661),
 * formatWorkflowApproval (60676), getWorkflowApprovals (54621),
 * formatWorkflowRun (61803), getWorkflowRuns (61766).
 *
 * Helpers are UI-pure: no React, no I/O. They re-implement small
 * derivations the engine already produces (sorting, totals, tone
 * classification) and add UI-specific shaping (Armenian status tone,
 * risk-level colour).
 *
 * Public surface:
 *  - classifyApprovalStatus
 *  - classifyRiskLevel
 *  - classifyRunStatus
 *  - compareApprovalsByRiskThenDateDesc
 *  - compareVersionsByNumberDesc
 *  - compareRunsByStartedAtDesc
 *  - pendingApprovalCount
 *  - failedRunCount
 *  - approvedCount, rejectedCount, executedCount
 *  - ruleEnabledTone
 *  - formatRelativeDate (lightweight — no date-fns)
 */
import type {
  AutomationRule,
  AutomationRuleVersion,
  WorkflowApproval,
  WorkflowRun,
} from "../api/schemas";

/* ────────── types ────────── */

export type ApprovalTone = "pending" | "approved" | "rejected" | "executed" | "unknown";

export type RiskTone = "legal" | "financial" | "operational" | "unknown";

export type RunTone = "running" | "succeeded" | "failed" | "cancelled" | "unknown";

export type RuleEnabledTone = "enabled" | "disabled" | "unknown";

/* ────────── approval classification ────────── */

const APPROVAL_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "approved",
  "rejected",
  "executed",
]);

export function classifyApprovalStatus(
  approval: { status?: string | null } | null | undefined,
): ApprovalTone {
  const s = (approval?.status ?? "").toString().toLowerCase();
  if (APPROVAL_STATUSES.has(s)) return s as ApprovalTone;
  return "unknown";
}

const RISK_LEVELS: ReadonlySet<string> = new Set([
  "legal",
  "financial",
  "operational",
]);

export function classifyRiskLevel(
  approval: { riskLevel?: string | null } | null | undefined,
): RiskTone {
  const r = (approval?.riskLevel ?? "").toString().toLowerCase();
  if (RISK_LEVELS.has(r)) return r as RiskTone;
  return "unknown";
}

const RUN_STATUSES: ReadonlySet<string> = new Set([
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export function classifyRunStatus(
  run: { status?: string | null } | null | undefined,
): RunTone {
  const s = (run?.status ?? "").toString().toLowerCase();
  if (RUN_STATUSES.has(s)) return s as RunTone;
  return "unknown";
}

/* ────────── ordering ────────── */

const RISK_RANK: Record<string, number> = {
  legal: 1,
  financial: 2,
  operational: 3,
};

export function compareApprovalsByRiskThenDateDesc(
  a: Pick<WorkflowApproval, "riskLevel" | "createdAt">,
  b: Pick<WorkflowApproval, "riskLevel" | "createdAt">,
): number {
  const ra = RISK_RANK[(a.riskLevel ?? "").toString().toLowerCase()] ?? 99;
  const rb = RISK_RANK[(b.riskLevel ?? "").toString().toLowerCase()] ?? 99;
  if (ra !== rb) return ra - rb;
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}

export function compareVersionsByNumberDesc(
  a: Pick<AutomationRuleVersion, "versionNumber">,
  b: Pick<AutomationRuleVersion, "versionNumber">,
): number {
  return (b.versionNumber ?? 0) - (a.versionNumber ?? 0);
}

export function compareRulesByNameAsc(
  a: Pick<AutomationRule, "name">,
  b: Pick<AutomationRule, "name">,
): number {
  return (a.name ?? "").localeCompare(b.name ?? "");
}

export function compareRunsByStartedAtDesc(
  a: Pick<WorkflowRun, "startedAt">,
  b: Pick<WorkflowRun, "startedAt">,
): number {
  return (b.startedAt ?? "").localeCompare(a.startedAt ?? "");
}

/* ────────── counts ────────── */

export function pendingApprovalCount(
  approvals: ReadonlyArray<Pick<WorkflowApproval, "status">>,
): number {
  return approvals.filter((a) => (a.status ?? "").toString().toLowerCase() === "pending")
    .length;
}

export function approvedCount(
  approvals: ReadonlyArray<Pick<WorkflowApproval, "status">>,
): number {
  return approvals.filter((a) => (a.status ?? "").toString().toLowerCase() === "approved")
    .length;
}

export function rejectedCount(
  approvals: ReadonlyArray<Pick<WorkflowApproval, "status">>,
): number {
  return approvals.filter((a) => (a.status ?? "").toString().toLowerCase() === "rejected")
    .length;
}

export function executedCount(
  approvals: ReadonlyArray<Pick<WorkflowApproval, "status">>,
): number {
  return approvals.filter((a) => (a.status ?? "").toString().toLowerCase() === "executed")
    .length;
}

export function failedRunCount(
  runs: ReadonlyArray<{ status?: string | null }>,
): number {
  return runs.filter((r) => (r.status ?? "").toString().toLowerCase() === "failed").length;
}

export function succeededRunCount(
  runs: ReadonlyArray<{ status?: string | null }>,
): number {
  return runs.filter((r) => (r.status ?? "").toString().toLowerCase() === "succeeded")
    .length;
}

export function enabledRuleCount(
  rules: ReadonlyArray<Pick<AutomationRule, "enabled">>,
): number {
  return rules.filter((r) => r.enabled === true).length;
}

export function approvalRequiredRuleCount(
  rules: ReadonlyArray<Pick<AutomationRule, "approvalRequired">>,
): number {
  return rules.filter((r) => r.approvalRequired === true).length;
}

/* ────────── rule enabled tone ────────── */

export function ruleEnabledTone(
  rule: { enabled?: boolean | null } | null | undefined,
): RuleEnabledTone {
  if (rule == null) return "unknown";
  if (rule.enabled === true) return "enabled";
  if (rule.enabled === false) return "disabled";
  return "unknown";
}

/* ────────── formatting ────────── */

/**
 * Lightweight relative-time formatter: "just now", "5m ago", "3h ago",
 * "2d ago", or an ISO date for anything older than 7 days. We avoid
 * date-fns to keep the helper tree-shakable.
 */
export function formatRelativeDate(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return d.toISOString().slice(0, 10);
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 45) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toISOString().slice(0, 10);
}

export function formatRiskLabel(risk: string | null | undefined): string {
  const r = (risk ?? "").toString().toLowerCase();
  if (r === "legal") return "Legal";
  if (r === "financial") return "Financial";
  if (r === "operational") return "Operational";
  return "Unknown";
}

export function formatStatusLabel(status: string | null | undefined): string {
  const s = (status ?? "").toString().toLowerCase();
  if (!s) return "Unknown";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
