/**
 * /app/smb-crm/customers — Customer list (Phase 10, Track 5).
 *
 * Pattern A: search + status filter + branch filter, server-side via
 * /api/smb-crm/customers.
 *
 * Mirrors the structure of /app/crm-tube/index.tsx.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Search, Users, X } from "lucide-react";
import { getJson } from "../../../../lib/api/client";
import {
  SmbCrmCustomerStatus,
  SmbCrmListCustomersResponseSchema,
  type SmbCrmCustomer,
  type SmbCrmCustomerStatus as SmbCrmCustomerStatusType,
} from "../../../../lib/api/schemas";
import { cn } from "../../../../lib/utils/cn";

type Search = {
  status?: string;
  branch?: string;
  q?: string;
};

export const Route = createFileRoute("/app/smb-crm/customers/")({
  validateSearch: (raw): Search => ({
    status:
      raw.status === "active" || raw.status === "lead" || raw.status === "inactive"
        ? raw.status
        : undefined,
    branch: typeof raw.branch === "string" ? raw.branch : undefined,
    q: typeof raw.q === "string" ? raw.q : undefined,
  }),
  component: CustomersList,
});

const ARM_TITLE = "Հաճախորդներ · Customers";
const ARM_EMPTY = "Հաճախորդներ դեռ չկան";
const ARM_NO_MATCH = "Ոչ մի հաճախորդ չի գտնվել";

function CustomersList() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const customersQ = useQuery({
    queryKey: ["smb-crm-customers", search],
    queryFn: () =>
      getJson(
        `/api/smb-crm/customers${
          buildQuery({
            status: search.status,
            branchId: search.branch,
            search: search.q,
          })
        }`,
        SmbCrmListCustomersResponseSchema,
      ),
    staleTime: 15_000,
  });

  const customers: SmbCrmCustomer[] = customersQ.data?.customers ?? [];

  const setFilter = (patch: Partial<Search>) =>
    navigate({ search: { ...search, ...patch }, replace: true });

  const grouped = useMemo(() => {
    const byStatus: Record<SmbCrmCustomerStatusType, SmbCrmCustomer[]> = {
      active: [],
      lead: [],
      inactive: [],
    };
    for (const c of customers) byStatus[c.status].push(c);
    return byStatus;
  }, [customers]);

  const isLoading = customersQ.isLoading;
  const isError = customersQ.isError;

  return (
    <div
      className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="smb-crm-customers"
    >
      <PageHeader />
      <FilterBar search={search} onChange={setFilter} />

      {isLoading ? (
        <p className="px-3 py-10 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          Loading customers…
        </p>
      ) : isError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-ruby,#b23a48)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_5%,transparent)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
        >
          Could not load customers.
        </p>
      ) : customers.length === 0 ? (
        <div
          className="flex flex-col items-center gap-2 rounded-[var(--radius-xl)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-10 text-center"
          data-testid="smb-crm-customers-empty"
        >
          <Users className="size-8 text-[var(--color-muted)]" aria-hidden />
          <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
            {search.q ? ARM_NO_MATCH : ARM_EMPTY}
          </h3>
        </div>
      ) : (
        <div className="space-y-4">
          {(["active", "lead", "inactive"] as const).map((s) => {
            const list = grouped[s];
            if (list.length === 0) return null;
            return (
              <section
                key={s}
                data-testid="smb-crm-customers-group"
                data-status={s}
              >
                <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  {s} ({list.length})
                </h2>
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((c) => (
                    <li key={c.id}>
                      <CustomerCard customer={c} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <div>
        <Link
          to="/app/smb-crm"
          className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          Back to onboarding
        </Link>
      </div>
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
            <Users className="size-5" aria-hidden />
          </span>
          <div>
            <h1
              className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]"
              data-testid="smb-crm-customers-h1"
            >
              Customers
            </h1>
            <p
              className="text-[var(--text-sm)] text-[var(--color-muted)]"
              data-testid="smb-crm-customers-subtitle"
            >
              {ARM_TITLE}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}

/* ────────── filter bar ────────── */

function FilterBar({
  search,
  onChange,
}: {
  search: Search;
  onChange: (patch: Partial<Search>) => void;
}) {
  const opts: Array<{ id: SmbCrmCustomerStatusType; label: string }> = [
    { id: "active", label: "Active" },
    { id: "lead", label: "Lead" },
    { id: "inactive", label: "Inactive" },
  ];
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="smb-crm-customers-filter"
    >
      <label className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-[var(--text-sm)]">
        <Search className="size-3.5 text-[var(--color-muted)]" aria-hidden />
        <input
          type="search"
          placeholder="Search…"
          value={search.q ?? ""}
          onChange={(e) => onChange({ q: e.target.value || undefined })}
          className="w-40 bg-transparent text-[var(--text-sm)] outline-none"
          data-testid="smb-crm-customers-search"
        />
        {search.q && (
          <button
            type="button"
            onClick={() => onChange({ q: undefined })}
            className="text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            aria-label="Clear"
          >
            <X className="size-3" />
          </button>
        )}
      </label>

      <div className="flex items-center gap-1" role="tablist" aria-label="Status">
        {opts.map((o) => {
          const active = search.status === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange({ status: active ? undefined : o.id })}
              className={cn(
                "rounded-[var(--radius-pill)] border px-2 py-0.5 text-[11px] font-medium",
                active
                  ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white"
                  : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)]",
              )}
              data-testid="smb-crm-customers-status-chip"
              data-status={o.id}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ────────── card ────────── */

function CustomerCard({ customer }: { customer: SmbCrmCustomer }) {
  return (
    <Link
      to="/app/smb-crm/customers/$customerId"
      params={{ customerId: customer.id }}
      className="block rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 transition-colors hover:bg-[var(--color-surface-soft)]"
      data-customer-id={customer.id}
      data-testid="smb-crm-customer-card"
    >
      <p className="line-clamp-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        {customer.fullName}
      </p>
      {customer.email && (
        <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-muted)]">
          {customer.email}
        </p>
      )}
      <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--color-muted)]">
        <StatusPill status={customer.status} />
        {customer.companyName && <span>{customer.companyName}</span>}
      </div>
    </Link>
  );
}

function StatusPill({ status }: { status: SmbCrmCustomerStatusType }) {
  const palette: Record<SmbCrmCustomerStatusType, string> = {
    active: "bg-[color-mix(in_srgb,var(--color-teal,#0d9488)_15%,transparent)] text-[var(--color-teal,#0d9488)]",
    lead: "bg-[color-mix(in_srgb,var(--color-amber,#d97706)_15%,transparent)] text-[var(--color-amber,#d97706)]",
    inactive: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)] text-[var(--color-muted)]",
  };
  return (
    <span
      className={cn(
        "rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-medium uppercase",
        palette[status],
      )}
    >
      {SmbCrmCustomerStatus.options.find((o) => o === status) ?? status}
    </span>
  );
}

/* ────────── helpers ────────── */

function buildQuery(q: {
  status?: string;
  branchId?: string;
  search?: string;
}): string {
  const parts: string[] = [];
  if (q.status) parts.push(`status=${encodeURIComponent(q.status)}`);
  if (q.branchId) parts.push(`branchId=${encodeURIComponent(q.branchId)}`);
  if (q.search) parts.push(`search=${encodeURIComponent(q.search)}`);
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}
