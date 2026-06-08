# Sub-Plan 6: Export Documentation (Экспортная документация) — User Priority #6

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete export-documentation suite uniquely valuable in Armenia: Invoice, Packing List, CMR, TIR, Certificate of Origin, Phytosanitary Certificate, Export Declaration, Veterinary Certificate, plus AI features (auto-fill, error check, HS code check, country rules). Spayka-targeted modes: Russia, EAEU, EU, UAE, Hong Kong, Philippines.

**Architecture:** Pattern A module `server/exportDocs.js` (pure engine: document renderers per kind, HS-code validation, country-rule pack loader, AI auto-fill) + `web/src/exportDocs.jsx` panel (3-step wizard: Pick template → Fill from linked SO/PO → Validate → Export PDF/XML) + `test/export-docs.test.js`. Reuses the existing `customers` (foreign buyer), `vendors`, `products` (HS code), `stock_moves` (shipment) graph. New tables: `export_documents`, `export_document_lines`, `hs_code_rules`, `country_rule_packs`, `export_declarations`, `export_signatures`.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. PDF generation via local `pdfkit`-style output (or Puppeteer if already a dep) — fall back to a deterministic HTML/print template if no PDF lib is acceptable. Country rule packs are versioned JSON in `server/exportDocs/rules/<country>.json` and loaded at boot. AI features via `server/exportDocsAi.js` mirroring Copilot.

**Depends on:** sub-plan 0 (Pattern A skeleton), existing products / stock moves. Country-rule data is bundled in-repo (no network).

---

## DB additions

- `export_documents` (id, org_id, kind, destination_country, incoterm, currency, status, linked_so_id, linked_po_id, ship_from, ship_to, created_at, finalized_at, file_id)
- `export_document_lines` (id, export_doc_id, product_id, hs_code, description, quantity, uom, unit_price, net_weight_kg, gross_weight_kg, packages, marks)
- `hs_code_rules` (id, hs_code, country, requires_certificate, requires_inspection, vat_class, notes, source_url, reviewed_at)
- `country_rule_packs` (id, country, version, language, json_blob_path, loaded_at)
- `export_declarations` (id, org_id, export_doc_id, declaration_no, customs_office, status, submitted_at, cleared_at)
- `export_signatures` (id, export_doc_id, signer_id, signed_at, checksum, method)

## API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/export-docs/templates` | List available document templates |
| POST | `/api/export-docs` | Create export doc from a sales order |
| PATCH | `/api/export-docs/:id/lines` | Edit line items |
| GET | `/api/export-docs/:id/preview` | Render preview (HTML) |
| POST | `/api/export-docs/:id/finalize` | Lock + render PDF |
| POST | `/api/export-docs/:id/sign` | Sign (calls `stateIntegrations.eSignAdapter`) |
| GET | `/api/export-docs/hs-code/check?code=...&country=...` | HS-code rules |
| GET | `/api/export-docs/country-rules?country=...` | Country rule pack |
| POST | `/api/export-docs/declarations` | File export declaration (stub customs) |
| POST | `/api/export-docs/ai/auto-fill` | AI auto-fill from sales order + product master |
| POST | `/api/export-docs/ai/validate` | AI error / consistency check |
| GET | `/api/export-docs/ai/country-check?country=...&productId=...` | AI country rules check |

## Tasks (high level)

1. **Tests (RED)** — `test/export-docs.test.js`: invoice + packing list auto-fill from SO, CMR/TIR generation, HS-code rule fetch, country-rule pack selection, finalization immutability, signature audit, AI auto-fill, idempotency.
2. **Pure engine** — `server/exportDocs.js`: `renderInvoice`, `renderPackingList`, `renderCmr`, `renderTir`, `renderCertificateOfOrigin`, `renderPhyto`, `renderVeterinary`, `renderExportDeclaration`, `validateHsCode`, `loadCountryRules`.
3. **Country rule packs** — bundle 6 starter packs in `server/exportDocs/rules/`: `RU.json`, `EAEU.json`, `EU.json`, `AE.json`, `HK.json`, `PH.json`. Each lists required certificates, common HS-code prefixes, and document order.
4. **DB migration** — 6 new tables in `server/db.js`.
5. **Routes** — register 12 routes after the existing docs/cabinet routes.
6. **React wizard** — `web/src/exportDocs.jsx`: 4-step wizard with template picker, auto-fill preview, validation panel, finalize + sign.
7. **AI helper** — `server/exportDocsAi.js` mirroring Copilot; AI cites Armenian customs / EAEU / EU rules when `legal_sources.status === "active"`.
8. **Handoff + tag** — `export-docs-mvp`.

## Acceptance

- A Spayka operator picks "Phytosanitary Certificate" → auto-fills from a sales order with produce HS codes → AI flags a missing required field for the EU destination.
- Country rules are deterministic and bundled (no network at runtime).
- The finalized document is immutable; any further change requires a new revision.
- E-signature is a stub in test mode; real e-sign lands in sub-plan 7.

## Spine reused

`org_id`, `customers` (foreign buyer), `vendors` (shipper), `products` (HS code), `stock_moves` (shipment), `cabinet_documents` (sub-plan 1 — store the final file), `audit_events`, `idempotency_keys`, `legal_sources` (Armenian customs law, EAEU technical regulations, destination-country rules), `stateIntegrations` adapter.

## Deferred to other sub-plans

- Real customs declaration submission (sub-plan 7).
- Per-destination language templates (i18n expansion).
