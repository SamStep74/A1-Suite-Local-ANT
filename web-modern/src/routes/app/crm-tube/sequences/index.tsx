/**
 * /app/crm-tube/sequences — Tube sequences list.
 *
 * Per docs/phase8-tube/design.md section 2.1, sequences are the
 * outbound automation primitives. A sequence is owned by an
 * integration (Apollo, CloudTalk, Instantly, …) and may have any
 * number of steps. The V1 list is read-only except for the
 * "Active only" toggle and the "+ New sequence" modal — step
 * editing is deferred to 8.14 (the API surface for it doesn't
 * exist yet).
 *
 *   - Data: GET /api/crm/tube/sequences
 *   - Data: GET /api/crm/tube/integrations (for the connector picker
 *     in the new-sequence modal)
 *   - Create: POST /api/crm/tube/sequences
 *
 * No URL search state — the only filter is the local "Active only"
 * toggle, which doesn't need to be shareable. If/when we add
 * ?status= or ?integrationKey= we'll add validateSearch then.
 *
 * Inline-Armenian strings are intentional — same convention as
 * every other Phase 8 route (see healthcheck/index.tsx header).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  CircleAlert,
  Mail,
  PauseCircle,
  PlayCircle,
  Plus,
  Search,
  X,
} from "lucide-react";
import { getJson, postJson } from "../../../../lib/api/client";
import {
  TubeListResponseSchema,
  TubeSequenceSchema,
  type TubeIntegration,
  type TubeSequence,
} from "../../../../lib/api/schemas";
import { cn } from "../../../../lib/utils/cn";

export const Route = createFileRoute("/app/crm-tube/sequences/")({
  component: SequencesListRoute,
});

/* ────────── constants ────────── */

/** Relative time helper — no i18n lib, intentionally lightweight.
 *  The route file focuses on the layout, not date math. */
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

/* ────────── root component ────────── */

function SequencesListRoute() {
  const qc = useQueryClient();

  const sequencesQ = useQuery({
    queryKey: ["tube-sequences"],
    queryFn: () =>
      getJson("/api/crm/tube/sequences", TubeListResponseSchema),
    staleTime: 15_000,
  });
  const integrationsQ = useQuery({
    queryKey: ["tube-integrations"],
    queryFn: () =>
      getJson("/api/crm/tube/integrations", TubeListResponseSchema),
    staleTime: 60_000,
  });

  const [activeOnly, setActiveOnly] = useState(true);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const sequences = (sequencesQ.data?.sequences ?? []) as TubeSequence[];
  const integrations = (integrationsQ.data?.integrations ??
    []) as TubeIntegration[];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sequences.filter((s) => {
      if (activeOnly && !s.is_active) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q) ||
        (s.integration_key ?? "").toLowerCase().includes(q)
      );
    });
  }, [sequences, activeOnly, query]);

  const isLoading = sequencesQ.isLoading;
  const isError = sequencesQ.isError;

  return (
    <div
      className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="tube-sequences"
      data-entity="tube-sequences-list"
    >
      <Header onNew={() => setCreateOpen(true)} />

      <FilterBar
        activeOnly={activeOnly}
        onActiveOnlyChange={setActiveOnly}
        query={query}
        onQueryChange={setQuery}
        total={sequences.length}
        visible={filtered.length}
      />

      {isLoading ? (
        <p className="px-3 py-10 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          Loading sequences…
        </p>
      ) : isError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-sm)] border border-[var(--color-ruby,#b23a48)]/30 bg-[var(--color-ruby,#b23a48)]/5 px-3 py-2 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
        >
          Could not load sequences. The Tube engine is offline.
        </p>
      ) : sequences.length === 0 ? (
        <EmptyState onNew={() => setCreateOpen(true)} />
      ) : (
        <SequencesTable sequences={filtered} />
      )}

      {createOpen && (
        <CreateSequenceModal
          integrations={integrations}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void qc.invalidateQueries({ queryKey: ["tube-sequences"] });
          }}
        />
      )}

      <div>
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          back to Today
        </Link>
      </div>
    </div>
  );
}

/* ────────── header ────────── */

function Header({ onNew }: { onNew: () => void }) {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <Mail className="size-3" />
        Tube · Sequences
      </span>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
            Sequences
          </h1>
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
            Հ · Sequences
          </p>
        </div>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
        >
          <Plus className="size-3.5" />
          New sequence
        </button>
      </div>
    </header>
  );
}

/* ────────── filter bar ────────── */

function FilterBar({
  activeOnly,
  onActiveOnlyChange,
  query,
  onQueryChange,
  total,
  visible,
}: {
  activeOnly: boolean;
  onActiveOnlyChange: (next: boolean) => void;
  query: string;
  onQueryChange: (next: string) => void;
  total: number;
  visible: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="inline-flex cursor-pointer items-center gap-2 text-[var(--text-sm)] text-[var(--color-ink)]">
        <input
          type="checkbox"
          checked={activeOnly}
          onChange={(e) => onActiveOnlyChange(e.target.checked)}
          aria-label="Show only active sequences"
          className="size-3.5 rounded-[var(--radius-sm)] border-[var(--color-line)] text-[var(--color-focus)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
        />
        Active only
      </label>
      <div className="relative flex-1 min-w-[12rem]">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-muted)]" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search sequences…"
          aria-label="Filter sequences"
          className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] pl-7 pr-2 text-[var(--text-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
        />
      </div>
      <span className="text-[11px] text-[var(--color-muted)]">
        showing {visible} of {total}
      </span>
    </div>
  );
}

/* ────────── table ────────── */

function SequencesTable({ sequences }: { sequences: TubeSequence[] }) {
  if (sequences.length === 0) {
    return (
      <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-8 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
        No sequences match the current filter.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <table className="w-full text-left text-[var(--text-sm)]">
        <thead className="bg-[var(--color-surface-soft)] text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          <tr>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Description</th>
            <th className="px-3 py-2 font-medium">Integration</th>
            <th className="px-3 py-2 text-right font-medium">Steps</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {sequences.map((s) => (
            <tr
              key={s.id}
              className="cursor-pointer border-t border-[var(--color-line)] hover:bg-[var(--color-surface-soft)]"
            >
              <td className="px-3 py-2">
                <Link
                  to="/app/crm-tube/sequences/$sequenceId"
                  params={{ sequenceId: s.id }}
                  className="font-medium text-[var(--color-ink)] hover:underline"
                >
                  {s.name}
                </Link>
              </td>
              <td className="max-w-[20rem] truncate px-3 py-2 text-[var(--color-muted)]">
                {s.description ?? "—"}
              </td>
              <td className="px-3 py-2 text-[var(--color-muted)]">
                {s.integration_key ?? "—"}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                {s.step_count}
              </td>
              <td className="px-3 py-2">
                <StatusPill active={s.is_active} />
              </td>
              <td className="px-3 py-2 text-[var(--color-muted)]">
                {relativeTime(s.updated_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        active
          ? "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] text-[var(--color-tag-green)]"
          : "bg-[var(--color-surface-soft)] text-[var(--color-muted)]",
      )}
    >
      {active ? (
        <PlayCircle className="size-3" />
      ) : (
        <PauseCircle className="size-3" />
      )}
      {active ? "active" : "paused"}
    </span>
  );
}

/* ────────── empty state ────────── */

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-10 text-center">
      <Mail className="size-5 text-[var(--color-muted)]" />
      <p className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        No sequences yet
      </p>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Create a sequence to start enrolling contacts in an outbound
        campaign.
      </p>
      <button
        type="button"
        onClick={onNew}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
      >
        <Plus className="size-3.5" />
        New sequence
      </button>
    </div>
  );
}

/* ────────── create modal ────────── */

function CreateSequenceModal({
  integrations,
  onClose,
  onCreated,
}: {
  integrations: TubeIntegration[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [integrationKey, setIntegrationKey] = useState<string>("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: async () => {
      setError(null);
      // TubeSequenceSchema is the response shape; we let postJson
      // validate. The engine returns a single TubeSequence.
      await postJson(
        "/api/crm/tube/sequences",
        {
          name: name.trim(),
          description: description.trim() || undefined,
          integrationKey: integrationKey || undefined,
          isActive,
          idempotencyKey: `tube-seq-${Date.now()}`,
        },
        TubeSequenceSchema,
      );
    },
    onSuccess: () => onCreated(),
    onError: (err: Error) => {
      setError(err.message ?? "Failed to create sequence");
    },
  });

  const canSubmit = name.trim().length > 0 && !createM.isPending;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-sequence-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2
            id="create-sequence-title"
            className="text-[var(--text-base)] font-semibold text-[var(--color-ink)]"
          >
            New sequence
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-[var(--radius-sm)] p-1 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            createM.mutate();
          }}
          className="space-y-3"
        >
          <label className="block text-[var(--text-sm)]">
            <span className="mb-1 block text-[var(--color-muted)]">Name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              aria-label="Sequence name"
              data-testid="tube-sequence-name"
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-[var(--text-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
            />
          </label>

          <label className="block text-[var(--text-sm)]">
            <span className="mb-1 block text-[var(--color-muted)]">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={2}
              aria-label="Sequence description"
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-[var(--text-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
            />
          </label>

          <label className="block text-[var(--text-sm)]">
            <span className="mb-1 block text-[var(--color-muted)]">
              Integration
            </span>
            <select
              value={integrationKey}
              onChange={(e) => setIntegrationKey(e.target.value)}
              aria-label="Integration connector"
              data-testid="tube-sequence-integration"
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-[var(--text-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
            >
              <option value="">— none —</option>
              {integrations.map((i) => (
                <option key={i.id} value={i.connector_key}>
                  {i.display_name} ({i.connector_key})
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex cursor-pointer items-center gap-2 text-[var(--text-sm)] text-[var(--color-ink)]">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              aria-label="Active"
              className="size-3.5 rounded-[var(--radius-sm)] border-[var(--color-line)] text-[var(--color-focus)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
            />
            Active
          </label>

          {error && (
            <p
              role="alert"
              className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
            >
              <CircleAlert className="size-3.5" />
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              data-testid="tube-sequence-submit"
              className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createM.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
