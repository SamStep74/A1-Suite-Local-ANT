/**
 * LeftRail — vertical icon column with all the app icons, sitting between
 * the Topbar and the main content. Zoho / Odoo pattern.
 *
 * Renders all 14 APP_IDS as Link components and exposes the active app
 * via aria-current="page". The "All apps" trigger fires onOpenAppLauncher
 * and the chevron toggle persists the collapsed state in localStorage.
 */
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { APP_IDS, APPS } from "../../lib/apps";

let mockPathname = "/app";
const useLocation = vi.fn(() => ({ pathname: mockPathname }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    "aria-current": ariaCurrent,
    title,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    "aria-current"?: "page" | "step" | "location" | "date" | "time" | true | false;
    title?: string;
  }) => (
    <a
      href={params?.appId ? `${to.replace("$appId", params.appId)}` : to}
      aria-current={ariaCurrent}
      title={title}
    >
      {children}
    </a>
  ),
  useLocation: () => useLocation(),
}));

import { LeftRail } from "./LeftRail";

beforeEach(() => {
  mockPathname = "/app";
  // Clear any localStorage state from a previous test run.
  try {
    localStorage.removeItem("ant.lefRail.collapsed");
  } catch {
    // ignore
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LeftRail", () => {
  it("renders an <aside> with the app navigation landmark label", () => {
    render(<LeftRail onOpenAppLauncher={() => {}} />);
    expect(
      screen.getByRole("complementary", { name: "App navigation" }),
    ).toBeInTheDocument();
  });

  it("renders a Link for every registered app id (13 apps)", () => {
    render(<LeftRail onOpenAppLauncher={() => {}} />);
    // We test against the real APPS catalog, not a mock, so a regression
    // that drops an app from lib/apps.ts is caught here too.
    // TanStack Router normalizes path segments: routes with file-based
    // paths under routes/app/<id>/index.tsx render with a trailing
    // slash, routes with a single segment (e.g. /app/copilot) render
    // without. Accept either form — the catalog's APP_IDS is the
    // authoritative source.
    for (const id of APP_IDS) {
      const link = screen.getByRole("link", { name: APPS[id].label });
      const href = link.getAttribute("href") || "";
      expect([`/app/${id}`, `/app/${id}/`]).toContain(href);
    }
  });

  it("marks the active app with aria-current='page' based on the URL", () => {
    mockPathname = "/app/finance";
    render(<LeftRail onOpenAppLauncher={() => {}} />);
    const active = screen.getByRole("link", { name: "Finance" });
    expect(active).toHaveAttribute("aria-current", "page");
    // Inactive links must not carry aria-current.
    const inactive = screen.getByRole("link", { name: "CRM" });
    expect(inactive).not.toHaveAttribute("aria-current");
  });

  it("renders no active link on /app (no app segment)", () => {
    mockPathname = "/app";
    render(<LeftRail onOpenAppLauncher={() => {}} />);
    const rail = screen.getByRole("complementary");
    const links = within(rail).getAllByRole("link");
    for (const l of links) {
      expect(l).not.toHaveAttribute("aria-current");
    }
  });

  it("ignores unknown path segments (defensive against /app/foo)", () => {
    mockPathname = "/app/does-not-exist";
    render(<LeftRail onOpenAppLauncher={() => {}} />);
    const rail = screen.getByRole("complementary");
    const links = within(rail).getAllByRole("link");
    for (const l of links) {
      expect(l).not.toHaveAttribute("aria-current");
    }
  });

  it("exposes the 'All apps' launcher trigger", () => {
    const onOpen = vi.fn();
    render(<LeftRail onOpenAppLauncher={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Open app launcher" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("toggles collapsed state and persists it in localStorage", () => {
    render(<LeftRail onOpenAppLauncher={() => {}} />);
    // Initial: expanded (label says "Collapse").
    const toggle = screen.getByRole("button", { name: "Collapse navigation" });
    fireEvent.click(toggle);
    // After click: collapsed.
    expect(localStorage.getItem("ant.lefRail.collapsed")).toBe("1");
    expect(
      screen.getByRole("button", { name: "Expand navigation" }),
    ).toBeInTheDocument();
    // Toggle back.
    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    expect(localStorage.getItem("ant.lefRail.collapsed")).toBe("0");
  });

  it("hydrates the collapsed state from localStorage on mount", () => {
    localStorage.setItem("ant.lefRail.collapsed", "1");
    render(<LeftRail onOpenAppLauncher={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Expand navigation" }),
    ).toBeInTheDocument();
  });
});
