# Sub-Plan 9: Fleet Management (Автопарк) — Differentiator #2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fleet operations for Spayka's 350+ trucks: vehicles, drivers, trips, GPS, fuel, repairs, tires, cold-chain temperature logging. Linked to Warehouse (sub-plan 2) and Export Documentation (sub-plan 6).

**Architecture:** Pattern A module `server/fleet.js` (pure engine: trip cost, fuel efficiency, driver hours-of-service, cold-chain compliance check) + `web/src/fleet.jsx` panel (Vehicles / Drivers / Trips / Fuel / Repairs / Tires / Cold-Chain tabs) + `test/fleet.test.js`. New tables: `fleet_vehicles`, `fleet_drivers`, `fleet_trips`, `fleet_gps_pings`, `fleet_fuel_logs`, `fleet_repairs`, `fleet_tires`, `fleet_cold_chain_logs`. Foreign keys to `assets` (sub-plan 8) for the vehicle's own asset record.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. GPS: device-pushed HTTP endpoint accepts batches of pings; cold-chain: temperature sensor pushes via the same endpoint with a different event kind. The endpoint is auth-token-gated per device, never the user session.

**Depends on:** sub-plan 0 (Pattern A skeleton), sub-plan 2 (warehouse), sub-plan 6 (export for trip documents), sub-plan 8 (assets for vehicle asset record).

---

## DB additions

- `fleet_vehicles` (id, org_id, plate, asset_id, model, year, capacity_kg, refrigeration, max_fuel_l, created_at)
- `fleet_drivers` (id, org_id, employee_id, license_no, license_classes, license_expiry, hours_of_service_balance_min, created_at)
- `fleet_trips` (id, org_id, vehicle_id, driver_id, origin, destination, planned_departure, planned_arrival, actual_departure, actual_arrival, distance_km, fuel_l, status, export_doc_id, created_at)
- `fleet_gps_pings` (id, vehicle_id, recorded_at, lat, lon, speed_kph, heading_deg, ignition_on, recorded_via)
- `fleet_fuel_logs` (id, vehicle_id, occurred_at, liters, cost_amd, odometer_km, station, vendor_id, notes, file_id)
- `fleet_repairs` (id, vehicle_id, occurred_at, kind, description, cost_amd, vendor_id, odometer_km, file_id, next_due_at)
- `fleet_tires` (id, vehicle_id, position, brand, installed_at, removed_at, odometer_at_install, expected_life_km)
- `fleet_cold_chain_logs` (id, vehicle_id, trip_id, recorded_at, temp_c, humidity, sensor_id, alert_kind)

## API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/fleet/vehicles` | Register vehicle |
| POST | `/api/fleet/drivers` | Register driver |
| POST | `/api/fleet/trips` | Plan + start a trip |
| PATCH | `/api/fleet/trips/:id/status` | Update status (departed / arrived / cancelled) |
| POST | `/api/fleet/devices/gps-batch` | Device-pushed GPS batch (token-gated, not session) |
| POST | `/api/fleet/devices/cold-chain-batch` | Device-pushed temperature batch |
| POST | `/api/fleet/fuel-logs` | Log a fuel fill-up |
| POST | `/api/fleet/repairs` | Log a repair |
| POST | `/api/fleet/tires/install` | Install a tire |
| GET | `/api/fleet/vehicles/:id/cold-chain-compliance?tripId=...` | Compliance report |
| GET | `/api/fleet/analytics/fuel-efficiency?periodKey=...` | L/100km by vehicle |
| GET | `/api/fleet/analytics/maintenance-backlog` | Overdue maintenance list |

## Tasks (high level)

1. **Tests (RED)** — `test/fleet.test.js`: trip planning + state machine, GPS batch ingestion idempotency, fuel efficiency math, cold-chain compliance (alert when temp out of range for > N minutes), driver hours-of-service, device-token gate (not session), idempotency.
2. **Pure engine** — `server/fleet.js`: `computeTripCost`, `fuelEfficiency`, `coldChainCompliance`, `driverHosBalance`, `maintenanceBacklog`.
3. **DB migration** — 8 new tables in `server/db.js`.
4. **Routes** — register 12 routes. The device-push endpoints use a separate `deviceAuth` middleware (token) distinct from user auth.
5. **React panel** — `web/src/fleet.jsx`: 7 tabs.
6. **Cold-chain rules** — `server/fleet/coldChainRules.json`: perishable category → max temperature + max minutes out of range (Armenian + EU defaults).
7. **Handoff + tag** — `fleet-mvp`.

## Acceptance

- A trip plans a route, dispatches, logs GPS pings, and arrives; the cold-chain compliance report flags any out-of-range temperature.
- Fuel efficiency is computed from fuel fills + odometer deltas.
- A driver cannot exceed hours-of-service (configurable daily cap).
- Device-pushed GPS batches are idempotent (replay safe).

## Spine reused

`org_id`, `assets` (sub-plan 8), `employees` (drivers, sub-plan 4), `export_documents` (sub-plan 6), `vendors` (fuel stations, repair shops), `audit_events`, `idempotency_keys`, `legal_sources` (Armenian transport law).

## Deferred to other sub-plans

- Live GPS map UI (optional; can be a static list first).
- Real telematics provider integration (Geotab, Wialon, etc.) — adapter in sub-plan 7.
