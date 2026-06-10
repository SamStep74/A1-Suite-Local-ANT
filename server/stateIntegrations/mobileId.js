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

async function send({ requestId, payload }) {
  if (process.env.STATE_INTEGRATION_MODE === "production") {
    throw new Error("mobileId send() is a test stub; production Mobile-ID not yet implemented");
  }
  // SECURITY: bind challengeId to the validated phone so a confirm() step
  // (or a replay) cannot reuse a challenge issued for a different number.
  // The hash is one-way; the real provider keeps the phone in its DB.
  const phoneHash = crypto.createHash("sha256").update(String(payload.phone || "")).digest("hex");
  const challengeId = `${phoneHash.slice(0, 16)}-${crypto.randomBytes(6).toString("hex")}`;
  return {
    requestId,
    status: "sent",
    providerRef: `MID-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    challengeId,
    ttl: 120,
    advisoryOnly: true
  };
}

async function fetchStatus({ providerRef, orgId }) {
  return { providerRef, orgId: orgId || null, status: "awaiting_user", lastCheckedAt: new Date().toISOString(), advisoryOnly: true };
}

async function cancel({ requestId, orgId }) {
  return { requestId, orgId: orgId || null, status: "cancelled", advisoryOnly: true };
}

async function verifySignature() {
  return { verified: false, mode: "test", advisoryOnly: true, certificate: null, evidence: null };
}

module.exports = { prepare, send, fetchStatus, cancel, verifySignature };
