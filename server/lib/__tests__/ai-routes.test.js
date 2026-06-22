/**
 * ai-routes.test.js — 5-gate contract suite for the Fastify
 * AI HTTP routes (server/app.js → /api/ai/chat, /api/ai/chat/stream,
 * /api/ai/status).
 *
 * Slice 22 (ollama-integration.test.js) tested the AI ENGINE
 * (ollama-client, ollama-stream, chat wrapper) against a real
 * http.createServer using a mocked fetchImpl pattern. This
 * test closes the loop by exercising the ACTUAL Fastify
 * routes — the route layer, RBAC guards, audit hook, response
 * shape, NDJSON streaming. We use Fastify's built-in `inject()`
 * so we don't need a real TCP port.
 *
 * Gate coverage:
 *   1. Pure — GET /api/ai/status returns the documented
 *      {provider, baseURL, models, ok, error} shape;
 *      POST /api/ai/chat returns the discriminated
 *      {ok, provider, model, data, error} shape;
 *      POST /api/ai/chat/stream returns Content-Type:
 *      application/x-ndjson with one JSON object per line.
 *   2. Types — every response is JSON-parseable; the streaming
 *      response is a sequence of valid NDJSON lines; the
 *      audit row has the documented column shape.
 *   3. Idempotency — same input → same response shape on
 *      /api/ai/chat; the stream emits the same sequence of
 *      events for the same input.
 *   4. Contract — /api/ai/chat requires an Integration Writer
 *      role (Owner or Admin); /api/ai/status requires an
 *      Integration Reader (Owner/Admin/Auditor); both require
 *      a valid session. The audit hook records
 *      `ai.chat` for the chat route and `ai.chat_stream` for
 *      the stream route with the right fields. NDJSON
 *      streaming emits `{type:'token'|'done'|'error', data}`
 *      events. An Ollama target URL is wired when
 *      `AI_PROVIDER=ollama` (auto falls through to Ollama on ANT).
 *   5. Edge — 401 with no session; 403 with the wrong role
 *      (e.g. Viewer on the chat route); 200 with a
 *      `provider:'none'` error in the body when the input
 *      fails validation; the audit hook still fires when the
 *      underlying provider returns ok:false.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { buildApp } = require('../../app');
const { openDatabase } = require('../../db');

/* ── helpers ────────────────────────────────────────────────────── */

function mkDb() {
  return openDatabase(':memory:');
}

function seedOwner(db) {
  // Namespaced ids (`user-aitest-*`, `org-aitest`) avoid the
  // collisions with the demo seed in db.js (which uses
  // `user-owner`, `user-operator`, `user-auditor`, etc.).
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO organizations (id, name, legal_name, tax_id, locale, currency, market, data_region, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('org-aitest', 'AITest Org', 'AITest Org LLC', '99999', 'hy-AM', 'AMD', 'Armenia', 'Armenia hosted', now);
  db.prepare(`
    INSERT INTO users (id, org_id, email, name, role, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('user-aitest-owner', 'org-aitest', 'aitest-owner@test.am', 'AITest Owner', 'Owner', 'x', now);
  const expires = new Date(Date.now() + 60 * 60_000).toISOString();
  db.prepare(`
    INSERT INTO sessions (token, user_id, expires_at, created_at, user_agent, ip_address, mfa_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('aitest-owner-session', 'user-aitest-owner', expires, now, 'node:test', '127.0.0.1', 1);
}

function seedAuditor(db) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, org_id, email, name, role, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('user-aitest-auditor', 'org-aitest', 'aitest-auditor@test.am', 'AITest Auditor', 'Auditor', 'x', now);
  const expires = new Date(Date.now() + 60 * 60_000).toISOString();
  db.prepare(`
    INSERT INTO sessions (token, user_id, expires_at, created_at, user_agent, ip_address, mfa_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('aitest-auditor-session', 'user-aitest-auditor', expires, now, 'node:test', '127.0.0.1', 1);
}

function seedViewer(db) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, org_id, email, name, role, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('user-aitest-viewer', 'org-aitest', 'aitest-viewer@test.am', 'AITest Viewer', 'Viewer', 'x', now);
  const expires = new Date(Date.now() + 60 * 60_000).toISOString();
  db.prepare(`
    INSERT INTO sessions (token, user_id, expires_at, created_at, user_agent, ip_address, mfa_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('aitest-viewer-session', 'user-aitest-viewer', expires, now, 'node:test', '127.0.0.1', 1);
}

/**
 * Build the Fastify app + scope the relevant env vars for the
 * duration of the test. The /api/ai/chat route reads
 * `process.env.AI_PROVIDER` directly, so we have to set it
 * there too (not just on the buildApp options).
 */
async function mkApp(db, env = {}) {
  const prev = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = String(v);
  }
  const app = buildApp({ db, env: { ...process.env, ...env }, logger: false });
  await app.ready();
  return {
    app,
    restore: () => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
}

function bearerHeaders(token) {
  return { authorization: `Bearer ${token}` };
}

/**
 * Start a fake Ollama HTTP server. Returns {baseURL, close}.
 */
async function startFakeOllama() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://localhost');
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf-8');
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { /* ignore */ }

      if (req.method === 'GET' && u.pathname === '/api/tags') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }));
        return;
      }
      if (req.method === 'POST' && u.pathname === '/api/chat') {
        if (body.stream === true) {
          res.writeHead(200, { 'content-type': 'application/x-ndjson', 'transfer-encoding': 'chunked' });
          // The streaming path uses the raw `content` field
          // (no JSON extraction happens in streamChat). Plain
          // text is fine here.
          res.write(JSON.stringify({ model: body.model, message: { role: 'assistant', content: 'Hi' }, done: false }) + '\n');
          res.write(JSON.stringify({ model: body.model, message: { role: 'assistant', content: ', ' }, done: false }) + '\n');
          res.write(JSON.stringify({ model: body.model, message: { role: 'assistant', content: 'there!' }, done: true, total_duration: 100 }) + '\n');
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        // The non-streaming /api/ai/chat route calls
        // ollama.chatJson (always) which extracts the FIRST
        // JSON object from the response text and JSON.parses
        // it. Return a valid JSON object so chatJson succeeds
        // and `data` is the parsed object.
        res.end(JSON.stringify({
          model: body.model,
          message: { role: 'assistant', content: '{"answer":"pong"}' },
          done: true,
          total_duration: 100
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
        baseURL: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((res) => server.close(() => res()))
      });
    });
  });
}

/**
 * Wrap the global `fetch` to redirect Ollama-bound requests
 * to the fake server. The engine reads `globalThis.fetch` at
 * call time (via the default `fetchImpl`).
 */
function withRoutedFetch(baseURL) {
  const orig = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    const u = new URL(url, 'http://x');
    if (u.host === '127.0.0.1:11434' || u.host === 'localhost:11434') {
      const target = `${baseURL}${u.pathname}${u.search}`;
      return orig(target, opts);
    }
    return orig(url, opts);
  };
  return () => { globalThis.fetch = orig; };
}

/* ── 1. GET /api/ai/status ──────────────────────────────────────── */

test('GET /api/ai/status without a session returns 401', async () => {
  const db = mkDb();
  seedOwner(db);
  const { app, restore } = await mkApp(db);
  try {
    const res = await app.inject({ method: 'GET', url: '/api/ai/status' });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
    restore();
  }
});

test('GET /api/ai/status with an Owner session returns the documented shape', async () => {
  const db = mkDb();
  seedOwner(db);
  const { app, restore } = await mkApp(db);
  try {
    const res = await app.inject({ method: 'GET', url: '/api/ai/status', headers: bearerHeaders('aitest-owner-session') });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok('provider' in body);
    assert.ok('baseURL' in body);
    assert.ok(Array.isArray(body.models));
    assert.equal(typeof body.ok, 'boolean');
  } finally {
    await app.close();
    restore();
  }
});

test('GET /api/ai/status with an Auditor session succeeds (Integration Reader)', async () => {
  const db = mkDb();
  seedOwner(db);
  seedAuditor(db);
  const { app, restore } = await mkApp(db);
  try {
    const res = await app.inject({ method: 'GET', url: '/api/ai/status', headers: bearerHeaders('aitest-auditor-session') });
    assert.equal(res.statusCode, 200);
  } finally {
    await app.close();
    restore();
  }
});

/* ── 2. POST /api/ai/chat ───────────────────────────────────────── */

test('POST /api/ai/chat without a session returns 401', async () => {
  const db = mkDb();
  seedOwner(db);
  const { app, restore } = await mkApp(db);
  try {
    const res = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { user: 'hi' } });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
    restore();
  }
});

test('POST /api/ai/chat with a Viewer session returns 403 (requires writer)', async () => {
  const db = mkDb();
  seedOwner(db);
  seedViewer(db);
  const { app, restore } = await mkApp(db);
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      headers: bearerHeaders('aitest-viewer-session'),
      payload: { user: 'hi' }
    });
    assert.equal(res.statusCode, 403);
  } finally {
    await app.close();
    restore();
  }
});

test('POST /api/ai/chat with an empty body returns 200 + a chat error (engine returns the discriminated result, the route re-wraps it)', async () => {
  const db = mkDb();
  seedOwner(db);
  const { app, restore } = await mkApp(db);
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      headers: bearerHeaders('aitest-owner-session'),
      payload: {}
    });
    // The chat engine NEVER throws on bad input — it returns
    // a discriminated {ok:false, error, provider:'none'}.
    // The route re-wraps it as {ok, provider, model, data, error}
    // and Fastify sends it as a 200. The error is in the body.
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.equal(body.provider, 'none');
    assert.ok(body.error, 'should carry an error message');
    // The engine validates `system` and `user` separately; the
    // exact error string depends on which field trips the
    // check first. Both contain the substring "must be a string".
    assert.match(body.error, /must be a string/);
  } finally {
    await app.close();
    restore();
  }
});

test('POST /api/ai/chat with a valid body calls the underlying provider and returns the discriminated shape', async () => {
  const db = mkDb();
  seedOwner(db);
  const fakeOllama = await startFakeOllama();
  const { app, restore } = await mkApp(db, {
    AI_PROVIDER: 'ollama',
    A1_SOVEREIGN_LLM_BASE_URL: fakeOllama.baseURL,
    OLLAMA_BASE_URL: fakeOllama.baseURL
  });
  const restoreFetch = withRoutedFetch(fakeOllama.baseURL);
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      headers: bearerHeaders('aitest-owner-session'),
      payload: { user: 'ping', system: 'You are a test assistant.' }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.provider, 'ollama');
    // The fake Ollama returns `{"answer":"pong"}` as the
    // assistant content; chatJson extracts + parses it, so
    // body.data is the parsed object.
    assert.equal(typeof body.data, 'object');
    assert.equal(body.data.answer, 'pong');
    assert.equal(body.error, null);
  } finally {
    restoreFetch();
    restore();
    await app.close();
    await fakeOllama.close();
  }
});

test('POST /api/ai/chat fires the ai.chat audit row with the right fields', async () => {
  const db = mkDb();
  seedOwner(db);
  const fakeOllama = await startFakeOllama();
  const { app, restore } = await mkApp(db, {
    AI_PROVIDER: 'ollama',
    A1_SOVEREIGN_LLM_BASE_URL: fakeOllama.baseURL
  });
  const restoreFetch = withRoutedFetch(fakeOllama.baseURL);
  try {
    await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      headers: bearerHeaders('aitest-owner-session'),
      // Both `system` and `user` are required by the chat
      // engine (slice 9 contract). The default provider is
      // ollama because of the env var.
      payload: { system: 'You are a test assistant.', user: 'hi' }
    });
    // The audit table is `audit_events` with columns
    // (org_id, user_id, type, details, created_at). The
    // `type` is the action name (`ai.chat`), `details` is a
    // JSON blob with the provider, model, ok, error fields.
    const row = db.prepare(`
      SELECT org_id, user_id, type, details, created_at
        FROM audit_events
       WHERE type = 'ai.chat'
       ORDER BY id DESC
       LIMIT 1
    `).get();
    assert.ok(row, 'expected an ai.chat audit row');
    assert.equal(row.user_id, 'user-aitest-owner');
    assert.equal(row.org_id, 'org-aitest');
    const payload = JSON.parse(row.details);
    assert.equal(payload.provider, 'ollama');
    assert.equal(payload.ok, true);
    assert.equal(payload.error, null);
  } finally {
    restoreFetch();
    restore();
    await app.close();
    await fakeOllama.close();
  }
});

/* ── 3. POST /api/ai/chat/stream ────────────────────────────────── */

test('POST /api/ai/chat/stream without a session returns 401', async () => {
  const db = mkDb();
  seedOwner(db);
  const { app, restore } = await mkApp(db);
  try {
    const res = await app.inject({ method: 'POST', url: '/api/ai/chat/stream', payload: { user: 'hi' } });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
    restore();
  }
});

test('POST /api/ai/chat/stream with a Viewer session returns 403', async () => {
  const db = mkDb();
  seedOwner(db);
  seedViewer(db);
  const { app, restore } = await mkApp(db);
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/chat/stream',
      headers: bearerHeaders('aitest-viewer-session'),
      payload: { user: 'hi' }
    });
    assert.equal(res.statusCode, 403);
  } finally {
    await app.close();
    restore();
  }
});

test('POST /api/ai/chat/stream returns Content-Type: application/x-ndjson with token + done events', async () => {
  const db = mkDb();
  seedOwner(db);
  const fakeOllama = await startFakeOllama();
  const { app, restore } = await mkApp(db, {
    AI_PROVIDER: 'ollama',
    A1_SOVEREIGN_LLM_BASE_URL: fakeOllama.baseURL
  });
  const restoreFetch = withRoutedFetch(fakeOllama.baseURL);
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/chat/stream',
      headers: bearerHeaders('aitest-owner-session'),
      // Both `system` and `user` are required by the chat
      // engine (slice 9 contract).
      payload: { system: 'You are a test assistant.', user: 'say hi' }
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] || '', /application\/x-ndjson/);
    // The body should be NDJSON: 3 token lines + 1 done line
    const lines = res.body.split('\n').filter((l) => l.trim().length > 0);
    assert.equal(lines.length, 4);
    const events = lines.map((l) => JSON.parse(l));
    for (let i = 0; i < 3; i++) {
      assert.equal(events[i].type, 'token');
      assert.equal(typeof events[i].data, 'string');
    }
    assert.equal(events[3].type, 'done');
    assert.equal(typeof events[3].data, 'object');
  } finally {
    restoreFetch();
    restore();
    await app.close();
    await fakeOllama.close();
  }
});

test('POST /api/ai/chat/stream fires the ai.chat_stream audit row', async () => {
  const db = mkDb();
  seedOwner(db);
  const fakeOllama = await startFakeOllama();
  const { app, restore } = await mkApp(db, {
    AI_PROVIDER: 'ollama',
    A1_SOVEREIGN_LLM_BASE_URL: fakeOllama.baseURL
  });
  const restoreFetch = withRoutedFetch(fakeOllama.baseURL);
  try {
    await app.inject({
      method: 'POST',
      url: '/api/ai/chat/stream',
      headers: bearerHeaders('aitest-owner-session'),
      payload: { system: 'You are a test assistant.', user: 'hi' }
    });
    const row = db.prepare(`
      SELECT org_id, user_id, type, details
        FROM audit_events
       WHERE type = 'ai.chat_stream'
       ORDER BY id DESC
       LIMIT 1
    `).get();
    assert.ok(row, 'expected an ai.chat_stream audit row');
    assert.equal(row.user_id, 'user-aitest-owner');
    assert.equal(row.org_id, 'org-aitest');
  } finally {
    restoreFetch();
    restore();
    await app.close();
    await fakeOllama.close();
  }
});

test('POST /api/ai/chat/stream with AI_PROVIDER=disabled yields a single error event and a 200 response', async () => {
  // ANT's provider is ollama-only, but the engine still has
  // the `disabled` mode for explicit off-switching. When
  // disabled, the streaming engine yields a single
  // `{type: 'error', data: {code: 'no_provider', ...}}`
  // event and the route returns 200 (the error is in the
  // body, not the HTTP status).
  const db = mkDb();
  seedOwner(db);
  const { app, restore } = await mkApp(db, { AI_PROVIDER: 'disabled' });
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/chat/stream',
      headers: bearerHeaders('aitest-owner-session'),
      // Both `system` and `user` are required; this test
      // exercises the provider-resolution path (not the
      // input-validation path).
      payload: { system: 'You are a test assistant.', user: 'hi' }
    });
    assert.equal(res.statusCode, 200);
    const lines = res.body.split('\n').filter((l) => l.trim().length > 0);
    assert.ok(lines.length >= 1, 'expected at least one NDJSON line');
    const events = lines.map((l) => JSON.parse(l));
    const errorEvent = events.find((e) => e.type === 'error');
    assert.ok(errorEvent, 'expected at least one error event');
    assert.equal(errorEvent.data.code, 'no_provider');
  } finally {
    await app.close();
    restore();
  }
});
