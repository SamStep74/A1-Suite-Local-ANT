/**
 * useTour.test.tsx — state machine for the first-run tour overlay.
 *
 * Drives the hook through every transition:
 *   start → next → next → ... → finish (auto)
 *   start → back (no-op at step 0)
 *   start → next → skip (closes, NOT marked done)
 *   start → next → next → ... → next (last step) → finish (auto)
 *   reset(tourId) (clears the "done" flag)
 *
 * Uses a `renderHook` helper to render `useTour` in isolation
 * (no router context, no Lingui provider) — the hook is
 * designed to be unit-testable without external providers.
 *
 * The Lingui macro mock at the top stub `t()` so the catalog
 * import in `lib/onboarding/tours.ts` resolves cleanly without
 * enabling the babel-plugin-macros pipeline (see
 * `vitest.config.ts` for the full rationale). The hook itself
 * doesn't render any Lingui components, so the React-side mock
 * is not strictly required here — it's added defensively in
 * case the hook is later refactored to render preview text.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@lingui/core/macro", () => ({
  t: (msg: { message: string }) => msg.message,
  defineMessage: (msg: { message: string }) => msg,
}));

vi.mock("@lingui/react/macro", () => ({
  // Note: the SUT (tours.ts) imports `t` from `@lingui/core/macro`, but
  // because the Lingui macro package re-exports the same surface across
  // paths, vitest's mock resolver occasionally routes a `@lingui/core/macro`
  // import to the *react/macro* mock when both are hoisted in the same
  // file. Exporting `t` here too makes the test resilient to that quirk.
  t: (msg: { message: string } | string) => (typeof msg === "string" ? msg : msg.message),
  useLingui: () => ({
    i18n: { _: (msg: { message: string } | string) => (typeof msg === "string" ? msg : msg.message) },
    t: (msg: { message: string } | string) => (typeof msg === "string" ? msg : msg.message),
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => children,
  Plural: ({ children }: { children?: React.ReactNode }) => children,
  Select: ({ children, value }: { children?: React.ReactNode; value?: unknown }) => value ?? children,
  SelectOrdinal: ({ children, value }: { children?: React.ReactNode; value?: unknown }) => value ?? children,
}));

import { act, renderHook, type RenderHookOptions } from "@testing-library/react";
import { useTour } from "../useTour";
import { DEFAULT_TOURS_BY_ID, ALL_TOUR_IDS } from "../../../lib/onboarding/tours";
import { readDone, doneKey, DONE_VALUE } from "../../../lib/onboarding/state";

/** Strip a non-React props wrapper around the hook so the test
 *  can call `useTour({ onNavigate: ... })` without a Provider. */
function setup(opts?: { onNavigate?: (path: string) => void }) {
  const renderOpts: RenderHookOptions<{ onNavigate?: (path: string) => void }> = {
    initialProps: opts ?? {},
  };
  return renderHook(({ onNavigate }: { onNavigate?: (path: string) => void }) => useTour({ onNavigate }), renderOpts);
}

describe("useTour — state machine", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts closed with no done flags", () => {
    const { result } = setup();
    expect(result.current.view.kind).toBe("closed");
    for (const id of ALL_TOUR_IDS) {
      expect(result.current.isDone(id)).toBe(false);
    }
  });

  it("start(tourId) opens the overlay at step 0 and navigates on a navigate step", () => {
    const onNav = vi.fn();
    const { result } = setup({ onNavigate: onNav });
    act(() => result.current.start("fiscal-gates"));
    expect(result.current.view.kind).toBe("open");
    if (result.current.view.kind === "open") {
      expect(result.current.view.tourId).toBe("fiscal-gates");
      expect(result.current.view.stepIndex).toBe(0);
    }
    // First step is a navigate step → onNavigate should fire.
    expect(onNav).toHaveBeenCalledWith("/app/fiscal-gates");
  });

  it("start is a no-op for an unknown tourId", () => {
    const onNav = vi.fn();
    const { result } = setup({ onNavigate: onNav });
    act(() => result.current.start("nope-not-a-tour"));
    expect(result.current.view.kind).toBe("closed");
    expect(onNav).not.toHaveBeenCalled();
  });

  it("next advances one step", () => {
    const { result } = setup();
    act(() => result.current.start("fiscal-gates"));
    act(() => result.current.next());
    if (result.current.view.kind === "open") {
      expect(result.current.view.stepIndex).toBe(1);
    } else {
      throw new Error("expected open view");
    }
  });

  it("back decrements by one; no-op at step 0", () => {
    const { result } = setup();
    act(() => result.current.start("fiscal-gates"));
    act(() => result.current.back()); // no-op
    if (result.current.view.kind === "open") {
      expect(result.current.view.stepIndex).toBe(0);
    }
    act(() => result.current.next());
    act(() => result.current.back());
    if (result.current.view.kind === "open") {
      expect(result.current.view.stepIndex).toBe(0);
    }
  });

  it("advancing past the last step marks the tour done and closes", () => {
    const { result } = setup();
    act(() => result.current.start("fiscal-gates"));
    const total = DEFAULT_TOURS_BY_ID["fiscal-gates"]!.steps.length;
    for (let i = 0; i < total; i++) {
      act(() => result.current.next());
    }
    expect(result.current.view.kind).toBe("closed");
    expect(result.current.isDone("fiscal-gates")).toBe(true);
    expect(readDone("fiscal-gates")).toBe(true);
    expect(window.localStorage.getItem(doneKey("fiscal-gates"))).toBe(DONE_VALUE);
  });

  it("finish marks the tour done and closes", () => {
    const { result } = setup();
    act(() => result.current.start("ask-ai"));
    act(() => result.current.finish());
    expect(result.current.view.kind).toBe("closed");
    expect(result.current.isDone("ask-ai")).toBe(true);
  });

  it("skip closes the overlay but does NOT mark done", () => {
    const { result } = setup();
    act(() => result.current.start("triage-inbox"));
    act(() => result.current.skip());
    expect(result.current.view.kind).toBe("closed");
    expect(result.current.isDone("triage-inbox")).toBe(false);
  });

  it("reset clears the done flag", () => {
    const { result } = setup();
    act(() => result.current.start("ask-ai"));
    act(() => result.current.finish());
    expect(result.current.isDone("ask-ai")).toBe(true);
    act(() => result.current.reset("ask-ai"));
    expect(result.current.isDone("ask-ai")).toBe(false);
    expect(readDone("ask-ai")).toBe(false);
  });

  it("starting a second tour does not inherit the first's step index", () => {
    const { result } = setup();
    act(() => result.current.start("fiscal-gates"));
    act(() => result.current.next());
    act(() => result.current.skip());
    act(() => result.current.start("ask-ai"));
    if (result.current.view.kind === "open") {
      expect(result.current.view.tourId).toBe("ask-ai");
      expect(result.current.view.stepIndex).toBe(0);
    }
  });
});
