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
 *   ESM module (`export const messages = {...}`) with the real
 *   catalog, AND by injecting a `<script type="module">` in the
 *   HTML <head> that imports the (now-ESM) messages catalog and
 *   calls `i18n.activate("hy", messages)` BEFORE the bundle's
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
import { readFileSync } from "node:fs";

type Catalog = Record<string, unknown>;

/** Loaded from the compiled CJS catalogs under src/locales/.
 *  The `messages.js` files do `module.exports = { messages: ... }`,
 *  so `.messages` is the dictionary Lingui's `i18n.activate`
 *  expects. The package is `type: module`, so loading these
 *  `module.exports` artifacts through Node's module loader is
 *  version-sensitive; parse the committed compile output directly. */
const CATALOGS: Record<string, Catalog> = {
  hy: readCatalog("hy"),
  ru: readCatalog("ru"),
  en: readCatalog("en"),
};

/** Inline `<script type="module">` that pre-activates Lingui with
 *  the HY catalog (the most-frequently-tested locale) before the
 *  bundle's main module evaluates `tours.ts`. The I18nProvider
 *  then takes over and re-activates with the locale selected
 *  via `?lang=` / localStorage on the next render. */
const PRE_ACTIVATE_SNIPPET = `<script type="module">
const core = await import("/src/i18n/lingui.ts");
const mod = await import("/src/locales/hy/messages.js");
// Lingui v5: i18n.activate(locale, locales) only sets the locale.
// To set BOTH the locale AND the messages catalog, use
// loadAndActivate({ locale, messages }).
core.i18n.loadAndActivate({ locale: "hy", messages: mod.messages });
window.__I18N_PRE_ACTIVATED__ = true;
</script>`;

/** Map a request URL to a locale code. Returns "hy" as the
 *  fallback for URLs that don't match the expected pattern
 *  (the HY catalog has every source-string key, so it's a
 *  safe default). */
function localeFromUrl(url: string): string {
  const m = url.match(/\/src\/locales\/([a-z]+)\/messages/);
  if (m && CATALOGS[m[1]!]) return m[1]!;
  return "hy";
}

/** Build the ESM module body for a given locale. The body is
 *  the same shape Lingui expects from a real ESM catalog:
 *  `export const messages = { ... }`. */
function esmBodyFor(locale: string): string {
  const catalog = CATALOGS[locale] ?? CATALOGS.hy;
  return `export const messages = ${JSON.stringify(catalog)};\n`;
}

function readCatalog(locale: string): Catalog {
  const raw = readFileSync(new URL(`../src/locales/${locale}/messages.js`, import.meta.url), "utf8");
  const mod: { exports: unknown } = { exports: {} };
  new Function("module", raw)(mod);
  const messages = (mod.exports as { messages?: unknown }).messages;
  if (!messages || typeof messages !== "object") {
    throw new Error(`Compiled catalog for locale "${locale}" did not export messages`);
  }
  return messages as Catalog;
}

/** Install the i18n shim on a context. Must be called BEFORE
 *  the first navigation — `route` handlers are queued in order
 *  and only fire on subsequent navigations/requests. */
export async function installI18nShim(
  context: BrowserContext,
): Promise<void> {
  // (1) ESM-ify the CJS messages catalog, picking the per-locale
  //     catalog based on the URL's locale segment. We MUST skip
  //     `?raw` requests: the bundle's `loadCJS()` does
  //     `new Function("module", raw)(mod)` to extract
  //     `module.exports.messages`, so the response must be the
  //     raw CJS source as a STRING (which is what Vite's `?raw`
  //     transform does natively). If we reply with our synthetic
  //     ESM body, `mod.exports.messages` ends up `undefined`,
  //     Lingui activates with an empty catalog, and every `t()`
  //     call falls back to the message id + warns "Messages for
  //     locale 'hy' not loaded" — which the wizard surfaces as
  //     a re-render hot path.
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
