/**
 * status.test.ts — unit tests for the Greenhouse pure helpers.
 *
 * Pattern mirrors web-modern/src/lib/purchase/__tests__/status.test.ts.
 * Armenian label assertions verify the label is non-empty and starts
 * with the expected first letter from the legacy file.
 */
import { describe, it, expect } from "vitest";
import {
  GREENHOUSE_TABS,
  greenhouseTabLabelAm,
  greenhouseTabToHash,
  greenhouseTabFromHash,
  CROP_KINDS,
  cropKindLabelAm,
  GLAZING_KINDS,
  glazingKindLabelAm,
  HEATING_KINDS,
  heatingKindLabelAm,
  IRRIGATION_KINDS,
  irrigationKindLabelAm,
  QUALITY_GRADES,
  qualityGradeLabelAm,
  GREENHOUSE_AI_INTENTS,
  formatGreenhouseGddRow,
  formatGreenhouseEnergyRow,
  formatGreenhouseYieldRow,
  isValidGreenhousePeriodKey,
  isValidGreenhouseGddDateRange,
  canCreateZone,
  canCreateCrop,
  canRecordHarvest,
  generateGreenhouseIdempotencyKey,
} from "../status";

/* ────────── TABS ────────── */

describe("GREENHOUSE_TABS", () => {
  it("has 7 entries in expected order", () => {
    expect(GREENHOUSE_TABS).toEqual([
      "house",
      "zone",
      "crop",
      "climate",
      "energy",
      "bioprotection",
      "harvest",
    ]);
  });
});

describe("greenhouseTabLabelAm", () => {
  it("returns non-empty Armenian label for each tab", () => {
    for (const tab of GREENHOUSE_TABS) {
      const label = greenhouseTabLabelAm(tab);
      expect(label).toBeTruthy();
      expect(label.length).toBeGreaterThan(1);
      // All labels should start with an Armenian capital letter (U+0531..U+0556)
      expect(label.charCodeAt(0)).toBeGreaterThanOrEqual(0x0531);
      expect(label.charCodeAt(0)).toBeLessThanOrEqual(0x0556);
    }
  });
  it("first letter matches legacy first letter for each tab", () => {
    // From web/src/greenhouse.jsx lines 4-10:
    const expectedFirst: Record<string, string> = {
      house: "Ջ", // Ջdelays
      zone: "Գ", // Գdelays
      crop: "Կ", // Կdelays
      climate: "Կ", // Կdelays
      energy: "Է", // Էdelays
      bioprotection: "Պ", // Պdelays
      harvest: "Բ", // Բdelays
    };
    for (const [tab, first] of Object.entries(expectedFirst)) {
      expect(greenhouseTabLabelAm(tab).charAt(0)).toBe(first);
    }
  });
  it("falls back to input for unknown tab", () => {
    expect(greenhouseTabLabelAm("xyz")).toBe("xyz");
    expect(greenhouseTabLabelAm("")).toBe("");
  });
});

describe("greenhouseTabToHash / FromHash", () => {
  it("round-trips each tab", () => {
    for (const tab of GREENHOUSE_TABS) {
      expect(greenhouseTabFromHash(greenhouseTabToHash(tab))).toBe(tab);
    }
  });
  it("strips leading #", () => {
    expect(greenhouseTabFromHash("#crop")).toBe("crop");
  });
  it("falls back to 'house' for unknown hash", () => {
    expect(greenhouseTabFromHash("garbage")).toBe("house");
    expect(greenhouseTabFromHash("")).toBe("house");
  });
});

/* ────────── CROP KINDS ────────── */

describe("CROP_KINDS", () => {
  it("has all 6 expected kinds", () => {
    expect(CROP_KINDS).toEqual([
      "tomato",
      "cucumber",
      "pepper",
      "lettuce",
      "strawberry",
      "herb",
    ]);
  });
});

describe("cropKindLabelAm", () => {
  it("first letter matches legacy first letter for each kind", () => {
    // From web/src/greenhouse.jsx lines 15-20:
    const expectedFirst: Record<string, string> = {
      tomato: "Լ", // Լodelays
      cucumber: "Վ", // Վdelays
      pepper: "Պ", // Պdelays
      lettuce: "Հ", // Հdelays
      strawberry: "Ե", // Եdelays
      herb: "Կ", // Կdelays
    };
    for (const [kind, first] of Object.entries(expectedFirst)) {
      expect(cropKindLabelAm(kind).charAt(0)).toBe(first);
    }
  });
  it("falls back to input for unknown kind", () => {
    expect(cropKindLabelAm("cannabis")).toBe("cannabis");
  });
});

/* ────────── GLAZING ────────── */

describe("GLAZING_KINDS + glazingKindLabelAm", () => {
  it("has 3 kinds with Armenian-starting labels", () => {
    expect(GLAZING_KINDS).toEqual(["glass", "poly", "film"]);
    for (const k of GLAZING_KINDS) {
      const label = glazingKindLabelAm(k);
      expect(label).toBeTruthy();
      expect(label.charCodeAt(0)).toBeGreaterThanOrEqual(0x0531);
      expect(label.charCodeAt(0)).toBeLessThanOrEqual(0x0556);
    }
  });
});

/* ────────── HEATING ────────── */

describe("HEATING_KINDS + heatingKindLabelAm", () => {
  it("has 4 kinds with Armenian-starting labels", () => {
    expect(HEATING_KINDS).toEqual(["gas", "electric", "biomass", "geothermal"]);
    for (const k of HEATING_KINDS) {
      const label = heatingKindLabelAm(k);
      expect(label).toBeTruthy();
      expect(label.charCodeAt(0)).toBeGreaterThanOrEqual(0x0531);
      expect(label.charCodeAt(0)).toBeLessThanOrEqual(0x0556);
    }
  });
});

/* ────────── IRRIGATION ────────── */

describe("IRRIGATION_KINDS + irrigationKindLabelAm", () => {
  it("has 4 kinds with Armenian-starting labels", () => {
    expect(IRRIGATION_KINDS).toEqual(["drip", "sprinkler", "flood", "manual"]);
    for (const k of IRRIGATION_KINDS) {
      const label = irrigationKindLabelAm(k);
      expect(label).toBeTruthy();
      expect(label.charCodeAt(0)).toBeGreaterThanOrEqual(0x0531);
      expect(label.charCodeAt(0)).toBeLessThanOrEqual(0x0556);
    }
  });
});

/* ────────── QUALITY GRADES ────────── */

describe("QUALITY_GRADES", () => {
  it("has 3 entries A, B, C", () => {
    expect(QUALITY_GRADES).toEqual(["A", "B", "C"]);
    expect(qualityGradeLabelAm("A")).toBe("A");
    expect(qualityGradeLabelAm("B")).toBe("B");
    expect(qualityGradeLabelAm("C")).toBe("C");
  });
});

/* ────────── AI INTENTS ────────── */

describe("GREENHOUSE_AI_INTENTS", () => {
  it("has 3 known intents", () => {
    expect(GREENHOUSE_AI_INTENTS).toEqual([
      "yield-forecast",
      "climate-anomaly",
      "pest-risk",
    ]);
  });
});

/* ────────── formatGreenhouseGddRow ────────── */

describe("formatGreenhouseGddRow", () => {
  it("includes base temp, GDD count, sample size, and նմdelays (samples) label", () => {
    const out = formatGreenhouseGddRow({
      baseTempC: 10,
      growingDegreeDays: 245.7,
      sampleSize: 30,
    });
    expect(out).toContain("GDD");
    expect(out).toContain("10");
    expect(out).toContain("245.7");
    expect(out).toContain("30");
    // Should contain նdelay (nmushner = "samples" in Armenian) — first 3 chars are ն+մ+ո
    expect(out).toContain("նմո");
  });
});

/* ────────── formatGreenhouseEnergyRow ────────── */

describe("formatGreenhouseEnergyRow", () => {
  it("joins total + per-unit lines with newline", () => {
    const out = formatGreenhouseEnergyRow({
      totalKwh: 1200,
      totalGasM3: 45,
      totalKg: 800,
      kwhPerKg: 1.5,
      gasM3PerKg: 0.056,
    });
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("1200");
    expect(lines[0]).toContain("45");
    expect(lines[0]).toContain("800");
    expect(lines[1]).toContain("1.5");
    expect(lines[1]).toContain("0.056");
  });
  it("first line starts with Ըն (Total)", () => {
    const out = formatGreenhouseEnergyRow({
      totalKwh: 1,
      totalGasM3: 1,
      totalKg: 1,
      kwhPerKg: 1,
      gasM3PerKg: 1,
    });
    expect(out.charAt(0)).toBe("Ը"); // Ընդ...
    expect(out.charAt(1)).toBe("ն"); // Ըն...
  });
});

/* ────────── formatGreenhouseYieldRow ────────── */

describe("formatGreenhouseYieldRow", () => {
  it("renders crop label + expected + actual + percent", () => {
    const out = formatGreenhouseYieldRow({
      cropId: "c-1",
      cropKind: "tomato",
      expectedKg: 100,
      actualKg: 85,
      pctOfForecast: 85,
    });
    expect(out).toContain("100");
    expect(out).toContain("85");
    expect(out).toContain("85%");
    // Should contain crop label "Լodelays" — first char Լ
    expect(out.charAt(0)).toBe("Լ");
  });
  it("defaults pctOfForecast to 0", () => {
    const out = formatGreenhouseYieldRow({
      cropId: "c-2",
      cropKind: "cucumber",
      expectedKg: 50,
      actualKg: 40,
      pctOfForecast: null,
    });
    expect(out).toContain("0%");
  });
});

/* ────────── validators ────────── */

describe("isValidGreenhousePeriodKey", () => {
  it("accepts YYYY-MM", () => {
    expect(isValidGreenhousePeriodKey("2026-06")).toBe(true);
  });
  it("rejects malformed", () => {
    expect(isValidGreenhousePeriodKey("2026-6")).toBe(false);
    expect(isValidGreenhousePeriodKey("2026-06-01")).toBe(false);
    expect(isValidGreenhousePeriodKey("garbage")).toBe(false);
  });
});

describe("isValidGreenhouseGddDateRange", () => {
  it("accepts valid range", () => {
    expect(
      isValidGreenhouseGddDateRange("2026-06-01", "2026-06-30"),
    ).toEqual({ ok: true });
  });
  it("rejects invalid from", () => {
    const r = isValidGreenhouseGddDateRange("2026-6-1", "2026-06-30");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/from/);
  });
  it("rejects invalid to", () => {
    const r = isValidGreenhouseGddDateRange("2026-06-01", "06-30");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/to/);
  });
  it("rejects inverted range", () => {
    const r = isValidGreenhouseGddDateRange("2026-06-30", "2026-06-01");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/after/);
  });
});

/* ────────── cross-tab guards ────────── */

describe("canCreateZone", () => {
  it("true for non-empty string", () => {
    expect(canCreateZone("h-1")).toBe(true);
  });
  it("false for null, empty, or non-string", () => {
    expect(canCreateZone(null)).toBe(false);
    expect(canCreateZone("")).toBe(false);
    expect(canCreateZone(undefined as unknown as string | null)).toBe(false);
  });
});

describe("canCreateCrop", () => {
  it("true for non-empty string", () => {
    expect(canCreateCrop("z-1")).toBe(true);
  });
  it("false for null or empty", () => {
    expect(canCreateCrop(null)).toBe(false);
    expect(canCreateCrop("")).toBe(false);
  });
});

describe("canRecordHarvest", () => {
  it("true for non-empty string", () => {
    expect(canRecordHarvest("c-1")).toBe(true);
  });
  it("false for null or empty", () => {
    expect(canRecordHarvest(null)).toBe(false);
    expect(canRecordHarvest("")).toBe(false);
  });
});

/* ────────── idempotency ────────── */

describe("generateGreenhouseIdempotencyKey", () => {
  it("embeds the prefix", () => {
    expect(generateGreenhouseIdempotencyKey("ui-house")).toMatch(/^ui-house-/);
    expect(generateGreenhouseIdempotencyKey("ui-zone")).toMatch(/^ui-zone-/);
    expect(generateGreenhouseIdempotencyKey("ui-crop")).toMatch(/^ui-crop-/);
    expect(generateGreenhouseIdempotencyKey("ui-bio")).toMatch(/^ui-bio-/);
    expect(generateGreenhouseIdempotencyKey("ui-harv")).toMatch(/^ui-harv-/);
    expect(generateGreenhouseIdempotencyKey("ui-ai")).toMatch(/^ui-ai-/);
  });
  it("generates unique keys on each call", async () => {
    const a = generateGreenhouseIdempotencyKey("ui-house");
    await new Promise((r) => setTimeout(r, 2));
    const b = generateGreenhouseIdempotencyKey("ui-house");
    expect(a).not.toBe(b);
  });
});
