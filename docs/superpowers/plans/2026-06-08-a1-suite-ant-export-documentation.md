# Sub-Plan 6: Export Documentation (Экспортная документация) — User Priority #6

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete export-documentation suite uniquely valuable in Armenia: Invoice, Packing List, CMR, TIR, Certificate of Origin, Phytosanitary Certificate, Export Declaration, Veterinary Certificate, plus AI features (auto-fill, error check, HS code check, country rules). Spayka-targeted modes: Russia, EAEU, EU, UAE, Hong Kong, Philippines.

**Architecture:** Pattern A module `server/exportDocs.js` (pure engine: document renderers per kind, HS-code validation, country-rule pack loader, AI auto-fill) + `web/src/exportDocs.jsx` panel (3-step wizard: Pick template → Fill from linked SO/PO → Validate → Export PDF/XML) + `test/export-docs.test.js`. Reuses the existing `customers` (foreign buyer), `vendors`, `products` (HS code), `stock_moves` (shipment) graph. New tables: `export_documents`, `export_document_lines`, `hs_code_rules`, `country_rule_packs`, `export_declarations`, `export_signatures`.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. PDF generation via local HTML/print template (deterministic, no network) — finalised doc is a stored HTML blob in `cabinet_documents` (sub-plan 1) with an SHA-256 checksum. Country rule packs are versioned JSON in `server/exportDocs/rules/<country>.json` and loaded at boot. AI features via `server/exportDocsAi.js` mirroring Copilot with deterministic local fallback when `ARMOSPHERA_ONE_ALLOW_EGRESS` is not set.

**Depends on:** sub-plan 0 (Pattern A skeleton), existing products / customers / vendors / stock_moves. `stateIntegrations` adapter (sub-plan 7) for real e-sign + customs submission; this sub-plan ships a deterministic local stub so the route is exercisable end-to-end.

---

## File Structure

- Create: `server/exportDocs.js` — pure engine (renderers, validation, country rules).
- Create: `server/exportDocsAi.js` — AI helper mirroring Copilot; cites Armenian customs / EAEU / EU rules.
- Create: `server/exportDocs/rules/RU.json`, `EAEU.json`, `EU.json`, `AE.json`, `HK.json`, `PH.json`.
- Modify: `server/db.js` — add the 6 new tables + indexes.
- Modify: `server/app.js` — register the 12 routes after the existing `/api/docs/*` block.
- Create: `web/src/exportDocs.jsx` — 4-step wizard React panel.
- Modify: `web/src/main.jsx` — mount `<ExportDocsPanel />` near the docs panels.
- Create: `test/export-docs.test.js` — full Pattern A contract suite.
- Modify: `HANDOFF.md` — record the `export-docs-mvp` handoff line + completed bullet.

## DB additions

```sql
CREATE TABLE IF NOT EXISTS export_documents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- invoice | packing | cmr | tir | coo | phyto | vet | declaration
  destination_country TEXT NOT NULL,
  incoterm TEXT,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | finalized | signed | void
  linked_so_id TEXT,
  linked_po_id TEXT,
  ship_from TEXT,
  ship_to TEXT,
  buyer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  shipper_id TEXT REFERENCES purchase_vendors(id) ON DELETE SET NULL,
  file_id TEXT,
  created_at TEXT NOT NULL,
  finalized_at TEXT,
  CONSTRAINT export_documents_kind_chk CHECK (kind IN ('invoice','packing','cmr','tir','coo','phyto','vet','declaration'))
);
CREATE INDEX IF NOT EXISTS idx_export_documents_org ON export_documents(org_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS export_document_lines (
  id TEXT PRIMARY KEY,
  export_doc_id TEXT NOT NULL REFERENCES export_documents(id) ON DELETE CASCADE,
  product_id TEXT,
  hs_code TEXT,
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  uom TEXT NOT NULL,
  unit_price REAL NOT NULL,
  net_weight_kg REAL,
  gross_weight_kg REAL,
  packages INTEGER,
  marks TEXT
);
CREATE INDEX IF NOT EXISTS idx_export_document_lines_doc ON export_document_lines(export_doc_id);
CREATE INDEX IF NOT EXISTS idx_export_document_lines_hs ON export_document_lines(hs_code);

CREATE TABLE IF NOT EXISTS hs_code_rules (
  id TEXT PRIMARY KEY,
  hs_code TEXT NOT NULL,
  country TEXT NOT NULL,
  requires_certificate TEXT,
  requires_inspection INTEGER NOT NULL DEFAULT 0,
  vat_class TEXT,
  notes TEXT,
  source_url TEXT,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hs_code_rules_lookup ON hs_code_rules(hs_code, country);

CREATE TABLE IF NOT EXISTS country_rule_packs (
  id TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  version TEXT NOT NULL,
  language TEXT NOT NULL,
  json_blob_path TEXT NOT NULL,
  loaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_country_rule_packs_lookup ON country_rule_packs(country, version);

CREATE TABLE IF NOT EXISTS export_declarations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  export_doc_id TEXT NOT NULL REFERENCES export_documents(id) ON DELETE CASCADE,
  declaration_no TEXT NOT NULL,
  customs_office TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | submitted | cleared | rejected
  submitted_at TEXT,
  cleared_at TEXT
);

CREATE TABLE IF NOT EXISTS export_signatures (
  id TEXT PRIMARY KEY,
  export_doc_id TEXT NOT NULL REFERENCES export_documents(id) ON DELETE CASCADE,
  signer_id TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  checksum TEXT NOT NULL,
  method TEXT NOT NULL  -- stub-hash | e-sign (real lands in sub-plan 7)
);
```

## API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/export-docs/templates` | List available document templates |
| POST | `/api/export-docs` | Create export doc from a sales order |
| PATCH | `/api/export-docs/:id/lines` | Edit line items |
| GET | `/api/export-docs/:id/preview` | Render preview (HTML) |
| POST | `/api/export-docs/:id/finalize` | Lock + render PDF stub |
| POST | `/api/export-docs/:id/sign` | Sign (calls `stateIntegrations.eSignAdapter`) |
| GET | `/api/export-docs/hs-code/check?code=...&country=...` | HS-code rules |
| GET | `/api/export-docs/country-rules?country=...` | Country rule pack |
| POST | `/api/export-docs/declarations` | File export declaration (stub customs) |
| POST | `/api/export-docs/ai/auto-fill` | AI auto-fill from sales order + product master |
| POST | `/api/export-docs/ai/validate` | AI error / consistency check |
| GET | `/api/export-docs/ai/country-check?country=...&productId=...` | AI country rules check |

## Acceptance

- A Spayka operator picks "Phytosanitary Certificate" → auto-fills from a sales order with produce HS codes → AI flags a missing required field for the EU destination.
- Country rules are deterministic and bundled (no network at runtime).
- The finalized document is immutable; any further change requires a new revision.
- E-signature is a stub in test mode; real e-sign lands in sub-plan 7.

## Spine reused

`org_id` (from `app.auth`), `customers` (foreign buyer), `vendors` (shipper, via `purchase_vendors`), `products` (HS code), `stock_moves` (shipment), `cabinet_documents` (sub-plan 1 — store the final file), `audit_events`, `idempotency_keys`, `legal_sources` (Armenian customs law, EAEU technical regulations, destination-country rules), `app_assignments` / `requireAppAccess` for the `docs` app, `stateIntegrations` adapter (sub-plan 7, stubbed locally here).

## Deferred to other sub-plans

- Real customs declaration submission (sub-plan 7).
- Per-destination language templates (i18n expansion).

---

## Tasks

### Task 1: DB migration for the 6 new export-doc tables

**Files:**
- Read: `server/db.js` (find the last `CREATE TABLE IF NOT EXISTS` block to append after)
- Modify: `server/db.js` (append new tables + indexes + a tiny in-memory seed for `hs_code_rules` + `country_rule_packs` so the engine has data on first boot)
- Test: `test/export-docs.test.js` (uses these tables via the engine)

- [ ] **Step 1: Write the failing migration test**

Append to `test/export-docs.test.js`:

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

test("export-docs migration creates the 6 tables", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const required = [
      "export_documents",
      "export_document_lines",
      "hs_code_rules",
      "country_rule_packs",
      "export_declarations",
      "export_signatures"
    ];
    for (const name of required) {
      const row = app.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
      assert.ok(row, `table ${name} must exist`);
    }
  } finally {
    await app.close();
  }
});

test("export-docs country-rule pack for RU is seeded", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const pack = app.db.prepare("SELECT * FROM country_rule_packs WHERE country = ?").get("RU");
    assert.ok(pack, "RU pack must be seeded at boot");
    assert.ok(pack.version && /^\d+\.\d+/.test(pack.version));
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails (RED)**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/export-docs.test.js 2>&1 | tail -20
```

Expected: FAIL with `test file not found` (the file is brand new and not yet committed; we will add it in this task). If the file is detected, the first test should fail with `table export_documents must exist` because no migration has run.

- [ ] **Step 3: Add the migration in `server/db.js`**

Find the closing of the migration block (search for the last `CREATE INDEX IF NOT EXISTS` related to existing tables like `stock_moves`) and append the 6 new tables + indexes from the **DB additions** section above. Then append a tiny in-file seed right after the tables, scoped to `:memory:` and dev DBs only:

```js
// Seed hs_code_rules + country_rule_packs on first boot (idempotent).
const seedHsr = db.prepare("SELECT COUNT(*) AS c FROM hs_code_rules").get().c;
if (seedHsr === 0) {
  const ins = db.prepare("INSERT INTO hs_code_rules (id, hs_code, country, requires_certificate, requires_inspection, vat_class, notes, source_url, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const now = new Date().toISOString();
  const rules = [
    ["hsr-1", "0702", "RU", "phyto", 1, "vat-20", "Tomatoes — phyto certificate required", "https://customs.gov.am/", now],
    ["hsr-2", "0806", "EU", "phyto", 1, "vat-0-export", "Grapes — EU phyto", "https://ec.europa.eu/food/plant/", now],
    ["hsr-3", "0201", "AE", "vet", 1, "vat-0-export", "Beef — vet cert for UAE", "https://u.ae/en/information-and-services/", now],
    ["hsr-4", "1701", "EAEU", "coo", 0, "vat-0-export", "Sugar — certificate of origin", "https://eec.eaeunion.org/", now]
  ];
  for (const r of rules) ins.run(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]);
}
const seedPack = db.prepare("SELECT COUNT(*) AS c FROM country_rule_packs").get().c;
if (seedPack === 0) {
  const insP = db.prepare("INSERT INTO country_rule_packs (id, country, version, language, json_blob_path, loaded_at) VALUES (?, ?, ?, ?, ?, ?)");
  const now = new Date().toISOString();
  const packs = [
    ["pack-RU", "RU", "1.0", "ru", "server/exportDocs/rules/RU.json", now],
    ["pack-EAEU", "EAEU", "1.0", "ru", "server/exportDocs/rules/EAEU.json", now],
    ["pack-EU", "EU", "1.0", "en", "server/exportDocs/rules/EU.json", now],
    ["pack-AE", "AE", "1.0", "en", "server/exportDocs/rules/AE.json", now],
    ["pack-HK", "HK", "1.0", "en", "server/exportDocs/rules/HK.json", now],
    ["pack-PH", "PH", "1.0", "en", "server/exportDocs/rules/PH.json", now]
  ];
  for (const p of packs) insP.run(p[0], p[1], p[2], p[3], p[4], p[5]);
}
```

- [ ] **Step 4: Run the migration test to verify GREEN**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/export-docs.test.js 2>&1 | tail -10
```

Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, total test count increases by 2.

- [ ] **Step 6: Commit**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/db.js test/export-docs.test.js && git commit -m "feat(export-docs): add 6 tables + HS-code/country-pack seeds" && git push ant main
```

---

### Task 2: Pure engine — `server/exportDocs.js` (renderers + HS validation + country rules)

**Files:**
- Create: `server/exportDocs.js`
- Create: `server/exportDocs/rules/RU.json`, `EAEU.json`, `EU.json`, `AE.json`, `HK.json`, `PH.json`
- Test: `test/export-docs.test.js` (add the renderer + HS-code contract tests)

- [ ] **Step 1: Create the 6 country rule packs**

`server/exportDocs/rules/RU.json`:
```json
{
  "country": "RU",
  "version": "1.0",
  "language": "ru",
  "requiredCertificates": ["coo", "invoice", "packing"],
  "commonHsPrefixes": ["0702", "0803", "2009"],
  "documentOrder": ["invoice", "packing", "cmr", "coo"],
  "notes": "Россия — требуется сертификат происхождения и фито для растительной продукции."
}
```

`server/exportDocs/rules/EAEU.json`:
```json
{
  "country": "EAEU",
  "version": "1.0",
  "language": "ru",
  "requiredCertificates": ["coo", "invoice", "packing", "tir"],
  "commonHsPrefixes": ["1701", "2204", "0407"],
  "documentOrder": ["invoice", "packing", "tir", "coo"],
  "notes": "ЕАЭС — единый таможенный режим, требуется TIR или CMR."
}
```

`server/exportDocs/rules/EU.json`:
```json
{
  "country": "EU",
  "version": "1.0",
  "language": "en",
  "requiredCertificates": ["invoice", "packing", "coo", "phyto"],
  "commonHsPrefixes": ["0806", "0702", "2009"],
  "documentOrder": ["invoice", "packing", "coo", "phyto"],
  "notes": "EU — phyto required for fresh produce; check TRACES for animal products."
}
```

`server/exportDocs/rules/AE.json`:
```json
{
  "country": "AE",
  "version": "1.0",
  "language": "en",
  "requiredCertificates": ["invoice", "packing", "coo", "vet"],
  "commonHsPrefixes": ["0201", "0207", "0407"],
  "documentOrder": ["invoice", "coo", "vet", "packing"],
  "notes": "UAE — veterinary certificate required for meat and dairy; attested by MoCCAE."
}
```

`server/exportDocs/rules/HK.json`:
```json
{
  "country": "HK",
  "version": "1.0",
  "language": "en",
  "requiredCertificates": ["invoice", "packing", "coo"],
  "commonHsPrefixes": ["0806", "2204", "1701"],
  "documentOrder": ["invoice", "packing", "coo"],
  "notes": "Hong Kong — free port, no customs duties; certificate of origin suffices for most categories."
}
```

`server/exportDocs/rules/PH.json`:
```json
{
  "country": "PH",
  "version": "1.0",
  "language": "en",
  "requiredCertificates": ["invoice", "packing", "coo", "phyto"],
  "commonHsPrefixes": ["0803", "0806", "2009"],
  "documentOrder": ["invoice", "packing", "coo", "phyto"],
  "notes": "Philippines — BPI import clearance required for plant products; phyto cert mandatory."
}
```

- [ ] **Step 2: Write the failing engine tests**

Append to `test/export-docs.test.js`:

```js
const exportDocs = require("../server/exportDocs");

test("renderInvoice returns HTML with buyer, lines, totals", () => {
  const out = exportDocs.renderInvoice({
    docNo: "EXP-2026-0001",
    date: "2026-06-08",
    buyer: { name: "OOO Torgoviy Dom", country: "RU", city: "Москва" },
    shipper: { name: "Spayka LLC", country: "AM", city: "Ереван" },
    currency: "USD",
    lines: [
      { description: "Tomatoes", hsCode: "0702", quantity: 1000, uom: "kg", unitPrice: 1.2, netWeightKg: 1000, packages: 20 }
    ],
    incoterm: "CIF"
  });
  assert.ok(out.html.includes("EXP-2026-0001"));
  assert.ok(out.html.includes("OOO Torgoviy Dom"));
  assert.ok(out.html.includes("Tomatoes"));
  assert.ok(out.html.includes("Total"));
  assert.strictEqual(out.totals.grossValue, 1200);
  assert.ok(out.checksum.length === 64);
});

test("validateHsCode matches seeded rules and flags missing", () => {
  const r1 = exportDocs.validateHsCode({ code: "0702", country: "RU" });
  assert.strictEqual(r1.requiresCertificate, "phyto");
  assert.strictEqual(r1.requiresInspection, 1);
  const r2 = exportDocs.validateHsCode({ code: "9999", country: "RU" });
  assert.strictEqual(r2.requiresCertificate, null);
  assert.ok(r2.notes && r2.notes.includes("No specific rule"));
});

test("loadCountryRules returns deterministic pack for EAEU", () => {
  const pack = exportDocs.loadCountryRules("EAEU");
  assert.strictEqual(pack.country, "EAEU");
  assert.ok(pack.requiredCertificates.includes("tir"));
  assert.deepStrictEqual(pack.documentOrder, ["invoice", "packing", "tir", "coo"]);
});

test("renderCmr and renderTir include the 4 required fields", () => {
  const cmr = exportDocs.renderCmr({
    docNo: "CMR-1",
    sender: "Spayka LLC", senderAddress: "Ереван, ул. Арарат 1",
    carrier: "TransLog LLC", carrierAddress: "Ереван, ул. Баграмян 5",
    consignee: "OOO Torgoviy Dom", consigneeAddress: "Москва, ул. Тверская 1",
    placeOfDelivery: "Москва",
    dateOfDelivery: "2026-06-10",
    goods: [{ description: "Tomatoes", packages: 20, grossWeightKg: 1000 }]
  });
  assert.ok(cmr.html.includes("CMR-1"));
  assert.ok(cmr.html.includes("TransLog LLC"));
  assert.ok(cmr.html.includes("Тверская 1"));
  const tir = exportDocs.renderTir({
    docNo: "TIR-1", origin: "AM", destination: "RU", carrier: "TransLog LLC", plateNo: "AM123-01", sealNo: "SEAL-001", goodsCount: 1
  });
  assert.ok(tir.html.includes("TIR-1"));
  assert.ok(tir.html.includes("AM123-01"));
});

test("renderFinalized is immutable — direct call without finalize flag throws", () => {
  assert.throws(() => exportDocs.renderFinalized({
    docNo: "X", html: "<p>x</p>"
  }, { finalized: false }), /finalize/);
});
```

- [ ] **Step 3: Run the engine tests to verify they fail (RED)**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/export-docs.test.js 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module '../server/exportDocs'`.

- [ ] **Step 4: Implement the engine**

Create `server/exportDocs.js`:

```js
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const RULES_DIR = path.join(__dirname, "exportDocs", "rules");
const SUPPORTED_KINDS = new Set(["invoice", "packing", "cmr", "tir", "coo", "phyto", "vet", "declaration"]);

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function checksumOf(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function htmlShell(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(title)}</title></head><body>${body}</body></html>`;
}

function validateKind(kind) {
  if (!SUPPORTED_KINDS.has(String(kind))) {
    const err = new Error(`unsupported document kind: ${kind}`);
    err.statusCode = 400;
    throw err;
  }
}

function computeTotals(lines) {
  let grossValue = 0;
  let netWeightKg = 0;
  let packages = 0;
  for (const l of lines) {
    grossValue += Number(l.quantity) * Number(l.unitPrice);
    netWeightKg += Number(l.netWeightKg || 0);
    packages += Number(l.packages || 0);
  }
  return { grossValue, netWeightKg, packages };
}

function renderInvoice(input) {
  validateKind("invoice");
  const { docNo, date, buyer, shipper, currency, lines, incoterm } = input || {};
  if (!docNo || !date || !buyer || !shipper || !Array.isArray(lines) || lines.length === 0) {
    const err = new Error("invoice requires docNo, date, buyer, shipper, non-empty lines");
    err.statusCode = 400;
    throw err;
  }
  const totals = computeTotals(lines);
  const lineRows = lines.map((l, i) => `<tr>
    <td>${i + 1}</td>
    <td>${esc(l.description)}</td>
    <td>${esc(l.hsCode || "")}</td>
    <td>${esc(l.quantity)} ${esc(l.uom)}</td>
    <td>${esc(l.unitPrice)}</td>
    <td>${(Number(l.quantity) * Number(l.unitPrice)).toFixed(2)}</td>
  </tr>`).join("");
  const html = htmlShell(`Invoice ${docNo}`,
    `<h1>Արտահանման հաշիվ / Export Invoice ${esc(docNo)}</h1>
     <p>Ամսաթիվ / Date: ${esc(date)}</p>
     <p>Shipper: <strong>${esc(shipper.name)}</strong> (${esc(shipper.city)}, ${esc(shipper.country)})</p>
     <p>Buyer: <strong>${esc(buyer.name)}</strong> (${esc(buyer.city)}, ${esc(buyer.country)})</p>
     <p>Incoterm: ${esc(incoterm || "EXW")} · Currency: ${esc(currency || "USD")}</p>
     <table border="1" cellpadding="4"><thead><tr><th>#</th><th>Description</th><th>HS</th><th>Qty</th><th>Unit</th><th>Line total</th></tr></thead>
     <tbody>${lineRows}</tbody></table>
     <p>Total: <strong>${totals.grossValue.toFixed(2)} ${esc(currency || "USD")}</strong></p>
     <p>Net weight: ${totals.netWeightKg} kg · Packages: ${totals.packages}</p>`);
  return { html, totals, checksum: checksumOf(html) };
}

function renderPackingList(input) {
  validateKind("packing");
  if (!input || !input.docNo || !Array.isArray(input.lines) || input.lines.length === 0) {
    const err = new Error("packing list requires docNo and non-empty lines");
    err.statusCode = 400;
    throw err;
  }
  const totals = computeTotals(input.lines);
  const rows = input.lines.map((l, i) => `<tr>
    <td>${i + 1}</td>
    <td>${esc(l.description)}</td>
    <td>${esc(l.packages || 0)}</td>
    <td>${esc(l.netWeightKg || 0)}</td>
    <td>${esc(l.grossWeightKg || 0)}</td>
    <td>${esc(l.marks || "")}</td>
  </tr>`).join("");
  const html = htmlShell(`Packing List ${input.docNo}`,
    `<h1>Փաթեթավորման կետագիր / Packing List ${esc(input.docNo)}</h1>
     <p>Date: ${esc(input.date || "")}</p>
     <table border="1" cellpadding="4"><thead><tr><th>#</th><th>Description</th><th>Pkg</th><th>Net kg</th><th>Gross kg</th><th>Marks</th></tr></thead>
     <tbody>${rows}</tbody></table>
     <p>Totals: ${totals.packages} packages, ${totals.netWeightKg} kg net</p>`);
  return { html, totals, checksum: checksumOf(html) };
}

function renderCmr(input) {
  validateKind("cmr");
  const required = ["docNo", "sender", "carrier", "consignee", "placeOfDelivery", "goods"];
  for (const k of required) {
    if (!input || input[k] == null) {
      const err = new Error(`cmr requires ${k}`);
      err.statusCode = 400;
      throw err;
    }
  }
  const goodsRows = input.goods.map((g, i) => `<tr><td>${i + 1}</td><td>${esc(g.description)}</td><td>${esc(g.packages || 0)}</td><td>${esc(g.grossWeightKg || 0)}</td></tr>`).join("");
  const html = htmlShell(`CMR ${input.docNo}`,
    `<h1>CMR / Տրանսպորտային փաստաթուղթ № ${esc(input.docNo)}</h1>
     <p>Sender: <strong>${esc(input.sender)}</strong> — ${esc(input.senderAddress || "")}</p>
     <p>Consignee: <strong>${esc(input.consignee)}</strong> — ${esc(input.consigneeAddress || "")}</p>
     <p>Carrier: <strong>${esc(input.carrier)}</strong> — ${esc(input.carrierAddress || "")}</p>
     <p>Place of delivery: ${esc(input.placeOfDelivery)} · Date: ${esc(input.dateOfDelivery || "")}</p>
     <table border="1" cellpadding="4"><thead><tr><th>#</th><th>Description</th><th>Pkg</th><th>Gross kg</th></tr></thead>
     <tbody>${goodsRows}</tbody></table>`);
  return { html, checksum: checksumOf(html) };
}

function renderTir(input) {
  validateKind("tir");
  for (const k of ["docNo", "origin", "destination", "carrier", "plateNo", "sealNo"]) {
    if (!input || input[k] == null) {
      const err = new Error(`tir requires ${k}`);
      err.statusCode = 400;
      throw err;
    }
  }
  const html = htmlShell(`TIR Carnet ${input.docNo}`,
    `<h1>TIR Carnet № ${esc(input.docNo)}</h1>
     <p>Origin: ${esc(input.origin)} → Destination: ${esc(input.destination)}</p>
     <p>Carrier: <strong>${esc(input.carrier)}</strong></p>
     <p>Vehicle plate: <strong>${esc(input.plateNo)}</strong> · Seal: <strong>${esc(input.sealNo)}</strong></p>
     <p>Goods items: ${esc(input.goodsCount || 0)}</p>`);
  return { html, checksum: checksumOf(html) };
}

function renderCertificateOfOrigin(input) {
  validateKind("coo");
  if (!input || !input.docNo || !input.origin || !input.destination) {
    const err = new Error("coo requires docNo, origin, destination");
    err.statusCode = 400;
    throw err;
  }
  const html = htmlShell(`Certificate of Origin ${input.docNo}`,
    `<h1>Ծագման վկայական / Certificate of Origin № ${esc(input.docNo)}</h1>
     <p>Country of origin: <strong>${esc(input.origin)}</strong></p>
     <p>Country of destination: <strong>${esc(input.destination)}</strong></p>
     <p>Exporter: ${esc(input.exporter || "")} · Consignee: ${esc(input.consignee || "")}</p>
     <p>Goods: ${esc((input.goodsDescription || ""))}</p>`);
  return { html, checksum: checksumOf(html) };
}

function renderPhyto(input) {
  validateKind("phyto");
  for (const k of ["docNo", "exporter", "consignee", "countryOfOrigin", "countryOfDestination", "descriptionOfGoods", "botanicalName"]) {
    if (!input || input[k] == null) {
      const err = new Error(`phyto requires ${k}`);
      err.statusCode = 400;
      throw err;
    }
  }
  const html = htmlShell(`Phytosanitary Certificate ${input.docNo}`,
    `<h1>Ֆիտոսանիտարական վկայական / Phytosanitary Certificate № ${esc(input.docNo)}</h1>
     <p>Exporter: <strong>${esc(input.exporter)}</strong></p>
     <p>Consignee: <strong>${esc(input.consignee)}</strong></p>
     <p>Origin: <strong>${esc(input.countryOfOrigin)}</strong> · Destination: <strong>${esc(input.countryOfDestination)}</strong></p>
     <p>Description: ${esc(input.descriptionOfGoods)}</p>
     <p>Botanical name: ${esc(input.botanicalName)}</p>`);
  return { html, checksum: checksumOf(html) };
}

function renderVeterinary(input) {
  validateKind("vet");
  for (const k of ["docNo", "exporter", "consignee", "countryOfOrigin", "countryOfDestination", "species", "descriptionOfGoods"]) {
    if (!input || input[k] == null) {
      const err = new Error(`vet requires ${k}`);
      err.statusCode = 400;
      throw err;
    }
  }
  const html = htmlShell(`Veterinary Certificate ${input.docNo}`,
    `<h1>Անասնաբուժական վկայական / Veterinary Certificate № ${esc(input.docNo)}</h1>
     <p>Exporter: <strong>${esc(input.exporter)}</strong></p>
     <p>Consignee: <strong>${esc(input.consignee)}</strong></p>
     <p>Origin: <strong>${esc(input.countryOfOrigin)}</strong> · Destination: <strong>${esc(input.countryOfDestination)}</strong></p>
     <p>Species: ${esc(input.species)}</p>
     <p>Goods: ${esc(input.descriptionOfGoods)}</p>`);
  return { html, checksum: checksumOf(html) };
}

function renderExportDeclaration(input) {
  validateKind("declaration");
  for (const k of ["docNo", "exporter", "consignee", "destinationCountry", "hsCode", "grossWeightKg", "value"]) {
    if (!input || input[k] == null) {
      const err = new Error(`declaration requires ${k}`);
      err.statusCode = 400;
      throw err;
    }
  }
  const html = htmlShell(`Export Declaration ${input.docNo}`,
    `<h1>Արտահանման հայտարարություն / Export Declaration № ${esc(input.docNo)}</h1>
     <p>Exporter: ${esc(input.exporter)} · Consignee: ${esc(input.consignee)}</p>
     <p>Destination: <strong>${esc(input.destinationCountry)}</strong></p>
     <p>HS code: ${esc(input.hsCode)} · Gross weight: ${esc(input.grossWeightKg)} kg</p>
     <p>Value: ${esc(input.value)} ${esc(input.currency || "USD")}</p>`);
  return { html, checksum: checksumOf(html) };
}

function renderFinalized(input, opts) {
  if (!opts || opts.finalized !== true) {
    const err = new Error("must call finalize() before renderFinalized()");
    err.statusCode = 409;
    throw err;
  }
  if (!input || !input.html) {
    const err = new Error("renderFinalized requires html");
    err.statusCode = 400;
    throw err;
  }
  const sealed = input.html.replace("</body>", `<hr/><p>SEALED: ${input.docNo || ""} · ${new Date().toISOString()}</p></body>`);
  return { html: sealed, checksum: checksumOf(sealed) };
}

function validateHsCode(input, db) {
  if (!input || !input.code) {
    const err = new Error("validateHsCode requires code");
    err.statusCode = 400;
    throw err;
  }
  if (db && typeof db.prepare === "function") {
    const row = db.prepare("SELECT * FROM hs_code_rules WHERE hs_code = ? AND country = ?").get(String(input.code), String(input.country || ""));
    if (row) {
      return {
        hsCode: row.hs_code,
        country: row.country,
        requiresCertificate: row.requires_certificate,
        requiresInspection: row.requires_inspection,
        vatClass: row.vat_class,
        notes: row.notes,
        sourceUrl: row.source_url,
        reviewedAt: row.reviewed_at
      };
    }
  }
  return {
    hsCode: String(input.code),
    country: String(input.country || ""),
    requiresCertificate: null,
    requiresInspection: 0,
    vatClass: null,
    notes: `No specific rule for ${input.code} / ${input.country || "(any)"} in local rule pack.`
  };
}

function loadCountryRules(country) {
  const code = String(country || "").toUpperCase();
  if (!code) {
    const err = new Error("loadCountryRules requires country");
    err.statusCode = 400;
    throw err;
  }
  const file = path.join(RULES_DIR, `${code}.json`);
  if (!fs.existsSync(file)) {
    const err = new Error(`country rule pack not found: ${code}`);
    err.statusCode = 404;
    throw err;
  }
  const raw = fs.readFileSync(file, "utf8");
  const pack = JSON.parse(raw);
  return { country: pack.country, version: pack.version, language: pack.language, requiredCertificates: pack.requiredCertificates, commonHsPrefixes: pack.commonHsPrefixes, documentOrder: pack.documentOrder, notes: pack.notes };
}

function buildAutoFill({ salesOrder, productMaster, countryRulePack }) {
  const lines = (salesOrder.lines || []).map(line => {
    const product = (productMaster || []).find(p => p.id === line.productId) || {};
    return {
      productId: line.productId,
      hsCode: product.hsCode || line.hsCode || "",
      description: product.name || line.description,
      quantity: line.quantity,
      uom: product.uom || line.uom || "kg",
      unitPrice: line.unitPrice,
      netWeightKg: line.netWeightKg || line.quantity,
      grossWeightKg: line.grossWeightKg || (line.quantity * 1.05),
      packages: line.packages || 1,
      marks: line.marks || ""
    };
  });
  return {
    destinationCountry: salesOrder.destinationCountry,
    incoterm: salesOrder.incoterm || "CIF",
    currency: salesOrder.currency || "USD",
    requiredCertificates: (countryRulePack && countryRulePack.requiredCertificates) || [],
    lines
  };
}

module.exports = {
  SUPPORTED_KINDS,
  renderInvoice,
  renderPackingList,
  renderCmr,
  renderTir,
  renderCertificateOfOrigin,
  renderPhyto,
  renderVeterinary,
  renderExportDeclaration,
  renderFinalized,
  validateHsCode,
  loadCountryRules,
  buildAutoFill
};
```

- [ ] **Step 5: Run engine tests to verify GREEN**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/export-docs.test.js 2>&1 | tail -10
```

Expected: PASS (engine + migration tests = 7 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/exportDocs.js server/exportDocs test/export-docs.test.js && git commit -m "feat(export-docs): add pure engine + 6 country rule packs" && git push ant main
```

---

### Task 3: Routes — register the 12 export-docs endpoints in `server/app.js`

**Files:**
- Modify: `server/app.js` (import + 12 routes)
- Test: `test/export-docs.test.js` (add the route contract tests proving 401/403/400/200 + audit + idempotency on at least one mutation route)

- [ ] **Step 1: Add the import**

Near the other engine imports in `server/app.js`:

```js
const exportDocs = require("./exportDocs");
const exportDocsAi = require("./exportDocsAi");
```

- [ ] **Step 2: Write the failing route tests (mutation contract)**

Append to `test/export-docs.test.js`:

```js
test("POST /api/export-docs is auth-gated (401)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/export-docs",
      payload: { kind: "invoice", destinationCountry: "RU", idempotencyKey: "k-401" }
    });
    assert.strictEqual(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("POST /api/export-docs requires app access (403)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/export-docs",
      headers: { cookie },
      payload: { kind: "invoice", destinationCountry: "RU", idempotencyKey: "k-403" }
    });
    assert.strictEqual(res.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("POST /api/export-docs rejects malformed input (400)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/export-docs",
      headers: { cookie },
      payload: {} // missing kind + destinationCountry
    });
    assert.strictEqual(res.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("POST /api/export-docs happy path writes audit + idempotent replay (200)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const payload = {
      method: "POST",
      url: "/api/export-docs",
      headers: { cookie },
      payload: {
        kind: "invoice",
        destinationCountry: "RU",
        incoterm: "CIF",
        currency: "USD",
        buyer: { name: "OOO Torgoviy Dom", country: "RU", city: "Москва" },
        shipper: { name: "Spayka LLC", country: "AM", city: "Ереван" },
        lines: [{ description: "Tomatoes", hsCode: "0702", quantity: 1000, uom: "kg", unitPrice: 1.2, netWeightKg: 1000, packages: 20 }],
        idempotencyKey: "k-happy-1"
      }
    };
    const first = await app.inject(payload);
    assert.strictEqual(first.statusCode, 200, first.body);
    const body = first.json();
    assert.strictEqual(body.ok, true);
    assert.ok(body.exportDoc.id);
    assert.ok(body.exportDoc.previewHtml.includes("OOO Torgoviy Dom"));
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.strictEqual(after, before + 1, "audit row must be written");
    const second = await app.inject(payload);
    assert.strictEqual(second.statusCode, 200);
    assert.deepStrictEqual(second.json(), body);
    const afterReplay = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.strictEqual(afterReplay, after, "idempotent replay must not double-write audit");
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 3: Run route tests to verify they fail (RED)**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/export-docs.test.js 2>&1 | tail -10
```

Expected: FAIL — the 401 test should report a 404 because no route is registered yet, or a `route not found`.

- [ ] **Step 4: Register the 12 routes in `server/app.js`**

Find the end of the existing `/api/docs/*` block (search for `app.get("/api/docs/templates"`) and append directly after it:

```js
// ---------- Export documentation (sub-plan 6) ----------

app.get("/api/export-docs/templates", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "docs");
  return {
    ok: true,
    templates: Array.from(exportDocs.SUPPORTED_KINDS).map(kind => ({
      kind,
      label: {
        invoice: "Արտահանման հաշիվ / Export invoice",
        packing: "Փաթեթավորման կետագիր / Packing list",
        cmr: "Տրանսպորտային փաստաթուղթ / CMR",
        tir: "TIR կարնե",
        coo: "Ծագման վկայական / Certificate of origin",
        phyto: "Ֆիտոսանիտարական վկայական / Phytosanitary",
        vet: "Անասնաբուժական վկայական / Veterinary",
        declaration: "Արտահանման հայտարարություն / Export declaration"
      }[kind]
    }))
  };
});

app.post("/api/export-docs", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "docs");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
  if (!body.kind || !body.destinationCountry) { const e = new Error("kind and destinationCountry are required"); e.statusCode = 400; throw e; }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  const id = randomId("expdoc");
  const now = new Date().toISOString();
  const preview = exportDocs.renderInvoice({
    docNo: id,
    date: now.slice(0, 10),
    buyer: body.buyer || { name: "(buyer)", country: body.destinationCountry, city: "" },
    shipper: body.shipper || { name: "(shipper)", country: "AM", city: "Ереван" },
    currency: body.currency || "USD",
    lines: body.lines || [],
    incoterm: body.incoterm || "EXW"
  });
  db.prepare("INSERT INTO export_documents (id, org_id, kind, destination_country, incoterm, currency, status, ship_from, ship_to, created_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)")
    .run(id, user.org_id, body.kind, body.destinationCountry, body.incoterm || "EXW", body.currency || "USD", body.shipFrom || "", body.shipTo || "", now);
  for (const l of (body.lines || [])) {
    db.prepare("INSERT INTO export_document_lines (id, export_doc_id, product_id, hs_code, description, quantity, uom, unit_price, net_weight_kg, gross_weight_kg, packages, marks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(randomId("expln"), id, l.productId || null, l.hsCode || "", l.description || "", Number(l.quantity || 0), l.uom || "kg", Number(l.unitPrice || 0), Number(l.netWeightKg || 0), Number(l.grossWeightKg || 0), Number(l.packages || 0), l.marks || "");
  }
  const envelope = { ok: true, exportDoc: { id, kind: body.kind, destinationCountry: body.destinationCountry, previewHtml: preview.html, totals: preview.totals, checksum: preview.checksum } };
  db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now);
  audit(db, user.org_id, user.id, "exportDocs.created", { exportDocId: id, kind: body.kind, destinationCountry: body.destinationCountry, idempotencyKey: idem });
  return envelope;
});

app.patch("/api/export-docs/:id/lines", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "docs");
  const doc = db.prepare("SELECT * FROM export_documents WHERE id = ? AND org_id = ?").get(request.params.id, user.org_id);
  if (!doc) { const e = new Error("export document not found"); e.statusCode = 404; throw e; }
  if (doc.status !== "draft") { const e = new Error("cannot edit a finalized document"); e.statusCode = 409; throw e; }
  const body = request.body || {};
  if (!Array.isArray(body.lines) || body.lines.length === 0) { const e = new Error("lines is required and must be non-empty"); e.statusCode = 400; throw e; }
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM export_document_lines WHERE export_doc_id = ?").run(doc.id);
    for (const l of body.lines) {
      db.prepare("INSERT INTO export_document_lines (id, export_doc_id, product_id, hs_code, description, quantity, uom, unit_price, net_weight_kg, gross_weight_kg, packages, marks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(randomId("expln"), doc.id, l.productId || null, l.hsCode || "", l.description || "", Number(l.quantity || 0), l.uom || "kg", Number(l.unitPrice || 0), Number(l.netWeightKg || 0), Number(l.grossWeightKg || 0), Number(l.packages || 0), l.marks || "");
    }
  });
  tx();
  const envelope = { ok: true, exportDocId: doc.id, lineCount: body.lines.length };
  db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString());
  audit(db, user.org_id, user.id, "exportDocs.linesUpdated", { exportDocId: doc.id, lineCount: body.lines.length, idempotencyKey: idem });
  return envelope;
});

app.get("/api/export-docs/:id/preview", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "docs");
  const doc = db.prepare("SELECT * FROM export_documents WHERE id = ? AND org_id = ?").get(request.params.id, user.org_id);
  if (!doc) { const e = new Error("export document not found"); e.statusCode = 404; throw e; }
  const lines = db.prepare("SELECT * FROM export_document_lines WHERE export_doc_id = ?").all(doc.id);
  const html = `<h1>Preview ${esc(doc.kind)} ${esc(doc.id)}</h1><p>${lines.length} lines</p>`;
  return { ok: true, previewHtml: html, lineCount: lines.length };
});

app.post("/api/export-docs/:id/finalize", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "docs");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  const doc = db.prepare("SELECT * FROM export_documents WHERE id = ? AND org_id = ?").get(request.params.id, user.org_id);
  if (!doc) { const e = new Error("export document not found"); e.statusCode = 404; throw e; }
  if (doc.status !== "draft") { const e = new Error("already finalized"); e.statusCode = 409; throw e; }
  const now = new Date().toISOString();
  db.prepare("UPDATE export_documents SET status = 'finalized', finalized_at = ? WHERE id = ?").run(now, doc.id);
  const envelope = { ok: true, exportDocId: doc.id, status: "finalized", finalizedAt: now };
  db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now);
  audit(db, user.org_id, user.id, "exportDocs.finalized", { exportDocId: doc.id, idempotencyKey: idem });
  return envelope;
});

app.post("/api/export-docs/:id/sign", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "docs");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  const doc = db.prepare("SELECT * FROM export_documents WHERE id = ? AND org_id = ?").get(request.params.id, user.org_id);
  if (!doc) { const e = new Error("export document not found"); e.statusCode = 404; throw e; }
  const checksum = crypto.createHash("sha256").update(`${doc.id}|${user.id}|${Date.now()}`).digest("hex");
  const method = process.env.STATE_INTEGRATIONS_E_SIGN === "stub" ? "e-sign" : "stub-hash";
  db.prepare("INSERT INTO export_signatures (id, export_doc_id, signer_id, signed_at, checksum, method) VALUES (?, ?, ?, ?, ?, ?)")
    .run(randomId("expsig"), doc.id, user.id, new Date().toISOString(), checksum, method);
  db.prepare("UPDATE export_documents SET status = 'signed' WHERE id = ?").run(doc.id);
  const envelope = { ok: true, exportDocId: doc.id, status: "signed", checksum, method };
  db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString());
  audit(db, user.org_id, user.id, "exportDocs.signed", { exportDocId: doc.id, checksum, method, idempotencyKey: idem });
  return envelope;
});

app.get("/api/export-docs/hs-code/check", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "docs");
  const code = String((request.query || {}).code || "");
  const country = String((request.query || {}).country || "");
  if (!code) { const e = new Error("code is required"); e.statusCode = 400; throw e; }
  return { ok: true, rule: exportDocs.validateHsCode({ code, country }, db) };
});

app.get("/api/export-docs/country-rules", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "docs");
  const country = String((request.query || {}).country || "");
  if (!country) { const e = new Error("country is required"); e.statusCode = 400; throw e; }
  return { ok: true, pack: exportDocs.loadCountryRules(country) };
});

app.post("/api/export-docs/declarations", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "docs");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
  for (const k of ["exportDocId", "declarationNo", "customsOffice"]) {
    if (!body[k]) { const e = new Error(`${k} is required`); e.statusCode = 400; throw e; }
  }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  const doc = db.prepare("SELECT * FROM export_documents WHERE id = ? AND org_id = ?").get(body.exportDocId, user.org_id);
  if (!doc) { const e = new Error("export document not found"); e.statusCode = 404; throw e; }
  const id = randomId("expdecl");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO export_declarations (id, org_id, export_doc_id, declaration_no, customs_office, status, submitted_at) VALUES (?, ?, ?, ?, ?, 'submitted', ?)")
    .run(id, user.org_id, doc.id, body.declarationNo, body.customsOffice, now);
  const envelope = { ok: true, declarationId: id, status: "submitted", submittedAt: now };
  db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now);
  audit(db, user.org_id, user.id, "exportDocs.declarationSubmitted", { exportDocId: doc.id, declarationId: id, idempotencyKey: idem });
  return envelope;
});

app.post("/api/export-docs/ai/auto-fill", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "docs");
  const body = request.body || {};
  if (!body.salesOrder || !Array.isArray(body.salesOrder.lines)) { const e = new Error("salesOrder.lines is required"); e.statusCode = 400; throw e; }
  const pack = body.destinationCountry ? exportDocs.loadCountryRules(body.destinationCountry) : null;
  return { ok: true, draft: exportDocs.buildAutoFill({ salesOrder: body.salesOrder, productMaster: body.productMaster || [], countryRulePack: pack }), sourceCitations: exportDocsAi.citeLegalSources("auto-fill", body.destinationCountry) };
});

app.post("/api/export-docs/ai/validate", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "docs");
  const body = request.body || {};
  if (!body.exportDocId) { const e = new Error("exportDocId is required"); e.statusCode = 400; throw e; }
  return { ok: true, ...exportDocsAi.validateExportDoc({ exportDocId: body.exportDocId, db, exportDocs }) };
});

app.get("/api/export-docs/ai/country-check", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "docs");
  const country = String((request.query || {}).country || "");
  const productId = String((request.query || {}).productId || "");
  if (!country) { const e = new Error("country is required"); e.statusCode = 400; throw e; }
  return { ok: true, ...exportDocsAi.countryRulesCheck({ country, productId, db, exportDocs }) };
});
```

- [ ] **Step 5: Run the route tests to verify GREEN**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/export-docs.test.js 2>&1 | tail -10
```

Expected: FAIL — the import `exportDocsAi` is referenced before that file exists. The next step creates it.

- [ ] **Step 6: Create the AI helper stub so the routes load**

Create `server/exportDocsAi.js`:

```js
"use strict";
const exportDocs = require("./exportDocs");

function citeLegalSources(aspect, country) {
  const base = [
    { id: "am-customs-code", label: "Armenia Customs Code", status: "active" },
    { id: "eaeu-tech-regs", label: "EAEU Technical Regulations", status: "active" }
  ];
  if (country) base.push({ id: `rules-${String(country).toUpperCase()}`, label: `${country} import rules (bundled)`, status: "active" });
  return base;
}

function validateExportDoc({ exportDocId, db, exportDocs: engine }) {
  if (!exportDocId) return { issues: [{ severity: "high", message: "exportDocId is required" }] };
  const doc = db.prepare("SELECT * FROM export_documents WHERE id = ?").get(exportDocId);
  if (!doc) return { issues: [{ severity: "high", message: "export document not found" }] };
  const lines = db.prepare("SELECT * FROM export_document_lines WHERE export_doc_id = ?").all(exportDocId);
  const issues = [];
  for (const l of lines) {
    if (!l.hs_code) issues.push({ severity: "high", lineId: l.id, message: `Line "${l.description}" is missing an HS code` });
    if (!l.net_weight_kg) issues.push({ severity: "medium", lineId: l.id, message: `Line "${l.description}" has no declared net weight` });
  }
  const pack = engine.loadCountryRules(doc.destination_country);
  for (const cert of pack.requiredCertificates) {
    if (doc.kind === cert) continue;
  }
  return { issues, requiredCertificates: pack.requiredCertificates, destinationCountry: doc.destination_country };
}

function countryRulesCheck({ country, productId, db, exportDocs: engine }) {
  const pack = engine.loadCountryRules(country);
  let hsNote = null;
  if (productId && db) {
    const p = db.prepare("SELECT * FROM catalog_items WHERE id = ?").get(productId);
    if (p && p.hs_code) {
      const rule = engine.validateHsCode({ code: p.hs_code, country }, db);
      hsNote = `HS ${p.hs_code} → requiresCertificate=${rule.requiresCertificate || "(none)"}, requiresInspection=${rule.requiresInspection}`;
    }
  }
  return { pack, hsNote, citations: citeLegalSources("country-check", country) };
}

module.exports = { citeLegalSources, validateExportDoc, countryRulesCheck };
```

- [ ] **Step 7: Re-run the route tests to verify GREEN**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/export-docs.test.js 2>&1 | tail -10
```

Expected: PASS (all route contract tests + engine + migration).

- [ ] **Step 8: Run the full suite**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, no regressions.

- [ ] **Step 9: Commit**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/app.js server/exportDocsAi.js test/export-docs.test.js && git commit -m "feat(export-docs): wire 12 routes + AI helper stub" && git push ant main
```

---

### Task 4: React wizard — `web/src/exportDocs.jsx` (4-step panel)

**Files:**
- Create: `web/src/exportDocs.jsx`
- Modify: `web/src/main.jsx` (mount the panel near the docs panel)
- Read: `web/src/docs.jsx` (style reference)

- [ ] **Step 1: Create the wizard component**

```jsx
import React, { useState } from "react";

const TEMPLATE_LABELS = {
  invoice: "Արտահանման հաշիվ / Export invoice",
  packing: "Փաթեթավորման կետագիր / Packing list",
  cmr: "Տրանսպորտային փաստաթուղթ / CMR",
  tir: "TIR կարնե",
  coo: "Ծագման վկայական / Certificate of origin",
  phyto: "Ֆիտոսանիտարական վկայական / Phytosanitary",
  vet: "Անասնաբուժական վկայական / Veterinary",
  declaration: "Արտահանման հայտարարություն / Export declaration"
};

export function ExportDocsPanel({ api, actionState }) {
  const [step, setStep] = useState(1);
  const [template, setTemplate] = useState(null);
  const [country, setCountry] = useState("RU");
  const [draft, setDraft] = useState(null);
  const [validation, setValidation] = useState(null);
  const [error, setError] = useState("");
  const busy = actionState === "export-docs";

  async function autoFill() {
    setError("");
    const response = await api("/api/export-docs/ai/auto-fill", {
      method: "POST",
      body: {
        destinationCountry: country,
        salesOrder: {
          destinationCountry: country,
          incoterm: "CIF",
          currency: "USD",
          lines: [
            { productId: "demo-tomato", description: "Tomatoes", quantity: 1000, unitPrice: 1.2, uom: "kg" }
          ]
        },
        productMaster: [
          { id: "demo-tomato", name: "Tomatoes (Cherry)", hsCode: "0702", uom: "kg" }
        ]
      }
    });
    setDraft(response.draft);
    setStep(2);
  }

  async function validate() {
    setError("");
    const response = await api("/api/export-docs/ai/country-check?country=" + encodeURIComponent(country) + "&productId=demo-tomato");
    setValidation(response);
    setStep(3);
  }

  async function finalize() {
    setError("");
    const created = await api("/api/export-docs", {
      method: "POST",
      body: {
        kind: template,
        destinationCountry: country,
        incoterm: draft && draft.incoterm,
        currency: draft && draft.currency,
        lines: (draft && draft.lines) || [],
        idempotencyKey: `ui-create-${Date.now()}`
      }
    });
    await api(`/api/export-docs/${created.exportDoc.id}/finalize`, { method: "POST", body: { idempotencyKey: `ui-fin-${Date.now()}` } });
    setStep(4);
  }

  return (
    <article className="panel export-docs-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Արտահանման փաստաթղթեր</span>
          <h2>Export documentation wizard</h2>
        </div>
      </div>

      {step === 1 && (
        <div className="inline-form">
          <label>Տիպ
            <select value={template || ""} onChange={event => setTemplate(event.target.value)}>
              <option value="">— Ընտրել / Select —</option>
              {Object.keys(TEMPLATE_LABELS).map(k => <option key={k} value={k}>{TEMPLATE_LABELS[k]}</option>)}
            </select>
          </label>
          <label>Երկիր
            <select value={country} onChange={event => setCountry(event.target.value)}>
              {["RU","EAEU","EU","AE","HK","PH"].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button className="mini-action" type="button" disabled={!template || busy} onClick={autoFill}>
            {busy ? "Կատարվում է…" : "Հաջորդ"}
          </button>
        </div>
      )}

      {step === 2 && draft && (
        <div className="copilot-result">
          <h3>Նախնական լրացում / Auto-fill preview</h3>
          <p className="row"><span className="section-label">Երկիր</span> {draft.destinationCountry}</p>
          <p className="row"><span className="section-label">Incoterm</span> {draft.incoterm} · {draft.currency}</p>
          <ul>
            {draft.lines.map((l, i) => <li key={i}>{l.description} — HS {l.hsCode} — {l.quantity} {l.uom}</li>)}
          </ul>
          <div className="inline-form">
            <button className="mini-action" type="button" onClick={validate}>Ստուգել / Validate</button>
            <button className="mini-action" type="button" onClick={() => setStep(1)}>Վերադառնալ</button>
          </div>
        </div>
      )}

      {step === 3 && validation && (
        <div className="copilot-result">
          <h3>Ստուգման արդյունքներ / Validation</h3>
          <p className="row"><span className="section-label">Երկիր</span> {validation.destinationCountry}</p>
          <p className="row"><span className="section-label">Պարտադիր վկայականներ</span> {(validation.pack && validation.pack.requiredCertificates || []).join(", ")}</p>
          {validation.hsNote && <p className="row"><span className="section-label">HS ծանություն</span> {validation.hsNote}</p>}
          {error && <p className="aging-badge">{error}</p>}
          <div className="inline-form">
            <button className="mini-action" type="button" onClick={finalize} disabled={busy}>Ավարտել / Finalize</button>
            <button className="mini-action" type="button" onClick={() => setStep(2)}>Վերադառնալ</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="copilot-result">
          <h3>Փաստաթուղթն ավարտված է / Document finalized</h3>
          <p className="row"><span className="section-label">Կարգավիճակ</span> finalized</p>
          <button className="mini-action" type="button" onClick={() => { setStep(1); setDraft(null); setValidation(null); }}>Սկսել նորը</button>
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Mount the panel in `web/src/main.jsx`**

Find the docs panel import in `web/src/main.jsx` and add:

```jsx
import { ExportDocsPanel } from "./exportDocs.jsx";
```

Then find the `Workspace` body and add near the docs panel mount:

```jsx
<ExportDocsPanel api={api} actionState={actionState} />
```

- [ ] **Step 3: Build the UI**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm run build:ui 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add web/src/exportDocs.jsx web/src/main.jsx && git commit -m "feat(export-docs): mount 4-step wizard panel" && git push ant main
```

---

### Task 5: AI auto-fill + validation tests covering the legal-sources citation + AI egress gate

**Files:**
- Modify: `test/export-docs.test.js` (add AI tests)
- Read: `server/aiProvider.js` (style reference for the egress gate)

- [ ] **Step 1: Add the AI tests**

Append to `test/export-docs.test.js`:

```js
test("AI auto-fill returns Armenian-cited, deterministic draft when egress is off", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    delete process.env.ARMOSPHERA_ONE_ALLOW_EGRESS;
    const res = await app.inject({
      method: "POST",
      url: "/api/export-docs/ai/auto-fill",
      headers: { cookie },
      payload: {
        destinationCountry: "EU",
        salesOrder: { destinationCountry: "EU", incoterm: "CIF", currency: "EUR", lines: [{ productId: "p1", description: "Grapes", quantity: 500, unitPrice: 2.5, uom: "kg" }] },
        productMaster: [{ id: "p1", name: "Grapes (white)", hsCode: "0806", uom: "kg" }]
      }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(body.sourceCitations.find(c => c.id === "am-customs-code"));
    assert.ok(body.sourceCitations.find(c => c.id === "eaeu-tech-regs"));
    assert.strictEqual(body.draft.destinationCountry, "EU");
    assert.strictEqual(body.draft.lines[0].hsCode, "0806");
  } finally {
    await app.close();
  }
});

test("AI validate flags missing HS code on a line", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const create = await app.inject({
      method: "POST", url: "/api/export-docs", headers: { cookie },
      payload: {
        kind: "invoice", destinationCountry: "EU", incoterm: "CIF", currency: "EUR",
        lines: [{ description: "Mystery fruit", quantity: 10, uom: "kg", unitPrice: 1.0 }],
        idempotencyKey: "k-validate-1"
      }
    });
    const id = create.json().exportDoc.id;
    const v = await app.inject({
      method: "POST", url: "/api/export-docs/ai/validate", headers: { cookie },
      payload: { exportDocId: id }
    });
    assert.strictEqual(v.statusCode, 200, v.body);
    const issues = v.json().issues;
    assert.ok(issues.find(i => i.message.includes("HS code")));
  } finally {
    await app.close();
  }
});

test("AI country-check returns required certificates for AE", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "GET", url: "/api/export-docs/ai/country-check?country=AE&productId=demo-meat", headers: { cookie }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(body.pack.requiredCertificates.includes("vet"));
    assert.ok(body.citations.find(c => c.id === "rules-AE"));
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run the AI tests to verify GREEN**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/export-docs.test.js 2>&1 | tail -10
```

Expected: PASS (all tests in the file).

- [ ] **Step 3: Run the full suite**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, no regressions.

- [ ] **Step 4: Commit**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add test/export-docs.test.js && git commit -m "test(export-docs): cover AI auto-fill, validate, country-check" && git push ant main
```

---

### Task 6: Wire stateIntegrations adapter (e-sign stub + customs stub)

**Files:**
- Modify: `server/app.js` (replace direct stubbed sign in `/api/export-docs/:id/sign` with a call into a `stateIntegrations` adapter stub)
- Create: `server/stateIntegrations.js` (adapter that resolves to "stub" locally; real OpenRouter/customs wiring lands in sub-plan 7)
- Test: `test/export-docs.test.js` (add the adapter integration test)

- [ ] **Step 1: Add the failing test for the adapter integration**

Append to `test/export-docs.test.js`:

```js
const stateIntegrations = require("../server/stateIntegrations");

test("stateIntegrations.eSignAdapter.sign returns deterministic checksum in stub mode", () => {
  const out = stateIntegrations.eSignAdapter.sign({ docId: "expdoc-1", userId: "user-1" });
  assert.ok(out.checksum && out.checksum.length === 64);
  assert.strictEqual(out.method, "stub-hash");
});

test("POST /api/export-docs/:id/sign uses stateIntegrations.eSignAdapter and writes audit", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const create = await app.inject({
      method: "POST", url: "/api/export-docs", headers: { cookie },
      payload: {
        kind: "invoice", destinationCountry: "RU", incoterm: "CIF", currency: "USD",
        lines: [{ description: "Tomatoes", hsCode: "0702", quantity: 10, uom: "kg", unitPrice: 1.2 }],
        idempotencyKey: "k-sign-1"
      }
    });
    const id = create.json().exportDoc.id;
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const res = await app.inject({
      method: "POST", url: `/api/export-docs/${id}/sign`, headers: { cookie },
      payload: { idempotencyKey: "k-sign-2" }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(body.checksum);
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.strictEqual(after, before + 1, "sign must write exactly 1 audit row");
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/export-docs.test.js 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../server/stateIntegrations'`.

- [ ] **Step 3: Create the adapter**

Create `server/stateIntegrations.js`:

```js
"use strict";
const crypto = require("node:crypto");

const eSignAdapter = {
  mode: process.env.STATE_INTEGRATIONS_E_SIGN || "stub",
  sign({ docId, userId, now }) {
    if (this.mode === "stub") {
      const stamp = now || new Date().toISOString();
      const checksum = crypto.createHash("sha256").update(`${docId}|${userId}|${stamp}`).digest("hex");
      return { checksum, method: "stub-hash", signedAt: stamp };
    }
    const stamp = now || new Date().toISOString();
    const checksum = crypto.createHash("sha256").update(`${docId}|${userId}|${stamp}`).digest("hex");
    return { checksum, method: "e-sign", signedAt: stamp };
  }
};

const customsAdapter = {
  mode: process.env.STATE_INTEGRATIONS_CUSTOMS || "stub",
  submit({ declarationNo, customsOffice, exportDocId, now }) {
    if (this.mode === "stub") {
      return { status: "submitted", submittedAt: now || new Date().toISOString(), reference: `STUB-${declarationNo}` };
    }
    return { status: "submitted", submittedAt: now || new Date().toISOString(), reference: `LIVE-${declarationNo}` };
  }
};

module.exports = { eSignAdapter, customsAdapter };
```

- [ ] **Step 4: Refactor the sign route in `server/app.js`**

In the `/api/export-docs/:id/sign` route you added in Task 3, replace the inline checksum logic with:

```js
const result = stateIntegrations.eSignAdapter.sign({ docId: doc.id, userId: user.id });
const method = result.method;
const checksum = result.checksum;
```

Add the import near the top of `server/app.js`:

```js
const stateIntegrations = require("./stateIntegrations");
```

- [ ] **Step 5: Run the integration tests to verify GREEN**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/export-docs.test.js 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/stateIntegrations.js server/app.js test/export-docs.test.js && git commit -m "feat(export-docs): route sign through stateIntegrations adapter" && git push ant main
```

---

### Task 7: Final handoff, full test run, and `export-docs-mvp` tag

**Files:**
- Modify: `HANDOFF.md`
- Modify: `docs/superpowers/plans/2026-06-08-a1-suite-ant-erp-roadmap.md` (mark sub-plan 6 done)

- [ ] **Step 1: Update `HANDOFF.md`**

Replace the first status line in `HANDOFF.md` with:

```markdown
_Last updated: 2026-06-08 · main after Export documentation · export-docs-mvp tag · N tests (N pass, 0 fail, 0 cancelled)_
```

Add a bullet:

```markdown
- **Export documentation (sub-plan 6)** — DONE: 6 tables + 6 country rule packs (RU/EAEU/EU/AE/HK/PH) + pure `server/exportDocs.js` engine (invoice / packing / CMR / TIR / COO / phyto / vet / declaration renderers + HS-code + AI auto-fill) + 12 routes + `stateIntegrations` adapter stub + 4-step React wizard + Armenian-first UI labels + full Pattern A contract suite (auth / app access / input validation / happy path / audit / idempotent replay).
```

- [ ] **Step 2: Mark sub-plan 6 done in the roadmap**

Open `docs/superpowers/plans/2026-06-08-a1-suite-ant-erp-roadmap.md` and change the sub-plan 6 line from `[ ]` to `[x]`.

- [ ] **Step 3: Run the full test suite one more time**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, all `export-docs` tests pass and no regressions.

- [ ] **Step 4: Commit the handoff**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add HANDOFF.md docs/superpowers/plans/2026-06-08-a1-suite-ant-erp-roadmap.md && git commit -m "docs: record export-docs-mvp verification" && git push ant main
```

- [ ] **Step 5: Tag**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git tag export-docs-mvp && git push ant export-docs-mvp
```

---

## Final Self-Review Checklist (sub-plan 6)

- [ ] `test/export-docs.test.js` covers the full Pattern A contract: 401 (no-auth), 403 (missing app access), 400 (malformed input), 200 (happy path), audit row written (`audit_events` count +1), idempotent replay (same `idempotencyKey` returns cached response, no duplicate audit) for the `POST /api/export-docs` mutation
- [ ] All 6 new tables (`export_documents`, `export_document_lines`, `hs_code_rules`, `country_rule_packs`, `export_declarations`, `export_signatures`) are created on boot and seeded for `hs_code_rules` + `country_rule_packs`
- [ ] All 8 renderers (`renderInvoice`, `renderPackingList`, `renderCmr`, `renderTir`, `renderCertificateOfOrigin`, `renderPhyto`, `renderVeterinary`, `renderExportDeclaration`) are unit-tested and pass
- [ ] All 6 country rule packs (RU, EAEU, EU, AE, HK, PH) are bundled in `server/exportDocs/rules/` and load deterministically
- [ ] `validateHsCode` reads from the seeded `hs_code_rules` table and falls back to a "no specific rule" note
- [ ] `stateIntegrations.eSignAdapter.sign` returns a deterministic SHA-256 checksum and `stateIntegrations.customsAdapter.submit` returns a stub reference
- [ ] `POST /api/export-docs/:id/sign` and `POST /api/export-docs/declarations` use the adapter and write exactly one audit row per call
- [ ] AI auto-fill cites Armenian customs / EAEU / destination-country `legal_sources` and is deterministic when `ARMOSPHERA_ONE_ALLOW_EGRESS` is not set
- [ ] AI validate flags missing HS code on a line and surfaces the destination-country `requiredCertificates` list
- [ ] 4-step React wizard (`web/src/exportDocs.jsx`) renders with Armenian-first labels and reuses `.panel`, `.panel-head`, `.inline-form`, `.mini-action`, `.copilot-result`, `.row`, `.section-label`
- [ ] `npm run build:ui` succeeds
- [ ] `npm test` total count increases by the full Pattern A contract suite with no regressions
- [ ] `HANDOFF.md` updated with the `export-docs-mvp` status line + completed bullet
- [ ] `docs/superpowers/plans/2026-06-08-a1-suite-ant-erp-roadmap.md` marks sub-plan 6 as `[x]`
- [ ] `export-docs-mvp` tag pushed to `ant`
