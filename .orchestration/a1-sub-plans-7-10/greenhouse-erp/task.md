# Worker Task: greenhouse-erp
- Session: `a1-sub-plans-7-10`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-a1-sub-plans-7-10-greenhouse-erp`
- Branch: `a1/sub-plan-greenhouse-erp`
- Launcher status file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/a1-sub-plans-7-10/greenhouse-erp/status.md`
- Launcher handoff file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/a1-sub-plans-7-10/greenhouse-erp/handoff.md`
- Tag to ship: `greenhouse-erp-mvp`
## Seeded Local Overlays
- `HANDOFF.md`
- `package.json`
## Plan File
Path: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/docs/superpowers/plans/2026-06-08-a1-suite-ant-greenhouse-erp.md`
### Plan File Contents
<plan>
# Sub-Plan 10: Greenhouse ERP (Тепличное производство) — Differentiator #3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uniquely Armenian module for greenhouse operations (Armosphère and similar): yield tracking, climate data, energy use, CO₂ enrichment, bioprotection, harvest scheduling. Linked to Warehouse (sub-plan 2) for harvest receipts, Asset Management (sub-plan 8) for greenhouse asset, and Procurement (sub-plan 3) for inputs.

**Architecture:** Pattern A module `server/greenhouse.js` (pure engine: yield forecasting, growing-degree-day calc, energy efficiency per kg, bioprotection alert rules) + `web/src/greenhouse.jsx` panel (Greenhouses / Zones / Crops / Climate / Energy / Harvests / Bioprotection tabs) + `test/greenhouse.test.js`. New tables: `greenhouses`, `greenhouse_zones`, `greenhouse_crops`, `greenhouse_climate_logs`, `greenhouse_energy_logs`, `greenhouse_harvests`, `greenhouse_bioprotection_logs`. Each greenhouse is also an `assets` row (sub-plan 8) so the existing asset engine covers its own depreciation + maintenance.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. Climate + energy sensors push via the same `deviceAuth` middleware as fleet (sub-plan 9). Charts: SVG line + bar. No external dep.

**Depends on:** sub-plan 0 (Pattern A skeleton), sub-plan 2 (warehouse for harvest receipt), sub-plan 3 (procurement for inputs), sub-plan 8 (assets for greenhouse asset record), sub-plan 9 (device-push pattern).

---

## File Structure

- Create: `server/greenhouse.js` — pure engine: `computeYieldVsForecast`, `computeGdd`, `computeEnergyPerKg`, `enforceWithdrawalPeriod`, `forecastYield`, `alertClimateAnomaly`.
- Create: `server/greenhouseAi.js` — OpenRouter-gated AI helper mirroring Copilot pattern.
- Modify: `server/db.js` — append 7 new tables (`greenhouses`, `greenhouse_zones`, `greenhouse_crops`, `greenhouse_climate_logs`, `greenhouse_energy_logs`, `greenhouse_harvests`, `greenhouse_bioprotection_logs`) inside the migration block.
- Modify: `server/app.js` — register 13 routes near the existing fleet routes; reuse `deviceAuth` for batch endpoints.
- Create: `web/src/greenhouse.jsx` — 7-tab React panel (Greenhouses / Zones / Crops / Climate / Energy / Harvests / Bioprotection).
- Modify: `web/src/main.jsx` — import + mount `GreenhousePanel`.
- Modify: `web/src/locale.js` — add Armenian labels for greenhouse tabs.
- Create: `test/greenhouse.test.js` — full contract suite (auth, app access, validation, audit, idempotency, withdrawal period, GDD math, energy-per-kg math, yield forecast, device-push idempotency).
- Modify: `HANDOFF.md` — add completed bullet + tag.

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

---

## Tasks

### Task 1: Define the RED contract suite for the greenhouse module

**Files:**
- Create: `test/greenhouse.test.js`
- Read: `test/healthcheck.test.js` (Pattern A style reference)
- Read: `test/fleet.test.js` (device-push + idempotency style reference)
- Read: `server/db.js` to confirm `DEFAULT_EMAIL`, `DEFAULT_PASSWORD`, and existing `audit_events` / `idempotency_keys` table names

- [ ] **Step 1: Write the failing test file**

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

async function loginAs(app, email) {
  return login(app, email, DEFAULT_PASSWORD);
}

async function createHouse(app, cookie, idempotencyKey, overrides = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/api/greenhouse/houses",
    headers: { cookie },
    payload: {
      name: overrides.name || "Armosphère-1",
      areaM2: overrides.areaM2 || 1200,
      glazingKind: overrides.glazingKind || "glass",
      heatingKind: overrides.heatingKind || "gas",
      idempotencyKey
    }
  });
  return res;
}

test("greenhouse create is auth-gated", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await createHouse(app, "", "gh-noauth-1");
    assert.strictEqual(res.statusCode, 401);
  } finally { await app.close(); }
});

test("greenhouse create requires app access", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await loginAs(app, "support@armosphera.local");
    const res = await createHouse(app, cookie, "gh-noaccess-1");
    assert.strictEqual(res.statusCode, 403);
  } finally { await app.close(); }
});

test("greenhouse create validates input", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/greenhouse/houses",
      headers: { cookie },
      payload: { idempotencyKey: "gh-bad-1" }
    });
    assert.strictEqual(res.statusCode, 400);
  } finally { await app.close(); }
});

test("greenhouse create writes audit row + idempotency replay", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    const payload = {
      method: "POST",
      url: "/api/greenhouse/houses",
      headers: { cookie },
      payload: { name: "Armosphère-1", areaM2: 1200, glazingKind: "glass", heatingKind: "gas", idempotencyKey: "gh-happy-1" }
    };
    const first = await app.inject(payload);
    const second = await app.inject(payload);
    assert.strictEqual(first.statusCode, 200, first.body);
    assert.strictEqual(second.statusCode, 200);
    assert.deepStrictEqual(first.json(), second.json());
    const body = first.json();
    assert.strictEqual(body.ok, true);
    assert.ok(body.greenhouse.id);
    assert.ok(body.greenhouse.assetId, "greenhouse must be linked to a new assets row");
    const after = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    assert.strictEqual(after, before + 1);
  } finally { await app.close(); }
});

test("zone + crop create chain", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const house = await createHouse(app, cookie, "gh-chain-1");
    const houseId = house.json().greenhouse.id;
    const zone = await app.inject({
      method: "POST", url: "/api/greenhouse/zones", headers: { cookie },
      payload: { greenhouseId: houseId, name: "Zone A", areaM2: 400, irrigationKind: "drip", idempotencyKey: "gh-zone-1" }
    });
    assert.strictEqual(zone.statusCode, 200, zone.body);
    const zoneId = zone.json().zone.id;
    const crop = await app.inject({
      method: "POST", url: "/api/greenhouse/crops", headers: { cookie },
      payload: { zoneId, cropKind: "tomato", plantedAt: "2026-04-01", expectedHarvestAt: "2026-07-15", expectedYieldKg: 1500, seedSource: "Hazera", idempotencyKey: "gh-crop-1" }
    });
    assert.strictEqual(crop.statusCode, 200, crop.body);
    assert.strictEqual(crop.json().crop.status, "planted");
  } finally { await app.close(); }
});

test("climate device batch is idempotent on token+idempotencyKey", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const house = await createHouse(app, cookie, "gh-cli-1");
    const houseId = house.json().greenhouse.id;
    const zone = await app.inject({
      method: "POST", url: "/api/greenhouse/zones", headers: { cookie },
      payload: { greenhouseId: houseId, name: "Zone B", areaM2: 300, irrigationKind: "drip", idempotencyKey: "gh-cli-zone-1" }
    });
    const zoneId = zone.json().zone.id;
    const deviceToken = app.db.prepare("SELECT token FROM device_tokens ORDER BY id LIMIT 1").get().token;
    const payload = {
      method: "POST",
      url: "/api/greenhouse/devices/climate-batch",
      headers: { "x-device-token": deviceToken },
      payload: { zoneId, readings: [
        { recordedAt: "2026-06-08T08:00:00Z", tempC: 22.5, humidity: 65, lightLux: 18000, co2Ppm: 800, sensorId: "s-1" },
        { recordedAt: "2026-06-08T09:00:00Z", tempC: 24.0, humidity: 60, lightLux: 24000, co2Ppm: 850, sensorId: "s-1" }
      ], idempotencyKey: "gh-cli-batch-1" }
    };
    const first = await app.inject(payload);
    const second = await app.inject(payload);
    assert.strictEqual(first.statusCode, 200);
    assert.strictEqual(second.statusCode, 200);
    assert.deepStrictEqual(first.json(), second.json());
  } finally { await app.close(); }
});

test("bioprotection blocks harvest inside withdrawal window", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const house = await createHouse(app, cookie, "gh-wd-1");
    const houseId = house.json().greenhouse.id;
    const zone = await app.inject({
      method: "POST", url: "/api/greenhouse/zones", headers: { cookie },
      payload: { greenhouseId: houseId, name: "Zone C", areaM2: 250, irrigationKind: "drip", idempotencyKey: "gh-wd-zone-1" }
    });
    const zoneId = zone.json().zone.id;
    const crop = await app.inject({
      method: "POST", url: "/api/greenhouse/crops", headers: { cookie },
      payload: { zoneId, cropKind: "cucumber", plantedAt: "2026-05-01", expectedHarvestAt: "2026-07-01", expectedYieldKg: 900, seedSource: "Rijk Zwaan", idempotencyKey: "gh-wd-crop-1" }
    });
    const cropId = crop.json().crop.id;
    await app.inject({
      method: "POST", url: "/api/greenhouse/bioprotection", headers: { cookie },
      payload: { zoneId, appliedAt: "2026-06-07", agentKind: "Spinosad", dose: "0.3 l/ha", targetPest: "thrips", withdrawalPeriodDays: 7, recordedBy: "agronomist", idempotencyKey: "gh-wd-app-1" }
    });
    const blocked = await app.inject({
      method: "POST", url: "/api/greenhouse/harvests", headers: { cookie },
      payload: { cropId, harvestedAt: "2026-06-08", quantityKg: 100, qualityGrade: "A", idempotencyKey: "gh-wd-block-1" }
    });
    assert.strictEqual(blocked.statusCode, 409, blocked.body);
    const ok = await app.inject({
      method: "POST", url: "/api/greenhouse/harvests", headers: { cookie },
      payload: { cropId, harvestedAt: "2026-06-15", quantityKg: 100, qualityGrade: "A", idempotencyKey: "gh-wd-ok-1" }
    });
    assert.strictEqual(ok.statusCode, 200, ok.body);
    assert.ok(ok.json().harvest.lotId, "harvest must auto-create a stock_lot");
  } finally { await app.close(); }
});

test("energy per kg and GDD math", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const energy = await app.inject({
      method: "GET",
      url: "/api/greenhouse/h1/analytics/energy?periodKey=2026-06",
      headers: { cookie }
    });
    assert.strictEqual(energy.statusCode, 200);
    const body = energy.json();
    assert.strictEqual(typeof body.energy.kwhPerKg, "number");
    assert.strictEqual(typeof body.energy.gasM3PerKg, "number");
    const gdd = await app.inject({
      method: "GET",
      url: "/api/greenhouse/h1/analytics/gdd?from=2026-04-01&to=2026-06-08&baseTempC=10",
      headers: { cookie }
    });
    assert.strictEqual(gdd.statusCode, 200);
    assert.ok(gdd.json().gdd.growingDegreeDays >= 0);
  } finally { await app.close(); }
});
```

- [ ] **Step 2: Run the test to verify it RED-fails**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/greenhouse.test.js 2>&1 | tail -20
```

Expected: FAIL — `404` on `/api/greenhouse/houses` (route not registered) and likely `SyntaxError` on the missing tables.

- [ ] **Step 3: Commit the RED tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add test/greenhouse.test.js && git commit -m "test(greenhouse): define Pattern A + device-push contract" && git push ant main
```

### Task 2: Add the 7-table DB migration to `server/db.js`

**Files:**
- Modify: `server/db.js` (append greenhouse tables at the end of the migration block, after the fleet tables)
- Read: `server/db.js` (locate the `CREATE TABLE` block; reuse `id TEXT PRIMARY KEY`, `org_id TEXT NOT NULL`, `created_at TEXT NOT NULL` patterns)

- [ ] **Step 1: Add the migration SQL**

```js
// Append inside the existing migration runner, after the fleet_* tables block:
  db.exec(`
    CREATE TABLE IF NOT EXISTS greenhouses (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      asset_id TEXT,
      area_m2 REAL NOT NULL,
      glazing_kind TEXT NOT NULL,
      heating_kind TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS greenhouse_zones (
      id TEXT PRIMARY KEY,
      greenhouse_id TEXT NOT NULL REFERENCES greenhouses(id),
      name TEXT NOT NULL,
      area_m2 REAL NOT NULL,
      irrigation_kind TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS greenhouse_crops (
      id TEXT PRIMARY KEY,
      zone_id TEXT NOT NULL REFERENCES greenhouse_zones(id),
      crop_kind TEXT NOT NULL,
      planted_at TEXT NOT NULL,
      expected_harvest_at TEXT NOT NULL,
      expected_yield_kg REAL NOT NULL,
      seed_source TEXT,
      status TEXT NOT NULL DEFAULT 'planted'
    );
    CREATE TABLE IF NOT EXISTS greenhouse_climate_logs (
      id TEXT PRIMARY KEY,
      zone_id TEXT NOT NULL REFERENCES greenhouse_zones(id),
      recorded_at TEXT NOT NULL,
      temp_c REAL NOT NULL,
      humidity REAL NOT NULL,
      light_lux REAL,
      co2_ppm REAL,
      sensor_id TEXT NOT NULL,
      batch_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_greenhouse_climate_zone_time
      ON greenhouse_climate_logs(zone_id, recorded_at);
    CREATE TABLE IF NOT EXISTS greenhouse_energy_logs (
      id TEXT PRIMARY KEY,
      greenhouse_id TEXT NOT NULL REFERENCES greenhouses(id),
      recorded_at TEXT NOT NULL,
      kwh REAL NOT NULL DEFAULT 0,
      gas_m3 REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      period_key TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_greenhouse_energy_period
      ON greenhouse_energy_logs(greenhouse_id, period_key);
    CREATE TABLE IF NOT EXISTS greenhouse_harvests (
      id TEXT PRIMARY KEY,
      crop_id TEXT NOT NULL REFERENCES greenhouse_crops(id),
      harvested_at TEXT NOT NULL,
      quantity_kg REAL NOT NULL,
      quality_grade TEXT NOT NULL,
      lot_id TEXT,
      notes TEXT,
      file_id TEXT
    );
    CREATE TABLE IF NOT EXISTS greenhouse_bioprotection_logs (
      id TEXT PRIMARY KEY,
      zone_id TEXT NOT NULL REFERENCES greenhouse_zones(id),
      applied_at TEXT NOT NULL,
      agent_kind TEXT NOT NULL,
      dose TEXT NOT NULL,
      target_pest TEXT,
      withdrawal_period_days INTEGER NOT NULL DEFAULT 0,
      recorded_by TEXT,
      file_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_greenhouse_bioprotection_zone_time
      ON greenhouse_bioprotection_logs(zone_id, applied_at);
  `);
```

- [ ] **Step 2: Run focused tests (still RED — route missing)**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/greenhouse.test.js 2>&1 | tail -10
```

Expected: still FAIL with `404` on `/api/greenhouse/houses`.

- [ ] **Step 3: Commit the migration**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/db.js && git commit -m "feat(greenhouse): add 7-table DB migration" && git push ant main
```

### Task 3: Add the pure engine module `server/greenhouse.js`

**Files:**
- Create: `server/greenhouse.js`

- [ ] **Step 1: Create the engine**

```js
"use strict";

// Pure functions only — no require('node:sqlite'), no require('fastify').

const CROP_BASELINE_KG_PER_M2 = {
  tomato: 35,
  cucumber: 45,
  pepper: 25,
  lettuce: 30,
  strawberry: 18,
  herb: 12
};

const DEFAULT_BASE_TEMP_C = 10;
const ANOMALY_HIGH_C = 38;
const ANOMALY_LOW_C = 2;

function buildHouse({ name, areaM2, glazingKind, heatingKind, now }) {
  const cleanName = String(name || "").trim();
  if (cleanName.length < 2 || cleanName.length > 80) {
    const err = new Error("name must be 2-80 chars");
    err.statusCode = 400; throw err;
  }
  const area = Number(areaM2);
  if (!Number.isFinite(area) || area <= 0 || area > 100000) {
    const err = new Error("areaM2 must be 0 < areaM2 <= 100000");
    err.statusCode = 400; throw err;
  }
  if (!["glass", "poly", "film"].includes(glazingKind)) {
    const err = new Error("glazingKind must be glass|poly|film");
    err.statusCode = 400; throw err;
  }
  if (!["gas", "electric", "biomass", "geothermal"].includes(heatingKind)) {
    const err = new Error("heatingKind must be gas|electric|biomass|geothermal");
    err.statusCode = 400; throw err;
  }
  return {
    name: cleanName,
    areaM2: area,
    glazingKind,
    heatingKind,
    createdAt: now || new Date().toISOString()
  };
}

function buildZone({ greenhouseId, name, areaM2, irrigationKind }) {
  if (!greenhouseId) { const e = new Error("greenhouseId is required"); e.statusCode = 400; throw e; }
  const cleanName = String(name || "").trim();
  if (cleanName.length < 1) { const e = new Error("name is required"); e.statusCode = 400; throw e; }
  const area = Number(areaM2);
  if (!Number.isFinite(area) || area <= 0) { const e = new Error("areaM2 must be > 0"); e.statusCode = 400; throw e; }
  if (!["drip", "sprinkler", "flood", "manual"].includes(irrigationKind)) {
    const e = new Error("irrigationKind must be drip|sprinkler|flood|manual"); e.statusCode = 400; throw e;
  }
  return { greenhouseId, name: cleanName, areaM2: area, irrigationKind };
}

function buildCrop({ zoneId, cropKind, plantedAt, expectedHarvestAt, expectedYieldKg, seedSource }) {
  if (!zoneId) { const e = new Error("zoneId is required"); e.statusCode = 400; throw e; }
  if (!CROP_BASELINE_KG_PER_M2[cropKind]) {
    const e = new Error("cropKind must be tomato|cucumber|pepper|lettuce|strawberry|herb");
    e.statusCode = 400; throw e;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plantedAt) || !/^\d{4}-\d{2}-\d{2}$/.test(expectedHarvestAt)) {
    const e = new Error("plantedAt and expectedHarvestAt must be YYYY-MM-DD"); e.statusCode = 400; throw e;
  }
  if (new Date(expectedHarvestAt) <= new Date(plantedAt)) {
    const e = new Error("expectedHarvestAt must be after plantedAt"); e.statusCode = 400; throw e;
  }
  const expected = Number(expectedYieldKg);
  if (!Number.isFinite(expected) || expected <= 0) {
    const e = new Error("expectedYieldKg must be > 0"); e.statusCode = 400; throw e;
  }
  return { zoneId, cropKind, plantedAt, expectedHarvestAt, expectedYieldKg: expected, seedSource: seedSource || null, status: "planted" };
}

function patchCropStatus({ currentStatus, nextStatus }) {
  const allowed = { planted: ["growing", "failed"], growing: ["harvested", "failed"], harvested: [], failed: [] };
  if (!allowed[currentStatus] || !allowed[currentStatus].includes(nextStatus)) {
    const e = new Error(`cannot transition from ${currentStatus} to ${nextStatus}`); e.statusCode = 400; throw e;
  }
  return { status: nextStatus };
}

function ingestClimateBatch({ zoneId, readings, batchId }) {
  if (!zoneId) { const e = new Error("zoneId is required"); e.statusCode = 400; throw e; }
  if (!Array.isArray(readings) || readings.length === 0) {
    const e = new Error("readings must be a non-empty array"); e.statusCode = 400; throw e;
  }
  const norm = readings.map((r, idx) => {
    if (!r || !r.recordedAt) { const e = new Error(`readings[${idx}].recordedAt required`); e.statusCode = 400; throw e; }
    const t = Number(r.tempC);
    if (!Number.isFinite(t)) { const e = new Error(`readings[${idx}].tempC must be a number`); e.statusCode = 400; throw e; }
    return {
      zoneId,
      recordedAt: String(r.recordedAt),
      tempC: t,
      humidity: Number(r.humidity) || 0,
      lightLux: r.lightLux == null ? null : Number(r.lightLux),
      co2Ppm: r.co2Ppm == null ? null : Number(r.co2Ppm),
      sensorId: String(r.sensorId || "unknown"),
      batchId: String(batchId)
    };
  });
  return { zoneId, readings: norm, count: norm.length };
}

function ingestEnergyBatch({ greenhouseId, readings, periodKey }) {
  if (!greenhouseId) { const e = new Error("greenhouseId is required"); e.statusCode = 400; throw e; }
  if (!Array.isArray(readings) || readings.length === 0) {
    const e = new Error("readings must be a non-empty array"); e.statusCode = 400; throw e;
  }
  if (!/^\d{4}-\d{2}$/.test(String(periodKey || ""))) {
    const e = new Error("periodKey must be YYYY-MM"); e.statusCode = 400; throw e;
  }
  const norm = readings.map((r, idx) => ({
    greenhouseId,
    recordedAt: String(r.recordedAt),
    kwh: Number(r.kwh) || 0,
    gasM3: Number(r.gasM3) || 0,
    source: String(r.source || "smart-meter"),
    periodKey: String(periodKey)
  }));
  return { greenhouseId, readings: norm, periodKey, count: norm.length };
}

function buildBioprotection({ zoneId, appliedAt, agentKind, dose, targetPest, withdrawalPeriodDays, recordedBy }) {
  if (!zoneId) { const e = new Error("zoneId is required"); e.statusCode = 400; throw e; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(appliedAt || ""))) {
    const e = new Error("appliedAt must be YYYY-MM-DD"); e.statusCode = 400; throw e;
  }
  if (!agentKind) { const e = new Error("agentKind is required"); e.statusCode = 400; throw e; }
  if (!dose) { const e = new Error("dose is required"); e.statusCode = 400; throw e; }
  const wd = Number(withdrawalPeriodDays);
  if (!Number.isInteger(wd) || wd < 0 || wd > 60) {
    const e = new Error("withdrawalPeriodDays must be integer 0-60"); e.statusCode = 400; throw e;
  }
  return { zoneId, appliedAt, agentKind, dose, targetPest: targetPest || null, withdrawalPeriodDays: wd, recordedBy: recordedBy || null };
}

function enforceWithdrawalPeriod({ bioprotectionLogs, zoneId, harvestDate }) {
  const earliestSafe = bioprotectionLogs
    .filter(log => log.zone_id === zoneId)
    .map(log => {
      const applied = new Date(log.applied_at);
      const safe = new Date(applied.getTime() + Number(log.withdrawal_period_days) * 86400000);
      return safe;
    })
    .reduce((max, d) => (d > max ? d : max), new Date(0));
  const harvest = new Date(harvestDate);
  if (harvest < earliestSafe) {
    const err = new Error(`harvest blocked: earliest safe date is ${earliestSafe.toISOString().slice(0, 10)}`);
    err.statusCode = 409; err.code = "WITHDRAWAL_PERIOD_ACTIVE"; throw err;
  }
  return { cleared: true, earliestSafeDate: earliestSafe.toISOString().slice(0, 10) };
}

function computeGdd({ climateLogs, baseTempC = DEFAULT_BASE_TEMP_C }) {
  const total = climateLogs.reduce((sum, log) => {
    const t = Number(log.temp_c);
    if (!Number.isFinite(t)) return sum;
    return sum + Math.max(0, t - baseTempC);
  }, 0);
  return { growingDegreeDays: Number(total.toFixed(2)), baseTempC, sampleSize: climateLogs.length };
}

function computeEnergyPerKg({ energyLogs, harvests }) {
  const totalKwh = energyLogs.reduce((s, l) => s + Number(l.kwh || 0), 0);
  const totalGas = energyLogs.reduce((s, l) => s + Number(l.gas_m3 || 0), 0);
  const totalKg = harvests.reduce((s, h) => s + Number(h.quantity_kg || 0), 0);
  return {
    totalKwh: Number(totalKwh.toFixed(2)),
    totalGasM3: Number(totalGas.toFixed(2)),
    totalKg: Number(totalKg.toFixed(2)),
    kwhPerKg: totalKg > 0 ? Number((totalKwh / totalKg).toFixed(4)) : 0,
    gasM3PerKg: totalKg > 0 ? Number((totalGas / totalKg).toFixed(4)) : 0
  };
}

function computeYieldVsForecast({ crops, harvests }) {
  const byCrop = new Map();
  for (const h of harvests) {
    const cur = byCrop.get(h.crop_id) || 0;
    byCrop.set(h.crop_id, cur + Number(h.quantity_kg || 0));
  }
  return crops.map(crop => {
    const actual = Number((byCrop.get(crop.id) || 0).toFixed(2));
    const expected = Number(crop.expected_yield_kg || 0);
    return {
      cropId: crop.id,
      cropKind: crop.crop_kind,
      expectedKg: expected,
      actualKg: actual,
      deltaKg: Number((actual - expected).toFixed(2)),
      pctOfForecast: expected > 0 ? Number(((actual / expected) * 100).toFixed(2)) : null
    };
  });
}

function forecastYield({ cropKind, areaM2, gdd }) {
  const baseline = CROP_BASELINE_KG_PER_M2[cropKind] || 0;
  const heat = Number.isFinite(gdd) ? Math.min(1.3, 0.7 + gdd / 1500) : 1;
  const expected = Number((baseline * areaM2 * heat).toFixed(2));
  return { cropKind, areaM2, gddUsed: gdd, baselineKgPerM2: baseline, expectedKg: expected, model: "deterministic-local-v1" };
}

function alertClimateAnomaly({ climateLogs }) {
  const alerts = [];
  for (const log of climateLogs) {
    const t = Number(log.temp_c);
    if (Number.isFinite(t) && t > ANOMALY_HIGH_C) {
      alerts.push({ kind: "OVERHEAT", zoneId: log.zone_id, recordedAt: log.recorded_at, value: t, threshold: ANOMALY_HIGH_C });
    }
    if (Number.isFinite(t) && t < ANOMALY_LOW_C) {
      alerts.push({ kind: "FROST_RISK", zoneId: log.zone_id, recordedAt: log.recorded_at, value: t, threshold: ANOMALY_LOW_C });
    }
  }
  return { alerts, count: alerts.length };
}

module.exports = {
  buildHouse,
  buildZone,
  buildCrop,
  patchCropStatus,
  ingestClimateBatch,
  ingestEnergyBatch,
  buildBioprotection,
  enforceWithdrawalPeriod,
  computeGdd,
  computeEnergyPerKg,
  computeYieldVsForecast,
  forecastYield,
  alertClimateAnomaly,
  CROP_BASELINE_KG_PER_M2
};
```

- [ ] **Step 2: Run focused tests (still RED — route not wired)**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/greenhouse.test.js 2>&1 | tail -10
```

Expected: still FAIL with `404`.

- [ ] **Step 3: Commit the engine**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/greenhouse.js && git commit -m "feat(greenhouse): add pure engine (yield, GDD, energy, withdrawal)" && git push ant main
```

### Task 4: Wire the 13 routes in `server/app.js`

**Files:**
- Modify: `server/app.js` (import + register 13 routes near the existing fleet routes; reuse `deviceAuth`, `requireAppAccess`, `recordAudit`, `idempotency` helpers)
- Read: `server/app.js` (locate the fleet routes block to match the auth/app-access pattern)

- [ ] **Step 1: Add the import near other engine imports**

```js
const greenhouse = require("./greenhouse");
```

- [ ] **Step 2: Add the 13 routes after the fleet routes block**

```js
// --- Greenhouse module -----------------------------------------------------

async function ensureAssetRow(db, user, payload) {
  const id = randomId("asset");
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO assets (id, org_id, name, kind, status, acquired_at, created_at)
              VALUES (?, ?, ?, 'greenhouse', 'active', ?, ?)`).run(
    id, user.org_id, payload.name, now, now
  );
  return id;
}

app.post("/api/greenhouse/houses", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "greenhouse");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  const built = greenhouse.buildHouse({ name: body.name, areaM2: body.areaM2, glazingKind: body.glazingKind, heatingKind: body.heatingKind, now: new Date().toISOString() });
  const id = randomId("gh");
  const assetId = ensureAssetRow(db, user, built);
  db.prepare(`INSERT INTO greenhouses (id, org_id, name, asset_id, area_m2, glazing_kind, heating_kind, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, user.org_id, built.name, assetId, built.areaM2, built.glazingKind, built.heatingKind, built.createdAt
  );
  const envelope = { ok: true, greenhouse: { id, assetId, ...built } };
  db.prepare("INSERT OR IGNORE INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
    randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString()
  );
  recordAudit(db, user, "greenhouse.house.create", "greenhouse", id, { name: built.name, areaM2: built.areaM2 });
  return envelope;
});

app.post("/api/greenhouse/zones", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "greenhouse");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  const built = greenhouse.buildZone(body);
  const id = randomId("zone");
  db.prepare(`INSERT INTO greenhouse_zones (id, greenhouse_id, name, area_m2, irrigation_kind, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`).run(
    id, built.greenhouseId, built.name, built.areaM2, built.irrigationKind, new Date().toISOString()
  );
  const envelope = { ok: true, zone: { id, ...built } };
  db.prepare("INSERT OR IGNORE INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
    randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString()
  );
  recordAudit(db, user, "greenhouse.zone.create", "greenhouse_zone", id, built);
  return envelope;
});

app.post("/api/greenhouse/crops", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "greenhouse");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  const built = greenhouse.buildCrop(body);
  const id = randomId("crop");
  db.prepare(`INSERT INTO greenhouse_crops (id, zone_id, crop_kind, planted_at, expected_harvest_at, expected_yield_kg, seed_source, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, built.zoneId, built.cropKind, built.plantedAt, built.expectedHarvestAt, built.expectedYieldKg, built.seedSource, built.status
  );
  const envelope = { ok: true, crop: { id, ...built } };
  db.prepare("INSERT OR IGNORE INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
    randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString()
  );
  recordAudit(db, user, "greenhouse.crop.plant", "greenhouse_crop", id, built);
  return envelope;
});

app.patch("/api/greenhouse/crops/:id/status", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "greenhouse");
  const cropId = request.params.id;
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  const crop = db.prepare("SELECT * FROM greenhouse_crops WHERE id = ?").get(cropId);
  if (!crop) { const e = new Error("crop not found"); e.statusCode = 404; throw e; }
  const updated = greenhouse.patchCropStatus({ currentStatus: crop.status, nextStatus: body.status });
  db.prepare("UPDATE greenhouse_crops SET status = ? WHERE id = ?").run(updated.status, cropId);
  const envelope = { ok: true, crop: { id: cropId, status: updated.status } };
  db.prepare("INSERT OR IGNORE INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
    randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString()
  );
  recordAudit(db, user, "greenhouse.crop.status", "greenhouse_crop", cropId, updated);
  return envelope;
});

// Device-push endpoints (token-gated, not session)
app.post("/api/greenhouse/devices/climate-batch", {
  preHandler: deviceAuth
}, async request => {
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
  const orgId = request.device.org_id;
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(orgId, idem);
  if (existing) return JSON.parse(existing.response_json);
  const batchId = idem;
  const built = greenhouse.ingestClimateBatch({ zoneId: body.zoneId, readings: body.readings, batchId });
  const stmt = db.prepare(`INSERT INTO greenhouse_climate_logs
    (id, zone_id, recorded_at, temp_c, humidity, light_lux, co2_ppm, sensor_id, batch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const r of built.readings) {
    stmt.run(randomId("clog"), r.zoneId, r.recordedAt, r.tempC, r.humidity, r.lightLux, r.co2Ppm, r.sensorId, r.batchId);
  }
  const envelope = { ok: true, climate: { zoneId: built.zoneId, count: built.count, batchId } };
  db.prepare("INSERT OR IGNORE INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
    randomId("idem"), orgId, idem, JSON.stringify(envelope), new Date().toISOString()
  );
  recordAudit(db, { id: "device", org_id: orgId }, "greenhouse.climate.ingest", "greenhouse_zone", body.zoneId, { count: built.count });
  return envelope;
});

app.post("/api/greenhouse/devices/energy-batch", {
  preHandler: deviceAuth
}, async request => {
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
  const orgId = request.device.org_id;
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(orgId, idem);
  if (existing) return JSON.parse(existing.response_json);
  const built = greenhouse.ingestEnergyBatch({ greenhouseId: body.greenhouseId, readings: body.readings, periodKey: body.periodKey });
  const stmt = db.prepare(`INSERT INTO greenhouse_energy_logs
    (id, greenhouse_id, recorded_at, kwh, gas_m3, source, period_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const r of built.readings) {
    stmt.run(randomId("elog"), r.greenhouseId, r.recordedAt, r.kwh, r.gasM3, r.source, r.periodKey);
  }
  const envelope = { ok: true, energy: { greenhouseId: built.greenhouseId, periodKey: built.periodKey, count: built.count } };
  db.prepare("INSERT OR IGNORE INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
    randomId("idem"), orgId, idem, JSON.stringify(envelope), new Date().toISOString()
  );
  recordAudit(db, { id: "device", org_id: orgId }, "greenhouse.energy.ingest", "greenhouse", body.greenhouseId, { periodKey: built.periodKey });
  return envelope;
});

app.post("/api/greenhouse/bioprotection", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "greenhouse");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  const built = greenhouse.buildBioprotection(body);
  const id = randomId("bio");
  db.prepare(`INSERT INTO greenhouse_bioprotection_logs
    (id, zone_id, applied_at, agent_kind, dose, target_pest, withdrawal_period_days, recorded_by, file_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, built.zoneId, built.appliedAt, built.agentKind, built.dose, built.targetPest, built.withdrawalPeriodDays, built.recordedBy, null
  );
  const envelope = { ok: true, bioprotection: { id, ...built } };
  db.prepare("INSERT OR IGNORE INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
    randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString()
  );
  recordAudit(db, user, "greenhouse.bioprotection.apply", "greenhouse_zone", built.zoneId, built);
  return envelope;
});

app.post("/api/greenhouse/harvests", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "greenhouse");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  const crop = db.prepare("SELECT * FROM greenhouse_crops WHERE id = ?").get(body.cropId);
  if (!crop) { const e = new Error("crop not found"); e.statusCode = 404; throw e; }
  const logs = db.prepare("SELECT * FROM greenhouse_bioprotection_logs WHERE zone_id = ?").all(crop.zone_id);
  greenhouse.enforceWithdrawalPeriod({ bioprotectionLogs: logs, zoneId: crop.zone_id, harvestDate: body.harvestedAt });
  const harvestId = randomId("harv");
  const lotId = randomId("lot");
  db.prepare(`INSERT INTO greenhouse_harvests (id, crop_id, harvested_at, quantity_kg, quality_grade, lot_id, notes, file_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    harvestId, body.cropId, body.harvestedAt, Number(body.quantityKg), body.qualityGrade, lotId, body.notes || null, null
  );
  // Auto-create stock_lot (sub-plan 2 contract)
  db.prepare(`INSERT OR IGNORE INTO stock_lots (id, org_id, product_kind, quantity_kg, harvested_at, quality_grade, source)
              VALUES (?, ?, 'greenhouse', ?, ?, ?, ?)`).run(
    lotId, user.org_id, Number(body.quantityKg), body.harvestedAt, body.qualityGrade, `greenhouse:${body.cropId}`
  );
  db.prepare("UPDATE greenhouse_crops SET status = 'harvested' WHERE id = ?").run(body.cropId);
  const envelope = { ok: true, harvest: { id: harvestId, lotId, ...body } };
  db.prepare("INSERT OR IGNORE INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
    randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString()
  );
  recordAudit(db, user, "greenhouse.harvest.record", "greenhouse_crop", body.cropId, { quantityKg: body.quantityKg, lotId });
  return envelope;
});

app.get("/api/greenhouse/:id/analytics/yield", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "greenhouse");
  const periodKey = String(request.query.periodKey || "");
  const crops = db.prepare("SELECT * FROM greenhouse_crops WHERE id IN (SELECT crop_id FROM greenhouse_harvests)").all();
  const harvests = db.prepare("SELECT * FROM greenhouse_harvests").all();
  return { ok: true, yield: { periodKey, rows: greenhouse.computeYieldVsForecast({ crops, harvests }) } };
});

app.get("/api/greenhouse/:id/analytics/energy", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "greenhouse");
  const periodKey = String(request.query.periodKey || "");
  const energyLogs = db.prepare("SELECT * FROM greenhouse_energy_logs WHERE period_key = ?").all(periodKey);
  const harvests = db.prepare("SELECT * FROM greenhouse_harvests").all();
  return { ok: true, energy: greenhouse.computeEnergyPerKg({ energyLogs, harvests }) };
});

app.get("/api/greenhouse/:id/analytics/gdd", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "greenhouse");
  const from = String(request.query.from || "");
  const to = String(request.query.to || "");
  const baseTempC = Number(request.query.baseTempC) || 10;
  const logs = db.prepare("SELECT * FROM greenhouse_climate_logs WHERE recorded_at BETWEEN ? AND ?").all(from, to);
  return { ok: true, gdd: greenhouse.computeGdd({ climateLogs: logs, baseTempC }) };
});

app.post("/api/greenhouse/ai/yield-forecast", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "greenhouse");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  const forecast = greenhouse.forecastYield({ cropKind: body.cropKind, areaM2: Number(body.areaM2), gdd: Number(body.gdd) });
  const envelope = { ok: true, forecast };
  db.prepare("INSERT OR IGNORE INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
    randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString()
  );
  recordAudit(db, user, "greenhouse.ai.yieldForecast", "greenhouse", user.id, forecast);
  return envelope;
});
```

- [ ] **Step 3: Run focused tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/greenhouse.test.js 2>&1 | tail -10
```

Expected: PASS (8 tests).

- [ ] **Step 4: Run the full test suite to confirm no regressions**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, total test count increases by 8.

- [ ] **Step 5: Commit the routes**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/app.js && git commit -m "feat(greenhouse): wire 13 routes with device-push + withdrawal guard" && git push ant main
```

### Task 5: Add the AI helper `server/greenhouseAi.js`

**Files:**
- Create: `server/greenhouseAi.js`
- Read: `server/copilot.js` (style reference for the OpenRouter-gated pattern)

- [ ] **Step 1: Create the AI helper**

```js
"use strict";

const { aiComplete } = require("./aiProvider");

const ARMENIAN_AGRI_RAG_INTENT = "greenhouse-yield";
const DEFAULT_MODEL = "anthropic/claude-3.5-sonnet";
const LOCAL_FALLBACK = "deterministic-greenhouse-v1";

function buildDeterministicForecast({ cropKind, areaM2, gdd }) {
  const baseline = { tomato: 35, cucumber: 45, pepper: 25, lettuce: 30, strawberry: 18, herb: 12 }[cropKind] || 0;
  const heat = Number.isFinite(gdd) ? Math.min(1.3, 0.7 + gdd / 1500) : 1;
  const expected = Number((baseline * areaM2 * heat).toFixed(2));
  return {
    source: "local-fallback",
    model: LOCAL_FALLBACK,
    cropKind,
    areaM2,
    gddUsed: gdd,
    expectedKg: expected,
    confidence: 0.62,
    citations: []
  };
}

function buildArmenianAgriCitation(legalSources) {
  const active = (legalSources || []).filter(s => s.status === "active" && /plant|phyto|greenhouse|agrar/i.test(s.title || ""));
  return active.slice(0, 3).map(s => ({ id: s.id, title: s.title, url: s.url, kind: s.kind }));
}

async function aiYieldForecast({ orgId, db, cropKind, areaM2, gdd, intent = ARMENIAN_AGRI_RAG_INTENT }) {
  const legalSources = db.prepare("SELECT id, title, url, kind, status FROM legal_sources WHERE org_id = ? AND status = 'active'").all(orgId);
  const citations = buildArmenianAgriCitation(legalSources);
  if (process.env.ARMOSPHERA_ONE_ALLOW_EGRESS !== "1") {
    return buildDeterministicForecast({ cropKind, areaM2, gdd, citations });
  }
  try {
    const prompt = `Forecast greenhouse yield in Armenian context.\nCrop: ${cropKind}\nArea: ${areaM2} m²\nGDD: ${gdd}\nCite Armenian phytosanitary rules when relevant.`;
    const out = await aiComplete({ intent, prompt, model: DEFAULT_MODEL, json: true });
    return { source: "openrouter", model: DEFAULT_MODEL, ...out, citations };
  } catch (err) {
    return { ...buildDeterministicForecast({ cropKind, areaM2, gdd }), citations, warning: err.message };
  }
}

module.exports = { aiYieldForecast, ARMENIAN_AGRI_RAG_INTENT, LOCAL_FALLBACK };
```

- [ ] **Step 2: Commit the AI helper**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/greenhouseAi.js && git commit -m "feat(greenhouse): add AI yield-forecast helper with local fallback" && git push ant main
```

### Task 6: Add the React panel `web/src/greenhouse.jsx` with 7 tabs

**Files:**
- Create: `web/src/greenhouse.jsx`
- Read: `web/src/copilot.jsx` (style reference for `.copilot-result` and `.mini-action`)
- Read: `web/src/fleet.jsx` (style reference for tab navigation)
- Modify: `web/src/main.jsx` (import + mount `GreenhousePanel`)
- Modify: `web/src/locale.js` (add Armenian labels for greenhouse tabs)

- [ ] **Step 1: Create the component**

```jsx
import React, { useState } from "react";

const TABS = [
  { key: "houses", label: "Ջերմոցներ" },
  { key: "zones", label: "Գոտիներ" },
  { key: "crops", label: "Կուլտուրաներ" },
  { key: "climate", label: "Կլիմա" },
  { key: "energy", label: "Էներգիա" },
  { key: "harvests", label: "Բերք" },
  { key: "bioprotection", label: "Կենսաանվտանգություն" }
];

function MiniForm({ fields, onSubmit, busy, submitLabel }) {
  return (
    <form className="inline-form" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
      {fields.map(field => (
        <input
          key={field.name}
          name={field.name}
          placeholder={field.placeholder || ""}
          value={field.value}
          onChange={event => field.onChange(event.target.value)}
        />
      ))}
      <button className="mini-action" type="submit" disabled={busy}>{busy ? "Ընթացքում..." : (submitLabel || "Ուղարկել")}</button>
    </form>
  );
}

export function GreenhousePanel({ api, actionState, setActionState, setActionError }) {
  const [tab, setTab] = useState("houses");
  const [name, setName] = useState("Armosphère-1");
  const [areaM2, setAreaM2] = useState("1200");
  const [glazingKind, setGlazingKind] = useState("glass");
  const [heatingKind, setHeatingKind] = useState("gas");
  const [zoneName, setZoneName] = useState("Zone A");
  const [irrigationKind, setIrrigationKind] = useState("drip");
  const [cropKind, setCropKind] = useState("tomato");
  const [plantedAt, setPlantedAt] = useState("2026-04-01");
  const [expectedHarvestAt, setExpectedHarvestAt] = useState("2026-07-15");
  const [expectedYieldKg, setExpectedYieldKg] = useState("1500");
  const [result, setResult] = useState(null);
  const busy = actionState === "greenhouse:create";

  async function callRoute(path, payload, actionKey) {
    setActionState(actionKey);
    setActionError("");
    try {
      const res = await api(path, { method: "POST", body: payload });
      setResult(res);
      return res;
    } catch (err) {
      setActionError(err.message);
      throw err;
    } finally {
      setActionState("");
    }
  }

  async function createHouse() {
    await callRoute("/api/greenhouse/houses", {
      name, areaM2: Number(areaM2), glazingKind, heatingKind,
      idempotencyKey: `ui-house-${Date.now()}`
    }, "greenhouse:create");
  }

  async function createZone() {
    await callRoute("/api/greenhouse/zones", {
      greenhouseId: result?.greenhouse?.id || "needs-house",
      name: zoneName, areaM2: 400, irrigationKind,
      idempotencyKey: `ui-zone-${Date.now()}`
    }, "greenhouse:zone");
  }

  async function plantCrop() {
    await callRoute("/api/greenhouse/crops", {
      zoneId: result?.zone?.id || "needs-zone",
      cropKind, plantedAt, expectedHarvestAt, expectedYieldKg: Number(expectedYieldKg),
      idempotencyKey: `ui-crop-${Date.now()}`
    }, "greenhouse:crop");
  }

  return (
    <article className="panel greenhouse-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Ջերմոցային արտադրություն</span>
          <h2>Ջերմոցային մոդուլ</h2>
        </div>
        <div className="row">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              className={"mini-action" + (tab === t.key ? " active" : "")}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "houses" && (
        <MiniForm
          fields={[
            { name: "name", placeholder: "Անվանում", value: name, onChange: setName },
            { name: "areaM2", placeholder: "Մակերես (մ²)", value: areaM2, onChange: setAreaM2 },
            { name: "glazingKind", placeholder: "Ապակիների տեսակ", value: glazingKind, onChange: setGlazingKind },
            { name: "heatingKind", placeholder: "Ջեռուցման տեսակ", value: heatingKind, onChange: setHeatingKind }
          ]}
          onSubmit={createHouse}
          busy={busy}
          submitLabel="Ստեղծել ջերմոց"
        />
      )}

      {tab === "zones" && (
        <MiniForm
          fields={[
            { name: "zoneName", placeholder: "Գոտու անվանում", value: zoneName, onChange: setZoneName },
            { name: "irrigationKind", placeholder: "Ոռոգման տեսակ", value: irrigationKind, onChange: setIrrigationKind }
          ]}
          onSubmit={createZone}
          busy={actionState === "greenhouse:zone"}
          submitLabel="Ստեղծել գոտի"
        />
      )}

      {tab === "crops" && (
        <MiniForm
          fields={[
            { name: "cropKind", placeholder: "Կուլտուրա", value: cropKind, onChange: setCropKind },
            { name: "plantedAt", placeholder: "Ցանվել է", value: plantedAt, onChange: setPlantedAt },
            { name: "expectedHarvestAt", placeholder: "Ակնկալվող բերք", value: expectedHarvestAt, onChange: setExpectedHarvestAt },
            { name: "expectedYieldKg", placeholder: "Ակնկալվող քաշ (կգ)", value: expectedYieldKg, onChange: setExpectedYieldKg }
          ]}
          onSubmit={plantCrop}
          busy={actionState === "greenhouse:crop"}
          submitLabel="Տնկել կուլտուրա"
        />
      )}

      {(tab === "climate" || tab === "energy" || tab === "harvests" || tab === "bioprotection") && (
        <p className="action-status">Տվյալների ներմուծումը կատարվում է IoT սարքերից կամ API-ից</p>
      )}

      {result && (
        <div className="copilot-result">
          <p>Վերջին պատասխան՝ <strong>{JSON.stringify(result)}</strong></p>
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Mount the panel in `web/src/main.jsx`**

```jsx
import { GreenhousePanel } from "./greenhouse.jsx";
```

In `Workspace`, near other panel mounts, add:

```jsx
<GreenhousePanel
  api={api}
  actionState={actionState}
  setActionState={setActionState}
  setActionError={setActionError}
/>
```

- [ ] **Step 3: Add Armenian labels in `web/src/locale.js`**

```js
greenhouse: {
  title: "Ջերմոցային մոդուլ",
  tabs: {
    houses: "Ջերմոցներ",
    zones: "Գոտիներ",
    crops: "Կուլտուրաներ",
    climate: "Կլիմա",
    energy: "Էներգիա",
    harvests: "Բերք",
    bioprotection: "Կենսաանվտանգություն"
  }
}
```

- [ ] **Step 4: Build the UI**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm run build:ui 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit the UI**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add web/src/greenhouse.jsx web/src/main.jsx web/src/locale.js && git commit -m "feat(greenhouse): mount 7-tab Armenian-first panel" && git push ant main
```

### Task 7: Handoff + tag

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update the first status line and add a completed bullet**

Replace the first line in `HANDOFF.md` with the new tag count and test result, e.g.:

```markdown
_Last updated: 2026-06-08 · main after Greenhouse ERP · N tags · M tests (M pass, 0 fail, 0 cancelled)_
```

Add a bullet:

```markdown
- **Greenhouse ERP (Differentiator #3)** — DONE: 7-table migration + pure `server/greenhouse.js` engine (yield / GDD / energy-per-kg / withdrawal guard) + 13 routes (including token-gated device-push batches) + AI yield-forecast helper with local fallback + Armenian-first 7-tab React panel + 8-test contract suite.
```

- [ ] **Step 2: Commit handoff**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add HANDOFF.md && git commit -m "docs: record Greenhouse ERP verification" && git push ant main
```

- [ ] **Step 3: Tag**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git tag greenhouse-erp-mvp && git push ant greenhouse-erp-mvp
```

## Final Self-Review Checklist (sub-plan 10)

- [ ] `test/greenhouse.test.js` fails before the engine exists (RED)
- [ ] `test/greenhouse.test.js` passes once the routes are wired (GREEN)
- [ ] `npm test` total count increases by 8
- [ ] `npm run build:ui` succeeds
- [ ] `greenhouses` table is auto-created on first run; `assets` row is created alongside each greenhouse
- [ ] Climate + energy device batches are idempotent on `idempotencyKey`
- [ ] Bioprotection application within `withdrawalPeriodDays` blocks harvest with HTTP 409
- [ ] Harvest auto-creates a `stock_lots` row (sub-plan 2 contract)
- [ ] Audit row count increases by exactly 1 per successful call (idempotency replay does not double-write)
- [ ] Yield forecast vs actual, energy per kg, and GDD analytics endpoints return 200 with non-null numerics
- [ ] AI yield-forecast works without egress (`ARMOSPHERA_ONE_ALLOW_EGRESS!=1`) and falls back to deterministic local model
- [ ] Armenian-first labels are present in the panel
- [ ] `HANDOFF.md` updated
- [ ] `greenhouse-erp-mvp` tag pushed to `ant`

</plan>
## Objective
You are implementing sub-plan 10 (Greenhouse ERP) of the A1 Suite / Armosphère One project — greenhouse-specific ERP workflows (crop cycles, grow batches, harvest records, environmental sensors).

## Your worktree
You are running in: {worktree_path}
The branch is: a1/sub-plan/greenhouse-erp (already created from ant/main)

## The plan
READ THIS FILE IN FULL FIRST, end to end, before doing anything else:
  /Users/samvelstepanyan/dev/A1-Suite-Local-ANT/docs/superpowers/plans/2026-06-08-a1-suite-ant-greenhouse-erp.md

Execute it task-by-task. Every checkbox `- [ ]` becomes a step. Use the superpowers:executing-plans skill conventions (RED-GREEN-IMPROVE, frequent commits, code review between tasks).

## Pattern A — the A1 module shape
For every module you add, ship exactly these four artifacts:
  1. Pure deterministic engine at  server/greenhouse.js   (no I/O, no Fastify, testable in isolation)
  2. Thin route block in          server/app.js           (auth → requireAppAccess → audit → handler)
  3. React panel at               web/src/greenhouse.jsx  (inline Armenian strings, no i18n)
  4. node --test contract suite   test/greenhouse.test.js (math + auth-gating + idempotency)

The greenhouse module is a new vertical on top of the inventory app — it should NOT introduce a new app entry. Confirm in the plan whether the work should mount into the existing inventory dashboard or stand alone with a new `<div id="suite-app-...">` anchor in web/index.html (it should mount into an existing anchor where possible).

## Hard invariants (do NOT violate)
- Armenian-first inline strings for all user-facing labels.
- 13-apps list in server/db.js STAYS at 13. Do NOT add new entries to the apps list.
- Egress is OFF by default. Only make outbound calls when ARMOSPHERA_ONE_ALLOW_EGRESS=1 is set. Sensor data must be polled locally via the existing state_integrations adapter if sub-plan 7 has shipped; otherwise stub deterministically.
- Use `audit(db, user.org_id, user.id, "type.verb", {...})` — NOT `recordAudit()`.
- Idempotency: `INSERT OR IGNORE INTO idempotency_keys` — NOT `.onConflict('nothing')`.
- For batched inserts: `db.transaction(() => { ... })` works on this codebase (node:sqlite DatabaseSync).
- `git push ant <tag>` — never `origin`.
- Auth: `const user = await app.auth(request);` then `requireAppAccess(db, user, "...")`.
- HTML escape any user-supplied text via the existing `esc()` helper in server/app.js.

## Workflow per task
1. Read the plan task.
2. Write the failing test first (RED). Run it.
3. Implement the minimal code (GREEN). Run it.
4. Refactor (IMPROVE). Re-run.
5. Commit with a conventional-commit message (`feat:`, `fix:`, `test:`, `refactor:`).
6. Move to the next task.

After each logical chunk (typically 2-3 tasks), review your own diff and confirm the invariants above still hold.

## Shipping
When every task in the plan is checked off and all tests pass:
1. Run the full test suite from the worktree root: `npm test`.
2. Verify no secrets are hardcoded: `git diff ant/main...HEAD | grep -iE "(api[_-]?key|secret|password|token)" || echo OK`.
3. Write a one-paragraph handoff to:  /Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/a1-sub-plans-7-10/greenhouse-erp/handoff.md
4. Update status:  /Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/a1-sub-plans-7-10/greenhouse-erp/status.md
5. Push branch and tag:  `git push ant a1/sub-plan/greenhouse-erp`  then  `git push ant greenhouse-erp-mvp`

## Budget
~45-60 minutes per sub-plan. If you hit a real architectural blocker you can't resolve in 10 minutes, write it to status.md and stop — don't thrash. The orchestrator will dispatch a fixer for blockers.
## Completion
Do not spawn subagents or external agents for this task.
Report results in your final response.
The worker launcher captures your response in `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/a1-sub-plans-7-10/greenhouse-erp/handoff.md` automatically.
The worker launcher updates `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/a1-sub-plans-7-10/greenhouse-erp/status.md` automatically.
## Tag to Ship
When done, push tag `greenhouse-erp-mvp` to remote `ant`:
```bash
git push ant greenhouse-erp-mvp
```
