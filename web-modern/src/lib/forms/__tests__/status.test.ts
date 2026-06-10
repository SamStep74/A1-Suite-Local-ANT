/**
 * status.test.ts — unit tests for the Forms pure helpers.
 *
 * Mirrors web-modern/src/lib/cfo/__tests__/status.test.ts pattern.
 * Submission counts are integer AMD-equivalents (whole submissions).
 */
import { describe, it, expect } from "vitest";
import {
  int,
  intOrNull,
  classifyFormStatus,
  formStatusTone,
  classifyFieldType,
  fieldTypeBadge,
  totalSubmissions,
  countFormsByStatus,
  hasRequiredFields,
  requiredFieldCount,
  sortByUpdatedAtDesc,
  sortBySubmissionCountDesc,
  sortByTitleAsc,
  isFieldFilled,
  filledFieldCount,
  extractLeadId,
  sortSubmissionsByCreatedAtDesc,
  formatSubmissionCount,
  formatShortDate,
  FIELD_TYPE_BADGE,
  FORM_STATUSES,
  type FormTone,
} from "../status";

/* ────────── fixtures ────────── */

const FORMS = {
  draft: { id: "f1", status: "draft", submissionCount: 0, title: "Contact", updatedAt: "2026-06-01T00:00:00Z" },
  published: { id: "f2", status: "published", submissionCount: 12, title: "Lead", updatedAt: "2026-06-15T00:00:00Z" },
  closed: { id: "f3", status: "closed", submissionCount: 3, title: "Beta", updatedAt: "2026-06-08T00:00:00Z" },
  archived: { id: "f4", status: "archived", submissionCount: 99, title: "Old", updatedAt: "2026-01-01T00:00:00Z" },
  garbage: { id: "f5", status: "garbage", submissionCount: 1, title: "Z" },
  missing: { id: "f6", status: undefined as unknown as string, submissionCount: 0, title: "Q" },
};

const FIELDS = [
  { key: "name", label: "Name", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
  { key: "phone", label: "Phone", type: "phone", required: false },
  { key: "interest", label: "Interest", type: "textarea", required: false },
  { key: "plan", label: "Plan", type: "select", required: false },
  { key: "agree", label: "I agree", type: "checkbox", required: true },
  { key: "qty", label: "Quantity", type: "number", required: false },
  { key: "due", label: "Due date", type: "date", required: false },
];

/* ────────── int helpers ────────── */

describe("int", () => {
  it("truncates a finite number", () => {
    expect(int(12.9)).toBe(12);
    expect(int(-3.4)).toBe(-3);
  });
  it("parses numeric strings", () => {
    expect(int("42")).toBe(42);
    expect(int(" 7 ")).toBe(7);
  });
  it("returns 0 for non-numeric strings / null / undefined", () => {
    expect(int("abc")).toBe(0);
    expect(int(null)).toBe(0);
    expect(int(undefined)).toBe(0);
  });
  it("returns 0 for NaN/Infinity", () => {
    expect(int(NaN)).toBe(0);
    expect(int(Infinity)).toBe(0);
  });
});

describe("intOrNull", () => {
  it("returns the integer when valid", () => {
    expect(intOrNull(12)).toBe(12);
    expect(intOrNull("42")).toBe(42);
  });
  it("returns null for invalid values", () => {
    expect(intOrNull(null)).toBeNull();
    expect(intOrNull(undefined)).toBeNull();
    expect(intOrNull("abc")).toBeNull();
  });
});

/* ────────── classifyFormStatus ────────── */

describe("classifyFormStatus", () => {
  it("maps known statuses", () => {
    expect(classifyFormStatus(FORMS.draft)).toBe("draft");
    expect(classifyFormStatus(FORMS.published)).toBe("published");
    expect(classifyFormStatus(FORMS.closed)).toBe("closed");
    expect(classifyFormStatus(FORMS.archived)).toBe("archived");
  });
  it("falls back to 'unknown' for unrecognized values", () => {
    expect(classifyFormStatus(FORMS.garbage)).toBe("unknown");
    expect(classifyFormStatus(FORMS.missing)).toBe("unknown");
    expect(classifyFormStatus(null)).toBe("unknown");
  });
});

describe("formStatusTone", () => {
  it("returns positive for published", () => {
    expect(formStatusTone(FORMS.published)).toBe<FormTone>("positive");
  });
  it("returns warning for closed", () => {
    expect(formStatusTone(FORMS.closed)).toBe<FormTone>("warning");
  });
  it("returns muted for draft", () => {
    expect(formStatusTone(FORMS.draft)).toBe<FormTone>("muted");
  });
  it("returns negative for archived", () => {
    expect(formStatusTone(FORMS.archived)).toBe<FormTone>("negative");
  });
  it("returns muted for unknown", () => {
    expect(formStatusTone(FORMS.garbage)).toBe<FormTone>("muted");
  });
});

/* ────────── classifyFieldType ────────── */

describe("classifyFieldType", () => {
  it("buckets short-text fields", () => {
    expect(classifyFieldType({ type: "text" })).toBe("short-text");
    expect(classifyFieldType({ type: "email" })).toBe("short-text");
    expect(classifyFieldType({ type: "phone" })).toBe("short-text");
  });
  it("buckets long-text fields", () => {
    expect(classifyFieldType({ type: "textarea" })).toBe("long-text");
  });
  it("buckets choice / boolean / numeric / temporal", () => {
    expect(classifyFieldType({ type: "select" })).toBe("choice");
    expect(classifyFieldType({ type: "checkbox" })).toBe("boolean");
    expect(classifyFieldType({ type: "number" })).toBe("numeric");
    expect(classifyFieldType({ type: "date" })).toBe("temporal");
  });
  it("returns 'other' for unknown / missing", () => {
    expect(classifyFieldType({ type: "rating" })).toBe("other");
    expect(classifyFieldType({})).toBe("other");
    expect(classifyFieldType(null)).toBe("other");
  });
});

describe("fieldTypeBadge", () => {
  it("returns Armenian label for short-text", () => {
    expect(fieldTypeBadge({ type: "text" })).toBe("Տեքստ");
  });
  it("returns Armenian label for long-text", () => {
    expect(fieldTypeBadge({ type: "textarea" })).toBe("Տեքստ (երկար)");
  });
  it("returns Armenian label for choice", () => {
    expect(fieldTypeBadge({ type: "select" })).toBe("Ընտրանք");
  });
  it("returns 'Այլ' for unknown", () => {
    expect(fieldTypeBadge({ type: "rating" })).toBe("Այլ");
  });
});

describe("FIELD_TYPE_BADGE", () => {
  it("has 7 keys", () => {
    expect(Object.keys(FIELD_TYPE_BADGE)).toHaveLength(7);
  });
});

/* ────────── aggregates ────────── */

describe("totalSubmissions", () => {
  it("sums submissionCount across forms", () => {
    const all = [FORMS.draft, FORMS.published, FORMS.closed, FORMS.archived];
    expect(totalSubmissions(all)).toBe(0 + 12 + 3 + 99);
  });
  it("returns 0 for an empty list", () => {
    expect(totalSubmissions([])).toBe(0);
  });
});

describe("countFormsByStatus", () => {
  it("counts each status bucket", () => {
    const all = [FORMS.draft, FORMS.published, FORMS.closed, FORMS.archived, FORMS.garbage];
    const counts = countFormsByStatus(all);
    expect(counts.draft).toBe(1);
    expect(counts.published).toBe(1);
    expect(counts.closed).toBe(1);
    expect(counts.archived).toBe(1);
    expect(counts.unknown).toBe(1);
  });
});

describe("hasRequiredFields", () => {
  it("returns true when at least one field is required", () => {
    expect(hasRequiredFields(FIELDS)).toBe(true);
  });
  it("returns false when no field is required", () => {
    expect(
      hasRequiredFields([
        { key: "x", label: "x", type: "text", required: false },
      ]),
    ).toBe(false);
  });
  it("returns false for an empty list", () => {
    expect(hasRequiredFields([])).toBe(false);
    expect(hasRequiredFields(null)).toBe(false);
  });
});

describe("requiredFieldCount", () => {
  it("counts required fields", () => {
    expect(requiredFieldCount(FIELDS)).toBe(3); // name, email, agree
  });
  it("returns 0 for an empty list", () => {
    expect(requiredFieldCount([])).toBe(0);
  });
});

/* ────────── ordering ────────── */

describe("sortByUpdatedAtDesc", () => {
  it("sorts by updatedAt descending", () => {
    const all = [FORMS.draft, FORMS.published, FORMS.archived];
    const out = all.slice().sort(sortByUpdatedAtDesc).map((f) => f.id);
    expect(out).toEqual(["f2", "f1", "f4"]);
  });
});

describe("sortBySubmissionCountDesc", () => {
  it("sorts by submissionCount descending", () => {
    const all = [FORMS.draft, FORMS.published, FORMS.archived, FORMS.closed];
    const out = all.slice().sort(sortBySubmissionCountDesc).map((f) => f.id);
    expect(out).toEqual(["f4", "f2", "f3", "f1"]); // 99, 12, 3, 0
  });
});

describe("sortByTitleAsc", () => {
  it("sorts by title ascending", () => {
    const all = [FORMS.archived, FORMS.closed, FORMS.published, FORMS.draft];
    const out = all.slice().sort(sortByTitleAsc).map((f) => f.title);
    expect(out).toEqual(["Beta", "Contact", "Lead", "Old"]);
  });
});

/* ────────── submission helpers ────────── */

describe("isFieldFilled", () => {
  it("returns false for null / undefined / empty string", () => {
    expect(isFieldFilled(null)).toBe(false);
    expect(isFieldFilled(undefined)).toBe(false);
    expect(isFieldFilled("")).toBe(false);
    expect(isFieldFilled("   ")).toBe(false);
  });
  it("returns false for empty arrays / objects", () => {
    expect(isFieldFilled([])).toBe(false);
    expect(isFieldFilled({})).toBe(false);
  });
  it("returns true for non-empty values", () => {
    expect(isFieldFilled("hello")).toBe(true);
    expect(isFieldFilled(0)).toBe(true);
    expect(isFieldFilled(["a"])).toBe(true);
    expect(isFieldFilled({ k: "v" })).toBe(true);
  });
});

describe("filledFieldCount", () => {
  it("counts only fields with a value present", () => {
    expect(
      filledFieldCount(
        { data: { name: "Alice", email: "a@b.co", phone: "" } },
        FIELDS.slice(0, 3),
      ),
    ).toBe(2);
  });
  it("returns 0 for an empty data object", () => {
    expect(filledFieldCount({ data: {} }, FIELDS)).toBe(0);
  });
  it("returns 0 for a missing data field", () => {
    expect(filledFieldCount({}, FIELDS)).toBe(0);
  });
});

describe("extractLeadId", () => {
  it("returns the leadId when set", () => {
    expect(extractLeadId({ leadId: "lead-1" })).toBe("lead-1");
  });
  it("returns null when missing or null", () => {
    expect(extractLeadId({ leadId: null })).toBeNull();
    expect(extractLeadId({ leadId: undefined })).toBeNull();
    expect(extractLeadId(null)).toBeNull();
  });
});

describe("sortSubmissionsByCreatedAtDesc", () => {
  it("sorts by createdAt descending", () => {
    const subs = [
      { id: "a", createdAt: "2026-06-01T00:00:00Z" },
      { id: "b", createdAt: "2026-06-05T00:00:00Z" },
      { id: "c", createdAt: "2026-06-03T00:00:00Z" },
    ];
    const out = subs.slice().sort(sortSubmissionsByCreatedAtDesc).map((s) => s.id);
    expect(out).toEqual(["b", "c", "a"]);
  });
});

/* ────────── formatting ────────── */

describe("formatSubmissionCount", () => {
  it("formats with Armenian digit grouping", () => {
    expect(formatSubmissionCount(1200)).toMatch(/1\s*200/);
  });
  it("returns the input as a plain integer for small values", () => {
    expect(formatSubmissionCount(5)).toMatch(/5/);
  });
  it("returns '—' for null/NaN", () => {
    expect(formatSubmissionCount(null)).toBe("—");
    expect(formatSubmissionCount(NaN)).toBe("—");
  });
});

describe("formatShortDate", () => {
  it("returns the YYYY-MM-DD portion of an ISO string", () => {
    expect(formatShortDate("2026-06-15T10:30:00Z")).toBe("2026-06-15");
  });
  it("returns the input unchanged for date-only strings", () => {
    expect(formatShortDate("2026-06-15")).toBe("2026-06-15");
  });
  it("returns '—' for missing / invalid values", () => {
    expect(formatShortDate(null)).toBe("—");
    expect(formatShortDate(undefined)).toBe("—");
    expect(formatShortDate("abc")).toBe("—");
  });
});

/* ────────── FORM_STATUSES ────────── */

describe("FORM_STATUSES", () => {
  it("contains the four canonical statuses", () => {
    expect(FORM_STATUSES).toEqual(["draft", "published", "closed", "archived"]);
  });
});
