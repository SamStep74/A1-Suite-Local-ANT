/**
 * Skeleton — co-located test.
 *
 * Pins the public contract:
 *   1. Default 3 skeleton bars when no `rows` prop is passed.
 *   2. Renders the custom row count when `rows={5}` is passed.
 *   3. Default label is Armenian "Բեռնվում է…".
 *   4. Renders the custom label when `label="foo"` is passed.
 *   5. The root wrapper is centered (mx-auto class is present).
 */
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Skeleton } from "./Skeleton";

afterEach(() => cleanup());

describe("Skeleton", () => {
  it("renders default 3 rows when no `rows` prop is passed", () => {
    const { container } = render(<Skeleton />);
    // The skeleton bars are the only animated divs (animate-pulse).
    const bars = container.querySelectorAll(".animate-pulse");
    expect(bars.length).toBe(3);
  });

  it("renders the custom row count when `rows={5}` is passed", () => {
    const { container } = render(<Skeleton rows={5} />);
    const bars = container.querySelectorAll(".animate-pulse");
    expect(bars.length).toBe(5);
  });

  it("renders the Armenian label by default", () => {
    render(<Skeleton />);
    expect(
      screen.getByText("Բեռնվում է…", { selector: "span" }),
    ).toBeInTheDocument();
  });

  it("renders the custom label when `label` is passed", () => {
    render(<Skeleton label="foo" />);
    expect(screen.getByText("foo")).toBeInTheDocument();
  });

  it("renders a centered wrapper (mx-auto on the root)", () => {
    const { container } = render(<Skeleton />);
    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    expect(root!.className).toMatch(/\bmx-auto\b/);
  });
});
