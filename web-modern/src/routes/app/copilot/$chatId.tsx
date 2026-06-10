/**
 * /app/copilot/$chatId — chat detail.
 *
 * Drills into a single chat from the Copilot workspace. Fetches
 * `/api/copilot/chats/:id` and renders a deterministic message
 * thread (user / assistant bubbles), the latest packet's status +
 * confidence, and the citation/calculation counts. Streaming can
 * be added in a later phase.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, ChevronLeft, CircleSlash, MessagesSquare, User } from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  CopilotChatDetailResponseSchema,
  type CopilotChatMessage,
  type CopilotPacket,
} from "../../../lib/api/schemas";
import { cn } from "../../../lib/utils/cn";
import {
  classifyPacketStatus,
  countCalculations,
  countCitations,
  formatConfidence,
  formatRelativeTime,
  intentLabel,
  messageCount,
  packetStatusLabel,
  packetStatusTone,
  riskLabel,
  riskTone,
  sortMessagesByCreatedAtAsc,
  type PacketTone,
  type RiskTone,
} from "../../../lib/copilot/status";

/* ────────── typed URL search ────────── */

export const Route = createFileRoute("/app/copilot/$chatId")({
  validateSearch: () => ({}),
  component: ChatDetail,
});

/* ────────── status pill ────────── */

const PACKET_TONE_CLASS: Record<PacketTone, { bg: string; fg: string }> = {
  info: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
  },
  positive: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
  },
  negative: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
  },
  warning: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
  },
  muted: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
  },
};

const RISK_TONE_CLASS: Record<RiskTone, { bg: string; fg: string }> = {
  info: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
  },
  positive: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
  },
  negative: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
  },
  warning: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
  },
  muted: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
  },
};

function StatusPill({ status }: { status: string | null | undefined }) {
  const tone = packetStatusTone({ status });
  const cls = PACKET_TONE_CLASS[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        cls.bg,
        cls.fg,
      )}
    >
      {packetStatusLabel({ status })}
    </span>
  );
}

function RiskPill({ risk }: { risk: string | null | undefined }) {
  const tone = riskTone({ riskLevel: risk });
  const cls = RISK_TONE_CLASS[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        cls.bg,
        cls.fg,
      )}
    >
      {riskLabel({ riskLevel: risk })}
    </span>
  );
}

/* ────────── root component ────────── */

function ChatDetail() {
  const { chatId } = Route.useParams();

  const q = useQuery({
    queryKey: ["copilot", "chat", chatId],
    queryFn: async () => {
      const raw = await getJson(`/api/copilot/chats/${encodeURIComponent(chatId)}`);
      return CopilotChatDetailResponseSchema.parse(raw);
    },
    enabled: Boolean(chatId),
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
        <PageHeader chatId={chatId} title={null} />
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading chat…</p>
      </div>
    );
  }

  if (q.isError || !q.data?.chat) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
        <PageHeader chatId={chatId} title={null} />
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          <CircleSlash className="mx-auto mb-2 size-5 opacity-50" />
          {q.isError ? "Failed to load chat." : "Chat not found."}
        </div>
        <BackLink />
      </div>
    );
  }

  const chat = q.data.chat;
  const messages = (chat.messages ?? []).slice().sort(sortMessagesByCreatedAtAsc);
  const total = messageCount(messages);
  const lastPacket = lastAssistantPacket(messages);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader chatId={chatId} title={chat.title} />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Messages" value={String(total)} hint="Հաղորդագրություններ" />
        <KpiCard
          label="Confidence"
          value={lastPacket ? formatConfidence(lastPacket.confidence) : "—"}
          hint="Վերջին պատասխանի վստահությունը"
        />
        <KpiCard
          label="Citations"
          value={lastPacket ? String(countCitations(lastPacket)) : "—"}
          hint="Հղումներ"
        />
        <KpiCard
          label="Calculations"
          value={lastPacket ? String(countCalculations(lastPacket)) : "—"}
          hint="Հաշվարկներ"
        />
      </section>

      {lastPacket ? (
        <div
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
          role="note"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={lastPacket.status} />
            <RiskPill risk={lastPacket.riskLevel} />
            <span className="text-[10px] text-[var(--color-muted)]">
              {lastPacket.reviewRequired
                ? "Պահանջվում է վերանայում"
                : "Ավտոմատ հաստատում"}
            </span>
          </div>
        </div>
      ) : null}

      <section
        className="space-y-3"
        data-entity="copilot-message"
        data-count={String(messages.length)}
      >
        {messages.length === 0 ? (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
            Այս խոսակցությունը դատարկ է։
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </section>

      <BackLink />
    </div>
  );
}

/* ────────── message bubble ────────── */

function MessageBubble({ message }: { message: CopilotChatMessage }) {
  const role = (message.role ?? "").toString().toLowerCase();
  const isUser = role === "user";
  const Icon = isUser ? User : Bot;
  const toneClass = isUser
    ? "bg-[color-mix(in_srgb,var(--color-tag-blue)_8%,var(--color-surface))] border-[color-mix(in_srgb,var(--color-tag-blue)_30%,var(--color-line))]"
    : "bg-[var(--color-surface)] border-[var(--color-line)]";
  const intent = message.packet ? intentLabel({ intent: message.packet.intent }) : null;

  return (
    <article
      className={cn(
        "rounded-[var(--radius-md)] border p-3",
        toneClass,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          <Icon className="size-3" aria-hidden />
          {isUser ? "Դուք" : "Copilot"}
        </div>
        <div className="inline-flex items-center gap-2 text-[10px] text-[var(--color-muted)]">
          {intent ? <span>{intent}</span> : null}
          {message.packet ? (
            <span>· {formatConfidence(message.packet.confidence)}</span>
          ) : null}
          {message.createdAt ? (
            <span>· {formatRelativeTime(message.createdAt)}</span>
          ) : null}
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[var(--text-sm)] text-[var(--color-ink)]">
        {message.content}
      </p>
    </article>
  );
}

/* ────────── page header ────────── */

function PageHeader({ chatId, title }: { chatId: string; title: string | null }) {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <MessagesSquare className="size-3" />
        Copilot · Chat
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
        {title ?? "Խոսակցություն"}
      </h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        <span className="font-mono">{chatId}</span>
      </p>
    </header>
  );
}

/* ────────── KPI card ────────── */

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className="mt-1 font-mono text-[var(--text-lg)] text-[var(--color-ink)]">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

/* ────────── back link ────────── */

function BackLink() {
  return (
    <Link
      to="/app/copilot"
      search={{ view: "chats" }}
      className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
    >
      <ChevronLeft className="size-3.5" />
      Back to Copilot
    </Link>
  );
}

/* ────────── helpers ────────── */

function lastAssistantPacket(
  messages: ReadonlyArray<CopilotChatMessage>,
): CopilotPacket | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m && m.packet) return m.packet;
  }
  return null;
}

// Suppress unused — class names exposed for future per-status tones.
void classifyPacketStatus;
