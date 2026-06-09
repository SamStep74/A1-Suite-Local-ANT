"use strict";
const crypto = require("node:crypto");

/**
 * State Revenue Committee (SRC) — VAT return + e-invoice submission.
 * Real endpoint: https://www.taxservice.am/ (production opt-in only).
 * Legal: RA Tax Code Art. 44.
 */

function validateVatPayload(input) {
  const period = String(input.period || "");
  if (!/^\d{4}-Q[1-4]$/.test(period)) {
    const err = new Error("period must match YYYY-Q[1-4]");
    err.statusCode = 400;
    throw err;
  }
  const net = Number(input.netAmount);
  if (!Number.isFinite(net) || net < 0 || net > 1e12) {
    const err = new Error("netAmount must be 0..1e12");
    err.statusCode = 400;
    throw err;
  }
  const vat = Number(input.vatRate || 0);
  if (!Number.isFinite(vat) || vat < 0 || vat > 50) {
    const err = new Error("vatRate must be 0..50");
    err.statusCode = 400;
    throw err;
  }
}

async function prepare({ requestId, input }) {
  validateVatPayload(input);
  return {
    requestId,
    payload: {
      declarationType: "VAT-RETURN",
      period: input.period,
      netAmount: Number(input.netAmount),
      vatRate: Number(input.vatRate || 0),
      vatAmount: Math.round(Number(input.netAmount) * Number(input.vatRate || 0)), // integer minor units (cents/dram)
      vatAmountMajor: Math.round(Number(input.netAmount) * Number(input.vatRate || 0)) / 100, // display, 2-decimal rounded
      preparedAt: new Date().toISOString()
    },
    status: "prepared"
  };
}

async function send({ requestId }) {
  if (process.env.STATE_INTEGRATION_MODE === "production") {
    throw new Error("src send() is a test stub; production SRC submission not yet implemented");
  }
  return {
    requestId,
    status: "sent",
    providerRef: `SRC-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
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
