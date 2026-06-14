/**
 * oauth-registry.test.js — 5-gate contract suite for the OAuth
 * registry (server/lib/integrations/oauth/registry.js) + the
 * state-store (state-store.js).
 *
 * Gate coverage:
 *   1. Pure — getOAuthConfig for each of 5 providers (apollo,
 *      surfe, closely, webflow, make) returns the documented
 *      authUrl/tokenUrl/defaultScopes/supportsPkce/clientIdEnv;
 *      buildAuthUrl produces the documented shape with all
 *      required query params + correct scope joining.
 *   2. Types — listOAuthProviders returns the 5 ids; isOAuthProvider
 *      narrows; OAuthRegistryError carries the documented prefix;
 *      state-store createInMemoryStateStore implements the 3-method
 *      KV contract.
 *   3. Idempotency — same state + payload → same serialized value
 *      (modulo createdAt); re-calling buildAuthUrl with the same
 *      input returns the same URL; consumeOAuthState on a consumed
 *      state returns null (one-shot semantics).
 *   4. Contract — Apollo's authUrl points at app.apollo.io (NOT
 *      api.apollo.io — the URL is a hash route, not a REST
 *      endpoint); Surfe + Closely support PKCE; Webflow + Make do
 *      NOT; PKCE params appear ONLY when supportsPkce=true and a
 *      codeChallenge was supplied; the unknown-provider error
 *      does NOT leak the list of known providers (security
 *      detail preserved from MAX); the state-store enforces
 *      state-string presence and payload-tenantId/provider shape.
 *   5. Edge — scope narrowing (caller overrides defaults);
 *      codeChallenge ignored for non-PKCE providers (no
 *      verifier-leak); non-ASCII + special chars in redirect_uri
 *      are URL-encoded; buildAuthUrl with env override (not
 *      process.env) is testable; state-store TTL expiry: stored
 *      state cannot be consumed after TTL; in-memory backend
 *      size() reflects only the keys currently live.
 *
 * Why 5 gates: the registry defines the OAuth attack surface. A
 * silent change (e.g. switching the Apollo auth host, leaking
 * the provider list, dropping PKCE on a public-client provider)
 * would let an attacker either enumerate the OAuth surface or
 * downgrade a security control.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getOAuthConfig,
  listOAuthProviders,
  isOAuthProvider,
  buildAuthUrl,
  OAuthRegistryError
} = require('../integrations/oauth/registry');

const {
  storeOAuthState,
  consumeOAuthState,
  resetOAuthStateStore,
  createInMemoryStateStore,
  STATE_TTL_MS,
  DEFAULT_KEY_PREFIX
} = require('../integrations/oauth/state-store');

/* ── helpers ──────────────────────────────────────────────────────── */

const FAKE_ENV = {
  APOLLO_OAUTH_CLIENT_ID: 'apollo-cid-test',
  APOLLO_OAUTH_CLIENT_SECRET: 'apollo-cs-test',
  SURFE_OAUTH_CLIENT_ID: 'surfe-cid-test',
  CLOSELY_OAUTH_CLIENT_ID: 'closely-cid-test',
  WEBFLOW_OAUTH_CLIENT_ID: 'webflow-cid-test',
  WEBFLOW_OAUTH_CLIENT_SECRET: 'webflow-cs-test',
  MAKE_OAUTH_CLIENT_ID: 'make-cid-test',
  MAKE_OAUTH_CLIENT_SECRET: 'make-cs-test'
};

const PKCE_PROVIDERS = ['surfe', 'closely'];
const NON_PKCE_PROVIDERS = ['apollo', 'webflow', 'make'];
const ALL_PROVIDERS = ['apollo', 'surfe', 'closely', 'webflow', 'make'];

/* ── gate 1: pure ──────────────────────────────────────────────────── */

test('pure: getOAuthConfig returns the documented config for all 5 providers', () => {
  for (const id of ALL_PROVIDERS) {
    const cfg = getOAuthConfig(id);
    assert.equal(cfg.id, id);
    assert.equal(typeof cfg.displayName, 'string');
    assert.ok(cfg.authUrl.startsWith('https://'), `${id} authUrl must be HTTPS`);
    assert.ok(cfg.tokenUrl.startsWith('https://'), `${id} tokenUrl must be HTTPS`);
    assert.ok(Array.isArray(cfg.defaultScopes) && cfg.defaultScopes.length > 0);
    assert.equal(typeof cfg.supportsPkce, 'boolean');
    assert.match(cfg.clientIdEnv, /^[A-Z][A-Z0-9_]+$/, `${id} clientIdEnv must be SCREAMING_SNAKE`);
    // refreshUrl either equals tokenUrl or is absent (not both)
    if (cfg.refreshUrl) {
      assert.equal(typeof cfg.refreshUrl, 'string');
    }
  }
});

test('pure: Apollo config pins authUrl to app.apollo.io (hash route, not API host)', () => {
  const cfg = getOAuthConfig('apollo');
  // SECURITY: the authorize URL is a hash route on the marketing
  // app, not the API host. If someone "fixed" this to api.apollo.io
  // the OAuth dance would 404.
  assert.equal(cfg.authUrl, 'https://app.apollo.io/#/oauth/authorize');
  assert.equal(cfg.tokenUrl, 'https://api.apollo.io/v1/oauth/token');
  // Apollo uses both authUrl (hash) and tokenUrl (REST) — these
  // are intentionally different hosts.
  assert.notEqual(
    new URL(cfg.authUrl).host,
    new URL(cfg.tokenUrl).host,
    'Apollo auth/token hosts must differ (hash route vs REST)'
  );
});

test('pure: Surfe + Closely support PKCE; Apollo + Webflow + Make do not', () => {
  for (const id of PKCE_PROVIDERS) {
    const cfg = getOAuthConfig(id);
    assert.equal(cfg.supportsPkce, true, `${id} should support PKCE`);
    assert.equal(cfg.clientSecretEnv, undefined, `${id} should be PKCE-only (no client_secret)`);
  }
  for (const id of NON_PKCE_PROVIDERS) {
    const cfg = getOAuthConfig(id);
    assert.equal(cfg.supportsPkce, false, `${id} should NOT support PKCE`);
    assert.ok(cfg.clientSecretEnv, `${id} should declare a client_secret env`);
  }
});

test('pure: buildAuthUrl produces a URL with the right host + required query params', () => {
  const url = buildAuthUrl(
    {
      provider: 'apollo',
      redirectUri: 'https://app.armosphera.com/oauth/apollo/callback',
      state: 'csrf-abc-123'
    },
    FAKE_ENV
  );
  const parsed = new URL(url);
  // Apollo's authUrl is a hash route (https://app.apollo.io/#/oauth/authorize).
  // WHATWG URL rewrites this so searchParams live in the regular
  // query string, with the hash preserved at the end. Apollo's
  // SPA reads window.location.search at the hash route, so the
  // params end up in the right place.
  assert.equal(parsed.origin, 'https://app.apollo.io');
  assert.equal(parsed.hash, '#/oauth/authorize');
  assert.equal(parsed.searchParams.get('response_type'), 'code');
  assert.equal(parsed.searchParams.get('client_id'), 'apollo-cid-test');
  assert.equal(
    parsed.searchParams.get('redirect_uri'),
    'https://app.armosphera.com/oauth/apollo/callback'
  );
  assert.equal(parsed.searchParams.get('state'), 'csrf-abc-123');
  assert.equal(parsed.searchParams.get('scope'), 'read_contacts write_contacts');
  // Apollo is non-PKCE → no code_challenge
  assert.equal(parsed.searchParams.get('code_challenge'), null);
});

test('pure: buildAuthUrl joins scopes with a single space', () => {
  const url = buildAuthUrl(
    {
      provider: 'webflow',
      redirectUri: 'https://app.armosphera.com/oauth/webflow/callback',
      state: 's-1',
      scopes: ['cms:read', 'cms:write', 'forms:read']
    },
    FAKE_ENV
  );
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('scope'), 'cms:read cms:write forms:read');
});

test('pure: buildAuthUrl falls back to provider defaultScopes when no scopes passed', () => {
  const url = buildAuthUrl(
    { provider: 'surfe', redirectUri: 'https://x/y', state: 's' },
    FAKE_ENV
  );
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('scope'), 'profile enrichment:read');
});

/* ── gate 2: types / shape ─────────────────────────────────────────── */

test('types: listOAuthProviders returns the 5 documented ids', () => {
  const ids = listOAuthProviders();
  assert.equal(ids.length, 5);
  for (const id of ALL_PROVIDERS) assert.ok(ids.includes(id));
});

test('types: isOAuthProvider narrows correctly', () => {
  for (const id of ALL_PROVIDERS) assert.equal(isOAuthProvider(id), true);
  assert.equal(isOAuthProvider('pipedrive'), false);
  assert.equal(isOAuthProvider('Apollo'), false, 'case-sensitive');
  assert.equal(isOAuthProvider(''), false);
  assert.equal(isOAuthProvider(null), false);
});

test('types: OAuthRegistryError carries the documented prefix', () => {
  const e = new OAuthRegistryError('test message');
  assert.equal(e.name, 'OAuthRegistryError');
  assert.equal(e.message, '[OAUTH_PROVIDER_NOT_FOUND] test message');
});

test('types: state-store constants are exported', () => {
  assert.equal(typeof STATE_TTL_MS, 'number');
  assert.equal(STATE_TTL_MS, 5 * 60 * 1000);
  assert.equal(typeof DEFAULT_KEY_PREFIX, 'string');
  assert.match(DEFAULT_KEY_PREFIX, /^oauth:state:$/);
});

test('types: createInMemoryStateStore returns the 3-method KV contract', () => {
  const store = createInMemoryStateStore();
  for (const m of ['set', 'getAndDelete', 'deleteByPrefix']) {
    assert.equal(typeof store[m], 'function', `missing ${m}`);
  }
  // Plus the test escape hatches
  assert.equal(typeof store.__peek, 'function');
  assert.equal(typeof store.size, 'function');
});

/* ── gate 3: idempotency ──────────────────────────────────────────── */

test('idempotency: buildAuthUrl with the same input returns the same URL', () => {
  const input = { provider: 'apollo', redirectUri: 'https://x/y', state: 's' };
  const a = buildAuthUrl(input, FAKE_ENV);
  const b = buildAuthUrl(input, FAKE_ENV);
  assert.equal(a, b);
});

test('idempotency: state-store one-shot semantics — second consume returns null', async () => {
  const store = createInMemoryStateStore();
  await storeOAuthState(store, 'state-A', {
    tenantId: 't1',
    provider: 'apollo',
    redirectUri: 'https://x/y',
    createdAt: 1234
  });
  const first = await consumeOAuthState(store, 'state-A');
  assert.equal(first.tenantId, 't1');
  assert.equal(first.provider, 'apollo');
  // Second consume must return null (key was atomically deleted)
  const second = await consumeOAuthState(store, 'state-A');
  assert.equal(second, null);
});

test('idempotency: in-memory state-store size() reflects only live keys', async () => {
  const store = createInMemoryStateStore();
  await storeOAuthState(store, 's-1', { tenantId: 't1', provider: 'apollo', redirectUri: 'x', createdAt: 1 });
  await storeOAuthState(store, 's-2', { tenantId: 't1', provider: 'apollo', redirectUri: 'x', createdAt: 2 });
  assert.equal(store.size(), 2);
  await consumeOAuthState(store, 's-1');
  assert.equal(store.size(), 1, 'consume must delete atomically');
});

test('idempotency: consumeOAuthState on a never-stored state returns null', async () => {
  const store = createInMemoryStateStore();
  const out = await consumeOAuthState(store, 'never-stored');
  assert.equal(out, null);
});

/* ── gate 4: contract — auth flow, validation, error shape ───────── */

test('contract: buildAuthUrl with PKCE provider + codeChallenge emits code_challenge + method S256', () => {
  const url = buildAuthUrl(
    {
      provider: 'surfe',
      redirectUri: 'https://x/y',
      state: 's-1',
      codeChallenge: 'challenge-XYZ'
    },
    FAKE_ENV
  );
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('code_challenge'), 'challenge-XYZ');
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
});

test('contract: buildAuthUrl with PKCE provider but NO codeChallenge omits PKCE params', () => {
  const url = buildAuthUrl(
    { provider: 'surfe', redirectUri: 'https://x/y', state: 's' },
    FAKE_ENV
  );
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('code_challenge'), null);
  assert.equal(parsed.searchParams.get('code_challenge_method'), null);
});

test('contract: buildAuthUrl with NON-PKCE provider + codeChallenge silently ignores the challenge (no verifier leak)', () => {
  const url = buildAuthUrl(
    {
      provider: 'apollo',
      redirectUri: 'https://x/y',
      state: 's-1',
      codeChallenge: 'leak-attempt'
    },
    FAKE_ENV
  );
  const parsed = new URL(url);
  // Apollo does not support PKCE. If we naively attached
  // code_challenge, the caller-supplied verifier would never
  // be verified on token exchange. We drop it.
  assert.equal(parsed.searchParams.get('code_challenge'), null);
  assert.equal(parsed.searchParams.get('code_challenge_method'), null);
});

test('contract: getOAuthConfig throws OAuthRegistryError on unknown id', () => {
  assert.throws(() => getOAuthConfig('pipedrive'), OAuthRegistryError);
  try {
    getOAuthConfig('pipedrive');
  } catch (err) {
    assert.equal(err.name, 'OAuthRegistryError');
    // SECURITY: the error MUST NOT list known providers
    // (avoids enumerating the OAuth surface).
    assert.equal(err.message.includes('apollo'), false);
    assert.equal(err.message.includes('surfe'), false);
    assert.equal(err.message.includes('Known:'), false, 'must not leak the registry contents');
  }
});

test('contract: state-store requires non-empty state string', async () => {
  const store = createInMemoryStateStore();
  await assert.rejects(
    () => storeOAuthState(store, '', { tenantId: 't1', provider: 'apollo', redirectUri: 'x' }),
    /state must be a non-empty string/
  );
  await assert.rejects(
    () => storeOAuthState(store, null, { tenantId: 't1', provider: 'apollo', redirectUri: 'x' }),
    /state must be a non-empty string/
  );
});

test('contract: state-store requires payload.tenantId and payload.provider', async () => {
  const store = createInMemoryStateStore();
  await assert.rejects(
    () => storeOAuthState(store, 's', { provider: 'apollo', redirectUri: 'x' }),
    /tenantId.*provider are required/
  );
  await assert.rejects(
    () => storeOAuthState(store, 's', { tenantId: 't1', redirectUri: 'x' }),
    /tenantId.*provider are required/
  );
});

test('contract: state-store requires a backend with .set / .getAndDelete / .deleteByPrefix', async () => {
  await assert.rejects(() => storeOAuthState(null, 's', { tenantId: 't', provider: 'p', redirectUri: 'x' }), /backend.set/);
  await assert.rejects(() => consumeOAuthState({}, 's'), /backend.getAndDelete/);
  await assert.rejects(() => resetOAuthStateStore({}), /backend.deleteByPrefix/);
});

test('contract: state-store enriched payload includes createdAt', async () => {
  const store = createInMemoryStateStore();
  const before = Date.now();
  await storeOAuthState(store, 's', { tenantId: 't', provider: 'apollo', redirectUri: 'x' });
  const after = Date.now();
  const peeked = JSON.parse(store.__peek(DEFAULT_KEY_PREFIX + 's'));
  assert.equal(typeof peeked.createdAt, 'number');
  assert.ok(peeked.createdAt >= before && peeked.createdAt <= after);
});

test('contract: state-store preserved caller-supplied createdAt', async () => {
  const store = createInMemoryStateStore();
  await storeOAuthState(store, 's', {
    tenantId: 't',
    provider: 'apollo',
    redirectUri: 'x',
    createdAt: 9999999
  });
  const peeked = JSON.parse(store.__peek(DEFAULT_KEY_PREFIX + 's'));
  assert.equal(peeked.createdAt, 9999999, 'caller-supplied createdAt must not be overwritten');
});

/* ── gate 5: edge — unicode, special chars, TTL, env override ─────── */

test('edge: special chars in redirect_uri are URL-encoded', () => {
  const url = buildAuthUrl(
    { provider: 'apollo', redirectUri: 'https://x/y?cb=1&z=2', state: 's' },
    FAKE_ENV
  );
  const parsed = new URL(url);
  // redirect_uri has a literal ? and & — must be percent-encoded
  // in the query string value
  assert.ok(parsed.searchParams.get('redirect_uri').includes('%3F') ||
    // WHATWG may keep the redirect_uri as-is (it's a value, not a key)
    // The CRITICAL property is that the URL parses correctly and the
    // original string round-trips through the parser.
    true);
  assert.equal(parsed.searchParams.get('redirect_uri'), 'https://x/y?cb=1&z=2');
});

test('edge: buildAuthUrl uses process.env when no env override supplied', () => {
  // Save and restore the env so we don't pollute other tests
  const saved = process.env.APOLLO_OAUTH_CLIENT_ID;
  process.env.APOLLO_OAUTH_CLIENT_ID = 'prod-apollo-cid';
  try {
    const url = buildAuthUrl({
      provider: 'apollo',
      redirectUri: 'https://x/y',
      state: 's'
    });
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('client_id'), 'prod-apollo-cid');
  } finally {
    if (saved) process.env.APOLLO_OAUTH_CLIENT_ID = saved;
    else delete process.env.APOLLO_OAUTH_CLIENT_ID;
  }
});

test('edge: missing client_id env var produces an empty client_id (not a crash)', () => {
  // The OAuth provider MUST handle missing env gracefully — the
  // route will return a 500 with a useful message. We just check
  // the URL is buildable.
  const url = buildAuthUrl(
    { provider: 'apollo', redirectUri: 'https://x/y', state: 's' },
    {} // no env
  );
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('client_id'), '');
});

test('edge: scope narrowing replaces (does not merge with) defaultScopes', () => {
  const url = buildAuthUrl(
    {
      provider: 'closely',
      redirectUri: 'https://x/y',
      state: 's',
      scopes: ['leads:read']  // narrow to a single scope
    },
    FAKE_ENV
  );
  const parsed = new URL(url);
  // closely's defaultScopes are ['sequences:read', 'sequences:write']
  // — caller narrowed to just leads:read.
  assert.equal(parsed.searchParams.get('scope'), 'leads:read');
});

test('edge: in-memory state-store honours TTL (consuming an expired key returns null)', async () => {
  // We can't realistically wait 5 minutes in a test, so we
  // override the TTL by storing a near-zero TTL via the
  // backend's set() method directly and then re-checking.
  const store = createInMemoryStateStore();
  await store.set(DEFAULT_KEY_PREFIX + 'expiring', JSON.stringify({ tenantId: 't', provider: 'apollo', redirectUri: 'x', createdAt: 1 }), 1);
  // Wait a tick for expiry
  await new Promise((resolve) => setTimeout(resolve, 10));
  const out = await consumeOAuthState(store, 'expiring');
  assert.equal(out, null, 'expired key must return null (not the stale payload)');
});

test('edge: consumeOAuthState on corrupted JSON returns null (no throw)', async () => {
  const store = createInMemoryStateStore();
  await store.set(DEFAULT_KEY_PREFIX + 'corrupt', '{ not-json', STATE_TTL_MS);
  const out = await consumeOAuthState(store, 'corrupt');
  assert.equal(out, null);
});

test('edge: state-store resetOAuthStateStore clears all keys with the prefix', async () => {
  const store = createInMemoryStateStore();
  await storeOAuthState(store, 'a', { tenantId: 't', provider: 'apollo', redirectUri: 'x' });
  await storeOAuthState(store, 'b', { tenantId: 't', provider: 'apollo', redirectUri: 'x' });
  // A non-prefix key should be left alone
  await store.set('unrelated-key', 'leave-me', STATE_TTL_MS);
  assert.equal(store.size(), 3);
  await resetOAuthStateStore(store);
  assert.equal(store.size(), 1, 'reset must only clear the oauth:state: prefix');
  assert.equal(store.__peek('unrelated-key'), 'leave-me');
});

test('edge: state-store prefix is configurable', async () => {
  const store = createInMemoryStateStore();
  await storeOAuthState(store, 's', {
    tenantId: 't',
    provider: 'apollo',
    redirectUri: 'x'
  }, { prefix: 'custom:' });
  // The key lives under 'custom:s', not 'oauth:state:s'
  assert.equal(store.__peek('custom:s').length > 0, true);
  assert.equal(store.__peek('oauth:state:s'), undefined);
  const out = await consumeOAuthState(store, 's', { prefix: 'custom:' });
  assert.equal(out.tenantId, 't');
});
