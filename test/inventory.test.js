"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD, openDatabase, __test } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const response = await app.inject({
    method: "POST",
    url: "/api/login",
    payload: { email, password }
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.headers["set-cookie"];
}

function readStock(app, orgId, catalogItemId, locationId) {
  const row = app.db.prepare(`
    SELECT quantity, reserved_quantity AS reservedQuantity, average_cost AS averageCost
    FROM stock_quants
    WHERE org_id = ? AND catalog_item_id = ? AND location_id = ?
  `).get(orgId, catalogItemId, locationId);
  return row || { quantity: 0, reservedQuantity: 0, averageCost: 0 };
}

function setFinancePeriodStatus(app, orgId, periodKey, status) {
  const [year, month] = periodKey.split("-").map(Number);
  const endsOn = `${periodKey}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
  const now = new Date().toISOString();
  const existing = app.db.prepare("SELECT id FROM finance_periods WHERE org_id = ? AND period_key = ?").get(orgId, periodKey);
  if (existing) {
    app.db.prepare(`
      UPDATE finance_periods
      SET status = ?, closed_at = ?, closed_by_user_id = NULL, reason = ?, updated_at = ?
      WHERE org_id = ? AND period_key = ?
    `).run(status, status === "closed" ? now : null, `Inventory valuation test ${status}`, now, orgId, periodKey);
    return;
  }
  app.db.prepare(`
    INSERT INTO finance_periods (
      id, org_id, period_key, starts_on, ends_on, status, closed_at,
      closed_by_user_id, reason, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `).run(
    `period-inventory-${periodKey}`,
    orgId,
    periodKey,
    `${periodKey}-01`,
    endsOn,
    status,
    status === "closed" ? now : null,
    `Inventory valuation test ${status}`,
    now,
    now
  );
}

test("inventory: seeded stock ledger is auth-gated, role-scoped, and backup-scoped", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();

    const unauthenticated = await app.inject({ method: "GET", url: "/api/inventory/stock" });
    assert.equal(unauthenticated.statusCode, 401);

    const owner = await login(app);
    const stockResponse = await app.inject({ method: "GET", url: "/api/inventory/stock", headers: { cookie: owner } });
    assert.equal(stockResponse.statusCode, 200, stockResponse.body);
    const stockBody = stockResponse.json();
    assert.ok(stockBody.locations.some(location => location.id === "stockloc-main-warehouse" && location.locationType === "internal"));
    assert.ok(stockBody.locations.some(location => location.id === "stockloc-dispatch-staging" && location.parentLocationId === "stockloc-main-warehouse"));
    assert.ok(stockBody.locations.some(location => location.id === "stockloc-customer" && location.locationType === "customer"));
    const scannerStock = stockBody.stock.find(row => row.catalogItemId === "catitem-pos-barcode-scanner" && row.locationId === "stockloc-main-warehouse");
    assert.ok(scannerStock, "seeded barcode scanner stock is visible");
    assert.equal(scannerStock.catalogSku, "HW-BARCODE-SCANNER");
    assert.equal(scannerStock.quantity, 12);
    assert.equal(scannerStock.availableQuantity, 12);
    assert.equal(scannerStock.averageCost, 62000);

    const auditor = await login(app, "auditor@armosphera.local");
    const auditorRead = await app.inject({ method: "GET", url: "/api/inventory/moves", headers: { cookie: auditor } });
    assert.equal(auditorRead.statusCode, 200, auditorRead.body);
    const auditorWrite = await app.inject({
      method: "POST",
      url: "/api/inventory/moves",
      headers: { cookie: auditor },
      payload: { catalogItemId: "catitem-pos-barcode-scanner", sourceLocationId: "stockloc-main-warehouse", destinationLocationId: "stockloc-dispatch-staging", moveType: "transfer", quantity: 1 }
    });
    assert.equal(auditorWrite.statusCode, 403, auditorWrite.body);

    const support = await login(app, "support@armosphera.local");
    const supportDenied = await app.inject({ method: "GET", url: "/api/inventory/stock", headers: { cookie: support } });
    assert.equal(supportDenied.statusCode, 403);

    const backup = await app.inject({
      method: "POST",
      url: "/api/admin/backups",
      headers: { cookie: owner },
      payload: { note: "Inventory stock ledger must be included in tenant backup scope." }
    });
    assert.equal(backup.statusCode, 200, backup.body);
    const backupTables = backup.json().backup.payload.tables;
    assert.ok(backupTables.stock_locations.some(location => location.id === "stockloc-main-warehouse"));
    const locationOrder = new Map(backupTables.stock_locations.map((location, index) => [location.id, index]));
    for (const location of backupTables.stock_locations) {
      if (location.parent_location_id) {
        assert.ok(locationOrder.get(location.parent_location_id) < locationOrder.get(location.id), "stock location backup parents must come before children");
      }
    }
    assert.ok(backupTables.stock_quants.some(quant => quant.catalog_item_id === "catitem-pos-barcode-scanner"));
    assert.ok(backupTables.stock_moves.some(move => move.id === "stockmove-pos-scanner-opening"));
  } finally {
    await app.close();
  }
});

test("inventory: posting stock moves updates internal balances with virtual endpoint evidence", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const accountant = await login(app, "accountant@armosphera.local");
    const orgId = "org-armosphera-demo";
    const currentPeriodKey = new Date().toISOString().slice(0, 7);
    setFinancePeriodStatus(app, orgId, currentPeriodKey, "open");
    const valuationCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM ledger_journal
      WHERE org_id = ? AND source_type = 'stock_move_valuation'
    `).get(orgId).count;
    const counts = () => ({
      moves: app.db.prepare("SELECT COUNT(*) AS count FROM stock_moves WHERE org_id = ?").get(orgId).count,
      audits: app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type = ?").get(orgId, "inventory.stock_move.posted").count,
      events: app.db.prepare("SELECT COUNT(*) AS count FROM suite_events WHERE org_id = ? AND event_type = ?").get(orgId, "inventory.stock_move.posted").count,
      valuationRows: valuationCount()
    });

    const before = counts();
    const created = await app.inject({
      method: "POST",
      url: "/api/inventory/moves",
      headers: { cookie: accountant },
      payload: {
        catalogItemId: "catitem-pos-barcode-scanner",
        sourceLocationId: "stockloc-main-warehouse",
        destinationLocationId: "stockloc-dispatch-staging",
        moveType: "transfer",
        quantity: 5,
        unitCost: 1,
        reason: "Stage scanners for Armenian retail POS dispatch.",
        reference: "PICK-2026-001"
      }
    });
    assert.equal(created.statusCode, 200, created.body);
    const move = created.json().move;
    assert.match(move.id, /^stockmove-/);
    assert.equal(move.catalogSku, "HW-BARCODE-SCANNER");
    assert.equal(move.sourceLocationCode, "WH/STOCK");
    assert.equal(move.sourceLocationType, "internal");
    assert.equal(move.destinationLocationCode, "WH/OUT");
    assert.equal(move.destinationLocationType, "internal");
    assert.equal(move.quantity, 5);
    assert.equal(move.unitCost, 62000);
    assert.equal(move.totalCost, 310000);
    assert.equal(move.status, "posted");
    assert.equal(move.valuationPosting, null);
    assert.equal(readStock(app, orgId, "catitem-pos-barcode-scanner", "stockloc-main-warehouse").quantity, 7);
    assert.equal(readStock(app, orgId, "catitem-pos-barcode-scanner", "stockloc-dispatch-staging").quantity, 5);
    assert.equal(readStock(app, orgId, "catitem-pos-barcode-scanner", "stockloc-dispatch-staging").averageCost, 62000);
    assert.equal(counts().moves, before.moves + 1);
    assert.equal(counts().audits, before.audits + 1);
    assert.equal(counts().events, before.events + 1);

    const adjustment = await app.inject({
      method: "POST",
      url: "/api/inventory/moves",
      headers: { cookie: accountant },
      payload: {
        catalogItemId: "catitem-pos-barcode-scanner",
        destinationLocationId: "stockloc-dispatch-staging",
        moveType: "adjustment",
        quantity: 3,
        unitCost: 65000,
        reason: "Cycle count gain for staged scanner hardware.",
        reference: "COUNT-2026-001"
      }
    });
    assert.equal(adjustment.statusCode, 200, adjustment.body);
    assert.equal(adjustment.json().move.sourceLocationCode, "INV/ADJUST");
    assert.equal(adjustment.json().move.destinationLocationCode, "WH/OUT");
    assert.equal(adjustment.json().move.unitCost, 65000);
    assert.equal(adjustment.json().move.totalCost, 195000);
    assert.equal(adjustment.json().move.valuationPosting, null);
    assert.equal(readStock(app, orgId, "catitem-pos-barcode-scanner", "stockloc-dispatch-staging").quantity, 8);
    assert.equal(readStock(app, orgId, "catitem-pos-barcode-scanner", "stockloc-dispatch-staging").averageCost, 63125);

    const delivery = await app.inject({
      method: "POST",
      url: "/api/inventory/moves",
      headers: { cookie: accountant },
      payload: {
        catalogItemId: "catitem-pos-barcode-scanner",
        sourceLocationId: "stockloc-dispatch-staging",
        moveType: "delivery",
        quantity: 2,
        reason: "Customer delivery leaves warehouse stock only.",
        reference: "DELIVERY-2026-001"
      }
    });
    assert.equal(delivery.statusCode, 200, delivery.body);
    assert.equal(delivery.json().move.destinationLocationCode, "CUSTOMERS");
    assert.equal(delivery.json().move.destinationLocationType, "customer");
    assert.equal(delivery.json().move.unitCost, 63125);
    assert.equal(delivery.json().move.totalCost, 126250);
    const deliveryMove = delivery.json().move;
    assert.match(deliveryMove.valuationPosting.id, /^jrn-/);
    assert.equal(deliveryMove.valuationPosting.sourceType, "stock_move_valuation");
    assert.equal(deliveryMove.valuationPosting.sourceId, deliveryMove.id);
    assert.equal(deliveryMove.valuationPosting.periodKey, currentPeriodKey);
    assert.equal(deliveryMove.valuationPosting.entryDate, deliveryMove.createdAt.slice(0, 10));
    assert.equal(deliveryMove.valuationPosting.debitCode, "711");
    assert.equal(deliveryMove.valuationPosting.creditCode, "216");
    assert.equal(deliveryMove.valuationPosting.amount, 126250);
    const journal = app.db.prepare(`
      SELECT debit_code AS debitCode, credit_code AS creditCode, amount, period_key AS periodKey
      FROM ledger_journal
      WHERE org_id = ? AND source_type = 'stock_move_valuation' AND source_id = ?
    `).get(orgId, deliveryMove.id);
    assert.deepEqual({ ...journal }, { debitCode: "711", creditCode: "216", amount: 126250, periodKey: currentPeriodKey });
    assert.equal(readStock(app, orgId, "catitem-pos-barcode-scanner", "stockloc-dispatch-staging").quantity, 6);
    assert.equal(readStock(app, orgId, "catitem-pos-barcode-scanner", "stockloc-customer").quantity, 0);
    assert.equal(counts().moves, before.moves + 3);
    assert.equal(counts().audits, before.audits + 3);
    assert.equal(counts().events, before.events + 3);
    assert.equal(counts().valuationRows, before.valuationRows + 1);

    const observedValuationCount = valuationCount();
    const filteredMoves = await app.inject({
      method: "GET",
      url: "/api/inventory/moves?locationId=stockloc-dispatch-staging",
      headers: { cookie: accountant }
    });
    assert.equal(filteredMoves.statusCode, 200, filteredMoves.body);
    assert.ok(filteredMoves.json().moves.some(row => row.id === move.id));
    assert.ok(filteredMoves.json().moves.some(row => row.id === adjustment.json().move.id));
    const observedDelivery = filteredMoves.json().moves.find(row => row.id === deliveryMove.id);
    assert.ok(observedDelivery);
    assert.deepEqual(observedDelivery.valuationPosting, deliveryMove.valuationPosting);

    const observedAgain = await app.inject({
      method: "GET",
      url: "/api/inventory/moves?locationId=stockloc-dispatch-staging",
      headers: { cookie: accountant }
    });
    assert.equal(observedAgain.statusCode, 200, observedAgain.body);
    assert.equal(valuationCount(), observedValuationCount);
  } finally {
    await app.close();
  }
});

test("inventory: linked delivery moves surface material cost on service field visits", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const accountant = await login(app, "accountant@armosphera.local");
    const orgId = "org-armosphera-demo";
    const currentPeriodKey = new Date().toISOString().slice(0, 7);
    setFinancePeriodStatus(app, orgId, currentPeriodKey, "open");

    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: owner } })).json();
    const serviceCase = console1.cases[0];
    const assignee = console1.agents.find(agent => agent.role === "Service Manager") || console1.agents[0];
    const visit = await app.inject({
      method: "POST",
      url: "/api/service/field-visits",
      headers: { cookie: owner },
      payload: {
        caseId: serviceCase.id,
        customerId: serviceCase.customerId,
        assignedUserId: assignee.id,
        scheduledStartAt: "2026-05-14T08:00:00.000Z",
        scheduledEndAt: "2026-05-14T09:15:00.000Z",
        status: "scheduled",
        location: "Ani Beauty material visit",
        worksheetSummary: "Deliver scanner material for service visit."
      }
    });
    assert.equal(visit.statusCode, 200, visit.body);

    const rejectedTransfer = await app.inject({
      method: "POST",
      url: "/api/inventory/moves",
      headers: { cookie: accountant },
      payload: {
        catalogItemId: "catitem-pos-barcode-scanner",
        sourceLocationId: "stockloc-main-warehouse",
        destinationLocationId: "stockloc-dispatch-staging",
        moveType: "transfer",
        quantity: 1,
        serviceFieldVisitId: visit.json().visit.id,
        reason: "Transfers should not count as consumed service material."
      }
    });
    assert.equal(rejectedTransfer.statusCode, 400, rejectedTransfer.body);

    const linkedDelivery = await app.inject({
      method: "POST",
      url: "/api/inventory/moves",
      headers: { cookie: accountant },
      payload: {
        catalogItemId: "catitem-pos-barcode-scanner",
        sourceLocationId: "stockloc-main-warehouse",
        moveType: "delivery",
        quantity: 1,
        serviceFieldVisitId: visit.json().visit.id,
        reason: "Linked field-service material consumption.",
        reference: "VISIT-MAT-001"
      }
    });
    assert.equal(linkedDelivery.statusCode, 200, linkedDelivery.body);
    assert.equal(linkedDelivery.json().move.serviceFieldVisitId, visit.json().visit.id);
    assert.equal(linkedDelivery.json().move.totalCost, 62000);
    assert.equal(linkedDelivery.json().move.valuationPosting.sourceType, "stock_move_valuation");

    const reloadedVisit = await app.inject({
      method: "GET",
      url: "/api/service/field-visits",
      headers: { cookie: owner }
    });
    assert.equal(reloadedVisit.statusCode, 200, reloadedVisit.body);
    const withMaterial = reloadedVisit.json().visits.find(row => row.id === visit.json().visit.id);
    assert.ok(withMaterial);
    assert.equal(withMaterial.costAllocation.materialCost, 62000);
    assert.equal(withMaterial.costAllocation.totalCost, 62000);
    assert.ok(!withMaterial.costAllocation.limitations.includes("inventory-consumption-not-linked"));
    assert.ok(withMaterial.costAllocation.limitations.includes("not-posted-to-ledger"));
    assert.deepEqual(withMaterial.costAllocation.materialEvidence, [{
      serviceFieldVisitId: visit.json().visit.id,
      stockMoveId: linkedDelivery.json().move.id,
      catalogItemId: "catitem-pos-barcode-scanner",
      catalogSku: "HW-BARCODE-SCANNER",
      catalogName: "POS barcode scanner",
      moveType: "delivery",
      quantity: 1,
      unitCost: 62000,
      totalCost: 62000,
      reference: "VISIT-MAT-001",
      reason: "Linked field-service material consumption.",
      source: "stock_moves.service_field_visit_id",
      createdAt: linkedDelivery.json().move.createdAt,
      valuationPosting: linkedDelivery.json().move.valuationPosting
    }]);
    assert.equal(app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM ledger_journal
      WHERE org_id = ? AND source_type = 'stock_move_valuation' AND source_id = ?
    `).get(orgId, linkedDelivery.json().move.id).count, 1);
    assert.equal(app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM ledger_journal
      WHERE org_id = ? AND source_type LIKE 'service%'
    `).get(orgId).count, 0);
  } finally {
    await app.close();
  }
});

test("inventory: closed valuation period rejects outbound move and rolls back quantity", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const accountant = await login(app, "accountant@armosphera.local");
    const orgId = "org-armosphera-demo";
    const currentPeriodKey = new Date().toISOString().slice(0, 7);
    setFinancePeriodStatus(app, orgId, currentPeriodKey, "closed");
    const counts = () => ({
      moves: app.db.prepare("SELECT COUNT(*) AS count FROM stock_moves WHERE org_id = ?").get(orgId).count,
      valuationRows: app.db.prepare(`
        SELECT COUNT(*) AS count
        FROM ledger_journal
        WHERE org_id = ? AND source_type = 'stock_move_valuation'
      `).get(orgId).count,
      mainStock: readStock(app, orgId, "catitem-pos-barcode-scanner", "stockloc-main-warehouse").quantity
    });
    const before = counts();

    const response = await app.inject({
      method: "POST",
      url: "/api/inventory/moves",
      headers: { cookie: accountant },
      payload: {
        catalogItemId: "catitem-pos-barcode-scanner",
        sourceLocationId: "stockloc-main-warehouse",
        destinationLocationId: "stockloc-customer",
        moveType: "delivery",
        quantity: 1,
        reason: "Closed period valuation rollback check.",
        reference: "DELIVERY-CLOSED-PERIOD"
      }
    });
    assert.equal(response.statusCode, 409, response.body);
    assert.match(response.body, /closed|PERIOD_LOCKED/);
    assert.deepEqual(counts(), before);
  } finally {
    await app.close();
  }
});

test("inventory: non-demo tenants receive locations but not fake opening stock", () => {
  const db = openDatabase(":memory:");
  try {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO organizations (id, name, legal_name, tax_id, locale, currency, market, data_region, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("org-client-tenant", "Client Tenant", "Client Tenant LLC", "12345678", "hy-AM", "AMD", "Armenia", "Armenia hosted", now);

    __test.seedInventoryCore(db, "org-client-tenant");
    assert.ok(db.prepare("SELECT COUNT(*) AS count FROM stock_locations WHERE org_id = ?").get("org-client-tenant").count >= 6);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stock_moves WHERE org_id = ?").get("org-client-tenant").count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stock_quants WHERE org_id = ?").get("org-client-tenant").count, 0);
  } finally {
    db.close();
  }
});

test("inventory: stock move guards reject unsafe metadata before mutation", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const sales = await login(app, "sales@armosphera.local");
    const orgId = "org-armosphera-demo";
    const counts = () => ({
      moves: app.db.prepare("SELECT COUNT(*) AS count FROM stock_moves WHERE org_id = ?").get(orgId).count,
      audits: app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type = ?").get(orgId, "inventory.stock_move.posted").count,
      events: app.db.prepare("SELECT COUNT(*) AS count FROM suite_events WHERE org_id = ? AND event_type = ?").get(orgId, "inventory.stock_move.posted").count,
      mainStock: readStock(app, orgId, "catitem-pos-barcode-scanner", "stockloc-main-warehouse").quantity
    });
    const validBase = {
      catalogItemId: "catitem-pos-barcode-scanner",
      sourceLocationId: "stockloc-main-warehouse",
      destinationLocationId: "stockloc-customer",
      moveType: "delivery",
      quantity: 1,
      reason: "Guarded delivery check"
    };
    const expectRejected = async (payload, statusCode = 400) => {
      const before = counts();
      const response = await app.inject({ method: "POST", url: "/api/inventory/moves", headers: { cookie: owner }, payload });
      assert.equal(response.statusCode, statusCode, response.body);
      assert.doesNotMatch(response.body, /secret-inventory-/);
      assert.deepEqual(counts(), before);
    };

    const salesDenied = await app.inject({ method: "POST", url: "/api/inventory/moves", headers: { cookie: sales }, payload: validBase });
    assert.equal(salesDenied.statusCode, 403, salesDenied.body);

    await expectRejected(["secret-inventory-array-body-token"]);
    await expectRejected({ ...validBase, catalogItemId: "catitem-pos-barcode-scanner\nsecret-inventory-item-token" });
    await expectRejected({ ...validBase, catalogItemId: "catitem-pos-barcode-scanner/bad-secret-inventory-item-token" });
    await expectRejected({ ...validBase, moveType: "teleport-secret-inventory-type-token" });
    await expectRejected({ ...validBase, quantity: { amount: 1, token: "secret-inventory-quantity-token" } });
    await expectRejected({ ...validBase, quantity: "1\n" });
    await expectRejected({ ...validBase, reason: "Bad\nsecret-inventory-reason-token" });
    await expectRejected({ ...validBase, destinationLocationId: "stockloc-dispatch-staging" });
    await expectRejected({ ...validBase, sourceLocationId: "stockloc-missing" }, 404);
    await expectRejected({ ...validBase, catalogItemId: "catitem-salon-inbox-package" }, 422);
    await expectRejected({ ...validBase, quantity: 1000 }, 409);
  } finally {
    await app.close();
  }
});
