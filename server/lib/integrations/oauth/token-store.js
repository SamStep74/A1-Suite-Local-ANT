/**
 * oauth/token-store — Vault-backed OAuth token store.
 *
 * Tokens live in `Integration.credentials` (a JSON column in the
 * existing `Integration` SQLite/Prisma model). The vault encrypts
 * the sensitive fields (`accessToken`, `refreshToken`,
 * `clientSecret`) before write and decrypts after read. The
 * public fields (`provider`, `tenantId`, `expiresAt`, `scopes`,
 * `connectedAt`) stay plaintext so the OAuth refresh worker can
 * find expiring tokens without burning a decrypt.
 *
 * Storage shape (`Integration.credentials`):
 *   {
 *     oauth: {
 *       [provider]: {
 *         accessToken:  "<vault-packed-or-plaintext>",
 *         refreshToken: "<vault-packed-or-plaintext>",
 *         expiresAt:    "2026-06-07T12:00:00.000Z",
 *         scopes:       ["profile", "enrichment:read"],
 *         connectedAt:  "2026-06-06T00:00:00.000Z",
 *       }
 *     }
 *   }
 *
 * Phase 1: we accept either plaintext OR vault-packed secrets on
 * read (the helpers check `isVaultPacked`). Phase 2: every write
 * path will vault-encrypt on save; we'll fail closed if a tenant
 * integration row has a plaintext secret and the vault is unavailable.
 *
 * ANT adaptation: the storage backend is injected as a 3-method
 * adapter (findByTenantProvider, updateCredentials, exists). The
 * default ANT wiring uses `node:sqlite` (server/db.js) but tests
 * can pass a plain in-memory map. The vault + AAD binding
 * (`tenant:<id>|provider:<id>`) is preserved verbatim from MAX.
 *
 * Pure logic: the AAD-bound encrypt/decrypt round-trip + the
 * "no expiry ⇒ never needs proactive refresh" rules. The store
 * is the I/O boundary.
 */
'use strict';

const { encryptConfigSecrets, decryptConfigSecrets, isVaultPacked } = require('../../vault');

const ENCRYPTED_FIELDS = /** @type {const} */ (['accessToken', 'refreshToken', 'clientSecret']);
const ENVELOPE_KEY = 'oauth';

class OAuthTokenStoreError extends Error {
  constructor(message) {
    super(`[OAUTH_TOKEN_STORE] ${message}`);
    this.name = 'OAuthTokenStoreError';
  }
}

/**
 * @typedef {Object} OAuthTokens
 * @property {string} accessToken
 * @property {string|null} refreshToken
 * @property {string|null} expiresAt   ISO-8601
 * @property {string[]} scopes
 * @property {string} connectedAt      ISO-8601
 * @property {string} [codeVerifier]   PKCE verifier (cleared after code exchange)
 */

/**
 * @typedef {Object} IntegrationBackend
 * @property {(tenantId: string, provider: string) => Promise<{ id: string, credentials: Record<string, unknown>|null }|null>} findByTenantProvider
 * @property {(id: string, credentials: Record<string, unknown>) => Promise<void>} updateCredentials
 */

/**
 * @param {Object} options
 * @param {IntegrationBackend} options.backend
 * @param {Object} [options.vault]  pre-built vault (defaults to createVault with dev key)
 * @param {Object} [options.vaultOpts]  opts forwarded to createVault
 * @param {string} [options.now]  ISO-8601 factory (defaults to () => new Date().toISOString())
 */
function createOAuthTokenStore(options) {
  if (!options || !options.backend) {
    throw new Error('createOAuthTokenStore requires { backend }');
  }
  const backend = options.backend;
  const vault = options.vault || null;
  const now = options.now || (() => new Date().toISOString());

  function aadFor(tenantId, provider) {
    return `tenant:${tenantId}|provider:${provider}`;
  }

  /**
   * Save tokens for a (tenant, provider) pair. Encrypts the secret
   * fields before persisting, shallow-merges with any existing
   * `Integration.credentials` JSON so unrelated keys (other
   * providers, future fields) survive.
   *
   * @param {string} tenantId
   * @param {string} provider
   * @param {Omit<OAuthTokens,'connectedAt'> & { connectedAt?: string }} tokens
   * @returns {Promise<void>}
   */
  async function setOAuthTokens(tenantId, provider, tokens) {
    if (!vault) {
      throw new OAuthTokenStoreError(
        'setOAuthTokens requires a vault (pass { vault } to createOAuthTokenStore). Refusing to write plaintext secrets.'
      );
    }
    const integ = await backend.findByTenantProvider(tenantId, provider);
    if (!integ) {
      throw new OAuthTokenStoreError(`Integration not found for tenant=${tenantId} provider=${provider}`);
    }

    const connectedAt = tokens.connectedAt || now();
    const plain = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      connectedAt
    };
    if (tokens.codeVerifier) plain.codeVerifier = tokens.codeVerifier;

    // Encrypt only the secret fields, leave scopes/expiresAt/connectedAt
    // plain so the refresh worker can scan for expiring tokens without
    // decrypting.
    const sealed = vault.encryptConfigSecrets(plain, ENCRYPTED_FIELDS, { aad: aadFor(tenantId, provider) });

    const existing = recordValue(integ.credentials) || {};
    const existingOAuth = recordValue(existing[ENVELOPE_KEY]) || {};
    const nextOAuth = { ...existingOAuth, [provider]: sealed };
    const nextCredentials = { ...existing, [ENVELOPE_KEY]: nextOAuth };

    await backend.updateCredentials(integ.id, nextCredentials);
  }

  /**
   * Read tokens for a (tenant, provider) pair. Decrypts the
   * secret fields. Returns null if no tokens are stored.
   *
   * @param {string} tenantId
   * @param {string} provider
   * @returns {Promise<OAuthTokens|null>}
   */
  async function getOAuthTokens(tenantId, provider) {
    if (!vault) {
      throw new OAuthTokenStoreError(
        'getOAuthTokens requires a vault (pass { vault } to createOAuthTokenStore).'
      );
    }
    const integ = await backend.findByTenantProvider(tenantId, provider);
    const credentials = recordValue(integ ? integ.credentials : null);
    if (!credentials) return null;
    const oauth = recordValue(credentials[ENVELOPE_KEY]);
    if (!oauth) return null;
    const stored = recordValue(oauth[provider]);
    if (!stored) return null;

    // Decrypt — the helpers are no-ops for plaintext values, so
    // this is safe to call even if the row was written before the
    // vault existed.
    const unsealed = vault.decryptConfigSecrets(stored, ENCRYPTED_FIELDS, { aad: aadFor(tenantId, provider) });

    if (typeof unsealed.accessToken !== 'string' || unsealed.accessToken.length === 0) return null;

    return {
      accessToken: unsealed.accessToken,
      refreshToken: typeof unsealed.refreshToken === 'string' ? unsealed.refreshToken : null,
      expiresAt: typeof unsealed.expiresAt === 'string' ? unsealed.expiresAt : null,
      scopes: Array.isArray(unsealed.scopes) ? unsealed.scopes : [],
      connectedAt: typeof unsealed.connectedAt === 'string' ? unsealed.connectedAt : now(),
      ...(typeof unsealed.codeVerifier === 'string' ? { codeVerifier: unsealed.codeVerifier } : {})
    };
  }

  /**
   * Drop tokens for a (tenant, provider) pair. Idempotent.
   * @param {string} tenantId
   * @param {string} provider
   * @returns {Promise<void>}
   */
  async function clearOAuthTokens(tenantId, provider) {
    const integ = await backend.findByTenantProvider(tenantId, provider);
    if (!integ) return;
    const existing = recordValue(integ.credentials);
    if (!existing) return;
    const existingOAuth = recordValue(existing[ENVELOPE_KEY]);
    if (!existingOAuth || !Object.prototype.hasOwnProperty.call(existingOAuth, provider)) return;
    const nextOAuth = { ...existingOAuth };
    delete nextOAuth[provider];
    await backend.updateCredentials(integ.id, { ...existing, [ENVELOPE_KEY]: nextOAuth });
  }

  return {
    setOAuthTokens,
    getOAuthTokens,
    clearOAuthTokens,
    // Re-export the pure helpers + the underlying primitives
    ENCRYPTED_FIELDS,
    ENVELOPE_KEY,
    OAuthTokenStoreError
  };
}

/* ── pure helpers (independent of the store) ────────────────────── */

/**
 * True if the access token expires within `thresholdMs`
 * (default 5 min).
 * @param {OAuthTokens} tokens
 * @param {number} [thresholdMs]
 * @returns {boolean}
 */
function isTokenExpiringSoon(tokens, thresholdMs = 5 * 60 * 1000) {
  if (!tokens.expiresAt) return false; // no expiry ⇒ never needs proactive refresh
  const expiresAt = Date.parse(tokens.expiresAt);
  if (Number.isNaN(expiresAt)) return false;
  return expiresAt - Date.now() < thresholdMs;
}

/**
 * True if the stored token is unrecoverable (no refresh token AND
 * expired or about to expire).
 * @param {OAuthTokens} tokens
 * @returns {boolean}
 */
function isTokenDead(tokens) {
  if (!isTokenExpiringSoon(tokens)) return false;
  return !tokens.refreshToken;
}

function recordValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

module.exports = {
  createOAuthTokenStore,
  // Pure helpers
  isTokenExpiringSoon,
  isTokenDead,
  // Constants + errors
  ENCRYPTED_FIELDS,
  ENVELOPE_KEY,
  OAuthTokenStoreError,
  // Re-exports for callers that want to detect plaintext rows
  isVaultPacked
};
