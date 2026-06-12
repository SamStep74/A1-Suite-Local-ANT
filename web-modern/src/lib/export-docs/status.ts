/**
 * Pure helpers for the Export Documentation wizard (Phase 8.9).
 *
 * Source of truth:
 *   - server/app.js (lines 3400-3596) — POST /api/export-docs,
 *     POST /api/export-docs/:id/finalize,
 *     POST /api/export-docs/ai/auto-fill,
 *     GET  /api/export-docs/ai/country-check
 *   - web/src/exportDocs.jsx (legacy 4-step wizard, 136 lines) — the
 *     legacy `TEMPLATE_LABELS` and the hardcoded demo salesOrder
 *     match what this module exports below.
 *   - .orchestration/phase8-export-docs/plan.md
 *
 * These helpers are UI-pure: no React, no fetch, no router, no I/O.
 * They re-derive the wizard's affordances (template labels, Armenian
 * destination names, the auto-fill demo payload, line previews, status
 * pills, deep-link step hashing) and shape server data for rendering.
 *
 * Public surface:
 *  - EXPORT_DOC_TEMPLATES                       → readonly array of {kind, label}
 *  - EXPORT_DOC_DESTINATIONS                    → readonly tuple of codes
 *  - EXPORT_DOC_DESTINATION_LABELS_AM           → code → Armenian string
 *  - exportDocTemplateLabelAm                   → Armenian-first label
 *  - exportDocDestinationLabelAm                → code → Armenian label
 *  - isExportDocTemplateKind                    → type-guard for TemplateKind
 *  - generateExportDocIdempotencyKey            → "ui-create-<ts>" / "ui-fin-<ts>"
 *  - buildExportDocSalesOrderDemo               → matches legacy line 27-40
 *  - buildExportDocProductMasterDemo            → matches legacy line 37-39
 *  - formatExportDocLinePreview                 → "Tomatoes — HS 0702 — 1000 kg"
 *  - formatExportDocRequiredCertificates        → join(", ") or "—"
 *  - formatExportDocStatusLabelAm               → Armenian status pill label
 *  - exportDocStepFromHash                      → 1|2|3|4 from "#step=2"
 *  - exportDocStepToHash                        → "#step=2"
 *  - isExportDocStep                            → type-guard for 1|2|3|4
 */
import {
  ExportDocTemplateKindSchema,
  type ExportDocAutoFillDraftLine,
  type ExportDocDestination,
  type ExportDocProductMaster,
  type ExportDocSalesOrder,
  type ExportDocTemplateKind,
} from "@/lib/api/schemas";

/* ────────── type re-exports (UI narrowing) ────────── */

export type {
  ExportDocAutoFillDraftLine,
  ExportDocDestination,
  ExportDocProductMaster,
  ExportDocSalesOrder,
  ExportDocTemplateKind,
};

/* ────────── enum constants ────────── */

/** Catalog of template kinds — mirrors the legacy `TEMPLATE_LABELS`
 *  in web/src/exportDocs.jsx (lines 3-12) and the server's
 *  SUPPORTED_KINDS set in server/exportDocs.js. Order is the display
 *  order in the Step 1 <select>. */
export interface ExportDocTemplateDescriptor {
  readonly kind: ExportDocTemplateKind;
  /** Armenian-first label, exactly as the legacy exports it. */
  readonly label: string;
}

export const EXPORT_DOC_TEMPLATES: ReadonlyArray<ExportDocTemplateDescriptor> = [
  { kind: "invoice", label: "Արտահանման հաշիվ / Export invoice" },
  { kind: "packing", label: "Փաթեթավորման կետագիր / Packing list" },
  { kind: "cmr", label: "Տրանսպորտային փաստաթուղթ / CMR" },
  { kind: "tir", label: "TIR կարնե" },
  { kind: "coo", label: "Ծագման վկայական / Certificate of origin" },
  { kind: "phyto", label: "Ֆիտոսանիտարական վկայական / Phytosanitary" },
  { kind: "vet", label: "Անասնաբուժական վկայական / Veterinary" },
  { kind: "declaration", label: "Արտահանման հայտարարություն / Export declaration" },
] as const;

/** 6 destination codes — the closed enum the wizard exposes in its
 *  Step 1 country <select>. Order matches the legacy array
 *  `["RU","EAEU","EU","AE","HK","PH"]` in web/src/exportDocs.jsx:89. */
export const EXPORT_DOC_DESTINATIONS = [
  "RU",
  "EAEU",
  "EU",
  "AE",
  "HK",
  "PH",
] as const satisfies readonly ExportDocDestination[];

/** Armenian display labels for each destination. Used in the
 *  country-check result and the Step 1 select when the user wants
 *  a verbose label (the legacy component shows the raw code only). */
export const EXPORT_DOC_DESTINATION_LABELS_AM: Readonly<
  Record<ExportDocDestination, string>
> = Object.freeze({
  RU: "Ռուսաստան",
  EAEU: "ԵԱՏՄ",
  EU: "ԵՄ",
  AE: "ԱՄԷ",
  HK: "Հոնգ Կոնգ",
  PH: "Ֆիլիպիններ",
});

/* ────────── predicates ────────── */

/** Type-guard: is `value` one of the closed `ExportDocTemplateKind`
 *  values? Used by the route when accepting a `?template=` query
 *  param from the URL hash. */
export function isExportDocTemplateKind(value: string): value is ExportDocTemplateKind {
  return ExportDocTemplateKindSchema.safeParse(value).success;
}

/* ────────── template / destination label helpers ────────── */

const TEMPLATE_LABEL_BY_KIND: Readonly<
  Record<ExportDocTemplateKind, string>
> = Object.freeze(
  EXPORT_DOC_TEMPLATES.reduce<Record<ExportDocTemplateKind, string>>(
    (acc, t) => {
      acc[t.kind] = t.label;
      return acc;
    },
    {} as Record<ExportDocTemplateKind, string>,
  ),
);

/** Armenian-first template label. Falls back to the raw token for
 *  any unknown kind — defense in depth (the schema already rejects
 *  unknown kinds at the wire, but a deep-link from a stale URL
 *  could still reach the UI). */
export function exportDocTemplateLabelAm(kind: ExportDocTemplateKind): string {
  return TEMPLATE_LABEL_BY_KIND[kind] ?? kind;
}

/** Armenian label for a destination code. */
export function exportDocDestinationLabelAm(code: ExportDocDestination): string {
  return EXPORT_DOC_DESTINATION_LABELS_AM[code];
}

/* ────────── idempotency key generation ────────── */

/** Two idempotency-key kinds — see web/src/exportDocs.jsx:63 + :66. */
export type ExportDocIdempotencyKind = "ui-create" | "ui-fin";

/** Build the idempotency key the wizard sends to the server.
 *  `ui-create` → POST /api/export-docs. `ui-fin` →
 *  POST /api/export-docs/:id/finalize. The server uses this as the
 *  cache-row PK in `idempotency_keys`, so a click-replay returns the
 *  prior response byte-for-byte.
 *
 *  `now` defaults to `Date.now()`; tests pass a fixed value for
 *  determinism. The shape `${kind}-${ts}` is load-bearing: changing
 *  it would change the cache key, so the server would treat a
 *  legacy client's replay as a new request. */
export function generateExportDocIdempotencyKey(
  kind: ExportDocIdempotencyKind,
  now: number = Date.now(),
): string {
  return `${kind}-${now}`;
}

/* ────────── demo data builders (Step 1 → auto-fill payload) ────────── */

/** The hardcoded sales-order demo the legacy wizard POSTs into
 *  /api/export-docs/ai/auto-fill (web/src/exportDocs.jsx:27-40).
 *  `destinationCountry` is the user's current Step 1 selection;
 *  incoterm, currency, and the single tomato line are constants. */
export function buildExportDocSalesOrderDemo(
  destinationCountry: ExportDocDestination,
): ExportDocSalesOrder {
  return {
    destinationCountry,
    incoterm: "CIF",
    currency: "USD",
    lines: [
      { productId: "demo-tomato", description: "Tomatoes", quantity: 1000, unitPrice: 1.2, uom: "kg" },
    ],
  };
}

/** The hardcoded product-master demo (web/src/exportDocs.jsx:37-39).
 *  Pairs with `buildExportDocSalesOrderDemo` so the AI can resolve
 *  hsCode + uom for productId "demo-tomato". */
export function buildExportDocProductMasterDemo(): ExportDocProductMaster[] {
  return [
    { id: "demo-tomato", name: "Tomatoes (Cherry)", hsCode: "0702", uom: "kg" },
  ];
}

/* ────────── formatters ────────── */

/** Render a single auto-fill line as
 *  `description — HS hsCode — quantity uom`. Matches the legacy
 *  line 104 verbatim. */
export function formatExportDocLinePreview(
  line: ExportDocAutoFillDraftLine,
): string {
  return `${line.description} — HS ${line.hsCode} — ${line.quantity} ${line.uom}`;
}

/** Render the cert list as `, ` joined. Returns an em-dash when the
 *  list is empty so the wizard's "Պարտադիր վկայականներ" row is
 *  never blank. */
export function formatExportDocRequiredCertificates(
  certs: ReadonlyArray<string>,
): string {
  if (certs.length === 0) return "—";
  return certs.join(", ");
}

/** Armenian-first status pill label — `finalized` is the only
 *  terminal status the legacy wizard surfaces; the schema also
 *  permits `draft` and `void` so the helpers cover the full enum. */
const STATUS_LABELS_AM: Readonly<Record<"draft" | "finalized" | "void", string>> =
  Object.freeze({
    draft: "Սևագիր",
    finalized: "Ավարտված",
    void: "Չեղարկված",
  });

export function formatExportDocStatusLabelAm(
  status: "draft" | "finalized" | "void",
): string {
  return STATUS_LABELS_AM[status] ?? status;
}

/* ────────── deep-link step hashing ────────── */

/** Wizard step — 1, 2, 3, or 4. Modeled as a tuple of literal types
 *  so the route can type-narrow the state. */
export type ExportDocStep = 1 | 2 | 3 | 4;

/** Type-guard: is `value` one of the four wizard steps? */
export function isExportDocStep(value: number): value is ExportDocStep {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/** Hash fragment → step. Accepts `"#step=2"`, `"step=2"`, `""`, or
 *  any malformed input. Returns 1 (the entry step) for anything
 *  unparseable — the route uses 1 as the safe default so a stale
 *  link never lands the user mid-wizard. */
export function exportDocStepFromHash(hash: string): ExportDocStep {
  if (typeof hash !== "string") return 1;
  // strip leading "#", then pull the value of step=
  const m = hash.replace(/^#/, "").match(/step=(\d+)/);
  if (!m) return 1;
  const n = Number(m[1]);
  return isExportDocStep(n) ? n : 1;
}

/** Step → hash fragment. The wizard pushes the new hash on
 *  step transitions so a refresh restores the same step. */
export function exportDocStepToHash(step: ExportDocStep): string {
  return `#step=${step}`;
}
