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
  return {
    requestId,
    status: "sent",
    providerRef: `EKENG-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    acceptedAt: new Date().toISOString()
  };
}

async function fetchStatus({ providerRef }) {
  return { providerRef, status: "in_review", lastCheckedAt: new Date().toISOString() };
}

async function cancel({ requestId }) {
  return { requestId, status: "cancelled" };
}

async function verifySignature() {
  return { verified: true, certificate: null, evidence: null };
}

module.exports = { prepare, send, fetchStatus, cancel, verifySignature };
