/**
 * Runtime helpers for the Lingui v5 i18n setup.
 *
 * The i18n instance itself is the named export `i18n` from
 * `@lingui/core` (matches `runtimeConfigModule: ["@lingui/core", "i18n"]`
 * in `lingui.config.js`). We re-export it here so the rest of the app
 * only ever imports from `../i18n/lingui` — that keeps the runtime
 * import surface to one symbol and lets the macros (Trans / t``) be
 * processed by `babel-plugin-macros` consistently.
 *
 * Locale resolution order (see `getActiveLocale`):
 *   1. `?lang=` query string  — useful for e2e and screenshot tests
 *   2. `localStorage["a1:locale"]` — user-set preference
 *   3. `DEFAULT_LOCALE` ("hy")
 *
 * The dynamic import in `activateLocale` keeps each per-locale catalog
 * out of the initial bundle; Vite splits each `messages.ts` into its
 * own chunk that's fetched on first activation.
 */
import { i18n } from "@lingui/core";

export const LOCALES = ["hy", "ru", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "hy";

// Arm the i18n instance synchronously at module load so that any
// `t({ message: "..." })` macro evaluated at module-eval time (notably
// in `lib/onboarding/tours.ts` which builds a static const out of them)
// gets a safe `message`-fallback instead of throwing
// "Lingui: Attempted to call a translation function without setting a
// locale". The async `activateLocale()` in `I18nProvider`'s useEffect
// then replaces the empty messages dict with the real per-locale
// catalog on the next render.
i18n.activate(DEFAULT_LOCALE, {} as unknown as string[]);

const LOCALE_LABELS: Record<Locale, string> = {
  hy: "Հյ",
  ru: "РУ",
  en: "EN",
};

export const localeLabel = (l: Locale): string => LOCALE_LABELS[l];

const STORAGE_KEY = "a1:locale";

export const getStoredLocale = (): Locale | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw && (LOCALES as readonly string[]).includes(raw)) {
    return raw as Locale;
  }
  return null;
};

export const setStoredLocale = (l: Locale): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, l);
};

export const getActiveLocale = (): Locale => {
  // 1. ?lang= query string takes priority (useful for e2e tests and screenshots)
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("lang");
    if (q && (LOCALES as readonly string[]).includes(q)) {
      return q as Locale;
    }
  }
  // 2. localStorage
  const stored = getStoredLocale();
  if (stored) return stored;
  // 3. Default
  return DEFAULT_LOCALE;
};

/**
 * Static map of every supported locale to its compiled catalog
 * loader. Using a static map (instead of a templated
 * `import(\`../locales/${l}/messages\`)`) lets Vite/Rollup
 * discover the three chunks at build time and emit a separate
 * lazy-loaded chunk for each. The templated form would either
 * pull all three into the initial bundle (worst case) or trip
 * `vite:dynamic-import-vars`' "file extension required" rule.
 *
 * Dev-mode CJS workaround: `lingui compile` emits CJS
 * (`module.exports = { messages: ... }`), but Vite's dev server
 * serves the file verbatim to the browser, where `module` is
 * undefined. We sidestep that with `import.meta.glob`, which
 * tells Vite to bundle the matching files as raw strings
 * (`?raw`). We then evaluate the CJS in an isolated `Function`
 * scope to extract `module.exports`. The production build
 * bundles the catalogs into proper ESM chunks, so the raw path
 * is only hit in dev.
 *
 * Security note: the `raw` string is a build artifact from
 * `lingui compile` (derived from the committed `.po` files in
 * the source tree) — not user input. The content is
 * deterministic and reviewed via the `.po` files in git.
 */
type CatalogModule = {
  default?: { messages: Record<string, string> };
  messages?: Record<string, string>;
};

const CATALOG_MODULES = import.meta.glob<CatalogModule>(
  "/src/locales/*/messages.js"
);

const loadCatalog = async (
  localeKey: string,
): Promise<{ messages: Record<string, string> }> => {
  const loader = CATALOG_MODULES[`/src/locales/${localeKey}/messages.js`];
  if (!loader) {
    throw new Error(`No compiled catalog for locale "${localeKey}"`);
  }
  const mod = await loader();
  const catalog = mod.default ?? mod;
  return { messages: catalog.messages ?? {} };
};

const CATALOG_LOADERS: Record<Locale, () => Promise<{ messages: Record<string, string> }>> = {
  hy: () => loadCatalog("hy"),
  ru: () => loadCatalog("ru"),
  en: () => loadCatalog("en"),
};

export const activateLocale = async (l: Locale): Promise<void> => {
  setStoredLocale(l);
  document.documentElement.lang = l;
  // Each loader is its own dynamic import, so Vite emits one
  // chunk per locale and only fetches it on first activation.
  const { messages } = await CATALOG_LOADERS[l]();
  i18n.loadAndActivate({ locale: l, messages });
  window.dispatchEvent(new CustomEvent("a1:locale-changed", { detail: l }));
};

export { i18n };
