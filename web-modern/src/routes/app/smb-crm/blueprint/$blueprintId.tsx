/**
 * /app/smb-crm/blueprint/$blueprintId — Blueprint viewer (Phase 10, Track 5).
 *
 * Pattern A: reads /api/smb-crm/blueprints/:id, renders modules + stages +
 * fields + opportunities + tasks + an Apply button that calls
 * POST /api/smb-crm/blueprints/:id/apply.
 *
 * Mirrors the structure of /app/crm-tube/index.tsx.
 */
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, Layers, ListChecks } from "lucide-react";
import { getJson, postJson } from "../../../../lib/api/client";
import {
    SmbCrmApplyBlueprintResponseSchema,
  SmbCrmGetBlueprintResponseSchema,
} from "../../../../lib/api/schemas";
import { cn } from "../../../../lib/utils/cn";

export const Route = createFileRoute("/app/smb-crm/blueprint/$blueprintId")({
  component: BlueprintViewer,
});

/* ────────── root component ────────── */

function BlueprintViewer() {
  const { blueprintId } = useParams({ from: Route.fullPath }) as {
    blueprintId: string;
  };
  const qc = useQueryClient();
  const bpQ = useQuery({
    queryKey: ["smb-crm-blueprint", blueprintId],
    queryFn: () =>
      getJson(
        `/api/smb-crm/blueprints/${blueprintId}`,
        SmbCrmGetBlueprintResponseSchema,
      ),
    enabled: !!blueprintId,
  });

  const applyMut = useMutation({
    mutationFn: () =>
      postJson(
        `/api/smb-crm/blueprints/${blueprintId}/apply`,
        {
          idempotencyKey: `smb-crm-apply-${Date.now()}`,
        },
        SmbCrmApplyBlueprintResponseSchema,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["smb-crm-blueprint"] }),
  });

  const bp = bpQ.data?.blueprint;

  return (
    <div
      className="mx-auto max-w-4xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="smb-crm-blueprint"
      data-blueprint-id={blueprintId}
    >
      <header className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
            <Layers className="size-5" aria-hidden />
          </span>
          <div>
            <h1
              className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]"
              data-testid="smb-crm-blueprint-h1"
            >
              {bp?.companyName ?? "Blueprint"}
            </h1>
            <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
              {bp?.industry} · {bp?.language}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => applyMut.mutate()}
          disabled={applyMut.isPending || !bp}
          className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 py-1.5 text-[var(--text-sm)] font-semibold text-white disabled:opacity-60"
          data-testid="smb-crm-apply"
        >
          {applyMut.isPending ? (
            "…"
          ) : applyMut.data?.ok ? (
            <>
              <CheckCircle2 className="size-3.5" />
              Applied
            </>
          ) : (
            "Apply blueprint"
          )}
        </button>
      </header>

      {bpQ.isError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-ruby,#b23a48)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_5%,transparent)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
        >
          Could not load blueprint.
        </p>
      ) : !bp ? (
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          Loading…
        </p>
      ) : (
        <>
          <Section title="Modules" items={bp.modules} />
          <Section title="Pipeline" items={bp.pipeline} />
          <Section title="Fields" items={bp.fields} />
          <Section title="KPIs" items={bp.kpis} />
          <Section title="Lead form fields" items={bp.leadFormFields} />
          <Section title="Starter messages" items={bp.starterMessages} />
        </>
      )}

      <div>
        <a
          href="/app/smb-crm"
          className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          Back to onboarding
        </a>
      </div>
    </div>
  );
}

/* ────────── section ────────── */

function Section({ title, items }: { title: string; items: ReadonlyArray<string> }) {
  if (items.length === 0) return null;
  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
      data-testid="smb-crm-blueprint-section"
      data-section={title}
    >
      <h2 className="mb-1 flex items-center gap-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        <ListChecks className="size-3.5" aria-hidden />
        {title}
      </h2>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <li
            key={`${title}-${i}`}
            className={cn(
              "rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-0.5 text-[11px] text-[var(--color-ink)]",
            )}
          >
            {it}
          </li>
        ))}
      </ul>
    </section>
  );
}
