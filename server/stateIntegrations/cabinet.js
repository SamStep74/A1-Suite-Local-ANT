"use strict";
const crypto = require("node:crypto");

/**
 * Document-cabinet e-signature bridge (sub-plan 6 follow-up).
 *
 * The legacy `eSignAdapter()` in server/stateIntegrations.js returns a
 * synchronous stub envelope — no audit row, no PII redaction. This adapter
 * gives the cabinet flow a path through the new dispatch() hub so the
 * call lands in `state_integration_calls` with the same PII-scrubbing
 * guarantees as the new state-int endpoints, without coupling the
 * cabinet to the strict `AN\d{7}` idNumber validation that
 * `server/stateIntegrations/egov.js` enforces for the production
 * e-gov.am sign endpoint.
 *
 * Real endpoint: still n/a — cabinet e-sign in this codebase is a
 * pre-flight envelope preparer; the actual signing ceremony is run by
 * the operator's PKCS#7/CMS stack outside the API.
 *
 * In test mode the envelope id is deterministic from
 * (requestId, cabinetId) so a replay under the same idempotency key
 * produces the same shape. In production the hub refuses to run unless
 * the adapter is explicitly opted in.
 */

function validate(input) {
  if (!input.cabinetId || typeof input.cabinetId !== "string") {
    const err = new Error("cabinetId is required");
    err.statusCode = 400;
    throw err;
  }
  // The signer's idNumber (if any) is recorded in the audit row, not
  // validated here — the cabinet's signer pool is broader than the
  // e-gov.am certified signer pool, and we don't want this bridge to
  // reject cabinet signers that the real signing ceremony may later
  // accept (foreign spouses, B2B authorised agents, etc.).
}

async function prepare({ requestId, input }) {
  validate(input);
  return {
    requestId,
    payload: {
      cabinetId: String(input.cabinetId),
      signerClaims: input.signer || null,
      document: input.document || null,
      preparedAt: new Date().toISOString()
    },
    status: "prepared"
  };
}

async function send({ requestId, payload }) {
  if (process.env.STATE_INTEGRATION_MODE === "production") {
    throw new Error("cabinet send() is a test stub; production cabinet e-sign not yet implemented");
  }
  // Deterministic envelope id from (requestId, cabinetId) so idempotent
  // replays produce the same envelopeId. This matches the legacy
  // eSignAdapter()'s `env-test-<cabinetId>-<ts>` shape prefix and lets
  // the cabinet route's `readCachedIdempotent` short-circuit replays
  // before the hub even runs.
  const envelopeId = `env-test-${payload.cabinetId}-${crypto.createHash("sha256")
    .update(String(requestId))
    .digest("hex")
    .slice(0, 10)}`;
  return {
    requestId,
    status: "prepared",
    envelopeId,
    provider: "test-stub",
    providerRef: `CABINET-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    cabinetId: payload.cabinetId,
    signedAt: new Date().toISOString(),
    advisoryOnly: true
  };
}

async function fetchStatus({ providerRef, orgId }) {
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

async function verifySignature() {
  // SECURITY: stubs MUST NOT return verified:true. The cabinet flow has
  // not yet run the real signing ceremony; the hub only persists the
  // attempt and the PII-scrubbed payload.
  return { verified: false, mode: "test", advisoryOnly: true, certificate: null, evidence: null };
}

module.exports = { prepare, send, fetchStatus, cancel, verifySignature };
