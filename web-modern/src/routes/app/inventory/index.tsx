/**
 * /app/inventory — Inventory workspace: catalog | stock | moves.
 *
 * Per the plan §3.4, Inventory maps to Zoho Inventory. The home
 * route is a view-switcher over three surfaces:
 *
 *   - **Catalog** — every catalog item, with a stock-at-a-glance
 *     column. Click a row → /app/inventory/$itemId.
 *   - **Stock** — every stock balance (one row per (item, location)
 *     pair), with a status column that buckets each row as
 *     out / low / healthy. Click a row → item detail.
 *   - **Moves** — recent stock moves (receipt, transfer, delivery,
 *     adjustment, scrap), newest first. Read-only; the StockMoveForm
 *     lives on the item detail page (Phase 2.5).
 *
 * URL state:
 *   ?view=catalog | stock | moves
 *   ?status=…        (per-view filter — see TYPE_FILTERS)
 *
 * The view switcher is a controlled component (the parent owns the
 * URL). The filter tabs switch in URL state too — they aren't
 * separate routes, they collapse the same data the list shows.
 *
 * Data:
 *   - /api/catalog/items  (CatalogItemsResponse)
 *   - /api/inventory/stock + /api/inventory/moves
 *     (each returns arrays; locations come on the stock response)
 *
 * The same Fastify proxy as the rest of the workspace.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  Box,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  PackageOpen,
  Search,
  Trash2,
  Wrench,
} from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  CatalogItemsResponseSchema,
  StockResponseSchema,
  StockMovesResponseSchema,
  type CatalogItem,
  type StockBalance,
  type StockMove,
  type StockMoveType,
} from "../../../lib/api/schemas";
import { ViewSwitcher } from "../../../components/view-switcher/ViewSwitcher";
import { HybridBadge } from "../../../components/ui/HybridBadge";
import { money, numberShort } from "../../../lib/utils/money";
import { cn } from "../../../lib/utils/cn";
import {
  classifyStockLevel,
  summariseItemStock,
  totalStockByItemId,
  type StockHealth,
} from "../../../lib/inventory/status";

/* ────────── typed URL search ────────── */

type View = "catalog" | "stock" | "moves";

const STOCK_HEALTH_VALUES = ["out", "low", "healthy", "all", "unknown"] as const;
type StockHealthFilter = (typeof STOCK_HEALTH_VALUES)[number];

const MOVE_TYPES = [
  "inbound",
  "outbound",
  "transfer",
  "receipt",
  "delivery",
  "adjustment",
  "scrap",
  "return",
] as const;
type MoveTypeFilter = "all" | (typeof MOVE_TYPES)[number];

export const Route = createFileRoute("/app/inventory/")({
  validateSearch: (raw) => {
    const v: View =
      raw.view === "stock" || raw.view === "moves" ? raw.view : "catalog";
    const s = String(raw.status ?? "all");
    return { view: v, status: s };
  },
  component: InventoryWorkspace,
});

/* ────────── constants ────────── */

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "catalog", label: "Catalog" },
  { value: "stock", label: "Stock" },
  { value: "moves", label: "Moves" },
];

const STOCK_FILTER_TABS: { value: StockHealthFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "out", label: "Out" },
  { value: "low", label: "Low" },
  { value: "healthy", label: "Healthy" },
];

const MOVE_FILTER_TABS: { value: MoveTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "inbound", label: "Inbound" },
  { value: "outbound", label: "Outbound" },
  { value: "receipt", label: "Receipts" },
  { value: "delivery", label: "Deliveries" },
  { value: "transfer", label: "Transfers" },
  { value: "adjustment", label: "Adjustments" },
  { value: "scrap", label: "Scrap" },
  { value: "return", label: "Returns" },
];

/* ────────── filter coercion ────────── */

function coerceStockFilter(s: string): StockHealthFilter {
  return (STOCK_HEALTH_VALUES as readonly string[]).includes(s)
    ? (s as StockHealthFilter)
    : "all";
}

function coerceMoveFilter(s: string): MoveTypeFilter {
  return s === "receipt" ||
    s === "delivery" ||
    s === "transfer" ||
    s === "adjustment" ||
    s === "scrap"
    ? s
    : "all";
}

/* ────────── root component ────────── */

function InventoryWorkspace() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const view = search.view;
  const status = search.status;

  // Fetch all three datasets once. The user may switch views, but
  // re-fetching on every tab click is wasteful. The StockList pulls
  // totals from `stock`, the Catalog list pulls per-item stock from
  // `stock`, and the Moves list pulls from `moves`.
  const catalogQ = useQuery({
    queryKey: ["catalog-items"],
    queryFn: () =>
      getJson("/api/catalog/items", CatalogItemsResponseSchema),
    staleTime: 30_000,
  });
  const stockQ = useQuery({
    queryKey: ["stock"],
    queryFn: () => getJson("/api/inventory/stock", StockResponseSchema),
    staleTime: 30_000,
  });
  const movesQ = useQuery({
    queryKey: ["inventory-moves"],
    queryFn: () =>
      getJson("/api/inventory/moves", StockMovesResponseSchema),
    staleTime: 30_000,
  });

  const setView = (next: View) =>
    navigate({ search: { view: next, status: "all" } });
  const setStatus = (next: string) =>
    navigate({ search: { view, status: next } });

  const isLoading =
    catalogQ.isLoading || stockQ.isLoading || movesQ.isLoading;
  const isError =
    catalogQ.isError || stockQ.isError || movesQ.isError;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <WorkspaceHeader
        view={view}
        setView={setView}
        catalogCount={catalogQ.data?.items.length ?? 0}
        stockCount={stockQ.data?.stock.length ?? 0}
        movesCount={movesQ.data?.moves.length ?? 0}
      />

      {isLoading ? (
        <p className="px-3 py-10 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          Loading inventory…
        </p>
      ) : isError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-sm)] border border-[var(--color-ruby,#b23a48)]/30 bg-[var(--color-ruby,#b23a48)]/5 px-2 py-1.5 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
        >
          Could not load inventory data.
        </p>
      ) : view === "catalog" ? (
        <CatalogList
          items={catalogQ.data?.items ?? []}
          totalsByItemId={totalStockByItemId(stockQ.data?.stock ?? [])}
        />
      ) : view === "stock" ? (
        <StockList
          balances={stockQ.data?.stock ?? []}
          filter={coerceStockFilter(status)}
          onFilterChange={setStatus}
        />
      ) : (
        <MovesList
          moves={movesQ.data?.moves ?? []}
          filter={coerceMoveFilter(status)}
          onFilterChange={setStatus}
        />
      )}
    </div>
  );
}

/* ────────── header ────────── */

function WorkspaceHeader({
  view,
  setView,
  catalogCount,
  stockCount,
  movesCount,
}: {
  view: View;
  setView: (next: View) => void;
  catalogCount: number;
  stockCount: number;
  movesCount: number;
}) {
  const counts: Record<View, number> = {
    catalog: catalogCount,
    stock: stockCount,
    moves: movesCount,
  };
  return (
    <header className="space-y-3">
      <Link
        to="/app/inventory"
        search={{ view: "catalog", status: "all" }}
        className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        Inventory
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
            <PackageOpen className="size-5" />
            Inventory
          </h1>
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
            Catalog items · stock by location · recent moves
          </p>
        </div>
        <div className="flex items-center gap-2">
          <HybridBadge kind="rule" />
          <span className="text-[11px] text-[var(--color-muted)]">
            Stock tiers and moves are deterministic
          </span>
          <Link
            to="/app/inventory/warehouse"
            data-testid="inventory-warehouse-link"
            data-entity="inventory-warehouse-link"
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
          >
            <PackageOpen className="size-3" />
            Պահեստ
          </Link>
        </div>
      </div>
      <ViewSwitcher
        options={VIEW_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
          count: counts[o.value],
        }))}
        value={view}
        onChange={setView}
      />
    </header>
  );
}

/* ────────── catalog list ────────── */

function CatalogList({
  items,
  totalsByItemId,
}: {
  items: CatalogItem[];
  totalsByItemId: Record<string, number>;
}) {
  const [query, setQuery] = useQueryState();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.sku.toLowerCase().includes(q) ||
        it.name.toLowerCase().includes(q) ||
        (it.categoryName ?? "").toLowerCase().includes(q),
    );
  }, [items, query]);

  if (items.length === 0) {
    return (
      <EmptyState
        title="No catalog items yet"
        body="Create a catalog item to start tracking stock and pricing."
      />
    );
  }

  return (
    <section className="space-y-2">
      <SearchInput value={query} onChange={setQuery} />
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
        <table className="w-full text-left text-[var(--text-sm)]">
          <thead className="bg-[var(--color-surface-soft)] text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">SKU</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 text-right font-medium">List</th>
              <th className="px-3 py-2 text-right font-medium">In stock</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((it) => {
              const total = totalsByItemId[it.id] ?? 0;
              const tier = total === 0 ? "out" : total < 10 ? "low" : "healthy";
              return (
                <tr
                  key={it.id}
                  className="cursor-pointer border-t border-[var(--color-line)] hover:bg-[var(--color-surface-soft)]"
                >
                  <td className="px-3 py-2 font-mono text-[var(--color-ink)]">
                    <Link
                      to="/app/inventory/$itemId"
                      params={{ itemId: it.id }}
                      search={{ tab: "overview" }}
                      className="hover:underline"
                    >
                      {it.sku}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-ink)]">
                    {it.name}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {it.categoryName ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {it.itemType}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                    {typeof it.listPrice === "number"
                      ? money(it.listPrice, { compact: true })
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                    {it.trackStock === false ? (
                      <span className="text-[var(--color-muted)]">—</span>
                    ) : (
                      numberShort(total)
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StockHealthPill health={tier} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="px-3 py-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
            No items match “{query}”.
          </p>
        )}
      </div>
    </section>
  );
}

/* ────────── stock list ────────── */

function StockList({
  balances,
  filter,
  onFilterChange,
}: {
  balances: StockBalance[];
  filter: StockHealthFilter;
  onFilterChange: (next: string) => void;
}) {
  const [query, setQuery] = useQueryState();
  const counts = useMemo(() => {
    const c: Record<StockHealthFilter, number> = {
      all: balances.length,
      out: 0,
      low: 0,
      healthy: 0,
      unknown: 0,
    };
    for (const b of balances) {
      c[classifyStockLevel(b)]++;
    }
    return c;
  }, [balances]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return balances.filter((b) => {
      if (filter !== "all" && classifyStockLevel(b) !== filter) return false;
      if (!q) return true;
      return (
        (b.catalogSku ?? "").toLowerCase().includes(q) ||
        (b.catalogName ?? "").toLowerCase().includes(q) ||
        (b.locationCode ?? "").toLowerCase().includes(q)
      );
    });
  }, [balances, filter, query]);

  return (
    <section className="space-y-2">
      <FilterTabs
        tabs={STOCK_FILTER_TABS.map((t) => ({
          ...t,
          count: counts[t.value],
        }))}
        value={filter}
        onChange={onFilterChange}
      />
      <SearchInput value={query} onChange={setQuery} />
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
        <table className="w-full text-left text-[var(--text-sm)]">
          <thead className="bg-[var(--color-surface-soft)] text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium">Location</th>
              <th className="px-3 py-2 text-right font-medium">On hand</th>
              <th className="px-3 py-2 text-right font-medium">Reserved</th>
              <th className="px-3 py-2 text-right font-medium">Available</th>
              <th className="px-3 py-2 text-right font-medium">Avg cost</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((b) => (
              <tr
                key={b.id}
                className="border-t border-[var(--color-line)] hover:bg-[var(--color-surface-soft)]"
              >
                <td className="px-3 py-2">
                  <Link
                    to="/app/inventory/$itemId"
                    params={{ itemId: b.catalogItemId }}
                    search={{ tab: "stock" }}
                    className="font-mono text-[var(--color-ink)] hover:underline"
                  >
                    {b.catalogSku ?? b.catalogItemId}
                  </Link>
                  <p className="text-[11px] text-[var(--color-muted)]">
                    {b.catalogName ?? ""}
                  </p>
                </td>
                <td className="px-3 py-2 text-[var(--color-muted)]">
                  <div>{b.locationCode ?? b.locationId}</div>
                  <div className="text-[11px]">
                    {b.locationName ?? b.locationType ?? ""}
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                  {b.quantity}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-muted)]">
                  {b.reservedQuantity ?? 0}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                  {b.availableQuantity}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                  {typeof b.averageCost === "number"
                    ? money(b.averageCost, { compact: true })
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  <StockHealthPill health={classifyStockLevel(b)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="px-3 py-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
            {balances.length === 0
              ? "No stock balances yet. Receive items to populate stock."
              : "No rows match the current filter."}
          </p>
        )}
      </div>
    </section>
  );
}

/* ────────── moves list ────────── */

function MovesList({
  moves,
  filter,
  onFilterChange,
}: {
  moves: StockMove[];
  filter: MoveTypeFilter;
  onFilterChange: (next: string) => void;
}) {
  const [query, setQuery] = useQueryState();
  const counts = useMemo(() => {
    const c: Record<MoveTypeFilter, number> = {
      all: moves.length,
      inbound: 0,
      outbound: 0,
      receipt: 0,
      delivery: 0,
      transfer: 0,
      adjustment: 0,
      scrap: 0,
      return: 0,
    };
    for (const m of moves) {
      const t = (m.moveType as MoveTypeFilter) ?? "all";
      if (t in c) c[t]++;
    }
    return c;
  }, [moves]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return moves
      .filter((m) => {
        if (filter !== "all" && m.moveType !== filter) return false;
        if (!q) return true;
        return (
          (m.catalogSku ?? "").toLowerCase().includes(q) ||
          (m.catalogName ?? "").toLowerCase().includes(q) ||
          (m.reason ?? "").toLowerCase().includes(q) ||
          (m.reference ?? "").toLowerCase().includes(q)
        );
      })
      .slice()
      .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") * -1);
  }, [moves, filter, query]);

  return (
    <section className="space-y-2">
      <FilterTabs
        tabs={MOVE_FILTER_TABS.map((t) => ({
          ...t,
          count: counts[t.value],
        }))}
        value={filter}
        onChange={onFilterChange}
      />
      <SearchInput value={query} onChange={setQuery} />
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
        <table className="w-full text-left text-[var(--text-sm)]">
          <thead className="bg-[var(--color-surface-soft)] text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium">From → To</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Unit cost</th>
              <th className="px-3 py-2 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr
                key={m.id}
                className="border-t border-[var(--color-line)] hover:bg-[var(--color-surface-soft)]"
              >
                <td className="px-3 py-2 text-[var(--color-muted)]">
                  {m.createdAt
                    ? new Date(m.createdAt).toLocaleString()
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  <MoveTypePill type={m.moveType as StockMoveType} />
                </td>
                <td className="px-3 py-2">
                  <Link
                    to="/app/inventory/$itemId"
                    params={{ itemId: m.catalogItemId }}
                    search={{ tab: "moves" }}
                    className="font-mono text-[var(--color-ink)] hover:underline"
                  >
                    {m.catalogSku ?? m.catalogItemId}
                  </Link>
                  <p className="text-[11px] text-[var(--color-muted)]">
                    {m.catalogName ?? ""}
                  </p>
                </td>
                <td className="px-3 py-2 text-[var(--color-muted)]">
                  <div className="inline-flex items-center gap-1">
                    {m.sourceLocationCode ?? "—"}
                    <ChevronRight className="size-3" />
                    {m.destinationLocationCode ?? "—"}
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                  {m.quantity}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                  {typeof m.unitCost === "number"
                    ? money(m.unitCost, { compact: true })
                    : "—"}
                </td>
                <td className="px-3 py-2 text-[var(--color-muted)]">
                  {m.reason ?? m.reference ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="px-3 py-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
            {moves.length === 0
              ? "No stock moves yet. Receipts, deliveries and transfers will appear here."
              : "No moves match the current filter."}
          </p>
        )}
      </div>
    </section>
  );
}

/* ────────── small primitives ────────── */

function FilterTabs<V extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: V; label: string; count?: number }[];
  value: V;
  onChange: (next: V) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex flex-wrap items-center gap-1 text-[var(--text-sm)]"
    >
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 transition",
              active
                ? "bg-[var(--color-surface)] font-semibold text-[var(--color-ink)] ring-1 ring-[var(--color-line)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]",
            )}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span
                className={cn(
                  "rounded-[var(--radius-sm)] px-1 py-0.5 font-mono text-[10px] tabular-nums",
                  active
                    ? "bg-[var(--color-surface-soft)] text-[var(--color-ink)]"
                    : "bg-[var(--color-surface-soft)] text-[var(--color-muted)]",
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

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
        placeholder="Search…"
        aria-label="Filter"
        className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] pl-7 pr-2 text-[var(--text-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
      />
    </div>
  );
}

/** Tiny search-state primitive that hides React's `useState` from
 *  each list view. Keeps the route file focused on layout. */
function useQueryState(): [string, (next: string) => void] {
  const [q, setQ] = useReactState("");
  return [q, setQ];
}

// We re-import useState under a local name to avoid a top-level
// `useState` import that the file already pulls in for nothing.
import { useState as useReactState } from "react";

function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-10 text-center">
      <ListChecks className="size-5 text-[var(--color-muted)]" />
      <p className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        {title}
      </p>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">{body}</p>
    </div>
  );
}

const HEALTH_TONE: Record<StockHealth, { bg: string; fg: string; label: string }> = {
  out: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
    label: "Out",
  },
  low: {
    bg: "bg-[color-mix(in_srgb,var(--color-amber,#d78b2f)_15%,transparent)]",
    fg: "text-[var(--color-amber,#d78b2f)]",
    label: "Low",
  },
  healthy: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Healthy",
  },
  unknown: {
    bg: "bg-[var(--color-surface-soft)]",
    fg: "text-[var(--color-muted)]",
    label: "—",
  },
};

function StockHealthPill({ health }: { health: StockHealth }) {
  const tone = HEALTH_TONE[health];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        tone.bg,
        tone.fg,
      )}
    >
      {health === "out" ? (
        <AlertTriangle className="size-3" />
      ) : health === "healthy" ? (
        <CheckCircle2 className="size-3" />
      ) : null}
      {tone.label}
    </span>
  );
}

const MOVE_TONE: Record<
  StockMoveType,
  { bg: string; fg: string; icon: typeof Box }
> = {
  inbound: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    icon: ArrowDownToLine,
  },
  receipt: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    icon: ArrowDownToLine,
  },
  outbound: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
    icon: ArrowUpFromLine,
  },
  delivery: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
    icon: ArrowUpFromLine,
  },
  transfer: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-violet)_15%,transparent)]",
    fg: "text-[var(--color-tag-violet)]",
    icon: ArrowRightLeft,
  },
  adjustment: {
    bg: "bg-[color-mix(in_srgb,var(--color-amber,#d78b2f)_15%,transparent)]",
    fg: "text-[var(--color-amber,#d78b2f)]",
    icon: Wrench,
  },
  scrap: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
    icon: Trash2,
  },
  return: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-violet)_15%,transparent)]",
    fg: "text-[var(--color-tag-violet)]",
    icon: ArrowRightLeft,
  },
};

function MoveTypePill({ type }: { type: StockMoveType }) {
  const tone = MOVE_TONE[type] ?? {
    bg: "bg-[var(--color-surface-soft)]",
    fg: "text-[var(--color-muted)]",
    icon: Box,
  };
  const Icon = tone.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        tone.bg,
        tone.fg,
      )}
    >
      <Icon className="size-3" />
      {type}
    </span>
  );
}

// Keep an explicit reference so the linter doesn't drop summariseItemStock
// (Phase 2.6 widgets will reuse it; until then this is a no-op for
// the catalog view that computes the same total via totalsByItemId).
void summariseItemStock;
