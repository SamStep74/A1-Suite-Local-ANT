"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");
const ledger = require("../server/ledger");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const response = await app.inject({
    method: "POST",
    url: "/api/login",
    payload: { email, password }
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.headers["set-cookie"];
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function createPostedPosSale(app, operator, options = {}) {
  const orgId = "org-armosphera-demo";
  app.db.prepare("UPDATE finance_periods SET status = 'open' WHERE org_id = ? AND period_key = ?")
    .run(orgId, new Date().toISOString().slice(0, 7));
  const stockLocationId = options.stockLocationId || "stockloc-main-warehouse";
  const opened = await app.inject({
    method: "POST",
    url: "/api/pos/cash-sessions",
    headers: { cookie: operator },
    payload: {
      stockLocationId,
      registerCode: options.registerCode || "POS-PACKET",
      openingCash: options.openingCash ?? 10000,
      fiscalDeviceId: options.fiscalDeviceId ?? "FISCAL-AM-PACKET",
      openedAt: options.openedAt || "2026-06-22T08:00:00.000Z"
    }
  });
  assert.equal(opened.statusCode, 200, opened.body);
  const session = opened.json().session;
  const posted = await app.inject({
    method: "POST",
    url: options.useSalesEndpoint ? "/api/pos/sales" : `/api/pos/cash-sessions/${session.id}/sales`,
    headers: { cookie: operator },
    payload: {
      ...(options.useSalesEndpoint ? { cashSessionId: session.id } : {}),
      receiptNumber: options.receiptNumber || "R-PACKET-001",
      paymentMethod: options.paymentMethod || "cash",
      ...(options.payments ? { payments: options.payments } : {}),
      soldAt: options.soldAt || "2026-06-22T09:15:00.000Z",
      idempotencyKey: options.idempotencyKey || "pos-receipt-packet-sale",
      lines: options.lines || [{ catalogItemId: "catitem-pos-barcode-scanner", quantity: 1 }]
    }
  });
  assert.equal(posted.statusCode, 200, posted.body);
  return { session: posted.json().session || session, sale: posted.json().sale };
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
    assert.equal(workspace.json().capabilityStatus.refunds, "available");
    assert.equal(workspace.json().capabilityStatus.receiptPrinting, "local-preview");

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
    assert.equal(session.expectedCashBasis, "opening-cash-plus-cash-sales-minus-cash-refunds");
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
    assert.equal(body.evidenceMetadata.expectedCashBasis, "opening-cash-plus-cash-sales-minus-cash-refunds");
    assert.equal(body.capabilityStatus.inventoryPosting, "available");
    assert.equal(body.capabilityStatus.ledgerPosting, "available");
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
    await expectRejected({ receiptNumber: "R-VAL-6", paymentMethod: "cash", idempotencyKey: "pos-val-empty-split", payments: [], lines: [line] }, 422);
    await expectRejected({ receiptNumber: "R-VAL-7", paymentMethod: "cash", idempotencyKey: "pos-val-bad-split-method", payments: [{ paymentMethod: "crypto", amount: 85000 }], lines: [line] }, 422);
    await expectRejected({ receiptNumber: "R-VAL-8", paymentMethod: "cash", idempotencyKey: "pos-val-decimal-split", payments: [{ paymentMethod: "cash", amount: "1.50" }], lines: [line] }, 422);
    await expectRejected({ receiptNumber: "R-VAL-9", paymentMethod: "cash", idempotencyKey: "pos-val-wrong-split-total", payments: [{ paymentMethod: "cash", amount: 1000 }, { paymentMethod: "card", amount: 1000 }], lines: [line] }, 422);

    app.db.prepare("UPDATE catalog_items SET fiscal_receipt_required = 0 WHERE org_id = ? AND id = ?")
      .run("org-armosphera-demo", "catitem-pos-barcode-scanner");
    await expectRejected({ receiptNumber: "R-VAL-10", paymentMethod: "cash", idempotencyKey: "pos-val-non-fiscal", lines: [line] }, 422);
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
    assert.equal(body.session.postings.ledgerPosting, "posted");

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
    assert.equal(sale.postings.salePosting, "posted");
    assert.equal(sale.postings.inventoryPosting, "posted");
    assert.equal(sale.postings.ledgerPosting, "posted");
    assert.equal(sale.postings.ledgerPostingCount, 2);
    assert.equal(sale.postings.ledgerPostingIds.length, 2);
    const saleJournals = app.db.prepare(`
      SELECT debit_code, credit_code, amount, source_type, source_id, period_key
      FROM ledger_journal
      WHERE org_id = ? AND source_type = ? AND source_id = ?
      ORDER BY credit_code
    `).all(orgId, "pos_sale", sale.id).map(row => ({ ...row }));
    assert.deepEqual(saleJournals, [
      { debit_code: "251", credit_code: "524", amount: 28333, source_type: "pos_sale", source_id: sale.id, period_key: "2026-06" },
      { debit_code: "251", credit_code: "611", amount: 141667, source_type: "pos_sale", source_id: sale.id, period_key: "2026-06" }
    ]);

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
      && row.ledger_posting_status === "posted"
    )));
    assert.ok(tables.pos_sale_lines.some(row => (
      row.sale_id === sale.id
      && row.catalog_item_id === itemId
      && row.stock_move_id === saleLine.stockMoveId
    )));
    assert.ok(tables.ledger_journal.some(row => (
      row.source_type === "pos_sale"
      && row.source_id === sale.id
      && row.debit_code === "251"
      && row.credit_code === "611"
      && row.amount === 141667
    )));
    assert.ok(tables.ledger_journal.some(row => (
      row.source_type === "pos_sale"
      && row.source_id === sale.id
      && row.debit_code === "251"
      && row.credit_code === "524"
      && row.amount === 28333
    )));
  } finally {
    await app.close();
  }
});

test("pos: split cash and card sale records payment evidence, ledger split, expected cash, and terminal clearing", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");
    const owner = await login(app);
    const orgId = "org-armosphera-demo";
    const { session, sale } = await createPostedPosSale(app, operator, {
      registerCode: "POS-SPLIT-SALE",
      openingCash: 10000,
      fiscalDeviceId: "FISCAL-AM-SPLIT",
      receiptNumber: "R-SPLIT-001",
      paymentMethod: "cash",
      payments: [
        { paymentMethod: "cash", amount: 20000 },
        { paymentMethod: "card", amount: 65000 }
      ],
      idempotencyKey: "pos-split-sale-1",
      useSalesEndpoint: true
    });

    assert.equal(session.expectedCash, 30000);
    assert.equal(sale.total, 85000);
    assert.equal(sale.paidCash, 20000);
    assert.equal(sale.paymentMethod, "cash");
    assert.equal(sale.paymentCount, 2);
    assert.deepEqual(sale.paymentTotals, { cash: 20000, card: 65000, "bank-transfer": 0 });
    assert.deepEqual(sale.payments.map(payment => ({
      paymentMethod: payment.paymentMethod,
      amount: payment.amount
    })), [
      { paymentMethod: "cash", amount: 20000 },
      { paymentMethod: "card", amount: 65000 }
    ]);

    const paymentRows = app.db.prepare(`
      SELECT payment_method, amount_amd
      FROM pos_sale_payments
      WHERE org_id = ? AND sale_id = ?
      ORDER BY line_number
    `).all(orgId, sale.id).map(row => ({ ...row }));
    assert.deepEqual(paymentRows, [
      { payment_method: "cash", amount_amd: 20000 },
      { payment_method: "card", amount_amd: 65000 }
    ]);

    const saleJournals = app.db.prepare(`
      SELECT debit_code, credit_code, amount, source_type, source_id, period_key
      FROM ledger_journal
      WHERE org_id = ? AND source_type = ? AND source_id = ?
      ORDER BY debit_code, credit_code
    `).all(orgId, "pos_sale", sale.id).map(row => ({ ...row }));
    assert.deepEqual(saleJournals, [
      { debit_code: "251", credit_code: "524", amount: 3333, source_type: "pos_sale", source_id: sale.id, period_key: "2026-06" },
      { debit_code: "251", credit_code: "611", amount: 16667, source_type: "pos_sale", source_id: sale.id, period_key: "2026-06" },
      { debit_code: "255", credit_code: "524", amount: 10834, source_type: "pos_sale", source_id: sale.id, period_key: "2026-06" },
      { debit_code: "255", credit_code: "611", amount: 54166, source_type: "pos_sale", source_id: sale.id, period_key: "2026-06" }
    ]);

    const closed = await app.inject({
      method: "POST",
      url: `/api/pos/cash-sessions/${session.id}/close`,
      headers: { cookie: operator },
      payload: {
        countedCash: 30000,
        fiscalDeviceId: "FISCAL-AM-SPLIT",
        zReportNumber: "ZR-SPLIT-001",
        receiptNumberStart: "R-SPLIT-001",
        receiptNumberEnd: "R-SPLIT-001",
        closeNote: "Split sale ready for card batch."
      }
    });
    assert.equal(closed.statusCode, 200, closed.body);

    const preview = await app.inject({
      method: "GET",
      url: `/api/pos/cash-sessions/${session.id}/terminal-settlement-preview`,
      headers: { cookie: operator }
    });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().preview.cardSalesTotal, 65000);
    assert.equal(preview.json().preview.cardSalesCount, 1);
    assert.equal(preview.json().preview.outstandingAmount, 65000);

    const settlement = await app.inject({
      method: "POST",
      url: `/api/pos/cash-sessions/${session.id}/terminal-settlements`,
      headers: { cookie: operator },
      payload: {
        idempotencyKey: "pos-split-terminal-settlement-1",
        settlementReference: "TERM-SPLIT-001",
        provider: "Acba POS",
        settledTotal: 65000
      }
    });
    assert.equal(settlement.statusCode, 200, settlement.body);
    assert.equal(settlement.json().settlement.expectedTotal, 65000);
    assert.equal(settlement.json().settlement.settledTotal, 65000);
    assert.equal(settlement.json().preview.outstandingAmount, 0);

    const backup = await app.inject({
      method: "POST",
      url: "/api/admin/backups",
      headers: { cookie: owner },
      payload: { note: "POS split payment rows must be restorable." }
    });
    assert.equal(backup.statusCode, 200, backup.body);
    assert.ok(backup.json().backup.payload.tables.pos_sale_payments.some(row => (
      row.sale_id === sale.id
      && row.payment_method === "card"
      && row.amount_amd === 65000
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

test("pos: receipt packet prepares local fiscal handoff evidence for a posted sale", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");
    const owner = await login(app);
    const orgId = "org-armosphera-demo";
    const { session, sale } = await createPostedPosSale(app, operator, {
      registerCode: "POS-PACKET",
      fiscalDeviceId: "FISCAL-AM-PACKET",
      receiptNumber: "R-PACKET-001",
      idempotencyKey: "pos-receipt-packet-sale-1"
    });
    const auditCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM audit_events
      WHERE org_id = ? AND type = ?
    `).get(orgId, "pos.receipt_packet.prepared").count;
    const eventCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM suite_events
      WHERE org_id = ? AND event_type = ?
    `).get(orgId, "pos.receipt_packet.prepared").count;
    const beforeAudit = auditCount();
    const beforeEvents = eventCount();

    const prepared = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/receipt-packet`,
      headers: { cookie: operator },
      payload: {}
    });
    assert.equal(prepared.statusCode, 200, prepared.body);
    const body = prepared.json();
    assert.equal(body.ok, true);
    assert.equal(body.idempotent, false);
    assert.equal(body.sale.id, sale.id);

    const packet = body.receiptPacket;
    assert.match(packet.id, /^pos-receipt-packet-/);
    assert.equal(packet.saleId, sale.id);
    assert.equal(packet.cashSessionId, session.id);
    assert.equal(packet.receiptNumber, "R-PACKET-001");
    assert.equal(packet.fiscalDeviceId, "FISCAL-AM-PACKET");
    assert.equal(packet.packetStatus, "prepared");
    assert.equal(packet.packetKind, "pos-fiscal-receipt-handoff");
    assert.equal(packet.packetFormat, "json-v1");
    assert.match(packet.checksum, /^[a-f0-9]{64}$/);

    assert.equal(packet.payload.kind, "armosphera-one-pos-receipt-packet");
    assert.equal(packet.payload.sale.id, sale.id);
    assert.equal(packet.payload.sale.status, "posted");
    assert.deepEqual(packet.payload.sale.payments.map(payment => ({
      paymentMethod: payment.paymentMethod,
      amount: payment.amount
    })), [
      { paymentMethod: "cash", amount: sale.total }
    ]);
    assert.deepEqual(packet.payload.sale.totals, {
      subtotal: sale.subtotal,
      vat: sale.vat,
      total: sale.total,
      paidCash: sale.paidCash,
      paymentTotals: { cash: sale.total, card: 0, "bank-transfer": 0 }
    });
    assert.equal(packet.payload.session.id, session.id);
    assert.equal(packet.payload.session.fiscalDeviceId, "FISCAL-AM-PACKET");
    assert.equal(packet.payload.lines.length, 1);
    assert.equal(packet.payload.lines[0].sku, "HW-BARCODE-SCANNER");
    assert.equal(packet.payload.lines[0].fiscalReceiptRequired, true);
    assert.equal(packet.payload.fiscal.deviceId, "FISCAL-AM-PACKET");
    assert.equal(packet.payload.fiscal.liveSubmission, false);
    assert.equal(packet.payload.fiscal.submissionStatus, "not-submitted");
    assert.ok(packet.payload.controls.includes("no-live-fiscal-device-submission"));
    assert.equal(packet.checksum, sha256Json(packet.payload));

    const replayed = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/receipt-packet`,
      headers: { cookie: operator },
      payload: { fiscalDeviceId: "FISCAL-AM-IGNORED-ON-REPLAY" }
    });
    assert.equal(replayed.statusCode, 200, replayed.body);
    assert.equal(replayed.json().idempotent, true);
    assert.equal(replayed.json().receiptPacket.id, packet.id);
    assert.equal(replayed.json().receiptPacket.fiscalDeviceId, "FISCAL-AM-PACKET");
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM pos_receipt_packets WHERE org_id = ? AND sale_id = ?").get(orgId, sale.id).count, 1);
    assert.equal(auditCount(), beforeAudit + 1);
    assert.equal(eventCount(), beforeEvents + 1);

    const backup = await app.inject({
      method: "POST",
      url: "/api/admin/backups",
      headers: { cookie: owner },
      payload: { note: "POS receipt packet evidence must be restorable." }
    });
    assert.equal(backup.statusCode, 200, backup.body);
    assert.ok(backup.json().backup.payload.tables.pos_receipt_packets.some(row => (
      row.id === packet.id
      && row.sale_id === sale.id
      && row.cash_session_id === session.id
      && row.packet_status === "prepared"
      && row.checksum === packet.checksum
    )));
  } finally {
    await app.close();
  }
});

test("pos: receipt print records local preview evidence after packet preparation", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");
    const owner = await login(app);
    const orgId = "org-armosphera-demo";
    const { session, sale } = await createPostedPosSale(app, operator, {
      registerCode: "POS-PRINT",
      fiscalDeviceId: "FISCAL-AM-PRINT",
      receiptNumber: "R-PRINT-001",
      idempotencyKey: "pos-receipt-print-sale-1"
    });

    const badId = await app.inject({
      method: "POST",
      url: "/api/pos/sales/POS-SALE-BAD/receipt-print",
      headers: { cookie: operator },
      payload: {}
    });
    assert.equal(badId.statusCode, 400, badId.body);

    const badBody = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/receipt-print`,
      headers: { cookie: operator },
      payload: []
    });
    assert.equal(badBody.statusCode, 400, badBody.body);

    const missingSale = await app.inject({
      method: "POST",
      url: "/api/pos/sales/pos-sale-missing/receipt-print",
      headers: { cookie: operator },
      payload: {}
    });
    assert.equal(missingSale.statusCode, 404, missingSale.body);

    const missingPacket = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/receipt-print`,
      headers: { cookie: operator },
      payload: {}
    });
    assert.equal(missingPacket.statusCode, 409, missingPacket.body);

    const prepared = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/receipt-packet`,
      headers: { cookie: operator },
      payload: {}
    });
    assert.equal(prepared.statusCode, 200, prepared.body);
    const packet = prepared.json().receiptPacket;

    const auditCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM audit_events
      WHERE org_id = ? AND type = ?
    `).get(orgId, "pos.receipt_print.previewed").count;
    const eventCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM suite_events
      WHERE org_id = ? AND event_type = ?
    `).get(orgId, "pos.receipt_print.previewed").count;
    const beforeAudit = auditCount();
    const beforeEvents = eventCount();

    const printed = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/receipt-print`,
      headers: { cookie: operator },
      payload: {
        copyCount: 2,
        printMode: "local-preview",
        printFormat: "receipt-preview-json-v1"
      }
    });
    assert.equal(printed.statusCode, 200, printed.body);
    const body = printed.json();
    assert.equal(body.ok, true);
    assert.equal(body.idempotent, false);
    assert.equal(body.sale.id, sale.id);
    assert.equal(body.receiptPacket.id, packet.id);
    assert.equal(body.receiptPacket.receiptPrint.checksum, body.receiptPrint.checksum);

    const receiptPrint = body.receiptPrint;
    assert.equal(receiptPrint.receiptPacketId, packet.id);
    assert.equal(receiptPrint.saleId, sale.id);
    assert.equal(receiptPrint.cashSessionId, session.id);
    assert.equal(receiptPrint.receiptNumber, "R-PRINT-001");
    assert.equal(receiptPrint.status, "previewed");
    assert.equal(receiptPrint.printMode, "local-preview");
    assert.equal(receiptPrint.printFormat, "receipt-preview-json-v1");
    assert.equal(receiptPrint.copyCount, 2);
    assert.equal(receiptPrint.liveFiscalSubmission, false);
    assert.equal(receiptPrint.physicalPrinterCommand, false);
    assert.equal(receiptPrint.deviceSubmissionStatus, "not-submitted");
    assert.match(receiptPrint.checksum, /^[a-f0-9]{64}$/);
    assert.ok(receiptPrint.previewLines.some(line => line.includes("R-PRINT-001")));
    assert.ok(receiptPrint.previewText.includes("no printer or fiscal device command"));

    assert.equal(receiptPrint.payload.kind, "armosphera-one-pos-receipt-print-preview");
    assert.equal(receiptPrint.payload.print.status, "previewed");
    assert.equal(receiptPrint.payload.print.copyCount, 2);
    assert.equal(receiptPrint.payload.print.liveFiscalSubmission, false);
    assert.equal(receiptPrint.payload.print.physicalPrinterCommand, false);
    assert.equal(receiptPrint.payload.receiptPacket.checksum, packet.checksum);
    assert.equal(receiptPrint.payload.fiscal.liveSubmission, false);
    assert.equal(receiptPrint.payload.fiscal.physicalPrinterCommand, false);
    assert.ok(receiptPrint.payload.controls.includes("no-live-fiscal-device-submission"));
    assert.ok(receiptPrint.payload.controls.includes("no-physical-printer-command"));
    assert.equal(receiptPrint.checksum, sha256Json(receiptPrint.payload));

    const replayed = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/receipt-print`,
      headers: { cookie: operator },
      payload: { copyCount: 5 }
    });
    assert.equal(replayed.statusCode, 200, replayed.body);
    assert.equal(replayed.json().idempotent, true);
    assert.equal(replayed.json().receiptPrint.checksum, receiptPrint.checksum);
    assert.equal(replayed.json().receiptPrint.copyCount, 2);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM pos_receipt_packets WHERE org_id = ? AND sale_id = ?").get(orgId, sale.id).count, 1);
    assert.equal(auditCount(), beforeAudit + 1);
    assert.equal(eventCount(), beforeEvents + 1);

    const backup = await app.inject({
      method: "POST",
      url: "/api/admin/backups",
      headers: { cookie: owner },
      payload: { note: "POS receipt print preview evidence must be restorable." }
    });
    assert.equal(backup.statusCode, 200, backup.body);
    assert.ok(backup.json().backup.payload.tables.pos_receipt_packets.some(row => (
      row.id === packet.id
      && row.sale_id === sale.id
      && row.receipt_print_status === "previewed"
      && row.receipt_print_checksum === receiptPrint.checksum
      && row.receipt_print_copy_count === 2
    )));
  } finally {
    await app.close();
  }
});

test("pos: receipt packet rejects malformed input, missing sales, unposted sales, and missing fiscal device", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");
    const orgId = "org-armosphera-demo";

    const badId = await app.inject({
      method: "POST",
      url: "/api/pos/sales/POS-SALE-BAD/receipt-packet",
      headers: { cookie: operator },
      payload: {}
    });
    assert.equal(badId.statusCode, 400, badId.body);

    const badBody = await app.inject({
      method: "POST",
      url: "/api/pos/sales/pos-sale-missing/receipt-packet",
      headers: { cookie: operator },
      payload: []
    });
    assert.equal(badBody.statusCode, 400, badBody.body);

    const missingSale = await app.inject({
      method: "POST",
      url: "/api/pos/sales/pos-sale-missing/receipt-packet",
      headers: { cookie: operator },
      payload: {}
    });
    assert.equal(missingSale.statusCode, 404, missingSale.body);

    const noFiscal = await createPostedPosSale(app, operator, {
      registerCode: "POS-PACKET-NOFISCAL",
      fiscalDeviceId: "",
      receiptNumber: "R-PACKET-NOFISCAL",
      idempotencyKey: "pos-receipt-packet-no-fiscal"
    });
    const missingFiscalDevice = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${noFiscal.sale.id}/receipt-packet`,
      headers: { cookie: operator },
      payload: {}
    });
    assert.equal(missingFiscalDevice.statusCode, 400, missingFiscalDevice.body);

    const explicitFiscalDevice = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${noFiscal.sale.id}/receipt-packet`,
      headers: { cookie: operator },
      payload: { fiscalDeviceId: "FISCAL-AM-BODY" }
    });
    assert.equal(explicitFiscalDevice.statusCode, 200, explicitFiscalDevice.body);
    assert.equal(explicitFiscalDevice.json().receiptPacket.fiscalDeviceId, "FISCAL-AM-BODY");

    const unposted = await createPostedPosSale(app, operator, {
      registerCode: "POS-PACKET-UNPOSTED",
      fiscalDeviceId: "FISCAL-AM-UNPOSTED",
      receiptNumber: "R-PACKET-UNPOSTED",
      idempotencyKey: "pos-receipt-packet-unposted"
    });
    app.db.prepare("UPDATE pos_sales SET status = 'draft' WHERE org_id = ? AND id = ?")
      .run(orgId, unposted.sale.id);
    const notPosted = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${unposted.sale.id}/receipt-packet`,
      headers: { cookie: operator },
      payload: {}
    });
    assert.equal(notPosted.statusCode, 409, notPosted.body);
  } finally {
    await app.close();
  }
});

test("pos: cash sale void posts evidence, reduces expected cash, replays idempotently, and backs up", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");
    const owner = await login(app);
    const orgId = "org-armosphera-demo";
    const { session, sale } = await createPostedPosSale(app, operator, {
      registerCode: "POS-VOID-CASH",
      openingCash: 20000,
      fiscalDeviceId: "FISCAL-AM-VOID-CASH",
      receiptNumber: "R-VOID-CASH-001",
      idempotencyKey: "pos-void-cash-sale-1"
    });
    assert.equal(session.expectedCash, 105000);

    const itemId = "catitem-pos-barcode-scanner";
    const stockLocationId = "stockloc-main-warehouse";
    const quant = () => app.db.prepare(`
      SELECT quantity
      FROM stock_quants
      WHERE org_id = ? AND catalog_item_id = ? AND location_id = ?
    `).get(orgId, itemId, stockLocationId).quantity;
    const afterSaleQuantity = quant();
    const stockMoveCount = () => app.db.prepare("SELECT COUNT(*) AS count FROM stock_moves WHERE org_id = ?").get(orgId).count;
    const auditCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM audit_events
      WHERE org_id = ? AND type = ?
    `).get(orgId, "pos.sale.voided").count;
    const eventCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM suite_events
      WHERE org_id = ? AND event_type = ?
    `).get(orgId, "pos.sale.voided").count;
    const beforeMoves = stockMoveCount();
    const beforeAudit = auditCount();
    const beforeEvents = eventCount();
    const vatAfterSale = ledger.vatReport(app.db, orgId, "2026-06");

    const payload = {
      idempotencyKey: "pos-void-cash-1",
      voidReference: "void-cash-001",
      reason: "Cashier caught the sale before fiscal receipt handoff.",
      voidedAt: "2026-06-22T10:15:00.000Z"
    };
    const voided = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/void`,
      headers: { cookie: operator },
      payload
    });
    assert.equal(voided.statusCode, 200, voided.body);
    const body = voided.json();
    assert.equal(body.ok, true);
    assert.equal(body.idempotent, false);
    assert.equal(body.session.id, session.id);
    assert.equal(body.session.expectedCash, 20000);
    assert.equal(body.sale.id, sale.id);
    assert.equal(body.sale.status, "voided");
    assert.equal(body.sale.postings.salePosting, "posted");
    assert.equal(body.sale.postings.inventoryPosting, "posted");
    assert.equal(body.sale.postings.ledgerPosting, "posted");
    assert.equal(body.sale.postings.ledgerPostingCount, 2);

    const saleVoid = body.void;
    assert.match(saleVoid.id, /^pos-sale-void-/);
    assert.equal(saleVoid.saleId, sale.id);
    assert.equal(saleVoid.cashSessionId, session.id);
    assert.equal(saleVoid.voidReference, "VOID-CASH-001");
    assert.equal(saleVoid.sourceKey, "pos-void-cash-1");
    assert.equal(saleVoid.reason, "Cashier caught the sale before fiscal receipt handoff.");
    assert.equal(saleVoid.voidedTotal, sale.total);
    assert.equal(saleVoid.cashAdjustment, sale.paidCash);
    assert.equal(saleVoid.status, "posted");
    assert.equal(saleVoid.inventoryPostingStatus, "posted");
    assert.equal(saleVoid.ledgerPostingStatus, "posted");
    assert.equal(saleVoid.postings.ledgerPosting, "posted");
    assert.equal(saleVoid.postings.ledgerPostingCount, 2);
    assert.equal(saleVoid.postings.ledgerPostingIds.length, 2);
    assert.equal(saleVoid.voidedAt, "2026-06-22T10:15:00.000Z");
    assert.equal(saleVoid.lineCount, sale.lineCount);
    assert.equal(saleVoid.lines[0].saleLineId, sale.lines[0].id);
    assert.equal(saleVoid.lines[0].quantity, sale.lines[0].quantity);
    assert.equal(saleVoid.lines[0].total, sale.lines[0].total);
    assert.equal(saleVoid.lines[0].sourceStockMoveId, sale.lines[0].stockMoveId);
    assert.match(saleVoid.lines[0].returnStockMoveId, /^stockmove-/);
    assert.equal(stockMoveCount(), beforeMoves + 1);
    assert.equal(quant(), afterSaleQuantity + sale.lines[0].quantity);
    const returnStockMove = app.db.prepare("SELECT * FROM stock_moves WHERE org_id = ? AND id = ?")
      .get(orgId, saleVoid.lines[0].returnStockMoveId);
    assert.equal(returnStockMove.move_type, "return");
    assert.equal(returnStockMove.source_location_id, "stockloc-customer");
    assert.equal(returnStockMove.destination_location_id, stockLocationId);
    assert.equal(returnStockMove.quantity, sale.lines[0].quantity);
    assert.equal(returnStockMove.reference, "POS void VOID-CASH-001 line 1");
    assert.equal(returnStockMove.status, "posted");

    const voidJournals = app.db.prepare(`
      SELECT debit_code, credit_code, amount, source_type, source_id, period_key
      FROM ledger_journal
      WHERE org_id = ? AND source_type = ? AND source_id = ?
      ORDER BY debit_code
    `).all(orgId, "pos_sale_void", saleVoid.id).map(row => ({ ...row }));
    assert.deepEqual(voidJournals, [
      { debit_code: "524", credit_code: "251", amount: sale.vat, source_type: "pos_sale_void", source_id: saleVoid.id, period_key: "2026-06" },
      { debit_code: "611", credit_code: "251", amount: sale.subtotal, source_type: "pos_sale_void", source_id: saleVoid.id, period_key: "2026-06" }
    ]);
    const voidVat = ledger.vatReport(app.db, orgId, "2026-06");
    assert.equal(voidVat.outputVat, vatAfterSale.outputVat - sale.vat);
    assert.equal(voidVat.netVatPayable, vatAfterSale.netVatPayable - sale.vat);
    assert.equal(auditCount(), beforeAudit + 1);
    assert.equal(eventCount(), beforeEvents + 1);

    const replayed = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/void`,
      headers: { cookie: operator },
      payload: { ...payload, reason: "Replay should not alter the stored void." }
    });
    assert.equal(replayed.statusCode, 200, replayed.body);
    assert.equal(replayed.json().idempotent, true);
    assert.equal(replayed.json().void.id, saleVoid.id);
    assert.equal(replayed.json().void.reason, "Cashier caught the sale before fiscal receipt handoff.");
    assert.equal(replayed.json().session.expectedCash, 20000);
    assert.equal(replayed.json().void.lines[0].returnStockMoveId, saleVoid.lines[0].returnStockMoveId);
    assert.equal(stockMoveCount(), beforeMoves + 1);
    assert.equal(quant(), afterSaleQuantity + sale.lines[0].quantity);
    assert.equal(auditCount(), beforeAudit + 1);
    assert.equal(eventCount(), beforeEvents + 1);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM pos_sale_voids WHERE org_id = ? AND sale_id = ?").get(orgId, sale.id).count, 1);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/void`,
      headers: { cookie: operator },
      payload: { ...payload, idempotencyKey: "pos-void-cash-2", voidReference: "VOID-CASH-002" }
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);

    const backup = await app.inject({
      method: "POST",
      url: "/api/admin/backups",
      headers: { cookie: owner },
      payload: { note: "POS void evidence must be restorable." }
    });
    assert.equal(backup.statusCode, 200, backup.body);
    const tables = backup.json().backup.payload.tables;
    assert.ok(tables.pos_sale_voids.some(row => (
      row.id === saleVoid.id
      && row.sale_id === sale.id
      && row.cash_session_id === session.id
      && row.void_reference === "VOID-CASH-001"
      && row.source_key === "pos-void-cash-1"
      && row.voided_total_amd === sale.total
      && row.cash_adjustment_amd === sale.paidCash
      && row.inventory_posting_status === "posted"
      && row.ledger_posting_status === "posted"
    )));
    assert.ok(tables.pos_sale_void_lines.some(row => (
      row.void_id === saleVoid.id
      && row.sale_id === sale.id
      && row.sale_line_id === sale.lines[0].id
      && row.source_stock_move_id === sale.lines[0].stockMoveId
      && row.return_stock_move_id === saleVoid.lines[0].returnStockMoveId
    )));
    assert.ok(tables.stock_moves.some(row => (
      row.id === saleVoid.lines[0].returnStockMoveId
      && row.move_type === "return"
      && row.source_location_id === "stockloc-customer"
      && row.destination_location_id === stockLocationId
    )));
    assert.ok(tables.ledger_journal.some(row => (
      row.source_type === "pos_sale_void"
      && row.source_id === saleVoid.id
      && row.debit_code === "611"
      && row.credit_code === "251"
      && row.amount === sale.subtotal
    )));
    assert.ok(tables.ledger_journal.some(row => (
      row.source_type === "pos_sale_void"
      && row.source_id === saleVoid.id
      && row.debit_code === "524"
      && row.credit_code === "251"
      && row.amount === sale.vat
    )));
  } finally {
    await app.close();
  }
});

test("pos: cash full refund posts evidence, reduces expected cash, replays idempotently, and backs up", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");
    const owner = await login(app);
    const orgId = "org-armosphera-demo";
    const { session, sale } = await createPostedPosSale(app, operator, {
      registerCode: "POS-REFUND-CASH",
      openingCash: 20000,
      fiscalDeviceId: "FISCAL-AM-REFUND-CASH",
      receiptNumber: "R-REFUND-CASH-001",
      idempotencyKey: "pos-refund-cash-sale-1"
    });
    assert.equal(session.expectedCash, 105000);
    const itemId = "catitem-pos-barcode-scanner";
    const stockLocationId = "stockloc-main-warehouse";
    const quant = () => app.db.prepare(`
      SELECT quantity
      FROM stock_quants
      WHERE org_id = ? AND catalog_item_id = ? AND location_id = ?
    `).get(orgId, itemId, stockLocationId).quantity;
    const afterSaleQuantity = quant();

    const stockMoveCount = () => app.db.prepare("SELECT COUNT(*) AS count FROM stock_moves WHERE org_id = ?").get(orgId).count;
    const auditCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM audit_events
      WHERE org_id = ? AND type = ?
    `).get(orgId, "pos.sale.refunded").count;
    const eventCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM suite_events
      WHERE org_id = ? AND event_type = ?
    `).get(orgId, "pos.sale.refunded").count;
    const beforeMoves = stockMoveCount();
    const beforeAudit = auditCount();
    const beforeEvents = eventCount();
    const vatAfterSale = ledger.vatReport(app.db, orgId, "2026-06");

    const payload = {
      idempotencyKey: "pos-refund-cash-1",
      refundReference: "rf-cash-001",
      reason: "Customer returned sealed scanner.",
      refundMethod: "cash",
      refundedAt: "2026-06-22T10:00:00.000Z"
    };
    const refunded = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/refund`,
      headers: { cookie: operator },
      payload
    });
    assert.equal(refunded.statusCode, 200, refunded.body);
    const body = refunded.json();
    assert.equal(body.ok, true);
    assert.equal(body.idempotent, false);
    assert.equal(body.session.id, session.id);
    assert.equal(body.session.expectedCash, 20000);
    assert.equal(body.sale.id, sale.id);
    assert.equal(body.sale.status, "refunded_full");
    assert.equal(body.sale.postings.salePosting, "posted");
    assert.equal(body.sale.postings.inventoryPosting, "posted");
    assert.equal(body.sale.postings.ledgerPosting, "posted");
    assert.equal(body.sale.postings.ledgerPostingCount, 2);

    const refund = body.refund;
    assert.match(refund.id, /^pos-sale-refund-/);
    assert.equal(refund.saleId, sale.id);
    assert.equal(refund.cashSessionId, session.id);
    assert.equal(refund.refundReference, "RF-CASH-001");
    assert.equal(refund.sourceKey, "pos-refund-cash-1");
    assert.equal(refund.reason, "Customer returned sealed scanner.");
    assert.equal(refund.refundMethod, "cash");
    assert.equal(refund.refundedTotal, sale.total);
    assert.equal(refund.cashAdjustment, sale.paidCash);
    assert.equal(refund.status, "posted");
    assert.equal(refund.inventoryPostingStatus, "posted");
    assert.equal(refund.ledgerPostingStatus, "posted");
    assert.equal(refund.postings.ledgerPosting, "posted");
    assert.equal(refund.postings.ledgerPostingCount, 2);
    assert.equal(refund.postings.ledgerPostingIds.length, 2);
    assert.equal(refund.refundedAt, "2026-06-22T10:00:00.000Z");
    assert.equal(refund.lineCount, sale.lineCount);
    assert.equal(refund.lines[0].saleLineId, sale.lines[0].id);
    assert.equal(refund.lines[0].quantity, sale.lines[0].quantity);
    assert.equal(refund.lines[0].total, sale.lines[0].total);
    assert.equal(refund.lines[0].sourceStockMoveId, sale.lines[0].stockMoveId);
    assert.match(refund.lines[0].returnStockMoveId, /^stockmove-/);
    assert.equal(stockMoveCount(), beforeMoves + 1);
    assert.equal(quant(), afterSaleQuantity + sale.lines[0].quantity);
    const returnStockMove = app.db.prepare("SELECT * FROM stock_moves WHERE org_id = ? AND id = ?")
      .get(orgId, refund.lines[0].returnStockMoveId);
    assert.equal(returnStockMove.move_type, "return");
    assert.equal(returnStockMove.source_location_id, "stockloc-customer");
    assert.equal(returnStockMove.destination_location_id, stockLocationId);
    assert.equal(returnStockMove.quantity, sale.lines[0].quantity);
    assert.equal(returnStockMove.reference, "POS refund RF-CASH-001 line 1");
    assert.equal(returnStockMove.status, "posted");
    const refundJournals = app.db.prepare(`
      SELECT debit_code, credit_code, amount, source_type, source_id, period_key
      FROM ledger_journal
      WHERE org_id = ? AND source_type = ? AND source_id = ?
      ORDER BY debit_code
    `).all(orgId, "pos_sale_refund", refund.id).map(row => ({ ...row }));
    assert.deepEqual(refundJournals, [
      { debit_code: "524", credit_code: "251", amount: sale.vat, source_type: "pos_sale_refund", source_id: refund.id, period_key: "2026-06" },
      { debit_code: "611", credit_code: "251", amount: sale.subtotal, source_type: "pos_sale_refund", source_id: refund.id, period_key: "2026-06" }
    ]);
    const refundVat = ledger.vatReport(app.db, orgId, "2026-06");
    assert.equal(refundVat.outputVat, vatAfterSale.outputVat - sale.vat);
    assert.equal(refundVat.netVatPayable, vatAfterSale.netVatPayable - sale.vat);
    assert.equal(auditCount(), beforeAudit + 1);
    assert.equal(eventCount(), beforeEvents + 1);

    const replayed = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/refund`,
      headers: { cookie: operator },
      payload: { ...payload, reason: "Replay should not alter the stored refund." }
    });
    assert.equal(replayed.statusCode, 200, replayed.body);
    assert.equal(replayed.json().idempotent, true);
    assert.equal(replayed.json().refund.id, refund.id);
    assert.equal(replayed.json().refund.reason, "Customer returned sealed scanner.");
    assert.equal(replayed.json().session.expectedCash, 20000);
    assert.equal(replayed.json().refund.lines[0].returnStockMoveId, refund.lines[0].returnStockMoveId);
    assert.equal(stockMoveCount(), beforeMoves + 1);
    assert.equal(quant(), afterSaleQuantity + sale.lines[0].quantity);
    assert.equal(auditCount(), beforeAudit + 1);
    assert.equal(eventCount(), beforeEvents + 1);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM pos_sale_refunds WHERE org_id = ? AND sale_id = ?").get(orgId, sale.id).count, 1);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/refund`,
      headers: { cookie: operator },
      payload: { ...payload, idempotencyKey: "pos-refund-cash-2", refundReference: "RF-CASH-002" }
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);

    const backup = await app.inject({
      method: "POST",
      url: "/api/admin/backups",
      headers: { cookie: owner },
      payload: { note: "POS refund evidence must be restorable." }
    });
    assert.equal(backup.statusCode, 200, backup.body);
    const tables = backup.json().backup.payload.tables;
    assert.ok(tables.pos_sale_refunds.some(row => (
      row.id === refund.id
      && row.sale_id === sale.id
      && row.cash_session_id === session.id
      && row.refund_reference === "RF-CASH-001"
      && row.source_key === "pos-refund-cash-1"
      && row.refunded_total_amd === sale.total
      && row.cash_adjustment_amd === sale.paidCash
      && row.inventory_posting_status === "posted"
      && row.ledger_posting_status === "posted"
    )));
    assert.ok(tables.pos_sale_refund_lines.some(row => (
      row.refund_id === refund.id
      && row.sale_id === sale.id
      && row.sale_line_id === sale.lines[0].id
      && row.source_stock_move_id === sale.lines[0].stockMoveId
      && row.return_stock_move_id === refund.lines[0].returnStockMoveId
    )));
    assert.ok(tables.stock_moves.some(row => (
      row.id === refund.lines[0].returnStockMoveId
      && row.move_type === "return"
      && row.source_location_id === "stockloc-customer"
      && row.destination_location_id === stockLocationId
    )));
    assert.ok(tables.ledger_journal.some(row => (
      row.source_type === "pos_sale_refund"
      && row.source_id === refund.id
      && row.debit_code === "611"
      && row.credit_code === "251"
      && row.amount === sale.subtotal
    )));
    assert.ok(tables.ledger_journal.some(row => (
      row.source_type === "pos_sale_refund"
      && row.source_id === refund.id
      && row.debit_code === "524"
      && row.credit_code === "251"
      && row.amount === sale.vat
    )));
  } finally {
    await app.close();
  }
});

test("pos: cash partial refund reduces expected cash by the partial amount and prorates ledger without restock", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");
    const orgId = "org-armosphera-demo";
    const { session, sale } = await createPostedPosSale(app, operator, {
      registerCode: "POS-REFUND-PARTIAL-CASH",
      openingCash: 20000,
      fiscalDeviceId: "FISCAL-AM-REFUND-PARTIAL",
      receiptNumber: "R-REFUND-PARTIAL-001",
      idempotencyKey: "pos-refund-partial-sale-1"
    });
    assert.equal(session.expectedCash, 105000);

    const itemId = "catitem-pos-barcode-scanner";
    const stockLocationId = "stockloc-main-warehouse";
    const quant = () => app.db.prepare(`
      SELECT quantity
      FROM stock_quants
      WHERE org_id = ? AND catalog_item_id = ? AND location_id = ?
    `).get(orgId, itemId, stockLocationId).quantity;
    const afterSaleQuantity = quant();
    const stockMoveCount = () => app.db.prepare("SELECT COUNT(*) AS count FROM stock_moves WHERE org_id = ?").get(orgId).count;
    const beforeMoves = stockMoveCount();
    const vatAfterSale = ledger.vatReport(app.db, orgId, "2026-06");
    const refundedTotal = 30000;
    const refundedVat = Math.round((sale.vat * refundedTotal) / sale.total);
    const refundedSubtotal = refundedTotal - refundedVat;

    const payload = {
      idempotencyKey: "pos-refund-partial-cash-1",
      refundReference: "RF-PARTIAL-CASH-001",
      reason: "Customer received a partial goodwill refund.",
      refundMethod: "cash",
      refundedTotal,
      refundedAt: "2026-06-22T10:30:00.000Z"
    };
    const refunded = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/refund`,
      headers: { cookie: operator },
      payload
    });

    assert.equal(refunded.statusCode, 200, refunded.body);
    const body = refunded.json();
    assert.equal(body.ok, true);
    assert.equal(body.idempotent, false);
    assert.equal(body.session.expectedCash, session.expectedCash - refundedTotal);
    assert.equal(body.sale.status, "refunded");
    assert.equal(body.sale.postings.salePosting, "posted");
    assert.equal(body.sale.postings.ledgerPosting, "posted");

    const refund = body.refund;
    assert.equal(refund.saleId, sale.id);
    assert.equal(refund.cashSessionId, session.id);
    assert.equal(refund.refundReference, "RF-PARTIAL-CASH-001");
    assert.equal(refund.refundedTotal, refundedTotal);
    assert.equal(refund.cashAdjustment, refundedTotal);
    assert.equal(refund.inventoryPostingStatus, "not-posted");
    assert.equal(refund.ledgerPostingStatus, "posted");
    assert.equal(refund.postings.ledgerPostingCount, 2);
    assert.equal(refund.lineCount, 0);
    assert.deepEqual(refund.lines, []);
    assert.equal(stockMoveCount(), beforeMoves);
    assert.equal(quant(), afterSaleQuantity);

    const refundJournals = app.db.prepare(`
      SELECT debit_code, credit_code, amount, source_type, source_id, period_key
      FROM ledger_journal
      WHERE org_id = ? AND source_type = ? AND source_id = ?
      ORDER BY debit_code
    `).all(orgId, "pos_sale_refund", refund.id).map(row => ({ ...row }));
    assert.deepEqual(refundJournals, [
      { debit_code: "524", credit_code: "251", amount: refundedVat, source_type: "pos_sale_refund", source_id: refund.id, period_key: "2026-06" },
      { debit_code: "611", credit_code: "251", amount: refundedSubtotal, source_type: "pos_sale_refund", source_id: refund.id, period_key: "2026-06" }
    ]);
    const refundVat = ledger.vatReport(app.db, orgId, "2026-06");
    assert.equal(refundVat.outputVat, vatAfterSale.outputVat - refundedVat);
    assert.equal(refundVat.netVatPayable, vatAfterSale.netVatPayable - refundedVat);
    assert.equal(app.db.prepare("SELECT status FROM pos_sales WHERE org_id = ? AND id = ?").get(orgId, sale.id).status, "refunded");

    const replayed = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/refund`,
      headers: { cookie: operator },
      payload: { ...payload, reason: "Replay should not alter the partial refund." }
    });
    assert.equal(replayed.statusCode, 200, replayed.body);
    assert.equal(replayed.json().idempotent, true);
    assert.equal(replayed.json().refund.id, refund.id);
    assert.equal(replayed.json().refund.reason, "Customer received a partial goodwill refund.");
    assert.equal(replayed.json().session.expectedCash, session.expectedCash - refundedTotal);
    assert.equal(stockMoveCount(), beforeMoves);
    assert.equal(quant(), afterSaleQuantity);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/refund`,
      headers: { cookie: operator },
      payload: { ...payload, idempotencyKey: "pos-refund-partial-cash-2", refundReference: "RF-PARTIAL-CASH-002" }
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
  } finally {
    await app.close();
  }
});

test("pos: line-level partial refund derives amount, restocks returned quantity, and replays idempotently", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");
    const orgId = "org-armosphera-demo";
    const { session, sale } = await createPostedPosSale(app, operator, {
      registerCode: "POS-REFUND-LINE-RETURN",
      openingCash: 20000,
      fiscalDeviceId: "FISCAL-AM-REFUND-LINE",
      receiptNumber: "R-REFUND-LINE-001",
      idempotencyKey: "pos-refund-line-return-sale-1",
      lines: [{ catalogItemId: "catitem-pos-barcode-scanner", quantity: 2 }]
    });
    assert.equal(session.expectedCash, 190000);
    const sourceLine = sale.lines[0];
    const returnedQuantity = 1;
    const refundedTotal = Math.round((sourceLine.total * returnedQuantity) / sourceLine.quantity);
    const refundedVat = Math.min(sourceLine.vat, Math.round((sourceLine.vat * returnedQuantity) / sourceLine.quantity));
    const refundedSubtotal = refundedTotal - refundedVat;

    const itemId = "catitem-pos-barcode-scanner";
    const stockLocationId = "stockloc-main-warehouse";
    const quant = () => app.db.prepare(`
      SELECT quantity
      FROM stock_quants
      WHERE org_id = ? AND catalog_item_id = ? AND location_id = ?
    `).get(orgId, itemId, stockLocationId).quantity;
    const afterSaleQuantity = quant();
    const stockMoveCount = () => app.db.prepare("SELECT COUNT(*) AS count FROM stock_moves WHERE org_id = ?").get(orgId).count;
    const beforeMoves = stockMoveCount();
    const vatAfterSale = ledger.vatReport(app.db, orgId, "2026-06");

    const payload = {
      idempotencyKey: "pos-refund-line-return-1",
      refundReference: "RF-LINE-RETURN-001",
      reason: "Customer returned one scanner from a two-unit sale.",
      refundMethod: "cash",
      lines: [{ saleLineId: sourceLine.id, quantity: returnedQuantity }],
      refundedAt: "2026-06-22T10:45:00.000Z"
    };
    const refunded = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/refund`,
      headers: { cookie: operator },
      payload
    });
    assert.equal(refunded.statusCode, 200, refunded.body);
    const body = refunded.json();
    assert.equal(body.ok, true);
    assert.equal(body.idempotent, false);
    assert.equal(body.session.expectedCash, session.expectedCash - refundedTotal);
    assert.equal(body.sale.status, "refunded");

    const refund = body.refund;
    assert.equal(refund.refundReference, "RF-LINE-RETURN-001");
    assert.equal(refund.refundedTotal, refundedTotal);
    assert.equal(refund.cashAdjustment, refundedTotal);
    assert.equal(refund.inventoryPostingStatus, "posted");
    assert.equal(refund.ledgerPostingStatus, "posted");
    assert.equal(refund.postings.ledgerPostingCount, 2);
    assert.equal(refund.lineCount, 1);
    assert.equal(refund.lines[0].saleLineId, sourceLine.id);
    assert.equal(refund.lines[0].quantity, returnedQuantity);
    assert.equal(refund.lines[0].unitPrice, sourceLine.unitPrice);
    assert.equal(refund.lines[0].subtotal, refundedSubtotal);
    assert.equal(refund.lines[0].vat, refundedVat);
    assert.equal(refund.lines[0].total, refundedTotal);
    assert.equal(refund.lines[0].sourceStockMoveId, sourceLine.stockMoveId);
    assert.match(refund.lines[0].returnStockMoveId, /^stockmove-/);
    assert.equal(stockMoveCount(), beforeMoves + 1);
    assert.equal(quant(), afterSaleQuantity + returnedQuantity);

    const returnStockMove = app.db.prepare("SELECT * FROM stock_moves WHERE org_id = ? AND id = ?")
      .get(orgId, refund.lines[0].returnStockMoveId);
    assert.equal(returnStockMove.move_type, "return");
    assert.equal(returnStockMove.source_location_id, "stockloc-customer");
    assert.equal(returnStockMove.destination_location_id, stockLocationId);
    assert.equal(returnStockMove.quantity, returnedQuantity);
    assert.equal(returnStockMove.reference, "POS refund RF-LINE-RETURN-001 line 1");

    const refundJournals = app.db.prepare(`
      SELECT debit_code, credit_code, amount, source_type, source_id, period_key
      FROM ledger_journal
      WHERE org_id = ? AND source_type = ? AND source_id = ?
      ORDER BY debit_code
    `).all(orgId, "pos_sale_refund", refund.id).map(row => ({ ...row }));
    assert.deepEqual(refundJournals, [
      { debit_code: "524", credit_code: "251", amount: refundedVat, source_type: "pos_sale_refund", source_id: refund.id, period_key: "2026-06" },
      { debit_code: "611", credit_code: "251", amount: refundedSubtotal, source_type: "pos_sale_refund", source_id: refund.id, period_key: "2026-06" }
    ]);
    const refundVat = ledger.vatReport(app.db, orgId, "2026-06");
    assert.equal(refundVat.outputVat, vatAfterSale.outputVat - refundedVat);
    assert.equal(refundVat.netVatPayable, vatAfterSale.netVatPayable - refundedVat);

    const replayed = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/refund`,
      headers: { cookie: operator },
      payload: { ...payload, reason: "Replay should not alter the line refund." }
    });
    assert.equal(replayed.statusCode, 200, replayed.body);
    assert.equal(replayed.json().idempotent, true);
    assert.equal(replayed.json().refund.id, refund.id);
    assert.equal(replayed.json().refund.reason, "Customer returned one scanner from a two-unit sale.");
    assert.equal(replayed.json().refund.lines[0].returnStockMoveId, refund.lines[0].returnStockMoveId);
    assert.equal(stockMoveCount(), beforeMoves + 1);
    assert.equal(quant(), afterSaleQuantity + returnedQuantity);
  } finally {
    await app.close();
  }
});

test("pos: card and bank full refunds record evidence without changing expected cash", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");

    const card = await createPostedPosSale(app, operator, {
      registerCode: "POS-REFUND-CARD",
      openingCash: 30000,
      fiscalDeviceId: "FISCAL-AM-REFUND-CARD",
      receiptNumber: "R-REFUND-CARD-001",
      paymentMethod: "card",
      idempotencyKey: "pos-refund-card-sale-1"
    });
    assert.equal(card.session.expectedCash, 30000);
    const cardRefund = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${card.sale.id}/refund`,
      headers: { cookie: operator },
      payload: {
        idempotencyKey: "pos-refund-card-1",
        refundReference: "RF-CARD-001",
        reason: "Card processor reversal recorded.",
        refundMethod: "card"
      }
    });
    assert.equal(cardRefund.statusCode, 200, cardRefund.body);
    assert.equal(cardRefund.json().refund.refundMethod, "card");
    assert.equal(cardRefund.json().refund.cashAdjustment, 0);
    assert.equal(cardRefund.json().refund.inventoryPostingStatus, "posted");
    assert.equal(cardRefund.json().refund.ledgerPostingStatus, "posted");
    assert.equal(cardRefund.json().refund.postings.ledgerPostingCount, 2);
    assert.match(cardRefund.json().refund.lines[0].returnStockMoveId, /^stockmove-/);
    assert.equal(cardRefund.json().session.expectedCash, 30000);
    const cardRefundJournals = app.db.prepare(`
      SELECT debit_code, credit_code, amount, source_type, source_id, period_key
      FROM ledger_journal
      WHERE org_id = ? AND source_type = ? AND source_id = ?
      ORDER BY debit_code
    `).all("org-armosphera-demo", "pos_sale_refund", cardRefund.json().refund.id).map(row => ({ ...row }));
    assert.deepEqual(cardRefundJournals, [
      { debit_code: "524", credit_code: "255", amount: card.sale.vat, source_type: "pos_sale_refund", source_id: cardRefund.json().refund.id, period_key: "2026-06" },
      { debit_code: "611", credit_code: "255", amount: card.sale.subtotal, source_type: "pos_sale_refund", source_id: cardRefund.json().refund.id, period_key: "2026-06" }
    ]);

    const bank = await createPostedPosSale(app, operator, {
      registerCode: "POS-REFUND-BANK",
      openingCash: 40000,
      fiscalDeviceId: "FISCAL-AM-REFUND-BANK",
      receiptNumber: "R-REFUND-BANK-001",
      paymentMethod: "bank-transfer",
      idempotencyKey: "pos-refund-bank-sale-1"
    });
    assert.equal(bank.session.expectedCash, 40000);
    const bankRefund = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${bank.sale.id}/refund`,
      headers: { cookie: operator },
      payload: {
        idempotencyKey: "pos-refund-bank-1",
        refundReference: "RF-BANK-001",
        reason: "Bank transfer refund reference captured.",
        refundMethod: "bank-transfer"
      }
    });
    assert.equal(bankRefund.statusCode, 200, bankRefund.body);
    assert.equal(bankRefund.json().refund.refundMethod, "bank-transfer");
    assert.equal(bankRefund.json().refund.cashAdjustment, 0);
    assert.equal(bankRefund.json().refund.inventoryPostingStatus, "posted");
    assert.equal(bankRefund.json().refund.ledgerPostingStatus, "posted");
    assert.equal(bankRefund.json().refund.postings.ledgerPostingCount, 2);
    assert.match(bankRefund.json().refund.lines[0].returnStockMoveId, /^stockmove-/);
    assert.equal(bankRefund.json().session.expectedCash, 40000);
    const bankRefundJournals = app.db.prepare(`
      SELECT debit_code, credit_code, amount, source_type, source_id, period_key
      FROM ledger_journal
      WHERE org_id = ? AND source_type = ? AND source_id = ?
      ORDER BY debit_code
    `).all("org-armosphera-demo", "pos_sale_refund", bankRefund.json().refund.id).map(row => ({ ...row }));
    assert.deepEqual(bankRefundJournals, [
      { debit_code: "524", credit_code: "252", amount: bank.sale.vat, source_type: "pos_sale_refund", source_id: bankRefund.json().refund.id, period_key: "2026-06" },
      { debit_code: "611", credit_code: "252", amount: bank.sale.subtotal, source_type: "pos_sale_refund", source_id: bankRefund.json().refund.id, period_key: "2026-06" }
    ]);
  } finally {
    await app.close();
  }
});

test("pos: closed card session records terminal settlement evidence and ledger clearing", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");
    const owner = await login(app);
    const orgId = "org-armosphera-demo";
    const { session, sale } = await createPostedPosSale(app, operator, {
      registerCode: "POS-TERM-SETTLE",
      openingCash: 30000,
      fiscalDeviceId: "FISCAL-AM-TERM-SETTLE",
      receiptNumber: "R-TERM-SETTLE-001",
      paymentMethod: "card",
      idempotencyKey: "pos-terminal-settlement-sale-1"
    });
    assert.equal(session.expectedCash, 30000);

    const openPost = await app.inject({
      method: "POST",
      url: `/api/pos/cash-sessions/${session.id}/terminal-settlements`,
      headers: { cookie: operator },
      payload: {
        idempotencyKey: "pos-terminal-settlement-open",
        settlementReference: "TERM-OPEN-001",
        provider: "Acba POS",
        settledTotal: sale.total
      }
    });
    assert.equal(openPost.statusCode, 409, openPost.body);

    const closed = await app.inject({
      method: "POST",
      url: `/api/pos/cash-sessions/${session.id}/close`,
      headers: { cookie: operator },
      payload: {
        countedCash: 30000,
        fiscalDeviceId: "FISCAL-AM-TERM-SETTLE",
        zReportNumber: "ZR-TERM-SETTLE-001",
        receiptNumberStart: "R-TERM-SETTLE-001",
        receiptNumberEnd: "R-TERM-SETTLE-001",
        closeNote: "Card batch ready for terminal settlement."
      }
    });
    assert.equal(closed.statusCode, 200, closed.body);
    assert.equal(closed.json().session.status, "closed");

    const preview = await app.inject({
      method: "GET",
      url: `/api/pos/cash-sessions/${session.id}/terminal-settlement-preview`,
      headers: { cookie: operator }
    });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().preview.sessionStatus, "closed");
    assert.equal(preview.json().preview.ready, true);
    assert.equal(preview.json().preview.cardSalesTotal, sale.total);
    assert.equal(preview.json().preview.cardSalesCount, 1);
    assert.equal(preview.json().preview.outstandingAmount, sale.total);
    assert.equal(preview.json().preview.processorFeeTotal, 0);
    assert.equal(preview.json().preview.clearedTotal, 0);
    assert.equal(preview.json().preview.processorFeeAccountCode, "711");

    const overCleared = await app.inject({
      method: "POST",
      url: `/api/pos/cash-sessions/${session.id}/terminal-settlements`,
      headers: { cookie: operator },
      payload: {
        idempotencyKey: "pos-terminal-settlement-over-clear",
        settlementReference: "TERM-OVER-001",
        provider: "Acba POS",
        settledTotal: sale.total,
        processorFee: 1
      }
    });
    assert.equal(overCleared.statusCode, 400, overCleared.body);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM pos_terminal_settlements WHERE org_id = ? AND cash_session_id = ?").get(orgId, session.id).count, 0);

    const beforeAudit = app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM audit_events
      WHERE org_id = ? AND type = ?
    `).get(orgId, "pos.terminal_settlement.posted").count;
    const settledAmount = sale.total - 5000;
    const settled = await app.inject({
      method: "POST",
      url: `/api/pos/cash-sessions/${session.id}/terminal-settlements`,
      headers: { cookie: operator },
      payload: {
        idempotencyKey: "pos-terminal-settlement-1",
        settlementReference: "term-batch-001",
        provider: "Acba POS",
        settledTotal: settledAmount,
        processorFee: 5000,
        settledAt: "2026-06-22T19:00:00.000Z",
        note: "Terminal deposit includes processor fee evidence."
      }
    });
    assert.equal(settled.statusCode, 200, settled.body);
    const body = settled.json();
    assert.equal(body.ok, true);
    assert.equal(body.idempotent, false);
    assert.equal(body.preview.outstandingAmount, 0);
    assert.equal(body.preview.processorFeeTotal, 5000);
    assert.equal(body.preview.clearedTotal, sale.total);
    assert.equal(body.preview.ready, false);
    assert.equal(body.settlement.cashSessionId, session.id);
    assert.equal(body.settlement.settlementReference, "TERM-BATCH-001");
    assert.equal(body.settlement.provider, "Acba POS");
    assert.equal(body.settlement.expectedTotal, sale.total);
    assert.equal(body.settlement.settledTotal, settledAmount);
    assert.equal(body.settlement.processorFee, 5000);
    assert.equal(body.settlement.processorFeeAccountCode, "711");
    assert.equal(body.settlement.clearedTotal, sale.total);
    assert.equal(body.settlement.outstandingAfterSettledAndFee, 0);
    assert.equal(body.settlement.difference, 0);
    assert.equal(body.settlement.clearingAccountCode, "255");
    assert.equal(body.settlement.bankAccountCode, "252");
    assert.equal(body.settlement.ledgerPostingStatus, "posted");
    assert.equal(body.settlement.postings.ledgerPostingCount, 2);
    assert.equal(body.settlement.postings.processorFeeLedgerPostingCount, 1);
    assert.equal(body.settlement.settledAt, "2026-06-22T19:00:00.000Z");
    assert.equal(app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM audit_events
      WHERE org_id = ? AND type = ?
    `).get(orgId, "pos.terminal_settlement.posted").count, beforeAudit + 1);

    const settlementJournals = app.db.prepare(`
      SELECT debit_code, credit_code, amount, source_type, source_id, period_key
      FROM ledger_journal
      WHERE org_id = ? AND source_type = ? AND source_id = ?
      ORDER BY debit_code
    `).all(orgId, "pos_terminal_settlement", body.settlement.id).map(row => ({ ...row }));
    assert.deepEqual(settlementJournals, [
      {
        debit_code: "252",
        credit_code: "255",
        amount: settledAmount,
        source_type: "pos_terminal_settlement",
        source_id: body.settlement.id,
        period_key: "2026-06"
      },
      {
        debit_code: "711",
        credit_code: "255",
        amount: 5000,
        source_type: "pos_terminal_settlement",
        source_id: body.settlement.id,
        period_key: "2026-06"
      }
    ]);

    const replayed = await app.inject({
      method: "POST",
      url: `/api/pos/cash-sessions/${session.id}/terminal-settlements`,
      headers: { cookie: operator },
      payload: {
        idempotencyKey: "pos-terminal-settlement-1",
        settlementReference: "TERM-BATCH-001",
        provider: "Replay should not alter provider.",
        settledTotal: settledAmount
      }
    });
    assert.equal(replayed.statusCode, 200, replayed.body);
    assert.equal(replayed.json().idempotent, true);
    assert.equal(replayed.json().settlement.id, body.settlement.id);
    assert.equal(replayed.json().settlement.provider, "Acba POS");
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM pos_terminal_settlements WHERE org_id = ? AND cash_session_id = ?").get(orgId, session.id).count, 1);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM ledger_journal WHERE org_id = ? AND source_type = ? AND source_id = ?").get(orgId, "pos_terminal_settlement", body.settlement.id).count, 2);

    const backup = await app.inject({
      method: "POST",
      url: "/api/admin/backups",
      headers: { cookie: owner },
      payload: { note: "POS terminal settlement evidence must be restorable." }
    });
    assert.equal(backup.statusCode, 200, backup.body);
    const tables = backup.json().backup.payload.tables;
    assert.ok(tables.pos_terminal_settlements.some(row => (
      row.id === body.settlement.id
      && row.cash_session_id === session.id
      && row.settlement_reference === "TERM-BATCH-001"
      && row.expected_total_amd === sale.total
      && row.settled_total_amd === settledAmount
      && row.processor_fee_amd === 5000
      && row.difference_amd === 0
      && row.fee_account_code === "711"
      && row.ledger_posting_status === "posted"
    )));
    assert.ok(tables.ledger_journal.some(row => (
      row.source_type === "pos_terminal_settlement"
      && row.source_id === body.settlement.id
      && row.debit_code === "252"
      && row.credit_code === "255"
      && row.amount === settledAmount
    )));
    assert.ok(tables.ledger_journal.some(row => (
      row.source_type === "pos_terminal_settlement"
      && row.source_id === body.settlement.id
      && row.debit_code === "711"
      && row.credit_code === "255"
      && row.amount === 5000
    )));
  } finally {
    await app.close();
  }
});

test("pos: closed cash-session cash refund is rejected for this first slice", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");
    const orgId = "org-armosphera-demo";
    const { session, sale } = await createPostedPosSale(app, operator, {
      registerCode: "POS-REFUND-CLOSED",
      openingCash: 15000,
      fiscalDeviceId: "FISCAL-AM-REFUND-CLOSED",
      receiptNumber: "R-REFUND-CLOSED-001",
      idempotencyKey: "pos-refund-closed-sale-1"
    });
    const closed = await app.inject({
      method: "POST",
      url: `/api/pos/cash-sessions/${session.id}/close`,
      headers: { cookie: operator },
      payload: {
        countedCash: session.expectedCash,
        fiscalDeviceId: "FISCAL-AM-REFUND-CLOSED",
        zReportNumber: "Z-REFUND-CLOSED-001",
        receiptNumberStart: "R-REFUND-CLOSED-001",
        receiptNumberEnd: "R-REFUND-CLOSED-001"
      }
    });
    assert.equal(closed.statusCode, 200, closed.body);

    const rejected = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${sale.id}/refund`,
      headers: { cookie: operator },
      payload: {
        idempotencyKey: "pos-refund-closed-1",
        refundReference: "RF-CLOSED-001",
        reason: "Cash refunds after Z-close wait for the next slice.",
        refundMethod: "cash"
      }
    });
    assert.equal(rejected.statusCode, 409, rejected.body);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM pos_sale_refunds WHERE org_id = ? AND sale_id = ?").get(orgId, sale.id).count, 0);
    assert.equal(app.db.prepare("SELECT status FROM pos_sales WHERE org_id = ? AND id = ?").get(orgId, sale.id).status, "posted");
  } finally {
    await app.close();
  }
});

test("pos: refund rejects malformed ids, unsafe bodies, missing sales, and non-posted sales", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local");
    const orgId = "org-armosphera-demo";
    const validPayload = {
      idempotencyKey: "pos-refund-valid-missing",
      refundReference: "RF-MISSING-001",
      reason: "Validated missing-sale rejection.",
      refundMethod: "card"
    };

    const badId = await app.inject({
      method: "POST",
      url: "/api/pos/sales/POS-SALE-BAD/refund",
      headers: { cookie: operator },
      payload: validPayload
    });
    assert.equal(badId.statusCode, 400, badId.body);

    const badBody = await app.inject({
      method: "POST",
      url: "/api/pos/sales/pos-sale-missing/refund",
      headers: { cookie: operator },
      payload: []
    });
    assert.equal(badBody.statusCode, 400, badBody.body);

    const missingFields = await app.inject({
      method: "POST",
      url: "/api/pos/sales/pos-sale-missing/refund",
      headers: { cookie: operator },
      payload: { refundReference: "RF-MISSING-FIELDS", reason: "Missing idempotency key.", refundMethod: "card" }
    });
    assert.equal(missingFields.statusCode, 400, missingFields.body);

    const lineSale = await createPostedPosSale(app, operator, {
      registerCode: "POS-REFUND-LINE-VALIDATION",
      receiptNumber: "R-REFUND-LINE-VALIDATION",
      idempotencyKey: "pos-refund-line-validation-sale",
      lines: [{ catalogItemId: "catitem-pos-barcode-scanner", quantity: 2 }]
    });
    const linePayload = {
      idempotencyKey: "pos-refund-line-validation",
      refundReference: "RF-LINE-VALIDATION",
      reason: "Validate line-level refund guards.",
      refundMethod: "card"
    };
    const duplicateLine = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${lineSale.sale.id}/refund`,
      headers: { cookie: operator },
      payload: {
        ...linePayload,
        lines: [
          { saleLineId: lineSale.sale.lines[0].id, quantity: 1 },
          { saleLineId: lineSale.sale.lines[0].id, quantity: 1 }
        ]
      }
    });
    assert.equal(duplicateLine.statusCode, 400, duplicateLine.body);

    const unknownLine = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${lineSale.sale.id}/refund`,
      headers: { cookie: operator },
      payload: {
        ...linePayload,
        idempotencyKey: "pos-refund-line-validation-unknown",
        lines: [{ saleLineId: "pos-sale-line-missing", quantity: 1 }]
      }
    });
    assert.equal(unknownLine.statusCode, 400, unknownLine.body);

    const overQuantity = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${lineSale.sale.id}/refund`,
      headers: { cookie: operator },
      payload: {
        ...linePayload,
        idempotencyKey: "pos-refund-line-validation-over",
        lines: [{ saleLineId: lineSale.sale.lines[0].id, quantity: lineSale.sale.lines[0].quantity + 1 }]
      }
    });
    assert.equal(overQuantity.statusCode, 400, overQuantity.body);

    const mismatchedTotal = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${lineSale.sale.id}/refund`,
      headers: { cookie: operator },
      payload: {
        ...linePayload,
        idempotencyKey: "pos-refund-line-validation-total",
        refundedTotal: Math.round(lineSale.sale.lines[0].total / 2) - 1,
        lines: [{ saleLineId: lineSale.sale.lines[0].id, quantity: 1 }]
      }
    });
    assert.equal(mismatchedTotal.statusCode, 400, mismatchedTotal.body);

    const nonRestockable = await createPostedPosSale(app, operator, {
      registerCode: "POS-REFUND-LINE-NONRESTOCK",
      receiptNumber: "R-REFUND-LINE-NONRESTOCK",
      idempotencyKey: "pos-refund-line-nonrestock-sale"
    });
    app.db.prepare("UPDATE pos_sale_lines SET stock_move_id = NULL WHERE org_id = ? AND id = ?")
      .run(orgId, nonRestockable.sale.lines[0].id);
    const missingStockMove = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${nonRestockable.sale.id}/refund`,
      headers: { cookie: operator },
      payload: {
        ...linePayload,
        idempotencyKey: "pos-refund-line-validation-nonrestock",
        refundReference: "RF-LINE-NONRESTOCK",
        lines: [{ saleLineId: nonRestockable.sale.lines[0].id, quantity: 1 }]
      }
    });
    assert.equal(missingStockMove.statusCode, 409, missingStockMove.body);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM pos_sale_refunds WHERE org_id = ? AND sale_id = ?").get(orgId, lineSale.sale.id).count, 0);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM pos_sale_refunds WHERE org_id = ? AND sale_id = ?").get(orgId, nonRestockable.sale.id).count, 0);

    const missingSale = await app.inject({
      method: "POST",
      url: "/api/pos/sales/pos-sale-missing/refund",
      headers: { cookie: operator },
      payload: validPayload
    });
    assert.equal(missingSale.statusCode, 404, missingSale.body);

    const unposted = await createPostedPosSale(app, operator, {
      registerCode: "POS-REFUND-UNPOSTED",
      receiptNumber: "R-REFUND-UNPOSTED",
      idempotencyKey: "pos-refund-unposted-sale"
    });
    app.db.prepare("UPDATE pos_sales SET status = 'draft' WHERE org_id = ? AND id = ?")
      .run(orgId, unposted.sale.id);
    const notPosted = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${unposted.sale.id}/refund`,
      headers: { cookie: operator },
      payload: {
        idempotencyKey: "pos-refund-unposted-1",
        refundReference: "RF-UNPOSTED-001",
        reason: "Draft sales cannot be refunded.",
        refundMethod: "card"
      }
    });
    assert.equal(notPosted.statusCode, 409, notPosted.body);

    const voided = await createPostedPosSale(app, operator, {
      registerCode: "POS-REFUND-VOIDED",
      receiptNumber: "R-REFUND-VOIDED",
      idempotencyKey: "pos-refund-voided-sale"
    });
    app.db.prepare("UPDATE pos_sales SET status = 'voided' WHERE org_id = ? AND id = ?")
      .run(orgId, voided.sale.id);
    const alreadyVoided = await app.inject({
      method: "POST",
      url: `/api/pos/sales/${voided.sale.id}/refund`,
      headers: { cookie: operator },
      payload: {
        idempotencyKey: "pos-refund-voided-1",
        refundReference: "RF-VOIDED-001",
        reason: "Voided sales cannot be refunded again.",
        refundMethod: "card"
      }
    });
    assert.equal(alreadyVoided.statusCode, 409, alreadyVoided.body);
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
