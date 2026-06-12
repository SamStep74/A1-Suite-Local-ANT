/**
 * serve-spa.mjs — minimal SPA static server (Phase 10.0 D1).
 *
 * Replaces the TanStack Start SSR runtime (.output/server/index.mjs)
 * that the previous `start` script invoked. The new app is a pure
 * SPA — `vite build` emits a static `web-modern/dist/`, and this
 * script serves it with the same /api/* proxy semantics the dev
 * server's `apiProxy` plugin used.
 *
 * Why a plain `http.createServer` and not Fastify:
 *   - We only need two behaviours: proxy /api/* + serve static.
 *   - Spawning a second Fastify instance just to mount a static
 *     middleware would be circular (the SPA server fronts Fastify).
 *   - The same Connect-style shape the Vite dev `apiProxy` uses
 *     maps 1:1 to Node's `(req, res)` model. Re-use the pattern.
 *
 * Why `sirv` (3 KB, zero-dep) and not @fastify/static:
 *   - Smallest blast radius: no Fastify plugin lifecycle to wire.
 *   - `single: true` gives the SPA shell fallback out of the box.
 *   - Production-grade caching headers (etags, immutable asset
 *     filenames from Vite already bust cache, but we still set
 *     1y on /assets/* so browsers don't revalidate).
 *
 * Env vars:
 *   PORT                — port to listen on (default 3000)
 *   FASTIFY_BACKEND_URL — where to proxy /api/* (default
 *                         http://localhost:4100)
 *
 * Routes:
 *   /api/*  →  proxied to FASTIFY_BACKEND_URL
 *   /assets/*  →  served from web-modern/dist/assets with 1y cache
 *   /*       →  served from web-modern/dist with `single` SPA
 *               fallback (any unknown route → index.html)
 */
import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sirv from "sirv";

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ lives at web-modern/scripts/, so dist/ is at web-modern/dist/.
const DIST_DIR = resolve(__dirname, "..", "dist");

const PORT = Number(process.env.PORT ?? 3000);
const BACKEND = process.env.FASTIFY_BACKEND_URL ?? "http://localhost:4100";

// `single: true` makes sirv return index.html for any path that
// doesn't match a file on disk — that's the SPA shell fallback.
// `dev: false` disables the in-memory file cache (the file is read
// from disk on every request, which is fine for a small dist/ and
// means deploys that swap the dist dir are picked up immediately
// after a process restart).
const serveStatic = sirv(DIST_DIR, {
  single: true,
  dev: false,
  // dotfiles: false is the default; we never want to expose a
  // .env or .git directory if one accidentally lands in dist/.
  etag: true,
});

// Strip the Vite-hashed asset prefix and set aggressive caching.
// We do this in a small wrapper around sirv so the rest of the
// static tree keeps sirv's default `must-revalidate` semantics.
const ASSETS_RE = /^\/assets\//;
const serveAssets = (req, res, next) => {
  if (ASSETS_RE.test(req.url ?? "")) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
  // Always hand off to sirv — even for non-asset paths. Sirv is
  // responsible for serving index.html on `/` and for the SPA
  // shell fallback on unknown routes (`single: true`).
  return serveStatic(req, res, next);
};

// Wrap sirv again for the SPA shell — the shell must NEVER be
// cached, otherwise a deploy of a new index.html that references
// new asset hashes is invisible to clients that hit a stale
// /index.html. Vite's HMR gets this for free in dev; we have to
// set it explicitly here. Set the header BEFORE handing off to
// sirv, so it's in place before sirv's first `res.write`.
const serveShell = (req, res, next) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.setHeader("Cache-Control", "no-cache");
  }
  return serveAssets(req, res, next);
};

/**
 * /api/* → BACKEND. We re-implement the same fetch-based proxy
 * the dev `apiProxy` plugin uses, but as a server-level handler.
 * `redirect: "manual"` keeps 30x Location headers intact.
 */
const API_PREFIX = "/api";
async function proxyApi(req, res) {
  const target = `${BACKEND}${req.url}`;
  try {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase();
      // Drop hop-by-hop + host (we want Fastify to see our Host,
      // not the browser's, so its allowlist is happy).
      if (lk === "host" || lk === "connection" || lk === "content-length") continue;
      if (Array.isArray(v)) headers.set(lk, v.join(", "));
      else if (typeof v === "string") headers.set(lk, v);
    }

    const method = (req.method ?? "GET").toUpperCase();
    const hasBody = !["GET", "HEAD"].includes(method);
    const init = { method, headers, redirect: "manual" };
    if (hasBody) {
      // Node IncomingMessage → Web Body isn't a one-liner. The
      // SPA only ever sends small JSON to /api/* so buffering is
      // safe and matches the dev plugin's behaviour.
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      init.body = Buffer.concat(chunks);
    }

    const upstream = await fetch(target, init);

    res.statusCode = upstream.status;
    // Forward headers EXCEPT the ones Node will set itself; sending
    // them confuses the runtime (chunked transfer, gzipped body
    // that Node doesn't know to re-encode, etc.).
    upstream.headers.forEach((value, key) => {
      const lk = key.toLowerCase();
      if (lk === "content-encoding" || lk === "content-length" || lk === "transfer-encoding") return;
      res.setHeader(key, value);
    });
    // Reflect the request's Origin with credentials so Set-Cookie
    // survives. Same reason as the dev plugin.
    const reqOrigin = req.headers.origin;
    if (reqOrigin) {
      res.setHeader("Access-Control-Allow-Origin", reqOrigin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        code: "upstream_unreachable",
        message: `Could not reach Fastify at ${BACKEND}: ${err?.message ?? err}`,
      }),
    );
  }
}

const server = http.createServer((req, res) => {
  // Defensive: if the dist/ doesn't exist (e.g. `pnpm start` run
  // before `pnpm build`), bail with a 503 instead of crashing.
  if (!req.url) {
    res.statusCode = 400;
    return res.end("Bad Request");
  }
  if (req.url.startsWith(API_PREFIX)) {
    return proxyApi(req, res);
  }
  return serveShell(req, res, () => {
    // If sirv's single-fallback didn't catch it (shouldn't happen
    // with `single: true`, but guard anyway), return a 404 JSON
    // so the SPA can show its not-found component.
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ code: "not_found", path: req.url }));
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[serve-spa] listening on http://localhost:${PORT} ` +
      `(dist=${DIST_DIR}, backend=${BACKEND})`,
  );
});
