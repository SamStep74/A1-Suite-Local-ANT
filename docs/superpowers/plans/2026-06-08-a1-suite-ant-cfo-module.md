# Sub-Plan 5: CFO Module (Финансы) — User Priority #5

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CFO module *separate from* accounting/HayHashvapah. Cover Cash Flow forecasting, Budgeting, Treasury, Payment Calendar, FX Exposure, and Loan Management, plus AI features (liquidity forecast, cash-gap detection, FX risk, debt load analysis). Especially important for Spayka.

**Architecture:** Pattern A module `server/cfo.js` (pure engine: cash-flow rollup, budget variance, treasury position, payment-calendar generation, FX exposure aggregation, loan amortization) + `web/src/cfo.jsx` panel (5 tabs: Cash Flow / Budget / Treasury / Calendar / Loans) + `test/cfo.test.js`. Reuses the existing `accounting` engine (`server/accounting.js`, `server/ledger.js`) for source data; CFO is read-mostly with a few budget-mutation endpoints. New tables: `budgets`, `budget_lines`, `treasury_accounts`, `fx_positions`, `loans`, `loan_schedules`, `cash_flow_forecasts`.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. Local-first AI forecasting; AMD base + multi-currency (USD, EUR, RUB, AED) display. Charts: SVG via React (no chart lib dep) or optional `d3` later.

**Depends on:** sub-plan 0 (Pattern A skeleton). Existing accounting/ledger.

---

## DB additions

- `budgets` (id, org_id, name, period_key, currency, status, created_at)
- `budget_lines` (id, budget_id, account_id, planned_amount, actual_cache_amount, last_synced_at)
- `treasury_accounts` (id, org_id, name, currency, bank_name, account_number_masked, balance_cache, last_synced_at)
- `fx_positions` (id, org_id, currency, amount, rate_to_amd, source, as_of)
- `loans` (id, org_id, lender, principal_amd, currency, rate_pct, term_months, start_date, schedule_kind, status)
- `loan_schedules` (id, loan_id, period_key, principal_due, interest_due, balance_after, status)
- `cash_flow_forecasts` (id, org_id, scenario, period_key, opening_amd, expected_inflow_amd, expected_outflow_amd, closing_amd, generated_at, ai_source)

## API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cfo/cash-flow?periodKey=...&scenario=base` | Cash flow statement + forecast |
| POST | `/api/cfo/budgets` | Create budget |
| PATCH | `/api/cfo/budgets/:id/lines` | Update planned lines |
| GET | `/api/cfo/budgets/:id/variance` | Planned vs actual |
| GET | `/api/cfo/treasury/positions` | Treasury balances by currency |
| POST | `/api/cfo/treasury/accounts` | Add treasury account |
| GET | `/api/cfo/payment-calendar?from=...&to=...` | Upcoming AP/AR/loan dues |
| POST | `/api/cfo/fx/positions` | Record FX position |
| GET | `/api/cfo/fx/exposure` | Net FX exposure by currency |
| POST | `/api/cfo/loans` | Create loan |
| GET | `/api/cfo/loans/:id/schedule` | Amortization schedule |
| POST | `/api/cfo/ai/forecast` | AI liquidity / cash-gap forecast (intent: cfo-forecast) |
| POST | `/api/cfo/ai/fx-risk` | AI FX risk (intent: cfo-fx) |
| POST | `/api/cfo/ai/debt-load` | AI debt load (intent: cfo-debt) |

## Tasks (high level)

1. **Tests (RED)** — `test/cfo.test.js`: cash-flow math, budget variance, treasury roll-up, payment-calendar ordering, FX exposure aggregation, loan amortization correctness, AI forecast deterministic fallback, idempotency.
2. **Pure engine** — `server/cfo.js`: `computeCashFlow`, `computeBudgetVariance`, `computeTreasuryPosition`, `buildPaymentCalendar`, `computeFxExposure`, `amortizeLoan`, `forecastLiquidity` (local deterministic), `analyzeFxRisk` (local), `analyzeDebtLoad` (local).
3. **DB migration** — 7 new tables in `server/db.js`.
4. **Routes** — register 14 routes after the existing finance routes.
5. **React panel** — `web/src/cfo.jsx`: 5 tabs + chart placeholders (SVG line + bar); reuse `.panel`, `.inline-form`, `.copilot-result` styles.
6. **AI helper** — `server/cfoAi.js` mirroring the Copilot pattern; AI cites Armenian tax/banking law only if `legal_sources.status === "active"`.
7. **Handoff + tag** — `cfo-mvp`.

## Acceptance

- A CFO sees a 13-week cash-flow forecast with deterministic local math.
- A budget's planned vs actual updates as the underlying accounting journal posts.
- The payment calendar lists upcoming AP, AR, and loan dues in AMD-equivalent.
- FX exposure shows net open position by currency; AI suggests a hedge if exposure > threshold.
- Loan amortization is correct for equal-principal and annuity schedules.

## Spine reused

`org_id`, `accounting` engine, `ledger` engine, `customers` (AR), `vendors` (AP), `audit_events`, `period_locks` (for budget freezes), `idempotency_keys`, `legal_sources`.

## Deferred to other sub-plans

- Real bank feed integration (out of scope; will be adapter in sub-plan 7).
- Multi-entity consolidation (out of scope; future work).
