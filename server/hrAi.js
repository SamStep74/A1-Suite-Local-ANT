"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { allowEgress } = require("./config");
const hr = require("./hr");

function listTemplates(templatesDir) {
  return fs.readdirSync(templatesDir)
    .filter(name => name.endsWith(".md"))
    .map(name => ({ code: name.replace(/\.md$/, ""), title: name.replace(/\.md$/, "").replace(/-/g, " ") }));
}

function loadTemplate(templatesDir, code) {
  const safe = String(code || "").replace(/[^a-z0-9-]/gi, "");
  if (!safe) {
    const err = new Error("Invalid template code");
    err.statusCode = 400;
    throw err;
  }
  return fs.readFileSync(path.join(templatesDir, `${safe}.md`), "utf8");
}

function loadLegalSources(db, orgId) {
  return db.prepare(`
    SELECT id, title, status, 0 AS professionalReviewReady
    FROM legal_sources
    WHERE org_id = ? AND status = 'active'
    ORDER BY title
  `).all(orgId);
}

async function buildJobDescription({ db, orgId, position, language, templatesDir, fetchImpl }) {
  const legal = loadLegalSources(db, orgId);
  const local = hr.generateJobDescription({ position, language, legalSources: legal });
  const packet = {
    intent: "hr-job-description",
    language: local.language,
    body: local.body,
    citations: local.citations,
    advisoryOnly: true,
    reviewRequired: true,
    egressAttempted: false
  };
  if (!allowEgress()) return packet;
  if (typeof fetchImpl !== "function") return packet;
  try {
    const egress = await fetchImpl({ position, language: local.language, legalSources: legal });
    packet.egressAttempted = true;
    if (egress && typeof egress.body === "string") packet.body = egress.body;
    if (Array.isArray(egress?.citations)) packet.citations = egress.citations;
  } catch {
    // Egress failure: stay on local fallback; do not throw.
  }
  return packet;
}

async function buildOrderDraft({ db, orgId, employee, orderType, effectiveDate, orderNumber, templatesDir, fetchImpl }) {
  const legal = loadLegalSources(db, orgId);
  const issuer = db.prepare(`
    SELECT full_name AS fullName FROM people_employees WHERE org_id = ? AND id = ?
  `).get(orgId, employee?.approverId) || { fullName: "[Ղեկավար]" };
  const local = {
    intent: "hr-order",
    language: "hy-AM",
    bodyMd: hr.draftOrder({
      orderType,
      employeeName: employee?.fullName || "[Աշխատակից]",
      issuerName: issuer.fullName,
      effectiveDate,
      orderNumber
    }),
    citations: legal,
    advisoryOnly: true,
    reviewRequired: true,
    egressAttempted: false
  };
  if (!allowEgress()) return local;
  if (typeof fetchImpl !== "function") return local;
  try {
    const egress = await fetchImpl({ orderType, employee, effectiveDate, orderNumber, legalSources: legal });
    local.egressAttempted = true;
    if (egress && typeof egress.bodyMd === "string") local.bodyMd = egress.bodyMd;
  } catch {
    // Stay on local fallback.
  }
  return local;
}

module.exports = {
  listTemplates,
  loadTemplate,
  loadLegalSources,
  buildJobDescription,
  buildOrderDraft
};
