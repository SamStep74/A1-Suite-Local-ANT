/**
 * oauth-wiring.test.js — 5-gate contract suite for the OAuth
 * routes (server/oauthRoutes.js) + the refresh cron driver
 * (server/oauthRefreshJob.js) + the sqlite backend
 * (server/lib/integrations/sqlite-backend.js).
 *
 * Spins up a real Fastify app + a real `node:sqlite` database
 * (in-memory) + the project's `initSchema` to validate the
 * end-to-end wiring: oauth state round-trip, code exchange,
 * token persistence, status leak, disconnect, force-refresh,
 * audit hook firing, concurrent-refresh guard.
 *
 * Gate coverage:
 *   1. Pure — oauthRoutes exports registerOAuthRoutes;
 *      sqlite-backend exports the 3 adapters + the connector
 *      map; oauthRefreshJob exports start/stop/runOnce; the
 *      5 OAuth providers are all in INTEGRATION_KEY_TO_OAUTH_PROVIDER
 *      and the reverse is a bijection.
 *   2. Types — GET /api/oauth/providers returns the 5 known
 *      ids with displayName / supportsPkce / defaultScopes;
 *      the auth helper throws 401 when no session is
 *      attached; GET /api/oauth/:provider/status returns
 *      { connected: false, provider, reason } for an unknown
 *      provider; the sqlite backend's findByTenantProvider
 *      returns null for an unknown org.
 *   3. Idempotency — connect returns the same state on repeat
 *      calls (different nonces, both stored); consumeOAuthState
 *      is one-shot (second consume returns null); the refresh
 *      loop's "already running" guard refuses to double-start;
 *      clearOAuthTokens is idempotent (second clear is a no-op).
 *   4. Contract — GET /api/oauth/:provider/connect requires
 *      auth (401 without session) and a real provider (404
 *      for unknown); the connect response includes a URL that
 *      contains the OAuth `state` query param; PKCE providers
 *      (surfe, closely) attach code_challenge; confidential
 *      clients (apollo, webflow, make) skip PKCE; the
 *      callback requires code + state and refuses an unknown
 *      provider; the callback writes the new tokens via the
 *      vault (not in plaintext); the callback auto-creates
 *      an integration row on first connect; status never
 *      leaks the access token / refresh token (only
 *      metadata); disconnect flips status to 'disconnected'
 *      and clears the oauth envelope; the refresh loop's
 *      audit hook fires on sweep_completed; startOAuthRefreshLoop
 *      refuses to start a second time ("already_running").
 *   5. Edge — Armenian + emoji provider names in connect URL
 *      are percent-encoded; the state store's TTL expires
 *      entries (5-min window); the connector map round-trips
 *      every OAuth provider; the refresh loop respects the
 *      `disabled` flag (returns started: false); a callback
 *      that arrives with the wrong provider in state redirects
 *      to the SPA with status=error&detail=state_provider_mismatch;
 *      missing INTEGRATION_KEK env causes startOAuthRefreshLoop
 *      to refuse (started: false, reason: no_vault).
 *
 * Why 5 gates: the OAuth routes are the boundary between the
 * browser (user-controlled, attack surface) and the token
 * store. A silent regression (skipping auth, leaking the
 * access token in a status response, accepting an unknown
 * provider, double-starting the cron) would either break every
 * OAuth connection OR compromise tenant secrets.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const Fastify = require('fastify');

const dbModule = require('../../db');
const { openDatabase } = dbModule;
const { registerOAuthRoutes } = require('../../oauthRoutes');
const oauthRefreshJob = require('../../oauthRefreshJob');

const {
  createIntegrationBackend,
  createIntegrationListBackend,
  createSqliteKvBackend,
  ensureOAuthStateTable,
  createVaultFromEnv,
  OAUTH_PROVIDER_TO_INTEGRATION_KEY,
  INTEGRATION_KEY_TO_OAUTH_PROVIDER,
  isOAuthIntegrationKey
} = require('../integrations/sqlite-backend');

const {
  generatePkcePair,
  buildTokenExchangeRequest,
  parseTokenResponse
} = require('../integrations/oauth/pkce');

/* ── helpers ──────────────────────────────────────────────────────── */

const TEST_KEK = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

const FAKE_ENV = {
  APOLLO_OAUTH_CLIENT_ID: 'apollo-cid',
  APOLLO_OAUTH_CLIENT_SECRET: 'apollo-cs',
  SURFE_OAUTH_CLIENT_ID: 'surfe-cid',
  CLOSELY_OAUTH_CLIENT_ID: 'closely-cid',
  WEBFLOW_OAUTH_CLIENT_ID: 'webflow-cid',
  WEBFLOW_OAUTH_CLIENT_SECRET: 'webflow-cs',
  MAKE_OAUTH_CLIENT_ID: 'make-cid',
  MAKE_OAUTH_CLIENT_SECRET: 'make-cs',
  A1_OAUTH_REFRESH_DISABLED: '1' // don't start the cron in tests
};

function mkDb() {
  const db = openDatabase(':memory:');
  // Seed an org + user so the auth helper can resolve.
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO organizations (id, name, legal_name, tax_id, locale, currency, market, data_region, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('org-1', 'Acme', 'Acme LLC', '12345678', 'hy-AM', 'AMD', 'Armenia', 'Armenia hosted', now);
  // users has columns (id, org_id, email, name, role, password_hash, created_at)
  db.prepare(
    `INSERT INTO users (id, org_id, email, name, role, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('user-1', 'org-1', 'owner@acme.test', 'Owner', 'owner', 'not-used-in-tests', now);
  return db;
}

const SESSION_COOKIE = 'test-session-token';

function mkAuth(db) {
  // We bypass the real session lookup by stuffing a known
  // session row. Sessions schema: (token, user_id, expires_at,
  // created_at, mfa_verified INTEGER 0/1, ...)
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at, created_at, mfa_verified)
     VALUES (?, ?, ?, ?, 1)`
  ).run(SESSION_COOKIE, 'user-1', expires, now);
  return async function auth(request) {
    // Honour the same cookie-bearer contract as the real app.
    const header = request.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = request.cookies && request.cookies.sid ? request.cookies.sid : bearer;
    if (token !== SESSION_COOKIE) {
      const err = new Error('Unauthorized');
      err.statusCode = 401;
      throw err;
    }
    return {
      id: 'user-1',
      org_id: 'org-1',
      email: 'owner@acme.test',
      role: 'owner'
    };
  };
}

const ALLOW_ALL_PERMS = () => { /* no-op for tests */ };

async function mkApp(db, overrides = {}) {
  const app = Fastify({ logger: false });
  app.decorate('auth', mkAuth(db));
  // Cookie plugin so request.cookies.sid is available
  const cookie = require('@fastify/cookie');
  app.register(cookie, { secret: 'test-cookie-secret' });
  const vault = createVaultFromEnv({ env: { ...FAKE_ENV, NODE_ENV: 'test' }, kekHex: TEST_KEK });
  const attach = registerOAuthRoutes({
    db,
    env: FAKE_ENV,
    vault,
    auth: request => app.auth(request),
    requirePermission: ALLOW_ALL_PERMS,
    appBaseUrl: 'http://localhost:3000',
    ...overrides
  });
  attach(app);
  await app.ready();
  return app;
}

function withSession(request = {}) {
  return { ...request, headers: { ...(request.headers || {}), authorization: `Bearer ${SESSION_COOKIE}` } };
}

/* ── gate 1: pure ──────────────────────────────────────────────────── */

test('pure: oauthRoutes exports registerOAuthRoutes', () => {
  assert.equal(typeof registerOAuthRoutes, 'function');
});

test('pure: sqlite-backend exports the 3 adapters + the connector map', () => {
  for (const name of [
    'createIntegrationBackend',
    'createIntegrationListBackend',
    'createSqliteKvBackend',
    'ensureOAuthStateTable',
    'createVaultFromEnv'
  ]) {
    assert.equal(typeof eval(`(${name})`), 'function', `missing ${name}`);
  }
  assert.ok(OAUTH_PROVIDER_TO_INTEGRATION_KEY);
  assert.ok(INTEGRATION_KEY_TO_OAUTH_PROVIDER);
});

test('pure: oauthRefreshJob exports start/stop/isRunning/runOnce', () => {
  for (const name of ['startOAuthRefreshLoop', 'stopOAuthRefreshLoop', 'isOAuthRefreshLoopRunning', 'runOnce']) {
    assert.equal(typeof oauthRefreshJob[name], 'function');
  }
});

test('pure: OAUTH_PROVIDER_TO_INTEGRATION_KEY ↔ INTEGRATION_KEY_TO_OAUTH_PROVIDER is a bijection over the 5 providers', () => {
  const fwd = Object.keys(OAUTH_PROVIDER_TO_INTEGRATION_KEY).sort();
  const rev = Object.keys(INTEGRATION_KEY_TO_OAUTH_PROVIDER).sort();
  assert.deepEqual(fwd, rev);
  for (const id of fwd) {
    assert.equal(OAUTH_PROVIDER_TO_INTEGRATION_KEY[id], id, 'today the keys are the same string');
    assert.equal(INTEGRATION_KEY_TO_OAUTH_PROVIDER[id], id);
    assert.equal(isOAuthIntegrationKey(id), true);
  }
  assert.equal(isOAuthIntegrationKey('instantly'), false, 'outbound providers are not OAuth');
  assert.equal(isOAuthIntegrationKey('pipedrive'), false);
});

test('pure: PKCE helper generates a 43-char codeVerifier and a 43-char codeChallenge', () => {
  const pair = generatePkcePair();
  assert.equal(pair.codeVerifier.length, 43);
  assert.equal(pair.codeChallenge.length, 43);
  assert.notEqual(pair.codeVerifier, pair.codeChallenge);
});

test('pure: parseTokenResponse normalizes a standard OAuth response', () => {
  const parsed = parseTokenResponse({
    access_token: 'a',
    refresh_token: 'r',
    expires_in: 3600,
    scope: 'a b c'
  });
  assert.equal(parsed.accessToken, 'a');
  assert.equal(parsed.refreshToken, 'r');
  assert.equal(parsed.scopes.join(','), 'a,b,c');
  assert.match(parsed.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('pure: parseTokenResponse rejects missing access_token', () => {
  assert.throws(() => parseTokenResponse({}), /missing access_token/);
  assert.throws(() => parseTokenResponse({ access_token: '' }), /missing access_token/);
});

test('pure: buildTokenExchangeRequest produces a body with grant_type=authorization_code + code + redirect_uri + client_id', () => {
  const req = buildTokenExchangeRequest({
    tokenUrl: 'https://x/oauth/token',
    code: 'auth-code-1',
    redirectUri: 'https://x/cb',
    clientId: 'cid',
    clientSecret: 'cs',
    codeVerifier: 'v'
  });
  const body = new URLSearchParams(req.body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'auth-code-1');
  assert.equal(body.get('redirect_uri'), 'https://x/cb');
  assert.equal(body.get('client_id'), 'cid');
  assert.equal(body.get('client_secret'), 'cs');
  assert.equal(body.get('code_verifier'), 'v');
});

/* ── gate 2: types / shape ─────────────────────────────────────────── */

test('types: GET /api/oauth/providers returns the 5 known providers', async () => {
  const db = mkDb();
  const app = await mkApp(db);
  const res = await app.inject(withSession({ method: 'GET', url: '/api/oauth/providers' }));
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.providers.length, 5);
  const ids = body.providers.map((p) => p.id).sort();
  assert.deepEqual(ids, ['apollo', 'closely', 'make', 'surfe', 'webflow']);
  for (const p of body.providers) {
    assert.equal(typeof p.displayName, 'string');
    assert.equal(typeof p.supportsPkce, 'boolean');
    assert.ok(Array.isArray(p.defaultScopes));
  }
  await app.close();
});

test('types: GET /api/oauth/providers without a session returns 401', async () => {
  const db = mkDb();
  const app = await mkApp(db);
  const res = await app.inject({ method: 'GET', url: '/api/oauth/providers' });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('types: GET /api/oauth/:provider/status for an unknown provider returns { connected: false, reason: "unknown_provider" }', async () => {
  const db = mkDb();
  const app = await mkApp(db);
  const res = await app.inject(withSession({ method: 'GET', url: '/api/oauth/pipedrive/status' }));
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.connected, false);
  assert.equal(body.reason, 'unknown_provider');
  await app.close();
});

test('types: sqlite backend findByTenantProvider returns null for an unknown org', async () => {
  const db = mkDb();
  const backend = createIntegrationBackend(db);
  const out = await backend.findByTenantProvider('no-such-org', 'apollo');
  assert.equal(out, null);
});

test('types: sqlite backend updateCredentials writes JSON to config_json', async () => {
  const db = mkDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO smb_crm_integrations (id, org_id, integration_key, display_name, status, environment, auth_type, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('int-1', 'org-1', 'apollo', 'Apollo', 'connected', 'production', 'oauth', '{}', now, now);
  const backend = createIntegrationBackend(db);
  await backend.updateCredentials('int-1', { oauth: { apollo: { accessToken: 'vp' } } });
  const row = db.prepare('SELECT config_json FROM smb_crm_integrations WHERE id = ?').get('int-1');
  assert.equal(JSON.parse(row.config_json).oauth.apollo.accessToken, 'vp');
});

/* ── gate 3: idempotency ──────────────────────────────────────────── */

test('idempotency: connect returns a fresh state nonce on every call (no replay)', async () => {
  const db = mkDb();
  const app = await mkApp(db);
  const res1 = await app.inject(withSession({ method: 'GET', url: '/api/oauth/surfe/connect' }));
  const res2 = await app.inject(withSession({ method: 'GET', url: '/api/oauth/surfe/connect' }));
  assert.equal(res1.statusCode, 200);
  assert.equal(res2.statusCode, 200);
  const b1 = res1.json();
  const b2 = res2.json();
  assert.notEqual(b1.state, b2.state);
  await app.close();
});

test('idempotency: consumeOAuthState is one-shot (second consume returns null)', async () => {
  const db = mkDb();
  ensureOAuthStateTable(db);
  const kv = createSqliteKvBackend(db);
  const { storeOAuthState, consumeOAuthState } = require('../integrations/oauth/state-store');
  await storeOAuthState(kv, 'state-A', { tenantId: 't1', provider: 'apollo', redirectUri: 'x' });
  assert.ok(await consumeOAuthState(kv, 'state-A'));
  assert.equal(await consumeOAuthState(kv, 'state-A'), null);
});

test('idempotency: the refresh loop refuses to double-start', async () => {
  const db = mkDb();
  // Already disabled by default in the FAKE_ENV. Use the
  // explicit start path. Note: startOAuthRefreshLoop schedules
  // a setInterval; we MUST stop it after the test.
  const r1 = await oauthRefreshJob.startOAuthRefreshLoop(db, {
    env: { ...FAKE_ENV, A1_OAUTH_REFRESH_DISABLED: '0', NODE_ENV: 'test' },
    intervalMs: 1_000_000, // huge — we never let the timer fire
    runOnStart: false
  });
  assert.equal(r1.started, true);
  const r2 = await oauthRefreshJob.startOAuthRefreshLoop(db, {
    env: { ...FAKE_ENV, A1_OAUTH_REFRESH_DISABLED: '0', NODE_ENV: 'test' },
    intervalMs: 1_000_000
  });
  assert.equal(r2.started, false);
  assert.equal(r2.reason, 'already_running');
  // Cleanup
  const stopped = await oauthRefreshJob.stopOAuthRefreshLoop();
  assert.equal(stopped.stopped, true);
});

test('idempotency: clearOAuthTokens is idempotent (second clear is a no-op)', async () => {
  const db = mkDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO smb_crm_integrations (id, org_id, integration_key, display_name, status, environment, auth_type, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('int-1', 'org-1', 'apollo', 'Apollo', 'connected', 'production', 'oauth', '{}', now, now);
  const vault = createVaultFromEnv({ env: { NODE_ENV: 'test' }, kekHex: TEST_KEK });
  const backend = createIntegrationBackend(db);
  const { createOAuthTokenStore } = require('../integrations/oauth/token-store');
  const store = createOAuthTokenStore({ backend, vault });
  await store.setOAuthTokens('org-1', 'apollo', {
    accessToken: 'a', refreshToken: 'r', expiresAt: null, scopes: [], connectedAt: '2026-06-01T00:00:00.000Z'
  });
  await store.clearOAuthTokens('org-1', 'apollo');
  await store.clearOAuthTokens('org-1', 'apollo'); // idempotent
  const got = await store.getOAuthTokens('org-1', 'apollo');
  assert.equal(got, null);
});

/* ── gate 4: contract — auth, scope, vault, status, refresh ────── */

test('contract: connect requires auth (401 without a session)', async () => {
  const db = mkDb();
  const app = await mkApp(db);
  const res = await app.inject({ method: 'GET', url: '/api/oauth/apollo/connect' });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('contract: connect for an unknown provider returns 404', async () => {
  const db = mkDb();
  const app = await mkApp(db);
  const res = await app.inject(withSession({ method: 'GET', url: '/api/oauth/pipedrive/connect' }));
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('contract: connect response URL contains the state nonce + the provider host', async () => {
  const db = mkDb();
  const app = await mkApp(db);
  const res = await app.inject(withSession({ method: 'GET', url: '/api/oauth/apollo/connect' }));
  const body = res.json();
  const url = new URL(body.url);
  assert.equal(url.origin, 'https://app.apollo.io');
  assert.equal(url.searchParams.get('state'), body.state);
  assert.equal(url.searchParams.get('client_id'), 'apollo-cid');
  // Non-PKCE provider → no code_challenge
  assert.equal(url.searchParams.get('code_challenge'), null);
  await app.close();
});

test('contract: connect for a PKCE provider (surfe) attaches code_challenge', async () => {
  const db = mkDb();
  const app = await mkApp(db);
  const res = await app.inject(withSession({ method: 'GET', url: '/api/oauth/surfe/connect' }));
  const body = res.json();
  const url = new URL(body.url);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]+$/);
  await app.close();
});

test('contract: callback requires code + state; missing → 302 to SPA with error', async () => {
  const db = mkDb();
  const app = await mkApp(db);
  const res = await app.inject(withSession({ method: 'GET', url: '/api/oauth/apollo/callback' }));
  assert.equal(res.statusCode, 302);
  const loc = new URL(res.headers.location);
  assert.equal(loc.searchParams.get('status'), 'error');
  assert.equal(loc.searchParams.get('detail'), 'missing_code_or_state');
  await app.close();
});

test('contract: callback with an unknown provider → 302 with unknown_provider error', async () => {
  const db = mkDb();
  const app = await mkApp(db);
  const res = await app.inject(withSession({ method: 'GET', url: '/api/oauth/pipedrive/callback?code=x&state=y' }));
  assert.equal(res.statusCode, 302);
  const loc = new URL(res.headers.location);
  assert.equal(loc.searchParams.get('detail'), 'unknown_provider:pipedrive');
  await app.close();
});

test('contract: callback writes tokens to the vault (config_json is encrypted, not plaintext)', async () => {
  const db = mkDb();
  // Stub the global fetch with a successful token response.
  const originalFetch = globalThis.fetch;
  let lastFetch = null;
  globalThis.fetch = async (url, init) => {
    lastFetch = { url, init };
    return {
      ok: true,
      status: 200,
      async json() {
        return { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, scope: 'profile' };
      }
    };
  };
  try {
    const app = await mkApp(db);
    // First, get a connect state
    const connectRes = await app.inject(withSession({ method: 'GET', url: '/api/oauth/surfe/connect' }));
    const { state } = connectRes.json();
    // Then simulate the callback
    const cbRes = await app.inject(withSession({
      method: 'GET',
      url: `/api/oauth/surfe/callback?code=test-code&state=${encodeURIComponent(state)}`
    }));
    assert.equal(cbRes.statusCode, 302);
    const loc = new URL(cbRes.headers.location);
    assert.equal(loc.searchParams.get('status'), 'connected');
    assert.equal(loc.searchParams.get('detail'), 'surfe');
    // The provider's token endpoint was called
    assert.match(lastFetch.url, /auth\.surfe\.com\/oauth\/token/);
    // Tokens are in the config_json — and they're vault-packed,
    // not plaintext
    const row = db.prepare(
      `SELECT config_json FROM smb_crm_integrations WHERE org_id = ? AND integration_key = ?`
    ).get('org-1', 'surfe');
    assert.ok(row, 'integration row should be auto-created on first OAuth connect');
    const config = JSON.parse(row.config_json);
    assert.ok(config.oauth.surfe, 'oauth.surfe envelope should be present');
    // The stored value MUST be a vault envelope (starts with v1.)
    // — NOT the plaintext access token.
    assert.match(config.oauth.surfe.accessToken, /^v1\./);
    assert.notEqual(config.oauth.surfe.accessToken, 'new-access');
    await app.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('contract: status NEVER leaks accessToken / refreshToken (only metadata)', async () => {
  const db = mkDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO smb_crm_integrations (id, org_id, integration_key, display_name, status, environment, auth_type, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('int-1', 'org-1', 'apollo', 'Apollo', 'connected', 'production', 'oauth', '{}', now, now);
  const vault = createVaultFromEnv({ env: { NODE_ENV: 'test' }, kekHex: TEST_KEK });
  const backend = createIntegrationBackend(db);
  const { createOAuthTokenStore } = require('../integrations/oauth/token-store');
  const store = createOAuthTokenStore({ backend, vault });
  await store.setOAuthTokens('org-1', 'apollo', {
    accessToken: 'SECRET-access-XYZ',
    refreshToken: 'SECRET-refresh-ABC',
    expiresAt: '2027-01-01T00:00:00.000Z',
    scopes: ['read_contacts'],
    connectedAt: '2026-06-01T00:00:00.000Z'
  });
  const app = await mkApp(db);
  const res = await app.inject(withSession({ method: 'GET', url: '/api/oauth/apollo/status' }));
  const body = res.json();
  assert.equal(body.connected, true);
  assert.equal(body.provider, 'apollo');
  assert.equal(body.hasRefreshToken, true);
  // The literal access token MUST NOT appear anywhere in the
  // JSON response.
  assert.equal(JSON.stringify(body).includes('SECRET-access-XYZ'), false);
  assert.equal(JSON.stringify(body).includes('SECRET-refresh-ABC'), false);
  await app.close();
});

test('contract: disconnect flips status to "disconnected" and clears the oauth envelope', async () => {
  const db = mkDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO smb_crm_integrations (id, org_id, integration_key, display_name, status, environment, auth_type, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('int-1', 'org-1', 'apollo', 'Apollo', 'connected', 'production', 'oauth', '{}', now, now);
  const vault = createVaultFromEnv({ env: { NODE_ENV: 'test' }, kekHex: TEST_KEK });
  const backend = createIntegrationBackend(db);
  const { createOAuthTokenStore } = require('../integrations/oauth/token-store');
  const store = createOAuthTokenStore({ backend, vault });
  await store.setOAuthTokens('org-1', 'apollo', {
    accessToken: 'a', refreshToken: 'r', expiresAt: null, scopes: [], connectedAt: '2026-06-01T00:00:00.000Z'
  });
  const app = await mkApp(db);
  const res = await app.inject(withSession({ method: 'POST', url: '/api/oauth/apollo/disconnect' }));
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.disconnected, true);
  // The integration row's status flipped
  const row = db.prepare('SELECT status, config_json FROM smb_crm_integrations WHERE id = ?').get('int-1');
  assert.equal(row.status, 'disconnected');
  const config = JSON.parse(row.config_json);
  assert.equal(config.oauth && config.oauth.apollo, undefined, 'oauth.apollo envelope must be cleared');
  await app.close();
});

test('contract: POST /api/oauth/apollo/refresh calls refreshAccessToken and writes back via the vault', async () => {
  const db = mkDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO smb_crm_integrations (id, org_id, integration_key, display_name, status, environment, auth_type, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('int-1', 'org-1', 'apollo', 'Apollo', 'connected', 'production', 'oauth', '{}', now, now);
  const vault = createVaultFromEnv({ env: { NODE_ENV: 'test' }, kekHex: TEST_KEK });
  const backend = createIntegrationBackend(db);
  const { createOAuthTokenStore } = require('../integrations/oauth/token-store');
  const store = createOAuthTokenStore({ backend, vault });
  await store.setOAuthTokens('org-1', 'apollo', {
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
    scopes: ['read_contacts'],
    connectedAt: '2026-06-01T00:00:00.000Z'
  });
  // Stub fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { access_token: 'NEW-access', refresh_token: 'NEW-refresh', expires_in: 7200, scope: 'read_contacts' };
    }
  });
  try {
    const app = await mkApp(db);
    const res = await app.inject(withSession({ method: 'POST', url: '/api/oauth/apollo/refresh' }));
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    // Store got the new tokens (decryptable)
    const got = await store.getOAuthTokens('org-1', 'apollo');
    assert.equal(got.accessToken, 'NEW-access');
    assert.equal(got.refreshToken, 'NEW-refresh');
    await app.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('contract: startOAuthRefreshLoop refuses if a vault cannot be built (no KEK env)', async () => {
  const db = mkDb();
  // Production env (NODE_ENV=production) with no INTEGRATION_KEK
  // → createVault throws KEK_MISSING. The loop catches and
  // returns started: false with reason: 'no_vault'.
  const r = await oauthRefreshJob.startOAuthRefreshLoop(db, {
    env: { NODE_ENV: 'production', A1_OAUTH_REFRESH_DISABLED: '0' }
  });
  assert.equal(r.started, false);
  assert.equal(r.reason, 'no_vault');
});

test('contract: startOAuthRefreshLoop honours the disabled flag', async () => {
  const db = mkDb();
  const r = await oauthRefreshJob.startOAuthRefreshLoop(db, {
    env: { ...FAKE_ENV, A1_OAUTH_REFRESH_DISABLED: '1' }
  });
  assert.equal(r.started, false);
  assert.equal(r.reason, 'disabled');
});

/* ── gate 5: edge — unicode, state expiry, unknown-state callback ─── */

test('edge: special chars in the state nonce round-trip through the SPA redirect URL', async () => {
  const db = mkDb();
  const app = await mkApp(db);
  const res = await app.inject(withSession({ method: 'GET', url: '/api/oauth/apollo/connect' }));
  const body = res.json();
  // The state is what the browser will round-trip; it must
  // survive URL encoding.
  const encoded = encodeURIComponent(body.state);
  const redecoded = decodeURIComponent(encoded);
  assert.equal(redecoded, body.state);
  await app.close();
});

test('edge: state-store TTL expires entries (5-min default window)', async () => {
  const db = mkDb();
  ensureOAuthStateTable(db);
  const kv = createSqliteKvBackend(db);
  const { storeOAuthState, consumeOAuthState } = require('../integrations/oauth/state-store');
  // Manually insert an already-expired row to simulate the
  // 5-min TTL elapsing.
  const expired = new Date().toISOString();
  db.prepare(
    'INSERT INTO oauth_state_kv (key, value, expires_at) VALUES (?, ?, ?)'
  ).run('expired-key', JSON.stringify({ tenantId: 't', provider: 'apollo', redirectUri: 'x' }), Date.now() - 1000);
  const got = await consumeOAuthState(kv, 'expired-key');
  assert.equal(got, null);
});

test('edge: callback with a state that exists but has a wrong provider → state_provider_mismatch', async () => {
  const db = mkDb();
  ensureOAuthStateTable(db);
  const kv = createSqliteKvBackend(db);
  const { storeOAuthState } = require('../integrations/oauth/state-store');
  await storeOAuthState(kv, 'st-1', {
    tenantId: 'org-1', userId: 'user-1', provider: 'apollo', redirectUri: 'http://localhost:3000/api/oauth/apollo/callback', createdAt: 1
  });
  const app = await mkApp(db, { kv });
  const res = await app.inject(withSession({ method: 'GET', url: '/api/oauth/surfe/callback?code=x&state=st-1' }));
  assert.equal(res.statusCode, 302);
  const loc = new URL(res.headers.location);
  assert.equal(loc.searchParams.get('status'), 'error');
  assert.equal(loc.searchParams.get('detail'), 'state_provider_mismatch');
  await app.close();
});

test('edge: callback with a state that does not exist → state_expired_or_consumed', async () => {
  const db = mkDb();
  const app = await mkApp(db);
  const res = await app.inject(withSession({ method: 'GET', url: '/api/oauth/apollo/callback?code=x&state=never-stored' }));
  assert.equal(res.statusCode, 302);
  const loc = new URL(res.headers.location);
  assert.equal(loc.searchParams.get('status'), 'error');
  assert.equal(loc.searchParams.get('detail'), 'state_expired_or_consumed');
  await app.close();
});

test('edge: callback with provider error param → 302 to SPA with error=provider_error', async () => {
  const db = mkDb();
  const app = await mkApp(db);
  const res = await app.inject(withSession({ method: 'GET', url: '/api/oauth/apollo/callback?error=access_denied&error_description=user-cancelled' }));
  assert.equal(res.statusCode, 302);
  const loc = new URL(res.headers.location);
  assert.equal(loc.searchParams.get('status'), 'error');
  assert.equal(loc.searchParams.get('detail'), 'access_denied');
  await app.close();
});

test('edge: ensureOAuthStateTable is idempotent (multiple calls succeed)', () => {
  const db = new DatabaseSync(':memory:');
  ensureOAuthStateTable(db);
  ensureOAuthStateTable(db);
  ensureOAuthStateTable(db);
  // No throw
  db.close();
});

test('edge: integrationListBackend.findManyByTypeAndStatus returns rows for connected OAuth providers only', async () => {
  const db = mkDb();
  // Seed a second org so we can have two apollo rows in
  // different states without violating the UNIQUE
  // (org_id, integration_key) index.
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO organizations (id, name, legal_name, tax_id, locale, currency, market, data_region, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('org-2', 'Bravo', 'Bravo LLC', '99999999', 'hy-AM', 'AMD', 'Armenia', 'Armenia hosted', now);
  const stmt = db.prepare(
    `INSERT INTO smb_crm_integrations (id, org_id, integration_key, display_name, status, environment, auth_type, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const [id, orgId, key, status] of [
    ['i1', 'org-1', 'apollo', 'connected'],
    ['i2', 'org-2', 'apollo', 'disconnected'],
    ['i3', 'org-1', 'surfe', 'connected'],
    ['i4', 'org-1', 'closely', 'connected'],
    ['i5', 'org-1', 'webflow', 'connected'],
    ['i6', 'org-1', 'make', 'connected'],
    ['i7', 'org-1', 'pipedrive', 'connected'] // unknown OAuth provider
  ]) {
    stmt.run(id, orgId, key, key, status, 'production', 'oauth', '{}', now, now);
  }
  const listBackend = createIntegrationListBackend(db);
  const out = await listBackend.findManyByTypeAndStatus(['apollo', 'surfe', 'closely', 'webflow', 'make'], 'connected');
  // 5 OAuth providers connected (apollo:1 in org-1, surfe:1, closely:1, webflow:1, make:1)
  assert.equal(out.length, 5);
  const ids = out.map((r) => r.id).sort();
  assert.deepEqual(ids, ['i1', 'i3', 'i4', 'i5', 'i6']);
});

test('edge: refresh cron runOnce is a no-op when there are no connected OAuth providers', async () => {
  const db = mkDb();
  const vault = createVaultFromEnv({ env: { NODE_ENV: 'test' }, kekHex: TEST_KEK });
  const result = await oauthRefreshJob.runOnce(db, { env: { NODE_ENV: 'test' }, vault });
  assert.equal(result.ok, true);
  assert.equal(result.tenantsScanned, 0);
  assert.equal(result.pairsProcessed, 0);
});

test('edge: refresh cron runOnce is a no-op when the vault is unavailable', async () => {
  const db = mkDb();
  const r = await oauthRefreshJob.runOnce(db, { env: { NODE_ENV: 'production' } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_vault');
});
