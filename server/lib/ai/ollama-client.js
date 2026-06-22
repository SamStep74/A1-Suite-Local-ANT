/**
 * ai/ollama-client — Direct HTTP client for a local Ollama server.
 *
 * Why direct HTTP instead of the Vercel AI SDK? ANT is a
 * single-process, no-Docker, no-Vercel-runtime codebase. We
 * hit Ollama's /api/chat, /api/embeddings, and /api/tags
 * endpoints directly. The shape is simple JSON, and the
 * `format: { type: 'object', ... }` field gives us
 * schema-constrained generation for free.
 *
 * The contract is provider-agnostic (CallAIRequest /
 * CallAIResult in ./provider.js). This client is the
 * implementation behind the 'ollama' provider name.
 *
 * All endpoints are SOVEREIGN (localhost by default;
 * A1_SOVEREIGN_LLM_BASE_URL or OLLAMA_BASE_URL override
 * allow a private LLM gateway on the LAN). The base URL is
 * NEVER sent to a third party.
 *
 * Pure: no DB import, no module-level state. Every call takes
 * its dependencies as args (fetchImpl + baseURL).
 */
'use strict';

const { extractFirstJson } = require('./json-extract');

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_EMBED_TIMEOUT_MS = 60_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;

/**
 * Resolve the Ollama base URL from env / options.
 * @param {Object} [env]
 * @returns {string}
 */
function resolveBaseURL(env) {
  const src = env || (typeof process !== 'undefined' ? process.env : {});
  const raw = src.A1_SOVEREIGN_LLM_BASE_URL || src.OLLAMA_BASE_URL || DEFAULT_BASE_URL;
  return String(raw).replace(/\/+$/, '');
}

/**
 * @param {Object} [env]
 * @returns {string}
 */
function resolveChatModel(env) {
  const src = env || (typeof process !== 'undefined' ? process.env : {});
  return src.OLLAMA_MODEL || 'llama3.1:8b';
}

/**
 * @param {Object} [env]
 * @returns {string}
 */
function resolveEmbedModel(env) {
  const src = env || (typeof process !== 'undefined' ? process.env : {});
  return src.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
}

/**
 * @typedef {Object} OllamaChatMessage
 * @property {'system'|'user'|'assistant'} role
 * @property {string} content
 */

/**
 * @typedef {Object} OllamaChatRequest
 * @property {string} model
 * @property {OllamaChatMessage[]} messages
 * @property {Record<string, unknown>} [format]  JSON schema for structured output
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {boolean} [stream]  default false
 */

/**
 * @typedef {Object} OllamaChatResponse
 * @property {{ role: string, content: string }} message
 * @property {boolean} done
 * @property {string} [model]
 * @property {Object<string, number>} [usage]
 */

/**
 * Send a chat request to Ollama.
 * @param {OllamaChatRequest} req
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl]
 * @param {string} [options.baseURL]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<OllamaChatResponse>}
 */
async function chat(req, options = {}) {
  if (!req || !req.model || !Array.isArray(req.messages) || req.messages.length === 0) {
    throw new Error('ollama.chat: model and a non-empty messages array are required');
  }
  const fetchImpl = options.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl) throw new Error('ollama.chat: no fetch implementation available');
  const baseURL = (options.baseURL || resolveBaseURL(options.env)).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs == null ? DEFAULT_TIMEOUT_MS : options.timeoutMs;

  const body = {
    model: req.model,
    messages: req.messages,
    stream: req.stream === true
  };
  if (req.format && typeof req.format === 'object') body.format = req.format;
  const options2 = {};
  if (typeof req.temperature === 'number') options2.temperature = req.temperature;
  if (typeof req.maxTokens === 'number') options2.num_predict = req.maxTokens;
  if (Object.keys(options2).length > 0) body.options = options2;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${baseURL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = `http_${res.status}`;
    try {
      const text = await res.text();
      detail += `:${text.slice(0, 200)}`;
    } catch { /* ignore */ }
    throw new Error(`ollama.chat: ${detail}`);
  }
  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new Error(`ollama.chat: json_parse_failed: ${(err && err.message) || err}`);
  }
  return /** @type {OllamaChatResponse} */ (json);
}

/**
 * Send a chat request and parse the response as JSON.
 * Tolerant of leading prose + markdown fences via extractFirstJson.
 *
 * @param {OllamaChatRequest} req
 * @param {Object} [options]  same as chat() plus `fallback`
 * @returns {Promise<{ ok: boolean, data: unknown, model: string, raw: string, error?: string }>}
 */
async function chatJson(req, options = {}) {
  const fallback = options.fallback;
  try {
    const res = await chat(req, options);
    const raw = (res && res.message && typeof res.message.content === 'string')
      ? res.message.content
      : '';
    const json = extractFirstJson(raw);
    if (!json) {
      return { ok: false, data: fallback, model: res.model || req.model, raw, error: 'no_json_in_response' };
    }
    try {
      return { ok: true, data: JSON.parse(json), model: res.model || req.model, raw };
    } catch (err) {
      return { ok: false, data: fallback, model: res.model || req.model, raw, error: 'json_parse_failed: ' + (err && err.message) };
    }
  } catch (err) {
    return { ok: false, data: fallback, model: req.model, raw: '', error: (err && err.message) || String(err) };
  }
}

/**
 * Compute an embedding vector for a single text. Returns
 * {ok, embedding, model, error}.
 *
 * @param {string} text
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl]
 * @param {string} [options.baseURL]
 * @param {string} [options.model]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ ok: boolean, embedding: number[], model: string, error?: string }>}
 */
async function embed(text, options = {}) {
  if (typeof text !== 'string') {
    return { ok: false, embedding: [], model: options.model || resolveEmbedModel(options.env), error: 'text_not_string' };
  }
  const fetchImpl = options.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl) return { ok: false, embedding: [], model: options.model || '', error: 'no_fetch' };
  const baseURL = (options.baseURL || resolveBaseURL(options.env)).replace(/\/+$/, '');
  const model = options.model || resolveEmbedModel(options.env);
  const timeoutMs = options.timeoutMs == null ? DEFAULT_EMBED_TIMEOUT_MS : options.timeoutMs;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${baseURL}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
      signal: ctrl.signal
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    return { ok: false, embedding: [], model, error: `http_${res.status}` };
  }
  let json;
  try {
    json = await res.json();
  } catch (err) {
    return { ok: false, embedding: [], model, error: 'json_parse_failed: ' + ((err && err.message) || err) };
  }
  const embedding = Array.isArray(json && json.embedding) ? json.embedding : [];
  if (embedding.length === 0) {
    return { ok: false, embedding, model, error: 'empty_embedding' };
  }
  return { ok: true, embedding, model };
}

/**
 * Probe Ollama's /api/tags endpoint to see if the server is
 * reachable and what models are installed. Used by the
 * /api/ai/status route to surface "is my local LLM up?" without
 * making a real generation request.
 *
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl]
 * @param {string} [options.baseURL]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ ok: boolean, baseURL: string, models: string[], error?: string }>}
 */
async function health(options = {}) {
  const fetchImpl = options.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const baseURL = (options.baseURL || resolveBaseURL(options.env)).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs == null ? DEFAULT_HEALTH_TIMEOUT_MS : options.timeoutMs;
  if (!fetchImpl) return { ok: false, baseURL, models: [], error: 'no_fetch' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${baseURL}/api/tags`, { signal: ctrl.signal });
  } catch (err) {
    clearTimeout(timer);
    const name = err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || 'network_error';
    return { ok: false, baseURL, models: [], error: name };
  }
  clearTimeout(timer);
  if (!res.ok) {
    return { ok: false, baseURL, models: [], error: `http_${res.status}` };
  }
  let json;
  try {
    json = await res.json();
  } catch (err) {
    return { ok: false, baseURL, models: [], error: 'json_parse_failed: ' + ((err && err.message) || err) };
  }
  const models = Array.isArray(json && json.models)
    ? json.models.map((m) => (m && typeof m.name === 'string' ? m.name : '')).filter((s) => s.length > 0)
    : [];
  return { ok: true, baseURL, models };
}

module.exports = {
  // Resolvers
  resolveBaseURL,
  resolveChatModel,
  resolveEmbedModel,
  // Core
  chat,
  chatJson,
  embed,
  health
};
