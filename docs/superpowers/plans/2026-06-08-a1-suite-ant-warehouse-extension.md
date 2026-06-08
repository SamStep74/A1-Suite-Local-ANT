# Sub-Plan 2: Warehouse Extension (Склад) — User Priority #2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shipped inventory spine (`/api/inventory/*` routes in `server/app.js`, `test/inventory.test.js`, `web/src/inventory.jsx`) with lot/serial tracking, expiry dates, lot traceability, cold-storage readings, ABC analysis, turnover analytics, and a deterministic AI restock-forecast hook — without rewriting the existing ledger.

**Architecture:** Adds Pattern A module `server/warehouse.js` (pure engine: ABC classification, turnover days, FEFO ordering, lot/serial/expiry validators, traceability walker, local forecast fallback) + route registration in `server/app.js` + `web/src/warehouse.jsx` extension panel (Lots/Serials/Cold-Storage/Analytics tabs) mounted from `web/src/main.jsx`. Reuses `stock_moves` / `stock_quants` / `warehouses` / `stock_locations` / `catalog_items` tables. New tables: `stock_lots`, `stock_serials`, `stock_lot_moves`, `cold_storage_readings`, `stock_valuation_layers`. All mutations emit `audit_events` rows gated by `requireInventoryWriter`; reads gated by `requireInventoryReader`; both go through the same `app.auth` session.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite` `DatabaseSync`, `node --test`, React + Vite. AI forecast uses a deterministic local fallback (moving average + FEFO + turnover) with an optional OpenRouter gate (same `ARMOSPHERA_ONE_ALLOW_EGRESS=1` flag used by Copilot).

**Depends on:** sub-plan 0 (Pattern A skeleton) for the audit + role-gate + `node --test` conventions, and the shipped inventory spine (no need to rewrite `server/app.js` inventory routes).

---

## File Structure

- Modify: `server/db.js` — add 5 new tables in the schema init block (`stock_lots`, `stock_serials`, `stock_lot_moves`, `cold_storage_readings`, `stock_valuation_layers`).
- Create: `server/warehouse.js` — pure engine: `classifyAbc`, `turnoverDays`, `fefoOrder`, `traceLot`, `forecastRestock`, `validateExpiry`, `validateLotCode`, `validateSerial`.
- Modify: `server/app.js` — register 9 routes after the existing `/api/inventory/moves` POST route.
- Create: `test/warehouse-extension.test.js` — `node --test` contract suite (auth, role, validation, happy path, audit, FEFO, traceability, ABC, turnover, AI gate).
- Create: `web/src/warehouse.jsx` — React panel with Lots/Serials/Cold-Storage/Analytics tabs and Armenian-first labels.
- Modify: `web/src/main.jsx` — import + mount the warehouse panel and wire the API calls.
- Modify: `HANDOFF.md` — add `warehouse-extension-mvp` bullet to status.

## Cross-cutting spine reused

- `org_id` from `app.auth` for tenant isolation.
- `audit_events` row written on every successful mutation via `audit(db, user.org_id, user.id, "warehouse.<verb>", { ... })`.
- `requireInventoryReader` / `requireInventoryWriter` role gates already in `server/app.js` (lines 7854–7868).
- `catalog_items` is the existing product master; `stock_moves` and `stock_quants` are the existing ledger (read-only join, never re-posted from this module).
- `vendors` and `customers` tables for traceability (linked_type + linked_id, not direct FK).
- AI gate: `ARMOSPHERA_ONE_ALLOW_EGRESS=1` env var, same constant as Copilot.

## Task 1: Add the five new tables and write the RED contract test

**Files:**
- Modify: `server/db.js` (add table CREATE statements)
- Create: `test/warehouse-extension.test.js`

- [ ] **Step 1: Add the table CREATE block to `server/db.js`**

Open `server/db.js` and find the existing `CREATE TABLE IF NOT EXISTS stock_quants` block (search for `stock_quants`). Immediately after that block, add:

```js
    CREATE TABLE IF NOT EXISTS stock_lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      lot_code TEXT NOT NULL,
      mfg_date TEXT,
      expiry_date TEXT,
      harvest_date TEXT,
      source_vendor_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(org_id, product_id, lot_code)
    );
    CREATE INDEX IF NOT EXISTS idx_stock_lots_expiry
      ON stock_lots(org_id, product_id, expiry_date);

    CREATE TABLE IF NOT EXISTS stock_serials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      serial TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_stock',
      current_location_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(org_id, product_id, serial)
    );
    CREATE INDEX IF NOT EXISTS idx_stock_serials_status
      ON stock_serials(org_id, product_id, status);

    CREATE TABLE IF NOT EXISTS stock_lot_moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      lot_id INTEGER NOT NULL,
      move_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stock_lot_moves_lot
      ON stock_lot_moves(org_id, lot_id);

    CREATE TABLE IF NOT EXISTS cold_storage_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      location_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      temp_c REAL NOT NULL,
      humidity REAL,
      sensor_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cold_storage_location_time
      ON cold_storage_readings(org_id, location_id, recorded_at DESC);

    CREATE TABLE IF NOT EXISTS stock_valuation_layers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      lot_id INTEGER,
      layer_date TEXT NOT NULL,
      unit_cost REAL NOT NULL,
      quantity_remaining REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stock_valuation_layers
      ON stock_valuation_layers(org_id, product_id, layer_date);
```

- [ ] **Step 2: Create the RED test file**

Create `test/warehouse-extension.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const response = await app.inject({
    method: "POST",
    url: "/api/login",
    payload: { email, password }
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.headers["set-cookie"];
}

function auditCount(app, orgId, type) {
  return app.db
    .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type = ?")
    .get(orgId, type).count;
}

test("warehouse: lot creation is auth-gated (401)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/warehouse/lots",
      payload: { productId: "catitem-pos-barcode-scanner", lotCode: "L-001" }
    });
    assert.equal(res.statusCode, 401);
  } finally { await app.close(); }
});

test("warehouse: lot creation is role-gated (403 for sales)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app, "sales@armosphera.local");
    const res = await app.inject({
      method: "POST",
      url: "/api/warehouse/lots",
      headers: { cookie },
      payload: { productId: "catitem-pos-barcode-scanner", lotCode: "L-001" }
    });
    assert.equal(res.statusCode, 403);
  } finally { await app.close(); }
});

test("warehouse: lot creation validates input (400 missing productId)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/warehouse/lots",
      headers: { cookie },
      payload: { lotCode: "L-001" }
    });
    assert.equal(res.statusCode, 400);
  } finally { await app.close(); }
});

test("warehouse: lot creation writes audit row and returns 200", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const orgId = "org-armosphera-demo";
    const before = auditCount(app, orgId, "warehouse.lot.created");
    const res = await app.inject({
      method: "POST",
      url: "/api/warehouse/lots",
      headers: { cookie },
      payload: {
        productId: "catitem-pos-barcode-scanner",
        lotCode: "LOT-2026-001",
        mfgDate: "2026-05-01",
        expiryDate: "2027-05-01",
        harvestDate: null,
        sourceVendorId: "vendor-1"
      }
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.ok(body.lot.id > 0);
    assert.equal(body.lot.lotCode, "LOT-2026-001");
    assert.equal(auditCount(app, orgId, "warehouse.lot.created"), before + 1);
  } finally { await app.close(); }
});

test("warehouse: FEFO list returns lots ordered by expiry ascending", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const seed = [
      { productId: "catitem-pos-barcode-scanner", lotCode: "LATE",  expiryDate: "2027-12-31" },
      { productId: "catitem-pos-barcode-scanner", lotCode: "SOON",  expiryDate: "2026-07-01" },
      { productId: "catitem-pos-barcode-scanner", lotCode: "MID",   expiryDate: "2026-09-15" }
    ];
    for (const lot of seed) {
      await app.inject({ method: "POST", url: "/api/warehouse/lots", headers: { cookie }, payload: lot });
    }
    const res = await app.inject({
      method: "GET",
      url: "/api/warehouse/lots?productId=catitem-pos-barcode-scanner&expiringWithin=400",
      headers: { cookie }
    });
    assert.equal(res.statusCode, 200, res.body);
    const codes = res.json().lots.map(l => l.lotCode);
    assert.deepEqual(codes, ["SOON", "MID", "LATE"]);
  } finally { await app.close(); }
});

test("warehouse: serial registration is auth-gated and writes audit", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const orgId = "org-armosphera-demo";
    const noAuth = await app.inject({
      method: "POST",
      url: "/api/warehouse/serials",
      payload: { productId: "catitem-pos-barcode-scanner", serial: "S-001" }
    });
    assert.equal(noAuth.statusCode, 401);
    const cookie = await login(app);
    const before = auditCount(app, orgId, "warehouse.serial.registered");
    const res = await app.inject({
      method: "POST",
      url: "/api/warehouse/serials",
      headers: { cookie },
      payload: { productId: "catitem-pos-barcode-scanner", serial: "SN-2026-001", currentLocationId: "stockloc-main-warehouse" }
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.ok(res.json().serial.id > 0);
    assert.equal(auditCount(app, orgId, "warehouse.serial.registered"), before + 1);
  } finally { await app.close(); }
});

test("warehouse: cold storage reading records and is queryable", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const orgId = "org-armosphera-demo";
    const before = auditCount(app, orgId, "warehouse.cold_storage.reading_recorded");
    const malformed = await app.inject({
      method: "POST",
      url: "/api/warehouse/cold-storage/readings",
      headers: { cookie },
      payload: { locationId: "stockloc-main-warehouse" }
    });
    assert.equal(malformed.statusCode, 400);
    const res = await app.inject({
      method: "POST",
      url: "/api/warehouse/cold-storage/readings",
      headers: { cookie },
      payload: { locationId: "stockloc-main-warehouse", recordedAt: "2026-06-08T08:00:00.000Z", tempC: 4.2, humidity: 78, sensorId: "sensor-1" }
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(auditCount(app, orgId, "warehouse.cold_storage.reading_recorded"), before + 1);
    const list = await app.inject({
      method: "GET",
      url: "/api/warehouse/cold-storage/readings?locationId=stockloc-main-warehouse",
      headers: { cookie }
    });
    assert.equal(list.statusCode, 200);
    assert.ok(list.json().readings.some(r => r.sensorId === "sensor-1"));
  } finally { await app.close(); }
});

test("warehouse: ABC analysis buckets seeded products by revenue contribution", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "GET",
      url: "/api/warehouse/analytics/abc?periodKey=2026-Q2",
      headers: { cookie }
    });
    assert.equal(res.statusCode, 200, res.body);
    const buckets = res.json().abc;
    const labels = new Set(buckets.map(b => b.bucket));
    assert.ok(labels.has("A") || labels.has("B") || labels.has("C"), "at least one A/B/C bucket present");
    for (const row of buckets) {
      assert.ok(["A", "B", "C"].includes(row.bucket));
      assert.ok(Number.isFinite(Number(row.revenueShare)));
      assert.ok(Number.isFinite(Number(row.cumulativeShare)));
    }
  } finally { await app.close(); }
});

test("warehouse: turnover days returns a positive number per product", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "GET",
      url: "/api/warehouse/analytics/turnover?periodKey=2026-Q2",
      headers: { cookie }
    });
    assert.equal(res.statusCode, 200, res.body);
    const rows = res.json().turnover;
    assert.ok(Array.isArray(rows));
    if (rows.length > 0) {
      assert.ok(rows.every(r => Number.isFinite(Number(r.turnoverDays))));
      assert.ok(rows.every(r => Number(r.turnoverDays) >= 0));
    }
  } finally { await app.close(); }
});

test("warehouse: forecast restock returns deterministic local suggestions without egress", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    delete process.env.ARMOSPHERA_ONE_ALLOW_EGRESS;
    const res = await app.inject({
      method: "POST",
      url: "/api/warehouse/forecast/restock",
      headers: { cookie },
      payload: { productId: "catitem-pos-barcode-scanner", horizonDays: 14, intent: "warehouse-restock" }
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.forecast.source, "local-fallback");
    assert.ok(body.forecast.suggestedQuantity >= 0);
    assert.ok(Array.isArray(body.forecast.reasoning));
  } finally { await app.close(); }
});

test("warehouse: traceability returns upstream vendor and downstream customer chain", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const lotRes = await app.inject({
      method: "POST",
      url: "/api/warehouse/lots",
      headers: { cookie },
      payload: {
        productId: "catitem-pos-barcode-scanner",
        lotCode: "TRACE-2026-001",
        expiryDate: "2027-06-01",
        sourceVendorId: "vendor-armosphère-orchards"
      }
    });
    assert.equal(lotRes.statusCode, 200);
    const lotId = lotRes.json().lot.id;
    const trace = await app.inject({
      method: "GET",
      url: `/api/warehouse/traceability/${lotId}`,
      headers: { cookie }
    });
    assert.equal(trace.statusCode, 200, trace.body);
    const body = trace.json();
    assert.ok(body.trace.upstream.some(u => u.vendorId === "vendor-armosphère-orchards"));
    assert.ok(Array.isArray(body.trace.downstream));
  } finally { await app.close(); }
});
```

- [ ] **Step 3: Run the test to verify RED**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/warehouse-extension.test.js 2>&1 | tail -20
```

Expected: FAIL with `404` for `/api/warehouse/lots` and friends (routes not registered yet). The new tables will already exist after Step 1's commit, so any 500 indicates a SQL error to debug.

- [ ] **Step 4: Commit RED tests + schema**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/db.js test/warehouse-extension.test.js && git commit -m "test(warehouse-extension): define 11-test contract + add 5 tables" && git push ant main
```

## Task 2: Add the pure engine module

**Files:**
- Create: `server/warehouse.js`

- [ ] **Step 1: Create the engine**

```js
"use strict";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const LOT_CODE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
const SERIAL_CODE = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;

function throw400(message) {
  const err = new Error(message);
  err.statusCode = 400;
  throw err;
}

function validateLotCode(value) {
  const text = String(value || "").trim();
  if (!LOT_CODE.test(text)) throw400("lotCode must match /^[A-Z0-9][A-Z0-9_-]{1,31}$/");
  return text;
}

function validateSerial(value) {
  const text = String(value || "").trim();
  if (!SERIAL_CODE.test(text)) throw400("serial must match /^[A-Z0-9][A-Z0-9_-]{1,63}$/");
  return text;
}

function validateProductId(value) {
  const text = String(value || "").trim();
  if (text.length < 3 || text.length > 80) throw400("productId must be 3-80 chars");
  return text;
}

function validateOptionalDate(field, value) {
  if (value === null || value === undefined || value === "") return null;
  if (!ISO_DATE.test(String(value))) throw400(`${field} must be YYYY-MM-DD or null`);
  return String(value);
}

function validateExpiry({ mfgDate, expiryDate }) {
  if (mfgDate && expiryDate && expiryDate < mfgDate) {
    throw400("expiryDate must be on or after mfgDate");
  }
  return { mfgDate: validateOptionalDate("mfgDate", mfgDate), expiryDate: validateOptionalDate("expiryDate", expiryDate) };
}

function fefoOrder(lots) {
  return [...lots]
    .filter(lot => lot && lot.expiryDate)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
}

function classifyAbc(rows) {
  const sorted = [...rows]
    .filter(r => Number(r.revenue) > 0)
    .sort((a, b) => Number(b.revenue) - Number(a.revenue));
  const total = sorted.reduce((sum, r) => sum + Number(r.revenue), 0);
  let running = 0;
  return sorted.map(r => {
    const revenue = Number(r.revenue);
    running += revenue;
    const share = total > 0 ? revenue / total : 0;
    const cumulative = total > 0 ? running / total : 0;
    let bucket = "C";
    if (cumulative <= 0.8) bucket = "A";
    else if (cumulative <= 0.95) bucket = "B";
    return { productId: r.productId, revenue, revenueShare: Number(share.toFixed(4)), cumulativeShare: Number(cumulative.toFixed(4)), bucket };
  });
}

function turnoverDays({ averageInventory, cogs, periodDays = 90 }) {
  const avg = Math.max(0, Number(averageInventory) || 0);
  const sold = Math.max(0, Number(cogs) || 0);
  if (sold === 0) return { turnoverDays: avg > 0 ? periodDays : 0, turns: 0 };
  const turns = avg / sold;
  const days = periodDays / turns;
  return { turnoverDays: Math.round(days * 10) / 10, turns: Math.round(turns * 100) / 100 };
}

function traceLot({ lot, lotMoves, stockMoves, vendors, customers }) {
  const upstream = (vendors || [])
    .filter(v => lot.source_vendor_id && v.id === lot.source_vendor_id)
    .map(v => ({ vendorId: v.id, vendorName: v.name, receivedAt: lot.created_at }));
  const moveIds = new Set((lotMoves || []).filter(m => m.lot_id === lot.id).map(m => m.move_id));
  const downstream = (stockMoves || [])
    .filter(m => moveIds.has(m.id))
    .filter(m => m.destination_location_type === "customer")
    .map(m => ({ moveId: m.id, customerLocationId: m.destination_location_id, quantity: m.quantity, movedAt: m.created_at }));
  return { lotId: lot.id, lotCode: lot.lot_code, upstream, downstream };
}

function forecastRestock({ productId, recentIssues, averageDailyDemand, safetyStockDays = 7, horizonDays = 14 }) {
  const product = validateProductId(productId);
  const demand = Math.max(0, Number(averageDailyDemand) || 0);
  const onHand = Math.max(0, Number(recentIssues?.onHand) || 0);
  const inTransit = Math.max(0, Number(recentIssues?.inTransit) || 0);
  const safety = demand * Math.max(0, Number(safetyStockDays) || 0);
  const target = demand * Math.max(1, Number(horizonDays) || 1) + safety;
  const suggested = Math.max(0, Math.ceil(target - onHand - inTransit));
  const reasoning = [];
  if (suggested === 0) reasoning.push("on-hand + in-transit covers horizon + safety stock");
  if (suggested > 0) reasoning.push(`reorder to cover ${horizonDays}d demand + ${safetyStockDays}d safety stock`);
  if (demand === 0) reasoning.push("no recent demand history; baseline reorder of 1 unit suggested for safety");
  return {
    productId: product,
    horizonDays,
    safetyStockDays,
    onHand,
    inTransit,
    averageDailyDemand: demand,
    suggestedQuantity: suggested,
    reasoning,
    source: "local-fallback",
    generatedAt: new Date().toISOString()
  };
}

function recordColdStorageReading({ locationId, recordedAt, tempC, humidity, sensorId }) {
  const loc = String(locationId || "").trim();
  if (loc.length < 3) throw400("locationId must be 3+ chars");
  const at = String(recordedAt || "").trim();
  if (!ISO_DATETIME.test(at)) throw400("recordedAt must be ISO-8601 with milliseconds and Z");
  const temp = Number(tempC);
  if (!Number.isFinite(temp) || temp < -80 || temp > 80) throw400("tempC must be a finite number in [-80, 80]");
  const hum = humidity === null || humidity === undefined ? null : Number(humidity);
  if (hum !== null && (!Number.isFinite(hum) || hum < 0 || hum > 100)) throw400("humidity must be 0-100 or null");
  const sensor = sensorId === null || sensorId === undefined ? null : String(sensorId).trim().slice(0, 80);
  return { locationId: loc, recordedAt: at, tempC: temp, humidity: hum, sensorId: sensor };
}

module.exports = {
  validateLotCode,
  validateSerial,
  validateProductId,
  validateExpiry,
  fefoOrder,
  classifyAbc,
  turnoverDays,
  traceLot,
  forecastRestock,
  recordColdStorageReading
};
```

- [ ] **Step 2: Run focused tests (still RED — routes not registered yet)**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/warehouse-extension.test.js 2>&1 | tail -10
```

Expected: still FAIL with `404` (no routes yet) — the engine import has no errors.

- [ ] **Step 3: Commit the engine**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/warehouse.js && git commit -m "feat(warehouse-extension): add pure engine (ABC, FEFO, traceability, forecast)" && git push ant main
```

## Task 3: Wire the lot/serial routes in `server/app.js`

**Files:**
- Modify: `server/app.js` (add import + 6 routes after the existing `/api/inventory/moves` POST)

- [ ] **Step 1: Add the import**

Near the other engine imports in `server/app.js` (search for `const accounting = require("./accounting");` block), add:

```js
const warehouse = require("./warehouse");
```

- [ ] **Step 2: Add the lot/serial routes immediately after the `/api/inventory/moves` POST block (around line 488)**

```js
  app.post("/api/warehouse/lots", async request => {
    const user = await app.auth(request);
    requireInventoryWriter(user);
    const body = request.body || {};
    const productId = warehouse.validateProductId(body.productId);
    const lotCode = warehouse.validateLotCode(body.lotCode);
    const { mfgDate, expiryDate } = warehouse.validateExpiry({
      mfgDate: body.mfgDate,
      expiryDate: body.expiryDate
    });
    const harvestDate = warehouse.validateOptionalDate("harvestDate", body.harvestDate);
    const sourceVendorId = body.sourceVendorId == null ? null : String(body.sourceVendorId).trim().slice(0, 80) || null;
    const now = new Date().toISOString();
    const dup = db.prepare("SELECT id FROM stock_lots WHERE org_id = ? AND product_id = ? AND lot_code = ?").get(user.org_id, productId, lotCode);
    if (dup) {
      const err = new Error("lot already exists for this product");
      err.statusCode = 409;
      throw err;
    }
    const info = db.prepare(`
      INSERT INTO stock_lots (org_id, product_id, lot_code, mfg_date, expiry_date, harvest_date, source_vendor_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user.org_id, productId, lotCode, mfgDate, expiryDate, harvestDate, sourceVendorId, now);
    const lot = db.prepare("SELECT * FROM stock_lots WHERE id = ?").get(info.lastInsertRowid);
    audit(db, user.org_id, user.id, "warehouse.lot.created", { lotId: lot.id, productId, lotCode });
    return { ok: true, lot };
  });

  app.get("/api/warehouse/lots", async request => {
    const user = await app.auth(request);
    requireInventoryReader(user);
    const productId = request.query?.productId ? warehouse.validateProductId(request.query.productId) : null;
    const expiringWithin = request.query?.expiringWithin ? Math.max(0, Math.round(Number(request.query.expiringWithin) || 0)) : null;
    const params = [user.org_id];
    let where = "WHERE org_id = ?";
    if (productId) { where += " AND product_id = ?"; params.push(productId); }
    if (expiringWithin !== null) {
      const cutoff = new Date(Date.now() + expiringWithin * 86400000).toISOString().slice(0, 10);
      where += " AND expiry_date IS NOT NULL AND expiry_date <= ?";
      params.push(cutoff);
    }
    const rows = db.prepare(`SELECT * FROM stock_lots ${where} ORDER BY expiry_date ASC NULLS LAST, id ASC`).all(...params);
    return { lots: warehouse.fefoOrder(rows).map(row => ({
      id: row.id,
      productId: row.product_id,
      lotCode: row.lot_code,
      mfgDate: row.mfg_date,
      expiryDate: row.expiry_date,
      harvestDate: row.harvest_date,
      sourceVendorId: row.source_vendor_id,
      createdAt: row.created_at
    })) };
  });

  app.post("/api/warehouse/serials", async request => {
    const user = await app.auth(request);
    requireInventoryWriter(user);
    const body = request.body || {};
    const productId = warehouse.validateProductId(body.productId);
    const serial = warehouse.validateSerial(body.serial);
    const locationId = body.currentLocationId == null ? null : String(body.currentLocationId).trim().slice(0, 80) || null;
    const now = new Date().toISOString();
    const dup = db.prepare("SELECT id FROM stock_serials WHERE org_id = ? AND product_id = ? AND serial = ?").get(user.org_id, productId, serial);
    if (dup) {
      const err = new Error("serial already registered for this product");
      err.statusCode = 409;
      throw err;
    }
    const info = db.prepare(`
      INSERT INTO stock_serials (org_id, product_id, serial, status, current_location_id, created_at)
      VALUES (?, ?, ?, 'in_stock', ?, ?)
    `).run(user.org_id, productId, serial, locationId, now);
    const row = db.prepare("SELECT * FROM stock_serials WHERE id = ?").get(info.lastInsertRowid);
    audit(db, user.org_id, user.id, "warehouse.serial.registered", { serialId: row.id, productId, serial, locationId });
    return { ok: true, serial: { id: row.id, productId: row.product_id, serial: row.serial, status: row.status, currentLocationId: row.current_location_id, createdAt: row.created_at } };
  });

  app.get("/api/warehouse/serials/:id/trace", async request => {
    const user = await app.auth(request);
    requireInventoryReader(user);
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      const err = new Error("serial id must be a positive integer");
      err.statusCode = 400;
      throw err;
    }
    const serial = db.prepare("SELECT * FROM stock_serials WHERE id = ? AND org_id = ?").get(id, user.org_id);
    if (!serial) {
      const err = new Error("serial not found");
      err.statusCode = 404;
      throw err;
    }
    const moves = db.prepare(`
      SELECT m.* FROM stock_moves m
      JOIN stock_lot_moves lm ON lm.move_id = m.id
      JOIN stock_lots l ON l.id = lm.lot_id
      WHERE l.org_id = ? AND l.product_id = ? AND lm.lot_id IN (SELECT id FROM stock_lots WHERE product_id = ? AND org_id = ?)
      ORDER BY m.created_at ASC
    `).all(user.org_id, serial.product_id, serial.product_id, user.org_id);
    audit(db, user.org_id, user.id, "warehouse.serial.trace_read", { serialId: id });
    return { ok: true, serial: { id: serial.id, productId: serial.product_id, serial: serial.serial, status: serial.status, currentLocationId: serial.current_location_id }, moves };
  });

  app.post("/api/warehouse/cold-storage/readings", async request => {
    const user = await app.auth(request);
    requireInventoryWriter(user);
    const cleaned = warehouse.recordColdStorageReading(request.body || {});
    const now = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO cold_storage_readings (org_id, location_id, recorded_at, temp_c, humidity, sensor_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user.org_id, cleaned.locationId, cleaned.recordedAt, cleaned.tempC, cleaned.humidity, cleaned.sensorId, now);
    const row = db.prepare("SELECT * FROM cold_storage_readings WHERE id = ?").get(info.lastInsertRowid);
    audit(db, user.org_id, user.id, "warehouse.cold_storage.reading_recorded", { readingId: row.id, locationId: cleaned.locationId, tempC: cleaned.tempC });
    return { ok: true, reading: { id: row.id, locationId: row.location_id, recordedAt: row.recorded_at, tempC: row.temp_c, humidity: row.humidity, sensorId: row.sensor_id } };
  });

  app.get("/api/warehouse/cold-storage/readings", async request => {
    const user = await app.auth(request);
    requireInventoryReader(user);
    const locationId = request.query?.locationId ? String(request.query.locationId).trim() : null;
    const params = [user.org_id];
    let where = "WHERE org_id = ?";
    if (locationId) { where += " AND location_id = ?"; params.push(locationId); }
    const rows = db.prepare(`SELECT * FROM cold_storage_readings ${where} ORDER BY recorded_at DESC LIMIT 100`).all(...params);
    return { readings: rows.map(r => ({ id: r.id, locationId: r.location_id, recordedAt: r.recorded_at, tempC: r.temp_c, humidity: r.humidity, sensorId: r.sensor_id })) };
  });
```

- [ ] **Step 3: Run focused tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/warehouse-extension.test.js 2>&1 | tail -10
```

Expected: PASS for the 7 tests covering lots, serials, FEFO, cold-storage (the analytics + traceability + forecast tests still RED until Task 4).

- [ ] **Step 4: Commit the lot/serial routes**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/app.js && git commit -m "feat(warehouse-extension): wire lot, serial, and cold-storage routes" && git push ant main
```

## Task 4: Wire the analytics, forecast, and traceability routes

**Files:**
- Modify: `server/app.js` (add 3 routes immediately after the cold-storage GET route added in Task 3)

- [ ] **Step 1: Add the three remaining routes**

```js
  app.get("/api/warehouse/analytics/abc", async request => {
    const user = await app.auth(request);
    requireInventoryReader(user);
    const periodKey = String(request.query?.periodKey || "").trim();
    if (!periodKey || periodKey.length > 20) {
      const err = new Error("periodKey is required (max 20 chars)");
      err.statusCode = 400;
      throw err;
    }
    const rows = db.prepare(`
      SELECT sm.catalog_item_id AS productId, SUM(sm.quantity * COALESCE(sm.unit_cost, 0)) AS revenue
      FROM stock_moves sm
      WHERE sm.org_id = ? AND sm.destination_location_type = 'customer' AND substr(sm.created_at, 1, 7) = substr(?, 1, 7)
      GROUP BY sm.catalog_item_id
    `).all(user.org_id, `${periodKey.slice(0, 4)}-${periodKey.slice(5, 7)}`);
    const abc = warehouse.classifyAbc(rows);
    audit(db, user.org_id, user.id, "warehouse.analytics.abc_read", { periodKey, productCount: abc.length });
    return { ok: true, periodKey, abc };
  });

  app.get("/api/warehouse/analytics/turnover", async request => {
    const user = await app.auth(request);
    requireInventoryReader(user);
    const periodKey = String(request.query?.periodKey || "").trim();
    if (!periodKey || periodKey.length > 20) {
      const err = new Error("periodKey is required (max 20 chars)");
      err.statusCode = 400;
      throw err;
    }
    const rows = db.prepare(`
      SELECT
        sm.catalog_item_id AS productId,
        SUM(sm.quantity * COALESCE(sm.unit_cost, 0)) AS cogs,
        AVG(sq.quantity * COALESCE(sq.average_cost, 0)) AS averageInventory
      FROM stock_moves sm
      LEFT JOIN stock_quants sq
        ON sq.org_id = sm.org_id AND sq.catalog_item_id = sm.catalog_item_id
      WHERE sm.org_id = ? AND sm.destination_location_type = 'customer' AND substr(sm.created_at, 1, 7) = substr(?, 1, 7)
      GROUP BY sm.catalog_item_id
    `).all(user.org_id, `${periodKey.slice(0, 4)}-${periodKey.slice(5, 7)}`);
    const turnover = rows.map(row => ({
      productId: row.productId,
      ...warehouse.turnoverDays({ averageInventory: row.averageInventory, cogs: row.cogs, periodDays: 90 })
    }));
    audit(db, user.org_id, user.id, "warehouse.analytics.turnover_read", { periodKey, productCount: turnover.length });
    return { ok: true, periodKey, turnover };
  });

  app.post("/api/warehouse/forecast/restock", async request => {
    const user = await app.auth(request);
    requireInventoryWriter(user);
    const body = request.body || {};
    if (body.intent !== "warehouse-restock") {
      const err = new Error("intent must be 'warehouse-restock'");
      err.statusCode = 400;
      throw err;
    }
    const productId = warehouse.validateProductId(body.productId);
    const horizonDays = Math.max(1, Math.min(180, Math.round(Number(body.horizonDays) || 14)));
    const onHand = db.prepare(`
      SELECT COALESCE(SUM(quantity - reserved_quantity), 0) AS onHand
      FROM stock_quants
      WHERE org_id = ? AND catalog_item_id = ? AND location_id IN (SELECT id FROM stock_locations WHERE org_id = ? AND location_type = 'internal')
    `).get(user.org_id, productId, user.org_id).onHand;
    const inTransit = db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) AS inTransit
      FROM stock_moves
      WHERE org_id = ? AND catalog_item_id = ? AND source_location_type = 'supplier' AND destination_location_type = 'internal' AND status = 'posted'
    `).get(user.org_id, productId).inTransit;
    const recent = db.prepare(`
      SELECT COALESCE(AVG(quantity), 0) AS avgQty
      FROM stock_moves
      WHERE org_id = ? AND catalog_item_id = ? AND destination_location_type = 'customer' AND created_at >= date('now', '-30 day')
    `).get(user.org_id, productId).avgQty;
    const forecast = warehouse.forecastRestock({
      productId,
      recentIssues: { onHand, inTransit },
      averageDailyDemand: Number(recent) / 30,
      horizonDays
    });
    audit(db, user.org_id, user.id, "warehouse.forecast.restock_run", { productId, suggestedQuantity: forecast.suggestedQuantity });
    return { ok: true, forecast };
  });

  app.get("/api/warehouse/traceability/:lotId", async request => {
    const user = await app.auth(request);
    requireInventoryReader(user);
    const lotId = Number(request.params.lotId);
    if (!Number.isInteger(lotId) || lotId <= 0) {
      const err = new Error("lotId must be a positive integer");
      err.statusCode = 400;
      throw err;
    }
    const lot = db.prepare("SELECT * FROM stock_lots WHERE id = ? AND org_id = ?").get(lotId, user.org_id);
    if (!lot) {
      const err = new Error("lot not found");
      err.statusCode = 404;
      throw err;
    }
    const lotMoves = db.prepare("SELECT * FROM stock_lot_moves WHERE lot_id = ? AND org_id = ?").all(lotId, user.org_id);
    const stockMoves = db.prepare("SELECT * FROM stock_moves WHERE org_id = ? AND id IN (SELECT move_id FROM stock_lot_moves WHERE lot_id = ?)").all(user.org_id, lotId);
    const vendors = lot.source_vendor_id ? db.prepare("SELECT id, name FROM vendors WHERE org_id = ? AND id = ?").all(user.org_id, lot.source_vendor_id) : [];
    const trace = warehouse.traceLot({ lot, lotMoves, stockMoves, vendors, customers: [] });
    audit(db, user.org_id, user.id, "warehouse.traceability.read", { lotId });
    return { ok: true, trace };
  });
```

- [ ] **Step 2: Run focused tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/warehouse-extension.test.js 2>&1 | tail -10
```

Expected: PASS (all 11 tests).

- [ ] **Step 3: Run the full test suite to confirm no regressions**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, total test count increases by 11.

- [ ] **Step 4: Commit the analytics/forecast/traceability routes**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/app.js && git commit -m "feat(warehouse-extension): wire ABC, turnover, forecast, traceability routes" && git push ant main
```

## Task 5: Add the AI forecast hook with local fallback + OpenRouter gate

**Files:**
- Modify: `server/warehouse.js` (add the OpenRouter gate helper at the bottom of the file)

- [ ] **Step 1: Append the AI gate helper**

Add this block at the end of `server/warehouse.js` (before `module.exports`), then add the new export to the exports object:

```js
function shouldAllowEgress(env = process.env) {
  return String(env.ARMOSPHERA_ONE_ALLOW_EGRESS || "").trim() === "1";
}

async function maybeAiRestockAssist({ localForecast, env = process.env, fetchImpl = globalThis.fetch }) {
  if (!shouldAllowEgress(env)) return { ...localForecast, aiAssist: null };
  const apiKey = String(env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) return { ...localForecast, aiAssist: null };
  try {
    const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "openrouter/auto",
        temperature: 0.1,
        messages: [
          { role: "system", content: "You are a restock forecasting assistant for an Armenian produce warehouse. Reply in 2 short bullets." },
          { role: "user", content: `Local forecast: ${JSON.stringify(localForecast)}. Provide 2 short bullet suggestions.` }
        ]
      })
    });
    if (!response.ok) return { ...localForecast, aiAssist: null };
    const json = await response.json();
    const text = json?.choices?.[0]?.message?.content || "";
    return { ...localForecast, aiAssist: { source: "openrouter", text: String(text).slice(0, 800) } };
  } catch {
    return { ...localForecast, aiAssist: null };
  }
}
```

Update the `module.exports` block to include:

```js
module.exports = {
  validateLotCode,
  validateSerial,
  validateProductId,
  validateExpiry,
  fefoOrder,
  classifyAbc,
  turnoverDays,
  traceLot,
  forecastRestock,
  recordColdStorageReading,
  shouldAllowEgress,
  maybeAiRestockAssist
};
```

- [ ] **Step 2: Wire the AI assist in the forecast route (modify the existing handler in `server/app.js`)**

Find the `app.post("/api/warehouse/forecast/restock", ...)` block added in Task 4 and replace the final `return` line with:

```js
    const enriched = await warehouse.maybeAiRestockAssist({ localForecast: forecast, env: options.env || process.env, fetchImpl: options.fetch || globalThis.fetch });
    audit(db, user.org_id, user.id, "warehouse.forecast.restock_run", { productId, suggestedQuantity: enriched.suggestedQuantity, aiAssist: enriched.aiAssist ? "openrouter" : "local" });
    return { ok: true, forecast: enriched };
```

- [ ] **Step 3: Re-run focused tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/warehouse-extension.test.js 2>&1 | tail -10
```

Expected: PASS (11/11) — the test runs without `ARMOSPHERA_ONE_ALLOW_EGRESS`, so the gate is closed and the local fallback is used.

- [ ] **Step 4: Commit the AI gate**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/warehouse.js server/app.js && git commit -m "feat(warehouse-extension): add OpenRouter gate for AI restock assist" && git push ant main
```

## Task 6: Add the React panel with Lots/Serials/Cold-Storage/Analytics tabs

**Files:**
- Create: `web/src/warehouse.jsx`
- Modify: `web/src/main.jsx` (import + mount + wire 9 API calls)

- [ ] **Step 1: Create the component**

Create `web/src/warehouse.jsx`:

```jsx
import React, { useEffect, useMemo, useState } from "react";

const amd = value => `${Number(value || 0).toLocaleString("hy-AM")} AMD`;
const num = value => Number(value || 0).toLocaleString("hy-AM");

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`mini-action ${active ? "" : "secondary"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function LotsTab({ lots, onCreate, onSelect, busy }) {
  const [productId, setProductId] = useState("catitem-pos-barcode-scanner");
  const [lotCode, setLotCode] = useState("LOT-2026-001");
  const [expiryDate, setExpiryDate] = useState("2027-06-01");
  return (
    <div className="rows">
      <form
        className="inline-form"
        onSubmit={event => {
          event.preventDefault();
          onCreate({ productId, lotCode, expiryDate });
        }}
      >
        <label>
          Ապրանք
          <input value={productId} onChange={event => setProductId(event.target.value)} disabled={busy} />
        </label>
        <label>
          Խմբի կոդ
          <input value={lotCode} onChange={event => setLotCode(event.target.value)} disabled={busy} />
        </label>
        <label>
          Պիտանիության ժամկետ
          <input value={expiryDate} onChange={event => setExpiryDate(event.target.value)} disabled={busy} />
        </label>
        <button className="mini-action" type="submit" disabled={busy}>
          {busy ? "Ավելացվում է…" : "Ավելացնել խմբաքանակ"}
        </button>
      </form>
      {lots.map(lot => (
        <div className="row warehouse-lot" key={lot.id} onClick={() => onSelect(lot)}>
          <span>
            {lot.lotCode} · պիտանիություն <strong>{lot.expiryDate || "առանց ժամկետի"}</strong>
          </span>
          <strong>{num(lot.id)}</strong>
        </div>
      ))}
      {lots.length === 0 && <div className="row"><span>Խմբաքանակներ դեռ չկան</span></div>}
    </div>
  );
}

function SerialsTab({ serials, onRegister, busy }) {
  const [productId, setProductId] = useState("catitem-pos-barcode-scanner");
  const [serial, setSerial] = useState("SN-2026-001");
  return (
    <div className="rows">
      <form
        className="inline-form"
        onSubmit={event => {
          event.preventDefault();
          onRegister({ productId, serial });
        }}
      >
        <label>
          Ապրանք
          <input value={productId} onChange={event => setProductId(event.target.value)} disabled={busy} />
        </label>
        <label>
          Սերիական համար
          <input value={serial} onChange={event => setSerial(event.target.value)} disabled={busy} />
        </label>
        <button className="mini-action" type="submit" disabled={busy}>
          {busy ? "Գրանցվում է…" : "Գրանցել սերիական համարը"}
        </button>
      </form>
      {serials.map(item => (
        <div className="row warehouse-serial" key={item.id}>
          <span>
            {item.serial} · {item.productId} · {item.status}
          </span>
          <strong>{item.currentLocationId || "առանց տեղադրության"}</strong>
        </div>
      ))}
      {serials.length === 0 && <div className="row"><span>Սերիական համարներ դեռ չկան</span></div>}
    </div>
  );
}

function ColdStorageTab({ readings, onRecord, busy }) {
  const [locationId, setLocationId] = useState("stockloc-main-warehouse");
  const [tempC, setTempC] = useState("4.0");
  const [humidity, setHumidity] = useState("75");
  return (
    <div className="rows">
      <form
        className="inline-form"
        onSubmit={event => {
          event.preventDefault();
          onRecord({ locationId, recordedAt: new Date().toISOString(), tempC: Number(tempC), humidity: Number(humidity), sensorId: "panel-ui" });
        }}
      >
        <label>
          Տեղադրություն
          <input value={locationId} onChange={event => setLocationId(event.target.value)} disabled={busy} />
        </label>
        <label>
          Ջերմաստիճան (°C)
          <input value={tempC} onChange={event => setTempC(event.target.value)} inputMode="decimal" disabled={busy} />
        </label>
        <label>
          Խոնավություն (%)
          <input value={humidity} onChange={event => setHumidity(event.target.value)} inputMode="decimal" disabled={busy} />
        </label>
        <button className="mini-action" type="submit" disabled={busy}>
          {busy ? "Հիշվում է…" : "Գրանցել սենսորի տվյալը"}
        </button>
      </form>
      {readings.map(reading => (
        <div className="row warehouse-cold-storage" key={reading.id}>
          <span>
            {reading.locationId} · {new Date(reading.recordedAt).toLocaleString("hy-AM")}
          </span>
          <strong>{Number(reading.tempC).toFixed(1)}°C · {reading.humidity == null ? "—" : `${Math.round(reading.humidity)}%`}</strong>
        </div>
      ))}
      {readings.length === 0 && <div className="row"><span>Սենսորի տվյալներ դեռ չկան</span></div>}
    </div>
  );
}

function AnalyticsTab({ abc, turnover, forecast, onForecast, busy }) {
  const [productId, setProductId] = useState("catitem-pos-barcode-scanner");
  return (
    <div className="rows">
      <div className="panel-head"><h3>ABC վերլուծություն (2026-Q2)</h3></div>
      {abc.map(row => (
        <div className="row warehouse-abc" key={row.productId}>
          <span>
            <strong className="aging-badge">{row.bucket}</strong> {row.productId}
          </span>
          <strong>{Math.round(row.revenueShare * 100)}% · կուտակային {Math.round(row.cumulativeShare * 100)}%</strong>
        </div>
      ))}
      {abc.length === 0 && <div className="row"><span>Վաճառքի տվյալներ դեռ չկան</span></div>}
      <div className="panel-head"><h3>Շրջանառություն (օրեր)</h3></div>
      {turnover.map(row => (
        <div className="row warehouse-turnover" key={row.productId}>
          <span>{row.productId}</span>
          <strong>{row.turnoverDays} օր</strong>
        </div>
      ))}
      {turnover.length === 0 && <div className="row"><span>Շրջանառության տվյալներ դեռ չկան</span></div>}
      <form
        className="inline-form"
        onSubmit={event => {
          event.preventDefault();
          onForecast({ productId, horizonDays: 14, intent: "warehouse-restock" });
        }}
      >
        <label>
          Ապրանքի ID
          <input value={productId} onChange={event => setProductId(event.target.value)} disabled={busy} />
        </label>
        <button className="mini-action" type="submit" disabled={busy}>
          {busy ? "Հաշվարկվում է…" : "Կանխատեսել վերապահեստավորումը"}
        </button>
      </form>
      {forecast && (
        <div className="copilot-result">
          <p>Առաջարկվող քանակ՝ <strong>{num(forecast.suggestedQuantity)}</strong></p>
          <p className="action-status">աղբյուր՝ {forecast.source} · {forecast.reasoning.join(" / ")}</p>
        </div>
      )}
    </div>
  );
}

export function WarehousePanel({
  lots,
  serials,
  readings,
  abc,
  turnover,
  forecast,
  actionState,
  onCreateLot,
  onRegisterSerial,
  onRecordReading,
  onRunForecast
}) {
  const [tab, setTab] = useState("lots");
  const busy = actionState === "warehouse:running";
  return (
    <article className="panel warehouse-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Պահեստի ընդլայնում</span>
          <h2>Խմբաքանակներ, սերիաներ, սառը պահեստ, վերլուծություն</h2>
        </div>
        <strong className="aging-badge">{lots.length} խմբաքանակ</strong>
      </div>
      <div className="inline-form">
        <TabButton active={tab === "lots"} onClick={() => setTab("lots")}>Խմբաքանակներ</TabButton>
        <TabButton active={tab === "serials"} onClick={() => setTab("serials")}>Սերիաներ</TabButton>
        <TabButton active={tab === "cold"} onClick={() => setTab("cold")}>Սառը պահեստ</TabButton>
        <TabButton active={tab === "analytics"} onClick={() => setTab("analytics")}>Վերլուծություն</TabButton>
      </div>
      {tab === "lots" && <LotsTab lots={lots} onCreate={onCreateLot} onSelect={() => {}} busy={busy} />}
      {tab === "serials" && <SerialsTab serials={serials} onRegister={onRegisterSerial} busy={busy} />}
      {tab === "cold" && <ColdStorageTab readings={readings} onRecord={onRecordReading} busy={busy} />}
      {tab === "analytics" && <AnalyticsTab abc={abc} turnover={turnover} forecast={forecast} onForecast={onRunForecast} busy={busy} />}
    </article>
  );
}
```

- [ ] **Step 2: Mount the panel in `web/src/main.jsx`**

Find the existing imports near the top of `web/src/main.jsx` and add:

```jsx
import { WarehousePanel } from "./warehouse.jsx";
```

Inside the `Workspace` component (find where `setActionState` is defined and where the inventory panels are mounted), add a new state group and a wrapper for warehouse actions. Place this near the inventory mount code:

```jsx
  const [warehouseLots, setWarehouseLots] = useState([]);
  const [warehouseSerials, setWarehouseSerials] = useState([]);
  const [warehouseReadings, setWarehouseReadings] = useState([]);
  const [warehouseAbc, setWarehouseAbc] = useState([]);
  const [warehouseTurnover, setWarehouseTurnover] = useState([]);
  const [warehouseForecast, setWarehouseForecast] = useState(null);

  const refreshWarehouse = useCallback(async () => {
    if (!api) return;
    try {
      const [lots, abc, turnover, readings] = await Promise.all([
        api("/api/warehouse/lots?expiringWithin=400"),
        api("/api/warehouse/analytics/abc?periodKey=2026-Q2"),
        api("/api/warehouse/analytics/turnover?periodKey=2026-Q2"),
        api("/api/warehouse/cold-storage/readings?locationId=stockloc-main-warehouse")
      ]);
      setWarehouseLots(lots?.lots || []);
      setWarehouseAbc(abc?.abc || []);
      setWarehouseTurnover(turnover?.turnover || []);
      setWarehouseReadings(readings?.readings || []);
    } catch (error) {
      console.warn("warehouse refresh failed", error);
    }
  }, [api]);
```

Add four action wrappers (place them next to `pingHealthcheck` or similar existing wrappers):

```jsx
  const createWarehouseLot = async payload => {
    setActionState("warehouse:running");
    setActionError("");
    try {
      const result = await api("/api/warehouse/lots", { method: "POST", body: payload });
      await refreshWarehouse();
      return result;
    } finally { setActionState(""); }
  };
  const registerWarehouseSerial = async payload => {
    setActionState("warehouse:running");
    setActionError("");
    try {
      const result = await api("/api/warehouse/serials", { method: "POST", body: payload });
      setWarehouseSerials(prev => [...prev, result.serial]);
      return result;
    } finally { setActionState(""); }
  };
  const recordWarehouseReading = async payload => {
    setActionState("warehouse:running");
    setActionError("");
    try {
      const result = await api("/api/warehouse/cold-storage/readings", { method: "POST", body: payload });
      setWarehouseReadings(prev => [result.reading, ...prev].slice(0, 100));
      return result;
    } finally { setActionState(""); }
  };
  const runWarehouseForecast = async payload => {
    setActionState("warehouse:running");
    setActionError("");
    try {
      const result = await api("/api/warehouse/forecast/restock", { method: "POST", body: payload });
      setWarehouseForecast(result.forecast);
      return result;
    } finally { setActionState(""); }
  };
```

Render the panel near the existing inventory panels (immediately after the closing tag of the inventory panel block):

```jsx
      <WarehousePanel
        lots={warehouseLots}
        serials={warehouseSerials}
        readings={warehouseReadings}
        abc={warehouseAbc}
        turnover={warehouseTurnover}
        forecast={warehouseForecast}
        actionState={actionState}
        onCreateLot={createWarehouseLot}
        onRegisterSerial={registerWarehouseSerial}
        onRecordReading={recordWarehouseReading}
        onRunForecast={runWarehouseForecast}
      />
```

- [ ] **Step 3: Build the UI**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm run build:ui 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 4: Commit UI integration**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add web/src/warehouse.jsx web/src/main.jsx && git commit -m "feat(warehouse-extension): mount Lots/Serials/Cold-Storage/Analytics panel" && git push ant main
```

## Task 7: Handoff + tag

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update the first status line and add a completed bullet**

Replace the first line in `HANDOFF.md` with the new tag count and test result, e.g.:

```markdown
_Last updated: 2026-06-08 · main after warehouse-extension · N tags · M tests (M pass, 0 fail, 0 cancelled)_
```

Add a bullet:

```markdown
- **Warehouse extension** — DONE: `server/warehouse.js` pure engine (ABC, FEFO, turnover, traceability, AI gate) + 9 routes under `/api/warehouse/*` + 5 new tables in `server/db.js` + React `WarehousePanel` with Armenian-first tabs + 11-test contract suite covering auth, role gates, validation, audit, FEFO ordering, cold-storage readings, ABC bucketing, turnover math, AI fallback, and lot traceability.
```

- [ ] **Step 2: Commit handoff**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add HANDOFF.md && git commit -m "docs: record warehouse-extension verification" && git push ant main
```

- [ ] **Step 3: Tag**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git tag warehouse-extension-mvp && git push ant warehouse-extension-mvp
```

## Final Self-Review Checklist (sub-plan 2)

- [ ] `test/warehouse-extension.test.js` fails before the engine exists
- [ ] `test/warehouse-extension.test.js` passes once all 9 routes are wired
- [ ] `npm test` total count increases by 11
- [ ] `npm run build:ui` succeeds
- [ ] `audit_events` row count increases by exactly 1 per successful lot/serial/cold-storage/forecast mutation
- [ ] FEFO list returns lots ordered by `expiry_date` ascending (verified by SOON → MID → LATE test)
- [ ] ABC analysis buckets products with cumulative share ≤ 0.8 = A, ≤ 0.95 = B, else C
- [ ] Turnover math: `periodDays / (averageInventory / cogs)` with cogs=0 returns `periodDays`
- [ ] Cold-storage reading rejects malformed payloads (missing `tempC`) with 400
- [ ] Lot traceability returns upstream vendor entry when `source_vendor_id` is set
- [ ] AI forecast returns `source: "local-fallback"` when `ARMOSPHERA_ONE_ALLOW_EGRESS` is not `1`
- [ ] Replay (same `idempotencyKey`) returns cached envelope and does not double-write audit (verified by `auditCount` diff)
- [ ] Armenian-first labels: Ապրանք, Խմբի կոդ, Պիտանիության ժամկետ, Սերիական համար, Սառը պահեստ, Վերլուծություն
- [ ] Reused CSS classes: `.panel`, `.panel-head`, `.inline-form`, `.mini-action`, `.copilot-result`, `.row`, `.section-label`, `.aging-badge`
- [ ] Spine reused: `org_id`, `audit_events`, `catalog_items`, `stock_moves`, `stock_quants`, `warehouses`, `stock_locations`, `vendors`, `customers`
- [ ] `HANDOFF.md` updated
- [ ] `warehouse-extension-mvp` tag pushed to `ant`
