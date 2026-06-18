/**
 * Pure helpers for the Procurement extension workspace.
 *
 * Source of truth: server/app.js 860-998 (the 12 `/api/procurement/*`
 * route handlers) and the Zod registry at
 * web-modern/src/lib/api/schemas.ts (the `Procurement*` schemas).
 *
 * These helpers are UI-pure: no React, no I/O, no router. They
 * re-derive small UI affordances (idempotency-key minting, Armenian
 * labels for landed-cost kinds + allocation methods, vendor score /
 * price formatting, deep-linking hash ↔ tab, and a one-shot requisition
 * input guard) and shape server data for rendering. Tested in
 * isolation under jsdom.
 *
 * Public surface:
 *  - PROCUREMENT_TABS / LANDED_COST_KINDS / ALLOCATION_METHODS
 *      → readonly enum arrays
 *  - IdempotencyKeyKind (union)
 *  - LandedCostKind / AllocationMethod (re-exported from the schema)
 *  - generateIdempotencyKey       → `${kind}-ui-${Date.now()}`
 *  - landedCostKindLabelAm        → "Առաքում" | "Մաքսատուրք" | ...
 *  - allocationMethodLabelAm      → "Ըստ արժեքի" | ...
 *  - isLandedCostKind / isAllocationMethod
 *      → type guards
 *  - formatVendorScore            → "0.85" (2-decimal)
 *  - formatPrice                  → Armenian number grouping + currency
 *  - procurementTabFromHash / procurementTabToHash
 *      → deep-linking helpers
 *  - validateRequisitionInput     → {ok, reason?}
 */
import type {
  ProcurementAllocationMethod,
  ProcurementLandedCostKind,
} from "../api/schemas";

/* ────────── type re-exports (UI narrowing) ────────── */

export type { ProcurementLandedCostKind, ProcurementAllocationMethod };
export type LandedCostKind = ProcurementLandedCostKind;
export type AllocationMethod = ProcurementAllocationMethod;

/* ────────── enum constants ────────── */

export const LANDED_COST_KINDS: readonly LandedCostKind[] = [
  "freight",
  "duty",
  "insurance",
  "other",
] as const;

export const ALLOCATION_METHODS: readonly AllocationMethod[] = [
  "value",
  "quantity",
  "weight",
] as const;

export type ProcurementTab =
  | "requisitions"
  | "rfq"
  | "blanket"
  | "landed"
  | "credit";

export const PROCUREMENT_TABS: readonly ProcurementTab[] = [
  "requisitions",
  "rfq",
  "blanket",
  "landed",
  "credit",
] as const;

/* The five "kinds" of create operations. Each maps to one server
 * POST endpoint and gets a dedicated idempotency-key prefix. The
 * literal matches the union on `generateIdempotencyKey`. */
export type IdempotencyKeyKind =
  | "requisition"
  | "convert"
  | "blanket"
  | "landed"
  | "credit";

/* ────────── idempotency key minting ────────── */

/**
 * Mint a client-side idempotency key for a write operation. The
 * server caches the response envelope under the (orgId, key) pair
 * and returns the cached body on duplicate, so a retried submission
 * doesn't double-post. The prefix matches the endpoint family so
 * server logs are greppable.
 *
 * Format: `${kind}-ui-${Date.now()}` — same shape the legacy
 * `web/src/procurement.jsx` used, with one improvement: the kind is
 * the full English word (`requisition`, `convert`, `blanket`,
 * `landed`, `credit`) so the prefix is self-describing in the
 * audit log. The legacy used abbreviations (`pr`, `bo`, `lc`, `cn`).
 */
export function generateIdempotencyKey(kind: IdempotencyKeyKind): string {
  return `${kind}-ui-${Date.now()}`;
}

/* ────────── landed cost kind labels (Armenian-first) ────────── */

const LANDED_COST_KIND_LABEL_HY: Record<LandedCostKind, string> = {
  freight: "Առաքում",
  duty: "Մաքսատուրք",
  insurance: "Ապահովագրություն",
  other: "Այլ",
};

const LANDED_COST_KIND_LABEL_EN: Record<LandedCostKind, string> = {
  freight: "Freight",
  duty: "Duty",
  insurance: "Insurance",
  other: "Other",
};

/**
 * Armenian-first label for a landed-cost kind. The Armenian word is
 * the primary string; the English gloss is appended in parens so
 * the pill is readable in dev / mixed-language contexts. Mirrors
 * `directionLabelArm` in cabinet/status.ts.
 */
export function landedCostKindLabelAm(kind: LandedCostKind): string {
  const hy = LANDED_COST_KIND_LABEL_HY[kind];
  const en = LANDED_COST_KIND_LABEL_EN[kind];
  return `${hy} (${en})`;
}

/* ────────── allocation method labels (Armenian-first) ────────── */

const ALLOCATION_METHOD_LABEL_HY: Record<AllocationMethod, string> = {
  value: "Ըստ արժեքի",
  quantity: "Ըստ քանակի",
  weight: "Ըստ քաշի",
};

const ALLOCATION_METHOD_LABEL_EN: Record<AllocationMethod, string> = {
  value: "By value",
  quantity: "By quantity",
  weight: "By weight",
};

export function allocationMethodLabelAm(method: AllocationMethod): string {
  const hy = ALLOCATION_METHOD_LABEL_HY[method];
  const en = ALLOCATION_METHOD_LABEL_EN[method];
  return `${hy} (${en})`;
}

/* ────────── type guards ────────── */

export function isLandedCostKind(value: string): value is LandedCostKind {
  return (LANDED_COST_KINDS as readonly string[]).includes(value);
}

export function isAllocationMethod(value: string): value is AllocationMethod {
  return (ALLOCATION_METHODS as readonly string[]).includes(value);
}

/* ────────── formatting ────────── */

const NBSP = "\u00A0";

function groupInteger(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const digits = String(Math.abs(rounded));
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}`;
}

/**
 * Format a vendor score (a 0..100 float from the AI ranking engine)
 * to two decimals, e.g. `0.85` → `"0.85"`. Stable for negative
 * scores too — the engine should not emit them but a malformed
 * payload is rendered rather than thrown.
 */
export function formatVendorScore(score: number): string {
  if (!Number.isFinite(score)) return "0.00";
  return score.toFixed(2);
}

/**
 * Format a price with Armenian number grouping (`1 200 000`) and a
 * trailing currency suffix. The currency is uppercased and slotted
 * in after a space so the result reads `1 200 000 AMD`. Non-finite
 * values fall back to "—" so a malformed payload doesn't throw in
 * the renderer.
 */
export function formatPrice(price: number, currency: string): string {
  if (!Number.isFinite(price)) return "—";
  const ccy = (currency || "").toUpperCase();
  const suffix = ccy.length > 0 ? ` ${ccy}` : "";
  return `${groupInteger(price)}${suffix}`;
}

/* ────────── deep-linking helpers (tab ↔ URL hash) ────────── */

/**
 * Map a URL hash fragment to a procurement tab. The hash is the bare
 * tab name without a leading `#` (TanStack Router normalises
 * location.hash before this is called). Unknown values fall back to
 * the default `requisitions` tab.
 */
export function procurementTabFromHash(hash: string): ProcurementTab {
  const normalized = (hash ?? "").replace(/^#/, "").trim();
  if ((PROCUREMENT_TABS as readonly string[]).includes(normalized)) {
    return normalized as ProcurementTab;
  }
  return "requisitions";
}

/**
 * Inverse of `procurementTabFromHash`. Returns the hash fragment
 * (with leading `#`) used by the route to deep-link a tab.
 */
export function procurementTabToHash(tab: ProcurementTab): string {
  return `#${tab}`;
}

/* ────────── input validation ────────── */

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Guard for the requisition create form. Runs client-side before
 * POST so the user gets immediate feedback; the server re-validates.
 *
 * Rules:
 *  - `neededBy` is required and must be a `YYYY-MM-DD` string.
 *  - `justification` is optional; if present, must be ≤ 500 chars
 *    (the schema-level cap on the server).
 *
 * Returns `{ ok: true }` on success, `{ ok: false, reason }` on
 * failure with an Armenian-first message that the form can render
 * directly. Mirrors `validateCabinetCreateRequest` style from
 * `forms/status.ts`.
 */
export function validateRequisitionInput(input: {
  neededBy: string;
  justification?: string;
}): { ok: boolean; reason?: string } {
  if (typeof input.neededBy !== "string" || !YYYY_MM_DD.test(input.neededBy)) {
    return { ok: false, reason: "Պահանջվող ժամկետը պետք է լինի YYYY-MM-DD ձևաչափով" };
  }
  if (
    input.justification !== undefined &&
    typeof input.justification === "string" &&
    input.justification.length > 500
  ) {
    return { ok: false, reason: "Հիմնավորումը չպետք է գերազանցի 500 նիշ" };
  }
  return { ok: true };
}
