/**
 * /app/crm-tube/contacts/$contactId — Tube contact detail.
 *
 * Per the plan §3.4 + docs/phase8-tube/design.md §2.4, this is the
 * per-contact workspace inside the CRM Tube app. Mirrors the shape of
 * /app/inventory/$itemId (2-column: detail left ~70%, AI Action Panel
 * right ~30%) but the panel is Tube-specific.
 *
 * Two Tube agents have `triggers` that include `"tube.contact"`:
 *   - enrich-opportunity — flags un-enriched contacts on high-value deals
 *   - deal-health       — does NOT trigger here (only `tube.deal`)
 *   - sequence-rollout  — does NOT trigger here (only `tube.deal`)
 *
 * Data:
 *   GET /api/crm/tube/contacts      → { contacts: TubeContact[] }
 *   GET /api/crm/tube/deals         → { deals: TubeDeal[] } (filtered client-side)
 *   GET /api/crm/tube/activities    → { activities: Activity[] } (filtered client-side)
 *
 * Mutations happen via the right-rail DecisionCard's `onApprove` →
 * `api(method, path, body)` against the existing routes.
 */
import {
  createFileRoute,
  Link,
  notFound,
} from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity as ActivityIcon,
  Briefcase,
  ChevronLeft,
  ExternalLink,
  Sparkles,
  TrendingUp,
  User as UserIcon,
  Users as UsersIcon,
} from "lucide-react";
import { api, getJson } from "../../../../lib/api/client";
import {
  TubeListResponseSchema,
  type TubeContact,
  type TubeDeal,
} from "../../../../lib/api/schemas";
import { tubeAgents } from "../../../../lib/agents/tube/registry";
import type {
  AgentContext,
  AgentSuggestion,
  SourceCitation as AgentSourceCitation,
} from "../../../../lib/agents/types";
import {
  DecisionCard,
  type PreviewDiff,
  type SourceCitation as CardSourceCitation,
} from "../../../../components/decision-card/DecisionCard";
import { HybridBadge, type HybridKind } from "../../../../components/ui/HybridBadge";
import { cn } from "../../../../lib/utils/cn";

/* ────────── status palette (mirrors index.tsx) ────────── */

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  new: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
  },
  enriched: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-violet)_15%,transparent)]",
    fg: "text-[var(--color-tag-violet)]",
  },
  contacted: {
    bg: "bg-[color-mix(in_srgb,var(--color-amber,#d78b2f)_15%,transparent)]",
    fg: "text-[var(--color-amber,#d78b2f)]",
  },
  qualified: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
  },
  unqualified: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
  },
  rejected: {
    bg: "bg-[var(--color-surface-soft)]",
    fg: "text-[var(--color-muted)]",
  },
};

/* ────────── typed route ────────── */

export const Route = createFileRoute("/app/crm-tube/contacts/$contactId")({
  component: ContactDetail,
});

/* ────────── root component ────────── */

function ContactDetail() {
  const { contactId } = Route.useParams();
  const qc = useQueryClient();

  const listQ = useQuery({
    queryKey: ["tube-contacts"],
    queryFn: () =>
      getJson("/api/crm/tube/contacts", TubeListResponseSchema),
    staleTime: 30_000,
  });

  const dealsQ = useQuery({
    queryKey: ["tube-deals"],
    queryFn: () => getJson("/api/crm/tube/deals", TubeListResponseSchema),
    staleTime: 30_000,
  });

  const actsQ = useQuery({
    queryKey: ["tube-activities-all"],
    queryFn: () =>
      getJson("/api/crm/tube/activities", TubeListResponseSchema),
    staleTime: 30_000,
  });

  const contact = useMemo<TubeContact | null>(() => {
    const list = (listQ.data?.contacts ?? []) as TubeContact[];
    return list.find((c) => c.id === contactId) ?? null;
  }, [listQ.data?.contacts, contactId]);

  const contactDeals = useMemo<TubeDeal[]>(() => {
    const list = (dealsQ.data?.deals ?? []) as TubeDeal[];
    return list.filter((d) => d.contact_id === contactId);
  }, [dealsQ.data?.deals, contactId]);

  // Activities in the envelope are `unknown` per the schema; narrow at
  // the boundary so the rest of the file stays typed. We expect the
  // backend to ship an `{ id, contact_id, kind, body, occurred_at, ... }`
  // shape — the same shape `deals/:id` uses.
  const contactActivities = useMemo<
    Array<{ id: string; kind?: string; body?: string | null; subject?: string | null; occurred_at: string; channel?: string | null }>
  >(() => {
    const raw = (actsQ.data?.activities ?? []) as unknown[];
    return raw
      .filter((a): a is { id: string; contact_id?: string; occurred_at: string; [k: string]: unknown } => {
        return !!a && typeof a === "object" && "id" in (a as object);
      })
      .filter((a) => a.contact_id === contactId || contactDeals.some((d) => d.id === (a as { deal_id?: string }).deal_id))
      .map((a) => ({
        id: a.id,
        kind: typeof a.kind === "string" ? a.kind : undefined,
        body: typeof a.body === "string" ? a.body : null,
        subject: typeof a.subject === "string" ? a.subject : null,
        occurred_at: a.occurred_at,
        channel: typeof a.channel === "string" ? a.channel : null,
      }));
  }, [actsQ.data?.activities, contactId, contactDeals]);

  // ─── Loading / error / 404 gates ───
  if (listQ.isLoading || dealsQ.isLoading) {
    return (
      <p
        data-testid="tube-contact-loading"
        className="px-6 py-10 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        Loading contact…
      </p>
    );
  }
  if (listQ.isError || dealsQ.isError) {
    return (
      <p
        role="alert"
        data-testid="tube-contact-error"
        className="mx-auto max-w-3xl px-6 py-10 text-center text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
      >
        Could not load the contact.
      </p>
    );
  }
  if (!contact) {
    return notFound();
  }

  const tone = STATUS_TONE[contact.status] ?? {
    bg: "bg-[var(--color-surface-soft)]",
    fg: "text-[var(--color-muted)]",
  };

  // Pick the first open deal for the AI panel context. The
  // enrich-opportunity agent only cares about contact.status === "new"
  // and a deal.value >= 100000; it ignores other deals.
  const primaryDeal = contactDeals.find((d) => d.status === "open") ?? contactDeals[0] ?? null;

  const ctx: AgentContext = {
    type: "tube.contact",
    id: contact.id,
    data: {
      contact: {
        id: contact.id,
        status: contact.status,
        lead_score: contact.lead_score,
      },
      deal: primaryDeal
        ? {
            id: primaryDeal.id,
            status: primaryDeal.status,
            value: primaryDeal.value,
            contact_id: primaryDeal.contact_id,
          }
        : { id: "n/a", status: "lost", value: 0, contact_id: contact.id },
    },
  };

  return (
    <div
      data-testid="tube-contact"
      data-entity="tube-contact-detail"
      className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
    >
      <Link
        to="/app/crm-tube/contacts"
        data-testid="tube-contact-back"
        className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        Contacts
      </Link>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <ContactHeader contact={contact} tone={tone} />
          <ContactInfoCard contact={contact} />
          <DealsPanel deals={contactDeals} />
          <ActivitiesPanel activities={contactActivities} />
        </div>

        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <TubeAgentPanel
            ctx={ctx}
            onApproved={() => {
              qc.invalidateQueries({ queryKey: ["tube-contacts"] });
              qc.invalidateQueries({ queryKey: ["tube-deals"] });
            }}
          />
        </aside>
      </div>
    </div>
  );
}

/* ────────── header ────────── */

function ContactHeader({
  contact,
  tone,
}: {
  contact: TubeContact;
  tone: { bg: string; fg: string };
}) {
  return (
    <header className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            <UsersIcon className="size-3" />
            Contact
          </span>
          <h1
            data-testid="tube-contact-name"
            className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]"
          >
            {contact.full_name ?? "—"}
          </h1>
          <p className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--text-sm)] text-[var(--color-muted)]">
            {contact.title && (
              <span className="inline-flex items-center gap-1">
                <Briefcase className="size-3" /> {contact.title}
              </span>
            )}
            {contact.organization_name && <span>· {contact.organization_name}</span>}
            <span className="inline-flex items-center gap-1">
              <ActivityIcon className="size-3" />
              Updated {relativeTime(contact.updated_at)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              tone.bg,
              tone.fg,
            )}
          >
            {contact.status}
          </span>
          <span
            data-testid="tube-contact-lead-score"
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)] px-2 py-0.5 text-[11px] font-mono font-semibold tabular-nums text-[var(--color-ink)]"
          >
            <TrendingUp className="size-3" />
            {contact.lead_score == null ? "no score" : `${contact.lead_score} / 100`}
          </span>
        </div>
      </div>
    </header>
  );
}

/* ────────── info card ────────── */

function ContactInfoCard({ contact }: { contact: TubeContact }) {
  return (
    <section
      data-testid="tube-contact-info"
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
    >
      <h2 className="mb-3 inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
        <UserIcon className="size-3.5" />
        Contact details
      </h2>
      <dl className="grid grid-cols-1 gap-3 text-[var(--text-sm)] sm:grid-cols-2">
        <Field
          label="Email"
          value={contact.email}
          mono
          href={contact.email ? `mailto:${contact.email}` : undefined}
        />
        <Field
          label="Phone"
          value={contact.phone}
          mono
          href={contact.phone ? `tel:${contact.phone}` : undefined}
        />
        <Field label="Title" value={contact.title} />
        <Field
          label="Organization"
          value={contact.organization_name}
          href={
            contact.organization_id
              ? `/app/crm-tube/organizations/${contact.organization_id}`
              : undefined
          }
        />
        <Field
          label="LinkedIn"
          value={contact.linkedin_url}
          href={contact.linkedin_url ?? undefined}
          external
        />
      </dl>
    </section>
  );
}

function Field({
  label,
  value,
  mono,
  href,
  external,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  href?: string;
  external?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] text-[var(--color-muted)]">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-[var(--text-sm)] text-[var(--color-ink)]",
          mono && "font-mono tabular-nums",
        )}
      >
        {value ? (
          href ? (
            <a
              href={href}
              target={external ? "_blank" : undefined}
              rel={external ? "noopener noreferrer" : undefined}
              className="inline-flex items-center gap-1 text-[var(--color-link,#2563eb)] hover:underline"
            >
              {value}
              {external && <ExternalLink className="size-3" />}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="text-[var(--color-muted)]">—</span>
        )}
      </dd>
    </div>
  );
}

/* ────────── deals panel ────────── */

function DealsPanel({ deals }: { deals: TubeDeal[] }) {
  if (deals.length === 0) {
    return (
      <section
        data-testid="tube-contact-deals"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        No deals attached to this contact yet.
      </section>
    );
  }
  return (
    <section
      data-testid="tube-contact-deals"
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
    >
      <h2 className="mb-3 inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
        <Briefcase className="size-3.5" />
        Deals
      </h2>
      <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line)]">
        <table className="w-full text-left text-[var(--text-sm)]">
          <thead className="bg-[var(--color-surface-soft)] text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            <tr>
              <th className="px-3 py-1.5 font-medium">Title</th>
              <th className="px-3 py-1.5 text-right font-medium">Value</th>
              <th className="px-3 py-1.5 font-medium">Stage</th>
              <th className="px-3 py-1.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => (
              <tr
                key={d.id}
                className="border-t border-[var(--color-line)] hover:bg-[var(--color-surface-soft)]"
              >
                <td className="px-3 py-1.5 text-[var(--color-ink)]">
                  <a
                    href={`/app/crm-tube/deals/${d.id}`}
                    className="hover:underline"
                  >
                    {d.title}
                  </a>
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[var(--color-ink)]">
                  {d.value.toLocaleString()} {d.currency}
                </td>
                <td className="px-3 py-1.5 text-[var(--color-muted)]">
                  {d.stage_name ?? "—"}
                </td>
                <td className="px-3 py-1.5">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      d.status === "open"
                        ? "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)] text-[var(--color-tag-blue)]"
                        : d.status === "won"
                          ? "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] text-[var(--color-tag-green)]"
                          : "bg-[var(--color-surface-soft)] text-[var(--color-muted)]",
                    )}
                  >
                    {d.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ────────── activities panel ────────── */

function ActivitiesPanel({
  activities,
}: {
  activities: Array<{
    id: string;
    kind?: string;
    body?: string | null;
    subject?: string | null;
    occurred_at: string;
    channel?: string | null;
  }>;
}) {
  if (activities.length === 0) {
    return (
      <section
        data-testid="tube-contact-activities"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        No activities recorded for this contact yet.
      </section>
    );
  }
  // newest first
  const sorted = [...activities].sort((a, b) =>
    (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""),
  );
  return (
    <section
      data-testid="tube-contact-activities"
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
    >
      <h2 className="mb-3 inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
        <ActivityIcon className="size-3.5" />
        Activities
      </h2>
      <ol className="space-y-2">
        {sorted.map((a) => (
          <li
            key={a.id}
            className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-2"
          >
            <div className="mb-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
              <span>{formatActivityTime(a.occurred_at)}</span>
              {a.kind && (
                <span className="rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-1 py-0.5">
                  {a.kind}
                </span>
              )}
              {a.channel && (
                <span className="rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-1 py-0.5">
                  {a.channel}
                </span>
              )}
            </div>
            {a.subject && (
              <p className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
                {a.subject}
              </p>
            )}
            {a.body && (
              <p className="text-[var(--text-sm)] text-[var(--color-ink)]">{a.body}</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ────────── tube agent panel (right rail) ────────── */

/** A small Tube-specific alternative to the global `AgentActionPanel`.
 *  The global panel iterates the main `AGENTS` registry, which does
 *  not include tube agents (they live in their own registry). This
 *  local panel mirrors the same UX (DecisionCard per suggestion) but
 *  pulls from `tubeAgents` so tube triggers work in isolation. */
function TubeAgentPanel({
  ctx,
  onApproved,
}: {
  ctx: AgentContext;
  onApproved?: (suggestion: AgentSuggestion) => void;
}) {
  const [decisions, setDecisions] = useState<Set<string>>(() => new Set());
  const [allSuggestions, setAllSuggestions] = useState<AgentSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const eligible = tubeAgents.filter((a) => a.triggers.includes(ctx.type));
      const flat: AgentSuggestion[] = [];
      for (const agent of eligible) {
        try {
          const out = await agent.evaluate(ctx);
          flat.push(...out);
        } catch {
          // swallow — one agent's failure must not blank the panel
        }
      }
      if (cancelled) return;
      setAllSuggestions(flat);
      setDecisions(new Set());
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx.type, ctx.id, ctx]);

  const visible = allSuggestions.filter((s) => !decisions.has(s.id));

  return (
    <aside
      aria-label="AI suggestions"
      data-testid="tube-contact-ai-panel"
      className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
    >
      <header className="flex items-center justify-between">
        <h3 className="inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
          <Sparkles className="size-3.5" />
          AI suggestions
        </h3>
        <span className="text-[11px] text-[var(--color-muted)]">
          {loading
            ? "thinking…"
            : `${visible.length} suggestion${visible.length === 1 ? "" : "s"}`}
        </span>
      </header>
      {loading ? (
        <p className="px-2 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          Agents are reviewing this contact…
        </p>
      ) : visible.length === 0 ? (
        <p className="px-2 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          {allSuggestions.length > 0
            ? "All suggestions addressed."
            : "No new suggestions."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((s) => (
            <DecisionCard
              key={s.id}
              id={s.id}
              title={s.title}
              why={s.rationale}
              sources={toSources(s)}
              confidence={Math.round((s.confidence ?? 0) * 100)}
              risk={s.risk}
              riskReason={s.riskReason}
              preview={toPreviewDiff(s.previewDiff)}
              kind={(s.kind ?? "agent") as HybridKind}
              onApprove={async () => {
                const { method, path, body } = s.proposedAction;
                await api(
                  path,
                  null,
                  { method, body } as unknown as Parameters<typeof api>[2],
                );
                setDecisions((prev) => new Set(prev).add(s.id));
                onApproved?.(s);
              }}
              onReject={() => {
                setDecisions((prev) => new Set(prev).add(s.id));
              }}
            />
          ))}
        </div>
      )}
      <footer className="flex items-center gap-1 border-t border-[var(--color-line)] pt-2 text-[11px] text-[var(--color-muted)]">
        <HybridBadge kind="agent" />
        <span>Tube agents. Approvals hit the same API a human would.</span>
      </footer>
    </aside>
  );
}

/* ────────── helpers ────────── */

function toSources(s: AgentSuggestion): CardSourceCitation[] {
  const fromStructured: AgentSourceCitation[] = s.sourceCitations ?? [];
  const fromStrings = s.sourceRecords
    .filter((label) => !fromStructured.some((c) => c.label === label))
    .map<CardSourceCitation>((label) => ({ label, kind: "data" }));
  return [...fromStructured, ...fromStrings];
}

function toPreviewDiff(diff: Record<string, unknown>): PreviewDiff[] {
  return Object.entries(diff).map(([field, value]) => {
    if (
      value &&
      typeof value === "object" &&
      "from" in value &&
      "to" in value
    ) {
      const v = value as { from: unknown; to: unknown };
      return {
        field,
        from: v.from == null ? undefined : String(v.from),
        to: String(v.to ?? ""),
      };
    }
    return { field, to: String(value ?? "") };
  });
}

/** Best-effort relative time formatter. Mirrors index.tsx. */
function relativeTime(iso: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const sign = diffMs >= 0 ? "" : "in ";
  const suffix = diffMs >= 0 ? " ago" : "";
  if (abs < minute) return "just now";
  if (abs < hour) {
    const n = Math.round(abs / minute);
    return `${sign}${n} min${n === 1 ? "" : "s"}${suffix}`;
  }
  if (abs < day) {
    const n = Math.round(abs / hour);
    return `${sign}${n} hour${n === 1 ? "" : "s"}${suffix}`;
  }
  const n = Math.round(abs / day);
  return `${sign}${n} day${n === 1 ? "" : "s"}${suffix}`;
}

/** Compact "Mmm dd HH:mm" formatter (no Intl.DateTimeFormat to keep
 *  the test environment stable). */
function formatActivityTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const mo = months[d.getMonth()] ?? "—";
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${mo} ${day} ${hh}:${mm}`;
}

/* ────────── tiny in-file hooks (no react import bloat) ────────── */
