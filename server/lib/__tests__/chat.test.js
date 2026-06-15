/**
 * chat.test.js — 5-gate contract suite for the AI chat wrapper
 * (server/lib/ai/chat.js).
 *
 * Gate coverage:
 *   1. Pure — chatText / chatJson / normaliseChatRequest are
 *      exported; ChatInputError is exported; the MAX_TOKENS_CAP
 *      is 4096 and never changes across calls; ChatInputError
 *      subclasses Error with a `[CHAT_INPUT_INVALID]` prefix
 *      so the route layer can pattern-match the error message
 *      when deciding whether to surface a 4xx.
 *   2. Types — chatText / chatJson return the discriminated
 *      result from provider.callAI; the input validation
 *      surfaces a `{ ok: false, error, provider: 'none' }`
 *      shape (NEVER throws for invalid input); the success
 *      path returns `{ ok: true, data, provider, model }` for
 *      chatText; chatJson passes `jsonSchema` to the provider
 *      (and the provider passes it to Ollama `format`).
 *   3. Idempotency — two calls with the same input produce
 *      the same Ollama request payload bytes (modulo the
 *      `signal` AbortController); the temperature / maxTokens
 *      fields appear in the Ollama `options` block; chatJson
 *      without a jsonSchema sends NO `format` field.
 *   4. Contract — chatText forwards `system` + `user` into
 *      Ollama's `messages` array; the system prompt is the
 *      user-supplied system (NOT the provider's JSON
 *      instruction — that's the provider's job, not the
 *      wrapper's); chatText returns the discriminated result
 *      verbatim on a provider failure (no re-wrap); the
 *      route-layer pattern `{ ok: result.ok === true, ...
 *      }` produces a 2xx envelope on success and an error
 *      message on failure; the Armenian + emoji input
 *      round-trips byte-for-byte into the Ollama payload.
 *   5. Edge — system string empty / non-string / > 8 KB →
 *      `{ ok: false, error, provider: 'none' }` (NEVER throws);
 *      user string empty / non-string / > 64 KB → same;
 *      temperature out of [0, 2] → same; maxTokens out of
 *      [1, 4096] → same; chatJson without a body → returns
 *      the same error shape (no throw); chatJson with a
 *      non-object jsonSchema → returns the same error shape;
 *      request body null / non-object → returns the same
 *      error shape; provider fetch that throws (network
 *      down) is propagated as `{ ok: false, error, ... }`
 *      (no unhandled rejection).
 *
 * Why 5 gates: chat.js is the SOLE entry point for the
 * "Ask AI" / batch-summarize surfaces. A silent regression
 * (throwing on bad input instead of returning a discriminated
 * error, leaking a giant string into the AbortController,
 * mangling Armenian, dropping the jsonSchema pass-through)
 * would either break the SPA or compromise the audit hook.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const chat = require('../ai/chat');
const provider = require('../ai/provider');

/* ── helpers ──────────────────────────────────────────────────────── */

const FAKE_ENV_OLLAMA = {
  AI_PROVIDER: 'ollama',
  OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
  OLLAMA_MODEL: 'llama3.1:8b'
};

const FAKE_ENV_DISABLED = {
  AI_PROVIDER: 'disabled'
};

function mkFetch(response, opts = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (opts.throwOnCall) throw new Error(opts.throwOnCall);
    const r = (init && init.method && response[init.method]) || response.default || response;
    return {
      ok: r.ok !== false,
      status: r.status || 200,
      async text() { return r.text || ''; },
      async json() { return r.body; }
    };
  };
  impl.calls = calls;
  return impl;
}

const OLLAMA_OK_JSON_RESPONSE = {
  default: {
    body: { message: { role: 'assistant', content: '{"ok":true}' }, done: true, model: 'llama3.1:8b' }
  }
};

/* ── gate 1: pure ──────────────────────────────────────────────────── */

test('pure: chatText / chatJson / normaliseChatRequest / ChatInputError are exported', () => {
  assert.equal(typeof chat.chatText, 'function');
  assert.equal(typeof chat.chatJson, 'function');
  assert.equal(typeof chat.normaliseChatRequest, 'function');
  assert.equal(typeof chat.ChatInputError, 'function');
});

test('pure: MAX_TOKENS_CAP is 4096 and stable', () => {
  assert.equal(chat.MAX_TOKENS_CAP, 4096);
  // Re-read to make sure we don't accidentally mutate the export.
  assert.equal(chat.MAX_TOKENS_CAP, 4096);
});

test('pure: ChatInputError subclasses Error with the [CHAT_INPUT_INVALID] prefix', () => {
  const err = new chat.ChatInputError('test message');
  assert.ok(err instanceof Error);
  assert.ok(err instanceof chat.ChatInputError);
  assert.equal(err.name, 'ChatInputError');
  assert.match(err.message, /^\[CHAT_INPUT_INVALID\]/);
  assert.match(err.message, /test message/);
});

test('pure: MAX_USER_LEN = 64 KB, MAX_SYSTEM_LEN = 8 KB', () => {
  assert.equal(chat.MAX_USER_LEN, 64 * 1024);
  assert.equal(chat.MAX_SYSTEM_LEN, 8 * 1024);
});

/* ── gate 2: types ─────────────────────────────────────────────────── */

test('types: chatText returns the discriminated result on success', async () => {
  const fetchImpl = mkFetch(OLLAMA_OK_JSON_RESPONSE);
  const result = await chat.chatText(
    { system: 'sys', user: 'usr' },
    { env: FAKE_ENV_OLLAMA, fetchImpl }
  );
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'ollama');
  assert.equal(result.model, 'llama3.1:8b');
  // The provider coerces the JSON body through extractFirstJson
  // and JSON.parse; the wrapper returns the result verbatim.
  assert.deepEqual(result.data, { ok: true });
});

test('types: chatText returns the discriminated result on input error (NEVER throws)', async () => {
  const result = await chat.chatText(
    { system: '', user: 'usr' },
    { env: FAKE_ENV_OLLAMA, fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE) }
  );
  assert.equal(result.ok, false);
  assert.equal(result.provider, 'none');
  assert.match(result.error, /\[CHAT_INPUT_INVALID\]/);
  assert.match(result.error, /system/);
});

test('types: chatJson passes jsonSchema to the provider', async () => {
  const fetchImpl = mkFetch(OLLAMA_OK_JSON_RESPONSE);
  await chat.chatJson(
    { system: 'sys', user: 'usr', jsonSchema: { type: 'object', properties: { x: { type: 'string' } } } },
    { env: FAKE_ENV_OLLAMA, fetchImpl }
  );
  // The provider writes the jsonSchema into the Ollama `format`
  // field. The provider also injects a "respond with JSON"
  // instruction into the system prompt, but the wrapper's
  // job is to forward jsonSchema verbatim.
  const sentBody = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(sentBody.format.type, 'object');
  assert.deepEqual(sentBody.format.properties, { x: { type: 'string' } });
});

test('types: chatJson without jsonSchema sends NO `format` field', async () => {
  const fetchImpl = mkFetch(OLLAMA_OK_JSON_RESPONSE);
  await chat.chatJson(
    { system: 'sys', user: 'usr' },
    { env: FAKE_ENV_OLLAMA, fetchImpl }
  );
  const sentBody = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(sentBody.format, undefined);
});

test('types: chatJson with non-object jsonSchema returns a discriminated error (NEVER throws)', async () => {
  const result = await chat.chatJson(
    { system: 'sys', user: 'usr', jsonSchema: 'not-an-object' },
    { env: FAKE_ENV_OLLAMA, fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE) }
  );
  assert.equal(result.ok, false);
  assert.equal(result.provider, 'none');
  assert.match(result.error, /\[CHAT_INPUT_INVALID\]/);
  assert.match(result.error, /jsonSchema/);
});

test('types: chatText propagates provider failures as discriminated result (no re-wrap, no throw)', async () => {
  const fetchImpl = mkFetch(OLLAMA_OK_JSON_RESPONSE);
  const result = await chat.chatText(
    { system: 'sys', user: 'usr' },
    { env: FAKE_ENV_DISABLED, fetchImpl } // disabled → no_provider
  );
  assert.equal(result.ok, false);
  assert.equal(result.provider, 'none');
  assert.equal(result.error, 'no_provider');
});

/* ── gate 3: idempotency ───────────────────────────────────────────── */

test('idempotency: two identical chatText calls produce the same Ollama payload (modulo signal)', async () => {
  const fetch1 = mkFetch(OLLAMA_OK_JSON_RESPONSE);
  const fetch2 = mkFetch(OLLAMA_OK_JSON_RESPONSE);
  await chat.chatText(
    { system: 'sys', user: 'usr', temperature: 0.3, maxTokens: 200 },
    { env: FAKE_ENV_OLLAMA, fetchImpl: fetch1 }
  );
  await chat.chatText(
    { system: 'sys', user: 'usr', temperature: 0.3, maxTokens: 200 },
    { env: FAKE_ENV_OLLAMA, fetchImpl: fetch2 }
  );
  // Strip `signal` (AbortController instance, not stable) and
  // `body` stringification (timestamp-independent here).
  const stripSignal = (call) => {
    const { signal, ...rest } = call.init;
    return { url: call.url, method: call.init.method, rest };
  };
  assert.deepEqual(stripSignal(fetch1.calls[0]), stripSignal(fetch2.calls[0]));
  assert.equal(
    JSON.stringify(JSON.parse(fetch1.calls[0].init.body)),
    JSON.stringify(JSON.parse(fetch2.calls[0].init.body))
  );
});

test('idempotency: temperature + maxTokens appear in the Ollama `options` block', async () => {
  const fetchImpl = mkFetch(OLLAMA_OK_JSON_RESPONSE);
  await chat.chatText(
    { system: 'sys', user: 'usr', temperature: 0.7, maxTokens: 500 },
    { env: FAKE_ENV_OLLAMA, fetchImpl }
  );
  const sentBody = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(sentBody.options.temperature, 0.7);
  assert.equal(sentBody.options.num_predict, 500);
});

test('idempotency: chatText defaults to temperature=0.2 + maxTokens=1024 when omitted', async () => {
  const fetchImpl = mkFetch(OLLAMA_OK_JSON_RESPONSE);
  await chat.chatText(
    { system: 'sys', user: 'usr' },
    { env: FAKE_ENV_OLLAMA, fetchImpl }
  );
  const sentBody = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(sentBody.options.temperature, 0.2);
  assert.equal(sentBody.options.num_predict, 1024);
});

/* ── gate 4: contract ──────────────────────────────────────────────── */

test('contract: chatText forwards system + user into Ollama messages (role-tagged)', async () => {
  const fetchImpl = mkFetch(OLLAMA_OK_JSON_RESPONSE);
  await chat.chatText(
    { system: 'You are a helper', user: 'hi there' },
    { env: FAKE_ENV_OLLAMA, fetchImpl }
  );
  const sentBody = JSON.parse(fetchImpl.calls[0].init.body);
  // The provider injects a "respond with JSON" instruction into
  // the system prompt. We assert the user-supplied system is a
  // substring of the actual system message (i.e. the wrapper
  // forwards it verbatim, doesn't replace it).
  assert.ok(
    sentBody.messages[0].content.includes('You are a helper'),
    'system prompt must contain the user-supplied system'
  );
  assert.equal(sentBody.messages[1].role, 'user');
  assert.equal(sentBody.messages[1].content, 'hi there');
});

test('contract: chatText returns the discriminated result verbatim on provider failure (no re-wrap)', async () => {
  const fetchImpl = mkFetch(OLLAMA_OK_JSON_RESPONSE);
  const result = await chat.chatText(
    { system: 'sys', user: 'usr' },
    { env: FAKE_ENV_DISABLED, fetchImpl }
  );
  // The wrapper returns the provider's exact result. The route
  // layer (server/app.js) does the re-shape for the SPA.
  assert.equal(result.error, 'no_provider');
  assert.equal(result.provider, 'none');
  assert.equal(result.ok, false);
});

test('contract: route-layer envelope shape (success path)', async () => {
  // Simulate what server/app.js does on the success path:
  //   const result = await chatText(body, { env });
  //   return { ok: result.ok === true, provider, model,
  //            data: result.ok === true ? result.data : null,
  //            error: result.ok === true ? null : ... }
  const fetchImpl = mkFetch(OLLAMA_OK_JSON_RESPONSE);
  const result = await chat.chatText(
    { system: 'sys', user: 'usr' },
    { env: FAKE_ENV_OLLAMA, fetchImpl }
  );
  const envelope = {
    ok: result.ok === true,
    provider: result.provider,
    model: result.model || null,
    data: result.ok === true ? result.data : null,
    error: result.ok === true ? null : (result.error || 'unknown')
  };
  assert.equal(envelope.ok, true);
  assert.equal(envelope.provider, 'ollama');
  assert.equal(envelope.model, 'llama3.1:8b');
  assert.deepEqual(envelope.data, { ok: true });
  assert.equal(envelope.error, null);
});

test('contract: route-layer envelope shape (failure path)', async () => {
  const fetchImpl = mkFetch(OLLAMA_OK_JSON_RESPONSE);
  const result = await chat.chatText(
    { system: 'sys', user: 'usr' },
    { env: FAKE_ENV_DISABLED, fetchImpl }
  );
  const envelope = {
    ok: result.ok === true,
    provider: result.provider,
    model: result.model || null,
    data: result.ok === true ? result.data : null,
    error: result.ok === true ? null : (result.error || 'unknown')
  };
  assert.equal(envelope.ok, false);
  assert.equal(envelope.provider, 'none');
  assert.equal(envelope.model, null);
  assert.equal(envelope.data, null);
  assert.equal(envelope.error, 'no_provider');
});

test('contract: Armenian + emoji round-trip byte-for-byte into the Ollama payload', async () => {
  const fetchImpl = mkFetch(OLLAMA_OK_JSON_RESPONSE);
  const armenian = 'Բարև աշխարհ 🇦🇲 💼';
  await chat.chatText(
    { system: 'Համակարգ 📋', user: armenian },
    { env: FAKE_ENV_OLLAMA, fetchImpl }
  );
  const sentBody = JSON.parse(fetchImpl.calls[0].init.body);
  // The user message is forwarded verbatim — JSON serialisation
  // preserves UTF-8 bytes, and we decode back to the original
  // string for the assertion.
  assert.equal(sentBody.messages[1].content, armenian);
  assert.ok(sentBody.messages[0].content.includes('Համակարգ'));
});

test('contract: provider.fetchImpl that throws is propagated as discriminated result (no unhandled rejection)', async () => {
  const fetchImpl = mkFetch(OLLAMA_OK_JSON_RESPONSE, { throwOnCall: 'ECONNREFUSED' });
  const result = await chat.chatText(
    { system: 'sys', user: 'usr' },
    { env: FAKE_ENV_OLLAMA, fetchImpl }
  );
  // The provider's callOllama uses ollama.chatJson which NEVER
  // throws (it catches and returns {ok:false, error}); the
  // wrapper then surfaces the discriminated result. If the
  // wrapper accidentally propagated the throw, the test would
  // fail with an unhandled rejection.
  assert.equal(result.ok, false);
  assert.equal(result.provider, 'ollama');
  assert.match(result.error, /ECONNREFUSED/);
});

/* ── gate 5: edge ──────────────────────────────────────────────────── */

test('edge: system string non-string → discriminated error', async () => {
  const result = await chat.chatText(
    { system: 42, user: 'usr' },
    { env: FAKE_ENV_OLLAMA, fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE) }
  );
  assert.equal(result.ok, false);
  assert.equal(result.provider, 'none');
  assert.match(result.error, /system must be a string/);
});

test('edge: system string empty → discriminated error', async () => {
  const result = await chat.chatText(
    { system: '', user: 'usr' },
    { env: FAKE_ENV_OLLAMA, fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE) }
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /system must not be empty/);
});

test('edge: system string > 8 KB → discriminated error', async () => {
  const huge = 'x'.repeat(8 * 1024 + 1);
  const result = await chat.chatText(
    { system: huge, user: 'usr' },
    { env: FAKE_ENV_OLLAMA, fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE) }
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /system length \d+ exceeds max 8192/);
});

test('edge: user string non-string → discriminated error', async () => {
  const result = await chat.chatText(
    { system: 'sys', user: null },
    { env: FAKE_ENV_OLLAMA, fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE) }
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /user must be a string/);
});

test('edge: user string empty → discriminated error', async () => {
  const result = await chat.chatText(
    { system: 'sys', user: '' },
    { env: FAKE_ENV_OLLAMA, fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE) }
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /user must not be empty/);
});

test('edge: user string > 64 KB → discriminated error', async () => {
  const huge = 'x'.repeat(64 * 1024 + 1);
  const result = await chat.chatText(
    { system: 'sys', user: huge },
    { env: FAKE_ENV_OLLAMA, fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE) }
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /user length \d+ exceeds max 65536/);
});

test('edge: temperature out of [0, 2] → discriminated error', async () => {
  const neg = await chat.chatText(
    { system: 'sys', user: 'usr', temperature: -0.1 },
    { env: FAKE_ENV_OLLAMA, fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE) }
  );
  assert.equal(neg.ok, false);
  assert.match(neg.error, /temperature -0.1 is out of \[0, 2\]/);

  const hot = await chat.chatText(
    { system: 'sys', user: 'usr', temperature: 2.5 },
    { env: FAKE_ENV_OLLAMA, fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE) }
  );
  assert.equal(hot.ok, false);
  assert.match(hot.error, /temperature 2.5 is out of \[0, 2\]/);
});

test('edge: temperature NaN is IGNORED (falls back to 0.2)', async () => {
  const fetchImpl = mkFetch(OLLAMA_OK_JSON_RESPONSE);
  const result = await chat.chatText(
    { system: 'sys', user: 'usr', temperature: Number.NaN },
    { env: FAKE_ENV_OLLAMA, fetchImpl }
  );
  assert.equal(result.ok, true);
  const sentBody = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(sentBody.options.temperature, 0.2);
});

test('edge: maxTokens out of [1, 4096] → discriminated error', async () => {
  const zero = await chat.chatText(
    { system: 'sys', user: 'usr', maxTokens: 0 },
    { env: FAKE_ENV_OLLAMA, fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE) }
  );
  assert.equal(zero.ok, false);
  assert.match(zero.error, /maxTokens 0 is out of \[1, 4096\]/);

  const over = await chat.chatText(
    { system: 'sys', user: 'usr', maxTokens: 5000 },
    { env: FAKE_ENV_OLLAMA, fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE) }
  );
  assert.equal(over.ok, false);
  assert.match(over.error, /maxTokens 5000 is out of \[1, 4096\]/);
});

test('edge: maxTokens = 4096 is allowed (cap is inclusive)', async () => {
  const fetchImpl = mkFetch(OLLAMA_OK_JSON_RESPONSE);
  const result = await chat.chatText(
    { system: 'sys', user: 'usr', maxTokens: 4096 },
    { env: FAKE_ENV_OLLAMA, fetchImpl }
  );
  assert.equal(result.ok, true);
  const sentBody = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(sentBody.options.num_predict, 4096);
});

test('edge: maxTokens inside range is floored to integer (4095.9 → 4095)', async () => {
  const fetchImpl = mkFetch(OLLAMA_OK_JSON_RESPONSE);
  const result = await chat.chatText(
    { system: 'sys', user: 'usr', maxTokens: 4095.9 },
    { env: FAKE_ENV_OLLAMA, fetchImpl }
  );
  assert.equal(result.ok, true);
  const sentBody = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(sentBody.options.num_predict, 4095);
});

test('edge: maxTokens at 4096.7 is REJECTED (out of [1, 4096] range)', async () => {
  const result = await chat.chatText(
    { system: 'sys', user: 'usr', maxTokens: 4096.7 },
    { env: FAKE_ENV_OLLAMA, fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE) }
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /maxTokens 4096\.7 is out of \[1, 4096\]/);
});

test('edge: request body null → discriminated error', async () => {
  const result = await chat.chatText(
    null,
    { env: FAKE_ENV_OLLAMA, fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE) }
  );
  assert.equal(result.ok, false);
  assert.equal(result.provider, 'none');
  assert.match(result.error, /request body must be an object/);
});

test('edge: chatJson with null body → discriminated error', async () => {
  const result = await chat.chatJson(
    null,
    { env: FAKE_ENV_OLLAMA, fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE) }
  );
  assert.equal(result.ok, false);
  assert.equal(result.provider, 'none');
  assert.match(result.error, /\[CHAT_INPUT_INVALID\] request body must be an object/);
});

test('edge: chatText with completely missing body fields → discriminated error (NEVER throws)', async () => {
  const result = await chat.chatText(
    {},
    { env: FAKE_ENV_OLLAMA, fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE) }
  );
  assert.equal(result.ok, false);
  assert.equal(result.provider, 'none');
  assert.match(result.error, /system must be a string/);
});

test('edge: provider resolver sees "anthropic" + key → returns not_implemented_on_ant (sovereignty preserved)', async () => {
  // Sanity: this proves the contract that the chat wrapper
  // never bypasses the provider's "we don't ship anthropic on
  // ANT" decision. If the wrapper ever calls Ollama directly
  // with the user's system prompt, this test would break.
  const result = await chat.chatText(
    { system: 'sys', user: 'usr' },
    {
      env: { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-fake' },
      fetchImpl: mkFetch(OLLAMA_OK_JSON_RESPONSE)
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.provider, 'anthropic');
  assert.match(result.error, /not_implemented_on_ant/);
});

/* ── summary ──────────────────────────────────────────────────────── */

// Re-export the things route-layer callers reach for, so the
// import graph in server/app.js can rely on the test having
// touched every public surface.
test('pure: re-exports the public surface that server/app.js imports', () => {
  const surface = ['chatText', 'chatJson', 'normaliseChatRequest', 'ChatInputError', 'MAX_TOKENS_CAP', 'MAX_USER_LEN', 'MAX_SYSTEM_LEN'];
  for (const name of surface) {
    assert.ok(name in chat, `chat.${name} is missing`);
  }
});
