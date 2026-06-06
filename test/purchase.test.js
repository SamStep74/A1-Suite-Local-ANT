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

function rowCount(app, table, orgId) {
  return app.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE org_id = ?`).get(orgId).count;
}

function stockQuantity(app, orgId, catalogItemId, locationId) {
  const row = app.db.prepare(`
    SELECT quantity, average_cost AS averageCost
    FROM stock_quants
    WHERE org_id = ? AND catalog_item_id = ? AND location_id = ?
  `).get(orgId, catalogItemId, locationId);
  return row || { quantity: 0, averageCost: 0 };
}

test("purchase: RFQ -> confirmed PO -> stock receipt -> vendor bill", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app, "operator@armosphera.local");
    const accountantCookie = await login(app, "accountant@armosphera.local");
    const ownerCookie = await login(app);
    const orgId = "org-armosphera-demo";
    const openPeriod = app.db.prepare("SELECT period_key FROM finance_periods WHERE org_id = ? AND status = 'open' LIMIT 1").get(orgId).period_key;
    const before = {
      purchaseOrders: rowCount(app, "purchase_orders", orgId),
      purchaseLines: rowCount(app, "purchase_order_lines", orgId),
      stockMoves: rowCount(app, "stock_moves", orgId),
      bills: rowCount(app, "bills", orgId),
      billAudits: app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type = ?").get(orgId, "finance.bill.created").count,
      purchaseEvents: app.db.prepare("SELECT COUNT(*) AS count FROM suite_events WHERE org_id = ? AND event_type LIKE ?").get(orgId, "purchase.order.%").count,
      purchaseAudits: app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type LIKE ?").get(orgId, "purchase.order.%").count,
      mainStock: stockQuantity(app, orgId, "catitem-pos-barcode-scanner", "stockloc-main-warehouse")
    };

    const created = await app.inject({
      method: "POST",
      url: "/api/purchase/orders",
      headers: { cookie },
      payload: {
        orderNumber: "PO-ARM-0001",
        supplier: "Yerevan Hardware Supply",
        supplierTaxId: "01234568",
        orderDate: `${openPeriod}-07`,
        expectedDate: `${openPeriod}-09`,
        note: "Barcode scanners for Armenian retail pilots.",
        lines: [
          {
            catalogItemId: "catitem-pos-barcode-scanner",
            quantity: 2,
            unitCost: 60000,
            description: "POS barcode scanner replenishment"
          }
        ]
      }
    });
    assert.equal(created.statusCode, 200, created.body);
    const order = created.json().order;
    assert.match(order.id, /^po-/);
    assert.equal(order.orderNumber, "PO-ARM-0001");
    assert.equal(order.status, "rfq");
    assert.equal(order.supplier, "Yerevan Hardware Supply");
    assert.equal(order.supplierTaxId, "01234568");
    assert.equal(order.subtotal, 120000);
    assert.equal(order.vat, 24000);
    assert.equal(order.total, 144000);
    assert.equal(order.lines.length, 1);
    assert.equal(order.lines[0].catalogSku, "HW-BARCODE-SCANNER");
    assert.equal(order.lines[0].receivedQuantity, 0);
    assert.equal(rowCount(app, "purchase_orders", orgId), before.purchaseOrders + 1);
    assert.equal(rowCount(app, "purchase_order_lines", orgId), before.purchaseLines + 1);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/purchase/orders",
      headers: { cookie },
      payload: {
        orderNumber: "PO-ARM-0001",
        supplier: "Yerevan Hardware Supply",
        lines: [{ catalogItemId: "catitem-pos-barcode-scanner", quantity: 1, unitCost: 60000 }]
      }
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    assert.equal(rowCount(app, "purchase_orders", orgId), before.purchaseOrders + 1);
    assert.equal(rowCount(app, "purchase_order_lines", orgId), before.purchaseLines + 1);

    const listed = await app.inject({ method: "GET", url: "/api/purchase/orders", headers: { cookie } });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.ok(listed.json().orders.some(item => item.id === order.id && item.lines.length === 1));

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${order.id}/confirm`,
      headers: { cookie },
      payload: {}
    });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(confirmed.json().order.status, "confirmed");

    const received = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${order.id}/receive`,
      headers: { cookie },
      payload: {
        receivedAt: `${openPeriod}-09`,
        reference: "RCPT-PO-ARM-0001"
      }
    });
    assert.equal(received.statusCode, 200, received.body);
    const receivedBody = received.json();
    assert.equal(receivedBody.order.status, "received");
    assert.equal(receivedBody.order.receiptReference, "RCPT-PO-ARM-0001");
    assert.equal(receivedBody.order.billId, "");
    assert.equal(receivedBody.stockMoves.length, 1);
    assert.equal(receivedBody.stockMoves[0].moveType, "receipt");
    assert.equal(receivedBody.stockMoves[0].sourceLocationCode, "SUPPLIERS");
    assert.equal(receivedBody.stockMoves[0].destinationLocationCode, "WH/STOCK");
    assert.equal(receivedBody.stockMoves[0].quantity, 2);
    assert.equal(receivedBody.stockMoves[0].unitCost, 60000);
    assert.equal(receivedBody.order.lines[0].receivedQuantity, 2);
    assert.equal(receivedBody.order.lines[0].stockMoveId, receivedBody.stockMoves[0].id);
    assert.equal(rowCount(app, "stock_moves", orgId), before.stockMoves + 1);
    assert.equal(rowCount(app, "bills", orgId), before.bills);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type = ?").get(orgId, "finance.bill.created").count, before.billAudits);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM suite_events WHERE org_id = ? AND event_type LIKE ?").get(orgId, "purchase.order.%").count, before.purchaseEvents + 3);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type LIKE ?").get(orgId, "purchase.order.%").count, before.purchaseAudits + 3);
    assert.equal(stockQuantity(app, orgId, "catitem-pos-barcode-scanner", "stockloc-main-warehouse").quantity, before.mainStock.quantity + 2);

    const billed = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${order.id}/bill`,
      headers: { cookie: accountantCookie },
      payload: {
        billDate: `${openPeriod}-09`,
        dueDate: `${openPeriod}-24`,
        description: "Supplier invoice for PO-ARM-0001"
      }
    });
    assert.equal(billed.statusCode, 200, billed.body);
    const billedBody = billed.json();
    assert.equal(billedBody.order.status, "billed");
    assert.equal(billedBody.order.billId, billedBody.bill.id);
    assert.equal(billedBody.bill.supplier, "Yerevan Hardware Supply");
    assert.equal(billedBody.bill.subtotal, 120000);
    assert.equal(billedBody.bill.vat, 24000);
    assert.equal(billedBody.bill.total, 144000);
    assert.equal(rowCount(app, "bills", orgId), before.bills + 1);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type = ?").get(orgId, "finance.bill.created").count, before.billAudits + 1);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM suite_events WHERE org_id = ? AND event_type LIKE ?").get(orgId, "purchase.order.%").count, before.purchaseEvents + 4);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type LIKE ?").get(orgId, "purchase.order.%").count, before.purchaseAudits + 4);

    const payables = await app.inject({ method: "GET", url: `/api/finance/payables?asOf=${openPeriod}-30`, headers: { cookie } });
    assert.equal(payables.statusCode, 200, payables.body);
    assert.ok(payables.json().bills.some(bill => bill.id === billedBody.bill.id && bill.outstanding === 144000));

    const repeatedReceive = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${order.id}/receive`,
      headers: { cookie },
      payload: { receivedAt: `${openPeriod}-09`, reference: "RCPT-PO-ARM-0001" }
    });
    assert.equal(repeatedReceive.statusCode, 200, repeatedReceive.body);
    assert.equal(repeatedReceive.json().idempotent, true);
    assert.equal(rowCount(app, "stock_moves", orgId), before.stockMoves + 1);
    assert.equal(rowCount(app, "bills", orgId), before.bills + 1);
    const repeatedBill = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${order.id}/bill`,
      headers: { cookie: accountantCookie },
      payload: { billDate: `${openPeriod}-09`, dueDate: `${openPeriod}-24` }
    });
    assert.equal(repeatedBill.statusCode, 200, repeatedBill.body);
    assert.equal(repeatedBill.json().idempotent, true);
    assert.equal(rowCount(app, "bills", orgId), before.bills + 1);
    const repeatedConfirm = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${order.id}/confirm`,
      headers: { cookie },
      payload: {}
    });
    assert.equal(repeatedConfirm.statusCode, 200, repeatedConfirm.body);
    assert.equal(repeatedConfirm.json().idempotent, true);
    assert.equal(rowCount(app, "stock_moves", orgId), before.stockMoves + 1);
    assert.equal(rowCount(app, "bills", orgId), before.bills + 1);

    const backup = await app.inject({
      method: "POST",
      url: "/api/admin/backups",
      headers: { cookie: ownerCookie },
      payload: { note: "Purchase orders must restore with stock and AP evidence." }
    });
    assert.equal(backup.statusCode, 200, backup.body);
    const backupTables = backup.json().backup.payload.tables;
    assert.ok(backupTables.purchase_orders.some(item => item.id === order.id && item.bill_id === billedBody.bill.id));
    assert.ok(backupTables.purchase_order_lines.some(item => item.purchase_order_id === order.id && item.stock_move_id === receivedBody.stockMoves[0].id));
    assert.ok(backupTables.purchase_vendors.some(item => item.id === "vendor-yerevan-hardware-supply"));
    assert.ok(backupTables.purchase_vendor_prices.some(item => item.vendor_id === "vendor-yerevan-hardware-supply"));
    assert.ok(backupTables.bills.some(item => item.id === billedBody.bill.id && item.total === 144000));
    assert.ok(Array.isArray(backupTables.bill_payments));
  } finally {
    await app.close();
  }
});

test("purchase: vendor master and pricelists drive RFQ supplier costs", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operatorCookie = await login(app, "operator@armosphera.local");
    const ownerCookie = await login(app);
    const orgId = "org-armosphera-demo";
    const openPeriod = app.db.prepare("SELECT period_key FROM finance_periods WHERE org_id = ? AND status = 'open' LIMIT 1").get(orgId).period_key;

    const vendors = await app.inject({ method: "GET", url: "/api/purchase/vendors", headers: { cookie: operatorCookie } });
    assert.equal(vendors.statusCode, 200, vendors.body);
    const seededVendor = vendors.json().vendors.find(vendor => vendor.id === "vendor-yerevan-hardware-supply");
    assert.ok(seededVendor, "seeded hardware vendor is visible");
    assert.equal(seededVendor.taxId, "01234568");
    assert.ok(seededVendor.prices.some(price => price.catalogItemId === "catitem-pos-barcode-scanner" && price.unitCost === 60000));

    const createdVendor = await app.inject({
      method: "POST",
      url: "/api/purchase/vendors",
      headers: { cookie: operatorCookie },
      payload: {
        name: "Gyumri Device Supply",
        taxId: "12345678",
        paymentTermsDays: 10,
        leadTimeDays: 3,
        note: "Regional backup vendor for POS hardware.",
        prices: [{
          catalogItemId: "catitem-pos-barcode-scanner",
          unitCost: 61000,
          minQuantity: 1,
          leadTimeDays: 3,
          validFrom: `${openPeriod}-01`,
          note: "One-unit scanner replacement cost."
        }]
      }
    });
    assert.equal(createdVendor.statusCode, 200, createdVendor.body);
    const vendor = createdVendor.json().vendor;
    assert.match(vendor.id, /^vendor-/);
    assert.equal(vendor.name, "Gyumri Device Supply");
    assert.equal(vendor.taxId, "12345678");
    assert.equal(vendor.prices.length, 1);
    assert.equal(vendor.prices[0].unitCost, 61000);

    const createdOrder = await app.inject({
      method: "POST",
      url: "/api/purchase/orders",
      headers: { cookie: operatorCookie },
      payload: {
        vendorId: vendor.id,
        orderNumber: "PO-VENDOR-PRICE-1",
        orderDate: `${openPeriod}-08`,
        expectedDate: `${openPeriod}-11`,
        lines: [{ catalogItemId: "catitem-pos-barcode-scanner", quantity: 1 }]
      }
    });
    assert.equal(createdOrder.statusCode, 200, createdOrder.body);
    const order = createdOrder.json().order;
    assert.equal(order.vendorId, vendor.id);
    assert.equal(order.vendorName, "Gyumri Device Supply");
    assert.equal(order.supplier, "Gyumri Device Supply");
    assert.equal(order.supplierTaxId, "12345678");
    assert.equal(order.lines[0].unitCost, 61000);
    assert.equal(order.subtotal, 61000);
    assert.equal(order.vat, 12200);
    assert.equal(order.total, 73200);

    const supportCookie = await login(app, "support@armosphera.local");
    const supportDenied = await app.inject({ method: "GET", url: "/api/purchase/vendors", headers: { cookie: supportCookie } });
    assert.equal(supportDenied.statusCode, 403, supportDenied.body);

    const backup = await app.inject({
      method: "POST",
      url: "/api/admin/backups",
      headers: { cookie: ownerCookie },
      payload: { note: "Purchase vendor master and pricelist must restore with RFQ evidence." }
    });
    assert.equal(backup.statusCode, 200, backup.body);
    const backupTables = backup.json().backup.payload.tables;
    assert.ok(backupTables.purchase_vendors.some(item => item.id === vendor.id && item.tax_id === "12345678"));
    assert.ok(backupTables.purchase_vendor_prices.some(item => item.vendor_id === vendor.id && item.unit_cost === 61000));
    assert.ok(backupTables.purchase_orders.some(item => item.id === order.id && item.vendor_id === vendor.id));
  } finally {
    await app.close();
  }
});

test("purchase: vendor master prices seed, create, and back RFQ default costing", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");
    const auditor = await login(app, "auditor@armosphera.local");
    const support = await login(app, "support@armosphera.local");
    const orgId = "org-armosphera-demo";
    const openPeriod = app.db.prepare("SELECT period_key FROM finance_periods WHERE org_id = ? AND status = 'open' LIMIT 1").get(orgId).period_key;
    const vendorCounts = () => ({
      vendors: rowCount(app, "purchase_vendors", orgId),
      prices: rowCount(app, "purchase_vendor_prices", orgId),
      orders: rowCount(app, "purchase_orders", orgId),
      lines: rowCount(app, "purchase_order_lines", orgId),
      events: app.db.prepare("SELECT COUNT(*) AS count FROM suite_events WHERE org_id = ? AND event_type = ?").get(orgId, "purchase.vendor.created").count,
      audits: app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type = ?").get(orgId, "purchase.vendor.created").count
    });

    const unauthenticated = await app.inject({ method: "GET", url: "/api/purchase/vendors" });
    assert.equal(unauthenticated.statusCode, 401);
    const auditorRead = await app.inject({ method: "GET", url: "/api/purchase/vendors", headers: { cookie: auditor } });
    assert.equal(auditorRead.statusCode, 200, auditorRead.body);
    const supportRead = await app.inject({ method: "GET", url: "/api/purchase/vendors", headers: { cookie: support } });
    assert.equal(supportRead.statusCode, 403, supportRead.body);
    const seededVendor = auditorRead.json().vendors.find(vendor => vendor.id === "vendor-yerevan-hardware-supply");
    assert.equal(seededVendor.name, "Yerevan Hardware Supply");
    assert.ok(seededVendor.prices.some(price => price.catalogItemId === "catitem-pos-barcode-scanner" && price.unitCost === 60000));

    const malformedBefore = vendorCounts();
    const invalidWindow = await app.inject({
      method: "POST",
      url: "/api/purchase/vendors",
      headers: { cookie: operator },
      payload: {
        name: "Invalid Window Supplier",
        prices: [{ catalogItemId: "catitem-pos-barcode-scanner", unitCost: 55000, validFrom: `${openPeriod}-20`, validTo: `${openPeriod}-01` }]
      }
    });
    assert.equal(invalidWindow.statusCode, 400, invalidWindow.body);
    assert.deepEqual(vendorCounts(), malformedBefore);

    const duplicatePrices = await app.inject({
      method: "POST",
      url: "/api/purchase/vendors",
      headers: { cookie: operator },
      payload: {
        name: "Duplicate Price Supplier",
        prices: [
          { catalogItemId: "catitem-pos-barcode-scanner", unitCost: 55000, minQuantity: 2, validFrom: `${openPeriod}-01` },
          { catalogItemId: "catitem-pos-barcode-scanner", unitCost: 54000, minQuantity: 2, validFrom: `${openPeriod}-01` }
        ]
      }
    });
    assert.equal(duplicatePrices.statusCode, 400, duplicatePrices.body);
    assert.doesNotMatch(duplicatePrices.body, /purchase_vendor_prices|UNIQUE constraint/i);
    assert.deepEqual(vendorCounts(), malformedBefore);

    const missingItem = await app.inject({
      method: "POST",
      url: "/api/purchase/vendors",
      headers: { cookie: operator },
      payload: {
        name: "Missing Item Supplier",
        prices: [{ catalogItemId: "catitem-missing-safe", unitCost: 55000, validFrom: `${openPeriod}-01` }]
      }
    });
    assert.equal(missingItem.statusCode, 404, missingItem.body);
    assert.deepEqual(vendorCounts(), malformedBefore);

    const created = await app.inject({
      method: "POST",
      url: "/api/purchase/vendors",
      headers: { cookie: operator },
      payload: {
        name: "Gyumri Office Supply",
        taxId: "87654321",
        email: "procurement@gyumri-office.example",
        phone: "+374 312 112233",
        paymentTermsDays: 10,
        leadTimeDays: 3,
        note: "Preferred regional vendor for POS equipment.",
        prices: [
          {
            catalogItemId: "catitem-pos-barcode-scanner",
            unitCost: 55000,
            minQuantity: 3,
            leadTimeDays: 1,
            validFrom: `${openPeriod}-01`,
            validTo: `${openPeriod}-28`,
            note: "Bulk scanner replenishment cost."
          }
        ]
      }
    });
    assert.equal(created.statusCode, 200, created.body);
    const vendor = created.json().vendor;
    assert.match(vendor.id, /^vendor-/);
    assert.equal(vendor.name, "Gyumri Office Supply");
    assert.equal(vendor.taxId, "87654321");
    assert.equal(vendor.paymentTermsDays, 10);
    assert.equal(vendor.leadTimeDays, 3);
    assert.equal(vendor.prices.length, 1);
    assert.equal(vendor.prices[0].unitCost, 55000);
    assert.equal(vendor.prices[0].minQuantity, 3);
    assert.equal(vendorCounts().vendors, malformedBefore.vendors + 1);
    assert.equal(vendorCounts().prices, malformedBefore.prices + 1);
    assert.equal(vendorCounts().events, malformedBefore.events + 1);
    assert.equal(vendorCounts().audits, malformedBefore.audits + 1);

    const duplicateBefore = vendorCounts();
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/purchase/vendors",
      headers: { cookie: operator },
      payload: { name: "Gyumri Office Supply" }
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    assert.deepEqual(vendorCounts(), duplicateBefore);

    const order = await app.inject({
      method: "POST",
      url: "/api/purchase/orders",
      headers: { cookie: operator },
      payload: {
        vendorId: vendor.id,
        orderNumber: "PO-VENDOR-PRICE",
        orderDate: `${openPeriod}-07`,
        expectedDate: `${openPeriod}-10`,
        lines: [{ catalogItemId: "catitem-pos-barcode-scanner", quantity: 4 }]
      }
    });
    assert.equal(order.statusCode, 200, order.body);
    const purchaseOrder = order.json().order;
    assert.equal(purchaseOrder.vendorId, vendor.id);
    assert.equal(purchaseOrder.vendorName, "Gyumri Office Supply");
    assert.equal(purchaseOrder.supplier, "Gyumri Office Supply");
    assert.equal(purchaseOrder.supplierTaxId, "87654321");
    assert.equal(purchaseOrder.subtotal, 220000);
    assert.equal(purchaseOrder.vat, 44000);
    assert.equal(purchaseOrder.total, 264000);
    assert.equal(purchaseOrder.lines[0].unitCost, 55000);
    assert.equal(purchaseOrder.lines[0].vendorPriceId, vendor.prices[0].id);
    const storedOrder = app.db.prepare("SELECT vendor_id FROM purchase_orders WHERE org_id = ? AND id = ?").get(orgId, purchaseOrder.id);
    assert.equal(storedOrder.vendor_id, vendor.id);
    const storedLine = app.db.prepare("SELECT vendor_price_id FROM purchase_order_lines WHERE org_id = ? AND purchase_order_id = ?").get(orgId, purchaseOrder.id);
    assert.equal(storedLine.vendor_price_id, vendor.prices[0].id);

    const explicitOverride = await app.inject({
      method: "POST",
      url: "/api/purchase/orders",
      headers: { cookie: operator },
      payload: {
        vendorId: vendor.id,
        orderNumber: "PO-VENDOR-EXPLICIT",
        orderDate: `${openPeriod}-07`,
        expectedDate: `${openPeriod}-10`,
        lines: [{ catalogItemId: "catitem-pos-barcode-scanner", quantity: 4, unitCost: 50000 }]
      }
    });
    assert.equal(explicitOverride.statusCode, 200, explicitOverride.body);
    const explicitOrder = explicitOverride.json().order;
    assert.equal(explicitOrder.lines[0].unitCost, 50000);
    assert.equal(explicitOrder.lines[0].vendorPriceId, "");
    const explicitLine = app.db.prepare("SELECT vendor_price_id FROM purchase_order_lines WHERE org_id = ? AND purchase_order_id = ?").get(orgId, explicitOrder.id);
    assert.equal(explicitLine.vendor_price_id, null);
  } finally {
    await app.close();
  }
});

test("purchase: role gates and metadata guards reject writes before mutation", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const auditor = await login(app, "auditor@armosphera.local");
    const operator = await login(app, "operator@armosphera.local");
    const support = await login(app, "support@armosphera.local");
    const orgId = "org-armosphera-demo";
    const openPeriod = app.db.prepare("SELECT period_key FROM finance_periods WHERE org_id = ? AND status = 'open' LIMIT 1").get(orgId).period_key;
    const counts = () => ({
      purchaseOrders: rowCount(app, "purchase_orders", orgId),
      purchaseLines: rowCount(app, "purchase_order_lines", orgId),
      stockMoves: rowCount(app, "stock_moves", orgId),
      bills: rowCount(app, "bills", orgId),
      billAudits: app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type = ?").get(orgId, "finance.bill.created").count,
      billLedgerRows: app.db.prepare("SELECT COUNT(*) AS count FROM ledger_journal WHERE org_id = ? AND source_type = ?").get(orgId, "bill").count,
      inventoryEvents: app.db.prepare("SELECT COUNT(*) AS count FROM suite_events WHERE org_id = ? AND event_type = ?").get(orgId, "inventory.stock_move.posted").count,
      inventoryAudits: app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type = ?").get(orgId, "inventory.stock_move.posted").count,
      scannerStock: stockQuantity(app, orgId, "catitem-pos-barcode-scanner", "stockloc-main-warehouse").quantity,
      events: app.db.prepare("SELECT COUNT(*) AS count FROM suite_events WHERE org_id = ? AND event_type LIKE ?").get(orgId, "purchase.order.%").count,
      audits: app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type LIKE ?").get(orgId, "purchase.order.%").count
    });
    const basePayload = {
      supplier: "Yerevan Hardware Supply",
      supplierTaxId: "01234568",
      orderDate: `${openPeriod}-07`,
      expectedDate: `${openPeriod}-09`,
      lines: [{ catalogItemId: "catitem-pos-barcode-scanner", quantity: 1, unitCost: 60000 }]
    };

    const unauthenticated = await app.inject({ method: "GET", url: "/api/purchase/orders" });
    assert.equal(unauthenticated.statusCode, 401);
    const auditorRead = await app.inject({ method: "GET", url: "/api/purchase/orders", headers: { cookie: auditor } });
    assert.equal(auditorRead.statusCode, 200, auditorRead.body);
    const supportRead = await app.inject({ method: "GET", url: "/api/purchase/orders", headers: { cookie: support } });
    assert.equal(supportRead.statusCode, 403, supportRead.body);

    const beforeDenied = counts();
    const auditorDenied = await app.inject({ method: "POST", url: "/api/purchase/orders", headers: { cookie: auditor }, payload: basePayload });
    assert.equal(auditorDenied.statusCode, 403, auditorDenied.body);
    assert.deepEqual(counts(), beforeDenied);

    const malformedBodies = [
      null,
      ["secret-purchase-array-body-token"],
      { ...basePayload, supplier: { text: "Yerevan Hardware Supply", token: "secret-purchase-object-supplier-token" } },
      { ...basePayload, supplier: "Yerevan\nsecret-purchase-control-supplier-token" },
      { ...basePayload, supplierTaxId: "0123456A" },
      { ...basePayload, orderDate: "2026-02-30" },
      { ...basePayload, lines: [] },
      { ...basePayload, lines: [{ catalogItemId: "catitem-pos-barcode-scanner", quantity: 0, unitCost: 60000 }] },
      { ...basePayload, lines: [{ catalogItemId: "catitem-pos-barcode-scanner", quantity: 1000000, unitCost: 1000000000000 }] },
      { ...basePayload, lines: [
        { catalogItemId: "catitem-pos-barcode-scanner", quantity: 7000, unitCost: 1000000000000 },
        { catalogItemId: "catitem-pos-barcode-scanner", quantity: 7000, unitCost: 1000000000000 }
      ] },
      { ...basePayload, lines: [{ catalogItemId: "catitem-pos-barcode-scanner", quantity: 1, unitCost: ["60000"] }] },
      { ...basePayload, lines: [{ catalogItemId: "catitem-pos-barcode-scanner\nsecret-purchase-control-item-token", quantity: 1, unitCost: 60000 }] }
    ];
    for (const payload of malformedBodies) {
      const before = counts();
      const response = await app.inject({ method: "POST", url: "/api/purchase/orders", headers: { cookie: owner }, payload });
      assert.equal(response.statusCode, 400, response.body);
      assert.doesNotMatch(response.body, /secret-purchase-/);
      assert.deepEqual(counts(), before);
    }

    const unknownItem = await app.inject({
      method: "POST",
      url: "/api/purchase/orders",
      headers: { cookie: owner },
      payload: { ...basePayload, lines: [{ catalogItemId: "catitem-missing-safe", quantity: 1, unitCost: 60000 }] }
    });
    assert.equal(unknownItem.statusCode, 404, unknownItem.body);
    assert.deepEqual(counts(), beforeDenied);

    const created = await app.inject({ method: "POST", url: "/api/purchase/orders", headers: { cookie: owner }, payload: basePayload });
    assert.equal(created.statusCode, 200, created.body);
    const orderId = created.json().order.id;
    const receiveBeforeConfirm = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${orderId}/receive`,
      headers: { cookie: owner },
      payload: { receivedAt: `${openPeriod}-09`, dueDate: `${openPeriod}-24` }
    });
    assert.equal(receiveBeforeConfirm.statusCode, 409, receiveBeforeConfirm.body);

    const malformedPath = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${orderId}%0Asecret-purchase-path-token/confirm`,
      headers: { cookie: owner },
      payload: {}
    });
    assert.equal(malformedPath.statusCode, 400, malformedPath.body);
    assert.doesNotMatch(malformedPath.body, /secret-purchase-/);

    app.db.exec(`
      CREATE TEMP TRIGGER purchase_test_fail_confirm_event
      BEFORE INSERT ON suite_events
      WHEN NEW.event_type = 'purchase.order.confirmed'
      BEGIN
        SELECT RAISE(ABORT, 'purchase confirm trigger fail');
      END;
    `);
    const beforeFailedConfirm = counts();
    const failedConfirm = await app.inject({ method: "POST", url: `/api/purchase/orders/${orderId}/confirm`, headers: { cookie: owner }, payload: {} });
    assert.equal(failedConfirm.statusCode, 500, failedConfirm.body);
    assert.deepEqual(counts(), beforeFailedConfirm);
    assert.equal(app.db.prepare("SELECT status FROM purchase_orders WHERE org_id = ? AND id = ?").get(orgId, orderId).status, "rfq");
    app.db.exec("DROP TRIGGER purchase_test_fail_confirm_event");

    const confirmed = await app.inject({ method: "POST", url: `/api/purchase/orders/${orderId}/confirm`, headers: { cookie: owner }, payload: {} });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    app.db.exec(`
      CREATE TEMP TRIGGER purchase_test_fail_receipt_line
      BEFORE UPDATE OF received_quantity ON purchase_order_lines
      WHEN NEW.purchase_order_id = '${orderId}'
      BEGIN
        SELECT RAISE(ABORT, 'purchase receipt trigger fail');
      END;
    `);
    const beforeFailedReceive = counts();
    const failedReceive = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${orderId}/receive`,
      headers: { cookie: owner },
      payload: { receivedAt: `${openPeriod}-09`, reference: "RCPT-GUARD" }
    });
    assert.equal(failedReceive.statusCode, 500, failedReceive.body);
    assert.deepEqual(counts(), beforeFailedReceive);
    app.db.exec("DROP TRIGGER purchase_test_fail_receipt_line");
    const received = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${orderId}/receive`,
      headers: { cookie: owner },
      payload: { receivedAt: `${openPeriod}-09`, reference: "RCPT-GUARD" }
    });
    assert.equal(received.statusCode, 200, received.body);
    const operatorBillDenied = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${orderId}/bill`,
      headers: { cookie: operator },
      payload: { billDate: `${openPeriod}-09`, dueDate: `${openPeriod}-24` }
    });
    assert.equal(operatorBillDenied.statusCode, 403, operatorBillDenied.body);
    app.db.exec(`
      CREATE TEMP TRIGGER purchase_test_fail_bill_link
      BEFORE UPDATE OF bill_id ON purchase_orders
      WHEN NEW.id = '${orderId}'
      BEGIN
        SELECT RAISE(ABORT, 'purchase bill trigger fail');
      END;
    `);
    const beforeFailedBill = counts();
    const failedBill = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${orderId}/bill`,
      headers: { cookie: owner },
      payload: { billDate: `${openPeriod}-09`, dueDate: `${openPeriod}-24` }
    });
    assert.equal(failedBill.statusCode, 500, failedBill.body);
    assert.deepEqual(counts(), beforeFailedBill);
    app.db.exec("DROP TRIGGER purchase_test_fail_bill_link");
    app.db.prepare("UPDATE finance_periods SET status = 'closed' WHERE org_id = ? AND period_key = ?").run(orgId, openPeriod);
    const beforeClosedReceive = counts();
    const closedBill = await app.inject({
      method: "POST",
      url: `/api/purchase/orders/${orderId}/bill`,
      headers: { cookie: owner },
      payload: { billDate: `${openPeriod}-09`, dueDate: `${openPeriod}-24` }
    });
    assert.equal(closedBill.statusCode, 409, closedBill.body);
    assert.match(closedBill.body, /PERIOD_LOCKED/);
    assert.deepEqual(counts(), beforeClosedReceive);
  } finally {
    await app.close();
  }
});
