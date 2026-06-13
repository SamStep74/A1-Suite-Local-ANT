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
 *
 * Dev-only "translations in progress" banner:
 *   When a user picks `ru` or `en` in the dev locale switcher and
 *   the active catalog is still the placeholder (hasTranslation()
 *   returns false), we render a small fixed-position banner at the
 *   top of the page. The banner is wrapped in `import.meta.env.DEV`
 *   so it's stripped from production builds (same pattern as the
 *   10.3 locale switcher in `Topbar.tsx`).
 *
 *   When the 10.5-translation-pass phase lands and the `ru` / `en`
 *   catalogs grow past 10 keys, `hasTranslation()` flips to `true`
 *   and the banner stops appearing. At that point this code can
 *   be deleted in a follow-up commit.
 */
import { Trans } from "@lingui/react/macro";
import { useEffect, useState, type ReactNode } from "react";
import { I18nProvider as LinguiProvider } from "@lingui/react";
import {
  i18n,
  activateLocale,
  getActiveLocale,
  hasTranslation,
  type Locale,
} from "./lingui";

interface Props {
  children: ReactNode;
}

export const I18nProvider = ({ children }: Props) => {
  const [ready, setReady] = useState(false);
  const [locale, setLocale] = useState<Locale>(getActiveLocale);

  useEffect(() => {
    let cancelled = false;
    const l: Locale = getActiveLocale();
    activateLocale(l).then(() => {
      if (!cancelled) {
        setLocale(l);
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
      {import.meta.env.DEV && !hasTranslation(locale) ? (
        <div
          data-testid="i18n-translations-in-progress"
          role="status"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            padding: "6px 12px",
            background: "#fff3cd",
            color: "#664d03",
            borderBottom: "1px solid #ffe69c",
            fontFamily:
              "system-ui, -apple-system, 'Segoe UI', sans-serif",
            fontSize: 13,
            lineHeight: 1.4,
            textAlign: "center",
          }}
        >
          <Trans>
            Translations for this language are still in progress — some
            text may appear in Armenian. Switch back to Հյ for the full
            experience.
          </Trans>
        </div>
      ) : null}
      {children}
    </LinguiProvider>
  );
};
