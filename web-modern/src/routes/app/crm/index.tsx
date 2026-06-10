/**
 * /app/crm — CRM workspace: quotes + leads + forecast, list/kanban/leads.
 *
 * Per the plan §3.4, CRM maps 1:1 to the Zoho CRM reference. The home
 * route is a list view of quotes with:
 *   - Status filter tabs (All / Draft / Sent / Accepted / Declined / Expired)
 *   - View-switcher (List | Kanban | Leads) — also drives ?view=…
 *   - A forecast summary card on the right rail (the V1 substitute for
 *     a chart, per the ForecastSummaryCard header doc)
 *   - Quick links to /crm/leads (full Leads view) and /crm/new (new lead
 *     capture form)
 *
 * URL state:
 *   ?status=…  filter the quote list
 *   ?view=…    list | kanban | leads
 *
 * The view switcher is a controlled component: the parent owns the URL,
 * the component calls onChange(next) → we navigate.
 *
 * Data: /api/crm/quotes (list), /api/crm/leads (for the leads count
 * badge on the tab), /api/crm/forecast (for the summary card).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Search,
  TrendingUp,
  Users,
} from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  CrmForecastSchema,
  CrmLeadsResponseSchema,
  CrmQuotesResponseSchema,
  type CrmQuote,
  type CrmQuoteStatus as Status,
} from "../../../lib/api/schemas";
import { ViewSwitcher } from "../../../components/view-switcher/ViewSwitcher";
import { KanbanBoard, type KanbanItem } from "../../../components/kanban/KanbanBoard";
import { ForecastSummaryCard } from "../../../components/forecast/ForecastSummaryCard";
import { LeadCaptureForm } from "../../../components/lead/LeadCaptureForm";
import { HybridBadge } from "../../../components/ui/HybridBadge";
import { money, numberShort } from "../../../lib/utils/money";
import { cn } from "../../../lib/utils/cn";

/* ────────── typed URL search ────────── */

type View = "list" | "kanban" | "leads";

export const Route = createFileRoute("/app/crm/")({
  validateSearch: (raw) => {
    const v: View =
      raw.view === "kanban" || raw.view === "leads" ? raw.view : "list";
    const s: "all" | Status =
      raw.status === "draft" ||
      raw.status === "sent" ||
      raw.status === "accepted" ||
      raw.status === "declined" ||
      raw.status === "expired"
        ? raw.status
        : "all";
    return { view: v, status: s };
  },
  component: CrmWorkspace,
});

/* ────────── constants ────────── */

const STATUS_TABS: { value: "all" | Status; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "expired", label: "Expired" },
];

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "list", label: "List" },
  { value: "kanban", label: "Kanban" },
  { value: "leads", label: "Leads" },
];

// Kanban stages — drives the columns. We group "expired" into
// "declined" so the kanban isn't a graveyard of one-card columns.
const KANBAN_STAGES = ["draft", "sent", "accepted", "declined"] as const;

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  draft: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
  },
  sent: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
  },
  accepted: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
  },
  declined: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
  },
  expired: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-violet)_15%,transparent)]",
    fg: "text-[var(--color-tag-violet)]",
  },
};

/* ────────── root component ────────── */

function CrmWorkspace() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view: View = search.view;
  const status: "all" | Status = search.status;

  const setView = (next: View) =>
    navigate({ search: { ...search, view: next }, replace: true });
  const setStatus = (next: "all" | Status) =>
    navigate({ search: { ...search, status: next }, replace: true });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ViewSwitcher options={VIEW_OPTIONS} value={view} onChange={setView} />
        <Link
          to="/app/crm"
          search={{ view: "leads", status: "all" }}
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <Users className="size-3.5" />
          Leads pipeline
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      {view === "leads" ? (
        <LeadsView />
      ) : (
        <QuotesView view={view} status={status} setStatus={setStatus} />
      )}
    </div>
  );
}

/* ────────── header ────────── */

function PageHeader() {
  return (
    <header>
      <Link
        to="/app"
        className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        Today
      </Link>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
            <Briefcase className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
              CRM
            </h1>
            <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
              Quotes · Deals · Leads · Forecast
            </p>
          </div>
        </div>
        <HybridBadge kind="agent" />
      </div>
    </header>
  );
}

/* ────────── quotes view (list + kanban) ────────── */

function QuotesView({
  view,
  status,
  setStatus,
}: {
  view: "list" | "kanban";
  status: "all" | Status;
  setStatus: (s: "all" | Status) => void;
}) {
  const [query, setQuery] = useState("");

  const quotesQ = useQuery({
    queryKey: ["crm-quotes"],
    queryFn: () => getJson("/api/crm/quotes", CrmQuotesResponseSchema),
    staleTime: 30_000,
  });
  const forecastQ = useQuery({
    queryKey: ["crm-forecast"],
    queryFn: () => getJson("/api/crm/forecast", CrmForecastSchema),
    staleTime: 60_000,
  });

  const quotes: CrmQuote[] = quotesQ.data?.quotes ?? [];

  const visible = useMemo(() => {
    let list = quotes;
    if (status !== "all") list = list.filter((q) => q.status === status);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.customerName.toLowerCase().includes(q) ||
          (item.number ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [quotes, status, query]);

  const countByStatus = useMemo(() => {
    const map: Record<string, number> = { all: quotes.length };
    for (const q of quotes) map[q.status] = (map[q.status] ?? 0) + 1;
    return map;
  }, [quotes]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-muted)]"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search quotes, customers…"
              aria-label="Search quotes"
              className={cn(
                "h-8 w-full rounded-[var(--radius-md)] border border-[var(--color-line)]",
                "bg-[var(--color-surface)] pl-7 pr-2 text-[var(--text-sm)]",
                "text-[var(--color-ink)] placeholder:text-[var(--color-muted)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
              )}
            />
          </div>
          <span className="font-mono text-[11px] text-[var(--color-muted)]">
            {quotesQ.isLoading ? "…" : `${visible.length} of ${quotes.length}`}
          </span>
        </div>

        <nav
          className="flex flex-wrap gap-1 border-b border-[var(--color-line)]"
          aria-label="Filter by status"
        >
          {STATUS_TABS.map((tab) => {
            const active = tab.value === status;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setStatus(tab.value)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 border-b-2 px-2 py-1.5 text-[var(--text-sm)] font-medium",
                  active
                    ? "border-[var(--color-brand)] text-[var(--color-ink)]"
                    : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-ink)]",
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    "rounded-[var(--radius-sm)] px-1 text-[10px]",
                    active
                      ? "bg-[var(--color-surface-soft)] text-[var(--color-ink)]"
                      : "bg-transparent text-[var(--color-muted)]",
                  )}
                >
                  {countByStatus[tab.value] ?? 0}
                </span>
              </button>
            );
          })}
        </nav>

        {quotesQ.isLoading ? (
          <p className="px-3 py-8 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
            Loading quotes…
          </p>
        ) : visible.length === 0 ? (
          <EmptyState />
        ) : view === "list" ? (
          <QuoteTable quotes={visible} />
        ) : (
          <QuoteKanban quotes={visible} />
        )}
      </div>

      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        {forecastQ.data ? (
          <ForecastSummaryCard forecast={forecastQ.data} />
        ) : (
          <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] p-3 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
            {forecastQ.isLoading ? "Loading forecast…" : "No forecast available"}
          </p>
        )}
        <ForecastTotals
          total={forecastQ.data?.totals.value ?? 0}
          weighted={forecastQ.data?.totals.weightedValue ?? 0}
          atRisk={forecastQ.data?.totals.atRisk ?? 0}
        />
      </aside>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-xl)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-10 text-center">
      <ListChecks className="size-8 text-[var(--color-muted)]" aria-hidden />
      <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        No quotes in this view
      </h3>
      <p className="text-[11px] text-[var(--color-muted)]">
        Create a quote from a deal, or change the status filter.
      </p>
    </div>
  );
}

/* ────────── list table ────────── */

function QuoteTable({
  quotes,
}: {
  quotes: CrmQuote[];
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <table className="w-full text-left text-[var(--text-sm)]">
        <thead className="bg-[var(--color-surface-soft)] text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          <tr>
            <th className="px-3 py-2 font-medium">Quote</th>
            <th className="px-3 py-2 font-medium">Customer</th>
            <th className="px-3 py-2 font-medium">Deal</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Valid until</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((q) => {
            const tone = STATUS_TONE[q.status] ?? STATUS_TONE.draft;
            return (
              <tr
                key={q.id}
                className="group border-t border-[var(--color-line)] transition-colors hover:bg-[var(--color-surface-soft)]"
                onClick={() => {
                  window.location.href = `/app/crm/${q.id}`;
                }}
                style={{ cursor: "pointer" }}
              >
                <td className="px-3 py-2">
                  <div className="flex flex-col">
                    <span className="font-medium text-[var(--color-ink)]">
                      {q.title}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--color-muted)]">
                      {q.number ?? q.id.slice(0, 8)}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 text-[var(--color-ink)]">
                  {q.customerName}
                </td>
                <td className="px-3 py-2 text-[var(--color-muted)]">
                  {q.dealTitle ?? "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                  {money(Number(q.total) || 0, { compact: true })}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                      tone.bg,
                      tone.fg,
                    )}
                  >
                    {q.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-[11px] text-[var(--color-muted)]">
                  {q.validUntil
                    ? new Date(q.validUntil).toLocaleDateString()
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* Hidden marker for E2E / smoke tests */}
      <span data-entity="crm-quote" data-count={quotes.length} hidden />
    </div>
  );
}

/* ────────── kanban ────────── */

type QuoteKanbanItem = KanbanItem & {
  quote: CrmQuote;
};

const STAGE_TITLE: Record<(typeof KANBAN_STAGES)[number], string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined / Expired",
};

function QuoteKanban({
  quotes,
}: {
  quotes: CrmQuote[];
}) {
  // The KanbanBoard is generic on column id (string) and item; we
  // build the column descriptors and the per-column item list.
  const items: Record<(typeof KANBAN_STAGES)[number], QuoteKanbanItem[]> = {
    draft: [],
    sent: [],
    accepted: [],
    declined: [],
  };
  for (const q of quotes) {
    if (q.status === "draft") items.draft.push({ id: q.id, quote: q });
    else if (q.status === "sent") items.sent.push({ id: q.id, quote: q });
    else if (q.status === "accepted")
      items.accepted.push({ id: q.id, quote: q });
    else items.declined.push({ id: q.id, quote: q }); // declined + expired
  }

  const columns: ReadonlyArray<{
    id: (typeof KANBAN_STAGES)[number];
    title: string;
    accent: "blue" | "orange" | "green" | "red";
    count: number;
  }> = [
    { id: "draft", title: STAGE_TITLE.draft, accent: "blue", count: items.draft.length },
    { id: "sent", title: STAGE_TITLE.sent, accent: "orange", count: items.sent.length },
    { id: "accepted", title: STAGE_TITLE.accepted, accent: "green", count: items.accepted.length },
    { id: "declined", title: STAGE_TITLE.declined, accent: "red", count: items.declined.length },
  ];

  return (
    <KanbanBoard<typeof KANBAN_STAGES[number], QuoteKanbanItem>
      columns={columns}
      items={items}
      renderItem={(item) => {
        const q = item.quote;
        const tone = STATUS_TONE[q.status] ?? STATUS_TONE.draft;
        return (
          <Link
            to="/app/crm/$quoteId"
            params={{ quoteId: q.id }}
            className="flex flex-col gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
              {q.title}
            </span>
            <span className="text-[11px] text-[var(--color-muted)]">
              {q.customerName}
            </span>
            <div className="mt-1 flex items-center justify-between">
              <span
                className={cn(
                  "rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  tone.bg,
                  tone.fg,
                )}
              >
                {q.status}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink)]">
                {money(Number(q.total) || 0, { compact: true })}
              </span>
            </div>
          </Link>
        );
      }}
    />
  );
}

/* ────────── leads view (inline, with quick capture) ────────── */

function LeadsView() {
  const qc = useQueryClient();
  const leadsQ = useQuery({
    queryKey: ["crm-leads"],
    queryFn: () => getJson("/api/crm/leads", CrmLeadsResponseSchema),
    staleTime: 30_000,
  });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
            <Users className="size-3.5" />
            Leads
          </h2>
          <span className="font-mono text-[11px] text-[var(--color-muted)]">
            {leadsQ.isLoading ? "…" : `${leadsQ.data?.leads.length ?? 0}`}
          </span>
        </div>

        {leadsQ.isLoading ? (
          <p className="px-3 py-8 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
            Loading leads…
          </p>
        ) : (leadsQ.data?.leads ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-[var(--radius-xl)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-10 text-center">
            <Users className="size-8 text-[var(--color-muted)]" aria-hidden />
            <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              No leads yet
            </h3>
            <p className="text-[11px] text-[var(--color-muted)]">
              Use the form on the right to capture one.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
            <table className="w-full text-left text-[var(--text-sm)]">
              <thead className="bg-[var(--color-surface-soft)] text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 font-medium">Contact</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {(leadsQ.data?.leads ?? []).map((l) => (
                  <tr
                    key={l.id}
                    className="border-t border-[var(--color-line)] transition-colors hover:bg-[var(--color-surface-soft)]"
                  >
                    <td className="px-3 py-2 font-medium text-[var(--color-ink)]">
                      {l.companyName}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">
                      {l.contactName ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">
                      {l.source ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[var(--color-muted)]">
                      {l.status}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                      {l.score ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <aside>
        <LeadCaptureForm
          onSuccess={() => qc.invalidateQueries({ queryKey: ["crm-leads"] })}
        />
      </aside>
    </div>
  );
}

/* ────────── small extras on the right rail ────────── */

function ForecastTotals({
  total,
  weighted,
  atRisk,
}: {
  total: number;
  weighted: number;
  atRisk: number;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <h3 className="inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
        <TrendingUp className="size-3.5" />
        Pipeline
      </h3>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
            Total
          </p>
          <p className="font-mono text-[var(--text-md)] font-semibold tabular-nums text-[var(--color-ink)]">
            {money(total, { compact: true })}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
            Weighted
          </p>
          <p className="font-mono text-[var(--text-md)] font-semibold tabular-nums text-[var(--color-brand)]">
            {money(weighted, { compact: true })}
          </p>
        </div>
      </div>
      {atRisk > 0 && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-amber,#d78b2f)]/30 bg-[var(--color-amber,#d78b2f)]/5 px-2 py-1 text-[11px] text-[var(--color-amber,#d78b2f)]">
          {numberShort(atRisk)} deal{atRisk === 1 ? "" : "s"} at risk
        </p>
      )}
    </div>
  );
}
