/**
 * Shared helpers for the web-modern e2e suite.
 *
 * The whole point of these helpers is to keep the actual specs boring:
 * every test file calls `authedPage()`, gets a `Page` already wired
 * with the session Bearer header, and then just asserts on DOM state.
 */
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";

/** Default seeded owner account (see server/db.js DEFAULT_EMAIL). */
export const DEFAULT_EMAIL = "owner@armosphera.local";
export const DEFAULT_PASSWORD = "change-me-now";

/** Fastify base URL. Tests run against the Vite dev proxy (4173),
 *  but `/api/*` is forwarded to this port. We hit the Fastify
 *  port directly for `/api/login` because the Vite dev server's
 *  `apiProxy` is configured for browser traffic only. */
export const FASTIFY_URL = process.env.FASTIFY_URL ?? "http://localhost:4100";
export const BASE_URL = process.env.BASE_URL ?? "http://localhost:4173";

/** Extract the `sid` cookie value from a `set-cookie` response header.
 *  The current /api/login response sets the session in an HttpOnly
 *  `sid` cookie (the JSON body returns `{ok,user}` but not the
 *  token). The Bearer-token strategy used by the new SPA reads the
 *  same value from `sessionStorage["ant.bearerSid"]`, so we treat
 *  the cookie value as the Bearer token. */
function sidFromSetCookie(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  // A response may include several Set-Cookie headers combined
  // (comma-separated) when fetched through the request fixture;
  // we walk each segment looking for `sid=<value>`.
  const segments = setCookieHeader.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  for (const raw of segments) {
    const m = raw.match(/(?:^|,\s*)sid=([^;]+)/);
    if (m) return decodeURIComponent(m[1]!);
  }
  return null;
}

/** Extract the `sid` cookie value from a `set-cookie` response header.
 *  The current /api/login response sets the session in an HttpOnly
 *  `sid` cookie (the JSON body returns `{ok,user}` but not the
 *  token). The Bearer-token strategy used by the new SPA reads the
 *  same value from `sessionStorage["ant.bearerSid"]`, so we treat
 *  the cookie value as the Bearer token. */
function sidFromSetCookie(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  // A response may include several Set-Cookie headers combined
  // (comma-separated) when fetched through the request fixture;
  // we walk each segment looking for `sid=<value>`.
  const segments = setCookieHeader.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  for (const raw of segments) {
    const m = raw.match(/(?:^|,\s*)sid=([^;]+)/);
    if (m) return decodeURIComponent(m[1]!);
  }
  return null;
}

/** POST /api/login. Returns the session id (sid). Throws on non-200. */
export async function login(
  request: APIRequestContext,
  email = DEFAULT_EMAIL,
  password = DEFAULT_PASSWORD,
): Promise<string> {
  const res = await request.post(`${FASTIFY_URL}/api/login`, {
    data: { email, password },
    headers: { "Content-Type": "application/json" },
  });
  if (res.status() !== 200) {
    const text = await res.text();
    throw new Error(`login failed (${res.status()}): ${text}`);
  }
  // First try the JSON body (legacy shape), then fall back to the
  // Set-Cookie header (current shape). Either way the SPA reads
  // the same sid via `Authorization: Bearer <sid>` and via
  // `sessionStorage["ant.bearerSid"]`.
  const body = await res.json().catch(() => null);
  if (body?.sid) return body.sid as string;
  const setCookie =
    res.headers()["set-cookie"] ?? res.headers()["Set-Cookie"] ?? null;
  const cookieSid = sidFromSetCookie(
    Array.isArray(setCookie) ? setCookie.join(", ") : setCookie,
  );
  if (cookieSid) return cookieSid;
  throw new Error(
    `login response missing sid (body=${JSON.stringify(body)}, set-cookie=${JSON.stringify(setCookie)})`,
  );
}

/** Build a `BrowserContext` with the Bearer auth header already set.
 *  The web-modern client uses Bearer auth (not cookies), so this
 *  is the only auth propagation mechanism the suite needs.
 *
 *  We also seed `sessionStorage["ant.bearerSid"]` via
 *  `addInitScript` because the SPA's client-side auth gate
 *  (in `routes/app/route.tsx`) reads the token from
 *  sessionStorage on the first paint and redirects to `/login`
 *  if it is empty. `extraHTTPHeaders` covers `/api/*` traffic
 *  through the Vite proxy; `addInitScript` covers the
 *  client-side guard. */
export async function newAuthedContext(
  browser: Browser,
  sid: string,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    extraHTTPHeaders: { Authorization: `Bearer ${sid}` },
  });
  // Seed sessionStorage before any page script runs so the
  // SPA's first-paint auth check (which reads
  // `sessionStorage["ant.bearerSid"]`) passes.
  await context.addInitScript((token: string) => {
    try {
      window.sessionStorage.setItem("ant.bearerSid", token);
    } catch {
      // sessionStorage may throw in private-browsing / restricted
      // contexts; ignore — the Bearer header still covers /api/*.
    }
  }, sid);
  return context;
}

/** Convenience: full chain — log in, open an authed context, return
 *  a Page. The caller owns the context lifetime. */
export async function authedPage(
  browser: Browser,
  request: APIRequestContext,
): Promise<{ page: Page; context: BrowserContext; sid: string }> {
  const sid = await login(request);
  const context = await newAuthedContext(browser, sid);
  const page = await context.newPage();
  return { page, context, sid };
}

/** Authenticate an existing Playwright page fixture before its
 *  first navigation. This keeps tests on runner-owned context
 *  teardown while preserving the same Bearer/sessionStorage setup
 *  as authedPage(). */
export async function authenticatePage(
  page: Page,
  request: APIRequestContext,
): Promise<string> {
  const sid = await login(request);
  await page.context().setExtraHTTPHeaders({ Authorization: `Bearer ${sid}` });
  await page.addInitScript((token: string) => {
    try {
      window.sessionStorage.setItem("ant.bearerSid", token);
    } catch {
      // See newAuthedContext(): the Authorization header still covers /api/*.
    }
  }, sid);
  return sid;
}

/** Wait until the page has painted SOMETHING (heading or primary
 *  nav), then return. Used by smoke tests that just need to confirm
 *  a route loaded and didn't 404 / throw. */
export async function waitForHydration(page: Page): Promise<void> {
  // Wait for the React app to mount. The $appId route renders a
  // <h1> with the app's Armenian label as its text content; falling
  // back to any h1 covers legacy routes that might use an English
  // heading. We use a generous timeout because the first Vite load
  // does module discovery.
  await page.waitForLoadState("domcontentloaded");
  await page.locator("h1, h2, [data-testid='app-heading']").first().waitFor({ timeout: 15_000 });
}
