/**
 * ai/stream-handler — Fastify handler for the
 * POST /api/ai/chat/stream route.
 *
 * Accepts the same body as /api/ai/chat
 * ({ system, user, temperature?, maxTokens?, jsonSchema? })
 * and returns an NDJSON stream of events:
 *   { type: 'token', data: '...' }        — one chunk of generated text
 *   { type: 'done',  data: { model, total_duration, ... } }  — terminal
 *   { type: 'error', data: { code, message } }               — terminal
 *
 * The handler never closes the response on its own; the
 * engine emits a `done` event as the final NDJSON line and
 * Fastify then closes the response. The SPA consumes the
 * body with a streaming reader and reads until done.
 *
 * Pure: takes the parsed request + an auth context, returns
 * the Fastify handler closure. No module-level state.
 */
'use strict';

const { Readable } = require('node:stream');

const { streamChat } = require('./ollama-stream');

/**
 * Build a Fastify handler that streams Ollama responses back
 * to the SPA as NDJSON.
 *
 * @param {Object} deps
 * @param {Function} [deps.requireIntegrationWriter]  RBAC guard
 * @param {Function} [deps.audit]                    audit hook (db, org, user, type, payload)
 * @returns {Function}  Fastify route handler
 */
function buildStreamChatHandler(deps = {}) {
  const requireIntegrationWriter = deps.requireIntegrationWriter || ((user) => {
    if (!user || !['Owner', 'Admin'].includes(user.role)) {
      const err = new Error('Integration writer role required');
      err.statusCode = 403;
      throw err;
    }
  });
  const audit = deps.audit || (() => {});

  return async function streamChatRoute(request, reply) {
    const user = await this.auth(request);
    requireIntegrationWriter(user);
    const body = request.body || {};

    // Reuse chat.js's normaliseChatRequest for input validation.
    const chat = require('./chat');
    let normalised;
    try {
      normalised = chat.normaliseChatRequest(body);
    } catch (err) {
      // chat.js throws ChatInputError on bad input. Emit as a
      // single error NDJSON event so the SPA can render the
      // message inline (instead of getting a 4xx + empty body).
      reply.type('application/x-ndjson');
      const buf = Buffer.from(
        JSON.stringify({
          type: 'error',
          data: { code: 'invalid_request', message: err.message }
        }) + '\n'
      );
      audit(null, user.org_id, user.id, 'ai.chat_stream', {
        ok: false,
        error: err.message
      });
      return reply.send(buf);
    }

    const providerMod = require('./provider');
    const provider = providerMod.resolveProvider(process.env);

    // Only ollama is wired for streaming on ANT. anthropic/openai
    // are sentinels; disabled returns no_provider.
    if (provider !== 'ollama') {
      reply.type('application/x-ndjson');
      const code = provider === 'none' ? 'no_provider' : `not_streaming:${provider}`;
      const buf = Buffer.from(
        JSON.stringify({
          type: 'error',
          data: { code, message: `streaming is only wired for ollama on ANT (got ${provider})` }
        }) + '\n'
      );
      audit(null, user.org_id, user.id, 'ai.chat_stream', { provider, ok: false, error: code });
      return reply.send(buf);
    }

    // Resolve the ollama model + baseURL from env (same
    // resolution as provider.callOllama → ollama-client). The
    // provider module re-exports these via the ollama client
    // (it doesn't expose `resolveChatModel` / `resolveBaseURL`
    // directly — those live in `./ollama-client`).
    const ollamaClient = require('./ollama-client');
    const model = ollamaClient.resolveChatModel(process.env);
    const baseURL = ollamaClient.resolveBaseURL(process.env).replace(/\/+$/, '');

    // Build the Ollama messages array (system + user).
    const messages = [
      { role: 'system', content: normalised.system + '\n\nYou MUST respond with valid JSON. No prose, no markdown fences.' },
      { role: 'user', content: normalised.user }
    ];
    const ollamaReq = {
      model,
      messages,
      temperature: normalised.temperature,
      maxTokens: normalised.maxTokens
    };
    if (body.jsonSchema && typeof body.jsonSchema === 'object') {
      ollamaReq.format = body.jsonSchema;
    }

    reply.type('application/x-ndjson');
    // Start an audit immediately so the per-tenant trail
    // captures the call even if the stream errors.
    audit(null, user.org_id, user.id, 'ai.chat_stream', {
      provider,
      model,
      ok: true
    });

    // Convert the async generator to a Node Readable that
    // emits one NDJSON line per event. The 'data' field is
    // a Buffer; the Readable serialises each chunk as-is.
    const gen = streamChat(ollamaReq, { baseURL });
    const readable = Readable.from((async function* () {
      for await (const ev of gen) {
        yield JSON.stringify(ev) + '\n';
      }
    })());
    return reply.send(readable);
  };
}

module.exports = { buildStreamChatHandler };
