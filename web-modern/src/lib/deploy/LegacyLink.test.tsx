/**
 * LegacyLink — Phase 10.1 escape hatch component.
 *
 * What this test pins:
 *   - The link's `href` is `/legacy${to}` (the Fastify mount prefix in
 *     `server/app.js:registerStatic`).
 *   - The link opens in a new tab with the safe `noopener noreferrer` rel
 *     (a regression that dropped the rel would expose the SPA to tab-tab
 *     access via `window.opener`).
 *   - The `↗` glyph is always present so operators get the visual hint
 *     that this is an external link (it leaves the SPA).
 *   - Custom `className` overrides the default muted style; omitting it
 *     falls back to a sensible default (used by the Topbar).
 *
 * Auth: not required — this is a pure render test, no router or fetch
 * is involved.
 */
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { LegacyLink } from "./LegacyLink";

afterEach(() => {
  cleanup();
});

describe("LegacyLink", () => {
  it("renders the children", () => {
    render(<LegacyLink to="/">Open legacy UI</LegacyLink>);
    // The link renders `{children} ↗` so the text content is split
    // across two text nodes ("Open legacy UI" + " ↗"). A regex
    // substring match handles that — `getByText("Open legacy UI")`
    // with a string would fail to match the combined text.
    expect(screen.getByText(/Open legacy UI/)).toBeInTheDocument();
  });

  it("renders href='/legacy/foo' when to='/foo'", () => {
    render(<LegacyLink to="/foo">Inventory</LegacyLink>);
    const link = screen.getByRole("link", { name: /Inventory/ });
    expect(link).toHaveAttribute("href", "/legacy/foo");
  });

  it("renders href='/legacy' when to=''", () => {
    render(<LegacyLink to="">Open legacy UI</LegacyLink>);
    const link = screen.getByRole("link", { name: /Open legacy UI/ });
    expect(link).toHaveAttribute("href", "/legacy");
  });

  it("opens in a new tab with safe rel attributes", () => {
    render(<LegacyLink to="/">Open legacy UI</LegacyLink>);
    const link = screen.getByRole("link", { name: /Open legacy UI/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders the ↗ glyph as the external-link hint", () => {
    render(<LegacyLink to="/">Open legacy UI</LegacyLink>);
    // The glyph is appended to children, so it's part of the link's
    // accessible name. Match it as a substring so we don't depend on
    // the exact whitespace.
    expect(screen.getByText(/↗/)).toBeInTheDocument();
  });

  it("applies the custom className when provided", () => {
    render(
      <LegacyLink to="/" className="text-red-500 font-bold">
        Open legacy UI
      </LegacyLink>,
    );
    const link = screen.getByRole("link", { name: /Open legacy UI/ });
    expect(link.className).toContain("text-red-500");
    expect(link.className).toContain("font-bold");
    // The custom className REPLACES the default (it doesn't get appended),
    // so the muted default should be absent.
    expect(link.className).not.toContain("text-stone-500");
  });

  it("falls back to default Tailwind classes when className is omitted", () => {
    render(<LegacyLink to="/">Open legacy UI</LegacyLink>);
    const link = screen.getByRole("link", { name: /Open legacy UI/ });
    // The defaults are the muted, small, underlined style used by the
    // Topbar's escape-hatch chip. If a future redesign changes the
    // defaults, this test should be updated in lockstep.
    expect(link.className).toContain("text-stone-500");
    expect(link.className).toContain("underline");
    expect(link.className).toContain("text-xs");
  });
});
