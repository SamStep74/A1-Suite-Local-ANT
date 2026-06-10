/**
 * /app/copilot/ — Copilot chat workspace.
 *
 * Sub-route of the top-level /app/copilot Mission Control. The top
 * route (/app/copilot) is unchanged; this directory mounts the
 * chat-history view as a sibling surface (chats | recent | agents)
 * so the top route still owns the ops dashboard.
 *
 * URL state:
 *   ?view=chats | recent | agents
 *
 * Data (all require app=copilot access):
 *   - GET /api/copilot/chats                  → chat summaries
 *   - GET /api/copilot/chats/:id              → chat with messages
 *   - POST /api/copilot/questions             → ask a new question
 *   - GET /api/copilot/agents                 → list of agent personas
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, ChevronLeft, MessagesSquare, MessageSquarePlus, Sparkles } from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  CopilotChatsListResponseSchema,
  type CopilotChatSummary,
} from "../../../lib/api/schemas";
import { ViewSwitcher } from "../../../components/view-switcher/ViewSwitcher";
import { cn } from "../../../lib/utils/cn";
import {
  classifyPacketStatus,
  formatRelativeTime,
  intentLabel,
  packetStatusLabel,
  packetStatusTone,
  sortChatsByLastActivityDesc,
  totalMessageCount,
  type PacketTone,
} from "../../../lib/copilot/status";

/* ────────── typed URL search ────────── */

type View = "chats" | "recent" | "agents";

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "chats", label: "Chats" },
  { value: "recent", label: "Recent" },
  { value: "agents", label: "Agents" },
];

export const Route = createFileRoute("/app/copilot/")({
  validateSearch: (raw) => {
    const v: View =
      raw.view === "recent" || raw.view === "agents" ? raw.view : "chats";
    return { view: v };
  },
  component: CopilotWorkspace,
});

/* ────────── status pill ────────── */

const TONE_CLASS: Record<PacketTone, { bg: string; fg: string }> = {
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
  const cls = TONE_CLASS[tone];
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

/* ────────── root component ────────── */

function CopilotWorkspace() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view: View = search.view;
  const setView = (next: View) => navigate({ search: { view: next }, replace: true });

  const chatsQ = useQuery({
    queryKey: ["copilot", "chats"],
    queryFn: async () => {
      const raw = await getJson("/api/copilot/chats");
      return CopilotChatsListResponseSchema.parse(raw);
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ViewSwitcher options={VIEW_OPTIONS} value={view} onChange={setView} />
        <Link
          to="/app/copilot"
          search={{ view: "chats" }}
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          Mission Control
        </Link>
      </div>

      {view === "chats" && (
        <ChatsView data={chatsQ.data} loading={chatsQ.isLoading} error={chatsQ.isError} />
      )}
      {view === "recent" && (
        <RecentView data={chatsQ.data} loading={chatsQ.isLoading} error={chatsQ.isError} />
      )}
      {view === "agents" && <AgentsView />}
    </div>
  );
}

/* ────────── page header ────────── */

function PageHeader() {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <MessagesSquare className="size-3" />
        Copilot
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">Copilot</h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Խոսակցություններ · Վերջին ակտիվություն · Գործակալներ
      </p>
    </header>
  );
}

/* ────────── KPI card ────────── */

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className="mt-1 font-mono text-[var(--text-lg)] text-[var(--color-ink)]">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

/* ────────── Chats view ────────── */

function ChatsView({
  data,
  loading,
  error,
}: {
  data: { chats: CopilotChatSummary[] } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading chats…</p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load chats.
      </p>
    );
  }

  const chats = (data?.chats ?? []).slice().sort(sortChatsByLastActivityDesc);
  const total = totalMessageCount(chats);

  if (chats.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
        <MessageSquarePlus className="mx-auto mb-2 size-5 opacity-50" />
        Խոսակցություններ դեռ չկան։
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Chats" value={String(chats.length)} hint="Ընդհանուր" />
        <KpiCard label="Messages" value={String(total)} hint="Հաղորդագրություններ" />
        <KpiCard
          label="Top intent"
          value={chats[0] ? intentLabel({ intent: chats[0].intent }) : "—"}
          hint="Վերջինի մտադրությունը"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="copilot-chat"
        data-count={String(chats.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Title
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Intent
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Messages
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Last activity
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {chats.map((c) => (
              <tr key={c.id} className="hover:bg-[var(--color-surface-soft)]">
                <td className="px-3 py-2">
                  <Link
                    to="/app/copilot/$chatId"
                    params={{ chatId: c.id }}
                    className="font-medium text-[var(--color-ink)] hover:text-[var(--color-brand)]"
                  >
                    {c.title}
                  </Link>
                </td>
                <td className="px-3 py-2 text-[var(--color-muted)]">
                  {intentLabel({ intent: c.intent })}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                  {c.messageCount ?? 0}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-muted)]">
                  {formatRelativeTime(c.lastMessageAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ────────── Recent view ────────── */

function RecentView({
  data,
  loading,
  error,
}: {
  data: { chats: CopilotChatSummary[] } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading recent…</p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load recent activity.
      </p>
    );
  }

  // The "recent" view mirrors "chats" but is keyed off the last
  // activity timestamp. For now we sort the same set, treating this
  // as a recency-only view (no separate API call yet).
  const chats = (data?.chats ?? []).slice().sort(sortChatsByLastActivityDesc);
  const last24h = chats.filter((c) => {
    if (!c.lastMessageAt) return false;
    const age = Date.now() - new Date(c.lastMessageAt).getTime();
    return age >= 0 && age <= 24 * 60 * 60 * 1000;
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Last 24h" value={String(last24h.length)} hint="Վերջին օրվա" />
        <KpiCard label="Total chats" value={String(chats.length)} hint="Ընդհանուր" />
        <KpiCard
          label="Most recent"
          value={chats[0]?.title ?? "—"}
          hint={chats[0] ? formatRelativeTime(chats[0].lastMessageAt) : undefined}
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="copilot-recent-chat"
        data-count={String(chats.length)}
      >
        {chats.length === 0 ? (
          <div className="p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
            Վերջին ակտիվություն դեռ չկա։
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {chats.map((c) => (
              <li key={c.id} className="px-3 py-2">
                <Link
                  to="/app/copilot/$chatId"
                  params={{ chatId: c.id }}
                  className="flex items-center gap-3 text-[var(--text-sm)] text-[var(--color-ink)] hover:text-[var(--color-brand)]"
                >
                  <Sparkles className="size-3.5 shrink-0 text-[var(--color-agent)]" aria-hidden />
                  <span className="flex-1 truncate font-medium">{c.title}</span>
                  <span className="font-mono text-[11px] text-[var(--color-muted)]">
                    {formatRelativeTime(c.lastMessageAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ────────── Agents view (constant list) ────────── */

const AGENTS: ReadonlyArray<{
  key: string;
  title: string;
  description: string;
  intent: string;
}> = [
  {
    key: "vat",
    title: "VAT advisor",
    description: "ԱԱՀ-ի խորհրդատվություն, հաշվարկ և արտահանման փաթեթի նախապատրաստում։",
    intent: "vat",
  },
  {
    key: "payroll",
    title: "Payroll advisor",
    description: "Աշխատավարձի նախադիտում, հայկական պահումներ, ֆինանսական վերանայում։",
    intent: "payroll",
  },
  {
    key: "personal-data",
    title: "Personal data guide",
    description: "Անձնական տվյալների արտահանման/ջնջման հարցումների ուղեցույց։",
    intent: "personal-data",
  },
  {
    key: "esign",
    title: "e-Sign guide",
    description: "Էլեկտրոնային ստորագրության իրավական ուղեցույց։",
    intent: "esign",
  },
  {
    key: "month-close",
    title: "Month close",
    description: "Ամսվա փակման նախապատրաստման խորհրդատվություն։",
    intent: "month-close",
  },
  {
    key: "general",
    title: "General assistant",
    description: "Ընդհանուր հարցերի պատասխանում, առանց մասնագիտական վերանայման։",
    intent: "general",
  },
];

function AgentsView() {
  return (
    <div className="space-y-4">
      <div
        className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
        role="note"
      >
        <p className="inline-flex items-center gap-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          <Bot className="size-3.5" />
          Հասցեավորված գործակալներ
        </p>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Ընտրեք մտադրությունը (intent) խոսակցություն սկսելու համար։
        </p>
      </div>

      <section
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        data-entity="copilot-agent"
        data-count={String(AGENTS.length)}
      >
        {AGENTS.map((a) => (
          <div
            key={a.key}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
          >
            <p className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              {a.title}
            </p>
            <p className="mt-1 text-[11px] text-[var(--color-muted)]">{a.description}</p>
            <div className="mt-2 flex items-center justify-between">
              <StatusPill status={classifyPacketStatus({ status: "draft" })} />
              <span className="font-mono text-[11px] text-[var(--color-muted)]">
                {intentLabel({ intent: a.intent })}
              </span>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
