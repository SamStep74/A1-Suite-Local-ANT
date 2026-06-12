/**
 * /app/inventory/$itemId — catalog item detail with right-rail AI
 * Action Panel (Zoho §3.2 #2) and StockMoveForm (Zoho §3.2 #5,
 * human-in-the-loop).
 *
 * Per the plan §3.4, this is the canonical per-record surface for
 * the Inventory app — header + a tab switcher (Overview | Stock |
 * Moves | Post move) and the right rail. The Inventory Risk Agent
 * triggers on `catalog.item`; the page enriches the context with
 * the item's stock balances and price-list entries before passing
 * it in.
 *
 * Phase 10.0 split: the 12 form/header/panel/pill subcomponents
 * live in `lib/inventory/panels/`. This file owns data fetching,
 * tab navigation, the agent-context assembly, and the
 * `ITEM_STATUS_TONE → itemTone` derivation. The test only imports
 * `Route` so the re-export surface is minimal.
 */
import {
  createFileRoute,
  Link,
  notFound,
  useNavigate,
} from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  CatalogItemsResponseSchema,
  StockResponseSchema,
  StockMovesResponseSchema,
  type CatalogItem,
  type PriceListItem,
  type StockBalance,
  type StockMove,
} from "../../../lib/api/schemas";
import { AgentActionPanel } from "../../../components/agent-panel/AgentActionPanel";
import { summariseItemStock } from "../../../lib/inventory/status";
import {
  ItemHeader,
  ItemMetadata,
  MovesPanel,
  OverviewPanel,
  PostMovePanel,
  StockPanel,
  TabBar,
  type Tab,
} from "../../../lib/inventory/panels";
import type { AgentContext } from "../../../lib/agents/types";

/* ────────── re-exports (preserves the test's named import surface) ─ */

export { type Tab } from "../../../lib/inventory/panels";
export {
  ItemHeader,
  ItemMetadata,
  MovesPanel,
  OverviewPanel,
  PostMovePanel,
  StockPanel,
  TabBar,
} from "../../../lib/inventory/panels";

/* ────────── file route ────────── */

export const Route = createFileRoute("/app/inventory/$itemId")({
  validateSearch: (raw) => {
    const t: Tab =
      raw.tab === "stock" || raw.tab === "moves" || raw.tab === "post"
        ? raw.tab
        : "overview";
    return { tab: t };
  },
  component: ItemDetail,
});

/* ────────── route-local tone map (item.status → pill tone) ────── */

const ITEM_STATUS_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  active: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Active",
  },
  archived: {
    bg: "bg-[var(--color-surface-soft)]",
    fg: "text-[var(--color-muted)]",
    label: "Archived",
  },
  draft: {
    bg: "bg-[color-mix(in_srgb,var(--color-amber,#d78b2f)_15%,transparent)]",
    fg: "text-[var(--color-amber,#d78b2f)]",
    label: "Draft",
  },
};

/* ────────── root component ────────── */

function ItemDetail() {
  const { itemId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();
  const tab = search.tab;

  // Catalog items (also carries price lists we need for the agent).
  const catalogQ = useQuery({
    queryKey: ["catalog-items"],
    queryFn: () =>
      getJson("/api/catalog/items", CatalogItemsResponseSchema),
    staleTime: 30_000,
  });

  // Stock balances (the agent needs per-item stock + per-item
  // price-list entries — both are in the catalog response, but the
  // balances come from /api/inventory/stock, so we filter).
  const stockQ = useQuery({
    queryKey: ["stock"],
    queryFn: () => getJson("/api/inventory/stock", StockResponseSchema),
    staleTime: 30_000,
  });

  // Recent moves — used for the Moves tab + the AgentContext we hand
  // to the right-rail panel (the Inventory Risk Agent doesn't read
  // these, but Phase 2.6 widgets will).
  const movesQ = useQuery({
    queryKey: ["inventory-moves"],
    queryFn: () =>
      getJson("/api/inventory/moves", StockMovesResponseSchema),
    staleTime: 30_000,
  });

  const item = useMemo<CatalogItem | null>(() => {
    const list = catalogQ.data?.items ?? [];
    return list.find((x) => x.id === itemId) ?? null;
  }, [catalogQ.data?.items, itemId]);

  const itemBalances = useMemo<StockBalance[]>(
    () => (stockQ.data?.stock ?? []).filter((b) => b.catalogItemId === itemId),
    [stockQ.data?.stock, itemId],
  );

  const itemMoves = useMemo<StockMove[]>(() => {
    const all = movesQ.data?.moves ?? [];
    return all
      .filter((m) => m.catalogItemId === itemId)
      .slice()
      .sort(
        (a, b) =>
          (a.createdAt ?? "").localeCompare(b.createdAt ?? "") * -1,
      );
  }, [movesQ.data?.moves, itemId]);

  // Build the agent context. The Inventory Risk Agent's
  // `evaluate(ctx)` filters on `ctx.type === "catalog.item"` and
  // then reads `data` as a `CatalogItemShape`. We pass the item +
  // the per-item stock + the per-item price-list entries so it can
  // decide.
  const itemPriceListEntries = useMemo<PriceListItem[]>(() => {
    const lists = catalogQ.data?.priceLists ?? [];
    const out: PriceListItem[] = [];
    for (const pl of lists) {
      for (const li of pl.items ?? []) {
        if (li.catalogItemId === itemId) out.push(li);
      }
    }
    return out;
  }, [catalogQ.data?.priceLists, itemId]);

  const setTab = (next: Tab) => navigate({ search: { tab: next } });

  if (catalogQ.isLoading || stockQ.isLoading || movesQ.isLoading) {
    return (
      <p className="px-6 py-10 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading item…
      </p>
    );
  }
  if (catalogQ.isError || stockQ.isError || movesQ.isError) {
    return (
      <p
        role="alert"
        className="mx-auto max-w-3xl px-6 py-10 text-center text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
      >
        Could not load the catalog item.
      </p>
    );
  }
  if (!item) {
    return notFound();
  }

  const summary = summariseItemStock(itemBalances);
  const health = item.trackStock === false ? "unknown" : summary.health;
  const itemTone = ITEM_STATUS_TONE[item.status] ?? ITEM_STATUS_TONE.active;
  const preferred = itemBalances[0];

  // The agent context the right-rail panel evaluates against.
  const ctx: AgentContext = {
    type: "catalog.item",
    id: item.id,
    data: {
      id: item.id,
      sku: item.sku,
      name: item.name,
      itemType: item.itemType,
      status: item.status,
      trackStock: item.trackStock,
      reorderPoint:
        typeof (item as { reorderPoint?: number }).reorderPoint === "number"
          ? (item as { reorderPoint?: number }).reorderPoint
          : undefined,
      averageCost:
        typeof item.standardCost === "number" ? item.standardCost : undefined,
      stockBalances: itemBalances.map((b) => ({
        id: b.id,
        catalogItemId: b.catalogItemId,
        locationId: b.locationId,
        locationCode: b.locationCode,
        locationName: b.locationName,
        locationType: b.locationType,
        quantity: b.quantity,
        reservedQuantity: b.reservedQuantity,
        availableQuantity: b.availableQuantity,
        averageCost: b.averageCost,
      })),
      priceListEntries: itemPriceListEntries.map((p) => ({
        priceListId: p.priceListId,
        // priceListCode isn't on PriceListItem (it lives on PriceList)
        // — the agent's interface is permissive, so the empty
        // string is fine; the agent falls back to priceListId.
        listPrice: p.listPrice,
        netPrice: p.netPrice,
        standardCost: p.standardCost,
        marginAmount: p.marginAmount,
        marginPercent: p.marginPercent,
        marginStatus:
          p.marginStatus === "below_minimum"
            ? "below_minimum"
            : p.marginStatus === "ok"
              ? "ok"
              : undefined,
        marginRuleCode: p.marginRuleCode,
        minimumMarginPercent: p.minimumMarginPercent,
        targetMarginPercent: p.targetMarginPercent,
      })),
      preferredLocationId: preferred?.locationId,
      preferredLocationCode: preferred?.locationCode,
    },
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <Link
        to="/app/inventory"
        search={{ view: "catalog", status: "all" }}
        className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        Inventory
      </Link>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <ItemHeader
            item={item}
            health={health}
            totalAvailable={summary.totalAvailable}
            itemTone={itemTone}
          />
          <TabBar tab={tab} onTabChange={setTab} />
          {tab === "overview" && (
            <OverviewPanel
              item={item}
              priceListEntries={itemPriceListEntries}
            />
          )}
          {tab === "stock" && (
            <StockPanel balances={itemBalances} />
          )}
          {tab === "moves" && <MovesPanel moves={itemMoves} />}
          {tab === "post" && (
            <PostMovePanel
              item={item}
              balances={itemBalances}
              onPosted={() => {
                // Refetch stock + moves so the new balance + the
                // new move row show up immediately.
                qc.invalidateQueries({ queryKey: ["stock"] });
                qc.invalidateQueries({ queryKey: ["inventory-moves"] });
                qc.invalidateQueries({ queryKey: ["agents", "catalog.item", item.id] });
                setTab("moves");
              }}
            />
          )}
        </div>

        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <AgentActionPanel
            context={ctx}
            title="AI suggestions"
            onApproved={() => {
              qc.invalidateQueries({ queryKey: ["stock"] });
              qc.invalidateQueries({ queryKey: ["inventory-moves"] });
            }}
          />
          <ItemMetadata item={item} />
        </aside>
      </div>
    </div>
  );
}
