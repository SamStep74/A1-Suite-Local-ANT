/**
 * Pure helpers for the Forms workspace.
 *
 * Source of truth: server/app.js (forms table, form_submissions
 * table) and server/forms.js schema normalizers.
 *
 * These helpers are UI-pure: no React, no I/O. They re-derive
 * small aggregations (submission counts, status tones, field type
 * classification) and shape server data for rendering (sorting by
 * recency, formatting submission counts as "1 200" with Armenian
 * digit grouping, etc.).
 *
 * Public surface:
 *  - int                  → coerce a value to a non-negative integer
 *  - classifyFormStatus   → "draft" | "published" | "archived" | "closed" | "unknown"
 *  - classifyFieldType    → "short-text" | "long-text" | "choice" | "boolean" | "numeric" | "temporal" | "other"
 *  - formStatusTone       → "info" | "positive" | "negative" | "muted" | "warning"
 *  - sortByUpdatedAtDesc  → most-recently-updated first
 *  - totalSubmissions     → sum across a list
 *  - hasRequiredFields    → true when at least one field is required
 *  - formatSubmissionCount
 *  - isFieldFilled        → true when a submission value is non-empty
 *  - extractLeadId        → leadId or null
 *  - FORM_STATUSES
 *  - FIELD_TYPE_BADGE
 */
import type {
  FormField,
  FormStatus,
  FormSubmission,
  FormSummary,
} from "../api/schemas";

/* ────────── types ────────── */

export type FormTone = "info" | "positive" | "negative" | "muted" | "warning";

export type FieldKind =
  | "short-text"
  | "long-text"
  | "choice"
  | "boolean"
  | "numeric"
  | "temporal"
  | "other";

export const FORM_STATUSES: readonly FormStatus[] = [
  "draft",
  "published",
  "closed",
  "archived",
] as const;

/* ────────── small utilities ────────── */

export function int(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return 0;
}

export function intOrNull(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

/* ────────── classification ────────── */

const STATUS_TONE: Record<string, FormTone> = {
  draft: "muted",
  published: "positive",
  closed: "warning",
  archived: "negative",
};

export function classifyFormStatus(
  form: { status?: string | null } | null | undefined,
): FormStatus | "unknown" {
  const s = (form?.status ?? "").toString().toLowerCase();
  if (FORM_STATUSES.includes(s as FormStatus)) return s as FormStatus;
  return "unknown";
}

export function formStatusTone(
  form: { status?: string | null } | null | undefined,
): FormTone {
  const s = classifyFormStatus(form);
  return STATUS_TONE[s] ?? "muted";
}

export function classifyFieldType(field: { type?: string | null } | null | undefined): FieldKind {
  const t = (field?.type ?? "").toString().toLowerCase();
  if (t === "text" || t === "email" || t === "phone") return "short-text";
  if (t === "textarea") return "long-text";
  if (t === "select") return "choice";
  if (t === "checkbox") return "boolean";
  if (t === "number") return "numeric";
  if (t === "date") return "temporal";
  return "other";
}

/* ────────── aggregates ────────── */

export function totalSubmissions(forms: ReadonlyArray<Pick<FormSummary, "submissionCount">>): number {
  return forms.reduce((s, f) => s + int(f.submissionCount), 0);
}

export function countFormsByStatus(
  forms: ReadonlyArray<{ status?: string | null }>,
): Record<FormStatus | "unknown", number> {
  const out: Record<FormStatus | "unknown", number> = {
    draft: 0,
    published: 0,
    closed: 0,
    archived: 0,
    unknown: 0,
  };
  for (const f of forms) {
    const s = classifyFormStatus(f);
    out[s] += 1;
  }
  return out;
}

export function hasRequiredFields(fields: ReadonlyArray<FormField> | null | undefined): boolean {
  if (!fields) return false;
  return fields.some((f) => Boolean(f.required));
}

export function requiredFieldCount(fields: ReadonlyArray<FormField> | null | undefined): number {
  if (!fields) return 0;
  return fields.filter((f) => Boolean(f.required)).length;
}

/* ────────── ordering ────────── */

export function sortByUpdatedAtDesc(
  a: { updatedAt?: string | null },
  b: { updatedAt?: string | null },
): number {
  const av = a.updatedAt ?? "";
  const bv = b.updatedAt ?? "";
  if (av === bv) return 0;
  return bv.localeCompare(av);
}

export function sortBySubmissionCountDesc(
  a: { submissionCount?: number | null },
  b: { submissionCount?: number | null },
): number {
  return int(b.submissionCount) - int(a.submissionCount);
}

export function sortByTitleAsc(
  a: { title?: string | null },
  b: { title?: string | null },
): number {
  return (a.title ?? "").localeCompare(b.title ?? "");
}

/* ────────── submission helpers ────────── */

export function isFieldFilled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

export function filledFieldCount(
  submission: { data?: Record<string, unknown> | null },
  fields: ReadonlyArray<FormField>,
): number {
  const data = submission.data ?? {};
  let count = 0;
  for (const f of fields) {
    if (isFieldFilled(data[f.key])) count += 1;
  }
  return count;
}

export function extractLeadId(
  submission: Pick<FormSubmission, "leadId"> | null | undefined,
): string | null {
  if (!submission) return null;
  const v = submission.leadId;
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

export function sortSubmissionsByCreatedAtDesc(
  a: { createdAt?: string | null },
  b: { createdAt?: string | null },
): number {
  const av = a.createdAt ?? "";
  const bv = b.createdAt ?? "";
  if (av === bv) return 0;
  return bv.localeCompare(av);
}

/* ────────── formatting ────────── */

const hyAM = new Intl.NumberFormat("hy-AM", { maximumFractionDigits: 0 });

export function formatSubmissionCount(value: number | null | undefined): string {
  const n = intOrNull(value);
  if (n == null) return "—";
  return hyAM.format(n);
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  // Expect ISO YYYY-MM-DD or full ISO. Strip time portion if present.
  const datePart = value.split("T")[0] ?? "";
  if (datePart.length < 10) return "—";
  return datePart.slice(0, 10);
}

/* ────────── field-type badge labels (Armenian-first) ────────── */

export const FIELD_TYPE_BADGE: Record<FieldKind, string> = {
  "short-text": "Տեքստ",
  "long-text": "Տեքստ (երկար)",
  "choice": "Ընտրանք",
  "boolean": "Այո/Ոչ",
  "numeric": "Թիվ",
  "temporal": "Ամսաթիվ",
  "other": "Այլ",
};

export function fieldTypeBadge(field: { type?: string | null } | null | undefined): string {
  return FIELD_TYPE_BADGE[classifyFieldType(field)];
}
