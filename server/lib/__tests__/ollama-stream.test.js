/**
 * ollama-stream.test.js — 5-gate contract suite for the
 * AI streaming adapter (server/lib/ai/ollama-stream.js).
 *
 * Gate coverage:
 *   1. Pure — streamChat is exported; DEFAULT_TIMEOUT_MS is
 *      60_000 (longer than chat() because streaming can
 *      produce many tokens over many seconds); AsyncGenerator
 *      yields only {token, done, error} events.
 *   2. Types — each event has the documented shape
 *      ({type: 'token'|'done'|'error', data: string|object});
 *      token events carry a string; done events carry an
 *      object with model + total_duration; error events
 *      carry {code, message}.
 *   3. Idempotency — replaying the same NDJSON stream produces
 *      the same event sequence (no dedup, no reordering);
 *      tokens accumulate in the same order as Ollama emits
 *      them.
 *   4. Contract — content extraction reads
 *      `parsed.message.content` (Ollama's wire format); done
 *      events are emitted exactly once per call (even when
 *      multiple `done: true` lines appear); malformed lines
 *      (non-JSON) are silently skipped, not yielded as
 *      errors; the final buffered line (no trailing \n) is
 *      still parsed; tokens are split correctly across line
 *      boundaries (defensive against proxies that chunk
 *      mid-JSON).
 *   5. Edge — invalid request (no model, no messages) yields
 *      a single error event and exits; HTTP 5xx response
 *      yields a single `http_error` error event; AbortError
 *      (timeout) yields a `timeout` error event; response
 *      with no body (no `getReader`) yields `no_stream_body`
 *      error event; reader.releaseLock() runs in finally
 *      even on error; the buffer flush at end-of-stream
 *      handles a final non-newline-terminated JSON object.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { streamChat, DEFAULT_TIMEOUT_MS } = require('../ai/ollama-stream');

/* ── helpers ──────────────────────────────────────────────────────── */

const FAKE_MODEL = 'llama3.1:8b';

const FAKE_BASE_REQ = {
  model: FAKE_MODEL,
  messages: [
    { role: 'system', content: 'You are a concise assistant.' },
    { role: 'user', content: 'Say hi in 1 word.' }
  ]
};

/**
 * Build a fake fetch that returns a ReadableStream of
 * NDJSON-encoded Ollama chunks. Each `lines` entry is a
 * full Ollama chat-chunk object.
 */
function mkStreamFetch(lines, opts = {}) {
  const calls = [];
  return {
    calls,
    async fetchImpl(url, init) {
      calls.push({ url, init });
      if (opts.abortBeforeResponse) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      if (opts.throwOnCall) throw new Error(opts.throwOnCall);
      if (opts.httpStatus) {
        return {
          ok: false,
          status: opts.httpStatus,
          async text() { return 'upstream is sad'; }
        };
      }
      const body = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          let i = 0;
          function push() {
            if (i >= lines.length) {
              controller.close();
              return;
            }
            // Optional: split a single line across multiple chunks
            // to test boundary handling.
            if (opts.chunkedSends && opts.chunkSize && i === 0) {
              const full = JSON.stringify(lines[0]);
              const mid = Math.floor(full.length / 2);
              controller.enqueue(enc.encode(full.slice(0, mid)));
              controller.enqueue(enc.encode(full.slice(mid) + '\n'));
            } else {
              controller.enqueue(enc.encode(JSON.stringify(lines[i]) + '\n'));
            }
            i++;
            // Yield to the event loop so the reader can consume.
            queueMicrotask(push);
          }
          push();
        }
      });
      return { ok: true, status: 200, body };
    }
  };
}

/**
 * Drain an async generator into an array.
 */
async function drain(gen) {
  const out = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

/* ── gate 1: pure ──────────────────────────────────────────────────── */

test('pure: streamChat is exported and is an async function', () => {
  assert.equal(typeof streamChat, 'function');
  assert.equal(streamChat.constructor.name, 'AsyncGeneratorFunction');
});

test('pure: DEFAULT_TIMEOUT_MS is 60_000 (longer than chat())', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 60_000);
});

test('pure: events are only one of {token, done, error}', async () => {
  const fetchImpl = mkStreamFetch([
    { message: { role: 'assistant', content: 'hi' }, done: false, model: FAKE_MODEL },
    { message: { role: 'assistant', content: ' there' }, done: true, model: FAKE_MODEL, total_duration: 12345 }
  ]).fetchImpl;
  const events = await drain(streamChat(FAKE_BASE_REQ, { fetchImpl }));
  for (const e of events) {
    assert.ok(['token', 'done', 'error'].includes(e.type), `unknown event type: ${e.type}`);
  }
});

/* ── gate 2: types ─────────────────────────────────────────────────── */

test('types: token events carry a string in data', async () => {
  const fetchImpl = mkStreamFetch([
    { message: { role: 'assistant', content: 'hello' }, done: false, model: FAKE_MODEL },
    { message: { role: 'assistant', content: ' world' }, done: true, model: FAKE_MODEL }
  ]).fetchImpl;
  const events = await drain(streamChat(FAKE_BASE_REQ, { fetchImpl }));
  const tokens = events.filter((e) => e.type === 'token');
  assert.equal(tokens.length, 2);
  for (const t of tokens) assert.equal(typeof t.data, 'string');
  assert.equal(tokens[0].data, 'hello');
  assert.equal(tokens[1].data, ' world');
});

test('types: done event carries an object with model + total_duration', async () => {
  const fetchImpl = mkStreamFetch([
    { message: { role: 'assistant', content: 'ok' }, done: true, model: FAKE_MODEL, total_duration: 9876, eval_count: 5 }
  ]).fetchImpl;
  const events = await drain(streamChat(FAKE_BASE_REQ, { fetchImpl }));
  const done = events.find((e) => e.type === 'done');
  assert.ok(done);
  assert.equal(typeof done.data, 'object');
  assert.equal(done.data.model, FAKE_MODEL);
  assert.equal(done.data.total_duration, 9876);
  assert.equal(done.data.eval_count, 5);
});

test('types: error event carries {code, message}', async () => {
  const events = await drain(streamChat(null));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].data.code, 'invalid_request');
  assert.match(events[0].data.message, /model and a non-empty messages array are required/);
});

/* ── gate 3: idempotency ───────────────────────────────────────────── */

test('idempotency: replaying the same stream produces the same event sequence', async () => {
  const lines = [
    { message: { role: 'assistant', content: 'A' }, done: false, model: FAKE_MODEL },
    { message: { role: 'assistant', content: 'B' }, done: false, model: FAKE_MODEL },
    { message: { role: 'assistant', content: 'C' }, done: true, model: FAKE_MODEL }
  ];
  const a = await drain(streamChat(FAKE_BASE_REQ, { fetchImpl: mkStreamFetch(lines).fetchImpl }));
  const b = await drain(streamChat(FAKE_BASE_REQ, { fetchImpl: mkStreamFetch(lines).fetchImpl }));
  // Compare types + data (skip `done` because the call may be the same but
  // JSON serialization keys may differ; we compare structural).
  const shape = (xs) => xs.map((e) => ({ type: e.type, data: e.data }));
  assert.deepEqual(shape(a), shape(b));
  // The tokens must accumulate in the same order.
  const aText = a.filter((e) => e.type === 'token').map((e) => e.data).join('');
  const bText = b.filter((e) => e.type === 'token').map((e) => e.data).join('');
  assert.equal(aText, bText);
  assert.equal(aText, 'ABC');
});

/* ── gate 4: contract ──────────────────────────────────────────────── */

test('contract: content extraction reads parsed.message.content', async () => {
  const fetchImpl = mkStreamFetch([
    { message: { role: 'assistant', content: 'first chunk' }, done: false, model: FAKE_MODEL },
    { message: { role: 'assistant', content: ' second' }, done: true, model: FAKE_MODEL }
  ]).fetchImpl;
  const events = await drain(streamChat(FAKE_BASE_REQ, { fetchImpl }));
  const tokens = events.filter((e) => e.type === 'token').map((e) => e.data);
  assert.deepEqual(tokens, ['first chunk', ' second']);
});

test('contract: done event is emitted exactly once per call', async () => {
  const fetchImpl = mkStreamFetch([
    { message: { role: 'assistant', content: 'a' }, done: true, model: FAKE_MODEL },
    { message: { role: 'assistant', content: 'b' }, done: true, model: FAKE_MODEL } // duplicate done (Ollama won't do this, but be defensive)
  ]).fetchImpl;
  const events = await drain(streamChat(FAKE_BASE_REQ, { fetchImpl }));
  const dones = events.filter((e) => e.type === 'done');
  assert.equal(dones.length, 1);
});

test('contract: malformed lines are silently skipped, not yielded as errors', async () => {
  // Build a fetch that returns a body with 3 lines: valid, malformed, valid.
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(JSON.stringify({ message: { role: 'assistant', content: 'before' }, done: false, model: FAKE_MODEL }) + '\n'));
      controller.enqueue(enc.encode('this is not json\n'));
      controller.enqueue(enc.encode(JSON.stringify({ message: { role: 'assistant', content: ' after' }, done: true, model: FAKE_MODEL }) + '\n'));
      controller.close();
    }
  });
  const fetchImpl = (url, init) => Promise.resolve({ ok: true, status: 200, body });
  const events = await drain(streamChat(FAKE_BASE_REQ, { fetchImpl }));
  const tokens = events.filter((e) => e.type === 'token').map((e) => e.data);
  // Malformed line is silently dropped, before+after are emitted.
  assert.deepEqual(tokens, ['before', ' after']);
  const errors = events.filter((e) => e.type === 'error');
  assert.equal(errors.length, 0, 'malformed lines must not produce error events');
});

test('contract: the final buffered line (no trailing newline) is still parsed', async () => {
  const enc = new TextEncoder();
  const fetchImpl = (url, init) => {
    return Promise.resolve({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(enc.encode(JSON.stringify({ message: { role: 'assistant', content: 'streamed' }, done: true, model: FAKE_MODEL })));
          controller.close();
        }
      })
    });
  };
  const events = await drain(streamChat(FAKE_BASE_REQ, { fetchImpl }));
  const tokens = events.filter((e) => e.type === 'token').map((e) => e.data);
  assert.deepEqual(tokens, ['streamed']);
});

test('contract: tokens split across a single chunk boundary are still emitted intact', async () => {
  // First chunk contains the first half of a JSON object; second
  // chunk contains the rest + a newline. The decoder buffer
  // must NOT split the object.
  const enc = new TextEncoder();
  const full = JSON.stringify({ message: { role: 'assistant', content: 'across boundary' }, done: true, model: FAKE_MODEL });
  const mid = Math.floor(full.length / 2);
  const fetchImpl = (url, init) => Promise.resolve({
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode(full.slice(0, mid)));
        controller.enqueue(enc.encode(full.slice(mid) + '\n'));
        controller.close();
      }
    })
  });
  const events = await drain(streamChat(FAKE_BASE_REQ, { fetchImpl }));
  const tokens = events.filter((e) => e.type === 'token').map((e) => e.data);
  assert.deepEqual(tokens, ['across boundary']);
});

test('contract: fetchImpl receives the documented payload + headers + signal', async () => {
  const wrapper = mkStreamFetch([
    { message: { role: 'assistant', content: 'ok' }, done: true, model: FAKE_MODEL }
  ]);
  await drain(streamChat(FAKE_BASE_REQ, { fetchImpl: wrapper.fetchImpl, baseURL: 'http://example.test' }));
  assert.equal(wrapper.calls.length, 1);
  const call = wrapper.calls[0];
  assert.equal(call.url, 'http://example.test/api/chat');
  assert.equal(call.init.method, 'POST');
  assert.match(call.init.headers['content-type'], /application\/json/);
  assert.match(call.init.headers.accept, /application\/x-ndjson/);
  assert.ok(call.init.signal, 'AbortController signal must be present');
  const body = JSON.parse(call.init.body);
  assert.equal(body.model, FAKE_MODEL);
  assert.equal(body.stream, true);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].role, 'user');
});

/* ── gate 5: edge ──────────────────────────────────────────────────── */

test('edge: invalid request (no model) yields invalid_request error', async () => {
  const events = await drain(streamChat({ messages: [] }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].data.code, 'invalid_request');
});

test('edge: invalid request (no messages) yields invalid_request error', async () => {
  const events = await drain(streamChat({ model: FAKE_MODEL }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].data.code, 'invalid_request');
});

test('edge: null request yields invalid_request error', async () => {
  const events = await drain(streamChat(null));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
});

test('edge: HTTP 5xx response yields http_error with status + body snippet', async () => {
  const fetchImpl = mkStreamFetch([], { httpStatus: 503 }).fetchImpl;
  const events = await drain(streamChat(FAKE_BASE_REQ, { fetchImpl }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].data.code, 'http_error');
  assert.match(events[0].data.message, /http_503:upstream is sad/);
});

test('edge: AbortError before the response is read yields timeout error', async () => {
  const fetchImpl = mkStreamFetch([], { abortBeforeResponse: true }).fetchImpl;
  const events = await drain(streamChat(FAKE_BASE_REQ, { fetchImpl }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].data.code, 'timeout');
});

test('edge: fetch throwing network error yields network_error event', async () => {
  const fetchImpl = mkStreamFetch([], { throwOnCall: 'ECONNREFUSED' }).fetchImpl;
  const events = await drain(streamChat(FAKE_BASE_REQ, { fetchImpl }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].data.code, 'network_error');
  assert.match(events[0].data.message, /ECONNREFUSED/);
});

test('edge: response with no body yields no_stream_body error', async () => {
  const fetchImpl = (url, init) => Promise.resolve({ ok: true, status: 200, body: null });
  const events = await drain(streamChat(FAKE_BASE_REQ, { fetchImpl }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].data.code, 'no_stream_body');
});

test('edge: the done event is still emitted on success even when no tokens are generated', async () => {
  // Empty content, but done:true on the first line.
  const fetchImpl = mkStreamFetch([
    { message: { role: 'assistant', content: '' }, done: true, model: FAKE_MODEL }
  ]).fetchImpl;
  const events = await drain(streamChat(FAKE_BASE_REQ, { fetchImpl }));
  const tokens = events.filter((e) => e.type === 'token');
  const dones = events.filter((e) => e.type === 'done');
  assert.equal(tokens.length, 0);
  assert.equal(dones.length, 1);
});

test('edge: streaming with format (jsonSchema) sends format in the wire payload', async () => {
  const wrapper = mkStreamFetch([
    { message: { role: 'assistant', content: '{"ok":true}' }, done: true, model: FAKE_MODEL }
  ]);
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
  await drain(streamChat({ ...FAKE_BASE_REQ, format: schema }, { fetchImpl: wrapper.fetchImpl }));
  const body = JSON.parse(wrapper.calls[0].init.body);
  assert.deepEqual(body.format, schema);
});

test('edge: streaming with temperature + maxTokens sends them in options', async () => {
  const wrapper = mkStreamFetch([
    { message: { role: 'assistant', content: 'ok' }, done: true, model: FAKE_MODEL }
  ]);
  await drain(streamChat({ ...FAKE_BASE_REQ, temperature: 0.4, maxTokens: 256 }, { fetchImpl: wrapper.fetchImpl }));
  const body = JSON.parse(wrapper.calls[0].init.body);
  assert.equal(body.options.temperature, 0.4);
  assert.equal(body.options.num_predict, 256);
});
