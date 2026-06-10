/**
 * AgentActionPanel — right-rail list of `AgentSuggestion`s rendered as
 * `DecisionCard`s.
 *
 * Per the plan §3.2 patterns #2 (Zoho right-rail AI Action Panel) and #6
 * (Salesforce Explainable AI cards), this is the per-record context menu
 * that sits on every CRM / Inventory detail page.
 *
 * Each suggestion from an agent becomes one `DecisionCard`. The card's
 * `onApprove` callback is wired to `proposedAction` — a normal
 * `api(method, path, body)` call against the existing Fastify route. We
 * deliberately do NOT route through `/api/agents/:id/execute`; mutations
 * land on the same handler a human would hit, which means RBAC, audit
 * trail, and "the same business rule rejected the human too" all stay
 * in one place.
 *
 * Loading state: the panel runs `evaluate()` once per context. While
 * `evaluate()` is in flight, we show a calm "thinking" placeholder — NOT
 * a spinner per card (the user has no per-card control over agents
 * yet; the whole list is one query).
 *
 * Empty state: when no agent has anything to say, the panel collapses
 * to a one-liner ("No new suggestions") so the right rail still serves
 * a purpose.
 */

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api } from "../../lib/api/client";
import type {
  AgentContext,
  AgentSuggestion,
  SourceCitation,
} from "../../lib/agents/types";
import { AGENTS } from "../../lib/agents/registry";
import {
  DecisionCard,
  type PreviewDiff,
} from "../decision-card/DecisionCard";
import { HybridBadge, type HybridKind } from "../ui/HybridBadge";
import { cn } from "../../lib/utils/cn";

export interface AgentActionPanelProps {
  /** The context the agents are evaluated against. Drives the cache
   *  key — changing `contextType` or `contextId` invalidates the
   *  result automatically. */
  context: AgentContext;
  /** Optional className override for the wrapper. */
  className?: string;
  /** Heading text. Defaults to "AI suggestions". */
  title?: string;
  /** Called when a suggestion is approved. Use this to surface a
   *  toast, navigate, or refresh secondary queries. */
  onApproved?: (suggestion: AgentSuggestion) => void;
  /** Called when a suggestion is rejected. */
  onRejected?: (suggestion: AgentSuggestion) => void;
}

/** Run every registered agent's `evaluate()` against `context`,
 *  flatten the suggestions. Cache by `${contextType}:${contextId}`.
 *  Pure client-side fan-out — no server coordination needed since
 *  each agent is its own pure function. */
async function evaluateAll(
  context: AgentContext,
): Promise<{ agentId: string; suggestions: AgentSuggestion[] }[]> {
  const eligible = AGENTS.filter((a) => a.triggers.includes(context.type));
  // Sequential awaits keep the network in check for now. Phase 4 may
  // fan these out in parallel if profiling shows latency.
  const out: { agentId: string; suggestions: AgentSuggestion[] }[] = [];
  for (const agent of eligible) {
    try {
      const suggestions = await agent.evaluate(context);
      out.push({ agentId: agent.id, suggestions });
    } catch {
      // One agent's failure must not take down the panel. We swallow
      // and let the rest render. A future Phase 4 polish will surface
      // per-agent errors in a debug section.
      out.push({ agentId: agent.id, suggestions: [] });
    }
  }
  return out;
}

/** Map an `AgentSuggestion.previewDiff` (Record<string, unknown>) to
 *  the `PreviewDiff[]` shape DecisionCard expects. Best-effort: we
 *  stringify both sides; richer UIs (in Phase 4) will replace this. */
function toPreviewDiff(
  diff: Record<string, unknown>,
): PreviewDiff[] {
  return Object.entries(diff).map(([field, value]) => {
    if (
      value &&
      typeof value === "object" &&
      "from" in value &&
      "to" in value
    ) {
      const v = value as { from: unknown; to: unknown };
      return {
        field,
        from: v.from == null ? undefined : String(v.from),
        to: String(v.to ?? ""),
      };
    }
    return { field, to: String(value ?? "") };
  });
}

/** Map an `AgentSuggestion.sourceRecords` (string[]) +
 *  `sourceCitations?` to DecisionCard's `SourceCitation[]`. Strings
 *  become `kind: "data"` chips with no href. */
function toSources(s: AgentSuggestion): SourceCitation[] {
  const fromStructured = s.sourceCitations ?? [];
  const fromStrings = s.sourceRecords
    .filter((label) => !fromStructured.some((c) => c.label === label))
    .map<SourceCitation>((label) => ({ label, kind: "data" }));
  return [...fromStructured, ...fromStrings];
}

export function AgentActionPanel({
  context,
  className,
  title = "AI suggestions",
  onApproved,
  onRejected,
}: AgentActionPanelProps) {
  const qc = useQueryClient();
  const [decidedIds, setDecidedIds] = useState<Set<string>>(new Set());

  const queryKey = ["agents", context.type, context.id] as const;
  const query = useQuery({
    queryKey: [...queryKey],
    queryFn: () => evaluateAll(context),
    staleTime: 30_000,
  });

  // If the context changes (route nav, record swap), forget decisions
  // — the user is looking at a new record, their approvals don't carry.
  useEffect(() => {
    setDecidedIds(new Set());
  }, [context.type, context.id]);

  const allSuggestions: AgentSuggestion[] = (query.data ?? []).flatMap(
    (r) => r.suggestions,
  );
  const visible = allSuggestions.filter((s) => !decidedIds.has(s.id));

  return (
    <aside
      aria-label={title}
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3",
        className,
      )}
    >
      <header className="flex items-center justify-between">
        <h3 className="inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
          <Sparkles className="size-3.5" />
          {title}
        </h3>
        <span className="text-[11px] text-[var(--color-muted)]">
          {query.isLoading
            ? "thinking…"
            : `${visible.length} suggestion${visible.length === 1 ? "" : "s"}`}
        </span>
      </header>

      {query.isError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-sm)] border border-[var(--color-ruby,#b23a48)]/30 bg-[var(--color-ruby,#b23a48)]/5 px-2 py-1.5 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
        >
          Could not load agent suggestions.
        </p>
      ) : query.isLoading ? (
        <p className="px-2 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          Agents are reviewing this record…
        </p>
      ) : visible.length === 0 ? (
        <p className="px-2 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          {allSuggestions.length > 0
            ? "All suggestions addressed."
            : "No new suggestions."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((s) => (
            <DecisionCard
              key={s.id}
              id={s.id}
              title={s.title}
              why={s.rationale}
              sources={toSources(s)}
              confidence={Math.round((s.confidence ?? 0) * 100)}
              risk={s.risk}
              riskReason={s.riskReason}
              preview={toPreviewDiff(s.previewDiff)}
              kind={(s.kind ?? "agent") as HybridKind}
              onApprove={async () => {
                const { method, path, body } = s.proposedAction;
                // We don't parse the response here — the parent route
                // can read the mutation's onSuccess for finer refresh
                // control. We DO invalidate the agent query so the
                // card disappears once the source data shifts.
                await api(
                  path,
                  null,
                  { method, body } as unknown as Parameters<typeof api>[2],
                );
                setDecidedIds((prev) => new Set(prev).add(s.id));
                qc.invalidateQueries({ queryKey });
                onApproved?.(s);
              }}
              onReject={() => {
                setDecidedIds((prev) => new Set(prev).add(s.id));
                onRejected?.(s);
              }}
            />
          ))}
        </div>
      )}

      <footer className="flex items-center gap-1 border-t border-[var(--color-line)] pt-2 text-[11px] text-[var(--color-muted)]">
        <HybridBadge kind="agent" />
        <span>Suggestions come from the agent registry. Approvals hit the same API a human would.</span>
      </footer>
    </aside>
  );
}
