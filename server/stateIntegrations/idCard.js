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

async function send({ requestId, input }) {
  if (process.env.STATE_INTEGRATION_MODE === "production") {
    throw new Error("idCard send() is a test stub; production verification not yet implemented");
  }
  // Stub: do NOT echo back any identity claims. The hub stores the request
  // hash; the real claims only come from a Ministry of Justice cert handshake.
  return {
    requestId,
    status: "sent",
    providerRef: `IDCARD-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    claims: null,
    advisoryOnly: true,
    requestedSubjectId: input && input.subjectId ? String(input.subjectId) : null
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
