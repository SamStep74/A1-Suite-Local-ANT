"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

async function seedCategory(app, cookie, name = "Սարքեր") {
  const res = await app.inject({
    method: "POST",
    url: "/api/assets/categories",
    headers: { cookie },
    payload: {
      idempotencyKey: `cat-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      defaultUsefulLifeMonths: 60,
      defaultDepreciationMethod: "straight_line",
      defaultResidualPct: 10,
      assetAccountId: "111",
      accumDeprAccountId: "112",
      deprExpenseAccountId: "711"
    }
  });
  assert.strictEqual(res.statusCode, 200, res.body);
  return res.json().category;
}

test("assets:create is auth-gated", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/assets/categories", payload: { name: "x" } });
    assert.strictEqual(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("assets:create requires assets app access", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/assets/categories",
      headers: { cookie },
      payload: { name: "x", idempotencyKey: "no-access" }
    });
    assert.strictEqual(res.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("assets:create validates input", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/assets/categories",
      headers: { cookie },
      payload: { idempotencyKey: "missing-name" }
    });
    assert.strictEqual(res.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("assets:create writes audit row", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    const cat = await seedCategory(app, cookie);
    assert.ok(cat.id, "category id returned");
    const after = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    assert.strictEqual(after, before + 1);
  } finally {
    await app.close();
  }
});

test("assets:create is idempotent on replay", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    const idem = `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      method: "POST",
      url: "/api/assets/categories",
      headers: { cookie },
      payload: {
        idempotencyKey: idem,
        name: "Հովացման համակարգեր",
        defaultUsefulLifeMonths: 84,
        defaultDepreciationMethod: "reducing_balance",
        defaultResidualPct: 5,
        assetAccountId: "111",
        accumDeprAccountId: "112",
        deprExpenseAccountId: "711"
      }
    };
    const first = await app.inject(payload);
    const second = await app.inject(payload);
    assert.strictEqual(first.statusCode, 200);
    assert.strictEqual(second.statusCode, 200);
    assert.deepStrictEqual(first.json(), second.json());
    const after = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    assert.strictEqual(after, before + 1, "idempotent replay must not double-write audit");
  } finally {
    await app.close();
  }
});

test("assets:depreciation schedule applies straight-line math", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const cat = await seedCategory(app, cookie);
    const create = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: { cookie },
      payload: {
        idempotencyKey: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        categoryId: cat.id,
        name: "Samsung սառնարան #1",
        serial: "SR-0001",
        purchaseDate: "2026-01-15",
        purchaseCostAmd: 1200000,
        vendorId: "v-samsung",
        locationId: "wh-cold-1",
        salvageValueAmd: 120000
      }
    });
    assert.strictEqual(create.statusCode, 200, create.body);
    const asset = create.json().asset;
    const sched = await app.inject({ method: "GET", url: `/api/assets/${asset.id}/depreciation`, headers: { cookie } });
    assert.strictEqual(sched.statusCode, 200);
    const body = sched.json();
    assert.strictEqual(body.schedule.length, 60, "60 monthly periods");
    assert.strictEqual(body.schedule[0].depreciationAmd, 18000, "straight-line = (1200000-120000)/60");
    assert.strictEqual(body.schedule[body.schedule.length - 1].netBookValueAmd, 120000, "ends at salvage");
  } finally {
    await app.close();
  }
});
