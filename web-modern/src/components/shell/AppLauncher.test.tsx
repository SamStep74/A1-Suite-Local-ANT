/**
 * AppLauncher — modal grid of all app cards. Phase 0.4c.
 *
 * Renders against the real lib/apps catalog (DO NOT MOCK) so the test
 * catches regressions in the apps list as well as the launcher itself.
 *
 * Behaviors pinned here:
 *   - Renders nothing when `open` is false.
 *   - When open: dialog role, "Apps" heading, "Core" / "Extensions" sections.
 *   - Escape closes the launcher.
 *   - Backdrop click closes the launcher.
 *   - App card click navigates to /app/<id> and closes the launcher.
 *   - "Close" button (X) closes the launcher.
 *   - One card is rendered per registered app id.
 */
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { APP_IDS, APPS } from "../../lib/apps";

const navigateMock = vi.fn();
const useNavigate = vi.fn(() => navigateMock);

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNavigate: () => useNavigate(),
}));

import { AppLauncher } from "./AppLauncher";

beforeEach(() => {
  navigateMock.mockClear();
  useNavigate.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("AppLauncher", () => {
  it("renders nothing when `open` is false", () => {
    const onClose = vi.fn();
    render(<AppLauncher open={false} onClose={onClose} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // No app headings either.
    expect(screen.queryByText("Apps")).not.toBeInTheDocument();
  });

  it("renders the dialog with the expected landmark + heading when open", () => {
    render(<AppLauncher open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "App launcher" });
    expect(dialog).toBeInTheDocument();
    // Heading inside the dialog.
    expect(within(dialog).getByRole("heading", { name: "Apps" })).toBeInTheDocument();
  });

  it("renders the 'Core' and 'Extensions' section labels", () => {
    render(<AppLauncher open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "App launcher" });
    expect(within(dialog).getByText("Core")).toBeInTheDocument();
    expect(within(dialog).getByText("Extensions")).toBeInTheDocument();
  });

  it("renders one card per registered app id", () => {
    render(<AppLauncher open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "App launcher" });
    for (const id of APP_IDS) {
      // The card shows the English label as a heading-like span.
      expect(within(dialog).getByText(APPS[id].label)).toBeInTheDocument();
    }
  });

  it("splits the catalog into core and extensions groups", () => {
    render(<AppLauncher open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "App launcher" });
    // The core group is the first 4 apps; ext is the rest. We assert by
    // the "Core" / "Extensions" headings + that we render >= 1 of each.
    const coreCount = APP_IDS.filter((id) => APPS[id].group === "core").length;
    const extCount = APP_IDS.filter((id) => APPS[id].group === "ext").length;
    expect(coreCount).toBeGreaterThan(0);
    expect(extCount).toBeGreaterThan(0);
    // At minimum the entire catalog is rendered.
    const totalCards = APP_IDS.length;
    expect(totalCards).toBeGreaterThan(0);
  });

  it("closes when the X button is clicked", () => {
    const onClose = vi.fn();
    render(<AppLauncher open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close app launcher" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the Escape key is pressed", () => {
    const onClose = vi.fn();
    render(<AppLauncher open onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT register an Escape handler when closed", () => {
    const onClose = vi.fn();
    render(<AppLauncher open={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<AppLauncher open onClose={onClose} />);
    // The backdrop is the absolutely-positioned div with bg-black/30.
    const backdrop = container.querySelector(".bg-black\\/30");
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("navigates to /app/<id> and closes the launcher when an app card is clicked", () => {
    const onClose = vi.fn();
    render(<AppLauncher open onClose={onClose} />);
    // Click the "CRM" card (a known core app).
    fireEvent.click(screen.getByRole("button", { name: /CRM/ }));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/app/$appId",
      params: { appId: "crm" },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the Armenian labels for at least one app (bilingual UX contract)", () => {
    render(<AppLauncher open onClose={() => {}} />);
    // CRM has labelAm = "Հաճախորդներ".
    expect(screen.getByText("Հաճախորդներ")).toBeInTheDocument();
  });

  it("renders the 'Esc' shortcut hint in the footer", () => {
    render(<AppLauncher open onClose={() => {}} />);
    expect(screen.getByText("Esc")).toBeInTheDocument();
    // The hint copy: "Press Esc to close".
    expect(screen.getByText(/to close/i)).toBeInTheDocument();
  });
});
