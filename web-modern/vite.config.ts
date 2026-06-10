import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

/**
 * TanStack Start 1.0 + React 19 + Tailwind v4.
 *
 * The new app lives at web-modern/ alongside the legacy Vite app at web/.
 * Dev server: http://localhost:4173 (Fastify on :4100, legacy Vite on :5173).
 *
 * ── API proxy strategy (two-track architecture) ──────────────────────
 * DEV   : custom Vite plugin `apiProxy` (this file) — Node `fetch` →
 *         Fastify. We use a hand-written Connect middleware instead
 *         of Vite's `server.proxy` because http-proxy (the lib behind
 *         `server.proxy`) strips `Set-Cookie` from the browser-facing
 *         response when `cookieDomainRewrite` / `autoRewrite` aren't
 *         configured. Curl sees the header (curl talks to the proxy
 *         directly), the browser doesn't. Forwarding the response
 *         with the raw middleware passes Set-Cookie through verbatim.
 *
 *         The new app authenticates via `Authorization: Bearer <sid>`
 *         (see src/lib/api/auth-token.ts), so the Set-Cookie bug is
 *         moot for the new app — but the legacy Vite app on :5173
 *         still relies on cookies and benefits from the verbatim
 *         Set-Cookie forwarding.
 *
 * PROD  : TanStack Start server route at `src/routes/api/$.ts`.
 *         Lives in the `.output/server/index.mjs` bundle.
 * ──────────────────────────────────────────────────────────────────────
 */
import type { Plugin, Connect } from "vite";

const BACKEND = process.env.FASTIFY_BACKEND_URL ?? "http://localhost:4100";

/**
 * `apiProxy` — Vite plugin that forwards /api/* to Fastify in dev.
 *
 * Implemented as a Connect-style middleware (the same shape Vite's
 * internal middlewares use), wired via the `configureServer` hook so
 * it runs BEFORE Vite's own middlewares. This guarantees:
 *   1. The middleware path is `/api`, so the request never reaches
 *      Vite's SPA fallback (which would return index.html).
 *   2. The response is built from the upstream `Response` directly,
 *      so `Set-Cookie` is forwarded verbatim — no http-proxy
 *      filtering, no Vite CORS middleware in the way.
 *   3. `body` is streamed (`upstream.body` is a ReadableStream), so
 *      large responses (lists, exports) don't buffer in memory.
 */
function apiProxy(): Plugin {
  return {
    name: "ant-api-proxy",
    configureServer(server) {
      const handler: Connect.NextHandleFunction = async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/api")) return next();
        const target = `${BACKEND}${req.url}`;
        try {
          // Re-build headers from the incoming request, dropping
          // hop-by-hop + host (we want Fastify to see the proxy's
          // Host, not the browser's, so its allowlist is happy).
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            const lk = k.toLowerCase();
            if (lk === "host" || lk === "connection" || lk === "content-length") continue;
            if (Array.isArray(v)) headers.set(lk, v.join(", "));
            else if (typeof v === "string") headers.set(lk, v);
          }

          // Stream the incoming request body (for POST/PUT/PATCH).
          const method = (req.method ?? "GET").toUpperCase();
          const hasBody = !["GET", "HEAD"].includes(method);
          const init: RequestInit = { method, headers, redirect: "manual" };
          if (hasBody) {
            // Node IncomingMessage → ReadableStream isn't trivial in
            // older Node; for our endpoints bodies are small (JSON)
            // so buffer once.
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            init.body = Buffer.concat(chunks);
          }

          const upstream = await fetch(target, init);

          // Forward status + headers, INCLUDING Set-Cookie (the whole
          // reason this plugin exists). We DO have to materialise the
          // body because Node's `res` doesn't speak Web ReadableStream.
          res.statusCode = upstream.status;
          upstream.headers.forEach((value, key) => {
            // Node will set these itself; sending them confuses it.
            const lk = key.toLowerCase();
            if (lk === "content-encoding" || lk === "content-length" || lk === "transfer-encoding") return;
            res.setHeader(key, value);
          });
          // Tell the browser this is a same-origin credentialed
          // response. Without these, Chrome's cookie model drops
          // Set-Cookie because the request is `credentials: include`
          // AND the response has no Access-Control-Allow-Credentials.
          // The Origin is whatever the browser sent; reflect it.
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
              message: `Could not reach Fastify at ${BACKEND}: ${(err as Error).message}`,
            }),
          );
        }
      };
      // `pre` runs before Vite's internal middlewares (SPA fallback,
      // CORS, HMR, etc.). Critical: `/api` must hit our handler first.
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  server: {
    port: 4173,
    strictPort: true,
    // cors:false keeps Vite from injecting CORS headers on SPA
    // responses. Our apiProxy plugin handles /api itself, so Vite's
    // CORS middleware never sees those requests.
    cors: false,
  },
  plugins: [
    // Tailwind v4 — CSS-first config; tokens live in src/styles/tokens.css.
    tailwindcss(),
    // The API proxy MUST be registered before TanStack Start so it
    // runs before the dev-server-plugin's catch-all middleware.
    apiProxy(),
    tanstackStart(),
    react(),
    tsConfigPaths(),
  ],
});
