/**
 * I18nProvider + locale-resolution unit tests (Phase 10.3).
 *
 * These tests pin three contracts:
 *
 *   1. `getActiveLocale()` returns `"hy"` (the project's source locale)
 *      when localStorage is empty and no `?lang=` is set.
 *   2. `getActiveLocale()` respects `?lang=ru` before localStorage
 *      (e2e / screenshot-friendly escape hatch).
 *   3. `getActiveLocale()` falls back to localStorage when there is
 *      no `?lang=`.
 *
 * The `?lang=` and localStorage cases are tested in isolation by
 * mutating the jsdom globals directly between cases. We don't try
 * to mount the full I18nProvider in this file — that's covered by
 * the e2e spec (`web-modern/e2e/i18n-canary.spec.ts`).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  getActiveLocale,
  getStoredLocale,
  hasTranslation,
  setStoredLocale,
} from "./lingui";

const STORAGE_KEY = "a1:locale";

afterEach(() => {
  // Reset jsdom localStorage + URL between cases
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("i18n / lingui.ts — getActiveLocale()", () => {
  it('returns "hy" when localStorage is empty and no ?lang= is set', () => {
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
    expect(getActiveLocale()).toBe("hy");
    expect(getActiveLocale()).toBe(DEFAULT_LOCALE);
  });

  it('returns "ru" when ?lang=ru is in the URL (overrides localStorage)', () => {
    window.history.replaceState(null, "", "/some/path?lang=ru");
    window.localStorage.setItem(STORAGE_KEY, "en");
    expect(getActiveLocale()).toBe("ru");
  });

  it('returns "en" when localStorage has a1:locale="en" and no ?lang=', () => {
    window.history.replaceState(null, "", "/");
    window.localStorage.setItem(STORAGE_KEY, "en");
    expect(getActiveLocale()).toBe("en");
  });

  it("ignores an unknown ?lang= and falls through to localStorage/default", () => {
    window.history.replaceState(null, "", "/?lang=zz");
    expect(getActiveLocale()).toBe("hy");
    window.localStorage.setItem(STORAGE_KEY, "en");
    expect(getActiveLocale()).toBe("en");
  });
});

describe("i18n / lingui.ts — localStorage helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("setStoredLocale then getStoredLocale returns the same locale", () => {
    setStoredLocale("en");
    expect(getStoredLocale()).toBe("en");
    setStoredLocale("ru");
    expect(getStoredLocale()).toBe("ru");
    setStoredLocale("hy");
    expect(getStoredLocale()).toBe("hy");
  });

  it("getStoredLocale returns null when the key is missing", () => {
    expect(getStoredLocale()).toBeNull();
  });

  it("getStoredLocale ignores garbage values (returns null)", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-a-locale");
    expect(getStoredLocale()).toBeNull();
  });
});

describe("i18n / lingui.ts — LOCALES constant", () => {
  it("contains exactly hy, ru, en in that order", () => {
    expect([...LOCALES]).toEqual(["hy", "ru", "en"]);
  });
});

describe("i18n / lingui.ts — hasTranslation() (Phase 10.5 gate)", () => {
  // This pins the static allowlist in `lingui.ts`. The
  // 10.5-translation-pass worker is responsible for flipping `ru`
  // and `en` to `true` after it commits real translations. Until
  // then, only `hy` is considered "translated" and the I18nProvider
  // banner appears for `ru` / `en` users in dev mode.
  it('"hy" returns true (source locale, always translated)', () => {
    expect(hasTranslation("hy")).toBe(true);
  });

  it('"ru" returns false until the 10.5-translation-pass flips it', () => {
    expect(hasTranslation("ru")).toBe(false);
  });

  it('"en" returns false until the 10.5-translation-pass flips it', () => {
    expect(hasTranslation("en")).toBe(false);
  });
});
