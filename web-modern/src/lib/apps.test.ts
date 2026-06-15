/**
 * apps — Centralized app/module catalog. Source of truth for the
 * App Launcher grid, LeftRail, /app/<id> route param validation,
 * and Today feed deep-links.
 *
 * These tests pin the *shape* of the catalog (count, fields, id
 * uniqueness, palette conformance) and the `appHref` helper, so
 * future refactors can't silently break the launcher UI, the route
 * tree, or the body.apps.length === N invariant that the server
 * tests rely on.
 */
import { describe, expect, it } from "vitest";
import { APP_IDS, APPS, type AppId, type AppMeta, appHref, appLinkTo } from "./apps";

/**
 * The exact set of palette names defined on the AppMeta.accent field.
 * Mirrors `--color-{teal|blue|violet|green|amber|ruby|orange|pink}`
 * in tokens.css. If a new accent is added, the source's TS union
 * (AppMeta.accent) and tokens.css must both change in lockstep.
 */
const VALID_ACCENTS = [
  "teal",
  "blue",
  "violet",
  "green",
  "amber",
  "ruby",
  "orange",
  "pink",
] as const;

const VALID_GROUPS = ["core", "ext"] as const;

describe("apps — APP_IDS catalog", () => {
  it("APP_IDS matches the keys present on APPS (no orphans)", () => {
    // Round-trip: every id in APP_IDS has a meta entry, and every
    // meta entry's id is in APP_IDS. Catches typos like
    // APP_IDS = ["crm", "finace"] that would silently desync.
    const apsKeys = Object.keys(APPS).sort();
    const ids = [...APP_IDS].sort();
    expect(apsKeys).toEqual(ids);
  });

  it("APP_IDS has no duplicate entries", () => {
    const set = new Set(APP_IDS);
    expect(set.size).toBe(APP_IDS.length);
  });

  it("APP_IDS is non-empty", () => {
    expect(APP_IDS.length).toBeGreaterThan(0);
  });
});

describe("apps — APPS shape", () => {
  it("the count of APPS entries matches APP_IDS.length", () => {
    // The server tests assert `body.apps.length === N` for the
    // launcher response. This pins N to the source of truth here
    // — if you add/remove an id, both update in lockstep or
    // body.apps.length invariant breaks.
    expect(Object.keys(APPS)).toHaveLength(APP_IDS.length);
  });

  it("APPS has no duplicate ids (Record keys are unique by construction)", () => {
    // The TS type Record<AppId, AppMeta> enforces uniqueness, but
    // we double-check at runtime — useful if someone changes the
    // type to allow loose keys.
    const ids = Object.keys(APPS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every APPS entry has all required fields populated", () => {
    for (const [key, meta] of Object.entries(APPS)) {
      expect(meta.id, `${key}.id`).toBe(key);
      expect(typeof meta.label, `${key}.label`).toBe("string");
      expect(meta.label.length, `${key}.label is empty`).toBeGreaterThan(0);
      expect(typeof meta.labelAm, `${key}.labelAm`).toBe("string");
      expect(meta.labelAm.length, `${key}.labelAm is empty`).toBeGreaterThan(0);
      expect(typeof meta.tagline, `${key}.tagline`).toBe("string");
      expect(meta.tagline.length, `${key}.tagline is empty`).toBeGreaterThan(0);
      expect(meta.icon, `${key}.icon`).toBeDefined();
      expect(VALID_ACCENTS, `${key}.accent`).toContain(meta.accent);
      expect(VALID_GROUPS, `${key}.group`).toContain(meta.group);
      expect(typeof meta.legacyMountId, `${key}.legacyMountId`).toBe("string");
      expect(meta.legacyMountId.length, `${key}.legacyMountId is empty`).toBeGreaterThan(0);
    }
  });

  it("every APPS entry's `id` field matches its key in the Record", () => {
    // Defends against a refactor that swaps e.g. crm's id to "customer"
    // but forgets the Record key — silent route mount break.
    for (const key of Object.keys(APPS) as AppId[]) {
      expect(APPS[key]!.id).toBe(key);
    }
  });

  it("every icon is a lucide-react component (function or class)", () => {
    // lucide-react icons are forwardRef'd function components, so
    // they are `function` or `object` (forwardRef returns an object).
    // We just need to assert the property is present and not
    // undefined — the .tsx render path would have failed at build
    // time otherwise.
    for (const [key, meta] of Object.entries(APPS)) {
      expect(meta.icon, `${key}.icon should be defined`).toBeDefined();
      // forwardRef'd components are objects; class components are
      // functions; both `typeof` checks pass. Reject only primitives.
      const t = typeof meta.icon;
      expect(
        t === "function" || t === "object",
        `${key}.icon should be a React component (got ${t})`,
      ).toBe(true);
    }
  });

  it("every legacyMountId starts with 'suite-app-'", () => {
    // Convention from the legacy Vite app at web/ — every mount
    // point is named `suite-app-<id>`. Drift here would mean the
    // legacy SPA can't find the React island to hydrate.
    for (const [key, meta] of Object.entries(APPS)) {
      expect(
        meta.legacyMountId.startsWith("suite-app-"),
        `${key}.legacyMountId should start with "suite-app-" (got "${meta.legacyMountId}")`,
      ).toBe(true);
    }
  });

  it("label and labelAm are distinct (the suite is bilingual EN/AM)", () => {
    for (const [key, meta] of Object.entries(APPS)) {
      expect(
        meta.label !== meta.labelAm,
        `${key}: label and labelAm should differ (bilingual)`,
      ).toBe(true);
    }
  });
});

describe("apps — group balance", () => {
  it("there is at least one 'core' app and at least one 'ext' app", () => {
    // The launcher visually groups core/ext and renders them as
    // separate sections. If either group is empty the layout breaks.
    const groups = new Set(Object.values(APPS).map((m) => m.group));
    expect(groups.has("core")).toBe(true);
    expect(groups.has("ext")).toBe(true);
  });

  it("no accent is reused by every app (palette is supposed to spread)", () => {
    // Cheap sanity: with 8 accents and N apps, no single accent
    // should appear on every entry — otherwise the launcher
    // would look like a single color.
    const counts: Record<string, number> = {};
    for (const meta of Object.values(APPS)) {
      counts[meta.accent] = (counts[meta.accent] ?? 0) + 1;
    }
    const maxCount = Math.max(...Object.values(counts));
    expect(maxCount).toBeLessThan(Object.keys(APPS).length);
  });
});

describe("apps — TypeScript narrowing", () => {
  it("an AppId-typed lookup returns a fully-typed AppMeta", () => {
    // Compile-time check via runtime: a typed lookup of a known
    // id should give back the same shape we'd hand-write.
    const sample: AppId = "crm";
    const meta: AppMeta = APPS[sample];
    expect(meta.id).toBe("crm");
    expect(meta.group).toBe("core");
  });
});

describe("appHref", () => {
  it("returns /app/<id> for any AppId", () => {
    expect(appHref("crm")).toBe("/app/crm");
    expect(appHref("finance")).toBe("/app/finance");
    expect(appHref("cfo")).toBe("/app/cfo");
  });

  it("the returned href has a single leading slash", () => {
    for (const id of APP_IDS) {
      const href = appHref(id);
      expect(href.startsWith("/")).toBe(true);
      expect(href.startsWith("//"), `${id} should not have a protocol-relative URL`).toBe(false);
    }
  });
});

describe("appLinkTo", () => {
  it("keeps the copilot catalog link on Mission Control", () => {
    expect(appLinkTo("copilot").to).toBe("/app/copilot");
  });

  it("links ordinary known apps to their literal index routes", () => {
    expect(appLinkTo("crm").to).toBe("/app/crm/");
  });
});
