"use strict";
// Phase 8.6 — server layer: covers the 7 missing list GET endpoints under /api/fleet/*.
// Seeding is done via direct DB inserts (app.db.prepare) so tests do not depend on
// the POST handlers' idempotency-key contract. cold-chain logs are inserted directly
// because the production writer is device-auth, not user-auth.

const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

function orgIdFor(app, email) {
  const row = app.db.prepare("SELECT org_id AS orgId FROM users WHERE email = ?").get(email);
  return row && row.orgId;
}

function seedVehicle(app, orgId, plate, id) {
  app.db.prepare(
    "INSERT INTO fleet_vehicles (id, org_id, plate, model, year, capacity_kg, refrigeration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, orgId, plate, "Volvo FH16", 2024, 12000, 0, new Date().toISOString());
}

function seedDriver(app, orgId, licenseNo, id) {
  app.db.prepare(
    "INSERT INTO fleet_drivers (id, org_id, employee_id, license_no, license_classes, license_expiry, hours_of_service_balance_min, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, orgId, "emp-x", licenseNo, "B,C", "2028-01-01", 600, new Date().toISOString());
}

function seedTrip(app, orgId, id) {
  app.db.prepare(
    "INSERT INTO fleet_trips (id, org_id, vehicle_id, driver_id, origin, destination, planned_departure, planned_arrival, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, orgId, "veh-seed-1", "drv-seed-1", "Yerevan", "Gyumri", "2026-06-08T08:00:00Z", "2026-06-08T11:00:00Z", "planned", new Date().toISOString());
}

function seedFuelLog(app, orgId, vehicleId, id) {
  app.db.prepare(
    "INSERT INTO fleet_fuel_logs (id, org_id, vehicle_id, occurred_at, liters, cost_amd, odometer_km, station, vendor_id, notes, file_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, orgId, vehicleId, "2026-06-08T10:00:00Z", 60, 28800, 120000, "Sas Group #4", "vendor-1", null, null);
}

function seedRepair(app, orgId, vehicleId, id) {
  app.db.prepare(
    "INSERT INTO fleet_repairs (id, org_id, vehicle_id, occurred_at, kind, description, cost_amd, vendor_id, odometer_km, file_id, next_due_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, orgId, vehicleId, "2026-06-08T11:00:00Z", "oil_change", "Engine oil + filter", 18000, "vendor-2", 120500, null, "2026-12-08T00:00:00Z");
}

function seedTire(app, orgId, vehicleId, id) {
  app.db.prepare(
    "INSERT INTO fleet_tires (id, org_id, vehicle_id, position, brand, installed_at, removed_at, odometer_at_install, expected_life_km) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, orgId, vehicleId, "FL", "Michelin", "2026-06-01T00:00:00Z", null, 120000, 80000);
}

function seedColdChainLog(app, vehicleId, id) {
  app.db.prepare(
    "INSERT INTO fleet_cold_chain_logs (id, vehicle_id, trip_id, recorded_at, temp_c, humidity, sensor_id, alert_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, vehicleId, null, "2026-06-08T10:05:00Z", 4.5, 65, "sensor-1", null);
}

test("GET /api/fleet/vehicles returns 200 + envelope + seeded row with camelCased fields", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const orgId = orgIdFor(app, DEFAULT_EMAIL);
    seedVehicle(app, orgId, "34AB1234", "veh-list-1");
    const res = await app.inject({ method: "GET", url: "/api/fleet/vehicles", headers: { cookie } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(Array.isArray(body.vehicles));
    assert.ok(body.vehicles.length >= 1);
    const v = body.vehicles.find(r => r.id === "veh-list-1");
    assert.ok(v, "seeded vehicle must appear in the list");
    assert.strictEqual(v.plate, "34AB1234");
    assert.strictEqual(v.refrigeration, 0);
    // camelCased field surface — proves SELECT ... AS alias worked
    assert.ok("capacityKg" in v, "capacityKg must be camelCased");
    assert.ok("createdAt" in v, "createdAt must be camelCased");
  } finally { await app.close(); }
});

test("GET /api/fleet/drivers returns 200 + envelope + seeded row with camelCased fields", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const orgId = orgIdFor(app, DEFAULT_EMAIL);
    seedDriver(app, orgId, "AM-0099", "drv-list-1");
    const res = await app.inject({ method: "GET", url: "/api/fleet/drivers", headers: { cookie } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(Array.isArray(body.drivers));
    const d = body.drivers.find(r => r.id === "drv-list-1");
    assert.ok(d, "seeded driver must appear in the list");
    assert.strictEqual(d.licenseNo, "AM-0099");
    assert.ok("hoursOfServiceBalanceMin" in d, "HoS column must be camelCased");
    assert.ok("licenseExpiry" in d, "licenseExpiry must be camelCased");
  } finally { await app.close(); }
});

test("GET /api/fleet/trips returns 200 + envelope + seeded row with camelCased fields", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const orgId = orgIdFor(app, DEFAULT_EMAIL);
    seedTrip(app, orgId, "trp-list-1");
    const res = await app.inject({ method: "GET", url: "/api/fleet/trips", headers: { cookie } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(Array.isArray(body.trips));
    const t = body.trips.find(r => r.id === "trp-list-1");
    assert.ok(t, "seeded trip must appear in the list");
    assert.strictEqual(t.status, "planned");
    assert.ok("vehicleId" in t, "vehicleId must be camelCased");
    assert.ok("plannedDeparture" in t, "plannedDeparture must be camelCased");
  } finally { await app.close(); }
});

test("GET /api/fleet/fuel-logs returns 200 + envelope + seeded row with camelCased fields", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const orgId = orgIdFor(app, DEFAULT_EMAIL);
    seedVehicle(app, orgId, "34FL0001", "veh-fl-1");
    seedFuelLog(app, orgId, "veh-fl-1", "fl-list-1");
    const res = await app.inject({ method: "GET", url: "/api/fleet/fuel-logs", headers: { cookie } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(Array.isArray(body.fuelLogs));
    const f = body.fuelLogs.find(r => r.id === "fl-list-1");
    assert.ok(f, "seeded fuel log must appear in the list");
    assert.strictEqual(f.liters, 60);
    assert.strictEqual(f.costAmd, 28800);
    assert.ok("odometerKm" in f, "odometerKm must be camelCased");
    assert.ok("occurredAt" in f, "occurredAt must be camelCased");
  } finally { await app.close(); }
});

test("GET /api/fleet/repairs returns 200 + envelope + seeded row with camelCased fields", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const orgId = orgIdFor(app, DEFAULT_EMAIL);
    seedVehicle(app, orgId, "34RP0001", "veh-rp-1");
    seedRepair(app, orgId, "veh-rp-1", "rp-list-1");
    const res = await app.inject({ method: "GET", url: "/api/fleet/repairs", headers: { cookie } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(Array.isArray(body.repairs));
    const r = body.repairs.find(x => x.id === "rp-list-1");
    assert.ok(r, "seeded repair must appear in the list");
    assert.strictEqual(r.kind, "oil_change");
    assert.ok("nextDueAt" in r, "nextDueAt must be camelCased");
    assert.ok("odometerKm" in r, "odometerKm must be camelCased");
  } finally { await app.close(); }
});

test("GET /api/fleet/tires returns 200 + envelope + seeded row with camelCased fields", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const orgId = orgIdFor(app, DEFAULT_EMAIL);
    seedVehicle(app, orgId, "34TR0001", "veh-tr-1");
    seedTire(app, orgId, "veh-tr-1", "tr-list-1");
    const res = await app.inject({ method: "GET", url: "/api/fleet/tires", headers: { cookie } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(Array.isArray(body.tires));
    const t = body.tires.find(x => x.id === "tr-list-1");
    assert.ok(t, "seeded tire must appear in the list");
    assert.strictEqual(t.position, "FL");
    assert.strictEqual(t.brand, "Michelin");
    assert.ok("installedAt" in t, "installedAt must be camelCased");
    assert.ok("expectedLifeKm" in t, "expectedLifeKm must be camelCased");
  } finally { await app.close(); }
});

test("GET /api/fleet/cold-chain returns 200 + envelope + seeded row with camelCased fields (JOIN-scoped by org)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const orgId = orgIdFor(app, DEFAULT_EMAIL);
    // cold-chain has no org_id, so the log must be linked to a vehicle that is in our org.
    seedVehicle(app, orgId, "34CC0001", "veh-cc-1");
    seedColdChainLog(app, "veh-cc-1", "cc-list-1");
    const res = await app.inject({ method: "GET", url: "/api/fleet/cold-chain", headers: { cookie } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(Array.isArray(body.logs));
    const c = body.logs.find(x => x.id === "cc-list-1");
    assert.ok(c, "seeded cold-chain log must appear in the list (JOIN on vehicle's org)");
    assert.strictEqual(c.tempC, 4.5);
    assert.ok("vehicleId" in c, "vehicleId must be camelCased");
    assert.ok("recordedAt" in c, "recordedAt must be camelCased");
  } finally { await app.close(); }
});

test("All 7 fleet list GETs are auth-gated (401 without session)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const paths = [
      "/api/fleet/vehicles",
      "/api/fleet/drivers",
      "/api/fleet/trips",
      "/api/fleet/fuel-logs",
      "/api/fleet/repairs",
      "/api/fleet/tires",
      "/api/fleet/cold-chain"
    ];
    for (const url of paths) {
      const res = await app.inject({ method: "GET", url });
      assert.strictEqual(res.statusCode, 401, `${url} must require session`);
    }
  } finally { await app.close(); }
});

test("All 7 fleet list GETs reject users without fleet app access (403)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    // support@armosphera.local exists in seed and has no fleet access — same trick fleet.test.js uses
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const paths = [
      "/api/fleet/vehicles",
      "/api/fleet/drivers",
      "/api/fleet/trips",
      "/api/fleet/fuel-logs",
      "/api/fleet/repairs",
      "/api/fleet/tires",
      "/api/fleet/cold-chain"
    ];
    for (const url of paths) {
      const res = await app.inject({ method: "GET", url, headers: { cookie } });
      assert.strictEqual(res.statusCode, 403, `${url} must reject non-fleet user`);
    }
  } finally { await app.close(); }
});

test("Cross-tenant isolation: a second org's vehicle is NOT visible in the first org's GET /api/fleet/vehicles", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const orgA = orgIdFor(app, DEFAULT_EMAIL);
    // Create a second org + owner (we only need the org id for direct insert)
    const orgB = "org-other-tenant";
    const now = new Date().toISOString();
    app.db.prepare("INSERT INTO organizations (id, name, legal_name, tax_id, locale, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(orgB, "Other Tenant LLC", "Other Tenant LLC", "99999999", "hy-AM", "AMD", now);
    app.db.prepare(
      "INSERT INTO users (id, org_id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("user-other", orgB, "other@other.local", "Other Owner", "Owner", "x", now);

    // Seed one vehicle in each org
    seedVehicle(app, orgA, "34OR0001", "veh-orgA-1");
    seedVehicle(app, orgB, "99OR0001", "veh-orgB-1");

    const cookie = await login(app);
    const res = await app.inject({ method: "GET", url: "/api/fleet/vehicles", headers: { cookie } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    const ids = body.vehicles.map(v => v.id);
    assert.ok(ids.includes("veh-orgA-1"), "first org must see its own vehicle");
    assert.ok(!ids.includes("veh-orgB-1"), "first org MUST NOT see second org's vehicle (tenant isolation)");
  } finally { await app.close(); }
});
