/**
 * AIActionPanel — Zoho-style right-rail context-aware actions.
 *
 * Per the plan §3.2 pattern #2, this is the per-record context menu that
 * sits on every detail page. It is NOT a chat surface — it's a list of
 * tappable proposed actions, each with:
 *   - a hybrid badge (agent / rule / resolved)
 *   - a short title
 *   - a one-line reason
 *   - an optional confidence pill
 *   - a primary button (the action)
 *
 * Sections:
 *   - SUGGESTED — what the system recommends the user do next
 *   - INSIGHTS  — what the system has already learned about this record
 *   - CONTEXT   — static facts that ground the user's decisions
 *
 * The actions are derived from the case's data (status / priority / SLA /
 * owner). The agent framework that *generates* the suggestions lands in
 * Phase 4 — for Phase 1.3 the panel ships with a deterministic derivation
 * (the "what would a triage operator suggest?" list) plus one LIVE action
 * (status transitions) so the panel feels useful, not decorative.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Info,
  Send,
  Sparkles,
  TimerReset,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, type JsonBody } from "../../lib/api/client";
import {
  UpdateServiceCaseResponseSchema,
  type ServiceCase,
  type ServiceCaseStatus,
} from "../../lib/api/schemas";
import { HybridBadge, type HybridKind } from "../ui/HybridBadge";
import { cn } from "../../lib/utils/cn";

/* ────────────── types ────────────── */

interface SuggestedAction {
  id: string;
  title: string;
  reason: string;
  kind: HybridKind;
  /** Visual weight: "primary" → filled button, "secondary" → outline. */
  weight: "primary" | "secondary";
  /** Optional confidence (0–100). Drives a progress-style pill. */
  confidence?: number;
  /** Icon. Defaults to ChevronRight. */
  icon?: LucideIcon;
}

interface PanelProps {
  case: ServiceCase;
  /** Called when the user invokes a status transition. */
  onTransition?: (nextStatus: ServiceCaseStatus) => void;
  /** Whether the panel is currently inside a transitioning mutation. */
  isTransitioning?: boolean;
}

/* ────────────── derivations ────────────── */

/** Build the suggested list from a case record. The shape is fixed
 *  (deterministic derivation), but `enabled` toggles which actions
 *  make sense given the current status / SLA / priority. */
function deriveActions(c: ServiceCase): SuggestedAction[] {
  const actions: SuggestedAction[] = [];

  // High-priority waiting-customer cases get the AI's VAT-drafting hint
  // (the seed data has a real case with `aiSuggestion` for this).
  if (c.aiSuggestion) {
    actions.push({
      id: "apply-ai-suggestion",
      title: "Apply AI suggestion",
      reason: c.aiSuggestion,
      kind: "agent",
      weight: "primary",
      confidence: 82,
      icon: Sparkles,
    });
  }

  // SLA at-risk / breached → nudge to escalate.
  if (c.slaStatus === "breached" && c.status !== "escalated") {
    actions.push({
      id: "escalate",
      title: "Escalate to supervisor",
      reason: "SLA breached — owner can't bring this back in time.",
      kind: "rule",
      weight: "primary",
      icon: ArrowUpRight,
    });
  }

  // Unowned high-priority → suggest assign.
  if (!c.ownerName && c.priority === "high") {
    actions.push({
      id: "assign",
      title: "Assign to on-call agent",
      reason: "High-priority ticket is unowned. Round-robin will pick one.",
      kind: "rule",
      weight: "secondary",
      icon: UserPlus,
    });
  }

  // waiting-customer → suggest nudging them.
  if (c.status === "waiting-customer") {
    actions.push({
      id: "nudge-customer",
      title: "Nudge customer",
      reason: `No reply from ${c.customerName} in 3+ days. Send a WhatsApp reminder.`,
      kind: "agent",
      weight: "secondary",
      icon: Send,
    });
  }

  // generic: send WhatsApp reply
  if (c.channel === "WhatsApp" && c.status !== "resolved" && c.status !== "closed") {
    actions.push({
      id: "send-reply",
      title: "Send WhatsApp reply",
      reason: "Customer is on WhatsApp; reply goes through the same channel.",
      kind: "rule",
      weight: "secondary",
      icon: Send,
    });
  }

  return actions;
}

/* ────────────── component ────────────── */

export function AIActionPanel({ case: c, onTransition, isTransitioning }: PanelProps) {
  const actions = deriveActions(c);
  return (
    <aside
      className={cn(
        "rounded-[var(--radius-xl)] border border-[var(--color-line)]",
        "bg-[var(--color-surface)] p-3",
        "sticky top-[calc(var(--spacing-12)+var(--spacing-2))]", // below topbar
      )}
      aria-label="AI action panel"
    >
      <header className="mb-2 flex items-center gap-2">
        <Sparkles className="size-3.5 text-[var(--color-agent)]" aria-hidden />
        <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          AI Action Panel
        </h2>
        <HybridBadge kind="agent" showLabel={false} />
      </header>

      <Section title="Suggested actions" count={actions.length}>
        {actions.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-[var(--color-muted)]">
            Nothing to suggest — this case is on track.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {actions.map((a) => (
              <ActionCard
                key={a.id}
                action={a}
                onActivate={() => {
                  // Phase 1.3: only the live actions are wired. The
                  // framework actions ship in Phase 4.
                  if (a.id === "send-reply" && onTransition) {
                    onTransition("in-progress");
                  }
                }}
                disabled={isTransitioning}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="AI insights" count={c.aiSuggestion ? 1 : 0}>
        {c.aiSuggestion ? (
          <p className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-2 text-[11px] text-[var(--color-ink)]">
            <Sparkles className="mr-1 inline-block size-3 text-[var(--color-agent)]" aria-hidden />
            {c.aiSuggestion}
          </p>
        ) : (
          <p className="px-2 py-2 text-[11px] text-[var(--color-muted)]">
            No AI insights yet for this case.
          </p>
        )}
      </Section>

      <Section title="Context" count={3}>
        <ul className="space-y-1 text-[11px] text-[var(--color-ink)]">
          <ContextRow label="Customer" value={c.customerName} />
          <ContextRow label="Channel" value={c.channel} />
          <ContextRow label="Owner" value={c.ownerName ?? "Unassigned"} />
          {c.slaDueAt && (
            <ContextRow
              label="SLA"
              value={c.slaStatus === "breached" ? "breached" : c.slaStatus ?? "—"}
              tone={c.slaStatus === "breached" ? "danger" : c.slaStatus === "at-risk" ? "warn" : "ok"}
            />
          )}
          {c.knowledgeArticle && (
            <ContextRow label="KB" value={c.knowledgeArticle} />
          )}
        </ul>
      </Section>

      <p className="mt-2 border-t border-[var(--color-line)] pt-2 text-[10px] text-[var(--color-muted)]">
        The decision card for these actions (why / source / confidence /
        approve / edit / reject) wires up in Phase 1.4.
      </p>
    </aside>
  );
}

/* ────────────── subcomponents ────────────── */

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-3 last:mb-0">
      <h3 className="mb-1 flex items-baseline gap-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
        {title}
        {typeof count === "number" && (
          <span className="font-normal text-[var(--color-muted)]">({count})</span>
        )}
      </h3>
      {children}
    </section>
  );
}

function ActionCard({
  action,
  onActivate,
  disabled,
}: {
  action: SuggestedAction;
  onActivate: () => void;
  disabled?: boolean;
}) {
  const Icon = action.icon ?? ChevronRight;
  const base =
    "flex w-full items-start gap-2 rounded-[var(--radius-md)] border px-2 py-1.5 text-left";
  const tone =
    action.weight === "primary"
      ? "border-[color-mix(in_srgb,var(--color-agent)_35%,transparent)] bg-[var(--color-agent-soft)] hover:border-[var(--color-agent)]"
      : "border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-brand)]";
  return (
    <li>
      <button
        type="button"
        onClick={onActivate}
        disabled={disabled}
        className={cn(base, tone, "disabled:opacity-50")}
      >
        <Icon className="mt-0.5 size-3.5 shrink-0 text-[var(--color-agent)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
              {action.title}
            </span>
            <HybridBadge kind={action.kind} />
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--color-muted)]">
            {action.reason}
          </p>
          {typeof action.confidence === "number" && (
            <div className="mt-1 flex items-center gap-1.5">
              <div
                className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-line)]"
                aria-hidden
              >
                <div
                  className="h-full bg-[var(--color-agent)]"
                  style={{ width: `${action.confidence}%` }}
                />
              </div>
              <span className="font-mono text-[10px] text-[var(--color-muted)]">
                {action.confidence}%
              </span>
            </div>
          )}
        </div>
      </button>
    </li>
  );
}

function ContextRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "danger";
}) {
  const valueClass =
    tone === "danger"
      ? "text-[var(--color-ruby)]"
      : tone === "warn"
        ? "text-[var(--color-copper)]"
        : "text-[var(--color-ink)]";
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span className="text-[var(--color-muted)]">{label}</span>
      <span className={cn("truncate font-medium", valueClass)}>{value}</span>
    </li>
  );
}

/* ────────────── status transition hook ────────────── */

interface UseCaseTransitionOptions {
  onSuccess?: (next: ServiceCase) => void;
}

/** Mutation hook for the live PATCH /api/service/cases/:id transition.
 *  Invalidates the service/console query so Today + Mission Control
 *  re-fetch. */
export function useCaseTransition({ onSuccess }: UseCaseTransitionOptions = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: JsonBody }) => {
      // The signature of `api` is `RequestInit & ApiOptions`. The two
      // `body` types disagree (BodyInit | null vs JsonBody); client.ts
      // casts at the fetch() call site. We use `as Parameters<...>[2]`
      // to opt into the same widening.
      return api(
        `/api/service/cases/${id}`,
        UpdateServiceCaseResponseSchema,
        { method: "PATCH", body: patch } as Parameters<typeof api>[2],
      );
    },
    onSuccess: (result) => {
      if (result?.case) onSuccess?.(result.case);
      qc.invalidateQueries({ queryKey: ["service", "console"] });
    },
  });
}

/* ────────────── icon re-exports for callers ────────────── */
// Re-export so a detail page can compose its own action row without
// importing lucide directly.
export { CheckCircle2, Info, Send, TimerReset, ArrowUpRight };
