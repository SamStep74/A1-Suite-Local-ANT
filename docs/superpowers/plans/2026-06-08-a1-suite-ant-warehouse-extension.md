# Sub-Plan 2: Warehouse Extension (Склад) — User Priority #2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shipped inventory spine (`server/inventory` routes in `app.js`, `test/inventory.test.js`, `web/src/inventory.jsx`) with lot/serial tracking, expiry dates, lot traceability, cold-storage tracking, ABC analysis, turnover analytics, and AI forecasting hooks (Spayka produce, Armosphère orchards).

**Architecture:** Adds Pattern A module `server/warehouse.js` (pure engine: ABC classification, turnover days, low-stock forecast, lot/serial/expiry validators) + route registration + `web/src/warehouse.jsx` extension panel (lots/serials tab + analytics tab). Reuses existing `stock_moves` / `stock_quants` / `warehouses` / `stock_locations` tables — no destructive schema changes. New tables: `stock_lots`, `stock_serials`, `stock_lot_moves`, `cold_storage_readings`.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. Optional local embedder for AI forecasting (`bge-m3`) — same gate as Copilot.

**Depends on:** sub-plan 0 (Pattern A skeleton). Extends existing inventory backend (no need to rewrite).

---

## DB additions

- `stock_lots` (id, org_id, product_id, lot_code, mfg_date, expiry_date, harvest_date, source_vendor_id, created_at)
- `stock_serials` (id, org_id, product_id, serial, status, current_location_id, created_at)
- `stock_lot_moves` (id, org_id, lot_id, move_id, quantity, created_at)
- `cold_storage_readings` (id, org_id, location_id, recorded_at, temp_c, humidity, sensor_id)
- `stock_valuation_layers` (id, org_id, product_id, lot_id, layer_date, unit_cost, quantity_remaining) — for FIFO/LIFO/Average

## API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/warehouse/lots` | Create lot |
| GET | `/api/warehouse/lots?productId=...&expiringWithin=...` | List/filter lots, FEFO order |
| POST | `/api/warehouse/serials` | Register serial |
| GET | `/api/warehouse/serials/:id/trace` | Trace forward/backward movements |
| POST | `/api/warehouse/cold-storage/readings` | Record sensor reading |
| GET | `/api/warehouse/analytics/abc?periodKey=...` | ABC classification |
| GET | `/api/warehouse/analytics/turnover?periodKey=...` | Turnover days per product |
| POST | `/api/warehouse/forecast/restock` | AI restock forecast (intent: warehouse-restock) |
| GET | `/api/warehouse/traceability/:lotId` | Full lot traceability (upstream vendor + downstream customers) |

## Tasks (high level)

1. **Tests (RED)** — `test/warehouse-extension.test.js`: lot creation + expiry guard, serial trace, cold-storage reading, ABC correctness on seeded data, turnover math, FEFO ordering, idempotency.
2. **Pure engine** — `server/warehouse.js`: `classifyAbc`, `turnoverDays`, `fefoOrder`, `traceLot`, `forecastRestock` (local deterministic fallback), `validateExpiry`.
3. **DB migration** — add the five tables in `server/db.js`.
4. **Routes** — register the 9 routes after the existing inventory routes.
5. **React extension panel** — `web/src/warehouse.jsx`: add "Lots" / "Serials" / "Cold Storage" / "Analytics" tabs to the existing inventory panel.
6. **AI forecast hook** — `server/documentAi`-style local fallback + optional OpenRouter gate.
7. **Handoff + tag** — `warehouse-extension-mvp` after green build.

## Acceptance

- Receive PO with lot/serial/expiry data into warehouse.
- FEFO picking order automatically respected on delivery.
- Lot traceability report shows full chain vendor → warehouse → customer.
- ABC analysis buckets products into A/B/C by revenue contribution.
- Cold-storage sensor reading recorded and surfaced in warehouse detail.
- AI restock forecast provides deterministic local suggestion; no egress required.

## Spine reused

`org_id`, `products`, `stock_moves`, `stock_quants`, `warehouses`, `stock_locations`, `vendors`, `customers`, `audit_events`, `idempotency_keys`, `legal_sources` (only when AI forecast cites any regulatory source — usually none).

## Deferred to other sub-plans

- Production-order consumption of lots (sub-plan 10 Greenhouse).
- Fleet cold-chain GPS temperature logging (sub-plan 9 Fleet).
- Customs lot declarations (sub-plan 6 Export).
