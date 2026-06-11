/**
 * Public types for the Warehouse workspace (Phase 8.3 layer 1).
 *
 * Re-exports the Zod-inferred domain types from
 * web-modern/src/lib/api/schemas.ts and adds a couple of UI-only
 * unions (the four tab names + their canonical order).
 *
 * The route component imports from this file rather than reaching
 * into the schema registry directly, so the public surface of
 * the warehouse lib is grep-able from a single entry point.
 */
export type {
  WarehouseAbcRow,
  WarehouseColdStorageReading,
  WarehouseForecast,
  WarehouseLot,
  WarehouseSerial,
  WarehouseTurnoverRow,
} from "../api/schemas";

/** Canonical warehouse tab names, in their default render order. */
export type WarehouseTab = "lots" | "serials" | "cold" | "analytics";

export const WAREHOUSE_TABS: readonly WarehouseTab[] = [
  "lots",
  "serials",
  "cold",
  "analytics",
] as const;
