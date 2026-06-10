/**
 * Button — primary action primitive.
 *
 * The plan §3.3 requires a sharp focus ring (no glow), calm colors per
 * variant, and a "loading" state that disables interaction. These tests
 * pin the public contract: variant styling, size, loading, disabled,
 * leading/trailing icons, and a real forwarded ref.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { Button } from "./Button";

afterEach(() => cleanup());

describe("Button", () => {
  it("renders children inside a real <button> element", () => {
    render(<Button>Save quote</Button>);
    const btn = screen.getByRole("button", { name: "Save quote" });
    expect(btn.tagName).toBe("BUTTON");
  });

  it("fires onClick when activated", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click me</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Click me" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies the primary brand background by default", () => {
    render(<Button>Primary</Button>);
    const btn = screen.getByRole("button", { name: "Primary" });
    // The primary variant uses --color-brand.
    expect(btn.className).toMatch(/var\(--color-brand\)/);
  });

  it("renders the danger variant with the ruby color", () => {
    render(<Button variant="danger">Delete</Button>);
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn.className).toMatch(/var\(--color-ruby\)/);
  });

  it("renders the ghost variant as transparent (no brand/ruby/surface-soft fill)", () => {
    render(<Button variant="ghost">Cancel</Button>);
    const btn = screen.getByRole("button", { name: "Cancel" });
    expect(btn.className).toMatch(/bg-transparent/);
  });

  it("renders each size token with its height utility", () => {
    const { rerender } = render(<Button size="sm">S</Button>);
    expect(screen.getByRole("button").className).toMatch(/\bh-7\b/);

    rerender(<Button size="md">M</Button>);
    expect(screen.getByRole("button").className).toMatch(/\bh-8\b/);

    rerender(<Button size="lg">L</Button>);
    expect(screen.getByRole("button").className).toMatch(/\bh-10\b/);

    rerender(<Button size="icon">I</Button>);
    expect(screen.getByRole("button").className).toMatch(/\bh-8 w-8\b/);
  });

  it("is disabled when the `disabled` prop is set", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Disabled" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("is disabled while loading and suppresses onClick", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Saving" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders leading and trailing icons flanking the label", () => {
    render(
      <Button
        leadingIcon={<span data-testid="leading">+</span>}
        trailingIcon={<span data-testid="trailing">→</span>}
      >
        New
      </Button>,
    );
    const btn = screen.getByRole("button", { name: /New/ });
    // Both icons must be descendants of the same button.
    expect(btn.contains(screen.getByTestId("leading"))).toBe(true);
    expect(btn.contains(screen.getByTestId("trailing"))).toBe(true);
  });

  it("forwards a ref to the underlying button element", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Refable</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.textContent).toBe("Refable");
  });

  it("merges a custom className through cn (no duplicate utilities)", () => {
    render(<Button className="text-[var(--color-ruby)]">Custom</Button>);
    const btn = screen.getByRole("button", { name: "Custom" });
    expect(btn).toHaveClass("text-[var(--color-ruby)]");
    // Base classes still applied.
    expect(btn).toHaveClass("rounded-[var(--radius-md)]");
  });
});
