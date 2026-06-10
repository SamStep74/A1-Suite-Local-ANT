/**
 * /app/docs/$documentId — per-document detail page.
 *
 * Pattern A from the plan: route file is the parent that owns the
 * URL search, the data fetch, and the per-action right-rail panel.
 * Server is the source of truth; this page is read-only in Phase 3
 * with a deterministic action panel.
 *
 * Surface:
 *   - header: title, doc type, status pill, sealed pill
 *   - body preview (truncated for long docs)
 *   - signers table
 *   - action panel (send-for-signature / remind / void / reopen)
 *   - metadata sidebar (customer, creator, timestamps)
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  CircleCheck,
  CircleSlash,
  FileSignature,
  Mail,
  Send,
  Stamp,
  X,
} from "lucide-react";
import { getJson } from "../../../lib/api/client";
import { DocsDocumentEnvelopeSchema, type DocsDocument } from "../../../lib/api/schemas";
import { cn } from "../../../lib/utils/cn";
import {
  anySignerDeclined,
  classifyDocumentStatus,
  classifySignerStatus,
  pendingSignerCount,
  sealedLabel,
  signerProgress,
  type DocumentTone,
  type SignerTone,
} from "../../../lib/docs/status";

/* ────────── route ────────── */

export const Route = createFileRoute("/app/docs/$documentId")({
  component: DocumentDetail,
});

/* ────────── tones ────────── */

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

const SIGNER_TONE: Record<SignerTone, { bg: string; fg: string; label: string }> = {
  pending: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
    label: "Pending",
  },
  signed: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Signed",
  },
  declined: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
    label: "Declined",
  },
  voided: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "Voided",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "—",
  },
};

/* ────────── root ────────── */

function DocumentDetail() {
  const { documentId } = Route.useParams();

  const q = useQuery({
    queryKey: ["docs-document", documentId],
    queryFn: async () => {
      const raw = await getJson(`/api/docs/documents/${documentId}`);
      return DocsDocumentEnvelopeSchema.parse(raw);
    },
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-5xl p-6 text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading document…
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 p-6" data-state="not-found">
        <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
          Document not found.
        </p>
        <Link
          to="/app/docs"
          search={{ view: "documents" }}
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" /> Back to docs
        </Link>
      </div>
    );
  }

  const document = q.data.document;
  const tone = DOCUMENT_TONE[classifyDocumentStatus(document)];
  const isSealed = sealedLabel(document) === "Sealed";

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <Link
        to="/app/docs"
        search={{ view: "documents" }}
        className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        Back to docs
      </Link>

      <DocumentHeader document={document} tone={tone} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <BodyBlock document={document} />
          <SignersTable document={document} />
        </div>
        <DocumentSidebar document={document} isSealed={isSealed} />
      </div>
    </div>
  );
}

/* ────────── header ────────── */

function DocumentHeader({
  document,
  tone,
}: {
  document: DocsDocument;
  tone: { bg: string; fg: string; label: string };
}) {
  return (
    <header
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
      data-entity="docs-document"
      data-id={document.id}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            <FileSignature className="size-3" />
            {document.docType ?? "document"}
          </span>
          <h1 className="mt-1 text-[var(--text-xl)] font-semibold text-[var(--color-ink)]">
            {document.title}
          </h1>
          {document.customerId && (
            <p className="mt-0.5 text-[var(--text-sm)] text-[var(--color-muted)]">
              For customer <span className="font-mono">{document.customerId}</span>
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              tone.bg,
              tone.fg,
            )}
          >
            {tone.label}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] uppercase tracking-wide",
              "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
              "text-[var(--color-muted)]",
            )}
          >
            <Stamp className="size-3" />
            {sealedLabel(document)}
          </span>
        </div>
      </div>
    </header>
  );
}

/* ────────── body ────────── */

function BodyBlock({ document }: { document: DocsDocument }) {
  const body = document.body ?? "";
  const truncated = body.length > 1200;
  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
      aria-label="Document body"
    >
      <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">Body</h2>
      <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">Փաստաթղթի տեքստ</p>
      <pre
        className={cn(
          "mt-3 max-h-96 overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)] p-3 font-mono text-[11px] leading-relaxed text-[var(--color-ink)]",
          truncated && "relative",
        )}
      >
        {truncated ? body.slice(0, 1200) + "\n… (truncated)" : body || "—"}
      </pre>
    </section>
  );
}

/* ────────── signers ────────── */

function SignersTable({ document }: { document: DocsDocument }) {
  const signers = document.signers ?? [];
  const progress = signerProgress(signers);
  const pending = pendingSignerCount(signers);
  const declined = anySignerDeclined(signers);

  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
      aria-label="Signers"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">Signers</h2>
        <p className="text-[11px] text-[var(--color-muted)]">
          {progress == null ? (
            "—"
          ) : (
            <>
              {Math.round(progress * 100)}% signed
              {pending > 0 && ` · ${pending} pending`}
              {declined && (
                <span className="ml-1 text-[var(--color-tag-red)]">· has declined</span>
              )}
            </>
          )}
        </p>
      </div>
      {signers.length === 0 ? (
        <p className="mt-3 text-[var(--text-sm)] text-[var(--color-muted)]">No signers.</p>
      ) : (
        <table className="mt-3 w-full text-[var(--text-sm)]" role="table">
          <thead className="text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-2 py-1 text-left font-semibold">
                Order
              </th>
              <th scope="col" className="px-2 py-1 text-left font-semibold">
                Name
              </th>
              <th scope="col" className="px-2 py-1 text-left font-semibold">
                Email
              </th>
              <th scope="col" className="px-2 py-1 text-left font-semibold">
                Status
              </th>
              <th scope="col" className="px-2 py-1 text-left font-semibold">
                Signed at
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {signers
              .slice()
              .sort((a, b) => (a.signOrder ?? 0) - (b.signOrder ?? 0))
              .map((s) => {
                const tone = SIGNER_TONE[classifySignerStatus(s)];
                return (
                  <tr key={s.id}>
                    <td className="px-2 py-1 font-mono text-[var(--color-muted)]">
                      {s.signOrder ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-[var(--color-ink)]">{s.signerName}</td>
                    <td className="px-2 py-1 text-[var(--color-muted)]">
                      {s.signerEmail ?? "—"}
                    </td>
                    <td className="px-2 py-1">
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
                    <td className="px-2 py-1 text-[var(--color-muted)]">
                      {s.signedAt?.slice(0, 10) ?? "—"}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ────────── sidebar ────────── */

function DocumentSidebar({
  document,
  isSealed,
}: {
  document: DocsDocument;
  isSealed: boolean;
}) {
  const actions = deriveActions(document, isSealed);

  return (
    <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start" aria-label="Document actions">
      <DocsActionPanel actions={actions} />
      <DocumentMetadata document={document} />
    </aside>
  );
}

function DocumentMetadata({ document }: { document: DocsDocument }) {
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">Metadata</h2>
      <dl className="mt-3 space-y-2 text-[var(--text-sm)]">
        <div className="flex items-center justify-between">
          <dt className="text-[var(--color-muted)]">Document ID</dt>
          <dd className="font-mono text-[10px] text-[var(--color-ink)]">{document.id}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[var(--color-muted)]">Created</dt>
          <dd className="text-[var(--color-ink)]">
            {document.createdAt?.slice(0, 10) ?? "—"}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[var(--color-muted)]">Updated</dt>
          <dd className="text-[var(--color-ink)]">
            {document.updatedAt?.slice(0, 10) ?? "—"}
          </dd>
        </div>
        {document.sealedAt && (
          <div className="flex items-center justify-between">
            <dt className="text-[var(--color-muted)]">Sealed at</dt>
            <dd className="text-[var(--color-ink)]">{document.sealedAt.slice(0, 10)}</dd>
          </div>
        )}
        {document.sealedChecksum && (
          <div>
            <dt className="text-[var(--color-muted)]">Checksum</dt>
            <dd className="mt-0.5 break-all font-mono text-[10px] text-[var(--color-ink)]">
              {document.sealedChecksum}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/* ────────── action panel ────────── */

type DocsAction = {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  variant: "primary" | "secondary" | "destructive";
  enabled: boolean;
};

function deriveActions(document: DocsDocument, isSealed: boolean): DocsAction[] {
  const status = classifyDocumentStatus(document);
  const progress = signerProgress(document.signers ?? []);
  const declined = anySignerDeclined(document.signers ?? []);
  const hasSigners = (document.signers?.length ?? 0) > 0;
  const allDone = progress === 1;

  const actions: DocsAction[] = [];

  if (status === "draft") {
    actions.push({
      id: "send",
      label: "Send for signature",
      description: "Email signers and mark out-for-signature.",
      icon: <Send className="size-3.5" />,
      variant: "primary",
      enabled: hasSigners,
    });
  }

  if (status === "out-for-signature") {
    actions.push({
      id: "remind",
      label: "Remind pending signers",
      description: "Send a reminder email to anyone still pending.",
      icon: <Mail className="size-3.5" />,
      variant: "secondary",
      enabled: hasSigners && !allDone,
    });
    if (declined) {
      actions.push({
        id: "void-declined",
        label: "Void document",
        description: "A signer declined; cancel this document.",
        icon: <CircleSlash className="size-3.5" />,
        variant: "destructive",
        enabled: true,
      });
    }
  }

  if (status === "signed" && !isSealed) {
    actions.push({
      id: "seal",
      label: "Sealed — locked",
      description: "Document is signed and ready to archive.",
      icon: <CircleCheck className="size-3.5" />,
      variant: "primary",
      enabled: false,
    });
  }

  if (status === "voided") {
    actions.push({
      id: "reopen",
      label: "Reopen as draft",
      description: "Reset the document back to a draft so you can edit it again.",
      icon: <X className="size-3.5" />,
      variant: "secondary",
      enabled: true,
    });
  }

  return actions;
}

function DocsActionPanel({ actions }: { actions: DocsAction[] }) {
  if (actions.length === 0) {
    return (
      <section className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-[var(--text-sm)] text-[var(--color-muted)]">
        No actions available for this document.
      </section>
    );
  }
  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
      data-entity="docs-action-panel"
      data-count={String(actions.length)}
    >
      <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">Actions</h2>
      <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">Գործողություններ</p>
      <ul className="mt-3 space-y-2">
        {actions.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              disabled={!a.enabled}
              data-action={a.id}
              data-variant={a.variant}
              className={cn(
                "flex w-full items-start gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-left text-[var(--text-sm)]",
                actionClasses(a.variant, a.enabled),
              )}
            >
              <span className="mt-0.5 shrink-0">{a.icon}</span>
              <span className="flex-1">
                <span className="block font-semibold">{a.label}</span>
                <span className="block text-[11px] text-[var(--color-muted)]">
                  {a.description}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function actionClasses(variant: DocsAction["variant"], enabled: boolean): string {
  if (!enabled) {
    return "border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-muted)] opacity-60 cursor-not-allowed";
  }
  switch (variant) {
    case "primary":
      return "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,var(--color-surface))] text-[var(--color-ink)] hover:bg-[color-mix(in_srgb,var(--color-accent)_15%,var(--color-surface))]";
    case "destructive":
      return "border-[var(--color-tag-red)] bg-[color-mix(in_srgb,var(--color-tag-red)_10%,var(--color-surface))] text-[var(--color-ink)] hover:bg-[color-mix(in_srgb,var(--color-tag-red)_15%,var(--color-surface))]";
    case "secondary":
    default:
      return "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]";
  }
}
