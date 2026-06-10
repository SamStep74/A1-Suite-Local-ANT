/**
 * /app/forms — Forms workspace: forms | submissions | templates.
 *
 * Mirrors crm/ purchase/ people/ docs/ pattern (Pattern A from
 * the plan §3.5). The home route is a ViewSwitcher over three
 * surfaces:
 *
 *   - **Forms** — definitions (draft / published / archived)
 *   - **Submissions** — recent activity across all forms
 *   - **Templates** — built-in starter forms (constant list)
 *
 * URL state:
 *   ?view=forms | submissions | templates
 *
 * Data (all require app=forms access):
 *   - GET /api/forms                       → list of FormSummary
 *   - GET /api/forms/:id                  → full FormDetail w/ recent submissions
 *   - GET /api/forms/:id/submissions      (not yet exposed — submissions
 *     surface currently derives from the list endpoint's submission_count)
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ClipboardList, FileText, Inbox, Sparkles } from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  FormsListResponseSchema,
  type FormSummary,
} from "../../../lib/api/schemas";
import { ViewSwitcher } from "../../../components/view-switcher/ViewSwitcher";
import { cn } from "../../../lib/utils/cn";
import {
  classifyFormStatus,
  countFormsByStatus,
  fieldTypeBadge,
  formStatusTone,
  formatShortDate,
  formatSubmissionCount,
  sortByUpdatedAtDesc,
  totalSubmissions,
  type FormTone,
} from "../../../lib/forms/status";

/* ────────── typed URL search ────────── */

type View = "forms" | "submissions" | "templates";

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "forms", label: "Forms" },
  { value: "submissions", label: "Submissions" },
  { value: "templates", label: "Templates" },
];

export const Route = createFileRoute("/app/forms/")({
  validateSearch: (raw) => {
    const v: View =
      raw.view === "submissions" || raw.view === "templates"
        ? raw.view
        : "forms";
    return { view: v };
  },
  component: FormsWorkspace,
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

function FormsWorkspace() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view: View = search.view;
  const setView = (next: View) => navigate({ search: { view: next }, replace: true });

  const formsQ = useQuery({
    queryKey: ["forms", "list"],
    queryFn: async () => {
      const raw = await getJson("/api/forms");
      return FormsListResponseSchema.parse(raw);
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

      {view === "forms" && (
        <FormsView data={formsQ.data} loading={formsQ.isLoading} error={formsQ.isError} />
      )}
      {view === "submissions" && (
        <SubmissionsView
          data={formsQ.data}
          loading={formsQ.isLoading}
          error={formsQ.isError}
        />
      )}
      {view === "templates" && <TemplatesView />}
    </div>
  );
}

/* ────────── page header ────────── */

function PageHeader() {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <ClipboardList className="size-3" />
        Forms
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">Forms</h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Ձևեր · Ուղարկումներ · Կաղապարներ
      </p>
    </header>
  );
}

/* ────────── KPI card ────────── */

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className="mt-1 font-mono text-[var(--text-lg)] text-[var(--color-ink)]">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

/* ────────── Forms view (definitions) ────────── */

function FormsView({
  data,
  loading,
  error,
}: {
  data: { forms: FormSummary[] } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading forms…</p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load forms.
      </p>
    );
  }

  const forms = (data?.forms ?? []).slice().sort(sortByUpdatedAtDesc);
  const counts = countFormsByStatus(forms);
  const total = forms.length;

  if (total === 0) {
    return (
      <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
        <FileText className="mx-auto mb-2 size-5 opacity-50" />
        Ձևեր դեռ չկան։
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total" value={String(total)} hint="Ընդհանուր" />
        <KpiCard label="Published" value={String(counts.published)} hint="Հրապարակված" />
        <KpiCard label="Draft" value={String(counts.draft)} hint="Սևագիր" />
        <KpiCard
          label="Submissions"
          value={formatSubmissionCount(totalSubmissions(forms))}
          hint="Ուղարկումներ"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="forms-form"
        data-count={String(forms.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Title
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Status
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Submissions
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Updated
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {forms.map((f) => (
              <tr key={f.id} className="hover:bg-[var(--color-surface-soft)]">
                <td className="px-3 py-2">
                  <Link
                    to="/app/forms/$formId"
                    params={{ formId: f.id }}
                    className="font-medium text-[var(--color-ink)] hover:text-[var(--color-brand)]"
                  >
                    {f.title}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <StatusPill status={f.status} />
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                  {formatSubmissionCount(f.submissionCount)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-muted)]">
                  {formatShortDate(f.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ────────── Submissions view (recent activity) ────────── */

function SubmissionsView({
  data,
  loading,
  error,
}: {
  data: { forms: FormSummary[] } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading submissions…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load submissions.
      </p>
    );
  }

  const forms = (data?.forms ?? []).slice().sort((a, b) => {
    return (b.submissionCount ?? 0) - (a.submissionCount ?? 0);
  });
  const total = totalSubmissions(forms);
  const active = forms.filter(
    (f) => f.submissionCount > 0 && (f.status ?? "").toString().toLowerCase() === "published",
  ).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Total submissions"
          value={formatSubmissionCount(total)}
          hint="Ընդհանուր ուղարկում"
        />
        <KpiCard label="Active forms" value={String(active)} hint="Ակտիվ ձևեր" />
        <KpiCard label="Forms" value={String(forms.length)} hint="Ձևերի քանակ" />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="forms-submission-summary"
        data-count={String(forms.length)}
      >
        {forms.length === 0 ? (
          <div className="p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
            <Inbox className="mx-auto mb-2 size-5 opacity-50" />
            Ուղարկումներ դեռ չկան։
          </div>
        ) : (
          <table className="w-full text-[var(--text-sm)]" role="table">
            <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Form
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Submissions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {forms.map((f) => (
                <tr key={f.id} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2">
                    <Link
                      to="/app/forms/$formId"
                      params={{ formId: f.id }}
                      className="font-medium text-[var(--color-ink)] hover:text-[var(--color-brand)]"
                    >
                      {f.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={f.status} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                    {formatSubmissionCount(f.submissionCount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/* ────────── Templates view (constant) ────────── */

const TEMPLATES: ReadonlyArray<{
  key: string;
  title: string;
  description: string;
  fields: ReadonlyArray<{ type: string; label: string }>;
}> = [
  {
    key: "contact",
    title: "Contact form",
    description: "Հիմնական կոնտակտային ձև — անուն, էլ. հասցե, հեռախոս, հաղորդագրություն։",
    fields: [
      { type: "text", label: "Name" },
      { type: "email", label: "Email" },
      { type: "textarea", label: "Message" },
    ],
  },
  {
    key: "lead-capture",
    title: "Lead capture",
    description: "Լիդի ներգրավման ձև — ընկերություն, կոնտակտ, հետաքրքրության ոլորտ։",
    fields: [
      { type: "text", label: "Company" },
      { type: "text", label: "Contact" },
      { type: "email", label: "Email" },
      { type: "phone", label: "Phone" },
      { type: "select", label: "Interest" },
    ],
  },
  {
    key: "support-ticket",
    title: "Support request",
    description: "Սպասարկման հարցում — թեմա, առաջնահերթություն, նկարագրություն։",
    fields: [
      { type: "text", label: "Subject" },
      { type: "select", label: "Priority" },
      { type: "textarea", label: "Description" },
    ],
  },
];

function TemplatesView() {
  return (
    <div className="space-y-4">
      <div
        className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
        role="note"
      >
        <p className="inline-flex items-center gap-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          <Sparkles className="size-3.5" />
          Պատրաստի կաղապարներ
        </p>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Օգտագործեք որպես սկիզբ և հարմարեցրեք ձեր կարիքներին։
        </p>
      </div>

      <section
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        data-entity="forms-template"
        data-count={String(TEMPLATES.length)}
      >
        {TEMPLATES.map((t) => (
          <div
            key={t.key}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
          >
            <p className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              {t.title}
            </p>
            <p className="mt-1 text-[11px] text-[var(--color-muted)]">{t.description}</p>
            <ul className="mt-2 space-y-1">
              {t.fields.map((f, i) => (
                <li key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-[var(--color-ink)]">{f.label}</span>
                  <span className="font-mono text-[var(--color-muted)]">
                    {fieldTypeBadge({ type: f.type })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
