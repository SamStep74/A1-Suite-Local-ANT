/**
 * PeekPanel — open / render / close behaviors.
 *
 * The native `<dialog>` element only works in real browsers, so
 * jsdom mocks the minimal surface we need: showModal() flips
 * `open`, close() un-flips it, and click target comparison fires
 * the backdrop-close path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

import { PeekPanel } from "./PeekPanel";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
    <>{children ?? id ?? null}</>
  ),
  useLingui: () => ({
    t: (s: string | TemplateStringsArray) => (Array.isArray(s) ? s[0] : s),
    i18n: { _: (s: string) => s, locale: "hy" },
  }),
}));

interface Row {
  id: string;
  name: string;
}

beforeEach(() => {
  // jsdom doesn't implement <dialog>.showModal() / .close(). Patch
  // a minimal no-op so the component can mount.
  if (!("showModal" in HTMLDialogElement.prototype)) {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: function () {
        (this as HTMLDialogElement & { open: boolean }).open = true;
      },
    });
  }
  if (!("close" in HTMLDialogElement.prototype)) {
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: function () {
        (this as HTMLDialogElement & { open: boolean }).open = false;
        this.dispatchEvent(new Event("close"));
      },
    });
  }
});

afterEach(() => {
  cleanup();
});

describe("PeekPanel — open / close", () => {
  it("does not render content when record is null", () => {
    render(
      <PeekPanel<Row>
        record={null}
        onClose={() => {}}
        renderContent={(r) => <span>{r.name}</span>}
      />,
    );
    expect(screen.queryByTestId("peek-panel")).toBeInTheDocument();
    expect(screen.getByTestId("peek-panel").getAttribute("data-open")).toBe("false");
  });

  it("opens and renders the content when record is provided", () => {
    const row: Row = { id: "1", name: "Acme" };
    render(
      <PeekPanel<Row>
        record={row}
        onClose={() => {}}
        renderContent={(r) => <span data-testid="peek-body">{r.name}</span>}
      />,
    );
    expect(screen.getByTestId("peek-panel").getAttribute("data-open")).toBe("true");
    expect(screen.getByTestId("peek-body").textContent).toBe("Acme");
  });

  it("close button fires onClose", () => {
    const onClose = vi.fn();
    const row: Row = { id: "1", name: "Acme" };
    render(
      <PeekPanel<Row>
        record={row}
        onClose={onClose}
        renderContent={(r) => <span>{r.name}</span>}
      />,
    );
    fireEvent.click(screen.getByTestId("peek-panel-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ESC dispatches the native 'close' event, which triggers onClose", () => {
    const onClose = vi.fn();
    const row: Row = { id: "1", name: "Acme" };
    render(
      <PeekPanel<Row>
        record={row}
        onClose={onClose}
        renderContent={(r) => <span>{r.name}</span>}
      />,
    );
    const dialog = screen.getByTestId("peek-panel");
    // Simulate the native ESC → close() path: set open=false, fire
    // the close event the browser would normally dispatch.
    Object.defineProperty(dialog, "open", { configurable: true, value: false });
    dialog.dispatchEvent(new Event("close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the dialog backdrop (target=dialog) closes the panel", () => {
    const onClose = vi.fn();
    const row: Row = { id: "1", name: "Acme" };
    render(
      <PeekPanel<Row>
        record={row}
        onClose={onClose}
        renderContent={(r) => <span>{r.name}</span>}
      />,
    );
    const dialog = screen.getByTestId("peek-panel");
    // A click on the dialog itself (backdrop) → target is the dialog
    fireEvent.click(dialog, { target: dialog });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking inside the content does NOT close the panel", () => {
    const onClose = vi.fn();
    const row: Row = { id: "1", name: "Acme" };
    render(
      <PeekPanel<Row>
        record={row}
        onClose={onClose}
        renderContent={(r) => <span data-testid="inner">{r.name}</span>}
      />,
    );
    fireEvent.click(screen.getByTestId("inner"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("PeekPanel — header", () => {
  it("renders the supplied title", () => {
    const row: Row = { id: "1", name: "Acme" };
    render(
      <PeekPanel<Row>
        record={row}
        onClose={() => {}}
        title={<span>Invoice 42</span>}
        renderContent={(r) => <span>{r.name}</span>}
      />,
    );
    expect(screen.getByText("Invoice 42")).toBeInTheDocument();
  });

  it("falls back to a localized 'Details' when no title is supplied", () => {
    const row: Row = { id: "1", name: "Acme" };
    render(
      <PeekPanel<Row>
        record={row}
        onClose={() => {}}
        renderContent={(r) => <span>{r.name}</span>}
      />,
    );
    expect(screen.getByText("Details")).toBeInTheDocument();
  });
});
