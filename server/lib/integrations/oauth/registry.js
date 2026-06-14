/**
 * oauth/registry — OAuth registry for PULL APIs.
 *
 * Why a separate registry from the outbound sequence providers in
 * `integrations/providers/`? Different concerns:
 *   - The `providers/` registry owns URL shapes for outbound PUSH
 *     (Apollo enroll, Instantly enroll, Closely enroll).
 *   - This registry owns the OAuth dance: where to send users for
 *     authorization, where to exchange the code for tokens, and
 *     what scopes to request. The PULL adapter later combines
 *     these tokens with the provider's URL/header conventions.
 *
 * All secrets (client_id, client_secret, access_token, refresh_token)
 * live in the integration's encrypted config (vault-bound, see
 * `server/lib/vault.js`). The registry itself only holds PUBLIC
 * config: the OAuth endpoints, scopes, and which env var carries
 * the per-tenant client_id. No secret material lives here.
 *
 * Pure: no I/O, no DB import, no fetch.
 */
'use strict';

/** @typedef {'apollo'|'surfe'|'closely'|'webflow'|'make'} OAuthProviderId */

/**
 * @typedef {Object} OAuthProviderConfig
 * @property {OAuthProviderId} id
 * @property {string} displayName
 * @property {string} authUrl
 * @property {string} tokenUrl
 * @property {string} [refreshUrl]
 * @property {string[]} defaultScopes
 * @property {boolean} supportsPkce
 * @property {string} clientIdEnv
 * @property {string} [clientSecretEnv]
 * @property {Record<string,string>} [extraAuthParams]
 */

const OAUTH_PROVIDERS = /** @type {Record<OAuthProviderId, OAuthProviderConfig>} */ ({
  apollo: {
    id: 'apollo',
    displayName: 'Apollo',
    // Apollo uses a master API key by default; OAuth is for partner
    // integrations. Most tenants will use API key instead — OAuth
    // is here for the few who want delegated access.
    authUrl: 'https://app.apollo.io/#/oauth/authorize',
    tokenUrl: 'https://api.apollo.io/v1/oauth/token',
    refreshUrl: 'https://api.apollo.io/v1/oauth/token',
    defaultScopes: ['read_contacts', 'write_contacts'],
    supportsPkce: false,
    clientIdEnv: 'APOLLO_OAUTH_CLIENT_ID',
    clientSecretEnv: 'APOLLO_OAUTH_CLIENT_SECRET',
    extraAuthParams: { response_type: 'code' }
  },
  surfe: {
    id: 'surfe',
    displayName: 'Surfe',
    authUrl: 'https://auth.surfe.com/oauth/authorize',
    tokenUrl: 'https://auth.surfe.com/oauth/token',
    defaultScopes: ['profile', 'enrichment:read'],
    supportsPkce: true,
    clientIdEnv: 'SURFE_OAUTH_CLIENT_ID'
    // PKCE-only — no static client secret.
  },
  closely: {
    id: 'closely',
    displayName: 'Closely',
    authUrl: 'https://api.closelyhq.com/oauth/authorize',
    tokenUrl: 'https://api.closelyhq.com/oauth/token',
    defaultScopes: ['sequences:read', 'sequences:write'],
    supportsPkce: true,
    clientIdEnv: 'CLOSELY_OAUTH_CLIENT_ID'
  },
  webflow: {
    id: 'webflow',
    displayName: 'Webflow',
    authUrl: 'https://webflow.com/oauth/authorize',
    tokenUrl: 'https://api.webflow.com/oauth/access_token',
    defaultScopes: ['sites:read', 'sites:write', 'forms:read', 'forms:write'],
    supportsPkce: false,
    clientIdEnv: 'WEBFLOW_OAUTH_CLIENT_ID',
    clientSecretEnv: 'WEBFLOW_OAUTH_CLIENT_SECRET',
    extraAuthParams: { response_type: 'code' }
  },
  make: {
    id: 'make',
    displayName: 'Make',
    authUrl: 'https://www.make.com/oauth/authorize',
    tokenUrl: 'https://www.make.com/oauth/token',
    defaultScopes: ['scenarios:read', 'scenarios:run'],
    supportsPkce: false,
    clientIdEnv: 'MAKE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MAKE_OAUTH_CLIENT_SECRET',
    extraAuthParams: { response_type: 'code' }
  }
});

class OAuthRegistryError extends Error {
  constructor(message) {
    super(`[OAUTH_PROVIDER_NOT_FOUND] ${message}`);
    this.name = 'OAuthRegistryError';
  }
}

function getOAuthConfig(id) {
  const cfg = OAUTH_PROVIDERS[id];
  if (!cfg) {
    // Don't list the known providers in the error message — that
    // both leaks the OAuth surface to anyone who can hit a path
    // that touches this lookup AND unnecessarily widens the
    // error string (which gets localized in some callers). The
    // provider id is in the caller's log, that's enough.
    throw new OAuthRegistryError(`Unknown OAuth provider: ${id}`);
  }
  return cfg;
}

function listOAuthProviders() {
  return Object.keys(OAUTH_PROVIDERS);
}

function isOAuthProvider(id) {
  return Object.prototype.hasOwnProperty.call(OAUTH_PROVIDERS, id);
}

/**
 * @typedef {Object} BuildAuthUrlInput
 * @property {OAuthProviderId} provider
 * @property {string} redirectUri
 * @property {string} state  per-request state for CSRF
 * @property {string} [codeChallenge]  PKCE code challenge
 * @property {string[]} [scopes]  tenant-supplied scope narrowing
 */

/**
 * Build the URL the user's browser should be sent to.
 * @param {BuildAuthUrlInput} input
 * @param {Object} [env]  env override (defaults to process.env)
 * @returns {string}
 */
function buildAuthUrl(input, env) {
  const cfg = getOAuthConfig(input.provider);
  const envSource = env || process.env;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: envSource[cfg.clientIdEnv] || '',
    redirect_uri: input.redirectUri,
    state: input.state,
    scope: (input.scopes || cfg.defaultScopes).join(' ')
  });
  // Only attach PKCE params for providers that support PKCE. A
  // caller asking for codeChallenge on a confidential-client
  // provider would just leak a verifier nobody verifies; we
  // ignore it instead.
  if (input.codeChallenge && cfg.supportsPkce) {
    params.set('code_challenge', input.codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  if (cfg.extraAuthParams) {
    for (const [k, v] of Object.entries(cfg.extraAuthParams)) {
      // Don't let provider-level params clobber the caller's
      // explicit overrides. response_type is the only one in
      // our current configs; checking by key keeps the rule
      // generic.
      if (!params.has(k)) params.set(k, v);
    }
  }
  const url = new URL(cfg.authUrl);
  for (const [k, v] of params) url.searchParams.set(k, v);
  return url.toString();
}

module.exports = {
  getOAuthConfig,
  listOAuthProviders,
  isOAuthProvider,
  buildAuthUrl,
  OAuthRegistryError
};
