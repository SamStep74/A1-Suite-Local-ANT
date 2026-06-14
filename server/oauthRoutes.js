/**
 * oauthRoutes — Fastify routes for the OAuth PULL flow.
 *
 * Endpoints (all under /api/oauth):
 *   GET  /api/oauth/:provider/connect
 *     Build the auth URL for the given provider, store the
 *     state+verifier in the KV backend, return { url, state }
 *     so the SPA can redirect the browser.
 *
 *   GET  /api/oauth/:provider/callback?code=...&state=...
 *     Handle the provider redirect back. Consume the state
 *     (one-shot), exchange the code for tokens, vault-seal the
 *     tokens, update smb_crm_integrations.config_json. Redirect
 *     the browser to the SPA's success/error page.
 *
 *   GET  /api/oauth/:provider/status
 *     Returns { connected, expiresAt, scopes, integrationId }
 *     for the authed user's org. NO secret material is leaked.
 *
 *   POST /api/oauth/:provider/disconnect
 *     Idempotent. Clears the stored tokens. Does NOT delete the
 *     integration row.
 *
 *   POST /api/oauth/:provider/refresh
 *     Force-refresh. Useful from the admin "Reconnect now" button
 *     and as a manual escape hatch when the cron hasn't fired
 *     yet.
 *
 * The state-store is injected (createSqliteKvBackend by default
 * in production; in-memory in tests). The vault is injected too
 * so tests can use a deterministic KEK.
 *
 * Pure orchestration: each route delegates to a pure engine from
 * server/lib/integrations/ and writes through the SQLite backend
 * from server/lib/integrations/sqlite-backend.js.
 */
'use strict';

const {
  getOAuthConfig,
  listOAuthProviders,
  isOAuthProvider,
  buildAuthUrl,
  OAuthRegistryError
} = require('./lib/integrations/oauth/registry');
const {
  storeOAuthState,
  consumeOAuthState,
  STATE_TTL_MS
} = require('./lib/integrations/oauth/state-store');
const {
  createOAuthTokenStore,
  OAuthTokenStoreError
} = require('./lib/integrations/oauth/token-store');
const {
  refreshAccessToken,
  forceRefreshTenantTokens
} = require('./lib/integrations/oauth/refresh');
const {
  generatePkcePair,
  buildTokenExchangeRequest,
  parseTokenResponse
} = require('./lib/integrations/oauth/pkce');
const {
  createIntegrationBackend,
  createSqliteKvBackend,
  OAUTH_PROVIDER_TO_INTEGRATION_KEY,
  isOAuthIntegrationKey
} = require('./lib/integrations/sqlite-backend');

const OAUTH_STATE_PREFIX = 'oauth:state:';
const SPACER = /-/g; // none

/**
 * Convert a tenant/orgId+provider pair to a state-store key.
 * @param {string} orgId
 * @param {string} provider
 * @returns {string}
 */
function stateKey(orgId, provider) {
  return `${orgId}:${provider}`;
}

/**
 * @param {Object} options
 * @param {import('node:sqlite').DatabaseSync} options.db
 * @param {Object} [options.vault]  pre-built vault
 * @param {{ set: Function, getAndDelete: Function, deleteByPrefix: Function }} [options.kv]  injected KV (defaults to sqlite)
 * @param {Function} [options.fetchImpl]  injected fetch (defaults to global)
 * @param {Function} [options.auth]  injected auth helper
 * @param {Function} [options.requirePermission]  injected RBAC check
 * @param {Object} [options.env]  process.env override
 * @param {string} [options.appBaseUrl]  used to build the redirectUri
 */
function registerOAuthRoutes(options) {
  if (!options || !options.db) {
    throw new Error('registerOAuthRoutes requires { db }');
  }
  const db = options.db;
  const vault = options.vault || null;
  const fetchImpl = options.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const auth = options.auth;
  const requirePermission = options.requirePermission;
  const env = options.env || (typeof process !== 'undefined' ? process.env : {});
  const appBaseUrl = options.appBaseUrl || env.APP_BASE_URL || 'http://localhost:3000';

  const kv = options.kv || createSqliteKvBackend(db);
  const backend = createIntegrationBackend(db);
  const tokenStore = vault ? createOAuthTokenStore({ backend, vault }) : null;

  /**
   * @param {import('fastify').FastifyInstance} app
   */
  return function attach(app) {
    if (!app) throw new Error('registerOAuthRoutes: attach(app) requires an app instance');

    // ─── GET /api/oauth/providers ─────────────────────────────────────
    app.get('/api/oauth/providers', async (request) => {
      const user = await (auth ? auth(request) : null);
      if (!user) {
        const err = new Error('Unauthorized');
        err.statusCode = 401;
        throw err;
      }
      return {
        providers: listOAuthProviders().map((id) => {
          const cfg = getOAuthConfig(id);
          return {
            id,
            displayName: cfg.displayName,
            supportsPkce: cfg.supportsPkce,
            defaultScopes: cfg.defaultScopes
          };
        })
      };
    });

    // ─── GET /api/oauth/:provider/connect ────────────────────────────
    // Starts the OAuth dance. Returns the auth URL + the state nonce
    // so the SPA can redirect the browser. The verifier (PKCE) is
    // stashed in the state payload so the callback can complete the
    // exchange without trusting the SPA.
    app.get('/api/oauth/:provider/connect', async (request) => {
      const user = await (auth ? auth(request) : null);
      if (!user) {
        const err = new Error('Unauthorized');
        err.statusCode = 401;
        throw err;
      }
      if (requirePermission) {
        requirePermission(db, user, user.org_id, 'integrations.write');
      }
      const provider = String(request.params.provider || '');
      if (!isOAuthProvider(provider)) {
        const err = new OAuthRegistryError(`Unknown OAuth provider: ${provider}`);
        err.statusCode = 404;
        throw err;
      }
      const cfg = getOAuthConfig(provider);
      // PKCE for public-client providers
      let codeVerifier;
      let codeChallenge;
      if (cfg.supportsPkce) {
        const pair = generatePkcePair();
        codeVerifier = pair.codeVerifier;
        codeChallenge = pair.codeChallenge;
      }
      // Per-tenant+provider state nonce. Reuse as the OAuth `state`
      // query param (so the browser round-trips it back). NOT a
      // security boundary on its own — the verifier is the real
      // proof for PKCE flows; for confidential-client flows the
      // state must at least be unique + unforgeable.
      const state = `${user.org_id}:${provider}:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`;
      const redirectUri = `${appBaseUrl}/api/oauth/${provider}/callback`;
      const url = buildAuthUrl(
        {
          provider,
          redirectUri,
          state,
          ...(codeChallenge ? { codeChallenge } : {})
        },
        env
      );
      await storeOAuthState(kv, state, {
        tenantId: user.org_id,
        userId: user.id,
        provider,
        redirectUri,
        ...(codeVerifier ? { codeVerifier } : {}),
        createdAt: Date.now()
      });
      return { url, state, expiresInMs: STATE_TTL_MS };
    });

    // ─── GET /api/oauth/:provider/callback ───────────────────────────
    // The provider redirects the user's browser here with ?code=...
    // &state=... We consume the state (one-shot), exchange the
    // code for tokens, vault-seal them, update the integration
    // row, and redirect the browser to the SPA.
    app.get('/api/oauth/:provider/callback', async (request, reply) => {
      const provider = String(request.params.provider || '');
      const code = String((request.query || {}).code || '');
      const state = String((request.query || {}).state || '');
      const errorParam = String((request.query || {}).error || '');
      // Compute the SPA's post-callback URL up-front so every
      // exit path (success, error, expired) lands in the same
      // place.
      const spaBase = appBaseUrl.replace(/\/+$/, '');
      const spaRedirect = (status, detail) => {
        const params = new URLSearchParams({ status });
        if (detail) params.set('detail', detail);
        return `${spaBase}/app/smb-crm/integrations?${params.toString()}`;
      };

      if (errorParam) {
        reply.redirect(spaRedirect('error', errorParam));
        return reply;
      }
      if (!code || !state) {
        reply.redirect(spaRedirect('error', 'missing_code_or_state'));
        return reply;
      }
      if (!isOAuthProvider(provider)) {
        reply.redirect(spaRedirect('error', `unknown_provider:${provider}`));
        return reply;
      }
      // Consume the state (one-shot). The state must include the
      // tenantId + provider we expect.
      const payload = await consumeOAuthState(kv, state);
      if (!payload) {
        reply.redirect(spaRedirect('error', 'state_expired_or_consumed'));
        return reply;
      }
      if (payload.provider !== provider) {
        reply.redirect(spaRedirect('error', 'state_provider_mismatch'));
        return reply;
      }
      // Exchange the code for tokens.
      const cfg = getOAuthConfig(provider);
      const clientId = env[cfg.clientIdEnv];
      const clientSecret = cfg.clientSecretEnv ? env[cfg.clientSecretEnv] : undefined;
      if (!clientId) {
        reply.redirect(spaRedirect('error', `missing_client_id_env:${cfg.clientIdEnv}`));
        return reply;
      }
      if (!clientSecret && !cfg.supportsPkce) {
        reply.redirect(spaRedirect('error', 'confidential_client_missing_client_secret'));
        return reply;
      }
      const exchange = buildTokenExchangeRequest({
        tokenUrl: cfg.tokenUrl,
        code,
        redirectUri: payload.redirectUri,
        clientId,
        ...(clientSecret ? { clientSecret } : {}),
        ...(payload.codeVerifier ? { codeVerifier: payload.codeVerifier } : {})
      });
      let res;
      try {
        res = await fetchWithTimeout(fetchImpl, exchange.url, {
          method: 'POST',
          headers: exchange.headers,
          body: exchange.body
        }, 10_000);
      } catch (err) {
        const detail = err && err.name === 'AbortError' ? 'exchange_timeout' : `exchange_network_error:${(err && err.message) || err}`;
        reply.redirect(spaRedirect('error', detail));
        return reply;
      }
      if (!res.ok) {
        let detail = `http_${res.status}`;
        try {
          const body = await res.text();
          // Surface a small slice of the response for diagnosis
          detail += `:${body.slice(0, 80)}`;
        } catch { /* ignore */ }
        reply.redirect(spaRedirect('error', detail));
        return reply;
      }
      let json;
      try {
        json = await res.json();
      } catch (err) {
        reply.redirect(spaRedirect('error', 'exchange_parse_error'));
        return reply;
      }
      let parsed;
      try {
        parsed = parseTokenResponse(json);
      } catch (err) {
        reply.redirect(spaRedirect('error', `exchange_invalid:${(err && err.message) || err}`));
        return reply;
      }
      // Persist via the token store (vault-seal + write config_json).
      if (!tokenStore) {
        reply.redirect(spaRedirect('error', 'vault_not_configured'));
        return reply;
      }
      const integrationKey = OAUTH_PROVIDER_TO_INTEGRATION_KEY[provider];
      const integ = await backend.findByTenantProvider(payload.tenantId, integrationKey);
      if (!integ) {
        // Auto-create the integration row on first OAuth connect.
        // The tenant just authorized a provider they hadn't
        // registered yet; create a "connected" row so future
        // refreshes have a stable id.
        const id = `int-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO smb_crm_integrations
             (id, org_id, integration_key, display_name, status, environment, auth_type, config_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'connected', 'production', 'oauth', '{}', ?, ?)`
        ).run(id, payload.tenantId, integrationKey, cfg.displayName, now, now);
        // Re-fetch the new row
        await tokenStore.setOAuthTokens(payload.tenantId, provider, {
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          expiresAt: parsed.expiresAt,
          scopes: parsed.scopes
        });
      } else {
        await tokenStore.setOAuthTokens(payload.tenantId, provider, {
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          expiresAt: parsed.expiresAt,
          scopes: parsed.scopes
        });
        // Mark the row as connected (it may have been in
        // 'disconnected' or 'planned' state from the configure
        // step before OAuth completed).
        db.prepare(
          'UPDATE smb_crm_integrations SET status = ?, updated_at = ? WHERE id = ?'
        ).run('connected', new Date().toISOString(), integ.id);
      }
      reply.redirect(spaRedirect('connected', provider));
      return reply;
    });

    // ─── GET /api/oauth/:provider/status ─────────────────────────────
    app.get('/api/oauth/:provider/status', async (request) => {
      const user = await (auth ? auth(request) : null);
      if (!user) {
        const err = new Error('Unauthorized');
        err.statusCode = 401;
        throw err;
      }
      if (requirePermission) {
        requirePermission(db, user, user.org_id, 'integrations.read');
      }
      const provider = String(request.params.provider || '');
      if (!isOAuthProvider(provider)) {
        return { connected: false, provider, reason: 'unknown_provider' };
      }
      if (!tokenStore) {
        return { connected: false, provider, reason: 'vault_not_configured' };
      }
      const tokens = await tokenStore.getOAuthTokens(user.org_id, provider);
      if (!tokens) {
        return { connected: false, provider };
      }
      return {
        connected: true,
        provider,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        connectedAt: tokens.connectedAt,
        // No refresh token in the response — that's a secret.
        hasRefreshToken: !!tokens.refreshToken
      };
    });

    // ─── POST /api/oauth/:provider/disconnect ────────────────────────
    app.post('/api/oauth/:provider/disconnect', async (request) => {
      const user = await (auth ? auth(request) : null);
      if (!user) {
        const err = new Error('Unauthorized');
        err.statusCode = 401;
        throw err;
      }
      if (requirePermission) {
        requirePermission(db, user, user.org_id, 'integrations.write');
      }
      const provider = String(request.params.provider || '');
      if (!isOAuthProvider(provider)) {
        const err = new OAuthRegistryError(`Unknown OAuth provider: ${provider}`);
        err.statusCode = 404;
        throw err;
      }
      if (tokenStore) {
        await tokenStore.clearOAuthTokens(user.org_id, provider);
      }
      // Mark the integration row as disconnected (preserve the
      // row for audit; only secrets are cleared).
      const integrationKey = OAUTH_PROVIDER_TO_INTEGRATION_KEY[provider];
      const integ = await backend.findByTenantProvider(user.org_id, integrationKey);
      if (integ) {
        db.prepare(
          'UPDATE smb_crm_integrations SET status = ?, updated_at = ? WHERE id = ?'
        ).run('disconnected', new Date().toISOString(), integ.id);
      }
      return { disconnected: true, provider };
    });

    // ─── POST /api/oauth/:provider/refresh ──────────────────────────
    app.post('/api/oauth/:provider/refresh', async (request) => {
      const user = await (auth ? auth(request) : null);
      if (!user) {
        const err = new Error('Unauthorized');
        err.statusCode = 401;
        throw err;
      }
      if (requirePermission) {
        requirePermission(db, user, user.org_id, 'integrations.write');
      }
      const provider = String(request.params.provider || '');
      if (!isOAuthProvider(provider)) {
        const err = new OAuthRegistryError(`Unknown OAuth provider: ${provider}`);
        err.statusCode = 404;
        throw err;
      }
      if (!tokenStore) {
        const err = new OAuthTokenStoreError('Vault not configured');
        err.statusCode = 503;
        throw err;
      }
      const tokens = await tokenStore.getOAuthTokens(user.org_id, provider);
      if (!tokens) {
        return { ok: false, provider, reason: 'no_tokens' };
      }
      if (!tokens.refreshToken) {
        return { ok: false, provider, reason: 'no_refresh_token' };
      }
      const outcome = await refreshAccessToken(provider, tokens.refreshToken, { fetchImpl, env });
      if (!outcome.ok) {
        return { ok: false, provider, reason: outcome.reason };
      }
      await tokenStore.setOAuthTokens(user.org_id, provider, {
        accessToken: outcome.tokens.accessToken,
        refreshToken: outcome.tokens.refreshToken,
        expiresAt: outcome.tokens.expiresAt,
        scopes: outcome.tokens.scopes
      });
      return { ok: true, provider, expiresAt: outcome.tokens.expiresAt };
    });
  };
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  if (!fetchImpl) {
    throw new Error('fetchWithTimeout: no fetch implementation provided');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  registerOAuthRoutes,
  // Re-export the providers list for the SPA to render the
  // "Connect" UI without a second round-trip.
  listOAuthProviders,
  isOAuthProvider
};
