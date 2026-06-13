/**
 * AI surface — RPC client (Phase 10.5 ask-ai).
 *
 * The Phase 10.5 brief is *UI-only*: there is no real LLM. We:
 *   1. POST to /api/ai/ask (so the contract is real and the e2e
 *      can verify it goes over the wire).
 *   2. If the server returns 404 (the Fastify backend hasn't been
 *      updated yet), fall back to a deterministic stub that
 *      simulates an 800ms canned answer.
 *   3. Validate the response with Zod — never trust the network,
 *      even when the response is one we authored ourselves.
 *
 * Streaming: the brief mentions "streaming answer" but the stub
 * layer in Phase 10.5 returns a single chunk. We expose a
 * `streamAsk` helper that yields the answer in word-sized chunks
 * with a small per-chunk delay so the UI's "answer appearing"
 * animation has something to play. This is enough to validate the
 * streaming UX; the Phase 11+ wiring can swap in real SSE without
 * touching the call site.
 */
import {
  AskRequestSchema,
  AskResponseSchema,
  type AskRequest,
  type AskResponse,
  type Citation,
  type RouteContext,
} from "./schemas";

/** Public type re-exports so consumers only need to import from
 *  one place. */
export type { AskRequest, AskResponse, Citation, RouteContext } from "./schemas";

/** Default endpoint. Matches the brief. The Vite dev `apiProxy`
 *  plugin forwards /api/* to Fastify at :4100. */
const ASK_ENDPOINT = "/api/ai/ask";

/** Latency for the canned answer (the brief says 800ms). */
const STUB_LATENCY_MS = 800;

/** Per-chunk delay for the streaming simulation. */
const STUB_STREAM_CHUNK_MS = 28;

/** Chunk size for the streaming simulation. */
const STUB_STREAM_CHARS_PER_CHUNK = 4;

/** Build a citation list from the current route context. We never
 *  fabricate citations for routes we don't recognise — when the
 *  user is on a vanilla /app/copilot page the stub returns an
 *  empty list (the answer text is generic and we don't want to
 *  mislead the user). */
function stubCitationsFor(ctx: RouteContext): Citation[] {
  if (!ctx.entity) return [];
  const label = humaniseEntity(ctx.entity);
  return [
    {
      kind: "route",
      id: `${ctx.app}:${ctx.entity}${ctx.id ? `:${ctx.id}` : ""}`,
      app: ctx.app,
      label,
      href: ctx.id
        ? `/app/${ctx.app}/${ctx.entity}/${ctx.id}`
        : `/app/${ctx.app}/${ctx.entity}`,
    },
  ];
}

/** Title-cases a kebab entity name ("customer-invoices" →
 *  "Customer invoices"). */
function humaniseEntity(entity: string): string {
  return entity
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Canned prose. We never put any PII or fabricated business
 *  numbers in here — the brief is explicit that this is UI-only
 *  and we must not pretend the AI knows anything. */
function stubAnswerFor(ctx: RouteContext): string {
  const where = ctx.entity
    ? `the ${humaniseEntity(ctx.entity)} view in ${humaniseEntity(ctx.app)}`
    : `the ${humaniseEntity(ctx.app)} app`;
  return [
    `This is a Phase 10.5 stub answer. The AI layer in ${where} is a UI placeholder — no real model is invoked.`,
    "",
    "What the full version will do (Phase 11+):",
    "  • Pull live context from the current route (entity, filters, recent activity).",
    "  • Cite the records it consulted so you can drill straight back in.",
    "  • Stream the answer in 4-char chunks so the panel feels responsive.",
    "",
    "Try changing the question or route — the stub echoes the same canned text by design, so it's safe to demo.",
  ].join("\n");
}

/** Build the full stub response (no network). Used by both the
 *  404-fallback path and the e2e test (which intercepts /api/ai/ask). */
function buildStubResponse(req: AskRequest): AskResponse {
  return {
    answer: stubAnswerFor(req.context),
    citations: stubCitationsFor(req.context),
    tokensUsed: 0,
    idempotencyKey: req.idempotencyKey,
  };
}

/** Try the network first. If the server hasn't shipped the route
 *  yet, fall back to the stub. We *always* return a parsed,
 *  Zod-validated `AskResponse` — the caller never sees a raw
 *  `unknown`. */
export async function askOnce(req: AskRequest): Promise<AskResponse> {
  // Validate the request before it leaves the client. Catches
  // local bugs (e.g. caller passed an empty `question`) without
  // burning a round-trip.
  const safeReq = AskRequestSchema.parse(req);

  let res: Response;
  try {
    res = await fetch(ASK_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(safeReq),
    });
  } catch {
    // Network is down (typical for static deploys / e2e without
    // the Fastify backend running). The brief says "stub endpoint
    // is OK" — degrade gracefully.
    return AskResponseSchema.parse(buildStubResponse(safeReq));
  }

  if (res.status === 404 || res.status === 405) {
    // Endpoint not implemented yet — fall back. We do NOT throw;
    // the panel should still be demoable end-to-end.
    await sleep(STUB_LATENCY_MS);
    return AskResponseSchema.parse(buildStubResponse(safeReq));
  }

  if (!res.ok) {
    throw new Error(`ask-ai: server returned ${res.status} ${res.statusText}`);
  }

  const data: unknown = await res.json();
  return AskResponseSchema.parse(data);
}

/** Stream variant. Splits the canned answer into ~4-char chunks
 *  and yields each with a small per-chunk delay. AbortSignal is
 *  honoured on the first chunk; once a chunk is yielded, the
 *  caller must check the signal itself (we return a sync array
 *  here for simplicity — Phase 11 will swap in real SSE).
 *
 *  Returns `{ chunks, response }` so the caller can render the
 *  citation chips after the prose finishes arriving. */
export async function streamAsk(
  req: AskRequest,
  signal?: AbortSignal,
): Promise<{ chunks: string[]; response: AskResponse }> {
  // The network attempt goes first so the real backend (when it
  // exists in Phase 11+) can short-circuit. The streaming UX
  // degrades to the same chunked-stub behaviour either way.
  const response = await askOnce(req);

  if (signal?.aborted) {
    return { chunks: [], response };
  }

  const text = response.answer;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += STUB_STREAM_CHARS_PER_CHUNK) {
    if (signal?.aborted) break;
    chunks.push(text.slice(i, i + STUB_STREAM_CHARS_PER_CHUNK));
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose
    await sleep(STUB_STREAM_CHUNK_MS);
  }
  return { chunks, response };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
