"use strict";
const crypto = require("node:crypto");

/**
 * e-Customs (EKENG) — import/export/transit declarations.
 * Real endpoint: https://www.customs.am/ + EKENG trusted integration.
 * Legal: RA Customs Code Art. 175.
 *
 * HS code: 6-10 digits per WCO Harmonized System; declarationType is
 * IMPORT | EXPORT | TRANSIT.
 */

function validate(input) {
  const declType = String(input.declarationType || "");
  if (!["IMPORT", "EXPORT", "TRANSIT"].includes(declType)) {
    const err = new Error("declarationType must be IMPORT | EXPORT | TRANSIT");
    err.statusCode = 400;
    throw err;
  }
  const hsCode = String(input.hsCode || "");
  if (!/^\d{6,10}$/.test(hsCode)) {
    const err = new Error("hsCode must be 6-10 digits");
    err.statusCode = 400;
    throw err;
  }
  const value = Number(input.declaredValue);
  if (!Number.isFinite(value) || value < 0) {
    const err = new Error("declaredValue must be a non-negative number");
    err.statusCode = 400;
    throw err;
  }
}

async function prepare({ requestId, input }) {
  validate(input);
  return {
    requestId,
    payload: {
      declarationType: input.declarationType,
      hsCode: input.hsCode,
      declaredValue: input.declaredValue,
      currency: input.currency || "AMD"
    },
    status: "prepared"
  };
}

async function send({ requestId }) {
  if (process.env.STATE_INTEGRATION_MODE === "production") {
    throw new Error("customs send() is a test stub; production EKENG submission not yet implemented");
  }
  return {
    requestId,
    status: "sent",
    providerRef: `EKENG-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    acceptedAt: new Date().toISOString(),
    advisoryOnly: true
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
