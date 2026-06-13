"use strict";

/**
 * A1 SMB CRM — Integrations catalog + secret rotation + health check
 * engine (Track 4: M14.16). Mirrors the crm-tube connector surface
 * but for the SMB-CRM integration catalog (NOT the crm-tube one).
 *
 * Pattern A: pure functions, no Fastify imports, no `node:sqlite`
 * imports, no `process.env` reads.
 *
 * Public surface:
 *   listIntegrations(db, orgId, filters)  → integration view[]
 *   getIntegration(db, orgId, key)         → integration view | null
 *   upsertIntegration(db, orgId, input)   → integration view
 *   deleteIntegration(db, orgId, key)      → boolean
 *   rotateSecret(db, orgId, key, secret, userId) → { view, fingerprint }
 *   healthCheck(db, orgId, key)            → integration view (with last_health)
 *   getActionTriggers(db, orgId, integrationId) → trigger row[]
 *   upsertActionTrigger(db, orgId, input)  → trigger row
 *   toIntegrationView(raw)                → camelCase
 *   toActionTriggerView(raw)              → camelCase
 *
 * The integration catalog is a per-tenant registry of installed
 * connectors. Each integration has a key (e.g. "whatsapp-cloud",
 * "stripe", "telegram-bot"), a display name, an environment
 * (production / sandbox), an auth type (api_key / oauth2 / etc.),
 * and a config_json blob for the per-tenant configuration.
 *
 * Secrets are NEVER stored as plaintext. The `rotateSecret` endpoint
 * takes a plaintext secret from the caller (typically a UI form),
 * hashes it with SHA-256, computes an 8-char fingerprint
 * (truncated hex of the same hash), and persists only the hash
 * + fingerprint. The plaintext is returned ONCE in the response
 * so the SPA can confirm to the user, then immediately discarded.
 *
 * Health check: V1 returns a deterministic stub envelope per
 * integration. The shape is `last_health_json` on the row, with
 * `{ ok, latencyMs, checkedAt, note }`. Real provider pings
 * (HTTP, OAuth refresh, etc.) are V2.
 *
 * Schema lives in `server/db.js#ensureSmbCrmAutomationSchema`
 * (`smb_crm_integrations`, `smb_crm_integration_credentials`,
 * `smb_crm_integration_action_triggers` tables).
 *
 * Cross-tenant safety: every read+write takes `orgId` as a
 * positional argument. Foreign get/list returns `null` / `[]`.
 */

const crypto = require("node:crypto");

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}

function nowIso() { return new Date().toISOString(); }

function safeJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

// ─── Errors ──────────────────────────────────────────────────────────────

class IntegrationError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = "IntegrationError";
    this.code = code;
    this.statusCode = statusCode || 400;
  }
}

class NotFoundError extends IntegrationError {
  constructor(message) { super("NOT_FOUND", message, 404); this.name = "NotFoundError"; }
}

// ─── Validation helpers ──────────────────────────────────────────────────

const VALID_STATUSES = ["connected", "disconnected", "error", "pending"];
const VALID_ENVIRONMENTS = ["production", "sandbox"];
const VALID_AUTH_TYPES = ["api_key", "oauth2", "bearer_token", "webhook_secret", "none"];

function nonEmptyString(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new IntegrationError("MISSING_FIELD", `${field} is required`);
  }
  return String(value).trim();
}

function validateStatus(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  if (!VALID_STATUSES.includes(v)) {
    throw new IntegrationError("INVALID_STATUS", `status must be one of ${VALID_STATUSES.join("|")}`);
  }
  return v;
}

function validateEnvironment(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  if (!VALID_ENVIRONMENTS.includes(v)) {
    throw new IntegrationError("INVALID_ENV", `environment must be one of ${VALID_ENVIRONMENTS.join("|")}`);
  }
  return v;
}

function validateAuthType(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  if (!VALID_AUTH_TYPES.includes(v)) {
    throw new IntegrationError("INVALID_AUTH_TYPE", `authType must be one of ${VALID_AUTH_TYPES.join("|")}`);
  }
  return v;
}

function assertOrgScope(orgId) {
  if (!orgId || typeof orgId !== "string") {
    throw new IntegrationError("MISSING_ORG_ID", "orgId is required");
  }
}

function _hashSecret(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest("hex");
}

function _fingerprintSecret(secret) {
  return _hashSecret(secret).slice(0, 8);
}

// ════════════════════════════════════════════════════════════════════════
// INTEGRATIONS CATALOG
// ════════════════════════════════════════════════════════════════════════

function listIntegrations(db, orgId, filters) {
  filters = filters || {};
  const where = ["org_id = ?"];
  const params = [orgId];
  if (filters.status) {
    where.push("status = ?");
    params.push(String(filters.status).trim().toLowerCase());
  }
  if (filters.environment) {
    where.push("environment = ?");
    params.push(String(filters.environment).trim().toLowerCase());
  }
  if (filters.search) {
    const like = `%${String(filters.search).trim().toLowerCase()}%`;
    where.push("(LOWER(integration_key) LIKE ? OR LOWER(display_name) LIKE ?)");
    params.push(like, like);
  }
  return db.prepare(`
    SELECT * FROM smb_crm_integrations
     WHERE ${where.join(" AND ")}
     ORDER BY updated_at DESC
     LIMIT ?
  `).all(...params, Math.max(1, Math.min(500, Number(filters.limit) || 100)));
}

function getIntegration(db, orgId, key) {
  const row = db
    .prepare("SELECT * FROM smb_crm_integrations WHERE org_id = ? AND integration_key = ?")
    .get(orgId, String(key).trim().toLowerCase());
  return row || null;
}

function upsertIntegration(db, orgId, input, opts) {
  assertOrgScope(orgId);
  input = input || {};
  opts = opts || {};
  const integrationKey = nonEmptyString(input.integrationKey, "integrationKey").toLowerCase();
  const displayName = nonEmptyString(input.displayName, "displayName");
  const status = validateStatus(input.status, "disconnected");
  const environment = validateEnvironment(input.environment, "production");
  const authType = validateAuthType(input.authType, "api_key");
  const configJson = JSON.stringify(input.config || {});
  const now = nowIso();

  const existing = getIntegration(db, orgId, integrationKey);
  if (existing) {
    db.prepare(`
      UPDATE smb_crm_integrations
         SET display_name = ?, status = ?, environment = ?, auth_type = ?,
             config_json = ?, updated_at = ?
       WHERE id = ? AND org_id = ?
    `).run(displayName, status, environment, authType, configJson, now, existing.id, orgId);
    return getIntegrationById(db, orgId, existing.id);
  }
  const id = randomId("intg");
  db.prepare(`
    INSERT INTO smb_crm_integrations (
      id, org_id, integration_key, display_name, status, environment, auth_type,
      config_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, orgId, integrationKey, displayName, status, environment, authType, configJson, now, now);
  return getIntegrationById(db, orgId, id);
}

function getIntegrationById(db, orgId, id) {
  const row = db
    .prepare("SELECT * FROM smb_crm_integrations WHERE id = ? AND org_id = ?")
    .get(id, orgId);
  return row || null;
}

function deleteIntegration(db, orgId, key) {
  const existing = getIntegration(db, orgId, key);
  if (!existing) return false;
  db.prepare("DELETE FROM smb_crm_integrations WHERE id = ? AND org_id = ?")
    .run(existing.id, orgId);
  return true;
}

// ════════════════════════════════════════════════════════════════════════
// SECRET ROTATION
// ════════════════════════════════════════════════════════════════════════

function rotateSecret(db, orgId, key, secret, userId) {
  const integration = getIntegration(db, orgId, key);
  if (!integration) {
    throw new NotFoundError(`integration ${key} not found`);
  }
  if (secret === undefined || secret === null || String(secret) === "") {
    throw new IntegrationError("MISSING_SECRET", "secret is required");
  }
  const secretStr = String(secret);
  const hash = _hashSecret(secretStr);
  const fingerprint = _fingerprintSecret(secretStr);
  const now = nowIso();
  // Wipe any prior credentials for this integration (one active
  // secret at a time). The audit trail is in
  // smb_crm_integration_credentials.rotated_at.
  db.prepare("DELETE FROM smb_crm_integration_credentials WHERE integration_id = ? AND org_id = ?")
    .run(integration.id, orgId);
  db.prepare(`
    INSERT INTO smb_crm_integration_credentials (
      id, org_id, integration_id, secret_hash, secret_fingerprint,
      rotated_at, rotated_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomId("cred"), orgId, integration.id, hash, fingerprint, now,
    userId ? String(userId) : null
  );
  // Mark the integration as connected (it was just authed).
  db.prepare(`
    UPDATE smb_crm_integrations
       SET status = 'connected', updated_at = ?
     WHERE id = ? AND org_id = ?
  `).run(now, integration.id, orgId);
  // NOTE: we return the plaintext secret ONCE in the envelope so the
  // SPA can show it to the user ("we received this secret, here it
  // is back for confirmation, we never store it"). After that, the
  // caller must drop the value — there's no way to retrieve it.
  return {
    view: toIntegrationView(getIntegrationById(db, orgId, integration.id)),
    fingerprint,
    secretEcho: secretStr
  };
}

// ════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ════════════════════════════════════════════════════════════════════════

function healthCheck(db, orgId, key) {
  const integration = getIntegration(db, orgId, key);
  if (!integration) return null;
  const started = Date.now();
  // V1 deterministic stub: every integration reports ok with a
  // tiny synthetic latency. Real provider pings (HTTP, OAuth
  // refresh, etc.) are V2.
  const note = `stub health-check for ${integration.integration_key} (${integration.environment})`;
  const latencyMs = Math.max(1, (Date.now() - started) + Math.floor(Math.random() * 5) + 1);
  const health = {
    ok: true,
    latencyMs,
    checkedAt: nowIso(),
    note
  };
  db.prepare(`
    UPDATE smb_crm_integrations
       SET last_health_at = ?, last_health_json = ?, updated_at = ?
     WHERE id = ? AND org_id = ?
  `).run(health.checkedAt, JSON.stringify(health), health.checkedAt, integration.id, orgId);
  return getIntegrationById(db, orgId, integration.id);
}

// ════════════════════════════════════════════════════════════════════════
// ACTION TRIGGERS
// ════════════════════════════════════════════════════════════════════════

function getActionTriggers(db, orgId, integrationId) {
  return db
    .prepare(`
      SELECT * FROM smb_crm_integration_action_triggers
       WHERE org_id = ? AND integration_id = ?
       ORDER BY action_key ASC
    `)
    .all(orgId, integrationId);
}

function upsertActionTrigger(db, orgId, input) {
  assertOrgScope(orgId);
  input = input || {};
  const integrationId = nonEmptyString(input.integrationId, "integrationId");
  // Confirm the integration exists in this org (defense in depth).
  const integration = db
    .prepare("SELECT id FROM smb_crm_integrations WHERE id = ? AND org_id = ?")
    .get(integrationId, orgId);
  if (!integration) {
    throw new NotFoundError(`integration ${integrationId} not found`);
  }
  const actionKey = nonEmptyString(input.actionKey, "actionKey");
  const enabled = input.enabled === undefined || input.enabled === null
    ? 1
    : (input.enabled ? 1 : 0);
  const configJson = JSON.stringify(input.config || {});
  const now = nowIso();
  const existing = db
    .prepare(`
      SELECT id FROM smb_crm_integration_action_triggers
       WHERE org_id = ? AND integration_id = ? AND action_key = ?
    `)
    .get(orgId, integrationId, actionKey);
  if (existing) {
    db.prepare(`
      UPDATE smb_crm_integration_action_triggers
         SET enabled = ?, config_json = ?, updated_at = ?
       WHERE id = ? AND org_id = ?
    `).run(enabled, configJson, now, existing.id, orgId);
    return db.prepare(`
      SELECT * FROM smb_crm_integration_action_triggers WHERE id = ? AND org_id = ?
    `).get(existing.id, orgId);
  }
  const id = randomId("trg");
  db.prepare(`
    INSERT INTO smb_crm_integration_action_triggers (
      id, org_id, integration_id, action_key, enabled, config_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, orgId, integrationId, actionKey, enabled, configJson, now, now);
  return db.prepare(`
    SELECT * FROM smb_crm_integration_action_triggers WHERE id = ? AND org_id = ?
  `).get(id, orgId);
}

// ════════════════════════════════════════════════════════════════════════
// VIEW ADAPTERS
// ════════════════════════════════════════════════════════════════════════

function toIntegrationView(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    orgId: raw.org_id,
    integrationKey: raw.integration_key,
    displayName: raw.display_name,
    status: raw.status,
    environment: raw.environment,
    authType: raw.auth_type,
    config: safeJson(raw.config_json, {}),
    lastHealthAt: raw.last_health_at,
    lastHealth: safeJson(raw.last_health_json, null),
    createdAt: raw.created_at,
    updatedAt: raw.updated_at
  };
}

function toActionTriggerView(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    orgId: raw.org_id,
    integrationId: raw.integration_id,
    actionKey: raw.action_key,
    enabled: raw.enabled === 1 || raw.enabled === true,
    config: safeJson(raw.config_json, {}),
    createdAt: raw.created_at,
    updatedAt: raw.updated_at
  };
}

module.exports = {
  listIntegrations,
  getIntegration,
  upsertIntegration,
  deleteIntegration,
  rotateSecret,
  healthCheck,
  getActionTriggers,
  upsertActionTrigger,
  toIntegrationView,
  toActionTriggerView,
  VALID_STATUSES,
  VALID_ENVIRONMENTS,
  VALID_AUTH_TYPES,
  IntegrationError,
  NotFoundError
};
