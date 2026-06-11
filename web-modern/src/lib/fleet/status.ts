/**
 * Pure helpers for the Fleet workspace.
 *
 * Source of truth: server/app.js#fleetApi (the 9 list / POST / PATCH /
 * analytics endpoints + the cold-chain compliance report) and the
 * Zod registry at web-modern/src/lib/api/schemas.ts (the `Fleet*`
 * schemas). The trip status state machine lives in server/fleet.js.
 *
 * These helpers are UI-pure: no React, no I/O, no router. They
 * re-derive small UI affordances (tab labels in Armenian, deep-link
 * hash round-trips, trip-state → Armenian labels, the trip state
 * machine's transition table, cold-chain category labels, fleet-id
 * shortening, fuel-efficiency formatting, idempotency-key
 * generation) and shape server data for rendering. Tested in
 * isolation under vitest.
 *
 * Public surface:
 *  - FLEET_TABS / FleetTab / FLEET_DEFAULT_TAB      readonly tab tuple
 *  - fleetTabLabelAm                                 Armenian-first pill label
 *  - fleetTabFromHash                                resolve a deep-link hash → tab
 *  - fleetTabToHash                                  encode a tab → deep-link hash
 *  - TRIP_STATES / TRIP_STATE_LABELS_AM / TripStateLabelHy
 *                                                   trip status enum + Armenian labels
 *  - fleetTripStatusCanTransition                    state machine: (state, action) → ok?
 *  - fleetTripStatusNextActionFor                    next available action(s) for a state
 *  - COLD_CHAIN_CATEGORIES / coldChainCategoryLabelAm
 *                                                   cold-chain categories
 *  - formatFleetIdShort                              "abc-123def" → "123def"
 *  - formatFleetFuelEfficiency                       "8.5L/100km · 11.76km/L"
 *  - generateFleetIdempotencyKey                     "vehicles-create-ui-1700000000000"
 */
import type {
  FleetColdChainCategory,
  FleetTripAction,
  FleetTripState,
} from "../api/schemas";

/* ────────── type re-exports (UI narrowing) ────────── */

export type { FleetColdChainCategory, FleetTripAction, FleetTripState };

/* ────────── enum constants ────────── */

/** Canonical tab order. The first entry is the default tab the route
 *  opens to. Matches the legacy `web/src/fleet.jsx` tab order. */
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

/** The first tab in FLEET_TABS — used as the default when no hash is set
 *  and to short-circuit the "unknown hash" branch in `fleetTabFromHash`. */
export const FLEET_DEFAULT_TAB: FleetTab = FLEET_TABS[0];

/* ────────── tab labels (Armenian-first) ────────── */

const TAB_LABEL_HY: Record<FleetTab, string> = {
  vehicles: "Տրանսպորտային միջոցներ",
  drivers: "Վարորդներ",
  trips: "Ուղևորություններ",
  fuel: "Վառելիք",
  repairs: "Վերանորոգում",
  tires: "Անվադողեր",
  coldchain: "Սառը շղdelays",
};

const TAB_LABEL_EN: Record<FleetTab, string> = {
  vehicles: "Vehicles",
  drivers: "Drivers",
  trips: "Trips",
  fuel: "Fuel",
  repairs: "Repairs",
  tires: "Tires",
  coldchain: "Cold Chain",
};

/**
 * Armenian-first pill label. Mirrors the legacy fleet.jsx tab order
 * (web/src/fleet.jsx:22-30) so the modern and legacy UIs use the
 * exact same Armenian string. Cold chain label uses "Սdelays շdelayta"
 * transliteration for compatibility with the legacy UI; the new app
 * uses the proper Armenian "Սdelays շdelayta" — when the i18n layer
 * lands (Phase 9), the Armenian text can be tightened without
 * breaking the API.
 */
export function fleetTabLabelAm(tab: FleetTab): string {
  return `${TAB_LABEL_HY[tab]} (${TAB_LABEL_EN[tab]})`;
}

/* ────────── deep-link hash round-trip ────────── */

/**
 * Encode a tab to its deep-link hash fragment. Bare tab id (e.g.
 * `#trips`) — no prefix — so copy-paste stays short.
 */
export function fleetTabToHash(tab: FleetTab): string {
  return `#${tab}`;
}

/**
 * Resolve a deep-link hash to a tab. Accepts the bare form (`#trips`),
 * the URL-style form (`#fleet/trips`), and the `window.location.hash`
 * value (which Chrome prefixes with `#`). Returns the default tab on
 * any unrecognised input — never throws.
 */
export function fleetTabFromHash(hash: string | null | undefined): FleetTab {
  if (typeof hash !== "string" || hash.length === 0) {
    return FLEET_DEFAULT_TAB;
  }
  // Strip the leading "#" and any "/fleet/" prefix the route may have added.
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  const tail = stripped.startsWith("fleet/") ? stripped.slice("fleet/".length) : stripped;
  const head = tail.split("/")[0];
  if ((FLEET_TABS as readonly string[]).includes(head)) {
    return head as FleetTab;
  }
  return FLEET_DEFAULT_TAB;
}

/* ────────── trip state enum + Armenian labels ────────── */

export const TRIP_STATES: readonly FleetTripState[] = [
  "planned",
  "in_transit",
  "arrived",
  "cancelled",
] as const;

export const TRIP_STATE_LABELS_AM: Record<FleetTripState, string> = {
  planned: "Պլանավորված",
  in_transit: "Ճdelays ընթացքում",
  arrived: "Հասել է",
  cancelled: "Չեղարկված",
};

export const TRIP_STATE_LABELS_EN: Record<FleetTripState, string> = {
  planned: "Planned",
  in_transit: "In transit",
  arrived: "Arrived",
  cancelled: "Cancelled",
};

/**
 * Combined Armenian-first label for a trip state. Used by the trip
 * table's status pill.
 */
export function tripStateLabelArm(state: FleetTripState): string {
  return `${TRIP_STATE_LABELS_AM[state]} (${TRIP_STATE_LABELS_EN[state]})`;
}

/* ────────── trip state machine ────────── */

/**
 * Trip status state machine (mirrors server/fleet.js#applyTripTransition).
 *
 *   planned    --departed-->  in_transit
 *   in_transit --arrived-->   arrived
 *   planned    --cancelled--> cancelled
 *   in_transit --cancelled--> cancelled
 *   arrived    --(terminal)--> no further actions
 *   cancelled  --(terminal)--> no further actions
 *
 * Returns true when the (state, action) pair is valid. The route's
 * PATCH buttons (`departed` / `arrived` / `cancelled`) use this to
 * decide which buttons to render per row — only the valid action for
 * the row's current state shows.
 */
export function fleetTripStatusCanTransition(
  state: FleetTripState,
  action: FleetTripAction,
): boolean {
  if (state === "planned") {
    return action === "departed" || action === "cancelled";
  }
  if (state === "in_transit") {
    return action === "arrived" || action === "cancelled";
  }
  // arrived + cancelled are terminal — no transitions allowed.
  return false;
}

/**
 * List the valid next actions for a given trip state. The route can
 * map this to a button set; consumers that want a single
 * "next-action" affordance can just take the first entry.
 *
 * Returns an empty array for terminal states.
 */
export function fleetTripStatusNextActionFor(state: FleetTripState): FleetTripAction[] {
  if (state === "planned") return ["departed", "cancelled"];
  if (state === "in_transit") return ["arrived", "cancelled"];
  return [];
}

/* ────────── cold-chain categories ────────── */

export const COLD_CHAIN_CATEGORIES: readonly FleetColdChainCategory[] = [
  "dairy",
  "frozen",
  "produce",
  "meat",
  "default",
] as const;

const COLD_CHAIN_CATEGORY_LABELS_AM: Record<FleetColdChainCategory, string> = {
  dairy: "Կաթնամթdelays",
  frozen: "Սdelays",
  produce: "Միրգ-բdelays",
  meat: "Միս",
  default: "Ընդհանdelays",
};

const COLD_CHAIN_CATEGORY_LABELS_EN: Record<FleetColdChainCategory, string> = {
  dairy: "Dairy",
  frozen: "Frozen",
  produce: "Produce",
  meat: "Meat",
  default: "Default",
};

/**
 * Armenian-first label for a cold-chain category. Used in the
 * cold-chain form's <select> and the compliance report header.
 */
export function coldChainCategoryLabelAm(category: FleetColdChainCategory): string {
  return `${COLD_CHAIN_CATEGORY_LABELS_AM[category]} (${COLD_CHAIN_CATEGORY_LABELS_EN[category]})`;
}

/* ────────── fleet id shortening ────────── */

/**
 * Return the short suffix of a fleet id — used in the trip / vehicle
 * table to render compact row keys while keeping the full id on a
 * `data-id` attribute for the test. Strips a leading UUID-style dash
 * segment (so `abc-123def` → `123def`) and falls back to the input
 * when no dash is present.
 */
export function formatFleetIdShort(id: string | null | undefined): string {
  if (typeof id !== "string" || id.length === 0) return "—";
  const dash = id.lastIndexOf("-");
  if (dash < 0 || dash === id.length - 1) return id;
  return id.slice(dash + 1);
}

/* ────────── fuel efficiency formatting ────────── */

const FUEL_FORMATTER_2DP = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format a fuel-efficiency row as "L/100km · km/L". The server
 * returns both `lPer100km` (always set) and `kmPerL` (null when the
 * vehicle has no km logged yet — division-by-zero guard). The "·"
 * separator keeps it compact; we deliberately don't use a unicode
 * middle dot glyph to avoid font rendering surprises.
 *
 * `null` / `undefined` kmPerL falls back to the L/100km figure only
 * with "—" for the second half.
 */
export function formatFleetFuelEfficiency(
  lPer100km: number | null | undefined,
  kmPerL: number | null | undefined,
): string {
  if (typeof lPer100km !== "number" || !Number.isFinite(lPer100km)) return "—";
  const l100 = FUEL_FORMATTER_2DP.format(lPer100km);
  if (typeof kmPerL !== "number" || !Number.isFinite(kmPerL)) {
    return `${l100}L/100km`;
  }
  return `${l100}L/100km · ${FUEL_FORMATTER_2DP.format(kmPerL)}km/L`;
}

/* ────────── idempotency key generation ────────── */

/** UI-grade idempotency-key kinds. The server has its own cache
 *  keyed on this string. */
export type FleetIdempotencyKind =
  | "vehicles-create"
  | "drivers-create"
  | "trips-create"
  | "trips-status"
  | "fuel-create"
  | "repairs-create"
  | "tires-install";

/**
 * Generate a UI-grade idempotency key for a fleet mutation. Mirrors
 * the legacy fleet.jsx UI keys (line 432: `ui-${kind}-${Date.now()}`)
 * but without the leading "ui-" prefix — the server's
 * `lookupIdempotent` table is keyed on the whole string and we want
 * the kind to sort first.
 *
 * Note: this is NOT cryptographically unique — two clicks in the
 * same millisecond could collide. The server's idempotency cache
 * window is short, so collisions only affect in-flight retries.
 */
export function generateFleetIdempotencyKey(kind: FleetIdempotencyKind): string {
  return `${kind}-ui-${Date.now()}`;
}
