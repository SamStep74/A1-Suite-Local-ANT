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
