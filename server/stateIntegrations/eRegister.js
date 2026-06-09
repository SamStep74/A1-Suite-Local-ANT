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
  return {
    requestId,
    status: "sent",
    providerRef: `SRLE-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    record: {
      taxId: payload.taxId,
      legalName: "Փորձնական ՍՊԸ (Test LLC)",
      status: "ACTIVE",
      registeredOn: "2018-04-12",
      address: "Երևան, Աբովյան 1"
    }
  };
}

async function fetchStatus({ providerRef }) {
  return { providerRef, status: "completed", lastCheckedAt: new Date().toISOString() };
}

async function cancel({ requestId }) {
  return { requestId, status: "cancelled" };
}

async function verifySignature() {
  return { verified: true, certificate: null, evidence: null };
}

module.exports = { prepare, send, fetchStatus, cancel, verifySignature };
