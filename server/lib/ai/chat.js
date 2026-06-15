/**
 * ai/chat — Stateless chat-call wrapper for the "Ask AI" +
 * batch-summarize surfaces.
 *
 * Two call shapes:
 *   - chatText({ system, user, temperature?, maxTokens? })
 *       → { ok, data, error, provider, model }
 *   - chatJson({ system, user, jsonSchema, ... })
 *       → { ok, data, error, provider, model }
 *
 * Pure orchestration: this module is a thin façade over
 * provider.callAI that:
 *   1. Validates the input shape (system + user must be
 *      non-empty strings).
 *   2. Surfaces the discriminated result verbatim — never
 *      throws on a provider failure.
 *   3. Caps `maxTokens` at 4096 (anything above is almost
 *      certainly a bug — LLM responses above 4 K tokens are
 *      for batch jobs, not chat).
 *   4. Normalises Armenian + emoji + Latin input untouched
 *      (the provider layer handles UTF-8).
 *
 * The route layer (server/app.js) wraps this with RBAC +
 * the org_id + an audit hook. The wrapper itself is pure
 * and has no I/O.
 */
'use strict';

const provider = require('./provider');

const MAX_TOKENS_CAP = 4096;
const MAX_USER_LEN = 64 * 1024; // 64 KB
const MAX_SYSTEM_LEN = 8 * 1024; // 8 KB

class ChatInputError extends Error {
  constructor(message) {
    super(`[CHAT_INPUT_INVALID] ${message}`);
    this.name = 'ChatInputError';
  }
}

/**
 * @param {unknown} v
 * @param {string} field
 * @param {number} max
 * @returns {string}
 */
function coerceString(v, field, max) {
  if (typeof v !== 'string') {
    throw new ChatInputError(`${field} must be a string`);
  }
  if (v.length === 0) {
    throw new ChatInputError(`${field} must not be empty`);
  }
  if (v.length > max) {
    throw new ChatInputError(`${field} length ${v.length} exceeds max ${max}`);
  }
  return v;
}

/**
 * Normalise a chat request. Throws ChatInputError on bad input.
 *
 * @param {unknown} req
 * @returns {{ system: string, user: string, temperature: number, maxTokens: number }}
 */
function normaliseChatRequest(req) {
  if (!req || typeof req !== 'object') {
    throw new ChatInputError('request body must be an object');
  }
  const r = /** @type {any} */ (req);
  const system = coerceString(r.system, 'system', MAX_SYSTEM_LEN);
  const user = coerceString(r.user, 'user', MAX_USER_LEN);
  let temperature = 0.2;
  if (typeof r.temperature === 'number' && !Number.isNaN(r.temperature)) {
    if (r.temperature < 0 || r.temperature > 2) {
      throw new ChatInputError(`temperature ${r.temperature} is out of [0, 2]`);
    }
    temperature = r.temperature;
  }
  let maxTokens = 1024;
  if (typeof r.maxTokens === 'number' && !Number.isNaN(r.maxTokens)) {
    if (r.maxTokens < 1 || r.maxTokens > MAX_TOKENS_CAP) {
      throw new ChatInputError(`maxTokens ${r.maxTokens} is out of [1, ${MAX_TOKENS_CAP}]`);
    }
    maxTokens = Math.floor(r.maxTokens);
  }
  return { system, user, temperature, maxTokens };
}

/**
 * @typedef {Object} NormalisedChatRequest
 * @property {string} system
 * @property {string} user
 * @property {number} temperature
 * @property {number} maxTokens
 */

/**
 * Run a text-in / text-out chat call. Returns the discriminated
 * result from provider.callAI verbatim.
 *
 * @param {unknown} req
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl]
 * @param {Object} [options.env]
 * @returns {Promise<import('./provider').CallAIResult>}
 */
async function chatText(req, options = {}) {
  let normalised;
  try {
    normalised = normaliseChatRequest(req);
  } catch (err) {
    if (err instanceof ChatInputError) {
      return { ok: false, error: err.message, provider: 'none' };
    }
    throw err;
  }
  return provider.callAI(
    {
      system: normalised.system,
      user: normalised.user,
      temperature: normalised.temperature,
      maxTokens: normalised.maxTokens
    },
    options
  );
}

/**
 * Run a text-in / JSON-out chat call (the schema is passed
 * to Ollama's `format` parameter for structured output).
 *
 * @param {unknown} req
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl]
 * @param {Object} [options.env]
 * @returns {Promise<import('./provider').CallAIResult>}
 */
async function chatJson(req, options = {}) {
  if (!req || typeof req !== 'object') {
    return { ok: false, error: '[CHAT_INPUT_INVALID] request body must be an object', provider: 'none' };
  }
  const r = /** @type {any} */ (req);
  if (r.jsonSchema && typeof r.jsonSchema !== 'object') {
    return { ok: false, error: '[CHAT_INPUT_INVALID] jsonSchema must be an object', provider: 'none' };
  }
  let normalised;
  try {
    normalised = normaliseChatRequest(req);
  } catch (err) {
    if (err instanceof ChatInputError) {
      return { ok: false, error: err.message, provider: 'none' };
    }
    throw err;
  }
  return provider.callAI(
    {
      system: normalised.system,
      user: normalised.user,
      jsonSchema: r.jsonSchema,
      temperature: normalised.temperature,
      maxTokens: normalised.maxTokens
    },
    options
  );
}

module.exports = {
  chatText,
  chatJson,
  normaliseChatRequest,
  ChatInputError,
  MAX_TOKENS_CAP,
  MAX_USER_LEN,
  MAX_SYSTEM_LEN
};
