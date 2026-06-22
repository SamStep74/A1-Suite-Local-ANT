# ERP Comparison and A1 Suite Implementation Plan

Generated: 2026-06-05
Scope: the reference ERP product research, comparison with current A1 Suite Local, and a localized implementation plan for Armenian businesses.

## Executive Summary

the reference ERP's current product strength is not one isolated ERP module. It is the breadth of tightly connected apps: finance, CRM, sales, POS, website/eCommerce, inventory, manufacturing, purchase, HR, marketing, projects, documents/signature, Studio customizations, and AI agents. the reference ERP's own documentation groups these apps across finance, sales, websites, supply chain, HR, marketing, services, productivity, Studio, and deployment/administration.

A1 Suite Local already has a stronger Armenian sovereignty position than the reference ERP for the target market: local-first deployment, Armenian legal/accounting Copilot, RA tax/accounting workflows, professional legal-source review, and privacy/audit hardening. The major gap is breadth outside the current service/CRM/finance/docs/projects core: product catalog depth, inventory, purchase, POS, eCommerce, manufacturing, no-code customization, richer HR, marketing automation, reporting/spreadsheets, and app-level AI agents.

The recommended product direction is not to clone the reference ERP module-by-module. Implement an A1-native operating graph that borrows the proven the reference ERP coverage map, but prioritizes Armenian-localized workflows where generic the reference ERP is weak: ՀՎՀՀ, AMD, Armenian chart of accounts, VAT/SRC/HDM handoffs, Armenian address taxonomy, Armenian-first documents, sovereign/legal RAG, and offline/on-prem operation. the reference ERP appears to rely on a third-party Armenia localization app for Armenian chart of accounts and address data, while A1 should treat this as a first-party moat.

## Research Questions

1. What functional areas does the reference ERP cover today?
2. Where is the reference ERP strongest relative to A1 Suite Local?
3. Where is A1 Suite Local already differentiated?
4. What missing the reference ERP-style capabilities should A1 implement first?
5. How should Armenian localization change the implementation order and data model?

## the reference ERP Product Baseline

### Platform Breadth

the reference ERP 19 documentation exposes a broad app suite grouped into:

- Finance: Accounting/Invoicing, Expenses, Online Payments, Fiscal Localizations, ESG.
- Sales: CRM, Sales, Point of Sale, Subscriptions, Rental.
- Websites: Website, eCommerce, eLearning, Forum, Blog, Live Chat.
- Supply Chain: Inventory, Manufacturing, Purchase, Barcode, Quality, Maintenance, PLM, Repairs.
- HR: Attendances, Employees, Appraisals, Frontdesk, Fleet, Payroll, Time Off, Recruitment, Referrals, Lunch.
- Marketing: Email Marketing, Marketing Automation, SMS Marketing, Events, Surveys, Social Marketing.
- Services/Productivity: Project, Timesheets, Planning, Field Service, Helpdesk, Documents, Sign, Spreadsheet, Dashboards, Knowledge, Calendar, To-do, AI, Studio.

Source: [the reference ERP 19 User Docs](https://www.the reference ERP.com/documentation/19.0/applications.html).

### Finance And Accounting

the reference ERP Accounting/Invoicing covers chart of accounts, journals, multi-currency, taxes, fiscal positions, invoices, vendor bills, payments, bank/cash accounts, bank reconciliation, VAT/tax reports, budgets, year-end closing, analytic accounting, and custom reports.

Source: [the reference ERP Accounting and Invoicing](https://www.the reference ERP.com/documentation/19.0/applications/finance/accounting.html).

Comparison to A1:

- A1 already has a strong finance core: RA chart of accounts, double-entry ledger, invoices, expenses, bills/AP, payroll, VAT, reports, opening balances, period locks, SRC export packets, legal-source gates, and audit evidence.
- the reference ERP is broader in generic accounting operations: multi-currency, payment providers, bank synchronization, document digitization, analytic budgets, custom reports, and accounting-localization catalog.
- A1 should not chase generic global payment providers first. A1 should deepen Armenian accounting: SRC/ՀԴՄ, Armenian bank import/reconciliation, Armenian VAT/legal review, invoice evidence, payroll law updates, and accountant workpapers.

### CRM, Sales, Quotes, And Subscriptions

the reference ERP CRM manages leads, opportunities, Tubes, forecasts, meetings/next activities, lead acquisition from web forms/email/manual entry, quotation creation, predictive scoring, lead reports, and forecast reports.

Source: [the reference ERP CRM](https://www.the reference ERP.com/documentation/19.0/applications/sales/crm.html).

the reference ERP Sales extends quotation templates, margins, optional products, online signatures/payments, quote deadlines, delivery/invoice address separation, product variants, pricelists, foreign currencies, discounts, returns/refunds, eWallets/gift cards, loyalty programs, subscriptions, rental, and connectors.

Source: [the reference ERP Sales](https://www.the reference ERP.com/documentation/19.0/applications/sales/sales.html).

Comparison to A1:

- A1 has CRM leads, deals, quotes, public quote acceptance, governed quote release, finance proposal handoff, and Customer 360.
- Missing the reference ERP-style depth: products/variants, quote templates, pricelists, discounts, margins, returns, subscriptions, rental, sales order fulfillment, sales-to-inventory reservation, and customer portal.

### Inventory, Purchase, Warehouse, And Stock Valuation

the reference ERP Inventory is both inventory and warehouse management. It covers product tracking, serial/lot numbers, expiration dates, warehouses, locations, adjustments, cycle counts, scrap, replenishment, lead times, inter-warehouse replenishment, stock reports, inbound/outbound flows, routes, putaway, consignment, dropshipping, shipping carriers, picking methods, removal strategies, landed costs, valuation by lots/serials, and scrapped-goods accounting.

Source: [the reference ERP Inventory](https://www.the reference ERP.com/documentation/19.0/applications/inventory_and_mrp/inventory.html).

the reference ERP Purchase covers RFQs, purchase orders, blanket orders, tenders, purchase templates, control policies, vendor bills, demand-based suggested quantities, purchase analysis, vendor costs, procurement expenses, EDI purchase-to-sales import, and dashboards.

Source: [the reference ERP Purchase](https://www.the reference ERP.com/documentation/19.0/applications/inventory_and_mrp/purchase.html).

Comparison to A1:

- This remains one of A1's largest ERP gaps, but the first catalog/inventory/purchase spine is now shipped: product master rows, stock locations, stock balances, governed stock moves, Suite sidebar Inventory and Purchase workspaces, RFQ/PO -> partial/full receipt -> supplier return -> AP bill flow, billed-return credit notes with AP reversal evidence, pre-receipt landed-cost allocation evidence for receipt valuation, first vendor master/pricelist defaults, vendor lifecycle/pricelist risk evidence, receipt and return evidence, procurement analytics, Vendor 360 coverage/backlog panels, first blanket agreement coverage evidence, first purchase-to-sales replenishment suggestions, and first RFQ tender contract alignment from requisition line to quote and award draft PO. A1 still lacks warehouse operations depth, valuation accounting, lots/serials, advanced tender packages/portal/bid intake/comparative award matrices, post-receipt landed-cost revaluation/accounting, and MRP-grade replenishment planning beyond the first quote/open-PO demand queue.
- This should be the first major post-core module because it connects CRM quotes, finance invoices, eCommerce, POS, and Armenian retail/wholesale needs.

### Manufacturing, Quality, Maintenance, PLM, And Repairs

the reference ERP Manufacturing supports manufacturing orders, work-center control, shop-floor tablets, maintenance triggers, quality issues, bills of materials, one/two/three-step manufacturing, manufacturing costs, product variants, kits, multilevel BoMs, work centers, dependencies, master production schedule, scrap, backorders, split/merge orders, unbuild orders, by-products, lots/serial manufacturing, shop-floor time tracking, subcontracting, and production analysis.

Source: [the reference ERP Manufacturing](https://www.the reference ERP.com/documentation/19.0/applications/inventory_and_mrp/manufacturing.html).

the reference ERP PLM covers engineering change orders, ECO types/stages, version control, and approvals.

Source: [the reference ERP PLM](https://www.the reference ERP.com/documentation/19.0/applications/inventory_and_mrp/plm.html).

Comparison to A1:

- A1 has no MRP yet.
- Armenian SMB priority should be "light manufacturing and repair/service production" before full industrial MRP: BoMs, small workshop work orders, costing, serial/lot traceability, quality checks, and repair handoffs.

### POS And Retail

the reference ERP POS runs shops/restaurants in a browser, can work temporarily offline, registers stock moves automatically, consolidates data across shops, supports products, customers, refunds, cash register sessions, employee attribution, receipts/invoices, barcodes, lots/serials, loyalty, pricelists, flexible taxes, cash rounding, and payment terminals.

Source: [the reference ERP Point of Sale](https://www.the reference ERP.com/documentation/19.0/applications/sales/point_of_sale.html).

Comparison to A1:

- A1 now has a first POS cash-session, sale-posting, customer-linked sale/refund, fiscal-handoff, accounting, payment-split, terminal-settlement, processor-fee, refund-evidence, pre-receipt void-evidence, browser-local sale draft queue, and offline replay readiness spine: POS app entry, role-gated workspace, tenant-scoped cash sessions, register opening, Z-report-like closeout evidence, receipt range fields, durable sale/line/payment rows with optional customer linkage, cash expected-cash updates, source-key replay, stock delivery moves for stock-tracked fiscal items, checksum-backed local receipt handoff packets, local receipt print-preview evidence, split-aware sale revenue-VAT-settlement ledger journals, refund/void revenue-VAT-settlement reversal journals, closed-session card terminal settlement and processor-fee evidence, full-sale refund evidence with tracked-line stock return moves, first single partial refund amount evidence, line-level partial refund stock-return evidence, pre-receipt void evidence with tracked-line return moves, local offline replay queue evidence, browser-local sale draft persistence/manual retry, browser-offline sale capture draft evidence, durable offline-replay evidence bridging for local draft replays, safe automatic browser replay for network-failed and browser-offline sale drafts, conflict/needs-review handling, customer timeline events, audit events, and backup coverage.
- A1 still does not have full retail operations: full browser offline fiscal execution, live fiscal-device submission, physical printer commands, lots/serials, live payment-terminal provider feeds, chargeback reconciliation, loyalty, or deep barcode operations.
- For Armenia, POS must not be generic: it must continue toward fiscal receipt/ՀԴՄ handoff, cash session closeout, Z-report-like evidence, AMD cash rounding, offline mode, cashier roles, and stock/finance posting.

### Website, eCommerce, And Online Storefront

the reference ERP eCommerce covers product pages, checkout customization, delivery methods, sales/delivery order handling, customer accounts, B2B/B2C, performance monitoring, and Google Merchant Center.

Source: [the reference ERP eCommerce](https://www.the reference ERP.com/documentation/19.0/applications/websites/ecommerce.html).

Comparison to A1:

- A1 currently has public forms and public quote acceptance, but not full storefront/catalog/checkout/customer accounts.
- A1 should implement an "Armenian B2B/B2C portal" rather than a broad website builder first: catalog, cart, quote/request-order, customer documents, invoices, payments/receipts, delivery, and support tickets.

### HR, People, Attendance, Payroll, Fleet

the reference ERP Employees covers employee records, departments, contracts, certifications, badges, equipment, offboarding, retention reporting, and presence settings linked to attendance or user status.

Source: [the reference ERP Employees](https://www.the reference ERP.com/documentation/19.0/applications/hr/employees.html).

Comparison to A1:

- A1 has People-HR employee registry and payroll-to-ledger seam.
- Missing: departments, contracts, leave/time-off, attendance, onboarding/offboarding, equipment, fleet, recruitment, appraisals, certifications, and richer HR analytics.
- Armenian priority: employment contract templates, work schedule, absence/overtime evidence, payroll law calculations, and HR document packets.

### Projects, Timesheets, Field Service, Helpdesk

the reference ERP Project manages tasks, activities, profitability, milestones, templates, recurring tasks, subtasks, and task dependencies.

Source: [the reference ERP Project](https://www.the reference ERP.com/documentation/19.0/applications/services/project.html).

the reference ERP Helpdesk is ticket-based support with configurable teams, dashboards, Tubes, ticket stages, prioritization, and customer submission flows.

Source: [the reference ERP Helpdesk](https://www.the reference ERP.com/documentation/19.0/applications/services/helpdesk.html).

Comparison to A1:

- A1 has projects, project template evidence, recurring task evidence, tasks, subtask hierarchy evidence, task dependency evidence, milestones, time entries, project billing, project-level profitability evidence, task/product/field-visit cost-basis profitability evidence, service cases, SLA policy evidence and editing UX, field service visit planning evidence, worksheet summaries, assigned-technician visit workflow, offline-safe technician dispatch queue and idempotent replay evidence, mobile/PWA technician dispatch shell evidence with map/navigation links, technician GPS/geolocation capture evidence, browser dispatch alert feed and acknowledgement evidence, local service-worker dispatch notification readiness, schedule/location route-plan evidence, field-service cost allocation evidence with linked stock-move material consumption and valuation-status evidence, support replies, escalations, and Customer 360.
- Missing the reference ERP-style depth: native offline map tiles, externally triggered background push dispatch alerts, live distance-matrix/traffic-aware route optimization, and posted accounting-grade field-service cost allocation across payroll, travel/procurement, and service-cost ledger journals.

### Documents, Sign, Knowledge, Spreadsheet, Dashboards

the reference ERP Documents centralizes files across apps, supports upload/drag-drop, URL links, requested documents, linking files to specific records, and saving record attachments to Documents.

Source: [the reference ERP Documents](https://www.the reference ERP.com/documentation/19.0/applications/productivity/documents.html).

the reference ERP Sign supports online signing, templates, envelopes, prepared/non-prepared signing, auto-complete fields from database data, and signer authentication options.

Source: [the reference ERP Sign](https://www.the reference ERP.com/documentation/19.0/applications/productivity/sign.html).

Comparison to A1:

- A1 has Docs & Sign lifecycle, multi-signer evidence, consent chain, SHA-256, export certificate, and Armenian legal-source prerequisites.
- Missing: file cabinet/workspaces, cross-app attachment centralization, requested document workflow, envelopes, richer template library, and document-to-record linkage UX.

### Studio, No-Code Customization, Automation, And Webhooks

the reference ERP Studio lets users customize fields, views, models, apps, automation rules, webhooks, PDF reports, approval rules, and security rules without coding.

Source: [the reference ERP Studio](https://www.the reference ERP.com/documentation/19.0/applications/studio.html).

Comparison to A1:

- A1 has fixed modules, workflow rules, approvals, webhooks, and audit.
- Missing: tenant-configurable fields, custom views, custom report templates, per-role layout customization, form builder into data models, and safe no-code automation.
- This is strategically important, but should follow stable core inventory/sales schemas so custom fields have durable anchors.

### AI Agents And AI Fields

the reference ERP 19 AI includes AI agents with topics, tools, sources, and model selection. Agents can use topics/tools to take actions such as opening views or creating leads; sources can include PDFs, web links, uploaded Documents, and Knowledge articles. the reference ERP also has AI fields that generate/suggest values on forms from record context.

Sources: [the reference ERP AI Agents](https://www.the reference ERP.com/documentation/19.0/applications/productivity/ai/agents.html), [the reference ERP AI Fields](https://www.the reference ERP.com/documentation/19.0/applications/productivity/ai/fields.html).

Comparison to A1:

- A1 already has a domain-specific Armenian legal/accounting Copilot with source gates, citations, professional review, action proposals, and local/offline legal RAG.
- the reference ERP AI is broader across the app framework. A1 should add the reference ERP-like "agent topics and tools" but keep stronger guardrails: Armenian legal/accounting gates, explicit approvals for mutations, local-first retrieval, and egress disabled by default.

### Deployment And Pricing

the reference ERP pricing and documentation indicate multiple deployment modes: the reference ERP Online, the reference ERP.sh, and on-premise. The pricing page says Standard/Custom include all apps for one fee and notes the reference ERP Online hosting limitations around custom modules; the reference ERP documentation separately covers installing, maintaining, upgrading, and source-installing the reference ERP on premise.

Sources: [the reference ERP Pricing](https://www.the reference ERP.com/pricing), [the reference ERP On-premise Documentation](https://www.the reference ERP.com/documentation/19.0/administration/on_premise.html), [the reference ERP Source Install](https://www.the reference ERP.com/documentation/19.0/administration/on_premise/source.html), [the reference ERP.sh Documentation](https://www.the reference ERP.com/documentation/19.0/administration/the reference ERP_sh.html).

Comparison to A1:

- A1's main advantage is product posture: private, local, sovereign, Armenian-first, and intentionally deployment-simple.
- the reference ERP is mature but broad, upgrade-heavy, partner/ecosystem-dependent, and local Armenian compliance is not first-party in the official docs reviewed.

### Armenian Localization Gap

The official the reference ERP fiscal localization list reviewed covers many countries but did not show Armenia in the visible the reference ERP 19 accounting localization list. A third-party the reference ERP Apps Store module exists for Armenian accounting/localization, priced separately, with Armenian chart of accounts, cities, states, and ZIP/postal-address support.

Sources: [the reference ERP Accounting/Fiscal Localizations](https://www.the reference ERP.com/documentation/19.0/applications/finance/accounting.html), [Armenian Accounting and Localization third-party app](https://apps.the reference ERP.com/apps/modules/16.0/l10n_hy).

Implication for A1:

- Armenian localization must be first-party, not an add-on.
- A1 should define localization as a platform layer: Armenian labels, RA chart of accounts, AMD, ՀՎՀՀ, regional addresses, VAT/SRC/ՀԴՄ, Armenian payroll, labor-law document packets, legal source registry, bilingual document templates, and Armenian AI prompts/evaluations.

## A1 Suite Current Baseline

Source: local `HANDOFF.md` and `docs/PRODUCT_BASELINE.md` in `~/dev/A1-Suite-Local`.

Current A1 strengths:

- CRM: leads, deals, quotes, public quote acceptance, activity timeline, Customer 360.
- Finance: RA accounting, ledger, AR/AP, payroll, VAT, bank import, opening balances, period close, SRC export packet.
- Desk: service cases, replies, escalations, knowledge-grounded support summaries.
- People-HR: employee registry and payroll seam.
- Docs & Sign: templates, signer lifecycle, evidence packets, export certificate.
- Projects: project/task/milestone/time entries, task dependency evidence, project billing, project-level profitability evidence, task/product/field-visit cost-basis profitability evidence.
- Forms/Campaigns: public forms, lead intake, rate limits.
- Copilot: Armenian legal/accounting advisory, citations, guarded proposed actions, Open Notebook supplemental sources.
- Security/governance: RBAC, MFA/session controls, audit packets, tenant routing, public route throttling, payload redaction, many malformed-input/path-id guards.

Major A1 gaps relative to the reference ERP:

| Area | the reference ERP capability | A1 status | Priority |
|---|---|---|---|
| Product catalog | Products, variants, UoM, pricelists, discounts, margins | Shipped core product master + quote-line integration + Catalog & Inventory UI + governed UoM catalog + seeded variant spine + margin evidence + first sales pricelist spine + first sales discount evidence + first margin-rule evidence + read-only price resolution + quote-line resolver consumption + variant-aware quote lines + quote-line pricing evidence + quote-line pricing evidence UI + first quantity-break discount evidence + first category-scoped margin-rule evidence + quote-line margin-rule provenance; advanced configurable discount and margin-rule management still missing | P0 |
| Inventory/WMS | Warehouses, locations, stock moves, lots/serials, replenishment, valuation | Shipped core locations/quants/moves + sidebar workspace + first purchase replenishment suggestions; advanced WMS, lots/serials, and valuation still missing | P0 |
| Purchase/procurement | RFQ, PO, vendor pricelists, tender/blanket orders, vendor bills | Shipped RFQ/PO -> partial/full receipt -> supplier return -> AP bill spine plus billed-return credit-note/AP reversal evidence, pre-receipt landed-cost allocation evidence for receipt valuation, first Purchase sidebar workspace, vendor/pricelist defaults, vendor lifecycle/pricelist risk evidence, receipt/return evidence, procurement analytics, Vendor 360, purchase-to-sales replenishment suggestions, blanket agreement coverage evidence, and RFQ tender contract alignment; advanced tender packages/portal/bid intake/comparative award matrices and post-receipt landed-cost revaluation/accounting still missing | P0 |
| POS | Browser POS, offline mode, cash sessions, stock sync, receipts | First cash-session/fiscal closeout spine, cash sale posting, optional customer-linked sales/refunds, tracked-item stock decrement, checksum-backed fiscal receipt handoff packets, local receipt print-preview evidence, full-sale and line-level partial refund evidence with tracked-line stock return moves, first single partial refund amount evidence, pre-receipt void evidence with stock/cash/ledger reversal evidence, split payment evidence, split-aware sale revenue/VAT settlement journals, closed-session card terminal settlement evidence, processor-fee reconciliation evidence, local offline replay queue readiness, browser-offline sale capture draft evidence, durable local-draft replay evidence bridging, and safe automatic browser replay for network-failed/browser-offline sale drafts shipped; full browser offline fiscal execution, live fiscal-device submission, physical printer commands, lots/serials/barcode depth, live terminal feeds, and chargeback reconciliation still missing | P1 |
| eCommerce/portal | Storefront, checkout, B2B/B2C, customer accounts | Public forms/quotes only | P1 |
| Manufacturing/MRP | BoM, work orders, shop floor, MPS, quality, maintenance | Missing | P2 |
| HR depth | contracts, leave, attendance, recruitment, equipment, fleet | Payroll registry only | P2 |
| Marketing | email/SMS/social campaigns, segmentation, unsubscribe, attribution | Campaign performance exists, campaign execution missing | P2 |
| Documents cabinet | centralized files, requested docs, linked attachments | Sign/doc lifecycle exists, file cabinet missing | P2 |
| Studio/no-code | custom fields/views/models/reports/approval rules | Missing | P3 |
| AI agents | app-wide agents, topics, tools, sources | Copilot exists but not generalized agent platform | P3 |
| Spreadsheet/dashboards | user-built live reports and spreadsheet-like analytics | Analytics/report packets exist, builder missing | P3 |

## Implementation Principles

1. Keep one local SQLite/Fastify/React suite process unless scale evidence forces a split.
2. Every new app must attach to the same customer/product/document/audit graph.
3. Armenian localization is not translation. It is first-party business logic: RA tax/accounting, AMD, ՀՎՀՀ, SRC/ՀԴՄ, legal source gates, Armenian addresses, Armenian document templates.
4. Build "deep workflow slices" before broad shallow screens.
5. Prefer deterministic accounting/audit behavior over AI autonomy.
6. AI may propose and draft; governed workflows approve and execute.
7. All public/portal flows must inherit A1's existing rate limits, tenant scoping, redaction, and evidence rules.

## Recommended Implementation Roadmap

### Phase 0 - Shared Product And Localization Kernel

Goal: Create the data spine required for the reference ERP-like sales, inventory, purchase, POS, eCommerce, and manufacturing.

Deliverables:

- Product master:
  - `products`, `product_variants`, `product_categories`, `units_of_measure`, `product_barcodes`, `product_prices`.
  - Armenian fields: Armenian display name, English/Russian optional names, SKU, barcode, VAT class, excise marker, fiscal receipt category.
  - Product audit events and import/export.
- Localization dictionary:
  - Armenian administrative regions/cities.
  - ՀՎՀՀ validation helper.
  - AMD currency/rounding policy.
  - Tax regime profile per tenant.
  - Localized labels for product, warehouse, purchase, POS, manufacturing, portal.
- Shared order primitives:
  - `sales_orders`, `sales_order_lines`, `fulfillment_status`, `billing_status`.
  - Keep quote -> order -> invoice path distinct from existing quote -> acceptance -> draft invoice path.
- Tests:
  - product CRUD and role gates.
  - ՀՎՀՀ validation.
  - product VAT class to invoice line mapping.
  - product import rejects malformed metadata.

Acceptance:

- CRM quote can reference products/variants.
- Finance invoice lines can be product-linked without breaking existing HayHashvapah posting.
- Product creation is Armenian-first and audit-backed.

### Phase 1 - Inventory And Purchase Core

Goal: Close the largest the reference ERP gap first.

Deliverables:

- Inventory:
  - `warehouses`, `stock_locations`, `stock_quants`, `stock_moves`, `stock_move_lines`.
  - Receive, deliver, adjust, scrap, transfer.
  - Lot/serial tracking optional per product.
  - Stock valuation handoff to Finance.
  - Replenishment report and low-stock alerts.
- Purchase:
  - vendors, vendor pricelists, RFQ, purchase order, receiving, vendor bill generation.
  - PO -> partial/full stock receipts -> AP bill -> payment.
  - Shipped core backend, first sidebar workspace, vendor/pricelist defaults, procurement analytics, and first supplier returns on 2026-06-06: RFQ/PO records, confirmation, partial/full receipt to `WH/STOCK`, unbilled return from `WH/STOCK` to `SUPPLIERS`, AP bill generation after full net receipt, receipt/return evidence, idempotency, role gates, period-lock reuse, backup inclusion, RFQ creation, progression controls, vendor creation, vendor-price default costing, Vendor 360, price coverage, returned quantity, and receipt backlog.
  - Pre-receipt landed-cost allocation evidence for receipt valuation; post-receipt revaluation/accounting remains future scope.
- Armenian localization:
  - Armenian supplier fields and ՀՎՀՀ.
  - Armenian PO and delivery-note templates.
  - Stock valuation entries mapped to RA chart accounts.
- UI:
  - Inventory app in sidebar (shipped as Catalog & Inventory workspace on 2026-06-06).
  - Purchase app in sidebar (first RFQ/order/progression workspace shipped on 2026-06-06).
  - Product detail stock ledger.
  - Customer 360 and Vendor 360 inventory/procurement panels.
- Tests:
  - receive PO posts stock and AP bill evidence.
  - delivery reduces stock and creates COGS/valuation evidence when configured.
  - malformed product/warehouse/location IDs rejected before mutation.
  - role gates: Accountant/Operations/Owner only.

Acceptance:

- A1 can sell and purchase real products, track stock, and produce accounting evidence.

### Phase 2 - POS And Retail Fiscal Workflow

Goal: Build Armenian retail flow with the reference ERP-like browser POS but A1-specific fiscal evidence.

Shipped slices:

- POS app entry, app-assignment guards, and modern `/app/pos` workspace.
- Tenant-scoped `pos_cash_sessions` for cashier/register opening, expected/count cash, difference evidence, fiscal device, Z-report number, receipt range, audit events, and backup coverage.
- POS workspace endpoint with current session, recent sessions, fiscal catalog preview, customer preview, stock location preview, closeout labels, and explicit capability flags for sale, inventory, refund, offline, receipt-printing, and ledger status.
- Durable `pos_sales`, `pos_sale_lines`, and `pos_sale_payments` with `POST /api/pos/cash-sessions/:id/sales`, optional customer linkage, optional cash/card/bank-transfer payment split evidence, same-session source-key replay, duplicate receipt protection, VAT-inclusive totals, cash expected-cash updates based only on the cash portion, customer timeline event linkage, and stock delivery moves for tracked fiscal items.
- Modern POS sale capture panel for one-line fiscal catalog sales with optional split-payment entry and visible payment and sale ledger journal evidence while keeping fiscal-device submission and offline replay deferred.
- Durable `pos_receipt_packets` and `POST /api/pos/sales/:id/receipt-packet` prepare checksum-backed local fiscal receipt handoff evidence for posted POS sales, replay by sale, include sale/session/line/fiscal metadata, and explicitly avoid live fiscal-device submission.
- Durable local receipt print-preview evidence on `pos_receipt_packets` and `POST /api/pos/sales/:id/receipt-print` now require a prepared receipt packet, replay by sale, store print status/checksum/payload/copy-count evidence, and explicitly avoid live fiscal-device submission or physical printer commands.
- The modern POS workspace exposes post-sale receipt packet and local print-preview evidence actions for the last posted sale, showing packet/print status, checksums, preview lines, and not-submitted device state without claiming legal fiscalization or live printer submission.
- Durable `pos_offline_replay_items`, `GET /api/pos/offline-replay-items`, `POST /api/pos/offline-replay-items`, and `POST /api/pos/offline-replay-items/:id/mark-replayed` now record checksum-backed local replay queue evidence for sale/refund/void/receipt/terminal actions, list recent queue items, and mark queued evidence replayed or rejected without executing the underlying POS mutation.
- The modern POS workspace exposes an offline replay readiness panel with local queue capability, sample queue evidence, replay/reject marking, recent queue status, and browser-local sale draft replay state while keeping true browser-offline execution, fiscal-device submission, terminal submission, and printer commands deferred.
- The modern POS workspace now has a browser-local sale draft queue for the first offline execution step: sale form payloads can be queued explicitly by the cashier, queued immediately when the browser is offline, or queued automatically after network/backend-unavailable failures, persisted in localStorage with the original idempotency key and customer/payment/receipt evidence, linked to deterministic durable `pos_offline_replay_items` evidence before manual/automatic replay, marked replayed after successful sale posting, manually retried, or safely auto-replayed on load/online/focus when they were queued after failed posting or browser-offline capture. Closed-session, receipt/source conflict, auth, validation, and schema failures stay visible as needs-review evidence instead of retrying forever.
- Durable `pos_sale_refunds` and `pos_sale_refund_lines` with `POST /api/pos/sales/:id/refund` record full-sale, first single partial refund amount, line-level partial stock-return evidence, and inherited customer linkage, replay by source key, reject already-refunded/unposted sales, copy original sale-line evidence, create tracked-line customer return stock moves for full and requested partial-line refunds, mark the sale `refunded_full` or `refunded`, update the customer timeline when linked, and include tenant-backup coverage.
- Cash full-sale refund evidence reduces open-session expected cash by the original paid-cash amount; cash partial refund evidence reduces expected cash by the partial amount; card and bank-transfer refund evidence records the reversal without changing drawer cash. Tracked sale lines now restock through linked customer-to-internal return stock moves for full refunds and requested line-level partial returns, amount-only partial refunds remain no-restock goodwill evidence, sale ledger journals split revenue and output VAT across cash/bank/card-clearing settlement accounts by payment evidence, refund ledger journals post reversal evidence, and closed card sessions can post terminal settlement evidence from card clearing to bank with optional processor-fee expense evidence. Fiscal refund submission, live receipt printer/fiscal-device submission, live terminal feeds, and chargeback handling remain deferred.
- The modern POS workspace exposes a post-sale refund evidence form for the last posted sale, supports optional partial refund amount and per-line return quantity evidence, renders refund status, amount, method, cash adjustment, inventory-posted status, return stock move count, returned-line quantity evidence, and ledger status, and locks duplicate refund entry after success.
- Durable `pos_sale_voids` and `pos_sale_void_lines` with `POST /api/pos/sales/:id/void` record pre-receipt void evidence, replay by source key, reject receipt-handoff/refunded/unposted sales, create tracked-line customer return stock moves, reduce open-session expected cash by the paid cash amount, mark the sale `voided`, post void reversal ledger journals, and include tenant-backup coverage.
- The modern POS workspace exposes a post-sale void evidence form for the last posted sale, renders void reference, sale status, voided total, cash adjustment, inventory-posted status, return stock move count, and ledger journal count, and locks refund/receipt actions once voided.

Deliverables:

- Browser POS:
  - POS sessions, cashier assignment, opening/closing cash control. First cash-session spine and one-line sale capture shipped; richer sale controls remain.
  - local offline replay readiness queue evidence, first browser-local sale draft storage/manual retry, browser-offline sale capture drafts, durable local-draft replay evidence bridging, and safe automatic replay/conflict surfacing for network-failed/browser-offline sale drafts shipped; full fiscal/printer/terminal offline execution remains.
  - customer selection, discounts, returns/refunds. First customer selector and customer-linked sale/refund evidence, first full-sale refund evidence, tracked-line return stock moves, single partial refund amount evidence, line-level partial stock returns, and pre-receipt void evidence shipped; richer customer history/loyalty UI remains.
  - barcode input.
  - stock decrement for tracked sale lines plus full-sale and line-level partial tracked refund restock shipped; reservations and lots/serials remain.
- Fiscal layer:
  - ՀԴՄ handoff packet model. First local checksum-backed handoff packet shipped; live submission remains.
  - receipt number evidence. First receipt-range closeout, sale receipt packet, and local print-preview evidence shipped.
  - cash/card/payment-method split. First cash/card/bank-transfer payment split evidence shipped for sale capture, response payloads, receipt packets, cash expected-cash, card terminal clearing, and sale ledger postings.
  - Z-report-like session close evidence. First closeout evidence shipped.
  - integration placeholder for local fiscal device/provider.
- Finance integration:
  - POS sale -> revenue/VAT/cash/bank/card-clearing journal. First balanced sale ledger posting, split-aware sale settlement journals, card terminal clearing-to-bank settlement, and terminal processor-fee posting shipped; live terminal feeds and chargebacks remain.
  - returns -> credit/refund journal. First balanced full-sale refund, single partial refund, line-level partial stock-return refund, backend customer-linked refund evidence, and pre-receipt void reversal journals shipped.
- Tests:
  - offline queued sale replays idempotently.
  - session cannot close with unsafe cash discrepancy metadata.
  - POS sale, receipt packet, receipt print-preview, refund evidence, void evidence, and offline replay queue evidence replay idempotently, stock updates for tracked sale items, cash refunds/voids adjust the open drawer, and sale/refund/void evidence posts balanced ledger journals.

Acceptance:

- A small Armenian shop can run daily sales, close cash, update inventory, and hand accountant fiscal evidence.

### Phase 3 - Customer Portal And Armenian eCommerce

Goal: Turn public forms/quotes into a real customer-facing business portal.

Deliverables:

- Storefront:
  - product catalog, categories, search, product page, price/VAT display.
  - B2B request quote and B2C checkout.
  - delivery method configuration.
  - customer account and order history.
- Portal:
  - invoices, quotes, documents, service tickets, signature requests.
  - Armenian-first templates and bilingual optional view.
- Payment:
  - local bank transfer evidence first.
  - payment provider adapter interface later.
- Tests:
  - public catalog tenant scoping.
  - cart/order cannot leak foreign tenant products.
  - checkout creates sales order and governed finance handoff.

Acceptance:

- A1 supports online order intake without sacrificing local deployment.

### Phase 4 - Light Manufacturing, Repair, And Quality

Goal: Capture the reference ERP MRP's most valuable SMB workflows without overbuilding enterprise MRP.

Deliverables:

- BoM and kits.
- Manufacturing order.
- Work orders and work centers.
- Material consumption and finished goods receipt.
- Basic costing into Finance.
- Quality check and quality alert.
- Repair order linked to Service Desk.
- Serial/lot traceability.

Armenian localization:

- Armenian production acts, material write-off documents, repair acceptance/handover templates.
- Payroll/time linkage for shop-floor labor costing.

Acceptance:

- A bakery, workshop, repair center, or light manufacturer can plan/complete production and trace costs.

### Phase 5 - HR Depth And Workforce Operations

Goal: Move People-HR from payroll registry to operating HR.

Deliverables:

- Departments and positions.
- Employment contracts and contract templates.
- Attendance and time-off.
- Overtime evidence.
- Equipment assignment.
- Onboarding/offboarding checklist.
- Recruitment Tube.
- Fleet basics.

Armenian localization:

- Armenian labor contract templates.
- vacation/sick leave/overtime calculations.
- employment document packets.
- Armenian payroll law source linkage.

Acceptance:

- People-HR supports the employee lifecycle, not only payroll posting.

### Phase 6 - Marketing, Communications, And Omnichannel Intake

Goal: Add the reference ERP-style campaign execution but tuned to Armenian SMB channels.

Deliverables:

- Email campaign builder with templates, segments, unsubscribe/blacklist, schedule, click/open stats.
- SMS/Telegram/WhatsApp connector abstractions.
- Lead attribution from campaigns.
- Campaign -> CRM lead/deal -> quote -> invoice attribution.
- Consent ledger integrated with privacy module.

Armenian localization:

- Armenian language templates.
- Consent wording for Armenian personal-data law.
- Local telecom/provider adapters.

Acceptance:

- A1 can run compliant Armenian campaigns and measure Tube/revenue impact.

### Phase 7 - Documents Cabinet, Knowledge, Spreadsheet, Dashboards

Goal: Convert A1 from operational app to office operating layer.

Deliverables:

- Document workspaces/folders.
- Linked attachments for every record.
- requested document workflow.
- Knowledge articles with source status.
- Spreadsheet-like report builder over curated semantic tables.
- Dashboard builder per role.

Localization:

- Armenian document type taxonomy.
- Armenian legal/accounting knowledge source review.
- bilingual export templates.

Acceptance:

- Users can keep documents and reports inside A1 rather than external file shares.

### Phase 8 - Studio-Lite And Safe Automation

Goal: Offer the reference ERP Studio's business flexibility without letting tenants break audited Armenian flows.

Deliverables:

- Custom fields for allowed models.
- custom form/list layouts.
- approval rules.
- report templates.
- safe webhook builder.
- automation rules with dry-run/test-event.
- migration-safe schema metadata.

Guardrails:

- No custom field can override legal/accounting canonical fields.
- All automation must be role-gated and audit-backed.
- AI-generated automations require preview and approval.

Acceptance:

- A1 can adapt to SMB-specific processes without code changes.

### Phase 9 - A1 AI Agent Platform

Goal: Generalize Copilot into the reference ERP-style agents while keeping A1's stronger governance.

Deliverables:

- Agent registry:
  - agent, topic, tool, source, model policy, response style.
- Source registry:
  - legal KB, documents, knowledge articles, customer records, product records.
- Tool registry:
  - read-only tools by default.
  - mutation tools require workflow approval unless explicitly low-risk.
- Armenian agent presets:
  - Accountant Copilot.
  - Legal/Privacy Copilot.
  - Sales Copilot.
  - Support Copilot.
  - Inventory/Purchase Copilot.
  - HR Copilot.
- Evaluation:
  - Armenian prompt fixtures.
  - citation-required legal/accounting answers.
  - refusal tests for unsafe autonomous actions.

Acceptance:

- A1 can answer and draft across all modules, but cannot silently mutate critical business/legal/accounting records.

## Suggested Execution Order

1. Product catalog and localization kernel.
2. Inventory core.
3. Purchase/procurement first spine, sidebar workspace, vendor/pricelist defaults, vendor lifecycle/pricelist risk evidence, partial receipts, supplier returns, billed-return credit notes, pre-receipt landed-cost evidence, Vendor 360 analytics, purchase-to-sales replenishment suggestions, blanket agreement coverage evidence, and RFQ tender contract alignment (shipped incrementally from 2026-06-06); next: advanced tender packages/portal/bid intake/comparative award matrices and post-receipt landed-cost revaluation/accounting.
4. Sales orders and product-aware quotes.
5. POS with Armenian fiscal evidence; first cash-session closeout, cash sale posting, customer-linked sale/refund evidence and first selector, payment split evidence/accounting, stock decrement, local receipt handoff packets, local receipt print-preview evidence, offline replay queue readiness, browser-local sale draft queue/manual retry, browser-offline sale capture draft evidence, durable local-draft replay evidence bridging, safe automatic replay/conflict surfacing, full-sale refund evidence, single partial refund amount evidence, line-level partial stock-return refund evidence, pre-receipt void evidence, sale/refund/void ledger journals, closed-session card terminal settlement evidence, and processor-fee reconciliation evidence shipped, next focus is full browser offline fiscal execution, live fiscal-device handling, richer returns, live terminal feeds, and chargeback reconciliation.
6. Customer portal and eCommerce.
7. Light MRP/repair.
8. HR depth.
9. Marketing automation.
10. Documents cabinet and knowledge.
11. Spreadsheet/dashboard builder.
12. Studio-lite.
13. AI agent platform.

This order gives A1 the highest practical ERP lift while preserving the current Armenian accounting/legal moat.

## First Three Engineering Milestones

### Milestone 1 - Product Catalog + Quote/Invoice Product Lines

Files likely touched:

- `server/app.js`
- `server/db.js`
- `web/src/main.jsx`
- `test/api.test.js`
- new `test/products.test.js`
- `docs/PRODUCT_BASELINE.md`

Implementation:

- Add products, categories, variants, UoM, barcode, VAT class.
- Add product picker to CRM quote line creation.
- Preserve free-text quote lines.
- Map product-linked quote acceptance into finance draft invoice lines.
- Add product panel to Customer 360.

### Milestone 2 - Warehouse Stock Moves

Files likely touched:

- new `server/inventory.js`
- `server/app.js`
- `server/db.js`
- `web/src/main.jsx`
- new `test/inventory.test.js`

Implementation:

- Add warehouses, locations, stock moves, stock balances.
- Add receive, adjust, transfer, deliver.
- Add role gates and audit.
- Add product stock ledger UI.

### Milestone 3 - Purchase RFQ/PO To Vendor Bill

Files likely touched:

- new `server/purchase.js`
- `server/app.js`
- finance bill endpoints/tests.
- `web/src/main.jsx`
- new `test/purchase.test.js`

Implementation:

- First backend/UI slice shipped on 2026-06-06:
  - Added tenant-scoped purchase orders and purchase order lines.
  - PO confirmation, receipt, and billing progress through explicit guarded endpoints.
  - Partial/full receipt updates stock through canonical stock receipt moves into `WH/STOCK`.
  - Vendor bill links to the fully received PO and posts to AP through existing Finance.
  - Added first Purchase sidebar workspace for RFQ creation and Confirm/Receive/Bill progression.
  - Added first vendor master/pricelist layer with vendor-price-backed RFQ costs and persisted line evidence.
  - Added partial receipt status, receipt history, over-receipt guards, idempotent receipt references, and UI receive-quantity controls.
  - Added procurement analytics endpoint and Purchase workspace Vendor 360 panel with receipt progress, usable active-price coverage, active covered items, returned quantity, top vendor performance, and confirmed/partial receipt backlog.
  - Added vendor lifecycle/pricelist risk evidence with usable/expired/future/archived/expiring price counts and active-only vendor selection hardening for RFQ, AI supplier selection, replenishment, and Purchase analytics.
  - Added unbilled supplier returns with `WH/STOCK -> SUPPLIERS` stock moves, return evidence, status rollback, idempotent references, backup inclusion, analytics returned quantity, and Purchase workspace Return controls.
  - Added pre-receipt landed-cost allocation evidence with durable header/line rows, Purchase detail/read-model exposure, backup inclusion, and landed-inclusive receipt stock-move valuation.
  - Added blanket agreement coverage evidence with active-window filtering, open-PO consumption, remaining/uncovered quantity, enriched vendor/item rows, and a modern Procurement coverage tab.
  - Added RFQ tender contract alignment with non-empty requisition lines, nested RFQ conversion, RFQ quote capture, RFQ award to draft PO, stable quote/award response evidence, and a modern Procurement workspace wired to the live backend route chain.
  - Auditor read-only coverage, backup inclusion, period-lock blocking, sanitized malformed metadata/path guards, duplicate PO-number `409`, app-assignment role guards, and idempotent retries are covered by tests.
- Remaining:
  - Advanced tender packages, supplier portal/bid intake, comparative award matrices, and post-receipt landed-cost revaluation/accounting.

## Localization Checklist

Each new module must ship with:

- Armenian-first UI copy.
- optional English/Russian labels only where needed for customer-facing documents.
- AMD display and rounding.
- ՀՎՀՀ fields and validation for organizations/customers/vendors.
- Armenian address region/city dictionary.
- RA chart-of-accounts mapping.
- VAT category mapping.
- legal/accounting source references where the workflow implies compliance.
- offline-safe operation and egress-off defaults.
- tenant-local exports suitable for accountant/lawyer review.

## Research Methodology

The research pass used official the reference ERP documentation and the the reference ERP Apps Store where possible. Firecrawl/Exa MCP tools from the `deep-research` skill were not exposed in this Codex session, so the available web search/browser tool was used instead.

Sources reviewed:

1. [the reference ERP 19 User Docs](https://www.the reference ERP.com/documentation/19.0/applications.html) - app suite taxonomy.
2. [the reference ERP Accounting and Invoicing](https://www.the reference ERP.com/documentation/19.0/applications/finance/accounting.html) - finance/accounting scope.
3. [the reference ERP CRM](https://www.the reference ERP.com/documentation/19.0/applications/sales/crm.html) - CRM scope.
4. [the reference ERP Sales](https://www.the reference ERP.com/documentation/19.0/applications/sales/sales.html) - sales order, quoting, pricing, subscriptions.
5. [the reference ERP Inventory](https://www.the reference ERP.com/documentation/19.0/applications/inventory_and_mrp/inventory.html) - WMS and stock features.
6. [the reference ERP Purchase](https://www.the reference ERP.com/documentation/19.0/applications/inventory_and_mrp/purchase.html) - procurement scope.
7. [the reference ERP Manufacturing](https://www.the reference ERP.com/documentation/19.0/applications/inventory_and_mrp/manufacturing.html) - MRP scope.
8. [the reference ERP PLM](https://www.the reference ERP.com/documentation/19.0/applications/inventory_and_mrp/plm.html) - engineering change/approval scope.
9. [the reference ERP Point of Sale](https://www.the reference ERP.com/documentation/19.0/applications/sales/point_of_sale.html) - retail/POS scope.
10. [the reference ERP eCommerce](https://www.the reference ERP.com/documentation/19.0/applications/websites/ecommerce.html) - storefront/checkout scope.
11. [the reference ERP Employees](https://www.the reference ERP.com/documentation/19.0/applications/hr/employees.html) - HR employee scope.
12. [the reference ERP Project](https://www.the reference ERP.com/documentation/19.0/applications/services/project.html) - project management scope.
13. [the reference ERP Helpdesk](https://www.the reference ERP.com/documentation/19.0/applications/services/helpdesk.html) - support ticket scope.
14. [the reference ERP Documents](https://www.the reference ERP.com/documentation/19.0/applications/productivity/documents.html) - document cabinet scope.
15. [the reference ERP Sign](https://www.the reference ERP.com/documentation/19.0/applications/productivity/sign.html) - online signature scope.
16. [the reference ERP Studio](https://www.the reference ERP.com/documentation/19.0/applications/studio.html) - no-code customization scope.
17. [the reference ERP AI Agents](https://www.the reference ERP.com/documentation/19.0/applications/productivity/ai/agents.html) - AI agents, topics, tools, sources.
18. [the reference ERP AI Fields](https://www.the reference ERP.com/documentation/19.0/applications/productivity/ai/fields.html) - AI-generated form values.
19. [the reference ERP Pricing](https://www.the reference ERP.com/pricing) - deployment/pricing modes.
20. [the reference ERP On-premise Documentation](https://www.the reference ERP.com/documentation/19.0/administration/on_premise.html) - on-prem install/maintenance category.
21. [Armenian Accounting and Localization App](https://apps.the reference ERP.com/apps/modules/16.0/l10n_hy) - third-party Armenia localization evidence.
