# Sub-Plan 4: HR Depth (HR) — User Priority #4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move People-HR from "payroll registry" to operating HR. Add employee contracts (Armenian templates), leave management, business trips, timesheet, KPI tracking, equipment assignment, recruitment tube, and AI features (Armenian job-description generation, order generation, turnover analytics, performance review drafts).

**Architecture:** Pattern A module `server/hr.js` (pure engine: contract template selection, leave balance math, business-trip allowance, KPI score aggregation, turnover rate, AI job-description / order generators) + `web/src/people.jsx` extension (add Contracts / Leave / Trips / Timesheet / KPI / Recruitment tabs) + `test/hr.test.js`. Builds on the existing `employees` / `payroll_runs` tables. New tables: `employment_contracts`, `leave_requests`, `leave_balances`, `business_trips`, `timesheets`, `kpi_targets`, `kpi_actuals`, `equipment_assignments`, `recruitment_pipelines`, `recruitment_candidates`, `hr_orders`.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. Armenian contract templates stored as Markdown in `server/hr/templates/` (versioned in repo). AI generators use `server/copilot.js` pattern with a `server/hrAi.js` local-first helper.

**Depends on:** sub-plan 0 (Pattern A skeleton). Existing payroll + employees.

---

## DB additions

- `employment_contracts` (id, org_id, employee_id, template_code, signed_at, start_date, end_date, gross_salary, position, file_id, status)
- `leave_requests` (id, org_id, employee_id, kind, start_date, end_date, days, status, approver_id, reason, created_at)
- `leave_balances` (id, org_id, employee_id, year, kind, entitled_days, used_days, carried_over)
- `business_trips` (id, org_id, employee_id, destination, start_date, end_date, per_diem_amd, transportation_amd, status, approver_id)
- `timesheets` (id, org_id, employee_id, work_date, hours, project_id, task_id, notes)
- `kpi_targets` (id, org_id, employee_id, period_key, metric, target, weight)
- `kpi_actuals` (id, org_id, employee_id, period_key, metric, actual, evidence_url)
- `equipment_assignments` (id, org_id, employee_id, asset_id, assigned_at, returned_at, signature_doc_id)
- `recruitment_pipelines` (id, org_id, name, stage_order_json, created_at)
- `recruitment_candidates` (id, org_id, pipeline_id, full_name, email, stage, applied_at, notes)
- `hr_orders` (id, org_id, employee_id, order_type, effective_date, body_md, issued_by, signed_at, file_id)

## API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/hr/contracts` | Create contract from template |
| GET | `/api/hr/contracts/templates` | List Armenian templates |
| POST | `/api/hr/leave-requests` | Request leave |
| POST | `/api/hr/leave-requests/:id/approve` | Approve / reject |
| GET | `/api/hr/leave-balances?employeeId=...&year=...` | Balance |
| POST | `/api/hr/business-trips` | Create trip with per-diem + transport |
| POST | `/api/hr/timesheets/bulk` | Submit weekly timesheet |
| GET | `/api/hr/timesheets/report?periodKey=...` | Aggregated hours |
| POST | `/api/hr/kpis/targets` | Set KPI targets |
| POST | `/api/hr/kpis/actuals` | Record actuals + evidence |
| GET | `/api/hr/kpis/score?employeeId=...&periodKey=...` | Weighted score |
| POST | `/api/hr/equipment/assign` | Assign asset to employee (links to sub-plan 8) |
| POST | `/api/hr/recruitment/pipelines` | Create pipeline |
| POST | `/api/hr/recruitment/candidates` | Add candidate |
| POST | `/api/hr/orders` | Issue HR order (vacation, transfer, etc.) |
| POST | `/api/hr/ai/job-description` | AI generate JD (intent: hr-job-description) |
| POST | `/api/hr/ai/order` | AI draft order body (intent: hr-order) |
| GET | `/api/hr/analytics/turnover?periodKey=...` | Turnover rate |

## Tasks (high level)

1. **Tests (RED)** — `test/hr.test.js`: contract creation from template, leave balance math, business-trip per-diem calc, timesheet aggregation, KPI weighted score, equipment assignment audit, recruitment stage transition, order issuance + signer lifecycle, AI JD generation, idempotency.
2. **Pure engine** — `server/hr.js`: `renderContract`, `computeLeaveBalance`, `computeTripAllowance`, `aggregateTimesheet`, `scoreKpi`, `computeTurnover`, `generateJobDescription` (local fallback), `draftOrder` (local fallback).
3. **Templates** — `server/hr/templates/*.md`: 6 Armenian contract templates (fixed-term, permanent, part-time, intern, remote, secondment) + 8 order templates.
4. **DB migration** — 11 new tables in `server/db.js`.
5. **Routes** — register 18 routes after the existing people routes.
6. **AI helper** — `server/hrAi.js` mirroring `server/copilot.js` pattern.
7. **React tabs** — extend `web/src/people.jsx`: 6 new tabs; preserve existing payroll views.
8. **Handoff + tag** — `hr-depth-mvp`.

## Acceptance

- An HR officer can issue a vacation order end-to-end: request → balance check → approval → order PDF draft.
- A timesheet can be submitted in bulk and rolled up to project hours.
- A KPI score is computed from weighted targets and stored as evidence.
- Recruitment pipeline moves candidates through stages with audit.
- AI job description draft cites Armenian labor law only if `legal_sources.status === "active"`.

## Spine reused

`org_id`, `employees`, `payroll_runs`, `vendors` (for external trainers), `assets` (sub-plan 8), `audit_events`, `period_locks` (for HR orders that affect payroll period), `idempotency_keys`, `legal_sources` (Labor Code, Personal Data, etc.).

## Deferred to other sub-plans

- e-Government submission of HR orders (sub-plan 7).
- Biometric attendance + Mobile ID check-in (sub-plan 7 + 9).
