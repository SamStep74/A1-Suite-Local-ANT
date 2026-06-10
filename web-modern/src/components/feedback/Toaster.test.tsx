/**
 * Toaster — Sonner, themed to the design tokens (success=teal, error=ruby,
 * info=blue, warning=amber). Per plan §3.3: no glow, no gradient.
 *
 * Sonner is mocked at the module boundary so we don't pull its full DOM
 * implementation into jsdom — we just verify that our wrapper passes the
 * expected props (position, toastOptions.classNames, closeButton, richColors).
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// Mock the sonner Toaster BEFORE importing the component under test.
const sonnerSpy = vi.fn((props: Record<string, unknown>) => (
  <div data-testid="sonner-toaster" data-props={JSON.stringify(props)} />
));
vi.mock("sonner", () => ({
  Toaster: (props: Record<string, unknown>) => sonnerSpy(props),
}));

import { Toaster } from "./Toaster";

afterEach(() => {
  cleanup();
  sonnerSpy.mockClear();
});

describe("Toaster", () => {
  it("renders a single Sonner Toaster", () => {
    render(<Toaster />);
    expect(sonnerSpy).toHaveBeenCalledTimes(1);
  });

  it("anchors toasts to the bottom-right corner", () => {
    render(<Toaster />);
    const props = sonnerSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(props.position).toBe("bottom-right");
  });

  it("disables rich colors (we apply our own color-blind-safe palette)", () => {
    render(<Toaster />);
    const props = sonnerSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(props.richColors).toBe(false);
  });

  it("shows a close button on every toast", () => {
    render(<Toaster />);
    const props = sonnerSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(props.closeButton).toBe(true);
  });

  it("themes toasts with the surface/ink tokens so they match the design system", () => {
    render(<Toaster />);
    const props = sonnerSpy.mock.calls[0][0] as Record<string, unknown>;
    const options = props.toastOptions as {
      classNames: Record<string, string>;
    };
    expect(options.classNames.toast).toMatch(/var\(--color-surface\)/);
    expect(options.classNames.toast).toMatch(/var\(--color-ink\)/);
  });

  it("uses color-blind-safe accents: success=teal, error=ruby, info=blue, warning=amber", () => {
    render(<Toaster />);
    const props = sonnerSpy.mock.calls[0][0] as Record<string, unknown>;
    const cn = (props.toastOptions as { classNames: Record<string, string> })
      .classNames;
    expect(cn.success).toMatch(/var\(--color-teal\)/);
    expect(cn.error).toMatch(/var\(--color-ruby\)/);
    expect(cn.info).toMatch(/var\(--color-blue\)/);
    expect(cn.warning).toMatch(/var\(--color-amber\)/);
  });
});
