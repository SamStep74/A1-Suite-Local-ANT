/**
 * /app/ask-ai — full-page version of the Ask AI surface.
 *
 * Renders the same question → answer → citations flow as the
 * sidebar panel, but full-width. Reuses the same client + Zod
 * schemas so the two surfaces cannot drift on the wire shape.
 *
 * Why both a sidebar AND a full page?
 *   • The sidebar is for *in-context* questions: "what's this
 *     invoice?", "why is this row red?" — the user is already
 *     looking at the data and wants a hint.
 *   • The full page is for *cross-app* questions: "summarise
 *     last week's receivable situation across CRM and Finance"
 *     — the user wants a larger canvas to read the answer and
 *     iterate.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Sparkles, ExternalLink, type LucideIcon } from "lucide-react";
import { streamAsk } from "../../../lib/ai/client";
import type { AskResponse } from "../../../lib/ai/schemas";
import { Citations } from "../../../lib/ai/citations";
import { parseRouteContext } from "../../../components/ai/AskAiPanel";
import { APPS, type AppId } from "../../../lib/apps";
import { cn } from "../../../lib/utils/cn";

export const Route = createFileRoute("/app/ask-ai/")({
  component: AskAiFullPage,
});

function AskAiFullPage() {
  const { t } = useLingui();
  const [question, setQuestion] = useState("");
  const [streamedText, setStreamedText] = useState("");
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [history, setHistory] = useState<Array<{ q: string; a: AskResponse }>>([]);
  const abortRef = useRef<AbortController | null>(null);

  // We resolve the route context at *load* time, not on submit.
  // The full page is anchored at /app/ask-ai, so the "context"
  // is whatever the user was looking at *before* navigating in.
  // Phase 11: a `?from=...` query param will override this.
  const lastNonAskAiPath = useLastNonAskAiPath();
  const routeContext = parseRouteContext(lastNonAskAiPath ?? "/app/ask-ai");

  // Cancel any in-flight stream on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const submit = async () => {
    const q = question.trim();
    if (!q) return;
    setResponse(null);
    setStreamedText("");
    setIsStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const { chunks, response: final } = await streamAsk(
        {
          question: q,
          context: routeContext,
          idempotencyKey: `page-${Date.now()}`,
        },
        ctrl.signal,
      );
      let acc = "";
      for (const chunk of chunks) {
        if (ctrl.signal.aborted) break;
        acc += chunk;
        // eslint-disable-next-line no-await-in-loop -- sequential stream
        await new Promise<void>((r) => setTimeout(r, 0));
        setStreamedText(acc);
      }
      setResponse(final);
      setHistory((prev) => [...prev, { q, a: final }]);
      setQuestion("");
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <header className="space-y-1">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          <Sparkles className="size-3" />
          App · Ask AI
        </span>
        <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
          <Trans>Ask AI</Trans>
        </h1>
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          <Trans>
            Ask anything about your business. Phase 10.5 ships a UI-only stub
            — answers come from your browser, no LLM is contacted.
          </Trans>
        </p>
      </header>

      <article
        data-testid="ask-ai-page-context"
        className="panel flex items-center gap-3"
      >
        <ContextGlyph app={routeContext.app} />
        <div className="flex-1">
          <p className="text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
            <Trans>Context anchor</Trans>
          </p>
          <p className="text-[11px] text-[var(--color-muted)]">
            <code className="font-mono">{routeContext.rawPath}</code>
            {routeContext.entity && (
              <>
                {" · "}
                <Trans>entity</Trans>
                {": "}
                <code className="font-mono">{routeContext.entity}</code>
              </>
            )}
            {routeContext.id && (
              <>
                {" · "}
                <Trans>id</Trans>
                {": "}
                <code className="font-mono">{routeContext.id}</code>
              </>
            )}
          </p>
        </div>
        {lastNonAskAiPath && (
          <Link
            to={lastNonAskAiPath as never}
            className="inline-flex items-center gap-1 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            <Trans>Go back</Trans>
            <ExternalLink className="size-3" aria-hidden />
          </Link>
        )}
      </article>

      <section className="panel flex flex-col gap-3" data-testid="ask-ai-page-thread">
        {history.length === 0 && !streamedText && (
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
            <Trans>
              No questions yet. Ask one below to see the stub answer and
              citation chips.
            </Trans>
          </p>
        )}
        {history.map((turn, i) => (
          <Turn
            key={i}
            question={turn.q}
            answer={turn.a.answer}
            citations={turn.a.citations}
          />
        ))}
        {streamedText && (
          <Turn
            question={question}
            answer={streamedText}
            citations={response?.citations ?? []}
            streaming={isStreaming}
          />
        )}
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="panel sticky bottom-0 flex flex-col gap-2"
      >
        <label htmlFor="ask-ai-page-input" className="sr-only">
          <Trans>Ask the AI a question</Trans>
        </label>
        <textarea
          id="ask-ai-page-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t({
            message:
              "Type a question — the stub echoes a canned answer with citation chips for the current context.",
          })}
          rows={3}
          disabled={isStreaming}
          data-testid="ask-ai-page-input"
          className={cn(
            "resize-none rounded-[var(--radius-md)] border border-[var(--color-line)]",
            "bg-[var(--color-canvas)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ink)]",
            "placeholder:text-[var(--color-muted)] focus:border-[var(--color-brand)] focus:outline-none",
            "disabled:opacity-60",
          )}
        />
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-[var(--color-muted)]">
            <Trans>Enter to ask · Shift+Enter for newline</Trans>
          </p>
          <button
            type="submit"
            disabled={!question.trim() || isStreaming}
            data-testid="ask-ai-page-submit"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[var(--radius-md)]",
              "bg-[var(--color-agent)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-white",
              "hover:bg-[var(--color-agent-strong)] disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <Sparkles className="size-3.5" aria-hidden />
            <Trans>Ask</Trans>
          </button>
        </div>
      </form>

      <div>
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          <Trans>Back to today</Trans>
        </Link>
      </div>
    </div>
  );
}

/* ────────────── pieces ────────────── */

function Turn({
  question,
  answer,
  citations,
  streaming,
}: {
  question: string;
  answer: string;
  citations: AskResponse["citations"];
  streaming?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
        <Trans>You</Trans>
      </p>
      <p className="rounded-[var(--radius-md)] bg-[var(--color-surface-soft)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ink)]">
        {question}
      </p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-agent)]">
        <Trans>AI</Trans>
      </p>
      <p
        className="whitespace-pre-wrap rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ink)]"
        data-testid="ask-ai-page-answer"
      >
        {answer}
        {streaming && (
          <span
            aria-hidden
            className="ml-0.5 inline-block h-3 w-1 translate-y-0.5 animate-pulse bg-[var(--color-agent)]"
          />
        )}
      </p>
      {citations.length > 0 && <Citations citations={citations} className="mt-1" />}
    </div>
  );
}

function ContextGlyph({ app }: { app: string }) {
  const meta = APPS[app as AppId];
  const Icon: LucideIcon = meta?.icon ?? Sparkles;
  return (
    <div className="flex size-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
      <Icon className="size-4" aria-hidden />
    </div>
  );
}

/** Hook: the most recent pathname that wasn't /app/ask-ai. We
 *  use the History API (pushState / popstate) because
 *  useRouterState is the source of truth while *inside* the
 *  page. We snapshot before the user navigates to /app/ask-ai
 *  so the back button takes them where they came from. */
function useLastNonAskAiPath(): string | null {
  const [path, setPath] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.location.pathname === "/app/ask-ai" ? null : window.location.pathname;
  });
  useEffect(() => {
    const onPop = () => {
      const p = window.location.pathname;
      setPath(p === "/app/ask-ai" ? null : p);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}
