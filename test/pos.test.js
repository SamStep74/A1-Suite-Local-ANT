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

test("pos: workspace is auth-gated, app-gated, and launcher-assigned", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();

    const unauthenticated = await app.inject({ method: "GET", url: "/api/pos/workspace" });
    assert.equal(unauthenticated.statusCode, 401);

    const owner = await login(app);
    const apps = await app.inject({ method: "GET", url: "/api/apps", headers: { cookie: owner } });
    assert.equal(apps.statusCode, 200, apps.body);
    assert.ok(apps.json().apps.some(item => item.id === "pos" && item.route === "/app/pos"));
    const posApp = apps.json().allApps.find(item => item.id === "pos");
    assert.ok(posApp);
    assert.ok(posApp.assignments.some(item => item.role === "Operator" && item.enabled === 1));
    assert.ok(posApp.assignments.some(item => item.role === "Accountant" && item.enabled === 1));
    assert.ok(posApp.assignments.some(item => item.role === "Salesperson" && item.enabled === 1));

    const workspace = await app.inject({ method: "GET", url: "/api/pos/workspace", headers: { cookie: owner } });
    assert.equal(workspace.statusCode, 200, workspace.body);
    assert.equal(workspace.json().capabilityStatus.salePosting, "available");
    assert.equal(workspace.json().capabilityStatus.receiptPrinting, "not-implemented");

    const support = await login(app, "support@armosphera.local");
    const supportDenied = await app.inject({ method: "GET", url: "/api/pos/workspace", headers: { cookie: support } });
    assert.equal(supportDenied.statusCode, 403);

    const badAssign = await app.inject({
      method: "POST",
      url: "/api/apps/pos/assign",
      headers: { cookie: owner },
      payload: { role: "Support", enabled: true }
    });
    assert.equal(badAssign.statusCode, 400, badAssign.body);

    app.db.prepare("UPDATE app_assignments SET enabled = 0 WHERE org_id = ? AND role = ? AND app_id = ?")
      .run("org-armosphera-demo", "Salesperson", "pos");
    const salesperson = await login(app, "sales@armosphera.local");
    const disabledAssignment = await app.inject({ method: "GET", url: "/api/pos/workspace", headers: { cookie: salesperson } });
    assert.equal(disabledAssignment.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("pos: opening a cash session validates register, cash, currency, and stock location", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");
    const orgId = "org-armosphera-demo";
    const count = () => app.db.prepare("SELECT COUNT(*) AS count FROM pos_cash_sessions WHERE org_id = ?").get(orgId).count;
    const before = count();
    const expectRejected = async (payload, statusCode = 400) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/pos/cash-sessions",
        headers: { cookie: operator },
        payload
      });
      assert.equal(response.statusCode, statusCode, response.body);
    };

    await expectRejected({});
    await expectRejected({ stockLocationId: "stockloc-main-warehouse", registerCode: "bad register", openingCash: 1000 });
    await expectRejected({ stockLocationId: "stockloc-main-warehouse", registerCode: "POS-VAL", openingCash: "1000.25" });
    await expectRejected({ stockLocationId: "stockloc-main-warehouse", registerCode: "POS-VAL", openingCash: 1000, currency: "USD" });
    await expectRejected({ stockLocationId: "stockloc-customer", registerCode: "POS-VAL", openingCash: 1000 });
    await expectRejected({ stockLocationId: "stockloc-missing", registerCode: "POS-VAL", openingCash: 1000 }, 404);

    assert.equal(count(), before);
  } finally {
    await app.close();
  }
});

test("pos: open, list, and workspace return the bounded cash-session spine", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");

    const created = await app.inject({
      method: "POST",
      url: "/api/pos/cash-sessions",
      headers: { cookie: operator },
      payload: {
        stockLocationId: "stockloc-main-warehouse",
        registerCode: "pos-01",
        openingCash: 10000,
        fiscalDeviceId: "FISCAL-AM-01",
        openedAt: "2026-06-22T08:00:00.000Z"
      }
    });
    assert.equal(created.statusCode, 200, created.body);
    const session = created.json().session;
    assert.match(session.id, /^pos-session-/);
    assert.equal(session.cashierUserId, "user-operator");
    assert.equal(session.stockLocationId, "stockloc-main-warehouse");
    assert.equal(session.registerCode, "POS-01");
    assert.equal(session.status, "open");
    assert.equal(session.openingCash, 10000);
    assert.equal(session.expectedCash, 10000);
    assert.equal(session.expectedCashBasis, "opening-cash-plus-cash-sales");
    assert.equal(session.postings.salePosting, "not-posted");
    assert.equal(session.fiscalDeviceId, "FISCAL-AM-01");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/pos/cash-sessions",
      headers: { cookie: operator },
      payload: { stockLocationId: "stockloc-main-warehouse", registerCode: "POS-01", openingCash: 0 }
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);

    const listed = await app.inject({ method: "GET", url: "/api/pos/cash-sessions?status=open", headers: { cookie: operator } });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.ok(listed.json().sessions.some(item => item.id === session.id && item.status === "open"));

    const workspace = await app.inject({ method: "GET", url: "/api/pos/workspace", headers: { cookie: operator } });
    assert.equal(workspace.statusCode, 200, workspace.body);
    const body = workspace.json();
    assert.equal(body.openSession.id, session.id);
    assert.ok(body.activeFiscalCatalogItems.some(item => item.id === "catitem-pos-barcode-scanner" && item.fiscalReceiptRequired === true));
    assert.ok(body.activeStockLocations.some(location => location.id === "stockloc-main-warehouse"));
    assert.ok(body.activeStockLocations.every(location => location.status === "active" && location.locationType === "internal"));
    assert.equal(body.evidenceMetadata.expectedCashBasis, "opening-cash-plus-cash-sales");
    assert.equal(body.capabilityStatus.inventoryPosting, "available");
    assert.equal(body.capabilityStatus.ledgerPosting, "not-implemented");
  } finally {
    await app.close();
  }
});

test("pos: cash sale validates input, fiscal catalog, and stock availability", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");

    const created = await app.inject({
      method: "POST",
      url: "/api/pos/cash-sessions",
      headers: { cookie: operator },
      payload: {
        stockLocationId: "stockloc-main-warehouse",
        registerCode: "POS-VAL-SALE",
        openingCash: 10000,
        fiscalDeviceId: "FISCAL-AM-VAL"
      }
    });
    assert.equal(created.statusCode, 200, created.body);
    const saleUrl = `/api/pos/cash-sessions/${created.json().session.id}/sales`;
    const line = { catalogItemId: "catitem-pos-barcode-scanner", quantity: 1 };
    const expectRejected = async (payload, statusCode = 400) => {
      const response = await app.inject({
        method: "POST",
        url: saleUrl,
        headers: { cookie: operator },
        payload
      });
      assert.equal(response.statusCode, statusCode, response.body);
    };

    await expectRejected({ receiptNumber: "R-VAL-1", paymentMethod: "cash", lines: [line] });
    await expectRejected({ receiptNumber: "R-VAL-2", paymentMethod: "crypto", idempotencyKey: "pos-val-bad-method", lines: [line] });
    await expectRejected({ receiptNumber: "R-VAL-3", paymentMethod: "cash", idempotencyKey: "pos-val-bad-qty", lines: [{ ...line, quantity: 0 }] });
    await expectRejected({ receiptNumber: "R-VAL-4", paymentMethod: "cash", idempotencyKey: "pos-val-missing-item", lines: [{ catalogItemId: "catitem-missing", quantity: 1 }] }, 404);
    await expectRejected({ receiptNumber: "R-VAL-5", paymentMethod: "cash", idempotencyKey: "pos-val-stock", lines: [{ ...line, quantity: 999 }] }, 409);

    app.db.prepare("UPDATE catalog_items SET fiscal_receipt_required = 0 WHERE org_id = ? AND id = ?")
      .run("org-armosphera-demo", "catitem-pos-barcode-scanner");
    await expectRejected({ receiptNumber: "R-VAL-6", paymentMethod: "cash", idempotencyKey: "pos-val-non-fiscal", lines: [line] }, 422);
  } finally {
    await app.close();
  }
});

test("pos: cash sale posts sale rows, delivery stock move, expected cash, and backup evidence", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");
    const owner = await login(app);
    const orgId = "org-armosphera-demo";
    app.db.prepare("UPDATE finance_periods SET status = 'open' WHERE org_id = ? AND period_key = ?")
      .run(orgId, new Date().toISOString().slice(0, 7));
    const itemId = "catitem-pos-barcode-scanner";
    const stockLocationId = "stockloc-main-warehouse";
    const quant = () => app.db.prepare(`
      SELECT quantity
      FROM stock_quants
      WHERE org_id = ? AND catalog_item_id = ? AND location_id = ?
    `).get(orgId, itemId, stockLocationId).quantity;
    const beforeQuantity = quant();

    const created = await app.inject({
      method: "POST",
      url: "/api/pos/cash-sessions",
      headers: { cookie: operator },
      payload: {
        stockLocationId,
        registerCode: "POS-SALE",
        openingCash: 10000,
        fiscalDeviceId: "FISCAL-AM-SALE",
        openedAt: "2026-06-22T08:00:00.000Z"
      }
    });
    assert.equal(created.statusCode, 200, created.body);
    const sessionId = created.json().session.id;

    const response = await app.inject({
      method: "POST",
      url: `/api/pos/cash-sessions/${sessionId}/sales`,
      headers: { cookie: operator },
      payload: {
        receiptNumber: "r-422-001",
        paymentMethod: "cash",
        soldAt: "2026-06-22T09:15:00.000Z",
        idempotencyKey: "pos-sale-happy-1",
        lines: [{ catalogItemId: itemId, catalogItemVariantId: null, quantity: 2 }]
      }
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.equal(body.session.id, sessionId);
    assert.equal(body.session.expectedCash, 180000);
    assert.equal(body.session.postings.salePosting, "posted");
    assert.equal(body.session.postings.inventoryPosting, "posted");

    const sale = body.sale;
    assert.match(sale.id, /^pos-sale-/);
    assert.equal(sale.cashSessionId, sessionId);
    assert.equal(sale.receiptNumber, "R-422-001");
    assert.equal(sale.status, "posted");
    assert.equal(sale.paymentMethod, "cash");
    assert.equal(sale.currency, "AMD");
    assert.equal(sale.subtotal, 141667);
    assert.equal(sale.vat, 28333);
    assert.equal(sale.total, 170000);
    assert.equal(sale.paidCash, 170000);
    assert.equal(sale.lineCount, 1);
    assert.equal(sale.soldAt, "2026-06-22T09:15:00.000Z");
    assert.equal(sale.cashierUserId, "user-operator");
    assert.equal(sale.stockLocationId, stockLocationId);
    assert.deepEqual(sale.postings, { salePosting: "posted", inventoryPosting: "posted", ledgerPosting: "not-posted" });

    const saleLine = sale.lines[0];
    assert.equal(saleLine.catalogItemId, itemId);
    assert.equal(saleLine.catalogItemVariantId, null);
    assert.equal(saleLine.sku, "HW-BARCODE-SCANNER");
    assert.equal(saleLine.name, "POS barcode scanner");
    assert.equal(saleLine.quantity, 2);
    assert.equal(saleLine.unitPrice, 85000);
    assert.equal(saleLine.subtotal, 141667);
    assert.equal(saleLine.vat, 28333);
    assert.equal(saleLine.total, 170000);
    assert.equal(saleLine.vatMode, "standard");
    assert.equal(saleLine.fiscalReceiptRequired, true);
    assert.match(saleLine.stockMoveId, /^stockmove-/);
    assert.equal(quant(), beforeQuantity - 2);

    const stockMove = app.db.prepare("SELECT * FROM stock_moves WHERE org_id = ? AND id = ?").get(orgId, saleLine.stockMoveId);
    assert.equal(stockMove.move_type, "delivery");
    assert.equal(stockMove.source_location_id, stockLocationId);
    assert.equal(stockMove.destination_location_id, "stockloc-customer");
    assert.equal(stockMove.quantity, 2);
    assert.equal(stockMove.reference, "POS sale R-422-001");
    assert.equal(stockMove.status, "posted");

    const backup = await app.inject({
      method: "POST",
      url: "/api/admin/backups",
      headers: { cookie: owner },
      payload: { note: "POS cash sale evidence must be restorable." }
    });
    assert.equal(backup.statusCode, 200, backup.body);
    const tables = backup.json().backup.payload.tables;
    assert.ok(tables.pos_sales.some(row => (
      row.id === sale.id
      && row.cash_session_id === sessionId
      && row.receipt_number === "R-422-001"
      && row.source_key === "pos-sale-happy-1"
      && row.total_amd === 170000
    )));
    assert.ok(tables.pos_sale_lines.some(row => (
      row.sale_id === sale.id
      && row.catalog_item_id === itemId
      && row.stock_move_id === saleLine.stockMoveId
    )));
  } finally {
    await app.close();
  }
});

test("pos: cash sale replays duplicate source key and rejects duplicate receipt and closed sessions", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");
    const orgId = "org-armosphera-demo";
    app.db.prepare("UPDATE finance_periods SET status = 'open' WHERE org_id = ? AND period_key = ?")
      .run(orgId, new Date().toISOString().slice(0, 7));
    const itemId = "catitem-pos-barcode-scanner";

    const created = await app.inject({
      method: "POST",
      url: "/api/pos/cash-sessions",
      headers: { cookie: operator },
      payload: {
        stockLocationId: "stockloc-main-warehouse",
        registerCode: "POS-DUP",
        openingCash: 10000,
        fiscalDeviceId: "FISCAL-AM-DUP"
      }
    });
    assert.equal(created.statusCode, 200, created.body);
    const sessionId = created.json().session.id;
    const saleUrl = `/api/pos/cash-sessions/${sessionId}/sales`;
    const payload = {
      receiptNumber: "R-DUP-001",
      paymentMethod: "cash",
      idempotencyKey: "pos-sale-dup-1",
      lines: [{ catalogItemId: itemId, quantity: 1 }]
    };
    const first = await app.inject({ method: "POST", url: saleUrl, headers: { cookie: operator }, payload });
    assert.equal(first.statusCode, 200, first.body);
    const firstBody = first.json();
    const firstMoveCount = app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM stock_moves
      WHERE org_id = ? AND reference = ?
    `).get(orgId, "POS sale R-DUP-001").count;

    const duplicateSource = await app.inject({
      method: "POST",
      url: saleUrl,
      headers: { cookie: operator },
      payload: { ...payload, receiptNumber: "R-DUP-002" }
    });
    assert.equal(duplicateSource.statusCode, 200, duplicateSource.body);
    assert.equal(duplicateSource.json().sale.id, firstBody.sale.id);
    assert.equal(duplicateSource.json().sale.receiptNumber, "R-DUP-001");
    assert.equal(duplicateSource.json().session.expectedCash, firstBody.session.expectedCash);
    assert.equal(app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM stock_moves
      WHERE org_id = ? AND reference = ?
    `).get(orgId, "POS sale R-DUP-001").count, firstMoveCount);

    const duplicateReceipt = await app.inject({
      method: "POST",
      url: saleUrl,
      headers: { cookie: operator },
      payload: { ...payload, idempotencyKey: "pos-sale-dup-2" }
    });
    assert.equal(duplicateReceipt.statusCode, 409, duplicateReceipt.body);

    const close = await app.inject({
      method: "POST",
      url: `/api/pos/cash-sessions/${sessionId}/close`,
      headers: { cookie: operator },
      payload: {
        countedCash: 95000,
        fiscalDeviceId: "FISCAL-AM-DUP",
        zReportNumber: "Z-DUP-001",
        receiptNumberStart: "R-DUP-001",
        receiptNumberEnd: "R-DUP-001"
      }
    });
    assert.equal(close.statusCode, 200, close.body);

    const closedSale = await app.inject({
      method: "POST",
      url: saleUrl,
      headers: { cookie: operator },
      payload: {
        receiptNumber: "R-DUP-003",
        paymentMethod: "cash",
        idempotencyKey: "pos-sale-closed-1",
        lines: [{ catalogItemId: itemId, quantity: 1 }]
      }
    });
    assert.equal(closedSale.statusCode, 409, closedSale.body);
  } finally {
    await app.close();
  }
});

test("pos: closing requires fiscal evidence, computes difference, conflicts on reclose, and backs up", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");
    const owner = await login(app);

    const created = await app.inject({
      method: "POST",
      url: "/api/pos/cash-sessions",
      headers: { cookie: operator },
      payload: {
        stockLocationId: "stockloc-main-warehouse",
        registerCode: "POS-CLOSE",
        openingCash: 10000,
        fiscalDeviceId: "FISCAL-AM-CLOSE"
      }
    });
    assert.equal(created.statusCode, 200, created.body);
    const sessionId = created.json().session.id;

    const missingEvidence = await app.inject({
      method: "POST",
      url: `/api/pos/cash-sessions/${sessionId}/close`,
      headers: { cookie: operator },
      payload: { countedCash: 10000, zReportNumber: "Z-001" }
    });
    assert.equal(missingEvidence.statusCode, 400, missingEvidence.body);

    const invalidCash = await app.inject({
      method: "POST",
      url: `/api/pos/cash-sessions/${sessionId}/close`,
      headers: { cookie: operator },
      payload: {
        countedCash: "10000.50",
        fiscalDeviceId: "FISCAL-AM-CLOSE",
        zReportNumber: "Z-001",
        receiptNumberStart: "R-100",
        receiptNumberEnd: "R-120"
      }
    });
    assert.equal(invalidCash.statusCode, 400, invalidCash.body);

    const closed = await app.inject({
      method: "POST",
      url: `/api/pos/cash-sessions/${sessionId}/close`,
      headers: { cookie: operator },
      payload: {
        countedCash: 12500,
        fiscalDeviceId: "FISCAL-AM-CLOSE",
        zReportNumber: "Z-2026-0001",
        receiptNumberStart: "R-100",
        receiptNumberEnd: "R-120",
        closeNote: "Drawer over by reviewed cash count.",
        closedAt: "2026-06-22T18:00:00.000Z"
      }
    });
    assert.equal(closed.statusCode, 200, closed.body);
    const session = closed.json().session;
    assert.equal(session.status, "closed");
    assert.equal(session.expectedCash, 10000);
    assert.equal(session.countedCash, 12500);
    assert.equal(session.cashDifference, 2500);
    assert.equal(session.zReportNumber, "Z-2026-0001");
    assert.equal(session.receiptNumberStart, "R-100");
    assert.equal(session.receiptNumberEnd, "R-120");
    assert.equal(session.closedAt, "2026-06-22T18:00:00.000Z");

    const closedAgain = await app.inject({
      method: "POST",
      url: `/api/pos/cash-sessions/${sessionId}/close`,
      headers: { cookie: operator },
      payload: {
        countedCash: 12500,
        fiscalDeviceId: "FISCAL-AM-CLOSE",
        zReportNumber: "Z-2026-0001",
        receiptNumberStart: "R-100",
        receiptNumberEnd: "R-120"
      }
    });
    assert.equal(closedAgain.statusCode, 409, closedAgain.body);

    const listed = await app.inject({ method: "GET", url: "/api/pos/cash-sessions?status=closed", headers: { cookie: operator } });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.ok(listed.json().sessions.some(item => item.id === sessionId && item.cashDifference === 2500));

    const backup = await app.inject({
      method: "POST",
      url: "/api/admin/backups",
      headers: { cookie: owner },
      payload: { note: "POS cash-session closeout evidence must be restorable." }
    });
    assert.equal(backup.statusCode, 200, backup.body);
    const rows = backup.json().backup.payload.tables.pos_cash_sessions;
    assert.ok(Array.isArray(rows));
    assert.ok(rows.some(row => (
      row.id === sessionId
      && row.status === "closed"
      && row.z_report_number === "Z-2026-0001"
      && row.cash_difference_amd === 2500
    )));
  } finally {
    await app.close();
  }
});
