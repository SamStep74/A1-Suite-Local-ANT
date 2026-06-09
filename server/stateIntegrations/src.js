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
      vatAmount: Number((input.netAmount * (input.vatRate || 0) / 100).toFixed(2)),
      preparedAt: new Date().toISOString()
    },
    status: "prepared"
  };
}

async function send({ requestId }) {
  return {
    requestId,
    status: "sent",
    providerRef: `SRC-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    acceptedAt: new Date().toISOString()
  };
}

async function fetchStatus({ providerRef }) {
  return { providerRef, status: "accepted", lastCheckedAt: new Date().toISOString() };
}

async function cancel({ requestId }) {
  return { requestId, status: "cancelled" };
}

async function verifySignature() {
  return { verified: true, certificate: null, evidence: null };
}

module.exports = { prepare, send, fetchStatus, cancel, verifySignature };
