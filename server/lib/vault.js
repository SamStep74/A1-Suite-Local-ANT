/**
 * vault — Pattern A port of A1-SMB-CRM-HY-MAX/src/lib/vault.ts
 * (216 lines). AES-256-GCM vault for sensitive JSON fields
 * (e.g. integration config blobs).
 *
 * Source mapping:
 *   A1-Platform env import (development/test check) → injected
 *     via `createVault({ env, kekBase64, now, randomBytes })`.
 *     The caller (typically `lib/integrations/config-vault.js`)
 *     decides how to read KEK from the runtime.
 *   Pure functions (encryptString/decryptString/etc.) are
 *     unchanged. AAD binding + version envelope + defaults
 *     for "known secret fields" are preserved verbatim.
 *
 * Public surface:
 *   createVault(options) → {
 *     encryptString(plain, opts)
 *     decryptString(packed, opts)
 *     encryptJSON(value, opts)
 *     decryptJSON(packed, opts)
 *     encryptConfigSecrets(config, fields, opts)
 *     decryptConfigSecrets(config, fields, opts)
 *     isVaultPacked(value)
 *   }
 *   plus the pure helpers (pack, unpack, derivePurposeKey) for
 *   tests + advanced callers.
 *
 *   Pure helpers (no I/O, no global state):
 *     pack(version, iv, tag, ct, aad?)  → string
 *     unpack(packed)  → { version, aad, iv, tag, ct }
 *     isVaultPacked(value)  → boolean
 *     parsePackedEnvelope(packed)  → { version, aad }
 *
 * Threat model (preserved from source):
 *   - DB snapshot leak (someone gets an SQLite dump).
 *   - DB read access by an operator that shouldn't see plaintext.
 *   NOT in scope: in-transit encryption (use TLS), insider with
 *   code-exec (then they can read the env).
 */
'use strict';

const { createCipheriv, createDecipheriv, hkdfSync, randomBytes } = require('node:crypto');

const VAULT_VERSION = 1;
const VAULT_PURPOSE = 'a1-crm/integration-config/v1';
const DEV_KEK_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const DEFAULT_ENCRYPTED_FIELDS = Object.freeze([
  'apiKey',
  'signingSecret',
  'accessToken',
  'refreshToken',
  'clientSecret',
  'webhookSecret'
]);

/* ── errors ─────────────────────────────────────────────────────────── */

class VaultError extends Error {
  constructor(code, message, options = {}) {
    super(`[${code}] ${message}`);
    this.name = 'VaultError';
    this.code = code;
    if (options.cause) this.cause = options.cause;
  }
}

/* ── pure helpers ──────────────────────────────────────────────────── */

/** Packed envelope: `v<version>.<aad_or_dash>.<iv_b64>.<tag_b64>.<ct_b64>`. */
function pack(version, iv, tag, ct, aad) {
  return [
    `v${version}`,
    aad ? Buffer.from(aad, 'utf8').toString('base64url') : '-',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ct.toString('base64url')
  ].join('.');
}

function unpack(packed) {
  const parts = String(packed || '').split('.');
  if (parts.length !== 5) {
    throw new VaultError('PACK_INVALID', 'Envelope is not a vault-packed string');
  }
  const [verRaw, aadRaw, ivRaw, tagRaw, ctRaw] = parts;
  if (!verRaw.startsWith('v')) {
    throw new VaultError('PACK_INVALID', 'Envelope version missing');
  }
  const version = parseInt(verRaw.slice(1), 10);
  if (!Number.isFinite(version)) {
    throw new VaultError('PACK_INVALID', 'Envelope version is not a number');
  }
  let aad = null;
  if (aadRaw !== '-') aad = Buffer.from(aadRaw, 'base64url').toString('utf8');
  return {
    version,
    aad,
    iv: Buffer.from(ivRaw, 'base64url'),
    tag: Buffer.from(tagRaw, 'base64url'),
    ct: Buffer.from(ctRaw, 'base64url')
  };
}

function isVaultPacked(value) {
  return (
    typeof value === 'string' &&
    /^v\d+\.(-|[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
  );
}

function decodeKekBase64(b64) {
  const raw = Buffer.from(String(b64 || ''), 'base64');
  if (raw.length !== 32) {
    throw new VaultError(
      'KEK_INVALID',
      `KEK must decode to exactly 32 bytes (got ${raw.length})`
    );
  }
  return raw;
}

function derivePurposeKey(kek, purpose, len = 32) {
  // HKDF-SHA256, single info string — enough for AES-256.
  const out = hkdfSync('sha256', kek, Buffer.alloc(0), Buffer.from(purpose, 'utf8'), len);
  return Buffer.from(out);
}

/** Read just the version + aad fields from a packed string. */
function parsePackedEnvelope(packed) {
  const env = unpack(packed);
  return { version: env.version, aad: env.aad };
}

/** Build the canonical AAD string for a tenant+provider pair. */
function aadFor(tenantId, provider) {
  return `tenant:${tenantId}|provider:${provider}`;
}

/* ── factory ────────────────────────────────────────────────────────── */

function createVault(options = {}) {
  // The KEK can be injected (test path), read from the
  // environment, or fall back to the deterministic dev key when
  // the runtime is marked development/test. The "no silent
  // fallback" rule is preserved: production (NODE_ENV not in
  // {development, test}) without INTEGRATION_KEK throws.
  const env = options.env || {};
  const isDevLike = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  let devKeyLogged = false;

  // Eagerly validate any KEK the caller provided so misconfig
  // surfaces at construction, not on the first encrypt.
  if (options.kekBase64) {
    decodeKekBase64(options.kekBase64);
  } else if (options.kekHex) {
    const raw = Buffer.from(options.kekHex, 'hex');
    if (raw.length !== 32) {
      throw new VaultError(
        'KEK_INVALID',
        `KEK hex must decode to exactly 32 bytes (got ${raw.length})`
      );
    }
  }

  function resolveKek() {
    const fromArg = options.kekBase64 || (options.kekHex ? Buffer.from(options.kekHex, 'hex').toString('base64') : null);
    if (fromArg) return fromArg;
    const fromEnv = process.env.INTEGRATION_KEK;
    if (fromEnv && fromEnv.length > 0) return fromEnv;
    if (!isDevLike) {
      throw new VaultError('KEK_MISSING', 'INTEGRATION_KEK is not set');
    }
    if (!devKeyLogged) {
      // eslint-disable-next-line no-console
      console.warn('[vault] INTEGRATION_KEK not set — using deterministic DEV KEK. DO NOT USE IN PROD.');
      devKeyLogged = true;
    }
    return Buffer.from(DEV_KEK_HEX, 'hex').toString('base64');
  }

  function getDataKey() {
    return derivePurposeKey(decodeKekBase64(resolveKek()), options.purpose || VAULT_PURPOSE);
  }

  function encryptString(plain, opts = {}) {
    if (typeof plain !== 'string') {
      throw new VaultError('INPUT_INVALID', 'plain must be a string');
    }
    const key = getDataKey();
    const iv = (options.randomBytes || cryptoRandomBytes)(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    if (opts.aad) cipher.setAAD(Buffer.from(opts.aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return pack(options.version || VAULT_VERSION, iv, tag, ct, opts.aad);
  }

  function decryptString(packed, opts = {}) {
    if (typeof packed !== 'string') {
      throw new VaultError('INPUT_INVALID', 'packed must be a string');
    }
    const env = unpack(packed);
    const targetVersion = options.version || VAULT_VERSION;
    if (env.version !== targetVersion) {
      throw new VaultError(
        'VERSION_UNSUPPORTED',
        `Vault envelope version v${env.version} is not supported (current: v${targetVersion})`
      );
    }
    if ((opts.aad ?? null) !== (env.aad ?? null)) {
      throw new VaultError('AAD_MISMATCH', 'AAD does not match envelope');
    }
    const key = getDataKey();
    const decipher = createDecipheriv('aes-256-gcm', key, env.iv);
    if (env.aad) decipher.setAAD(Buffer.from(env.aad, 'utf8'));
    decipher.setAuthTag(env.tag);
    try {
      const pt = Buffer.concat([decipher.update(env.ct), decipher.final()]);
      return pt.toString('utf8');
    } catch (err) {
      throw new VaultError('DECRYPT_FAILED', 'Decryption failed (wrong key or tampered ciphertext)', {
        cause: err
      });
    }
  }

  function encryptJSON(value, opts = {}) {
    return encryptString(JSON.stringify(value), opts);
  }

  function decryptJSON(packed, opts = {}) {
    const plain = decryptString(packed, opts);
    try {
      return JSON.parse(plain);
    } catch (err) {
      throw new VaultError('PARSE_FAILED', 'Decrypted plaintext is not valid JSON', { cause: err });
    }
  }

  function encryptConfigSecrets(config, fields = DEFAULT_ENCRYPTED_FIELDS, opts = {}) {
    const out = { ...config };
    for (const f of fields) {
      const v = out[f];
      if (typeof v === 'string' && v.length > 0 && !isVaultPacked(v)) {
        out[f] = encryptString(v, opts);
      }
    }
    return out;
  }

  function decryptConfigSecrets(config, fields = DEFAULT_ENCRYPTED_FIELDS, opts = {}) {
    const out = { ...config };
    for (const f of fields) {
      const v = out[f];
      if (isVaultPacked(v)) {
        out[f] = decryptString(v, opts);
      }
    }
    return out;
  }

  /** Test-only: clear the dev-key log flag so we can re-trigger. */
  function __resetDevKeyFlagForTests() {
    devKeyLogged = false;
  }

  return {
    encryptString,
    decryptString,
    encryptJSON,
    decryptJSON,
    encryptConfigSecrets,
    decryptConfigSecrets,
    isVaultPacked,
    parsePackedEnvelope,
    // Test escape hatches
    __resetDevKeyFlagForTests,
    __derivePurposeKeyForTests: (kekHex, purpose) =>
      derivePurposeKey(Buffer.from(kekHex, 'hex'), purpose || (options.purpose || VAULT_PURPOSE))
  };
}

function cryptoRandomBytes(n) {
  return randomBytes(n);
}

module.exports = {
  createVault,
  // pure helpers
  pack,
  unpack,
  isVaultPacked,
  parsePackedEnvelope,
  aadFor,
  decodeKekBase64,
  derivePurposeKey,
  // constants
  VAULT_VERSION,
  VAULT_PURPOSE,
  DEV_KEK_HEX,
  DEFAULT_ENCRYPTED_FIELDS,
  // error
  VaultError
};
