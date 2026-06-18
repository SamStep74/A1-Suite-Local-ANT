/**
 * api() — typed fetch wrapper. Talks to the Fastify proxy at /api/*.
 *
 * The new app's server route at routes/api/$.ts forwards every request to
 * the Fastify backend at FASTIFY_BACKEND_URL (default http://localhost:4100).
 *
 * Authentication in the new app: Bearer token in `Authorization` header
 * (see auth-token.ts). The legacy Vite app uses the `sid` HttpOnly cookie
 * which still works on its own domain (5173). Both surfaces authenticate
 * the same Fastify session — `app.auth` reads cookie OR Bearer
 * (server/app.js:172).
 *
 * Schemas are validated with Zod 4 — the same schemas are used by the
 * server route to type-check the Fastify response before returning.
 */
import { z } from "zod";
import { getToken } from "./auth-token";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** JSON-serialisable body shape. We JSON.stringify objects/arrays; strings pass through as-is. */
export type JsonBody = string | Record<string, unknown> | unknown[] | null;

export interface ApiOptions {
  signal?: AbortSignal;
  /** Skip schema validation (for fire-and-forget POSTs that don't return anything). */
  noParse?: boolean;
  /** Send a body. Will be JSON.stringify'd unless it's already a string. */
  body?: JsonBody;
  /** Override the request Content-Type. */
  contentType?: string;
  /**
   * Skip the automatic `Authorization: Bearer <sid>` header. Used by the
   * login and register endpoints, where the caller doesn't have a token yet.
   */
  skipAuth?: boolean;
}

export async function api<T = unknown>(
  path: string,
  schema: z.ZodType<T> | null,
  init: RequestInit & ApiOptions = {},
): Promise<T> {
  const { body, contentType, noParse, signal, skipAuth, ...rest } = init;

  const headers = new Headers(rest.headers);
  if (body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", contentType ?? "application/json");
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  // Attach the Bearer token if we have one and the caller didn't opt out
  // (login/register skip the header — they have no token yet).
  if (!skipAuth && !headers.has("Authorization")) {
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  // Resolve body to a BodyInit-compatible value. The body is a JSON-serialisable
  // union (string | Record | unknown[] | null). We cast to BodyInit | undefined
  // because RequestInit.body's intersection with our JsonBody type is too strict
  // for TypeScript's inference (it tries to also match URLSearchParams etc.).
  const fetchBody: BodyInit | undefined =
    body == null
      ? undefined
      : typeof body === "string"
        ? body
        : (JSON.stringify(body) as string);

  const res = await fetch(path, {
    method: rest.method ?? (body != null ? "POST" : "GET"),
    credentials: "include",
    body: fetchBody,
    ...rest,
    headers,
    // RequestInit.signal is `AbortSignal | null`, not `... | undefined`.
    // We already destructured `signal` out of init, so the spread `...rest`
    // no longer carries a `signal` property. Coalesce undefined down to null.
    signal: signal ?? null,
  });

  if (!res.ok) {
    let code = "unknown";
    let message = res.statusText;
    let details: unknown;
    try {
      const data = (await res.json()) as { code?: string; message?: string; error?: string };
      code = data.code ?? code;
      message = data.message ?? data.error ?? message;
      details = data;
    } catch {
      // body wasn't JSON; fall back to status text
    }
    throw new ApiError(res.status, code, message, details);
  }

  if (noParse) return undefined as T;
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;

  const data: unknown = JSON.parse(text);
  if (schema) {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new ApiError(500, "schema_mismatch", "API response did not match expected shape", parsed.error.format());
    }
    return parsed.data;
  }
  return data as T;
}

/** Convenience: GET with optional schema. */
export function getJson<T>(path: string, schema?: z.ZodType<T>, signal?: AbortSignal) {
  return api(path, schema ?? null, { method: "GET", signal });
}

/** Convenience: POST JSON. The body is narrowed to JsonBody; the api() wrapper
 *  casts to BodyInit at the fetch() call site. */
export function postJson<T>(path: string, body: JsonBody, schema?: z.ZodType<T>, signal?: AbortSignal) {
  return api(path, schema ?? null, { method: "POST", body, signal } as RequestInit & ApiOptions);
}

/** Convenience: PATCH JSON. Mirrors postJson but with method PATCH. */
export function patchJson<T>(path: string, body: JsonBody, schema?: z.ZodType<T>, signal?: AbortSignal) {
  return api(path, schema ?? null, { method: "PATCH", body, signal } as RequestInit & ApiOptions);
}

/** Convenience: PUT JSON. Mirrors postJson but with method PUT. */
export function putJson<T>(path: string, body: JsonBody, schema?: z.ZodType<T>, signal?: AbortSignal) {
  return api(path, schema ?? null, { method: "PUT", body, signal } as RequestInit & ApiOptions);
}

/** Convenience: DELETE. No body; the response is validated against an optional schema. */
export function deleteJson<T>(path: string, schema?: z.ZodType<T>, signal?: AbortSignal) {
  return api(path, schema ?? null, { method: "DELETE", signal });
}

/** Convenience: POST that returns nothing (e.g. logout). */
export function postVoid(path: string, body?: JsonBody) {
  return api(path, null, { method: "POST", body, noParse: true } as RequestInit & ApiOptions);
}

/** Convenience: PATCH JSON. Mirrors postJson — the body is the patch object,
 *  the response is validated against an optional schema. */
// (duplicate patchJson removed — sequences worker added a redundant copy; the
// canonical one at line 135 is kept)

/* ── NDJSON streaming (Phase 10.13 / slice 14) ─────────────────────
 *
 * Used by /api/ai/chat/stream. The server returns
 * Content-Type: application/x-ndjson with one JSON object per
 * line. Each line is {type, data} where type is one of
 * 'token' | 'done' | 'error'. The body is consumed with a
 * streaming reader; we do NOT wait for the entire response
 * before resolving.
 *
 * The returned AsyncIterable yields the parsed events. The
 * caller pattern-matches on `type` to render each token.
 *
 * `signal` aborts the underlying fetch. Errors before the
 * first byte yield an `{type: 'error', data: {code, message}}`
 * event so the caller can render a friendly message without
 * special-casing the network path.
 */
export interface NdjsonEvent {
  type: string;
  data: unknown;
}

export async function* streamNdjson(
  path: string,
  body: JsonBody,
  options: { signal?: AbortSignal; skipAuth?: boolean } = {},
): AsyncGenerator<NdjsonEvent, void, void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/x-ndjson"
  };
  if (!options.skipAuth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers,
    body: body == null ? undefined : JSON.stringify(body),
    signal: options.signal ?? null
  });
  if (!res.ok) {
    yield {
      type: "error",
      data: { code: `http_${res.status}`, message: res.statusText || "stream error" }
    };
    return;
  }
  if (!res.body || typeof res.body.getReader !== "function") {
    yield { type: "error", data: { code: "no_stream_body", message: "response is not a stream" } };
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nlIdx;
      while ((nlIdx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nlIdx).trim();
        buffer = buffer.slice(nlIdx + 1);
        if (line.length === 0) continue;
        try {
          yield JSON.parse(line) as NdjsonEvent;
        } catch {
          // Skip malformed lines defensively.
        }
      }
    }
    if (buffer.trim().length > 0) {
      try { yield JSON.parse(buffer.trim()) as NdjsonEvent; } catch { /* ignore */ }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}
