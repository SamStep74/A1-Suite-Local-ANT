/**
 * SavedViews — dropdown save / load / rename / delete round-trip.
 *
 * The test exercises the public surface: open the menu, type a
 * name, submit, click the new row, observe the onLoad callback.
 * Persistence is asserted through the `loadViews` helper after the
 * React tree re-renders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

import { SavedViews } from "./SavedViews";
import { __clearForTests, loadViews, type SavedViewState } from "../../lib/components/savedViewsStore";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
    <>{children ?? id ?? null}</>
  ),
  useLingui: () => ({
    t: (s: string | TemplateStringsArray) => (Array.isArray(s) ? s[0] : s),
    i18n: { _: (s: string) => s, locale: "hy" },
  }),
}));

const TID = "saved-views-test";

const baseState = (over: Partial<SavedViewState> = {}): SavedViewState => ({
  sort: { id: "amount", desc: true },
  filter: "current filter text",
  page: 2,
  pageSize: 50,
  columns: ["name", "amount", "due"],
  ...over,
});

beforeEach(() => {
  __clearForTests(TID);
});

afterEach(() => {
  __clearForTests(TID);
  cleanup();
});

describe("SavedViews — open / close", () => {
  it("trigger button toggles the menu", () => {
    render(<SavedViews tableId={TID} state={baseState()} onLoad={() => {}} />);
    expect(screen.queryByTestId("saved-views-menu")).toBeNull();
    fireEvent.click(screen.getByTestId("saved-views-trigger"));
    expect(screen.getByTestId("saved-views-menu")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("saved-views-trigger"));
    expect(screen.queryByTestId("saved-views-menu")).toBeNull();
  });

  it("Escape closes the menu", () => {
    render(<SavedViews tableId={TID} state={baseState()} onLoad={() => {}} />);
    fireEvent.click(screen.getByTestId("saved-views-trigger"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("saved-views-menu")).toBeNull();
  });

  it("clicking outside closes the menu", () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <SavedViews tableId={TID} state={baseState()} onLoad={() => {}} />
      </div>,
    );
    fireEvent.click(screen.getByTestId("saved-views-trigger"));
    expect(screen.getByTestId("saved-views-menu")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("saved-views-menu")).toBeNull();
  });
});

describe("SavedViews — save round-trip", () => {
  it("saves the current state and appears in the menu", async () => {
    const onLoad = vi.fn();
    const { rerender } = render(
      <SavedViews tableId={TID} state={baseState()} onLoad={onLoad} />,
    );
    fireEvent.click(screen.getByTestId("saved-views-trigger"));
    fireEvent.click(screen.getByTestId("saved-view-show-save"));
    const input = screen.getByTestId("saved-view-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "High-value overdue" } });
    fireEvent.click(screen.getByTestId("saved-view-save"));

    // Menu re-opens with the saved row
    expect(screen.queryByTestId("saved-views-menu")).toBeInTheDocument();
    await waitFor(() => {
      const all = loadViews(TID);
      expect(all).toHaveLength(1);
      expect(all[0]?.name).toBe("High-value overdue");
    });
    // Now click the saved row → onLoad fires
    const row = screen.getByRole("option", { name: "High-value overdue" });
    fireEvent.click(row);
    expect(onLoad).toHaveBeenCalledTimes(1);
    const passed = onLoad.mock.calls[0]?.[0] as SavedViewState;
    expect(passed.page).toBe(2);
    expect(passed.pageSize).toBe(50);
    expect(passed.columns).toEqual(["name", "amount", "due"]);
    expect(passed.sort).toEqual({ id: "amount", desc: true });

    // Empty-name cancels
    rerender(<SavedViews tableId={TID} state={baseState()} onLoad={onLoad} />);
  });

  it("empty name does not create a record", () => {
    render(<SavedViews tableId={TID} state={baseState()} onLoad={() => {}} />);
    fireEvent.click(screen.getByTestId("saved-views-trigger"));
    fireEvent.click(screen.getByTestId("saved-view-show-save"));
    const input = screen.getByTestId("saved-view-name-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("saved-view-save"));
    expect(loadViews(TID)).toHaveLength(0);
  });

  it("3+ saves all appear in order", () => {
    render(<SavedViews tableId={TID} state={baseState()} onLoad={() => {}} />);
    // Open the menu once. The "Save current view" button stays at the
    // bottom of the menu after each save (so the user can see the new
    // row land and keep saving), so we don't re-click the trigger
    // between iterations — that would toggle the menu closed.
    fireEvent.click(screen.getByTestId("saved-views-trigger"));
    for (const name of ["A", "B", "C"]) {
      fireEvent.click(screen.getByTestId("saved-view-show-save"));
      fireEvent.change(screen.getByTestId("saved-view-name-input"), { target: { value: name } });
      fireEvent.click(screen.getByTestId("saved-view-save"));
      // The save form collapses after save; click "Save current view"
      // again to open it for the next iteration.
    }
    expect(loadViews(TID).map((v) => v.name)).toEqual(["A", "B", "C"]);
  });
});

describe("SavedViews — rename + delete", () => {
  it("rename updates the record", async () => {
    render(<SavedViews tableId={TID} state={baseState()} onLoad={() => {}} />);
    fireEvent.click(screen.getByTestId("saved-views-trigger"));
    fireEvent.click(screen.getByTestId("saved-view-show-save"));
    fireEvent.change(screen.getByTestId("saved-view-name-input"), { target: { value: "Original" } });
    fireEvent.click(screen.getByTestId("saved-view-save"));

    const v = loadViews(TID)[0]!;
    fireEvent.click(screen.getByTestId(`saved-view-rename-${v.id}`));
    const draft = screen.getByLabelText("Rename view") as HTMLInputElement;
    fireEvent.change(draft, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByTestId("saved-view-rename-confirm"));

    await waitFor(() => {
      expect(loadViews(TID)[0]?.name).toBe("Renamed");
    });
  });

  it("delete removes the record", () => {
    render(<SavedViews tableId={TID} state={baseState()} onLoad={() => {}} />);
    fireEvent.click(screen.getByTestId("saved-views-trigger"));
    fireEvent.click(screen.getByTestId("saved-view-show-save"));
    fireEvent.change(screen.getByTestId("saved-view-name-input"), { target: { value: "A" } });
    fireEvent.click(screen.getByTestId("saved-view-save"));
    const v = loadViews(TID)[0]!;
    fireEvent.click(screen.getByTestId(`saved-view-delete-${v.id}`));
    expect(loadViews(TID)).toHaveLength(0);
  });
});

describe("SavedViews — empty menu", () => {
  it("shows the empty-state hint when no views exist", () => {
    render(<SavedViews tableId={TID} state={baseState()} onLoad={() => {}} />);
    fireEvent.click(screen.getByTestId("saved-views-trigger"));
    expect(screen.getByText("No saved views yet")).toBeInTheDocument();
  });
});
