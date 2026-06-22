/**
 * status.test.ts — unit tests for the Fleet pure helpers.
 *
 * Mirrors web-modern/src/lib/cabinet/__tests__/status.test.ts pattern.
 * The helpers consume the Zod-inferred `Fleet*` types from
 * web-modern/src/lib/api/schemas.ts as their single source of truth.
 */
import { describe, expect, it } from "vitest";
import {
  COLD_CHAIN_CATEGORIES,
  FLEET_TABS,
  TRIP_STATES,
  coldChainCategoryLabelAm,
  fleetTabFromHash,
  fleetTabLabelAm,
  fleetTabToHash,
  fleetTripStatusActionLabelAm,
  fleetTripStatusCanTransition,
  fleetTripStatusLabelAm,
  fleetTripStatusNextActionFor,
  formatFleetFuelEfficiency,
  formatFleetIdShort,
  generateFleetIdempotencyKey,
  type FleetTab,
  type FleetTripAction,
  type FleetTripState,
} from "../status";

/* ────────── enum constants ────────── */

describe("FLEET_TABS", () => {
  it("lists the seven canonical tabs in order", () => {
    expect(FLEET_TABS).toEqual([
      "vehicles",
      "drivers",
      "trips",
      "fuel",
      "repairs",
      "tires",
      "coldchain",
    ]);
  });
});

describe("TRIP_STATES", () => {
  it("lists the four canonical trip states in order", () => {
    expect(TRIP_STATES).toEqual(["planned", "in_transit", "arrived", "cancelled"]);
  });
});

describe("COLD_CHAIN_CATEGORIES", () => {
  it("lists the five canonical cold-chain categories in order", () => {
    expect(COLD_CHAIN_CATEGORIES).toEqual([
      "dairy",
      "frozen",
      "produce",
      "meat",
      "default",
    ]);
  });
});

/* ────────── fleetTabLabelAm ────────── */

describe("fleetTabLabelAm", () => {
  it("returns the Armenian label for each of the seven tabs", () => {
    expect(fleetTabLabelAm("vehicles")).toBe("Տրանսպորտ");
    expect(fleetTabLabelAm("drivers")).toBe("Վարորդներ");
    expect(fleetTabLabelAm("trips")).toBe("Ճանապարհորդություններ");
    expect(fleetTabLabelAm("fuel")).toBe("Վառելիք");
    expect(fleetTabLabelAm("repairs")).toBe("Վերանորոգում");
    expect(fleetTabLabelAm("tires")).toBe("Անվադողեր");
    expect(fleetTabLabelAm("coldchain")).toBe("Սառը շղթա");
  });

  it("returns the raw key for an unknown tab name (forward-compat fallback)", () => {
    expect(fleetTabLabelAm("telemetry")).toBe("telemetry");
  });
});

/* ────────── fleetTabToHash / fleetTabFromHash ────────── */

describe("fleetTabToHash / fleetTabFromHash", () => {
  it("round-trips each of the seven tabs", () => {
    for (const tab of FLEET_TABS) {
      expect(fleetTabFromHash(fleetTabToHash(tab))).toBe<FleetTab>(tab);
    }
  });

  it("fleetTabToHash is the identity (the hash IS the tab key)", () => {
    expect(fleetTabToHash("vehicles")).toBe("vehicles");
    expect(fleetTabToHash("coldchain")).toBe("coldchain");
  });

  it("fleetTabFromHash strips a leading '#' before lookup", () => {
    expect(fleetTabFromHash("#fuel")).toBe<FleetTab>("fuel");
  });

  it("fleetTabFromHash accepts nested route fragments", () => {
    expect(fleetTabFromHash("#fleet/coldchain")).toBe<FleetTab>("coldchain");
    expect(fleetTabFromHash("fleet/fuel")).toBe<FleetTab>("fuel");
  });

  it("fleetTabFromHash trims whitespace before lookup", () => {
    expect(fleetTabFromHash("  trips  ")).toBe<FleetTab>("trips");
  });

  it("fleetTabFromHash falls back to 'vehicles' for an unknown hash", () => {
    expect(fleetTabFromHash("nonexistent")).toBe<FleetTab>("vehicles");
  });

  it("fleetTabFromHash falls back to 'vehicles' for an empty hash", () => {
    expect(fleetTabFromHash("")).toBe<FleetTab>("vehicles");
  });
});

/* ────────── TRIP_STATE_LABELS_AM (fleetTripStatusLabelAm) ────────── */

describe("fleetTripStatusLabelAm", () => {
  it("returns the Armenian label for each of the four states", () => {
    expect(fleetTripStatusLabelAm("planned")).toBe("Պլանավորված");
    expect(fleetTripStatusLabelAm("in_transit")).toBe("Ճանապարհին");
    expect(fleetTripStatusLabelAm("arrived")).toBe("Ժամանել է");
    expect(fleetTripStatusLabelAm("cancelled")).toBe("Չեղարկված");
  });

  it("returns the raw status for an unknown state (forward-compat fallback)", () => {
    expect(fleetTripStatusLabelAm("loading")).toBe("loading");
  });
});

/* ────────── TRIP_ACTION_LABELS_AM (fleetTripStatusActionLabelAm) ────────── */

describe("fleetTripStatusActionLabelAm", () => {
  it("returns the Armenian label for each of the three actions", () => {
    expect(fleetTripStatusActionLabelAm("departed")).toBe("Մեկնել");
    expect(fleetTripStatusActionLabelAm("arrived")).toBe("Ժամանել");
    expect(fleetTripStatusActionLabelAm("cancelled")).toBe("Չեղարկել");
  });

  it("returns the raw action for an unknown action (forward-compat fallback)", () => {
    expect(fleetTripStatusActionLabelAm("frobnicated")).toBe("frobnicated");
  });
});

/* ────────── coldChainCategoryLabelAm ────────── */

describe("coldChainCategoryLabelAm", () => {
  it("returns an Armenian-first label with an English gloss for each category", () => {
    expect(coldChainCategoryLabelAm("dairy")).toBe("Կաթնամթերք (Dairy)");
    expect(coldChainCategoryLabelAm("frozen")).toBe("Սառեցված (Frozen)");
    expect(coldChainCategoryLabelAm("produce")).toBe("Մրգեր / Բանջարեղեն (Produce)");
    expect(coldChainCategoryLabelAm("meat")).toBe("Միս (Meat)");
    expect(coldChainCategoryLabelAm("default")).toBe("Ընդհանուր (Default)");
  });

  it("returns the raw key for an unknown category (forward-compat fallback)", () => {
    expect(coldChainCategoryLabelAm("pharma")).toBe("pharma");
  });
});

/* ────────── state machine: fleetTripStatusCanTransition ────────── */

describe("fleetTripStatusCanTransition", () => {
  it("allows planned + departed (planned → in_transit)", () => {
    expect(fleetTripStatusCanTransition("planned", "departed")).toBe(true);
  });

  it("allows planned + cancelled (planned → cancelled)", () => {
    expect(fleetTripStatusCanTransition("planned", "cancelled")).toBe(true);
  });

  it("forbids planned + arrived (no skip-to-arrival)", () => {
    expect(fleetTripStatusCanTransition("planned", "arrived")).toBe(false);
  });

  it("allows in_transit + arrived (in_transit → arrived)", () => {
    expect(fleetTripStatusCanTransition("in_transit", "arrived")).toBe(true);
  });

  it("allows in_transit + cancelled (in_transit → cancelled)", () => {
    expect(fleetTripStatusCanTransition("in_transit", "cancelled")).toBe(true);
  });

  it("forbids in_transit + departed (already departed)", () => {
    expect(fleetTripStatusCanTransition("in_transit", "departed")).toBe(false);
  });

  it("forbids every action from terminal 'arrived'", () => {
    for (const action of ["departed", "arrived", "cancelled"] as FleetTripAction[]) {
      expect(fleetTripStatusCanTransition("arrived", action)).toBe(false);
    }
  });

  it("forbids every action from terminal 'cancelled'", () => {
    for (const action of ["departed", "arrived", "cancelled"] as FleetTripAction[]) {
      expect(fleetTripStatusCanTransition("cancelled", action)).toBe(false);
    }
  });
});

/* ────────── state machine: fleetTripStatusNextActionFor ────────── */

describe("fleetTripStatusNextActionFor", () => {
  it("returns [departed, cancelled] for planned", () => {
    expect(fleetTripStatusNextActionFor("planned")).toEqual([
      "departed",
      "cancelled",
    ]);
  });

  it("returns [arrived, cancelled] for in_transit", () => {
    expect(fleetTripStatusNextActionFor("in_transit")).toEqual([
      "arrived",
      "cancelled",
    ]);
  });

  it("returns an empty array for terminal 'arrived'", () => {
    expect(fleetTripStatusNextActionFor("arrived")).toEqual([]);
  });

  it("returns an empty array for terminal 'cancelled'", () => {
    expect(fleetTripStatusNextActionFor("cancelled")).toEqual([]);
  });

  it("returns a fresh array on each call (no shared mutable reference)", () => {
    const a = fleetTripStatusNextActionFor("planned");
    const b = fleetTripStatusNextActionFor("planned");
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("every action returned is recognized by fleetTripStatusCanTransition", () => {
    for (const state of TRIP_STATES) {
      for (const action of fleetTripStatusNextActionFor(state)) {
        expect(fleetTripStatusCanTransition(state, action)).toBe(true);
      }
    }
  });

  it("returns false for an unknown state (defensive fallback in canTransition)", () => {
    // Cast bypasses the type guard so we can hit the runtime fallback.
    const bogus = "loading" as unknown as FleetTripState;
    expect(fleetTripStatusCanTransition(bogus, "departed")).toBe(false);
  });

  it("returns an empty array for an unknown state (defensive fallback in nextActionFor)", () => {
    // Cast bypasses the type guard so we can hit the runtime fallback.
    const bogus = "loading" as unknown as FleetTripState;
    expect(fleetTripStatusNextActionFor(bogus)).toEqual([]);
  });
});

/* ────────── formatFleetIdShort ────────── */

describe("formatFleetIdShort", () => {
  it("returns the last 6 characters of a long id (matches legacy `t.id.slice(-6)`)", () => {
    expect(formatFleetIdShort("fleet-vehicle-abc123")).toBe("abc123");
    expect(formatFleetIdShort("veh-999999")).toBe("999999");
  });

  it("returns the full id when shorter than 6 characters (slice clamps to 0)", () => {
    expect(formatFleetIdShort("abc")).toBe("abc");
  });

  it("returns the full id when exactly 6 characters", () => {
    expect(formatFleetIdShort("abc123")).toBe("abc123");
  });

  it("does not truncate ids ending in a dash", () => {
    expect(formatFleetIdShort("trailing-")).toBe("trailing-");
  });

  it("renders an em-dash for nullish ids", () => {
    expect(formatFleetIdShort(null)).toBe("—");
    expect(formatFleetIdShort(undefined)).toBe("—");
  });

  it("preserves Armenian / unicode characters in the tail", () => {
    expect(formatFleetIdShort("prefix-ավտո-123")).toBe("ավտո-123".slice(-6));
  });
});

/* ────────── formatFleetFuelEfficiency ────────── */

describe("formatFleetFuelEfficiency", () => {
  it("formats L/100km and km/L to 2 decimal places, joined by ' · '", () => {
    expect(formatFleetFuelEfficiency(12.345, 8.0987)).toBe(
      "12.35L/100km · 8.10km/L",
    );
  });

  it("omits the km/L portion when kmPerL is null (zero-km edge)", () => {
    expect(formatFleetFuelEfficiency(0, null)).toBe("0.00L/100km");
  });

  it("renders correctly for integer values (no fractional part)", () => {
    expect(formatFleetFuelEfficiency(10, 10)).toBe("10.00L/100km · 10.00km/L");
  });

  it("renders correctly for very small fractions (3+ decimals clamp to 2)", () => {
    expect(formatFleetFuelEfficiency(0.001, 0.001)).toBe("0.00L/100km · 0.00km/L");
  });
});

/* ────────── generateFleetIdempotencyKey ────────── */

describe("generateFleetIdempotencyKey", () => {
  it("starts with the kind prefix, then '-ui-', then a numeric timestamp", () => {
    const key = generateFleetIdempotencyKey("vehicle");
    expect(key).toMatch(/^vehicle-ui-\d+$/);
  });

  it("uses the correct kind for each writer endpoint", () => {
    expect(generateFleetIdempotencyKey("vehicle")).toMatch(/^vehicle-ui-/);
    expect(generateFleetIdempotencyKey("driver")).toMatch(/^driver-ui-/);
    expect(generateFleetIdempotencyKey("trip")).toMatch(/^trip-ui-/);
    expect(generateFleetIdempotencyKey("trip-status")).toMatch(/^trip-status-ui-/);
    expect(generateFleetIdempotencyKey("fuel")).toMatch(/^fuel-ui-/);
    expect(generateFleetIdempotencyKey("repair")).toMatch(/^repair-ui-/);
    expect(generateFleetIdempotencyKey("tire")).toMatch(/^tire-ui-/);
  });

  it("returns a strictly non-decreasing timestamp across consecutive calls (monotonic Date.now)", async () => {
    const first = generateFleetIdempotencyKey("vehicle");
    await new Promise((r) => setTimeout(r, 2));
    const second = generateFleetIdempotencyKey("vehicle");
    const firstTs = Number(first.split("-ui-")[1]);
    const secondTs = Number(second.split("-ui-")[1]);
    expect(secondTs).toBeGreaterThanOrEqual(firstTs);
  });
});
