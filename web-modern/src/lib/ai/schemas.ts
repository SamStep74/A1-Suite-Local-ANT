/**
 * AI surface — Zod schemas (Phase 10.5 ask-ai).
 *
 * This module owns the *wire shape* of the ask-ai RPC: the payload the
 * client sends to /api/ai/ask and the response it expects back.
 * The same schemas are intended to be reused by the Fastify backend
 * once a real LLM is wired in (Phase 11+). For now the client
 * short-circuits to a canned 800ms response — see ./client.ts.
 *
 * Design rules:
 *   • Everything is validated with Zod 4. Never trust the network.
 *   • `Citation` is the union of *route* citations (in-app drill-down)
 *     and *document* citations (placeholder for Phase 11).
 *   • The `Context` shape mirrors the routing layer's idea of "where
 *     the user is right now" — `{app, entity?, id?}`. We intentionally
 *     keep it open-ended; Phase 11 will add structured fields like
 *     `dateRange` or `filters`.
 *   • All exported types are derived via `z.infer<>` — never write
 *     a duplicate `interface` that could drift.
 */
import { z } from "zod";

/** Route context — where the user is when they ask. Derived from
 *  `useRouterState().location.pathname` in the client. */
export const RouteContextSchema = z.object({
  /** App id segment, e.g. "finance" (matches AppId in lib/apps). */
  app: z.string().min(1),
  /** Entity segment when the route names one, e.g. "invoices". */
  entity: z.string().min(1).optional(),
  /** Record id when the route carries one, e.g. "inv_abc". */
  id: z.string().min(1).optional(),
  /** Free-form path for routes that don't fit the app/entity/id
   *  shape (e.g. /app/copilot/$chatId). Phase 1. */
  rawPath: z.string().min(1),
});
export type RouteContext = z.infer<typeof RouteContextSchema>;

/** Citation kinds. We model two up front so the UI can render
 *  different chips (route chips are clickable; document chips are
 *  inline badges until Phase 11 ships doc-viewer drill-down). */
export const CitationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("route"),
    /** Stable id for React keys. */
    id: z.string().min(1),
    /** Human-readable label shown on the chip. */
    label: z.string().min(1),
    /** App id — used for icon + colour. */
    app: z.string().min(1),
    /** Optional in-app href (e.g. /app/finance/invoices/inv_abc). */
    href: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("document"),
    id: z.string().min(1),
    label: z.string().min(1),
    /** Phase 11: link to the doc-viewer route. */
    href: z.string().min(1).optional(),
  }),
]);
export type Citation = z.infer<typeof CitationSchema>;

/** Request payload. The client always sends the current route
 *  context — even when the user is on a non-AI-aware page — so the
 *  stub backend can echo a sensible answer. */
export const AskRequestSchema = z.object({
  question: z.string().min(1).max(2_000),
  context: RouteContextSchema,
  /** Optional client-supplied idempotency key, mirrors the rest
   *  of the app's mutation shape (see healthcheck ping). */
  idempotencyKey: z.string().min(1).max(200).optional(),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

/** Response payload. `answer` is the canned prose, `citations`
 *  are the clickable chips the user can drill into. `tokensUsed`
 *  is a UI nicety (the stub returns a constant). */
export const AskResponseSchema = z.object({
  answer: z.string().min(1),
  citations: z.array(CitationSchema),
  tokensUsed: z.number().int().nonnegative(),
  /** Echoed from the request so the client can correlate when
   *  multiple questions are in flight. */
  idempotencyKey: z.string().min(1).optional(),
});
export type AskResponse = z.infer<typeof AskResponseSchema>;
