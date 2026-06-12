/**
 * BulkActionBar — visibility / dispatch / clear.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

import { BulkActionBar } from "./BulkActionBar";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
    <>{children ?? id ?? null}</>
  ),
  useLingui: () => ({
    t: (s: string | TemplateStringsArray) => (Array.isArray(s) ? s[0] : s),
    i18n: { _: (s: string) => s, locale: "hy" },
  }),
}));

afterEach(() => {
  cleanup();
});

describe("BulkActionBar — visibility", () => {
  it("does not render when selectedRowIds is empty", () => {
    render(<BulkActionBar selectedRowIds={[]} onAction={() => {}} />);
    expect(screen.queryByTestId("bulk-action-bar")).toBeNull();
  });

  it("renders when at least 1 row is selected", () => {
    render(<BulkActionBar selectedRowIds={["a"]} onAction={() => {}} />);
    expect(screen.getByTestId("bulk-action-bar")).toBeInTheDocument();
    expect(screen.getByTestId("bulk-action-bar").getAttribute("data-count")).toBe("1");
  });

  it("renders the count summary", () => {
    render(<BulkActionBar selectedRowIds={["a", "b", "c"]} onAction={() => {}} />);
    expect(screen.getByTestId("bulk-action-bar-count").textContent).toMatch(/3 selected/);
  });
});

describe("BulkActionBar — actions", () => {
  it("clicking Delete calls onAction with 'delete' and the ids", () => {
    const onAction = vi.fn();
    render(
      <BulkActionBar
        selectedRowIds={["a", "b"]}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByTestId("bulk-action-delete"));
    expect(onAction).toHaveBeenCalledWith("delete", ["a", "b"]);
  });

  it("clicking Export calls onAction with 'export'", () => {
    const onAction = vi.fn();
    render(<BulkActionBar selectedRowIds={["a"]} onAction={onAction} />);
    fireEvent.click(screen.getByTestId("bulk-action-export"));
    expect(onAction).toHaveBeenCalledWith("export", ["a"]);
  });

  it("clicking Tag calls onAction with 'tag'", () => {
    const onAction = vi.fn();
    render(<BulkActionBar selectedRowIds={["a"]} onAction={onAction} />);
    fireEvent.click(screen.getByTestId("bulk-action-tag"));
    expect(onAction).toHaveBeenCalledWith("tag", ["a"]);
  });

  it("the ids array passed to onAction is a fresh copy (caller can mutate)", () => {
    const onAction = vi.fn();
    const ids = ["a", "b"];
    render(<BulkActionBar selectedRowIds={ids} onAction={onAction} />);
    fireEvent.click(screen.getByTestId("bulk-action-delete"));
    const passed = onAction.mock.calls[0]?.[1] as string[];
    expect(passed).toEqual(["a", "b"]);
    expect(passed).not.toBe(ids);
  });
});

describe("BulkActionBar — actions whitelist", () => {
  it("only renders whitelisted actions", () => {
    render(
      <BulkActionBar
        selectedRowIds={["a"]}
        onAction={() => {}}
        actions={["delete"]}
      />,
    );
    expect(screen.getByTestId("bulk-action-delete")).toBeInTheDocument();
    expect(screen.queryByTestId("bulk-action-export")).toBeNull();
    expect(screen.queryByTestId("bulk-action-tag")).toBeNull();
  });

  it("empty actions array renders no buttons (count only)", () => {
    render(
      <BulkActionBar
        selectedRowIds={["a"]}
        onAction={() => {}}
        actions={[]}
      />,
    );
    expect(screen.getByTestId("bulk-action-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("bulk-action-delete")).toBeNull();
  });
});

describe("BulkActionBar — onClear", () => {
  it("renders the clear button when onClear is provided", () => {
    const onClear = vi.fn();
    render(
      <BulkActionBar
        selectedRowIds={["a"]}
        onAction={() => {}}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByTestId("bulk-action-clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("does not render the clear button when onClear is omitted", () => {
    render(<BulkActionBar selectedRowIds={["a"]} onAction={() => {}} />);
    expect(screen.queryByTestId("bulk-action-clear")).toBeNull();
  });
});
