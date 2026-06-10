/**
 * Topbar — persistent navigation header.
 *
 * The Topbar wires three side-effecting systems:
 *   1. TanStack Router <Link> (mocked — we don't need a real router here)
 *   2. useTheme (mocked — see the mock below)
 *   3. useDensity (mocked — see the mock below)
 *
 * These tests pin the public contract of the Topbar itself:
 *   - App launcher / command palette / notifications / help / account
 *     buttons fire the right callbacks.
 *   - The current-app label is shown when currentApp is provided.
 *   - The density and theme cycles fire the mocked setters.
 *   - The "ANT" brand link and the ⌘K shortcut are visible.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Mocks MUST be set up before the component module is imported.
const useTheme = vi.fn(() => ({
  theme: "light" as const,
  setTheme: vi.fn(),
}));
const useDensity = vi.fn(() => ({
  density: "comfortable" as const,
  setDensity: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("../../lib/theme/ThemeProvider", () => ({
  useTheme: () => useTheme(),
}));

vi.mock("../../lib/density/DensityProvider", () => ({
  useDensity: () => useDensity(),
  DENSITIES: ["comfortable", "compact", "spacious"],
}));

import { Topbar } from "./Topbar";

afterEach(() => {
  cleanup();
  useTheme.mockClear();
  useDensity.mockClear();
});

const noop = () => {};

describe("Topbar", () => {
  it("renders a <header> landmark", () => {
    render(
      <Topbar
        onOpenAppLauncher={noop}
        onOpenCommandPalette={noop}
        onOpenNotifications={noop}
        onOpenHelp={noop}
      />,
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("shows the ANT brand link to /app", () => {
    render(
      <Topbar
        onOpenAppLauncher={noop}
        onOpenCommandPalette={noop}
        onOpenNotifications={noop}
        onOpenHelp={noop}
      />,
    );
    const brand = screen.getByRole("link", { name: /ANT/ });
    expect(brand).toHaveAttribute("href", "/app");
  });

  it("shows the ⌘K shortcut chip in the command palette trigger", () => {
    render(
      <Topbar
        onOpenAppLauncher={noop}
        onOpenCommandPalette={noop}
        onOpenNotifications={noop}
        onOpenHelp={noop}
      />,
    );
    expect(screen.getByText("⌘K")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Ask / Command palette" }),
    ).toBeInTheDocument();
  });

  it("does NOT show the current-app segment when currentApp is omitted", () => {
    render(
      <Topbar
        onOpenAppLauncher={noop}
        onOpenCommandPalette={noop}
        onOpenNotifications={noop}
        onOpenHelp={noop}
      />,
    );
    expect(screen.queryByText("CRM")).not.toBeInTheDocument();
  });

  it("shows the current-app label and a separator when currentApp is provided", () => {
    render(
      <Topbar
        currentApp="crm"
        onOpenAppLauncher={noop}
        onOpenCommandPalette={noop}
        onOpenNotifications={noop}
        onOpenHelp={noop}
      />,
    );
    expect(screen.getByText("CRM")).toBeInTheDocument();
    expect(screen.getByText("/")).toBeInTheDocument();
  });

  it("fires onOpenAppLauncher when the apps grid button is clicked", () => {
    const onOpenAppLauncher = vi.fn();
    render(
      <Topbar
        onOpenAppLauncher={onOpenAppLauncher}
        onOpenCommandPalette={noop}
        onOpenNotifications={noop}
        onOpenHelp={noop}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open app launcher" }),
    );
    expect(onOpenAppLauncher).toHaveBeenCalledTimes(1);
  });

  it("fires onOpenCommandPalette when the Ask/Command trigger is clicked", () => {
    const onOpenCommandPalette = vi.fn();
    render(
      <Topbar
        onOpenAppLauncher={noop}
        onOpenCommandPalette={onOpenCommandPalette}
        onOpenNotifications={noop}
        onOpenHelp={noop}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open Ask / Command palette" }),
    );
    expect(onOpenCommandPalette).toHaveBeenCalledTimes(1);
  });

  it("fires onOpenNotifications / onOpenHelp when their buttons are clicked", () => {
    const onOpenNotifications = vi.fn();
    const onOpenHelp = vi.fn();
    render(
      <Topbar
        onOpenAppLauncher={noop}
        onOpenCommandPalette={noop}
        onOpenNotifications={onOpenNotifications}
        onOpenHelp={onOpenHelp}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(onOpenNotifications).toHaveBeenCalledTimes(1);
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
  });

  it("cycles density (comfortable → compact) on click", () => {
    const setDensity = vi.fn();
    useDensity.mockReturnValue({ density: "comfortable", setDensity });
    render(
      <Topbar
        onOpenAppLauncher={noop}
        onOpenCommandPalette={noop}
        onOpenNotifications={noop}
        onOpenHelp={noop}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Density: Comfortable/ }),
    );
    expect(setDensity).toHaveBeenCalledWith("compact");
  });

  it("cycles theme (light → dark) on click", () => {
    const setTheme = vi.fn();
    useTheme.mockReturnValue({ theme: "light", setTheme });
    render(
      <Topbar
        onOpenAppLauncher={noop}
        onOpenCommandPalette={noop}
        onOpenNotifications={noop}
        onOpenHelp={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Theme: light/ }));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("shows the userName initial as the avatar letter, falling back to '?'", () => {
    const { rerender } = render(
      <Topbar
        userName="Nare"
        onOpenAppLauncher={noop}
        onOpenCommandPalette={noop}
        onOpenNotifications={noop}
        onOpenHelp={noop}
      />,
    );
    // The avatar is a 24px span with the first letter uppercased.
    const accountBtn = screen.getByRole("button", { name: "Account menu" });
    expect(accountBtn.textContent).toMatch(/^N/);
    expect(accountBtn).toHaveTextContent("Nare");

    rerender(
      <Topbar
        onOpenAppLauncher={noop}
        onOpenCommandPalette={noop}
        onOpenNotifications={noop}
        onOpenHelp={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "Account menu" })).toHaveTextContent(
      "?",
    );
  });
});
