/**
 * status.test.ts — unit tests for the Warehouse pure helpers.
 *
 * Mirrors web-modern/src/lib/cabinet/__tests__/status.test.ts. The
 * helpers consume the Zod-inferred `Warehouse*` types from
 * web-modern/src/lib/api/schemas.ts as their single source of truth
 * and the server-side validation regexes in server/warehouse.js.
 */
import { describe, expect, it } from "vitest";
import type {
  WarehouseAbcRow,
  WarehouseColdStorageReading,
  WarehouseLot,
  WarehouseSerial,
} from "../../api/schemas";
import {
  WAREHOUSE_TABS,
  abcRowCumulative,
  fefoOrderLots,
  forecastReasoningString,
  formatColdStorageHumidity,
  formatColdStorageTemp,
  formatTurnoverDays,
  isAbcBucket,
  isValidLotInput,
  isValidSerialInput,
  warehouseTabFromHash,
  warehouseTabToHash,
} from "../status";
import type { WarehouseTab } from "../types";

/* ────────── fixtures ────────── */

const LOTS: WarehouseLot[] = [
  {
    id: 1,
    productId: "catitem-eggs",
    lotCode: "LOT-2026-001",
    mfgDate: "2026-05-01",
    expiryDate: "2027-06-01",
    harvestDate: null,
    sourceVendorId: null,
    createdAt: "2026-05-01T00:00:00.000Z",
  },
  {
    id: 2,
    productId: "catitem-cheese",
    lotCode: "LOT-2026-002",
    mfgDate: "2026-04-01",
    expiryDate: "2026-08-15",
    harvestDate: "2026-04-01",
    sourceVendorId: "vendor-1",
    createdAt: "2026-04-01T00:00:00.000Z",
  },
  {
    id: 3,
    productId: "catitem-honey",
    lotCode: "LOT-2026-003",
    mfgDate: null,
    expiryDate: null, // honey is shelf-stable — no expiry
    harvestDate: "2026-03-01",
    sourceVendorId: "vendor-2",
    createdAt: "2026-03-01T00:00:00.000Z",
  },
  {
    id: 4,
    productId: "catitem-milk",
    lotCode: "LOT-2026-004",
    mfgDate: "2026-05-15",
    expiryDate: "2026-06-30",
    harvestDate: null,
    sourceVendorId: null,
    createdAt: "2026-05-15T00:00:00.000Z",
  },
];

const SERIALS: WarehouseSerial[] = [
  {
    id: 10,
    productId: "catitem-barcode-scanner",
    serial: "SN-2026-001",
    status: "in_stock",
    currentLocationId: "stockloc-main-warehouse",
    createdAt: "2026-05-01T00:00:00.000Z",
  },
];

const READINGS: WarehouseColdStorageReading[] = [
  {
    id: 100,
    locationId: "stockloc-cold-1",
    recordedAt: "2026-06-10T08:00:00.000Z",
    tempC: 4.0,
    humidity: 75,
    sensorId: "sensor-1",
  },
  {
    id: 101,
    locationId: "stockloc-freezer-1",
    recordedAt: "2026-06-10T09:00:00.000Z",
    tempC: -18.5,
    humidity: null,
    sensorId: "sensor-2",
  },
];

const ABC_ROWS: WarehouseAbcRow[] = [
  { productId: "catitem-eggs", bucket: "A", revenueShare: 0.55, cumulativeShare: 0.55 },
  { productId: "catitem-cheese", bucket: "B", revenueShare: 0.25, cumulativeShare: 0.8 },
  { productId: "catitem-honey", bucket: "C", revenueShare: 0.2, cumulativeShare: 1.0 },
];

/* ────────── WAREHOUSE_TABS ────────── */

describe("WAREHOUSE_TABS", () => {
  it("lists the four canonical warehouse tabs in default render order", () => {
    expect(WAREHOUSE_TABS).toEqual(["lots", "serials", "cold", "analytics"]);
  });
});

/* ────────── fefoOrderLots ────────── */

describe("fefoOrderLots", () => {
  it("orders lots by expiryDate ASC; null expiryDate lots float to the end", () => {
    const out = fefoOrderLots(LOTS);
    expect(out.map((l) => l.id)).toEqual([4, 2, 1, 3]);
  });

  it("does not mutate the input array", () => {
    const snapshot = LOTS.map((l) => l.id);
    fefoOrderLots(LOTS);
    expect(LOTS.map((l) => l.id)).toEqual(snapshot);
  });

  it("handles an empty list", () => {
    expect(fefoOrderLots([])).toEqual([]);
  });

  it("preserves input order for ties on expiryDate (stable sort)", () => {
    const sameExp = "2027-01-01";
    const tie: WarehouseLot[] = [
      { ...LOTS[0], id: 100, expiryDate: sameExp },
      { ...LOTS[0], id: 101, expiryDate: sameExp },
      { ...LOTS[0], id: 102, expiryDate: sameExp },
    ];
    const out = fefoOrderLots(tie);
    expect(out.map((l) => l.id)).toEqual([100, 101, 102]);
  });

  it("treats missing expiryDate (nullish-coalesce branch) as a null sentinel", () => {
    // Malformed runtime value: the schema allows null, but a runtime
    // value may be missing entirely. The helper must not throw —
    // fall back to "no expiry" and float to the end.
    const broken: WarehouseLot = {
      ...LOTS[0],
      id: 999,
      expiryDate: undefined as unknown as string,
    };
    const out = fefoOrderLots([LOTS[1], broken]);
    expect(out.map((l) => l.id)).toEqual([2, 999]);
  });

  it("groups all null-expiry lots together at the end (no interleave)", () => {
    const nullsFirst: WarehouseLot[] = [
      { ...LOTS[0], id: 50, expiryDate: null },
      { ...LOTS[0], id: 51, expiryDate: null },
    ];
    const out = fefoOrderLots([...nullsFirst, LOTS[1], LOTS[3]]);
    // Both null-expiry lots at the end, in their original input order
    expect(out.map((l) => l.id)).toEqual([4, 2, 50, 51]);
  });
});

/* ────────── isValidLotInput ────────── */

describe("isValidLotInput", () => {
  it("returns ok for a well-formed lot code with no dates", () => {
    expect(isValidLotInput({ lotCode: "LOT-2026-001" })).toEqual({ ok: true });
  });

  it("returns ok when expiryDate is a valid YYYY-MM-DD string", () => {
    expect(isValidLotInput({ lotCode: "LOT-2026-001", expiryDate: "2027-06-01" })).toEqual({
      ok: true,
    });
  });

  it("returns ok when expiryDate is null (optional)", () => {
    expect(isValidLotInput({ lotCode: "LOT-2026-001", expiryDate: null })).toEqual({
      ok: true,
    });
  });

  it("fails on an empty lot code", () => {
    const out = isValidLotInput({ lotCode: "" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/required/i);
  });

  it("fails on a whitespace-only lot code (trims first)", () => {
    const out = isValidLotInput({ lotCode: "   " });
    expect(out.ok).toBe(false);
  });

  it("fails on a lot code with lowercase characters (regex is uppercase-only)", () => {
    const out = isValidLotInput({ lotCode: "lot-2026-001" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/\[A-Z0-9\]/);
  });

  it("fails on a lot code that starts with a dash (regex anchors on alnum first char)", () => {
    const out = isValidLotInput({ lotCode: "-LOT-2026" });
    expect(out.ok).toBe(false);
  });

  it("fails when expiryDate is not a YYYY-MM-DD string", () => {
    const out = isValidLotInput({ lotCode: "LOT-2026-001", expiryDate: "06/30/2026" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/YYYY-MM-DD/);
  });

  it("fails when mfgDate is not a YYYY-MM-DD string", () => {
    const out = isValidLotInput({
      lotCode: "LOT-2026-001",
      mfgDate: "not-a-date",
      expiryDate: "2027-01-01",
    });
    expect(out.ok).toBe(false);
  });

  it("fails when expiryDate is before mfgDate (server parity)", () => {
    const out = isValidLotInput({
      lotCode: "LOT-2026-001",
      mfgDate: "2026-05-01",
      expiryDate: "2026-04-01",
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/on or after/);
  });

  it("returns ok when expiryDate equals mfgDate (boundary: 'on or after')", () => {
    expect(
      isValidLotInput({
        lotCode: "LOT-2026-001",
        mfgDate: "2026-05-01",
        expiryDate: "2026-05-01",
      }),
    ).toEqual({ ok: true });
  });

  it("trims surrounding whitespace on the lot code before validating", () => {
    expect(isValidLotInput({ lotCode: "  LOT-2026-001  " })).toEqual({ ok: true });
  });
});

/* ────────── isValidSerialInput ────────── */

describe("isValidSerialInput", () => {
  it("returns ok for a well-formed serial", () => {
    expect(isValidSerialInput({ serial: SERIALS[0].serial })).toEqual({ ok: true });
  });

  it("fails on an empty serial", () => {
    const out = isValidSerialInput({ serial: "" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/required/i);
  });

  it("fails on a whitespace-only serial", () => {
    expect(isValidSerialInput({ serial: "   " }).ok).toBe(false);
  });

  it("fails on a lowercase serial (regex is uppercase-only)", () => {
    const out = isValidSerialInput({ serial: "sn-2026-001" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/\[A-Z0-9\]/);
  });

  it("fails on a serial longer than 64 chars (regex is /.{1,63}/ after the first char)", () => {
    const long = `SN-${"A".repeat(70)}`;
    const out = isValidSerialInput({ serial: long });
    expect(out.ok).toBe(false);
  });

  it("accepts a 64-char serial (boundary)", () => {
    // First char + 63 more = 64 total
    const exact = `S${"A".repeat(63)}`;
    expect(isValidSerialInput({ serial: exact })).toEqual({ ok: true });
  });
});

/* ────────── isAbcBucket ────────── */

describe("isAbcBucket", () => {
  it("returns true for 'A'", () => {
    expect(isAbcBucket("A")).toBe(true);
  });
  it("returns true for 'B'", () => {
    expect(isAbcBucket("B")).toBe(true);
  });
  it("returns true for 'C'", () => {
    expect(isAbcBucket("C")).toBe(true);
  });
  it("returns false for lowercase 'a'", () => {
    expect(isAbcBucket("a")).toBe(false);
  });
  it("returns false for 'D' (out of range)", () => {
    expect(isAbcBucket("D")).toBe(false);
  });
  it("returns false for the empty string", () => {
    expect(isAbcBucket("")).toBe(false);
  });
  it("acts as a TypeScript type guard (assignment narrows)", () => {
    const bucket: string = "B";
    if (isAbcBucket(bucket)) {
      // After the guard, `bucket` is "A" | "B" | "C"
      const narrowed: "A" | "B" | "C" = bucket;
      expect(narrowed).toBe("B");
    }
  });
});

/* ────────── abcRowCumulative ────────── */

describe("abcRowCumulative", () => {
  it("formats 0.55 as '55%'", () => {
    expect(abcRowCumulative({ cumulativeShare: 0.55 })).toBe("55%");
  });

  it("formats 1.0 as '100%'", () => {
    expect(abcRowCumulative({ cumulativeShare: 1.0 })).toBe("100%");
  });

  it("formats 0 as '0%'", () => {
    expect(abcRowCumulative({ cumulativeShare: 0 })).toBe("0%");
  });

  it("rounds half-up (0.555 → 56%)", () => {
    expect(abcRowCumulative({ cumulativeShare: 0.555 })).toBe("56%");
  });

  it("clamps a negative cumulativeShare to '0%' (defensive)", () => {
    expect(abcRowCumulative({ cumulativeShare: -0.1 })).toBe("0%");
  });

  it("falls back to '0%' for NaN", () => {
    expect(abcRowCumulative({ cumulativeShare: Number.NaN })).toBe("0%");
  });

  it("works against the ABC fixture rows", () => {
    expect(abcRowCumulative(ABC_ROWS[0])).toBe("55%");
    expect(abcRowCumulative(ABC_ROWS[1])).toBe("80%");
    expect(abcRowCumulative(ABC_ROWS[2])).toBe("100%");
  });
});

/* ────────── formatTurnoverDays ────────── */

describe("formatTurnoverDays", () => {
  it("formats a positive integer with the օր suffix", () => {
    expect(formatTurnoverDays(15)).toBe("15 օր");
  });

  it("formats 0 as '0 օր'", () => {
    expect(formatTurnoverDays(0)).toBe("0 օր");
  });

  it("rounds a fractional value (3.4 → '3 օր')", () => {
    expect(formatTurnoverDays(3.4)).toBe("3 օր");
  });

  it("rounds half-up (3.5 → '4 օր')", () => {
    expect(formatTurnoverDays(3.5)).toBe("4 օր");
  });

  it("clamps a negative value to '0 օր'", () => {
    expect(formatTurnoverDays(-5)).toBe("0 օր");
  });

  it("falls back to '0 օր' for NaN", () => {
    expect(formatTurnoverDays(Number.NaN)).toBe("0 օր");
  });
});

/* ────────── formatColdStorageTemp ────────── */

describe("formatColdStorageTemp", () => {
  it("formats 4.0 as '4.0°C'", () => {
    expect(formatColdStorageTemp(4.0)).toBe("4.0°C");
  });

  it("formats -18.5 as '-18.5°C'", () => {
    expect(formatColdStorageTemp(READINGS[1].tempC)).toBe("-18.5°C");
  });

  it("formats 0 as '0.0°C'", () => {
    expect(formatColdStorageTemp(0)).toBe("0.0°C");
  });

  it("falls back to '0.0°C' for NaN", () => {
    expect(formatColdStorageTemp(Number.NaN)).toBe("0.0°C");
  });
});

/* ────────── formatColdStorageHumidity ────────── */

describe("formatColdStorageHumidity", () => {
  it("formats 75 as '75%'", () => {
    expect(formatColdStorageHumidity(75)).toBe("75%");
  });

  it("formats 75.4 as '75%' (rounds to whole percent)", () => {
    expect(formatColdStorageHumidity(75.4)).toBe("75%");
  });

  it("formats null as the em-dash placeholder", () => {
    expect(formatColdStorageHumidity(null)).toBe("—");
  });

  it("formats undefined as the em-dash placeholder", () => {
    expect(formatColdStorageHumidity(undefined)).toBe("—");
  });

  it("clamps > 100 to 100% (defensive)", () => {
    expect(formatColdStorageHumidity(120)).toBe("100%");
  });

  it("clamps < 0 to 0% (defensive)", () => {
    expect(formatColdStorageHumidity(-3)).toBe("0%");
  });

  it("falls back to em-dash for NaN", () => {
    expect(formatColdStorageHumidity(Number.NaN)).toBe("—");
  });

  it("matches the legacy format for the cold-storage fixture", () => {
    expect(formatColdStorageHumidity(READINGS[0].humidity)).toBe("75%");
    expect(formatColdStorageHumidity(READINGS[1].humidity)).toBe("—");
  });
});

/* ────────── forecastReasoningString ────────── */

describe("forecastReasoningString", () => {
  it("joins multiple reasoning bullets with ' / '", () => {
    expect(
      forecastReasoningString([
        "reorder to cover 14d demand + 7d safety stock",
        "no recent demand history; baseline reorder of 1 unit suggested for safety",
      ]),
    ).toBe(
      "reorder to cover 14d demand + 7d safety stock / no recent demand history; baseline reorder of 1 unit suggested for safety",
    );
  });

  it("returns a single string unchanged", () => {
    expect(forecastReasoningString(["only one reason"])).toBe("only one reason");
  });

  it("returns the empty string for an empty array (no stray ' / ')", () => {
    expect(forecastReasoningString([])).toBe("");
  });
});

/* ────────── warehouseTabFromHash ────────── */

describe("warehouseTabFromHash", () => {
  it("parses '#lots' to 'lots'", () => {
    expect(warehouseTabFromHash("#lots")).toBe<WarehouseTab>("lots");
  });

  it("parses '#serials' to 'serials'", () => {
    expect(warehouseTabFromHash("#serials")).toBe<WarehouseTab>("serials");
  });

  it("parses '#cold' to 'cold'", () => {
    expect(warehouseTabFromHash("#cold")).toBe<WarehouseTab>("cold");
  });

  it("parses '#analytics' to 'analytics'", () => {
    expect(warehouseTabFromHash("#analytics")).toBe<WarehouseTab>("analytics");
  });

  it("accepts the tab name without a leading '#'", () => {
    expect(warehouseTabFromHash("analytics")).toBe<WarehouseTab>("analytics");
  });

  it("defaults to 'lots' for an empty string", () => {
    expect(warehouseTabFromHash("")).toBe<WarehouseTab>("lots");
  });

  it("defaults to 'lots' for null", () => {
    expect(warehouseTabFromHash(null)).toBe<WarehouseTab>("lots");
  });

  it("defaults to 'lots' for undefined", () => {
    expect(warehouseTabFromHash(undefined)).toBe<WarehouseTab>("lots");
  });

  it("defaults to 'lots' for an unknown tab name", () => {
    expect(warehouseTabFromHash("#unknown")).toBe<WarehouseTab>("lots");
  });

  it("defaults to 'lots' for whitespace-only input", () => {
    expect(warehouseTabFromHash("   ")).toBe<WarehouseTab>("lots");
  });

  it("defaults to 'lots' for a bare '#'", () => {
    expect(warehouseTabFromHash("#")).toBe<WarehouseTab>("lots");
  });
});

/* ────────── warehouseTabToHash ────────── */

describe("warehouseTabToHash", () => {
  it("prefixes the tab with '#'", () => {
    expect(warehouseTabToHash("lots")).toBe("#lots");
    expect(warehouseTabToHash("analytics")).toBe("#analytics");
  });
});

/* ────────── round-trip ────────── */

describe("warehouseTabFromHash / warehouseTabToHash round-trip", () => {
  it("every canonical tab survives a parse → stringify → parse round trip", () => {
    for (const tab of WAREHOUSE_TABS) {
      const hash = warehouseTabToHash(tab);
      const parsed = warehouseTabFromHash(hash);
      expect(parsed).toBe<WarehouseTab>(tab);
    }
  });
});
