"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

async function seedPurchaseFixtures(app) {
  const cookie = await login(app);
  const vendorsList = await app.inject({ method: "GET", url: "/api/purchase/vendors", headers: { cookie } });
  const vendorId = vendorsList.json().vendors[0].id;
  const catalogRes = await app.inject({ method: "GET", url: "/api/catalog/items", headers: { cookie } });
  const itemId = catalogRes.json().items.find(i => i.trackStock).id;
  const orderRes = await app.inject({
    method: "POST", url: "/api/purchase/orders", headers: { cookie },
    payload: { vendorId, orderNumber: "PO-EX-" + Math.random().toString(36).slice(2, 8), supplier: "Yerevan Hardware", orderDate: "2026-06-08", expectedDate: "2026-06-15", lines: [{ catalogItemId: itemId, quantity: 10, unitCost: 100000 }] }
  });
  return { cookie, vendorId, itemId, orderId: orderRes.json().order.id };
}

test("procurement/requisitions is auth-gated (401)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/procurement/requisitions", payload: { neededBy: "2026-06-15", lines: [] } });
    assert.strictEqual(res.statusCode, 401);
  } finally { await app.close(); }
});

test("procurement/requisitions requires purchase app access (403)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({ method: "POST", url: "/api/procurement/requisitions", headers: { cookie }, payload: { neededBy: "2026-06-15", lines: [] } });
    assert.strictEqual(res.statusCode, 403);
  } finally { await app.close(); }
});

test("procurement/requisitions validates input (400)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({ method: "POST", url: "/api/procurement/requisitions", headers: { cookie }, payload: { neededBy: "" } });
    assert.strictEqual(res.statusCode, 400);
  } finally { await app.close(); }
});

test("procurement/requisitions happy path + audit + idempotency", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const { cookie, itemId, vendorId } = await seedPurchaseFixtures(app);
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const payload = {
      method: "POST", url: "/api/procurement/requisitions", headers: { cookie },
      payload: { neededBy: "2026-06-15", justification: "Restock fasteners", idempotencyKey: "pr-1",
        lines: [{ catalogItemId: itemId, quantity: 5, estUnitPrice: 95000, suggestedVendorId: vendorId }] }
    };
    const first = await app.inject(payload);
    const second = await app.inject(payload);
    assert.strictEqual(first.statusCode, 200, first.body);
    assert.strictEqual(second.statusCode, 200);
    assert.deepStrictEqual(first.json(), second.json());
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.strictEqual(after, before + 1, "idempotent replay must not double-write audit");
    const body = first.json();
    assert.ok(body.requisition.id);
    assert.strictEqual(body.requisition.status, "open");
  } finally { await app.close(); }
});

test("procurement/convert-to-rfq creates RFQ and scores vendors", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const { cookie, itemId, vendorId } = await seedPurchaseFixtures(app);
    const prRes = await app.inject({ method: "POST", url: "/api/procurement/requisitions", headers: { cookie },
      payload: { neededBy: "2026-06-15", idempotencyKey: "pr-2", lines: [{ catalogItemId: itemId, quantity: 5, estUnitPrice: 95000, suggestedVendorId: vendorId }] } });
    const prId = prRes.json().requisition.id;
    const res = await app.inject({ method: "POST", url: `/api/procurement/requisitions/${prId}/convert-to-rfq`, headers: { cookie },
      payload: { dueAt: "2026-06-12", idempotencyKey: "rfq-1" } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(body.rfq.id);
    assert.ok(Array.isArray(body.rfq.shortlistedVendors) && body.rfq.shortlistedVendors.length >= 1);
  } finally { await app.close(); }
});

test("procurement/rfqs/:id/quotes records quote and award creates draft PO", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const { cookie, itemId, vendorId } = await seedPurchaseFixtures(app);
    const prRes = await app.inject({ method: "POST", url: "/api/procurement/requisitions", headers: { cookie },
      payload: { neededBy: "2026-06-15", idempotencyKey: "pr-3", lines: [{ catalogItemId: itemId, quantity: 5, estUnitPrice: 95000, suggestedVendorId: vendorId }] } });
    const prId = prRes.json().requisition.id;
    const rfqRes = await app.inject({ method: "POST", url: `/api/procurement/requisitions/${prId}/convert-to-rfq`, headers: { cookie },
      payload: { dueAt: "2026-06-12", idempotencyKey: "rfq-2" } });
    const rfqId = rfqRes.json().rfq.id;
    const lines = prRes.json().requisition.lines;
    const quoteRes = await app.inject({ method: "POST", url: `/api/procurement/rfqs/${rfqId}/quotes`, headers: { cookie },
      payload: { vendorId, requisitionLineId: lines[0].id, unitPrice: 90000, currency: "AMD", validUntil: "2026-06-30", idempotencyKey: "quote-1" } });
    assert.strictEqual(quoteRes.statusCode, 200, quoteRes.body);
    const awardRes = await app.inject({ method: "POST", url: `/api/procurement/rfqs/${rfqId}/award`, headers: { cookie },
      payload: { vendorId, idempotencyKey: "award-1" } });
    assert.strictEqual(awardRes.statusCode, 200, awardRes.body);
    const body = awardRes.json();
    assert.strictEqual(body.purchaseOrder.status, "rfq");
  } finally { await app.close(); }
});

test("procurement/blanket-orders coverage check returns committed qty", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const { cookie, itemId, vendorId } = await seedPurchaseFixtures(app);
    const createRes = await app.inject({ method: "POST", url: "/api/procurement/blanket-orders", headers: { cookie },
      payload: { vendorId, catalogItemId: itemId, startDate: "2026-06-01", endDate: "2026-12-31", committedQty: 100, unitPrice: 80000, currency: "AMD", idempotencyKey: "bo-1" } });
    assert.strictEqual(createRes.statusCode, 200, createRes.body);
    const covRes = await app.inject({ method: "GET", url: `/api/procurement/blanket-orders/coverage?productId=${itemId}`, headers: { cookie } });
    assert.strictEqual(covRes.statusCode, 200);
    const body = covRes.json();
    assert.ok(body.coverage.committedQty >= 100);
  } finally { await app.close(); }
});

test("procurement/landed-costs allocates by value to PO lines", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const { cookie, orderId } = await seedPurchaseFixtures(app);
    const res = await app.inject({ method: "POST", url: "/api/procurement/landed-costs", headers: { cookie },
      payload: { poId: orderId, kind: "freight", amount: 50000, currency: "AMD", allocationMethod: "value", idempotencyKey: "lc-1" } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(body.allocation.allocations.length >= 1);
    assert.ok(body.allocation.totalAllocated === 50000);
  } finally { await app.close(); }
});

test("procurement/credit-notes requires open period and writes AP reversal", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const { cookie, orderId, itemId } = await seedPurchaseFixtures(app);
    // Close the period for the order date
    app.db.prepare("INSERT OR REPLACE INTO period_locks (org_id, period, locked_at, locked_by_user_id) VALUES (?, ?, ?, ?)")
      .run("org-default", "2026-06", new Date().toISOString(), "user-default");
    const blockedRes = await app.inject({ method: "POST", url: "/api/procurement/credit-notes", headers: { cookie },
      payload: { poId: orderId, amount: 30000, currency: "AMD", idempotencyKey: "cn-1" } });
    assert.strictEqual(blockedRes.statusCode, 423, blockedRes.body);
    // Unlock and re-try
    app.db.prepare("DELETE FROM period_locks WHERE org_id = ? AND period = ?").run("org-default", "2026-06");
    const okRes = await app.inject({ method: "POST", url: "/api/procurement/credit-notes", headers: { cookie },
      payload: { poId: orderId, amount: 30000, currency: "AMD", idempotencyKey: "cn-2" } });
    assert.strictEqual(okRes.statusCode, 200, okRes.body);
    const body = okRes.json();
    assert.strictEqual(body.creditNote.status, "posted");
  } finally { await app.close(); }
});

test("procurement/ai/select-vendor returns deterministic local score", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const { cookie, itemId, vendorId } = await seedPurchaseFixtures(app);
    const res = await app.inject({ method: "POST", url: "/api/procurement/ai/select-vendor", headers: { cookie },
      payload: { catalogItemId: itemId, quantity: 10, idempotencyKey: "ai-1" } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(Array.isArray(body.candidates));
    assert.ok(body.candidates[0].score > 0);
  } finally { await app.close(); }
});

test("procurement/ai/price-anomaly flags vendor price above history", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const { cookie, itemId, vendorId } = await seedPurchaseFixtures(app);
    const res = await app.inject({ method: "POST", url: "/api/procurement/ai/price-anomaly", headers: { cookie },
      payload: { catalogItemId: itemId, proposedUnitPrice: 500000, currency: "AMD", idempotencyKey: "pa-1" } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.verdict, "anomaly");
    assert.ok(body.deviationPct > 0);
  } finally { await app.close(); }
});

test("procurement/analytics/replenishment returns suggestions", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const { cookie } = await seedPurchaseFixtures(app);
    const res = await app.inject({ method: "GET", url: "/api/procurement/analytics/replenishment", headers: { cookie } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(Array.isArray(body.suggestions));
  } finally { await app.close(); }
});
