/**
 * ErrorBoundary — co-located test.
 *
 * Pins the public contract:
 *   1. Renders the Armenian H1 by default.
 *   2. Shows the error message from the `error` prop.
 *   3. Hides the error block when no `error` prop is passed.
 *   4. Calls `reset` when "Try again" is clicked.
 *   5. Renders a <Link> to `/` for the home button.
 *   6. Does NOT leak the error stack (the rendered HTML must not
 *      contain `error.stack` content).
 *
 * We mock `@tanstack/react-router`'s `Link` to a plain anchor — this
 * avoids the full router setup while still letting us assert the
 * `href` TanStack would have wired up at runtime.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => cleanup());

describe("ErrorBoundary", () => {
  it("renders the Armenian H1 by default", () => {
    render(<ErrorBoundary />);
    expect(
      screen.getByRole("heading", { level: 1, name: /Սխալ է տեղի ունեցել/ }),
    ).toBeInTheDocument();
  });

  it("shows the error message from the `error` prop", () => {
    render(<ErrorBoundary error={new Error("boom: network down")} />);
    expect(screen.getByTestId("error-message")).toHaveTextContent(
      "boom: network down",
    );
  });

  it("hides the error block when no `error` prop is passed", () => {
    render(<ErrorBoundary />);
    expect(screen.queryByTestId("error-message")).toBeNull();
  });

  it("calls `reset` when the 'Try again' button is clicked", () => {
    const reset = vi.fn();
    render(<ErrorBoundary error={new Error("x")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: /Փորձել կրկին/ }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("renders a <Link> to `/` for the home button", () => {
    render(<ErrorBoundary />);
    // The home button is rendered as an anchor by the mocked Link.
    const home = screen.getByRole("link", { name: /Գնալ գլխավոր/ });
    expect(home).toBeInTheDocument();
    expect(home.getAttribute("href")).toBe("/");
  });

  it("does NOT leak the error stack in the rendered output", () => {
    const err = new Error("public message");
    // Force a non-empty stack — every Error has one in jsdom.
    expect(err.stack).toBeTruthy();
    const { container } = render(<ErrorBoundary error={err} />);
    const html = container.innerHTML;
    expect(html).toContain("public message");
    // The first stack frame is the most identifying; assert it does
    // not appear in the rendered output.
    const firstFrame = err.stack!.split("\n")[0] ?? "__sentinel__";
    expect(html).not.toContain(firstFrame);
  });
});
