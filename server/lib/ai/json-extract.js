/**
 * ai/json-extract — Tolerant JSON extraction from LLM response text.
 *
 * Different providers wrap the JSON output in different ways:
 *   - Anthropic: bare JSON, sometimes with leading "Here is the JSON:"
 *     prose
 *   - OpenAI: bare JSON, occasionally wrapped in ```json ... ``` fences
 *   - Ollama: bare JSON, sometimes with leading "Sure! Here's the JSON:"
 *     prose + trailing "Let me know if you need anything else"
 *   - The "structured output" mode of each provider returns clean JSON
 *     but the JSON can have nested braces (a top-level array of objects,
 *     a string containing a }, etc.)
 *
 * This helper extracts the FIRST balanced JSON value (object or array)
 * from the response. It is provider-agnostic, allocation-light, and
 * does not throw on garbage input (returns null instead).
 *
 * Pure: no I/O, no DB, no fetch.
 */
'use strict';

/**
 * @param {string} s
 * @returns {string|null}
 */
function extractFirstJson(s) {
  if (typeof s !== 'string' || s.length === 0) return null;
  // Strip code fences if present. Match the opening fence
  // (with optional "json" language tag) and the first matching
  // closing fence. Non-greedy on the body.
  const fenced = s.match(/```(?:json|js|ts|javascript)?\s*([\s\S]*?)```/);
  if (fenced && typeof fenced[1] === 'string') {
    return fenced[1].trim();
  }
  // Find the first `{` or `[` and walk to the matching close,
  // respecting string + escape + line-comment + block-comment
  // contexts. Strings and comments can contain `}` / `]` / `{`
  // that should NOT change the depth.
  const startObj = s.indexOf('{');
  const startArr = s.indexOf('[');
  let start = -1;
  let openChar = '';
  let closeChar = '';
  if (startObj === -1 && startArr === -1) return null;
  if (startObj === -1) { start = startArr; openChar = '['; closeChar = ']'; }
  else if (startArr === -1 || startObj < startArr) { start = startObj; openChar = '{'; closeChar = '}'; }
  else { start = startArr; openChar = '['; closeChar = ']'; }

  let depth = 0;
  let inString = false;
  let stringQuote = '';
  let escape = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && s[i + 1] === '/') {
        inBlockComment = false;
        i += 1; // skip the /
      }
      continue;
    }
    if (inString) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === stringQuote) { inString = false; }
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringQuote = c;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') { inLineComment = true; i += 1; continue; }
    if (c === '/' && s[i + 1] === '*') { inBlockComment = true; i += 1; continue; }
    if (c === openChar) depth += 1;
    else if (c === closeChar) {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * @param {string} s
 * @param {unknown} fallback
 * @returns {unknown}
 */
function tryParseFirstJson(s, fallback) {
  const json = extractFirstJson(s);
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

module.exports = {
  extractFirstJson,
  tryParseFirstJson
};
