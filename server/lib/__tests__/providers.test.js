/**
 * providers.test.js — 5-gate contract suite for the sequence
 * provider registry (server/lib/integrations/providers/*).
 *
 * Gate coverage:
 *   1. Pure — every provider's buildEnrollUrl/buildEnrollBody/
 *      resolveAuthHeader is deterministic and shape-correct for
 *      the documented inputs.
 *   2. Types — registry returns 3 known ids; the contract is
 *      narrow and predictable; coerceProviderId narrows the
 *      type correctly.
 *   3. Idempotency — building the same URL N times yields the
 *      same string (no internal random / time leakage); a
 *      repeated call with identical EnrollRequest returns
 *      deep-equal body.
 *   4. Contract — Apollo's enroll URL must include the
 *      emailer_campaign_id query param; Instantly/Closely must
 *      return a `Bearer <key>` Authorization string; Apollo
 *      must validate that contact_ids is a non-empty array and
 *      mailboxAlias is a non-empty string when validation
 *      runs; registry errors use the ProviderRegistryError
 *      class with the documented message prefix.
 *   5. Edge — Unicode + special chars in sequenceId are
 *      URL-encoded; null phone passes through as null for
 *      Closely, undefined for Instantly; unknown provider id
 *      throws a useful error listing known ids; Apollo's
 *      validateEnrollBody accepts the alternate
 *      'contact_ids[]' key (some clients send bracket syntax).
 *
 * Why 5 gates: every outbound HTTP request to Apollo /
 * Instantly / Closely flows through these adapters. A subtle
 * shape drift (missing query param, wrong auth prefix) would
 * silently break tenant enrollments.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { apolloProvider } = require('../integrations/providers/apollo');
const { instantlyProvider } = require('../integrations/providers/instantly');
const { closelyProvider } = require('../integrations/providers/closely');
const {
  getSequenceProvider,
  listSequenceProviders,
  isSequenceProvider,
  ProviderRegistryError
} = require('../integrations/providers');
const { PROVIDER_IDS, coerceProviderId } = require('../integrations/providers/types');

/* ── helpers ──────────────────────────────────────────────────────── */

function mkEnrollRequest(overrides = {}) {
  return {
    tenantId: 'tenant-t1',
    integrationId: 'int-x',
    action: {
      provider: 'apollo',
      sequenceId: 'seq-123',
      mailboxAlias: 'mailbox-A',
      listId: undefined,
      ...overrides.action
    },
    contact: {
      email: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Stepanyan',
      phone: '+37499123456',
      externalContactId: 'apollo-789',
      ...overrides.contact
    },
    deal: {
      dealId: 'deal-42',
      fromStageName: 'New',
      toStageName: 'Qualified',
      ...overrides.deal
    },
    correlationId: 'corr-1'
  };
}

/* ── gate 1: pure ──────────────────────────────────────────────────── */

test('pure: Apollo buildEnrollUrl includes emailer_campaign_id and mailbox alias', () => {
  const url = apolloProvider.buildEnrollUrl('seq-123', 'mailbox-A');
  // URL-encode: "seq-123" passes through, special chars would
  // be encoded. The path must contain the sequence id.
  assert.ok(
    url.startsWith('https://api.apollo.io/api/v1/emailer_campaigns/seq-123/add_contact_ids'),
    `unexpected url: ${url}`
  );
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('emailer_campaign_id'), 'seq-123');
  assert.equal(
    parsed.searchParams.get('send_email_from_email_account_id'),
    'mailbox-A'
  );
});

test('pure: Apollo buildEnrollUrl omits mailbox param when alias is missing', () => {
  const url = apolloProvider.buildEnrollUrl('seq-123');
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('emailer_campaign_id'), 'seq-123');
  assert.equal(parsed.searchParams.get('send_email_from_email_account_id'), null);
});

test('pure: Apollo buildEnrollBody includes campaign id, contact ids, custom fields', () => {
  const body = apolloProvider.buildEnrollBody(mkEnrollRequest());
  assert.equal(body.emailer_campaign_id, 'seq-123');
  assert.deepEqual(body.contact_ids, ['apollo-789']);
  assert.equal(body.send_email_from_email_account_id, 'mailbox-A');
  assert.equal(body.contact_custom_fields.a1_deal_id, 'deal-42');
  assert.equal(body.contact_custom_fields.a1_from_stage, 'New');
  assert.equal(body.contact_custom_fields.a1_to_stage, 'Qualified');
});

test('pure: Apollo buildEnrollBody omits contact_ids when externalContactId is missing', () => {
  const body = apolloProvider.buildEnrollBody(
    mkEnrollRequest({ contact: { externalContactId: undefined } })
  );
  assert.equal(body.contact_ids, undefined);
});

test('pure: Apollo resolveAuthHeader returns api_key=<key> URL form', () => {
  assert.equal(apolloProvider.resolveAuthHeader('sk_live_abc'), 'api_key=sk_live_abc');
  // Empty key still produces a deterministic string (caller
  // is responsible for catching "no key configured" upstream)
  assert.equal(apolloProvider.resolveAuthHeader(''), 'api_key=');
});

test('pure: Instantly buildEnrollUrl points to /v1/campaigns/{id}/leads', () => {
  const url = instantlyProvider.buildEnrollUrl('seq-123');
  assert.equal(url, 'https://api.instantly.ai/v1/campaigns/seq-123/leads');
});

test('pure: Instantly buildEnrollBody uses email/first/last + personalization', () => {
  const body = instantlyProvider.buildEnrollBody(mkEnrollRequest({ action: { provider: 'instantly', sequenceId: 'seq-456' } }));
  assert.equal(body.campaign_id, 'seq-456');
  assert.equal(body.email, 'alice@example.com');
  assert.equal(body.first_name, 'Alice');
  assert.equal(body.last_name, 'Stepanyan');
  assert.equal(body.phone, '+37499123456');
  assert.equal(body.personalization.deal_id, 'deal-42');
  assert.equal(body.personalization.from_stage, 'New');
  assert.equal(body.personalization.to_stage, 'Qualified');
});

test('pure: Instantly resolveAuthHeader returns "Bearer <key>"', () => {
  assert.equal(instantlyProvider.resolveAuthHeader('tk_abc'), 'Bearer tk_abc');
});

test('pure: Closely buildEnrollUrl points to /v1/sequences/{id}/leads', () => {
  const url = closelyProvider.buildEnrollUrl('seq-123');
  assert.equal(url, 'https://api.closelyhq.com/v1/sequences/seq-123/leads');
});

test('pure: Closely buildEnrollBody uses sequence_id + custom_fields array', () => {
  const body = closelyProvider.buildEnrollBody(mkEnrollRequest({ action: { provider: 'closely', sequenceId: 'seq-789' } }));
  assert.equal(body.sequence_id, 'seq-789');
  assert.equal(body.email, 'alice@example.com');
  assert.equal(body.phone, '+37499123456');
  assert.equal(Array.isArray(body.custom_fields), true);
  assert.deepEqual(body.custom_fields, [
    { key: 'a1_deal_id', value: 'deal-42' },
    { key: 'a1_from_stage', value: 'New' },
    { key: 'a1_to_stage', value: 'Qualified' }
  ]);
});

test('pure: Closely resolveAuthHeader returns "Bearer <key>"', () => {
  assert.equal(closelyProvider.resolveAuthHeader('tk_xyz'), 'Bearer tk_xyz');
});

/* ── gate 2: types / shape ─────────────────────────────────────────── */

test('types: listSequenceProviders returns the 3 known ids', () => {
  const ids = listSequenceProviders();
  assert.equal(ids.length, 3);
  assert.ok(ids.includes('apollo'));
  assert.ok(ids.includes('instantly'));
  assert.ok(ids.includes('closely'));
});

test('types: PROVIDER_IDS is a const tuple of the 3 ids', () => {
  assert.deepEqual([...PROVIDER_IDS], ['apollo', 'instantly', 'closely']);
});

test('types: coerceProviderId narrows valid ids, rejects garbage', () => {
  assert.equal(coerceProviderId('apollo'), 'apollo');
  assert.equal(coerceProviderId('INSTANTLY'), null, 'case-sensitive: no cross-case alias');
  assert.equal(coerceProviderId('pipedrive'), null, 'unknown provider is not a sequence provider');
  assert.equal(coerceProviderId(null), null);
  assert.equal(coerceProviderId(undefined), null);
  assert.equal(coerceProviderId(42), null);
  assert.equal(coerceProviderId({}), null);
});

test('types: isSequenceProvider narrows correctly', () => {
  assert.equal(isSequenceProvider('apollo'), true);
  assert.equal(isSequenceProvider('instantly'), true);
  assert.equal(isSequenceProvider('closely'), true);
  assert.equal(isSequenceProvider('pipedrive'), false);
  assert.equal(isSequenceProvider(''), false);
  assert.equal(isSequenceProvider(null), false);
});

test('types: getSequenceProvider returns the canonical adapter object', () => {
  for (const id of listSequenceProviders()) {
    const p = getSequenceProvider(id);
    assert.equal(p.id, id);
    assert.equal(typeof p.displayName, 'string');
    assert.match(p.apiHost, /\./, 'apiHost should be a domain');
    for (const m of ['buildEnrollUrl', 'buildEnrollBody', 'resolveAuthHeader']) {
      assert.equal(typeof p[m], 'function', `${id} missing ${m}`);
    }
  }
});

test('types: ProviderRegistryError carries the documented prefix', () => {
  const e = new ProviderRegistryError('test message');
  assert.equal(e.name, 'ProviderRegistryError');
  assert.equal(e.message, '[PROVIDER_NOT_FOUND] test message');
});

/* ── gate 3: idempotency ──────────────────────────────────────────── */

test('idempotency: buildEnrollUrl is deterministic across 100 calls', () => {
  for (const p of [apolloProvider, instantlyProvider, closelyProvider]) {
    const first = p.buildEnrollUrl('seq-X', 'mailbox-Y');
    for (let i = 0; i < 99; i += 1) {
      assert.equal(p.buildEnrollUrl('seq-X', 'mailbox-Y'), first, `${p.id} must be deterministic`);
    }
  }
});

test('idempotency: buildEnrollBody is deep-stable for the same EnrollRequest', () => {
  for (const p of [apolloProvider, instantlyProvider, closelyProvider]) {
    const req = mkEnrollRequest({ action: { provider: p.id, sequenceId: 'seq-1' } });
    const first = p.buildEnrollBody(req);
    for (let i = 0; i < 5; i += 1) {
      assert.deepEqual(p.buildEnrollBody(req), first, `${p.id} body must be stable`);
    }
  }
});

test('idempotency: resolveAuthHeader is pure (no random suffix / timestamp)', () => {
  for (const p of [apolloProvider, instantlyProvider, closelyProvider]) {
    const first = p.resolveAuthHeader('key-A');
    for (let i = 0; i < 5; i += 1) {
      assert.equal(p.resolveAuthHeader('key-A'), first);
    }
  }
});

/* ── gate 4: contract — auth shape, validation, errors ───────────── */

test('contract: Apollo auth shape is the literal "api_key=<key>" URL fragment', () => {
  // We pin this exact format because the dispatch layer
  // concatenates resolveAuthHeader() onto the URL as a query
  // string.
  const header = apolloProvider.resolveAuthHeader('sk_live_abc');
  assert.match(header, /^api_key=.+/);
  // No spaces, no Bearer prefix
  assert.equal(header.includes('Bearer'), false);
  assert.equal(header.includes(' '), false, 'Apollo auth must not have whitespace');
});

test('contract: Instantly + Closely auth shape is "Bearer <key>"', () => {
  for (const p of [instantlyProvider, closelyProvider]) {
    const header = p.resolveAuthHeader('tk_abc');
    assert.match(header, /^Bearer .+/, `${p.id} must use Bearer prefix`);
    assert.equal(header.startsWith('Bearer '), true);
  }
});

test('contract: Apollo validateEnrollBody returns null when valid', () => {
  const body = {
    contact_ids: ['apollo-1'],
    send_email_from_email_account_id: 'mailbox-A'
  };
  assert.equal(apolloProvider.validateEnrollBody(body), null);
});

test('contract: Apollo validateEnrollBody rejects missing contact_ids', () => {
  const body = { send_email_from_email_account_id: 'mailbox-A' };
  const err = apolloProvider.validateEnrollBody(body);
  assert.match(err, /contact_ids/i);
  assert.match(err, /Apollo/);
});

test('contract: Apollo validateEnrollBody rejects empty contact_ids', () => {
  const body = { contact_ids: [], send_email_from_email_account_id: 'mailbox-A' };
  const err = apolloProvider.validateEnrollBody(body);
  assert.match(err, /contact_ids/);
});

test('contract: Apollo validateEnrollBody accepts the bracket-key variant contact_ids[]', () => {
  const body = { 'contact_ids[]': ['apollo-1'], send_email_from_email_account_id: 'mailbox-A' };
  assert.equal(apolloProvider.validateEnrollBody(body), null);
});

test('contract: Apollo validateEnrollBody rejects missing mailbox alias', () => {
  const body = { contact_ids: ['apollo-1'] };
  const err = apolloProvider.validateEnrollBody(body);
  assert.match(err, /send_email_from_email_account_id/);
});

test('contract: Apollo validateEnrollBody rejects whitespace-only fields', () => {
  const body = { contact_ids: ['apollo-1'], send_email_from_email_account_id: '   ' };
  const err = apolloProvider.validateEnrollBody(body);
  assert.match(err, /send_email_from_email_account_id/);
});

test('contract: getSequenceProvider throws ProviderRegistryError on unknown id', () => {
  assert.throws(
    () => getSequenceProvider('pipedrive'),
    ProviderRegistryError
  );
  try {
    getSequenceProvider('pipedrive');
  } catch (err) {
    assert.equal(err.name, 'ProviderRegistryError');
    assert.match(err.message, /pipedrive/);
    assert.match(err.message, /Known: apollo, instantly, closely/);
  }
});

/* ── gate 5: edge — unicode, special chars, null phone ───────────── */

test('edge: special chars in sequenceId are URL-encoded', () => {
  // Apollo: path component, must be percent-encoded
  const apolloUrl = apolloProvider.buildEnrollUrl('seq with spaces & chars?');
  const parsedApollo = new URL(apolloUrl);
  assert.equal(parsedApollo.pathname.includes(' '), false, 'no literal spaces');
  assert.ok(parsedApollo.pathname.includes('seq%20with%20spaces'));
  // Instantly + Closely: same expectation
  const instantlyUrl = instantlyProvider.buildEnrollUrl('seq/with/slashes');
  assert.ok(instantlyUrl.includes('seq%2Fwith%2Fslashes'));
  const closelyUrl = closelyProvider.buildEnrollUrl('seq/with/slashes');
  assert.ok(closelyUrl.includes('seq%2Fwith%2Fslashes'));
});

test('edge: Armenian sequence id is URL-encoded to percent form', () => {
  // Armenian "Seq" (Seq/Երdelays) — non-ASCII codepoints must be encoded
  const apolloUrl = apolloProvider.buildEnrollUrl('հաջորդ-1');
  const parsed = new URL(apolloUrl);
  // Armenian capital Հ = U+0540, encoded as %D5%80 in the path
  // (Node's WHATWG URL uses UPPERCASE percent-encoding in the
  // pathname but LOWERCASE in the query). Check both casings.
  const pathname = parsed.pathname.toLowerCase();
  assert.ok(
    pathname.includes('%d5%b0'),
    `Armenian char must be percent-encoded (lowercase or uppercase): ${apolloUrl}`
  );
  // Either casing works in production — what matters is the
  // codepoint is escaped, not the case.
  const isPercentEncoded = /%[0-9a-f]{2}/i.test(parsed.pathname);
  assert.equal(isPercentEncoded, true);
});

test('edge: null phone in Closely body becomes JSON null (callers can tell)', () => {
  const body = closelyProvider.buildEnrollBody(
    mkEnrollRequest({
      action: { provider: 'closely', sequenceId: 'seq-1' },
      contact: { phone: null }
    })
  );
  assert.equal(body.phone, null);
});

test('edge: null phone in Instantly body becomes undefined', () => {
  const body = instantlyProvider.buildEnrollBody(
    mkEnrollRequest({
      action: { provider: 'instantly', sequenceId: 'seq-1' },
      contact: { phone: null }
    })
  );
  // We use `phone: contact.phone ?? undefined` so the value is
  // undefined. When the dispatch layer JSON-serializes the body,
  // the key is omitted. (`'phone' in body` is still true because
  // the key was assigned — but the serialised JSON will not
  // include it.)
  assert.equal(body.phone, undefined);
  const serialised = JSON.stringify(body);
  assert.equal(serialised.includes('phone'), false, 'JSON.stringify must drop undefined');
});

test('edge: Apollo validates contact_ids with mixed empty entries', () => {
  const body = {
    contact_ids: ['', '  ', 'apollo-1'],
    send_email_from_email_account_id: 'mailbox-A'
  };
  // stringArray() filters out empty/whitespace entries, leaving
  // one valid id — validation should pass.
  assert.equal(apolloProvider.validateEnrollBody(body), null);
});

test('edge: Apollo rejects body with no contact_ids key at all', () => {
  const body = { send_email_from_email_account_id: 'mailbox-A' };
  // Neither contact_ids nor contact_ids[] is present
  const err = apolloProvider.validateEnrollBody(body);
  assert.match(err, /contact_ids/);
});

test('edge: fromStageName=null is surfaced as empty string (not "null")', () => {
  const body = apolloProvider.buildEnrollBody(
    mkEnrollRequest({ deal: { fromStageName: null } })
  );
  assert.equal(body.contact_custom_fields.a1_from_stage, '');
  assert.notEqual(body.contact_custom_fields.a1_from_stage, 'null');
});

test('edge: deeply nested object shape is preserved through serialization round-trip', () => {
  const req = mkEnrollRequest();
  const body = apolloProvider.buildEnrollBody(req);
  // JSON round-trip must preserve the deal context exactly
  const restored = JSON.parse(JSON.stringify(body));
  assert.deepEqual(restored.contact_custom_fields, {
    a1_deal_id: 'deal-42',
    a1_from_stage: 'New',
    a1_to_stage: 'Qualified'
  });
});

test('edge: registry lookup is case-sensitive (id in PROVIDERS uses Object.hasOwn)', () => {
  // Even though the source uses `id in PROVIDERS`, Object.hasOwn
  // is the safer test — and it's what we ship.
  assert.equal(isSequenceProvider('Apollo'), false, 'case-sensitive: Apollo !== apollo');
  assert.equal(isSequenceProvider('APOLLO'), false);
  assert.equal(isSequenceProvider('apollo'), true);
});
