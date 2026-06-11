/**
 * Pure helpers for the Warehouse workspace (Phase 8.3 layer 1).
 *
 * Source of truth: server/warehouse.js (FEFO ordering, ABC
 * classification, turnover days, restock forecast, cold-storage
 * reading normalization) and the Zod registry at
 * web-modern/src/lib/api/schemas.ts (the `Warehouse*` schemas).
 *
 * These helpers are UI-pure: no React, no I/O, no router. They
 * re-derive small UI affordances (FEFO ordering, form-time
 * validation, Armenian formatting, tab deep-link parsing) so the
 * /app/inventory/warehouse route can preview server logic
 * client-side without bouncing through the API. Tested in isolation
 * under jsdom.
 *
 * Public surface:
 *  - fefoOrderLots                    → expiry ASC, null last, stable
 *  - isValidLotInput                  → mirrors server validateLotCode + validateExpiry
 *  - isValidSerialInput               → mirrors server validateSerial
 *  - isAbcBucket                      → type guard for A | B | C
 *  - abcRowCumulative                 → "X%" (Armenian locale, no fractional)
 *  - formatTurnoverDays               → "X օր"
 *  - formatColdStorageTemp            → "X.X°C"
 *  - formatColdStorageHumidity        → "—" for null, else "X%"
 *  - forecastReasoningString          → join(" / ")
 *  - warehouseTabFromHash / ToHash    → deep-link helpers
 */
import type {
  WarehouseAbcRow,
  WarehouseLot,
  WarehouseTab,
} from "./types";
import { WAREHOUSE_TABS } from "./types";

/* ────────── type re-exports (UI narrowing) ────────── */

export type { WarehouseLot, WarehouseAbcRow, WarehouseTab } from "./types";
export { WAREHOUSE_TABS } from "./types";

/* ────────── ordering (FEFO) ────────── */

/**
 * FEFO (First-Expired-First-Out) sort. Lots with an `expiryDate`
 * come first in ascending order; lots without an expiry float to
 * the end as a single block (preserves input order within the
 * null-bucket). Ties on expiryDate preserve input order — JS
 * `Array.prototype.sort` is stable since ES2019, so we get that
 * for free. The server's `fefoOrder` (server/warehouse.js) drops
 * null-expiry lots entirely; the route needs the full set so the
 * user sees all of their inventory, hence the divergence.
 */
export function fefoOrderLots(lots: ReadonlyArray<WarehouseLot>): WarehouseLot[] {
  return lots.slice().sort((a, b) => {
    const ax = a.expiryDate ?? null;
    const bx = b.expiryDate ?? null;
    if (ax === null && bx === null) return 0;
    if (ax === null) return 1; // a is null → a goes after b
    if (bx === null) return -1; // b is null → b goes after a
    if (ax === bx) return 0;
    return ax.localeCompare(bx);
  });
}

/* ────────── client-side form validation ────────── */

/** Mirrors server/warehouse.js#LOT_CODE exactly. */
const LOT_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
/** Mirrors server/warehouse.js#SERIAL_CODE exactly. */
const SERIAL_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;
/** Mirrors server/warehouse.js#ISO_DATE exactly. */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function trimToString(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Mirrors the server's `validateLotCode` + `validateExpiry` for
 * client-side form gating. The server still re-validates; this is
 * an affordance to fail fast in the UI. Returns the same
 * `400`-equivalent reason the server would emit, so error chips
 * stay consistent across the round-trip.
 */
export function isValidLotInput(input: {
  lotCode: string;
  expiryDate?: string | null;
  mfgDate?: string | null;
}): ValidationResult {
  const code = trimToString(input.lotCode);
  if (code.length === 0) {
    return { ok: false, reason: "Lot code is required" };
  }
  if (!LOT_CODE_REGEX.test(code)) {
    return {
      ok: false,
      reason: "Lot code must match /^[A-Z0-9][A-Z0-9_-]{1,31}$/",
    };
  }
  const expiry = input.expiryDate == null ? "" : trimToString(input.expiryDate);
  if (expiry.length > 0 && !ISO_DATE_REGEX.test(expiry)) {
    return { ok: false, reason: "expiryDate must be YYYY-MM-DD" };
  }
  const mfg = input.mfgDate == null ? "" : trimToString(input.mfgDate);
  if (mfg.length > 0 && !ISO_DATE_REGEX.test(mfg)) {
    return { ok: false, reason: "mfgDate must be YYYY-MM-DD" };
  }
  if (mfg.length > 0 && expiry.length > 0 && expiry < mfg) {
    return { ok: false, reason: "expiryDate must be on or after mfgDate" };
  }
  return { ok: true };
}

/**
 * Mirrors server/warehouse.js#validateSerial. Same shape as
 * `isValidLotInput` so the route can render the same error chip.
 */
export function isValidSerialInput(input: { serial: string }): ValidationResult {
  const code = trimToString(input.serial);
  if (code.length === 0) {
    return { ok: false, reason: "Serial is required" };
  }
  if (!SERIAL_CODE_REGEX.test(code)) {
    return {
      ok: false,
      reason: "Serial must match /^[A-Z0-9][A-Z0-9_-]{1,63}$/",
    };
  }
  return { ok: true };
}

/* ────────── classification ────────── */

/** Type guard for the three ABC classification buckets. */
export function isAbcBucket(value: string): value is "A" | "B" | "C" {
  return value === "A" || value === "B" || value === "C";
}

/* ────────── formatting (Armenian-first) ────────── */

const hyAMInteger = new Intl.NumberFormat("hy-AM", { maximumFractionDigits: 0 });

/**
 * Format an ABC row's cumulative revenue share as "X%" using the
 * Armenian locale for digit grouping. The server stores
 * `cumulativeShare` as a fraction in [0, 1] with up to 4 decimal
 * places; we round to a whole percent so the pill is compact.
 * Values that aren't finite (defensive against malformed server
 * responses) fall back to "0%".
 */
export function abcRowCumulative(row: Pick<WarehouseAbcRow, "cumulativeShare">): string {
  const value = Number(row.cumulativeShare);
  if (!Number.isFinite(value)) return "0%";
  return `${hyAMInteger.format(Math.max(0, Math.round(value * 100)))}%`;
}

/**
 * Turn a turnover-days number into the operator's "X օր" suffix.
 * The server returns `Math.round(days * 10) / 10` (one decimal);
 * we round to a whole number for display because the legacy
 * renders fractional values the same way ("3.4 օր" looked noisy
 * in the analytics tab).
 */
export function formatTurnoverDays(days: number): string {
  const n = Number(days);
  if (!Number.isFinite(n)) return "0 օր";
  return `${Math.max(0, Math.round(n))} օր`;
}

/**
 * Format a cold-storage temperature in °C with one decimal place,
 * matching the legacy `Number(reading.tempC).toFixed(1) + "°C"`.
 */
export function formatColdStorageTemp(tempC: number): string {
  const n = Number(tempC);
  if (!Number.isFinite(n)) return "0.0°C";
  return `${n.toFixed(1)}°C`;
}

/**
 * Format a cold-storage humidity reading. `null` means the sensor
 * didn't report humidity (cold-only fridges), which the legacy
 * renders as a long em-dash. Otherwise we round to a whole
 * percent for compactness — the sensor resolution is 1% anyway.
 */
export function formatColdStorageHumidity(humidity: number | null | undefined): string {
  if (humidity == null) return "—";
  const n = Number(humidity);
  if (!Number.isFinite(n)) return "—";
  return `${Math.max(0, Math.min(100, Math.round(n)))}%`;
}

/**
 * Join a forecast's reasoning bullets with " / " so the analytics
 * tab can show a single secondary line. Empty arrays collapse to
 * an empty string rather than a stray " / ".
 */
export function forecastReasoningString(reasoning: ReadonlyArray<string>): string {
  return reasoning.join(" / ");
}

/* ────────── deep-link tab helpers ────────── */

/**
 * Parse a URL hash fragment (e.g. "#analytics") into a canonical
 * tab name. Defaults to "lots" when the hash is missing,
 * whitespace-only, or doesn't match one of the four warehouse
 * tabs. The leading `#` is optional; the caller may pass either
 * "#analytics" or "analytics".
 */
export function warehouseTabFromHash(hash: string | null | undefined): WarehouseTab {
  if (typeof hash !== "string") return "lots";
  const trimmed = hash.trim();
  if (trimmed.length === 0) return "lots";
  const stripped = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (stripped.length === 0) return "lots";
  if (WAREHOUSE_TABS.includes(stripped as WarehouseTab)) {
    return stripped as WarehouseTab;
  }
  return "lots";
}

/** Inverse of `warehouseTabFromHash`. Returns "#<tab>". */
export function warehouseTabToHash(tab: WarehouseTab): string {
  return `#${tab}`;
}
