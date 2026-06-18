/**
 * ollama-integration.test.js — 5-gate contract suite for the
 * AI client + streaming adapter against a REAL in-process HTTP
 * server (not a mock fetchImpl).
 *
 * Why a real server: the production code's NDJSON parser
 * uses `fetch().then(r => r.body.getReader())` and a TextDecoder.
 * A mock fetchImpl returns a single string or a fake ReadableStream;
 * it can't reproduce the real wire behaviour of:
 *   - HTTP chunked transfer encoding
 *   - mid-JSON chunk boundaries (one JSON object split across two TCP packets)
 *   - server-initiated connection close
 *   - the Node `Response` constructor wrapping a stream
 * This test spins up a real `http.createServer` and hits it with
 * the real built-in `fetch`. The server's only job is to play
 * canned NDJSON streams; the client is unmodified.
 *
 * Test hooks (forceStatus, forceHang, custom chunks) are read
 * from URL QUERY PARAMS, not the request body — because the
 * client serializes the body and drops unknown fields. The
 * tests that need special behaviour use a `fetchImpl` wrapper
 * that appends `?...` to the URL.
 *
 * Gate coverage:
 *   1. Pure — chat() returns the documented shape;
 *      chatJson() extracts JSON from prose via extractFirstJson;
 *      embed() returns the embedding vector; health() returns
 *      the model list; streamChat() yields token + done events.
 *   2. Types — each function's return shape is stable.
 *   3. Idempotency — same input → same output (server echoes it).
 *   4. Contract — chat() uses /api/chat; embed() uses /api/embeddings;
 *      health() uses /api/tags; streamChat() uses /api/chat with
 *      stream:true; the request body has model + messages + stream.
 *   5. Edge — HTTP 500 from chat() throws; HTTP 500 from streamChat()
 *      yields http_error event; AbortController timeout yields
 *      timeout event; chunk-boundary NDJSON (one JSON object
 *      split across two chunks) is still parsed correctly;
 *      server connection close (no done:true line) is handled.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const ollama = require('../ai/ollama-client');
const { streamChat } = require('../ai/ollama-stream');

/**
 * Parse a URL into its components.
 * @param {string} url
 * @returns {URL}
 */
function parseURL(url) {
  return new URL(url);
}

/**
 * Start a fake Ollama HTTP server.
 *
 * Test hooks (read from URL query params):
 *   ?__forceStatus=N    → respond with HTTP N
 *   ?__forceHang=1      → never write a response (causes client timeout)
 *   ?__chunks=base64    → write custom NDJSON chunks (each b64-decoded
 *                         and written verbatim, then \n appended)
 *
 * @param {(req, parsedUrl, body) => void | Promise<void>} [onRequest]
 * @returns {Promise<{ port: number, baseURL: string, close: () => Promise<void> }>}
 */
async function startFakeOllama(onRequest) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      // req.url is path-only (e.g. "/api/chat?__forceStatus=500").
      // We just need the searchParams + pathname, so prepend a
      // placeholder base; the host/port don't matter for parsing.
      const parsedUrl = new URL(req.url, 'http://localhost');
      const path = parsedUrl.pathname;
      // Read body
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf-8');
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { /* ignore */ }

      try {
        if (onRequest) await onRequest(req, parsedUrl, body);
      } catch (_) { /* ignore */ }

      const forceStatus = parsedUrl.searchParams.get('__forceStatus');
      const forceHang = parsedUrl.searchParams.get('__forceHang') === '1';
      const forceChunks = parsedUrl.searchParams.get('__chunks');

      if (forceStatus) {
        const status = parseInt(forceStatus, 10);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'forced ' + status }));
        return;
      }
      if (forceHang) {
        // Hold the request open; client timeout will fire.
        return;
      }

      if (req.method === 'GET' && path === '/api/tags') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'llama3.1:8b' }, { name: 'nomic-embed-text' }] }));
        return;
      }
      if (req.method === 'POST' && path === '/api/embeddings') {
        const dim = 8;
        const seed = (body.prompt || '').length;
        const embedding = Array.from({ length: dim }, (_, i) => ((seed * (i + 1)) % 100) / 100);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ embedding }));
        return;
      }
      if (req.method === 'POST' && path === '/api/chat') {
        if (body.stream === true) {
          res.writeHead(200, { 'content-type': 'application/x-ndjson', 'transfer-encoding': 'chunked' });
          if (forceChunks) {
            // Custom chunked sequence (for chunk-boundary tests).
            // __chunks format: comma-separated, each item is a base64-encoded
            // chunk of bytes to write. A literal "\n" means a newline.
            const parts = forceChunks.split(',');
            for (const p of parts) {
              if (p === '\\n') { res.write('\n'); continue; }
              try {
                const buf = Buffer.from(p, 'base64');
                res.write(buf);
              } catch (_) { /* ignore */ }
            }
          } else {
            res.write(JSON.stringify({ model: body.model, message: { role: 'assistant', content: 'Hello' }, done: false }) + '\n');
            res.write(JSON.stringify({ model: body.model, message: { role: 'assistant', content: ', ' }, done: false }) + '\n');
            res.write(JSON.stringify({ model: body.model, message: { role: 'assistant', content: 'world!' }, done: true, total_duration: 12345, eval_count: 3 }) + '\n');
          }
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          model: body.model,
          message: { role: 'assistant', content: body.__echoContent || 'pong' },
          done: true,
          total_duration: 9999,
          eval_count: 1
        }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        port: addr.port,
        baseURL: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((res) => server.close(() => res()))
      });
    });
  });
}

/**
 * Wrap a baseURL with one that appends a test query string to
 * /api/chat requests. Used by tests that need the server to
 * behave specially (force 500, hang, custom chunks).
 */
function chatWithQuery(baseURL, qs) {
  return (url, opts) => {
    const u = parseURL(url);
    if (u.pathname === '/api/chat') {
      // Append the test query params, preserving any others.
      for (const [k, v] of new URLSearchParams(qs)) {
        if (!u.searchParams.has(k)) u.searchParams.set(k, v);
      }
      return fetch(u.toString(), opts);
    }
    return fetch(url, opts);
  };
}

// =================================================================
// 1. health() — GET /api/tags
// =================================================================

test('health() returns ok + model list from a real server', async () => {
  const server = await startFakeOllama();
  try {
    const result = await ollama.health({ baseURL: server.baseURL });
    assert.equal(result.ok, true);
    assert.equal(result.baseURL, server.baseURL);
    assert.deepEqual(result.models, ['llama3.1:8b', 'nomic-embed-text']);
    assert.equal(result.error, undefined);
  } finally {
    await server.close();
  }
});

test('health() surfaces http_500 from a custom fetchImpl', async () => {
  const server = await startFakeOllama();
  try {
    const fake500 = async () => new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } });
    const result = await ollama.health({ baseURL: server.baseURL, fetchImpl: fake500 });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'http_500');
  } finally {
    await server.close();
  }
});

// =================================================================
// 2. chat() — POST /api/chat (non-streaming)
// =================================================================

test('chat() returns the response shape from a real server', async () => {
  const server = await startFakeOllama();
  try {
    const result = await ollama.chat({
      model: 'llama3.1:8b',
      messages: [{ role: 'user', content: 'ping' }]
    }, { baseURL: server.baseURL });
    assert.equal(result.message.role, 'assistant');
    assert.equal(result.message.content, 'pong');
    assert.equal(result.done, true);
    assert.equal(result.model, 'llama3.1:8b');
  } finally {
    await server.close();
  }
});

test('chat() includes temperature + num_predict when provided', async () => {
  let seenBody = null;
  const server = await startFakeOllama((_req, _u, body) => { seenBody = body; });
  try {
    await ollama.chat({
      model: 'llama3.1:8b',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.42,
      maxTokens: 128
    }, { baseURL: server.baseURL });
    assert.equal(seenBody.stream, false);
    assert.equal(seenBody.model, 'llama3.1:8b');
    assert.equal(seenBody.options.temperature, 0.42);
    assert.equal(seenBody.options.num_predict, 128);
  } finally {
    await server.close();
  }
});

test('chat() throws on http 500 with the body in the error message', async () => {
  const server = await startFakeOllama();
  try {
    await assert.rejects(
      () => ollama.chat(
        { model: 'llama3.1:8b', messages: [{ role: 'user', content: 'x' }] },
        { baseURL: server.baseURL, fetchImpl: chatWithQuery(server.baseURL, '__forceStatus=500') }
      ),
      (err) => {
        assert.match(err.message, /http_500/);
        assert.match(err.message, /forced 500/);
        return true;
      }
    );
  } finally {
    await server.close();
  }
});

// =================================================================
// 3. chatJson() — chat + extractFirstJson
// =================================================================

test('chatJson() extracts JSON from a prose response', async () => {
  // The default client doesn't pass __echoContent. We need a custom
  // fetchImpl that injects it via a custom URL param. Simpler: rely
  // on the server's default "pong" content + use a fetchImpl that
  // sends a request that triggers a different content.
  // For this test, the server reads the chat request body and
  // echoes back __echoContent. We need to inject __echoContent into
  // the body before it hits the server. Use a fetchImpl that
  // rewrites the body.
  const server = await startFakeOllama();
  try {
    const injectEcho = (url, opts) => {
      const bodyObj = JSON.parse(opts.body);
      bodyObj.__echoContent = 'Here you go: {"answer": 42, "ok": true}';
      return fetch(url, { ...opts, body: JSON.stringify(bodyObj) });
    };
    const result = await ollama.chatJson(
      { model: 'llama3.1:8b', messages: [{ role: 'user', content: 'give me json' }] },
      { baseURL: server.baseURL, fetchImpl: injectEcho }
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.answer, 42);
    assert.equal(result.data.ok, true);
  } finally {
    await server.close();
  }
});

test('chatJson() returns ok:false with no_json_in_response when no JSON', async () => {
  const server = await startFakeOllama();
  try {
    const injectPlain = (url, opts) => {
      const bodyObj = JSON.parse(opts.body);
      bodyObj.__echoContent = 'Sorry, I cannot help with that.';
      return fetch(url, { ...opts, body: JSON.stringify(bodyObj) });
    };
    const result = await ollama.chatJson(
      { model: 'llama3.1:8b', messages: [{ role: 'user', content: 'just text' }] },
      { baseURL: server.baseURL, fetchImpl: injectPlain }
    );
    assert.equal(result.ok, false);
    assert.equal(result.error, 'no_json_in_response');
  } finally {
    await server.close();
  }
});

// =================================================================
// 4. embed() — POST /api/embeddings
// =================================================================

test('embed() returns the embedding vector from a real server', async () => {
  const server = await startFakeOllama();
  try {
    const result = await ollama.embed('hello world', { baseURL: server.baseURL });
    assert.equal(result.ok, true);
    assert.equal(result.model, 'nomic-embed-text');
    assert.equal(Array.isArray(result.embedding), true);
    assert.equal(result.embedding.length, 8);
    // The seed depends on text length ("hello world" = 11 chars)
    assert.equal(result.embedding[0], (11 * 1) % 100 / 100);
  } finally {
    await server.close();
  }
});

test('embed() returns ok:false on non-string input', async () => {
  const result = await ollama.embed(123);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'text_not_string');
});

// =================================================================
// 5. streamChat() — POST /api/chat (streaming NDJSON)
// =================================================================

test('streamChat() yields token + done events in order', async () => {
  const server = await startFakeOllama();
  try {
    const events = [];
    for await (const ev of streamChat({
      model: 'llama3.1:8b',
      messages: [{ role: 'user', content: 'hello' }]
    }, { baseURL: server.baseURL })) {
      events.push(ev);
    }
    // 3 token events + 1 done event
    assert.equal(events.length, 4);
    assert.equal(events[0].type, 'token');
    assert.equal(events[0].data, 'Hello');
    assert.equal(events[1].type, 'token');
    assert.equal(events[1].data, ', ');
    assert.equal(events[2].type, 'token');
    assert.equal(events[2].data, 'world!');
    assert.equal(events[3].type, 'done');
    assert.equal(events[3].data.model, 'llama3.1:8b');
    assert.equal(events[3].data.total_duration, 12345);
  } finally {
    await server.close();
  }
});

test('streamChat() correctly parses JSON split across chunks', async () => {
  // One full line, then the next line split mid-content across two chunks.
  const server = await startFakeOllama();
  try {
    const fullLine1 = JSON.stringify({ model: 'llama3.1:8b', message: { role: 'assistant', content: 'A' }, done: false }) + '\n';
    const fullLine2 = JSON.stringify({ model: 'llama3.1:8b', message: { role: 'assistant', content: 'B' }, done: false });
    const fullLine3 = JSON.stringify({ model: 'llama3.1:8b', message: { role: 'assistant', content: 'C' }, done: true });
    // Split line 2 mid-content: take everything up to and including the
    // opening quote of "B", then "B" lives in the next chunk.
    const splitAt = fullLine2.indexOf('"B"') + 1;
    const partA = fullLine2.slice(0, splitAt);
    const partB = fullLine2.slice(splitAt) + '\n';
    // Encode the chunks as base64.
    const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64');
    const chunksParam = [
      b64(fullLine1 + partA),
      b64(partB + fullLine3)
    ].join(',');
    const events = [];
    for await (const ev of streamChat({
      model: 'llama3.1:8b',
      messages: [{ role: 'user', content: 'x' }]
    }, { baseURL: server.baseURL, fetchImpl: chatWithQuery(server.baseURL, '__chunks=' + encodeURIComponent(chunksParam)) })) {
      events.push(ev);
    }
    const tokenContents = events.filter((e) => e.type === 'token').map((e) => e.data);
    assert.deepEqual(tokenContents, ['A', 'B', 'C']);
    assert.equal(events[events.length - 1].type, 'done');
  } finally {
    await server.close();
  }
});

test('streamChat() yields http_error on http 503', async () => {
  const server = await startFakeOllama();
  try {
    const events = [];
    for await (const ev of streamChat({
      model: 'llama3.1:8b',
      messages: [{ role: 'user', content: 'x' }]
    }, { baseURL: server.baseURL, fetchImpl: chatWithQuery(server.baseURL, '__forceStatus=503') })) {
      events.push(ev);
    }
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'error');
    assert.equal(events[0].data.code, 'http_error');
    assert.match(events[0].data.message, /http_503/);
  } finally {
    await server.close();
  }
});

test('streamChat() yields timeout error when the server hangs', async () => {
  const server = await startFakeOllama();
  try {
    const events = [];
    for await (const ev of streamChat({
      model: 'llama3.1:8b',
      messages: [{ role: 'user', content: 'x' }]
    }, { baseURL: server.baseURL, fetchImpl: chatWithQuery(server.baseURL, '__forceHang=1'), timeoutMs: 200 })) {
      events.push(ev);
      // Stop early if we got the error so the test doesn't hang.
      if (events[0] && events[0].type === 'error') break;
    }
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'error');
    assert.equal(events[0].data.code, 'timeout');
  } finally {
    await server.close();
  }
});

test('streamChat() yields invalid_request error when no model', async () => {
  // No server needed — the validation happens before the fetch.
  const events = [];
  for await (const ev of streamChat({
    model: '',
    messages: [{ role: 'user', content: 'x' }]
  }, { baseURL: 'http://127.0.0.1:1' /* will not be hit */ })) {
    events.push(ev);
  }
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].data.code, 'invalid_request');
});

test('streamChat() handles server that closes connection without done:true', async () => {
  // One line, no done:true. The client must still yield a done event at end-of-stream.
  const server = await startFakeOllama();
  try {
    const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64');
    const chunksParam = b64(
      JSON.stringify({ model: 'llama3.1:8b', message: { role: 'assistant', content: 'partial' }, done: false }) + '\n'
    );
    const events = [];
    for await (const ev of streamChat({
      model: 'llama3.1:8b',
      messages: [{ role: 'user', content: 'x' }]
    }, { baseURL: server.baseURL, fetchImpl: chatWithQuery(server.baseURL, '__chunks=' + encodeURIComponent(chunksParam)) })) {
      events.push(ev);
    }
    const tokenContents = events.filter((e) => e.type === 'token').map((e) => e.data);
    assert.deepEqual(tokenContents, ['partial']);
    const last = events[events.length - 1];
    assert.equal(last.type, 'done');
    // finalMeta is null because done:true was never seen; client falls back to req.model
    assert.equal(last.data.model, 'llama3.1:8b');
  } finally {
    await server.close();
  }
});

// =================================================================
// 6. Idempotency — same input twice → same output
// =================================================================

test('embed() is idempotent: same text yields the same vector', async () => {
  const server = await startFakeOllama();
  try {
    const a = await ollama.embed('idempotent test', { baseURL: server.baseURL });
    const b = await ollama.embed('idempotent test', { baseURL: server.baseURL });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.deepEqual(a.embedding, b.embedding);
  } finally {
    await server.close();
  }
});
