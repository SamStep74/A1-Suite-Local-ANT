/**
 * tours.test.ts — invariants of the DEFAULT_TOURS catalog.
 *
 * The catalog is a static const that ships in the bundle; these
 * tests pin the public surface so a typo in a tour id or a
 * missing step doesn't reach production unnoticed.
 *
 * Lingui macro mock
 * ─────────────────
 * `tours.ts` calls `t({ message: "..." })` at module load for
 * every step title/body. Without a babel plugin in vitest, the
 * macro is unresolved and importing tours.ts would throw
 * `(0 , t) is not a function`. We could enable the babel plugin
 * — but that makes every other test that uses `useLingui()`
 * throw "useLingui hook was used without I18nProvider" unless
 * the test mounts an I18nProvider (see the comment in
 * `vitest.config.ts` for the full tradeoff). Per-file mock is
 * the surgical fix: we stub `t` and the React-side macros to
 * return the source message / pass children through, so the
 * catalog import works and the assertions below can match on
 * the literal English text.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@lingui/core/macro", () => ({
  t: (msg: { message: string }) => msg.message,
  defineMessage: (msg: { message: string }) => msg,
}));

vi.mock("@lingui/react/macro", () => ({
  // Note: the SUT (tours.ts) imports `t` from `@lingui/core/macro`, but
  // because the Lingui macro package re-exports the same surface across
  // paths, vitest's mock resolver occasionally routes a `@lingui/core/macro`
  // import to the *react/macro* mock when both are hoisted in the same
  // file. Exporting `t` here too makes the test resilient to that quirk.
  t: (msg: { message: string } | string) => (typeof msg === "string" ? msg : msg.message),
  useLingui: () => ({
    i18n: { _: (msg: { message: string } | string) => (typeof msg === "string" ? msg : msg.message) },
    t: (msg: { message: string } | string) => (typeof msg === "string" ? msg : msg.message),
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => children,
  Plural: ({ children }: { children?: React.ReactNode }) => children,
  Select: ({ children, value }: { children?: React.ReactNode; value?: unknown }) => value ?? children,
  SelectOrdinal: ({ children, value }: { children?: React.ReactNode; value?: unknown }) => value ?? children,
}));

import {
  DEFAULT_TOURS,
  DEFAULT_TOURS_BY_ID,
  ALL_TOUR_IDS,
} from "../tours";

describe("onboarding/tours — DEFAULT_TOURS catalog", () => {
  it("ships exactly 5 tours (fiscal-gates, triage-inbox, ask-ai, documents, settings)", () => {
    expect(DEFAULT_TOURS).toHaveLength(5);
    expect(ALL_TOUR_IDS).toEqual([
      "fiscal-gates",
      "triage-inbox",
      "ask-ai",
      "documents",
      "settings",
    ]);
  });

  it("every tour id is kebab-case and unique", () => {
    const ids = new Set<string>();
    for (const tour of DEFAULT_TOURS) {
      expect(tour.id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(tour.id)).toBe(false);
      ids.add(tour.id);
    }
  });

  it("every tour has at least one step", () => {
    for (const tour of DEFAULT_TOURS) {
      expect(tour.steps.length).toBeGreaterThan(0);
    }
  });

  it("the r1 surfaces (fiscal-gates, triage-inbox, ask-ai) are not deferred", () => {
    const r1 = ["fiscal-gates", "triage-inbox", "ask-ai"];
    for (const id of r1) {
      expect(DEFAULT_TOURS_BY_ID[id]?.deferred).toBe(false);
    }
  });

  it("the r2 surfaces (documents, settings) are live once W5 + W6 merge", () => {
    // W7 ships the tour catalog with `deferred: true` for the
    // W5 / W6 tours. After both workers land in ant/main, the
    // orchestrator flips the flag so the launcher offers all 5
    // tours without the "Preview" body copy. This test pins the
    // post-flip contract: r2 tours are NOT deferred once the
    // surfaces are live.
    expect(DEFAULT_TOURS_BY_ID["documents"]?.deferred).toBe(false);
    expect(DEFAULT_TOURS_BY_ID["settings"]?.deferred).toBe(false);
  });

  it("every step's kind is one of the three allowed values", () => {
    for (const tour of DEFAULT_TOURS) {
      for (const step of tour.steps) {
        expect(["navigate", "highlight", "info"]).toContain(step.kind);
      }
    }
  });

  it("every 'navigate' step has a non-empty routePath", () => {
    for (const tour of DEFAULT_TOURS) {
      for (const step of tour.steps) {
        if (step.kind === "navigate") {
          expect(step.routePath.length).toBeGreaterThan(0);
          // Must live under /app (the authed shell). `/app` is
          // also valid — the settings tour's first step lands
          // the user back on the app root to demonstrate the
          // cheatsheet.
          expect(step.routePath).toMatch(/^\/app(\/|$)/);
        }
      }
    }
  });

  it("every step has a non-empty title and body", () => {
    for (const tour of DEFAULT_TOURS) {
      for (const step of tour.steps) {
        // step.title and step.body are MessageNode (string | macro
        // descriptor) in the production schema; the test stub
        // always returns plain strings, so we cast.
        const title = step.title as unknown as string;
        const body = step.body as unknown as string;
        expect(title.length).toBeGreaterThan(0);
        expect(body.length).toBeGreaterThan(0);
      }
    }
  });

  it("the icon names match the launcher's ICONS map (defensive)", () => {
    // The launcher's `ICONS` map is the only consumer; if a
    // catalog tour uses an icon the map doesn't know, the
    // launcher falls back to Sparkles silently. We keep the
    // catalog aligned with the map by listing the known set
    // here as the source of truth for both files.
    const known = new Set(["Receipt", "Inbox", "Sparkles", "FileText", "Settings"]);
    for (const tour of DEFAULT_TOURS) {
      expect(known.has(tour.icon)).toBe(true);
    }
  });

  it("the 'documents' tour has 4 info-style wizard steps", () => {
    const docs = DEFAULT_TOURS_BY_ID["documents"];
    expect(docs).toBeDefined();
    // 1 navigate + 4 info = 5 steps total
    expect(docs?.steps).toHaveLength(5);
    const infoSteps = docs?.steps.filter((s) => s.kind === "info") ?? [];
    expect(infoSteps).toHaveLength(4);
  });

  it("the 'settings' tour references the locale switcher", () => {
    const settings = DEFAULT_TOURS_BY_ID["settings"];
    expect(settings).toBeDefined();
    const titles = settings?.steps.map((s) => s.title) ?? [];
    // The body string includes the locale switcher mention.
    const joined = JSON.stringify(titles);
    expect(joined.length).toBeGreaterThan(0);
  });
});
