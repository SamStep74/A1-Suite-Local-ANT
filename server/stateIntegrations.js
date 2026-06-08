"use strict";

/**
 * State Integrations adapter registry (Armenian state e-services stub).
 *
 * This module is the single seam between A1-Suite and Armenian state
 * e-services (e-signature, ID Card, Mobile ID, e-Register, e-Gov,
 * SRC, customs). In test mode (the default for this MVP) every
 * adapter returns a deterministic envelope WITHOUT making any network
 * call. The real adapters are added in sub-plan 7.
 *
 * Selection is driven by `STATE_INTEGRATION_MODE`:
 *   - "test"   (default) — every adapter returns a stub envelope.
 *   - "live"             — calls the real adapter; throws if the
 *                          adapter has not been implemented yet.
 *
 * The route layer in `server/documentCabinetRoutes.js` is the only
 * caller; this module never owns auth, app access, idempotency, or
 * audit. Each adapter is a pure function that returns a JSON envelope.
 */

function adapterMode() {
  const raw = process.env.STATE_INTEGRATION_MODE;
  const value = String(raw == null ? "" : raw).trim().toLowerCase();
  return value === "live" ? "live" : "test";
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
      if (adapterMode() === "live") {
        return liveNotImplemented("eSign", "prepare");
      }
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
      if (adapterMode() === "live") {
        return liveNotImplemented("eSign", "status");
      }
      return stubEnvelope("test-stub", "esign.status", {
        envelopeId,
        status: "pending"
      });
    }
  };
}

function idCardAdapter() {
  return {
    verify({ personalId } = {}) {
      if (!personalId) {
        const e = new Error("personalId is required"); e.statusCode = 400; throw e;
      }
      if (adapterMode() === "live") {
        return liveNotImplemented("IDCard", "verify");
      }
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
      if (adapterMode() === "live") {
        return liveNotImplemented("MobileID", "challenge");
      }
      return stubEnvelope("test-stub", "mobileid.challenge", {
        challengeId: `ch-test-${Date.now().toString(36)}`,
        phone: String(phone)
      });
    },
    confirm({ challengeId, code } = {}) {
      if (!challengeId || !code) {
        const e = new Error("challengeId and code are required"); e.statusCode = 400; throw e;
      }
      if (adapterMode() === "live") {
        return liveNotImplemented("MobileID", "confirm");
      }
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
      if (adapterMode() === "live") {
        return liveNotImplemented("SRC", "submitVatReturn");
      }
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
      if (adapterMode() === "live") {
        return liveNotImplemented("eRegister", "lookupCompany");
      }
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
      if (adapterMode() === "live") {
        return liveNotImplemented("Customs", "declare");
      }
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
      if (adapterMode() === "live") {
        return liveNotImplemented("eGov", "submitApplication");
      }
      return stubEnvelope("test-stub", "egov.submit", {
        applicationType: String(applicationType),
        referenceNumber: `egov-test-${Date.now().toString(36)}`,
        payload: payload || null
      });
    }
  };
}

const adapters = {
  eSign: eSignAdapter,
  idCard: idCardAdapter,
  mobileId: mobileIdAdapter,
  src: srcAdapter,
  eRegister: eRegisterAdapter,
  customs: customsAdapter,
  eGov: eGovAdapter
};

function getAdapter(name) {
  const factory = adapters[name];
  if (!factory) {
    const e = new Error(`Unknown state integration adapter: ${name}`);
    e.statusCode = 400;
    throw e;
  }
  return factory();
}

function listAdapters() {
  return Object.keys(adapters).map(name => ({
    name,
    mode: adapterMode()
  }));
}

module.exports = {
  // Adapter factory functions (preferred for production callers)
  eSignAdapter: eSignAdapter(),
  idCardAdapter: idCardAdapter(),
  mobileIdAdapter: mobileIdAdapter(),
  srcAdapter: srcAdapter(),
  eRegisterAdapter: eRegisterAdapter(),
  customsAdapter: customsAdapter(),
  eGovAdapter: eGovAdapter(),
  // Registry helpers
  getAdapter,
  listAdapters,
  // Exposed for tests:
  __internals: { adapterMode, stubEnvelope }
};
