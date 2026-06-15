/**
 * /app/smb-crm/ai — Ask AI (Phase 10.13 / slice 11)
 *
 * The sovereign "Ask AI" surface. Posts a {system, user} pair
 * to POST /api/ai/chat, which dispatches to the local Ollama
 * server (or the configured provider). The route never returns
 * a token / API key; the discriminated result is a 2xx envelope
 * with {ok, provider, model, data, error}.
 *
 * Why a separate page (not a sidebar on every route):
 *   - It has its own state model (history, temperature slider,
 *     max-tokens slider) that doesn't belong in the AppShell.
 *   - It has a clear entry point that doesn't compete with the
 *     primary "Onboarding wizard" surface on /app/smb-crm.
 *   - The /app launcher card links here from the SMB-CRM
 *     app.
 *
 * What this page guarantees (sovereign contract):
 *   - NO outbound network. The chat hits /api/ai/chat on the
 *     same origin, which dispatches to local Ollama.
 *   - NO API key is sent to or received from the browser.
 *   - The provider name + model are surfaced in the UI so the
 *     operator knows exactly which sovereign model answered.
 *   - When the provider is 'none' / 'disabled' / unavailable,
 *     a friendly empty state appears (no hard error).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, Send, Sparkles, AlertCircle, RefreshCw } from "lucide-react";
import { getJson, postJson } from "../../../../lib/api/client";
import {
  AiStatusResponseSchema,
  AiChatRequestSchema,
  AiChatResponseSchema,
  type AiStatusResponse,
  type AiChatResponse,
} from "../../../../lib/api/schemas";
import { cn } from "../../../../lib/utils/cn";

export const Route = createFileRoute("/app/smb-crm/ai/")({
  component: AskAiPage,
});

const SYSTEM_PROMPT_PRESETS: ReadonlyArray<{ id: string; label: string; prompt: string }> = [
  {
    id: "summarise",
    label: "Summarise",
    prompt:
      "You are a concise business analyst. Summarise the user's input in 3-5 bullet points. Use Armenian (hy-AM) if the user wrote in Armenian, otherwise English.",
  },
  {
    id: "translate",
    label: "Translate to Armenian",
    prompt:
      "You are a professional Armenian translator. Translate the user's input into Armenian (hy-AM). Preserve proper nouns. Reply with ONLY the translation, no preamble.",
  },
  {
    id: "draft",
    label: "Draft a customer email",
    prompt:
      "You are a polite Armenian SMB sales rep. Draft a short follow-up email for the user's input. Use Armenian (hy-AM) with a friendly tone.",
  },
  {
    id: "none",
    label: "Custom",
    prompt: "",
  },
];

function AskAiPage() {
  const [systemPrompt, setSystemPrompt] = useState<string>(SYSTEM_PROMPT_PRESETS[0]!.prompt);
  const [presetId, setPresetId] = useState<string>("summarise");
  const [userText, setUserText] = useState<string>("");
  const [temperature, setTemperature] = useState<number>(0.2);
  const [maxTokens, setMaxTokens] = useState<number>(1024);
  const [history, setHistory] = useState<Array<{ kind: "user" | "ai"; text: string; provider?: string; model?: string; ok?: boolean; error?: string | null }>>([]);

  const statusQ = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => getJson("/api/ai/status", AiStatusResponseSchema),
    staleTime: 30_000,
  });

  const chatMut = useMutation<AiChatResponse, Error, void>({
    mutationFn: async () => {
      // Server-side range validation. If the wrapper rejects,
      // the discriminated result has ok:false + error string.
      const req = AiChatRequestSchema.parse({
        system: systemPrompt || "You are a helpful assistant.",
        user: userText,
        temperature,
        maxTokens,
      });
      return postJson("/api/ai/chat", req, AiChatResponseSchema);
    },
    onSuccess: (resp) => {
      setHistory((h) => [
        ...h,
        { kind: "user", text: userText },
        {
          kind: "ai",
          text:
            resp.ok
              ? typeof resp.data === "string"
                ? resp.data
                : JSON.stringify(resp.data ?? "", null, 2)
              : "",
          provider: resp.provider,
          model: resp.model || undefined,
          ok: resp.ok,
          error: resp.ok ? null : resp.error || "unknown error",
        },
      ]);
      if (resp.ok) {
        setUserText("");
      }
    },
  });

  const onPresetChange = (id: string) => {
    setPresetId(id);
    const p = SYSTEM_PROMPT_PRESETS.find((x) => x.id === id);
    if (p) setSystemPrompt(p.prompt);
  };

  const canSend = userText.trim().length > 0 && !chatMut.isPending;

  return (
    <div
      className="mx-auto max-w-3xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="smb-crm-ai"
    >
      <Header status={statusQ.data} isLoading={statusQ.isLoading} />

      <PresetPicker value={presetId} onChange={onPresetChange} />

      <SystemPromptEditor value={systemPrompt} onChange={setSystemPrompt} />

      <HistoryView history={history} />

      <PromptInput
        value={userText}
        onChange={setUserText}
        onSend={() => chatMut.mutate()}
        disabled={!canSend}
        temperature={temperature}
        onTemperatureChange={setTemperature}
        maxTokens={maxTokens}
        onMaxTokensChange={setMaxTokens}
        isSending={chatMut.isPending}
      />

      {chatMut.isError && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-ruby,#b23a48)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_5%,transparent)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
          data-testid="smb-crm-ai-error"
        >
          Could not reach the AI route. Is the API server up?
        </p>
      )}

      <BackLink />
    </div>
  );
}

function Header({ status, isLoading }: { status?: AiStatusResponse; isLoading: boolean }) {
  return (
    <header className="flex items-end justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <div>
          <h1
            className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]"
            data-testid="smb-crm-ai-h1"
          >
            Ask AI
          </h1>
          <p
            className="text-[var(--text-sm)] text-[var(--color-muted)]"
            data-testid="smb-crm-ai-subtitle"
          >
            {ARM_SUBTITLE}
          </p>
        </div>
      </div>
      <ProviderBadge status={status} isLoading={isLoading} />
    </header>
  );
}

const ARM_SUBTITLE = "Sovereign local LLM · 0 outbound network";

function ProviderBadge({ status, isLoading }: { status?: AiStatusResponse; isLoading: boolean }) {
  if (isLoading) {
    return (
      <span
        className="rounded-[var(--radius-pill)] bg-[var(--color-surface-soft)] px-2 py-0.5 text-[11px] text-[var(--color-muted)]"
        data-testid="smb-crm-ai-status"
      >
        …
      </span>
    );
  }
  if (!status) {
    return (
      <span
        className="rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_15%,transparent)] px-2 py-0.5 text-[11px] text-[var(--color-ruby,#b23a48)]"
        data-testid="smb-crm-ai-status"
      >
        offline
      </span>
    );
  }
  if (!status.ok) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--color-amber,#d97706)_15%,transparent)] px-2 py-0.5 text-[11px] text-[var(--color-amber,#d97706)]"
        data-testid="smb-crm-ai-status"
      >
        <AlertCircle className="size-3" aria-hidden />
        {status.provider} {status.error ? `· ${status.error}` : ""}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--color-green,#15803d)_15%,transparent)] px-2 py-0.5 text-[11px] text-[var(--color-green,#15803d)]"
      data-testid="smb-crm-ai-status"
    >
      <Sparkles className="size-3" aria-hidden />
      {status.provider} · {status.models[0] || "model"}
    </span>
  );
}

function PresetPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div
      className="flex flex-wrap gap-1.5"
      data-testid="smb-crm-ai-presets"
    >
      {SYSTEM_PROMPT_PRESETS.map((p) => {
        const active = value === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            className={cn(
              "rounded-[var(--radius-pill)] border px-2.5 py-1 text-[11px] font-medium",
              active
                ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white"
                : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)]",
            )}
            data-testid="smb-crm-ai-preset"
            data-preset-id={p.id}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function SystemPromptEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-[var(--text-sm)]">
      <span className="text-[var(--color-muted)]">System prompt</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 font-mono text-[var(--text-sm)]"
        data-testid="smb-crm-ai-system-prompt"
      />
    </label>
  );
}

function HistoryView({ history }: { history: ReadonlyArray<{ kind: "user" | "ai"; text: string; provider?: string; model?: string; ok?: boolean; error?: string | null }> }) {
  if (history.length === 0) {
    return (
      <div
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
        data-testid="smb-crm-ai-history-empty"
      >
        Ask anything. Your prompt + the model's reply will appear here.
      </div>
    );
  }
  return (
    <ol
      className="space-y-2"
      data-testid="smb-crm-ai-history"
    >
      {history.map((entry, idx) => (
        <li
          key={idx}
          className={cn(
            "rounded-[var(--radius-md)] border p-3 text-[var(--text-sm)]",
            entry.kind === "user"
              ? "border-[var(--color-line)] bg-[var(--color-surface)]"
              : entry.ok === false
                ? "border-[color-mix(in_srgb,var(--color-ruby,#b23a48)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_5%,transparent)]"
                : "border-[color-mix(in_srgb,var(--color-brand)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-brand)_5%,var(--color-surface))]",
          )}
          data-ai-message-kind={entry.kind}
        >
          {entry.kind === "user" ? (
            <p className="whitespace-pre-wrap text-[var(--color-ink)]" data-testid="smb-crm-ai-history-user">
              {entry.text}
            </p>
          ) : entry.ok === false ? (
            <p className="text-[var(--color-ruby,#b23a48)]" data-testid="smb-crm-ai-history-err">
              {entry.error || "AI call failed"}
            </p>
          ) : (
            <>
              <p className="whitespace-pre-wrap text-[var(--color-ink)]" data-testid="smb-crm-ai-history-ai">
                {entry.text}
              </p>
              {entry.provider && (
                <p className="mt-1 text-[10px] text-[var(--color-muted)]">
                  via {entry.provider} {entry.model ? `(${entry.model})` : ""}
                </p>
              )}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

function PromptInput({
  value,
  onChange,
  onSend,
  disabled,
  temperature,
  onTemperatureChange,
  maxTokens,
  onMaxTokensChange,
  isSending,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
  temperature: number;
  onTemperatureChange: (n: number) => void;
  maxTokens: number;
  onMaxTokensChange: (n: number) => void;
  isSending: boolean;
}) {
  return (
    <div className="space-y-2" data-testid="smb-crm-ai-input-row">
      <label className="block text-[var(--text-sm)]">
        <span className="text-[var(--color-muted)]">Your message</span>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              if (!disabled) onSend();
            }
          }}
          rows={4}
          placeholder="Type your question (Armenian / English / Russian). Cmd/Ctrl+Enter to send."
          className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[var(--text-sm)]"
          data-testid="smb-crm-ai-user-input"
        />
      </label>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Sliders
          temperature={temperature}
          onTemperatureChange={onTemperatureChange}
          maxTokens={maxTokens}
          onMaxTokensChange={onMaxTokensChange}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-3 py-1.5 text-[var(--text-sm)] font-semibold text-white disabled:opacity-60"
          data-testid="smb-crm-ai-send"
        >
          {isSending ? <RefreshCw className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          Send
        </button>
      </div>
    </div>
  );
}

function Sliders({
  temperature,
  onTemperatureChange,
  maxTokens,
  onMaxTokensChange,
}: {
  temperature: number;
  onTemperatureChange: (n: number) => void;
  maxTokens: number;
  onMaxTokensChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-[var(--color-muted)]">
      <label className="flex items-center gap-1">
        temperature
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={temperature}
          onChange={(e) => onTemperatureChange(Number(e.target.value))}
          className="w-20"
          data-testid="smb-crm-ai-temperature"
        />
        <span className="font-mono">{temperature.toFixed(1)}</span>
      </label>
      <label className="flex items-center gap-1">
        max tokens
        <input
          type="number"
          min="1"
          max="4096"
          value={maxTokens}
          onChange={(e) => onMaxTokensChange(Math.max(1, Math.min(4096, Number(e.target.value) || 0)))}
          className="w-16 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-1 py-0.5 font-mono"
          data-testid="smb-crm-ai-max-tokens"
        />
      </label>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/app/smb-crm"
      className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      data-testid="smb-crm-ai-back"
    >
      <ChevronLeft className="size-3.5" />
      Back to SMB-CRM
    </Link>
  );
}
