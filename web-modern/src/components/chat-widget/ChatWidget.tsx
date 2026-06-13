/**
 * ChatWidget — Floating chat widget for the SMB CRM portal (Phase 10, Track 5).
 *
 * Mirrors the legacy `chat-widget.js`. V1 uses polling (every 5s) for
 * inbound messages; real-time WebSocket is V2. Drop-in component:
 * mount once in the app shell.
 *
 * Armenian strings are inlined as `__ARM_*` placeholders.
 */
import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { getJson, postJson } from "../../lib/api/client";
import { cn } from "../../lib/utils/cn";

const ARM_TITLE = "SMB CRM · Chat";
const ARM_PLACEHOLDER = "Գրեք հաղորդագրությունը…";
const ARM_EMPTY = "Ոչ մի հաղորդագրություն դեռ";

type Message = {
  id: string;
  direction: "in" | "out";
  body: string;
  at: string;
};

export interface ChatWidgetProps {
  customerId: string;
  pollMs?: number;
}

export function ChatWidget({ customerId, pollMs = 5000 }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
  const lastSeenRef = useRef<string | null>(null);

  // Poll for inbound messages.
  useEffect(() => {
    if (!open || !customerId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await getJson(
          `/api/smb-crm/chat/${encodeURIComponent(customerId)}/messages${
            lastSeenRef.current ? `?since=${encodeURIComponent(lastSeenRef.current)}` : ""
          }`,
          // shape: { messages: Message[] }
          undefined as never,
        );
        if (cancelled) return;
        const list = (data as { messages?: Message[] }).messages ?? [];
        if (list.length > 0) {
          setMessages((m) => [...m, ...list]);
          lastSeenRef.current = list[list.length - 1]!.at;
        }
      } catch {
        // swallow; polling is best-effort
      }
    };
    tick();
    const h = window.setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(h);
    };
  }, [open, customerId, pollMs]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      await postJson(
        `/api/smb-crm/chat/${encodeURIComponent(customerId)}/messages`,
        {
          idempotencyKey: `smb-crm-chat-${Date.now()}`,
          body,
        },
        undefined as never,
      );
      setMessages((m) => [
        ...m,
        { id: `local-${Date.now()}`, direction: "out", body, at: new Date().toISOString() },
      ]);
      setText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2"
      data-testid="smb-crm-chat-widget"
      data-customer-id={customerId}
    >
      {open && (
        <section
          className="flex h-96 w-80 flex-col rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg"
          role="dialog"
          aria-label={ARM_TITLE}
          data-testid="smb-crm-chat-panel"
        >
          <header className="flex items-center justify-between border-b border-[var(--color-line)] px-3 py-2">
            <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              {ARM_TITLE}
            </h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-[var(--radius-sm)] p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]"
              aria-label="Close"
            >
              <X className="size-3.5" />
            </button>
          </header>
          <ol
            className="flex-1 space-y-1 overflow-y-auto p-2"
            data-testid="smb-crm-chat-messages"
          >
            {messages.length === 0 ? (
              <li className="px-2 py-3 text-center text-[11px] text-[var(--color-muted)]">
                {ARM_EMPTY}
              </li>
            ) : (
              messages.map((m) => (
                <li
                  key={m.id}
                  data-direction={m.direction}
                  className={cn(
                    "max-w-[80%] rounded-[var(--radius-md)] px-2 py-1 text-[12px]",
                    m.direction === "out"
                      ? "ml-auto bg-[var(--color-brand)] text-white"
                      : "mr-auto bg-[var(--color-surface-soft)] text-[var(--color-ink)]",
                  )}
                >
                  {m.body}
                </li>
              ))
            )}
          </ol>
          <form
            className="flex items-center gap-1 border-t border-[var(--color-line)] p-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={ARM_PLACEHOLDER}
              className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[12px] outline-none"
              data-testid="smb-crm-chat-input"
            />
            <button
              type="submit"
              disabled={sending || !text.trim()}
              className="rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-2 py-1 text-[12px] font-semibold text-white disabled:opacity-60"
              data-testid="smb-crm-chat-send"
            >
              <Send className="size-3" />
            </button>
          </form>
        </section>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-brand)] text-white shadow"
        data-testid="smb-crm-chat-toggle"
        aria-label={open ? "Close chat" : "Open chat"}
      >
        {open ? <X className="size-4" /> : <MessageCircle className="size-4" />}
      </button>
    </div>
  );
}

export default ChatWidget;
