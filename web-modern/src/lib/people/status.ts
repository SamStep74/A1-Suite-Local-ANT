/**
 * Pure helpers for the People workspace.
 *
 * Mirrors the lib/finance/status.ts pattern: no React, no router,
 * no fetch. Just data-in, data-out, designed for unit tests and for
 * reuse by the Mission Control widgets (Phase 2.6+).
 *
 * The People module wraps an employee registry + payroll-run history.
 * The Phase 3 surface is read-mostly (list employees, view their
 * payroll history) with two write actions (create employee, run
 * payroll) that we surface as inline forms. The helpers below add the
 * *display-layer* logic (status tones, payroll totals, month labels)
 * that the route file and the right-rail People action panel both
 * consume.
 */

import type {
  PeopleEmployee,
  PeoplePayrollRun,
} from "../api/schemas";

/* ────────── employment status helpers ────────── */

export type EmploymentTone = "active" | "on-leave" | "terminated" | "unknown";

/** Classify an employee for the status pill + filter tabs.
 *  The server stores the canonical value; we tolerate unknown strings
 *  so legacy seeds and manually-inserted rows don't break the UI. */
export function classifyEmployment(
  employee: Pick<PeopleEmployee, "employmentStatus">,
): EmploymentTone {
  const status = (employee.employmentStatus ?? "").toLowerCase();
  if (status === "active") return "active";
  if (status === "on-leave") return "on-leave";
  if (status === "terminated") return "terminated";
  return "unknown";
}

/** Order employment statuses so the active cohort surfaces first. */
const EMPLOYMENT_ORDER: Record<EmploymentTone, number> = {
  active: 0,
  "on-leave": 1,
  terminated: 2,
  unknown: 3,
};

export function compareEmployeesByStatusThenName(
  a: Pick<PeopleEmployee, "employmentStatus" | "fullName">,
  b: Pick<PeopleEmployee, "employmentStatus" | "fullName">,
): number {
  const aTone = classifyEmployment(a);
  const bTone = classifyEmployment(b);
  const order = EMPLOYMENT_ORDER[aTone] - EMPLOYMENT_ORDER[bTone];
  if (order !== 0) return order;
  return (a.fullName ?? "").localeCompare(b.fullName ?? "");
}

/* ────────── cohort math ────────── */

/** Count employees by tone. Skips unknown tones (they land in
 *  the "Other" bucket of the right rail). */
export function countByEmployment(
  employees: ReadonlyArray<Pick<PeopleEmployee, "employmentStatus">>,
): Record<EmploymentTone, number> {
  const out: Record<EmploymentTone, number> = {
    active: 0,
    "on-leave": 0,
    terminated: 0,
    unknown: 0,
  };
  for (const e of employees) out[classifyEmployment(e)] += 1;
  return out;
}

/** Sum the gross payroll across a list of employees. Skips nulls,
 *  negatives, and non-finite values. */
export function sumGrossSalary(
  employees: ReadonlyArray<Pick<PeopleEmployee, "grossSalary">>,
): number {
  let total = 0;
  for (const e of employees) {
    if (typeof e.grossSalary === "number" && Number.isFinite(e.grossSalary) && e.grossSalary > 0) {
      total += e.grossSalary;
    }
  }
  return total;
}

/* ────────── payroll-run helpers ────────── */

/** Days between the run date and today. Positive = future, negative
 *  = past. Returns null when the run is missing a date. */
export function daysSinceRun(
  run: Pick<PeoplePayrollRun, "runDate">,
  today: Date = new Date(),
): number | null {
  if (!run.runDate) return null;
  const d = new Date(run.runDate);
  if (Number.isNaN(d.valueOf())) return null;
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((today.valueOf() - d.valueOf()) / msPerDay);
}

/** Sum the net pay across a list of payroll runs. */
export function sumPayrollNet(
  runs: ReadonlyArray<Pick<PeoplePayrollRun, "net">>,
): number {
  let total = 0;
  for (const r of runs) {
    if (typeof r.net === "number" && Number.isFinite(r.net)) total += r.net;
  }
  return total;
}

/** Sum the gross across a list of payroll runs. */
export function sumPayrollGross(
  runs: ReadonlyArray<Pick<PeoplePayrollRun, "gross">>,
): number {
  let total = 0;
  for (const r of runs) {
    if (typeof r.gross === "number" && Number.isFinite(r.gross)) total += r.gross;
  }
  return total;
}

/** Sort runs newest first. Stable: equal dates keep their input order. */
export function comparePayrollRunsDesc(
  a: Pick<PeoplePayrollRun, "runDate">,
  b: Pick<PeoplePayrollRun, "runDate">,
): number {
  if (!a.runDate && !b.runDate) return 0;
  if (!a.runDate) return 1;
  if (!b.runDate) return -1;
  return b.runDate.localeCompare(a.runDate);
}

/* ────────── period key helpers (Armenian month label) ────────── */

const AM_MONTHS = [
  "Հունվար", "Փետրվար", "Մարտ", "Ապրիլ", "Մայիս", "Հունիս",
  "Հուլիս", "Օգոստոս", "Սեպտեմբեր", "Հոկտեմբեր", "Նոյեմբեր", "Դեկտեմբեր",
] as const;

/** Convert YYYY-MM period key to a human-readable Armenian label.
 *  e.g. "2026-06" → "Հունիս 2026". Mirrors lib/finance/status.ts. */
export function periodLabel(periodKey: string | null | undefined): string {
  if (!periodKey) return "—";
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) return periodKey;
  const year = m[1];
  const monthIdx = Number(m[2]) - 1;
  if (monthIdx < 0 || monthIdx >= 12) return periodKey;
  return `${AM_MONTHS[monthIdx]} ${year}`;
}

/* ────────── validation helpers ────────── */

/** A simple 8-digit tax-ID check used by the inline create form.
 *  Returns true when the input is empty (optional) or matches the
 *  8-digit Armenian social-security number pattern. */
export function isValidTaxId(taxId: string | null | undefined): boolean {
  if (!taxId) return true;
  return /^\d{8}$/.test(taxId.trim());
}
