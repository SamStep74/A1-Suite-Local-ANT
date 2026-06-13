/**
 * /app/smb-crm — AI-onboarding questionnaire (Phase 10, Track 5).
 *
 * Pattern A: 7-step form in HY/EN/RU, LiveLanguageSwitcher from Phase 10.3,
 * then POST /api/smb-crm/generate-blueprint and redirect to the blueprint viewer.
 *
 * Mirrors the structure of /app/crm-tube/index.tsx and /app/crm/index.tsx.
 * Drag-and-drop is OUT of scope for V1 — the form is linear.
 *
 * Armenian strings are inlined as `__ARM_*` placeholders and substituted in
 * via Python at the end of this file (the Edit tool has historically
 * corrupted Armenian text on mixed-language files).
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, Languages, X } from "lucide-react";
import { getJson, postJson } from "../../../lib/api/client";
import {
  SmbCrmGenerateBlueprintRequestSchema,
  SmbCrmGenerateBlueprintResponseSchema,
  SmbCrmListIndustryTemplatesResponseSchema,
  type SmbCrmLocale,
} from "../../../lib/api/schemas";
import { cn } from "../../../lib/utils/cn";

/* ────────── typed URL search ────────── */

type Search = { locale?: string; step?: string };

export const Route = createFileRoute("/app/smb-crm/")({
  validateSearch: (raw): Search => ({
    locale:
      raw.locale === "hy" || raw.locale === "en" || raw.locale === "ru"
        ? raw.locale
        : undefined,
    step: typeof raw.step === "string" ? raw.step : undefined,
  }),
  component: OnboardingWizard,
});

/* ────────── constants ────────── */

const ARM_TITLE = "Փոքր բիզնես CRM · AI blueprint ստեղծում";
const ARM_SUBMIT = "Ստեղծել blueprint";
const ARM_NEXT = "Հաջորդը";
const ARM_BACK = "Հետ";
const ARM_CANCEL = "Չեղարկել";

const STEPS = [
  "industry",
  "companyName",
  "companySize",
  "language",
  "modules",
  "pipeline",
  "review",
] as const;
type Step = (typeof STEPS)[number];

/* ────────── helpers ────────── */

function nextStep(s: Step): Step | null {
  const i = STEPS.indexOf(s);
  if (i < 0 || i === STEPS.length - 1) return null;
  return STEPS[i + 1]!;
}

function prevStep(s: Step): Step | null {
  const i = STEPS.indexOf(s);
  if (i <= 0) return null;
  return STEPS[i - 1]!;
}

const STEP_LABEL: Record<Step, string> = {
  industry: "Industry",
  companyName: "Company name",
  companySize: "Company size",
  language: "Default language",
  modules: "Modules to enable",
  pipeline: "Sales pipeline stages",
  review: "Review & generate",
};

/* ────────── root component ────────── */

function OnboardingWizard() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const step: Step =
    (STEPS as readonly string[]).includes(search.step ?? "")
      ? (search.step as Step)
      : "industry";

  const [locale, setLocale] = useState<SmbCrmLocale>(
    (search.locale as SmbCrmLocale) || "en",
  );
  const [industry, setIndustry] = useState<string>("");
  const [companyName, setCompanyName] = useState<string>("");
  const [companySize, setCompanySize] = useState<string>("small");
  const [modules, setModules] = useState<string[]>([]);
  const [pipeline, setPipeline] = useState<string[]>([]);

  const templatesQ = useQuery({
    queryKey: ["smb-crm-templates"],
    queryFn: () =>
      getJson(
        "/api/smb-crm/industry-templates",
        SmbCrmListIndustryTemplatesResponseSchema,
      ),
    staleTime: 5 * 60_000,
  });

  const go = (s: Step | null) => {
    if (!s) return;
    navigate({ search: { ...search, step: s, locale }, replace: true });
  };

  const setLoc = (l: SmbCrmLocale) => {
    setLocale(l);
    navigate({ search: { ...search, locale: l }, replace: true });
  };

  return (
    <div
      className="mx-auto max-w-3xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="smb-crm-onboarding"
      data-step={step}
    >
      <PageHeader />
      <LanguagePicker value={locale} onChange={setLoc} />
      <Stepper current={step} />

      {templatesQ.isError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-ruby,#b23a48)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_5%,transparent)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
        >
          Could not load industry templates.
        </p>
      ) : step === "industry" ? (
        <StepIndustry
          templates={templatesQ.data?.industryTemplates ?? []}
          value={industry}
          onChange={setIndustry}
        />
      ) : step === "companyName" ? (
        <StepCompanyName value={companyName} onChange={setCompanyName} />
      ) : step === "companySize" ? (
        <StepCompanySize value={companySize} onChange={setCompanySize} />
      ) : step === "language" ? (
        <StepLanguage value={locale} onChange={setLoc} />
      ) : step === "modules" ? (
        <StepModules
          templates={templatesQ.data?.industryTemplates ?? []}
          industry={industry}
          value={modules}
          onChange={setModules}
        />
      ) : step === "pipeline" ? (
        <StepPipeline value={pipeline} onChange={setPipeline} />
      ) : (
        <StepReview
          industry={industry}
          companyName={companyName}
          companySize={companySize}
          language={locale}
          modules={modules}
          pipeline={pipeline}
        />
      )}

      <NavBar
        step={step}
        industry={industry}
        companyName={companyName}
        modules={modules}
        onBack={() => go(prevStep(step))}
        onNext={() => go(nextStep(step))}
        onCancel={() => navigate({ to: "/app", replace: true })}
        payload={{
          idempotencyKey: `smb-crm-blueprint-${Date.now()}`,
          questionnaire: {
            industry,
            companyName,
            companySize,
            language: locale,
            modules,
            pipeline,
          },
        }}
      />
    </div>
  );
}

/* ────────── header ────────── */

function PageHeader() {
  return (
    <header>
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
            <Building2 className="size-5" aria-hidden />
          </span>
          <div>
            <h1
              className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]"
              data-testid="smb-crm-onboarding-h1"
            >
              SMB CRM
            </h1>
            <p
              className="text-[var(--text-sm)] text-[var(--color-muted)]"
              data-testid="smb-crm-onboarding-subtitle"
            >
              {ARM_TITLE}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}

/* ────────── language picker ────────── */

function LanguagePicker({
  value,
  onChange,
}: {
  value: SmbCrmLocale;
  onChange: (l: SmbCrmLocale) => void;
}) {
  const opts: Array<{ id: SmbCrmLocale; label: string }> = [
    { id: "en", label: "EN" },
    { id: "hy", label: "ՀՅ" },
    { id: "ru", label: "RU" },
  ];
  return (
    <div
      className="flex items-center gap-1 self-end"
      data-testid="smb-crm-language-picker"
    >
      <Languages className="size-3.5 text-[var(--color-muted)]" aria-hidden />
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] font-medium",
            value === o.id
              ? "bg-[var(--color-brand)] text-white"
              : "bg-[var(--color-surface-soft)] text-[var(--color-muted)] hover:text-[var(--color-ink)]",
          )}
          data-locale={o.id}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ────────── stepper ────────── */

function Stepper({ current }: { current: Step }) {
  const i = STEPS.indexOf(current);
  return (
    <ol
      className="flex items-center gap-1 border-y border-[var(--color-line)] py-2"
      data-testid="smb-crm-onboarding-stepper"
    >
      {STEPS.map((s, idx) => {
        const done = idx < i;
        const active = idx === i;
        return (
          <li key={s} className="flex items-center gap-1">
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-mono",
                done
                  ? "bg-[var(--color-brand)] text-white"
                  : active
                    ? "border border-[var(--color-brand)] text-[var(--color-brand)]"
                    : "border border-[var(--color-line)] text-[var(--color-muted)]",
              )}
              data-step-marker={s}
            >
              {idx + 1}
            </span>
            <span
              className={cn(
                "text-[11px]",
                active
                  ? "font-semibold text-[var(--color-ink)]"
                  : "text-[var(--color-muted)]",
              )}
            >
              {STEP_LABEL[s]}
            </span>
            {idx < STEPS.length - 1 && (
              <ChevronRight
                className="size-3 text-[var(--color-muted)]"
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ────────── step: industry ────────── */

function StepIndustry({
  templates,
  value,
  onChange,
}: {
  templates: ReadonlyArray<{ industryKey: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <fieldset
      className="grid grid-cols-2 gap-2"
      data-testid="smb-crm-step-industry"
    >
      {templates.length === 0 ? (
        <p className="col-span-2 text-[11px] text-[var(--color-muted)]">
          Loading industry templates…
        </p>
      ) : (
        templates.map((t) => {
          const active = value === t.industryKey;
          return (
            <label
              key={t.industryKey}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-[var(--radius-md)] border bg-[var(--color-surface)] p-2 text-[var(--text-sm)]",
                active
                  ? "border-[var(--color-brand)] ring-1 ring-[var(--color-brand)]"
                  : "border-[var(--color-line)] hover:border-[var(--color-brand)]",
              )}
            >
              <input
                type="radio"
                name="industry"
                value={t.industryKey}
                checked={active}
                onChange={() => onChange(t.industryKey)}
                className="sr-only"
                data-testid="smb-crm-industry-radio"
              />
              <span className="font-medium text-[var(--color-ink)]">
                {t.label}
              </span>
              <span className="text-[10px] text-[var(--color-muted)]">
                {t.industryKey}
              </span>
            </label>
          );
        })
      )}
    </fieldset>
  );
}

/* ────────── step: company name ────────── */

function StepCompanyName({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2" data-testid="smb-crm-step-company-name">
      <label className="block text-[var(--text-sm)]">
        <span className="text-[var(--color-muted)]">Company name</span>
        <input
          type="text"
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[var(--text-sm)]"
          data-testid="smb-crm-company-name-input"
        />
      </label>
    </div>
  );
}

/* ────────── step: company size ────────── */

function StepCompanySize({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const opts: Array<{ id: string; label: string }> = [
    { id: "solo", label: "Solo (1)" },
    { id: "small", label: "Small (2–10)" },
    { id: "medium", label: "Medium (11–50)" },
    { id: "large", label: "Large (51+)" },
  ];
  return (
    <div className="space-y-2" data-testid="smb-crm-step-company-size">
      {opts.map((o) => {
        const active = value === o.id;
        return (
          <label
            key={o.id}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border bg-[var(--color-surface)] p-2 text-[var(--text-sm)]",
              active
                ? "border-[var(--color-brand)] ring-1 ring-[var(--color-brand)]"
                : "border-[var(--color-line)] hover:border-[var(--color-brand)]",
            )}
          >
            <input
              type="radio"
              name="companySize"
              value={o.id}
              checked={active}
              onChange={() => onChange(o.id)}
              className="sr-only"
              data-testid="smb-crm-company-size-radio"
            />
            <span className="font-medium text-[var(--color-ink)]">
              {o.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/* ────────── step: language ────────── */

function StepLanguage({
  value,
  onChange,
}: {
  value: SmbCrmLocale;
  onChange: (l: SmbCrmLocale) => void;
}) {
  const opts: Array<{ id: SmbCrmLocale; label: string }> = [
    { id: "hy", label: "Հայերեն (Armenian)" },
    { id: "en", label: "English" },
    { id: "ru", label: "Русский (Russian)" },
  ];
  return (
    <div className="space-y-2" data-testid="smb-crm-step-language">
      {opts.map((o) => {
        const active = value === o.id;
        return (
          <label
            key={o.id}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border bg-[var(--color-surface)] p-2 text-[var(--text-sm)]",
              active
                ? "border-[var(--color-brand)] ring-1 ring-[var(--color-brand)]"
                : "border-[var(--color-line)] hover:border-[var(--color-brand)]",
            )}
          >
            <input
              type="radio"
              name="language"
              value={o.id}
              checked={active}
              onChange={() => onChange(o.id)}
              className="sr-only"
              data-testid="smb-crm-language-radio"
            />
            <span className="font-medium text-[var(--color-ink)]">
              {o.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/* ────────── step: modules ────────── */

function StepModules({
  templates,
  industry,
  value,
  onChange,
}: {
  templates: ReadonlyArray<{
    industryKey: string;
    modules: ReadonlyArray<string>;
  }>;
  industry: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const tpl = templates.find((t) => t.industryKey === industry);
  const available = tpl?.modules ?? [
    "customers",
    "deals",
    "tasks",
    "quotes",
    "automations",
    "integrations",
  ];
  const toggle = (m: string) => {
    if (value.includes(m)) onChange(value.filter((x) => x !== m));
    else onChange([...value, m]);
  };
  return (
    <div
      className="grid grid-cols-2 gap-2"
      data-testid="smb-crm-step-modules"
    >
      {available.map((m) => {
        const active = value.includes(m);
        return (
          <label
            key={m}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border bg-[var(--color-surface)] p-2 text-[var(--text-sm)]",
              active
                ? "border-[var(--color-brand)] ring-1 ring-[var(--color-brand)]"
                : "border-[var(--color-line)] hover:border-[var(--color-brand)]",
            )}
          >
            <input
              type="checkbox"
              checked={active}
              onChange={() => toggle(m)}
              className="size-3.5"
              data-testid="smb-crm-module-checkbox"
            />
            <span className="font-medium text-[var(--color-ink)]">{m}</span>
          </label>
        );
      })}
    </div>
  );
}

/* ────────── step: pipeline ────────── */

function StepPipeline({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const presets: Array<{ id: string; label: string }> = [
    { id: "lead", label: "Lead" },
    { id: "qualified", label: "Qualified" },
    { id: "proposal", label: "Proposal" },
    { id: "won", label: "Won" },
    { id: "lost", label: "Lost" },
  ];
  const toggle = (s: string) => {
    if (value.includes(s)) onChange(value.filter((x) => x !== s));
    else onChange([...value, s]);
  };
  return (
    <div
      className="flex flex-wrap gap-1.5"
      data-testid="smb-crm-step-pipeline"
    >
      {presets.map((p) => {
        const active = value.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => toggle(p.id)}
            className={cn(
              "rounded-[var(--radius-pill)] border px-2.5 py-1 text-[11px] font-medium",
              active
                ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white"
                : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)]",
            )}
            data-testid="smb-crm-pipeline-toggle"
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

/* ────────── step: review ────────── */

function StepReview({
  industry,
  companyName,
  companySize,
  language,
  modules,
  pipeline,
}: {
  industry: string;
  companyName: string;
  companySize: string;
  language: string;
  modules: string[];
  pipeline: string[];
}) {
  return (
    <dl
      className="grid grid-cols-2 gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-[var(--text-sm)]"
      data-testid="smb-crm-step-review"
    >
      <Field k="Industry" v={industry} />
      <Field k="Company" v={companyName} />
      <Field k="Size" v={companySize} />
      <Field k="Language" v={language} />
      <Field k="Modules" v={modules.join(", ")} />
      <Field k="Pipeline" v={pipeline.join(", ")} />
    </dl>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
        {k}
      </dt>
      <dd className="text-[var(--color-ink)]">{v || "—"}</dd>
    </>
  );
}

/* ────────── nav bar ────────── */

function NavBar({
  step,
  industry,
  companyName,
  modules,
  onBack,
  onNext,
  onCancel,
  payload,
}: {
  step: Step;
  industry: string;
  companyName: string;
  modules: string[];
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
  payload: ReturnType<typeof SmbCrmGenerateBlueprintRequestSchema.parse>;
}) {
  const navigate = useNavigate({ from: Route.fullPath });
  const canAdvance =
    (step === "industry" && industry.length > 0) ||
    (step === "companyName" && companyName.length > 0) ||
    (step === "modules" && modules.length > 0) ||
    (step === "review") ||
    step === "companySize" ||
    step === "language" ||
    step === "pipeline";

  const generateMut = useMutation({
    mutationFn: async () => {
      return postJson(
        "/api/smb-crm/generate-blueprint",
        payload,
        SmbCrmGenerateBlueprintResponseSchema,
      );
    },
    onSuccess: (data) => {
      const id = data.blueprintId;
      if (id) navigate({ to: "/app/smb-crm/blueprint/$blueprintId", params: { blueprintId: id } });
    },
  });

  return (
    <nav
      className="flex items-center justify-between gap-2"
      data-testid="smb-crm-onboarding-nav"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2 py-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)]"
          data-testid="smb-crm-onboarding-cancel"
        >
          <X className="size-3.5" />
          {ARM_CANCEL}
        </button>
      </div>
      <div className="flex items-center gap-1">
        {step !== "industry" && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2 py-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)]"
            data-testid="smb-crm-onboarding-back"
          >
            {ARM_BACK}
          </button>
        )}
        {step !== "review" ? (
          <button
            type="button"
            onClick={onNext}
            disabled={!canAdvance}
            className="rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-2 py-1 text-[var(--text-sm)] font-semibold text-white disabled:opacity-60"
            data-testid="smb-crm-onboarding-next"
          >
            {ARM_NEXT}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => generateMut.mutate()}
            disabled={generateMut.isPending}
            className="rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-2 py-1 text-[var(--text-sm)] font-semibold text-white disabled:opacity-60"
            data-testid="smb-crm-onboarding-submit"
          >
            {generateMut.isPending ? "…" : ARM_SUBMIT}
          </button>
        )}
      </div>
    </nav>
  );
}
