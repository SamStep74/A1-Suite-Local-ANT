"use strict";
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * State Integrations hub (sub-plan 7).
 *
 * Two coexisting APIs:
 *
 *  1) NEW — sub-plan 7 hub: dispatch({ db, orgId, userId, adapter, operation, input })
 *     routes through a 5-method contract (prepare, send, fetchStatus, cancel,
 *     verifySignature) implemented by per-adapter modules under
 *     `server/stateIntegrations/*.js`. In test mode (default) every adapter
 *     returns a deterministic envelope; real production adapters are gated
 *     behind `STATE_INTEGRATION_MODE=production` + per-adapter `*_ENABLED=1`.
 *     The hub is the single owner of `state_integration_calls`,
 *     `state_signatures`, and `state_id_verifications` audit rows.
 *
 *  2) LEGACY — pre-sub-plan-7 document-cabinet e-sign: the eSignAdapter,
 *     idCardAdapter, etc. instances below. The cabinet routes call them
 *     directly via `stateIntegrations.eSignAdapter.prepare({...})`. Kept for
 *     backward compatibility; new code should use dispatch().
 */

const SUPPORTED = ["src", "eregister", "egov", "idcard", "mobileid", "customs"];

function loadAdapter(name) {
  if (!SUPPORTED.includes(name)) {
    const err = new Error(`unknown state-integration adapter: ${name}`);
    err.statusCode = 404;
    throw err;
  }
  return require(path.join(__dirname, "stateIntegrations", `${name}.js`));
}

function currentMode() {
  return process.env.STATE_INTEGRATION_MODE === "production" ? "production" : "test";
}

function isAdapterEnabled(name) {
  if (currentMode() !== "production") return true;
  return process.env[`${name.toUpperCase()}_ENABLED`] === "1";
}

function ensureProductionOptIn(name) {
  if (currentMode() === "production" && !isAdapterEnabled(name)) {
    const err = new Error(`${name} adapter requires ${name.toUpperCase()}_ENABLED=1 in production`);
    err.statusCode = 403;
    throw err;
  }
}

function makeRequestId(orgId, adapter, operation) {
  return `si-${String(orgId).slice(0, 6)}-${adapter}-${operation}-${crypto.randomBytes(6).toString("hex")}`;
}

async function dispatch({ db, orgId, userId, adapter, operation, input }) {
  ensureProductionOptIn(adapter);
  const mod = loadAdapter(adapter);
  const requestId = makeRequestId(orgId, adapter, operation);
  const started = Date.now();
  const requestJson = JSON.stringify({ operation, input });
  const prep = await mod.prepare({ requestId, input });
  const sent = await mod.send({ requestId, payload: prep.payload, input });
  const latency = Date.now() - started;
  const responseJson = JSON.stringify({ prepare: prep, send: sent });
  const callId = `sic-${crypto.randomBytes(8).toString("hex")}`;
  db.prepare(`INSERT INTO state_integration_calls
    (id, org_id, adapter, operation, request_id, request_json, response_json, status, latency_ms, called_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    callId, orgId, adapter, operation, requestId, requestJson, responseJson, sent.status, latency, new Date().toISOString()
  );
  if (adapter === "egov" && operation === "sign") {
    const sigId = `sig-${crypto.randomBytes(8).toString("hex")}`;
    const signerHash = crypto.createHash("sha256").update(String((input.signerClaims && input.signerClaims.idNumber) || "")).digest("hex");
    const docId = String(input.documentId || "");
    db.prepare(`INSERT INTO state_signatures
      (id, org_id, document_id, adapter, signer_id_hash, signed_at, signature_b64, certificate_thumbprint, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      sigId, orgId, docId, adapter, signerHash, new Date().toISOString(),
      sent.signatureB64 || "", sent.certificateThumbprint || "", "valid"
    );
  }
  if (adapter === "idcard" && operation === "verify") {
    const verId = `idv-${crypto.randomBytes(8).toString("hex")}`;
    db.prepare(`INSERT INTO state_id_verifications
      (id, org_id, subject_id, adapter, verified_at, claims_json, evidence_doc_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      verId, orgId, String(input.subjectId || "unknown"), adapter,
      new Date().toISOString(), JSON.stringify(sent.claims || {}), null
    );
  }
  return { requestId, status: sent.status, ...sent };
}

// --- Legacy cabinet API (preserved for documentCabinetRoutes) ----------------

function adapterMode() {
  return currentMode() === "production" ? "live" : "test";
}

function stubEnvelope(provider, action, extra) {
  const ts = new Date().toISOString();
  return Object.assign({
    provider,
    mode: "test",
    action,
    status: "pending",
    createdAt: ts,
    advisoryOnly: true
  }, extra || {});
}

function liveNotImplemented(provider, action) {
  const err = new Error(`State integration "${provider}" is not yet implemented in live mode`);
  err.statusCode = 501;
  err.details = { provider, action };
  throw err;
}

function eSignAdapter() {
  return {
    prepare({ cabinetId, signer, document } = {}) {
      const safeId = String(cabinetId || "").trim();
      if (!safeId) {
        const e = new Error("cabinetId is required"); e.statusCode = 400; throw e;
      }
      if (adapterMode() === "live") return liveNotImplemented("eSign", "prepare");
      const envelopeId = `env-test-${safeId}-${Date.now().toString(36)}`;
      const signerName = signer && typeof signer === "object" ? String(signer.name || "").trim() : "";
      return stubEnvelope("test-stub", "esign.prepare", {
        envelopeId,
        status: "prepared",
        cabinetId: safeId,
        signer: signerName ? { name: signerName, email: signer.email || null } : null,
        document: document ? { id: document.id || null, title: document.title || null } : null
      });
    },
    status({ envelopeId } = {}) {
      if (!envelopeId) {
        const e = new Error("envelopeId is required"); e.statusCode = 400; throw e;
      }
      if (adapterMode() === "live") return liveNotImplemented("eSign", "status");
      return stubEnvelope("test-stub", "esign.status", { envelopeId, status: "pending" });
    }
  };
}

function idCardAdapter() {
  return {
    verify({ personalId } = {}) {
      if (!personalId) {
        const e = new Error("personalId is required"); e.statusCode = 400; throw e;
      }
      if (adapterMode() === "live") return liveNotImplemented("IDCard", "verify");
      return stubEnvelope("test-stub", "idcard.verify", {
        verified: true,
        personalId: String(personalId)
      });
    }
  };
}

function mobileIdAdapter() {
  return {
    challenge({ phone } = {}) {
      if (!phone) {
        const e = new Error("phone is required"); e.statusCode = 400; throw e;
      }
      if (adapterMode() === "live") return liveNotImplemented("MobileID", "challenge");
      return stubEnvelope("test-stub", "mobileid.challenge", {
        challengeId: `ch-test-${Date.now().toString(36)}`,
        phone: String(phone)
      });
    },
    confirm({ challengeId, code } = {}) {
      if (!challengeId || !code) {
        const e = new Error("challengeId and code are required"); e.statusCode = 400; throw e;
      }
      if (adapterMode() === "live") return liveNotImplemented("MobileID", "confirm");
      return stubEnvelope("test-stub", "mobileid.confirm", {
        challengeId: String(challengeId),
        verified: true
      });
    }
  };
}

function srcAdapter() {
  return {
    submitVatReturn({ period, totals } = {}) {
      if (!period) {
        const e = new Error("period is required"); e.statusCode = 400; throw e;
      }
      if (adapterMode() === "live") return liveNotImplemented("SRC", "submitVatReturn");
      return stubEnvelope("test-stub", "src.vat.submit", {
        period: String(period),
        totals: totals || null,
        referenceNumber: `src-test-${Date.now().toString(36)}`
      });
    }
  };
}

function eRegisterAdapter() {
  return {
    lookupCompany({ taxId } = {}) {
      if (!taxId) {
        const e = new Error("taxId is required"); e.statusCode = 400; throw e;
      }
      if (adapterMode() === "live") return liveNotImplemented("eRegister", "lookupCompany");
      return stubEnvelope("test-stub", "eregister.lookup", {
        taxId: String(taxId),
        name: "Test Company LLC",
        status: "active"
      });
    }
  };
}

function customsAdapter() {
  return {
    declare({ declarationId } = {}) {
      if (!declarationId) {
        const e = new Error("declarationId is required"); e.statusCode = 400; throw e;
      }
      if (adapterMode() === "live") return liveNotImplemented("Customs", "declare");
      return stubEnvelope("test-stub", "customs.declare", {
        declarationId: String(declarationId),
        status: "submitted"
      });
    }
  };
}

function eGovAdapter() {
  return {
    submitApplication({ applicationType, payload } = {}) {
      if (!applicationType) {
        const e = new Error("applicationType is required"); e.statusCode = 400; throw e;
      }
      if (adapterMode() === "live") return liveNotImplemented("eGov", "submitApplication");
      return stubEnvelope("test-stub", "egov.submit", {
        applicationType: String(applicationType),
        referenceNumber: `egov-test-${Date.now().toString(36)}`,
        payload: payload || null
      });
    }
  };
}

module.exports = {
  // New hub API (sub-plan 7)
  dispatch,
  loadAdapter,
  currentMode,
  isAdapterEnabled,
  SUPPORTED,
  // Legacy cabinet API (sub-plan 1, kept for backward compat)
  eSignAdapter: eSignAdapter(),
  idCardAdapter: idCardAdapter(),
  mobileIdAdapter: mobileIdAdapter(),
  srcAdapter: srcAdapter(),
  eRegisterAdapter: eRegisterAdapter(),
  customsAdapter: customsAdapter(),
  eGovAdapter: eGovAdapter(),
  __internals: { adapterMode, stubEnvelope, ensureProductionOptIn, makeRequestId }
};
