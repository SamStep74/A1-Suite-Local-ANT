/**
 * Kbd — keyboard-shortcut hint chip. Renders a <kbd> element with the given
 * children. Used in the Topbar (⌘K) and the command palette.
 *
 * These tests pin the semantic element (so screen readers treat it as
 * keyboard input) and the styling hook (font-mono + canvas background).
 */
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Kbd } from "./Kbd";

afterEach(() => cleanup());

describe("Kbd", () => {
  it("renders a <kbd> element with the given children", () => {
    render(<Kbd>⌘K</Kbd>);
    expect(screen.getByText("⌘K")).toBeInTheDocument();
    // The text node should live inside a real <kbd> element.
    const kbd = screen.getByText("⌘K");
    expect(kbd.tagName).toBe("KBD");
  });

  it("renders arbitrary children (not just text)", () => {
    render(
      <Kbd>
        <span data-testid="inner-shortcut">Ctrl</span>+
        <span data-testid="inner-shortcut-2">K</span>
      </Kbd>,
    );
    expect(screen.getByTestId("inner-shortcut")).toBeInTheDocument();
    expect(screen.getByTestId("inner-shortcut-2")).toBeInTheDocument();
  });

  it("applies the font-mono class so glyphs render in a monospace face", () => {
    render(<Kbd>Esc</Kbd>);
    expect(screen.getByText("Esc")).toHaveClass("font-mono");
  });

  it("merges custom className without losing the base styling", () => {
    render(<Kbd className="text-[var(--color-ruby)]">!</Kbd>);
    const kbd = screen.getByText("!");
    // Custom class wins through cn → twMerge.
    expect(kbd).toHaveClass("text-[var(--color-ruby)]");
    // Base classes still present.
    expect(kbd).toHaveClass("rounded");
  });
});
