/**
 * /app/desk/$caseId — Desk ticket detail.
 *
 * Per the plan §3.2 patterns:
 *   - Pattern #2 (Zoho): right-rail AI Action Panel on every record
 *   - Pattern #6 (Salesforce): Decision Card on every AI recommendation
 *
 * Layout (desktop):
 *   ┌──────────────────────┬─────────────────┐
 *   │ Detail header         │ AI Action Panel │
 *   │ Status tabs           │ Decision Cards  │
 *   │ Conversation timeline │ Context         │
 *   │ Related cases         │                 │
 *   └──────────────────────┴─────────────────┘
 *
 * Data: same /api/service/console envelope (we look up the case by id
 * from the cases array). The messages list comes from a separate
 * /api/service/cases/:id call, plus /api/service/cases/:id/escalate
 * and /resolve for live status transitions.
 */
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  Headphones,
  Inbox,
  MessageSquare,
  User,
} from "lucide-react";
import { getJson, api } from "../../../lib/api/client";
import {
  ServiceConsoleSchema,
  type ServiceCase,
  type ServiceCaseStatus,
} from "../../../lib/api/schemas";
import { HybridBadge } from "../../../components/ui/HybridBadge";
import { AIActionPanel, useCaseTransition } from "../../../components/action-panel/AIActionPanel";
import { ReplyDecisionCard } from "../../../components/decision-card/DecisionCard";
import { cn } from "../../../lib/utils/cn";

export const Route = createFileRoute("/app/desk/$caseId")({
  component: DeskDetail,
});

const STATUS_TONE: Record<ServiceCaseStatus, { bg: string; fg: string }> = {
  open: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
  },
  "in-progress": {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-violet)_15%,transparent)]",
    fg: "text-[var(--color-tag-violet)]",
  },
  "waiting-customer": {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-yellow)_15%,transparent)]",
    fg: "text-[var(--color-tag-yellow)]",
  },
  escalated: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
  },
  resolved: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
  },
  closed: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-teal)_15%,transparent)]",
    fg: "text-[var(--color-tag-teal)]",
  },
};

function DeskDetail() {
  const { caseId } = Route.useParams();
  const qc = useQueryClient();

  const consoleQuery = useQuery({
    queryKey: ["service", "console"],
    queryFn: () => getJson("/api/service/console", ServiceConsoleSchema),
  });
  const caseRecord = consoleQuery.data?.cases.find((c) => c.id === caseId) ?? null;

  // Messages for this case (separate fetch — the envelope doesn't carry them).
  const messagesQuery = useQuery({
    queryKey: ["service", "case", caseId, "messages"],
    queryFn: async () => {
      // The /api/service/cases/:id GET endpoint returns the case + messages.
      // We tolerate the shape; the detail page renders gracefully if absent.
      const raw = await api(`/api/service/cases/${caseId}`, null, {
        method: "GET",
      } as Parameters<typeof api>[2]);
      return raw as { case?: ServiceCase; messages?: { id: string; body: string; authorName: string; createdAt: string; channel: string }[] };
    },
    enabled: Boolean(caseRecord),
  });

  const transition = useCaseTransition({
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service", "case", caseId, "messages"] });
    },
  });

  if (consoleQuery.isLoading) {
    return (
      <div className="p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading…
      </div>
    );
  }
  if (!caseRecord) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-6 text-center">
        <Inbox className="mx-auto size-8 text-[var(--color-muted)]" aria-hidden />
        <h1 className="text-[var(--text-md)] font-semibold text-[var(--color-ink)]">
          Ticket not found
        </h1>
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          The case {caseId} doesn't exist in this organization.
        </p>
        <Link
          to="/app/desk"
          search={{ status: "all", createTicket: null }}
          className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-brand)] hover:underline"
        >
          <ChevronLeft className="size-3.5" />
          Back to Desk
        </Link>
      </div>
    );
  }

  const tone = STATUS_TONE[caseRecord.status];
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <Link
        to="/app/desk"
        search={{ status: "all", createTicket: null }}
        className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        Desk
      </Link>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── left column ── */}
        <div className="space-y-4">
          {/* Header */}
          <header className="rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-[var(--color-muted)]">
                    {caseRecord.caseNumber}
                  </span>
                  <span
                    className={cn(
                      "rounded-[var(--radius-sm)] px-1.5 py-0.5",
                      "text-[10px] font-semibold uppercase tracking-wider",
                      tone.bg,
                      tone.fg,
                    )}
                  >
                    {caseRecord.status}
                  </span>
                  <HybridBadge kind="agent" showLabel={false} />
                </div>
                <h1 className="mt-1 truncate text-[var(--text-xl)] font-semibold text-[var(--color-ink)]">
                  {caseRecord.subject}
                </h1>
                <p className="mt-0.5 text-[var(--text-sm)] text-[var(--color-muted)]">
                  {caseRecord.customerName}
                  {caseRecord.channel ? ` · ${caseRecord.channel}` : ""}
                  {caseRecord.ownerName ? ` · ${caseRecord.ownerName}` : " · Unassigned"}
                </p>
              </div>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
                <Headphones className="size-5" aria-hidden />
              </span>
            </div>
          </header>

          {/* Status transition row — quick "move to" buttons. */}
          <section className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
              Move to
            </span>
            {(
              ["open", "in-progress", "waiting-customer", "resolved", "closed"] as ServiceCaseStatus[]
            )
              .filter((s) => s !== caseRecord.status)
              .map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => transition.mutate({ id: caseRecord.id, patch: { status: s } })}
                  disabled={transition.isPending}
                  className={cn(
                    "rounded-[var(--radius-md)] border px-2 py-1",
                    "text-[11px] font-medium",
                    "border-[var(--color-line)] bg-[var(--color-surface)]",
                    "hover:border-[var(--color-brand)] hover:bg-[var(--color-surface-soft)]",
                    "disabled:opacity-50",
                  )}
                >
                  {s}
                </button>
              ))}
            {transition.isPending && (
              <span className="text-[10px] text-[var(--color-muted)]">saving…</span>
            )}
          </section>

          {/* Decision Card — the live "send WhatsApp reply" suggestion. */}
          {caseRecord.status === "waiting-customer" || caseRecord.status === "in-progress" ? (
            <ReplyDecisionCard
              caseId={caseRecord.id}
              channel={caseRecord.channel}
              customerName={caseRecord.customerName}
              suggestedBody={
                caseRecord.aiSuggestion
                  ? `Hello, regarding "${caseRecord.subject}" — ${caseRecord.aiSuggestion}`
                  : `Hello, following up on "${caseRecord.subject}". Can you confirm?`
              }
              why="Customer is waiting for a reply. The agent has prepared a draft grounded in the AI suggestion and the open KB article."
              sources={[
                { label: caseRecord.knowledgeArticle ?? "KB", kind: "kb" },
                { label: "AI suggestion", kind: "ai" },
                { label: "Prior case messages", kind: "history" },
              ]}
            />
          ) : null}

          {/* Conversation */}
          <section className="rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              <MessageSquare className="size-3.5" aria-hidden />
              Conversation
              <span className="font-normal text-[10px] text-[var(--color-muted)]">
                {messagesQuery.data?.messages?.length ?? caseRecord.messageCount ?? 0} messages
              </span>
            </h2>
            <ol className="space-y-2">
              {(messagesQuery.data?.messages ?? []).map((m) => (
                <li
                  key={m.id}
                  className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-2"
                >
                  <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--color-muted)]">
                    <User className="size-2.5" aria-hidden />
                    <span className="font-semibold text-[var(--color-ink)]">{m.authorName}</span>
                    <span>·</span>
                    <span>{m.channel}</span>
                    <span>·</span>
                    <span>{new Date(m.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-[var(--text-sm)] text-[var(--color-ink)]">{m.body}</p>
                </li>
              ))}
              {messagesQuery.isLoading && (
                <li className="text-[11px] text-[var(--color-muted)]">Loading messages…</li>
              )}
              {!messagesQuery.isLoading && (messagesQuery.data?.messages?.length ?? 0) === 0 && (
                <li className="text-[11px] text-[var(--color-muted)]">
                  No messages on this case yet.
                </li>
              )}
            </ol>
          </section>
        </div>

        {/* ── right column: AI Action Panel ── */}
        <div>
          <AIActionPanel
            case={caseRecord}
            isTransitioning={transition.isPending}
            onTransition={(s) => transition.mutate({ id: caseRecord.id, patch: { status: s } })}
          />
        </div>
      </div>
    </div>
  );
}

void notFound;
