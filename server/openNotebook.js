"use strict";

/**
 * Open Notebook (lfnovo/open-notebook) — opt-in AI source beside the local RAG.
 *
 * We connect to a self-hosted Open Notebook instance over its REST API; we do
 * NOT bundle its Python/SurrealDB runtime. The connector is:
 *   - opt-in     — only runs when settings.openNotebook.enabled + baseUrl are set
 *   - egress-gated — calls go through config.safeFetch (loopback always ok;
 *                    remote hosts must be allowlisted)
 *   - non-throwing — any failure returns [] so the copilot/RAG flow is never broken
 *
 * Returned rows match the local RAG result shape so callers can merge sources.
 */

const config = require("./config");

const DEFAULT_SEARCH_PATH = "/api/search";

function isEnabled(settings) {
  return Boolean(
    settings && settings.openNotebook && settings.openNotebook.enabled && settings.openNotebook.baseUrl
  );
}

// Tolerate the likely Open Notebook response shapes ({results}|{sources}|{data}|array).
function normalizeResults(raw, k = 6) {
  let items = [];
  if (Array.isArray(raw)) items = raw;
  else if (raw && Array.isArray(raw.results)) items = raw.results;
  else if (raw && Array.isArray(raw.sources)) items = raw.sources;
  else if (raw && Array.isArray(raw.data)) items = raw.data;
  return items
    .slice(0, k)
    .map(it => ({
      title: String(it.title || it.name || it.notebook || "Open Notebook"),
      text: String(it.text || it.content || it.snippet || it.chunk || ""),
      score: Number.isFinite(it.score) ? it.score : (Number.isFinite(it.relevance) ? it.relevance : 0),
      sourceUrl: typeof it.url === "string" ? it.url : (typeof it.source_url === "string" ? it.source_url : ""),
      origin: "open-notebook"
    }))
    .filter(r => r.text);
}

async function search(query, { settings, k = 6, env = process.env } = {}) {
  if (!isEnabled(settings)) return [];
  const q = String(query || "").trim();
  if (!q) return [];
  const on = settings.openNotebook;
  const url = on.baseUrl.replace(/\/+$/, "") + (on.searchPath || DEFAULT_SEARCH_PATH);
  try {
    const headers = { "Content-Type": "application/json" };
    if (on.apiKey) headers.Authorization = `Bearer ${on.apiKey}`;
    const res = await config.safeFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: q, limit: k })
    }, env);
    if (!res || !res.ok) return [];
    return normalizeResults(await res.json(), k);
  } catch {
    // Egress-blocked, network, or parse error — degrade silently beside local RAG.
    return [];
  }
}

module.exports = { isEnabled, normalizeResults, search, DEFAULT_SEARCH_PATH };
