/**
 * Shared i18n shim for Vite-dev-mode e2e tests.
 *
 * WHY THIS EXISTS
 * ---------------
 * The web-modern app has two real source bugs that surface in
 * `pnpm dev` (but not the production build, which Rollup handles
 * correctly):
 *
 *   1. `src/i18n/lingui.ts` does
 *        `import.meta.glob("/src/locales/{hy,ru}/messages.js", { query: "?raw" })`
 *      to lazy-load each per-locale catalog. The compiled catalog
 *      is CJS (`module.exports = { messages: ... }`) — Vite's dev
 *      server serves the file verbatim to the browser, which
 *      cannot parse CJS as ESM. The dynamic import throws a
 *      SyntaxError and the I18nProvider stays at `ready=false`,
 *      returning `null` forever.
 *
 *   2. `src/lib/onboarding/tours.ts` evaluates `t({ message: "..." })`
 *      macro calls at MODULE top-level (compiled from the inline
 *      `t({ message: ... })` literals). The route tree imports
 *      tours.ts before any React hook fires, so these calls run
 *      against an empty catalog and throw
 *      "Lingui: Attempted to call a translation function without
 *      setting a locale." on first load.
 *
 *   This shim closes both gaps by intercepting Vite's request for
 *   `/src/locales/{locale}/messages.js` and returning a synthetic
 *   ESM module (`export default { messages: ... }`) with the real
 *   catalog, AND by injecting a `<script type="module">` in the
 *   HTML <head> that imports the (now-ESM) messages catalog and
 *   calls `i18n.loadAndActivate("hy", messages)` BEFORE the bundle's
 *   main module evaluates tours.ts.
 *
 * PER-LOCALE
 * ----------
 * The shim maps the locale segment of the URL (e.g. `ru` in
 * `/src/locales/ru/messages.js`) to the corresponding compiled
 * CJS catalog under `src/locales/<locale>/messages.js`. This is
 * what makes the Phase 10.7 locale-switch test
 * (`document-steppers.spec.ts` line ~558) pass: the test
 * navigates to `?lang=ru` and the I18nProvider then re-activates
 * i18n with the Russian catalog the shim served.
 *
 * SHAPE PARITY WITH THE VITE PLUGIN
 * ---------------------------------
 * The shim emits the SAME module shape as the `ant-lingui-catalogs`
 * Vite plugin (`vite-plugins/lingui-catalogs.ts`):
 *
 *   export default { messages: { ... } };
 *
 * `src/i18n/lingui.ts` consumes the catalogs with
 * `import.meta.glob(..., { import: "default" })`, so the consumer
 * unwraps the module's `default` export to reach the catalog. If
 * the shim emitted a NAMED export instead, `.default` would be
 * `undefined` and the loader would return `undefined`, which
 * would then throw `TypeError: Cannot destructure property
 * 'messages' of 'undefined'` inside `activateLocale()`. The
 * app shell would never mount and the locale switcher (the
 * testid every Phase 10.7 spec asserts on) would never appear.
 *
 * SCOPE
 * -----
 * Any spec that navigates to `/app/*` AND interacts with the
 * page (fill, click, expect visible) needs this shim.
 * Specs that only assert on initial DOM render may work without
 * it (the page DOES mount), but it's safe to install it for
 * every interaction-heavy spec to keep behavior consistent.
 *
 * None of these shims touch application code. The production
 * build (Vite + Rollup) emits a different module shape, and
 * these shims are only active in dev-mode e2e runs.
 */
import type { BrowserContext, Route } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

type Catalog = Record<string, unknown>;

/**
 * Extract the messages dict from a compiled CJS catalog.
 *
 * `lingui compile` emits
 *
 *   /*eslint-disable*\/module.exports={messages:JSON.parse("...")};
 *
 * The inner string literal is JS-string-escaped (`\"` → `"`,
 * `\\` → `\`). We use `JSON.parse` on a JSON-encoded string
 * (i.e. wrap the JS literal in `"..."` so JSON.parse interprets
 * it as a string value), which gives us the unescaped source,
 * then `JSON.parse` again to get the dict. This is pure data
 * parsing — no `new Function` or `vm` evaluation.
 */
function extractCatalog(cjsContent: string): Catalog {
  const parseStart = cjsContent.indexOf('JSON.parse("') + 'JSON.parse("'.length;
  // The closing of JSON.parse is `")`; the trailing `}` belongs
  // to the CJS object literal. Anchor on `")}` so any `)`
  // characters inside JSON string values (e.g.
  // "Environmental fee (annual)") don't trip the search.
  const parseEnd = cjsContent.lastIndexOf('")}');
  if (parseStart < 0 || parseEnd < 0 || parseEnd <= parseStart) {
    throw new Error(
      `i18n-shim: could not locate JSON.parse("…") in CJS catalog`,
    );
  }
  const jsStringLiteral = cjsContent.substring(parseStart, parseEnd);
  // `JSON.parse('"' + slice + '"')` treats the JS literal as a
  // JSON string literal and gives us the unescaped content.
  const jsonText = JSON.parse(`"${jsStringLiteral}"`);
  return JSON.parse(jsonText) as Catalog;
}

/** Loaded from the compiled CJS catalogs under src/locales/.
 *  Keyed by locale code; the value is the raw CJS file contents
 *  so we can re-parse on demand (matches what the real Vite dev
 *  server does: it reads the file fresh per request). */
const CATALOG_FILES: Record<string, string> = {
  hy: fs.readFileSync(
    path.join(REPO_ROOT, "src", "locales", "hy", "messages.js"),
    "utf8",
  ),
  ru: fs.readFileSync(
    path.join(REPO_ROOT, "src", "locales", "ru", "messages.js"),
    "utf8",
  ),
  en: fs.readFileSync(
    path.join(REPO_ROOT, "src", "locales", "en", "messages.js"),
    "utf8",
  ),
};

/** Inline `<script type="module">` that pre-activates Lingui with
 *  the HY catalog (the most-frequently-tested locale) before the
 *  bundle's main module evaluates `tours.ts`. The I18nProvider
 *  then takes over and re-activates with the locale selected
 *  via `?lang=` / localStorage on the next render. */
const PRE_ACTIVATE_SNIPPET = `<script type="module">
const core = await import("/node_modules/.vite/deps/@lingui_core.js?v=2fa7a4f2");
const mod = await import("/src/locales/hy/messages.js");
// Lingui v5: i18n.activate(locale, locales) only sets the locale.
// To set BOTH the locale AND the messages catalog, use
// loadAndActivate({ locale, messages }).
core.i18n.loadAndActivate({ locale: "hy", messages: mod.default.messages });
window.__I18N_PRE_ACTIVATED__ = true;
</script>`;

/** Map a request URL to a locale code. Returns "hy" as the
 *  fallback for URLs that don't match the expected pattern
 *  (the HY catalog has every source-string key, so it's a
 *  safe default). */
function localeFromUrl(url: string): string {
  const m = url.match(/\/src\/locales\/([a-z]+)\/messages/);
  if (m && CATALOG_FILES[m[1]!]) return m[1]!;
  return "hy";
}

/** Build the ESM module body for a given locale. The shape
 *  matches what the `ant-lingui-catalogs` Vite plugin emits
 *  (see `vite-plugins/lingui-catalogs.ts#buildCatalogEsm`):
 *
 *    export default { messages: { ... } };
 *
 *  `import.meta.glob(..., { import: "default" })` in
 *  `src/i18n/lingui.ts` unwraps the `.default` export, so the
 *  consumer sees `{ messages: { ... } }` and destructures
 *  `messages` cleanly. */
function esmBodyFor(locale: string): string {
  const raw = CATALOG_FILES[locale] ?? CATALOG_FILES.hy;
  const messages = extractCatalog(raw);
  return (
    `/* i18n-shim: synthetic ESM catalog (matches ant-lingui-catalogs Vite plugin) */\n` +
    `export default { messages: ${JSON.stringify(messages)} };\n`
  );
}

/** Install the i18n shim on a context. Must be called BEFORE
 *  the first navigation — `route` handlers are queued in order
 *  and only fire on subsequent navigations/requests. */
export async function installI18nShim(
  context: BrowserContext,
): Promise<void> {
  // (1) ESM-ify the messages catalog, picking the per-locale
  //     catalog based on the URL's locale segment. (In the bundle's
  //     `import.meta.glob` consumer, the dev server's
  //     `ant-lingui-catalogs` plugin would normally rewrite the
  //     CJS to ESM — but Playwright's `context.route` wins over the
  //     Vite plugin because it intercepts the request at the browser
  //     layer, before it ever hits the dev server's middleware
  //     chain. So we serve the synthetic ESM body here instead.)
  //     The route regex anchors on `messages.(?:js|ts)$` so it
  //     does not match Vite-internal `?v=...` or `?import`
  //     queries — only the bundle's own import.
  await context.route(
    /\/src\/locales\/[a-z]+\/messages\.(?:js|ts)$/,
    async (route) => {
      const locale = localeFromUrl(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: esmBodyFor(locale),
      });
    },
  );

  // (2) Inject the pre-activation script in the HTML <head>. We
  //     intercept both the SPA shell (`/`) and any `/app/*`
  //     deep-link so the snippet is in the DOM regardless of
  //     which URL Playwright opens first.
  const inject = async (route: Route): Promise<void> => {
    const response = await route.fetch();
    let body = await response.text();
    if (body.includes("<head>")) {
      body = body.replace("<head>", "<head>" + PRE_ACTIVATE_SNIPPET);
    }
    await route.fulfill({ response, body });
  };
  await context.route("**/app/**", inject);
  await context.route((url) => url.pathname === "/", inject);
}
