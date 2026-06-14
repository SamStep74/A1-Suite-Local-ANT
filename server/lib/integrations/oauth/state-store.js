/**
 * oauth/state-store — One-shot state store for the OAuth 2.0
 * callback flow.
 *
 * Why an adapter instead of a Redis client? MAX couples this to
 * ioredis directly. ANT is `node:sqlite`-only by default, so we
 * accept ANY KV backend (in-memory, sqlite, redis) that implements
 * the minimal three-method contract:
 *
 *   - `set(key, value, ttlMs)`         → Promise<void>
 *   - `getAndDelete(key)`              → Promise<string | null>  (atomic)
 *   - `deleteByPrefix(prefix)`         → Promise<void>          (for tests)
 *
 * The MAX source uses Redis GETDEL for atomicity. Our adapter
 * preserves that contract: getAndDelete MUST be atomic (a single
 * backend call that reads and removes the key in one shot), so
 * the OAuth flow cannot replay a state nonce after the callback
 * already consumed it.
 *
 * TTL: 5 minutes (matches MAX).
 *
 * Storage shape (per state key):
 *   key   = `${KEY_PREFIX}${state}`  (default "oauth:state:")
 *   value = JSON-serialized { tenantId, provider, redirectUri,
 *                             codeVerifier?, createdAt }
 *   TTL   = STATE_TTL_MS (5 min)
 *
 * Pure: no I/O on its own — the injected backend does the work.
 */
'use strict';

const STATE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_KEY_PREFIX = 'oauth:state:';

/**
 * @typedef {Object} OAuthStatePayload
 * @property {string} tenantId
 * @property {string} provider
 * @property {string} redirectUri
 * @property {string} [codeVerifier]
 * @property {number} createdAt
 */

/**
 * @typedef {Object} KVBackend
 * @property {(key: string, value: string, ttlMs: number) => Promise<void>} set
 * @property {(key: string) => Promise<string | null>} getAndDelete
 * @property {(prefix: string) => Promise<void>} deleteByPrefix
 */

/**
 * @param {string} state
 * @returns {string}
 */
function keyFor(state, prefix) {
  return (prefix || DEFAULT_KEY_PREFIX) + state;
}

/**
 * @param {KVBackend} backend
 * @param {string} state
 * @param {OAuthStatePayload} payload
 * @param {Object} [opts]
 * @param {string} [opts.prefix]
 * @returns {Promise<void>}
 */
async function storeOAuthState(backend, state, payload, opts = {}) {
  if (!backend || typeof backend.set !== 'function') {
    throw new Error('storeOAuthState: backend.set is required');
  }
  if (typeof state !== 'string' || state.length === 0) {
    throw new Error('storeOAuthState: state must be a non-empty string');
  }
  if (!payload || typeof payload.tenantId !== 'string' || typeof payload.provider !== 'string') {
    throw new Error('storeOAuthState: payload.tenantId and payload.provider are required');
  }
  const enriched = { ...payload, createdAt: payload.createdAt || Date.now() };
  await backend.set(keyFor(state, opts.prefix), JSON.stringify(enriched), STATE_TTL_MS);
}

/**
 * Atomically read and delete the state. Returns null if the state
 * is unknown, has already been consumed, or the stored value is
 * not valid JSON.
 *
 * @param {KVBackend} backend
 * @param {string} state
 * @param {Object} [opts]
 * @param {string} [opts.prefix]
 * @returns {Promise<OAuthStatePayload | null>}
 */
async function consumeOAuthState(backend, state, opts = {}) {
  if (!backend || typeof backend.getAndDelete !== 'function') {
    throw new Error('consumeOAuthState: backend.getAndDelete is required');
  }
  const raw = await backend.getAndDelete(keyFor(state, opts.prefix));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Best-effort cleanup. The TTL handles real expiry; this is for
 * tests that want to assert state-store behavior. Uses
 * `backend.deleteByPrefix(prefix)` which MUST be a single
 * backend-level operation (SQL `DELETE WHERE key LIKE ?`, Redis
 * `SCAN + DEL`, etc.) — never iterate from the application side.
 *
 * @param {KVBackend} backend
 * @param {Object} [opts]
 * @param {string} [opts.prefix]
 * @returns {Promise<void>}
 */
async function resetOAuthStateStore(backend, opts = {}) {
  if (!backend || typeof backend.deleteByPrefix !== 'function') {
    throw new Error('resetOAuthStateStore: backend.deleteByPrefix is required');
  }
  await backend.deleteByPrefix(opts.prefix || DEFAULT_KEY_PREFIX);
}

/**
 * In-memory KV backend for tests + small deployments. Implements
 * the 3-method contract atomically (a single Map mutation).
 *
 * @returns {KVBackend & { __peek?: (key: string) => string|undefined, size: () => number }}
 */
function createInMemoryStateStore() {
  const map = new Map();
  return {
    async set(key, value, ttlMs) {
      map.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    async getAndDelete(key) {
      const entry = map.get(key);
      if (!entry) return null;
      map.delete(key);
      if (entry.expiresAt <= Date.now()) return null;
      return entry.value;
    },
    async deleteByPrefix(prefix) {
      for (const k of Array.from(map.keys())) {
        if (k.startsWith(prefix)) map.delete(k);
      }
    },
    // Test escape hatches
    __peek(key) {
      const e = map.get(key);
      return e ? e.value : undefined;
    },
    size() {
      return map.size;
    }
  };
}

module.exports = {
  // Constants
  STATE_TTL_MS,
  DEFAULT_KEY_PREFIX,
  // Core ops
  storeOAuthState,
  consumeOAuthState,
  resetOAuthStateStore,
  // Pure helper
  keyFor,
  // Default backend (tests + small deployments)
  createInMemoryStateStore
};
