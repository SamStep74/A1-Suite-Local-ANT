"use strict";
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");
const fleet = require("../server/fleet");
const { hashToken } = require("../server/fleet/deviceAuth");

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

// -----------------------------------------------------------------------------
// Extended coverage: vehicles / drivers / status / fuel / repairs / tires /
// device-token GPS / cold-chain / compliance / analytics.
// -----------------------------------------------------------------------------

test("POST /api/fleet/vehicles happy path returns id and plate", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/fleet/vehicles",
      headers: { cookie },
      payload: { plate: "34AB1234", model: "Volvo FH16", year: 2024, refrigeration: true, idempotencyKey: "veh-1" }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.vehicle.plate, "34AB1234");
    assert.strictEqual(body.vehicle.refrigeration, true);
  } finally { await app.close(); }
});

test("POST /api/fleet/vehicles rejects missing plate (400)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/fleet/vehicles",
      headers: { cookie },
      payload: { model: "x", idempotencyKey: "veh-bad" }
    });
    assert.strictEqual(res.statusCode, 400);
  } finally { await app.close(); }
});

test("POST /api/fleet/drivers happy path returns driver row", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/fleet/drivers",
      headers: { cookie },
      payload: { fullName: "Արամ Մկրտչյան", licenseNo: "AM-0099", phone: "+37499000000", idempotencyKey: "drv-1" }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.driver.licenseNo, "AM-0099");
  } finally { await app.close(); }
});

test("PATCH /api/fleet/trips/:id/status transitions planned -> in_transit", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    // First, create a trip in the planned state.
    const create = await app.inject({
      method: "POST",
      url: "/api/fleet/trips",
      headers: { cookie },
      payload: {
        vehicleId: "v-ext-1", driverId: "d-ext-1",
        origin: "Yerevan", destination: "Vanadzor",
        plannedDeparture: "2026-06-08T08:00:00Z", idempotencyKey: "trip-ext-1"
      }
    });
    assert.strictEqual(create.statusCode, 200, create.body);
    const tripId = create.json().trip.id;
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/fleet/trips/${encodeURIComponent(tripId)}/status`,
      headers: { cookie },
      payload: { action: "departed", idempotencyKey: "patch-1" }
    });
    assert.strictEqual(patch.statusCode, 200, patch.body);
    assert.strictEqual(patch.json().trip.status, "in_transit");
  } finally { await app.close(); }
});

test("PATCH /api/fleet/trips/:id/status rejects invalid transition (400)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const create = await app.inject({
      method: "POST",
      url: "/api/fleet/trips",
      headers: { cookie },
      payload: {
        vehicleId: "v-ext-2", driverId: "d-ext-2",
        origin: "Yerevan", destination: "Gyumri",
        plannedDeparture: "2026-06-08T09:00:00Z", idempotencyKey: "trip-ext-2"
      }
    });
    const tripId = create.json().trip.id;
    // planned -> arrived is forbidden (must depart first)
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/fleet/trips/${encodeURIComponent(tripId)}/status`,
      headers: { cookie },
      payload: { action: "arrived", idempotencyKey: "patch-bad-1" }
    });
    assert.strictEqual(patch.statusCode, 400);
  } finally { await app.close(); }
});

test("POST /api/fleet/fuel-logs happy path writes row + audit", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const res = await app.inject({
      method: "POST",
      url: "/api/fleet/fuel-logs",
      headers: { cookie },
      payload: {
        vehicleId: "v-fuel-1", occurredAt: "2026-06-08T10:00:00Z",
        liters: 60, costAmd: 30000, odometerKm: 120000, idempotencyKey: "fl-1"
      }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(res.json().ok, true);
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.strictEqual(after, before + 1);
  } finally { await app.close(); }
});

test("POST /api/fleet/repairs happy path writes row + audit", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const res = await app.inject({
      method: "POST",
      url: "/api/fleet/repairs",
      headers: { cookie },
      payload: {
        vehicleId: "v-rep-1", kind: "oil-change",
        occurredAt: "2026-06-01T09:00:00Z", odometerKm: 110000,
        costAmd: 25000, nextDueAt: "2026-09-01", idempotencyKey: "rep-1"
      }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.strictEqual(after, before + 1);
  } finally { await app.close(); }
});

test("POST /api/fleet/tires/install happy path writes row + audit", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/fleet/tires/install",
      headers: { cookie },
      payload: {
        vehicleId: "v-tire-1", position: "FL",
        brand: "Michelin", installedAt: "2026-06-01",
        odometerAtInstall: 100000, expectedLifeKm: 60000, idempotencyKey: "tire-1"
      }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(res.json().tire.position, "FL");
  } finally { await app.close(); }
});

test("POST /api/fleet/devices/gps-batch requires X-Device-Token (401)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/fleet/devices/gps-batch",
      payload: { pings: [{ recordedAt: "2026-06-08T10:00:00Z", lat: 40.18, lon: 44.51 }], idempotencyKey: "gps-noauth" }
    });
    assert.strictEqual(res.statusCode, 401);
  } finally { await app.close(); }
});

test("POST /api/fleet/devices/gps-batch happy path with seeded device token", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    // Seed a device token via the raw DB.
    const rawToken = "tok-" + crypto.randomBytes(8).toString("hex");
    const orgId = app.db.prepare("SELECT id FROM organizations LIMIT 1").get().id;
    app.db.prepare(
      "INSERT INTO fleet_device_tokens (id, org_id, vehicle_id, token_hash, label) VALUES (?, ?, ?, ?, ?)"
    ).run("dvt-1", orgId, "v-gps-1", hashToken(rawToken), "test-gps");
    const res = await app.inject({
      method: "POST",
      url: "/api/fleet/devices/gps-batch",
      headers: { "x-device-token": rawToken },
      payload: {
        pings: [
          { recordedAt: "2026-06-08T10:00:00Z", lat: 40.18, lon: 44.51, speedKph: 60, ignitionOn: true },
          { recordedAt: "2026-06-08T10:05:00Z", lat: 40.19, lon: 44.52, speedKph: 65, ignitionOn: true }
        ],
        idempotencyKey: "gps-happy-1"
      }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(res.json().gps.accepted, 2);
    assert.strictEqual(res.json().gps.deduped, 0);
  } finally { await app.close(); }
});

test("POST /api/fleet/devices/cold-chain-batch requires X-Device-Token (401)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/fleet/devices/cold-chain-batch",
      payload: { readings: [{ recordedAt: "2026-06-08T10:00:00Z", tempC: 4 }], category: "dairy", idempotencyKey: "cc-noauth" }
    });
    assert.strictEqual(res.statusCode, 401);
  } finally { await app.close(); }
});

test("GET /api/fleet/vehicles/:id/cold-chain-compliance returns 404 for unknown vehicle (IDOR guard)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "GET",
      url: "/api/fleet/vehicles/does-not-exist/cold-chain-compliance",
      headers: { cookie }
    });
    assert.strictEqual(res.statusCode, 404);
  } finally { await app.close(); }
});

test("GET /api/fleet/analytics/fuel-efficiency returns efficiency list (200)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    // Seed two fuel logs in this month for the same vehicle.
    const orgId = app.db.prepare("SELECT id FROM organizations LIMIT 1").get().id;
    const iso = new Date().toISOString();
    const monthPrefix = iso.slice(0, 7);
    app.db.prepare(
      "INSERT INTO fleet_vehicles (id, org_id, plate, model, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run("v-eff-1", orgId, "77AA111", "MAN", iso);
    app.db.prepare(
      "INSERT INTO fleet_fuel_logs (id, org_id, vehicle_id, occurred_at, liters, cost_amd, odometer_km) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("fl-eff-1", orgId, "v-eff-1", monthPrefix + "-05T10:00:00Z", 40, 20000, 100000);
    app.db.prepare(
      "INSERT INTO fleet_fuel_logs (id, org_id, vehicle_id, occurred_at, liters, cost_amd, odometer_km) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("fl-eff-2", orgId, "v-eff-1", monthPrefix + "-15T10:00:00Z", 30, 15000, 101000);
    const res = await app.inject({
      method: "GET",
      url: `/api/fleet/analytics/fuel-efficiency?periodKey=${monthPrefix}`,
      headers: { cookie }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const eff = res.json().vehicles;
    assert.ok(Array.isArray(eff));
    assert.ok(eff.length >= 1);
    assert.ok(typeof eff[0].lPer100km === "number");
  } finally { await app.close(); }
});

test("GET /api/fleet/analytics/maintenance-backlog returns 200 with array", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "GET",
      url: "/api/fleet/analytics/maintenance-backlog",
      headers: { cookie }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.ok(Array.isArray(res.json().backlog));
  } finally { await app.close(); }
});
