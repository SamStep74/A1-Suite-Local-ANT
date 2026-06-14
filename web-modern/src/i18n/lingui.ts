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
 */
const CATALOG_LOADERS: Record<Locale, () => Promise<{ messages: Record<string, string> }>> = {
  // Use the @/ alias (mapped to ./src/* in tsconfig) so the
  // `src/locales/messages.d.ts` ambient declaration matches.
  hy: () => import("@/locales/hy/messages"),
  ru: () => import("@/locales/ru/messages"),
  en: () => import("@/locales/en/messages"),
};

export const activateLocale = async (l: Locale): Promise<void> => {
  // Each loader is its own dynamic import, so Vite emits one
  // chunk per locale and only fetches it on first activation.
  const { messages } = await CATALOG_LOADERS[l]();
  // Lingui's `activate` is typed `Locales = string | string[]` but
  // at runtime accepts the catalog-shape `Record<string,string>` we
  // hand back from the compiled CJS module. The cast keeps the
  // public type narrow without dragging in a loose `any` at the
  // call site.
  i18n.activate(l, messages as unknown as string[]);
  setStoredLocale(l);
  document.documentElement.lang = l;
};

export { i18n };

