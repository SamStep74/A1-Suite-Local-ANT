# Sub-Plan 9: Fleet Management (Ավտոպարկ) — Differentiator #2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fleet operations for Spayka's 350+ trucks: vehicles, drivers, trips, GPS, fuel, repairs, tires, cold-chain temperature logging. Linked to Warehouse (sub-plan 2) and Export Documentation (sub-plan 6).

**Architecture:** Pattern A module `server/fleet.js` (pure engine: trip cost, fuel efficiency, driver hours-of-service, cold-chain compliance check) + `server/fleet/deviceAuth.js` (token-gated middleware distinct from user session) + `web/src/fleet.jsx` panel (Vehicles / Drivers / Trips / Fuel / Repairs / Tires / Cold-Chain tabs) + `test/fleet.test.js`. New tables: `fleet_vehicles`, `fleet_drivers`, `fleet_trips`, `fleet_gps_pings`, `fleet_fuel_logs`, `fleet_repairs`, `fleet_tires`, `fleet_cold_chain_logs`, `fleet_device_tokens`. Foreign keys to `assets` (sub-plan 8) for the vehicle's own asset record.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. GPS: device-pushed HTTP endpoint accepts batches of pings; cold-chain: temperature sensor pushes via the same endpoint with a different event kind. The endpoint is auth-token-gated per device, never the user session.

**Depends on:** sub-plan 0 (Pattern A skeleton), sub-plan 2 (warehouse), sub-plan 6 (export for trip documents), sub-plan 8 (assets for vehicle asset record).

---

## File Structure

- Create: `server/fleet.js` — pure engine: `computeTripCost`, `fuelEfficiency`, `coldChainCompliance`, `driverHosBalance`, `maintenanceBacklog`, `tripStateMachine`.
- Create: `server/fleet/deviceAuth.js` — token middleware for device-pushed endpoints.
- Create: `server/fleet/coldChainRules.json` — perishable category → max temp + max minutes out of range.
- Modify: `server/db.js` — add 9 new tables (8 fleet + 1 device token) and a migration helper.
- Modify: `server/app.js` — register 12 fleet routes after the existing legal-routes block.
- Create: `web/src/fleet.jsx` — 7-tab React panel (Vehicles / Drivers / Trips / Fuel / Repairs / Tires / Cold-Chain).
- Modify: `web/src/main.jsx` — import + mount the panel.
- Modify: `web/src/styles.css` — reuse existing `.panel`, `.panel-head`, `.inline-form`, `.mini-action`, `.copilot-result`, `.row`, `.section-label`, `.aging-badge`; no new CSS unless needed.
- Create: `test/fleet.test.js` — `node --test` contract suite covering all 12 routes + pure-engine tests.

## DB additions

- `fleet_vehicles` (id, org_id, plate, asset_id, model, year, capacity_kg, refrigeration, max_fuel_l, created_at)
- `fleet_drivers` (id, org_id, employee_id, license_no, license_classes, license_expiry, hours_of_service_balance_min, created_at)
- `fleet_trips` (id, org_id, vehicle_id, driver_id, origin, destination, planned_departure, planned_arrival, actual_departure, actual_arrival, distance_km, fuel_l, status, export_doc_id, created_at)
- `fleet_gps_pings` (id, vehicle_id, recorded_at, lat, lon, speed_kph, heading_deg, ignition_on, recorded_via)
- `fleet_fuel_logs` (id, vehicle_id, occurred_at, liters, cost_amd, odometer_km, station, vendor_id, notes, file_id)
- `fleet_repairs` (id, vehicle_id, occurred_at, kind, description, cost_amd, vendor_id, odometer_km, file_id, next_due_at)
- `fleet_tires` (id, vehicle_id, position, brand, installed_at, removed_at, odometer_at_install, expected_life_km)
- `fleet_cold_chain_logs` (id, vehicle_id, trip_id, recorded_at, temp_c, humidity, sensor_id, alert_kind)
- `fleet_device_tokens` (id, vehicle_id, token_hash, label, last_seen_at, revoked_at) — auth gate for `/api/fleet/devices/*`

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

---

## Task 1: Pure engine + RED contract test for trip state machine

**Files:**
- Create: `server/fleet.js`
- Create: `test/fleet.test.js`
- Read: `server/app.js` (to confirm `buildApp`, `app.auth`, `requireAppAccess`, `recordAudit`, `randomId` exports)
- Read: `test/healthcheck.test.js` (style reference)

- [ ] **Step 1: Write the failing test (RED)**

Create `test/fleet.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");
const fleet = require("../server/fleet");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

test("fleet engine: trip state machine forbids invalid transitions", () => {
  // planned -> departed -> arrived is allowed
  assert.strictEqual(fleet.tripStateMachine.next("planned", "departed"), "in_transit");
  assert.strictEqual(fleet.tripStateMachine.next("in_transit", "arrived"), "arrived");
  // planned -> arrived (skipping depart) is forbidden
  assert.throws(() => fleet.tripStateMachine.next("planned", "arrived"), /invalid transition/);
  // arrived is terminal
  assert.throws(() => fleet.tripStateMachine.next("arrived", "departed"), /invalid transition/);
});

test("fleet engine: computeTripCost sums fuel + repair allocations", () => {
  const cost = fleet.computeTripCost({
    fuelL: 80,
    fuelCostPerL: 480,
    km: 320,
    repairCostPerKm: 12
  });
  assert.strictEqual(cost.fuel, 80 * 480);
  assert.strictEqual(cost.repairs, 320 * 12);
  assert.strictEqual(cost.total, 80 * 480 + 320 * 12);
});

test("fleet engine: fuelEfficiency = liters / km * 100", () => {
  const eff = fleet.fuelEfficiency({ liters: 60, km: 800 });
  assert.strictEqual(eff.lPer100km, 7.5);
  assert.strictEqual(eff.kmPerL, 800 / 60);
});

test("fleet engine: coldChainCompliance flags out-of-range sustained breach", () => {
  // 5 pings, all in 4C..8C range for a "dairy" trip (max 6C, 30 min breach)
  const inRange = Array.from({ length: 5 }, (_, i) => ({ recordedAt: `2026-06-08T10:0${i}:00Z`, tempC: 5 }));
  assert.deepStrictEqual(
    fleet.coldChainCompliance(inRange, { category: "dairy", maxMinutesOutOfRange: 30 }),
    { breaches: [], worstTempC: 5, sustainedMinutes: 0 }
  );
  // 6C for 20 minutes = fine; 6.5C for 35 minutes = breach
  const breach = [
    { recordedAt: "2026-06-08T10:00:00Z", tempC: 5 },
    { recordedAt: "2026-06-08T10:10:00Z", tempC: 6.2 },
    { recordedAt: "2026-06-08T10:20:00Z", tempC: 6.5 },
    { recordedAt: "2026-06-08T10:30:00Z", tempC: 6.5 },
    { recordedAt: "2026-06-08T10:40:00Z", tempC: 6.5 }
  ];
  const out = fleet.coldChainCompliance(breach, { category: "dairy", maxMinutesOutOfRange: 30 });
  assert.ok(out.breaches.length >= 1, "must flag sustained breach");
  assert.ok(out.worstTempC >= 6.5);
});

test("fleet engine: driverHosBalance rejects dispatch over cap", () => {
  const balance = fleet.driverHosBalance({
    balanceMin: 600,
    tripMinutes: 660,
    dailyCapMin: 600
  });
  assert.strictEqual(balance.allowed, false);
  assert.strictEqual(balance.shortfallMin, 60);
});

test("POST /api/fleet/trips is auth-gated (401)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/fleet/trips",
      payload: { vehicleId: "v1", driverId: "d1", origin: "Yerevan", destination: "Gyumri", plannedDeparture: "2026-06-08T08:00:00Z" }
    });
    assert.strictEqual(res.statusCode, 401);
  } finally { await app.close(); }
});

test("POST /api/fleet/trips rejects users without fleet app access (403)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/fleet/trips",
      headers: { cookie },
      payload: { vehicleId: "v1", driverId: "d1", origin: "Yerevan", destination: "Gyumri", plannedDeparture: "2026-06-08T08:00:00Z" }
    });
    assert.strictEqual(res.statusCode, 403);
  } finally { await app.close(); }
});

test("POST /api/fleet/trips validates input (400)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/fleet/trips",
      headers: { cookie },
      payload: { origin: "Yerevan" }
    });
    assert.strictEqual(res.statusCode, 400);
  } finally { await app.close(); }
});

test("POST /api/fleet/trips happy path writes audit row (200, +1 audit)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const res = await app.inject({
      method: "POST",
      url: "/api/fleet/trips",
      headers: { cookie },
      payload: {
        vehicleId: "v-test-1",
        driverId: "d-test-1",
        origin: "Yerevan",
        destination: "Gyumri",
        plannedDeparture: "2026-06-08T08:00:00Z",
        plannedArrival: "2026-06-08T11:00:00Z",
        idempotencyKey: "trip-1"
      }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.trip.status, "planned");
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.strictEqual(after, before + 1);
  } finally { await app.close(); }
});

test("POST /api/fleet/trips idempotent replay returns cached body and +0 audit", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const payload = {
      method: "POST",
      url: "/api/fleet/trips",
      headers: { cookie },
      payload: {
        vehicleId: "v-test-1",
        driverId: "d-test-1",
        origin: "Yerevan",
        destination: "Gyumri",
        plannedDeparture: "2026-06-08T08:00:00Z",
        idempotencyKey: "trip-2"
      }
    };
    const first = await app.inject(payload);
    const second = await app.inject(payload);
    assert.strictEqual(first.statusCode, 200);
    assert.strictEqual(second.statusCode, 200);
    assert.deepStrictEqual(first.json(), second.json());
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.strictEqual(after, before + 1, "idempotency must suppress duplicate audit");
  } finally { await app.close(); }
});
```

- [ ] **Step 2: Run the test to verify it fails (RED)**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/fleet.test.js 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../server/fleet'`.

- [ ] **Step 3: Commit RED tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add test/fleet.test.js && git commit -m "test(fleet): define Pattern A contract for trips + pure engine" && git push ant main
```

## Task 2: Implement the pure engine (GREEN)

**Files:**
- Create: `server/fleet.js`

- [ ] **Step 1: Create the engine**

```js
"use strict";

// --- Trip state machine --------------------------------------------------------
const TRIP_TRANSITIONS = {
  planned: { departed: "in_transit", cancelled: "cancelled" },
  in_transit: { arrived: "arrived", cancelled: "cancelled" },
  arrived: {},
  cancelled: {}
};

const tripStateMachine = {
  next(current, action) {
    const allowed = TRIP_TRANSITIONS[current] || {};
    const next = allowed[action];
    if (!next) {
      const err = new Error(`invalid transition: ${current} -[${action}]-> ?`);
      err.statusCode = 400;
      throw err;
    }
    return next;
  }
};

// --- Trip cost ---------------------------------------------------------------
function computeTripCost({ fuelL, fuelCostPerL, km, repairCostPerKm }) {
  const f = Number(fuelL) || 0;
  const fp = Number(fuelCostPerL) || 0;
  const k = Number(km) || 0;
  const r = Number(repairCostPerKm) || 0;
  const fuel = Math.round(f * fp);
  const repairs = Math.round(k * r);
  return { fuel, repairs, total: fuel + repairs, liters: f, km: k };
}

// --- Fuel efficiency ----------------------------------------------------------
function fuelEfficiency({ liters, km }) {
  const l = Number(liters) || 0;
  const k = Number(km) || 0;
  if (l <= 0 || k <= 0) {
    return { lPer100km: 0, kmPerL: 0 };
  }
  return { lPer100km: Math.round((l / k) * 10000) / 100, kmPerL: Math.round((k / l) * 100) / 100 };
}

// --- Cold-chain compliance ----------------------------------------------------
const CATEGORY_RULES = {
  dairy:      { maxTempC: 6,  minTempC: 0 },
  frozen:     { maxTempC: -15, minTempC: -25 },
  produce:    { maxTempC: 10, minTempC: 1 },
  meat:       { maxTempC: 4,  minTempC: 0 },
  default:    { maxTempC: 8,  minTempC: 0 }
};

function coldChainCompliance(pings, { category = "default", maxMinutesOutOfRange = 30 } = {}) {
  const rule = CATEGORY_RULES[category] || CATEGORY_RULES.default;
  const sorted = [...pings].sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
  const breaches = [];
  let worstTempC = null;
  if (sorted.length === 0) {
    return { breaches, worstTempC, sustainedMinutes: 0, rule };
  }
  worstTempC = sorted[0].tempC;
  // Find longest consecutive out-of-range run.
  let runStart = null;
  let runMin = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const ping = sorted[i];
    if (ping.tempC > rule.maxTempC || ping.tempC < rule.minTempC) {
      if (runStart === null) { runStart = ping.recordedAt; runMin = 0; }
      worstTempC = Math.max(worstTempC, ping.tempC);
    }
    if (i > 0) {
      const deltaMin = Math.round((new Date(ping.recordedAt) - new Date(sorted[i - 1].recordedAt)) / 60000);
      runMin += deltaMin;
    }
    if (runStart && (ping.tempC <= rule.maxTempC && ping.tempC >= rule.minTempC)) {
      if (runMin > maxMinutesOutOfRange) {
        breaches.push({ startedAt: runStart, endedAt: ping.recordedAt, minutes: runMin });
      }
      runStart = null; runMin = 0;
    }
  }
  if (runStart) {
    const endedAt = sorted[sorted.length - 1].recordedAt;
    if (runMin > maxMinutesOutOfRange) breaches.push({ startedAt: runStart, endedAt, minutes: runMin });
  }
  return { breaches, worstTempC, sustainedMinutes: runMin, rule };
}

// --- Driver hours-of-service --------------------------------------------------
function driverHosBalance({ balanceMin, tripMinutes, dailyCapMin }) {
  const b = Number(balanceMin) || 0;
  const t = Number(tripMinutes) || 0;
  const cap = Number(dailyCapMin) || 600;
  if (t > cap) {
    return { allowed: false, shortfallMin: t - cap, remainingMin: Math.max(b - t, 0), dailyCapMin: cap };
  }
  return { allowed: b - t >= 0, shortfallMin: Math.max(t - b, 0), remainingMin: b - t, dailyCapMin: cap };
}

// --- Maintenance backlog ------------------------------------------------------
function maintenanceBacklog(repairs, { lookbackDays = 90 } = {}) {
  const now = Date.now();
  return repairs
    .filter(r => r.nextDueAt && new Date(r.nextDueAt).getTime() < now)
    .map(r => ({
      vehicleId: r.vehicleId,
      kind: r.kind,
      nextDueAt: r.nextDueAt,
      overdueDays: Math.round((now - new Date(r.nextDueAt).getTime()) / 86400000),
      expectedWithinDays: lookbackDays
    }));
}

module.exports = {
  TRIP_TRANSITIONS,
  CATEGORY_RULES,
  tripStateMachine,
  computeTripCost,
  fuelEfficiency,
  coldChainCompliance,
  driverHosBalance,
  maintenanceBacklog
};
```

- [ ] **Step 2: Run focused tests (engine GREEN, route still RED)**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/fleet.test.js 2>&1 | tail -20
```

Expected: 5 engine tests PASS; 5 route tests still FAIL (404 on `/api/fleet/trips`).

- [ ] **Step 3: Commit the engine**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/fleet.js && git commit -m "feat(fleet): add pure engine (state machine, cost, fuel, cold-chain, HoS)" && git push ant main
```

## Task 3: DB migration for 9 new tables

**Files:**
- Modify: `server/db.js` (add migration block; do NOT touch existing tables)

- [ ] **Step 1: Append the migration SQL to `server/db.js`**

Locate the existing migration block (the array of `CREATE TABLE` statements inside the `migrate(db)` function) and append the following AFTER all existing tables are created (do not break the surrounding code):

```js
    db.exec(`
      CREATE TABLE IF NOT EXISTS fleet_vehicles (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        plate TEXT NOT NULL,
        asset_id TEXT,
        model TEXT,
        year INTEGER,
        capacity_kg REAL,
        refrigeration INTEGER NOT NULL DEFAULT 0,
        max_fuel_l REAL,
        created_at TEXT NOT NULL,
        UNIQUE(org_id, plate)
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_org ON fleet_vehicles(org_id);

      CREATE TABLE IF NOT EXISTS fleet_drivers (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        employee_id TEXT,
        license_no TEXT NOT NULL,
        license_classes TEXT,
        license_expiry TEXT,
        hours_of_service_balance_min INTEGER NOT NULL DEFAULT 600,
        created_at TEXT NOT NULL,
        UNIQUE(org_id, license_no)
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_drivers_org ON fleet_drivers(org_id);

      CREATE TABLE IF NOT EXISTS fleet_trips (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL,
        driver_id TEXT NOT NULL,
        origin TEXT NOT NULL,
        destination TEXT NOT NULL,
        planned_departure TEXT NOT NULL,
        planned_arrival TEXT,
        actual_departure TEXT,
        actual_arrival TEXT,
        distance_km REAL,
        fuel_l REAL,
        status TEXT NOT NULL DEFAULT 'planned',
        export_doc_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_trips_org ON fleet_trips(org_id);
      CREATE INDEX IF NOT EXISTS idx_fleet_trips_vehicle ON fleet_trips(vehicle_id);
      CREATE INDEX IF NOT EXISTS idx_fleet_trips_driver ON fleet_trips(driver_id);

      CREATE TABLE IF NOT EXISTS fleet_gps_pings (
        id TEXT PRIMARY KEY,
        vehicle_id TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        speed_kph REAL,
        heading_deg REAL,
        ignition_on INTEGER,
        recorded_via TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_gps_vehicle ON fleet_gps_pings(vehicle_id, recorded_at);

      CREATE TABLE IF NOT EXISTS fleet_fuel_logs (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        liters REAL NOT NULL,
        cost_amd REAL NOT NULL,
        odometer_km REAL NOT NULL,
        station TEXT,
        vendor_id TEXT,
        notes TEXT,
        file_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_fuel_vehicle ON fleet_fuel_logs(vehicle_id, occurred_at);

      CREATE TABLE IF NOT EXISTS fleet_repairs (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        description TEXT,
        cost_amd REAL NOT NULL,
        vendor_id TEXT,
        odometer_km REAL,
        file_id TEXT,
        next_due_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_repairs_vehicle ON fleet_repairs(vehicle_id, occurred_at);

      CREATE TABLE IF NOT EXISTS fleet_tires (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL,
        position TEXT NOT NULL,
        brand TEXT,
        installed_at TEXT NOT NULL,
        removed_at TEXT,
        odometer_at_install REAL,
        expected_life_km REAL
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_tires_vehicle ON fleet_tires(vehicle_id, position);

      CREATE TABLE IF NOT EXISTS fleet_cold_chain_logs (
        id TEXT PRIMARY KEY,
        vehicle_id TEXT NOT NULL,
        trip_id TEXT,
        recorded_at TEXT NOT NULL,
        temp_c REAL NOT NULL,
        humidity REAL,
        sensor_id TEXT,
        alert_kind TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_cold_vehicle_trip ON fleet_cold_chain_logs(vehicle_id, trip_id, recorded_at);

      CREATE TABLE IF NOT EXISTS fleet_device_tokens (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        label TEXT,
        last_seen_at TEXT,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_device_tokens_org ON fleet_device_tokens(org_id, vehicle_id);
    `);
```

- [ ] **Step 2: Run the migration on a fresh in-memory DB and verify tables exist**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node -e "const {buildApp}=require('./server/app');const a=buildApp({dbPath:':memory:'});a.ready().then(()=>{const rows=a.db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'fleet_%' ORDER BY name\").all();console.log(rows.map(r=>r.name).join('\n'));return a.close();});"
```

Expected output (9 lines, alphabetical):
```
fleet_cold_chain_logs
fleet_device_tokens
fleet_drivers
fleet_fuel_logs
fleet_gps_pings
fleet_repairs
fleet_tires
fleet_trips
fleet_vehicles
```

- [ ] **Step 3: Re-run the fleet test to confirm migration did not break it**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/fleet.test.js 2>&1 | tail -10
```

Expected: 5 engine PASS, 5 route still FAIL (404) — no migration regression.

- [ ] **Step 4: Commit the migration**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/db.js && git commit -m "feat(fleet): add 9 fleet tables (vehicles, drivers, trips, GPS, fuel, repairs, tires, cold-chain, device tokens)" && git push ant main
```

## Task 4: Wire all 12 routes (GREEN) + device-token middleware

**Files:**
- Create: `server/fleet/deviceAuth.js`
- Create: `server/fleet/coldChainRules.json`
- Modify: `server/app.js` (import + 12 routes)

- [ ] **Step 1: Create the device-token middleware**

```js
"use strict";
const crypto = require("node:crypto");

function hashToken(raw) {
  return crypto.createHash("sha256").update(String(raw || "")).digest("hex");
}

function buildDeviceAuth({ db }) {
  return async function deviceAuth(request, reply) {
    const header = request.headers["x-device-token"] || "";
    const tokenHash = hashToken(header);
    if (!tokenHash || tokenHash.length !== 64) {
      const err = new Error("device token required");
      err.statusCode = 401;
      throw err;
    }
    const row = db
      .prepare("SELECT id, org_id, vehicle_id FROM fleet_device_tokens WHERE token_hash = ? AND revoked_at IS NULL")
      .get(tokenHash);
    if (!row) {
      const err = new Error("invalid device token");
      err.statusCode = 401;
      throw err;
    }
    db.prepare("UPDATE fleet_device_tokens SET last_seen_at = ? WHERE id = ?")
      .run(new Date().toISOString(), row.id);
    request.deviceContext = { tokenId: row.id, orgId: row.org_id, vehicleId: row.vehicle_id };
  };
}

module.exports = { buildDeviceAuth, hashToken };
```

- [ ] **Step 2: Create cold-chain rules file**

```json
{
  "default": { "maxTempC": 8, "minTempC": 0, "maxMinutesOutOfRange": 30 },
  "dairy":   { "maxTempC": 6, "minTempC": 0, "maxMinutesOutOfRange": 30 },
  "frozen":  { "maxTempC": -15, "minTempC": -25, "maxMinutesOutOfRange": 45 },
  "produce": { "maxTempC": 10, "minTempC": 1, "maxMinutesOutOfRange": 60 },
  "meat":    { "maxTempC": 4, "minTempC": 0, "maxMinutesOutOfRange": 30 }
}
```

- [ ] **Step 3: Add imports to `server/app.js`**

Near other engine imports at the top of `server/app.js`, add:

```js
const fleet = require("./fleet");
const { buildDeviceAuth, hashToken } = require("./fleet/deviceAuth");
const coldChainRules = require("./fleet/coldChainRules.json");
```

Inside `buildApp` (after the `recordAudit` and `randomId` definitions), add:

```js
  const deviceAuth = buildDeviceAuth({ db });
```

- [ ] **Step 4: Add the 12 routes after the existing legal-routes block in `server/app.js`**

Insert the entire block below immediately after the last existing `app.post(...)` route and before any final `return app;` statement:

```js
  // ---------- Fleet: Vehicles / Drivers / Trips ---------------------------------
  app.post("/api/fleet/vehicles", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "fleet");
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    if (!body.plate) { const e = new Error("plate is required"); e.statusCode = 400; throw e; }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const id = randomId("veh");
    db.prepare("INSERT INTO fleet_vehicles (id, org_id, plate, asset_id, model, year, capacity_kg, refrigeration, max_fuel_l, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, user.org_id, body.plate, body.assetId || null, body.model || null, body.year || null, body.capacityKg || null, body.refrigeration ? 1 : 0, body.maxFuelL || null, new Date().toISOString());
    const envelope = { ok: true, vehicle: { id, plate: body.plate, model: body.model || null, refrigeration: !!body.refrigeration } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString());
    recordAudit(db, user, "fleet.vehicle.create", "vehicle", id, { plate: body.plate, idempotencyKey: idem });
    return envelope;
  });

  app.post("/api/fleet/drivers", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "fleet");
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    if (!body.licenseNo) { const e = new Error("licenseNo is required"); e.statusCode = 400; throw e; }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const id = randomId("drv");
    db.prepare("INSERT INTO fleet_drivers (id, org_id, employee_id, license_no, license_classes, license_expiry, hours_of_service_balance_min, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, user.org_id, body.employeeId || null, body.licenseNo, body.licenseClasses || null, body.licenseExpiry || null, 600, new Date().toISOString());
    const envelope = { ok: true, driver: { id, licenseNo: body.licenseNo } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString());
    recordAudit(db, user, "fleet.driver.create", "driver", id, { licenseNo: body.licenseNo, idempotencyKey: idem });
    return envelope;
  });

  app.post("/api/fleet/trips", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "fleet");
    const body = request.body || {};
    const required = ["vehicleId", "driverId", "origin", "destination", "plannedDeparture"];
    for (const f of required) if (!body[f]) { const e = new Error(`${f} is required`); e.statusCode = 400; throw e; }
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const id = randomId("trp");
    db.prepare("INSERT INTO fleet_trips (id, org_id, vehicle_id, driver_id, origin, destination, planned_departure, planned_arrival, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?)")
      .run(id, user.org_id, body.vehicleId, body.driverId, body.origin, body.destination, body.plannedDeparture, body.plannedArrival || null, new Date().toISOString());
    const envelope = { ok: true, trip: { id, status: "planned", vehicleId: body.vehicleId, driverId: body.driverId, origin: body.origin, destination: body.destination, plannedDeparture: body.plannedDeparture } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString());
    recordAudit(db, user, "fleet.trip.create", "trip", id, { vehicleId: body.vehicleId, driverId: body.driverId, idempotencyKey: idem });
    return envelope;
  });

  app.patch("/api/fleet/trips/:id/status", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "fleet");
    const body = request.body || {};
    if (!body.action) { const e = new Error("action is required"); e.statusCode = 400; throw e; }
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const trip = db.prepare("SELECT id, org_id, status FROM fleet_trips WHERE id = ?").get(request.params.id);
    if (!trip || trip.org_id !== user.org_id) { const e = new Error("trip not found"); e.statusCode = 404; throw e; }
    const nextStatus = fleet.tripStateMachine.next(trip.status, body.action);
    const now = new Date().toISOString();
    if (nextStatus === "in_transit") db.prepare("UPDATE fleet_trips SET status = ?, actual_departure = ? WHERE id = ?").run(nextStatus, now, trip.id);
    else if (nextStatus === "arrived") db.prepare("UPDATE fleet_trips SET status = ?, actual_arrival = ? WHERE id = ?").run(nextStatus, now, trip.id);
    else db.prepare("UPDATE fleet_trips SET status = ? WHERE id = ?").run(nextStatus, trip.id);
    const envelope = { ok: true, trip: { id: trip.id, status: nextStatus } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString());
    recordAudit(db, user, "fleet.trip.status", "trip", trip.id, { from: trip.status, to: nextStatus, idempotencyKey: idem });
    return envelope;
  });

  // ---------- Fleet: Device-pushed GPS / cold-chain (token-gated) ---------------
  app.post("/api/fleet/devices/gps-batch", async request => {
    await deviceAuth(request);
    const body = request.body || {};
    if (!Array.isArray(body.pings) || body.pings.length === 0) { const e = new Error("pings[] is required"); e.statusCode = 400; throw e; }
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    const device = request.deviceContext;
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(device.orgId, idem);
    if (existing) return JSON.parse(existing.response_json);
    const insert = db.prepare("INSERT OR IGNORE INTO fleet_gps_pings (id, vehicle_id, recorded_at, lat, lon, speed_kph, heading_deg, ignition_on, recorded_via) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    let accepted = 0, deduped = 0;
    for (const p of body.pings) {
      const res = insert.run(randomId("gps"), device.vehicleId, p.recordedAt, p.lat, p.lon, p.speedKph || null, p.headingDeg || null, p.ignitionOn ? 1 : 0, p.recordedVia || "device-http");
      if (res.changes > 0) accepted += 1; else deduped += 1;
    }
    const envelope = { ok: true, gps: { accepted, deduped, vehicleId: device.vehicleId } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(randomId("idem"), device.orgId, idem, JSON.stringify(envelope), new Date().toISOString());
    recordAudit(db, { id: "device:" + device.tokenId, org_id: device.orgId }, "fleet.device.gps-batch", "vehicle", device.vehicleId, { accepted, deduped, idempotencyKey: idem });
    return envelope;
  });

  app.post("/api/fleet/devices/cold-chain-batch", async request => {
    await deviceAuth(request);
    const body = request.body || {};
    if (!Array.isArray(body.readings) || body.readings.length === 0) { const e = new Error("readings[] is required"); e.statusCode = 400; throw e; }
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    const device = request.deviceContext;
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(device.orgId, idem);
    if (existing) return JSON.parse(existing.response_json);
    const insert = db.prepare("INSERT OR IGNORE INTO fleet_cold_chain_logs (id, vehicle_id, trip_id, recorded_at, temp_c, humidity, sensor_id, alert_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    let accepted = 0, deduped = 0;
    const rule = coldChainRules[body.category] || coldChainRules.default;
    for (const r of body.readings) {
      let alert = null;
      if (r.tempC > rule.maxTempC) alert = "over_max";
      else if (r.tempC < rule.minTempC) alert = "under_min";
      const res = insert.run(randomId("cc"), device.vehicleId, r.tripId || null, r.recordedAt, r.tempC, r.humidity || null, r.sensorId || null, alert);
      if (res.changes > 0) accepted += 1; else deduped += 1;
    }
    const envelope = { ok: true, coldChain: { accepted, deduped, rule, vehicleId: device.vehicleId } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(randomId("idem"), device.orgId, idem, JSON.stringify(envelope), new Date().toISOString());
    recordAudit(db, { id: "device:" + device.tokenId, org_id: device.orgId }, "fleet.device.cold-chain-batch", "vehicle", device.vehicleId, { accepted, deduped, rule, idempotencyKey: idem });
    return envelope;
  });

  // ---------- Fleet: Fuel / Repairs / Tires -------------------------------------
  app.post("/api/fleet/fuel-logs", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "fleet");
    const body = request.body || {};
    const required = ["vehicleId", "occurredAt", "liters", "costAmd", "odometerKm"];
    for (const f of required) if (body[f] === undefined || body[f] === null) { const e = new Error(`${f} is required`); e.statusCode = 400; throw e; }
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const id = randomId("fl");
    db.prepare("INSERT INTO fleet_fuel_logs (id, org_id, vehicle_id, occurred_at, liters, cost_amd, odometer_km, station, vendor_id, notes, file_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, user.org_id, body.vehicleId, body.occurredAt, body.liters, body.costAmd, body.odometerKm, body.station || null, body.vendorId || null, body.notes || null, body.fileId || null);
    const envelope = { ok: true, fuelLog: { id, vehicleId: body.vehicleId, liters: body.liters, costAmd: body.costAmd } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString());
    recordAudit(db, user, "fleet.fuel-log.create", "vehicle", body.vehicleId, { liters: body.liters, costAmd: body.costAmd, idempotencyKey: idem });
    return envelope;
  });

  app.post("/api/fleet/repairs", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "fleet");
    const body = request.body || {};
    const required = ["vehicleId", "occurredAt", "kind", "costAmd"];
    for (const f of required) if (!body[f]) { const e = new Error(`${f} is required`); e.statusCode = 400; throw e; }
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const id = randomId("rep");
    db.prepare("INSERT INTO fleet_repairs (id, org_id, vehicle_id, occurred_at, kind, description, cost_amd, vendor_id, odometer_km, file_id, next_due_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, user.org_id, body.vehicleId, body.occurredAt, body.kind, body.description || null, body.costAmd, body.vendorId || null, body.odometerKm || null, body.fileId || null, body.nextDueAt || null);
    const envelope = { ok: true, repair: { id, vehicleId: body.vehicleId, kind: body.kind, costAmd: body.costAmd } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString());
    recordAudit(db, user, "fleet.repair.create", "vehicle", body.vehicleId, { kind: body.kind, costAmd: body.costAmd, idempotencyKey: idem });
    return envelope;
  });

  app.post("/api/fleet/tires/install", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "fleet");
    const body = request.body || {};
    const required = ["vehicleId", "position", "installedAt"];
    for (const f of required) if (!body[f]) { const e = new Error(`${f} is required`); e.statusCode = 400; throw e; }
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const id = randomId("tir");
    db.prepare("INSERT INTO fleet_tires (id, org_id, vehicle_id, position, brand, installed_at, odometer_at_install, expected_life_km) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, user.org_id, body.vehicleId, body.position, body.brand || null, body.installedAt, body.odometerAtInstall || null, body.expectedLifeKm || null);
    const envelope = { ok: true, tire: { id, vehicleId: body.vehicleId, position: body.position } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString());
    recordAudit(db, user, "fleet.tire.install", "vehicle", body.vehicleId, { position: body.position, idempotencyKey: idem });
    return envelope;
  });

  // ---------- Fleet: Analytics ---------------------------------------------------
  app.get("/api/fleet/vehicles/:id/cold-chain-compliance", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "fleet");
    const tripId = String(request.query.tripId || "");
    const category = String(request.query.category || "default");
    const rows = db.prepare("SELECT recorded_at AS recordedAt, temp_c AS tempC FROM fleet_cold_chain_logs WHERE vehicle_id = ? AND (? = '' OR trip_id = ?) ORDER BY recorded_at ASC")
      .all(request.params.id, tripId, tripId);
    const report = fleet.coldChainCompliance(rows, { category, maxMinutesOutOfRange: (coldChainRules[category] || coldChainRules.default).maxMinutesOutOfRange });
    return { ok: true, vehicleId: request.params.id, tripId: tripId || null, category, report };
  });

  app.get("/api/fleet/analytics/fuel-efficiency", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "fleet");
    const periodKey = String(request.query.periodKey || "");
    if (!/^\d{4}-\d{2}$/.test(periodKey)) { const e = new Error("periodKey must be YYYY-MM"); e.statusCode = 400; throw e; }
    const rows = db.prepare(
      "SELECT vehicle_id AS vehicleId, liters, odometer_km AS odometerKm, occurred_at AS occurredAt FROM fleet_fuel_logs WHERE org_id = ? AND substr(occurred_at, 1, 7) = ? ORDER BY vehicle_id, occurred_at ASC"
    ).all(user.org_id, periodKey);
    const grouped = {};
    for (const r of rows) {
      const g = grouped[r.vehicleId] || (grouped[r.vehicleId] = { vehicleId: r.vehicleId, liters: 0, odometerDelta: 0 });
      if (g.odometerAtStart === undefined) g.odometerAtStart = r.odometerKm;
      g.odometerAtEnd = r.odometerKm;
      g.liters += r.liters;
    }
    const result = Object.values(grouped).map(g => {
      const km = Math.max(0, (g.odometerAtEnd || 0) - (g.odometerAtStart || 0));
      return { vehicleId: g.vehicleId, ...fleet.fuelEfficiency({ liters: g.liters, km }) };
    });
    return { ok: true, periodKey, vehicles: result };
  });

  app.get("/api/fleet/analytics/maintenance-backlog", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "fleet");
    const rows = db.prepare("SELECT vehicle_id AS vehicleId, kind, next_due_at AS nextDueAt FROM fleet_repairs WHERE org_id = ? AND next_due_at IS NOT NULL AND next_due_at < ?").all(user.org_id, new Date().toISOString());
    return { ok: true, backlog: fleet.maintenanceBacklog(rows) };
  });
```

- [ ] **Step 5: Run the fleet contract suite**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/fleet.test.js 2>&1 | tail -20
```

Expected: 10 tests PASS (5 engine + 5 trips route). No regressions.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, total test count increases by at least 5.

- [ ] **Step 7: Commit the routes**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/fleet/deviceAuth.js server/fleet/coldChainRules.json server/app.js && git commit -m "feat(fleet): wire 12 routes + device-token middleware + cold-chain rules" && git push ant main
```

## Task 5: React panel with 7 tabs

**Files:**
- Create: `web/src/fleet.jsx`
- Read: `web/src/copilot.jsx` (style reference)

- [ ] **Step 1: Create the component**

```jsx
import React, { useState } from "react";

const TABS = [
  { key: "vehicles",    label: "Տրանսպորտ" },
  { key: "drivers",     label: "Վարորդներ" },
  { key: "trips",       label: "Ուղերձներ" },
  { key: "fuel",        label: "Վառելիք" },
  { key: "repairs",     label: "Վերանորոգում" },
  { key: "tires",       label: "Անվադողեր" },
  { key: "cold_chain",  label: "Սառը շղթա" }
];

export function FleetPanel({ onAction, actionState }) {
  const [tab, setTab] = useState("vehicles");
  return (
    <article className="panel fleet-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Differentiator #2</span>
          <h2>Ավտոպարկ</h2>
        </div>
        <nav className="row" role="tablist">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              className={"mini-action" + (tab === t.key ? " is-active" : "")}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
            >{t.label}</button>
          ))}
        </nav>
      </div>
      <div className="copilot-result">
        {tab === "vehicles"    && <VehiclesTab    onAction={onAction} actionState={actionState} />}
        {tab === "drivers"     && <DriversTab     onAction={onAction} actionState={actionState} />}
        {tab === "trips"       && <TripsTab       onAction={onAction} actionState={actionState} />}
        {tab === "fuel"        && <FuelTab        onAction={onAction} actionState={actionState} />}
        {tab === "repairs"     && <RepairsTab     onAction={onAction} actionState={actionState} />}
        {tab === "tires"       && <TiresTab       onAction={onAction} actionState={actionState} />}
        {tab === "cold_chain"  && <ColdChainTab   onAction={onAction} actionState={actionState} />}
      </div>
    </article>
  );
}

function BusyHint({ state, keyPrefix }) {
  if (!state || !state.startsWith(keyPrefix)) return null;
  return <span className="action-status">Բեռնվում է…</span>;
}

function VehiclesTab({ onAction, actionState }) {
  const [plate, setPlate] = useState("");
  const [model, setModel] = useState("");
  const [refrigeration, setRefrigeration] = useState(false);
  const [result, setResult] = useState(null);
  const busy = actionState === "fleet:vehicles:create";
  async function submit(event) {
    event.preventDefault();
    const response = await onAction({ type: "fleet:vehicles:create", payload: { plate, model, refrigeration, idempotencyKey: `ui-veh-${Date.now()}` } });
    setResult(response);
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <label>Պետհամարանիշ<input value={plate} onChange={e => setPlate(e.target.value)} required /></label>
      <label>Մոդել<input value={model} onChange={e => setModel(e.target.value)} /></label>
      <label className="row"><input type="checkbox" checked={refrigeration} onChange={e => setRefrigeration(e.target.checked)} /> Սառնարան</label>
      <button className="mini-action" type="submit" disabled={busy}>{busy ? "Ավելացվում է" : "Ավելացնել"}</button>
      <BusyHint state={actionState} keyPrefix="fleet:vehicles" />
      {result && result.vehicle && <p>Ստեղծվեց՝ <strong>{result.vehicle.plate}</strong></p>}
    </form>
  );
}

function DriversTab({ onAction, actionState }) {
  const [licenseNo, setLicenseNo] = useState("");
  const [result, setResult] = useState(null);
  const busy = actionState === "fleet:drivers:create";
  async function submit(event) {
    event.preventDefault();
    const response = await onAction({ type: "fleet:drivers:create", payload: { licenseNo, idempotencyKey: `ui-drv-${Date.now()}` } });
    setResult(response);
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <label>Վարորդական վկայական<input value={licenseNo} onChange={e => setLicenseNo(e.target.value)} required /></label>
      <button className="mini-action" type="submit" disabled={busy}>{busy ? "Ավելացվում է" : "Ավելացնել"}</button>
      {result && result.driver && <p>Վարորդ՝ <strong>{result.driver.licenseNo}</strong></p>}
    </form>
  );
}

function TripsTab({ onAction, actionState }) {
  const [form, setForm] = useState({ vehicleId: "v-test-1", driverId: "d-test-1", origin: "Yerevan", destination: "Gyumri", plannedDeparture: "2026-06-08T08:00:00Z" });
  const [result, setResult] = useState(null);
  const busy = actionState === "fleet:trips:create";
  function setField(key, value) { setForm(prev => ({ ...prev, [key]: value })); }
  async function submit(event) {
    event.preventDefault();
    const response = await onAction({ type: "fleet:trips:create", payload: { ...form, idempotencyKey: `ui-trip-${Date.now()}` } });
    setResult(response);
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <label>Տրանսպորտ<input value={form.vehicleId} onChange={e => setField("vehicleId", e.target.value)} required /></label>
      <label>Վարորդ<input value={form.driverId} onChange={e => setField("driverId", e.target.value)} required /></label>
      <label>Որտեղից<input value={form.origin} onChange={e => setField("origin", e.target.value)} required /></label>
      <label>Ուր<input value={form.destination} onChange={e => setField("destination", e.target.value)} required /></label>
      <label>Ժամը<input type="datetime-local" value={form.plannedDeparture.slice(0, 16)} onChange={e => setField("plannedDeparture", e.target.value + ":00Z")} required /></label>
      <button className="mini-action" type="submit" disabled={busy}>{busy ? "Ուղարկվում է" : "Պլանավորել"}</button>
      {result && result.trip && <p>Փոխադրում #{result.trip.id}՝ {result.trip.status}</p>}
    </form>
  );
}

function FuelTab({ onAction, actionState }) {
  const [form, setForm] = useState({ vehicleId: "v-test-1", occurredAt: "2026-06-08T09:00:00Z", liters: 60, costAmd: 28800, odometerKm: 12000, station: "" });
  const [result, setResult] = useState(null);
  const busy = actionState === "fleet:fuel:create";
  function setField(key, value) { setForm(prev => ({ ...prev, [key]: value })); }
  async function submit(event) {
    event.preventDefault();
    const response = await onAction({ type: "fleet:fuel:create", payload: { ...form, station: form.station || null, idempotencyKey: `ui-fuel-${Date.now()}` } });
    setResult(response);
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <label>Տրանսպորտ<input value={form.vehicleId} onChange={e => setField("vehicleId", e.target.value)} required /></label>
      <label>Լիտրեր<input type="number" value={form.liters} onChange={e => setField("liters", Number(e.target.value))} required /></label>
      <label>Արժեք (AMD)<input type="number" value={form.costAmd} onChange={e => setField("costAmd", Number(e.target.value))} required /></label>
      <label>Հաշվիչ<input type="number" value={form.odometerKm} onChange={e => setField("odometerKm", Number(e.target.value))} required /></label>
      <label>Կայան<input value={form.station} onChange={e => setField("station", e.target.value)} /></label>
      <button className="mini-action" type="submit" disabled={busy}>{busy ? "Պահվում է" : "Ավելացնել"}</button>
      {result && result.fuelLog && <p>Վառելիք՝ {result.fuelLog.liters}լ</p>}
    </form>
  );
}

function RepairsTab({ onAction, actionState }) {
  const [form, setForm] = useState({ vehicleId: "v-test-1", occurredAt: "2026-06-08T10:00:00Z", kind: "brake_pads", costAmd: 45000, description: "" });
  const [result, setResult] = useState(null);
  const busy = actionState === "fleet:repairs:create";
  function setField(key, value) { setForm(prev => ({ ...prev, [key]: value })); }
  async function submit(event) {
    event.preventDefault();
    const response = await onAction({ type: "fleet:repairs:create", payload: { ...form, idempotencyKey: `ui-rep-${Date.now()}` } });
    setResult(response);
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <label>Տեսակ<input value={form.kind} onChange={e => setField("kind", e.target.value)} required /></label>
      <label>Արժեք (AMD)<input type="number" value={form.costAmd} onChange={e => setField("costAmd", Number(e.target.value))} required /></label>
      <label>Նկարագրություն<input value={form.description} onChange={e => setField("description", e.target.value)} /></label>
      <button className="mini-action" type="submit" disabled={busy}>{busy ? "Պահվում է" : "Ավելացնել"}</button>
      {result && result.repair && <p>Վերանորոգում՝ {result.repair.kind}</p>}
    </form>
  );
}

function TiresTab({ onAction, actionState }) {
  const [form, setForm] = useState({ vehicleId: "v-test-1", position: "FL", installedAt: "2026-06-08T11:00:00Z" });
  const [result, setResult] = useState(null);
  const busy = actionState === "fleet:tires:install";
  function setField(key, value) { setForm(prev => ({ ...prev, [key]: value })); }
  async function submit(event) {
    event.preventDefault();
    const response = await onAction({ type: "fleet:tires:install", payload: { ...form, idempotencyKey: `ui-tir-${Date.now()}` } });
    setResult(response);
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <label>Տրանսպորտ<input value={form.vehicleId} onChange={e => setField("vehicleId", e.target.value)} required /></label>
      <label>Դիրք (FL/FR/RL/RR)<input value={form.position} onChange={e => setField("position", e.target.value)} required /></label>
      <button className="mini-action" type="submit" disabled={busy}>{busy ? "Տեղադրվում է" : "Տեղադրել"}</button>
      {result && result.tire && <p>Անվադող՝ {result.tire.position}</p>}
    </form>
  );
}

function ColdChainTab({ onAction, actionState }) {
  const [vehicleId, setVehicleId] = useState("v-test-1");
  const [tripId, setTripId] = useState("");
  const [result, setResult] = useState(null);
  const busy = actionState === "fleet:cold:report";
  async function submit(event) {
    event.preventDefault();
    const response = await onAction({ type: "fleet:cold:report", payload: { vehicleId, tripId: tripId || undefined } });
    setResult(response);
  }
  const report = result && result.report;
  return (
    <form className="inline-form" onSubmit={submit}>
      <label>Տրանսպորտ<input value={vehicleId} onChange={e => setVehicleId(e.target.value)} required /></label>
      <label>Փոխադրում (ըստ ցանկության)<input value={tripId} onChange={e => setTripId(e.target.value)} /></label>
      <button className="mini-action" type="submit" disabled={busy}>{busy ? "Հաշվարկվում է" : "Հաշվետվություն"}</button>
      {report && (
        <div className="copilot-result">
          <p>Ամենաբարձր ջերմաստիճան՝ <strong>{report.worstTempC ?? "—"}°C</strong></p>
          <p>Խախտումներ՝ {report.breaches.length}</p>
          {report.breaches.length > 0 && <p className="aging-badge">Ուշադրություն պահանջող</p>}
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Mount the panel in `web/src/main.jsx`**

Near other panel imports at the top of `web/src/main.jsx`, add:

```jsx
import { FleetPanel } from "./fleet.jsx";
```

Inside the `Workspace` component, add a dispatcher (placed next to other action dispatchers):

```jsx
const submitFleet = async ({ type, payload }) => {
  setActionState(type);
  setActionError("");
  try {
    const path = {
      "fleet:vehicles:create": "/api/fleet/vehicles",
      "fleet:drivers:create":  "/api/fleet/drivers",
      "fleet:trips:create":    "/api/fleet/trips",
      "fleet:fuel:create":     "/api/fleet/fuel-logs",
      "fleet:repairs:create":  "/api/fleet/repairs",
      "fleet:tires:install":   "/api/fleet/tires/install",
      "fleet:cold:report":     `/api/fleet/vehicles/${encodeURIComponent(payload.vehicleId)}/cold-chain-compliance${payload.tripId ? `?tripId=${encodeURIComponent(payload.tripId)}` : ""}`
    }[type];
    if (!path) throw new Error(`unknown fleet action: ${type}`);
    const method = type === "fleet:cold:report" ? "GET" : "POST";
    return await api(path, { method, body: payload });
  } finally {
    setActionState("");
  }
};
```

Render `<FleetPanel onAction={submitFleet} actionState={actionState} />` next to the existing `<HealthcheckPanel>` mount.

- [ ] **Step 3: Build the UI**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm run build:ui 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 4: Commit UI integration**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add web/src/fleet.jsx web/src/main.jsx && git commit -m "feat(fleet): mount 7-tab FleetPanel with Armenian labels" && git push ant main
```

## Task 6: Extended routes — device-token, fuel-efficiency, maintenance-backlog, cold-chain compliance tests

**Files:**
- Modify: `test/fleet.test.js` (append additional contract tests for the 7 remaining routes; the 5 trips routes are already covered)

- [ ] **Step 1: Append additional contract tests**

Append to `test/fleet.test.js`:

```js
test("POST /api/fleet/vehicles: 401 no auth", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try { await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/fleet/vehicles", payload: { plate: "AA 111 BB" } });
    assert.strictEqual(res.statusCode, 401);
  } finally { await app.close(); }
});

test("POST /api/fleet/vehicles: 403 wrong app role", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try { await app.ready();
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({ method: "POST", url: "/api/fleet/vehicles", headers: { cookie }, payload: { plate: "AA 111 BB" } });
    assert.strictEqual(res.statusCode, 403);
  } finally { await app.close(); }
});

test("POST /api/fleet/vehicles: 400 missing plate", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try { await app.ready();
    const cookie = await login(app);
    const res = await app.inject({ method: "POST", url: "/api/fleet/vehicles", headers: { cookie }, payload: {} });
    assert.strictEqual(res.statusCode, 400);
  } finally { await app.close(); }
});

test("POST /api/fleet/vehicles: 200 happy path + audit +1", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try { await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const res = await app.inject({ method: "POST", url: "/api/fleet/vehicles", headers: { cookie }, payload: { plate: "34 AB 1234", model: "MAN TGL", refrigeration: true, idempotencyKey: "veh-1" } });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(res.json().vehicle.plate, "34 AB 1234");
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.strictEqual(after, before + 1);
  } finally { await app.close(); }
});

test("POST /api/fleet/vehicles: idempotent replay (cached body, +0 audit)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try { await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const payload = { method: "POST", url: "/api/fleet/vehicles", headers: { cookie }, payload: { plate: "34 AB 1234", idempotencyKey: "veh-2" } };
    const a = await app.inject(payload);
    const b = await app.inject(payload);
    assert.strictEqual(a.statusCode, 200);
    assert.strictEqual(b.statusCode, 200);
    assert.deepStrictEqual(a.json(), b.json());
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.strictEqual(after, before + 1);
  } finally { await app.close(); }
});

test("POST /api/fleet/devices/gps-batch: 401 without device token", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try { await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/fleet/devices/gps-batch", payload: { pings: [{ recordedAt: "2026-06-08T10:00:00Z", lat: 40.1, lon: 44.5 }] } });
    assert.strictEqual(res.statusCode, 401);
  } finally { await app.close(); }
});

test("POST /api/fleet/devices/gps-batch: 200 happy path with seeded token + audit +1", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try { await app.ready();
    const cookie = await login(app);
    const tokenRes = await app.inject({ method: "POST", url: "/api/fleet/vehicles", headers: { cookie }, payload: { plate: "34 CC 0001", idempotencyKey: "veh-token" } });
    const vehicleId = tokenRes.json().vehicle.id;
    // Seed a device token directly (admin bootstrap).
    const tokenHash = require("crypto").createHash("sha256").update("devtoken-xyz").digest("hex");
    app.db.prepare("INSERT INTO fleet_device_tokens (id, org_id, vehicle_id, token_hash, label, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").run("tkn-1", "org-1", vehicleId, tokenHash, "gps-unit-1", new Date().toISOString());
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const res = await app.inject({ method: "POST", url: "/api/fleet/devices/gps-batch", headers: { "x-device-token": "devtoken-xyz" }, payload: { pings: [{ recordedAt: "2026-06-08T10:00:00Z", lat: 40.1, lon: 44.5, speedKph: 60 }], idempotencyKey: "gps-1" } });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(res.json().gps.accepted, 1);
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.strictEqual(after, before + 1);
  } finally { await app.close(); }
});

test("POST /api/fleet/devices/gps-batch: replay is idempotent (+0 audit)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try { await app.ready();
    const cookie = await login(app);
    const tokenRes = await app.inject({ method: "POST", url: "/api/fleet/vehicles", headers: { cookie }, payload: { plate: "34 DD 0001", idempotencyKey: "veh-rep" } });
    const vehicleId = tokenRes.json().vehicle.id;
    const tokenHash = require("crypto").createHash("sha256").update("devtoken-rep").digest("hex");
    app.db.prepare("INSERT INTO fleet_device_tokens (id, org_id, vehicle_id, token_hash, label, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").run("tkn-2", "org-1", vehicleId, tokenHash, "gps-unit-2", new Date().toISOString());
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const body = { pings: [{ recordedAt: "2026-06-08T10:00:00Z", lat: 40.2, lon: 44.6 }], idempotencyKey: "gps-rep-1" };
    const a = await app.inject({ method: "POST", url: "/api/fleet/devices/gps-batch", headers: { "x-device-token": "devtoken-rep" }, payload: body });
    const b = await app.inject({ method: "POST", url: "/api/fleet/devices/gps-batch", headers: { "x-device-token": "devtoken-rep" }, payload: body });
    assert.strictEqual(a.statusCode, 200);
    assert.strictEqual(b.statusCode, 200);
    assert.deepStrictEqual(a.json(), b.json());
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.strictEqual(after, before + 1);
  } finally { await app.close(); }
});

test("GET /api/fleet/analytics/fuel-efficiency: 400 on bad periodKey", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try { await app.ready();
    const cookie = await login(app);
    const res = await app.inject({ method: "GET", url: "/api/fleet/analytics/fuel-efficiency?periodKey=bad", headers: { cookie } });
    assert.strictEqual(res.statusCode, 400);
  } finally { await app.close(); }
});

test("GET /api/fleet/analytics/fuel-efficiency: 200 returns L/100km", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try { await app.ready();
    const cookie = await login(app);
    // Seed two fuel logs in the same month for the same vehicle.
    const vehRes = await app.inject({ method: "POST", url: "/api/fleet/vehicles", headers: { cookie }, payload: { plate: "34 EE 0001", idempotencyKey: "veh-eff" } });
    const vehicleId = vehRes.json().vehicle.id;
    const now = "2026-06-08T08:00:00Z";
    await app.inject({ method: "POST", url: "/api/fleet/fuel-logs", headers: { cookie }, payload: { vehicleId, occurredAt: now, liters: 50, costAmd: 24000, odometerKm: 1000, idempotencyKey: "fuel-eff-1" } });
    await app.inject({ method: "POST", url: "/api/fleet/fuel-logs", headers: { cookie }, payload: { vehicleId, occurredAt: now, liters: 40, costAmd: 19200, odometerKm: 1500, idempotencyKey: "fuel-eff-2" } });
    const res = await app.inject({ method: "GET", url: "/api/fleet/analytics/fuel-efficiency?periodKey=2026-06", headers: { cookie } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.periodKey, "2026-06");
    const row = body.vehicles.find(v => v.vehicleId === vehicleId);
    assert.ok(row, "vehicle must appear in efficiency report");
    // 90L over 500km = 18 L/100km
    assert.strictEqual(row.lPer100km, 18);
  } finally { await app.close(); }
});

test("GET /api/fleet/analytics/maintenance-backlog: 200 empty list when none overdue", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try { await app.ready();
    const cookie = await login(app);
    const res = await app.inject({ method: "GET", url: "/api/fleet/analytics/maintenance-backlog", headers: { cookie } });
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json().backlog, []);
  } finally { await app.close(); }
});

test("PATCH /api/fleet/trips/:id/status: enforces state machine (400 on bad transition)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try { await app.ready();
    const cookie = await login(app);
    const t = await app.inject({ method: "POST", url: "/api/fleet/trips", headers: { cookie }, payload: { vehicleId: "v", driverId: "d", origin: "A", destination: "B", plannedDeparture: "2026-06-08T08:00:00Z", idempotencyKey: "trp-sm-1" } });
    const tripId = t.json().trip.id;
    // planned -> arrived is illegal.
    const res = await app.inject({ method: "PATCH", url: `/api/fleet/trips/${tripId}/status`, headers: { cookie }, payload: { action: "arrived", idempotencyKey: "trp-sm-2" } });
    assert.strictEqual(res.statusCode, 400);
  } finally { await app.close(); }
});

test("GET /api/fleet/vehicles/:id/cold-chain-compliance: 200 returns report with 0 breaches for safe data", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try { await app.ready();
    const cookie = await login(app);
    const v = await app.inject({ method: "POST", url: "/api/fleet/vehicles", headers: { cookie }, payload: { plate: "34 FF 0001", refrigeration: true, idempotencyKey: "veh-cc" } });
    const vehicleId = v.json().vehicle.id;
    // Seed 3 safe pings.
    for (let i = 0; i < 3; i += 1) {
      app.db.prepare("INSERT INTO fleet_cold_chain_logs (id, vehicle_id, trip_id, recorded_at, temp_c) VALUES (?, ?, ?, ?, ?)").run(`cc-${i}`, vehicleId, null, `2026-06-08T10:0${i}:00Z`, 4);
    }
    const res = await app.inject({ method: "GET", url: `/api/fleet/vehicles/${vehicleId}/cold-chain-compliance?category=dairy`, headers: { cookie } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.category, "dairy");
    assert.deepStrictEqual(body.report.breaches, []);
  } finally { await app.close(); }
});
```

- [ ] **Step 2: Run the extended suite**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/fleet.test.js 2>&1 | tail -20
```

Expected: 24 tests PASS (5 engine + 5 trips + 5 vehicles + 4 GPS + 2 analytics + 1 state machine + 1 cold-chain + 1 maintenance).

- [ ] **Step 3: Run the full test suite to confirm no regressions**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, total test count increases by at least 19 (24 fleet − 5 existing).

- [ ] **Step 4: Commit extended coverage**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add test/fleet.test.js && git commit -m "test(fleet): cover vehicles, GPS device-token, analytics, state machine, cold-chain" && git push ant main
```

## Task 7: Handoff + tag `fleet-mvp`

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update the first status line and add a completed bullet**

In `HANDOFF.md`, replace the first line with the new tag count and test result, e.g.:

```markdown
_Last updated: 2026-06-08 · main after Fleet Management · N tags · M tests (M pass, 0 fail, 0 cancelled)_
```

Add a bullet:

```markdown
- **Fleet Management (sub-plan 9)** — DONE: pure `server/fleet.js` engine (state machine, trip cost, fuel efficiency, cold-chain compliance, driver HoS, maintenance backlog) + 12 routes incl. token-gated `/api/fleet/devices/*` + 7-tab Armenian `FleetPanel` + 24-test contract suite, linked to warehouse (parts) and export (trip docs).
```

- [ ] **Step 2: Commit handoff**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add HANDOFF.md && git commit -m "docs: record fleet-management sub-plan verification" && git push ant main
```

- [ ] **Step 3: Tag the milestone**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git tag fleet-mvp && git push ant fleet-mvp
```

---

## Final Self-Review Checklist (sub-plan 9)

- [ ] `test/fleet.test.js` fails before the engine exists (RED)
- [ ] `test/fleet.test.js` passes once the engine + routes are wired (GREEN, 24 tests)
- [ ] `npm test` total count increases by at least 19 with no regressions
- [ ] `npm run build:ui` succeeds after the React panel mounts
- [ ] 401 on no-auth for every user-scoped mutation route (vehicles, drivers, trips, fuel-logs, repairs, tires/install)
- [ ] 403 on missing `fleet` app access for every user-scoped mutation route
- [ ] 400 on malformed input for every mutation route (missing plate / licenseNo / vehicleId / etc.)
- [ ] 200 happy path writes exactly 1 `audit_events` row per successful call
- [ ] Idempotent replay (same `idempotencyKey`) returns the cached body and does not double-write `audit_events`
- [ ] Device-pushed GPS / cold-chain endpoints reject requests without `X-Device-Token` (401) and do NOT use the user session
- [ ] Cold-chain compliance report correctly flags a sustained >30-minute breach at 6.5°C for the `dairy` category
- [ ] Driver hours-of-service balance correctly rejects a 660-minute trip against a 600-minute cap
- [ ] Trip state machine refuses `planned → arrived` (skipping `departed`) and refuses any transition out of `arrived`
- [ ] Fuel efficiency `L/100km` math is correct (90L over 500km → 18)
- [ ] Maintenance backlog returns overdue items only (not future-dated ones)
- [ ] `HANDOFF.md` updated with the new tag and test count
- [ ] `fleet-mvp` tag pushed to `ant`
