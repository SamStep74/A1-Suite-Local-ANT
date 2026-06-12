/**
 * status.test.ts — unit tests for the Production Readiness pure helpers
 * (Phase 8.10).
 *
 * Pattern A: mirrors web-modern/src/lib/cabinet/__tests__/status.test.ts
 * and web-modern/src/lib/export-docs/__tests__/status.test.ts.
 *
 * Source of truth: web-modern/src/lib/compliance/status.ts, which
 * itself mirrors web/src/compliance.jsx (49 lines, legacy) and the
 * wire contract at server/app.js:49570 (getProductionReadiness) and
 * server/app.js:9016 (requireProductionReadinessReader).
 *
 * Target: 100% line + branch coverage for the status.ts module.
 */
import { describe, expect, it } from "vitest";
import {
  ProductionReadinessGateDomainSchema,
  ProductionReadinessReadinessSchema,
  ProductionReadinessResponseSchema,
  ProductionReadinessStatusSchema,
} from "../../api/schemas";
import {
  canReadProductionReadiness,
  formatProductionEffectiveDate,
  formatProductionPassBadge,
  formatProductionRate,
  formatProductionReviewFlag,
  formatProductionStatusBadgeClass,
  formatProductionStatusLabel,
  hasProductionBlockers,
  isProductionReady,
} from "../status";
import type {
  ProductionReadinessGate,
  ProductionReadinessReadiness,
} from "../../api/schemas";

/* ────────── fixtures ────────── */

/** A minimal but fully-shaped gate the server would return. */
const LEGAL_SOURCE_GATE: ProductionReadinessGate = {
  key: "law-tax-code",
  label: "ԱԱՀ հարկային աղբյուր",
  domain: "legal-source",
  ownerRole: "Accountant",
  reviewerRoles: ["Accountant"],
  pass: true,
  status: "active",
  requiredStatus: "active",
  effectiveDate: "2026-01-15",
  sourceUrl: "https://example.com/law",
  rate: null,
  nextAction: "professionally reviewed",
};

/** A tax-rate gate with a fractional rate (matches the legacy `pct`
 *  rounding contract: 0.1234 → "12.34%"). */
const VAT_GATE: ProductionReadinessGate = {
  key: "tax-rate-vat-current",
  label: "Գործող ԱԱՀ դրույքաչափ",
  domain: "tax-rate",
  ownerRole: "Accountant",
  reviewerRoles: [],
  pass: true,
  status: "configured",
  requiredStatus: "configured",
  effectiveDate: "2026-04-01",
  sourceUrl: "",
  rate: 0.1234,
  nextAction: "configured",
};

/** A payroll-rate gate that has NOT been configured — used to
 *  exercise the "blocker" branch. */
const PAYROLL_GATE_BLOCKED: ProductionReadinessGate = {
  key: "tax-rate-payroll-current",
  label: "Գործող աշխատավարձային կարգավորում",
  domain: "payroll-rate",
  ownerRole: "Accountant",
  reviewerRoles: [],
  pass: false,
  status: "missing",
  requiredStatus: "configured",
  effectiveDate: "",
  sourceUrl: "",
  rate: null,
  nextAction: "Configure effective-dated payroll rates before production use",
};

const READY_READINESS: ProductionReadinessReadiness = {
  status: "ready",
  reviewRequired: false,
  asOf: "2026-06-12",
  generatedAt: "2026-06-12T00:00:00.000Z",
  summary: { total: 3, passed: 3, blocked: 0 },
  gates: [
    LEGAL_SOURCE_GATE,
    VAT_GATE,
    // A payroll gate that's fully configured — exercises the rate path
    // (with effectiveDate non-empty) alongside the legal-source null
    // rate and the tax-rate fractional rate.
    {
      ...PAYROLL_GATE_BLOCKED,
      pass: true,
      status: "configured",
      rate: 0.05,
      effectiveDate: "2026-04-01",
    },
  ],
  blockers: [],
};

const BLOCKED_READINESS: ProductionReadinessReadiness = {
  status: "blocked",
  reviewRequired: true,
  asOf: "2026-06-12",
  generatedAt: "2026-06-12T00:00:00.000Z",
  summary: { total: 3, passed: 2, blocked: 1 },
  gates: [LEGAL_SOURCE_GATE, VAT_GATE, PAYROLL_GATE_BLOCKED],
  blockers: [PAYROLL_GATE_BLOCKED],
};

/* ────────── formatProductionRate ────────── */

describe("formatProductionRate", () => {
  it("renders a 4-decimal fraction as a 2-decimal percent (legacy pct() contract)", () => {
    expect(formatProductionRate(0.1234)).toBe("12.34%");
  });

  it("renders 0 as '0%' (the falsey-but-numeric branch)", () => {
    expect(formatProductionRate(0)).toBe("0%");
  });

  it("renders 1 as '100%'", () => {
    expect(formatProductionRate(1)).toBe("100%");
  });

  it("renders null as the em-dash placeholder", () => {
    expect(formatProductionRate(null)).toBe("—");
  });

  it("renders undefined as the em-dash placeholder", () => {
    expect(formatProductionRate(undefined)).toBe("—");
  });
});

/* ────────── isProductionReady ────────── */

describe("isProductionReady", () => {
  it("returns true for status='ready'", () => {
    expect(isProductionReady({ status: "ready" })).toBe(true);
  });

  it("returns false for status='blocked'", () => {
    expect(isProductionReady({ status: "blocked" })).toBe(false);
  });

  it("returns false for null (defensive: no payload = not ready)", () => {
    expect(isProductionReady(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isProductionReady(undefined)).toBe(false);
  });
});

/* ────────── hasProductionBlockers ────────── */

describe("hasProductionBlockers", () => {
  it("returns true when the blockers array is non-empty", () => {
    expect(hasProductionBlockers({ blockers: [LEGAL_SOURCE_GATE, VAT_GATE] })).toBe(true);
  });

  it("returns false when the blockers array is empty", () => {
    expect(hasProductionBlockers({ blockers: [] })).toBe(false);
  });

  it("returns false for null (defensive: no payload = no banner)", () => {
    expect(hasProductionBlockers(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(hasProductionBlockers(undefined)).toBe(false);
  });
});

/* ────────── formatProductionStatusLabel / BadgeClass ────────── */

describe("formatProductionStatusLabel", () => {
  it("maps 'ready' to 'Ready'", () => {
    expect(formatProductionStatusLabel("ready")).toBe("Ready");
  });

  it("maps 'blocked' to 'Blocked'", () => {
    expect(formatProductionStatusLabel("blocked")).toBe("Blocked");
  });
});

describe("formatProductionStatusBadgeClass", () => {
  it("maps 'ready' to the 'ok' class (green tone)", () => {
    expect(formatProductionStatusBadgeClass("ready")).toBe("ok");
  });

  it("maps 'blocked' to the 'risk' class (red tone)", () => {
    expect(formatProductionStatusBadgeClass("blocked")).toBe("risk");
  });
});

/* ────────── formatProductionPassBadge ────────── */

describe("formatProductionPassBadge", () => {
  it("returns 'pass' for a passing gate", () => {
    expect(formatProductionPassBadge(true)).toBe("pass");
  });

  it("returns 'review' for a non-passing gate", () => {
    expect(formatProductionPassBadge(false)).toBe("review");
  });
});

/* ────────── formatProductionEffectiveDate ────────── */

describe("formatProductionEffectiveDate", () => {
  it("returns the date string verbatim when non-empty", () => {
    expect(formatProductionEffectiveDate("2026-01-15")).toBe("2026-01-15");
  });

  it("returns the Armenian placeholder for an empty string (server's missing-date sentinel)", () => {
    expect(formatProductionEffectiveDate("")).toBe("առանց ամսաթվի");
  });

  it("returns the Armenian placeholder for null", () => {
    expect(formatProductionEffectiveDate(null)).toBe("առանց ամսաթվի");
  });

  it("returns the Armenian placeholder for undefined", () => {
    expect(formatProductionEffectiveDate(undefined)).toBe("առանց ամսաթվի");
  });
});

/* ────────── formatProductionReviewFlag ────────── */

describe("formatProductionReviewFlag", () => {
  it("returns 'review required' when reviewRequired is true", () => {
    expect(formatProductionReviewFlag(true)).toBe("review required");
  });

  it("returns 'production-ready' when reviewRequired is false", () => {
    expect(formatProductionReviewFlag(false)).toBe("production-ready");
  });
});

/* ────────── canReadProductionReadiness ────────── */

describe("canReadProductionReadiness", () => {
  it("accepts all 5 server-enforced reader roles", () => {
    for (const role of ["Owner", "Admin", "Accountant", "Lawyer", "Auditor"] as const) {
      expect(canReadProductionReadiness(role)).toBe(true);
    }
  });

  it("rejects non-reader roles", () => {
    expect(canReadProductionReadiness("Salesperson")).toBe(false);
    expect(canReadProductionReadiness("Operator")).toBe(false);
    expect(canReadProductionReadiness("")).toBe(false);
    expect(canReadProductionReadiness("Owner ")).toBe(false); // case + whitespace sensitive
  });

  it("rejects null and undefined (defensive: pre-auth render)", () => {
    expect(canReadProductionReadiness(null)).toBe(false);
    expect(canReadProductionReadiness(undefined)).toBe(false);
  });
});

/* ────────── Zod schema smoke tests (parity with the server wire) ────────── */

describe("ProductionReadinessResponseSchema (smoke)", () => {
  it("parses a fully-shaped 'ready' response from the server", () => {
    const out = ProductionReadinessResponseSchema.parse({
      readiness: READY_READINESS,
    });
    expect(out.readiness.status).toBe("ready");
    expect(out.readiness.gates).toHaveLength(3);
  });

  it("parses a 'blocked' response with a non-empty blockers array", () => {
    const out = ProductionReadinessResponseSchema.parse({
      readiness: BLOCKED_READINESS,
    });
    expect(out.readiness.status).toBe("blocked");
    expect(out.readiness.blockers).toHaveLength(1);
    expect(out.readiness.blockers[0].key).toBe("tax-rate-payroll-current");
  });

  it("rejects a malformed asOf that isn't YYYY-MM-DD", () => {
    expect(() =>
      ProductionReadinessResponseSchema.parse({
        readiness: { ...READY_READINESS, asOf: "not-a-date" },
      }),
    ).toThrow(/YYYY-MM-DD/);
  });

  it("accepts a response with an empty gates + blockers array (zero-gate case)", () => {
    const out = ProductionReadinessResponseSchema.parse({
      readiness: {
        ...READY_READINESS,
        status: "ready",
        reviewRequired: false,
        summary: { total: 0, passed: 0, blocked: 0 },
        gates: [],
        blockers: [],
      },
    });
    expect(out.readiness.gates).toEqual([]);
  });
});

describe("ProductionReadinessStatusSchema", () => {
  it("accepts 'ready' and 'blocked'", () => {
    expect(ProductionReadinessStatusSchema.parse("ready")).toBe("ready");
    expect(ProductionReadinessStatusSchema.parse("blocked")).toBe("blocked");
  });

  it("rejects unknown status values", () => {
    expect(() => ProductionReadinessStatusSchema.parse("review")).toThrow();
  });
});

describe("ProductionReadinessGateDomainSchema", () => {
  it("accepts all three server-emitted domain values", () => {
    expect(ProductionReadinessGateDomainSchema.parse("legal-source")).toBe("legal-source");
    expect(ProductionReadinessGateDomainSchema.parse("tax-rate")).toBe("tax-rate");
    expect(ProductionReadinessGateDomainSchema.parse("payroll-rate")).toBe("payroll-rate");
  });

  it("rejects an unknown domain (defends against the legacy plan's wrong 'vat-rate')", () => {
    expect(() => ProductionReadinessGateDomainSchema.parse("vat-rate")).toThrow();
  });
});

describe("ProductionReadinessReadinessSchema (defensive)", () => {
  it("accepts a gate with rate=null (legal-source shape)", () => {
    const out = ProductionReadinessReadinessSchema.parse(READY_READINESS);
    expect(out.gates[0].rate).toBeNull();
  });

  it("rejects a negative summary count (defends against a server regression)", () => {
    expect(() =>
      ProductionReadinessReadinessSchema.parse({
        ...READY_READINESS,
        summary: { total: -1, passed: 0, blocked: 0 },
      }),
    ).toThrow();
  });
});
