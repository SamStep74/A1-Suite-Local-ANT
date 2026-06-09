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
