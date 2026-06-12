/**
 * savedViewsStore — round-trip + SSR safety + subscriber fan-out.
 *
 * Each case resets the localStorage slot for the tableId it owns so
 * cases don't bleed into each other. The test mirrors the
 * `I18nProvider.test.tsx` pattern: mutate jsdom globals directly,
 * assert the function under test's return value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearForTests,
  deleteView,
  loadViews,
  renameView,
  saveView,
  subscribeToViews,
  type SavedViewState,
} from "./savedViewsStore";

const TID = "test-table";

const baseState = (over: Partial<SavedViewState> = {}): SavedViewState => ({
  sort: { id: "name", desc: false },
  filter: "",
  page: 0,
  pageSize: 25,
  columns: ["name", "total"],
  ...over,
});

beforeEach(() => {
  __clearForTests(TID);
});

afterEach(() => {
  __clearForTests(TID);
});

describe("savedViewsStore — CRUD round-trip", () => {
  it("starts empty", () => {
    expect(loadViews(TID)).toEqual([]);
  });

  it("saveView appends a new record and returns it", () => {
    const v = saveView(TID, "Default", baseState());
    expect(v.name).toBe("Default");
    expect(v.id).toMatch(/^sv_/);
    expect(v.state).toEqual(baseState());
    const all = loadViews(TID);
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(v.id);
  });

  it("multiple saves are appended in order", () => {
    saveView(TID, "A", baseState());
    saveView(TID, "B", baseState());
    saveView(TID, "C", baseState());
    const names = loadViews(TID).map((v) => v.name);
    expect(names).toEqual(["A", "B", "C"]);
  });

  it("saveView with empty name falls back to 'Untitled'", () => {
    const v = saveView(TID, "   ", baseState());
    expect(v.name).toBe("Untitled");
  });

  it("deleteView removes the matching record and leaves others", () => {
    const a = saveView(TID, "A", baseState());
    saveView(TID, "B", baseState());
    deleteView(TID, a.id);
    const after = loadViews(TID);
    expect(after).toHaveLength(1);
    expect(after[0]?.name).toBe("B");
  });

  it("deleteView with unknown id is a no-op", () => {
    saveView(TID, "A", baseState());
    deleteView(TID, "does-not-exist");
    expect(loadViews(TID)).toHaveLength(1);
  });

  it("renameView updates only the matching record", () => {
    const a = saveView(TID, "A", baseState());
    saveView(TID, "B", baseState());
    renameView(TID, a.id, "AAA");
    const after = loadViews(TID);
    expect(after[0]?.name).toBe("AAA");
    expect(after[1]?.name).toBe("B");
  });

  it("renameView with empty/whitespace name is a no-op", () => {
    const a = saveView(TID, "Original", baseState());
    renameView(TID, a.id, "   ");
    expect(loadViews(TID)[0]?.name).toBe("Original");
  });

  it("state partial-merge fills in missing defaults", () => {
    const v = saveView(TID, "S", { sort: null, filter: "x" } as Partial<SavedViewState> as SavedViewState);
    expect(v.state.page).toBe(0);
    expect(v.state.pageSize).toBe(25);
    expect(v.state.columns).toEqual([]);
    expect(v.state.filter).toBe("x");
  });
});

describe("savedViewsStore — corruption resilience", () => {
  it("loadViews returns [] when the slot holds invalid JSON", () => {
    window.localStorage.setItem("a1:savedViews:" + TID, "{not json");
    expect(loadViews(TID)).toEqual([]);
  });

  it("loadViews returns [] when the slot holds a non-array", () => {
    window.localStorage.setItem("a1:savedViews:" + TID, JSON.stringify({ foo: 1 }));
    expect(loadViews(TID)).toEqual([]);
  });

  it("loadViews filters out records that don't match the SavedView shape", () => {
    window.localStorage.setItem(
      "a1:savedViews:" + TID,
      JSON.stringify([
        { id: "sv_1", name: "Good", state: {}, createdAt: "2026-01-01" },
        { id: 42 }, // bad id
        "string", // not an object
        null, // not an object
      ]),
    );
    const out = loadViews(TID);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("Good");
  });
});

describe("savedViewsStore — subscription fan-out", () => {
  it("subscribers fire on save", () => {
    const cb = vi.fn();
    const off = subscribeToViews(TID, cb);
    saveView(TID, "A", baseState());
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it("subscribers fire on delete and rename", () => {
    const cb = vi.fn();
    const a = saveView(TID, "A", baseState());
    const off = subscribeToViews(TID, cb);
    renameView(TID, a.id, "AAA");
    deleteView(TID, a.id);
    expect(cb).toHaveBeenCalledTimes(2);
    off();
  });

  it("unsubscribe stops further notifications", () => {
    const cb = vi.fn();
    const off = subscribeToViews(TID, cb);
    off();
    saveView(TID, "A", baseState());
    expect(cb).not.toHaveBeenCalled();
  });

  it("subscribers are scoped per tableId", () => {
    const a = vi.fn();
    const offA = subscribeToViews("table-A", a);
    const b = vi.fn();
    const offB = subscribeToViews("table-B", b);
    saveView("table-A", "x", baseState());
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    offA();
    offB();
  });
});

describe("savedViewsStore — SSR safety (window=undefined)", () => {
  it("loadViews returns [] when window is absent", () => {
    const orig = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: undefined,
    });
    try {
      expect(loadViews(TID)).toEqual([]);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: orig,
      });
    }
  });
});
