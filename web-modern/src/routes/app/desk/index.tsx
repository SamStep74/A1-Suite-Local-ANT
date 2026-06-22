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
  ChevronDown,
  ChevronLeft,
  Filter,
  Headphones,
  Inbox,
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
  ServiceSlaPoliciesResponseSchema,
  type CreateServiceCaseInput,
  type ServiceCase,
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
      />

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

function SlaPoliciesPanel({
  policies,
  loading,
}: {
  policies: ServiceSlaPolicy[];
  loading?: boolean;
}) {
  const activeCount = policies.filter(isSlaPolicyActive).length;

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
