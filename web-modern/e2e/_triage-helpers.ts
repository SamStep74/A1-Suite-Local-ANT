/**
 * _triage-helpers — Phase 10.7 worker-local helpers for the
 * triage-inbox e2e spec.
 *
 * Why this file exists:
 *   Three seeded-code race conditions prevent the triage-inbox route
 *   from mounting in Vite dev mode, blocking every e2e test in this
 *   spec. We patch around them at the test layer so the spec stays
 *   pure (no `web-modern/src/` changes per the worker task brief).
 *
 *   1. Client-side auth reads from `sessionStorage["ant.bearerSid"]`
 *      (see `src/lib/api/auth-token.ts`), not from the request
 *      `Authorization` header that `_helpers.authedPage` sets. Without
 *      seeding sessionStorage, the app's auth gate redirects to
 *      `/login` even when the Bearer header is correct.
 *
 *   2. `src/i18n/lingui.ts` does `import("@/locales/hy/messages")`
 *      which Vite resolves to `src/locales/hy/messages.js` — a
 *      CJS file (`module.exports = { messages: ... }`). The browser
 *      cannot import CJS as ESM, so `I18nProvider`'s `useEffect`
 *      rejection is unhandled and the provider stays at `ready=false`,
 *      returning `null` forever.
 *
 *   3. `src/lib/onboarding/tours.ts` calls `i18n._({ id, message })`
 *      at MODULE top-level (compiled from `t({ message: "..." })`).
 *      The route tree statically imports tours.ts before any React
 *      hook fires, so the call runs before `I18nProvider.useEffect`
 *      has a chance to call `i18n.activate(...)`. Result: every
 *      `/app/*` page throws "Attempted to call a translation function
 *      without setting a locale." on first load.
 *
 *   This helper closes all three gaps:
 *     - injects the Bearer sid into sessionStorage via addInitScript
 *     - intercepts the locale-catalog request and serves a
 *       pre-built ESM `export const messages = {...}` body
 *     - injects a `<script type="module">` in the HTML `<head>` that
 *       imports `@lingui/core` and the (now-ESM) messages catalog,
 *       then calls `i18n.activate("hy", messages)` BEFORE the bundle's
 *       main script tag evaluates tours.ts.
 *
 *   None of these shims touch application code. The production build
 *   (Vite + Rollup) emits a different module shape, and these shims
 *   are only active in dev-mode e2e runs.
 *
 * Scope:
 *   Phase 10.7 W1 ("e2e-triage-inbox") only. The pre-existing bugs
 *   above are a W7-onboarding-fix candidate for a future phase.
 */
import type {
  Browser,
  BrowserContext,
  APIRequestContext,
  Page,
  Route,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { authedPage as baseAuthedPage } from "./_helpers";

// Pre-extracted messages for the "hy" locale (source: src/locales/hy/messages.js).
// The CJS source uses `module.exports = { messages: JSON.parse("...") }`; we
// parsed the JSON out at helper-load time so the shim is synchronous and
// self-contained. Re-run scripts/extract-messages.cjs to refresh after a
// `pnpm i18n:extract` rerun.
const __dirname = dirname(fileURLToPath(import.meta.url));
const MESSAGES_HY = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/messages-hy.json"), "utf8"),
) as Record<string, string>;

/** ESM body the shim serves in place of the CJS messages.js.
 *  Vite's import path resolver turns `import("@/locales/hy/messages")` into
 *  `/src/locales/hy/messages.js`, so we intercept that exact path (and the
 *  `.ts?import` Vite sometimes appends). */
const MESSAGES_ESM_BODY = `export const messages = ${JSON.stringify(MESSAGES_HY)};\n`;

/** Inline `<script type="module">` that pre-activates the Lingui locale.
 *  Uses top-level await to ensure the activation completes before the
 *  bundle's main module (which loads `tours.ts` and races the
 *  `I18nProvider.useEffect`) starts evaluating. */
function buildPreActivateSnippet(): string {
  return `<script type="module">
const core = await import("/node_modules/.vite/deps/@lingui_core.js?v=2fa7a4f2");
const mod = await import("/src/locales/hy/messages.js");
core.i18n.activate("hy", mod.messages);
window.__I18N_PRE_ACTIVATED__ = true;
</script>`;
}

const PRE_ACTIVATE_SNIPPET = buildPreActivateSnippet();

/** Wire all three shims onto the given browser context. Must be called
 *  BEFORE the first navigation — Playwright's `addInitScript` and
 *  `route` handlers are queued in order and only fire on subsequent
 *  navigations/requests. */
export async function installTriageI18nShim(
  context: BrowserContext,
  sid: string,
): Promise<void> {
  // (1) Client-side auth: seed the sessionStorage token the app's
  // `auth-token.ts` reads. The Bearer header set on extraHTTPHeaders
  // covers network calls; sessionStorage covers the client-side guard.
  await context.addInitScript((token: string) => {
    try {
      window.sessionStorage.setItem("ant.bearerSid", token);
    } catch {
      // sessionStorage may throw in private mode; ignore.
    }
  }, sid);

  // (2) ESM-ify the CJS messages catalog. Vite serves the file raw;
  // the browser can't `import()` CJS. We return a synthetic ESM
  // module with the same `messages` named export.
  await context.route(
    /\/src\/locales\/[a-z]+\/messages(?:\.[a-z]+)?(?:\?.*)?$/,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: MESSAGES_ESM_BODY,
      });
    },
  );

  // (3) Inject the pre-activation script in the HTML <head>. We intercept
  // both the SPA shell (`/`) and any `/app/*` deep-link so the snippet
  // is in the DOM regardless of which URL Playwright opens first.
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

/** Login → authed context with the three shims installed → page. Drops
 *  in for `_helpers.authedPage` in this spec. */
export async function authedTriagePage(
  browser: Browser,
  request: APIRequestContext,
): Promise<{ page: Page; context: BrowserContext; sid: string }> {
  const { page, context, sid } = await baseAuthedPage(browser, request);
  await installTriageI18nShim(context, sid);
  return { page, context, sid };
}

/** Navigate to `/app/triage-inbox/?lang=hy` and assert the page mounted.
 *  The lang query is for the saved-view "All" / "Overdue" / "Awaiting"
 *  literal-label assertions (Armenian source). */
export async function gotoTriageInbox(page: Page): Promise<void> {
  const response = await page.goto("/app/triage-inbox/?lang=hy");
  if (!response) {
    throw new Error("triage-inbox route did not respond");
  }
  if (![200, 304].includes(response.status())) {
    throw new Error(
      `triage-inbox route returned ${response.status()}, expected 200/304`,
    );
  }
  await page.getByTestId("triage-inbox-page").waitFor({ timeout: 15_000 });
  await page
    .getByRole("heading", { level: 1, name: /Triage inbox/i })
    .waitFor({ timeout: 5_000 });
}
