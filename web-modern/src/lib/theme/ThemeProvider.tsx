/**
 * ThemeProvider — light / dark / contrast via [data-theme] on <html>.
 *
 * The plan §4 mandates all three themes (Odoo/Zoho/Salesforce all ship 3+).
 * "Contrast" hits WCAG AAA. Per the plan §3.3: a11y is not optional.
 *
 * mode-watcher handles system-preference detection; we layer on the contrast option.
 */
import { useCallback, useEffect, useState } from "react";

export const THEMES = ["light", "dark", "contrast"] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "a1.theme";
const QUERY = "(prefers-color-scheme: dark)";

function systemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia(QUERY).matches ? "dark" : "light";
}

function readStored(): { theme: Theme; system: boolean } {
  if (typeof window === "undefined") return { theme: "light", system: true };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { theme?: Theme; system?: boolean };
      const theme = (THEMES as readonly string[]).includes(parsed.theme ?? "")
        ? (parsed.theme as Theme)
        : systemTheme();
      return { theme, system: parsed.system ?? false };
    }
  } catch {
    // localStorage can be unavailable in private mode.
  }
  return { theme: systemTheme(), system: true };
}

export function useTheme(): {
  theme: Theme;
  followSystem: boolean;
  setTheme: (t: Theme) => void;
  setFollowSystem: (s: boolean) => void;
} {
  const [theme, setThemeState] = useState<Theme>("light");
  const [followSystem, setFollowSystemState] = useState(true);

  useEffect(() => {
    const { theme, system } = readStored();
    setThemeState(theme);
    setFollowSystemState(system);
    document.documentElement.setAttribute("data-theme", theme);
  }, []);

  // Follow the OS when the user hasn't pinned a choice.
  useEffect(() => {
    if (!followSystem) return;
    const mql = window.matchMedia(QUERY);
    const handler = () => {
      const next = mql.matches ? "dark" : "light";
      setThemeState(next);
      document.documentElement.setAttribute("data-theme", next);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [followSystem]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.setAttribute("data-theme", next);
    setFollowSystemState(false);
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ theme: next, system: false }),
      );
    } catch {
      // noop
    }
  }, []);

  const setFollowSystem = useCallback((s: boolean) => {
    setFollowSystemState(s);
    if (s) {
      const sys = systemTheme();
      setThemeState(sys);
      document.documentElement.setAttribute("data-theme", sys);
    }
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ theme: theme, system: s }),
      );
    } catch {
      // noop
    }
  }, [theme]);

  return { theme, followSystem, setTheme, setFollowSystem };
}
