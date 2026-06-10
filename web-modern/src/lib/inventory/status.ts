/**
 * Pure helpers for the inventory workspace.
 *
 * Kept separate from the route file so they are easy to unit-test
 * (TDD per common/testing.md) and easy to reuse from the Mission
 * Control widgets (Phase 2.6 will reuse `classifyStockLevel`).
 */

import type { StockBalance } from "../api/schemas";

/** Stock health tiers for the Stock view's status column + filter
 *  tabs. Same thresholds as the Inventory Risk Agent (default
 *  reorder point 10; out-of-stock = zero available). */
export type StockHealth = "out" | "low" | "healthy" | "unknown";

export interface StockRowForHealth {
  availableQuantity?: number | null;
  quantity?: number | null;
  reorderPoint?: number | null;
}

const DEFAULT_REORDER_POINT = 10;

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Map a stock row to a health tier. Falls back to the default
 *  reorder point if the row doesn't carry one (the legacy endpoint
 *  does not always include it). */
export function classifyStockLevel(
  row: StockRowForHealth,
  fallbackReorderPoint: number = DEFAULT_REORDER_POINT,
): StockHealth {
  const available = asNum(row.availableQuantity) ?? asNum(row.quantity) ?? null;
  if (available == null) return "unknown";
  if (available <= 0) return "out";
  const threshold = asNum(row.reorderPoint) ?? fallbackReorderPoint;
  if (threshold > 0 && available < threshold) return "low";
  return "healthy";
}

/** Summarise a single item's stock across all of its balance rows.
 *  Used by the catalog view's "stock at a glance" column. The rule:
 *  worst-of wins. */
export function summariseItemStock(
  rows: ReadonlyArray<StockRowForHealth>,
  fallbackReorderPoint: number = DEFAULT_REORDER_POINT,
): { totalAvailable: number; health: StockHealth } {
  const totalAvailable = rows.reduce(
    (acc, r) => acc + (asNum(r.availableQuantity) ?? asNum(r.quantity) ?? 0),
    0,
  );
  if (rows.length === 0) {
    return { totalAvailable, health: "unknown" };
  }
  if (totalAvailable <= 0) return { totalAvailable, health: "out" };
  if (totalAvailable < fallbackReorderPoint) {
    return { totalAvailable, health: "low" };
  }
  return { totalAvailable, health: "healthy" };
}

/** Aggregate per-item totals for the catalog list view, where we
 *  have an array of items each with optional stockBalances[]. */
export function indexByCatalogItemId<
  T extends { id: string; stockBalances?: ReadonlyArray<StockRowForHealth> | null },
>(
  items: ReadonlyArray<T>,
  fallbackReorderPoint: number = DEFAULT_REORDER_POINT,
): Record<string, { totalAvailable: number; health: StockHealth }> {
  const out: Record<string, { totalAvailable: number; health: StockHealth }> = {};
  for (const it of items) {
    const rows = (it.stockBalances ?? []) as ReadonlyArray<StockRowForHealth>;
    out[it.id] = summariseItemStock(rows, fallbackReorderPoint);
  }
  return out;
}

/** Reduce an array of balances to a (catalogItemId -> total) map.
 *  Used by the $itemId detail page to render "across all locations". */
export function totalStockByItemId(
  balances: ReadonlyArray<StockBalance>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of balances) {
    out[b.catalogItemId] =
      (out[b.catalogItemId] ?? 0) +
      (asNum(b.availableQuantity) ?? asNum(b.quantity) ?? 0);
  }
  return out;
}
