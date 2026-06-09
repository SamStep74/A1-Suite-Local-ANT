"use strict";
const crypto = require("node:crypto");

/**
 * Armenian ID card (Հայաստանի Հանրապետության անձնագիր) verification.
 * Real endpoint: requires Ministry of Justice service-provider cert.
 * Legal: RA Law on Personal Identification Cards.
 *
 * Subject ID format: AN + 7 digits (per Armenian ID card spec).
 */

function validate(input) {
  const sid = String(input.subjectId || "");
  if (!/^AN\d{7}$/.test(sid)) {
    const err = new Error("subjectId must match AN\\d{7}");
    err.statusCode = 400;
    throw err;
  }
}

async function prepare({ requestId, input }) {
  validate(input);
  return { requestId, payload: { subjectId: input.subjectId }, status: "prepared" };
}

async function send({ requestId }) {
  return {
    requestId,
    status: "sent",
    providerRef: `IDCARD-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    claims: {
      fullName: "Test User",
      dateOfBirth: "1990-01-01",
      nationality: "AM",
      documentNumber: "AN1234567"
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
