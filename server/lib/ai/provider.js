/**
 * ai/provider — AI provider switch.
 *
 * Resolves which AI backend to use based on env, and exposes a
 * single `callAI()` that returns a discriminated result.
 *
 * Modes:
 *   - 'disabled' (default) → caller MUST handle the "no AI" path
 *   - 'anthropic' / 'openai' / 'ollama' → real call, may fail
 *   - 'auto' → first available key wins (anthropic, then openai,
 *     then ollama)
 *
 * On any failure (missing key, network, parse error) the
 * caller is expected to fall back to the deterministic rules.
 * The provider NEVER throws — it returns a discriminated result
 * so the fallback path is explicit and testable.
 *
 * The Vercel AI SDK wrapper from MAX is gone. The 'ollama'
 * branch hits the local Ollama server via the direct HTTP
 * client. The 'anthropic' / 'openai' branches are stubs that
 * return a clean `not_implemented` error so the contract is
 * identical across providers — wire them up to the
 * `@ai-sdk/anthropic` / `@ai-sdk/openai` packages when those
 * secrets are present (the SMB-CRM MAX env wires them up; ANT
 * stays sovereign and uses Ollama only for now).
 *
 * Pure: no DB import. The fetch impl is injected.
 */
'use strict';

const ollama = require('./ollama-client');
const { extractFirstJson } = require('./json-extract');

const DEFAULT_TIMEOUT_MS = 30_000;

/** @typedef {'anthropic'|'openai'|'ollama'|'none'} AIProviderName */

/**
 * @typedef {Object} CallAIRequest
 * @property {string} system
 * @property {string} user
 * @property {Record<string, unknown>} [jsonSchema]  optional Ollama `format` schema
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 */

/**
 * @typedef {Object} CallAIResult
 * @property {boolean} ok
 * @property {unknown} [data]
 * @property {string} [error]
 * @property {AIProviderName} provider
 * @property {string} [model]
 */

/**
 * @param {Object} [env]
 * @returns {AIProviderName}
 */
function resolveProvider(env) {
  const src = env || (typeof process !== 'undefined' ? process.env : {});
  const pref = String(src.AI_PROVIDER || 'disabled').toLowerCase();
  if (pref === 'disabled' || pref === 'none' || pref === '') return 'none';
  if (pref === 'anthropic') return src.ANTHROPIC_API_KEY ? 'anthropic' : 'none';
  if (pref === 'openai') return src.OPENAI_API_KEY ? 'openai' : 'none';
  if (pref === 'ollama') return 'ollama';
  if (pref === 'auto') {
    if (src.ANTHROPIC_API_KEY) return 'anthropic';
    if (src.OPENAI_API_KEY) return 'openai';
    return 'ollama';
  }
  return 'none';
}

/**
 * @param {CallAIRequest} req
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl]
 * @param {Object} [options.env]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<CallAIResult>}
 */
async function callAI(req, options = {}) {
  if (!req || typeof req.system !== 'string' || typeof req.user !== 'string') {
    return { ok: false, error: 'invalid_request: system and user strings are required', provider: 'none' };
  }
  const provider = resolveProvider(options.env);
  if (provider === 'none') {
    return { ok: false, error: 'no_provider', provider };
  }
  if (provider === 'ollama') {
    return callOllama(req, options);
  }
  // anthropic + openai are not wired on ANT (sovereign mode
  // uses Ollama only). The contract is preserved so the SPA
  // gets a clean error to surface.
  return {
    ok: false,
    error: `not_implemented_on_ant:${provider}`,
    provider,
    model: provider === 'anthropic' ? 'claude' : 'gpt-4o-mini'
  };
}

/**
 * @param {CallAIRequest} req
 * @param {Object} options
 * @returns {Promise<CallAIResult>}
 */
async function callOllama(req, options) {
  const env = options.env || (typeof process !== 'undefined' ? process.env : {});
  const model = ollama.resolveChatModel(env);
  const baseURL = ollama.resolveBaseURL(env);
  const timeoutMs = options.timeoutMs == null ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  const systemPrompt = req.system +
    '\n\nYou MUST respond with valid JSON. No prose, no markdown fences.';

  const ollamaReq = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: req.user }
    ],
    stream: false
  };
  if (req.jsonSchema && typeof req.jsonSchema === 'object') {
    ollamaReq.format = req.jsonSchema;
  }
  if (typeof req.temperature === 'number') ollamaReq.temperature = req.temperature;
  if (typeof req.maxTokens === 'number') ollamaReq.maxTokens = req.maxTokens;

  const result = await ollama.chatJson(ollamaReq, {
    fetchImpl: options.fetchImpl,
    baseURL,
    timeoutMs,
    fallback: null
  });
  if (!result.ok) {
    return { ok: false, error: result.error, provider: 'ollama', model: result.model };
  }
  return { ok: true, data: result.data, provider: 'ollama', model: result.model };
}

/**
 * Compute an embedding. Always hits Ollama. Returns the
 * discriminated result.
 *
 * @param {string} text
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl]
 * @param {Object} [options.env]
 * @returns {Promise<{ ok: boolean, embedding?: number[], model?: string, error?: string }>}
 */
async function embed(text, options = {}) {
  if (typeof text !== 'string') {
    return { ok: false, error: 'text_not_string' };
  }
  const env = options.env || (typeof process !== 'undefined' ? process.env : {});
  const result = await ollama.embed(text, {
    fetchImpl: options.fetchImpl,
    baseURL: ollama.resolveBaseURL(env),
    model: ollama.resolveEmbedModel(env)
  });
  if (!result.ok) {
    return { ok: false, error: result.error, model: result.model };
  }
  return { ok: true, embedding: result.embedding, model: result.model };
}

/**
 * Probe the local Ollama server. Returns whether the server
 * is reachable, the base URL, and the list of installed model
 * names. Used by the /api/ai/status route.
 *
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl]
 * @param {Object} [options.env]
 * @returns {Promise<{ ok: boolean, baseURL: string, models: string[], provider: AIProviderName, error?: string }>}
 */
async function health(options = {}) {
  const env = options.env || (typeof process !== 'undefined' ? process.env : {});
  const provider = resolveProvider(env);
  if (provider !== 'ollama') {
    return {
      ok: provider !== 'none',
      baseURL: '',
      models: [],
      provider,
      error: provider === 'none' ? 'no_provider' : `not_local:${provider}`
    };
  }
  const r = await ollama.health({
    fetchImpl: options.fetchImpl,
    baseURL: ollama.resolveBaseURL(env)
  });
  return { ...r, provider };
}

module.exports = {
  resolveProvider,
  callAI,
  embed,
  health,
  // Re-export the extractor for callers that want it
  extractFirstJson
};
