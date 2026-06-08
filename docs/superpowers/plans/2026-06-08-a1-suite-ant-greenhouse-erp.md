# Sub-Plan 10: Greenhouse ERP (Тепличное производство) — Differentiator #3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uniquely Armenian module for greenhouse operations (Armosphère and similar): yield tracking, climate data, energy use, CO₂ enrichment, bioprotection, harvest scheduling. Linked to Warehouse (sub-plan 2) for harvest receipts, Asset Management (sub-plan 8) for greenhouse asset, and Procurement (sub-plan 3) for inputs.

**Architecture:** Pattern A module `server/greenhouse.js` (pure engine: yield forecasting, growing-degree-day calc, energy efficiency per kg, bioprotection alert rules) + `web/src/greenhouse.jsx` panel (Greenhouses / Zones / Crops / Climate / Energy / Harvests / Bioprotection tabs) + `test/greenhouse.test.js`. New tables: `greenhouses`, `greenhouse_zones`, `greenhouse_crops`, `greenhouse_climate_logs`, `greenhouse_energy_logs`, `greenhouse_harvests`, `greenhouse_bioprotection_logs`. Each greenhouse is also an `assets` row (sub-plan 8) so the existing asset engine covers its own depreciation + maintenance.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. Climate + energy sensors push via the same `deviceAuth` middleware as fleet (sub-plan 9). Charts: SVG line + bar. No external dep.

**Depends on:** sub-plan 0 (Pattern A skeleton), sub-plan 2 (warehouse for harvest receipt), sub-plan 3 (procurement for inputs), sub-plan 8 (assets for greenhouse asset record), sub-plan 9 (device-push pattern).

---

## DB additions

- `greenhouses` (id, org_id, name, asset_id, area_m2, glazing_kind, heating_kind, created_at)
- `greenhouse_zones` (id, greenhouse_id, name, area_m2, irrigation_kind, created_at)
- `greenhouse_crops` (id, zone_id, crop_kind, planted_at, expected_harvest_at, expected_yield_kg, seed_source, status)
- `greenhouse_climate_logs` (id, zone_id, recorded_at, temp_c, humidity, light_lux, co2_ppm, sensor_id)
- `greenhouse_energy_logs` (id, greenhouse_id, recorded_at, kwh, gas_m3, source, period_key)
- `greenhouse_harvests` (id, crop_id, harvested_at, quantity_kg, quality_grade, lot_id, notes, file_id)
- `greenhouse_bioprotection_logs` (id, zone_id, applied_at, agent_kind, dose, target_pest, withdrawal_period_days, recorded_by, file_id)

## API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/greenhouse/houses` | Create greenhouse (also creates an `assets` row) |
| POST | `/api/greenhouse/zones` | Create zone |
| POST | `/api/greenhouse/crops` | Plant a crop |
| PATCH | `/api/greenhouse/crops/:id/status` | Update crop status (planted / growing / harvested / failed) |
| POST | `/api/greenhouse/devices/climate-batch` | Device-pushed climate log |
| POST | `/api/greenhouse/devices/energy-batch` | Device-pushed energy log |
| POST | `/api/greenhouse/harvests` | Record harvest (auto-creates warehouse lot via sub-plan 2) |
| POST | `/api/greenhouse/bioprotection` | Log bioprotection application |
| GET | `/api/greenhouse/:id/analytics/yield?periodKey=...` | Yield vs forecast |
| GET | `/api/greenhouse/:id/analytics/energy?periodKey=...` | kWh + gas per kg harvested |
| GET | `/api/greenhouse/:id/analytics/gdd?from=...&to=...` | Growing-degree-days |
| POST | `/api/greenhouse/ai/yield-forecast` | AI yield forecast (intent: greenhouse-yield) |

## Tasks (high level)

1. **Tests (RED)** — `test/greenhouse.test.js`: greenhouse + zone + crop create, climate + energy batch idempotency, harvest auto-creates warehouse lot, bioprotection withdrawal-period enforcement, yield forecast math, GDD math, energy-per-kg math, idempotency.
2. **Pure engine** — `server/greenhouse.js`: `computeYieldVsForecast`, `computeGdd`, `computeEnergyPerKg`, `enforceWithdrawalPeriod`, `forecastYield` (local deterministic), `alertClimateAnomaly`.
3. **DB migration** — 7 new tables in `server/db.js`.
4. **Routes** — register 13 routes.
5. **Device push** — reuse the `deviceAuth` middleware from sub-plan 9.
6. **React panel** — `web/src/greenhouse.jsx`: 7 tabs.
7. **AI helper** — `server/greenhouseAi.js` mirroring Copilot pattern; cites Armenian agricultural / phytosanitary law when `legal_sources.status === "active"`.
8. **Handoff + tag** — `greenhouse-erp-mvp`.

## Acceptance

- A greenhouse + zone + crop are created; a climate batch is pushed; a harvest auto-creates a warehouse lot.
- A bioprotection application cannot record a harvest in the same zone within the withdrawal period.
- Yield forecast vs actual is shown per crop.
- Energy per kg harvested is shown per greenhouse.

## Spine reused

`org_id`, `assets` (sub-plan 8), `products` (the harvest's product), `stock_lots` (sub-plan 2 — auto-created on harvest), `vendors` (sub-plan 3 — input suppliers), `audit_events`, `period_locks`, `idempotency_keys`, `legal_sources`, `deviceAuth` middleware (sub-plan 9).

## Deferred to other sub-plans

- Computer-vision pest detection (out of scope; could be a future AI sub-skill).
- Multi-greenhouse environmental optimization (out of scope; future research).
