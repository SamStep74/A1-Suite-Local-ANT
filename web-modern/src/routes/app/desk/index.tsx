/**
 * /app/desk — Desk list view (tickets).
 *
 * Per the plan §3.2 patterns, this is the Zoho Desk pattern: status
 * filter tabs, hover-row actions, color tags for status / priority, a
 * quick-create form, and a tag-bulk-update affordance.
 *
 * The list re-uses /api/service/console — same envelope as Today /
 * Mission Control — filtered by status client-side (the backend doesn't
 * expose per-status list endpoints yet).
 *
 * Navigation:
 *   - Click a row → /app/desk/$caseId (detail view)
 *   - ⌘K → "create ticket" → quick create sheet (Phase 1.8)
 *   - Filter tabs (All / Open / In-Progress / Waiting / Escalated / Resolved / Closed)
 *
 * Phase 1.6 work-in-this-file: status tabs, hover-row actions, color
 * tags, mass update. The Mass Update (Apply to N) sheet is the only
 * piece deferred — needs a Sheet primitive that ships in Phase 2.
 */
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  CheckCircle2,
  ClipboardCheck,
  Filter,
  Headphones,
  Inbox,
  MapPin,
  Navigation,
  PlayCircle,
  Plus,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react";
import { getJson, postJson, api, type JsonBody } from "../../../lib/api/client";
import {
  CreateServiceCaseInputSchema,
  ServiceCasePriority,
  ServiceCaseSchema,
  ServiceCaseStatus,
  ServiceConsoleSchema,
  ServiceFieldVisitsResponseSchema,
  ServiceSlaPoliciesResponseSchema,
  UpdateServiceFieldVisitTechnicianStatusInputSchema,
  type CreateServiceCaseInput,
  type ServiceCase,
  type ServiceFieldVisit,
  type ServiceFieldVisitTechnicianStatus,
  type ServiceSlaPolicy,
  type ServiceCaseStatus as Status,
} from "../../../lib/api/schemas";
import { HybridBadge } from "../../../components/ui/HybridBadge";
import { cn } from "../../../lib/utils/cn";

export const Route = createFileRoute("/app/desk/")({
  validateSearch: (raw) => {
    // status: "all" | "open" | ... — read from query string so the
    // filter persists on refresh. Defaults to "all".
    // createTicket: "1" — when present, the inline create form auto-opens.
    //   Set by the ⌘K palette's "Create ticket" item.
    const s = typeof raw.status === "string" ? raw.status : "all";
    const ct = raw.createTicket === "1" ? "1" : null;
    return { status: s, createTicket: ct };
  },
  component: DeskList,
});

/* ────────────── constants ────────────── */

const STATUS_TABS: { value: "all" | Status; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "in-progress", label: "In-Progress" },
  { value: "waiting-customer", label: "Waiting" },
  { value: "escalated", label: "Escalated" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const CHANNELS = ["WhatsApp", "Telegram", "Email", "Phone", "Manual"];
const SLA_POLICY_CHANNELS = ["", ...CHANNELS];
const FIELD_VISIT_PREVIEW_LIMIT = 4;
const MY_FIELD_VISIT_PREVIEW_LIMIT = 5;
const VISIT_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const PRIORITY_TONE: Record<string, { bg: string; fg: string; ring: string }> = {
  high: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
    ring: "ring-[color-mix(in_srgb,var(--color-tag-red)_40%,transparent)]",
  },
  medium: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
    ring: "ring-[color-mix(in_srgb,var(--color-tag-orange)_40%,transparent)]",
  },
  low: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    ring: "ring-[color-mix(in_srgb,var(--color-tag-green)_40%,transparent)]",
  },
};

const STATUS_TONE: Record<Status, { bg: string; fg: string }> = {
  open: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
  },
  "in-progress": {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-violet)_15%,transparent)]",
    fg: "text-[var(--color-tag-violet)]",
  },
  "waiting-customer": {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-yellow)_15%,transparent)]",
    fg: "text-[var(--color-tag-yellow)]",
  },
  escalated: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
  },
  resolved: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
  },
  closed: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-teal)_15%,transparent)]",
    fg: "text-[var(--color-tag-teal)]",
  },
};

/* ────────────── component ────────────── */

function DeskList() {
  const search = Route.useSearch();
  const status = (search.status as "all" | Status) || "all";
  const createTicketFlag = search.createTicket === "1";
  const navigate = Route.useNavigate();
  const qc = useQueryClient();

  // When the ⌘K palette sets ?createTicket=1, auto-open the inline
  // create form. Strip the param so refresh doesn't re-trigger.
  useEffect(() => {
    if (createTicketFlag) {
      navigate({ search: { status, createTicket: null }, replace: true });
    }
  }, [createTicketFlag, status, navigate]);

  const consoleQuery = useQuery({
    queryKey: ["service", "console"],
    queryFn: () => getJson("/api/service/console", ServiceConsoleSchema),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  const consoleSlaPolicies = consoleQuery.data?.slaPolicies;
  const slaPoliciesQuery = useQuery({
    queryKey: ["service", "sla-policies"],
    queryFn: () => getJson("/api/service/sla-policies", ServiceSlaPoliciesResponseSchema),
    enabled: consoleQuery.isSuccess && consoleSlaPolicies == null,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 30_000,
  });

  const cases = consoleQuery.data?.cases ?? [];
  const customers = consoleQuery.data?.customers ?? [];
  const agents = consoleQuery.data?.agents ?? [];
  const slaPolicies = consoleSlaPolicies ?? slaPoliciesQuery.data?.policies ?? [];
  const consoleFieldVisits = consoleQuery.data?.fieldVisits;
  const fieldVisitsQuery = useQuery({
    queryKey: ["service", "field-visits"],
    queryFn: () => getJson("/api/service/field-visits", ServiceFieldVisitsResponseSchema),
    enabled: consoleQuery.isSuccess && consoleFieldVisits == null,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 30_000,
  });
  const fieldVisits = consoleFieldVisits ?? fieldVisitsQuery.data?.visits ?? [];
  const myFieldVisitsQuery = useQuery({
    queryKey: ["service", "my-field-visits"],
    queryFn: () => getJson("/api/service/my-field-visits", ServiceFieldVisitsResponseSchema),
    enabled: consoleQuery.isSuccess,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 30_000,
  });
  const myFieldVisits = myFieldVisitsQuery.data?.visits ?? [];
  const invalidateVisitQueries = () => {
    void qc.invalidateQueries({ queryKey: ["service", "console"] });
    void qc.invalidateQueries({ queryKey: ["service", "field-visits"] });
    void qc.invalidateQueries({ queryKey: ["service", "my-field-visits"] });
  };

  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    let list = cases;
    if (status !== "all") list = list.filter((c) => c.status === status);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.subject.toLowerCase().includes(q) ||
          c.customerName.toLowerCase().includes(q) ||
          c.caseNumber.toLowerCase().includes(q),
      );
    }
    return list;
  }, [cases, status, query]);

  // Counter per status — drives the "12" badge on each tab.
  const countByStatus = useMemo(() => {
    const map: Record<string, number> = { all: cases.length };
    for (const c of cases) map[c.status] = (map[c.status] ?? 0) + 1;
    return map;
  }, [cases]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader count={visible.length} loading={consoleQuery.isLoading} />
      <SlaPoliciesPanel
        policies={slaPolicies}
        loading={consoleQuery.isLoading || slaPoliciesQuery.isLoading}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ["service", "console"] });
          void qc.invalidateQueries({ queryKey: ["service", "sla-policies"] });
        }}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <FieldVisitsPanel
          visits={fieldVisits}
          loading={consoleQuery.isLoading || fieldVisitsQuery.isLoading}
          unavailable={fieldVisitsQuery.isError && consoleFieldVisits == null}
        />
        <MyVisitsPanel
          visits={myFieldVisits}
          loading={consoleQuery.isLoading || myFieldVisitsQuery.isLoading}
          unavailable={myFieldVisitsQuery.isError}
          onStatusUpdated={invalidateVisitQueries}
        />
      </div>

      {/* Filter row — search + tabs + (Phase 2: mass-update) */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-muted)]"
            aria-hidden
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search subject, customer, or AO-CASE-…"
            aria-label="Search tickets"
            className={cn(
              "h-8 w-full rounded-[var(--radius-md)] border border-[var(--color-line)]",
              "bg-[var(--color-surface)] pl-7 pr-2 text-[var(--text-sm)]",
              "text-[var(--color-ink)] placeholder:text-[var(--color-muted)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
            )}
          />
        </div>
        <div className="flex items-center gap-1">
          <Filter
            className="size-3.5 text-[var(--color-muted)]"
            aria-hidden
          />
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            Filter
          </span>
        </div>
      </div>

      {/* Status tabs — Zoho pattern. Clicking a tab updates the URL. */}
      <nav
        className="flex flex-wrap gap-1 border-b border-[var(--color-line)]"
        aria-label="Filter by status"
      >
        {STATUS_TABS.map((tab) => {
          const active = status === tab.value;
          const count = countByStatus[tab.value] ?? 0;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() =>
                navigate({ search: { status: tab.value, createTicket: null }, replace: true })
              }
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 border-b-2 px-2 py-1.5",
                "text-[var(--text-sm)] font-medium",
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
                {count}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Ticket table */}
      {consoleQuery.isLoading ? (
        <p className="px-3 py-8 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          Loading tickets…
        </p>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[var(--radius-xl)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-10 text-center">
          <Inbox className="size-8 text-[var(--color-muted)]" aria-hidden />
          <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
            No tickets in this view
          </h3>
          <p className="text-[11px] text-[var(--color-muted)]">
            {query
              ? "Try a different search term."
              : "All clear. Create one below or via ⌘K → 'create ticket'."}
          </p>
        </div>
      ) : (
        <TicketTable
          tickets={visible}
          agents={agents}
          onMutated={() => qc.invalidateQueries({ queryKey: ["service", "console"] })}
        />
      )}

      {/* Quick-create form (inline). ⌘K shortcut mirrors it. */}
      <CreateTicketInline
        customers={customers}
        disabled={consoleQuery.isLoading}
        defaultOpen={createTicketFlag}
        onCreated={() => qc.invalidateQueries({ queryKey: ["service", "console"] })}
      />
    </div>
  );
}

function FieldVisitsPanel({
  visits,
  loading,
  unavailable,
}: {
  visits: ServiceFieldVisit[];
  loading?: boolean;
  unavailable?: boolean;
}) {
  const scheduledCount = visits.filter((visit) => normalizeVisitStatus(visit.status) === "scheduled").length;
  const completedCount = visits.filter((visit) => normalizeVisitStatus(visit.status) === "completed").length;
  const previewVisits = visits.slice(0, FIELD_VISIT_PREVIEW_LIMIT);
  const extraCount = Math.max(0, visits.length - previewVisits.length);

  return (
    <section
      className={cn(
        "rounded-[var(--radius-xl)] border border-[var(--color-line)]",
        "bg-[var(--color-surface)] p-3",
      )}
      aria-label="Field visit evidence"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
            <CalendarClock className="size-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              Field Visits
            </h2>
            <p className="text-[11px] text-[var(--color-muted)]">
              Worksheet evidence from service appointments
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-left sm:min-w-64 sm:text-right">
          <SlaSummaryMetric label="Visits" value={loading ? "..." : String(visits.length)} />
          <SlaSummaryMetric label="Scheduled" value={loading ? "..." : String(scheduledCount)} />
          <SlaSummaryMetric label="Completed" value={loading ? "..." : String(completedCount)} />
        </dl>
      </div>

      {loading && visits.length === 0 ? (
        <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[11px] text-[var(--color-muted)]">
          Loading field visits...
        </p>
      ) : unavailable ? (
        <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[11px] text-[var(--color-muted)]">
          Field visit evidence is unavailable.
        </p>
      ) : visits.length === 0 ? (
        <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[11px] text-[var(--color-muted)]">
          No field visits scheduled.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
          {previewVisits.map((visit) => (
            <FieldVisitRow key={visit.id} visit={visit} />
          ))}
          {extraCount > 0 && (
            <li className="py-2 text-[11px] text-[var(--color-muted)]">
              +{extraCount} more field {extraCount === 1 ? "visit" : "visits"}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function FieldVisitRow({ visit }: { visit: ServiceFieldVisit }) {
  const status = normalizeVisitStatus(visit.status);
  const statusTone = FIELD_VISIT_STATUS_TONE[status] ?? FIELD_VISIT_STATUS_TONE.default;
  const caseLabel = visit.caseNumber ?? visit.subject ?? visit.caseId;
  const customerLabel = visit.customerName ?? visit.customerId;
  const assignedLabel = visit.assignedUserName ?? visit.assignedUserId ?? "Unassigned";

  return (
    <li className="grid gap-2 py-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(10rem,0.9fr)_minmax(10rem,1fr)] lg:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
            {caseLabel}
          </span>
          <span
            className={cn(
              "rounded-[var(--radius-sm)] px-1.5 py-0.5",
              "text-[10px] font-semibold uppercase tracking-wider",
              statusTone.bg,
              statusTone.fg,
            )}
          >
            {visit.status}
          </span>
        </div>
        {visit.subject && visit.subject !== caseLabel && (
          <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-muted)]">
            {visit.subject}
          </p>
        )}
        <p className="mt-1 line-clamp-1 text-[11px] text-[var(--color-muted)]">
          {customerLabel} · {assignedLabel}
        </p>
      </div>

      <div className="space-y-1 text-[11px] text-[var(--color-muted)]">
        <p className="flex items-center gap-1.5">
          <CalendarClock className="size-3.5 shrink-0" aria-hidden />
          <span>{formatVisitWindow(visit.scheduledStartAt, visit.scheduledEndAt)}</span>
        </p>
        <p className="flex items-center gap-1.5">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span className="line-clamp-1">{visit.location}</span>
        </p>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-[var(--color-ink)]">
        <ClipboardCheck className="mt-0.5 size-3.5 shrink-0 text-[var(--color-muted)]" aria-hidden />
        <span className="line-clamp-2">{visit.worksheetSummary}</span>
      </p>
    </li>
  );
}

type TechnicianVisitMutationInput = {
  visitId: string;
  status: ServiceFieldVisitTechnicianStatus;
  worksheetSummary?: string;
};

const TECHNICIAN_VISIT_ACTIONS: { status: ServiceFieldVisitTechnicianStatus; label: string }[] = [
  { status: "en-route", label: "En route" },
  { status: "in-progress", label: "Start" },
  { status: "completed", label: "Complete" },
];

function MyVisitsPanel({
  visits,
  loading,
  unavailable,
  onStatusUpdated,
}: {
  visits: ServiceFieldVisit[];
  loading?: boolean;
  unavailable?: boolean;
  onStatusUpdated: () => void;
}) {
  const activeCount = visits.filter((visit) => !isTerminalVisitStatus(visit.status)).length;
  const previewVisits = visits.slice(0, MY_FIELD_VISIT_PREVIEW_LIMIT);
  const extraCount = Math.max(0, visits.length - previewVisits.length);

  return (
    <section
      className={cn(
        "rounded-[var(--radius-xl)] border border-[var(--color-line)]",
        "bg-[var(--color-surface)] p-3",
      )}
      aria-label="My assigned field visits"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
            <Navigation className="size-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              My Visits
            </h2>
            <p className="text-[11px] text-[var(--color-muted)]">
              Technician field workflow
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-left sm:min-w-40 sm:text-right">
          <SlaSummaryMetric label="Assigned" value={loading ? "..." : String(visits.length)} />
          <SlaSummaryMetric label="Active" value={loading ? "..." : String(activeCount)} />
        </dl>
      </div>

      {loading && visits.length === 0 ? (
        <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[11px] text-[var(--color-muted)]">
          Loading assigned visits...
        </p>
      ) : unavailable ? (
        <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[11px] text-[var(--color-muted)]">
          Assigned visits are unavailable.
        </p>
      ) : visits.length === 0 ? (
        <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[11px] text-[var(--color-muted)]">
          No assigned field visits.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
          {previewVisits.map((visit) => (
            <MyVisitRow key={visit.id} visit={visit} onStatusUpdated={onStatusUpdated} />
          ))}
          {extraCount > 0 && (
            <li className="py-2 text-[11px] text-[var(--color-muted)]">
              +{extraCount} more assigned {extraCount === 1 ? "visit" : "visits"}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function MyVisitRow({
  visit,
  onStatusUpdated,
}: {
  visit: ServiceFieldVisit;
  onStatusUpdated: () => void;
}) {
  const [worksheetSummary, setWorksheetSummary] = useState(visit.worksheetSummary);
  const normalizedStatus = normalizeVisitStatus(visit.status);
  const statusTone = FIELD_VISIT_STATUS_TONE[normalizedStatus] ?? FIELD_VISIT_STATUS_TONE.default;
  const caseLabel = visit.caseNumber ?? visit.subject ?? visit.caseId;
  const customerLabel = visit.customerName ?? visit.customerId;
  const terminal = isTerminalVisitStatus(visit.status);
  const updateMut = useMutation({
    mutationFn: async ({ visitId, status, worksheetSummary: nextSummary }: TechnicianVisitMutationInput) => {
      const trimmedSummary = nextSummary?.trim();
      const payload = UpdateServiceFieldVisitTechnicianStatusInputSchema.parse({
        status,
        ...(trimmedSummary ? { worksheetSummary: trimmedSummary } : {}),
      });
      return postJson(`/api/service/field-visits/${visitId}/technician-status`, payload);
    },
    onSuccess: onStatusUpdated,
  });

  useEffect(() => {
    setWorksheetSummary(visit.worksheetSummary);
  }, [visit.id, visit.worksheetSummary]);

  return (
    <li className="grid gap-2 py-2 xl:grid-cols-[minmax(0,1fr)_minmax(9rem,0.75fr)_minmax(12rem,1fr)] xl:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
            {caseLabel}
          </span>
          <span
            className={cn(
              "rounded-[var(--radius-sm)] px-1.5 py-0.5",
              "text-[10px] font-semibold uppercase tracking-wider",
              statusTone.bg,
              statusTone.fg,
            )}
          >
            {visit.status}
          </span>
        </div>
        {visit.subject && visit.subject !== caseLabel && (
          <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-muted)]">
            {visit.subject}
          </p>
        )}
        <p className="mt-1 line-clamp-1 text-[11px] text-[var(--color-muted)]">
          {customerLabel}
        </p>
      </div>

      <div className="space-y-1 text-[11px] text-[var(--color-muted)]">
        <p className="flex items-center gap-1.5">
          <CalendarClock className="size-3.5 shrink-0" aria-hidden />
          <span>{formatVisitWindow(visit.scheduledStartAt, visit.scheduledEndAt)}</span>
        </p>
        <p className="flex items-center gap-1.5">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span className="line-clamp-1">{visit.location}</span>
        </p>
      </div>

      <div className="min-w-0">
        <label>
          <span className="sr-only">Worksheet summary for {caseLabel}</span>
          <textarea
            value={worksheetSummary}
            onChange={(event) => setWorksheetSummary(event.target.value)}
            disabled={terminal || updateMut.isPending}
            rows={2}
            className={cn(
              "h-14 w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-line)]",
              "bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-ink)]",
              "placeholder:text-[var(--color-muted)] disabled:bg-[var(--color-surface-soft)]",
            )}
            placeholder="Worksheet summary"
          />
        </label>
        <div className="mt-1 flex flex-wrap gap-1">
          {TECHNICIAN_VISIT_ACTIONS.map((action) => {
            const disabled =
              updateMut.isPending || !canApplyTechnicianStatus(visit.status, action.status);
            return (
              <button
                key={action.status}
                type="button"
                disabled={disabled}
                onClick={() =>
                  updateMut.mutate({
                    visitId: visit.id,
                    status: action.status,
                    worksheetSummary,
                  })
                }
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] px-2",
                  "text-[11px] font-medium",
                  disabled
                    ? "bg-[var(--color-surface-soft)] text-[var(--color-muted)] opacity-60"
                    : "bg-[var(--color-brand)] text-white hover:opacity-90",
                )}
              >
                <TechnicianActionIcon status={action.status} />
                {updateMut.isPending && updateMut.variables?.status === action.status
                  ? "Saving"
                  : action.label}
              </button>
            );
          })}
        </div>
        {updateMut.isError && (
          <p className="mt-1 text-[11px] text-[var(--color-ruby)]">
            {updateMut.error instanceof Error ? updateMut.error.message : "Update failed"}
          </p>
        )}
      </div>
    </li>
  );
}

function TechnicianActionIcon({ status }: { status: ServiceFieldVisitTechnicianStatus }) {
  if (status === "en-route") return <Navigation className="size-3" aria-hidden />;
  if (status === "in-progress") return <PlayCircle className="size-3" aria-hidden />;
  return <CheckCircle2 className="size-3" aria-hidden />;
}

const FIELD_VISIT_STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  scheduled: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
  },
  "en-route": {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
  },
  "in-progress": {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-violet)_15%,transparent)]",
    fg: "text-[var(--color-tag-violet)]",
  },
  completed: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
  },
  cancelled: {
    bg: "bg-[var(--color-surface-soft)]",
    fg: "text-[var(--color-muted)]",
  },
  default: {
    bg: "bg-[var(--color-surface-soft)]",
    fg: "text-[var(--color-muted)]",
  },
};

function normalizeVisitStatus(status: string): string {
  return status.trim().toLowerCase();
}

function isTerminalVisitStatus(status: string): boolean {
  const normalized = normalizeVisitStatus(status);
  return normalized === "completed" || normalized === "cancelled" || normalized === "canceled";
}

function canApplyTechnicianStatus(
  currentStatus: string,
  nextStatus: ServiceFieldVisitTechnicianStatus,
): boolean {
  const current = normalizeVisitStatus(currentStatus);
  if (isTerminalVisitStatus(current)) return false;
  if (nextStatus === "en-route") return current !== "en-route" && current !== "in-progress";
  if (nextStatus === "in-progress") return current === "en-route";
  return current === "in-progress";
}

function formatVisitWindow(startAt: string, endAt: string): string {
  const start = formatVisitDateTime(startAt);
  const end = formatVisitDateTime(endAt);

  if (start && end) return `${start} - ${end}`;
  return start || end || "Unscheduled";
}

function formatVisitDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value.trim();
  return VISIT_TIME_FORMATTER.format(new Date(timestamp));
}

function SlaPoliciesPanel({
  policies,
  loading,
  onSaved,
}: {
  policies: ServiceSlaPolicy[];
  loading?: boolean;
  onSaved: () => void;
}) {
  const activeCount = policies.filter(isSlaPolicyActive).length;
  const [form, setForm] = useState({
    name: "",
    priority: "high",
    channel: "",
    responseMinutes: "60",
    resolutionMinutes: "240",
    active: true,
  });
  const saveMut = useMutation({
    mutationFn: async () => {
      return postJson("/api/service/sla-policies", {
        name: form.name.trim(),
        priority: form.priority,
        channel: form.channel,
        responseMinutes: Number(form.responseMinutes),
        resolutionMinutes: Number(form.resolutionMinutes),
        active: form.active,
      });
    },
    onSuccess: () => {
      setForm({
        name: "",
        priority: "high",
        channel: "",
        responseMinutes: "60",
        resolutionMinutes: "240",
        active: true,
      });
      onSaved();
    },
  });

  return (
    <section
      className={cn(
        "rounded-[var(--radius-xl)] border border-[var(--color-line)]",
        "bg-[var(--color-surface)] p-3",
      )}
      aria-label="SLA configuration evidence"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
            <ShieldCheck className="size-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              SLA Policies
            </h2>
            <p className="text-[11px] text-[var(--color-muted)]">
              Response and resolution targets by priority and channel
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-left sm:min-w-44 sm:text-right">
          <SlaSummaryMetric label="Policies" value={loading ? "…" : String(policies.length)} />
          <SlaSummaryMetric label="Active" value={loading ? "…" : String(activeCount)} />
        </dl>
      </div>

      {loading && policies.length === 0 ? (
        <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[11px] text-[var(--color-muted)]">
          Loading SLA policies…
        </p>
      ) : policies.length === 0 ? (
        <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[11px] text-[var(--color-muted)]">
          No SLA policies configured.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
          {policies.map((policy) => {
            const active = isSlaPolicyActive(policy);
            const priorityKey = policy.priority.toLowerCase();
            return (
              <li
                key={policy.id}
                className="grid gap-2 py-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(7rem,0.7fr)_minmax(7rem,0.7fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
                    {policy.name}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span
                      className={cn(
                        "rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        PRIORITY_TONE[priorityKey]?.bg ?? "bg-[var(--color-surface-soft)]",
                        PRIORITY_TONE[priorityKey]?.fg ?? "text-[var(--color-muted)]",
                      )}
                    >
                      {policy.priority}
                    </span>
                    <span className="rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                      {formatSlaPolicyChannel(policy.channel)}
                    </span>
                  </div>
                </div>
                <SlaDuration label="Response" minutes={policy.responseMinutes} />
                <SlaDuration label="Resolution" minutes={policy.resolutionMinutes} />
                <span
                  className={cn(
                    "w-fit rounded-[var(--radius-sm)] px-1.5 py-0.5",
                    "text-[10px] font-semibold uppercase tracking-wider",
                    active
                      ? "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] text-[var(--color-tag-green)]"
                      : "bg-[var(--color-surface-soft)] text-[var(--color-muted)]",
                  )}
                >
                  {active ? "active" : "inactive"}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          saveMut.mutate();
        }}
        className="mt-3 grid grid-cols-1 gap-2 border-t border-[var(--color-line)] pt-3 md:grid-cols-[minmax(10rem,1.4fr)_minmax(7rem,0.7fr)_minmax(7rem,0.7fr)_minmax(6rem,0.5fr)_minmax(6rem,0.5fr)_auto_auto]"
      >
        <label>
          <span className="sr-only">Policy name</span>
          <input
            required
            minLength={3}
            maxLength={120}
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Policy name"
            className="h-8 w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)]"
          />
        </label>
        <label>
          <span className="sr-only">Priority</span>
          <select
            value={form.priority}
            onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
            className="h-8 w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)]"
          >
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Channel</span>
          <select
            value={form.channel}
            onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value }))}
            className="h-8 w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)]"
          >
            {SLA_POLICY_CHANNELS.map((channel) => (
              <option key={channel || "any"} value={channel}>
                {channel || "Any channel"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Response minutes</span>
          <input
            required
            min={1}
            max={43200}
            type="number"
            value={form.responseMinutes}
            onChange={(event) => setForm((current) => ({ ...current, responseMinutes: event.target.value }))}
            aria-label="Response minutes"
            className="h-8 w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)]"
          />
        </label>
        <label>
          <span className="sr-only">Resolution minutes</span>
          <input
            required
            min={1}
            max={43200}
            type="number"
            value={form.resolutionMinutes}
            onChange={(event) => setForm((current) => ({ ...current, resolutionMinutes: event.target.value }))}
            aria-label="Resolution minutes"
            className="h-8 w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)]"
          />
        </label>
        <label className="inline-flex h-8 items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
            className="size-3.5 accent-[var(--color-brand)]"
          />
          Active
        </label>
        <button
          type="submit"
          disabled={saveMut.isPending || loading}
          className="inline-flex h-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-[var(--text-sm)] font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saveMut.isPending ? "Saving…" : "Save"}
        </button>
        {saveMut.isError && (
          <p className="text-[11px] text-[var(--color-ruby)] md:col-span-7">
            {saveMut.error instanceof Error ? saveMut.error.message : "Save failed"}
          </p>
        )}
      </form>
    </section>
  );
}

function SlaSummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
        {label}
      </dt>
      <dd className="font-mono text-[var(--text-sm)] text-[var(--color-ink)]">
        {value}
      </dd>
    </div>
  );
}

function SlaDuration({ label, minutes }: { label: string; minutes: number }) {
  return (
    <div>
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
        {label}
      </span>
      <span className="font-mono text-[var(--text-sm)] text-[var(--color-ink)]">
        {formatSlaMinutes(minutes)}
      </span>
    </div>
  );
}

function isSlaPolicyActive(policy: ServiceSlaPolicy): boolean {
  return policy.active === true || (typeof policy.active === "number" && policy.active !== 0);
}

function formatSlaPolicyChannel(channel: string): string {
  return channel.trim() || "Any channel";
}

function formatSlaMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) return "—";
  const wholeMinutes = Math.max(0, Math.round(minutes));
  if (wholeMinutes < 60) return `${wholeMinutes}m`;
  const hours = wholeMinutes / 60;
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${wholeMinutes}m`;
}

/* ────────────── subcomponents ────────────── */

function PageHeader({ count, loading }: { count: number; loading?: boolean }) {
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
            <Headphones className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
              Desk
            </h1>
            <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
              Աջակցություն — Tickets · customer 360
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HybridBadge kind="agent" />
          <span className="font-mono text-[11px] text-[var(--color-muted)]">
            {loading ? "…" : `${count} visible`}
          </span>
        </div>
      </div>
    </header>
  );
}

function TicketTable({
  tickets,
  agents,
  onMutated,
}: {
  tickets: ServiceCase[];
  agents: { id: string; name: string; role?: string | null | undefined }[];
  onMutated: () => void;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line)]",
        "bg-[var(--color-surface)]",
      )}
    >
      <table className="w-full text-left">
        <thead className="bg-[var(--color-surface-soft)] text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          <tr>
            <Th>Case</Th>
            <Th>Subject</Th>
            <Th>Customer</Th>
            <Th>Status</Th>
            <Th>Priority</Th>
            <Th>Channel</Th>
            <Th>Owner</Th>
            <Th>SLA</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)] text-[var(--text-sm)]">
          {tickets.map((t) => (
            <TicketRow
              key={t.id}
              ticket={t}
              agents={agents}
              onMutated={onMutated}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-2 py-1.5 font-semibold" scope="col">
      {children}
    </th>
  );
}

function TicketRow({
  ticket: t,
  agents,
  onMutated,
}: {
  ticket: ServiceCase;
  agents: { id: string; name: string; role?: string | null | undefined }[];
  onMutated: () => void;
}) {
  const updateMut = useMutation({
    mutationFn: async (patch: JsonBody) => {
      return api(
        `/api/service/cases/${t.id}`,
        null,
        { method: "PATCH", body: patch } as unknown as Parameters<typeof api>[2],
      );
    },
    onSuccess: onMutated,
  });

  return (
    <tr className="group hover:bg-[var(--color-surface-soft)]">
      <td className="px-2 py-1.5 font-mono text-[11px] text-[var(--color-muted)]">
        <Link
          to="/app/desk/$caseId"
          params={{ caseId: t.id }}
          className="hover:text-[var(--color-ink)]"
        >
          {t.caseNumber}
        </Link>
      </td>
      <td className="px-2 py-1.5">
        <Link
          to="/app/desk/$caseId"
          params={{ caseId: t.id }}
          className="line-clamp-1 text-[var(--color-ink)] hover:text-[var(--color-brand)]"
        >
          {t.subject}
        </Link>
      </td>
      <td className="px-2 py-1.5 text-[var(--color-muted)]">{t.customerName}</td>
      <td className="px-2 py-1.5">
        <span
          className={cn(
            "rounded-[var(--radius-sm)] px-1.5 py-0.5",
            "text-[10px] font-semibold uppercase tracking-wider",
            STATUS_TONE[t.status].bg,
            STATUS_TONE[t.status].fg,
          )}
        >
          {t.status}
        </span>
      </td>
      <td className="px-2 py-1.5">
        <span
          className={cn(
            "rounded-[var(--radius-sm)] px-1.5 py-0.5",
            "text-[10px] font-semibold uppercase tracking-wider",
            PRIORITY_TONE[t.priority]?.bg ?? "bg-[var(--color-surface-soft)]",
            PRIORITY_TONE[t.priority]?.fg ?? "text-[var(--color-ink)]",
          )}
        >
          {t.priority}
        </span>
      </td>
      <td className="px-2 py-1.5 text-[11px] text-[var(--color-muted)]">
        {t.channel}
      </td>
      <td className="px-2 py-1.5 text-[11px] text-[var(--color-muted)]">
        {t.ownerName ?? "—"}
      </td>
      <td className="px-2 py-1.5">
        {t.slaStatus && t.slaStatus !== "on-track" ? (
          <span
            className={cn(
              "rounded-[var(--radius-sm)] px-1.5 py-0.5",
              "text-[10px] font-semibold uppercase tracking-wider",
              t.slaStatus === "breached"
                ? "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)] text-[var(--color-tag-red)]"
                : "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)] text-[var(--color-tag-orange)]",
            )}
          >
            {t.slaStatus}
          </span>
        ) : (
          <span className="text-[10px] text-[var(--color-muted)]">on-track</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const parsed = ServiceCaseStatus.safeParse(v);
              if (parsed.success) {
                updateMut.mutate({ status: parsed.data });
              }
              e.currentTarget.value = "";
            }}
            disabled={updateMut.isPending}
            aria-label="Move to status"
            className="h-6 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-1 text-[11px] text-[var(--color-ink)]"
          >
            <option value="">Move…</option>
            {(["open", "in-progress", "waiting-customer", "resolved", "closed"] as Status[])
              .filter((s) => s !== t.status)
              .map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
          </select>
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              updateMut.mutate({ ownerUserId: v });
              e.currentTarget.value = "";
            }}
            disabled={updateMut.isPending}
            aria-label="Assign owner"
            className="h-6 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-1 text-[11px] text-[var(--color-ink)]"
          >
            <option value="">Assign…</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </td>
    </tr>
  );
}

function CreateTicketInline({
  customers,
  disabled,
  defaultOpen,
  onCreated,
}: {
  customers: { id: string; name: string }[];
  disabled?: boolean;
  defaultOpen?: boolean;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [form, setForm] = useState<CreateServiceCaseInput>({
    customerId: "",
    subject: "",
    priority: "medium",
    channel: "Manual",
  });

  // React to external "open" requests (the ⌘K palette sets
  // ?createTicket=1, the parent strips it, and we open here).
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  const createMut = useMutation({
    mutationFn: async () => {
      const parsed = CreateServiceCaseInputSchema.parse(form);
      return postJson("/api/service/cases", parsed, ServiceCaseSchema);
    },
    onSuccess: () => {
      setForm({ customerId: "", subject: "", priority: "medium", channel: "Manual" });
      setOpen(false);
      onCreated();
    },
  });

  if (customers.length === 0) {
    return (
      <p className="text-[11px] text-[var(--color-muted)]">
        Add a customer first to create tickets.
      </p>
    );
  }

  return (
    <section
      className={cn(
        "rounded-[var(--radius-xl)] border border-[var(--color-line)]",
        "bg-[var(--color-surface)]",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          <Plus className="size-3.5" aria-hidden />
          New ticket
        </span>
        {open ? (
          <ChevronDown className="size-3.5 text-[var(--color-muted)]" aria-hidden />
        ) : (
          <ChevronLeft className="size-3.5 rotate-90 text-[var(--color-muted)]" aria-hidden />
        )}
      </button>
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMut.mutate();
          }}
          className="grid grid-cols-1 gap-2 border-t border-[var(--color-line)] p-3 sm:grid-cols-5"
        >
          <label className="sm:col-span-2">
            <span className="sr-only">Customer</span>
            <select
              required
              value={form.customerId}
              onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))}
              disabled={disabled}
              className="h-8 w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)]"
            >
              <option value="">— pick customer —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="sm:col-span-2">
            <span className="sr-only">Subject</span>
            <input
              required
              minLength={4}
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              placeholder="Subject"
              disabled={disabled}
              className="h-8 w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)]"
            />
          </label>
          <div className="flex items-center gap-1">
            <select
              value={form.priority}
              onChange={(e) => {
                const parsed = ServiceCasePriority.safeParse(e.target.value);
                if (parsed.success) {
                  setForm((f) => ({ ...f, priority: parsed.data }));
                }
              }}
              disabled={disabled}
              aria-label="Priority"
              className="h-8 flex-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)]"
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
            <select
              value={form.channel}
              onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
              disabled={disabled}
              aria-label="Channel"
              className="h-8 flex-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)]"
            >
              {CHANNELS.map((ch) => (
                <option key={ch} value={ch}>
                  {ch}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={disabled || createMut.isPending}
              className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-2 text-[var(--text-sm)] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              <Send className="size-3" aria-hidden />
              {createMut.isPending ? "Creating…" : "Create"}
            </button>
          </div>
          {createMut.isError && (
            <p className="sm:col-span-5 text-[11px] text-[var(--color-ruby)]">
              {createMut.error instanceof Error ? createMut.error.message : "Create failed"}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

void notFound;
