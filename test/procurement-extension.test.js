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
    const { cookie, itemId, vendorId, orderId } = await seedPurchaseFixtures(app);
    const createRes = await app.inject({ method: "POST", url: "/api/procurement/blanket-orders", headers: { cookie },
      payload: { vendorId, catalogItemId: itemId, startDate: "2026-06-01", endDate: "2026-12-31", committedQty: 100, unitPrice: 80000, currency: "AMD", idempotencyKey: "bo-1" } });
    assert.strictEqual(createRes.statusCode, 200, createRes.body);
    const created = createRes.json();
    const item = app.db.prepare("SELECT sku FROM catalog_items WHERE org_id = ? AND id = ?").get("org-armosphera-demo", itemId);
    assert.strictEqual(created.blanket.id, created.blanketOrder.id);
    assert.strictEqual(created.blanket.vendorId, vendorId);
    assert.strictEqual(created.blanket.catalogItemId, itemId);
    assert.strictEqual(created.blanket.vendorName, "Yerevan Hardware Supply");
    assert.strictEqual(created.blanket.sku, item.sku);
    assert.strictEqual(created.blanket.remainingQty, 100);
    const covRes = await app.inject({ method: "GET", url: `/api/procurement/blanket-orders/coverage?productId=${itemId}`, headers: { cookie } });
    assert.strictEqual(covRes.statusCode, 200);
    const body = covRes.json();
    assert.strictEqual(body.coverage.committedQty, 100);
    assert.strictEqual(body.coverage.openPoQty, 10);
    assert.strictEqual(body.coverage.remainingQty, 90);
    assert.strictEqual(body.coverage.uncoveredOpenPoQty, 0);
    assert.strictEqual(body.coverage.blanketOrderCount, 1);
    assert.strictEqual(body.coverage.blanketOrders.length, 1);
    assert.strictEqual(body.coverage.blanketOrders[0].id, created.blanket.id);
    assert.strictEqual(body.coverage.blanketOrders[0].consumedQty, 10);
    assert.strictEqual(body.coverage.blanketOrders[0].remainingQty, 90);
    assert.strictEqual(body.coverage.blanketOrders[0].unitPrice, 80000);

    const today = new Date();
    const offsetDate = days => new Date(today.getTime() + (days * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const insertBlanket = app.db.prepare(`
      INSERT INTO blanket_orders (
        id, org_id, vendor_id, catalog_item_id, start_date, end_date,
        committed_qty, unit_price, currency, uom, note, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertBlanket.run(
      "bo-expired-coverage",
      "org-armosphera-demo",
      vendorId,
      itemId,
      offsetDate(-30),
      offsetDate(-1),
      500,
      75000,
      "AMD",
      "հատ",
      "Expired agreement must not cover demand.",
      now
    );
    insertBlanket.run(
      "bo-future-coverage",
      "org-armosphera-demo",
      vendorId,
      itemId,
      offsetDate(10),
      offsetDate(40),
      600,
      74000,
      "AMD",
      "հատ",
      "Future agreement must not cover demand yet.",
      now
    );
    const filteredCov = await app.inject({ method: "GET", url: `/api/procurement/blanket-orders/coverage?productId=${itemId}`, headers: { cookie } });
    assert.strictEqual(filteredCov.statusCode, 200, filteredCov.body);
    assert.strictEqual(filteredCov.json().coverage.committedQty, 100);
    assert.deepStrictEqual(filteredCov.json().coverage.blanketOrders.map(item => item.id), [created.blanket.id]);

    app.db.prepare("UPDATE purchase_order_lines SET quantity = ? WHERE org_id = ? AND purchase_order_id = ? AND catalog_item_id = ?")
      .run(160, "org-armosphera-demo", orderId, itemId);
    const uncoveredCov = await app.inject({ method: "GET", url: `/api/procurement/blanket-orders/coverage?productId=${itemId}`, headers: { cookie } });
    assert.strictEqual(uncoveredCov.statusCode, 200, uncoveredCov.body);
    assert.strictEqual(uncoveredCov.json().coverage.openPoQty, 160);
    assert.strictEqual(uncoveredCov.json().coverage.remainingQty, 0);
    assert.strictEqual(uncoveredCov.json().coverage.uncoveredOpenPoQty, 60);
    assert.strictEqual(uncoveredCov.json().coverage.blanketOrders[0].consumedQty, 100);
    assert.strictEqual(uncoveredCov.json().coverage.blanketOrders[0].remainingQty, 0);

    const invalidWindow = await app.inject({ method: "POST", url: "/api/procurement/blanket-orders", headers: { cookie },
      payload: { vendorId, catalogItemId: itemId, startDate: "2026-12-31", endDate: "2026-06-01", committedQty: 10, unitPrice: 80000, currency: "AMD", idempotencyKey: "bo-invalid-window" } });
    assert.strictEqual(invalidWindow.statusCode, 400, invalidWindow.body);

    app.db.prepare("UPDATE purchase_vendors SET status = 'inactive' WHERE org_id = ? AND id = ?").run("org-armosphera-demo", vendorId);
    const inactiveVendor = await app.inject({ method: "POST", url: "/api/procurement/blanket-orders", headers: { cookie },
      payload: { vendorId, catalogItemId: itemId, startDate: "2026-06-01", endDate: "2026-12-31", committedQty: 10, unitPrice: 80000, currency: "AMD", idempotencyKey: "bo-inactive-vendor" } });
    assert.strictEqual(inactiveVendor.statusCode, 404, inactiveVendor.body);

    const emptyCov = await app.inject({ method: "GET", url: "/api/procurement/blanket-orders/coverage?productId=catitem-router", headers: { cookie } });
    assert.strictEqual(emptyCov.statusCode, 200, emptyCov.body);
    assert.deepStrictEqual(emptyCov.json().coverage.blanketOrders, []);
    assert.strictEqual(emptyCov.json().coverage.committedQty, 0);
  } finally { await app.close(); }
});

test("procurement/landed-costs allocates by value to PO lines", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const orgId = "org-armosphera-demo";
    const { cookie, orderId } = await seedPurchaseFixtures(app);
    const res = await app.inject({ method: "POST", url: "/api/procurement/landed-costs", headers: { cookie },
      payload: { poId: orderId, kind: "freight", amount: 50000, currency: "AMD", allocationMethod: "value", idempotencyKey: "lc-1" } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(body.landed.id);
    assert.strictEqual(body.landed.id, body.allocation.id);
    assert.strictEqual(body.landed.poId, orderId);
    assert.strictEqual(body.landed.totalAllocated, 50000);
    assert.strictEqual(body.landed.allocated.reduce((sum, item) => sum + item.amount, 0), 50000);
    assert.ok(body.allocation.allocations.length >= 1);
    assert.ok(body.allocation.totalAllocated === 50000);
    assert.strictEqual(body.allocation.allocations.reduce((sum, item) => sum + item.allocated, 0), 50000);
    const stored = app.db.prepare("SELECT allocation_json FROM landed_cost_allocations WHERE org_id = ? AND po_id = ?").get(orgId, orderId);
    assert.ok(stored);
    assert.deepStrictEqual(JSON.parse(stored.allocation_json), body.landed.allocated);
    const lineRows = app.db.prepare(`
      SELECT *
      FROM landed_cost_lines
      WHERE org_id = ? AND po_id = ?
      ORDER BY created_at, id
    `).all(orgId, orderId);
    assert.strictEqual(lineRows.length, body.landed.allocated.length);
    assert.strictEqual(lineRows.reduce((sum, item) => sum + item.amount, 0), 50000);
    assert.strictEqual(lineRows[0].landed_cost_allocation_id, body.landed.id);
    assert.strictEqual(lineRows[0].purchase_order_line_id, body.landed.allocated[0].lineId);
    assert.strictEqual(lineRows[0].unit_cost_delta, body.landed.allocated[0].unitCostAdjustment);

    const orders = await app.inject({ method: "GET", url: "/api/purchase/orders", headers: { cookie } });
    assert.strictEqual(orders.statusCode, 200, orders.body);
    const order = orders.json().orders.find(item => item.id === orderId);
    assert.strictEqual(order.landedCostCount, 1);
    assert.strictEqual(order.landedCostAmount, 50000);
    assert.strictEqual(order.landedCosts[0].id, body.landed.id);
    assert.strictEqual(order.landedCosts[0].allocated[0].amount, body.landed.allocated[0].amount);
    assert.strictEqual(order.landedCosts[0].allocated[0].landedCostId, body.landed.id);
    assert.strictEqual(order.lines[0].landedCostAmount, 50000);
    assert.strictEqual(order.lines[0].landedUnitCostDelta, 5000);
    assert.strictEqual(order.lines[0].effectiveUnitCost, 105000);
    assert.strictEqual(order.lines[0].landedCosts[0].landedCostId, body.landed.id);

    const detail = await app.inject({ method: "GET", url: `/api/purchase/orders/${orderId}`, headers: { cookie } });
    assert.strictEqual(detail.statusCode, 200, detail.body);
    const detailOrder = detail.json();
    assert.strictEqual(detailOrder.id, orderId);
    assert.strictEqual(detailOrder.landedCostAmount, 50000);
    assert.strictEqual(detailOrder.lines[0].effectiveUnitCost, 105000);

    const confirmed = await app.inject({ method: "POST", url: `/api/purchase/orders/${orderId}/confirm`, headers: { cookie }, payload: {} });
    assert.strictEqual(confirmed.statusCode, 200, confirmed.body);
    const received = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${orderId}/receive`,
      headers: { cookie },
      payload: {
        receivedAt: "2026-06-12",
        reference: "LC-RECEIPT-1",
        lines: [{ lineId: detailOrder.lines[0].id, quantity: 10 }]
      }
    });
    assert.strictEqual(received.statusCode, 200, received.body);
    assert.strictEqual(received.json().stockMoves[0].unitCost, 105000);
    assert.strictEqual(received.json().stockMoves[0].totalCost, 1050000);

    const blocked = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${orderId}/landed-costs`,
      headers: { cookie },
      payload: { kind: "insurance", amount: 1000, currency: "AMD", allocationMethod: "value", idempotencyKey: "lc-after-receipt" }
    });
    assert.strictEqual(blocked.statusCode, 409, blocked.body);

    const analytics = await app.inject({ method: "GET", url: "/api/purchase/analytics", headers: { cookie } });
    assert.strictEqual(analytics.statusCode, 200, analytics.body);
    assert.strictEqual(analytics.json().summary.landedCostAmount, 50000);
    assert.strictEqual(analytics.json().summary.landedCostCount, 1);

    const backup = await app.inject({ method: "POST", url: "/api/admin/backups", headers: { cookie }, payload: { note: "landed cost backup evidence" } });
    assert.strictEqual(backup.statusCode, 200, backup.body);
    assert.ok(backup.json().backup.payload.tables.landed_cost_allocations.some(item => item.id === body.landed.id && item.po_id === orderId));
    assert.ok(backup.json().backup.payload.tables.landed_cost_lines.some(item => item.landed_cost_allocation_id === body.landed.id && item.po_id === orderId));
  } finally { await app.close(); }
});

test("purchase/order landed-cost route returns updated purchase order evidence", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const { cookie, orderId } = await seedPurchaseFixtures(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${orderId}/landed-costs`,
      headers: { cookie },
      payload: { kind: "customs", amount: 25000, currency: "AMD", allocationMethod: "quantity", idempotencyKey: "po-lc-1" }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.landed.id, body.allocation.id);
    assert.strictEqual(body.order.id, orderId);
    assert.strictEqual(body.order.landedCostCount, 1);
    assert.strictEqual(body.order.landedCostAmount, 25000);
    assert.strictEqual(body.order.lines[0].landedCostAmount, 25000);
    assert.strictEqual(body.order.lines[0].landedUnitCostDelta, 2500);
    assert.strictEqual(body.order.lines[0].effectiveUnitCost, 102500);
    const replay = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${orderId}/landed-costs`,
      headers: { cookie },
      payload: { kind: "customs", amount: 25000, currency: "AMD", allocationMethod: "quantity", idempotencyKey: "po-lc-1" }
    });
    assert.strictEqual(replay.statusCode, 200, replay.body);
    assert.deepStrictEqual(replay.json(), body);
    const storedKey = app.db.prepare("SELECT key FROM idempotency_keys WHERE org_id = ? AND key = ?")
      .get("org-armosphera-demo", `purchase-order-landed:${orderId}:po-lc-1`);
    assert.ok(storedKey);
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
    const { cookie, orderId, itemId } = await seedPurchaseFixtures(app);
    const orgId = "org-armosphera-demo";
    app.db.prepare(`
      UPDATE stock_quants
      SET quantity = 0, reserved_quantity = 0
      WHERE org_id = ? AND catalog_item_id = ?
    `).run(orgId, itemId);
    const customerId = app.db.prepare("SELECT id FROM customers WHERE org_id = ? LIMIT 1").get(orgId).id;
    const now = new Date().toISOString();
    app.db.prepare(`
      INSERT INTO quotes (
        id, org_id, customer_id, deal_id, number, title, status, subtotal, vat,
        total, currency, valid_until, public_token, sent_at, accepted_at,
        created_by_user_id, created_at, updated_at
      )
      VALUES (?, ?, ?, NULL, ?, ?, 'sent', ?, ?, ?, 'AMD', ?, ?, ?, NULL, ?, ?, ?)
    `).run(
      "quote-replenishment-demand",
      orgId,
      customerId,
      "Q-REPLENISH-001",
      "Scanner rollout quote",
      4000000,
      800000,
      4800000,
      "2027-01-01",
      "public-quote-replenishment-demand",
      now,
      "user-owner",
      now,
      now
    );
    app.db.prepare(`
      INSERT INTO quote_lines (
        id, org_id, quote_id, catalog_item_id, description, quantity, unit_price,
        total, position
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "quote-line-replenishment-demand",
      orgId,
      "quote-replenishment-demand",
      itemId,
      "POS scanner sales demand",
      40,
      100000,
      4000000,
      1
    );
    const res = await app.inject({ method: "GET", url: "/api/procurement/analytics/replenishment", headers: { cookie } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(Array.isArray(body.suggestions));
    const suggestion = body.suggestions.find(item => item.catalogItemId === itemId);
    assert.ok(suggestion, "expected scanner replenishment suggestion from sales quote demand");
    assert.strictEqual(suggestion.salesQuoteDemand, 40);
    assert.strictEqual(suggestion.salesDemandQty, 40);
    assert.strictEqual(suggestion.openPoQty, 10);
    assert.strictEqual(suggestion.openPurchaseQty, 10);
    assert.strictEqual(suggestion.onHand, 0);
    assert.strictEqual(suggestion.availableStock, 0);
    assert.strictEqual(suggestion.safetyStockQty, 10);
    assert.strictEqual(suggestion.suggestedQty, 40);
    assert.strictEqual(suggestion.recommendedVendorId, "vendor-yerevan-hardware-supply");
    assert.strictEqual(suggestion.recommendedVendor.vendorName, "Yerevan Hardware Supply");
    assert.strictEqual(suggestion.leadTimeDays, 2);
    assert.deepStrictEqual(suggestion.demandSources, { stockMoves: 0, salesQuotes: 40, openPurchaseOrders: 10 });
    assert.ok(suggestion.reasoning.includes("sales demand 40"));
    assert.ok(suggestion.drivers.includes("sales-demand"));
    assert.strictEqual(body.summary.suggestionCount, body.suggestions.length);
    assert.ok(body.summary.salesDemandQty >= 40);

    app.db.prepare("UPDATE purchase_order_lines SET quantity = ? WHERE org_id = ? AND purchase_order_id = ?")
      .run(60, orgId, orderId);
    const covered = await app.inject({ method: "GET", url: "/api/procurement/analytics/replenishment", headers: { cookie } });
    assert.strictEqual(covered.statusCode, 200, covered.body);
    assert.equal(covered.json().suggestions.some(item => item.catalogItemId === itemId), false);
  } finally { await app.close(); }
});
