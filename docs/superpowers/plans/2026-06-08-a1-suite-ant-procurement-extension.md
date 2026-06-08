# Sub-Plan 3: Procurement Extension (Закупки) — User Priority #3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shipped Purchase spine (RFQ/PO/partial receipts/supplier returns/Vendor 360) with: purchase requisitions, RFQ distribution, AI-assisted supplier selection, price analysis (history + market reference), overspend warnings, blanket orders, landed costs (freight/duty/insurance), billed-return credit notes, and replenishment analytics.

**Architecture:** Pattern A module `server/procurement.js` (pure engine: requisition → RFQ, supplier scoring, price anomaly detection, landed cost allocation, blanket-order coverage check) + `web/src/procurement.jsx` extension panel (Requisitions / RFQ / Blanket Orders / Landed Costs / Billed Returns tabs) + `test/procurement-extension.test.js`. Reuses the existing `purchase_orders`, `purchase_order_lines`, `vendors`, `vendor_prices` tables. New tables: `purchase_requisitions`, `purchase_requisition_lines`, `rfq_requests`, `rfq_quotes`, `blanket_orders`, `landed_cost_allocations`, `purchase_credit_notes`.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. Local AI helper for supplier selection / price analysis (deterministic fallback). Armenian fiscal handling: landed cost is split into base cost, freight, insurance, duty; allocated to PO lines by quantity or value, and posted to stock valuation + expense accounts.

**Depends on:** sub-plan 0 (Pattern A skeleton). Extends existing Purchase backend (no rewrite).

---

## DB additions

- `purchase_requisitions` (id, org_id, requester_id, status, needed_by, justification, created_at)
- `purchase_requisition_lines` (id, requisition_id, product_id, qty, uom, est_unit_price, suggested_vendor_id, created_at)
- `rfq_requests` (id, org_id, requisition_id, sent_at, due_at, status)
- `rfq_request_vendors` (id, rfq_id, vendor_id, sent_at, responded_at)
- `rfq_quotes` (id, rfq_id, vendor_id, line_id, unit_price, valid_until, payment_terms, notes)
- `blanket_orders` (id, org_id, vendor_id, product_id, start_date, end_date, committed_qty, unit_price, uom)
- `landed_cost_allocations` (id, org_id, po_id, kind, amount, currency, fx_rate, allocation_method, created_at)
- `purchase_credit_notes` (id, org_id, po_id, bill_id, return_id, amount, currency, status, posted_at, created_at)

## API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/procurement/requisitions` | Create PR |
| POST | `/api/procurement/requisitions/:id/convert-to-rfq` | Convert PR to RFQ (auto-pick top vendors by score) |
| POST | `/api/procurement/rfqs/:id/quotes` | Vendor submits a quote |
| POST | `/api/procurement/rfqs/:id/award` | Award RFQ to a vendor (creates draft PO) |
| POST | `/api/procurement/blanket-orders` | Create blanket order |
| GET | `/api/procurement/blanket-orders/coverage?productId=...` | Coverage check |
| POST | `/api/procurement/landed-costs` | Allocate landed cost to a PO (FIFO/LIFO/AVG) |
| POST | `/api/procurement/credit-notes` | Issue credit note for a billed return |
| POST | `/api/procurement/ai/select-vendor` | AI vendor selection (intent: procurement-vendor) |
| POST | `/api/procurement/ai/price-anomaly` | AI price anomaly check (intent: procurement-price) |
| GET | `/api/procurement/analytics/replenishment` | Replenishment suggestions (low stock + lead time) |

## Tasks (high level)

1. **Tests (RED)** — `test/procurement-extension.test.js`: requisition → RFQ → quote → award flow, blanket-order coverage, landed cost allocation correctness, credit-note AP reversal, overspend warning threshold, idempotency.
2. **Pure engine** — `server/procurement.js`: `convertRequisitionToRfq`, `scoreVendors`, `detectPriceAnomaly`, `allocateLandedCost`, `computeReplenishment`, `checkBlanketCoverage`.
3. **DB migration** — add the eight tables in `server/db.js`.
4. **Routes** — register the 11 routes after the existing purchase routes.
5. **React extension panel** — `web/src/procurement.jsx`: add 5 tabs (Requisitions / RFQ / Blanket Orders / Landed Costs / Billed Returns); the existing purchase flow remains.
6. **AI hooks** — local deterministic supplier scoring + price anomaly detection.
7. **Handoff + tag** — `procurement-extension-mvp`.

## Acceptance

- A requisition converts to an RFQ, multiple vendors respond, the system scores them, and the award creates a draft PO.
- Landed costs (freight + duty + insurance) are allocated to PO lines and update stock valuation.
- A blanket order's committed qty is visible against open POs.
- A billed return issues a credit note that reverses the AP posting.
- Replenishment analytics suggests POs based on lead time + open demand.

## Spine reused

`org_id`, `vendors`, `vendor_prices`, `purchase_orders`, `purchase_order_lines`, `vendors` (existing), `products`, `stock_quants`, `audit_events`, `period_locks` (when posting credit notes), `idempotency_keys`, `legal_sources` (only when AI cites Armenian procurement law).

## Deferred to other sub-plans

- Real-time customs duty lookups (sub-plan 6 Export + sub-plan 7 State Integrations).
- Vendor portal for self-service quote submission (out of scope for now).
