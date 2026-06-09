"use strict";
const crypto = require("node:crypto");

/**
 * e-Register.am — State Register of Legal Entities (SRLE) counterparty lookup.
 * Real endpoint: https://www.e-register.am/ (production opt-in only).
 * Legal: RA Law on State Registration of Legal Entities.
 *
 * The Armenian TIN (taxpayer identification number, ՀԾՀ) is 8 digits
 * for legal entities and 10 digits for individual entrepreneurs.
 * This adapter accepts 8-digit TIN for legal-entity lookups (per the
 * sub-plan 7 spec).
 */

function validate(input) {
  const taxId = String(input.taxId || "");
  if (!/^\d{8}$/.test(taxId)) {
    const err = new Error("taxId must be 8 digits (Armenian TIN format)");
    err.statusCode = 400;
    throw err;
  }
}

async function prepare({ requestId, input }) {
  validate(input);
  return {
    requestId,
    payload: { queryType: "LEGAL_ENTITY_LOOKUP", taxId: input.taxId },
    status: "prepared"
  };
}

async function send({ requestId, payload }) {
  if (process.env.STATE_INTEGRATION_MODE === "production") {
    throw new Error("eRegister send() is a test stub; production SRLE lookup not yet implemented");
  }
  // SECURITY: do NOT echo back a fake legal-entity record. Production must hit
  // the real e-register.am endpoint. The stub only records that a lookup was
  // attempted for the validated taxId; downstream code must treat record=null
  // as "no real lookup performed".
  return {
    requestId,
    status: "sent",
    providerRef: `SRLE-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    record: null,
    advisoryOnly: true,
    requestedTaxId: payload.taxId
  };
}

async function fetchStatus({ providerRef, orgId }) {
  return { providerRef, orgId: orgId || null, status: "unknown", lastCheckedAt: new Date().toISOString(), advisoryOnly: true };
}

async function cancel({ requestId, orgId }) {
  return { requestId, orgId: orgId || null, status: "cancelled", advisoryOnly: true };
}

async function verifySignature() {
  return { verified: false, mode: "test", advisoryOnly: true, certificate: null, evidence: null };
}

module.exports = { prepare, send, fetchStatus, cancel, verifySignature };
