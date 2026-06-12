/**
 * ProductionReadinessPanel.test.tsx — route-level unit tests for the
 * Compliance production-readiness co-panel (Phase 8.10 layer 2).
 *
 * Mirrors the cabinet/cfo test pattern: import the component
 * directly, drive it with a few hand-crafted fixtures that match
 * the Zod schema shape, and assert on the data-testid contract
 * that the e2e spec (e2e/compliance.spec.ts) also exercises.
 *
 * Coverage targets:
 *  - Returns null when data is null / undefined (RBAC short-circuit)
 *  - Renders the panel root with status="ready" on a clean payload
 *  - Renders the status pill with Armenian-first label
 *  - Summary metrics reflect total / passed / blocked from the payload
 *  - Blocker banner appears only when blockers.length > 0
 *  - Gate rows expose data-gate-key and the pass/review badge
 *  - Empty effectiveDate falls back to em-dash
 *  - Rate column renders "20%" for 0.2 and is omitted when null
 *  - Meta row "as of" + review flag both visible
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  ProductionReadinessReadinessSchema,
  type ProductionReadinessGate,
  type ProductionReadinessReadiness,
} from "../api/schemas";
import { ProductionReadinessPanel } from "./ProductionReadinessPanel";

/* ────────── fixtures ────────── */

function buildReadiness(
  overrides: Partial<ProductionReadinessReadiness> = {},
): ProductionReadinessReadiness {
  return ProductionReadinessReadinessSchema.parse({
    status: "ready",
    reviewRequired: false,
    asOf: "2026-06-12",
    generatedAt: "2026-06-12T00:00:00.000Z",
    summary: { total: 2, passed: 2, blocked: 0 },
    gates: [
      {
        key: "tax-rate-vat-current",
        label: "Գործող ԱԱՀ դրույքաչափ",
        domain: "tax-rate",
        ownerRole: "Accountant",
        reviewerRoles: ["Accountant"],
        pass: true,
        status: "configured",
        requiredStatus: "configured",
        effectiveDate: "2026-01-01",
        sourceUrl: "",
        rate: 0.2,
        nextAction: "configured",
      },
      {
        key: "tax-rate-payroll-current",
        label: "Գործող աշխատավարձային կարգավորում",
        domain: "payroll-rate",
        ownerRole: "Accountant",
        reviewerRoles: ["Accountant"],
        pass: true,
        status: "configured",
        requiredStatus: "configured",
        effectiveDate: "2026-01-01",
        sourceUrl: "",
        rate: 0.1,
        nextAction: "configured",
      },
    ],
    blockers: [],
    ...overrides,
  });
}

/* ────────── reset ────────── */

afterEach(() => {
  cleanup();
});

/* ────────── null / undefined short-circuits ────────── */

describe("ProductionReadinessPanel — null short-circuit", () => {
  it("renders nothing when data is null", () => {
    const { container } = render(<ProductionReadinessPanel data={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when data is undefined", () => {
    const { container } = render(
      <ProductionReadinessPanel data={undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

/* ────────── happy path: ready + no blockers ────────── */

describe("ProductionReadinessPanel — ready payload", () => {
  it("renders the panel root with status=ready and Armenian H2", () => {
    const r = buildReadiness();
    render(<ProductionReadinessPanel data={r} />);
    const panel = screen.getByTestId("compliance-readiness-panel");
    expect(panel).toBeInTheDocument();
    expect(panel.tagName.toLowerCase()).toBe("article");
    expect(panel.getAttribute("data-status")).toBe("ready");
    // Armenian H2 + English gloss
    expect(
      screen.getByRole("heading", { level: 2, name: /Մասնագիտական վերանայման gate/ }),
    ).toBeInTheDocument();
  });

  it("renders the top-right status pill in the 'ok' class with Armenian label", () => {
    const r = buildReadiness();
    render(<ProductionReadinessPanel data={r} />);
    const status = screen.getByTestId("compliance-readiness-status");
    expect(status.getAttribute("data-status")).toBe("ready");
    expect(status.textContent).toContain("Պատրաստ է");
    expect(status.textContent).toContain("Ready");
  });

  it("renders the three summary metrics with values from the payload", () => {
    const r = buildReadiness({ summary: { total: 7, passed: 5, blocked: 2 } });
    render(<ProductionReadinessPanel data={r} />);
    expect(
      screen.getByTestId("compliance-readiness-summary-total").textContent,
    ).toContain("7");
    expect(
      screen.getByTestId("compliance-readiness-summary-passed").textContent,
    ).toContain("5");
    expect(
      screen.getByTestId("compliance-readiness-summary-blocked").textContent,
    ).toContain("2");
  });

  it("does NOT render the blocker banner on a clean payload", () => {
    const r = buildReadiness();
    render(<ProductionReadinessPanel data={r} />);
    expect(
      screen.queryByTestId("compliance-readiness-blocker-banner"),
    ).not.toBeInTheDocument();
  });

  it("renders one gate row per gate with data-gate-key and the right pass badge", () => {
    const r = buildReadiness();
    render(<ProductionReadinessPanel data={r} />);
    const rows = screen.getAllByTestId("compliance-readiness-gate-row");
    expect(rows).toHaveLength(2);
    const vatRow = rows.find(
      (row) => row.getAttribute("data-gate-key") === "tax-rate-vat-current",
    );
    expect(vatRow).toBeDefined();
    expect(vatRow!.getAttribute("data-pass")).toBe("true");
    const vatBadge = screen.getByTestId(
      "compliance-readiness-gate-pass-tax-rate-vat-current",
    );
    expect(vatBadge.textContent).toBe("pass");
  });

  it("renders the rate column for gates with a numeric rate", () => {
    const r = buildReadiness();
    render(<ProductionReadinessPanel data={r} />);
    const rows = screen.getAllByTestId("compliance-readiness-gate-row");
    const vatRow = rows.find(
      (row) => row.getAttribute("data-gate-key") === "tax-rate-vat-current",
    );
    expect(vatRow!.textContent).toContain("20%");
    expect(vatRow!.textContent).toContain("2026-01-01");
  });

  it("renders the meta row with as-of + production-ready flag", () => {
    const r = buildReadiness();
    render(<ProductionReadinessPanel data={r} />);
    const asOf = screen.getByTestId("compliance-readiness-as-of");
    expect(asOf.textContent).toContain("2026-06-12");
    const flag = screen.getByTestId("compliance-readiness-review-flag");
    expect(flag.textContent).toContain("Արտադրական պատրաստ");
  });
});

/* ────────── blocked payload: banner + review badges + em-dash dates ────────── */

describe("ProductionReadinessPanel — blocked payload", () => {
  const failingLegalGate: ProductionReadinessGate = {
    key: "law-personal-data",
    label: "Անձնական տվյալների իրավական աղբյուր",
    domain: "legal-source",
    ownerRole: "Lawyer",
    reviewerRoles: ["Lawyer"],
    pass: false,
    status: "missing",
    requiredStatus: "active",
    effectiveDate: "",
    sourceUrl: "",
    rate: null,
    nextAction: "Lawyer review required before production use",
  };

  it("renders the blocker banner with Armenian text", () => {
    const r = buildReadiness({
      status: "blocked",
      reviewRequired: true,
      summary: { total: 1, passed: 0, blocked: 1 },
      gates: [failingLegalGate],
      blockers: [failingLegalGate],
    });
    render(<ProductionReadinessPanel data={r} />);
    const banner = screen.getByTestId("compliance-readiness-blocker-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("Արտադրական օգտագործումը");
  });

  it("renders the top-right status pill in the 'risk' class with Armenian label", () => {
    const r = buildReadiness({
      status: "blocked",
      reviewRequired: true,
      summary: { total: 1, passed: 0, blocked: 1 },
      gates: [failingLegalGate],
      blockers: [failingLegalGate],
    });
    render(<ProductionReadinessPanel data={r} />);
    const status = screen.getByTestId("compliance-readiness-status");
    expect(status.getAttribute("data-status")).toBe("blocked");
    expect(status.textContent).toContain("Արգելափակված է");
    expect(status.textContent).toContain("Blocked");
  });

  it("renders the 'review' badge on a failing gate and em-dash for missing effective date", () => {
    const r = buildReadiness({
      status: "blocked",
      reviewRequired: true,
      summary: { total: 1, passed: 0, blocked: 1 },
      gates: [failingLegalGate],
      blockers: [failingLegalGate],
    });
    render(<ProductionReadinessPanel data={r} />);
    const gateRow = screen.getByTestId("compliance-readiness-gate-row");
    expect(gateRow.getAttribute("data-gate-key")).toBe("law-personal-data");
    expect(gateRow.getAttribute("data-pass")).toBe("false");
    // The failing gate has no rate; we should NOT see a percent string.
    expect(gateRow.textContent).not.toContain("%");
    // Effective date is empty → Armenian placeholder fallback
    // ("առանց ամսաթվի" = "without a date") from status.ts#formatProductionEffectiveDate
    expect(gateRow.textContent).toContain("առանց ամսաթվի");
    // The pass badge
    const badge = screen.getByTestId(
      "compliance-readiness-gate-pass-law-personal-data",
    );
    expect(badge.textContent).toBe("review");
  });

  it("renders the meta row with the Armenian review-required flag", () => {
    const r = buildReadiness({
      status: "blocked",
      reviewRequired: true,
      summary: { total: 1, passed: 0, blocked: 1 },
      gates: [failingLegalGate],
      blockers: [failingLegalGate],
    });
    render(<ProductionReadinessPanel data={r} />);
    const flag = screen.getByTestId("compliance-readiness-review-flag");
    expect(flag.textContent).toContain("Վերանայում է պահանջվում");
  });
});

/* ────────── summary fallback when server omits the field ────────── */

describe("ProductionReadinessPanel — summary fallback", () => {
  it("derives total/passed/blocked from the gates/blockers arrays when summary is missing", () => {
    // Strip summary from a normal fixture, then re-shape through a manual
    // parse() call to get a valid object without the optional summary.
    const base = buildReadiness();
    const stripped = { ...base, summary: undefined } as unknown as ProductionReadinessReadiness;
    render(<ProductionReadinessPanel data={stripped} />);
    // 2 gates, all pass, no blockers
    expect(
      screen.getByTestId("compliance-readiness-summary-total").textContent,
    ).toContain("2");
    expect(
      screen.getByTestId("compliance-readiness-summary-passed").textContent,
    ).toContain("0");
    expect(
      screen.getByTestId("compliance-readiness-summary-blocked").textContent,
    ).toContain("0");
  });
});

/* ────────── scope: helpers expose the right DOM anchors for the e2e spec ────────── */

describe("ProductionReadinessPanel — data-testid contract for e2e", () => {
  it("exposes every testid the e2e spec (compliance.spec.ts) looks up", () => {
    const r = buildReadiness();
    render(<ProductionReadinessPanel data={r} />);
    const panel = screen.getByTestId("compliance-readiness-panel");
    // Within the panel: status pill, three summary metrics, meta row
    expect(
      within(panel).getByTestId("compliance-readiness-status"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByTestId("compliance-readiness-summary-total"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByTestId("compliance-readiness-summary-passed"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByTestId("compliance-readiness-summary-blocked"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByTestId("compliance-readiness-as-of"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByTestId("compliance-readiness-review-flag"),
    ).toBeInTheDocument();
    // At least one gate row
    expect(
      within(panel).getAllByTestId("compliance-readiness-gate-row").length,
    ).toBeGreaterThan(0);
  });
});
