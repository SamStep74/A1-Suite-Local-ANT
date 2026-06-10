/**
 * InventoryRiskAgent — V1 pure-function evaluator.
 *
 * Trigger: a catalog item with `trackStock: true`, viewed on its detail
 * page (or aggregated across the catalog list / Mission Control widget).
 *
 * Logic:
 *   1. Look at the item's stock balances across locations.
 *   2. If `totalAvailable < reorderPoint` (default 10), propose a
 *      `POST /api/inventory/moves` receipt to bring the item back to
 *      a safe level.
 *   3. The receipt is sized to `max(reorderPoint * 2 - totalAvailable, 1)`
 *      — i.e. one full reorder cycle above the threshold.
 *   4. If any of the item's price-list entries has `marginStatus ===
 *      "below_minimum"`, also surface a "below-minimum margin" insight
 *      (informational; no action attached).
 *
 * The agent NEVER mutates state. The mutation lands through the
 * existing `DecisionCard.onApprove` → `api("POST", ...)` path.
 *
 * V2 swap (Phase 4) — replace `evaluate` body with a Vercel AI SDK v3
 * call that uses sales velocity, supplier lead time, and seasonality
 * to size the receipt. Same return shape.
 */

import { AlertTriangle } from "lucide-react";
import type { Agent, AgentContext, AgentSuggestion } from "./types";

/* ────────────── shape of the catalog-item payload we expect ────────────── */

interface StockBalanceRow {
  id: string;
  catalogItemId: string;
  locationId: string;
  locationCode?: string;
  locationName?: string;
  locationType?: string;
  quantity: number;
  reservedQuantity?: number;
  availableQuantity: number;
  averageCost?: number;
}

interface PriceListEntry {
  priceListId: string;
  priceListCode?: string;
  listPrice?: number;
  netPrice?: number;
  standardCost?: number;
  marginAmount?: number;
  marginPercent?: number;
  marginStatus?: "ok" | "below_minimum";
  marginRuleCode?: string;
  minimumMarginPercent?: number;
  targetMarginPercent?: number;
}

interface CatalogItemShape {
  id: string;
  sku: string;
  name: string;
  itemType: string;
  status: string;
  trackStock?: boolean;
  /** Per-item reorder threshold. Defaults to 10 if missing. */
  reorderPoint?: number;
  /** Suggested unit cost for the receipt. Falls back to
   *  `standardCost` of the first price-list entry, then to 0. */
  averageCost?: number;
  /** Stock balances across locations. May be empty. */
  stockBalances?: StockBalanceRow[];
  /** Price-list entries for margin check. */
  priceListEntries?: PriceListEntry[];
  /** Optional default destination location for the receipt. The
   *  inventory move form picks WH/STOCK if this is missing. */
  preferredLocationId?: string;
  preferredLocationCode?: string;
}

/* ────────────── helpers ────────────── */

const DEFAULT_REORDER_POINT = 10;

function sumAvailable(balances: StockBalanceRow[]): number {
  return balances.reduce(
    (acc, b) => acc + (Number.isFinite(b.availableQuantity) ? b.availableQuantity : 0),
    0,
  );
}

function pickAverageCost(item: CatalogItemShape): number {
  if (typeof item.averageCost === "number" && item.averageCost > 0) {
    return item.averageCost;
  }
  const firstWithCost = item.priceListEntries?.find(
    (p) => typeof p.standardCost === "number" && p.standardCost > 0,
  );
  return firstWithCost?.standardCost ?? 0;
}

/* ────────────── the evaluator ────────────── */

async function evaluate(ctx: AgentContext): Promise<AgentSuggestion[]> {
  if (ctx.type !== "catalog.item") return [];
  const item = ctx.data as CatalogItemShape;

  // Gate: only trackable, active items
  if (item.trackStock !== true) return [];
  if (item.status !== "active") return [];

  const reorderPoint = item.reorderPoint ?? DEFAULT_REORDER_POINT;
  const balances = item.stockBalances ?? [];
  const totalAvailable = sumAvailable(balances);
  const outOfStock = totalAvailable === 0;
  const belowThreshold = totalAvailable < reorderPoint;

  const suggestions: AgentSuggestion[] = [];

  // ─── 1. Low / out-of-stock → propose a receipt ─────────────────
  if (belowThreshold) {
    // Size the receipt to land one full reorder cycle above the
    // threshold. Round up so we never propose zero.
    const suggestedQty = Math.max(reorderPoint * 2 - totalAvailable, 1);
    const unitCost = pickAverageCost(item);

    suggestions.push({
      id: `inventory-risk:receipt:${item.id}`,
      agentId: "inventory-risk",
      contextType: "catalog.item",
      contextId: item.id,
      title: outOfStock
        ? `Replenish ${item.sku} — out of stock`
        : `Replenish ${item.sku} — below reorder point`,
      rationale: outOfStock
        ? `Total available is 0 across ${balances.length} location(s). Reorder threshold is ${reorderPoint}.`
        : `Total available is ${totalAvailable} across ${balances.length} location(s). Reorder threshold is ${reorderPoint}.`,
      sourceRecords: [
        `Catalog item: ${item.sku} · ${item.name}`,
        ...balances.map(
          (b) =>
            `Stock: ${b.availableQuantity} at ${b.locationCode ?? b.locationId}`,
        ),
        `Reorder threshold: ${reorderPoint}`,
      ],
      confidence: outOfStock ? 0.95 : 0.8,
      previewDiff: {
        status: `${totalAvailable} available`,
        to: `${totalAvailable + suggestedQty} available after receipt`,
        receiptQuantity: suggestedQty,
        unitCost,
        location: item.preferredLocationCode ?? "WH/STOCK",
      },
      risk: outOfStock ? "high" : "medium",
      riskReason: outOfStock
        ? "This item is at zero. A customer order or production line will fail without a receipt."
        : "A receipt adds to inventory and changes average cost. Review the unit cost before approving.",
      kind: "agent",
      proposedAction: {
        method: "POST",
        path: "/api/inventory/moves",
        body: {
          catalogItemId: item.id,
          destinationLocationId: item.preferredLocationId ?? undefined,
          moveType: "receipt",
          quantity: suggestedQty,
          unitCost,
          reason: "Agent: inventory-risk auto-replenishment",
          reference: `agent:inventory-risk:${item.id}`,
        },
      },
    });
  }

  // ─── 2. Below-minimum margin → insight only (no action) ───────
  const belowMinEntries = (item.priceListEntries ?? []).filter(
    (p) => p.marginStatus === "below_minimum",
  );
  if (belowMinEntries.length > 0) {
    suggestions.push({
      id: `inventory-risk:margin:${item.id}`,
      agentId: "inventory-risk",
      contextType: "catalog.item",
      contextId: item.id,
      title: `Below-minimum margin on ${belowMinEntries.length} price list(s)`,
      rationale: `Catalog pricing for ${item.sku} falls below the configured margin rule on ${belowMinEntries.length} price list(s). The Sales Quote Agent will surface this on any quote it drafts.`,
      sourceRecords: belowMinEntries.map(
        (p) => `Price list ${p.priceListCode ?? p.priceListId} (${p.marginPercent?.toFixed(1) ?? "?"}%, rule ${p.marginRuleCode ?? "?"})`,
      ),
      confidence: 0.9,
      previewDiff: {},
      risk: "low",
      riskReason:
        "Informational only. No mutation proposed. To fix, update the price list or the margin rule.",
      kind: "rule",
      // Empty proposedAction → the DecisionCard will render but its
      // Approve button is hidden (Phase 2.6 wiring handles this).
      proposedAction: { method: "POST", path: "/_no-op", body: {} },
    });
  }

  return suggestions;
}

/* ────────────── the registry entry ────────────── */

export const inventoryRiskAgent: Agent = {
  id: "inventory-risk",
  name: "Inventory Risk Agent",
  role: "Flags low stock and margin drops",
  description:
    "Watches catalog items with `trackStock`. Surfaces replenishment suggestions when stock drops below the reorder point, and flags price-list entries that fall below the minimum margin.",
  triggers: ["catalog.item"],
  icon: AlertTriangle,
  evaluate,
};
