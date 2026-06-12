/**
 * /app/cfo/export-docs — Export documentation wizard (Pattern A).
 *
 * Source: web/src/exportDocs.jsx (legacy React panel, 136 lines).
 * Migrated as the 4-step wizard for export documentation. The route
 * gates on `useUserAccess("cfo")` so non-CFO users see a 403 card.
 *
 * Step state machine (all client-side; no URL search state):
 *
 *   1. Select     — pick template (8 kinds) + destination country (6).
 *                   Next button disabled until template chosen.
 *                   POST /api/export-docs/ai/auto-fill
 *                   → stores `draft`, advances to step 2.
 *   2. Auto-fill  — preview the draft (destinationCountry, incoterm,
 *                   currency, lines). "Validate" / "Back".
 *                   GET /api/export-docs/ai/country-check
 *                   → stores `validation`, advances to step 3.
 *   3. Validation — show destinationCountry, requiredCertificates list,
 *                   and optional hsNote. "Finalize" / "Back".
 *                   POST /api/export-docs (create) then
 *                   POST /api/export-docs/{id}/finalize.
 *                   → advances to step 4.
 *   4. Done       — "Document finalized" + "Start new" → reset to step 1.
 *
 * Defensive selectors (used by the co-located test and the upcoming
 * Playwright e2e in worker 3):
 *   - data-testid="export-docs-panel" / data-entity="export-docs"
 *   - data-testid="export-docs-step-{1|2|3|4}"
 *   - data-testid="export-docs-template-select"
 *   - data-testid="export-docs-country-select"
 *   - data-testid="export-docs-next-button"
 *   - data-testid="export-docs-draft"
 *   - data-testid="export-docs-validation"
 *   - data-testid="export-docs-finalized"
 *   - data-testid="export-docs-error"
 *
 * Subcomponents are exported by name (mirrors the state-integrations
 * pattern) so the co-located test can import + render them in isolation.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  FileText,
  TriangleAlert,
} from "lucide-react";
import { getJson, postJson, postVoid } from "../../../../lib/api/client";
import { useUserAccess } from "../../../../lib/rbac/access";
import {
  ExportDocAutoFillRequestSchema,
  ExportDocCountryCheckResponseSchema,
  ExportDocCreateRequestSchema,
  ExportDocFinalizeRequestSchema,
  type ExportDoc,
  type ExportDocAutoFillDraft,
  type ExportDocCountryCheckResponse,
  type ExportDocDestination,
  type ExportDocTemplateKind,
} from "../../../../lib/api/schemas";
import {
  EXPORT_DOC_DESTINATIONS,
  EXPORT_DOC_DESTINATION_LABELS_AM,
  EXPORT_DOC_TEMPLATES,
  buildExportDocProductMasterDemo,
  buildExportDocSalesOrderDemo,
  exportDocDestinationLabelAm,
  exportDocTemplateLabelAm,
  formatExportDocLinePreview,
  formatExportDocRequiredCertificates,
  formatExportDocStatusLabelAm,
  generateExportDocIdempotencyKey,
  isExportDocTemplateKind,
} from "../../../../lib/export-docs/status";

/* ────────── file route ────────── */

export const Route = createFileRoute("/app/cfo/export-docs/")({
  component: ExportDocsRoute,
});

/* ────────── step state machine ────────── */

type Step = 1 | 2 | 3 | 4;

interface WizardState {
  step: Step;
  template: ExportDocTemplateKind | "";
  country: ExportDocDestination;
  draft: ExportDocAutoFillDraft | null;
  validation: ExportDocCountryCheckResponse | null;
  finalized: ExportDoc | null;
}

const INITIAL_STATE: WizardState = {
  step: 1,
  template: "",
  country: EXPORT_DOC_DESTINATIONS[0],
  draft: null,
  validation: null,
  finalized: null,
};

/* ────────── subcomponent: 403 panel ────────── */

function ForbiddenPanel() {
  return (
    <div
      data-testid="export-docs-forbidden"
      data-entity="export-docs-forbidden"
      className="panel text-center"
    >
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        403 · Մուտքը սահմանափակված է · CFO access required
      </p>
    </div>
  );
}

/* ────────── subcomponent: step indicator ────────── */

export function StepIndicator({ step }: { step: Step }) {
  return (
    <ol
      className="flex items-center gap-2 text-[var(--text-sm)] text-[var(--color-muted)]"
      data-testid="export-docs-step-indicator"
      data-entity="export-docs-step-indicator"
      data-step={String(step)}
      aria-label="Wizard step"
    >
      {([1, 2, 3, 4] as const).map((s) => (
        <li
          key={s}
          data-testid={`export-docs-step-${s}`}
          data-entity={`export-docs-step-${s}`}
          aria-current={s === step ? "step" : undefined}
          className={
            s === step
              ? "rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-2 py-0.5 font-mono font-semibold text-[var(--color-surface)]"
              : "rounded-[var(--radius-sm)] px-2 py-0.5 font-mono"
          }
        >
          {s}
        </li>
      ))}
    </ol>
  );
}

/* ────────── subcomponent: step 1 (select) ────────── */

export function SelectStep({
  template,
  country,
  onTemplateChange,
  onCountryChange,
  onNext,
  busy,
  error,
}: {
  template: ExportDocTemplateKind | "";
  country: ExportDocDestination;
  onTemplateChange: (next: ExportDocTemplateKind | "") => void;
  onCountryChange: (next: ExportDocDestination) => void;
  onNext: () => void;
  busy: boolean;
  error: string;
}) {
  return (
    <div
      data-testid="export-docs-step-1-panel"
      data-entity="export-docs-step-1"
      className="panel space-y-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Տիպ / Template</span>
          <select
            data-testid="export-docs-template-select"
            aria-label="Template"
            value={template}
            onChange={(e) => {
              const v = e.target.value;
              onTemplateChange(isExportDocTemplateKind(v) ? v : "");
            }}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          >
            <option value="">— Ընտրել / Select —</option>
            {EXPORT_DOC_TEMPLATES.map((t) => (
              <option key={t.kind} value={t.kind}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Երկիր / Country</span>
          <select
            data-testid="export-docs-country-select"
            aria-label="Destination country"
            value={country}
            onChange={(e) => onCountryChange(e.target.value as ExportDocDestination)}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          >
            {EXPORT_DOC_DESTINATIONS.map((c) => (
              <option key={c} value={c}>
                {c} · {EXPORT_DOC_DESTINATION_LABELS_AM[c]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="export-docs-next-button"
          data-entity="export-docs-next"
          disabled={!template || busy}
          onClick={onNext}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-semibold text-[var(--color-surface)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Կատարվում է…" : "Հաջորդ / Next"}
        </button>
        {error && (
          <span
            data-testid="export-docs-error"
            data-entity="export-docs-error"
            role="alert"
            className="action-status"
          >
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

/* ────────── subcomponent: step 2 (auto-fill preview) ────────── */

export function AutoFillStep({
  draft,
  onValidate,
  onBack,
  busy,
  error,
}: {
  draft: ExportDocAutoFillDraft;
  onValidate: () => void;
  onBack: () => void;
  busy: boolean;
  error: string;
}) {
  return (
    <div
      data-testid="export-docs-step-2-panel"
      data-entity="export-docs-step-2"
      className="panel space-y-3"
    >
      <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        Նախնական լրացում / Auto-fill preview
      </h3>
      <article
        data-testid="export-docs-draft"
        data-entity="export-docs-draft"
        className="space-y-1 text-[var(--text-sm)]"
      >
        <p>
          <span className="text-[var(--color-muted)]">Երկիր / Country</span>{" "}
          <strong className="font-mono">{draft.destinationCountry}</strong>
        </p>
        <p>
          <span className="text-[var(--color-muted)]">Incoterm</span>{" "}
          <strong className="font-mono">{draft.incoterm}</strong> ·{" "}
          <span className="text-[var(--color-muted)]">currency</span>{" "}
          <strong className="font-mono">{draft.currency}</strong>
        </p>
        <ul className="list-disc pl-5">
          {draft.lines.map((l, i) => (
            <li key={i} data-testid="export-docs-draft-line" data-line-index={String(i)}>
              {formatExportDocLinePreview(l)}
            </li>
          ))}
        </ul>
      </article>

      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="export-docs-validate-button"
          data-entity="export-docs-validate"
          disabled={busy}
          onClick={onValidate}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-semibold text-[var(--color-surface)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Ստուգվում է…" : "Ստուգել / Validate"}
        </button>
        <button
          type="button"
          data-testid="export-docs-back-from-2"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-line)]"
        >
          Վերադառնալ / Back
        </button>
        {error && (
          <span
            data-testid="export-docs-error"
            data-entity="export-docs-error"
            role="alert"
            className="action-status"
          >
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

/* ────────── subcomponent: step 3 (validation) ────────── */

export function ValidationStep({
  validation,
  onFinalize,
  onBack,
  busy,
  error,
}: {
  validation: ExportDocCountryCheckResponse;
  onFinalize: () => void;
  onBack: () => void;
  busy: boolean;
  error: string;
}) {
  return (
    <div
      data-testid="export-docs-step-3-panel"
      data-entity="export-docs-step-3"
      className="panel space-y-3"
    >
      <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        Ստուգման արդյունքներ / Validation
      </h3>
      <article
        data-testid="export-docs-validation"
        data-entity="export-docs-validation"
        className="space-y-1 text-[var(--text-sm)]"
      >
        <p>
          <span className="text-[var(--color-muted)]">Երկիր / Country</span>{" "}
          <strong className="font-mono">{validation.destinationCountry}</strong>
        </p>
        <p>
          <span className="text-[var(--color-muted)]">
            Պարտադիր վկայականներ / Required certificates
          </span>{" "}
          <strong>{formatExportDocRequiredCertificates(validation.pack.requiredCertificates)}</strong>
        </p>
        {validation.hsNote && (
          <p>
            <span className="text-[var(--color-muted)]">HS ծանություն / HS note</span>{" "}
            <span>{validation.hsNote}</span>
          </p>
        )}
      </article>

      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="export-docs-finalize-button"
          data-entity="export-docs-finalize"
          disabled={busy}
          onClick={onFinalize}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-semibold text-[var(--color-surface)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Ավարտվում է…" : "Ավարտել / Finalize"}
        </button>
        <button
          type="button"
          data-testid="export-docs-back-from-3"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-line)]"
        >
          Վերադառնալ / Back
        </button>
        {error && (
          <span
            data-testid="export-docs-error"
            data-entity="export-docs-error"
            role="alert"
            className="action-status"
          >
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

/* ────────── subcomponent: step 4 (done) ────────── */

export function FinalizedStep({
  finalized,
  onStartNew,
}: {
  finalized: ExportDoc | null;
  onStartNew: () => void;
}) {
  return (
    <div
      data-testid="export-docs-step-4-panel"
      data-entity="export-docs-step-4"
      className="panel space-y-3"
    >
      <h3 className="inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        <TriangleAlert className="size-3.5 text-[var(--color-tag-green)]" />
        Փաստաթուղթն ավարտված է / Document finalized
      </h3>
      <article
        data-testid="export-docs-finalized"
        data-entity="export-docs-finalized"
        className="space-y-1 text-[var(--text-sm)]"
      >
        {finalized ? (
          <>
            <p>
              <span className="text-[var(--color-muted)]">id</span>{" "}
              <code className="font-mono">{finalized.id}</code>
            </p>
            <p>
              <span className="text-[var(--color-muted)]">kind</span>{" "}
              <strong>{exportDocTemplateLabelAm(finalized.kind)}</strong>
            </p>
            <p>
              <span className="text-[var(--color-muted)]">status</span>{" "}
              <strong>{formatExportDocStatusLabelAm(finalized.status)}</strong>
            </p>
            <p>
              <span className="text-[var(--color-muted)]">createdAt</span>{" "}
              <code className="font-mono">{finalized.createdAt}</code>
            </p>
          </>
        ) : (
          <p className="text-[var(--color-muted)]">—</p>
        )}
      </article>
      <div>
        <button
          type="button"
          data-testid="export-docs-start-new"
          onClick={onStartNew}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-line)]"
        >
          Սկսել նորը / Start new
        </button>
      </div>
    </div>
  );
}

/* ────────── root route ────────── */

function ExportDocsRoute() {
  const hasAccess = useUserAccess("cfo");
  const [wizard, setWizard] = useState<WizardState>(INITIAL_STATE);
  const [error, setError] = useState<string>("");

  // Reset any prior error when stepping between stages — the inline
  // error chip is per-action, not a sticky top-of-page banner.
  useEffect(() => {
    setError("");
  }, [wizard.step]);

  /* ── step 1 → 2: auto-fill POST ─────────────────────────────── */
  const autoFillMut = useMutation({
    mutationFn: async (input: {
      template: ExportDocTemplateKind;
      country: ExportDocDestination;
    }) => {
      const request = ExportDocAutoFillRequestSchema.parse({
        destinationCountry: input.country,
        salesOrder: buildExportDocSalesOrderDemo(input.country),
        productMaster: buildExportDocProductMasterDemo(),
      });
      const res = await postJson(
        "/api/export-docs/ai/auto-fill",
        request,
        // The server returns { draft: ExportDocAutoFillDraft }, but the
        // schema validation in our helpers expects the full envelope
        // shape. We accept the response via a small structural parse
        // so the route can read `res.draft` directly.
        undefined as unknown as undefined,
      );
      const draft = (res as { draft: ExportDocAutoFillDraft }).draft;
      return draft;
    },
    onSuccess: (draft) => {
      setWizard((s) => ({ ...s, step: 2, draft }));
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  /* ── step 2 → 3: country-check GET ──────────────────────────── */
  const validateMut = useMutation({
    mutationFn: async (input: { country: ExportDocDestination }) => {
      const path = `/api/export-docs/ai/country-check?country=${encodeURIComponent(
        input.country,
      )}&productId=demo-tomato`;
      const res = await getJson(path, ExportDocCountryCheckResponseSchema);
      return res;
    },
    onSuccess: (validation) => {
      setWizard((s) => ({ ...s, step: 3, validation }));
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  /* ── step 3 → 4: create + finalize POSTs ────────────────────── */
  const finalizeMut = useMutation({
    mutationFn: async () => {
      if (!wizard.template || !wizard.draft) {
        throw new Error("missing template or draft");
      }
      const create = ExportDocCreateRequestSchema.parse({
        kind: wizard.template,
        destinationCountry: wizard.country,
        incoterm: wizard.draft.incoterm,
        currency: wizard.draft.currency,
        lines: wizard.draft.lines,
        idempotencyKey: generateExportDocIdempotencyKey("ui-create"),
      });
      const created = await postJson(
        "/api/export-docs",
        create,
        undefined as unknown as undefined,
      );
      const exportDoc = (created as { exportDoc: ExportDoc }).exportDoc;
      const fin = ExportDocFinalizeRequestSchema.parse({
        idempotencyKey: generateExportDocIdempotencyKey("ui-fin"),
      });
      const finalized = await postVoid(
        `/api/export-docs/${exportDoc.id}/finalize`,
        fin,
      );
      // The finalize endpoint returns the updated ExportDoc; we fold
      // the status back into the exportDoc we already have. The server
      // may also return the full doc; defensively use the original.
      void finalized;
      return { ...exportDoc, status: "finalized" as const };
    },
    onSuccess: (exportDoc) => {
      setWizard((s) => ({ ...s, step: 4, finalized: exportDoc }));
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  if (!hasAccess) {
    return (
      <div
        className="mx-auto max-w-3xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
        data-testid="export-docs-panel"
        data-entity="export-docs"
      >
        <header className="space-y-1">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            <FileText className="size-3" />
            CFO · Export docs
          </span>
          <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
            Արտահանման փաստաթղթեր
          </h1>
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
            Export documentation wizard
          </p>
        </header>
        <ForbiddenPanel />
        <div>
          <Link
            to="/app/cfo"
            search={{ view: "cash-flow" }}
            data-testid="export-docs-back"
            className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            <ChevronLeft className="size-3.5" />
            back to CFO
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mx-auto max-w-4xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="export-docs-panel"
      data-entity="export-docs"
    >
      <header className="space-y-1">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          <FileText className="size-3" />
          CFO · Export docs
        </span>
        <h1
          data-testid="export-docs-title"
          className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]"
        >
          Արտահանման փաստաթղթեր
        </h1>
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          Export documentation wizard
        </p>
      </header>

      <StepIndicator step={wizard.step} />

      {wizard.step === 1 && (
        <SelectStep
          template={wizard.template}
          country={wizard.country}
          onTemplateChange={(next) =>
            setWizard((s) => ({ ...s, template: next }))
          }
          onCountryChange={(next) =>
            setWizard((s) => ({ ...s, country: next }))
          }
          onNext={() => {
            if (!wizard.template) return;
            autoFillMut.mutate({
              template: wizard.template,
              country: wizard.country,
            });
          }}
          busy={autoFillMut.isPending}
          error={error}
        />
      )}

      {wizard.step === 2 && wizard.draft && (
        <AutoFillStep
          draft={wizard.draft}
          onValidate={() => validateMut.mutate({ country: wizard.country })}
          onBack={() => setWizard((s) => ({ ...s, step: 1 }))}
          busy={validateMut.isPending}
          error={error}
        />
      )}

      {wizard.step === 3 && wizard.validation && (
        <ValidationStep
          validation={wizard.validation}
          onFinalize={() => finalizeMut.mutate()}
          onBack={() => setWizard((s) => ({ ...s, step: 2 }))}
          busy={finalizeMut.isPending}
          error={error}
        />
      )}

      {wizard.step === 4 && (
        <FinalizedStep
          finalized={wizard.finalized}
          onStartNew={() => setWizard(INITIAL_STATE)}
        />
      )}

      <div>
        <Link
          to="/app/cfo"
          search={{ view: "cash-flow" }}
          data-testid="export-docs-back"
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          back to CFO
        </Link>
      </div>
    </div>
  );
}

/* ────────── unused-but-exported for tests / re-export convenience ── */

export { exportDocDestinationLabelAm };
