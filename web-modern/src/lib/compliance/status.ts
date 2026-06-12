/**
 * Pure helpers for the Production Readiness co-panel (Phase 8.10).
 *
 * Source of truth:
 *   - server/app.js (lines 49570-49686) — getProductionReadiness +
 *     build*ReadinessGates. Wire contract for the readiness object.
 *   - server/app.js (line 9016) — requireProductionReadinessReader
 *     defines the 5-role read gate (Owner, Admin, Accountant, Lawyer,
 *     Auditor).
 *   - web/src/compliance.jsx — the 49-line legacy component we are
 *     porting (kept in sync until the legacy-drop step lands in
 *     Worker 2). Its `pct(value)` helper is mirrored as
 *     `formatProductionRate`.
 *   - .orchestration/phase8-compliance/plan.md
 *
 * These helpers are UI-pure: no React, no fetch, no router, no I/O.
 * They re-derive the panel's affordances (rate formatting, status
 * pill, gate-row badges, the meta-row copy, the 5-role read gate)
 * and shape server data for rendering. Tested in isolation under
 * jsdom (see __tests__/status.test.ts).
 *
 * Public surface:
 *  - formatProductionRate            → "12.34%" or "—"
 *  - isProductionReady               → status === "ready"
 *  - hasProductionBlockers           → blockers.length > 0
 *  - formatProductionStatusLabel     → en copy for the status pill
 *  - formatProductionStatusBadgeClass→ "ok" | "risk" for the pill
 *  - formatProductionPassBadge       → "pass" | "review" for gate rows
 *  - formatProductionEffectiveDate   → date or "առանց ամսաթվի"
 *  - formatProductionReviewFlag      → meta-row copy
 *  - canReadProductionReadiness      → 5-role gate
 */
import type {
  ProductionReadinessReadiness,
  ProductionReadinessStatus,
} from "../api/schemas";

/* ────────── type re-exports (UI narrowing) ────────── */

export type {
  ProductionReadinessReadiness,
  ProductionReadinessStatus,
};

/* ────────── rate formatter (mirrors legacy pct()) ────────── */

/**
 * Render a gate rate (a 0..1 fraction) as a percent string, e.g.
 * `0.1234 → "12.34%"`. Returns the em-dash `"—"` for null/undefined
 * so the gate row can render the same placeholder for both
 * "rate is null" (legal-source gates) and "rate is missing"
 * (defensive against malformed runtime data).
 *
 * The rounding matches the legacy `pct()` function in
 * `web/src/compliance.jsx` line 3 verbatim:
 *   `${Math.round(value * 10000) / 100}%`
 * so the modern co-panel renders the exact same string the legacy
 * panel did for any given numeric input. Changing the rounding
 * here would change what the operator sees on screen.
 */
export function formatProductionRate(
  rate: number | null | undefined,
): string {
  if (typeof rate !== "number") return "—";
  return `${Math.round(rate * 10000) / 100}%`;
}

/* ────────── predicates ────────── */

/**
 * Is the readiness payload in the "ready" state? Operates on a
 * structural minimum (`{ status: string }`) so the helper stays
 * usable even before the Zod parse — the route can defer parse
 * to the network boundary and still use this for the banner.
 */
export function isProductionReady(
  readiness: { status: string } | null | undefined,
): boolean {
  if (readiness === null || readiness === undefined) return false;
  return readiness.status === "ready";
}

/**
 * Does the readiness payload currently have any blockers? A
 * zero-blocker payload is still "ready" (see isProductionReady);
 * this helper exposes the underlying array length so the UI can
 * decide whether to render the Armenian banner ("Արտադրական
 * օգտագործումը արգելափակված է …").
 *
 * Defensive: accepts nullish input and treats a missing blockers
 * array as "no blockers" so a partial payload never trips the
 * banner into a render loop.
 */
export function hasProductionBlockers(
  readiness: { blockers: ReadonlyArray<unknown> } | null | undefined,
): boolean {
  if (readiness === null || readiness === undefined) return false;
  return readiness.blockers.length > 0;
}

/* ────────── pill labels & classes ────────── */

/**
 * English label for the top-of-panel status pill. Matches the
 * legacy ternary in `web/src/compliance.jsx` line 18.
 */
export function formatProductionStatusLabel(
  status: ProductionReadinessStatus,
): "Ready" | "Blocked" {
  return status === "ready" ? "Ready" : "Blocked";
}

/**
 * Tailwind-ish class for the status pill tone. `"ok"` for ready,
 * `"risk"` for blocked — the legacy uses `aging-badge ok|risk`,
 * and the modern tokens reuse the same names. We narrow the
 * return type to the two valid string-literal values so callers
 * get a compile error if the enum ever grows.
 */
export function formatProductionStatusBadgeClass(
  status: ProductionReadinessStatus,
): "ok" | "risk" {
  return status === "ready" ? "ok" : "risk";
}

/**
 * Per-gate-row badge: `"pass"` if the gate passed its review
 * (legal-source accepted, tax/payroll rate configured) and
 * `"review"` otherwise. Matches `web/src/compliance.jsx` line 39.
 */
export function formatProductionPassBadge(pass: boolean): "pass" | "review" {
  return pass ? "pass" : "review";
}

/* ────────── Armenian date placeholder ────────── */

/**
 * Render the gate's `effectiveDate` field with an Armenian
 * placeholder when missing. The server emits `""` (not `null`)
 * for gates that have no effective-dated source row, and the
 * legacy component's line 35 already special-cases the empty
 * string with the placeholder "առանց ամսաթվի" ("without a
 * date"). We also accept null/undefined defensively in case
 * a future gate shape returns a different sentinel.
 */
export function formatProductionEffectiveDate(
  dateStr: string | null | undefined,
): string {
  if (dateStr === null || dateStr === undefined || dateStr.length === 0) {
    return "առանց ամսաթվի";
  }
  return dateStr;
}

/* ────────── meta-row copy ────────── */

/**
 * The right-hand span in the meta row, which is the operator's
 * at-a-glance verdict for the whole readiness payload.
 * - `reviewRequired: true`  → "review required"  (something
 *   needs human attention before production use).
 * - `reviewRequired: false` → "production-ready" (all clear).
 *
 * Matches `web/src/compliance.jsx` line 45.
 */
export function formatProductionReviewFlag(
  reviewRequired: boolean,
): "review required" | "production-ready" {
  return reviewRequired ? "review required" : "production-ready";
}

/* ────────── 5-role read gate ────────── */

/**
 * Closed set of roles the server allows to read the production
 * readiness endpoint (server/app.js#requireProductionReadinessReader,
 * line 9016). Mirrored here so the CFO dashboard route can hide
 * the co-panel from roles the API would 403 anyway — avoiding a
 * broken-component flash for unauthorized viewers.
 */
const PRODUCTION_READINESS_READER_ROLES: ReadonlyArray<string> = [
  "Owner",
  "Admin",
  "Accountant",
  "Lawyer",
  "Auditor",
];

/**
 * Can `role` read the production readiness endpoint? Returns
 * false for null/undefined so the helper is safe to call before
 * the auth user has been resolved (e.g. on the route's first
 * render while the user query is still loading).
 *
 * The role list is the exact set the server enforces — adding a
 * role here that the server doesn't accept would let an
 * unauthorized user see a panel that 403s on click.
 */
export function canReadProductionReadiness(
  role: string | null | undefined,
): boolean {
  if (typeof role !== "string" || role.length === 0) return false;
  return PRODUCTION_READINESS_READER_ROLES.includes(role);
}
