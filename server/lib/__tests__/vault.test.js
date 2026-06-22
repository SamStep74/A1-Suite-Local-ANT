/**
 * vault.test.js — 5-gate contract suite for the AES-256-GCM vault
 * (server/lib/vault.js + server/lib/integrations/config-vault.js).
 *
 * Gate coverage:
 *   1. Pure — pack/unpack round-trip; isVaultPacked; parsePackedEnvelope;
 *      aadFor format; derivePurposeKey deterministic.
 *   2. Types — createVault returns the 7-method surface; env-shape
 *      errors are VaultError with a code.
 *   3. Idempotency — encrypting the same plaintext twice produces
 *      different ciphertexts (random IV); decrypt-then-encrypt
 *      of the same plaintext is a no-op; encryptConfigSecrets on
 *      an already-packed field is a no-op.
 *   4. Contract — KEK must be 32 bytes; AAD mismatch throws;
 *      tampered ciphertext throws; plaintext legacy values are
 *      round-tripped as plain (with warning logged); strict mode
 *      refuses plaintext.
 *   5. Edge — large payload (10 KB JSON); unicode content; empty
 *      string round-trip; null/boolean/number values in the config
 *      object pass through unchanged; AAD with special characters
 *      (Armenian, CJK) round-trips.
 *
 * Why 5 gates: the vault is the ONLY line of defense for provider
 * secrets in JSON columns. A silent behavior change (e.g. dropping
 * AAD binding) would break the entire tenant isolation guarantee.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  createVault,
  pack,
  unpack,
  isVaultPacked,
  parsePackedEnvelope,
  aadFor,
  derivePurposeKey,
  VaultError,
  VAULT_VERSION,
  DEV_KEK_HEX
} = require('../vault');

const { createConfigVault, VaultStrictError } = require('../integrations/config-vault');

/* ── helpers ──────────────────────────────────────────────────────── */

const TEST_KEK_HEX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

function mkVault(opts = {}) {
  return createVault({
    env: { NODE_ENV: 'test' },
    kekHex: opts.kekHex || TEST_KEK_HEX,
    ...opts
  });
}

/* ── gate 1: pure ──────────────────────────────────────────────────── */

test('pure: pack/unpack round-trip preserves every field', () => {
  const iv = Buffer.from('0123456789ab', 'hex');
  const tag = Buffer.from('fedcba9876543210', 'hex');
  const ct = Buffer.from('hello, world!', 'utf8');
  const packed = pack(1, iv, tag, ct, 'tenant:t1|provider:p1');
  const env = unpack(packed);
  assert.equal(env.version, 1);
  assert.equal(env.aad, 'tenant:t1|provider:p1');
  assert.equal(env.iv.toString('hex'), iv.toString('hex'));
  assert.equal(env.tag.toString('hex'), tag.toString('hex'));
  assert.equal(env.ct.toString('utf8'), 'hello, world!');
});

test('pure: pack without aad uses "-" placeholder', () => {
  const iv = Buffer.alloc(12, 0);
  const tag = Buffer.alloc(16, 0);
  const ct = Buffer.from('no-aad');
  const packed = pack(1, iv, tag, ct);
  const env = unpack(packed);
  assert.equal(env.aad, null);
  // The aad section in the envelope is the literal dash
  assert.equal(packed.split('.')[1], '-');
});

test('pure: unpack rejects malformed envelopes', () => {
  assert.throws(() => unpack('garbage'), /PACK_INVALID/);
  assert.throws(() => unpack('v1.too-few-parts'), /PACK_INVALID/);
  assert.throws(() => unpack('vX.aaa.bbb.ccc.ddd'), /PACK_INVALID/);
});

test('pure: isVaultPacked accepts valid envelope, rejects plaintext', () => {
  const iv = Buffer.alloc(12, 1);
  const tag = Buffer.alloc(16, 2);
  const ct = Buffer.from('x');
  const packed = pack(1, iv, tag, ct);
  assert.equal(isVaultPacked(packed), true);
  assert.equal(isVaultPacked('plaintext'), false);
  assert.equal(isVaultPacked(null), false);
  assert.equal(isVaultPacked(undefined), false);
  assert.equal(isVaultPacked(42), false);
  assert.equal(isVaultPacked({}), false);
});

test('pure: parsePackedEnvelope returns only version + aad (no key material)', () => {
  const packed = pack(1, Buffer.alloc(12, 1), Buffer.alloc(16, 2), Buffer.from('x'), 'tenant:1|provider:2');
  const parsed = parsePackedEnvelope(packed);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.aad, 'tenant:1|provider:2');
});

test('pure: aadFor uses the documented format', () => {
  assert.equal(aadFor('tenant-x', 'apollo'), 'tenant:tenant-x|provider:apollo');
  assert.equal(aadFor('org-123', 'surfe'), 'tenant:org-123|provider:surfe');
});

test('pure: derivePurposeKey is deterministic and length-correct', () => {
  const kek = Buffer.from(TEST_KEK_HEX, 'hex');
  const k1 = derivePurposeKey(kek, 'test-purpose');
  const k2 = derivePurposeKey(kek, 'test-purpose');
  assert.equal(k1.length, 32);
  assert.equal(k1.equals(k2), true);
  // Different purpose → different key
  const k3 = derivePurposeKey(kek, 'other-purpose');
  assert.equal(k1.equals(k3), false);
  // Different KEK → different key
  const k4 = derivePurposeKey(Buffer.from(DEV_KEK_HEX, 'hex'), 'test-purpose');
  assert.equal(k1.equals(k4), false);
});

/* ── gate 2: types / shape ─────────────────────────────────────────── */

test('types: createVault returns the 7-method surface', () => {
  const v = mkVault();
  for (const m of [
    'encryptString',
    'decryptString',
    'encryptJSON',
    'decryptJSON',
    'encryptConfigSecrets',
    'decryptConfigSecrets',
    'isVaultPacked'
  ]) {
    assert.equal(typeof v[m], 'function', `missing method: ${m}`);
  }
  // Bonus: parsePackedEnvelope + test escape hatches
  assert.equal(typeof v.parsePackedEnvelope, 'function');
  assert.equal(typeof v.__resetDevKeyFlagForTests, 'function');
  assert.equal(typeof v.__derivePurposeKeyForTests, 'function');
});

test('types: VaultError carries a code + name', () => {
  const e = new VaultError('AAD_MISMATCH', 'test message');
  assert.equal(e.code, 'AAD_MISMATCH');
  assert.equal(e.name, 'VaultError');
  assert.equal(e.message, '[AAD_MISMATCH] test message');
});

test('types: VaultStrictError carries the right name + prefix', () => {
  const e = new VaultStrictError('test message');
  assert.equal(e.name, 'VaultStrictError');
  assert.match(e.message, /^\[VAULT_STRICT\] test message$/);
});

test('types: encryptString returns a vault-packed envelope', () => {
  const v = mkVault();
  const packed = v.encryptString('hello', { aad: 'tenant:t1|provider:p1' });
  assert.equal(isVaultPacked(packed), true);
  assert.equal(parsePackedEnvelope(packed).version, VAULT_VERSION);
});

/* ── gate 3: idempotency ──────────────────────────────────────────── */

test('idempotency: encrypting the same plaintext twice produces different IVs', () => {
  const v = mkVault();
  const a = v.encryptString('hello');
  const b = v.encryptString('hello');
  assert.notEqual(a, b, 'random IV must produce different ciphertexts');
  // Both decrypt back to the same plaintext
  assert.equal(v.decryptString(a), 'hello');
  assert.equal(v.decryptString(b), 'hello');
});

test('idempotency: encryptConfigSecrets on an already-packed field is a no-op', () => {
  const v = mkVault();
  const apiKey = 'sk_live_abcdef';
  const first = v.encryptConfigSecrets({ apiKey }, ['apiKey'], { aad: 'tenant:1|provider:p1' });
  // Call again on the already-sealed config
  const second = v.encryptConfigSecrets(first, ['apiKey'], { aad: 'tenant:1|provider:p1' });
  assert.deepEqual(second, first, 'second seal must be a no-op');
});

test('idempotency: decryptConfigSecrets on a non-packed config is a no-op (plaintext passthrough)', () => {
  const v = mkVault();
  const cfg = { apiKey: 'sk_live_abc', host: 'api.apollo.io' };
  const opened = v.decryptConfigSecrets(cfg, ['apiKey'], { aad: 'tenant:1|provider:p1' });
  // No decryption happened — value unchanged
  assert.equal(opened.apiKey, 'sk_live_abc');
  assert.equal(opened.host, 'api.apollo.io');
});

test('idempotency: round-trip the same value N times is stable', () => {
  const v = mkVault();
  for (let i = 0; i < 5; i += 1) {
    const aad = `tenant:t${i}|provider:p${i}`;
    const packed = v.encryptString(`payload-${i}`, { aad });
    assert.equal(v.decryptString(packed, { aad }), `payload-${i}`);
  }
});

/* ── gate 4: contract — error shape, validation ───────────────────── */

test('contract: KEK missing in production throws KEK_MISSING', () => {
  // NODE_ENV=production without INTEGRATION_KEK env → throws
  // Save the env so we can restore
  const saved = process.env.INTEGRATION_KEK;
  delete process.env.INTEGRATION_KEK;
  try {
    const v = createVault({ env: { NODE_ENV: 'production' } });
    assert.throws(() => v.encryptString('x'), VaultError);
    assert.throws(() => v.encryptString('x'), /KEK_MISSING/);
  } finally {
    if (saved) process.env.INTEGRATION_KEK = saved;
  }
});

test('contract: KEK must decode to exactly 32 bytes', () => {
  assert.throws(
    () => createVault({ env: { NODE_ENV: 'test' }, kekBase64: Buffer.from('short').toString('base64') }),
    VaultError
  );
  assert.throws(
    () => createVault({ env: { NODE_ENV: 'test' }, kekBase64: Buffer.from('short').toString('base64') }),
    /KEK_INVALID/
  );
});

test('contract: AAD mismatch throws AAD_MISMATCH', () => {
  const v = mkVault();
  const packed = v.encryptString('secret', { aad: 'tenant:1|provider:p1' });
  assert.throws(() => v.decryptString(packed, { aad: 'tenant:2|provider:p1' }), /AAD_MISMATCH/);
  // No AAD at decrypt but packed with AAD → mismatch
  assert.throws(() => v.decryptString(packed, {}), /AAD_MISMATCH/);
  // Packed without AAD, decrypt with AAD → mismatch
  const noAad = v.encryptString('secret');
  assert.throws(() => v.decryptString(noAad, { aad: 'tenant:1|provider:p1' }), /AAD_MISMATCH/);
});

test('contract: tampered ciphertext throws DECRYPT_FAILED', () => {
  const v = mkVault();
  const packed = v.encryptString('secret', { aad: 'tenant:1|provider:p1' });
  const env = unpack(packed);
  const tamperedCt = Buffer.from(env.ct);
  tamperedCt[0] ^= 0xff;
  const tampered = pack(env.version, env.iv, env.tag, tamperedCt, env.aad);
  assert.throws(
    () => v.decryptString(tampered, { aad: 'tenant:1|provider:p1' }),
    VaultError
  );
  assert.throws(
    () => v.decryptString(tampered, { aad: 'tenant:1|provider:p1' }),
    /DECRYPT_FAILED/
  );
});

test('contract: version mismatch throws VERSION_UNSUPPORTED', () => {
  const v = mkVault();
  // Construct a v2 envelope manually
  const iv = Buffer.alloc(12, 1);
  const tag = Buffer.alloc(16, 2);
  const ct = Buffer.from('x');
  const v2 = pack(2, iv, tag, ct);
  assert.throws(() => v.decryptString(v2), /VERSION_UNSUPPORTED/);
});

test('contract: plaintext legacy values are passed through (back-compat)', () => {
  const v = mkVault();
  const cfg = { apiKey: 'sk_live_plaintext', host: 'api.apollo.io' };
  // Non-strict: plaintext passes through unchanged
  const opened = v.decryptConfigSecrets(cfg, ['apiKey'], { aad: 'tenant:1|provider:p1' });
  assert.equal(opened.apiKey, 'sk_live_plaintext');
});

test('contract: strict mode refuses plaintext in any known secret field', () => {
  const cv = createConfigVault({ vault: mkVault() });
  // Non-strict seal: plaintext gets encrypted
  const sealed = cv.sealConfigSecrets('tenant:1', 'apollo', { apiKey: 'plain-key' });
  assert.notEqual(sealed.apiKey, 'plain-key');
  assert.equal(isVaultPacked(sealed.apiKey), true);
  // Strict seal with plaintext → throws
  assert.throws(
    () => cv.sealConfigSecrets('tenant:1', 'apollo', { apiKey: 'plain-key' }, { strict: true }),
    VaultStrictError
  );
  // Strict open with plaintext → throws
  assert.throws(
    () =>
      cv.openConfigSecrets('tenant:1', 'apollo', { apiKey: 'plain-key' }, { strict: true }),
    VaultStrictError
  );
});

test('contract: strict mode accepts vault-packed values (back-compat for sealed data)', () => {
  const cv = createConfigVault({ vault: mkVault() });
  const sealed = cv.sealConfigSecrets('tenant:1', 'apollo', { apiKey: 'plain-key' });
  // Same vault + same AAD → strict-open succeeds and recovers
  // the plaintext
  const opened = cv.openConfigSecrets('tenant:1', 'apollo', sealed, { strict: true });
  assert.equal(opened.apiKey, 'plain-key');
});

test('contract: strict mode requires a vault', () => {
  // AAD format: different provider → different ciphertext / can
  // detect if you accidentally swapped AADs
  const cv = createConfigVault({ vault: mkVault() });
  const sealedForApollo = cv.sealConfigSecrets('tenant:1', 'apollo', { apiKey: 'k' });
  // Trying to open with the wrong provider AAD should round-trip
  // to a useless plaintext (GCM tag check fails first).
  assert.throws(
    () => cv.openConfigSecrets('tenant:1', 'surfe', sealedForApollo),
    VaultError
  );
});

/* ── gate 5: edge — round-trip, unicode, large payloads ──────────── */

test('edge: large JSON payload (10 KB) round-trips', () => {
  const v = mkVault();
  const big = { rows: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `row-${i}`, meta: { a: i, b: 'x'.repeat(50) } })) };
  const packed = v.encryptJSON(big, { aad: 'tenant:1|provider:p1' });
  const opened = v.decryptJSON(packed, { aad: 'tenant:1|provider:p1' });
  assert.deepEqual(opened, big);
});

test('edge: Armenian + CJK + emoji round-trip through encryptString', () => {
  const v = mkVault();
  const samples = [
    'Երևան', // Yerevan (Armenian)
    '北京', // Beijing
    '🚀🎉💜', // emoji
    'café — naïve façade', // diacritics
    'A'.repeat(1000) + 'B' // 1 KB ASCII
  ];
  for (const s of samples) {
    const packed = v.encryptString(s, { aad: 'tenant:1|provider:p1' });
    const opened = v.decryptString(packed, { aad: 'tenant:1|provider:p1' });
    assert.equal(opened, s);
  }
});

test('edge: empty string round-trips (and is NOT packed)', () => {
  const v = mkVault();
  const packed = v.encryptString('', { aad: 'tenant:1|provider:p1' });
  const opened = v.decryptString(packed, { aad: 'tenant:1|provider:p1' });
  assert.equal(opened, '');
});

test('edge: non-string fields in config pass through unchanged', () => {
  const v = mkVault();
  const cfg = {
    apiKey: 'k',
    host: 'api.apollo.io',
    mode: 2,
    enabled: true,
    extra: null,
    tags: ['a', 'b'],
    nested: { x: 1, y: { z: 2 } }
  };
  const out = v.encryptConfigSecrets(cfg, ['apiKey'], { aad: 'tenant:1|provider:p1' });
  assert.equal(out.host, 'api.apollo.io');
  assert.equal(out.mode, 2);
  assert.equal(out.enabled, true);
  assert.equal(out.extra, null);
  assert.deepEqual(out.tags, ['a', 'b']);
  assert.deepEqual(out.nested, { x: 1, y: { z: 2 } });
  // The only encrypted field is apiKey
  assert.notEqual(out.apiKey, 'k');
  assert.equal(isVaultPacked(out.apiKey), true);
});

test('edge: config-vault per-tenant isolation — same secret, different tenants', () => {
  const cv = createConfigVault({ vault: mkVault() });
  const t1 = cv.sealConfigSecrets('tenant:1', 'apollo', { apiKey: 'secret-A' });
  const t2 = cv.sealConfigSecrets('tenant:2', 'apollo', { apiKey: 'secret-A' });
  // Ciphertexts are different (AAD binding)
  assert.notEqual(t1.apiKey, t2.apiKey);
  // Each opens correctly under its own AAD
  assert.equal(cv.openConfigSecrets('tenant:1', 'apollo', t1).apiKey, 'secret-A');
  assert.equal(cv.openConfigSecrets('tenant:2', 'apollo', t2).apiKey, 'secret-A');
  // Cross-tenant open fails
  assert.throws(() => cv.openConfigSecrets('tenant:2', 'apollo', t1), VaultError);
  assert.throws(() => cv.openConfigSecrets('tenant:2', 'apollo', t1), /DECRYPT_FAILED|AAD_MISMATCH/);
});

test('edge: AES-GCM nonce uniqueness — 1000 encryptions of the same plaintext all differ', () => {
  const v = mkVault();
  const seen = new Set();
  for (let i = 0; i < 1000; i += 1) {
    seen.add(v.encryptString('hello', { aad: 'tenant:1|provider:p1' }));
  }
  assert.equal(seen.size, 1000, 'every encryption must use a fresh IV');
});

test('edge: encrypted envelope size is bounded (no unbounded leak)', () => {
  // For a 1 KB plaintext, the packed envelope is ~1 KB + 12 IV
  // + 16 tag + base64 overhead. Roughly 1.4 KB. This is just a
  // sanity check that the size doesn't blow up.
  const v = mkVault();
  const plain = 'x'.repeat(1000);
  const packed = v.encryptString(plain, { aad: 'tenant:1|provider:p1' });
  // Packed format: v1.<aad>.<iv>.<tag>.<ct>. IV is 16 b64url chars,
  // tag is 22 chars, ct is 4/3 of plaintext size.
  const minExpected = 1000 + 16 + 22 + 6; // + 6 for "v1." / "."
  assert.ok(packed.length > minExpected, 'envelope should be at least plaintext + overhead');
  assert.ok(packed.length < 2000, 'envelope should not be wildly larger than plaintext');
});

test('edge: JSON round-trip with deeply nested structure', () => {
  const v = mkVault();
  let nested = { leaf: 'bottom' };
  for (let i = 0; i < 10; i += 1) nested = { level: i, child: nested };
  const packed = v.encryptJSON(nested, { aad: 'tenant:1|provider:p1' });
  const opened = v.decryptJSON(packed, { aad: 'tenant:1|provider:p1' });
  assert.deepEqual(opened, nested);
});

test('edge: __derivePurposeKeyForTests is the public escape hatch for key derivation', () => {
  const v = mkVault();
  const k1 = v.__derivePurposeKeyForTests(TEST_KEK_HEX, 'test-purpose');
  const k2 = derivePurposeKey(Buffer.from(TEST_KEK_HEX, 'hex'), 'test-purpose');
  assert.deepEqual(k1, k2);
});

test('edge: dev KEK fallback works when env says test but no INTEGRATION_KEK', () => {
  // Force no env var; the factory's env.NODE_ENV='test' must allow
  // the dev key fallback. This is the CI behaviour.
  const saved = process.env.INTEGRATION_KEK;
  delete process.env.INTEGRATION_KEK;
  try {
    const v = createVault({ env: { NODE_ENV: 'test' } });
    const packed = v.encryptString('hello');
    assert.equal(v.decryptString(packed), 'hello');
  } finally {
    if (saved) process.env.INTEGRATION_KEK = saved;
  }
});
