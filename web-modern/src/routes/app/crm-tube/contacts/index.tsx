/**
 * /app/crm-tube/contacts — Tube contact list.
 *
 * Per the plan §3.4 + docs/phase8-tube/design.md §2.4, this is the
 * per-organisation contact workspace inside the CRM Tube app. Mirrors
 * the shape of /app/inventory (a single table + filter chips + a
 * search bar) but adds the Tube-only bits:
 *
 *   - status filter chips (new / enriched / contacted / qualified /
 *     unqualified / rejected) — multi-select via local state
 *   - a per-row checkbox for bulk-enrich
 *   - a primary "Enrich selected" button that calls
 *     POST /api/crm/tube/contacts/enrich
 *
 * Data:
 *   GET /api/crm/tube/contacts → { contacts: TubeContact[] }
 *   POST /api/crm/tube/contacts/enrich → 200
 *
 * The page is read-only by default — no inline editing. Detail lives
 * at /app/crm-tube/contacts/$contactId. Inbox (messaging) lives at
 * /app/crm-tube/inbox.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  Search,
  Sparkles,
  Users as UsersIcon,
} from "lucide-react";
import { getJson, postJson } from "../../../../lib/api/client";
import {
  TubeListResponseSchema,
  type TubeContact,
} from "../../../../lib/api/schemas";
import { cn } from "../../../../lib/utils/cn";

/* ────────── status palette ────────── */

const STATUS_OPTIONS = [
  "new",
  "enriched",
  "contacted",
  "qualified",
  "unqualified",
  "rejected",
] as const;

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

export const Route = createFileRoute("/app/crm-tube/contacts/")({
  component: ContactsWorkspace,
});

/* ────────── root component ────────── */

function ContactsWorkspace() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [activeStatuses, setActiveStatuses] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [enrichError, setEnrichError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["tube-contacts"],
    queryFn: () =>
      getJson("/api/crm/tube/contacts", TubeListResponseSchema),
    staleTime: 30_000,
  });

  const contacts = (listQ.data?.contacts ?? []) as TubeContact[];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (activeStatuses.size > 0 && !activeStatuses.has(c.status)) {
        return false;
      }
      if (!q) return true;
      return (
        (c.full_name ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.organization_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [contacts, query, activeStatuses]);

  const enrichMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const idempotencyKey = `tube-enrich-${Date.now()}`;
      return postJson(
        "/api/crm/tube/contacts/enrich",
        { contactIds: ids, idempotencyKey },
      );
    },
    onSuccess: () => {
      setEnrichError(null);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["tube-contacts"] });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : "Could not enrich contacts";
      setEnrichError(msg);
    },
  });

  const toggleStatus = (s: string) => {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((c) => c.id)));
    }
  };

  const onEnrich = () => {
    if (selectedIds.size === 0) return;
    enrichMutation.mutate([...selectedIds]);
  };

  const isLoading = listQ.isLoading;
  const isError = listQ.isError;

  return (
    <div
      data-testid="tube-contacts"
      data-entity="tube-contacts-list"
      className="mx-auto max-w-7xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
    >
      <Link
        to="/app"
        className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        Back to today
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="inline-flex items-center gap-2 text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
              <UsersIcon className="size-5" />
              Contacts
            </h1>
            <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
              Կոնտակտներ · Tube
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="tube-contacts-enrich"
              disabled={selectedIds.size === 0 || enrichMutation.isPending}
              onClick={onEnrich}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-[var(--text-sm)] font-semibold transition",
                "bg-[var(--color-accent,#6c5ce7)] text-white hover:opacity-90",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <Sparkles className="size-3.5" />
              Enrich selected
              {selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_OPTIONS.map((s) => {
            const active = activeStatuses.has(s);
            return (
              <button
                key={s}
                type="button"
                data-testid={`tube-status-chip-${s}`}
                onClick={() => toggleStatus(s)}
                className={cn(
                  "rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition",
                  active
                    ? cn(STATUS_TONE[s]?.bg, STATUS_TONE[s]?.fg, "ring-1 ring-current")
                    : "bg-[var(--color-surface-soft)] text-[var(--color-muted)] hover:text-[var(--color-ink)]",
                )}
              >
                {s}
              </button>
            );
          })}
          {activeStatuses.size > 0 && (
            <button
              type="button"
              onClick={() => setActiveStatuses(new Set())}
              className="ml-1 text-[11px] text-[var(--color-muted)] underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </header>

      {isLoading ? (
        <p className="px-3 py-10 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          Loading contacts…
        </p>
      ) : isError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-sm)] border border-[var(--color-ruby,#b23a48)]/30 bg-[var(--color-ruby,#b23a48)]/5 px-2 py-1.5 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
        >
          Could not load contacts.
        </p>
      ) : contacts.length === 0 ? (
        <p
          data-testid="tube-contacts-empty"
          className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-10 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
        >
          No contacts yet. Import a CSV or sync from a connected inbox to
          populate the workspace.
        </p>
      ) : (
        <section className="space-y-2">
          <SearchInput value={query} onChange={setQuery} />
          {enrichError && (
            <p
              role="alert"
              className="rounded-[var(--radius-sm)] border border-[var(--color-ruby,#b23a48)]/30 bg-[var(--color-ruby,#b23a48)]/5 px-2 py-1.5 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
            >
              {enrichError}
            </p>
          )}
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
            <table className="w-full text-left text-[var(--text-sm)]">
              <thead className="bg-[var(--color-surface-soft)] text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                <tr>
                  <th className="w-8 px-3 py-2 font-medium">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      data-testid="tube-contacts-select-all"
                      checked={
                        filtered.length > 0 &&
                        selectedIds.size === filtered.length
                      }
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Organization</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Lead score</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const tone = STATUS_TONE[c.status] ?? {
                    bg: "bg-[var(--color-surface-soft)]",
                    fg: "text-[var(--color-muted)]",
                  };
                  return (
                    <tr
                      key={c.id}
                      data-testid="tube-contact-row"
                      className="cursor-pointer border-t border-[var(--color-line)] hover:bg-[var(--color-surface-soft)]"
                    >
                      <td
                        className="px-3 py-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.full_name ?? c.id}`}
                          data-testid="tube-contact-checkbox"
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggleSelected(c.id)}
                        />
                      </td>
                      <td className="px-3 py-2 text-[var(--color-ink)]">
                        <Link
                          to="/app/crm-tube/contacts/$contactId"
                          params={{ contactId: c.id }}
                          className="hover:underline"
                        >
                          {c.full_name ?? "—"}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-muted)]">
                        {c.email ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-muted)]">
                        {c.organization_name ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            tone.bg,
                            tone.fg,
                          )}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right font-mono tabular-nums",
                          c.lead_score == null
                            ? "text-[var(--color-muted)]"
                            : "text-[var(--color-ink)]",
                        )}
                      >
                        {c.lead_score == null ? "—" : c.lead_score}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-muted)]">
                        {relativeTime(c.updated_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p
                data-testid="tube-contacts-no-match"
                className="px-3 py-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
              >
                No contacts match the current filters.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/* ────────── primitives ────────── */

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-muted)]" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Փնտրել (search name/email)"
        aria-label="Filter contacts"
        data-testid="tube-contacts-search"
        className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] pl-7 pr-2 text-[var(--text-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
      />
    </div>
  );
}

/** Best-effort relative time formatter: "2 days ago", "in 3 hours".
 *  Avoids Intl.RelativeTimeFormat (older test runners are flaky on it). */
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
