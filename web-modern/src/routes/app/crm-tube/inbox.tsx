/**
 * /app/crm-tube/inbox — Tube unified inbox.
 *
 * Per the plan §3.4 + docs/phase8-tube/design.md §2.5, this is the
 * per-organisation message stream. It groups both `activity` and
 * `conversation` items by contact and shows them in a single feed,
 * newest-first. The V1 build is read-only — the reply input is
 * disabled because `POST /api/crm/tube/conversations/:id/messages`
 * is not yet shipped on the server.
 *
 * Data:
 *   GET /api/crm/tube/conversations → { items: TubeInboxItem[] }
 *
 * `unread_count` is computed client-side from the most-recent
 * `kind === "conversation"` item per contact (the server does not
 * yet expose a per-thread unread count).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Inbox as InboxIcon, Send } from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  TubeListResponseSchema,
  type TubeInboxItem,
} from "../../../lib/api/schemas";
import { cn } from "../../../lib/utils/cn";

/* ────────── typed route ────────── */

export const Route = createFileRoute("/app/crm-tube/inbox")({
  component: Inbox,
});

/* ────────── types ────────── */

interface ThreadRow {
  contactId: string | null;
  contactName: string;
  lastItem: TubeInboxItem;
  unreadCount: number;
  totalCount: number;
}

/* ────────── root component ────────── */

function Inbox() {
  const itemsQ = useQuery({
    queryKey: ["tube-inbox"],
    queryFn: () =>
      getJson("/api/crm/tube/conversations", TubeListResponseSchema),
    staleTime: 30_000,
  });

  const items = (itemsQ.data?.items ?? []) as TubeInboxItem[];

  const threads = useMemo<ThreadRow[]>(() => {
    if (items.length === 0) return [];
    const sorted = [...items].sort((a, b) =>
      (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""),
    );
    const byContact = new Map<string, ThreadRow>();
    for (const it of sorted) {
      const key = it.contact_id ?? "__none__";
      const existing = byContact.get(key);
      if (existing) {
        existing.totalCount += 1;
        if (it.kind === "conversation") existing.unreadCount += 1;
      } else {
        byContact.set(key, {
          contactId: it.contact_id,
          contactName: it.contact_name ?? "(no contact)",
          lastItem: it,
          unreadCount: it.kind === "conversation" ? 1 : 0,
          totalCount: 1,
        });
      }
    }
    return [...byContact.values()];
  }, [items]);

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeThread = useMemo(
    () => threads.find((t) => (t.contactId ?? "__none__") === activeKey) ?? threads[0] ?? null,
    [threads, activeKey],
  );
  const activeKeyResolved = activeThread
    ? (activeThread.contactId ?? "__none__")
    : null;

  const activeMessages = useMemo<TubeInboxItem[]>(() => {
    if (!activeThread) return [];
    return items
      .filter((it) => (it.contact_id ?? "__none__") === (activeThread.contactId ?? "__none__"))
      .sort((a, b) => (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""));
  }, [items, activeThread]);

  const isLoading = itemsQ.isLoading;
  const isError = itemsQ.isError;

  return (
    <div
      data-testid="tube-inbox"
      data-entity="tube-inbox"
      className="mx-auto max-w-7xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
    >
      <Link
        to="/app"
        className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        Back to today
      </Link>

      <header className="space-y-1">
        <h1 className="inline-flex items-center gap-2 text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
          <InboxIcon className="size-5" />
          Inbox
        </h1>
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          Ն · Inbox
        </p>
      </header>

      {isLoading ? (
        <p className="px-3 py-10 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          Loading inbox…
        </p>
      ) : isError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-sm)] border border-[var(--color-ruby,#b23a48)]/30 bg-[var(--color-ruby,#b23a48)]/5 px-2 py-1.5 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
        >
          Could not load the inbox.
        </p>
      ) : threads.length === 0 ? (
        <p
          data-testid="tube-inbox-empty"
          className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-10 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
        >
          No messages yet. Once a connected inbox or sequence starts sending,
          conversations will appear here.
        </p>
      ) : (
        <div
          data-testid="tube-inbox-split"
          className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
        >
          <ThreadList
            threads={threads}
            activeKey={activeKeyResolved}
            onSelect={(key) => setActiveKey(key)}
          />
          <MessagePane
            thread={activeThread}
            messages={activeMessages}
          />
        </div>
      )}
    </div>
  );
}

/* ────────── thread list (left ~40%) ────────── */

function ThreadList({
  threads,
  activeKey,
  onSelect,
}: {
  threads: ThreadRow[];
  activeKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <aside
      data-testid="tube-inbox-threads"
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
    >
      <ul className="divide-y divide-[var(--color-line)]">
        {threads.map((t) => {
          const key = t.contactId ?? "__none__";
          const active = key === activeKey;
          return (
            <li key={key}>
              <button
                type="button"
                data-testid="tube-inbox-thread"
                onClick={() => onSelect(key)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition",
                  active
                    ? "bg-[var(--color-surface-soft)]"
                    : "hover:bg-[var(--color-surface-soft)]",
                )}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="truncate text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
                    {t.contactName}
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    {t.unreadCount > 0 && (
                      <span
                        data-testid="tube-inbox-unread"
                        aria-label={`${t.unreadCount} unread`}
                        className="inline-block size-1.5 rounded-full bg-[var(--color-violet,#8b5cf6)]"
                      />
                    )}
                    {formatInboxTime(t.lastItem.occurred_at)}
                  </span>
                </div>
                <span className="line-clamp-1 text-[11px] text-[var(--color-muted)]">
                  {t.lastItem.subject ?? t.lastItem.body ?? "—"}
                </span>
                <span className="text-[10px] text-[var(--color-muted)]">
                  {t.totalCount} message{t.totalCount === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/* ────────── message pane (right ~60%) ────────── */

function MessagePane({
  thread,
  messages,
}: {
  thread: ThreadRow | null;
  messages: TubeInboxItem[];
}) {
  return (
    <section
      data-testid="tube-inbox-pane"
      className="flex h-full min-h-[400px] flex-col rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
    >
      {thread ? (
        <>
          <header className="border-b border-[var(--color-line)] px-3 py-2">
            <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              {thread.contactName}
            </h2>
            <p className="text-[11px] text-[var(--color-muted)]">
              {thread.totalCount} message{thread.totalCount === 1 ? "" : "s"}
            </p>
          </header>
          <ol className="flex-1 space-y-2 overflow-y-auto p-3">
            {messages.map((m) => (
              <li
                key={m.id}
                data-testid="tube-inbox-message"
                className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-2"
              >
                <div className="mb-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                  <span>{formatInboxTime(m.occurred_at)}</span>
                  <span className="rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-1 py-0.5">
                    {m.kind}
                  </span>
                  {m.channel && (
                    <span className="rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-1 py-0.5">
                      {m.channel}
                    </span>
                  )}
                </div>
                {m.subject && (
                  <p className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
                    {m.subject}
                  </p>
                )}
                {m.body && (
                  <p className="text-[var(--text-sm)] text-[var(--color-ink)]">{m.body}</p>
                )}
              </li>
            ))}
          </ol>
          <ReplyForm />
        </>
      ) : (
        <p className="m-auto px-3 py-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          Select a conversation to view its messages.
        </p>
      )}
    </section>
  );
}

/* ────────── reply form (disabled for V1) ────────── */

// TODO: POST /api/crm/tube/conversations/:id/messages not yet shipped.
// The V1 inbox is read-only — uncomment + wire the mutation when the
// server endpoint lands.
function ReplyForm() {
  return (
    <form
      data-testid="tube-inbox-reply"
      className="flex items-end gap-2 border-t border-[var(--color-line)] p-3"
      onSubmit={(e) => e.preventDefault()}
    >
      <textarea
        disabled
        rows={2}
        placeholder="Reply — V1 inbox is read-only"
        data-testid="tube-inbox-reply-input"
        className="flex-1 resize-none rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 text-[var(--text-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] disabled:cursor-not-allowed disabled:opacity-60"
      />
      <button
        type="submit"
        disabled
        data-testid="tube-inbox-reply-send"
        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-accent,#6c5ce7)] px-3 py-1.5 text-[var(--text-sm)] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Send className="size-3.5" />
        Send
      </button>
    </form>
  );
}

/* ────────── helpers ────────── */

/** Compact "Mmm dd HH:mm" formatter. Mirrors the format used in
 *  crm/contacts/$contactId.tsx. Avoids Intl.DateTimeFormat for test
 *  stability across Node versions. */
function formatInboxTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const mo = months[d.getMonth()] ?? "—";
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${mo} ${day} ${hh}:${mm}`;
}
