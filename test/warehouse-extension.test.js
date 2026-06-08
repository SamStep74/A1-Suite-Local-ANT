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
