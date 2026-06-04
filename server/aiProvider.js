"use strict";

/**
 * OpenRouter — the single cloud AI provider for the A1 Suite.
 *
 * The model catalog is fetched LIVE from OpenRouter so the onboarding dropdown
 * always reflects up-to-date selections. Egress is gated (deny-until-listed):
 * if openrouter.ai is not allowlisted we degrade to a small bundled fallback
 * list instead of throwing, so the menu always renders.
 *
 * This module never calls an LLM by itself — it serves the model menu and
 * resolves which model a given request (aspect + module) should use.
 */

const config = require("./config");

// Minimal offline fallback so the dropdown is never empty when egress is off.
// The live list is the source of truth; these are only shown when offline.
const FALLBACK_MODELS = Object.freeze([
  { id: "anthropic/claude-3.5-sonnet", name: "Anthropic: Claude 3.5 Sonnet", contextLength: 200000, pricing: { prompt: null, completion: null } },
  { id: "openai/gpt-4o", name: "OpenAI: GPT-4o", contextLength: 128000, pricing: { prompt: null, completion: null } },
  { id: "openai/gpt-4o-mini", name: "OpenAI: GPT-4o mini", contextLength: 128000, pricing: { prompt: null, completion: null } },
  { id: "google/gemini-flash-1.5", name: "Google: Gemini Flash 1.5", contextLength: 1000000, pricing: { prompt: null, completion: null } },
  { id: "meta-llama/llama-3.1-70b-instruct", name: "Meta: Llama 3.1 70B Instruct", contextLength: 131072, pricing: { prompt: null, completion: null } }
]);

function normalizeModels(raw) {
  const data = raw && Array.isArray(raw.data) ? raw.data : null;
  if (!data) return [];
  return data
    .filter(m => m && typeof m.id === "string" && m.id)
    .map(m => ({
      id: m.id,
      name: typeof m.name === "string" && m.name ? m.name : m.id,
      contextLength: Number.isFinite(m.context_length) ? m.context_length : 0,
      pricing: m.pricing && typeof m.pricing === "object"
        ? { prompt: m.pricing.prompt ?? null, completion: m.pricing.completion ?? null }
        : { prompt: null, completion: null }
    }));
}

function fallback(reason) {
  return { online: false, source: "fallback", reason, models: FALLBACK_MODELS.slice() };
}

/**
 * Fetch the live OpenRouter model catalog. Returns
 * { online, source: "live"|"fallback", reason?, models: [...] } and never throws.
 */
async function listModels({ apiKey = "", env = process.env } = {}) {
  if (!config.isOpenRouterEgressAllowed(env)) return fallback("egress-blocked");
  try {
    const headers = {
      "Content-Type": "application/json",
      // OpenRouter attribution (recommended for ranking/analytics).
      "HTTP-Referer": config.openrouter.referer,
      "X-Title": config.openrouter.title
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await config.safeFetch(config.openrouter.modelsUrl, { method: "GET", headers }, env);
    if (!res || !res.ok) return fallback(`http-${res ? res.status : "no-response"}`);
    const models = normalizeModels(await res.json());
    if (!models.length) return fallback("empty-list");
    return { online: true, source: "live", models };
  } catch (err) {
    return fallback((err && err.code) || "fetch-error");
  }
}

const MODULES = new Set(["finance", "crm", "docs"]);
const ASPECTS = new Set(["copilot", "transform"]);

/**
 * Resolve which model a request should use.
 *
 * Precedence (highest first): per-module override -> per-aspect override ->
 * global default -> "" (auto / pick at call time). This single ordering is the
 * main policy knob — e.g. flip module/aspect priority if a per-aspect choice
 * should never be overridden by a module default.
 *
 * @param {{default?:string,copilot?:string,transform?:string,finance?:string,crm?:string,docs?:string}} policy
 * @param {{aspect?:string,module?:string}} ctx
 * @returns {string} model id, or "" for auto
 */
function resolveModelForRequest(policy = {}, { aspect, module } = {}) {
  const pick = key => (key && typeof policy[key] === "string" && policy[key].trim() ? policy[key].trim() : "");
  if (module && MODULES.has(module)) {
    const m = pick(module);
    if (m) return m;
  }
  if (aspect && ASPECTS.has(aspect)) {
    const a = pick(aspect);
    if (a) return a;
  }
  return pick("default");
}

module.exports = { FALLBACK_MODELS, normalizeModels, listModels, resolveModelForRequest, MODULES, ASPECTS };
