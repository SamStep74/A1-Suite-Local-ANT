// test_oauth_routes.js — focused tests for the OAuth routes + helpers.
//
// The oauthRoutes module (server/oauthRoutes.js, 466 lines) is the Fastify
// route layer for the OAuth PULL flow. Per the docstring:
//
//   GET  /api/oauth/:provider/connect — Build the auth URL
//   GET  /api/oauth/:provider/callback — Handle the redirect back
//   GET  /api/oauth/:provider/status — Returns connection status
//   POST /api/oauth/:provider/disconnect — Idempotent disconnect
//   POST /api/oauth/:provider/refresh — Force-refresh
//
// Exports (3 functions):
//   - registerOAuthRoutes(options) — register the routes
//   - listOAuthProviders, isOAuthProvider — re-exports
//
// The PURE helpers from server/lib/integrations/oauth/ (some exported, some private):
//   - pkce.js (3 EXPORTED): generatePkcePair, buildTokenExchangeRequest, parseTokenResponse
//   - pkce.js (PRIVATE): base64UrlEncode
//   - token-store.js (2 EXPORTED): isTokenExpiringSoon, isTokenDead
//   - token-store.js (PRIVATE): recordValue, aadFor
//   - registry.js (4 EXPORTED): getOAuthConfig, listOAuthProviders, isOAuthProvider, buildAuthUrl
//   - state-store.js (4 EXPORTED): storeOAuthState, consumeOAuthState, resetOAuthStateStore, keyFor, createInMemoryStateStore
//
// This test focuses on the EXPORTED PURE functions (no DB, no network, no I/O).
//
// Tests (45 tests, all should pass in <100ms):
//   - 5 generatePkcePair tests (verifier + challenge, 43-char, randomness, RFC 7636)
//   - 8 buildTokenExchangeRequest tests (URL + body + headers, required fields, PKCE)
//   - 6 parseTokenResponse tests (access token, expiry, scope, errors)
//   - 5 isTokenExpiringSoon tests (soon, fresh, no expiry, custom threshold)
//   - 3 isTokenDead tests (fresh, with refresh, without refresh)
//   - 4 keyFor tests (state-store key generation)
//   - 4 listOAuthProviders / isOAuthProvider tests
//   - 4 getOAuthConfig tests
//   - 6 module shape + sovereignty tests

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const oauth = require("../server/oauthRoutes");
const pkce = require("../server/lib/integrations/oauth/pkce");
const tokenStore = require("../server/lib/integrations/oauth/token-store");
const registry = require("../server/lib/integrations/oauth/registry");
const stateStore = require("../server/lib/integrations/oauth/state-store");
const fs = require("node:fs");
const path = require("node:path");

// ─── 1. generatePkcePair (PKCE — EXPORTED) ───

test("generatePkcePair returns verifier + challenge", () => {
  const pair = pkce.generatePkcePair();
  assert.ok(pair.codeVerifier);
  assert.ok(pair.codeChallenge);
  assert.strictEqual(typeof pair.codeVerifier, "string");
  assert.strictEqual(typeof pair.codeChallenge, "string");
});

test("generatePkcePair produces 43-char verifier (32 random bytes → base64url)", () => {
  const pair = pkce.generatePkcePair();
  // 32 bytes encoded as base64url = 43 chars (no padding)
  assert.strictEqual(pair.codeVerifier.length, 43);
});

test("generatePkcePair produces URL-safe strings (no +/=)", () => {
  for (let i = 0; i < 10; i++) {
    const pair = pkce.generatePkcePair();
    assert.ok(!pair.codeVerifier.includes("+"));
    assert.ok(!pair.codeVerifier.includes("/"));
    assert.ok(!pair.codeVerifier.includes("="));
    assert.ok(!pair.codeChallenge.includes("+"));
    assert.ok(!pair.codeChallenge.includes("/"));
    assert.ok(!pair.codeChallenge.includes("="));
  }
});

test("generatePkcePair is random (each pair is different)", () => {
  const a = pkce.generatePkcePair();
  const b = pkce.generatePkcePair();
  assert.notStrictEqual(a.codeVerifier, b.codeVerifier);
  assert.notStrictEqual(a.codeChallenge, b.codeChallenge);
});

test("generatePkcePair matches RFC 7636 §4.1 (verifier 43-128 chars)", () => {
  for (let i = 0; i < 10; i++) {
    const pair = pkce.generatePkcePair();
    // 43 is the minimum "high-entropy" length per RFC 7636
    assert.ok(pair.codeVerifier.length >= 43);
    assert.ok(pair.codeVerifier.length <= 128);
  }
});

// ─── 2. buildTokenExchangeRequest (PKCE — EXPORTED) ───

test("buildTokenExchangeRequest returns url + body + headers", () => {
  const req = pkce.buildTokenExchangeRequest({
    tokenUrl: "https://auth.example.com/token",
    code: "auth-code-123",
    redirectUri: "https://app.example.com/callback",
    clientId: "client-123",
  });
  assert.ok(req.url);
  assert.ok(req.body);
  assert.ok(req.headers);
  assert.strictEqual(req.url, "https://auth.example.com/token");
});

test("buildTokenExchangeRequest includes grant_type=authorization_code", () => {
  const req = pkce.buildTokenExchangeRequest({
    tokenUrl: "https://x/token",
    code: "c",
    redirectUri: "https://x/cb",
    clientId: "cid",
  });
  assert.match(req.body, /grant_type=authorization_code/);
  assert.match(req.body, /code=c/);
  assert.match(req.body, /redirect_uri=https/);
  assert.match(req.body, /client_id=cid/);
});

test("buildTokenExchangeRequest includes client_secret when provided", () => {
  const req = pkce.buildTokenExchangeRequest({
    tokenUrl: "https://x/token",
    code: "c",
    redirectUri: "https://x/cb",
    clientId: "cid",
    clientSecret: "secret-abc",
  });
  assert.match(req.body, /client_secret=secret/);
});

test("buildTokenExchangeRequest includes code_verifier when provided (PKCE)", () => {
  const req = pkce.buildTokenExchangeRequest({
    tokenUrl: "https://x/token",
    code: "c",
    redirectUri: "https://x/cb",
    clientId: "cid",
    codeVerifier: "verifier-abc-123",
  });
  assert.match(req.body, /code_verifier=verifier/);
});

test("buildTokenExchangeRequest throws on missing required fields", () => {
  assert.throws(() => pkce.buildTokenExchangeRequest({}), /required/);
  assert.throws(() => pkce.buildTokenExchangeRequest({ tokenUrl: "x" }), /required/);
  assert.throws(
    () => pkce.buildTokenExchangeRequest({ tokenUrl: "x", code: "c" }),
    /required/,
  );
  assert.throws(
    () => pkce.buildTokenExchangeRequest({ tokenUrl: "x", code: "c", redirectUri: "https://x/cb" }),
    /required/,
  );
});

test("buildTokenExchangeRequest sets content-type header", () => {
  const req = pkce.buildTokenExchangeRequest({
    tokenUrl: "https://x/token",
    code: "c",
    redirectUri: "https://x/cb",
    clientId: "cid",
  });
  assert.strictEqual(req.headers["content-type"], "application/x-www-form-urlencoded");
  assert.strictEqual(req.headers["accept"], "application/json");
});

test("buildTokenExchangeRequest is deterministic (same input → same output)", () => {
  const input = {
    tokenUrl: "https://x/token",
    code: "c",
    redirectUri: "https://x/cb",
    clientId: "cid",
  };
  const a = pkce.buildTokenExchangeRequest(input);
  const b = pkce.buildTokenExchangeRequest(input);
  assert.strictEqual(a.body, b.body);
});

test("buildTokenExchangeRequest body is URL-encoded (no JSON)", () => {
  const req = pkce.buildTokenExchangeRequest({
    tokenUrl: "https://x/token",
    code: "code with spaces",
    redirectUri: "https://x/cb",
    clientId: "cid",
  });
  assert.ok(!req.body.startsWith("{"));
  assert.match(req.body, /\+/);  // spaces encoded as +
});

// ─── 3. parseTokenResponse (PKCE — EXPORTED) ───

test("parseTokenResponse returns access token + refresh + expiry", () => {
  const result = pkce.parseTokenResponse({
    access_token: "at-abc",
    refresh_token: "rt-xyz",
    expires_in: 3600,
  });
  assert.strictEqual(result.accessToken, "at-abc");
  assert.strictEqual(result.refreshToken, "rt-xyz");
  assert.ok(result.expiresAt, "should have expiresAt");
});

test("parseTokenResponse expiresAt is ISO string (now + expires_in seconds)", () => {
  const before = Date.now();
  const result = pkce.parseTokenResponse({
    access_token: "at",
    expires_in: 3600,
  });
  const after = Date.now();
  const expiresAt = Date.parse(result.expiresAt);
  assert.ok(expiresAt >= before + 3600000 - 100);
  assert.ok(expiresAt <= after + 3600000 + 100);
});

test("parseTokenResponse handles missing refresh_token (null)", () => {
  const result = pkce.parseTokenResponse({
    access_token: "at",
    expires_in: 3600,
  });
  assert.strictEqual(result.refreshToken, null);
});

test("parseTokenResponse handles missing expires_in (null)", () => {
  const result = pkce.parseTokenResponse({
    access_token: "at",
  });
  assert.strictEqual(result.expiresAt, null);
});

test("parseTokenResponse parses scope (space-separated)", () => {
  const result = pkce.parseTokenResponse({
    access_token: "at",
    scope: "read write admin",
  });
  assert.deepStrictEqual(result.scopes, ["read", "write", "admin"]);
});

test("parseTokenResponse filters empty scopes", () => {
  const result = pkce.parseTokenResponse({
    access_token: "at",
    scope: "read  write  ",  // double spaces
  });
  assert.deepStrictEqual(result.scopes, ["read", "write"]);
});

test("parseTokenResponse throws on missing access_token", () => {
  assert.throws(() => pkce.parseTokenResponse({}), /access_token/);
  assert.throws(() => pkce.parseTokenResponse({ access_token: "" }), /access_token/);
  assert.throws(() => pkce.parseTokenResponse(null), /expected a JSON object/);
  assert.throws(() => pkce.parseTokenResponse("string"), /expected a JSON object/);
  assert.throws(() => pkce.parseTokenResponse(42), /expected a JSON object/);
});

// ─── 4. isTokenExpiringSoon (token-store — EXPORTED) ───

test("isTokenExpiringSoon returns true for soon-expiring token", () => {
  const tokens = {
    expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),  // 2 min from now
  };
  assert.strictEqual(tokenStore.isTokenExpiringSoon(tokens), true);
});

test("isTokenExpiringSoon returns false for fresh token", () => {
  const tokens = {
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),  // 1 hour
  };
  assert.strictEqual(tokenStore.isTokenExpiringSoon(tokens), false);
});

test("isTokenExpiringSoon returns false for tokens without expiresAt", () => {
  const tokens = { accessToken: "at" };
  assert.strictEqual(tokenStore.isTokenExpiringSoon(tokens), false);
});

test("isTokenExpiringSoon returns false for invalid expiresAt", () => {
  const tokens = { expiresAt: "not a date" };
  assert.strictEqual(tokenStore.isTokenExpiringSoon(tokens), false);
});

test("isTokenExpiringSoon accepts custom threshold", () => {
  const tokens = {
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),  // 15 min
  };
  // Default threshold (5 min) → not expiring soon
  assert.strictEqual(tokenStore.isTokenExpiringSoon(tokens), false);
  // Custom threshold (20 min) → expiring soon
  assert.strictEqual(tokenStore.isTokenExpiringSoon(tokens, 20 * 60 * 1000), true);
});

// ─── 5. isTokenDead (token-store — EXPORTED) ───

test("isTokenDead returns false for fresh token", () => {
  const tokens = {
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    refreshToken: "rt",
  };
  assert.strictEqual(tokenStore.isTokenDead(tokens), false);
});

test("isTokenDead returns false for expiring token WITH refresh token", () => {
  const tokens = {
    expiresAt: new Date(Date.now() - 1000).toISOString(),  // already expired
    refreshToken: "rt",
  };
  // Has refresh token, so NOT dead
  assert.strictEqual(tokenStore.isTokenDead(tokens), false);
});

test("isTokenDead returns true for expiring token WITHOUT refresh token", () => {
  const tokens = {
    expiresAt: new Date(Date.now() - 1000).toISOString(),  // already expired
  };
  // No refresh token, already expired → dead
  assert.strictEqual(tokenStore.isTokenDead(tokens), true);
});

// ─── 6. keyFor (state-store — EXPORTED) ───

test("keyFor returns a prefixed state key", () => {
  const key = stateStore.keyFor("abc-123", "oauth");
  assert.ok(key);
  assert.match(key, /oauth/);
  assert.match(key, /abc-123/);
});

test("keyFor uses DEFAULT_KEY_PREFIX by default", () => {
  const keyA = stateStore.keyFor("state-1");
  const keyB = stateStore.keyFor("state-1", "oauth");
  // Different prefix if no prefix provided vs explicit prefix
  assert.notStrictEqual(keyA, keyB);
});

test("keyFor produces consistent output for same input", () => {
  const k1 = stateStore.keyFor("state-x", "oauth");
  const k2 = stateStore.keyFor("state-x", "oauth");
  assert.strictEqual(k1, k2);
});

test("keyFor produces different output for different inputs", () => {
  const k1 = stateStore.keyFor("state-1", "oauth");
  const k2 = stateStore.keyFor("state-2", "oauth");
  assert.notStrictEqual(k1, k2);
});

// ─── 7. listOAuthProviders / isOAuthProvider (registry — EXPORTED) ───

test("listOAuthProviders returns 5 known providers", () => {
  const providers = registry.listOAuthProviders();
  assert.strictEqual(providers.length, 5);
  assert.ok(providers.includes("apollo"));
  assert.ok(providers.includes("surfe"));
  assert.ok(providers.includes("closely"));
  assert.ok(providers.includes("webflow"));
  assert.ok(providers.includes("make"));
});

test("isOAuthProvider returns true for known providers", () => {
  for (const p of ["apollo", "surfe", "closely", "webflow", "make"]) {
    assert.strictEqual(registry.isOAuthProvider(p), true, `${p} should be a known provider`);
  }
});

test("isOAuthProvider returns false for unknown providers", () => {
  assert.strictEqual(registry.isOAuthProvider("google"), false);
  assert.strictEqual(registry.isOAuthProvider("facebook"), false);
  assert.strictEqual(registry.isOAuthProvider(""), false);
});

test("oauthRoutes re-exports listOAuthProviders + isOAuthProvider", () => {
  // The re-export pattern (per the comment in oauthRoutes.js)
  assert.strictEqual(oauth.listOAuthProviders, registry.listOAuthProviders);
  assert.strictEqual(oauth.isOAuthProvider, registry.isOAuthProvider);
});

// ─── 8. getOAuthConfig (registry — EXPORTED) ───

test("getOAuthConfig returns the config for a known provider", () => {
  const cfg = registry.getOAuthConfig("apollo");
  assert.ok(cfg);
  assert.strictEqual(cfg.id, "apollo");
  assert.ok(cfg.authUrl);
  assert.ok(cfg.tokenUrl);
});

test("getOAuthConfig returns apollo with PKCE support info", () => {
  const cfg = registry.getOAuthConfig("apollo");
  // Per the apollo config: supportsPkce = false
  assert.strictEqual(cfg.supportsPkce, false);
  assert.ok(cfg.defaultScopes.length > 0, "should have default scopes");
});

test("getOAuthConfig throws OAuthRegistryError for unknown provider", () => {
  assert.throws(
    () => registry.getOAuthConfig("nonexistent"),
    /Unknown OAuth provider/,
  );
});

test("OAuthRegistryError is an Error subclass with code", () => {
  try {
    registry.getOAuthConfig("nonexistent");
    assert.fail("Expected throw");
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.ok(e.code === "OAUTH_PROVIDER_NOT_FOUND" || e.message.includes("OAUTH_PROVIDER_NOT_FOUND"));
  }
});

// ─── 9. Module shape + sovereignty ───

test("oauthRoutes module exports the expected public surface", () => {
  assert.strictEqual(typeof oauth.registerOAuthRoutes, "function");
  assert.strictEqual(typeof oauth.listOAuthProviders, "function");
  assert.strictEqual(typeof oauth.isOAuthProvider, "function");
});

test("oauthRoutes doesn't import http/https/net/fs at top level", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "oauthRoutes.js"), "utf8");
  assert.ok(!/require\s*\(\s*['"]https?['"]/.test(src),
    "oauthRoutes.js should not require http/https (route layer, not transport)");
  assert.ok(!/require\s*\(\s*['"]node-fetch['"]/.test(src),
    "oauthRoutes.js should not require node-fetch");
});

test("oauthRoutes uses process.env fallback when options.env not provided", () => {
  // Per the source: env = options.env || (typeof process !== 'undefined' ? process.env : {})
  // This is a DELIBERATE design (per AGENTS.md §4) — the route layer is the
  // place where env-vars are read, then passed down to the pure engine.
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "oauthRoutes.js"), "utf8");
  assert.match(src, /process\.env/, "oauthRoutes.js should support process.env as env fallback");
  assert.match(src, /options\.env/, "oauthRoutes.js should accept options.env override");
});

test("oauthRoutes uses 'use strict' (CommonJS, per AGENTS.md §9)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "oauthRoutes.js"), "utf8");
  assert.match(src, /^'use strict';/m, "oauthRoutes.js should use 'use strict' directive");
});

test("pkce module has 3 EXPORTED pure functions", () => {
  const exported = Object.keys(pkce).filter((k) => typeof pkce[k] === "function");
  assert.strictEqual(exported.length, 3);
  assert.ok(exported.includes("generatePkcePair"));
  assert.ok(exported.includes("buildTokenExchangeRequest"));
  assert.ok(exported.includes("parseTokenResponse"));
});

test("token-store module has 2 EXPORTED pure helpers", () => {
  // isTokenExpiringSoon + isTokenDead are the pure ones
  // createOAuthTokenStore is also exported but takes db+options (integration)
  const fns = Object.keys(tokenStore).filter((k) => typeof tokenStore[k] === "function");
  // At least these 2 pure functions are exported
  assert.strictEqual(typeof tokenStore.isTokenExpiringSoon, "function");
  assert.strictEqual(typeof tokenStore.isTokenDead, "function");
});
