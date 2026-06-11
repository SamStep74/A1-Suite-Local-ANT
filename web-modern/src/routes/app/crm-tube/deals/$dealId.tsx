/**
 * /app/crm-tube/deals/$dealId — deal detail (Phase 8.13, worker 1/3).
 *
 * Layout: 2-column on lg+ — detail on left, AI Action Panel on right.
 * Below lg, the panel stacks underneath.
 *
 * Detail shows: title, value, status pill, stage badge, contact + org,
 * expected close date, activities timeline.
 *
 * The right-rail panel uses the 3 tube agents directly (the existing
 * AgentActionPanel uses AGENTS, which doesn't include tubeAgents). We
 * filter tubeAgents by `triggers.includes("tube.deal")` and call their
 * pure `evaluate()` with a per-deal context.
 *
 * Armenian strings are inlined as `__ARM_*` placeholders and substituted
 * via Python at the end of this file.
 */
import {
  createFileRoute,
  Link,
  notFound,
  useParams,
} from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  Calendar,
  CircleDot,
  Sparkles,
  Tag,
  User as UserIcon,
} from "lucide-react";
import { getJson, api } from "../../../../lib/api/client";
import {
  TubeListResponseSchema,
  TubeDealSchema,
  type TubeDeal,
  type TubeSequence,
} from "../../../../lib/api/schemas";
import { z } from "zod";
import { tubeAgents } from "../../../../lib/agents/tube/registry";
import type { AgentSuggestion } from "../../../../lib/agents/types";
import { DecisionCard } from "../../../../components/decision-card/DecisionCard";
import { HybridBadge } from "../../../../components/ui/HybridBadge";
import { cn } from "../../../../lib/utils/cn";

/* ────────── local schemas ────────── */

/**
 * Per-deal envelope returned by GET /api/crm/tube/deals/:id. Local
 * to this route so we don't have to expand TubeListResponseSchema
 * (which the port owns). Mirrors the server's `return { deal }`.
 */
const TubeDealEnvelopeSchema = z.object({
  deal: TubeDealSchema.optional(),
});

/* ────────── constants ────────── */

const ARMENIAN_TIMELINE = "Ժամանակացույց";
const ARMENIAN_NO_ACTIVITIES = "Գործողություններ դեռ չկան";
const ARMENIAN_EXPECTED = "Ակնկալվող փակում";
const ARMENIAN_PANEL_TITLE = "Tube AI առաջարկներ";
const ARMENIAN_NO_SUGGESTIONS = "Առաջարկներ չկան";
const ARMENIAN_LOADING = "Մտածում ենք…";
const ARMENIAN_NOT_FOUND = "Գործը չի գտնվել";
const ARMENIAN_STAGE = "Փուլ";
const ARMENIAN_CONTACT = "Կոնտակտ";
const ARMENIAN_ORG = "Կազմակերպություն";
const ARMENIAN_STATUS_OPEN = "Բաց";
const ARMENIAN_STATUS_WON = "Հաղթած";
const ARMENIAN_STATUS_LOST = "Պարտություն";

/* ────────── route ────────── */

export const Route = createFileRoute("/app/crm-tube/deals/$dealId")({
  component: DealDetail,
});

/* ────────── helpers ────────── */

function formatMmmDd(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

function formatArm(value: number): string {
  const v = Math.round(Number(value) || 0).toLocaleString("en-US");
  return `${v} AMD`;
}

function statusLabel(s: TubeDeal["status"]): string {
  if (s === "open") return ARMENIAN_STATUS_OPEN;
  if (s === "won") return ARMENIAN_STATUS_WON;
  return ARMENIAN_STATUS_LOST;
}

/* ────────── root component ────────── */

function DealDetail() {
  const { dealId } = useParams({ from: Route.fullPath });
  if (!dealId) throw notFound();

  const dealQ = useQuery({
    queryKey: ["tube-deal", dealId],
    queryFn: () =>
      getJson(`/api/crm/tube/deals/${dealId}`, TubeDealEnvelopeSchema),
    staleTime: 30_000,
  });
  const activitiesQ = useQuery({
    queryKey: ["tube-activities"],
    queryFn: () =>
      getJson("/api/crm/tube/activities", TubeListResponseSchema),
    staleTime: 30_000,
  });
  const sequencesQ = useQuery({
    queryKey: ["tube-sequences"],
    queryFn: () =>
      getJson("/api/crm/tube/sequences", TubeListResponseSchema),
    staleTime: 30_000,
  });

  const deal: TubeDeal | undefined = dealQ.data?.deal;
  const rawActivities: unknown[] = activitiesQ.data?.activities ?? [];
  const sequences: TubeSequence[] = (sequencesQ.data?.sequences ??
    []) as TubeSequence[];

  const dealActivities = useMemo(() => {
    return (rawActivities as Array<Record<string, unknown>>)
      .filter((a) => a.deal_id === dealId)
      .sort((a, b) =>
        String(b.occurred_at ?? "").localeCompare(
          String(a.occurred_at ?? ""),
        ),
      );
  }, [rawActivities, dealId]);

  if (dealQ.isLoading) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <p className="px-3 py-10 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          Loading deal…
        </p>
      </div>
    );
  }

  if (dealQ.isError || !deal) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-ruby,#b23a48)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_5%,transparent)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
        >
          {ARMENIAN_NOT_FOUND}
        </p>
        <BackLink />
      </div>
    );
  }

  return (
    <div
      className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4"
      data-testid="tube-deal-detail"
      data-entity="tube-deal"
    >
      <BackLink />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <DealMain deal={deal} activities={dealActivities} />
        <TubeAgentPanel
          deal={deal}
          activities={dealActivities}
          sequences={sequences}
        />
      </div>
    </div>
  );
}

/* ────────── back link ────────── */

function BackLink() {
  return (
    <Link
      to="/app/crm-tube"
      className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
    >
      <ArrowLeft className="size-3.5" />
      Back to Tube
    </Link>
  );
}

/* ────────── detail main column ────────── */

function DealMain({
  deal,
  activities,
}: {
  deal: TubeDeal;
  activities: Array<Record<string, unknown>>;
}) {
  return (
    <article className="space-y-3">
      <header className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-[var(--text-xl)] font-semibold text-[var(--color-ink)]">
            {deal.title}
          </h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status={deal.status} />
            {deal.stage_name && <StageBadge deal={deal} />}
          </div>
        </div>
        <p className="font-mono text-[var(--text-lg)] tabular-nums text-[var(--color-ink)]">
          {formatArm(deal.value)}
        </p>
      </header>

      <dl className="grid grid-cols-1 gap-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-[var(--text-sm)] sm:grid-cols-2">
        <Field
          icon={<UserIcon className="size-3.5" aria-hidden />}
          label={ARMENIAN_CONTACT}
          value={deal.contact_name ?? "—"}
          sub={deal.contact_email ?? undefined}
        />
        <Field
          icon={<Building2 className="size-3.5" aria-hidden />}
          label={ARMENIAN_ORG}
          value={deal.organization_name ?? "—"}
        />
        <Field
          icon={<Calendar className="size-3.5" aria-hidden />}
          label={ARMENIAN_EXPECTED}
          value={
            deal.expected_close_at
              ? formatMmmDd(deal.expected_close_at)
              : "—"
          }
        />
        <Field
          icon={<Tag className="size-3.5" aria-hidden />}
          label={ARMENIAN_STAGE}
          value={deal.stage_name ?? "—"}
          sub={
            deal.stage_probability != null
              ? `${deal.stage_probability}%`
              : undefined
          }
        />
      </dl>

      <section className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <h2 className="mb-2 text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          {ARMENIAN_TIMELINE}
        </h2>
        {activities.length === 0 ? (
          <p
            className="px-2 py-3 text-center text-[11px] text-[var(--color-muted)]"
            data-testid="tube-activities-empty"
          >
            {ARMENIAN_NO_ACTIVITIES}
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {activities.map((a) => (
              <ActivityRow key={String(a.id)} a={a} />
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}

/* ────────── field row ────────── */

function Field({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
        {icon}
        {label}
      </dt>
      <dd className="text-[var(--text-sm)] text-[var(--color-ink)]">
        {value}
        {sub && (
          <span className="ml-1 text-[11px] text-[var(--color-muted)]">
            {sub}
          </span>
        )}
      </dd>
    </div>
  );
}

/* ────────── status / stage pills ────────── */

function StatusPill({ status }: { status: TubeDeal["status"] }) {
  const cls =
    status === "won"
      ? "bg-[color-mix(in_srgb,var(--color-emerald,#2f7d57)_18%,transparent)] text-[var(--color-emerald,#2f7d57)]"
      : status === "lost"
        ? "bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_18%,transparent)] text-[var(--color-ruby,#b23a48)]"
        : "bg-[var(--color-surface-soft)] text-[var(--color-ink)]";
  return (
    <span
      className={cn(
        "rounded-[var(--radius-pill)] px-2 py-0.5 text-[11px] font-semibold",
        cls,
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

function StageBadge({ deal }: { deal: TubeDeal }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-2 py-0.5 text-[11px] text-[var(--color-ink)]">
      <CircleDot className="size-2.5" aria-hidden />
      {deal.stage_name}
    </span>
  );
}

/* ────────── activity row ────────── */

function ActivityRow({ a }: { a: Record<string, unknown> }) {
  const kind = String(a.kind ?? "activity");
  const subject = String(a.subject ?? a.title ?? "Activity");
  const body = a.body != null ? String(a.body) : null;
  const at = a.occurred_at != null ? String(a.occurred_at) : null;
  return (
    <li className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-2">
      <span
        className="mt-0.5 size-1.5 rounded-full bg-[var(--color-brand)]"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-[var(--text-sm)] text-[var(--color-ink)]">
          {subject}
        </p>
        {body && (
          <p className="line-clamp-2 text-[11px] text-[var(--color-muted)]">
            {body}
          </p>
        )}
        <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">
          {kind} · {at ? formatMmmDd(at) : "—"}
        </p>
      </div>
    </li>
  );
}

/* ────────── tube AI panel (right rail) ────────── */

function TubeAgentPanel({
  deal,
  activities,
  sequences,
}: {
  deal: TubeDeal;
  activities: Array<Record<string, unknown>>;
  sequences: TubeSequence[];
}) {
  const qc = useQueryClient();

  const suggestions = useMemo<AgentSuggestion[]>(() => {
    const ctx: Record<string, unknown> = {
      deal: {
        id: deal.id,
        status: deal.status,
        contact_id: deal.contact_id,
        value: deal.value,
        updated_at: deal.updated_at,
      },
      contact: deal.contact_id
        ? {
            id: deal.contact_id,
            status: "enriched",
            lead_score: null,
          }
        : null,
      sequences: sequences.map((s) => ({
        id: s.id,
        name: s.name,
        is_active: s.is_active,
      })),
      existingEnrollments: [],
      activities: activities
        .filter((a) => a.occurred_at != null)
        .map((a) => ({
          id: String(a.id),
          occurred_at: String(a.occurred_at),
        })),
    };

    const out: AgentSuggestion[] = [];
    for (const agent of tubeAgents) {
      if (!agent.triggers.includes("tube.deal")) continue;
      try {
        const got = agent.evaluate(ctx as never);
        if (Array.isArray(got)) out.push(...got);
      } catch {
        // skip
      }
    }
    return out;
  }, [deal, activities, sequences]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tube-activities"] });
    qc.invalidateQueries({ queryKey: ["tube-sequences"] });
    qc.invalidateQueries({ queryKey: ["tube-deal", deal.id] });
    qc.invalidateQueries({ queryKey: ["tube-deals"] });
  };

  return (
    <aside
      className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
      aria-label={ARMENIAN_PANEL_TITLE}
      data-testid="tube-ai-panel"
    >
      <header className="flex items-center justify-between">
        <h3 className="inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
          <Sparkles className="size-3.5" />
          {ARMENIAN_PANEL_TITLE}
        </h3>
        <span className="text-[11px] text-[var(--color-muted)]">
          {suggestions.length} suggestion
          {suggestions.length === 1 ? "" : "s"}
        </span>
      </header>

      {dealQLoadingFor() ? null : null}

      {suggestions.length === 0 ? (
        <p
          className="px-2 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
          data-testid="tube-ai-empty"
        >
          {ARMENIAN_NO_SUGGESTIONS}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {suggestions.map((s) => (
            <DecisionCard
              key={s.id}
              id={s.id}
              title={s.title}
              why={s.rationale}
              sources={s.sourceRecords.map((r) => ({ label: r, kind: "data" as const }))}
              confidence={Math.round((s.confidence ?? 0) * 100)}
              risk={s.risk}
              riskReason={s.riskReason}
              preview={Object.entries(s.previewDiff ?? {}).map(
                ([field, value]) => ({ field, to: String(value ?? "") }),
              )}
              kind={"agent" as const}
              onApprove={async () => {
                const { method, path, body } = s.proposedAction;
                await api(path, null, {
                  method,
                  body,
                } as unknown as Parameters<typeof api>[2]);
                refresh();
              }}
            />
          ))}
        </div>
      )}

      <footer className="flex items-center gap-1 border-t border-[var(--color-line)] pt-2 text-[11px] text-[var(--color-muted)]">
        <HybridBadge kind="agent" />
        <span>
          {ARMENIAN_LOADING}
        </span>
      </footer>
    </aside>
  );
}

/* helper that is intentionally a no-op now that we compute suggestions
 * synchronously via useMemo; kept so the JSX above remains readable */
function dealQLoadingFor(): false {
  return false;
}
