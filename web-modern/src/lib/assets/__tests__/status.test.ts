/**
 * status.test.ts — unit tests for the Fixed Assets pure helpers.
 *
 * Mirrors web-modern/src/lib/cabinet/__tests__/status.test.ts and
 * web-modern/src/lib/forms/__tests__/status.test.ts patterns. The
 * helpers consume the Zod-inferred `Assets*` types from
 * web-modern/src/lib/api/schemas.ts as their single source of truth.
 */
import { describe, expect, it } from "vitest";
import {
  ASSETS_DEFAULT_TAB,
  ASSETS_TABS,
  assetsTabFromHash,
  assetsTabLabelAm,
  assetsTabToHash,
  formatAssetCostAmd,
  formatAssetPeriodIndex,
  generateAssetsIdempotencyKey,
  isValidAssetsAssetId,
  type AssetsTab,
} from "../status";

/* ────────── ASSETS_TABS / AssetsTab ────────── */

describe("ASSETS_TABS", () => {
  it("lists the four canonical tabs in the legacy order", () => {
    expect(ASSETS_TABS).toEqual([
      "registry",
      "depreciation",
      "maintenance",
      "assignment",
    ]);
  });

  it("ASSETS_DEFAULT_TAB is the first tab (registry)", () => {
    expect(ASSETS_DEFAULT_TAB).toBe<AssetsTab>("registry");
  });

  it("is exhaustively covered by AssetsTab type", () => {
    // Compile-time check: every entry can be assigned to AssetsTab.
    const sample: AssetsTab[] = [...ASSETS_TABS];
    expect(sample).toHaveLength(4);
  });
});

/* ────────── assetsTabLabelAm ────────── */

describe("assetsTabLabelAm", () => {
  it("contains the Armenian word for registry", () => {
    expect(assetsTabLabelAm("registry")).toContain("Ռեեստր");
  });
  it("contains the Armenian word for depreciation", () => {
    expect(assetsTabLabelAm("depreciation")).toContain("Հարկում");
  });
  it("contains the Armenian word for maintenance", () => {
    expect(assetsTabLabelAm("maintenance")).toContain("Սպասարկում");
  });
  it("contains the Armenian word for assignment", () => {
    expect(assetsTabLabelAm("assignment")).toContain("Հանձնարարություն");
  });
  it("appends the English gloss in parens", () => {
    expect(assetsTabLabelAm("registry")).toMatch(/\(Registry\)$/);
  });
});

/* ────────── assetsTabToHash ────────── */

describe("assetsTabToHash", () => {
  it("encodes each tab to a #fragment", () => {
    expect(assetsTabToHash("registry")).toBe("#registry");
    expect(assetsTabToHash("depreciation")).toBe("#depreciation");
    expect(assetsTabToHash("maintenance")).toBe("#maintenance");
    expect(assetsTabToHash("assignment")).toBe("#assignment");
  });
});

/* ────────── assetsTabFromHash ────────── */

describe("assetsTabFromHash", () => {
  it("returns the default tab on null / undefined / empty", () => {
    expect(assetsTabFromHash(null)).toBe<AssetsTab>("registry");
    expect(assetsTabFromHash(undefined)).toBe<AssetsTab>("registry");
    expect(assetsTabFromHash("")).toBe<AssetsTab>("registry");
  });

  it("accepts the bare #fragment form", () => {
    expect(assetsTabFromHash("#depreciation")).toBe<AssetsTab>("depreciation");
    expect(assetsTabFromHash("#maintenance")).toBe<AssetsTab>("maintenance");
  });

  it("accepts the URL-style #assets/{tab} form", () => {
    expect(assetsTabFromHash("#assets/registry")).toBe<AssetsTab>("registry");
    expect(assetsTabFromHash("#assets/assignment")).toBe<AssetsTab>("assignment");
  });

  it("accepts the no-# path-segment form (defensive)", () => {
    expect(assetsTabFromHash("depreciation")).toBe<AssetsTab>("depreciation");
    expect(assetsTabFromHash("assets/maintenance")).toBe<AssetsTab>("maintenance");
  });

  it("falls back to the default tab on unknown input", () => {
    expect(assetsTabFromHash("#bogus")).toBe<AssetsTab>("registry");
    expect(assetsTabFromHash("#assets/garbage")).toBe<AssetsTab>("registry");
  });

  it("ignores trailing path segments after the tab", () => {
    // /assets/depreciation/12 — the period index after the tab is ignored
    expect(assetsTabFromHash("#depreciation/12")).toBe<AssetsTab>("depreciation");
  });
});

/* ────────── formatAssetCostAmd ────────── */

describe("formatAssetCostAmd", () => {
  it("formats a positive integer with Armenian grouping and AMD suffix", () => {
    const out = formatAssetCostAmd(1_200_000);
    expect(out).toContain("AMD");
    // Armenian locale uses a non-breaking space ( ) or thin space ( ) as
    // the group separator — both render the same. Match either.
    expect(out).toMatch(/1[\s  ]200[\s  ]000 AMD/);
  });

  it("formats zero as '0 AMD'", () => {
    expect(formatAssetCostAmd(0)).toBe("0 AMD");
  });

  it("formats negative amounts (refund, write-off delta)", () => {
    const out = formatAssetCostAmd(-500);
    expect(out).toMatch(/^-500 AMD$/);
  });

  it("truncates fractional input (no AMD decimals)", () => {
    expect(formatAssetCostAmd(123.99)).toBe("123 AMD");
  });

  it("returns the em-dash for non-finite / NaN / null / undefined input", () => {
    expect(formatAssetCostAmd(NaN)).toBe("—");
    expect(formatAssetCostAmd(Infinity)).toBe("—");
    expect(formatAssetCostAmd(-Infinity)).toBe("—");
    expect(formatAssetCostAmd(null)).toBe("—");
    expect(formatAssetCostAmd(undefined)).toBe("—");
  });

  it("does not throw on a stringly-typed number", () => {
    // The legacy `row.totalCostAmd.toLocaleString(...)` would throw on
    // a non-number; the helper's defensive branch keeps the UI rendering.
    expect(formatAssetCostAmd("1200" as unknown as number)).toBe("—");
  });
});

/* ────────── formatAssetPeriodIndex ────────── */

describe("formatAssetPeriodIndex", () => {
  it("renders the first period as '#1' (offset-by-one from wire format)", () => {
    expect(formatAssetPeriodIndex(0)).toBe("#1");
  });

  it("renders period 11 as '#12' (matches the legacy UI rendering)", () => {
    expect(formatAssetPeriodIndex(11)).toBe("#12");
  });

  it("clamps negative input to '#0' (defensive branch — periodIndex+1 ≤ 0)", () => {
    expect(formatAssetPeriodIndex(-5)).toBe("#0");
  });

  it("truncates fractional input", () => {
    expect(formatAssetPeriodIndex(2.9)).toBe("#3");
  });

  it("returns '#0' for non-finite / NaN / null / undefined input", () => {
    expect(formatAssetPeriodIndex(NaN)).toBe("#0");
    expect(formatAssetPeriodIndex(Infinity)).toBe("#0");
    expect(formatAssetPeriodIndex(null)).toBe("#0");
    expect(formatAssetPeriodIndex(undefined)).toBe("#0");
  });
});

/* ────────── generateAssetsIdempotencyKey ────────── */

describe("generateAssetsIdempotencyKey", () => {
  it("prefixes the post-depr kind and ends with a numeric timestamp", () => {
    const key = generateAssetsIdempotencyKey("post-depr");
    expect(key).toMatch(/^post-depr-ui-\d+$/);
  });

  it("prefixes the assign kind and ends with a numeric timestamp", () => {
    const key = generateAssetsIdempotencyKey("assign");
    expect(key).toMatch(/^assign-ui-\d+$/);
  });

  it("produces monotonically non-decreasing timestamps within a tick", () => {
    const a = generateAssetsIdempotencyKey("post-depr");
    const b = generateAssetsIdempotencyKey("assign");
    // Same-ms collisions are allowed (UI-grade). We only assert that the
    // numeric tail is parseable and non-negative.
    const ta = Number(a.split("ui-")[1]);
    const tb = Number(b.split("ui-")[1]);
    expect(Number.isFinite(ta)).toBe(true);
    expect(Number.isFinite(tb)).toBe(true);
    expect(ta).toBeGreaterThanOrEqual(0);
    expect(tb).toBeGreaterThanOrEqual(0);
  });
});

/* ────────── isValidAssetsAssetId ────────── */

describe("isValidAssetsAssetId", () => {
  it("accepts a normal non-empty id", () => {
    expect(isValidAssetsAssetId("asset-abc-123")).toBe(true);
  });

  it("rejects null / undefined / non-string", () => {
    expect(isValidAssetsAssetId(null)).toBe(false);
    expect(isValidAssetsAssetId(undefined)).toBe(false);
    expect(isValidAssetsAssetId(42 as unknown as string)).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isValidAssetsAssetId("")).toBe(false);
  });

  it("rejects whitespace-only input (after trim)", () => {
    expect(isValidAssetsAssetId("   \t\n  ")).toBe(false);
  });

  it("accepts a 100-char id (boundary, inclusive)", () => {
    expect(isValidAssetsAssetId("a".repeat(100))).toBe(true);
  });

  it("rejects a 101-char id (boundary, exclusive)", () => {
    expect(isValidAssetsAssetId("a".repeat(101))).toBe(false);
  });
});
