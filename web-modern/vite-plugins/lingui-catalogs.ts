/**
 * Vite plugin: rewrite `lingui compile` CJS catalogs into ESM.
 *
 * WHY THIS EXISTS
 * ---------------
 * `lingui compile` (see lingui.config.js) emits
 *
 *   /*eslint-disable*\/module.exports={messages:JSON.parse("...")};
 *
 * into `src/locales/{hy,ru,en}/messages.js`. The browser can't parse
 * CJS as ESM, so the consumer (`src/i18n/lingui.ts`) used to load each
 * catalog as a raw string and evaluate it with
 *
 *   new Function("module", raw)(mod)
 *
 * to extract `mod.exports.messages`. That works, but `new Function` is
 * a code-injection smell — the security reviewer flagged it as a
 * concern even though `raw` is a build artifact (not user input). This
 * plugin closes the gap by transforming the CJS wrapper into a clean
 * ESM default export at the Vite layer (dev + build), so the consumer
 * can use a plain `import.meta.glob` with no runtime evaluation.
 *
 * WHAT IT DOES
 * ------------
 * Intercepts requests for `/src/locales/{locale}/messages.js` and
 * returns
 *
 *   export default { messages: {...} };
 *
 * Extraction uses indexOf (not regex with backtracking) to locate the
 * `JSON.parse("...")` argument — JSON string literals never contain
 * raw `"`, so a simple find is unambiguous. The payload is then
 * `JSON.parse`-d (data, not code) and re-serialized into the emitted
 * ESM module.
 */
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/**
 * Un-escape the body of a JS string literal so the result is the
 * actual string value, not the escaped source.
 *
 * `lingui compile` emits the JSON source as a JS string literal, so
 * a value containing a `"` becomes `\"` in the file and a `\`
 * becomes `\\`. Catalog bodies never contain other JS escapes
 * (newlines, tabs, unicode), but we still pass them through
 * unchanged so a JSON.parse of the result handles them per JSON
 * rules (e.g. `\n` → newline char in both syntaxes).
 */
function unescapeJsStringLiteral(body: string): string {
  return body.replace(/\\(["\\])/g, (_match, ch: string) => ch);
}

/**
 * Pure extraction of the messages dict from a compiled Lingui catalog.
 *
 * Throws on shape mismatch — that's a build-pipeline regression, not
 * a runtime condition we want to silently swallow.
 */
export function extractLinguiMessages(raw: string): Record<string, unknown> {
  const startMarker = 'JSON.parse("';
  const start = raw.indexOf(startMarker);
  if (start < 0) {
    throw new Error(
      "[ant-lingui-catalogs] Could not find `JSON.parse(\"...\")` in catalog. " +
        "Expected lingui-compiled output; the file may be from a different source.",
    );
  }
  const from = start + startMarker.length;
  const end = raw.indexOf('")', from);
  if (end < 0) {
    throw new Error(
      "[ant-lingui-catalogs] Unterminated `JSON.parse(\"...\")` argument in catalog.",
    );
  }
  // The file content is JS source, so the inner body is JS-string-
  // literal escaped. Un-escape `\"` → `"` and `\\` → `\` before
  // handing to JSON.parse (which expects the actual JSON source).
  const inner = unescapeJsStringLiteral(raw.slice(from, end));
  return JSON.parse(inner) as Record<string, unknown>;
}

/**
 * Build the ESM module source for a locale's compiled catalog.
 *
 * The emitted shape — `export default { messages: { ... } }` — is what
 * Lingui v5 expects from a real ESM catalog and what
 * `import.meta.glob(..., { import: "default" })` hands back from
 * `await loader()`.
 */
export function buildCatalogEsm(raw: string, locale: string): string {
  const messages = extractLinguiMessages(raw);
  return (
    `/* lingui-catalog:${locale} ` +
    `(rewritten from CJS by ant-lingui-catalogs) */\n` +
    `export default { messages: ${JSON.stringify(messages)} };\n`
  );
}

// Match `/src/locales/<locale>/messages.js` with an optional Vite
// query suffix (`?v=...`, `?t=...`, `?import`, etc.). Anchored at the
// end so we don't false-match `messages.json`, `messages.jsx`, etc.
const CATALOG_RE = /\/src\/locales\/[a-z]+\/messages\.js(?:\?|$)/;

function readCatalog(filePath: string): { code: string; map: null } {
  const localeMatch = filePath.match(/\/src\/locales\/([a-z]+)\/messages\.js$/);
  const locale = localeMatch?.[1] ?? "unknown";
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(
      `[ant-lingui-catalogs] Could not read catalog at ${filePath}: ` +
        (err as Error).message,
    );
  }
  return {
    code: buildCatalogEsm(raw, locale),
    map: null,
  };
}

export function linguiCatalogs(): Plugin {
  return {
    name: "ant-lingui-catalogs",
    enforce: "pre",
    load(id) {
      if (!CATALOG_RE.test(id)) return null;
      const filePath = id.split("?")[0]!;
      return readCatalog(filePath);
    },
  };
}
