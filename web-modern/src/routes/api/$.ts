/**
 * Fastify reverse proxy — /api/* → ${FASTIFY_BACKEND_URL}/*.
 *
 * Phase 0.5. The new app at :4173 (dev) sits in front of Fastify at :4100.
 * Every /api/* request is forwarded with cookies preserved so the `sid`
 * session cookie stays on the new app's domain. This is what makes the
 * strangler-fig migration safe: users can move between the legacy Vite
 * app (:5173) and the new TanStack Start app (:4173) without re-logging-in
 * for the first 30-day parallel-run period (plan §8 Phase 5 decision 5b).
 *
 * TanStack Start 1.168 server handler signature:
 *   server.handlers[METHOD] = async ({ request, params, context }) => Response
 * The `params._splat` captures everything after /api/ from the catch-all route.
 */
import "@tanstack/react-start"; // Triggers the `server.handlers` type augmentation
import { createFileRoute } from "@tanstack/react-router";

const BACKEND = process.env.FASTIFY_BACKEND_URL ?? "http://localhost:4100";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

type HandlerCtx = {
  request: Request;
  params: Record<string, string | undefined>;
};

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: ({ request, params }: HandlerCtx) => {
        console.log("[api/$] HIT GET", request.url, JSON.stringify(params));
        return proxy(request, params);
      },
      POST: ({ request, params }: HandlerCtx) => {
        console.log("[api/$] HIT POST", request.url, JSON.stringify(params));
        return proxy(request, params);
      },
      PUT: ({ request, params }: HandlerCtx) => proxy(request, params),
      PATCH: ({ request, params }: HandlerCtx) => proxy(request, params),
      DELETE: ({ request, params }: HandlerCtx) => proxy(request, params),
      HEAD: ({ request, params }: HandlerCtx) => proxy(request, params),
      OPTIONS: ({ request, params }: HandlerCtx) => proxy(request, params),
    },
  },
});

async function proxy(request: Request, params: Record<string, string | undefined>) {
  const url = new URL(request.url);
  // The catch-all route captures the remainder after /api/. Use _splat if
  // present (TanStack Router convention) and fall back to URL parsing.
  const splat = params._splat ?? url.pathname.replace(/^\/api\/?/, "");
  const target = `${BACKEND}/${splat}${url.search}`;

  // Forward selected headers (skip hop-by-hop + host).
  const headers = new Headers();
  for (const [k, v] of request.headers.entries()) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    headers.set(k, v);
  }
  if (!headers.has("x-forwarded-for")) {
    headers.set("x-forwarded-for", request.headers.get("x-forwarded-for") ?? "");
  }
  if (!headers.has("x-forwarded-proto")) {
    headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  }

  // Read the body once (if any) so we can re-stream it to the backend.
  const hasBody = !["GET", "HEAD"].includes(request.method.toUpperCase());
  const body = hasBody ? await request.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        code: "upstream_unreachable",
        message: `Could not reach Fastify backend at ${BACKEND}. Is it running?`,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  // Stream the upstream body to the client, copying headers (but not
  // hop-by-hop, and not content-encoding / content-length, which the
  // runtime will re-compute from the new body).
  const respHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    if (k.toLowerCase() === "content-encoding") continue;
    if (k.toLowerCase() === "content-length") continue;
    respHeaders.set(k, v);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}
