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
