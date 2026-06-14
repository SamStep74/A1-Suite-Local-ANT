/**
 * oauth/pkce — PKCE code-verifier / code-challenge generator
 * (RFC 7636 §4.1, S256 only).
 *
 * Two helpers:
 *   generatePkcePair()  → { codeVerifier, codeChallenge }
 *     - codeVerifier  : 43–128 char URL-safe string
 *     - codeChallenge : base64url(sha256(codeVerifier))
 *
 *   buildTokenExchangeBody({ tokenUrl, code, codeVerifier, clientId, clientSecret, redirectUri })
 *     → { url, body }  for the standard OAuth code-exchange POST.
 *
 * Pure: no I/O, no DB.
 */
'use strict';

const crypto = require('node:crypto');

function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}

/**
 * @returns {{ codeVerifier: string, codeChallenge: string }}
 */
function generatePkcePair() {
  // 32 random bytes → 43-char base64url. RFC 7636 §4.1 allows
  // 43-128 chars; 43 is the shortest "high-entropy" length.
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
  const codeChallenge = base64UrlEncode(
    crypto.createHash('sha256').update(codeVerifier).digest()
  );
  return { codeVerifier, codeChallenge };
}

/**
 * @typedef {Object} TokenExchangeInput
 * @property {string} tokenUrl
 * @property {string} code
 * @property {string} redirectUri
 * @property {string} clientId
 * @property {string} [clientSecret]
 * @property {string} [codeVerifier]  PKCE — public clients only
 */

/**
 * @param {TokenExchangeInput} input
 * @returns {{ url: string, body: string, headers: Record<string,string> }}
 */
function buildTokenExchangeRequest(input) {
  if (!input || !input.tokenUrl || !input.code || !input.redirectUri || !input.clientId) {
    throw new Error('buildTokenExchangeRequest: tokenUrl, code, redirectUri, clientId are required');
  }
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId
  });
  if (input.clientSecret) params.set('client_secret', input.clientSecret);
  if (input.codeVerifier) params.set('code_verifier', input.codeVerifier);
  return {
    url: input.tokenUrl,
    body: params.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json'
    }
  };
}

/**
 * Parse the OAuth token-endpoint response. Tolerates the
 * documented response shape (RFC 6749 §5.1):
 *   {
 *     access_token, token_type, expires_in, refresh_token?, scope?
 *   }
 *
 * @param {unknown} value
 * @returns {{
 *   accessToken: string, refreshToken: string|null,
 *   expiresAt: string|null, scopes: string[]
 * }}
 */
function parseTokenResponse(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('parseTokenResponse: expected a JSON object');
  }
  const obj = /** @type {any} */ (value);
  if (typeof obj.access_token !== 'string' || obj.access_token.length === 0) {
    throw new Error('parseTokenResponse: missing access_token');
  }
  const expiresAt = typeof obj.expires_in === 'number'
    ? new Date(Date.now() + obj.expires_in * 1000).toISOString()
    : null;
  const scopes = typeof obj.scope === 'string' && obj.scope.length > 0
    ? obj.scope.split(' ').filter((s) => s.length > 0)
    : [];
  return {
    accessToken: obj.access_token,
    refreshToken: typeof obj.refresh_token === 'string' ? obj.refresh_token : null,
    expiresAt,
    scopes
  };
}

module.exports = {
  generatePkcePair,
  buildTokenExchangeRequest,
  parseTokenResponse
};
