/**
 * /app/copilot/onboarding — AI Provider & Models setup.
 *
 * Phase 8.11 layer 2. The route lets the Owner configure the
 * OpenRouter API key, pick the 6 per-aspect model ids (default,
 * copilot, transform, finance, crm, docs), and toggle the
 * optional Open Notebook RAG source. Mirrors the legacy
 * `web/src/ai-onboarding.jsx` UX surface and the `putRequestFromForm`
 * semantics: blank secrets mean "leave unchanged", and the PUT
 * body only carries the keys the user actually changed.
 *
 * The server route at `server/app.js:5403` enforces
 * `requireOwner(user)`; the client gate here defaults to
 * permissive and matches that until the auth context lands in
 * Phase 8.4 (same TODO as `/app/cabinet`).
 *
 * Subcomponents are exported with `export function` (not default
 * exports) so the co-located test can import them by name and
 * exercise the pieces in isolation. This mirrors the
 * `cabinet/index.tsx` test extraction pattern.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  KeyRound,
  ListChecks,
  Lock,
  NotebookPen,
  Save,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { api, getJson } from "../../../../lib/api/client";
import {
  AiModelsResponseSchema,
  type AiModel,
  type AiModelKey,
  type AiModelsResponse,
  type AiSettingsResponse,
} from "../../../../lib/api/schemas";
import {
  AI_MODEL_KEYS,
  isModelsResponseLive,
  modelBelongsToKnownList,
  modelsResponseLabel,
  onboardingFormFromSettings,
  putRequestFromForm,
} from "../../../../lib/onboarding/status";
import { cn } from "../../../../lib/utils/cn";

/* ────────── local form type (mirrors the status.ts return shape) ────────── */

type AiSettingsForm = {
  openrouterApiKey: string;
  models: Partial<Record<AiModelKey, string>>;
  openNotebook: { enabled: boolean; baseUrl: string; apiKey: string };
};

/* ────────── Owner gate (TODO: wire to useAuth() in 8.4) ────────── */

// Mirrors /app/cabinet — server is the source of truth, UI
// defaults to permissive until the auth context lands. The
// workspace accepts an optional `userRole` prop so the co-located
// test can render the 403 branch; production callers (the file
// route) get "Owner" by default.
type UserRole = "Owner" | "Admin" | "Manager" | "User";
const DEFAULT_USER_ROLE: UserRole = "Owner";

/* ────────── file route ────────── */

export const Route = createFileRoute("/app/copilot/onboarding/")({
  component: OnboardingWorkspace,
});

/* ────────── Armenian labels ────────── */

const MODEL_LABEL_HY: Record<AiModelKey, string> = {
  default: "Հիմնական մոդել (բոլոր գործառույթները ժառանգում են)",
  copilot: "Copilot պատասխաններ",
  transform: "Փաստաթղթի ամփոփում / ձեւափոխում",
  finance: "Ֆինանսներ (override)",
  crm: "CRM (override)",
  docs: "Փաստաթղթեր (override)",
};

const KEY_PLACEHOLDER = "•••••• (leave blank to keep unchanged)";

/* ────────── tone for the source chip ────────── */

const SOURCE_TONE: Record<"live" | "offline", string> = {
  live: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] text-[var(--color-tag-green)]",
  offline: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)] text-[var(--color-tag-orange)]",
};

/* ────────── Models source chip ────────── */

export function ModelsSourceChip({ modelsResponse }: { modelsResponse: AiModelsResponse | undefined }) {
  if (!modelsResponse) {
    return (
      <span
        data-testid="models-source-chip"
        data-source="loading"
        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]"
      >
        Բեռնում…
      </span>
    );
  }
  const live = isModelsResponseLive(modelsResponse);
  return (
    <span
      data-testid="models-source-chip"
      data-source={live ? "live" : "offline"}
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        SOURCE_TONE[live ? "live" : "offline"],
      )}
    >
      {modelsResponseLabel(modelsResponse)}
    </span>
  );
}

/* ────────── API key section ────────── */

export function ApiKeySection({
  settings,
  value,
  onChange,
}: {
  settings: AiSettingsResponse["settings"] | undefined;
  value: string;
  onChange: (next: string) => void;
}) {
  const set = settings?.openrouterApiKeySet === true;
  return (
    <section
      data-testid="api-key-section"
      data-entity="ai-onboarding-api-key"
      className="panel space-y-2"
    >
      <header className="flex items-center gap-2 text-[var(--text-sm)] text-[var(--color-ink)]">
        <KeyRound className="size-3.5" aria-hidden />
        <h2 className="font-semibold">OpenRouter API բանալի</h2>
      </header>
      <input
        type="password"
        autoComplete="off"
        aria-label="OpenRouter API key"
        placeholder={KEY_PLACEHOLDER}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
      />
      <p
        className="text-[11px] text-[var(--color-muted)]"
        data-testid="api-key-status"
        data-key-set={set ? "true" : "false"}
      >
        {set ? "key-ը տեղադրված է" : "key-ը դեռ տեղադրված չէ"}
      </p>
    </section>
  );
}

/* ────────── Model grid (2 × 3) ────────── */

export function ModelSelect({
  modelKey,
  value,
  models,
  onChange,
}: {
  modelKey: AiModelKey;
  value: string;
  models: ReadonlyArray<AiModel>;
  onChange: (next: string) => void;
}) {
  const known = modelBelongsToKnownList(value, models);
  const showOrphan = value.length > 0 && !known;
  return (
    <label
      data-testid="model-select"
      data-entity="ai-onboarding-model"
      data-model-key={modelKey}
      className="flex flex-col gap-1 text-[var(--text-sm)]"
    >
      <span className="text-[var(--color-muted)]">{MODEL_LABEL_HY[modelKey]}</span>
      <select
        aria-label={MODEL_LABEL_HY[modelKey]}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
      >
        <option value="">
          {modelKey === "default" ? "— ընտրեք մոդել —" : "— ինչպես հիմնականը —"}
        </option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
        {showOrphan && <option value={value}>{value}</option>}
      </select>
    </label>
  );
}

export function ModelGrid({
  form,
  models,
  onChange,
}: {
  form: AiSettingsForm;
  models: ReadonlyArray<AiModel>;
  onChange: (key: AiModelKey, value: string) => void;
}) {
  return (
    <section
      data-testid="model-grid"
      data-entity="ai-onboarding-model-grid"
      className="panel space-y-3"
    >
      <header className="flex items-center gap-2 text-[var(--text-sm)] text-[var(--color-ink)]">
        <ListChecks className="size-3.5" aria-hidden />
        <h2 className="font-semibold">Մոդելների ընտրություն</h2>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {AI_MODEL_KEYS.map((k) => (
          <ModelSelect
            key={k}
            modelKey={k}
            value={form.models[k] ?? ""}
            models={models}
            onChange={(v) => onChange(k, v)}
          />
        ))}
      </div>
    </section>
  );
}

/* ────────── Open Notebook section ────────── */

export function OpenNotebookSection({
  form,
  onChange,
}: {
  form: AiSettingsForm;
  onChange: (patch: Partial<AiSettingsForm["openNotebook"]>) => void;
}) {
  return (
    <section
      data-testid="open-notebook-section"
      data-entity="ai-onboarding-open-notebook"
      className="panel space-y-2"
    >
      <label className="flex items-center gap-2 text-[var(--text-sm)] text-[var(--color-ink)]">
        <input
          type="checkbox"
          data-testid="open-notebook-toggle"
          checked={form.openNotebook.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="size-3.5"
        />
        <NotebookPen className="size-3.5" aria-hidden />
        <span className="font-semibold">Միացնել Open Notebook-ը</span>
      </label>
      {form.openNotebook.enabled && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[var(--text-sm)]">
            <span className="text-[var(--color-muted)]">Base URL</span>
            <input
              type="text"
              aria-label="Open Notebook base URL"
              data-testid="open-notebook-base-url"
              value={form.openNotebook.baseUrl}
              onChange={(e) => onChange({ baseUrl: e.target.value })}
              placeholder="https://notebook.example.am"
              className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[var(--text-sm)]">
            <span className="text-[var(--color-muted)]">API key</span>
            <input
              type="password"
              aria-label="Open Notebook API key"
              data-testid="open-notebook-api-key"
              autoComplete="off"
              value={form.openNotebook.apiKey}
              onChange={(e) => onChange({ apiKey: e.target.value })}
              placeholder="•••••••• (leave blank to keep unchanged)"
              className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
            />
          </label>
        </div>
      )}
    </section>
  );
}

/* ────────── Save button + status ────────── */

export function SaveButton({
  onSave,
  isPending,
  status,
  error,
}: {
  onSave: () => void;
  isPending: boolean;
  status: string;
  error: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onSave}
        disabled={isPending}
        data-testid="onboarding-save"
        data-entity="ai-onboarding-save"
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-semibold text-[var(--color-surface)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Save className="size-3.5" />
        {isPending ? "Պահպանում…" : "Պահպանել"}
      </button>
      {status && (
        <span className="action-status" data-testid="onboarding-status">
          {status}
        </span>
      )}
      {error && (
        <span className="action-status" role="alert" data-testid="onboarding-error">
          {error}
        </span>
      )}
    </div>
  );
}

/* ────────── 403 card ────────── */

export function OwnerGateCard() {
  return (
    <article
      data-testid="onboarding-403"
      data-entity="ai-onboarding-forbidden"
      className="panel flex items-start gap-3 border-[color-mix(in_srgb,var(--color-ruby)_30%,transparent)]"
    >
      <Lock className="size-4 shrink-0 text-[var(--color-ruby)]" aria-hidden />
      <div>
        <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          Մուտքը սահմանափակված է
        </h2>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Միայն սեփականատիրոջ համար
        </p>
      </div>
    </article>
  );
}

/* ────────── root workspace ────────── */

export function OnboardingWorkspace({ userRole = DEFAULT_USER_ROLE }: { userRole?: UserRole } = {}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<AiSettingsForm | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const isOwner = userRole === "Owner";

  const settingsQ = useQuery({
    queryKey: ["ai", "settings"],
    queryFn: () => getJson("/api/ai/settings"),
    enabled: isOwner,
  });
  const modelsQ = useQuery({
    queryKey: ["ai", "models"],
    queryFn: () => getJson("/api/ai/models", AiModelsResponseSchema),
    enabled: isOwner,
  });

  // Initialize the form once the settings query resolves. The models
  // query is independent — we only need it for the dropdowns.
  useEffect(() => {
    if (settingsQ.data && !form) {
      const s = settingsQ.data as { settings: AiSettingsResponse["settings"] };
      setForm(onboardingFormFromSettings(s.settings, []));
    }
  }, [settingsQ.data, form]);

  // Surface a load error in the form area, but only after a real
  // round-trip — the query is `enabled: isOwner`, so a locked user
  // never sees a network error here.
  useEffect(() => {
    if (settingsQ.error) {
      setError((settingsQ.error as Error).message ?? "Բեռնումը ձախողվեց");
    }
  }, [settingsQ.error]);

  const saveMut = useMutation({
    mutationFn: async (next: AiSettingsForm) => {
      setError("");
      setStatus("");
      // Mirror the legacy `save` semantics: build the request body
      // through `putRequestFromForm` so empty secrets and unchanged
      // model ids are stripped before they hit the wire.
      const priorSettings = (settingsQ.data as { settings: AiSettingsResponse["settings"] } | undefined)?.settings;
      const patch = putRequestFromForm(
        {
          openrouterApiKey: next.openrouterApiKey,
          models: next.models,
          openNotebook: {
            enabled: next.openNotebook.enabled,
            baseUrl: next.openNotebook.baseUrl,
            apiKey: next.openNotebook.apiKey,
          },
        },
        priorSettings as AiSettingsResponse["settings"],
      );
      return api(
        "/api/ai/settings",
        null,
        {
          method: "PUT",
          body: patch as Record<string, unknown>,
          signal: undefined,
        } as unknown as RequestInit & { body: Record<string, unknown>; signal: undefined },
      );
    },
    onSuccess: () => {
      setStatus("Պահպանված է ✓");
      // Clear the transient secret fields so a stale value can't be
      // sent on the next save (matches the legacy `web/src/ai-onboarding.jsx`).
      setForm((f: AiSettingsForm | null) =>
        f
          ? {
              ...f,
              openrouterApiKey: "",
              openNotebook: { ...f.openNotebook, apiKey: "" },
            }
          : f,
      );
      qc.invalidateQueries({ queryKey: ["ai", "settings"] });
    },
    onError: (err: Error) => {
      setError(err.message ?? "Պահպանումը ձախողվեց");
    },
  });

  const models = useMemo<ReadonlyArray<AiModel>>(
    () => (modelsQ.data?.models ?? []) as ReadonlyArray<AiModel>,
    [modelsQ.data],
  );

  if (!isOwner) {
    return (
      <div
        className="mx-auto max-w-3xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
        data-testid="onboarding-panel"
        data-entity="ai-onboarding"
      >
        <PageHeader modelsResponse={modelsQ.data} />
        <OwnerGateCard />
        <BackToCopilot />
      </div>
    );
  }

  return (
    <div
      className="mx-auto max-w-3xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="onboarding-panel"
      data-entity="ai-onboarding"
    >
      <PageHeader modelsResponse={modelsQ.data} />

      {form ? (
        <>
          <ApiKeySection
            settings={(settingsQ.data as { settings: AiSettingsResponse["settings"] } | undefined)?.settings}
            value={form.openrouterApiKey}
            onChange={(v) => setForm({ ...form, openrouterApiKey: v })}
          />
          <ModelGrid
            form={form}
            models={models}
            onChange={(k, v) =>
              setForm({ ...form, models: { ...form.models, [k]: v } })
            }
          />
          <OpenNotebookSection
            form={form}
            onChange={(patch) =>
              setForm({
                ...form,
                openNotebook: { ...form.openNotebook, ...patch },
              })
            }
          />
          <SaveButton
            onSave={() => saveMut.mutate(form)}
            isPending={saveMut.isPending}
            status={status}
            error={error}
          />
        </>
      ) : (
        <div
          className="panel text-center text-[var(--text-sm)] text-[var(--color-muted)]"
          data-testid="onboarding-loading"
        >
          <TriangleAlert className="mx-auto mb-2 size-4 opacity-60" aria-hidden />
          Բեռնում…
        </div>
      )}

      <BackToCopilot />
    </div>
  );
}

/* ────────── shared header + back link ────────── */

function PageHeader({ modelsResponse }: { modelsResponse: AiModelsResponse | undefined }) {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <Sparkles className="size-3" />
        Copilot · Onboarding
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
          AI Provider &amp; Models
        </h1>
        <ModelsSourceChip modelsResponse={modelsResponse} />
      </div>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        AI մատակարար եւ մոդելներ
      </p>
    </header>
  );
}

function BackToCopilot() {
  return (
    <div>
      <Link
        to="/app/copilot"
        search={{ view: "chats" }}
        className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        back to copilot
      </Link>
    </div>
  );
}
