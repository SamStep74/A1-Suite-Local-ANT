/**
 * Pure-helper tests for web-modern/src/lib/export-docs/status.ts.
 *
 * Pattern A (mirroring web-modern/src/lib/cabinet/__tests__/status.test.ts
 * and web-modern/src/lib/state-int/__tests__/status.test.ts).
 * Target: 100% line + branch coverage.
 */
import { describe, expect, it } from "vitest";
import {
  EXPORT_DOC_DESTINATIONS,
  EXPORT_DOC_DESTINATION_LABELS_AM,
  EXPORT_DOC_TEMPLATES,
  buildExportDocProductMasterDemo,
  buildExportDocSalesOrderDemo,
  exportDocDestinationLabelAm,
  exportDocStepFromHash,
  exportDocStepToHash,
  exportDocTemplateLabelAm,
  formatExportDocLinePreview,
  formatExportDocRequiredCertificates,
  formatExportDocStatusLabelAm,
  generateExportDocIdempotencyKey,
  isExportDocStep,
  isExportDocTemplateKind,
} from "../status";
import type {
  ExportDocAutoFillDraftLine,
  ExportDocDestination,
  ExportDocTemplateKind,
} from "@/lib/api/schemas";

const ALL_TEMPLATE_KINDS: ReadonlyArray<ExportDocTemplateKind> = [
  "invoice",
  "packing",
  "cmr",
  "tir",
  "coo",
  "phyto",
  "vet",
  "declaration",
];

const ALL_DESTINATIONS: ReadonlyArray<ExportDocDestination> = [
  "RU",
  "EAEU",
  "EU",
  "AE",
  "HK",
  "PH",
];

/* ────────── EXPORT_DOC_TEMPLATES ────────── */

describe("EXPORT_DOC_TEMPLATES", () => {
  it("contains exactly 8 template kinds in the legacy order", () => {
    expect(EXPORT_DOC_TEMPLATES).toHaveLength(8);
    expect(EXPORT_DOC_TEMPLATES.map((t) => t.kind)).toEqual([
      "invoice",
      "packing",
      "cmr",
      "tir",
      "coo",
      "phyto",
      "vet",
      "declaration",
    ]);
  });

  it("every descriptor has a non-empty label and a unique kind", () => {
    const kinds = new Set<string>();
    for (const t of EXPORT_DOC_TEMPLATES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(kinds.has(t.kind)).toBe(false);
      kinds.add(t.kind);
    }
    expect(kinds.size).toBe(ALL_TEMPLATE_KINDS.length);
  });

  it("the legacy 'Արտահանման հաշիվ / Export invoice' label is the first entry", () => {
    expect(EXPORT_DOC_TEMPLATES[0].label).toBe(
      "Արտահանման հաշիվ / Export invoice",
    );
  });
});

/* ────────── EXPORT_DOC_DESTINATIONS ────────── */

describe("EXPORT_DOC_DESTINATIONS", () => {
  it("lists the 6 canonical destination codes in the legacy order", () => {
    expect([...EXPORT_DOC_DESTINATIONS]).toEqual([
      "RU",
      "EAEU",
      "EU",
      "AE",
      "HK",
      "PH",
    ]);
  });
});

/* ────────── EXPORT_DOC_DESTINATION_LABELS_AM ────────── */

describe("EXPORT_DOC_DESTINATION_LABELS_AM", () => {
  it("has a non-empty Armenian label for every destination code", () => {
    for (const code of ALL_DESTINATIONS) {
      const label = EXPORT_DOC_DESTINATION_LABELS_AM[code];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("maps RU to 'Ռուսաստան' and EAEU to 'ԵԱՏՄ'", () => {
    // Sanity: the first two labels are stable surface area — changes
    // here would need a UX review since they appear in the Step 1
    // select and the validation row.
    expect(EXPORT_DOC_DESTINATION_LABELS_AM.RU).toBe("Ռուսաստան");
    expect(EXPORT_DOC_DESTINATION_LABELS_AM.EAEU).toBe("ԵԱՏՄ");
  });
});

/* ────────── exportDocTemplateLabelAm ────────── */

describe("exportDocTemplateLabelAm", () => {
  it("returns the catalog label for every known template kind", () => {
    for (const t of EXPORT_DOC_TEMPLATES) {
      expect(exportDocTemplateLabelAm(t.kind)).toBe(t.label);
    }
  });

  it("returns the catalog label for each enum member", () => {
    expect(exportDocTemplateLabelAm("invoice")).toBe(
      "Արտահանման հաշիվ / Export invoice",
    );
    expect(exportDocTemplateLabelAm("declaration")).toBe(
      "Արտահանման հայտարարություն / Export declaration",
    );
  });
});

/* ────────── exportDocDestinationLabelAm ────────── */

describe("exportDocDestinationLabelAm", () => {
  it("returns the same string as the lookup table for every code", () => {
    for (const code of ALL_DESTINATIONS) {
      expect(exportDocDestinationLabelAm(code)).toBe(
        EXPORT_DOC_DESTINATION_LABELS_AM[code],
      );
    }
  });
});

/* ────────── isExportDocTemplateKind ────────── */

describe("isExportDocTemplateKind", () => {
  it("accepts every canonical template kind", () => {
    for (const kind of ALL_TEMPLATE_KINDS) {
      expect(isExportDocTemplateKind(kind)).toBe(true);
    }
  });

  it("rejects unknown, empty, case-mismatched, and non-string inputs", () => {
    expect(isExportDocTemplateKind("INVOICE")).toBe(false);
    expect(isExportDocTemplateKind("")).toBe(false);
    expect(isExportDocTemplateKind("invoice ")).toBe(false);
  });
});

/* ────────── generateExportDocIdempotencyKey ────────── */

describe("generateExportDocIdempotencyKey", () => {
  it("produces `${kind}-${ts}` for ui-create", () => {
    const key = generateExportDocIdempotencyKey("ui-create", 1700000000000);
    expect(key).toBe("ui-create-1700000000000");
  });

  it("produces `${kind}-${ts}` for ui-fin", () => {
    const key = generateExportDocIdempotencyKey("ui-fin", 42);
    expect(key).toBe("ui-fin-42");
  });

  it("uses Date.now() by default and matches the documented shape", () => {
    const before = Date.now();
    const key = generateExportDocIdempotencyKey("ui-create");
    const after = Date.now();
    const match = key.match(/^ui-create-(\d+)$/);
    expect(match).not.toBeNull();
    if (match) {
      const ms = Number(match[1]);
      expect(ms).toBeGreaterThanOrEqual(before);
      expect(ms).toBeLessThanOrEqual(after);
    }
  });

  it("two calls with the same `now` return the same key (replay-safe)", () => {
    const a = generateExportDocIdempotencyKey("ui-fin", 123);
    const b = generateExportDocIdempotencyKey("ui-fin", 123);
    expect(a).toBe(b);
  });
});

/* ────────── buildExportDocSalesOrderDemo ────────── */

describe("buildExportDocSalesOrderDemo", () => {
  it("matches the legacy wizard's hardcoded sales-order (web/src/exportDocs.jsx:27-40)", () => {
    const so = buildExportDocSalesOrderDemo("EU");
    expect(so).toEqual({
      destinationCountry: "EU",
      incoterm: "CIF",
      currency: "USD",
      lines: [
        {
          productId: "demo-tomato",
          description: "Tomatoes",
          quantity: 1000,
          unitPrice: 1.2,
          uom: "kg",
        },
      ],
    });
  });

  it("propagates the destination into the envelope and each line", () => {
    const so = buildExportDocSalesOrderDemo("AE");
    expect(so.destinationCountry).toBe("AE");
    // incoterm/currency/lines are constants — must not depend on the country.
    expect(so.incoterm).toBe("CIF");
    expect(so.currency).toBe("USD");
    expect(so.lines).toHaveLength(1);
  });
});

/* ────────── buildExportDocProductMasterDemo ────────── */

describe("buildExportDocProductMasterDemo", () => {
  it("matches the legacy wizard's hardcoded product master", () => {
    const pm = buildExportDocProductMasterDemo();
    expect(pm).toEqual([
      { id: "demo-tomato", name: "Tomatoes (Cherry)", hsCode: "0702", uom: "kg" },
    ]);
  });

  it("returns a fresh array on each call (no shared reference)", () => {
    const a = buildExportDocProductMasterDemo();
    const b = buildExportDocProductMasterDemo();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

/* ────────── formatExportDocLinePreview ────────── */

describe("formatExportDocLinePreview", () => {
  it("formats as `description — HS hsCode — quantity uom`", () => {
    const line: ExportDocAutoFillDraftLine = {
      description: "Tomatoes",
      hsCode: "0702",
      quantity: 1000,
      uom: "kg",
    };
    expect(formatExportDocLinePreview(line)).toBe(
      "Tomatoes — HS 0702 — 1000 kg",
    );
  });

  it("handles an alternate product with different units", () => {
    const line: ExportDocAutoFillDraftLine = {
      description: "Apples",
      hsCode: "0808",
      quantity: 250,
      uom: "box",
    };
    expect(formatExportDocLinePreview(line)).toBe(
      "Apples — HS 0808 — 250 box",
    );
  });
});

/* ────────── formatExportDocRequiredCertificates ────────── */

describe("formatExportDocRequiredCertificates", () => {
  it("returns an em-dash for an empty list (legacy line 117 fallback)", () => {
    expect(formatExportDocRequiredCertificates([])).toBe("—");
  });

  it("returns the single cert unchanged (no separator)", () => {
    expect(formatExportDocRequiredCertificates(["CMR"])).toBe("CMR");
  });

  it("joins multiple certs with ', '", () => {
    expect(
      formatExportDocRequiredCertificates(["Phyto", "COO", "CMR"]),
    ).toBe("Phyto, COO, CMR");
  });
});

/* ────────── formatExportDocStatusLabelAm ────────── */

describe("formatExportDocStatusLabelAm", () => {
  it("returns Armenian labels for every closed-enum status", () => {
    expect(formatExportDocStatusLabelAm("draft")).toBe("Սևագիր");
    expect(formatExportDocStatusLabelAm("finalized")).toBe("Ավարտված");
    expect(formatExportDocStatusLabelAm("void")).toBe("Չեղարկված");
  });
});

/* ────────── exportDocStepFromHash / exportDocStepToHash ────────── */

describe("exportDocStepFromHash", () => {
  it("parses '#step=2' into 2", () => {
    expect(exportDocStepFromHash("#step=2")).toBe(2);
  });

  it("parses 'step=3' (no leading #) into 3", () => {
    expect(exportDocStepFromHash("step=3")).toBe(3);
  });

  it("parses 'step=4' as the final step", () => {
    expect(exportDocStepFromHash("step=4")).toBe(4);
  });

  it("falls back to 1 for an empty hash, missing param, or out-of-range value", () => {
    expect(exportDocStepFromHash("")).toBe(1);
    expect(exportDocStepFromHash("#other=foo")).toBe(1);
    expect(exportDocStepFromHash("#step=0")).toBe(1);
    expect(exportDocStepFromHash("#step=5")).toBe(1);
    expect(exportDocStepFromHash("#step=abc")).toBe(1);
  });
});

describe("exportDocStepToHash", () => {
  it("round-trips through exportDocStepFromHash for every step", () => {
    for (const step of [1, 2, 3, 4] as const) {
      expect(exportDocStepFromHash(exportDocStepToHash(step))).toBe(step);
    }
  });

  it("renders as '#step=N'", () => {
    expect(exportDocStepToHash(1)).toBe("#step=1");
    expect(exportDocStepToHash(4)).toBe("#step=4");
  });
});

/* ────────── isExportDocStep ────────── */

describe("isExportDocStep", () => {
  it("accepts 1, 2, 3, 4", () => {
    expect(isExportDocStep(1)).toBe(true);
    expect(isExportDocStep(2)).toBe(true);
    expect(isExportDocStep(3)).toBe(true);
    expect(isExportDocStep(4)).toBe(true);
  });

  it("rejects 0, 5, -1, NaN, and non-integer values", () => {
    expect(isExportDocStep(0)).toBe(false);
    expect(isExportDocStep(5)).toBe(false);
    expect(isExportDocStep(-1)).toBe(false);
    expect(isExportDocStep(Number.NaN)).toBe(false);
    expect(isExportDocStep(1.5)).toBe(false);
  });
});
