/**
 * status.test.ts — unit tests for the Procurement extension helpers.
 *
 * Mirrors web-modern/src/lib/cabinet/__tests__/status.test.ts. The
 * helpers consume the Zod-inferred `Procurement*` types from
 * web-modern/src/lib/api/schemas.ts as their single source of truth.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ALLOCATION_METHODS,
  LANDED_COST_KINDS,
  PROCUREMENT_TABS,
  allocationMethodLabelAm,
  formatPrice,
  formatVendorScore,
  generateIdempotencyKey,
  isAllocationMethod,
  isLandedCostKind,
  landedCostKindLabelAm,
  procurementTabFromHash,
  procurementTabToHash,
  validateRequisitionInput,
  type IdempotencyKeyKind,
  type ProcurementTab,
} from "../status";

/* ────────── enum constants ────────── */

describe("LANDED_COST_KINDS", () => {
  it("lists the four canonical landed cost kinds", () => {
    expect(LANDED_COST_KINDS).toEqual([
      "freight",
      "duty",
      "insurance",
      "other",
    ]);
  });
});

describe("ALLOCATION_METHODS", () => {
  it("lists the three allocation methods", () => {
    expect(ALLOCATION_METHODS).toEqual(["value", "quantity", "weight"]);
  });
});

describe("PROCUREMENT_TABS", () => {
  it("lists the five canonical tabs", () => {
    expect(PROCUREMENT_TABS).toEqual([
      "requisitions",
      "rfq",
      "blanket",
      "landed",
      "credit",
    ]);
  });
});

/* ────────── generateIdempotencyKey ────────── */

describe("generateIdempotencyKey", () => {
  it("returns a string of the form `${kind}-ui-${timestamp}` for requisition", () => {
    const out = generateIdempotencyKey("requisition");
    expect(out).toMatch(/^requisition-ui-\d+$/);
  });

  it("uses the kind verbatim in the prefix for every supported kind", () => {
    const kinds: IdempotencyKeyKind[] = [
      "requisition",
      "convert",
      "blanket",
      "landed",
      "credit",
    ];
    for (const kind of kinds) {
      const out = generateIdempotencyKey(kind);
      expect(out.startsWith(`${kind}-ui-`)).toBe(true);
      const tail = out.slice(`${kind}-ui-`.length);
      expect(Number.isFinite(Number(tail))).toBe(true);
    }
  });

  it("mints a new key when the clock advances between calls", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-11T12:00:00.000Z"));
      const a = generateIdempotencyKey("blanket");
      vi.setSystemTime(new Date("2026-06-11T12:00:01.000Z"));
      const b = generateIdempotencyKey("blanket");
      expect(a).toMatch(/^blanket-ui-\d+$/);
      expect(b).toMatch(/^blanket-ui-\d+$/);
      expect(a).not.toBe(b);
      // The second key's timestamp is exactly 1000ms larger than the first.
      const aMs = Number(a.slice("blanket-ui-".length));
      const bMs = Number(b.slice("blanket-ui-".length));
      expect(bMs - aMs).toBe(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses Date.now() at call time (not import time)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const a = generateIdempotencyKey("landed");
      vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
      const b = generateIdempotencyKey("landed");
      // Both must have the correct prefix and a parseable numeric tail.
      expect(a).toMatch(/^landed-ui-\d+$/);
      expect(b).toMatch(/^landed-ui-\d+$/);
      // And b must be strictly greater than a (clock advanced).
      const aMs = Number(a.slice("landed-ui-".length));
      const bMs = Number(b.slice("landed-ui-".length));
      expect(bMs).toBeGreaterThan(aMs);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ────────── landedCostKindLabelAm ────────── */

describe("landedCostKindLabelAm", () => {
  it("returns the Armenian label for freight", () => {
    expect(landedCostKindLabelAm("freight")).toContain("Առաքում");
  });
  it("returns the Armenian label for duty", () => {
    expect(landedCostKindLabelAm("duty")).toContain("Մաքսատուրք");
  });
  it("returns the Armenian label for insurance", () => {
    expect(landedCostKindLabelAm("insurance")).toContain("Ապահովագրություն");
  });
  it("returns the Armenian label for other", () => {
    expect(landedCostKindLabelAm("other")).toContain("Այլ");
  });
  it("appends the English gloss in parens for freight", () => {
    expect(landedCostKindLabelAm("freight")).toMatch(/\(Freight\)$/);
  });
});

/* ────────── allocationMethodLabelAm ────────── */

describe("allocationMethodLabelAm", () => {
  it("returns the Armenian label for value", () => {
    expect(allocationMethodLabelAm("value")).toContain("Ըստ արժեքի");
  });
  it("returns the Armenian label for quantity", () => {
    expect(allocationMethodLabelAm("quantity")).toContain("Ըստ քանակի");
  });
  it("returns the Armenian label for weight", () => {
    expect(allocationMethodLabelAm("weight")).toContain("Ըստ քաշի");
  });
  it("appends the English gloss in parens for value", () => {
    expect(allocationMethodLabelAm("value")).toMatch(/\(By value\)$/);
  });
});

/* ────────── isLandedCostKind / isAllocationMethod ────────── */

describe("isLandedCostKind", () => {
  it("returns true for the four canonical kinds", () => {
    for (const k of LANDED_COST_KINDS) {
      expect(isLandedCostKind(k)).toBe(true);
    }
  });
  it("returns false for an unknown kind", () => {
    expect(isLandedCostKind("tax")).toBe(false);
    expect(isLandedCostKind("")).toBe(false);
  });
});

describe("isAllocationMethod", () => {
  it("returns true for the three canonical methods", () => {
    for (const m of ALLOCATION_METHODS) {
      expect(isAllocationMethod(m)).toBe(true);
    }
  });
  it("returns false for an unknown method", () => {
    expect(isAllocationMethod("volume")).toBe(false);
    expect(isAllocationMethod("")).toBe(false);
  });
});

/* ────────── formatVendorScore ────────── */

describe("formatVendorScore", () => {
  it("formats a 2-decimal float", () => {
    expect(formatVendorScore(0.85)).toBe("0.85");
  });
  it("pads a 1-digit decimal to two digits", () => {
    expect(formatVendorScore(0.5)).toBe("0.50");
  });
  it("handles a score of 0", () => {
    expect(formatVendorScore(0)).toBe("0.00");
  });
  it("handles a negative score (engine should not emit, but renderer must not throw)", () => {
    expect(formatVendorScore(-0.1)).toBe("-0.10");
  });
  it("returns '0.00' for non-finite input (NaN/Infinity)", () => {
    expect(formatVendorScore(NaN)).toBe("0.00");
    expect(formatVendorScore(Infinity)).toBe("0.00");
  });
});

/* ────────── formatPrice ────────── */

describe("formatPrice", () => {
  it("groups digits using hy-AM (non-breaking space) and appends currency", () => {
    // 1 200 000 AMD — assert it includes the currency suffix and the
    // expected Armenian-style grouping. The exact separator is a
    // non-breaking space ( ) per Intl.NumberFormat('hy-AM').
    const out = formatPrice(1200000, "AMD");
    expect(out).toMatch(/1 200 000\s*AMD$/);
  });

  it("uppercases the currency code", () => {
    expect(formatPrice(50000, "usd")).toMatch(/USD$/);
  });

  it("handles a 0 value", () => {
    expect(formatPrice(0, "AMD")).toMatch(/^0\s*AMD$/);
  });

  it("falls back to '—' for non-finite values", () => {
    expect(formatPrice(NaN, "AMD")).toBe("—");
    expect(formatPrice(Infinity, "AMD")).toBe("—");
  });

  it("does not throw when currency is an empty string (no suffix appended)", () => {
    expect(formatPrice(1000, "")).toBe("1 000");
  });
});

/* ────────── procurementTabFromHash / procurementTabToHash ────────── */

describe("procurementTabFromHash", () => {
  it("returns the matching tab for each canonical hash", () => {
    const cases: Record<string, ProcurementTab> = {
      requisitions: "requisitions",
      rfq: "rfq",
      blanket: "blanket",
      landed: "landed",
      credit: "credit",
    };
    for (const [hash, expected] of Object.entries(cases)) {
      expect(procurementTabFromHash(hash)).toBe(expected);
    }
  });

  it("strips a leading '#' before matching", () => {
    expect(procurementTabFromHash("#rfq")).toBe("rfq");
    expect(procurementTabFromHash("#blanket")).toBe("blanket");
  });

  it("falls back to 'requisitions' for an unknown hash", () => {
    expect(procurementTabFromHash("unknown")).toBe("requisitions");
    expect(procurementTabFromHash("")).toBe("requisitions");
  });

  it("falls back to 'requisitions' for an empty / whitespace input", () => {
    expect(procurementTabFromHash("   ")).toBe("requisitions");
  });

  it("falls back to 'requisitions' for null/undefined input (defensive nullish-coalesce branch)", () => {
    expect(procurementTabFromHash(null as unknown as string)).toBe(
      "requisitions",
    );
    expect(procurementTabFromHash(undefined as unknown as string)).toBe(
      "requisitions",
    );
  });
});

describe("procurementTabToHash", () => {
  it("prefixes the tab with '#' to form a hash fragment", () => {
    expect(procurementTabToHash("requisitions")).toBe("#requisitions");
    expect(procurementTabToHash("rfq")).toBe("#rfq");
    expect(procurementTabToHash("blanket")).toBe("#blanket");
    expect(procurementTabToHash("landed")).toBe("#landed");
    expect(procurementTabToHash("credit")).toBe("#credit");
  });

  it("round-trips with procurementTabFromHash", () => {
    for (const tab of PROCUREMENT_TABS) {
      expect(procurementTabFromHash(procurementTabToHash(tab))).toBe(tab);
    }
  });
});

/* ────────── validateRequisitionInput ────────── */

describe("validateRequisitionInput", () => {
  it("accepts a well-formed neededBy with no justification", () => {
    expect(validateRequisitionInput({ neededBy: "2026-06-30" })).toEqual({
      ok: true,
    });
  });

  it("accepts a well-formed neededBy with a short justification", () => {
    expect(
      validateRequisitionInput({
        neededBy: "2026-06-30",
        justification: "Հիմնավորում",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects an empty neededBy", () => {
    const out = validateRequisitionInput({ neededBy: "" });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toMatch(/YYYY-MM-DD/);
    }
  });

  it("rejects a neededBy that is not a YYYY-MM-DD string", () => {
    expect(validateRequisitionInput({ neededBy: "06/30/2026" }).ok).toBe(false);
    expect(validateRequisitionInput({ neededBy: "2026-6-30" }).ok).toBe(false);
    expect(validateRequisitionInput({ neededBy: "2026/06/30" }).ok).toBe(false);
  });

  it("rejects a justification over 500 characters", () => {
    const out = validateRequisitionInput({
      neededBy: "2026-06-30",
      justification: "x".repeat(501),
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toMatch(/500/);
    }
  });

  it("accepts a justification of exactly 500 characters (boundary)", () => {
    const out = validateRequisitionInput({
      neededBy: "2026-06-30",
      justification: "x".repeat(500),
    });
    expect(out.ok).toBe(true);
  });
});
