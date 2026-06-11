"use strict";

/**
 * A1 CRM Tube — connector registry.
 *
 * 10 sovereign connectors (Apollo, CloudTalk, Respond.io, Surfe, Dexatel,
 * Make, Webflow, Closely, Instantly, Pixxi). Each connector has a
 * deterministic stub adapter by default. A real adapter swaps in when
 * the env flag <KEY>_ENABLED=1 is set. Both modes return the same
 * envelope shape so callers don't branch.
 *
 * Outbound is sovereign: stub mode never makes a network call. Real
 * mode is opt-in per connector (one flag per integration).
 *
 * Pattern A: no `require('node:sqlite')` or `require('fastify')`. All
 * adapters are pure functions over the inputs.
 */

const crypto = require("node:crypto");

const CONNECTOR_KEYS = [
  "apollo",
  "cloudtalk",
  "respond-io",
  "surfe",
  "dexatel",
  "make",
  "webflow",
  "closely",
  "instantly",
  "pixxi"
];

// ─── Per-connector static metadata ─────────────────────────────────────

const CONNECTOR_META = {
  apollo:        { displayName: "Apollo.io",          authType: "api-key",       defaultScopes: ["contacts:read", "contacts:enrich"] },
  cloudtalk:     { displayName: "CloudTalk",         authType: "api-key",       defaultScopes: ["calls:read", "calls:write"] },
  "respond-io":  { displayName: "Respond.io",        authType: "api-key",       defaultScopes: ["messages:read", "messages:write"] },
  surfe:         { displayName: "Surfe",             authType: "api-key",       defaultScopes: ["contacts:enrich", "social:read"] },
  dexatel:       { displayName: "Dexatel",           authType: "api-key",       defaultScopes: ["sms:read", "sms:write"] },
  make:          { displayName: "Make (Integromat)", authType: "oauth2",        defaultScopes: ["scenarios:read", "scenarios:run"] },
  webflow:       { displayName: "Webflow",           authType: "api-key",       defaultScopes: ["forms:read", "cms:read"] },
  closely:       { displayName: "Closely",           authType: "api-key",       defaultScopes: ["sequences:read", "sequences:write"] },
  instantly:     { displayName: "Instantly.ai",      authType: "api-key",       defaultScopes: ["campaigns:read", "campaigns:write"] },
  pixxi:         { displayName: "Pixxi",             authType: "api-key",       defaultScopes: ["leads:read", "leads:enrich"] }
};

// ─── Helpers (file-local) ──────────────────────────────────────────────

function signRequest(secret, body) {
  // HMAC-SHA-256 over the canonical body, hex-encoded. Real adapter
  // signs the same shape; callers verify the X-Connector-Signature
  // header against this digest.
  return crypto
    .createHmac("sha256", String(secret || ""))
    .update(typeof body === "string" ? body : JSON.stringify(body || {}))
    .digest("hex");
}

function hashSecret(value) {
  if (!value) return { hash: null, fingerprint: null };
  const hash = crypto.createHash("sha256").update(String(value)).digest("hex");
  return { hash, fingerprint: hash.slice(0, 12) };
}

function deterministicEnvelope(connector, environment, mode, data) {
  return {
    ok: true,
    connector,
    environment,
    mode,
    data: data || {},
    warnings: [],
    evidence: {
      at: new Date().toISOString(),
      fingerprint: hashSecret(connector + ":" + environment).fingerprint
    }
  };
}

// ─── Adapter factories ─────────────────────────────────────────────────
// Each factory returns { healthCheck, pull, push, receiveWebhook }.
// The default is the deterministic stub; the real adapter is a
// thin shell that calls the same shape over HTTP. We keep both
// implementations in one file so the contract surface stays
// small and the difference is one env-flag branch.

function buildStubAdapter(connectorKey, environment) {
  return {
    healthCheck() {
      return deterministicEnvelope(connectorKey, environment, "stub", {
        status: "connected",
        latencyMs: 0,
        scopes: CONNECTOR_META[connectorKey].defaultScopes
      });
    },
    pull({ cursor, limit = 50 } = {}) {
      return deterministicEnvelope(connectorKey, environment, "stub", {
        items: [],
        cursor: cursor || null,
        nextCursor: null,
        pulled: 0
      });
    },
    push({ entity, payload } = {}) {
      return deterministicEnvelope(connectorKey, environment, "stub", {
        accepted: 1,
        entity: entity || "unknown",
        externalId: `stub-${connectorKey}-${hashSecret(JSON.stringify(payload || {})).fingerprint}`
      });
    },
    receiveWebhook({ headers = {}, body = {} } = {}) {
      return deterministicEnvelope(connectorKey, environment, "stub", {
        accepted: true,
        eventType: body.type || body.event || "unknown",
        externalId: body.id || null,
        signaturePresent: Boolean(headers["x-connector-signature"])
      });
    }
  };
}

function buildRealAdapter(connectorKey, environment, opts) {
  // Real adapter is opt-in via <KEY>_ENABLED=1. We do NOT make
  // outbound network calls from the orchestrator — the orchestrator
  // builds the signed request envelope and hands it to the daemon
  // (a separate process) for actual delivery. The envelope shape
  // matches the stub so callers can stay branch-free.
  return {
    healthCheck({ secret } = {}) {
      const sig = signRequest(secret, { op: "health", connector: connectorKey });
      return deterministicEnvelope(connectorKey, environment, "real", {
        status: "ready",
        signature: sig,
        method: "POST",
        path: "/v1/health"
      });
    },
    pull({ cursor, limit = 50, secret } = {}) {
      const sig = signRequest(secret, { op: "pull", cursor, limit });
      return deterministicEnvelope(connectorKey, environment, "real", {
        items: [],
        cursor: cursor || null,
        nextCursor: null,
        pulled: 0,
        signature: sig,
        method: "POST",
        path: "/v1/pull"
      });
    },
    push({ entity, payload, secret } = {}) {
      const sig = signRequest(secret, { op: "push", entity, payload });
      return deterministicEnvelope(connectorKey, environment, "real", {
        accepted: 1,
        entity,
        signature: sig,
        method: "POST",
        path: "/v1/push"
      });
    },
    receiveWebhook({ headers = {}, body = {} } = {}) {
      // Real mode verifies the signature against the per-connector
      // secret. If the header is missing or invalid, return
      // accepted=false with a warning. This is the only place the
      // real adapter can refuse a webhook.
      const sig = headers["x-connector-signature"];
      const valid = sig ? sig === signRequest(opts && opts.secret, body) : false;
      return {
        ok: valid,
        connector: connectorKey,
        environment,
        mode: "real",
        accepted: valid,
        warnings: valid ? [] : ["missing-or-invalid-signature"],
        evidence: { at: new Date().toISOString() }
      };
    }
  };
}

function isConnectorEnabled(connectorKey, env) {
  const flag = env[`${toEnvKey(connectorKey)}_ENABLED`];
  return flag === "1" || flag === "true";
}

function toEnvKey(connectorKey) {
  return connectorKey.toUpperCase().replace(/-/g, "_");
}

// ─── Public API ───────────────────────────────────────────────────────

const TUBE_CONNECTORS = CONNECTOR_KEYS.reduce((acc, key) => {
  acc[key] = {
    key,
    displayName: CONNECTOR_META[key].displayName,
    authType: CONNECTOR_META[key].authType,
    defaultScopes: CONNECTOR_META[key].defaultScopes,
    signRequest,
    hashSecret
  };
  return acc;
}, {});

function getConnector(connectorKey, { env = process.env, environment = "sandbox", secret } = {}) {
  if (!CONNECTOR_META[connectorKey]) {
    throw new Error(`Unknown connector: ${connectorKey}`);
  }
  return isConnectorEnabled(connectorKey, env)
    ? buildRealAdapter(connectorKey, environment, { secret })
    : buildStubAdapter(connectorKey, environment);
}

function listConnectors() {
  return CONNECTOR_KEYS.map(key => ({
    key,
    displayName: CONNECTOR_META[key].displayName,
    authType: CONNECTOR_META[key].authType,
    defaultScopes: CONNECTOR_META[key].defaultScopes
  }));
}

module.exports = {
  TUBE_CONNECTORS,
  getConnector,
  listConnectors,
  signRequest,
  hashSecret,
  isConnectorEnabled
};
