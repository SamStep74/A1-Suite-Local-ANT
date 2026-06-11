/**
 * Pure helpers for the Fleet workspace.
 *
 * Source of truth: server/app.js (the 9 list / POST / PATCH / analytics
 * endpoints plus the cold-chain compliance report at lines 3697-3930),
 * server/fleet.js (the trip status state machine), and the Zod registry
 * at web-modern/src/lib/api/schemas.ts (the `Fleet*` schemas).
 *
 * These helpers are UI-pure: no React, no I/O, no router. They
 * re-derive small UI affordances (the 7 tab labels, the trip state
 * machine, the cold-chain category dictionary, short-id truncation for
 * table cells, fuel-efficiency string formatting, and a client-side
 * idempotency key generator). Tested in isolation under jsdom.
 *
 * Public surface:
 *  - FLEET_TABS                          → readonly enum array of 7 tab keys
 *  - fleetTabLabelAm / fleetTabToHash /
 *    fleetTabFromHash                    → Armenian labels + URL hash bridge
 *  - TRIP_STATES / TRIP_STATE_LABELS_AM  → trip state dictionary
 *  - COLD_CHAIN_CATEGORIES /
 *    coldChainCategoryLabelAm            → cold-chain category dictionary
 *  - fleetTripStatusLabelAm /
 *    fleetTripStatusActionLabelAm        → state / action Armenian labels
 *  - fleetTripStatusCanTransition /
 *    fleetTripStatusNextActionFor        → state-machine type-guard + lister
 *  - formatFleetIdShort                  → id.slice(-6) (matches legacy)
 *  - formatFleetFuelEfficiency           → "12.3 L/100 · 8.1 km/L" string
 *  - generateFleetIdempotencyKey         → `${kind}-ui-${Date.now()}`
 */
import type {
  FleetColdChainCategory,
  FleetTripAction,
  FleetTripState,
} from "../api/schemas";

/* ────────── type re-exports (UI narrowing) ────────── */

export type {
  FleetColdChainCategory,
  FleetTripAction,
  FleetTripState,
};

/* ────────── tab constants ────────── */

export const FLEET_TABS = [
  "vehicles",
  "drivers",
  "trips",
  "fuel",
  "repairs",
  "tires",
  "coldchain",
] as const;
export type FleetTab = (typeof FLEET_TABS)[number];

/* ────────── tab labels (Armenian-first) ────────── */

const TAB_LABEL_AM: Record<FleetTab, string> = {
  vehicles: "Տրանսպորտ",
  drivers: "Վարորդներ",
  trips: "Ճանապարհորդություններ",
  fuel: "Վառելիք",
  repairs: "Վերանորոգում",
  tires: "Անվադողեր",
  coldchain: "Սառը շղթա",
};

/**
 * Armenian label for a fleet tab. Falls back to the raw key when the
 * caller passes an unknown string — the route guards against that case
 * with `fleetTabFromHash`, but the helper itself stays tolerant so a
 * future-tab stringified from a URL doesn't render as `undefined`.
 */
export function fleetTabLabelAm(tab: string): string {
  return TAB_LABEL_AM[tab as FleetTab] ?? tab;
}

/* ────────── URL hash bridge ────────── */

/**
 * Encode a fleet tab as a URL hash fragment. The hash is the same as the
 * tab key — `fleetTabToHash("vehicles") === "vehicles"`. Centralized so
 * any future encoding (e.g. `fleet:vehicles`) is one-line to change.
 */
export function fleetTabToHash(tab: FleetTab): string {
  return tab;
}

/**
 * Decode a URL hash into a FleetTab. Unknown / empty hashes fall back
 * to `"vehicles"` (the first tab) so a deep-link with a stale tab name
 * still lands on a real tab rather than rendering nothing.
 */
export function fleetTabFromHash(hash: string): FleetTab {
  const cleaned = hash.replace(/^#/, "").trim();
  if ((FLEET_TABS as readonly string[]).includes(cleaned)) {
    return cleaned as FleetTab;
  }
  return "vehicles";
}

/* ────────── trip state machine ────────── */

export const TRIP_STATES = [
  "planned",
  "in_transit",
  "arrived",
  "cancelled",
] as const;

const TRIP_STATE_LABELS_AM: Record<FleetTripState, string> = {
  planned: "Պլանավորված",
  in_transit: "Ճանապարհին",
  arrived: "Ժամանել է",
  cancelled: "Չեղարկված",
};

/**
 * Armenian label for a trip state. Returns the raw state for unknown
 * values so a future server-side state doesn't render as `undefined`.
 */
export function fleetTripStatusLabelAm(status: string): string {
  return TRIP_STATE_LABELS_AM[status as FleetTripState] ?? status;
}

/* ────────── trip actions ────────── */

const TRIP_ACTION_LABELS_AM: Record<FleetTripAction, string> = {
  departed: "Մեկնել",
  arrived: "Ժամանել",
  cancelled: "Չեղարկել",
};

/**
 * Armenian label for a trip action button. Tolerant of unknown actions
 * for the same reason as `fleetTripStatusLabelAm`.
 */
export function fleetTripStatusActionLabelAm(action: string): string {
  return TRIP_ACTION_LABELS_AM[action as FleetTripAction] ?? action;
}

/* The trip state machine — a literal copy of server/fleet.js#transition
 * so the UI hides buttons the server would 409 anyway. Encoded as a
 * frozen map keyed by (state × action) → next state. */
const TRANSITIONS: Readonly<Record<FleetTripState, ReadonlyArray<FleetTripAction>>> = {
  planned: ["departed", "cancelled"],
  in_transit: ["arrived", "cancelled"],
  arrived: [],
  cancelled: [],
};

/**
 * Type-guard for the state machine. Mirrors server/fleet.js exactly:
 *   "planned" + "departed"       → "in_transit"
 *   "planned" + "cancelled"      → "cancelled"
 *   "in_transit" + "arrived"     → "arrived"
 *   "in_transit" + "cancelled"   → "cancelled"
 *   "arrived" | "cancelled" + *  → never allowed
 *
 * Returns `false` for unknown states / actions so the UI button-visibility
 * logic stays branchless.
 */
export function fleetTripStatusCanTransition(
  from: FleetTripState,
  action: FleetTripAction,
): boolean {
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(action);
}

/**
 * The list of actions valid from a given state. Returns an empty array
 * for terminal states ("arrived", "cancelled") so the UI can map over
 * the result without a `?? []` fallback.
 */
export function fleetTripStatusNextActionFor(
  from: FleetTripState,
): FleetTripAction[] {
  return [...(TRANSITIONS[from] ?? [])];
}

/* ────────── cold-chain categories ────────── */

export const COLD_CHAIN_CATEGORIES = [
  "dairy",
  "frozen",
  "produce",
  "meat",
  "default",
] as const;

const COLD_CHAIN_CATEGORY_LABELS_AM: Record<FleetColdChainCategory, string> = {
  dairy: "Կաթնամթերք",
  frozen: "Սառեցված",
  produce: "Մրգեր / Բանջարեղեն",
  meat: "Միս",
  default: "Ընդհանուր",
};

/**
 * Armenian label for a cold-chain category. Falls back to the raw key
 * for unknown categories.
 */
export function coldChainCategoryLabelAm(category: string): string {
  return COLD_CHAIN_CATEGORY_LABELS_AM[category as FleetColdChainCategory] ?? category;
}

/* ────────── formatting helpers ────────── */

/**
 * Short-id for a fleet row. Mirrors the legacy `t.id.slice(-6)` used in
 * the data-table cells (last 6 characters of the id).
 */
export function formatFleetIdShort(id: string): string {
  return id.slice(-6);
}

/**
 * Format a fuel-efficiency row for the analytics table. The server
 * already computes both `lPer100km` and `kmPerL`; the route uses
 * `lPer100km` as the primary display and falls back to `kmPerL` if
 * it's null (e.g. zero km driven → division-by-zero → null).
 *
 * Output format: `"<L/100km> L/100 · <km/L> km/L"` (e.g. "12.34 L/100 · 8.10 km/L")
 * or `"<L/100km> L/100 · —"` when `kmPerL` is null.
 */
export function formatFleetFuelEfficiency(
  lPer100km: number,
  kmPerL: number | null,
): string {
  const left = `${lPer100km.toFixed(2)} L/100`;
  if (kmPerL === null) {
    return `${left} · —`;
  }
  return `${left} · ${kmPerL.toFixed(2)} km/L`;
}

/* ────────── idempotency key generator ────────── */

export type FleetIdempotencyKind =
  | "vehicle"
  | "driver"
  | "trip"
  | "trip-status"
  | "fuel"
  | "repair"
  | "tire";

/**
 * Generate a client-side idempotency key for a fleet write. The format
 * is `${kind}-ui-${Date.now()}` (e.g. `vehicle-ui-1718217600000`) —
 * `Date.now()` is monotonic per tab session, so two clicks within the
 * same tick share a key (and the server's idempotency cache returns the
 * first response on the second). The `${kind}-` prefix is human-greppable
 * in the server's `idempotency_keys` table when an operator is debugging.
 */
export function generateFleetIdempotencyKey(kind: FleetIdempotencyKind): string {
  return `${kind}-ui-${Date.now()}`;
}
