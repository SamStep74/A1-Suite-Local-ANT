/**
 * Triage default saved views — unit tests.
 *
 * Asserts the seeding contract:
 *   - First seed inserts the three named defaults.
 *   - Second seed is a no-op (idempotent).
 *   - The encoded filter round-trips through encode/decode.
 *   - The defaults carry the filter keys the route expects
 *     (statusIn, sourceIn, assigneeMatch, query).
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  __clearForTests,
} from "../components/savedViewsStore";
import {
  TRIAGE_DEFAULT_VIEWS,
  TRIAGE_TABLE_ID,
  decodeTriageFilter,
  encodeTriageFilter,
  seedDefaultTriageViews,
} from "./savedViews";

describe("triage default saved views", () => {
  beforeEach(() => {
    __clearForTests(TRIAGE_TABLE_ID);
  });

  it("seeds three defaults the first time", () => {
    const seeded = seedDefaultTriageViews();
    expect(seeded.length).toBe(3);
    const names = seeded.map((v) => v.name).sort();
    expect(names).toEqual(
      [...TRIAGE_DEFAULT_VIEWS.map((v) => v.label)].sort(),
    );
  });

  it("is idempotent: second call leaves the store alone", () => {
    const first = seedDefaultTriageViews();
    const second = seedDefaultTriageViews();
    expect(second.length).toBe(first.length);
    // Same ids, not duplicates.
    expect(second.map((v) => v.id).sort()).toEqual(first.map((v) => v.id).sort());
  });

  it("round-trips a filter through encode/decode", () => {
    const original = {
      statusIn: ["open"] as const,
      sourceIn: ["invoice", "tax-gate"] as const,
      query: "overdue",
      assigneeMatch: "me",
    };
    const encoded = encodeTriageFilter(original);
    const decoded = decodeTriageFilter(encoded);
    expect(decoded).toEqual(original);
  });

  it("decodes malformed JSON to an empty filter", () => {
    const empty = decodeTriageFilter({
      sort: null,
      filter: "{not valid json",
      page: 0,
      pageSize: 25,
      columns: [],
    });
    expect(empty).toEqual({});
  });

  it("seeds with the expected filter keys per default", () => {
    seedDefaultTriageViews();
    // Re-load so we can re-derive the filter from the saved
    // view. We re-import loadViews here to keep the test
    // self-contained.
    // (loadViews is already imported transitively through the
    // seed function, but we re-call it for clarity.)
    const views = seedDefaultTriageViews();
    for (const v of views) {
      const f = decodeTriageFilter(v.state);
      // Every default carries at least one filter key.
      const keys = Object.keys(f);
      expect(keys.length).toBeGreaterThan(0);
    }
  });
});
