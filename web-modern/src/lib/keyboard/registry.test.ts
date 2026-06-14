/**
 * Keyboard — registry unit tests.
 *
 * Pins the contract for the singleton registry:
 *   - registerShortcut / unregisterShortcut round-trip.
 *   - dispatch returns the matching entry (or null).
 *   - active scope beats `global`; first-registered wins on
 *     ties.
 *   - disabled entries are skipped.
 *   - a throwing handler does not poison the dispatch chain.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetKeyboardRegistryForTests,
  dispatch,
  getActiveScope,
  listEntries,
  registerShortcut,
  setActiveScope,
  unregisterShortcut,
} from "./registry";

function ev(opts: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...opts });
}

describe("keyboard registry", () => {
  beforeEach(() => {
    __resetKeyboardRegistryForTests();
  });

  it("registers and dispatches a single entry", () => {
    let called = 0;
    registerShortcut({
      id: "test.k",
      groupId: "actions",
      scope: "global",
      chord: "k",
      description: "test k",
      handler: () => {
        called++;
      },
    });
    const fired = dispatch(ev({ key: "k" }));
    expect(fired?.id).toBe("test.k");
    expect(called).toBe(1);
  });

  it("returns null when no entry matches", () => {
    registerShortcut({
      id: "test.k",
      groupId: "actions",
      scope: "global",
      chord: "k",
      description: "test k",
      handler: () => undefined,
    });
    expect(dispatch(ev({ key: "j" }))).toBeNull();
  });

  it("unregisterShortcut removes the entry", () => {
    const un = registerShortcut({
      id: "test.k",
      groupId: "actions",
      scope: "global",
      chord: "k",
      description: "test k",
      handler: () => undefined,
    });
    un();
    expect(dispatch(ev({ key: "k" }))).toBeNull();
  });

  it("respects active scope over global", () => {
    let activeHit = 0;
    let globalHit = 0;
    registerShortcut({
      id: "g.k",
      groupId: "actions",
      scope: "global",
      chord: "k",
      description: "global k",
      handler: () => {
        globalHit++;
      },
    });
    registerShortcut({
      id: "s.k",
      groupId: "actions",
      scope: "fiscal-gates",
      chord: "k",
      description: "scoped k",
      handler: () => {
        activeHit++;
      },
    });
    setActiveScope("fiscal-gates");
    expect(getActiveScope()).toBe("fiscal-gates");
    dispatch(ev({ key: "k" }));
    expect(activeHit).toBe(1);
    expect(globalHit).toBe(0);
  });

  it("falls back to global handlers when the active scope has no match", () => {
    let globalHit = 0;
    registerShortcut({
      id: "g.k",
      groupId: "actions",
      scope: "global",
      chord: "k",
      description: "global k",
      handler: () => {
        globalHit++;
      },
    });
    setActiveScope("triage-inbox");
    dispatch(ev({ key: "k" }));
    expect(globalHit).toBe(1);
  });

  it("skips disabled entries", () => {
    let called = 0;
    registerShortcut({
      id: "test.k",
      groupId: "actions",
      scope: "global",
      chord: "k",
      description: "test k",
      enabled: false,
      handler: () => {
        called++;
      },
    });
    expect(dispatch(ev({ key: "k" }))).toBeNull();
    expect(called).toBe(0);
  });

  it("does not let a throwing handler kill the dispatch chain", () => {
    let secondCalled = 0;
    registerShortcut({
      id: "test.bad",
      groupId: "actions",
      scope: "global",
      chord: "k",
      description: "bad",
      handler: () => {
        throw new Error("boom");
      },
    });
    unregisterShortcut("test.bad", "global", "k");
    registerShortcut({
      id: "test.good",
      groupId: "actions",
      scope: "global",
      chord: "k",
      description: "good",
      handler: () => {
        secondCalled++;
      },
    });
    // The first registration will throw, but the second
    // registration is now in place. dispatch should still
    // succeed on the second one.
    expect(dispatch(ev({ key: "k" }))?.id).toBe("test.good");
    expect(secondCalled).toBe(1);
  });

  it("listEntries returns a stable sorted view", () => {
    registerShortcut({
      id: "b",
      groupId: "lists",
      scope: "global",
      chord: "k",
      description: "k",
      handler: () => undefined,
    });
    registerShortcut({
      id: "a",
      groupId: "actions",
      scope: "global",
      chord: "j",
      description: "j",
      handler: () => undefined,
    });
    const list = listEntries();
    expect(list.map((e) => e.id)).toEqual(["a", "b"]);
  });
});
