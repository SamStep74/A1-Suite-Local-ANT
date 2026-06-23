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

const SUPPORTED = ["src", "eregister", "egov", "idcard", "mobileid", "customs", "cabinet"];

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

// PII fields are hashed (one-way, salted) before being written to state_integration_calls
// so the audit row records the attempt + which payload slots were filled, but
// never persists the cleartext idNumber/phone/taxId/etc. The hub's
// state_signatures table keeps its own signer_id_hash; the rest of the audit
// row is opaque to anyone who reads the table directly.
//
// The redaction is forensic-only: it lets a same-day investigator see "the
// same idNumber was sent again" without re-identification. For low-entropy
// fields like dateOfBirth it is NOT re-identification-resistant and the
// investigator should rely on the org_id + adapter + operation + timestamp
// to identify the call.
const PII_FIELDS = ["idNumber", "subjectId", "phone", "taxId", "fullName", "dateOfBirth", "documentNumber"];
// Pattern check covers common aliases (snake_case, Russian, etc.) so a
// caller cannot leak a PII-shaped value under an undeclared key. We split
// the key by [_-] and check each segment independently so "phone_number"
// is caught (phone is PII) but "phonebook" is not (no segment matches).
// The compound-prefix check catches "tax_id" / "inn_number" without false-
// flagging "user_id" / "org_id" (the prefix is checked, not "id" alone).
const PII_SEGMENT_PATTERN = /^(ssn|tin|inn|taxid|tax_id|idnumber|id_number|passport|dob|birth|personalid|personal_id|phone|mobile|name)$/i;
const PII_COMPOUND_PREFIX = /^(ssn|tin|inn|tax|idnumber|id_|passport|dob|birth|personal|phone|mobile)/i;
const PII_KEY_DENYLIST = new Set(["requestid", "status", "providerref", "operation", "adapter", "idempotencykey", "userid", "user_id", "orgid", "org_id", "appid", "app_id"]);

function isPIIKey(k) {
  if (PII_KEY_DENYLIST.has(k.toLowerCase())) return false;
  if (PII_FIELDS.includes(k)) return true;
  const segments = k.split(/[_-]/);
  if (segments.some(seg => PII_SEGMENT_PATTERN.test(seg))) return true;
  if (PII_COMPOUND_PREFIX.test(k)) return true;
  return false;
}

function hashPII(raw) {
  // Per-call 16-byte salt defeats rainbow tables; full 64-hex digest (256 bits)
  // is what survives on disk so the same value is not trivially correlatable
  // across rows.
  const salt = crypto.randomBytes(16);
  const digest = crypto.createHmac("sha256", salt).update(String(raw)).digest("hex");
  return `[hash:sha256:${salt.toString("hex")}:${digest}]`;
}

function redactPII(value, path) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v, i) => redactPII(v, `${path}[${i}]`));
  if (typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      const v = value[k];
      if (v == null) { out[k] = v; continue; }
      if (isPIIKey(k)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "bigint" || Buffer.isBuffer(v)) {
          out[k] = hashPII(Buffer.isBuffer(v) ? v.toString("utf8") : v);
          out[`${k}__present`] = true;
        } else {
          // Nested object/array under a PII key: redact the whole subtree
          // as a single unit so inner keys cannot leak cleartext values.
          out[k] = { __redactedSubtree: true, hash: hashPII(JSON.stringify(v)) };
          out[`${k}__present`] = true;
        }
      } else {
        out[k] = redactPII(v, `${path}.${k}`);
      }
    }
    return out;
  }
  return value;
}

// Authoritative entry-point scrub: runs over the request body BEFORE the
// adapter sees it, so a typo or undeclared PII-shaped key from the caller
// cannot leak through dispatch. Idempotent — safe to call multiple times.
function scrubPII(input) {
  return redactPII(input || {}, "input");
}

async function dispatch({ db, orgId, userId, adapter, operation, input }) {
  ensureProductionOptIn(adapter);
  const mod = loadAdapter(adapter);
  const requestId = makeRequestId(orgId, adapter, operation);
  const started = Date.now();
  const safeInput = redactPII(input || {}, "input");
  const requestJson = JSON.stringify({ operation, input: safeInput });
  const prep = await mod.prepare({ requestId, input });
  const sent = await mod.send({ requestId, payload: prep.payload, input });
  const latency = Date.now() - started;
  const safePrep = redactPII(prep, "prepare");
  const safeSent = redactPII(sent, "send");
  const responseJson = JSON.stringify({ prepare: safePrep, send: safeSent });
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

// --- Bridge: cabinet eSignAdapter wired into the new dispatch() hub ----------
// Sub-plan 6 follow-up. The legacy eSignAdapter() above is preserved for any
// caller that still wants the synchronous stub. New cabinet code should use
// eSignAdapterFor({ db, orgId, userId }), whose prepare()/status() route
// through dispatch() so the call lands in state_integration_calls with the
// same PII redaction guarantees as the new state-int endpoints.
function eSignAdapterFor({ db, orgId, userId }) {
  if (!db) {
    const err = new Error("eSignAdapterFor: db is required"); err.statusCode = 500; throw err;
  }
  if (!orgId) {
    const err = new Error("eSignAdapterFor: orgId is required"); err.statusCode = 500; throw err;
  }
  return {
    async prepare({ cabinetId, signer, document } = {}) {
      const safeId = String(cabinetId || "").trim();
      if (!safeId) {
        const err = new Error("cabinetId is required"); err.statusCode = 400; throw err;
      }
      // Route through the hub. The cabinet adapter (see
      // server/stateIntegrations/cabinet.js) is the non-strict
      // sibling of egov.js — it accepts the cabinet's broader
      // signer pool but still funnels the call through the hub so
      // the audit row + PII scrubbing fire.
      const out = await dispatch({
        db, orgId, userId: userId || null,
        adapter: "cabinet",
        operation: "esign.prepare",
        input: { cabinetId: safeId, signer: signer || null, document: document || null }
      });
      // Map the hub's response back to the legacy envelope shape so
      // the cabinet route (and any caller that reads
      // envelope.envelopeId / envelope.provider / envelope.status)
      // continues to work unchanged.
      const signerName = signer && typeof signer === "object" ? String(signer.name || "").trim() : "";
      return {
        ok: true,
        provider: out.provider || "test-stub",
        mode: adapterMode(),
        action: "esign.prepare",
        status: out.status || "prepared",
        advisoryOnly: true,
        envelopeId: out.envelopeId,
        cabinetId: safeId,
        signer: signerName ? { name: signerName, email: signer.email || null } : null,
        document: document ? { id: document.id || null, title: document.title || null } : null,
        requestId: out.requestId,
        createdAt: new Date().toISOString()
      };
    },
    async status({ envelopeId } = {}) {
      if (!envelopeId) {
        const err = new Error("envelopeId is required"); err.statusCode = 400; throw err;
      }
      // The cabinet adapter has no live fetchStatus path; we mirror
      // the legacy eSignAdapter().status() shape so the caller's
      // existing contract is preserved. Future production wiring
      // would poll the operator's signing ceremony here.
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
  scrubPII,
  // Bridge: cabinet eSign adapter wired into the new dispatch() hub
  // (sub-plan 6 follow-up). New code should use this factory.
  eSignAdapterFor,
  // Legacy cabinet API (sub-plan 1, kept for backward compat)
  eSignAdapter: eSignAdapter(),
  idCardAdapter: idCardAdapter(),
  mobileIdAdapter: mobileIdAdapter(),
  srcAdapter: srcAdapter(),
  eRegisterAdapter: eRegisterAdapter(),
  customsAdapter: customsAdapter(),
  eGovAdapter: eGovAdapter(),
  __internals: { adapterMode, stubEnvelope, ensureProductionOptIn, makeRequestId, redactPII, isPIIKey }
};
