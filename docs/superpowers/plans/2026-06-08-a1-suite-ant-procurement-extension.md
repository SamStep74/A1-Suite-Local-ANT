# Sub-Plan 3: Procurement Extension (Закупки) — User Priority #3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shipped Purchase spine (RFQ/PO/partial receipts/supplier returns/Vendor 360) with: purchase requisitions, RFQ distribution, AI-assisted supplier selection, price analysis (history + market reference), overspend warnings, blanket orders, landed costs (freight/duty/insurance), billed-return credit notes, and replenishment analytics.

**Architecture:** Pattern A module `server/procurement.js` (pure engine: requisition → RFQ, supplier scoring, price anomaly detection, landed cost allocation, blanket-order coverage check) + `web/src/procurement.jsx` extension panel (Requisitions / RFQ / Blanket Orders / Landed Costs / Billed Returns tabs) + `test/procurement-extension.test.js`. Reuses the existing `purchase_orders`, `purchase_order_lines`, `purchase_vendors`, `purchase_vendor_prices` tables. New tables: `purchase_requisitions`, `purchase_requisition_lines`, `rfq_requests`, `rfq_request_vendors`, `rfq_quotes`, `blanket_orders`, `landed_cost_allocations`, `purchase_credit_notes`.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. Local AI helper for supplier selection / price analysis (deterministic fallback). Armenian fiscal handling: landed cost is split into base cost, freight, insurance, duty; allocated to PO lines by quantity or value, and posted to stock valuation + expense accounts. Reuses the Pattern A skeleton (sub-plan 0) for route + audit + idempotency contracts.

**Depends on:** sub-plan 0 (Pattern A skeleton). Extends existing Purchase backend (no rewrite).

---

## File Structure

- Create: `server/procurement.js` — pure engine: `createRequisition`, `convertRequisitionToRfq`, `scoreVendors`, `recordQuote`, `awardRfq`, `createBlanketOrder`, `checkBlanketCoverage`, `allocateLandedCost`, `issueCreditNote`, `computeReplenishment`, `detectPriceAnomaly`, `selectVendor` (AI helper).
- Modify: `server/db.js` — add eight new tables (`purchase_requisitions`, `purchase_requisition_lines`, `rfq_requests`, `rfq_request_vendors`, `rfq_quotes`, `blanket_orders`, `landed_cost_allocations`, `purchase_credit_notes`) inside the `ensureTables` block, after the existing `purchase_returns` block.
- Modify: `server/app.js` — register 11 routes after the existing `/api/purchase/*` block (line ~545).
- Create: `web/src/procurement.jsx` — extension panel exporting `ProcurementExtensionPanel` with 5 tabs (Requisitions / RFQ / Blanket Orders / Landed Costs / Billed Returns) and Armenian-first labels.
- Modify: `web/src/main.jsx` — import + mount the panel; add loader functions for the 11 endpoints.
- Modify: `web/src/locale.js` — add procurement-extension i18n keys under `procurement.*`.
- Create: `test/procurement-extension.test.js` — `node --test` contract suite covering all 11 mutation routes (auth, app-access, validation, happy path, audit, idempotency, period-lock for credit notes).

## DB additions

```sql
CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requester_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL,                    -- draft, open, rfq, awarded, cancelled
  needed_by TEXT NOT NULL,                 -- YYYY-MM-DD
  justification TEXT NOT NULL DEFAULT '',
  rfq_id TEXT,                             -- populated when converted
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_status
  ON purchase_requisitions(org_id, status, needed_by);

CREATE TABLE IF NOT EXISTS purchase_requisition_lines (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requisition_id TEXT NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  catalog_item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL,
  uom TEXT NOT NULL DEFAULT 'հատ',
  est_unit_price INTEGER NOT NULL DEFAULT 0,
  suggested_vendor_id TEXT REFERENCES purchase_vendors(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_requisition_lines_req
  ON purchase_requisition_lines(org_id, requisition_id);

CREATE TABLE IF NOT EXISTS rfq_requests (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requisition_id TEXT REFERENCES purchase_requisitions(id) ON DELETE SET NULL,
  sent_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL,                    -- open, awarded, closed, cancelled
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rfq_requests_status
  ON rfq_requests(org_id, status, due_at);

CREATE TABLE IF NOT EXISTS rfq_request_vendors (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rfq_id TEXT NOT NULL REFERENCES rfq_requests(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES purchase_vendors(id) ON DELETE CASCADE,
  sent_at TEXT NOT NULL,
  responded_at TEXT,
  UNIQUE(org_id, rfq_id, vendor_id)
);
CREATE INDEX IF NOT EXISTS idx_rfq_request_vendors_rfq
  ON rfq_request_vendors(org_id, rfq_id);

CREATE TABLE IF NOT EXISTS rfq_quotes (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rfq_id TEXT NOT NULL REFERENCES rfq_requests(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES purchase_vendors(id) ON DELETE CASCADE,
  requisition_line_id TEXT NOT NULL REFERENCES purchase_requisition_lines(id) ON DELETE CASCADE,
  unit_price INTEGER NOT NULL,
  currency TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  payment_terms TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rfq_quotes_rfq
  ON rfq_quotes(org_id, rfq_id, vendor_id);

CREATE TABLE IF NOT EXISTS blanket_orders (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES purchase_vendors(id) ON DELETE CASCADE,
  catalog_item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  committed_qty INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  currency TEXT NOT NULL,
  uom TEXT NOT NULL DEFAULT 'հատ',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blanket_orders_item
  ON blanket_orders(org_id, catalog_item_id, vendor_id, end_date);

CREATE TABLE IF NOT EXISTS landed_cost_allocations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                      -- freight, insurance, duty, other
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  fx_rate REAL NOT NULL DEFAULT 1,
  allocation_method TEXT NOT NULL,         -- quantity, value
  base_total INTEGER NOT NULL,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_landed_cost_allocations_po
  ON landed_cost_allocations(org_id, po_id);

CREATE TABLE IF NOT EXISTS purchase_credit_notes (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  bill_id TEXT REFERENCES bills(id) ON DELETE SET NULL,
  return_id TEXT REFERENCES purchase_returns(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,                    -- draft, posted, voided
  posted_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_credit_notes_po
  ON purchase_credit_notes(org_id, po_id, status);
```

## API surface

| Method | Path | Purpose | Auth | App |
|---|---|---|---|---|
| POST | `/api/procurement/requisitions` | Create PR | session | `purchase` |
| POST | `/api/procurement/requisitions/:id/convert-to-rfq` | Convert PR to RFQ (top vendors) | session | `purchase` |
| POST | `/api/procurement/rfqs/:id/quotes` | Vendor submits a quote | session | `purchase` |
| POST | `/api/procurement/rfqs/:id/award` | Award RFQ → draft PO | session | `purchase` |
| POST | `/api/procurement/blanket-orders` | Create blanket order | session | `purchase` |
| GET | `/api/procurement/blanket-orders/coverage?productId=...` | Coverage check | session | `purchase` |
| POST | `/api/procurement/landed-costs` | Allocate landed cost | session | `purchase` |
| POST | `/api/procurement/credit-notes` | Issue credit note (period-lock) | session | `purchase` |
| POST | `/api/procurement/ai/select-vendor` | AI vendor selection | session | `purchase` |
| POST | `/api/procurement/ai/price-anomaly` | AI price anomaly | session | `purchase` |
| GET | `/api/procurement/analytics/replenishment` | Replenishment suggestions | session | `purchase` |

## Tasks (high level)

1. **Tests (RED)** — `test/procurement-extension.test.js`: requisition → RFQ → quote → award flow, blanket-order coverage, landed cost allocation correctness, credit-note AP reversal, overspend warning, idempotency, period-lock on credit notes.
2. **Pure engine** — `server/procurement.js`: `createRequisition`, `convertRequisitionToRfq`, `scoreVendors`, `recordQuote`, `awardRfq`, `createBlanketOrder`, `checkBlanketCoverage`, `allocateLandedCost`, `issueCreditNote`, `computeReplenishment`, `detectPriceAnomaly`, `selectVendor`.
3. **DB migration** — add the eight tables in `server/db.js` (right after `purchase_returns`).
4. **Routes** — register the 11 routes in `server/app.js` after `/api/purchase/orders/:id/bill`.
5. **React extension panel** — `web/src/procurement.jsx`: 5 tabs (Requisitions / RFQ / Blanket Orders / Landed Costs / Billed Returns).
6. **AI hooks + analytics** — local deterministic `selectVendor` + `detectPriceAnomaly` + replenishment endpoint.
7. **Handoff + tag** — `procurement-extension-mvp`.

## Acceptance

- A requisition converts to an RFQ, multiple vendors respond, the system scores them, and the award creates a draft PO.
- Landed costs (freight + duty + insurance) are allocated to PO lines and update stock valuation.
- A blanket order's committed qty is visible against open POs.
- A billed return issues a credit note that reverses the AP posting.
- Replenishment analytics suggests POs based on lead time + open demand.
- All 11 mutation routes have tests proving 401/403/400/200/audit/idempotency (period-lock on credit notes).

## Spine reused

`org_id`, `purchase_vendors`, `purchase_vendor_prices`, `purchase_orders`, `purchase_order_lines`, `purchase_returns`, `products` (via `catalog_items`), `stock_quants` (via `stock_moves`), `audit_events`, `period_locks` (when posting credit notes), `idempotency_keys`, `legal_sources` (only when AI cites Armenian procurement law). All eight existing purchase routes stay untouched; procurement-extension routes live under `/api/procurement/*`.

## Deferred to other sub-plans

- Real-time customs duty lookups (sub-plan 6 Export + sub-plan 7 State Integrations).
- Vendor portal for self-service quote submission (out of scope for now).
- E-signature on RFQ award (sub-plan 4 Docs).

---

## Task 1: Write the RED test file (contract suite for all 11 routes)

**Files:**
- Create: `test/procurement-extension.test.js`
- Read: `test/healthcheck.test.js` (style reference from sub-plan 0)
- Read: `test/purchase.test.js` (style reference for the spine)

- [ ] **Step 1: Create the test file with full contract coverage for all 11 mutation routes**

```js
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
  const vendorRes = await app.inject({
    method: "POST", url: "/api/purchase/vendors", headers: { cookie },
    payload: { name: "Yerevan Hardware Supply", taxId: "01234568", currency: "AMD" }
  });
  const vendorId = vendorRes.json().vendor.id;
  const catalogRes = await app.inject({ method: "GET", url: "/api/catalog/items", headers: { cookie } });
  const itemId = catalogRes.json().items.find(i => i.trackStock).id;
  const orderRes = await app.inject({
    method: "POST", url: "/api/purchase/orders", headers: { cookie },
    payload: { vendorId, orderNumber: "PO-EX-1", supplier: "Yerevan Hardware", orderDate: "2026-06-08", expectedDate: "2026-06-15", lines: [{ catalogItemId: itemId, quantity: 10, unitCost: 100000 }] }
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
```

- [ ] **Step 2: Run the test to verify RED**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/procurement-extension.test.js 2>&1 | tail -20
```

Expected: FAIL with `404` for every `/api/procurement/*` route.

- [ ] **Step 3: Commit RED tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add test/procurement-extension.test.js && git commit -m "test(procurement-extension): define Pattern A contract for 11 routes" && git push ant main
```

## Task 2: DB migration — add the eight procurement-extension tables

**Files:**
- Modify: `server/db.js` (insert after the `purchase_returns` block, before `crm_leads`)

- [ ] **Step 1: Add the eight CREATE TABLE statements**

In `server/db.js`, locate the closing `);` of the `CREATE TABLE IF NOT EXISTS purchase_returns` block (around line 809) and the start of the `crm_leads` block. Insert this block between them:

```js
    CREATE TABLE IF NOT EXISTS purchase_requisitions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      requester_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL,
      needed_by TEXT NOT NULL,
      justification TEXT NOT NULL DEFAULT '',
      rfq_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_status
      ON purchase_requisitions(org_id, status, needed_by);

    CREATE TABLE IF NOT EXISTS purchase_requisition_lines (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      requisition_id TEXT NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
      catalog_item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE RESTRICT,
      quantity INTEGER NOT NULL,
      uom TEXT NOT NULL DEFAULT 'հատ',
      est_unit_price INTEGER NOT NULL DEFAULT 0,
      suggested_vendor_id TEXT REFERENCES purchase_vendors(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_requisition_lines_req
      ON purchase_requisition_lines(org_id, requisition_id);

    CREATE TABLE IF NOT EXISTS rfq_requests (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      requisition_id TEXT REFERENCES purchase_requisitions(id) ON DELETE SET NULL,
      sent_at TEXT NOT NULL,
      due_at TEXT NOT NULL,
      status TEXT NOT NULL,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rfq_requests_status
      ON rfq_requests(org_id, status, due_at);

    CREATE TABLE IF NOT EXISTS rfq_request_vendors (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      rfq_id TEXT NOT NULL REFERENCES rfq_requests(id) ON DELETE CASCADE,
      vendor_id TEXT NOT NULL REFERENCES purchase_vendors(id) ON DELETE CASCADE,
      sent_at TEXT NOT NULL,
      responded_at TEXT,
      UNIQUE(org_id, rfq_id, vendor_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rfq_request_vendors_rfq
      ON rfq_request_vendors(org_id, rfq_id);

    CREATE TABLE IF NOT EXISTS rfq_quotes (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      rfq_id TEXT NOT NULL REFERENCES rfq_requests(id) ON DELETE CASCADE,
      vendor_id TEXT NOT NULL REFERENCES purchase_vendors(id) ON DELETE CASCADE,
      requisition_line_id TEXT NOT NULL REFERENCES purchase_requisition_lines(id) ON DELETE CASCADE,
      unit_price INTEGER NOT NULL,
      currency TEXT NOT NULL,
      valid_until TEXT NOT NULL,
      payment_terms TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rfq_quotes_rfq
      ON rfq_quotes(org_id, rfq_id, vendor_id);

    CREATE TABLE IF NOT EXISTS blanket_orders (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      vendor_id TEXT NOT NULL REFERENCES purchase_vendors(id) ON DELETE CASCADE,
      catalog_item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      committed_qty INTEGER NOT NULL,
      unit_price INTEGER NOT NULL,
      currency TEXT NOT NULL,
      uom TEXT NOT NULL DEFAULT 'հատ',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_blanket_orders_item
      ON blanket_orders(org_id, catalog_item_id, vendor_id, end_date);

    CREATE TABLE IF NOT EXISTS landed_cost_allocations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      fx_rate REAL NOT NULL DEFAULT 1,
      allocation_method TEXT NOT NULL,
      base_total INTEGER NOT NULL,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_landed_cost_allocations_po
      ON landed_cost_allocations(org_id, po_id);

    CREATE TABLE IF NOT EXISTS purchase_credit_notes (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      bill_id TEXT REFERENCES bills(id) ON DELETE SET NULL,
      return_id TEXT REFERENCES purchase_returns(id) ON DELETE SET NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      posted_at TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_credit_notes_po
      ON purchase_credit_notes(org_id, po_id, status);
```

- [ ] **Step 2: Boot the app to verify the migration is idempotent**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node -e "const { buildApp } = require('./server/app'); const app = buildApp({ dbPath: ':memory:' }); app.ready().then(() => { const tables = app.db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'purchase_%' OR name LIKE 'rfq_%' OR name LIKE 'blanket_%' OR name LIKE 'landed_%' ORDER BY name\").all(); console.log(tables.map(t => t.name).join(',')); app.close(); });"
```

Expected output includes: `blanket_orders,landed_cost_allocations,purchase_credit_notes,purchase_requisition_lines,purchase_requisitions,rfq_quotes,rfq_request_vendors,rfq_requests`.

- [ ] **Step 3: Commit the migration**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/db.js && git commit -m "feat(procurement-extension): add 8 procurement tables" && git push ant main
```

## Task 3: Add the pure engine module

**Files:**
- Create: `server/procurement.js`

- [ ] **Step 1: Create the engine with all 12 functions**

```js
"use strict";

const crypto = require("node:crypto");

function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}

function required(value, name) {
  if (value === undefined || value === null || value === "") {
    const err = new Error(`${name} is required`);
    err.statusCode = 400;
    throw err;
  }
  return value;
}

function positiveInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    const err = new Error(`${name} must be a positive integer`);
    err.statusCode = 400;
    throw err;
  }
  return n;
}

function nonNegativeInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    const err = new Error(`${name} must be a non-negative integer`);
    err.statusCode = 400;
    throw err;
  }
  return n;
}

function createRequisition(db, user, body) {
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length === 0) {
    const err = new Error("At least one line is required");
    err.statusCode = 400;
    throw err;
  }
  const now = new Date().toISOString();
  const id = newId("pr");
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO purchase_requisitions (id, org_id, requester_id, status, needed_by, justification, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, user.org_id, user.id, "open", required(body.neededBy, "neededBy"), String(body.justification || ""), now, now);
    const lineRows = [];
    for (const line of lines) {
      const lineId = newId("prl");
      db.prepare("INSERT INTO purchase_requisition_lines (id, org_id, requisition_id, catalog_item_id, quantity, uom, est_unit_price, suggested_vendor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(lineId, user.org_id, id, required(line.catalogItemId, "catalogItemId"), positiveInt(line.quantity, "quantity"), String(line.uom || "հատ"), nonNegativeInt(line.estUnitPrice, "estUnitPrice"), line.suggestedVendorId || null, now);
      lineRows.push({ id: lineId, catalogItemId: line.catalogItemId, quantity: line.quantity, estUnitPrice: line.estUnitPrice || 0, suggestedVendorId: line.suggestedVendorId || null });
    }
    return lineRows;
  });
  const lineRows = tx();
  return {
    id,
    status: "open",
    neededBy: body.neededBy,
    justification: String(body.justification || ""),
    requesterId: user.id,
    lines: lineRows,
    createdAt: now
  };
}

function scoreVendors(db, orgId, requisitionId) {
  const req = db.prepare("SELECT * FROM purchase_requisitions WHERE org_id = ? AND id = ?").get(orgId, requisitionId);
  if (!req) {
    const err = new Error("Requisition not found");
    err.statusCode = 404;
    throw err;
  }
  const lines = db.prepare("SELECT * FROM purchase_requisition_lines WHERE org_id = ? AND requisition_id = ?").all(orgId, requisitionId);
  const vendors = db.prepare("SELECT * FROM purchase_vendors WHERE org_id = ? AND status = 'active'").all(orgId);
  const scored = vendors.map(vendor => {
    let total = 0; let count = 0;
    for (const line of lines) {
      const price = db.prepare("SELECT * FROM purchase_vendor_prices WHERE org_id = ? AND vendor_id = ? AND catalog_item_id = ? AND status = 'active' ORDER BY min_quantity DESC LIMIT 1")
        .get(orgId, vendor.id, line.catalog_item_id);
      if (price) { total += price.unit_cost; count += 1; }
    }
    const avgPrice = count > 0 ? Math.round(total / count) : Number.MAX_SAFE_INTEGER;
    return { vendorId: vendor.id, name: vendor.name, score: count, avgPrice, leadTimeDays: 0 };
  });
  scored.sort((a, b) => b.score - a.score || a.avgPrice - b.avgPrice);
  return scored.slice(0, 5);
}

function convertRequisitionToRfq(db, user, requisitionId, body) {
  const dueAt = required(body.dueAt, "dueAt");
  const now = new Date().toISOString();
  const rfqId = newId("rfq");
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO rfq_requests (id, org_id, requisition_id, sent_at, due_at, status, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(rfqId, user.org_id, requisitionId, now, dueAt, "open", user.id, now);
    const shortlisted = scoreVendors(db, user.org_id, requisitionId);
    for (const v of shortlisted) {
      db.prepare("INSERT INTO rfq_request_vendors (id, org_id, rfq_id, vendor_id, sent_at) VALUES (?, ?, ?, ?, ?)")
        .run(newId("rfqv"), user.org_id, rfqId, v.vendorId, now);
    }
    db.prepare("UPDATE purchase_requisitions SET status = ?, rfq_id = ?, updated_at = ? WHERE id = ? AND org_id = ?")
      .run("rfq", rfqId, now, requisitionId, user.org_id);
    return shortlisted;
  });
  const shortlisted = tx();
  return { id: rfqId, requisitionId, sentAt: now, dueAt, status: "open", shortlistedVendors: shortlisted };
}

function recordQuote(db, user, rfqId, body) {
  const lineId = required(body.requisitionLineId, "requisitionLineId");
  const vendorId = required(body.vendorId, "vendorId");
  const unitPrice = nonNegativeInt(body.unitPrice, "unitPrice");
  const currency = String(body.currency || "AMD").toUpperCase();
  const validUntil = required(body.validUntil, "validUntil");
  const now = new Date().toISOString();
  const id = newId("rfqq");
  db.prepare("INSERT INTO rfq_quotes (id, org_id, rfq_id, vendor_id, requisition_line_id, unit_price, currency, valid_until, payment_terms, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, user.org_id, rfqId, vendorId, lineId, unitPrice, currency, validUntil, String(body.paymentTerms || ""), String(body.notes || ""), now);
  db.prepare("UPDATE rfq_request_vendors SET responded_at = ? WHERE org_id = ? AND rfq_id = ? AND vendor_id = ?")
    .run(now, user.org_id, rfqId, vendorId);
  return { id, rfqId, vendorId, requisitionLineId: lineId, unitPrice, currency, validUntil, createdAt: now };
}

function awardRfq(db, user, rfqId, body) {
  const vendorId = required(body.vendorId, "vendorId");
  const rfq = db.prepare("SELECT * FROM rfq_requests WHERE org_id = ? AND id = ?").get(user.org_id, rfqId);
  if (!rfq) {
    const err = new Error("RFQ not found");
    err.statusCode = 404;
    throw err;
  }
  const lines = db.prepare(`
    SELECT ql.requisition_line_id AS requisitionLineId, ql.unit_price AS unitPrice, ql.currency,
           rl.catalog_item_id AS catalogItemId, rl.quantity, rl.uom
    FROM rfq_quotes ql
    JOIN purchase_requisition_lines rl ON rl.id = ql.requisition_line_id
    WHERE ql.org_id = ? AND ql.rfq_id = ? AND ql.vendor_id = ?
  `).all(user.org_id, rfqId, vendorId);
  if (lines.length === 0) {
    const err = new Error("No quotes from this vendor");
    err.statusCode = 400;
    throw err;
  }
  const now = new Date().toISOString();
  const orderId = newId("po");
  const orderNumber = `PO-RFQ-${rfqId.slice(-6).toUpperCase()}`;
  const vendor = db.prepare("SELECT name FROM purchase_vendors WHERE org_id = ? AND id = ?").get(user.org_id, vendorId);
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO purchase_orders (id, org_id, vendor_id, order_number, supplier, supplier_tax_id, status, subtotal, vat, total, currency, order_date, expected_date, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(orderId, user.org_id, vendorId, orderNumber, vendor?.name || "", "", "rfq", 0, 0, 0, "AMD", now.slice(0, 10), now.slice(0, 10), user.id, now, now);
    let subtotal = 0;
    for (const line of lines) {
      const lineSubtotal = line.unitPrice * line.quantity;
      subtotal += lineSubtotal;
      db.prepare("INSERT INTO purchase_order_lines (id, org_id, purchase_order_id, catalog_item_id, description, quantity, unit_cost, subtotal, vat, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(newId("pol"), user.org_id, orderId, line.catalogItemId, "", line.quantity, line.unitPrice, lineSubtotal, 0, lineSubtotal, now);
    }
    db.prepare("UPDATE purchase_orders SET subtotal = ?, total = ? WHERE id = ?").run(subtotal, subtotal, orderId);
    db.prepare("UPDATE rfq_requests SET status = 'awarded' WHERE id = ? AND org_id = ?").run(rfqId, user.org_id);
    db.prepare("UPDATE purchase_requisitions SET status = 'awarded', updated_at = ? WHERE org_id = ? AND rfq_id = ?").run(now, user.org_id, rfqId);
  });
  tx();
  return { id: orderId, orderNumber, status: "rfq", vendorId, total: 0 };
}

function createBlanketOrder(db, user, body) {
  const now = new Date().toISOString();
  const id = newId("bo");
  db.prepare("INSERT INTO blanket_orders (id, org_id, vendor_id, catalog_item_id, start_date, end_date, committed_qty, unit_price, currency, uom, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, user.org_id, required(body.vendorId, "vendorId"), required(body.catalogItemId, "catalogItemId"),
         required(body.startDate, "startDate"), required(body.endDate, "endDate"),
         positiveInt(body.committedQty, "committedQty"), nonNegativeInt(body.unitPrice, "unitPrice"),
         String(body.currency || "AMD").toUpperCase(), String(body.uom || "հատ"),
         String(body.note || ""), now);
  return { id, status: "open", createdAt: now };
}

function checkBlanketCoverage(db, orgId, catalogItemId) {
  const rows = db.prepare("SELECT * FROM blanket_orders WHERE org_id = ? AND catalog_item_id = ? AND end_date >= ?")
    .all(orgId, catalogItemId, new Date().toISOString().slice(0, 10));
  const openPo = db.prepare("SELECT COALESCE(SUM(pol.quantity - pol.received_quantity), 0) AS openQty FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id WHERE po.org_id = ? AND pol.catalog_item_id = ? AND po.status IN ('rfq', 'confirmed', 'partial')")
    .get(orgId, catalogItemId);
  const committedQty = rows.reduce((s, r) => s + r.committed_qty, 0);
  return { committedQty, openPoQty: Number(openPo?.openQty || 0), blanketOrders: rows.length };
}

function allocateLandedCost(db, user, body) {
  const poId = required(body.poId, "poId");
  const kind = required(body.kind, "kind");
  const amount = positiveInt(body.amount, "amount");
  const method = String(body.allocationMethod || "value");
  if (!["quantity", "value"].includes(method)) {
    const err = new Error("allocationMethod must be 'quantity' or 'value'");
    err.statusCode = 400;
    throw err;
  }
  const lines = db.prepare("SELECT * FROM purchase_order_lines WHERE org_id = ? AND purchase_order_id = ?").all(user.org_id, poId);
  if (lines.length === 0) {
    const err = new Error("PO has no lines");
    err.statusCode = 400;
    throw err;
  }
  const baseTotal = method === "value"
    ? lines.reduce((s, l) => s + l.subtotal, 0)
    : lines.reduce((s, l) => s + l.quantity, 0);
  const allocations = lines.map(line => {
    const share = method === "value" ? line.subtotal : line.quantity;
    const allocated = baseTotal === 0 ? 0 : Math.round((amount * share) / baseTotal);
    return { lineId: line.id, allocated };
  });
  const totalAllocated = allocations.reduce((s, a) => s + a.allocated, 0);
  const now = new Date().toISOString();
  const id = newId("lca");
  db.prepare("INSERT INTO landed_cost_allocations (id, org_id, po_id, kind, amount, currency, fx_rate, allocation_method, base_total, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, user.org_id, poId, kind, amount, String(body.currency || "AMD").toUpperCase(), Number(body.fxRate) || 1, method, baseTotal, user.id, now);
  for (const a of allocations) {
    db.prepare("UPDATE purchase_order_lines SET unit_cost = unit_cost + ? WHERE id = ? AND org_id = ?")
      .run(Math.round(a.allocated / Math.max(1, lines.find(l => l.id === a.lineId).quantity)), a.lineId, user.org_id);
  }
  return { id, poId, kind, amount, allocationMethod: method, allocations, totalAllocated, createdAt: now };
}

function isPeriodOpen(db, orgId, period) {
  const row = db.prepare("SELECT 1 FROM period_locks WHERE org_id = ? AND period = ?").get(orgId, period);
  return !row;
}

function issueCreditNote(db, user, body) {
  const poId = required(body.poId, "poId");
  const amount = positiveInt(body.amount, "amount");
  const now = new Date().toISOString();
  const period = now.slice(0, 7);
  if (!isPeriodOpen(db, user.org_id, period)) {
    const err = new Error(`Period ${period} is locked`);
    err.statusCode = 423;
    throw err;
  }
  const id = newId("cn");
  db.prepare("INSERT INTO purchase_credit_notes (id, org_id, po_id, amount, currency, status, posted_at, note, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, user.org_id, poId, amount, String(body.currency || "AMD").toUpperCase(), "posted", now, String(body.note || ""), user.id, now);
  // AP reversal: credit 521 (AP) and debit 9111 (purchase returns / stock) via ledger
  const apAccount = db.prepare("SELECT id FROM accounts WHERE code = '5210' AND org_id = ?").get(user.org_id)?.id;
  if (apAccount) {
    db.prepare("INSERT INTO ledger_entries (id, org_id, account_id, debit_minor, credit_minor, currency, occurred_at, source_type, source_id, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(newId("le"), user.org_id, apAccount, 0, amount, "AMD", now, "purchase_credit_note", id, `AP reversal for credit note ${id}`, now);
  }
  return { id, poId, amount, status: "posted", postedAt: now };
}

function computeReplenishment(db, orgId) {
  const items = db.prepare("SELECT id, sku, name FROM catalog_items WHERE org_id = ? AND track_stock = 1").all(orgId);
  const suggestions = [];
  for (const item of items) {
    const stock = db.prepare("SELECT COALESCE(SUM(quantity), 0) AS on_hand FROM stock_quants WHERE org_id = ? AND catalog_item_id = ?").get(orgId, item.id);
    const demand = db.prepare("SELECT COALESCE(SUM(quantity), 0) AS open_demand FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id WHERE po.org_id = ? AND pol.catalog_item_id = ? AND po.status IN ('rfq', 'confirmed')")
      .get(orgId, item.id);
    if (Number(stock.on_hand) <= 0 && Number(demand.open_demand) === 0) {
      suggestions.push({ catalogItemId: item.id, sku: item.sku, name: item.name, onHand: Number(stock.on_hand), openDemand: 0, suggestedQty: 50 });
    }
  }
  return suggestions;
}

function detectPriceAnomaly(db, orgId, catalogItemId, proposedUnitPrice) {
  const history = db.prepare("SELECT unit_cost FROM purchase_vendor_prices WHERE org_id = ? AND catalog_item_id = ? AND status IN ('active', 'archived') ORDER BY updated_at DESC LIMIT 10")
    .all(orgId, catalogItemId);
  if (history.length === 0) return { verdict: "no-history", deviationPct: 0 };
  const avg = history.reduce((s, h) => s + h.unit_cost, 0) / history.length;
  const deviationPct = Math.round(((proposedUnitPrice - avg) / avg) * 10000) / 100;
  return { verdict: deviationPct > 20 ? "anomaly" : "ok", deviationPct, historicalAvg: Math.round(avg), sampleSize: history.length };
}

function selectVendor(db, orgId, catalogItemId, quantity) {
  const candidates = db.prepare(`
    SELECT pv.id AS vendorPriceId, pv.vendor_id AS vendorId, pvd.name AS vendorName,
           pv.unit_cost AS unitCost, pv.currency, pv.lead_time_days AS leadTimeDays,
           pv.min_quantity AS minQuantity
    FROM purchase_vendor_prices pv
    JOIN purchase_vendors pvd ON pvd.id = pv.vendor_id
    WHERE pv.org_id = ? AND pv.catalog_item_id = ? AND pv.status = 'active' AND pv.min_quantity <= ?
  `).all(orgId, catalogItemId, quantity);
  const scored = candidates.map(c => {
    const priceScore = 100 - Math.min(100, Math.round(c.unitCost / 1000));
    const leadScore = 100 - Math.min(100, c.leadTimeDays);
    const score = Math.round(priceScore * 0.6 + leadScore * 0.4);
    return { ...c, score, eligible: c.minQuantity <= quantity };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

module.exports = {
  createRequisition,
  scoreVendors,
  convertRequisitionToRfq,
  recordQuote,
  awardRfq,
  createBlanketOrder,
  checkBlanketCoverage,
  allocateLandedCost,
  issueCreditNote,
  computeReplenishment,
  detectPriceAnomaly,
  selectVendor
};
```

- [ ] **Step 2: Run focused tests (still RED — routes not wired yet)**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/procurement-extension.test.js 2>&1 | tail -20
```

Expected: still FAIL with `404` for all procurement routes (engine exists but is not wired).

- [ ] **Step 3: Commit the engine**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/procurement.js && git commit -m "feat(procurement-extension): add pure engine (12 functions)" && git push ant main
```

## Task 4: Wire the 11 routes in `server/app.js`

**Files:**
- Modify: `server/app.js` (add import near other engine imports, register 11 routes after the `/api/purchase/orders/:id/bill` block at line ~545)

- [ ] **Step 1: Add the import**

Near the top of `server/app.js`, after the existing `./vendor` imports and the other engine `require()` calls (e.g. next to `const copilot = require("./copilot");`), add:

```js
const procurement = require("./procurement");
```

- [ ] **Step 2: Register the 11 routes after the existing `/api/purchase/orders/:id/bill` route**

Insert this block immediately after the closing `});` of `app.post("/api/purchase/orders/:id/bill", ...)` (around line 545):

```js
  app.post("/api/procurement/requisitions", async request => {
    const user = await app.auth(request);
    requirePurchaseWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const err = new Error("idempotencyKey is required"); err.statusCode = 400; throw err; }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const requisition = procurement.createRequisition(db, user, body);
    const envelope = { ok: true, requisition };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString());
    audit(db, user.org_id, user.id, "procurement.requisition.created", { requisitionId: requisition.id, lines: requisition.lines.length, idempotencyKey: idem });
    return envelope;
  });

  app.post("/api/procurement/requisitions/:id/convert-to-rfq", async request => {
    const user = await app.auth(request);
    requirePurchaseWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const err = new Error("idempotencyKey is required"); err.statusCode = 400; throw err; }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const rfq = procurement.convertRequisitionToRfq(db, user, request.params.id, body);
    const envelope = { ok: true, rfq };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString());
    audit(db, user.org_id, user.id, "procurement.rfq.created", { rfqId: rfq.id, requisitionId: request.params.id, shortlisted: rfq.shortlistedVendors.length, idempotencyKey: idem });
    return envelope;
  });

  app.post("/api/procurement/rfqs/:id/quotes", async request => {
    const user = await app.auth(request);
    requirePurchaseWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const err = new Error("idempotencyKey is required"); err.statusCode = 400; throw err; }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const quote = procurement.recordQuote(db, user, request.params.id, body);
    const envelope = { ok: true, quote };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString());
    audit(db, user.org_id, user.id, "procurement.rfq.quote.recorded", { rfqId: request.params.id, vendorId: body.vendorId, unitPrice: body.unitPrice, idempotencyKey: idem });
    return envelope;
  });

  app.post("/api/procurement/rfqs/:id/award", async request => {
    const user = await app.auth(request);
    requirePurchaseWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const err = new Error("idempotencyKey is required"); err.statusCode = 400; throw err; }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const purchaseOrder = procurement.awardRfq(db, user, request.params.id, body);
    const envelope = { ok: true, purchaseOrder };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString());
    audit(db, user.org_id, user.id, "procurement.rfq.awarded", { rfqId: request.params.id, vendorId: body.vendorId, purchaseOrderId: purchaseOrder.id, idempotencyKey: idem });
    return envelope;
  });

  app.post("/api/procurement/blanket-orders", async request => {
    const user = await app.auth(request);
    requirePurchaseWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const err = new Error("idempotencyKey is required"); err.statusCode = 400; throw err; }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const blanketOrder = procurement.createBlanketOrder(db, user, body);
    const envelope = { ok: true, blanketOrder };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString());
    audit(db, user.org_id, user.id, "procurement.blanket_order.created", { blanketOrderId: blanketOrder.id, vendorId: body.vendorId, catalogItemId: body.catalogItemId, idempotencyKey: idem });
    return envelope;
  });

  app.get("/api/procurement/blanket-orders/coverage", async request => {
    const user = await app.auth(request);
    requirePurchaseReader(user);
    const productId = String(request.query.productId || "").trim();
    if (!productId) { const err = new Error("productId is required"); err.statusCode = 400; throw err; }
    return { ok: true, coverage: procurement.checkBlanketCoverage(db, user.org_id, productId) };
  });

  app.post("/api/procurement/landed-costs", async request => {
    const user = await app.auth(request);
    requirePurchaseWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const err = new Error("idempotencyKey is required"); err.statusCode = 400; throw err; }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const allocation = procurement.allocateLandedCost(db, user, body);
    const envelope = { ok: true, allocation };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString());
    audit(db, user.org_id, user.id, "procurement.landed_cost.allocated", { poId: body.poId, kind: body.kind, amount: body.amount, totalAllocated: allocation.totalAllocated, idempotencyKey: idem });
    return envelope;
  });

  app.post("/api/procurement/credit-notes", async request => {
    const user = await app.auth(request);
    requirePurchaseWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const err = new Error("idempotencyKey is required"); err.statusCode = 400; throw err; }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const creditNote = procurement.issueCreditNote(db, user, body);
    const envelope = { ok: true, creditNote };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString());
    audit(db, user.org_id, user.id, "procurement.credit_note.issued", { creditNoteId: creditNote.id, poId: body.poId, amount: body.amount, idempotencyKey: idem });
    return envelope;
  });

  app.post("/api/procurement/ai/select-vendor", async request => {
    const user = await app.auth(request);
    requirePurchaseReader(user);
    const body = request.body || {};
    const candidates = procurement.selectVendor(db, user.org_id, body.catalogItemId, Number(body.quantity) || 1);
    return { ok: true, candidates, source: "local-fallback" };
  });

  app.post("/api/procurement/ai/price-anomaly", async request => {
    const user = await app.auth(request);
    requirePurchaseReader(user);
    const body = request.body || {};
    const result = procurement.detectPriceAnomaly(db, user.org_id, body.catalogItemId, Number(body.proposedUnitPrice) || 0);
    return { ok: true, ...result, source: "local-fallback" };
  });

  app.get("/api/procurement/analytics/replenishment", async request => {
    const user = await app.auth(request);
    requirePurchaseReader(user);
    return { ok: true, suggestions: procurement.computeReplenishment(db, user.org_id) };
  });
```

- [ ] **Step 3: Run focused tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/procurement-extension.test.js 2>&1 | tail -25
```

Expected: PASS (12 tests).

- [ ] **Step 4: Run the full test suite to confirm no regressions**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, total test count increases by 12.

- [ ] **Step 5: Commit the routes**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/app.js test/procurement-extension.test.js && git commit -m "feat(procurement-extension): wire 11 routes with idempotency" && git push ant main
```

## Task 5: Add the React extension panel with 5 tabs

**Files:**
- Create: `web/src/procurement.jsx`
- Modify: `web/src/locale.js` (add procurement keys)
- Modify: `web/src/main.jsx` (import + mount the panel)

- [ ] **Step 1: Add Armenian-first locale keys**

In `web/src/locale.js`, add a new `procurementExtension` block:

```js
export const procurementExtension = {
  tabRequisitions: "Հայտեր",
  tabRfq: "RFQ / Հարցումներ",
  tabBlanket: "Ծածկագրեր (Blanket)",
  tabLanded: "Լոգիստիկական ծախսեր",
  tabCredit: "Վերադարձի հաշիվներ",
  createRequisition: "Ստեղծել հայտ",
  neededBy: "Պահանջվող ժամկետ",
  justification: "Հիմնավորում",
  convertToRfq: "Փոխարկել RFQ-ի",
  recordQuote: "Գրանցել առաջարկ",
  awardRfq: "Հաղթող ճանաչել",
  createBlanket: "Ստեղծել Blanket պատվեր",
  coverage: "Ծածկույթ",
  allocateLanded: "Բաշխել լոգիստիկական ծախսը",
  issueCredit: "Տրամադրել վերադարձի հաշիվ",
  aiSelectVendor: "AI՝ մատակարարի ընտրություն",
  aiPriceAnomaly: "AI՝ գնային անոմալիա",
  replenishment: "Վերալիցքի առաջարկներ"
};
```

Export `procurementExtension` from the locale module's default export.

- [ ] **Step 2: Create the panel component**

```jsx
import React, { useState } from "react";
import { procurementExtension as t } from "./locale.js";

function Tab({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`mini-action${active ? " is-active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function RequisitionForm({ onSubmit, busy }) {
  const [neededBy, setNeededBy] = useState("2026-06-30");
  const [justification, setJustification] = useState("");
  return (
    <form
      className="inline-form"
      onSubmit={event => {
        event.preventDefault();
        onSubmit({ neededBy, justification, idempotencyKey: `pr-ui-${Date.now()}` });
      }}
    >
      <label className="section-label">{t.neededBy}</label>
      <input type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)} required />
      <label className="section-label">{t.justification}</label>
      <input value={justification} onChange={e => setJustification(e.target.value)} placeholder="Հիմնավորում" />
      <button type="submit" className="mini-action" disabled={busy}>{busy ? "..." : t.createRequisition}</button>
    </form>
  );
}

function RfqResult({ result }) {
  if (!result) return null;
  return (
    <div className="copilot-result">
      <p>RFQ ID: <strong>{result.rfq.id}</strong></p>
      <p>Կարճ ցուցակ՝ {result.rfq.shortlistedVendors.length} մատակարար</p>
      <ul>
        {result.rfq.shortlistedVendors.map(v => (
          <li key={v.vendorId}>{v.name} — score {v.score}, avg {v.avgPrice}</li>
        ))}
      </ul>
    </div>
  );
}

function LandedForm({ onSubmit, busy, defaultPoId = "" }) {
  const [poId, setPoId] = useState(defaultPoId);
  const [kind, setKind] = useState("freight");
  const [amount, setAmount] = useState("50000");
  return (
    <form
      className="inline-form"
      onSubmit={event => {
        event.preventDefault();
        onSubmit({ poId, kind, amount: Number(amount), currency: "AMD", allocationMethod: "value", idempotencyKey: `lc-ui-${Date.now()}` });
      }}
    >
      <label className="section-label">PO ID</label>
      <input value={poId} onChange={e => setPoId(e.target.value)} required />
      <label className="section-label">Տեսակ</label>
      <select value={kind} onChange={e => setKind(e.target.value)}>
        <option value="freight">Freight</option>
        <option value="duty">Duty</option>
        <option value="insurance">Insurance</option>
        <option value="other">Other</option>
      </select>
      <label className="section-label">Գումար (դրամ)</label>
      <input type="number" value={amount} onChange={e => setAmount(e.target.value)} required />
      <button type="submit" className="mini-action" disabled={busy}>{busy ? "..." : t.allocateLanded}</button>
    </form>
  );
}

function CreditForm({ onSubmit, busy, defaultPoId = "" }) {
  const [poId, setPoId] = useState(defaultPoId);
  const [amount, setAmount] = useState("30000");
  return (
    <form
      className="inline-form"
      onSubmit={event => {
        event.preventDefault();
        onSubmit({ poId, amount: Number(amount), currency: "AMD", idempotencyKey: `cn-ui-${Date.now()}` });
      }}
    >
      <label className="section-label">PO ID</label>
      <input value={poId} onChange={e => setPoId(e.target.value)} required />
      <label className="section-label">Գումար (դրամ)</label>
      <input type="number" value={amount} onChange={e => setAmount(e.target.value)} required />
      <button type="submit" className="mini-action" disabled={busy}>{busy ? "..." : t.issueCredit}</button>
    </form>
  );
}

function BlanketForm({ onSubmit, busy }) {
  const [vendorId, setVendorId] = useState("");
  const [catalogItemId, setCatalogItemId] = useState("");
  const [committedQty, setCommittedQty] = useState("100");
  const [unitPrice, setUnitPrice] = useState("80000");
  return (
    <form
      className="inline-form"
      onSubmit={event => {
        event.preventDefault();
        onSubmit({
          vendorId, catalogItemId, startDate: "2026-06-01", endDate: "2026-12-31",
          committedQty: Number(committedQty), unitPrice: Number(unitPrice), currency: "AMD", idempotencyKey: `bo-ui-${Date.now()}`
        });
      }}
    >
      <label className="section-label">Մատակարար</label>
      <input value={vendorId} onChange={e => setVendorId(e.target.value)} required />
      <label className="section-label">Catalog Item</label>
      <input value={catalogItemId} onChange={e => setCatalogItemId(e.target.value)} required />
      <label className="section-label">Պարտավորված քանակ</label>
      <input type="number" value={committedQty} onChange={e => setCommittedQty(e.target.value)} required />
      <label className="section-label">Միավոր գին (դրամ)</label>
      <input type="number" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} required />
      <button type="submit" className="mini-action" disabled={busy}>{busy ? "..." : t.createBlanket}</button>
    </form>
  );
}

export function ProcurementExtensionPanel({
  requisitions,
  rfqs,
  coverage,
  actionState,
  onCreateRequisition,
  onConvertToRfq,
  onAllocateLanded,
  onIssueCredit,
  onCreateBlanket,
  onCheckCoverage
}) {
  const [tab, setTab] = useState("requisitions");
  const busyRequisition = actionState === "procurement:requisition";
  const busyConvert = actionState === "procurement:convert";
  const busyLanded = actionState === "procurement:landed";
  const busyCredit = actionState === "procurement:credit";
  const busyBlanket = actionState === "procurement:blanket";
  return (
    <article className="panel procurement-extension-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Ձեռքբերումների ընդլայնում</span>
          <h2>Procurement extension</h2>
        </div>
        <div className="row">
          <Tab active={tab === "requisitions"} onClick={() => setTab("requisitions")}>{t.tabRequisitions}</Tab>
          <Tab active={tab === "rfq"} onClick={() => setTab("rfq")}>{t.tabRfq}</Tab>
          <Tab active={tab === "blanket"} onClick={() => setTab("blanket")}>{t.tabBlanket}</Tab>
          <Tab active={tab === "landed"} onClick={() => setTab("landed")}>{t.tabLanded}</Tab>
          <Tab active={tab === "credit"} onClick={() => setTab("credit")}>{t.tabCredit}</Tab>
        </div>
      </div>

      {tab === "requisitions" && (
        <div className="section">
          <RequisitionForm onSubmit={onCreateRequisition} busy={busyRequisition} />
          {requisitions && requisitions.length > 0 && (
            <ul className="row">
              {requisitions.map(r => (
                <li key={r.id}>
                  <span className="section-label">{r.id}</span> — {r.neededBy} — {r.lines.length} տող
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "rfq" && (
        <div className="section">
          <RequisitionForm onSubmit={onConvertToRfq} busy={busyConvert} />
          <RfqResult result={rfqs} />
        </div>
      )}

      {tab === "blanket" && (
        <div className="section">
          <BlanketForm onSubmit={onCreateBlanket} busy={busyBlanket} />
          {coverage && (
            <div className="copilot-result">
              <p>Պարտավորված քանակ՝ <strong>{coverage.committedQty}</strong></p>
              <p>Բաց PO քանակ՝ <strong>{coverage.openPoQty}</strong></p>
              <span className="aging-badge">{coverage.blanketOrders} Blanket</span>
            </div>
          )}
        </div>
      )}

      {tab === "landed" && (
        <div className="section">
          <LandedForm onSubmit={onAllocateLanded} busy={busyLanded} />
        </div>
      )}

      {tab === "credit" && (
        <div className="section">
          <CreditForm onSubmit={onIssueCredit} busy={busyCredit} />
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 3: Mount the panel in `web/src/main.jsx`**

Find the import block at the top of `web/src/main.jsx` and add:

```jsx
import { ProcurementExtensionPanel } from "./procurement.jsx";
```

Inside the `Workspace` component, add the loader functions:

```jsx
const createRequisition = async payload => {
  setActionState("procurement:requisition");
  setActionError("");
  try {
    return await api("/api/procurement/requisitions", { method: "POST", body: payload });
  } finally { setActionState(""); }
};
const convertToRfq = async payload => {
  setActionState("procurement:convert");
  setActionError("");
  try {
    return await api("/api/procurement/requisitions/x/convert-to-rfq", { method: "POST", body: payload });
  } finally { setActionState(""); }
};
const allocateLanded = async payload => {
  setActionState("procurement:landed");
  setActionError("");
  try {
    return await api("/api/procurement/landed-costs", { method: "POST", body: payload });
  } finally { setActionState(""); }
};
const issueCredit = async payload => {
  setActionState("procurement:credit");
  setActionError("");
  try {
    return await api("/api/procurement/credit-notes", { method: "POST", body: payload });
  } finally { setActionState(""); }
};
const createBlanket = async payload => {
  setActionState("procurement:blanket");
  setActionError("");
  try {
    return await api("/api/procurement/blanket-orders", { method: "POST", body: payload });
  } finally { setActionState(""); }
};
```

Render the panel near the existing `<PurchaseWorkspacePanel ... />`:

```jsx
<ProcurementExtensionPanel
  actionState={actionState}
  onCreateRequisition={createRequisition}
  onConvertToRfq={convertToRfq}
  onAllocateLanded={allocateLanded}
  onIssueCredit={issueCredit}
  onCreateBlanket={createBlanket}
/>
```

- [ ] **Step 4: Build the UI**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm run build:ui 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit UI integration**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add web/src/procurement.jsx web/src/main.jsx web/src/locale.js && git commit -m "feat(procurement-extension): mount 5-tab React panel" && git push ant main
```

## Task 6: Wire AI hooks + replenishment analytics (OpenRouter-gated)

**Files:**
- Modify: `server/app.js` (add `ARMOSPHERA_ONE_ALLOW_EGRESS` gate around the AI routes, default to local fallback)

- [ ] **Step 1: Add the egress-gate wrapper around the two AI routes**

In `server/app.js`, locate the two AI routes added in Task 4 (`/api/procurement/ai/select-vendor` and `/api/procurement/ai/price-anomaly`) and wrap the engine call with a config check. Replace the `return { ok: true, candidates, source: "local-fallback" };` line in the first route with:

```js
    const candidates = procurement.selectVendor(db, user.org_id, body.catalogItemId, Number(body.quantity) || 1);
    const egressAllowed = process.env.ARMOSPHERA_ONE_ALLOW_EGRESS === "1";
    return { ok: true, candidates, source: egressAllowed ? "openrouter-eligible" : "local-fallback" };
```

Replace the `return { ok: true, ...result, source: "local-fallback" };` line in the second route with:

```js
    const result = procurement.detectPriceAnomaly(db, user.org_id, body.catalogItemId, Number(body.proposedUnitPrice) || 0);
    const egressAllowed = process.env.ARMOSPHERA_ONE_ALLOW_EGRESS === "1";
    return { ok: true, ...result, source: egressAllowed ? "openrouter-eligible" : "local-fallback" };
```

- [ ] **Step 2: Run the AI test cases to verify they still pass with the local fallback**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/procurement-extension.test.js 2>&1 | tail -25
```

Expected: PASS (12 tests, all green).

- [ ] **Step 3: Verify the egress flag is honored**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && ARMOSPHERA_ONE_ALLOW_EGRESS=1 node -e "const { buildApp } = require('./server/app'); const app = buildApp({ dbPath: ':memory:' }); app.ready().then(async () => { const cookie = (await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'owner@armosphera.local', password: 'change-me-now' } })).headers['set-cookie']; const r = await app.inject({ method: 'POST', url: '/api/procurement/ai/select-vendor', headers: { cookie }, payload: { catalogItemId: 'fake', quantity: 1 } }); console.log(r.json().source); app.close(); });"
```

Expected output: `openrouter-eligible`.

- [ ] **Step 4: Commit AI hooks**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/app.js && git commit -m "feat(procurement-extension): gate AI hooks behind ARMOSPHERA_ONE_ALLOW_EGRESS" && git push ant main
```

## Task 7: Update handoff and tag

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update the first status line and add a completed bullet**

Replace the first line in `HANDOFF.md` with the new tag count and test result, e.g.:

```markdown
_Last updated: 2026-06-08 · main after Procurement extension · N tags · M tests (M pass, 0 fail, 0 cancelled)_
```

Add a bullet:

```markdown
- **Procurement extension** — DONE: pure `server/procurement.js` engine + 11 `/api/procurement/*` routes (requisitions, RFQ distribution + scoring, blanket orders, landed cost allocation, credit notes, AI vendor selection, price anomaly, replenishment analytics) + 8 new tables + 5-tab React `ProcurementExtensionPanel` + 12-test contract suite, extending the shipped Purchase spine.
```

- [ ] **Step 2: Commit handoff**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add HANDOFF.md && git commit -m "docs: record procurement-extension verification" && git push ant main
```

- [ ] **Step 3: Tag**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git tag procurement-extension-mvp && git push ant procurement-extension-mvp
```

---

## Final Self-Review Checklist (sub-plan 3)

- [ ] `test/procurement-extension.test.js` fails before the engine exists
- [ ] `test/procurement-extension.test.js` passes once the routes are wired (12 tests)
- [ ] `npm test` total count increases by 12 with no regressions
- [ ] `npm run build:ui` succeeds
- [ ] All 8 procurement tables exist in `:memory:` boot probe
- [ ] All 11 mutation routes prove 401 (no-auth), 403 (missing app access), 400 (malformed input), 200 (happy path)
- [ ] All 11 mutation routes write exactly one `audit_events` row per successful call
- [ ] Replay with same `idempotencyKey` returns the cached envelope and does not double-write audit
- [ ] Credit notes blocked with HTTP 423 when the period is locked; succeed when unlocked
- [ ] Landed cost allocation sums to the requested `amount` (no rounding loss > 1)
- [ ] Award creates a `purchase_orders` row with `status = 'rfq'`
- [ ] AI routes return `source: "local-fallback"` by default and `source: "openrouter-eligible"` when `ARMOSPHERA_ONE_ALLOW_EGRESS=1`
- [ ] Replenishment endpoint returns suggestions array
- [ ] Armenian-first labels used in panel (no English-only fields)
- [ ] `HANDOFF.md` updated
- [ ] `procurement-extension-mvp` tag pushed to `ant`
