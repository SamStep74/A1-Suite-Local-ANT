"use strict";

/**
 * SMB CRM — AI provider interface + OpenRouter adapter.
 *
 * This module is the SMB CRM-specific AI surface (separate from
 * server/aiProvider.js, which is the @a1/ai model-catalog wrapper
 * used by copilot/cfo). The names don't collide: this one exposes
 * the contract-mandated `generateStructured` + `translate` interface
 * with the audit-grade `evidence` envelope; the existing
 * aiProvider.js exposes `listModels` + `resolveModelForRequest`.
 *
 * Pattern A: pure functions, no Fastify imports. The default
 * adapter (OpenRouter) is lazy-initialized from `process.env` at
 * first call. The in-memory stub is for tests + offline mode.
 *
 * The "evidence" envelope is the same shape as the crm-tube
 * connectors (see server/crmTube/connectors/registry.js):
 *   { url, method, requestHash, responseHash, at }
 * It is the wire the audit row lands in for every AI call.
 *
 * The OpenRouter request uses the chat-completions endpoint
 * (NOT OpenAI's `/v1/responses` — that endpoint is OpenAI-only)
 * with `response_format: { type: "json_object" }` for structured
 * output. Models without native json_object support will fail
 * loudly rather than silently returning prose.
 */

const crypto = require("node:crypto");

const OPENROUTER_DEFAULT_BASE = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openai/gpt-4o-mini";

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function nowIso() { return new Date().toISOString(); }

function evidence(url, method, requestBody, responseBody) {
  return {
    url: String(url || ""),
    method: String(method || "POST").toUpperCase(),
    requestHash: sha256Hex(typeof requestBody === "string" ? requestBody : JSON.stringify(requestBody || {})),
    responseHash: sha256Hex(typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody || {})),
    at: nowIso()
  };
}

function ok(data, warnings, ev) {
  return {
    ok: true,
    data: data || null,
    warnings: Array.isArray(warnings) ? warnings : [],
    evidence: ev || null
  };
}

function fail(warnings, ev, err) {
  return {
    ok: false,
    data: null,
    warnings: Array.isArray(warnings) ? warnings : [],
    evidence: ev || null,
    error: err ? (err.message || String(err)) : null
  };
}

/**
 * @typedef {Object} GenerateStructuredArgs
 * @property {string} systemPrompt
 * @property {string} userPrompt
 * @property {object} [jsonSchema] - Zod-shaped hint; coerced to a
 *   `response_format` object for the chat-completions call.
 * @property {string} [model]
 * @property {number} [temperature]
 * @property {number} [maxOutputTokens]
 */

/**
 * @typedef {Object} TranslateArgs
 * @property {string} text
 * @property {"hy"|"en"|"ru"} targetLocale
 * @property {"hy"|"en"|"ru"} [sourceLocale]
 * @property {string} [model]
 */

/**
 * @typedef {Object} AiProvider
 * @property {(args: GenerateStructuredArgs) => Promise<object>} generateStructured
 * @property {(args: TranslateArgs) => Promise<object>} translate
 * @property {string} name
 * @property {object} [config]
 */

/**
 * OpenRouter adapter. Sends chat-completions with response_format.
 * If no API key is set, returns a synthetic non-ok envelope (the
 * route layer falls back to the dictionary).
 */
function createOpenRouterProvider(opts) {
  const env = (opts && opts.env) || process.env;
  const baseUrl = (opts && opts.baseUrl) || env.OPENROUTER_BASE_URL || OPENROUTER_DEFAULT_BASE;
  const apiKey = (opts && opts.apiKey) || env.OPENROUTER_API_KEY || null;
  const defaultModel = (opts && opts.model) || env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const referer = (opts && opts.referer) || env.OPENROUTER_REFERER || "https://a1.am";
  const title = (opts && opts.title) || env.OPENROUTER_TITLE || "A1 Suite";
  const fetchImpl = (opts && opts.fetchImpl) || (typeof fetch === "function" ? fetch : null);

  const provider = {
    name: "openrouter",
    config: { baseUrl, defaultModel, hasApiKey: !!apiKey },

    async generateStructured(args) {
      if (!apiKey) {
        return fail(["OPENROUTER_API_KEY not configured"], null, new Error("missing API key"));
      }
      if (!fetchImpl) {
        return fail(["fetch is not available in this runtime"], null, new Error("fetch missing"));
      }
      const model = (args && args.model) || defaultModel;
      const systemPrompt = String((args && args.systemPrompt) || "").trim();
      const userPrompt = String((args && args.userPrompt) || "").trim();
      if (!systemPrompt || !userPrompt) {
        return fail(["systemPrompt and userPrompt are required"], null, new Error("invalid args"));
      }
      const requestBody = {
        model,
        temperature: typeof (args && args.temperature) === "number" ? args.temperature : 0.2,
        max_tokens: (args && args.maxOutputTokens) || 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      };
      const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
      let responseText = "";
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": referer,
            "X-Title": title
          },
          body: JSON.stringify(requestBody)
        });
        responseText = await res.text();
        const ev = evidence(url, "POST", requestBody, responseText);
        if (!res.ok) {
          return fail([`OpenRouter ${res.status}`], ev, new Error(`OpenRouter ${res.status}`));
        }
        const data = JSON.parse(responseText);
        const text = data.choices && data.choices[0] && data.choices[0].message
          ? String(data.choices[0].message.content || "")
          : "";
        if (!text) return fail(["OpenRouter returned empty content"], ev, new Error("empty content"));
        let parsed;
        try { parsed = JSON.parse(text); } catch (e) {
          return fail(["OpenRouter content was not valid JSON"], ev, e);
        }
        return ok(parsed, [], ev);
      } catch (err) {
        return fail(["OpenRouter call failed"], evidence(url, "POST", requestBody, responseText), err);
      }
    },

    async translate(args) {
      if (!apiKey) {
        return fail(["OPENROUTER_API_KEY not configured"], null, new Error("missing API key"));
      }
      if (!fetchImpl) {
        return fail(["fetch is not available in this runtime"], null, new Error("fetch missing"));
      }
      const model = (args && args.model) || defaultModel;
      const text = String((args && args.text) || "").trim();
      const target = (args && args.targetLocale) || "en";
      if (!text) return fail(["text is required"], null, new Error("empty text"));
      const systemPrompt = [
        "You translate SMB CRM UI strings between Armenian, English, and Russian.",
        `Target language: ${target}.`,
        "Preserve placeholders, product names, currency codes, and proper nouns verbatim.",
        "Return JSON: { \"translated\": \"<string>\" }."
      ].join(" ");
      const requestBody = {
        model,
        temperature: 0.1,
        max_tokens: 512,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text }
        ]
      };
      const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
      let responseText = "";
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": referer,
            "X-Title": title
          },
          body: JSON.stringify(requestBody)
        });
        responseText = await res.text();
        const ev = evidence(url, "POST", requestBody, responseText);
        if (!res.ok) return fail([`OpenRouter ${res.status}`], ev, new Error(`OpenRouter ${res.status}`));
        const data = JSON.parse(responseText);
        const content = data.choices && data.choices[0] && data.choices[0].message
          ? String(data.choices[0].message.content || "")
          : "";
        if (!content) return fail(["OpenRouter returned empty content"], ev, new Error("empty content"));
        let parsed;
        try { parsed = JSON.parse(content); } catch (e) {
          return fail(["OpenRouter content was not valid JSON"], ev, e);
        }
        const translated = String((parsed && parsed.translated) || "").trim();
        if (!translated) return fail(["OpenRouter JSON missing `translated` field"], ev, new Error("no translation"));
        return ok({ translated }, [], ev);
      } catch (err) {
        return fail(["OpenRouter call failed"], evidence(url, "POST", requestBody, responseText), err);
      }
    }
  };

  return provider;
}

/**
 * In-memory provider. Returns the canned response (or translation)
 * on every call. The canned response is either a string (auto-wrapped
 * as `{ translated: "..." }` for translate) or an arbitrary object
 * for generateStructured. Useful for tests + the "no network" path.
 */
function createInMemoryProvider(canned) {
  const c = canned || {};
  return {
    name: "inMemory",
    config: { canned: c },
    async generateStructured() {
      const payload = c.generateStructured !== undefined
        ? c.generateStructured
        : { fallback: true };
      return ok(payload, ["inMemoryProvider"], evidence("about:blank", "MEMORY", {}, payload));
    },
    async translate(args) {
      const text = (args && args.text) || "";
      const translated = typeof c.translate === "function"
        ? c.translate(args)
        : (c.translate !== undefined ? c.translate : text);
      const payload = { translated };
      return ok(payload, ["inMemoryProvider"], evidence("about:blank", "MEMORY", { text }, payload));
    }
  };
}

// TODO(phase-10-v2): add createOllamaProvider — same interface, points
// at http://localhost:11434/v1/chat/completions (mirrors the legacy
// lib/vendor/a1-ai.js). Out of scope for V1.

/**
 * Convenience factory. Returns the in-memory provider if `opts.inMemory`
 * is truthy (or no API key is set), otherwise the OpenRouter provider.
 * The fallback-to-in-memory behavior is what the route layer wants
 * when running locally with no OPENROUTER_API_KEY.
 */
function createDefaultProvider(opts) {
  const o = opts || {};
  if (o.inMemory) return createInMemoryProvider(o.canned || {});
  const env = o.env || process.env;
  const apiKey = o.apiKey || env.OPENROUTER_API_KEY || null;
  if (!apiKey) return createInMemoryProvider(o.canned || { generateStructured: { fallback: true }, translate: "" });
  return createOpenRouterProvider(o);
}

module.exports = {
  createOpenRouterProvider,
  createInMemoryProvider,
  createDefaultProvider,
  evidence,
  ok,
  fail,
  sha256Hex,
  DEFAULT_MODEL,
  OPENROUTER_DEFAULT_BASE
};
