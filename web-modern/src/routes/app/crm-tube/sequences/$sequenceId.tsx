/**
 * /app/crm-tube/sequences/$sequenceId — sequence builder.
 *
 * Per docs/phase8-tube/design.md section 2.1, a sequence is a
 * list of steps owned by an integration. The detail page is the
 * canonical "view + edit" surface for a sequence:
 *
 *   - Left column (70%): header (name + active/paused pill),
 *     description, integration chip, steps list, pause/resume
 *     button.
 *   - Right column (30%): "Enroll a contact" panel + AI Action
 *     Panel driven by the sequence-rollout agent.
 *
 * Step editing is deferred to 8.14 — the API surface for
 * PATCH /api/crm/tube/sequences/:id/steps doesn't exist yet.
 * Each step renders a card with an "Edit step" button that
 * is disabled with a TODO comment.
 *
 *   - Detail:    GET    /api/crm/tube/sequences/:id
 *   - Toggle:    PATCH  /api/crm/tube/sequences/:id  (isActive)
 *   - Enroll:    POST   /api/crm/tube/sequences/enroll
 *   - Contacts:  GET    /api/crm/tube/contacts?limit=10  (autocomplete)
 */
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  ListChecks,
  Mail,
  Pause,
  Pencil,
  Play,
  Plug,
  UserPlus,
} from "lucide-react";
import { getJson, patchJson, postJson } from "../../../../lib/api/client";
import {
  TubeListResponseSchema,
  TubeSequenceDetailSchema,
  type TubeContact,
  type TubeIntegration,
  type TubeSequence,
  type TubeSequenceDetail,
} from "../../../../lib/api/schemas";
import { tubeAgents } from "../../../../lib/agents/tube/registry";
import {
  DecisionCard,
  type PreviewDiff,
} from "../../../../components/decision-card/DecisionCard";
import type {
  AgentContext,
  AgentSuggestion,
  SourceCitation,
} from "../../../../lib/agents/types";
import { cn } from "../../../../lib/utils/cn";

export const Route = createFileRoute("/app/crm-tube/sequences/$sequenceId")({
  component: SequenceDetailRoute,
});

/* ────────── root component ────────── */

function SequenceDetailRoute() {
  const { sequenceId } = Route.useParams();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["tube-sequence", sequenceId],
    queryFn: () =>
      getJson(
        `/api/crm/tube/sequences/${encodeURIComponent(sequenceId)}`,
        TubeSequenceDetailSchema,
      ),
    staleTime: 15_000,
  });
  const integrationsQ = useQuery({
    queryKey: ["tube-integrations"],
    queryFn: () =>
      getJson("/api/crm/tube/integrations", TubeListResponseSchema),
    staleTime: 60_000,
  });

  const toggleM = useMutation({
    mutationFn: async (nextActive: boolean) => {
      await patchJson(
        `/api/crm/tube/sequences/${encodeURIComponent(sequenceId)}`,
        {
          isActive: nextActive,
          idempotencyKey: `tube-seq-pause-${Date.now()}`,
        },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tube-sequence", sequenceId] });
      void qc.invalidateQueries({ queryKey: ["tube-sequences"] });
    },
  });

  if (q.isLoading) {
    return (
      <p className="px-6 py-10 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading sequence…
      </p>
    );
  }

  if (q.isError || !q.data) {
    return notFound();
  }

  const sequence: TubeSequenceDetail = q.data;
  const integrations = (integrationsQ.data?.integrations ??
    []) as TubeIntegration[];
  const integration = sequence.integration_key
    ? integrations.find((i) => i.connector_key === sequence.integration_key)
    : undefined;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <Link
        to="/app/crm-tube/sequences"
        className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        Sequences
      </Link>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <DetailColumn
          sequence={sequence}
          integrationDisplayName={integration?.display_name}
          toggling={toggleM.isPending}
          onToggle={() => toggleM.mutate(!sequence.is_active)}
          error={toggleM.isError ? (toggleM.error as Error).message : null}
        />
        <EnrollColumn sequence={sequence} />
      </div>
    </div>
  );
}

/* ────────── left column ────────── */

function DetailColumn({
  sequence,
  integrationDisplayName,
  toggling,
  onToggle,
  error,
}: {
  sequence: TubeSequenceDetail;
  integrationDisplayName: string | undefined;
  toggling: boolean;
  onToggle: () => void;
  error: string | null;
}) {
  return (
    <article className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
              <Mail className="size-3" />
              Tube · Sequence
            </span>
            <h1
              className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]"
              data-testid="tube-sequence-name"
            >
              {sequence.name}
            </h1>
            <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
              {sequence.description ?? "No description."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill active={sequence.is_active} />
            <button
              type="button"
              onClick={onToggle}
              disabled={toggling}
              data-testid="tube-sequence-toggle"
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sequence.is_active ? (
                <>
                  <Pause className="size-3.5" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="size-3.5" />
                  Resume
                </>
              )}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[var(--text-sm)] text-[var(--color-muted)]">
          <Plug className="size-3.5" />
          <span>
            {integrationDisplayName ?? sequence.integration_key ?? "—"}
            {sequence.integration_key && integrationDisplayName ? (
              <span className="ml-1 text-[11px] text-[var(--color-muted)]">
                ({sequence.integration_key})
              </span>
            ) : null}
          </span>
          <span aria-hidden>·</span>
          <span>{sequence.step_count} step{sequence.step_count === 1 ? "" : "s"}</span>
        </div>
        {error && (
          <p
            role="alert"
            className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
          >
            <CircleAlert className="size-3.5" />
            {error}
          </p>
        )}
      </header>

      <section
        className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
        data-testid="tube-sequence-steps"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
            Steps
          </h2>
          <span className="text-[11px] text-[var(--color-muted)]">
            editing lands in 8.14
          </span>
        </div>
        {sequence.steps.length === 0 ? (
          <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
            No steps yet. Step editing arrives in Phase 8.14.
          </p>
        ) : (
          <ol className="space-y-2">
            {sequence.steps.map((step, i) => (
              <StepCard key={i} index={i} step={step} />
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        active
          ? "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] text-[var(--color-tag-green)]"
          : "bg-[var(--color-surface-soft)] text-[var(--color-muted)]",
      )}
    >
      {active ? "active" : "paused"}
    </span>
  );
}

function StepCard({ index, step }: { index: number; step: unknown }) {
  const summary = describeStep(step);
  return (
    <li className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2">
      <div>
        <p className="text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
          Step {index + 1} · {summary}
        </p>
        <p className="text-[11px] text-[var(--color-muted)]">
          {typeof step === "object" && step !== null
            ? JSON.stringify(step).slice(0, 80)
            : "—"}
        </p>
      </div>
      <button
        type="button"
        disabled
        title="Step editing lands in Phase 8.14"
        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-[11px] font-medium text-[var(--color-muted)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Pencil className="size-3" />
        Edit step
      </button>
    </li>
  );
}

/** Defensive step shape description — the engine returns
 *  `steps: z.array(z.unknown())` per TubeSequenceDetailSchema, so
 *  we coerce to whatever fields are present rather than relying
 *  on a strict shape. */
function describeStep(step: unknown): string {
  if (!step || typeof step !== "object") return "step";
  const s = step as Record<string, unknown>;
  const action = s.action ?? s.type ?? s.kind;
  if (typeof action === "string") return action;
  const name = s.name ?? s.label;
  if (typeof name === "string") return name;
  return "step";
}

/* ────────── right column ────────── */

function EnrollColumn({ sequence }: { sequence: TubeSequence }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrollOk, setEnrollOk] = useState<string | null>(null);

  const contactsQ = useQuery({
    queryKey: ["tube-contacts-picker", query],
    queryFn: () =>
      // The /api/crm/tube/contacts endpoint returns a list response;
      // we read `contacts` off the envelope. We don't pass a strict
      // schema because the contact picker only needs a few fields.
      getJson(
        `/api/crm/tube/contacts?limit=10${query ? `&q=${encodeURIComponent(query)}` : ""}`,
      ) as Promise<{ contacts?: TubeContact[] }>,
    staleTime: 10_000,
  });

  const suggestions: AgentSuggestion[] = useAgentSuggestions(sequence);

  const enrollM = useMutation({
    mutationFn: async (contactId: string) => {
      setEnrollError(null);
      setEnrollOk(null);
      await postJson(
        "/api/crm/tube/sequences/enroll",
        {
          sequenceId: sequence.id,
          contactIds: [contactId],
          idempotencyKey: `tube-enroll-${Date.now()}`,
        },
      );
    },
    onSuccess: () => {
      setEnrollOk("Contact enrolled");
      void qc.invalidateQueries({ queryKey: ["tube-sequence", sequence.id] });
    },
    onError: (err: Error) => {
      setEnrollError(err.message ?? "Failed to enroll");
    },
  });

  // Auto-clear success message after 2s.
  useEffect(() => {
    if (!enrollOk) return;
    const t = setTimeout(() => setEnrollOk(null), 2000);
    return () => clearTimeout(t);
  }, [enrollOk]);

  const contacts = contactsQ.data?.contacts ?? [];
  const picked = pickedId
    ? contacts.find((c) => c.id === pickedId) ?? null
    : null;

  return (
    <aside className="space-y-4">
      <section
        className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
        data-testid="tube-sequence-enroll"
      >
        <h2 className="mb-3 inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          <UserPlus className="size-3.5" />
          Enroll a contact
        </h2>
        <div className="space-y-2">
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPickedId(null);
            }}
            placeholder="Search contacts…"
            aria-label="Find a contact"
            data-testid="tube-sequence-enroll-input"
            className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          />
          {query && !pickedId && contacts.length > 0 && (
            <ul
              role="listbox"
              className="max-h-40 overflow-auto rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--text-sm)]"
            >
              {contacts.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => setPickedId(c.id)}
                    className="block w-full px-2 py-1 text-left hover:bg-[var(--color-surface-soft)]"
                  >
                    <span className="block text-[var(--color-ink)]">
                      {c.full_name ?? c.email ?? c.id}
                    </span>
                    {c.email && c.full_name ? (
                      <span className="block text-[11px] text-[var(--color-muted)]">
                        {c.email}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {picked && (
            <p className="rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)] px-2 py-1 text-[var(--text-sm)] text-[var(--color-ink)]">
              {picked.full_name ?? picked.email ?? picked.id}
            </p>
          )}
          <button
            type="button"
            disabled={!pickedId || enrollM.isPending}
            onClick={() => pickedId && enrollM.mutate(pickedId)}
            data-testid="tube-sequence-enroll-submit"
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enrollM.isPending ? "Enrolling…" : "Enroll"}
          </button>
          {enrollError && (
            <p
              role="alert"
              className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
            >
              <CircleAlert className="size-3.5" />
              {enrollError}
            </p>
          )}
          {enrollOk && (
            <p
              role="status"
              className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-tag-green)]"
            >
              <CircleCheck className="size-3.5" />
              {enrollOk}
            </p>
          )}
        </div>
      </section>

      <section
        className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
        data-testid="tube-sequence-ai-panel"
      >
        <h2 className="mb-3 inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          <ListChecks className="size-3.5" />
          AI suggestions
        </h2>
        {suggestions.length === 0 ? (
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
            No new suggestions.
          </p>
        ) : (
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li key={s.id}>
                <DecisionCard
                  id={s.id}
                  title={s.title}
                  why={s.rationale}
                  sources={toSourceCitations(s.sourceRecords)}
                  confidence={s.confidence}
                  risk={s.risk}
                  riskReason={s.riskReason}
                  preview={toPreviewDiff(s.previewDiff)}
                  kind={s.kind ?? "agent"}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

/* ────────── async agent suggestions hook ────────── */

/** Run the sequence-rollout agent against the given sequence. The
 *  agent's `evaluate()` is async (Phase 4 may swap it for an LLM
 *  call), so we keep the suggestions in component state rather
 *  than computing them in render. Until the inbox/deal flow
 *  ships we synthesise a minimal deal context from the sequence
 *  itself — the agent emits zero suggestions when contact_id is
 *  null, which is the correct V1 behaviour. */
function useAgentSuggestions(sequence: TubeSequence): AgentSuggestion[] {
  const [suggestions, setSuggestions] = useState<AgentSuggestion[]>([]);
  useEffect(() => {
    let cancelled = false;
    const agent = tubeAgents.find((a) => a.id === "tube.sequence-rollout");
    if (!agent) {
      setSuggestions([]);
      return () => {
        cancelled = true;
      };
    }
    const ctx: AgentContext = {
      type: "tube.sequence",
      id: sequence.id,
      data: {
        sequence,
        enrollments: [],
        deal: { id: sequence.id, status: "open", contact_id: null },
        contact: null,
        sequences: [sequence],
      },
    };
    Promise.resolve(agent.evaluate(ctx))
      .then((result) => {
        if (!cancelled) setSuggestions(result);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sequence]);
  return suggestions;
}

/* ────────── mappers from AgentSuggestion → DecisionCard props ────────── */

function toSourceCitations(records: string[]): SourceCitation[] {
  return records.map((r) => ({
    label: r,
    kind: "data" as const,
  }));
}

function toPreviewDiff(diff: Record<string, unknown>): PreviewDiff[] {
  return Object.entries(diff).map(([k, v]) => ({
    field: k,
    from: undefined,
    to: String(v),
  }));
}
