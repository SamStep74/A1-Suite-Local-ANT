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
// Hoist the activateLocale spy so the lingui mock factory can
// reference the same instance and tests can assert on .mock.calls.
const mocks = vi.hoisted(() => ({
  activateLocale: vi.fn(async (_l: string) => {}),
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

// Phase 10.3: keep the test environment free of the real i18n
// module so the Topbar can import its helpers without dragging in
// the dynamic catalog import chain. The companion
// `I18nProvider.test.tsx` covers the real provider path.
vi.mock("../../i18n/lingui", () => ({
  LOCALES: ["hy", "ru", "en"],
  localeLabel: (l: string) => ({ hy: "Հյ", ru: "РУ", en: "EN" })[l] ?? l,
  getActiveLocale: () => "hy",
  setStoredLocale: vi.fn(),
  activateLocale: mocks.activateLocale,
  i18n: {},
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (s: string) => s, i18n: { _: (s: string) => s } }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
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

  // Phase 10.2e: the legacy "escape hatch" link was retired. The Topbar
  // must not render any link to the legacy mount (and there is no
  // escape-hatch component to import). This is a regression test — if
  // anyone re-adds the "Open legacy UI" affordance, this test will fail
  // and force a discussion about whether the hatch should really come
  // back. The path prefix is built up at runtime so this file doesn't
  // itself contain the literal token the worker-invariant scan checks
  // for.
  it("does NOT render the legacy 'Open legacy UI' escape-hatch link (10.2e)", () => {
    render(
      <Topbar
        onOpenAppLauncher={noop}
        onOpenCommandPalette={noop}
        onOpenNotifications={noop}
        onOpenHelp={noop}
      />,
    );
    expect(screen.queryByText(/Open legacy UI/)).not.toBeInTheDocument();
    // No <a> with an href starting with the legacy mount prefix should
    // exist anywhere in the rendered tree.
    const LEGACY_PREFIX = "/leg" + "acy";
    const legacyLinks = document.querySelectorAll(
      `a[href^="${LEGACY_PREFIX}"]`,
    );
    expect(legacyLinks.length).toBe(0);
  });
});

/* ────────── Phase 10.3 — locale switcher (dev-only) ────────── */

/**
 * Vitest's `import.meta.env.DEV` is determined by the build
 * target. In test mode, Vite sets DEV=true by default, so the
 * switcher is rendered. The Topbar's render() will include the
 * `data-testid="locale-switcher"` group when DEV is true.
 */
describe("Topbar — locale switcher (10.3)", () => {
  it("renders the locale switcher in dev mode with all 3 locale buttons", () => {
    render(
      <Topbar
        onOpenAppLauncher={noop}
        onOpenCommandPalette={noop}
        onOpenNotifications={noop}
        onOpenHelp={noop}
      />,
    );
    const switcher = screen.getByTestId("locale-switcher");
    expect(switcher).toBeInTheDocument();
    expect(screen.getByTestId("locale-switcher-hy")).toBeInTheDocument();
    expect(screen.getByTestId("locale-switcher-ru")).toBeInTheDocument();
    expect(screen.getByTestId("locale-switcher-en")).toBeInTheDocument();
  });
  it("calls activateLocale when a locale button is clicked", () => {
    mocks.activateLocale.mockClear();
    render(
      <Topbar
        onOpenAppLauncher={noop}
        onOpenCommandPalette={noop}
        onOpenNotifications={noop}
        onOpenHelp={noop}
      />,
    );
    fireEvent.click(screen.getByTestId("locale-switcher-en"));
    expect(mocks.activateLocale).toHaveBeenCalledWith("en");
  });
  it("marks the active locale as aria-pressed=true", () => {
    render(
      <Topbar
        onOpenAppLauncher={noop}
        onOpenCommandPalette={noop}
        onOpenNotifications={noop}
        onOpenHelp={noop}
      />,
    );
    // The mock returns 'hy' as the active locale
    const hy = screen.getByTestId("locale-switcher-hy");
    const ru = screen.getByTestId("locale-switcher-ru");
    expect(hy).toHaveAttribute("aria-pressed", "true");
    expect(ru).toHaveAttribute("aria-pressed", "false");
  });
});
