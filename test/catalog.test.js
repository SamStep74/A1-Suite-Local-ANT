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

test("catalog: seeded product spine is auth-gated and role scoped", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();

    const unauthenticated = await app.inject({ method: "GET", url: "/api/catalog/items" });
    assert.equal(unauthenticated.statusCode, 401);

    const owner = await login(app);
    const listed = await app.inject({ method: "GET", url: "/api/catalog/items", headers: { cookie: owner } });
    assert.equal(listed.statusCode, 200, listed.body);
    const body = listed.json();
    assert.ok(body.categories.some(category => category.id === "catcat-tourism-packages"));
    assert.ok(body.items.length >= 4, "seeded catalog items present");

    const tourismPackage = body.items.find(item => item.id === "catitem-tourism-booking-workflow");
    assert.ok(tourismPackage, "tourism catalog package is seeded");
    assert.equal(tourismPackage.categoryName, "Tourism packages");
    assert.equal(tourismPackage.currency, "AMD");
    assert.equal(tourismPackage.vatMode, "standard");
    assert.equal(tourismPackage.fiscalReceiptRequired, true);
    assert.equal(tourismPackage.trackStock, false);

    const scanner = body.items.find(item => item.id === "catitem-pos-barcode-scanner");
    assert.equal(scanner.itemType, "stockable");
    assert.equal(scanner.trackStock, true);
    assert.equal(scanner.standardCost, 62000);

    const support = await login(app, "support@armosphera.local");
    const supportDenied = await app.inject({ method: "GET", url: "/api/catalog/items", headers: { cookie: support } });
    assert.equal(supportDenied.statusCode, 403);

    const accountant = await login(app, "accountant@armosphera.local");
    const accountantList = await app.inject({ method: "GET", url: "/api/catalog/items?itemType=service", headers: { cookie: accountant } });
    assert.equal(accountantList.statusCode, 200, accountantList.body);
    assert.ok(accountantList.json().items.every(item => item.itemType === "service"));

    const accountantCreate = await app.inject({
      method: "POST",
      url: "/api/catalog/items",
      headers: { cookie: accountant },
      payload: {
        sku: "A1-ACCOUNTANT-DENIED",
        categoryId: "catcat-service-packages",
        name: "Accountant denied catalog write",
        listPrice: 1000
      }
    });
    assert.equal(accountantCreate.statusCode, 403);

    const backup = await app.inject({
      method: "POST",
      url: "/api/admin/backups",
      headers: { cookie: owner },
      payload: { note: "Catalog master data must be included in tenant backup scope." }
    });
    assert.equal(backup.statusCode, 200, backup.body);
    assert.ok(Array.isArray(backup.json().backup.payload.tables.catalog_items));
    assert.ok(backup.json().backup.payload.tables.catalog_items.some(item => item.id === "catitem-tourism-booking-workflow"));
    assert.ok(Array.isArray(backup.json().backup.payload.tables.catalog_categories));
  } finally {
    await app.close();
  }
});

test("catalog: create and update guard product master metadata", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const orgId = "org-armosphera-demo";
    const counts = () => ({
      items: app.db.prepare("SELECT COUNT(*) AS count FROM catalog_items WHERE org_id = ?").get(orgId).count,
      audits: app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type LIKE 'catalog.item.%'").get(orgId).count,
      events: app.db.prepare("SELECT COUNT(*) AS count FROM suite_events WHERE org_id = ? AND event_type LIKE 'catalog.item.%'").get(orgId).count
    });
    const expectRejected = async (method, url, payload, statusCode = 400) => {
      const response = await app.inject({ method, url, headers: { cookie: owner }, payload });
      assert.equal(response.statusCode, statusCode, response.body);
      assert.doesNotMatch(response.body, /secret-catalog-/);
    };

    const beforeRejects = counts();
    for (const payload of [
      ["secret-catalog-array-body-token"],
      { sku: { value: "A1-OBJECT-SKU", token: "secret-catalog-object-sku-token" }, categoryId: "catcat-service-packages", name: "Valid service item", listPrice: 1000 },
      { sku: "A1-CONTROL-NAME", categoryId: "catcat-service-packages", name: "Bad\nsecret-catalog-control-name-token", listPrice: 1000 },
      { sku: "A1-BAD-TYPE", categoryId: "catcat-service-packages", name: "Valid service item", itemType: "ghost-secret-catalog-type-token", listPrice: 1000 },
      { sku: "A1-BAD-PRICE", categoryId: "catcat-service-packages", name: "Valid service item", listPrice: { amount: 1000, token: "secret-catalog-price-object-token" } },
      { sku: "A1-BAD-PRICE-CONTROL", categoryId: "catcat-service-packages", name: "Valid service item", listPrice: "1000\n" },
      { sku: "A1-BAD-COST", categoryId: "catcat-service-packages", name: "Valid service item", listPrice: 1000, standardCost: 2000 },
      { sku: "A1-BAD-STOCK", categoryId: "catcat-service-packages", name: "Valid service item", itemType: "service", listPrice: 1000, trackStock: true },
      { sku: "A1-BAD-CURRENCY", categoryId: "catcat-service-packages", name: "Valid service item", listPrice: 1000, currency: "USD" }
    ]) {
      await expectRejected("POST", "/api/catalog/items", payload);
    }
    assert.deepEqual(counts(), beforeRejects);

    await expectRejected("POST", "/api/catalog/items", {
      sku: "A1-MISSING-CATEGORY",
      categoryId: "catcat-missing",
      name: "Missing category item",
      listPrice: 1000
    }, 404);
    assert.deepEqual(counts(), beforeRejects);

    const created = await app.inject({
      method: "POST",
      url: "/api/catalog/items",
      headers: { cookie: owner },
      payload: {
        sku: "hw-label-printer-01",
        categoryId: "catcat-hardware",
        name: "Yerevan retail label printer",
        description: "Stock-tracked hardware for future POS and warehouse flows.",
        itemType: "stockable",
        unitOfMeasure: "unit",
        listPrice: 120000,
        standardCost: "90000",
        trackStock: true,
        trackLots: true,
        fiscalReceiptRequired: true
      }
    });
    assert.equal(created.statusCode, 200, created.body);
    const item = created.json().item;
    assert.match(item.id, /^catitem-/);
    assert.equal(item.sku, "HW-LABEL-PRINTER-01");
    assert.equal(item.categoryName, "POS and device hardware");
    assert.equal(item.trackStock, true);
    assert.equal(item.trackLots, true);
    assert.equal(counts().items, beforeRejects.items + 1);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/catalog/items",
      headers: { cookie: owner },
      payload: {
        sku: "HW-LABEL-PRINTER-01",
        categoryId: "catcat-hardware",
        name: "Duplicate SKU",
        itemType: "stockable",
        listPrice: 120000,
        standardCost: 90000,
        trackStock: true
      }
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    assert.equal(counts().items, beforeRejects.items + 1);

    const badPath = await app.inject({
      method: "PATCH",
      url: "/api/catalog/items/bad%2Fid",
      headers: { cookie: owner },
      payload: { status: "archived" }
    });
    assert.equal(badPath.statusCode, 400, badPath.body);
    assert.match(badPath.body, /Invalid catalog item id/);

    const beforePatchRejects = counts();
    for (const payload of [
      ["secret-catalog-patch-array-token"],
      { name: { value: "Renamed", token: "secret-catalog-patch-name-object-token" } },
      { standardCost: 130000 },
      { trackStock: false },
      { status: "ghost-secret-catalog-patch-status-token" }
    ]) {
      await expectRejected("PATCH", `/api/catalog/items/${item.id}`, payload);
    }
    assert.deepEqual(counts(), beforePatchRejects);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/catalog/items/${item.id}`,
      headers: { cookie: owner },
      payload: {
        status: "archived",
        listPrice: 130000,
        standardCost: 95000,
        trackLots: false
      }
    });
    assert.equal(patched.statusCode, 200, patched.body);
    assert.equal(patched.json().item.status, "archived");
    assert.equal(patched.json().item.listPrice, 130000);
    assert.equal(patched.json().item.trackStock, true);
    assert.equal(patched.json().item.trackLots, false);

    const searched = await app.inject({
      method: "GET",
      url: "/api/catalog/items?q=LABEL-PRINTER&status=archived",
      headers: { cookie: owner }
    });
    assert.equal(searched.statusCode, 200, searched.body);
    assert.ok(searched.json().items.some(row => row.id === item.id));

    const auditRows = app.db.prepare("SELECT type, details FROM audit_events WHERE org_id = ? AND type LIKE 'catalog.item.%' ORDER BY id").all(orgId);
    assert.ok(auditRows.some(row => row.type === "catalog.item.created" && row.details.includes(item.id)));
    assert.ok(auditRows.some(row => row.type === "catalog.item.updated" && row.details.includes(item.id)));
  } finally {
    await app.close();
  }
});

test("catalog: quote lines resolve active product metadata", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);

    const createdQuote = await app.inject({
      method: "POST",
      url: "/api/crm/quotes",
      headers: { cookie: owner },
      payload: {
        customerId: "cust-ani",
        dealId: "deal-ani-inbox",
        title: "Catalog-backed salon package",
        validUntil: "2026-07-31",
        lines: [
          { catalogItemId: "catitem-salon-inbox-package", quantity: 2 }
        ]
      }
    });
    assert.equal(createdQuote.statusCode, 200, createdQuote.body);
    const line = createdQuote.json().quote.lines[0];
    assert.equal(line.catalogItemId, "catitem-salon-inbox-package");
    assert.equal(line.catalogSku, "A1-SALON-INBOX");
    assert.equal(line.catalogName, "Instagram and WhatsApp inbox setup");
    assert.equal(line.description, "Instagram and WhatsApp inbox setup");
    assert.equal(line.unitPrice, 950000);
    assert.equal(line.total, 1900000);
    assert.equal(line.vatMode, "standard");
    assert.equal(line.fiscalReceiptRequired, true);

    const archived = await app.inject({
      method: "PATCH",
      url: "/api/catalog/items/catitem-salon-inbox-package",
      headers: { cookie: owner },
      payload: { status: "archived" }
    });
    assert.equal(archived.statusCode, 200, archived.body);

    const inactiveQuote = await app.inject({
      method: "POST",
      url: "/api/crm/quotes",
      headers: { cookie: owner },
      payload: {
        customerId: "cust-ani",
        dealId: "deal-ani-inbox",
        title: "Inactive catalog item quote",
        validUntil: "2026-08-31",
        lines: [
          { catalogItemId: "catitem-salon-inbox-package", quantity: 1 }
        ]
      }
    });
    assert.equal(inactiveQuote.statusCode, 422, inactiveQuote.body);
    assert.match(inactiveQuote.body, /Catalog item is required for quote line/);
  } finally {
    await app.close();
  }
});

test("catalog: CRM quote lines can reference active catalog items", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const sales = await login(app, "sales@armosphera.local");
    const orgId = "org-armosphera-demo";
    const counts = () => ({
      quotes: app.db.prepare("SELECT COUNT(*) AS count FROM quotes WHERE org_id = ?").get(orgId).count,
      quoteLines: app.db.prepare("SELECT COUNT(*) AS count FROM quote_lines WHERE org_id = ?").get(orgId).count,
      audits: app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type = ?").get(orgId, "crm.quote.created").count
    });

    const before = counts();
    const created = await app.inject({
      method: "POST",
      url: "/api/crm/quotes",
      headers: { cookie: sales },
      payload: {
        customerId: "cust-van",
        dealId: "deal-van-season",
        title: "Catalog-backed tourism quote",
        validUntil: "2026-06-30",
        lines: [
          { catalogItemId: "catitem-tourism-booking-workflow", quantity: 1 }
        ]
      }
    });
    assert.equal(created.statusCode, 200, created.body);
    const quote = created.json().quote;
    assert.equal(quote.total, 720000);
    assert.equal(quote.lines.length, 1);
    assert.equal(quote.lines[0].catalogItemId, "catitem-tourism-booking-workflow");
    assert.equal(quote.lines[0].catalogSku, "A1-TOUR-BOOKING");
    assert.equal(quote.lines[0].description, "Seasonal booking workflow package");
    assert.equal(quote.lines[0].unitPrice, 720000);
    assert.equal(quote.lines[0].vatMode, "standard");
    assert.equal(quote.lines[0].fiscalReceiptRequired, true);

    const storedLine = app.db.prepare(`
      SELECT catalog_item_id AS catalogItemId, vat_mode AS vatMode, fiscal_receipt_required AS fiscalReceiptRequired
      FROM quote_lines
      WHERE org_id = ? AND quote_id = ?
    `).get(orgId, quote.id);
    assert.equal(storedLine.catalogItemId, "catitem-tourism-booking-workflow");
    assert.equal(storedLine.vatMode, "standard");
    assert.equal(storedLine.fiscalReceiptRequired, 1);

    const beforeRejects = counts();
    const missing = await app.inject({
      method: "POST",
      url: "/api/crm/quotes",
      headers: { cookie: sales },
      payload: {
        customerId: "cust-van",
        dealId: "deal-van-season",
        title: "Missing catalog item quote",
        validUntil: "2026-06-30",
        lines: [{ catalogItemId: "catitem-missing", quantity: 1 }]
      }
    });
    assert.equal(missing.statusCode, 422, missing.body);
    assert.deepEqual(counts(), beforeRejects);

    const malformed = await app.inject({
      method: "POST",
      url: "/api/crm/quotes",
      headers: { cookie: sales },
      payload: {
        customerId: "cust-van",
        dealId: "deal-van-season",
        title: "Malformed catalog item quote",
        validUntil: "2026-06-30",
        lines: [{ catalogItemId: "catitem-tourism-booking-workflow\nsecret-catalog-quote-line-token", quantity: 1 }]
      }
    });
    assert.equal(malformed.statusCode, 400, malformed.body);
    assert.doesNotMatch(malformed.body, /secret-catalog-quote-line-token/);
    assert.deepEqual(counts(), beforeRejects);
    assert.equal(counts().quotes, before.quotes + 1);
  } finally {
    await app.close();
  }
});

test("catalog: quote totals respect catalog VAT modes", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);

    const exemptItem = await app.inject({
      method: "POST",
      url: "/api/catalog/items",
      headers: { cookie: owner },
      payload: {
        sku: "A1-EXEMPT-CONSULT",
        categoryId: "catcat-service-packages",
        name: "VAT exempt advisory package",
        itemType: "service",
        listPrice: 120000,
        vatMode: "exempt",
        fiscalReceiptRequired: false
      }
    });
    assert.equal(exemptItem.statusCode, 200, exemptItem.body);

    const quoteResponse = await app.inject({
      method: "POST",
      url: "/api/crm/quotes",
      headers: { cookie: owner },
      payload: {
        customerId: "cust-van",
        dealId: "deal-van-season",
        title: "Mixed VAT catalog quote",
        validUntil: "2026-07-31",
        lines: [
          { catalogItemId: "catitem-tourism-booking-workflow", quantity: 1 },
          { catalogItemId: exemptItem.json().item.id, quantity: 1 }
        ]
      }
    });
    assert.equal(quoteResponse.statusCode, 200, quoteResponse.body);
    const quote = quoteResponse.json().quote;
    assert.equal(quote.total, 840000);
    assert.equal(quote.subtotal, 720000);
    assert.equal(quote.vat, 120000);
    assert.equal(quote.lines[0].vatMode, "standard");
    assert.equal(quote.lines[1].vatMode, "exempt");
    assert.equal(quote.lines[1].fiscalReceiptRequired, false);
  } finally {
    await app.close();
  }
});
