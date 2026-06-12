/**
 * UndoToast — auto-dismiss timer + click-Undo + click-X.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

import { UndoToast, type UndoToastOptions } from "./UndoToast";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
    <>{children ?? id ?? null}</>
  ),
  useLingui: () => ({
    t: (s: string | TemplateStringsArray) => (Array.isArray(s) ? s[0] : s),
    i18n: { _: (s: string) => s, locale: "hy" },
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("UndoToast — visibility", () => {
  it("does not render when options is null", () => {
    render(<UndoToast options={null} onDismiss={() => {}} />);
    expect(screen.queryByTestId("undo-toast")).toBeNull();
  });

  it("renders message + action + dismiss when options is set", () => {
    const opts: UndoToastOptions = {
      message: <span>Invoice archived</span>,
      onUndo: () => {},
    };
    render(<UndoToast options={opts} onDismiss={() => {}} />);
    expect(screen.getByTestId("undo-toast")).toBeInTheDocument();
    expect(screen.getByText("Invoice archived")).toBeInTheDocument();
    expect(screen.getByTestId("undo-toast-action")).toBeInTheDocument();
    expect(screen.getByTestId("undo-toast-dismiss")).toBeInTheDocument();
  });
});

describe("UndoToast — Undo button", () => {
  it("clicking Undo fires onUndo + onDismiss exactly once", () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(
      <UndoToast
        options={{ message: "x", onUndo }}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByTestId("undo-toast-action"));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("double-click is idempotent (firedRef guard)", () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(
      <UndoToast
        options={{ message: "x", onUndo }}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByTestId("undo-toast-action"));
    fireEvent.click(screen.getByTestId("undo-toast-action"));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("UndoToast — dismiss X", () => {
  it("clicking the dismiss X fires onDismiss and skips onUndo", () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(
      <UndoToast
        options={{ message: "x", onUndo }}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByTestId("undo-toast-dismiss"));
    expect(onUndo).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("UndoToast — auto-dismiss", () => {
  it("auto-dismisses after the default 5s window", () => {
    const onDismiss = vi.fn();
    render(
      <UndoToast
        options={{ message: "x", onUndo: () => {} }}
        onDismiss={onDismiss}
      />,
    );
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("honors a custom durationMs", () => {
    const onDismiss = vi.fn();
    render(
      <UndoToast
        options={{ message: "x", onUndo: () => {}, durationMs: 1000 }}
        onDismiss={onDismiss}
      />,
    );
    vi.advanceTimersByTime(999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("progress attribute shrinks over time", () => {
    render(
      <UndoToast
        options={{ message: "x", onUndo: () => {}, durationMs: 1000 }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByTestId("undo-toast").getAttribute("data-remaining-pct")).toBe("100");
    // Wrap the timer advance in act() so the React state update from
    // the setInterval tick is flushed to the DOM before we read it.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // After 500ms of a 1000ms window, ~50% remaining
    const pct = Number(screen.getByTestId("undo-toast").getAttribute("data-remaining-pct"));
    expect(pct).toBeGreaterThan(40);
    expect(pct).toBeLessThan(60);
  });
});

describe("UndoToast — switching options resets the timer", () => {
  it("switching to a new options re-arms the dismiss timer", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <UndoToast
        options={{ message: "first", onUndo: () => {} }}
        onDismiss={onDismiss}
      />,
    );
    vi.advanceTimersByTime(4000);
    expect(onDismiss).not.toHaveBeenCalled();
    rerender(
      <UndoToast
        options={{ message: "second", onUndo: () => {} }}
        onDismiss={onDismiss}
      />,
    );
    // Reset: 4500ms past total, but only 500 past the new mount
    vi.advanceTimersByTime(4500);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
