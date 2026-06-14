/**
 * oauth/refresh — Token refresh worker.
 *
 * Finds OAuth tokens that expire soon and refreshes them against
 * the provider's token endpoint.
 *
 * BullMQ-friendly: every function is a pure async step that
 * accepts the I/O dependencies as arguments. The caller wires
 * the actual queue, retry policy, and dead-letter handling.
 *
 * The HTTP call is direct (not via `providerHttp`) because:
 *   - OAuth endpoints are PUBLIC (no per-tenant gate, no
 *     OUTBOUND flag).
 *   - AAD binding per-tenant is enforced on the token store, not
 *     the HTTP call, so we don't need the `providerHttp` client
 *     here.
 *
 * ANT adaptation: `planTokenRefreshes`, `refreshAccessToken`,
 * `refreshTenantTokens`, and `forceRefreshTenantTokens` all
 * accept an injected `tokenStore` (anything with
 * `getOAuthTokens` / `setOAuthTokens`). This makes the
 * orchestration testable in isolation without a DB.
 *
 * Pure: every function is `async` but deterministic given the
 * injected dependencies + a fixed `now`.
 */
'use strict';

const { getOAuthConfig } = require('./registry');
const { isTokenExpiringSoon } = require('./token-store');

const DEFAULT_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const OAUTH_REFRESH_TIMEOUT_MS = 10_000;

/**
 * @typedef {Object} RefreshPair
 * @property {string} tenantId
 * @property {string} provider
 */

/**
 * @typedef {Object} RefreshPlan
 * @property {RefreshPair[]} toRefresh
 * @property {Array<RefreshPair & { reason: string }>} skipped
 */

/**
 * @typedef {Object} OAuthTokenResponse
 * @property {string} access_token
 * @property {string} [refresh_token]
 * @property {number} [expires_in]  seconds until access_token expires
 * @property {string} [token_type]
 * @property {string} [scope]       space-separated
 */

/**
 * @typedef {(url: string, init: RequestInit) => Promise<Response>} FetchImpl
 */

/**
 * Build a refresh plan for a tenant. Pure — does not perform any
 * HTTP.
 *
 * @param {string} tenantId
 * @param {string[]} providers
 * @param {Object} options
 * @param {{ getOAuthTokens: (tenantId: string, provider: string) => Promise<any> }} options.tokenStore
 * @param {Date} [options.now]
 * @param {number} [options.windowMs]
 * @returns {Promise<RefreshPlan>}
 */
async function planTokenRefreshes(tenantId, providers, options) {
  if (!options || !options.tokenStore) {
    throw new Error('planTokenRefreshes requires { tokenStore }');
  }
  const now = options.now || new Date();
  const windowMs = options.windowMs == null ? DEFAULT_REFRESH_WINDOW_MS : options.windowMs;
  const toRefresh = [];
  const skipped = [];

  for (const provider of providers) {
    let tokens = null;
    try {
      tokens = await options.tokenStore.getOAuthTokens(tenantId, provider);
    } catch (err) {
      skipped.push({ tenantId, provider, reason: `read_failed: ${(err && err.message) || err}` });
      continue;
    }
    if (!tokens) {
      skipped.push({ tenantId, provider, reason: 'no_tokens' });
      continue;
    }
    if (!isTokenExpiringSoon(tokens, windowMs)) continue;
    if (!tokens.refreshToken) {
      skipped.push({ tenantId, provider, reason: 'expiring_but_no_refresh_token' });
      continue;
    }
    toRefresh.push({ tenantId, provider });
    void now; // reserved for future use
  }
  return { toRefresh, skipped };
}

/**
 * Refresh a single token. Pure HTTP — does NOT update the store.
 * The caller decides whether to write (e.g. only if the response
 * includes new tokens).
 *
 * @param {string} provider
 * @param {string} refreshToken
 * @param {Object} [options]
 * @param {FetchImpl} [options.fetchImpl]
 * @param {Object} [options.env]
 * @param {number} [options.timeoutMs]
 * @param {Function} [options.isTokenExpiringSoonImpl]  for tests
 * @returns {Promise<{ok: true, provider: string, tokens: any}|{ok: false, provider: string, reason: string}>}
 */
async function refreshAccessToken(provider, refreshToken, options = {}) {
  const fetchImpl = options.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl) {
    return { ok: false, provider, reason: 'no_fetch_implementation' };
  }
  const env = options.env || (typeof process !== 'undefined' ? process.env : {});
  const timeoutMs = options.timeoutMs == null ? OAUTH_REFRESH_TIMEOUT_MS : options.timeoutMs;

  const cfg = getOAuthConfig(provider);
  const url = cfg.refreshUrl || cfg.tokenUrl;
  const clientId = env[cfg.clientIdEnv];
  const clientSecret = cfg.clientSecretEnv ? env[cfg.clientSecretEnv] : undefined;
  if (!clientId) {
    return { ok: false, provider, reason: `missing_client_id_env: ${cfg.clientIdEnv}` };
  }
  if (!clientSecret && !cfg.supportsPkce) {
    return { ok: false, provider, reason: 'confidential_client_missing_client_secret' };
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId
  });
  if (clientSecret) body.set('client_secret', clientSecret);

  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json'
      },
      body: body.toString()
    }, timeoutMs);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { ok: false, provider, reason: 'timeout' };
    }
    return { ok: false, provider, reason: `network_error: ${(err && err.message) || err}` };
  }

  if (!res.ok) {
    return { ok: false, provider, reason: `http_${res.status}` };
  }

  let json;
  try {
    json = await res.json();
  } catch (err) {
    return { ok: false, provider, reason: `parse_error: ${(err && err.message) || err}` };
  }

  if (typeof json.access_token !== 'string' || json.access_token.length === 0) {
    return { ok: false, provider, reason: 'missing_access_token_in_response' };
  }

  const expiresAt = typeof json.expires_in === 'number'
    ? new Date(Date.now() + json.expires_in * 1000).toISOString()
    : null;

  return {
    ok: true,
    provider,
    tokens: {
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : refreshToken,
      expiresAt,
      scopes: typeof json.scope === 'string' ? json.scope.split(' ') : [],
      connectedAt: new Date().toISOString()
    }
  };
}

/**
 * End-to-end helper: scan + refresh + write. Used by the BullMQ
 * job. Returns the outcomes; the caller logs / metrics.
 *
 * @param {string} tenantId
 * @param {string[]} providers
 * @param {Object} options
 * @param {{ getOAuthTokens: Function, setOAuthTokens: Function }} options.tokenStore
 * @param {FetchImpl} [options.fetchImpl]
 * @param {Object} [options.env]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<Array<{ok: boolean, provider: string, [key: string]: any}>>}
 */
async function refreshTenantTokens(tenantId, providers, options = {}) {
  const plan = await planTokenRefreshes(tenantId, providers, { tokenStore: options.tokenStore });
  const outcomes = [];
  for (const { provider } of plan.toRefresh) {
    const tokens = await options.tokenStore.getOAuthTokens(tenantId, provider);
    if (!tokens || !tokens.refreshToken) continue;
    const outcome = await refreshAccessToken(provider, tokens.refreshToken, options);
    if (outcome.ok) {
      await options.tokenStore.setOAuthTokens(tenantId, provider, {
        accessToken: outcome.tokens.accessToken,
        refreshToken: outcome.tokens.refreshToken,
        expiresAt: outcome.tokens.expiresAt,
        scopes: outcome.tokens.scopes
      });
    }
    outcomes.push(outcome);
  }
  return outcomes;
}

/**
 * Force-refresh every provided (tenant, provider) pair regardless
 * of expiry. Used by the "Reconnect now" admin action and by the
 * callback route to immediately upgrade tokens after the initial
 * code exchange.
 *
 * @param {string} tenantId
 * @param {string[]} providers
 * @param {Object} options
 * @param {{ getOAuthTokens: Function, setOAuthTokens: Function }} options.tokenStore
 * @param {FetchImpl} [options.fetchImpl]
 * @param {Object} [options.env]
 * @returns {Promise<Array<{ok: boolean, provider: string, [key: string]: any}>>}
 */
async function forceRefreshTenantTokens(tenantId, providers, options = {}) {
  const outcomes = [];
  for (const provider of providers) {
    const tokens = await options.tokenStore.getOAuthTokens(tenantId, provider);
    if (!tokens) {
      outcomes.push({ ok: false, provider, reason: 'no_tokens' });
      continue;
    }
    if (!tokens.refreshToken) {
      outcomes.push({ ok: false, provider, reason: 'no_refresh_token' });
      continue;
    }
    const outcome = await refreshAccessToken(provider, tokens.refreshToken, options);
    if (outcome.ok) {
      await options.tokenStore.setOAuthTokens(tenantId, provider, {
        accessToken: outcome.tokens.accessToken,
        refreshToken: outcome.tokens.refreshToken,
        expiresAt: outcome.tokens.expiresAt,
        scopes: outcome.tokens.scopes
      });
    }
    outcomes.push(outcome);
  }
  return outcomes;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  // Core
  planTokenRefreshes,
  refreshAccessToken,
  refreshTenantTokens,
  forceRefreshTenantTokens,
  // Constants
  DEFAULT_REFRESH_WINDOW_MS,
  OAUTH_REFRESH_TIMEOUT_MS
};
