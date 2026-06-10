/**
 * /app/docs — Docs & Sign workspace: documents | packets | templates.
 *
 * Mirrors finance/ purchase/ people/ pattern (Pattern A from the plan
 * §3.4). The home route is a ViewSwitcher over three surfaces:
 *
 *   - **Documents** — every document (draft / out-for-signature /
 *     signed / voided), sorted actionable first. Click → /app/docs/$id.
 *   - **Packets** — every signature packet the org has created.
 *     Quote-backed e-signature flows for customer acceptances.
 *   - **Templates** — every doc template available for generation.
 *
 * URL state:
 *   ?view=documents | packets | templates
 *
 * Data:
 *   - /api/docs/documents
 *   - /api/docs/signature-packets
 *   - /api/docs/templates
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  CircleCheck,
  Clock,
  FileSignature,
  FileText,
  Stamp,
  Send,
  X,
} from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  DocsDocumentsResponseSchema,
  DocsSignaturePacketsResponseSchema,
  DocsTemplatesResponseSchema,
  type DocsDocument,
  type DocsSignaturePacket,
  type DocsTemplate,
} from "../../../lib/api/schemas";
import { ViewSwitcher } from "../../../components/view-switcher/ViewSwitcher";
import { cn } from "../../../lib/utils/cn";
import {
  classifyDocumentStatus,
  classifyPacketStatus,
  compareDocumentsByStatusThenUpdated,
  comparePacketsByStatusThenDate,
  hasRequiredVariables,
  pendingSignerCount,
  sealedLabel,
  signerProgress,
  templateVariableCount,
  type DocumentTone,
  type PacketTone,
} from "../../../lib/docs/status";

/* ────────── typed URL search ────────── */

type View = "documents" | "packets" | "templates";

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "documents", label: "Documents" },
  { value: "packets", label: "Signature packets" },
  { value: "templates", label: "Templates" },
];

export const Route = createFileRoute("/app/docs/")({
  validateSearch: (raw) => {
    const v: View =
      raw.view === "packets" || raw.view === "templates" ? raw.view : "documents";
    return { view: v };
  },
  component: DocsWorkspace,
});

/* ────────── tone maps ────────── */

const DOCUMENT_TONE: Record<DocumentTone, { bg: string; fg: string; label: string }> = {
  draft: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "Draft",
  },
  "out-for-signature": {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
    label: "Out for signature",
  },
  signed: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Signed",
  },
  voided: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
    label: "Voided",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "—",
  },
};

const PACKET_TONE: Record<PacketTone, { bg: string; fg: string; label: string }> = {
  draft: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "Draft",
  },
  sent: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
    label: "Sent",
  },
  signed: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Signed",
  },
  voided: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
    label: "Voided",
  },
  expired: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
    label: "Expired",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "—",
  },
};

/* ────────── root component ────────── */

function DocsWorkspace() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view: View = search.view;
  const setView = (next: View) => navigate({ search: { view: next }, replace: true });

  const docsQ = useQuery({
    queryKey: ["docs-documents"],
    queryFn: async () => {
      const raw = await getJson("/api/docs/documents");
      return DocsDocumentsResponseSchema.parse(raw);
    },
  });
  const packetsQ = useQuery({
    queryKey: ["docs-packets"],
    queryFn: async () => {
      const raw = await getJson("/api/docs/signature-packets");
      return DocsSignaturePacketsResponseSchema.parse(raw);
    },
  });
  const templatesQ = useQuery({
    queryKey: ["docs-templates"],
    queryFn: async () => {
      const raw = await getJson("/api/docs/templates");
      return DocsTemplatesResponseSchema.parse(raw);
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ViewSwitcher options={VIEW_OPTIONS} value={view} onChange={setView} />
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          Today
        </Link>
      </div>

      {view === "documents" && (
        <DocumentsView data={docsQ.data} loading={docsQ.isLoading} error={docsQ.isError} />
      )}
      {view === "packets" && (
        <PacketsView
          data={packetsQ.data}
          loading={packetsQ.isLoading}
          error={packetsQ.isError}
        />
      )}
      {view === "templates" && (
        <TemplatesView
          data={templatesQ.data}
          loading={templatesQ.isLoading}
          error={templatesQ.isError}
        />
      )}
    </div>
  );
}

/* ────────── page header ────────── */

function PageHeader() {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <FileSignature className="size-3" />
        Docs
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
        Docs &amp; Sign
      </h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Փաստաթղթեր · Ստորագրություններ · Կաղապարներ
      </p>
    </header>
  );
}

/* ────────── Documents view ────────── */

function DocumentsView({
  data,
  loading,
  error,
}: {
  data: { documents: DocsDocument[] } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading documents…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load documents.
      </p>
    );
  }

  const documents = (data?.documents ?? []).slice().sort(compareDocumentsByStatusThenUpdated);
  const drafts = documents.filter((d) => classifyDocumentStatus(d) === "draft").length;
  const outForSig = documents.filter((d) => classifyDocumentStatus(d) === "out-for-signature").length;
  const signed = documents.filter((d) => classifyDocumentStatus(d) === "signed").length;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {documents.length === 0 ? (
          <EmptyState message="No documents yet." />
        ) : (
          <div
            className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
            data-entity="docs-document"
            data-count={String(documents.length)}
          >
            <table className="w-full text-[var(--text-sm)]" role="table">
              <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Title
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Signers
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Sealed
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {documents.map((d) => (
                  <DocumentRow key={d.id} document={d} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DocumentsSidebar total={documents.length} drafts={drafts} outForSig={outForSig} signed={signed} />
    </div>
  );
}

function DocumentRow({ document }: { document: DocsDocument }) {
  const tone = DOCUMENT_TONE[classifyDocumentStatus(document)];
  const progress = signerProgress(document.signers ?? []);
  const pending = pendingSignerCount(document.signers ?? []);
  return (
    <tr className="hover:bg-[var(--color-surface-soft)]">
      <td className="px-3 py-2">
        <Link
          to="/app/docs/$documentId"
          params={{ documentId: document.id }}
          className="font-medium text-[var(--color-ink)] hover:underline"
        >
          {document.title}
        </Link>
        {document.updatedAt && (
          <p className="text-[11px] text-[var(--color-muted)]">
            Updated {document.updatedAt.slice(0, 10)}
          </p>
        )}
      </td>
      <td className="px-3 py-2 text-[var(--color-muted)]">
        {document.docType ?? "—"}
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
            tone.bg,
            tone.fg,
          )}
        >
          {tone.label}
        </span>
      </td>
      <td className="px-3 py-2 text-[var(--color-ink)]">
        {progress == null ? (
          <span className="text-[var(--color-muted)]">—</span>
        ) : (
          <span>
            {Math.round(progress * 100)}%
            {pending > 0 && (
              <span className="ml-1 text-[10px] text-[var(--color-tag-orange)]">
                · {pending} pending
              </span>
            )}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-[var(--color-muted)]">
        {sealedLabel(document)}
      </td>
    </tr>
  );
}

function DocumentsSidebar({
  total,
  drafts,
  outForSig,
  signed,
}: {
  total: number;
  drafts: number;
  outForSig: number;
  signed: number;
}) {
  return (
    <aside
      className="space-y-3 lg:sticky lg:top-4 lg:self-start"
      aria-label="Documents overview"
    >
      <section className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
        <h2 className="inline-flex items-center gap-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          <FileText className="size-3.5" /> Document library
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
          Փաստաթղթերի գրադարան
        </p>
        <dl className="mt-3 space-y-2 text-[var(--text-sm)]">
          <div className="flex items-center justify-between">
            <dt className="text-[var(--color-muted)]">Total</dt>
            <dd className="font-mono text-[var(--color-ink)]">{total}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-[var(--color-muted)]">Drafts</dt>
            <dd className="font-mono text-[var(--color-ink)]">{drafts}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="inline-flex items-center gap-1 text-[var(--color-tag-blue)]">
              <Send className="size-3" /> Out for sig
            </dt>
            <dd className="font-mono text-[var(--color-ink)]">{outForSig}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="inline-flex items-center gap-1 text-[var(--color-tag-green)]">
              <CircleCheck className="size-3" /> Signed
            </dt>
            <dd className="font-mono text-[var(--color-ink)]">{signed}</dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}

/* ────────── Packets view ────────── */

function PacketsView({
  data,
  loading,
  error,
}: {
  data: { packets: DocsSignaturePacket[] } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading packets…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load signature packets.
      </p>
    );
  }

  const packets = (data?.packets ?? []).slice().sort(comparePacketsByStatusThenDate);
  const sent = packets.filter((p) => classifyPacketStatus(p) === "sent").length;
  const signedPackets = packets.filter((p) => classifyPacketStatus(p) === "signed").length;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {packets.length === 0 ? (
          <EmptyState message="No signature packets yet." />
        ) : (
          <div
            className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
            data-entity="docs-signature-packet"
            data-count={String(packets.length)}
          >
            <table className="w-full text-[var(--text-sm)]" role="table">
              <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Customer
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Quote
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Created
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Created by
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {packets.map((p) => (
                  <PacketRow key={p.id} packet={p} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PacketsSidebar total={packets.length} sent={sent} signed={signedPackets} />
    </div>
  );
}

function PacketRow({ packet }: { packet: DocsSignaturePacket }) {
  const tone = PACKET_TONE[classifyPacketStatus(packet)];
  return (
    <tr className="hover:bg-[var(--color-surface-soft)]">
      <td className="px-3 py-2 text-[var(--color-ink)]">
        {packet.customerName ?? "—"}
      </td>
      <td className="px-3 py-2 font-mono text-[var(--color-muted)]">
        {packet.quoteNumber ?? "—"}
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
            tone.bg,
            tone.fg,
          )}
        >
          {tone.label}
        </span>
      </td>
      <td className="px-3 py-2 text-[var(--color-muted)]">
        {packet.createdAt?.slice(0, 10) ?? "—"}
      </td>
      <td className="px-3 py-2 text-[var(--color-muted)]">
        {packet.createdByName ?? "—"}
      </td>
    </tr>
  );
}

function PacketsSidebar({
  total,
  sent,
  signed,
}: {
  total: number;
  sent: number;
  signed: number;
}) {
  return (
    <aside
      className="space-y-3 lg:sticky lg:top-4 lg:self-start"
      aria-label="Signature packets overview"
    >
      <section className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
        <h2 className="inline-flex items-center gap-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          <Stamp className="size-3.5" /> Signature packets
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
          Ստորագրության փաթեթներ
        </p>
        <dl className="mt-3 space-y-2 text-[var(--text-sm)]">
          <div className="flex items-center justify-between">
            <dt className="text-[var(--color-muted)]">Total</dt>
            <dd className="font-mono text-[var(--color-ink)]">{total}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="inline-flex items-center gap-1 text-[var(--color-tag-blue)]">
              <Send className="size-3" /> Sent
            </dt>
            <dd className="font-mono text-[var(--color-ink)]">{sent}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="inline-flex items-center gap-1 text-[var(--color-tag-green)]">
              <CircleCheck className="size-3" /> Signed
            </dt>
            <dd className="font-mono text-[var(--color-ink)]">{signed}</dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}

/* ────────── Templates view ────────── */

function TemplatesView({
  data,
  loading,
  error,
}: {
  data: { templates: DocsTemplate[] } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading templates…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load templates.
      </p>
    );
  }

  const templates = (data?.templates ?? []).slice().sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {templates.length === 0 ? (
        <EmptyState message="No document templates." />
      ) : (
        templates.map((t) => (
          <TemplateCard key={t.id} template={t} />
        ))
      )}
    </div>
  );
}

function TemplateCard({ template }: { template: DocsTemplate }) {
  const count = templateVariableCount(template);
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
            {template.name}
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
            <code className="font-mono">{template.key}</code>
            {hasRequiredVariables(template) && (
              <span className="ml-2 inline-flex items-center gap-1 text-[var(--color-tag-orange)]">
                <Clock className="size-3" /> required vars
              </span>
            )}
          </p>
        </div>
        <span className="rounded-full bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-tag-blue)]">
          {template.docType}
        </span>
      </div>
      <p className="mt-2 text-[11px] text-[var(--color-muted)]">
        {count} variable{count === 1 ? "" : "s"}
      </p>
      <p className="mt-2 line-clamp-3 font-mono text-[10px] text-[var(--color-muted)]">
        {template.bodyTemplate.slice(0, 240)}
        {template.bodyTemplate.length > 240 && "…"}
      </p>
    </section>
  );
}

/* ────────── empty state ────────── */

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
      <X className="mx-auto mb-2 size-5 opacity-50" />
      {message}
    </div>
  );
}
