/**
 * DecisionCard — the explainable-AI primitive.
 *
 * Per the plan §3.2 pattern #6, every AI recommendation in the workspace
 * is presented as a card with six slots:
 *
 *   1. WHY       — short reasoning (1-2 sentences)
 *   2. SOURCE    — data lineage: which records, which rules, which KB
 *   3. CONFIDENCE — 0-100% with a progress bar
 *   4. WHAT WILL CHANGE — preview diff (collapsible)
 *   5. RISK      — impact assessment (tone-coded: low / medium / high)
 *   6. ACTIONS   — rollback / approve / edit / reject
 *
 * The card is mandatory on Finance / Procurement / Inventory / Payroll
 * surfaces, and Phase 4 will plumb in the full agent framework so the
 * `what will change` and `risk` slots are populated from real audit
 * data.
 *
 * Phase 1.4 ships:
 *   - the component itself (all six slots present)
 *   - a LIVE approve/reject path for the "Send WhatsApp reply" action,
 *     backed by POST /api/service/cases/:id/replies
 *   - rollback / edit buttons present but disabled, with a footer note
 *     that the agent framework lands in Phase 4
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Pencil,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../../lib/api/client";
import { HybridBadge, type HybridKind } from "../ui/HybridBadge";
import { cn } from "../../lib/utils/cn";

/* ────────────── types ────────────── */

export interface DecisionCardProps {
  /** Stable id for the underlying recommendation. */
  id: string;
  /** Short title — the action being proposed. */
  title: string;
  /** One-sentence "why" — the reasoning. */
  why: string;
  /** Source citations — KB articles, customer records, prior runs, etc. */
  sources: SourceCitation[];
  /** Confidence 0-100. */
  confidence: number;
  /** Risk level — drives the tone of the risk row. */
  risk: "low" | "medium" | "high";
  /** One-sentence risk description. */
  riskReason: string;
  /**
   * Preview of what will change. Key/value diff (e.g. status: open → in-progress).
   * Drives the "What will change" collapsible section.
   */
  preview?: PreviewDiff[];
  /** Hybrid badge to display next to the title. */
  kind?: HybridKind;
  /**
   * The action to invoke when the user clicks Approve. Returns a Promise
   * that resolves when the change is committed. If omitted, the button
   * is disabled and shows "Not wired in Phase 1.4".
   */
  onApprove?: () => Promise<void> | void;
  /**
   * The action to invoke when the user clicks Reject. By default this
   * just hides the card.
   */
  onReject?: () => void;
  /** Optional: called when the user wants to edit the proposal. */
  onEdit?: () => void;
  /** Optional: called when the user wants to roll back the change. */
  onRollback?: () => void;
}

export interface SourceCitation {
  label: string;
  /** Optional href / deep-link. */
  href?: string;
  /** "rule" / "data" / "kb" / "history" / "ai" — drives the chip color. */
  kind: "rule" | "data" | "kb" | "history" | "ai";
}

export interface PreviewDiff {
  field: string;
  from?: string;
  to: string;
}

/* ────────────── component ────────────── */

export function DecisionCard({
  id,
  title,
  why,
  sources,
  confidence,
  risk,
  riskReason,
  preview,
  kind = "agent",
  onApprove,
  onReject,
  onEdit,
  onRollback,
}: DecisionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [decided, setDecided] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const approveMut = useMutation({
    mutationFn: async () => {
      if (!onApprove) return;
      await onApprove();
    },
    onSuccess: () => {
      setDecided("approved");
      setError(null);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : "Approve failed");
    },
  });

  const handleReject = () => {
    onReject?.();
    setDecided("rejected");
  };

  // Already-decided view: collapsed banner, with optional rollback.
  if (decided === "approved") {
    return (
      <div
        className={cn(
          "rounded-[var(--radius-md)] border px-3 py-2",
          "border-[color-mix(in_srgb,var(--color-success)_30%,transparent)]",
          "bg-[color-mix(in_srgb,var(--color-success)_8%,transparent)]",
        )}
      >
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-success)]">
          <Check className="size-3" aria-hidden />
          <span className="font-semibold">Approved</span>
          <span className="text-[var(--color-muted)]">— {title}</span>
        </div>
        {onRollback && (
          <button
            type="button"
            onClick={onRollback}
            className="mt-1 inline-flex items-center gap-1 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-ruby)]"
          >
            <RotateCcw className="size-2.5" aria-hidden />
            Roll back
          </button>
        )}
      </div>
    );
  }
  if (decided === "rejected") {
    return (
      <div
        className={cn(
          "rounded-[var(--radius-md)] border px-3 py-2",
          "border-[color-mix(in_srgb,var(--color-ruby)_30%,transparent)]",
          "bg-[color-mix(in_srgb,var(--color-ruby)_8%,transparent)]",
        )}
      >
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-ruby)]">
          <X className="size-3" aria-hidden />
          <span className="font-semibold">Rejected</span>
          <span className="text-[var(--color-muted)]">— {title}</span>
        </div>
      </div>
    );
  }

  return (
    <article
      className={cn(
        "rounded-[var(--radius-lg)] border bg-[var(--color-surface)]",
        "border-[color-mix(in_srgb,var(--color-agent)_25%,transparent)]",
        "p-3",
      )}
      data-decision-id={id}
    >
      {/* Header — title + hybrid badge + confidence pill */}
      <header className="mb-2 flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-[var(--color-agent)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              {title}
            </h3>
            <HybridBadge kind={kind} />
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--color-ink)]">{why}</p>
        </div>
        <ConfidencePill value={confidence} />
      </header>

      {/* Sources — small chip row */}
      {sources.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Source
          </span>
          {sources.map((s, i) => (
            <SourceChip key={i} source={s} />
          ))}
        </div>
      )}

      {/* Risk */}
      <div className="mb-2 flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface-soft)] px-2 py-1.5">
        <AlertTriangle
          className={cn(
            "mt-0.5 size-3 shrink-0",
            risk === "high"
              ? "text-[var(--color-ruby)]"
              : risk === "medium"
                ? "text-[var(--color-copper)]"
                : "text-[var(--color-success)]",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1 text-[11px]">
          <span
            className={cn(
              "font-semibold uppercase tracking-wider",
              risk === "high"
                ? "text-[var(--color-ruby)]"
                : risk === "medium"
                  ? "text-[var(--color-copper)]"
                  : "text-[var(--color-success)]",
            )}
          >
            {risk} risk
          </span>
          <span className="ml-1.5 text-[var(--color-ink)]">{riskReason}</span>
        </div>
      </div>

      {/* What will change (collapsible) */}
      {preview && preview.length > 0 && (
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            aria-expanded={expanded}
          >
            <span>What will change</span>
            {expanded ? (
              <ChevronUp className="size-3" aria-hidden />
            ) : (
              <ChevronDown className="size-3" aria-hidden />
            )}
          </button>
          {expanded && (
            <ul className="mt-1 space-y-0.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-2">
              {preview.map((d, i) => (
                <li key={i} className="font-mono text-[11px]">
                  <span className="text-[var(--color-muted)]">{d.field}:</span>{" "}
                  {d.from && <span className="text-[var(--color-ruby)] line-through">{d.from}</span>}
                  {d.from && " → "}
                  <span className="text-[var(--color-success)]">{d.to}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Actions */}
      {error && (
        <p className="mb-2 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-ruby)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-ruby)_8%,transparent)] px-2 py-1 text-[11px] text-[var(--color-ruby)]">
          {error}
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <PrimaryButton
          icon={Check}
          onClick={() => approveMut.mutate()}
          disabled={!onApprove || approveMut.isPending}
          loading={approveMut.isPending}
          title={onApprove ? "Approve & apply" : "Not wired in Phase 1.4"}
        >
          {onApprove ? "Approve" : "Not wired"}
        </PrimaryButton>
        <SecondaryButton
          icon={X}
          onClick={handleReject}
          tone="danger"
          title="Reject — discard this proposal"
        >
          Reject
        </SecondaryButton>
        {onEdit && (
          <SecondaryButton
            icon={Pencil}
            onClick={onEdit}
            title="Edit the proposal before approving"
          >
            Edit
          </SecondaryButton>
        )}
        {onRollback && (
          <SecondaryButton
            icon={RotateCcw}
            onClick={onRollback}
            title="Roll back (only enabled after a previous approval)"
            disabled
          >
            Rollback
          </SecondaryButton>
        )}
      </div>
    </article>
  );
}

/* ────────────── subcomponents ────────────── */

function ConfidencePill({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const tone =
    pct >= 80
      ? "text-[var(--color-success)]"
      : pct >= 50
        ? "text-[var(--color-copper)]"
        : "text-[var(--color-ruby)]";
  return (
    <div
      className="shrink-0 text-right"
      aria-label={`Confidence ${pct}%`}
    >
      <div className={cn("font-mono text-[11px] font-semibold", tone)}>{pct}%</div>
      <div className="mt-0.5 h-1 w-12 overflow-hidden rounded-full bg-[var(--color-line)]">
        <div
          className={cn(
            "h-full",
            pct >= 80
              ? "bg-[var(--color-success)]"
              : pct >= 50
                ? "bg-[var(--color-copper)]"
                : "bg-[var(--color-ruby)]",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SourceChip({ source }: { source: SourceCitation }) {
  const { color, Icon } = SOURCE_META[source.kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-0.5",
        "text-[10px] font-medium",
        color.bg,
        color.fg,
        color.border,
      )}
      title={`${source.kind.toUpperCase()}: ${source.label}`}
    >
      <Icon className="size-2.5" aria-hidden />
      {source.label}
    </span>
  );
}

function PrimaryButton({
  children,
  icon: Icon,
  onClick,
  disabled,
  loading,
  title,
}: {
  children: React.ReactNode;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-md)] px-2 py-1",
        "bg-[var(--color-agent)] text-white",
        "hover:opacity-90",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "text-[11px] font-semibold",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {loading ? "Working…" : children}
    </button>
  );
}

function SecondaryButton({
  children,
  icon: Icon,
  onClick,
  disabled,
  tone = "default",
  title,
}: {
  children: React.ReactNode;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-md)] border px-2 py-1",
        "bg-[var(--color-surface)]",
        tone === "danger"
          ? "border-[color-mix(in_srgb,var(--color-ruby)_30%,transparent)] text-[var(--color-ruby)]"
          : "border-[var(--color-line)] text-[var(--color-ink)]",
        "hover:bg-[var(--color-surface-soft)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "text-[11px] font-medium",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {children}
    </button>
  );
}

/* ────────────── source kind meta ────────────── */

const SOURCE_META: Record<
  SourceCitation["kind"],
  { Icon: LucideIcon; color: { bg: string; fg: string; border: string } }
> = {
  rule: {
    Icon: FileText,
    color: {
      bg: "bg-[var(--color-deterministic-soft)]",
      fg: "text-[var(--color-deterministic)]",
      border: "border-[color-mix(in_srgb,var(--color-deterministic)_25%,transparent)]",
    },
  },
  data: {
    Icon: FileText,
    color: {
      bg: "bg-[var(--color-surface-soft)]",
      fg: "text-[var(--color-ink)]",
      border: "border-[var(--color-line)]",
    },
  },
  kb: {
    Icon: FileText,
    color: {
      bg: "bg-[color-mix(in_srgb,var(--color-tag-teal)_12%,transparent)]",
      fg: "text-[var(--color-tag-teal)]",
      border: "border-[color-mix(in_srgb,var(--color-tag-teal)_25%,transparent)]",
    },
  },
  history: {
    Icon: FileText,
    color: {
      bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_12%,transparent)]",
      fg: "text-[var(--color-tag-blue)]",
      border: "border-[color-mix(in_srgb,var(--color-tag-blue)_25%,transparent)]",
    },
  },
  ai: {
    Icon: Sparkles,
    color: {
      bg: "bg-[var(--color-agent-soft)]",
      fg: "text-[var(--color-agent)]",
      border: "border-[color-mix(in_srgb,var(--color-agent)_25%,transparent)]",
    },
  },
};

/* ────────────── ready-made reply decision (Phase 1.4 ship) ────────────── */

/** Pre-built Decision Card for the "Send WhatsApp reply" action.
 *  Wires the Approve path to POST /api/service/cases/:id/replies with a
 *  short canned body. This is the first LIVE decision-card flow in the
 *  new app. */
export function ReplyDecisionCard({
  caseId,
  channel,
  customerName,
  suggestedBody,
  confidence = 78,
  why,
  sources,
}: {
  caseId: string;
  channel: string;
  customerName: string;
  suggestedBody: string;
  confidence?: number;
  why: string;
  sources: SourceCitation[];
}) {
  const qc = useQueryClient();
  const replyMut = useMutation({
    mutationFn: async () => {
      // Cast widens the body type (see AIActionPanel for the same trick).
      return api(
        `/api/service/cases/${caseId}/replies`,
        null,
        { method: "POST", body: { body: suggestedBody } } as unknown as Parameters<typeof api>[2],
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service", "console"] });
    },
  });

  return (
    <DecisionCard
      id={`reply-${caseId}`}
      title={`Send ${channel} reply to ${customerName}`}
      why={why}
      sources={sources}
      confidence={confidence}
      risk="low"
      riskReason="Reply is human-approved before it goes out; customer sees your name."
      preview={[
        { field: "case.status", from: "in-progress", to: "waiting-customer" },
        { field: "case_messages[+1]", from: undefined, to: suggestedBody.slice(0, 32) + "…" },
      ]}
      kind="agent"
      onApprove={async () => {
        await replyMut.mutateAsync();
      }}
    />
  );
}
