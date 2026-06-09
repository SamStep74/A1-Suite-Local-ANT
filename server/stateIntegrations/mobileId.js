"use strict";
const crypto = require("node:crypto");

/**
 * Mobile ID (Beeline / VivaCell / Ucom) challenge adapter.
 * Real endpoint: requires EKENG service-provider cert.
 * Legal: RA Law on Electronic Trust Services.
 *
 * Phone format: +374 + 8 digits (Armenian mobile numbers).
 */

function validate(input) {
  const phone = String(input.phone || "");
  if (!/^\+374\d{8}$/.test(phone)) {
    const err = new Error("phone must match +374XXXXXXXX");
    err.statusCode = 400;
    throw err;
  }
}

async function prepare({ requestId, input }) {
  validate(input);
  return { requestId, payload: { phone: input.phone, op: "challenge" }, status: "prepared" };
}

async function send({ requestId }) {
  return {
    requestId,
    status: "sent",
    providerRef: `MID-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    challengeId: crypto.randomBytes(8).toString("hex"),
    ttl: 120
  };
}

async function fetchStatus({ providerRef }) {
  return { providerRef, status: "awaiting_user", lastCheckedAt: new Date().toISOString() };
}

async function cancel({ requestId }) {
  return { requestId, status: "cancelled" };
}

async function verifySignature() {
  return { verified: true, certificate: null, evidence: null };
}

module.exports = { prepare, send, fetchStatus, cancel, verifySignature };
