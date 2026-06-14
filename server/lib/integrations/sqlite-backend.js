/**
 * integrations/sqlite-backend — SQLite-backed adapters that wire
 * the pure engines (token-store, state-store, scheduler) to the
 * ANT integration tables.
 *
 * Two adapters, one file because they share the same `db` and
 * integrate against the same `smb_crm_integrations` table:
 *
 *   1. createIntegrationBackend(db)
 *      Implements the 3-method IntegrationBackend contract for
 *      `createOAuthTokenStore`:
 *        - findByTenantProvider(orgId, provider) → row | null
 *        - updateCredentials(id, credentials)     → void
 *      Reads/writes `smb_crm_integrations.config_json` (the JSON
 *      envelope where `oauth.<provider>` lives).
 *
 *   2. createIntegrationListBackend(db)
 *      Implements the 1-method IntegrationStore contract for
 *      `enumerateTenantsWithOAuth`:
 *        - findManyByTypeAndStatus(types, status) → rows
 *      Reads `smb_crm_integrations.integration_key` (the
 *      `type` column in MAX) and `status` columns.
 *
 *   3. createSqliteKvBackend(db)
 *      Implements the 3-method KV contract for
 *      `storeOAuthState`:
 *        - set(key, value, ttlMs)
 *        - getAndDelete(key)  (atomic)
 *        - deleteByPrefix(prefix)
 *      Backed by a small `oauth_state_kv` table (auto-created).
 *      Production uses this; tests can pass an in-memory backend
 *      via the same contract.
 *
 * All three are pure wrappings around `db` (no fetch, no logging,
 * no global state). The callers compose them into the engine
 * factories from slices 1-4.
 */
'use strict';

const crypto = require('node:crypto');

/* ─── 1. IntegrationBackend (for createOAuthTokenStore) ──────────── */

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{
 *   findByTenantProvider: (orgId: string, provider: string) => Promise<{id: string, credentials: Record<string,unknown>|null}|null>,
 *   updateCredentials: (id: string, credentials: Record<string,unknown>) => Promise<void>,
 *   findById: (id: string) => Promise<{id: string, org_id: string, integration_key: string, status: string, credentials: Record<string,unknown>|null}|null>
 * }}
 */
function createIntegrationBackend(db) {
  function rowToCredentials(row) {
    if (!row) return null;
    if (row.config_json) {
      try {
        return JSON.parse(row.config_json);
      } catch {
        return {};
      }
    }
    return {};
  }

  return {
    async findByTenantProvider(orgId, provider) {
      if (!orgId || !provider) return null;
      const row = db
        .prepare(
          'SELECT id, config_json FROM smb_crm_integrations WHERE org_id = ? AND integration_key = ?'
        )
        .get(orgId, provider);
      if (!row) return null;
      return { id: row.id, credentials: rowToCredentials(row) };
    },

    async updateCredentials(id, credentials) {
      db.prepare(
        'UPDATE smb_crm_integrations SET config_json = ?, updated_at = ? WHERE id = ?'
      ).run(JSON.stringify(credentials || {}), new Date().toISOString(), id);
    },

    async findById(id) {
      const row = db
        .prepare(
          'SELECT id, org_id, integration_key, status, config_json FROM smb_crm_integrations WHERE id = ?'
        )
        .get(id);
      if (!row) return null;
      return {
        id: row.id,
        org_id: row.org_id,
        integration_key: row.integration_key,
        status: row.status,
        credentials: rowToCredentials(row)
      };
    }
  };
}

/* ─── 2. IntegrationListBackend (for enumerateTenantsWithOAuth) ──── */

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{
 *   findManyByTypeAndStatus: (types: string[], status: string) => Promise<Array<{id: string, org_id: string, type: string}>>
 * }}
 */
function createIntegrationListBackend(db) {
  return {
    async findManyByTypeAndStatus(types, status) {
      if (!Array.isArray(types) || types.length === 0) return [];
      if (!status) return [];
      const placeholders = types.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT id, org_id, integration_key AS type FROM smb_crm_integrations
             WHERE integration_key IN (${placeholders})
               AND status = ?`
        )
        .all(...types, status);
      return rows;
    }
  };
}

/* ─── 3. SQLite-backed KV (for storeOAuthState) ───────────────────── */

/**
 * Ensure the oauth_state_kv table exists. Idempotent.
 * @param {import('node:sqlite').DatabaseSync} db
 */
function ensureOAuthStateTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_state_kv (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      expires_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_state_kv_expires
      ON oauth_state_kv(expires_at);
  `);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{
 *   set: (key: string, value: string, ttlMs: number) => Promise<void>,
 *   getAndDelete: (key: string) => Promise<string | null>,
 *   deleteByPrefix: (prefix: string) => Promise<void>
 * }}
 */
function createSqliteKvBackend(db) {
  ensureOAuthStateTable(db);
  return {
    async set(key, value, ttlMs) {
      const expiresAt = Date.now() + Math.max(0, ttlMs);
      db.prepare(
        'INSERT OR REPLACE INTO oauth_state_kv (key, value, expires_at) VALUES (?, ?, ?)'
      ).run(key, String(value), expiresAt);
    },

    async getAndDelete(key) {
      // Atomic: a single transaction reads, expires-check, deletes.
      const txn = db.prepare('BEGIN IMMEDIATE');
      try {
        txn.run();
        const row = db
          .prepare('SELECT value, expires_at FROM oauth_state_kv WHERE key = ?')
          .get(key);
        if (!row) {
          db.prepare('COMMIT').run();
          return null;
        }
        // Always delete (one-shot semantics)
        db.prepare('DELETE FROM oauth_state_kv WHERE key = ?').run(key);
        if (row.expires_at <= Date.now()) {
          db.prepare('COMMIT').run();
          return null;
        }
        db.prepare('COMMIT').run();
        return row.value;
      } catch (err) {
        try { db.prepare('ROLLBACK').run(); } catch { /* best effort */ }
        throw err;
      }
    },

    async deleteByPrefix(prefix) {
      // Use LIKE with the prefix; escape any LIKE special chars in
      // the prefix defensively (none of ours contain %, _, or \,
      // but be safe).
      const safe = prefix.replace(/[\\%_]/g, (c) => '\\' + c);
      db.prepare('DELETE FROM oauth_state_kv WHERE key LIKE ? ESCAPE \'\\\'').run(`${safe}%`);
    }
  };
}

/* ─── 4. Vault factory (wires the env-derived KEK) ────────────────── */

/**
 * Build a vault from process.env. Falls back to the dev KEK in
 * test/development environments. Production requires
 * INTEGRATION_KEK to be set.
 *
 * @param {Object} [opts]
 * @param {Object} [opts.env]
 * @param {string} [opts.kekHex]
 * @param {string} [opts.kekBase64]
 * @returns {ReturnType<typeof import('./vault').createVault>}
 */
function createVaultFromEnv(opts = {}) {
  const { createVault } = require('../vault');
  return createVault({
    env: opts.env || process.env,
    kekHex: opts.kekHex,
    kekBase64: opts.kekBase64
  });
}

/* ─── 5. Connector map (PULL OAuth providers → integration_key) ──── */

/**
 * Translate an OAuthProviderId to the smb_crm_integrations
 * `integration_key` used in the database. Today they're the same
 * string; this map exists so that future divergence (e.g.
 * `surfe` → `surfe-oauth`) is a one-line change.
 */
const OAUTH_PROVIDER_TO_INTEGRATION_KEY = Object.freeze({
  apollo: 'apollo',
  surfe: 'surfe',
  closely: 'closely',
  webflow: 'webflow',
  make: 'make'
});

/**
 * Reverse lookup: from `smb_crm_integrations.integration_key` back
 * to an OAuthProviderId. Returns null for keys that are not
 * OAuth providers (e.g. the outbound sequence providers like
 * 'instantly' or 'dexatel' which use API keys, not OAuth).
 */
const INTEGRATION_KEY_TO_OAUTH_PROVIDER = Object.freeze(
  Object.fromEntries(
    Object.entries(OAUTH_PROVIDER_TO_INTEGRATION_KEY).map(([k, v]) => [v, k])
  )
);

function isOAuthIntegrationKey(key) {
  return Object.prototype.hasOwnProperty.call(INTEGRATION_KEY_TO_OAUTH_PROVIDER, key);
}

module.exports = {
  createIntegrationBackend,
  createIntegrationListBackend,
  createSqliteKvBackend,
  ensureOAuthStateTable,
  createVaultFromEnv,
  OAUTH_PROVIDER_TO_INTEGRATION_KEY,
  INTEGRATION_KEY_TO_OAUTH_PROVIDER,
  isOAuthIntegrationKey
};
