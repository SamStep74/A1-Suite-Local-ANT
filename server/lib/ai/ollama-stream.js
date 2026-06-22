/**
 * ai/ollama-stream — AsyncIterable adapter over Ollama's
 * `stream: true` chat response.
 *
 * Ollama returns newline-delimited JSON when stream:true.
 * Each line is a ChatResponse-shaped object with the
 * `message.content` field containing the next chunk of
 * generated text. The final line is the full response with
 * `done: true`.
 *
 * This module exposes `streamChat(req, options)` which returns
 * an AsyncIterable of NDJSON event objects:
 *   { type: 'token',   data: string }   — one chunk of the assistant's reply
 *   { type: 'done',    data: { model, total_duration, ... } }  — terminal metadata
 *   { type: 'error',   data: { code, message } }  — terminal error
 *
 * The HTTP route layer wraps this in a Node Readable stream
 * (`Readable.from(streamChat(...))`) and sets
 * `Content-Type: application/x-ndjson` so the SPA can
 * `fetch().then(r => r.body.getReader())` and iterate.
 *
 * The function is pure (no module-level state, no DB import).
 * `fetchImpl` is injected so the test suite can replay canned
 * NDJSON streams without a real Ollama server.
 */
'use strict';

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * @typedef {Object} OllamaStreamEvent
 * @property {'token'|'done'|'error'} type
 * @property {string|Object} data
 */

/**
 * @param {Object} req  OllamaChatRequest (model, messages, options, format)
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl]
 * @param {string} [options.baseURL]
 * @param {number} [options.timeoutMs]
 * @returns {AsyncGenerator<OllamaStreamEvent, void, void>}
 */
async function* streamChat(req, options = {}) {
  if (!req || !req.model || !Array.isArray(req.messages) || req.messages.length === 0) {
    yield { type: 'error', data: { code: 'invalid_request', message: 'model and a non-empty messages array are required' } };
    return;
  }
  const fetchImpl = options.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl) {
    yield { type: 'error', data: { code: 'no_fetch', message: 'no fetch implementation available' } };
    return;
  }
  const baseURL = (options.baseURL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs == null ? DEFAULT_TIMEOUT_MS : options.timeoutMs;

  const body = {
    model: req.model,
    messages: req.messages,
    stream: true
  };
  if (req.format && typeof req.format === 'object') body.format = req.format;
  const opts = {};
  if (typeof req.temperature === 'number') opts.temperature = req.temperature;
  if (typeof req.maxTokens === 'number') opts.num_predict = req.maxTokens;
  if (Object.keys(opts).length > 0) body.options = opts;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${baseURL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (err) {
    clearTimeout(timer);
    const code = err && err.name === 'AbortError' ? 'timeout' : 'network_error';
    const message = (err && err.message) || String(err);
    yield { type: 'error', data: { code, message } };
    return;
  }
  clearTimeout(timer);
  if (!res.ok) {
    let detail = `http_${res.status}`;
    try {
      const text = await res.text();
      detail += `:${text.slice(0, 200)}`;
    } catch (_) { /* ignore */ }
    yield { type: 'error', data: { code: 'http_error', message: detail } };
    return;
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    yield { type: 'error', data: { code: 'no_stream_body', message: 'response body is not a ReadableStream' } };
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let finalMeta = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Split on newlines. Ollama emits one JSON object per line.
      let nlIdx;
      while ((nlIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nlIdx).trim();
        buffer = buffer.slice(nlIdx + 1);
        if (line.length === 0) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (e) {
          // Skip malformed lines. Ollama's stream is well-formed but
          // be defensive against proxies that may inject whitespace.
          continue;
        }
        if (parsed && typeof parsed === 'object') {
          const content = parsed.message && typeof parsed.message.content === 'string' ? parsed.message.content : '';
          if (content.length > 0) {
            yield { type: 'token', data: content };
          }
          if (parsed.done === true) {
            finalMeta = {
              model: parsed.model || req.model,
              total_duration: parsed.total_duration,
              eval_count: parsed.eval_count,
              eval_duration: parsed.eval_duration
            };
          }
        }
      }
    }
    // Flush any remaining buffered content.
    if (buffer.trim().length > 0) {
      try {
        const parsed = JSON.parse(buffer.trim());
        const content = parsed.message && typeof parsed.message.content === 'string' ? parsed.message.content : '';
        if (content.length > 0) {
          yield { type: 'token', data: content };
        }
        if (parsed.done === true) {
          finalMeta = {
            model: parsed.model || req.model,
            total_duration: parsed.total_duration,
            eval_count: parsed.eval_count,
            eval_duration: parsed.eval_duration
          };
        }
      } catch (_) { /* ignore */ }
    }
    yield { type: 'done', data: finalMeta || { model: req.model } };
  } catch (err) {
    const code = err && err.name === 'AbortError' ? 'timeout' : 'stream_read_error';
    const message = (err && err.message) || String(err);
    yield { type: 'error', data: { code, message } };
  } finally {
    try { reader.releaseLock(); } catch (_) { /* ignore */ }
  }
}

module.exports = {
  streamChat,
  DEFAULT_TIMEOUT_MS
};
