/**
 * DensityProvider — toggles the [data-density] attribute on <html>.
 *
 * Three modes: comfortable (default), compact, spacious.
 * Per the plan §3.3: density is a USER CHOICE, never force-fit. Persist in localStorage.
 *
 * Reading density in JS is rare (only for tooltip widths, table row heights).
 * The CSS in tokens.css handles the visual side via attribute selectors.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

export const DENSITIES = ["comfortable", "compact", "spacious"] as const;
export type Density = (typeof DENSITIES)[number];

const STORAGE_KEY = "a1.density";

function readStored(): Density {
  if (typeof window === "undefined") return "comfortable";
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v && (DENSITIES as readonly string[]).includes(v)) return v as Density;
  return "comfortable";
}

export function useDensity(): {
  density: Density;
  setDensity: (d: Density) => void;
} {
  const [density, setDensityState] = useState<Density>("comfortable");

  // On the client, sync to localStorage and the <html> attribute.
  useEffect(() => {
    const stored = readStored();
    setDensityState(stored);
    document.documentElement.setAttribute("data-density", stored);
  }, []);

  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    document.documentElement.setAttribute("data-density", next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage can throw in private mode; density still works in-memory.
    }
  }, []);

  return useMemo(() => ({ density, setDensity }), [density, setDensity]);
}
