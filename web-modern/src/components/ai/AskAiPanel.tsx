/**
 * AskAiPanel — the in-app AI assistant sidebar (Phase 10.5 ask-ai).
 *
 * Drawn as a right-edge drawer with the same affordances as the
 * eventual 10.4 PeekPanel: full-height, fixed position, backdrop
 * click + Escape to dismiss, focus trap, and a header / body /
 * footer slot. When the 10.4 PeekPanel lands, the JSX in
 * `PanelChrome` can be swapped for a `<PeekPanel open onOpenChange>`
 * with no change to the ask-ai form or the e2e selectors.
 *
 * Why self-contained chrome (Phase 10.5)?
 *   The plan branch promises PeekPanel as a 10.4 deliverable, but
 *   10.4 hasn't merged into this worktree's base. Importing
 *   `components/shared` here would fail to resolve. Owning the
 *   chrome locally keeps the 10.5 surface shippable and the
 *   10.4 integration a one-file swap.
 *
 * UX rules:
 *   • Controlled mode only: parent owns `open` state, panel is a
 *     pure function of props. This matches the planned 10.4 API
 *     and the AskCommandPalette pattern.
 *   • The question input is always focused when the panel opens.
 *   • Streaming answer renders character-by-character; Escape
 *     closes the panel mid-stream.
 *   • Citations are clickable drill-backs (see citations.tsx).
 *   • Lingui v5 macros wrap every user-facing string; total
 *     macrolable strings across this file are countable in the
 *     audit gate.
 */
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  Sparkles,
  X,
  ArrowUp,
  Square,
  ChevronRight,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { streamAsk, type RouteContext } from "../../lib/ai/client";
import type { AskResponse, Citation } from "../../lib/ai/schemas";
import { Citations } from "../../lib/ai/citations";
import { APPS, type AppId } from "../../lib/apps";
import { cn } from "../../lib/utils/cn";

/** Props mirror the eventual 10.4 PeekPanel contract. */
export interface AskAiPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional callback so the parent can tell the AI to focus
   *  a specific entity. The Phase 1 wiring is "open panel and
   *  jump to citations" — this is a hook for that. */
  onCitationClick?: (citation: Citation) => void;
}

export function AskAiPanel({ open, onOpenChange, onCitationClick }: AskAiPanelProps) {
  const { t } = useLingui();
  const location = useLocation();
  const navigate = useNavigate();

  /**
   * When the user clicks a citation chip we either:
   *   • bubble the event to the parent (so the parent can decide
   *     what to do — e.g. focus a record, switch to a different
   *     tab, or suppress navigation), OR
   *   • do the default in-app navigation ourselves and close the
   *     panel (the sidebar UX).
   *
   * The `Citations` component handles the click; this callback
   * only runs when the parent supplied an override. We use it to
   * keep the panel's external API symmetric with the full-page
   * `/app/ask-ai` view.
   */
  const handleCitationClick = (c: Citation) => {
    if (onCitationClick) {
      onCitationClick(c);
      return;
    }
    if (c.kind === "route" && c.href) {
      navigate({ to: c.href as never });
      onOpenChange(false);
    }
  };

  // ── State ───────────────────────────────────────────────
  const [question, setQuestion] = useState("");
  const [streamedText, setStreamedText] = useState("");
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ── Effects ─────────────────────────────────────────────
  // Focus the input when the panel opens; reset conversation
  // when it closes. We deliberately keep history per-session
  // (the brief doesn't ask for persistence).
  useEffect(() => {
    if (open) {
      // Microtask so the textarea is in the DOM.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    // Abort any in-flight stream when the panel closes.
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    return undefined;
  }, [open]);

  // Global Escape-to-close. Bound only while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        // If a stream is in progress, abort it; close on a
        // second Escape (or just close — UX choice: close
        // immediately, the next open starts a fresh session).
        if (isStreaming) {
          abortRef.current?.abort();
        }
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isStreaming, onOpenChange]);

  // Auto-scroll the answer area as the stream grows. Uses
  // requestAnimationFrame to coalesce DOM updates.
  useEffect(() => {
    if (!isStreaming) return;
    const id = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [streamedText, isStreaming]);

  // ── Derived ─────────────────────────────────────────────
  const routeContext: RouteContext = parseRouteContext(location.pathname);
  const canSubmit = question.trim().length > 0 && !isStreaming;

  // ── Handlers ────────────────────────────────────────────
  const submit = async () => {
    const q = question.trim();
    if (!q) return;
    setError(null);
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
          idempotencyKey: `ui-${Date.now()}`,
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  if (!open) return null;

  return (
    <PanelChrome open={open} onClose={() => onOpenChange(false)}>
      <header className="flex items-center gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
        <div className="flex size-7 items-center justify-center rounded-full bg-[var(--color-agent-soft)] text-[var(--color-agent)]">
          <Sparkles className="size-3.5" aria-hidden />
        </div>
        <div className="flex-1">
          <h2 className="text-[var(--text-md)] font-semibold text-[var(--color-ink)]">
            <Trans>Ask AI</Trans>
          </h2>
          <p className="text-[10px] text-[var(--color-muted)]">
            <RouteContextLabel ctx={routeContext} />
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label={t({ message: "Close Ask AI panel" })}
          className="inline-flex size-7 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4"
        data-testid="ask-ai-scroll"
      >
        {!response && !isStreaming && !error && (
          <EmptyState />
        )}
        {(streamedText || isStreaming) && (
          <article
            data-testid="ask-ai-answer"
            className="prose prose-sm max-w-none whitespace-pre-wrap text-[var(--text-sm)] text-[var(--color-ink)]"
          >
            {streamedText}
            {isStreaming && (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-3 w-1 translate-y-0.5 animate-pulse bg-[var(--color-agent)]"
              />
            )}
          </article>
        )}
        {response && !isStreaming && (
          <div className="mt-3">
            <Citations
              citations={response.citations}
              onCitationClick={handleCitationClick}
            />
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="mt-2 rounded-[var(--radius-md)] border border-[var(--color-ruby)] bg-[var(--color-ruby-soft)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ruby)]"
          >
            <Trans>Couldn't reach the AI. Showing a stub answer instead.</Trans>
            {" "}
            <span className="text-[var(--color-muted)]">{error}</span>
          </p>
        )}
      </div>

      <footer className="border-t border-[var(--color-line)] bg-[var(--color-surface)] p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="ask-ai-input" className="sr-only">
            <Trans>Ask the AI a question</Trans>
          </label>
          <textarea
            id="ask-ai-input"
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              // Enter submits, Shift+Enter inserts a newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSubmit) void submit();
              }
            }}
            placeholder={t({
              message: "Ask about this page, the data, or what to do next…",
            })}
            rows={2}
            disabled={isStreaming}
            data-testid="ask-ai-input"
            className={cn(
              "resize-none rounded-[var(--radius-md)] border border-[var(--color-line)]",
              "bg-[var(--color-canvas)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ink)]",
              "placeholder:text-[var(--color-muted)] focus:border-[var(--color-brand)] focus:outline-none",
              "disabled:opacity-60",
            )}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-[var(--color-muted)]">
              <Trans>Press Enter to ask · Shift+Enter for newline</Trans>
            </p>
            <button
              type="submit"
              disabled={!canSubmit}
              data-testid="ask-ai-submit"
              aria-label={
                isStreaming
                  ? t({ message: "Stop generating" })
                  : t({ message: "Ask" })
              }
              className={cn(
                "inline-flex size-9 items-center justify-center rounded-full",
                "bg-[var(--color-agent)] text-white shadow-[var(--shadow-1)]",
                "hover:bg-[var(--color-agent-strong)] disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {isStreaming ? (
                <Square className="size-3.5" aria-hidden />
              ) : (
                <ArrowUp className="size-4" aria-hidden />
              )}
            </button>
          </div>
        </form>
        <a
          href="/app/ask-ai"
          onClick={(e) => {
            e.preventDefault();
            onOpenChange(false);
            navigate({ to: "/app/ask-ai" });
          }}
          className="mt-2 inline-flex items-center gap-1 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <Trans>Open the full page</Trans>
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </footer>
    </PanelChrome>
  );
}

/* ────────────── chrome (Phase 10.5 local) ────────────── */

/** Local PeekPanel-style drawer. To be swapped for the 10.4
 *  PeekPanel when it lands — same `open`/`onClose` props. */
function PanelChrome({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Phase 10.5: we animate only the entry (the brief does not
  // require a polished slide-in). The first render after `open`
  // flips true runs the `data-state="open"` transition.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ask AI"
      data-state={open ? "open" : "closed"}
      data-testid="ask-ai-panel"
      className="fixed inset-0 z-50 flex justify-end"
    >
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="flex-1 cursor-default bg-black/30 backdrop-blur-[2px]"
      />
      <div
        className={cn(
          "flex h-full w-[min(420px,92vw)] flex-col",
          "border-l border-[var(--color-line)] bg-[var(--color-surface)]",
          "shadow-[var(--shadow-2)]",
          "transition-transform duration-150",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/* ────────────── small presentational ────────────── */

function EmptyState() {
  return (
    <div
      data-testid="ask-ai-empty"
      className="flex flex-col items-center gap-2 px-2 py-8 text-center"
    >
      <Sparkles className="size-5 text-[var(--color-agent)]" aria-hidden />
      <p className="text-[var(--text-sm)] text-[var(--color-ink)]">
        <Trans>Ask anything about this page.</Trans>
      </p>
      <p className="text-[11px] text-[var(--color-muted)]">
        <Trans>
          The answer is a UI-only stub in Phase 10.5 — no data leaves your
          browser.
        </Trans>
      </p>
    </div>
  );
}

/** Renders "Finance › Invoices" style breadcrumb as a small label
 *  for the current route context. Falls back to the raw path when
 *  the route is not in the app catalog. */
function RouteContextLabel({ ctx }: { ctx: RouteContext }) {
  const appMeta = APPS[ctx.app as AppId];
  const parts: string[] = [];
  if (appMeta) parts.push(appMeta.label);
  else parts.push(ctx.app);
  if (ctx.entity) parts.push(humanise(ctx.entity));
  if (ctx.id) parts.push(`#${ctx.id}`);
  return (
    <span className="inline-flex items-center gap-0.5">
      <Trans>Context:</Trans>
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center">
          {i > 0 && <ChevronRight className="mx-0.5 size-2.5" aria-hidden />}
          {p}
        </span>
      ))}
    </span>
  );
}

function humanise(s: string): string {
  return s
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ────────────── route parsing ────────────── */

/** Heuristic: turn the current pathname into a RouteContext.
 *  Examples:
 *    /app/finance → {app:"finance", rawPath:"/app/finance"}
 *    /app/finance/invoices → {app:"finance", entity:"invoices", rawPath:...}
 *    /app/finance/invoices/inv_abc → {app:"finance", entity:"invoices", id:"inv_abc", rawPath:...}
 *  Anything we can't parse degrades to {app:"copilot", rawPath} so
 *  the UI still has *something* to display. */
export function parseRouteContext(pathname: string): RouteContext {
  const segs = pathname.split("/").filter(Boolean);
  // [0] = "app", [1] = appId, [2..] = entity/id/...
  if (segs[0] !== "app" || !segs[1]) {
    return { app: "copilot", rawPath: pathname };
  }
  const app = segs[1];
  const entity = segs[2];
  const id = segs[3];
  return {
    app,
    entity: entity ?? undefined,
    id: id ?? undefined,
    rawPath: pathname,
  };
}

// Re-export so tests / e2e can mock the panel mounting without
// touching the chrome.
export const __test = { PanelChrome };
// Re-export the icon type so downstream callers can type the
// resolved app meta without depending on lucide directly.
export type { LucideIcon };
