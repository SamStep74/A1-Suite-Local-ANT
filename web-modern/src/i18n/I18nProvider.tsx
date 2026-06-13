/**
 * I18nProvider — mounts Lingui's React context once the right catalog
 * has been loaded into the i18n instance.
 *
 * Why a separate component:
 *   - The catalog is a dynamic import (per-locale code-split chunk),
 *     so we must wait for `activateLocale(...)` to resolve before
 *     rendering children. Otherwise the first frame would render
 *     `t\`\`` messages as their raw ids.
 *   - Returning `null` until the catalog is ready avoids a flash of
 *     untranslated text on hard reloads — the worst case is a
 *     sub-frame of blank, which is far less jarring than a flicker
 *     between Armenian (source) and the user's preferred locale.
 *
 * The `cancelled` flag protects against the user navigating away
 * mid-load: React 19's strict-mode double-mount also triggers the
 * cleanup, so the second `setReady` would be a no-op but we still
 * gate it.
 */
import { useEffect, useState, type ReactNode } from "react";
import { I18nProvider as LinguiProvider } from "@lingui/react";
import {
  i18n,
  activateLocale,
  getActiveLocale,
  type Locale,
} from "./lingui";

interface Props {
  children: ReactNode;
}

export const I18nProvider = ({ children }: Props) => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const l: Locale = getActiveLocale();
    activateLocale(l).then(() => {
      if (!cancelled) {
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Avoid a flash of untranslated text: render nothing until the catalog is loaded
  if (!ready) return null;

  return (
    <LinguiProvider i18n={i18n}>
      {children}
    </LinguiProvider>
  );
};
