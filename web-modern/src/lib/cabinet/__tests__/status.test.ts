/**
 * status.test.ts — unit tests for the Document Cabinet pure helpers.
 *
 * Mirrors web-modern/src/lib/forms/__tests__/status.test.ts pattern.
 * The helpers consume the Zod-inferred `Cabinet*` types from
 * web-modern/src/lib/api/schemas.ts as their single source of truth.
 */
import { describe, expect, it } from "vitest";
import type { CabinetDocument } from "../../api/schemas";
import {
  CABINET_DIRECTIONS,
  CABINET_STATUSES,
  buildCabinetCreate,
  cabinetEmptyMessage,
  cabinetStatusLabelHy,
  cabinetStatusTone,
  classifyCabinetStatus,
  directionLabelArm,
  filterCabinetDocuments,
  sortCabinetDocumentsByActivity,
  type CabinetTone,
} from "../status";

/* ────────── fixtures ────────── */

const DOCS: CabinetDocument[] = [
  {
    id: "cab-1",
    title: "Մուտքային պայմանագիր — Անի",
    direction: "incoming",
    status: "active",
    docType: "contract",
    currentVersion: 1,
    linkedType: "customer",
    linkedId: "cust-ani",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-15T00:00:00Z",
  },
  {
    id: "cab-2",
    title: "Ելքային հաշիվ",
    direction: "outgoing",
    status: "active",
    docType: "invoice",
    currentVersion: 2,
    linkedType: "customer",
    linkedId: "cust-nare",
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-06-10T00:00:00Z",
  },
  {
    id: "cab-3",
    title: "Ներքին Հաշվետվություն",
    direction: "internal",
    status: "active",
    docType: null,
    currentVersion: 1,
    linkedType: null,
    linkedId: null,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-06-08T00:00:00Z",
  },
  {
    id: "cab-4",
    title: "Հին պայմանագիր",
    direction: "incoming",
    status: "archived",
    docType: "contract",
    currentVersion: 5,
    linkedType: "customer",
    linkedId: "cust-old",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2025-12-01T00:00:00Z",
  },
  {
    id: "cab-5",
    title: "Այլ արխիվային փաստաթուղթ",
    direction: "outgoing",
    status: "archived",
    docType: "memo",
    currentVersion: 1,
    linkedType: null,
    linkedId: null,
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2025-06-01T00:00:00Z",
  },
];

/* ────────── enum constants ────────── */

describe("CABINET_DIRECTIONS", () => {
  it("lists the three canonical directions", () => {
    expect(CABINET_DIRECTIONS).toEqual(["incoming", "outgoing", "internal"]);
  });
});

describe("CABINET_STATUSES", () => {
  it("lists the two canonical statuses", () => {
    expect(CABINET_STATUSES).toEqual(["active", "archived"]);
  });
});

/* ────────── buildCabinetCreate ────────── */

describe("buildCabinetCreate", () => {
  it("happy path: trims title and includes every provided field", () => {
    const out = buildCabinetCreate({
      title: "  Մուտքային պայմանագիր  ",
      direction: "incoming",
      docType: "contract",
      linkedType: "customer",
      linkedId: "  cust-ani  ",
      body: "  Բովանդակություն  ",
      idempotencyKey: "  cab-create-1  ",
    });
    expect(out).toEqual({
      title: "Մուտքային պայմանագիր",
      direction: "incoming",
      docType: "contract",
      linkedType: "customer",
      linkedId: "cust-ani",
      body: "Բովանդակություն",
      idempotencyKey: "cab-create-1",
    });
  });

  it("strips empty linkedId, body, and docType (no key in payload)", () => {
    const out = buildCabinetCreate({
      title: "Minimal",
      direction: "outgoing",
      docType: "   ",
      linkedId: "",
      body: "",
      idempotencyKey: "cab-empty",
    });
    expect(out).toEqual({
      title: "Minimal",
      direction: "outgoing",
      idempotencyKey: "cab-empty",
    });
    expect("docType" in out).toBe(false);
    expect("linkedId" in out).toBe(false);
    expect("body" in out).toBe(false);
  });

  it("throws on a missing idempotencyKey (empty string)", () => {
    expect(() =>
      buildCabinetCreate({
        title: "Boom",
        direction: "incoming",
        idempotencyKey: "",
      }),
    ).toThrow(/idempotencyKey is required/);
  });

  it("throws on a whitespace-only idempotencyKey", () => {
    expect(() =>
      buildCabinetCreate({
        title: "Boom",
        direction: "incoming",
        idempotencyKey: "   \t\n  ",
      }),
    ).toThrow(/idempotencyKey is required/);
  });

  it("omits linkedType when the caller does not provide one (allows server to default)", () => {
    const out = buildCabinetCreate({
      title: "X",
      direction: "internal",
      idempotencyKey: "k1",
    });
    expect("linkedType" in out).toBe(false);
  });
});

/* ────────── filterCabinetDocuments ────────── */

describe("filterCabinetDocuments", () => {
  it("returns all docs when no filters are set", () => {
    const out = filterCabinetDocuments(DOCS, {});
    expect(out).toHaveLength(DOCS.length);
    expect(out.map((d) => d.id)).toEqual([
      "cab-1",
      "cab-2",
      "cab-3",
      "cab-4",
      "cab-5",
    ]);
  });

  it("treats a missing title (nullish-coalesce branch) as empty string for q matching", () => {
    // Malformed runtime value: the schema requires title, but the helper
    // must not throw on a missing field — fall back to "".
    const broken = {
      ...DOCS[0],
      id: "cab-broken",
      title: undefined as unknown as string,
    };
    const out = filterCabinetDocuments([broken], { q: "anything" });
    expect(out).toEqual([]);
    const out2 = filterCabinetDocuments([broken], {});
    expect(out2).toHaveLength(1);
  });

  it("combines direction + status + q into a single subset", () => {
    const out = filterCabinetDocuments(DOCS, {
      direction: "incoming",
      status: "active",
      q: "Մուտքային",
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("cab-1");
  });

  it("treats whitespace-only q as no text filter", () => {
    const out = filterCabinetDocuments(DOCS, { q: "   \t  " });
    expect(out).toHaveLength(DOCS.length);
  });

  it("matches q case-insensitively against the title", () => {
    const out = filterCabinetDocuments(DOCS, { q: "ՄՈՒՏdelays" });
    // No match — uppercase ՄՈՒՑ does not appear; expect 0
    expect(out).toHaveLength(0);
    const out2 = filterCabinetDocuments(DOCS, { q: "մուտdelays" });
    expect(out2).toHaveLength(0);
    // Real lowercase match
    const out3 = filterCabinetDocuments(DOCS, { q: "մուտ" });
    expect(out3.map((d) => d.id)).toEqual(["cab-1"]);
  });

  it("filters by status only", () => {
    const out = filterCabinetDocuments(DOCS, { status: "archived" });
    expect(out.map((d) => d.id).sort()).toEqual(["cab-4", "cab-5"]);
  });

  it("filters by direction only", () => {
    const out = filterCabinetDocuments(DOCS, { direction: "internal" });
    expect(out.map((d) => d.id)).toEqual(["cab-3"]);
  });

  it("does not mutate the input array", () => {
    const snapshot = DOCS.map((d) => d.id);
    filterCabinetDocuments(DOCS, { status: "active" });
    expect(DOCS.map((d) => d.id)).toEqual(snapshot);
  });
});

/* ────────── sortCabinetDocumentsByActivity ────────── */

describe("sortCabinetDocumentsByActivity", () => {
  it("puts active rows before archived rows, then updatedAt desc within each bucket", () => {
    const out = sortCabinetDocumentsByActivity(DOCS);
    // active first (3 of them, most-recent-updated first), then archived (2 of them, most-recent first).
    expect(out.map((d) => d.id)).toEqual([
      "cab-1", // active, 2026-06-15
      "cab-2", // active, 2026-06-10
      "cab-3", // active, 2026-06-08
      "cab-4", // archived, 2025-12-01
      "cab-5", // archived, 2025-06-01
    ]);
  });

  it("is stable for equal updatedAt within the same status bucket", () => {
    const sameTs = "2026-06-15T00:00:00Z";
    const tie: CabinetDocument[] = [
      { ...DOCS[0], id: "cab-a", status: "active", updatedAt: sameTs },
      { ...DOCS[0], id: "cab-b", status: "active", updatedAt: sameTs },
      { ...DOCS[0], id: "cab-c", status: "active", updatedAt: sameTs },
    ];
    const out = sortCabinetDocumentsByActivity(tie);
    expect(out.map((d) => d.id)).toEqual(["cab-a", "cab-b", "cab-c"]);
  });

  it("is stable for equal updatedAt within the archived bucket", () => {
    const sameTs = "2025-01-01T00:00:00Z";
    const tie: CabinetDocument[] = [
      { ...DOCS[3], id: "cab-x", status: "archived", updatedAt: sameTs },
      { ...DOCS[3], id: "cab-y", status: "archived", updatedAt: sameTs },
    ];
    const out = sortCabinetDocumentsByActivity(tie);
    expect(out.map((d) => d.id)).toEqual(["cab-x", "cab-y"]);
  });

  it("does not mutate the input array", () => {
    const snapshot = DOCS.map((d) => d.id);
    sortCabinetDocumentsByActivity(DOCS);
    expect(DOCS.map((d) => d.id)).toEqual(snapshot);
  });

  it("handles an empty list", () => {
    expect(sortCabinetDocumentsByActivity([])).toEqual([]);
  });

  it("treats a missing updatedAt (nullish-coalesce branch) as empty string", () => {
    const ts = "2026-06-15T00:00:00Z";
    const a: CabinetDocument = { ...DOCS[0], id: "cab-with", updatedAt: ts };
    const b: CabinetDocument = {
      ...DOCS[0],
      id: "cab-without",
      updatedAt: undefined as unknown as string,
    };
    // The "with" doc has a real timestamp; the "without" doc falls back to "".
    // Empty string < "2026-06-15..." in localeCompare, so "with" sorts first.
    const out = sortCabinetDocumentsByActivity([b, a]);
    expect(out.map((d) => d.id)).toEqual(["cab-with", "cab-without"]);
  });

  it("sorts a mixed list where the leading doc has a real updatedAt and the trailing doc has none", () => {
    const a: CabinetDocument = {
      ...DOCS[0],
      id: "cab-real",
      status: "active",
      updatedAt: "2026-06-15T00:00:00Z",
    };
    const b: CabinetDocument = {
      ...DOCS[0],
      id: "cab-missing",
      status: "active",
      updatedAt: undefined as unknown as string,
    };
    // Run the sort in both input orders to exercise both ?? outcomes.
    const out1 = sortCabinetDocumentsByActivity([a, b]);
    expect(out1.map((d) => d.id)).toEqual(["cab-real", "cab-missing"]);
    const out2 = sortCabinetDocumentsByActivity([b, a]);
    expect(out2.map((d) => d.id)).toEqual(["cab-real", "cab-missing"]);
  });
});

/* ────────── cabinetStatusTone ────────── */

describe("cabinetStatusTone", () => {
  it("returns 'positive' for active", () => {
    expect(cabinetStatusTone({ status: "active" })).toBe<CabinetTone>("positive");
  });
  it("returns 'muted' for archived", () => {
    expect(cabinetStatusTone({ status: "archived" })).toBe<CabinetTone>("muted");
  });
});

/* ────────── classifyCabinetStatus / Armenian subtitle ────────── */

describe("classifyCabinetStatus", () => {
  it("returns the English label for active", () => {
    expect(classifyCabinetStatus({ status: "active" })).toBe("Active");
  });
  it("returns the English label for archived", () => {
    expect(classifyCabinetStatus({ status: "archived" })).toBe("Archived");
  });
});

describe("cabinetStatusLabelHy", () => {
  it("returns the Armenian label for active", () => {
    expect(cabinetStatusLabelHy({ status: "active" })).toBe("Ակտիվ");
  });
  it("returns the Armenian label for archived", () => {
    expect(cabinetStatusLabelHy({ status: "archived" })).toBe("Արխիվացված");
  });
});

/* ────────── directionLabelArm ────────── */

describe("directionLabelArm", () => {
  it("contains the Armenian word for incoming", () => {
    expect(directionLabelArm("incoming")).toContain("Մուտքային");
  });
  it("contains the Armenian word for outgoing", () => {
    expect(directionLabelArm("outgoing")).toContain("Ելքային");
  });
  it("contains the Armenian word for internal", () => {
    expect(directionLabelArm("internal")).toContain("Ներքին");
  });
  it("appends the English gloss in parens", () => {
    expect(directionLabelArm("incoming")).toMatch(/\(Incoming\)$/);
  });
});

/* ────────── cabinetEmptyMessage ────────── */

describe("cabinetEmptyMessage", () => {
  it("returns a different string when q is set vs unset", () => {
    const withQ = cabinetEmptyMessage({ q: "չկա" });
    const withoutQ = cabinetEmptyMessage({});
    expect(withQ).not.toBe(withoutQ);
    expect(withQ).toContain("չկա");
  });

  it("returns the archived-specific message when status=archived", () => {
    expect(cabinetEmptyMessage({ status: "archived" })).toContain("Արխիվացված");
  });

  it("returns a direction-scoped message for incoming/outgoing", () => {
    expect(cabinetEmptyMessage({ direction: "incoming" })).toContain("Մուտքային");
    expect(cabinetEmptyMessage({ direction: "outgoing" })).toContain("Ելքային");
  });

  it("falls through to the generic empty message when only direction=internal is set", () => {
    const out = cabinetEmptyMessage({ direction: "internal" });
    expect(out).toBe("Փաստաթղթեր դեռ չկան");
  });

  it("q takes priority over status and direction in the messaging", () => {
    const out = cabinetEmptyMessage({
      direction: "incoming",
      status: "archived",
      q: "Փաստ",
    });
    expect(out).toContain("Փաստ");
  });
});
