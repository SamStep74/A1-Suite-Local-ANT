/**
 * /app/healthcheck — Pattern A skeleton.
 *
 * Source: server/app.js#healthcheckPing → POST /api/healthcheck/ping
 * Returns a single envelope with the echoed message and a server
 * timestamp. Used as a smoke test of the modern TanStack-Start
 * stack end-to-end (route → mutation → API client → server → Zod
 * parse → render).
 *
 * Inline-Armenian strings are intentional — we don't pull in an
 * i18n framework until the broader app decides it actually needs
 * one. This matches the convention used by sibling routes.
 *
 * No URL search state, no ViewSwitcher, no print section — the
 * route is intentionally a single-screen diagnostic panel.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Activity, ChevronLeft } from "lucide-react";
import { postJson } from "../../../lib/api/client";
import {
  HealthcheckPingResponseSchema,
  type HealthcheckPingResponse,
} from "../../../lib/api/schemas";

export const Route = createFileRoute("/app/healthcheck/")({
  component: HealthcheckRoute,
});

function HealthcheckRoute() {
  const [message, setMessage] = useState("skeleton");
  const [result, setResult] = useState<HealthcheckPingResponse["healthcheck"] | null>(null);
  const [error, setError] = useState<string>("");

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      setError("");
      const data = await postJson(
        "/api/healthcheck/ping",
        { message, idempotencyKey: `ui-${Date.now()}` },
        HealthcheckPingResponseSchema,
      );
      return data;
    },
    onSuccess: (data) => {
      setResult(data.healthcheck);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const busy = isPending;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <header className="space-y-1">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          <Activity className="size-3" />
          App · Healthcheck
        </span>
        <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
          Healthcheck
        </h1>
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          Առողջության ստուգում · Pattern A skeleton
        </p>
      </header>

      <article
        className="panel"
        data-testid="healthcheck-panel"
        data-entity="healthcheck-ping"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            aria-label="Healthcheck message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={200}
            className="flex-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => mutate()}
            className="inline-flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-line)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Pinging…" : "Ping"}
          </button>
        </div>

        {result && (
          <div className="mt-4 space-y-1">
            <p>
              echo: <strong>{result.message}</strong>
            </p>
            <p className="action-status">at {result.respondedAt}</p>
          </div>
        )}

        {error && (
          <p className="action-status" role="alert">
            error: {error}
          </p>
        )}
      </article>

      <div>
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          back to Today
        </Link>
      </div>
    </div>
  );
}
