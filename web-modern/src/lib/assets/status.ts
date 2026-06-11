/**
 * Pure helpers for the Fixed Assets workspace.
 *
 * Source of truth: server/app.js (the /api/assets/* handlers) and the
 * Zod registry at web-modern/src/lib/api/schemas.ts (the `Assets*`
 * schemas). The 4 tabs (Registry, Depreciation, Maintenance, Assignment)
 * and their Armenian labels are mirrored from the legacy component at
 * web/src/assets.jsx (lines 3-8) so the modern UI and the legacy UI
 * share the same vocabulary.
 *
 * These helpers are UI-pure: no React, no I/O, no router. They re-derive
 * small affordances (tab labels, AMD formatting with Armenian digit
 * grouping, deep-link hash round-trips, idempotency-key generation, asset-id
 * validation) and shape server data for rendering. Tested in isolation
 * under vitest.
 *
 * Public surface:
 *  - ASSETS_TABS                    readonly tuple of all tab ids (in order)
 *  - AssetsTab                      union type derived from ASSETS_TABS
 *  - assetsTabLabelAm               Armenian-first pill label for a tab
 *  - assetsTabFromHash              resolve a deep-link hash → tab (defensive)
 *  - assetsTabToHash                encode a tab → deep-link hash
 *  - formatAssetCostAmd             Armenian number + " AMD" suffix
 *  - formatAssetPeriodIndex         "#1" / "#12" — period chip label
 *  - generateAssetsIdempotencyKey   "post-depr-ui-1700000000000" / "assign-ui-..."
 *  - isValidAssetsAssetId           non-empty string, max 100 chars
 */
import type {
  AssetsAssignment,
  AssetsAssignRequest,
  AssetsDepreciationLine,
  AssetsMaintenanceLog,
  AssetsPostDepreciationRequest,
  AssetsValueRollupRow,
} from "../api/schemas";

/* ────────── type re-exports (UI narrowing) ────────── */

export type {
  AssetsAssignment,
  AssetsAssignRequest,
  AssetsDepreciationLine,
  AssetsMaintenanceLog,
  AssetsPostDepreciationRequest,
  AssetsValueRollupRow,
};

/* ────────── enum constants ────────── */

/** Canonical tab order. Mirrors the legacy `TABS` array in
 *  web/src/assets.jsx (lines 3-8). The first entry is the default tab
 *  the route opens to. */
export const ASSETS_TABS = [
  "registry",
  "depreciation",
  "maintenance",
  "assignment",
] as const;

export type AssetsTab = (typeof ASSETS_TABS)[number];

/** The first tab in ASSETS_TABS — used as the default when no hash is set
 *  and to short-circuit the "unknown hash" branch in `assetsTabFromHash`. */
export const ASSETS_DEFAULT_TAB: AssetsTab = ASSETS_TABS[0];

/* ────────── tab labels (Armenian-first) ────────── */

const TAB_LABEL_HY: Record<AssetsTab, string> = {
  registry: "Ռեեստր",
  depreciation: "Հարկում",
  maintenance: "Սպասարկում",
  assignment: "Հանձնարարություն",
};

const TAB_LABEL_EN: Record<AssetsTab, string> = {
  registry: "Registry",
  depreciation: "Depreciation",
  maintenance: "Maintenance",
  assignment: "Assignment",
};

/**
 * Armenian-first pill label. Mirrors the legacy `TABS` array
 * (web/src/assets.jsx:3-8) so the modern UI and the legacy UI use the
 * exact same Armenian string.
 */
export function assetsTabLabelAm(tab: AssetsTab): string {
  return `${TAB_LABEL_HY[tab]} (${TAB_LABEL_EN[tab]})`;
}

/* ────────── deep-link hash round-trip ────────── */

/**
 * Encode a tab to its deep-link hash fragment. The route can use
 * `<a href={assetsTabToHash(tab)}>` to land on a specific tab. We use
 * the bare tab id (e.g. `#depreciation`) — no `assets/` prefix — so
 * copy-paste stays short.
 */
export function assetsTabToHash(tab: AssetsTab): string {
  return `#${tab}`;
}

/**
 * Resolve a deep-link hash to a tab. Accepts the bare hash form
 * (`#depreciation`), the URL-style form (`#assets/depreciation`), and
 * the `window.location.hash` value (which Chrome prefixes with `#`).
 * Returns the default tab on any unrecognised input — never throws.
 */
export function assetsTabFromHash(hash: string | null | undefined): AssetsTab {
  if (typeof hash !== "string" || hash.length === 0) {
    return ASSETS_DEFAULT_TAB;
  }
  // Strip the leading "#" and any "/assets/" prefix the route may have added.
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  const tail = stripped.startsWith("assets/") ? stripped.slice("assets/".length) : stripped;
  // The first path segment is the tab; ignore anything after a "/".
  // (String.prototype.split always returns ≥1 element, so no fallback needed.)
  const head = tail.split("/")[0];
  if ((ASSETS_TABS as readonly string[]).includes(head)) {
    return head as AssetsTab;
  }
  return ASSETS_DEFAULT_TAB;
}

/* ────────── AMD formatting ────────── */

const hyAM = new Intl.NumberFormat("hy-AM", { maximumFractionDigits: 0 });

/**
 * Format an integer AMD amount with Armenian digit grouping and the
 * " AMD" suffix. Negative numbers are supported (refund, write-off
 * delta) and render with a leading minus — matches `toLocaleString("hy-AM")`
 * behavior used in the legacy component.
 *
 * Returns "—" for non-finite / NaN input so the UI can render an
 * ellipsis chip instead of "NaN AMD".
 */
export function formatAssetCostAmd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${hyAM.format(Math.trunc(value))} AMD`;
}

/* ────────── depreciation period index ────────── */

/**
 * Format a depreciation period index as a `#N` chip label.
 * Matches the legacy UI's `#{line.periodIndex + 1}` rendering
 * (web/src/assets.jsx:110) but is offset-by-one so callers can pass
 * the raw `periodIndex` from the wire format directly.
 *
 * Non-finite / negative input falls back to `#0` so the chip still
 * renders, matching the legacy "fall back to zero" semantics.
 */
export function formatAssetPeriodIndex(periodIndex: number | null | undefined): string {
  if (typeof periodIndex !== "number" || !Number.isFinite(periodIndex)) return "#0";
  const n = Math.max(0, Math.trunc(periodIndex) + 1);
  return `#${n}`;
}

/* ────────── idempotency key generation ────────── */

/** UI-grade idempotency-key kinds. The server has its own cache
 *  (`lookupIdempotent`) keyed on this string. */
export type AssetsIdempotencyKind = "post-depr" | "assign";

/**
 * Generate a UI-grade idempotency key for an assets mutation. The
 * legacy component always sends `ui-post-depr-${Date.now()}` (line 49)
 * and `ui-assign-${Date.now()}` (line 153); we follow the same contract.
 *
 * Note: this is NOT cryptographically unique — two clicks in the same
 * millisecond could collide. The server's idempotency cache window is
 * short, so collisions only affect in-flight retries; that's the same
 * behavior the legacy UI ships with.
 */
export function generateAssetsIdempotencyKey(kind: AssetsIdempotencyKind): string {
  return `${kind}-ui-${Date.now()}`;
}

/* ────────── asset-id validation ────────── */

/**
 * Validate a user-entered asset id before sending it to the server.
 * Mirrors the cabinet helper `isValidCabinetId` discipline (non-empty
 * after trim, max 100 chars). The server has no length cap, but we
 * guard the UI to keep a fat-finger entry from generating a
 * 1000-character URL.
 */
export function isValidAssetsAssetId(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > 100) return false;
  return true;
}
