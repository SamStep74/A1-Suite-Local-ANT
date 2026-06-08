# A1-Suite-Local-ANT ERP Extension Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform A1 Suite Local from "HayHashvapah + Copilot" into the Armenian analogue of Zoho One / Odoo by adding seven missing ERP subsystems (Documents, Warehouse, Procurement, HR, CFO, Export, State Integrations) and three differentiation modules (Asset, Fleet, Greenhouse) on a shared, audit-backed, Armenian-localized spine — without regressing the existing Copilot, Docs&Sign, CRM, Finance, and Inventory spines already shipped.

**Architecture:** Each new subsystem follows Pattern A (the existing Copilot pattern): one pure deterministic `server/<module>.js` engine with no DB / no Fastify, a thin route registration in `server/app.js`, an `app.<module>` UI module in `web/src/<module>.jsx`, and a `test/<module>.test.js` `node --test` contract suite. Modules attach to a shared cross-cutting spine (`org_id` tenant key, `audit_events` log, `legal_sources` + `legal_source_reviews` governance, `vendor/a1-localization-am` Armenian primitives, `platformTenant` multi-tenant resolver, `app`/`role` RBAC, `period_locks`). Mutations require role-gated, idempotent, evidence-emitting endpoints; the Copilot stays read-only and may *propose* actions but never *execute* module mutations.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite` `DatabaseSync`, vendored `@a1/localization-am` package, React + Vite, `node --test`, Browser plugin / Playwright for UI proof, `@fastify/cookie`, `@fastify/static`. New endpoints are non-mutating JSON for read paths and idempotent POST/PATCH for write paths. New integrations: Armenian State Revenue Committee (SRC) SOAP/REST adapter, State Register of Legal Entities (`e-register.am`) adapter, e-Government Gateway (`e-gov.am`) for e-sign/ID Card/Mobile ID, customs (EKENG / e-customs) for import/export, optional `bge-m3` local embedder for document semantic search, optional local Ollama for AI features.

---

## Baseline Snapshot (pre-plan)

Captured from `origin/main` at commit `4e06c09` (2026-06-07) by cloning into `A1-Suite-Local-ANT` (private, on GitHub as `SamStep74/A1-Suite-Local-ANT`). Local path: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`. Remote layout: `ant` → new ANT repo (working), `origin` → preserved for upstream sync from `SamStep74/A1-Suite-Local`.

| Subsystem | State | Where |
|---|---|---|
| Accounting + Ledger (HayHashvapah) | Shipped | `server/accounting.js`, `server/ledger.js`, `test/accounting*.test.js` |
| Payroll | Shipped (registry + posting) | `server/payroll.js`, `test/payroll*.test.js` |
| VAT / SRC / E-invoice | Shipped | `server/einvoice.js`, `server/vatReturn.js`, `test/einvoice*.test.js` |
| Legal RAG | Shipped (BM25 + optional `bge-m3`) | `server/rag.js`, `server/lawIngest.js`, `server/lawEmbedIngest.js` |
| Copilot (legal/accounting) | Shipped (read-only) | `server/copilot.js`, `web/src/copilot.jsx`, `test/copilot.test.js` |
| Armenian localization (fiscal engines) | Shipped (vendored) | `server/vendor/a1-localization-am/`, `server/localization*.js` |
| Platform / multi-tenant | Shipped | `server/platformTenant.js` |
| Auth / RBAC / audit | Shipped | `server/app.js`, `server/audit-access.js`, `test/auditor-readonly-coverage.test.js` |
| Product Catalog (variants, UoM, pricelists, margins) | Shipped | `test/catalog.test.js` |
| Inventory / Warehouse (locations, moves, receipts) | Shipped (server backend) | `web/src/inventory.jsx`, `test/inventory.test.js` |
| Purchase (RFQ, PO, receipts, returns, Vendor 360) | Shipped (server backend) | `web/src/purchase.jsx`, `test/purchase-*.test.js` |
| CRM (leads, deals, quotes, Customer 360) | Shipped | `web/src/crm.jsx`, `test/crm-activities.test.js` |
| Finance UI (statements, AP/AR, reports) | Shipped | `web/src/finance.jsx`, `test/finance-*.test.js` |
| People-HR registry | Shipped (minimal) | `web/src/people.jsx`, `server/payroll.js` |
| Projects (tasks, milestones, time entries) | Shipped | `web/src/projects.jsx` |
| Desk (service cases, replies) | Shipped | `web/src/desk.jsx` |
| Forms / public intake | Shipped | `web/src/forms.jsx`, `test/forms*.test.js` |
| Docs & Sign (templates, signers, evidence) | Shipped | `web/src/docs.jsx`, `test/docs-*.test.js` |
| Compliance | Shipped | `web/src/compliance.jsx` |
| AI onboarding | Shipped | `web/src/ai-onboarding.jsx` |
| Fleet Management | **Missing** | new `server/fleet.js` + `web/src/fleet.jsx` |
| Greenhouse ERP | **Missing** | new `server/greenhouse.js` + `web/src/greenhouse.jsx` |
| Asset Management | **Missing** | new `server/assets.js` + `web/src/assets.jsx` |
| Export Documentation (CMR, TIR, Phyto, Cert. of Origin) | **Missing** | new `server/exportDocs.js` + `web/src/exportDocs.jsx` |
| CFO module (Cash Flow, Budget, Treasury, FX, Loans) | **Missing** | new `server/cfo.js` + `web/src/cfo.jsx` |
| State Integrations (SRC e-invoice, e-Register, e-Gov, customs) | **Partial** (VAT/SRC/invoices only) | extend `server/einvoice.js`, new `server/stateIntegrations.js` |
| Document Cabinet (workspaces, cross-app attachments) | **Missing** (lifecycle exists, cabinet does not) | extend `server/docs.js` cabinet, new `web/src/cabinet.jsx` |

Cross-cutting spine tables every new module must reuse (no new silo tables):

- `org_id` (tenant scope from `platformTenant` or default org).
- `audit_events` (id, org_id, actor, action, target_type, target_id, payload_json, occurred_at).
- `legal_sources` / `legal_source_reviews` (citation gate for any legal/tax/HR answer).
- `legal_questions` (Copilot read trail; new modules can opt in to log advisory use).
- `period_locks` (Finance; rejects mutations outside open periods).
- `customers` / `vendors` / `employees` (shared CRM/AP/HR master data).
- `idempotency_keys` (per-endpoint mutation dedupe).
- `app_assignments` (RBAC per app; existing `requireAppAccess`).

## Operating Rules

- Repo: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Working remote: `ant` (`git@github.com:SamStep74/A1-Suite-Local-ANT.git`)
- Upstream remote: `origin` (`git@github.com:SamStep74/A1-Suite-Local.git`) — for periodic sync only; do not push working changes to it
- Plan branch: keep on `main` for direct checkpoint commits (matches repo convention); the user can request a feature branch per module if they prefer
- Use path-scoped git adds only: `git add server/<x>.js server/app.js test/<x>.test.js`
- Push every completed task commit to GitHub: `git push ant main`
- Local dev server (when validating UI): `PORT=4178 HOST=0.0.0.0 ARMOSPHERA_ONE_DB=/tmp/a1-suite-ant-<module>.sqlite ARMOSPHERA_ONE_ALLOW_EGRESS=0 node server/index.js`
- Do not enable outbound network for the product. Module tests that hit state services must use a stub adapter registered in `server/stateIntegrations.js` and selected via `STATE_INTEGRATION_MODE=test`
- All mutation endpoints: role-gated, idempotent, period-lock-aware, audit-emitting, RBAC-scoped per `app`
- All new modules: Armenian-first UI copy; English/Russian labels only where customer-facing documents require them
- `HANDOFF.md` updated after each module completes (commit SHA, test count, live URL, OPPO runbook)
- Local-first deterministic behavior: AI may propose; governed workflows approve and execute (the existing Copilot rule — extend to all modules)

## Scope Check (per writing-plans guidance)

This roadmap is broken into **ten independent sub-plans**, each producing working, testable, deployable software. Each sub-plan follows Pattern A (see below) and reuses the spine. The master plan does not contain per-task code — that lives in each sub-plan file under `docs/superpowers/plans/`. Do not start a sub-plan until the prior sub-plan it depends on is green.

| # | Sub-plan file | Phase | Status |
|---|---|---|---|
| 0 | `2026-06-08-a1-suite-ant-pattern-a-skeleton.md` | Shared skeleton: `server/<module>.js` template + route + UI + test harness | **first** |
| 1 | `2026-06-08-a1-suite-ant-document-cabinet.md` | User Priority #1 — Документооборот: incoming/outgoing/internal, versioning, archive, OCR, AI classifier | |
| 2 | `2026-06-08-a1-suite-ant-warehouse-extension.md` | User Priority #2 — Склад: lot/serial, expiry, ABC, turnover, lot traceability, cold-storage tracking | |
| 3 | `2026-06-08-a1-suite-ant-procurement-extension.md` | User Priority #3 — Закупки: requisition, RFQ, supplier selection AI, price analysis, overspend warnings, blanket orders, landed costs | |
| 4 | `2026-06-08-a1-suite-ant-hr-depth.md` | User Priority #4 — HR: contracts, leave, business trips, timesheet, KPI, AI job descriptions, turnover analytics | |
| 5 | `2026-06-08-a1-suite-ant-cfo-module.md` | User Priority #5 — Финансы: Cash Flow, Budgeting, Treasury, Payment Calendar, FX Exposure, Loan Management, AI forecasting | |
| 6 | `2026-06-08-a1-suite-ant-export-documentation.md` | User Priority #6 — Экспорт: Invoice, Packing List, CMR, TIR, Cert. of Origin, Phyto, Export Declaration, HS-code check, country rules | |
| 7 | `2026-06-08-a1-suite-ant-state-integrations.md` | User Priority #7 — Гос. интеграции: SRC adapter, e-Register, e-Gov, customs, ID Card, Mobile ID, e-sign | |
| 8 | `2026-06-08-a1-suite-ant-asset-management.md` | Differentiator — Asset Mgmt: equipment, vehicles, refrigeration, greenhouses | |
| 9 | `2026-06-08-a1-suite-ant-fleet-management.md` | Differentiator — Fleet: trips, drivers, GPS, fuel, repairs, tires (target: 350+ trucks Spayka) | |
| 10 | `2026-06-08-a1-suite-ant-greenhouse-erp.md` | Differentiator — Greenhouse: yield maps, climate, energy, CO₂, bioprotection (target: Armosphère) | |

## Pattern A (codified for reuse by every sub-plan)

Every new subsystem follows this exact skeleton, so sub-plans can reference rather than re-derive.

### Backend: pure engine module

Create `server/<module>.js` with **no `require` of `db` or `fastify`**. The module exports pure functions that take normalized inputs and return objects. Tests can require it directly and unit-test the engine without spinning Fastify.

```js
"use strict";
function decideAction(input) { /* pure logic */ }
module.exports = { decideAction };
```

### Route: thin handler in `server/app.js`

```js
const <module> = require("./<module>");
app.post("/api/<module>/<verb>", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "<module-app-code>");
  const result = doThing(db, user, request.body || {});
  return { ok: true, <module>: result };
});
```

### UI: `web/src/<module>.jsx`

One React component per module. Use existing `panel` / `panel-head` / `inline-form` / `mini-action` CSS classes from `web/src/styles.css`; do not introduce new design language. Mount in `Workspace` near the relevant domain panel.

### Test: `test/<module>.test.js`

`node --test` contract tests covering: auth gate, app access, input validation, role gate, audit emit, idempotency, period lock awareness, malformed-input guard. Use `buildApp({ dbPath: ":memory:" })` and `app.inject` — match the existing `test/copilot.test.js` style.

### Audit + period lock + idempotency

Every mutation:
1. Looks up an `idempotency_key` from request header; returns 409 on replay.
2. Verifies the period is not locked (if Finance-touching) via `period_locks`.
3. Wraps the change in a transaction; writes an `audit_events` row.
4. Returns 4xx for malformed input; never silently swallows errors.

### Localization

Every new module ships:
- Armenian-first label dictionary in `web/src/locale.js` (or new `web/src/locale.<module>.js`).
- `ՀՎՀՀ` validation for any organization/contact field (`a1-localization-am` already provides this).
- AMD currency display with proper rounding.
- Legal-source citation reference for any HR/payroll/tax/privacy workflow (gated by `legal_sources.status === "active"`).

## Sub-Plan Dependencies

```
0 (skeleton)  ─┬─► 1 (Documents)
               ├─► 2 (Warehouse)         ─► 9 (Fleet) ── uses warehouse parts linkage
               ├─► 3 (Procurement)       ─► 6 (Export) ── uses PO + vendor
               ├─► 4 (HR)
               ├─► 5 (CFO)               ─► 8 (Asset) ── uses asset depreciation
               ├─► 6 (Export)
               └─► 7 (State Integrations)─► 1, 3, 4, 5 (tax + register + e-sign)
                              ▲
                              └── 10 (Greenhouse) independent
```

Recommended execution order (matches the user's stated phases):

1. **Phase 1 (now):** Skeleton (0) → Documents (1) → Warehouse (2) → Procurement (3)
2. **Phase 2:** HR (4) → CFO (5)
3. **Phase 3:** Export (6) → State Integrations (7)
4. **Phase 4 (differentiators):** Asset (8) → Fleet (9) → Greenhouse (10)

## First Three Engineering Milestones (master plan level)

### Milestone 0 — Pattern A Skeleton

Stand up the shared Pattern A template, one trivial example module (`server/healthcheck.js` + route + UI card + test), prove the skeleton compiles and tests pass. Confirms the convention before any real module starts.

### Milestone 1 — Document Cabinet (User Priority #1)

Largest UX-visible win. Brings incoming/outgoing/internal doc flows, version history, archive, OCR (Tesseract local or optional Ollama vision), AI document type classifier and risk finder, ID Card / Mobile ID e-sign hooks (state integration prep). See `2026-06-08-a1-suite-ant-document-cabinet.md`.

### Milestone 2 — Warehouse Extension (User Priority #2)

Builds on the shipped inventory spine. Adds lot/serial, expiry, lot traceability, cold-storage tracking, ABC analysis, turnover analytics, and the AI forecasting hooks for Spayka/Armosphère produce. See `2026-06-08-a1-suite-ant-warehouse-extension.md`.

### Milestone 3 — Procurement Extension (User Priority #3)

Builds on the shipped purchase spine. Adds requisition, RFQ, AI supplier selection, price analysis, overspend warnings, blanket orders, landed costs, billed-return credit notes. See `2026-06-08-a1-suite-ant-procurement-extension.md`.

## Execution Handoff (master plan level)

After the master plan is approved, the recommended order is:

1. **Sub-plan 0 (skeleton)** — small, low risk; prove the pattern
2. **Sub-plan 1 (Documents)** — highest user priority
3. **Sub-plan 2 (Warehouse)** — high user priority; extends existing module
4. **Sub-plan 3 (Procurement)** — high user priority; extends existing module

Then pause for the user to validate Phase 1 deliverables before continuing with HR, CFO, Export, State, Asset, Fleet, Greenhouse.

---

## Final Self-Review Checklist (master level)

- [x] Repo cloned to `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT` and pushed to `SamStep74/A1-Suite-Local-ANT`
- [x] Original `origin` preserved for upstream sync
- [x] Master plan references the existing `docs/ERP_COMPARISON_IMPLEMENTATION_PLAN.md` and existing `2026-06-01-armenian-legal-accounting-copilot.md` plan
- [x] Each sub-plan produces independently testable software
- [x] Pattern A codified once and referenced by every sub-plan
- [x] Cross-cutting spine tables listed once and referenced by every sub-plan
- [x] No placeholder content in the master plan
- [x] Operating rules (paths, remotes, env vars, dev server command) defined once
- [ ] All ten sub-plan files created with full task detail (next step)
- [ ] First sub-plan (skeleton) reviewed and approved
