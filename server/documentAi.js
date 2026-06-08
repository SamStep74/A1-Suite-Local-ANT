"use strict";

/**
 * Local-first AI helper for the Document Cabinet.
 *
 * Mirrors the egress + fallback contract used by `server/copilot.js`:
 *   - When the user has not configured a cloud provider (no OpenRouter egress,
 *     or the AI provider is set to `local`), we return the deterministic
 *     fallback produced by `server/documentCabinet.js`.
 *   - When OpenRouter egress IS allowed and `OPENROUTER_API_KEY` is set, we
 *     attempt one lightweight completion and degrade silently back to the
 *     local fallback on any error.
 *
 * Every export returns the same envelope so route handlers don't branch on
 * source:
 *     { result, citations: [], guardrails: [], sourceActive: boolean }
 *
 * No DB, no Fastify, no persistence. The route layer is the only place that
 * owns auth, app access, idempotency, persistence, and audit emit.
 */

const config = require("./config");
const documentCabinet = require("./documentCabinet");

const INTENT_TO_ENGINE = {
  "doc-classify": "classifyDocument",
  "doc-extract": "extractAttributes",
  "doc-risk-scan": "scanRisks",
  "doc-compare": "compareRevisions",
  "doc-reply": "draftReply"
};

const SOURCE_LOCAL = "local-fallback";
const SOURCE_OPENROUTER = "openrouter";
const SOURCE_OPENROUTER_BLOCKED = "openrouter-egress-blocked";
const SOURCE_OPENROUTER_ERROR = "openrouter-error";

function buildGuardrails(intent) {
  const common = [
    "Document AI-ի պատասխանները խորհրդատվական նախագծեր են եւ փաստաթղթային փոփոխություններ չեն կատարում:",
    "Արտաքին իրավական կամ հաճախորդին ուղղված օգտագործումից առաջ մարդու վերանայումը պարտադիր է:"
  ];
  if (intent === "doc-classify") return [...common, "Այս պատասխանը փաստաթղթի տիպը չի գրանցում եւ որպես պաշտոնական դասակարգում չի հանդիսանում:"];
  if (intent === "doc-extract") return [...common, "Արդյունահեղ հատկանիշները վերջնական չեն մինչեւ մարդու վերանայումը:"];
  if (intent === "doc-risk-scan") return [...common, "Ռիսկերի սկանը իրավական եզրակացություն չի տրամադրում եւ փոխարինում չի իրավաբանի վերանայումը:"];
  if (intent === "doc-compare") return [...common, "Տարբերությունների ցանկը խորհրդատվական է. վերջնական որոշումը վերանայողինն է:"];
  if (intent === "doc-reply") return [...common, "Պատասխան նամակը չի ուղարկվում ավտոմատ. ուղարկումը պահանջում է մարդու հաստատում:"];
  return common;
}

function isCloudEnabled(env = process.env) {
  if (config.isOpenRouterEgressAllowed && !config.isOpenRouterEgressAllowed(env)) return false;
  if (!env.OPENROUTER_API_KEY) return false;
  if (env.AI_PROVIDER && String(env.AI_PROVIDER).toLowerCase() === "local") return false;
  return true;
}

function buildCloudPrompt(intent, normalized) {
  if (intent === "doc-classify") {
    return {
      system: "You classify Armenian/Russian/English business documents into a fixed taxonomy. Respond with JSON only.",
      user: `Title: ${normalized.title || ""}\nBody: ${normalized.body || ""}\nValid types: contract, invoice, act, letter, memo, report, claim, order. Return JSON {\"type\":\"...\",\"confidence\":0..100,\"reason\":\"...\"}.`
    };
  }
  if (intent === "doc-extract") {
    return {
      system: "You extract structured attributes from Armenian/Russian/English documents. Respond with JSON only.",
      user: `DocType: ${normalized.docType || ""}\nTitle: ${normalized.title || ""}\nBody: ${normalized.body || ""}\nReturn JSON {\"attributes\":{\"date\":\"YYYY-MM-DD\",\"counterparty\":\"...\",\"amount\":0,\"currency\":\"AMD\",\"dueDate\":\"YYYY-MM-DD\"},\"confidence\":0..100}. Use null for missing fields.`
    };
  }
  if (intent === "doc-risk-scan") {
    return {
      system: "You scan Armenian/Russian/English contracts for legal risk patterns. Respond with JSON only.",
      user: `Jurisdiction: ${normalized.jurisdiction || "AM"}\nBody: ${normalized.body || ""}\nReturn JSON {\"risks\":[{\"id\":\"...\",\"label\":\"...\",\"severity\":\"low|medium|high\",\"excerpt\":\"...\"}],\"confidence\":0..100}. Empty array if no risks.`
    };
  }
  if (intent === "doc-compare") {
    return {
      system: "You compare two document revisions and list the human-meaningful differences. Respond with JSON only.",
      user: `Left:\n${normalized.leftText || ""}\n\nRight:\n${normalized.rightText || ""}\nReturn JSON {\"diffs\":[{\"kind\":\"added|removed|changed\",\"text\":\"...\",\"before\":\"...\",\"after\":\"...\"}]}.`
    };
  }
  if (intent === "doc-reply") {
    return {
      system: "You draft a short Armenian reply letter for an incoming document. Respond with JSON only.",
      user: `Tone: ${normalized.tone || "formal"}\nLanguage: ${normalized.language || "hy-AM"}\nIncoming: ${normalized.incoming || ""}\nReturn JSON {\"body\":\"...\",\"citationIds\":[]}. Plain Armenian text in body.`
    };
  }
  return { system: "You assist with document work.", user: "" };
}

async function tryOpenRouter(intent, normalized, env) {
  if (!isCloudEnabled(env)) {
    return { ok: false, reason: SOURCE_OPENROUTER_BLOCKED };
  }
  const apiKey = env.OPENROUTER_API_KEY;
  const model = env.COPILOT_MODEL || env.A1_MODEL_DOCS || "openrouter/auto";
  const { system, user } = buildCloudPrompt(intent, normalized);
  try {
    const res = await config.safeFetch(`${config.openrouter.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "x-title": config.openrouter.title,
        referer: config.openrouter.referer
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.2,
        response_format: { type: "json_object" }
      })
    }, env);
    if (!res || !res.ok) return { ok: false, reason: SOURCE_OPENROUTER_ERROR };
    const json = await res.json();
    const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!content) return { ok: false, reason: SOURCE_OPENROUTER_ERROR };
    const parsed = JSON.parse(content);
    return { ok: true, parsed, source: SOURCE_OPENROUTER };
  } catch (err) {
    return { ok: false, reason: SOURCE_OPENROUTER_ERROR, error: err && err.message ? err.message : String(err) };
  }
}

function buildLocalPayload(intent, normalized) {
  const engineName = INTENT_TO_ENGINE[intent];
  if (!engineName) {
    return { suggestedType: "memo", confidence: 0, reason: "unknown intent" };
  }
  return documentCabinet[engineName](normalized);
}

function adaptLocalToIntent(intent, localResult) {
  if (intent === "doc-classify") {
    return {
      suggestedType: localResult.suggestedType,
      confidence: localResult.confidence,
      reason: localResult.reason
    };
  }
  if (intent === "doc-extract") {
    return {
      attributes: localResult.attributes || {},
      confidence: localResult.confidence || 50
    };
  }
  if (intent === "doc-risk-scan") {
    return {
      risks: localResult.risks || [],
      confidence: localResult.confidence || 70
    };
  }
  if (intent === "doc-compare") {
    return {
      diffs: (localResult.diffs || []).map(d => ({
        kind: d.kind,
        text: d.text,
        before: d.before,
        after: d.after
      })),
      summary: localResult.summary
    };
  }
  if (intent === "doc-reply") {
    return {
      body: localResult.body,
      citationIds: localResult.citationIds || [],
      tone: localResult.tone,
      language: localResult.language,
      advisoryOnly: true
    };
  }
  return localResult;
}

function makeEnvelope({ result, source, citations, guardrails }) {
  return {
    result,
    citations: Array.isArray(citations) ? citations : [],
    guardrails: Array.isArray(guardrails) ? guardrails : [],
    sourceActive: source === SOURCE_OPENROUTER,
    source,
    advisoryOnly: true
  };
}

function run(intent, normalized = {}, env = process.env) {
  if (!INTENT_TO_ENGINE[intent]) {
    return makeEnvelope({
      result: { error: `unknown intent: ${intent}` },
      source: SOURCE_LOCAL,
      guardrails: buildGuardrails(intent)
    });
  }
  const localResult = buildLocalPayload(intent, normalized || {});
  return makeEnvelope({
    result: adaptLocalToIntent(intent, localResult),
    source: SOURCE_LOCAL,
    guardrails: buildGuardrails(intent)
  });
}

async function runWithCloud(intent, normalized = {}, env = process.env) {
  if (!INTENT_TO_ENGINE[intent]) {
    return run(intent, normalized, env);
  }
  const guardrails = buildGuardrails(intent);
  const localResult = buildLocalPayload(intent, normalized || {});
  const localEnvelope = makeEnvelope({
    result: adaptLocalToIntent(intent, localResult),
    source: SOURCE_LOCAL,
    guardrails
  });
  if (!isCloudEnabled(env)) {
    if (config.isOpenRouterEgressAllowed && !env.OPENROUTER_API_KEY) {
      return { ...localEnvelope, source: SOURCE_LOCAL, sourceActive: false };
    }
    return { ...localEnvelope, source: SOURCE_LOCAL, sourceActive: false };
  }
  const cloud = await tryOpenRouter(intent, normalized, env);
  if (!cloud.ok) {
    return { ...localEnvelope, source: cloud.reason || SOURCE_OPENROUTER_ERROR, sourceActive: false };
  }
  return makeEnvelope({
    result: cloud.parsed,
    source: SOURCE_OPENROUTER,
    citations: [],
    guardrails
  });
}

const classify = (input, env) => run("doc-classify", input, env);
const extract = (input, env) => run("doc-extract", input, env);
const scanRisks = (input, env) => run("doc-risk-scan", input, env);
const compareRevisions = (input, env) => run("doc-compare", input, env);
const draftReply = (input, env) => run("doc-reply", input, env);

const classifyAsync = (input, env) => runWithCloud("doc-classify", input, env);
const extractAsync = (input, env) => runWithCloud("doc-extract", input, env);
const scanRisksAsync = (input, env) => runWithCloud("doc-risk-scan", input, env);
const compareRevisionsAsync = (input, env) => runWithCloud("doc-compare", input, env);
const draftReplyAsync = (input, env) => runWithCloud("doc-reply", input, env);

module.exports = {
  INTENT_TO_ENGINE,
  isCloudEnabled,
  run,
  runWithCloud,
  classify,
  extract,
  scanRisks,
  compareRevisions,
  draftReply,
  classifyAsync,
  extractAsync,
  scanRisksAsync,
  compareRevisionsAsync,
  draftReplyAsync,
  // Source labels — exposed for tests / observability.
  SOURCES: Object.freeze({
    LOCAL: SOURCE_LOCAL,
    OPENROUTER: SOURCE_OPENROUTER,
    OPENROUTER_BLOCKED: SOURCE_OPENROUTER_BLOCKED,
    OPENROUTER_ERROR: SOURCE_OPENROUTER_ERROR
  })
};
