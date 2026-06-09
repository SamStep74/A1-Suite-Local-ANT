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
