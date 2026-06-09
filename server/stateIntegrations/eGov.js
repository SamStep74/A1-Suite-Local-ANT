"use strict";
const crypto = require("node:crypto");

/**
 * e-Gov (e-gov.am) e-signature adapter.
 * Real endpoint: https://www.e-gov.am/ (production opt-in only).
 * Legal: RA Government Decree N 198-N (e-signature legal force).
 *
 * In test mode, the signature is a deterministic HMAC-SHA256 of the
 * document hash using a test-only key. Production replaces this with
 * real PKCS#7/CMS signing via the operator's service-provider cert.
 */

function validate(input) {
  if (!input.documentId || typeof input.documentId !== "string") {
    const err = new Error("documentId is required");
    err.statusCode = 400;
    throw err;
  }
  const claims = input.signerClaims || {};
  if (!/^AN\d{7}$/.test(String(claims.idNumber || ""))) {
    const err = new Error("signerClaims.idNumber must match AN\\d{7}");
    err.statusCode = 400;
    throw err;
  }
}

async function prepare({ requestId, input }) {
  validate(input);
  return {
    requestId,
    payload: {
      documentId: input.documentId,
      signerClaims: input.signerClaims,
      signedBytes: crypto.createHash("sha256").update(input.documentId).digest("hex")
    },
    status: "prepared"
  };
}

async function send({ requestId, payload }) {
  // Test-mode stub: deterministic HMAC using a clearly-labelled test key.
  // Production adapters MUST read the signing key from process.env.EGOV_SIGNING_KEY
  // (and refuse to run if unset). This stub refuses to run in production mode.
  if (process.env.STATE_INTEGRATION_MODE === "production") {
    throw new Error("eGov send() is a test stub; production signing not yet implemented");
  }
  const key = crypto.createHmac("sha256", "test-egov-signing-key").update(payload.signedBytes);
  return {
    requestId,
    status: "sent",
    providerRef: `EGOV-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    signatureB64: key.digest("base64"),
    certificateThumbprint: crypto.createHash("sha1").update("test-cert").digest("hex"),
    signedAt: new Date().toISOString()
  };
}

async function fetchStatus({ providerRef, orgId }) {
  // Stub: never claims completion. Real adapter re-queries the provider.
  return {
    providerRef,
    orgId: orgId || null,
    status: "unknown",
    lastCheckedAt: new Date().toISOString(),
    advisoryOnly: true
  };
}

async function cancel({ requestId, orgId }) {
  return { requestId, orgId: orgId || null, status: "cancelled", advisoryOnly: true };
}

async function verifySignature({ payload }) {
  // SECURITY: stubs MUST NOT return verified:true. Real signature verification
  // requires the operator's service-provider cert + the signed-bytes to recompute
  // the HMAC/signature and compare. The hub only ever relies on verified:false
  // in test mode; the audit row records the attempt, not the outcome.
  return {
    verified: false,
    mode: "test",
    advisoryOnly: true,
    certificate: { thumbprint: crypto.createHash("sha1").update("test-cert").digest("hex") },
    evidence: { documentId: payload && payload.documentId }
  };
}

module.exports = { prepare, send, fetchStatus, cancel, verifySignature };
