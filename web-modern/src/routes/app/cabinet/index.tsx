/**
 * /app/cabinet — Document Cabinet workspace.
 *
 * Pattern A route (TanStack-Start + Zod + TanStack-Query).
 * Mirrors the shape of /app/healthcheck (single-screen panel,
 * mutation-driven) and the structure of /app/forms (filterable
 * list, status pill, two-column body). Inline-Armenian strings —
 * no i18n framework yet, matching the convention used by sibling
 * routes.
 *
 * Phase 8.2 surface (deliberately minimal — AI / eSign / OCR / FTS
 * land in 8.2b–8.2f):
 *   - List + filter (direction, status, q)            GET  /api/cabinet/documents
 *   - Create                                          POST /api/cabinet/documents
 *   - Archive / Restore                               PATCH /api/cabinet/documents/:id
 *
 * Public subcomponents are exported with `export function` (not
 * default exports) so the co-located test can import them by name
 * and exercise the pieces in isolation. This mirrors the
 * cfo/reports and healthcheck test extraction pattern.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, ChevronLeft, FileText, Plus } from "lucide-react";
import { getJson, patchJson, postJson } from "../../../lib/api/client";
import {
  CabinetCreateRequestSchema,
  CabinetCreateResponseSchema,
  CabinetListResponseSchema,
  CabinetPatchRequestSchema,
  type CabinetCreateRequest,
  type CabinetDirection,
  type CabinetDocument,
  type CabinetStatus,
} from "../../../lib/api/schemas";
import { cn } from "../../../lib/utils/cn";
import {
  CABINET_DIRECTIONS,
  CABINET_STATUSES,
  cabinetEmptyMessage,
  cabinetStatusLabelHy,
  cabinetStatusTone,
  classifyCabinetStatus,
  directionLabelArm,
  filterCabinetDocuments,
  sortCabinetDocumentsByActivity,
  type CabinetTone,
} from "../../../lib/cabinet/status";
import { buildCabinetCreate } from "../../../lib/cabinet/status";

/* ────────── canWrite (gates the create form) ────────── */

// TODO: read from useAuth() when the auth context is wired in 8.4.
// For now, the OWNER user seeded at server boot (owner@armosphera.local)
// is the only one who should see the create form in production; the
// UI defaults to permissive and the server enforces role-based auth.
const canWrite = true;

/* ────────── file route ────────── */

export const Route = createFileRoute("/app/cabinet/")({
  component: CabinetWorkspace,
});

/* ────────── tone classes (mirrors forms/status pill) ────────── */

const TONE_CLASS: Record<CabinetTone, string> = {
  positive: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] text-[var(--color-tag-green)]",
  muted: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)] text-[var(--color-muted)]",
};

export function StatusPill({ status }: { status: CabinetStatus }) {
  const tone = cabinetStatusTone({ status });
  const labelEn = classifyCabinetStatus({ status });
  const labelHy = cabinetStatusLabelHy({ status });
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        TONE_CLASS[tone],
      )}
      data-status={status}
    >
      <span aria-hidden="true">{labelHy}</span>
      <span className="sr-only">({labelEn})</span>
    </span>
  );
}

/* ────────── document row (left column) ────────── */

export function CabinetListRow({
  doc,
  selected,
  onSelect,
}: {
  doc: CabinetDocument;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const dirLabel = directionLabelArm(doc.direction);
  const statusLabel = classifyCabinetStatus({ status: doc.status });
  const meta = `${dirLabel} · ${statusLabel} · v${doc.currentVersion}` +
    (doc.linkedType && doc.linkedId ? ` · ${doc.linkedType}:${doc.linkedId}` : "");
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(doc.id)}
        data-testid="cabinet-list-row"
        data-entity="cabinet-list-row"
        data-doc-id={doc.id}
        aria-pressed={selected}
        className={cn(
          "w-full rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors",
          selected
            ? "border-[var(--color-ink)] bg-[var(--color-surface-soft)]"
            : "border-[var(--color-line)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-soft)]",
        )}
      >
        <div className="text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
          {doc.title}
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">{meta}</div>
      </button>
    </li>
  );
}

export function CabinetList({
  docs,
  selectedId,
  onSelect,
  filters,
}: {
  docs: ReadonlyArray<CabinetDocument>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filters: { direction?: CabinetDirection; status?: CabinetStatus; q?: string };
}) {
  if (docs.length === 0) {
    return (
      <p
        data-testid="cabinet-empty"
        data-entity="cabinet-list-empty"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        {cabinetEmptyMessage(filters)}
      </p>
    );
  }
  return (
    <ul
      data-testid="cabinet-list"
      data-entity="cabinet-list"
      className="space-y-1.5"
    >
      {docs.map((d) => (
        <CabinetListRow
          key={d.id}
          doc={d}
          selected={d.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

/* ────────── detail (right column) ────────── */

export function CabinetDetail({
  doc,
  onArchive,
  onRestore,
  isPatching,
}: {
  doc: CabinetDocument;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  isPatching: boolean;
}) {
  const dirLabel = directionLabelArm(doc.direction);
  const statusLabel = classifyCabinetStatus({ status: doc.status });
  const linked = doc.linkedType && doc.linkedId ? `${doc.linkedType}:${doc.linkedId}` : "—";
  return (
    <article
      data-testid="cabinet-detail"
      data-entity="cabinet-detail"
      className="panel space-y-3"
    >
      <header className="space-y-1">
        <h2 className="text-[var(--text-lg)] font-semibold text-[var(--color-ink)]">
          {doc.title}
        </h2>
        <div className="flex items-center gap-2 text-[var(--text-sm)] text-[var(--color-muted)]">
          <StatusPill status={doc.status} />
          <span>{dirLabel}</span>
          <span aria-hidden="true">·</span>
          <span>v{doc.currentVersion}</span>
        </div>
      </header>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[var(--text-sm)]">
        <dt className="text-[var(--color-muted)]">Direction</dt>
        <dd className="text-[var(--color-ink)]">{dirLabel}</dd>
        <dt className="text-[var(--color-muted)]">Status</dt>
        <dd className="text-[var(--color-ink)]">{statusLabel}</dd>
        <dt className="text-[var(--color-muted)]">Linked</dt>
        <dd className="text-[var(--color-ink)]">{linked}</dd>
        <dt className="text-[var(--color-muted)]">Updated</dt>
        <dd className="text-[var(--color-ink)]">{doc.updatedAt}</dd>
      </dl>
      <div className="flex gap-2 pt-1">
        {doc.status === "active" ? (
          <button
            type="button"
            onClick={() => onArchive(doc.id)}
            disabled={isPatching}
            data-testid="cabinet-archive"
            data-entity="cabinet-archive"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-line)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Archive className="size-3.5" />
            Archive
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onRestore(doc.id)}
            disabled={isPatching}
            data-testid="cabinet-restore"
            data-entity="cabinet-restore"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-line)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArchiveRestore className="size-3.5" />
            Restore
          </button>
        )}
      </div>
    </article>
  );
}

/* ────────── create form (bottom, gated by canWrite) ────────── */

export function CabinetCreateForm({
  onSubmit,
  isPending,
  error,
}: {
  onSubmit: (input: {
    title: string;
    direction: CabinetDirection;
    docType: string;
    linkedId: string;
    body: string;
  }) => void;
  isPending: boolean;
  error: string;
}) {
  const [title, setTitle] = useState("");
  const [direction, setDirection] = useState<CabinetDirection>("incoming");
  const [docType, setDocType] = useState("agreement");
  const [linkedId, setLinkedId] = useState("");
  const [body, setBody] = useState("");

  const canSubmit = title.trim().length >= 3 && !isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ title, direction, docType, linkedId, body });
    // Reset transient fields; direction/docType keep their last value
    // (matches the legacy cabinet.jsx UX of clearing only the free-text).
    setTitle("");
    setLinkedId("");
    setBody("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="cabinet-create-form"
      data-entity="cabinet-create"
      className="panel space-y-3"
    >
      <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        New cabinet document
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Վերնագիր (title)</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Վերնագիր (title)"
            aria-label="Title"
            maxLength={200}
            minLength={3}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Direction</span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as CabinetDirection)}
            aria-label="Direction"
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          >
            {CABINET_DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {directionLabelArm(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Document type</span>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            aria-label="Document type"
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          >
            <option value="agreement">agreement</option>
            <option value="nda">nda</option>
            <option value="contract">contract</option>
            <option value="offer">offer</option>
            <option value="policy">policy</option>
            <option value="other">other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Linked ID (optional)</span>
          <input
            type="text"
            value={linkedId}
            onChange={(e) => setLinkedId(e.target.value)}
            placeholder="customer id (optional)"
            aria-label="Linked ID"
            maxLength={80}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)] sm:col-span-2">
          <span className="text-[var(--color-muted)]">Բովանդակություն (body)</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Բովանդակություն (body)"
            aria-label="Body"
            maxLength={20000}
            rows={3}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="cabinet-create-submit"
          data-entity="cabinet-create-submit"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-semibold text-[var(--color-surface)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="size-3.5" />
          {isPending ? "Creating…" : "Create cabinet doc"}
        </button>
        {error && (
          <span role="alert" className="action-status">
            error: {error}
          </span>
        )}
      </div>
    </form>
  );
}

/* ────────── filters bar ────────── */

export function CabinetFiltersBar({
  filters,
  onChange,
}: {
  filters: { direction?: CabinetDirection; status?: CabinetStatus; q?: string };
  onChange: (next: { direction?: CabinetDirection; status?: CabinetStatus; q?: string }) => void;
}) {
  return (
    <div
      data-testid="cabinet-filters"
      data-entity="cabinet-filters"
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <select
        aria-label="Filter by direction"
        value={filters.direction ?? ""}
        onChange={(e) =>
          onChange({
            ...filters,
            direction: e.target.value ? (e.target.value as CabinetDirection) : undefined,
          })
        }
        className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
      >
        <option value="">All directions</option>
        {CABINET_DIRECTIONS.map((d) => (
          <option key={d} value={d}>
            {directionLabelArm(d)}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter by status"
        value={filters.status ?? ""}
        onChange={(e) =>
          onChange({
            ...filters,
            status: e.target.value ? (e.target.value as CabinetStatus) : undefined,
          })
        }
        className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
      >
        <option value="">All statuses</option>
        {CABINET_STATUSES.map((s) => (
          <option key={s} value={s}>
            {classifyCabinetStatus({ status: s })}
          </option>
        ))}
      </select>
      <input
        type="search"
        aria-label="Search cabinet documents"
        placeholder="Փնտրել (search title)"
        value={filters.q ?? ""}
        onChange={(e) => onChange({ ...filters, q: e.target.value })}
        className="flex-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
      />
    </div>
  );
}

/* ────────── root workspace ────────── */

function CabinetWorkspace() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<{
    direction?: CabinetDirection;
    status?: CabinetStatus;
    q?: string;
  }>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createError, setCreateError] = useState("");

  const listQuery = useQuery({
    queryKey: ["cabinet-documents"],
    queryFn: async () => {
      const data = await getJson("/api/cabinet/documents", CabinetListResponseSchema);
      return data.documents;
    },
  });

  const sortedDocs = useMemo(
    () => sortCabinetDocumentsByActivity(listQuery.data ?? []),
    [listQuery.data],
  );
  const filteredDocs = useMemo(
    () => filterCabinetDocuments(sortedDocs, filters),
    [sortedDocs, filters],
  );

  // Default the selection to the first filtered doc; keep the explicit
  // selection if it's still in the filtered set. The detail panel hides
  // itself when nothing matches.
  const effectiveSelectedId = useMemo(() => {
    if (selectedId && filteredDocs.some((d) => d.id === selectedId)) return selectedId;
    return filteredDocs[0]?.id ?? null;
  }, [filteredDocs, selectedId]);
  const selectedDoc = useMemo(
    () => filteredDocs.find((d) => d.id === effectiveSelectedId) ?? null,
    [filteredDocs, effectiveSelectedId],
  );

  const createMut = useMutation({
    mutationFn: async (input: {
      title: string;
      direction: CabinetDirection;
      docType: string;
      linkedId: string;
      body: string;
    }) => {
      setCreateError("");
      const payload: CabinetCreateRequest = buildCabinetCreate({
        title: input.title,
        direction: input.direction,
        docType: input.docType,
        linkedId: input.linkedId,
        body: input.body,
        idempotencyKey: `cab-ui-${Date.now()}`,
      });
      // Pre-validate with the same Zod schema the server uses; if the
      // shape is wrong we want a clear error before hitting the wire.
      CabinetCreateRequestSchema.parse(payload);
      const res = await postJson(
        "/api/cabinet/documents",
        payload,
        CabinetCreateResponseSchema,
      );
      return res.document;
    },
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["cabinet-documents"] });
      setSelectedId(doc.id);
    },
    onError: (err: Error) => {
      setCreateError(err.message);
    },
  });

  const patchMut = useMutation({
    mutationFn: async (input: { id: string; status: CabinetStatus }) => {
      const patch = CabinetPatchRequestSchema.parse({
        id: input.id,
        status: input.status,
        idempotencyKey: `cab-ui-patch-${Date.now()}`,
      });
      return patchJson(
        `/api/cabinet/documents/${input.id}`,
        { status: patch.status, idempotencyKey: patch.idempotencyKey },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cabinet-documents"] });
    },
  });

  return (
    <div
      className="mx-auto max-w-6xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="cabinet-panel"
      data-entity="cabinet-root"
    >
      <header className="space-y-1">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          <FileText className="size-3" />
          App · Cabinet
        </span>
        <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
          Document Cabinet
        </h1>
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          Փաստաթղթաշրջանառություն · Cabinet
        </p>
      </header>

      <CabinetFiltersBar filters={filters} onChange={setFilters} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CabinetList
          docs={filteredDocs}
          selectedId={effectiveSelectedId}
          onSelect={setSelectedId}
          filters={filters}
        />
        {selectedDoc ? (
          <CabinetDetail
            doc={selectedDoc}
            onArchive={(id) => patchMut.mutate({ id, status: "archived" })}
            onRestore={(id) => patchMut.mutate({ id, status: "active" })}
            isPatching={patchMut.isPending}
          />
        ) : (
          <div
            data-testid="cabinet-detail-empty"
            data-entity="cabinet-detail-empty"
            className="panel text-center text-[var(--text-sm)] text-[var(--color-muted)]"
          >
            Ընտրեք փաստաթուղթ · Select a document
          </div>
        )}
      </div>

      {canWrite && (
        <CabinetCreateForm
          onSubmit={(input) => createMut.mutate(input)}
          isPending={createMut.isPending}
          error={createError}
        />
      )}

      {listQuery.error && (
        <p className="action-status" role="alert">
          error: {(listQuery.error as Error).message}
        </p>
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
