# Sub-Plan 8: Asset Management (Разное имущество) — Differentiator #1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track physical assets (equipment, vehicles, refrigeration units, greenhouses) and their lifecycle: acquisition, depreciation, maintenance schedule, assignment to employees or projects, write-off. Especially valuable for Spayka (refrigeration, vehicles) and Armosphère (greenhouses).

**Architecture:** Pattern A module `server/assets.js` (pure engine: depreciation schedule, maintenance interval, asset value roll-up) + `web/src/assets.jsx` panel (Asset Registry / Depreciation / Maintenance / Assignment tabs) + `test/assets.test.js`. New tables: `assets`, `asset_categories`, `asset_depreciation_schedules`, `asset_maintenance_logs`, `asset_assignments` (links to sub-plan 4 employees + sub-plan 9 fleet).

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. Straight-line and reducing-balance depreciation; AMD currency; no external dep.

**Depends on:** sub-plan 0 (Pattern A skeleton), sub-plan 4 (HR for assignments), sub-plan 9 (Fleet for vehicles), sub-plan 10 (Greenhouse for greenhouse assets).

---

## DB additions

- `asset_categories` (id, org_id, name, default_useful_life_months, default_depreciation_method, default_residual_pct, asset_account_id, accum_depr_account_id, depr_expense_account_id, created_at)
- `assets` (id, org_id, category_id, name, serial, purchase_date, purchase_cost_amd, vendor_id, current_location_id, status, salvage_value_amd, parent_asset_id, created_at)
- `asset_depreciation_schedules` (id, asset_id, period_key, depreciation_amd, accumulated_amd, net_book_value_amd, status, posted_at)
- `asset_maintenance_logs` (id, asset_id, performed_at, kind, cost_amd, vendor_id, notes, file_id, next_due_at)
- `asset_assignments` (id, asset_id, assignee_type, assignee_id, assigned_at, returned_at, signature_doc_id)

## API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/assets/categories` | Create category |
| POST | `/api/assets` | Create asset |
| GET | `/api/assets/:id/depreciation` | Schedule |
| POST | `/api/assets/:id/post-depreciation?periodKey=...` | Post a depreciation line to ledger |
| GET | `/api/assets/:id/maintenance-history` | List maintenance |
| POST | `/api/assets/:id/maintenance` | Log maintenance |
| POST | `/api/assets/:id/assign` | Assign (employee, project, location) |
| POST | `/api/assets/:id/return` | Return / unassign |
| GET | `/api/assets/report/value` | Total NBV by category |
| POST | `/api/assets/:id/write-off` | Write off (with approval + audit) |

## Tasks (high level)

1. **Tests (RED)** — `test/assets.test.js`: depreciation math (straight-line + reducing-balance), maintenance interval alert, assignment audit, NBV roll-up, write-off posts to ledger, idempotency.
2. **Pure engine** — `server/assets.js`: `depreciateStraightLine`, `depreciateReducingBalance`, `computeNbv`, `nextMaintenanceDue`, `rollUpValueByCategory`.
3. **DB migration** — 5 new tables in `server/db.js`.
4. **Routes** — register 11 routes.
5. **React panel** — `web/src/assets.jsx`: 4 tabs.
6. **Ledger integration** — depreciation posts to the existing `accounting` engine with category-specific accounts.
7. **Handoff + tag** — `assets-mvp`.

## Acceptance

- A refrigerator's monthly depreciation is computed, posted to the ledger, and the NBV updates.
- A maintenance log records a vendor service; the next-due date rolls forward.
- An asset is assigned to an employee, then returned, with both transitions audited.
- Write-off reduces NBV to zero and posts a disposal entry.

## Spine reused

`org_id`, `vendors` (service vendors), `employees` (assignees, sub-plan 4), `locations` (warehouses), `accounting` engine, `ledger` engine, `audit_events`, `period_locks`, `idempotency_keys`.

## Deferred to other sub-plans

- Vehicle-specific odometer / fuel / GPS (sub-plan 9 Fleet).
- Greenhouse-specific climate (sub-plan 10 Greenhouse).
