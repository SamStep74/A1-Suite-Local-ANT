/**
 * /app/forms/$formId — form definition detail.
 *
 * Drills into a single form from the Forms workspace. Fetches
 * `/api/forms/:id` and renders:
 *  - Header (title, monogram, status pill, description)
 *  - KPIs (fields, required, submissions, updated)
 *  - Schema table: key | label | type | required
 *  - Recent submissions table: when | data summary | lead
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ClipboardList, CircleSlash, FileText } from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  FormDetailResponseSchema,
  type FormDetail,
} from "../../../lib/api/schemas";
import { cn } from "../../../lib/utils/cn";
import {
  classifyFormStatus,
  extractLeadId,
  fieldTypeBadge,
  filledFieldCount,
  formatShortDate,
  formatSubmissionCount,
  formStatusTone,
  requiredFieldCount,
  sortSubmissionsByCreatedAtDesc,
  type FormTone,
} from "../../../lib/forms/status";

/* ────────── typed URL search ────────── */

export const Route = createFileRoute("/app/forms/$formId")({
  validateSearch: () => ({}),
  component: FormDetailRoute,
});

/* ────────── status pill ────────── */

const TONE_CLASS: Record<FormTone, { bg: string; fg: string }> = {
  info: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
  },
  positive: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
  },
  negative: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
  },
  muted: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
  },
  warning: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
  },
};

function StatusPill({ status }: { status: string | null | undefined }) {
  const tone = formStatusTone({ status });
  const cls = TONE_CLASS[tone];
  const label = classifyFormStatus({ status });
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        cls.bg,
        cls.fg,
      )}
    >
      {label}
    </span>
  );
}

/* ────────── root component ────────── */

function FormDetailRoute() {
  const { formId } = Route.useParams();

  const q = useQuery({
    queryKey: ["forms", "detail", formId],
    queryFn: async () => {
      const raw = await getJson(`/api/forms/${encodeURIComponent(formId)}`);
      return FormDetailResponseSchema.parse(raw);
    },
    enabled: Boolean(formId),
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
        <PageHeader formId={formId} form={null} />
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading form…</p>
      </div>
    );
  }

  if (q.isError || !q.data?.form) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
        <PageHeader formId={formId} form={null} />
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          <CircleSlash className="mx-auto mb-2 size-5 opacity-50" />
          {q.isError ? "Failed to load form." : "Form not found."}
        </div>
        <BackLink />
      </div>
    );
  }

  const form = q.data.form;
  const fields = form.fields ?? [];
  const submissions = (form.submissions ?? [])
    .slice()
    .sort(sortSubmissionsByCreatedAtDesc);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader formId={formId} form={form} />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Fields" value={String(fields.length)} hint="Դաշտեր" />
        <KpiCard
          label="Required"
          value={String(requiredFieldCount(fields))}
          hint="Պարտադիր"
        />
        <KpiCard
          label="Submissions"
          value={formatSubmissionCount(form.submissionCount)}
          hint="Ուղարկումներ"
        />
        <KpiCard
          label="Updated"
          value={formatShortDate(form.updatedAt)}
          hint="Թարմացվել է"
        />
      </section>

      {form.description ? (
        <p className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-[var(--text-sm)] text-[var(--color-ink)]">
          {form.description}
        </p>
      ) : null}

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="forms-form-field"
        data-count={String(fields.length)}
      >
        <div className="border-b border-[var(--color-line)] px-3 py-2">
          <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
            Schema
          </h2>
          <p className="text-[10px] text-[var(--color-muted)]">Դաշտերի կառուցվածք</p>
        </div>
        {fields.length === 0 ? (
          <div className="p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
            <FileText className="mx-auto mb-2 size-5 opacity-50" />
            Այս ձևը դաշտեր չունի։
          </div>
        ) : (
          <table className="w-full text-[var(--text-sm)]" role="table">
            <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Key
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Label
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Type
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Required
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {fields.map((f) => (
                <tr key={f.key} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2 font-mono text-[var(--color-ink)]">{f.key}</td>
                  <td className="px-3 py-2 text-[var(--color-ink)]">{f.label}</td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {fieldTypeBadge({ type: f.type })}
                  </td>
                  <td className="px-3 py-2">
                    {f.required ? (
                      <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--color-tag-red)]">
                        Այո
                      </span>
                    ) : (
                      <span className="text-[11px] text-[var(--color-muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="forms-form-submission"
        data-count={String(submissions.length)}
      >
        <div className="border-b border-[var(--color-line)] px-3 py-2">
          <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
            Recent submissions
          </h2>
          <p className="text-[10px] text-[var(--color-muted)]">Վերջին ուղարկումները</p>
        </div>
        {submissions.length === 0 ? (
          <div className="p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
            Ուղարկումներ դեռ չկան։
          </div>
        ) : (
          <table className="w-full text-[var(--text-sm)]" role="table">
            <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  When
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Filled
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Lead
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Data
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {submissions.map((s) => {
                const leadId = extractLeadId(s);
                const filled = filledFieldCount({ data: s.data }, fields);
                return (
                  <tr key={s.id} className="hover:bg-[var(--color-surface-soft)]">
                    <td className="px-3 py-2 font-mono text-[var(--color-ink)]">
                      {formatShortDate(s.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-ink)]">
                      {filled}/{fields.length}
                    </td>
                    <td className="px-3 py-2 font-mono text-[var(--color-muted)]">
                      {leadId ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">
                      {summarizeData(s.data)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <BackLink />
    </div>
  );
}

/* ────────── page header ────────── */

function PageHeader({ formId, form }: { formId: string; form: FormDetail | null }) {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <ClipboardList className="size-3" />
        Forms · Form
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
        {form?.title ?? "Ձև"}
      </h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        {form ? (
          <span className="inline-flex items-center gap-2">
            <StatusPill status={form.status} />
            <span className="font-mono">{formId}</span>
          </span>
        ) : (
          <span className="font-mono">{formId}</span>
        )}
      </p>
    </header>
  );
}

/* ────────── KPI card ────────── */

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className="mt-1 font-mono text-[var(--text-lg)] text-[var(--color-ink)]">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

/* ────────── back link ────────── */

function BackLink() {
  return (
    <Link
      to="/app/forms"
      search={{ view: "forms" }}
      className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
    >
      <ChevronLeft className="size-3.5" />
      Back to Forms
    </Link>
  );
}

/* ────────── small helper ────────── */

function summarizeData(data: Record<string, unknown> | null | undefined): string {
  if (!data) return "—";
  const keys = Object.keys(data);
  if (keys.length === 0) return "—";
  const preview = keys
    .slice(0, 3)
    .map((k) => {
      const v = data[k];
      const s = typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
      return `${k}=${String(s).slice(0, 24)}`;
    })
    .join(" · ");
  return keys.length > 3 ? `${preview} …` : preview;
}
