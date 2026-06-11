/**
 * Pure helpers for the Document Cabinet workspace.
 *
 * Source of truth: server/documentCabinetRoutes.js (the 15
 * `/api/cabinet/*` route handlers) and the Zod registry at
 * web-modern/src/lib/api/schemas.ts (the `Cabinet*` schemas).
 *
 * These helpers are UI-pure: no React, no I/O, no router. They
 * re-derive small UI affordances (status tones, Armenian-first
 * direction labels, list filtering, stable activity sorting, the
 * POST /api/cabinet/documents request payload) and shape server
 * data for rendering. Tested in isolation under jsdom.
 *
 * Public surface:
 *  - CABINET_DIRECTIONS / CABINET_STATUSES    → readonly enum arrays
 *  - buildCabinetCreate                       → UI form → API request
 *  - filterCabinetDocuments                   → direction/status/q filter
 *  - sortCabinetDocumentsByActivity           → active-first, updatedAt desc, stable
 *  - cabinetStatusTone                        → "positive" | "muted"
 *  - classifyCabinetStatus                    → "Active" | "Archived"
 *  - directionLabelArm                        → Armenian-first pill label
 *  - cabinetEmptyMessage                      → filters-aware empty-state string
 */
import type {
  CabinetCreateRequest,
  CabinetDirection,
  CabinetDocument,
  CabinetFilters,
  CabinetLinkedType,
  CabinetStatus,
} from "../api/schemas";

/* ────────── type re-exports (UI narrowing) ────────── */

export type { CabinetDirection, CabinetStatus, CabinetLinkedType };

/* ────────── enum constants ────────── */

export const CABINET_DIRECTIONS: readonly CabinetDirection[] = [
  "incoming",
  "outgoing",
  "internal",
] as const;

export const CABINET_STATUSES: readonly CabinetStatus[] = [
  "active",
  "archived",
] as const;

/* ────────── request payload builder ────────── */

function trimOrUndefined(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Build a `POST /api/cabinet/documents` request body from a UI form
 * state. Strips empty optionals so the server doesn't receive `""`
 * for fields the user left blank. The server normalizer
 * (server/documentCabinetRoutes.js#normalizeCabinetCreateBody) treats
 * empty strings as null, but sending undefined keeps the wire payload
 * small and lets Zod skip optional validation entirely.
 *
 * Throws when idempotencyKey is missing — the server requires it for
 * exactly-once semantics, and we'd rather fail loudly on the client
 * than bounce a 400 back through the optimistic mutation.
 */
export function buildCabinetCreate(input: {
  title: string;
  direction: CabinetDirection;
  docType?: string;
  linkedId?: string;
  linkedType?: CabinetLinkedType;
  body?: string;
  idempotencyKey: string;
}): CabinetCreateRequest {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
    throw new Error("idempotencyKey is required");
  }
  const out: CabinetCreateRequest = {
    title: input.title.trim(),
    direction: input.direction,
    idempotencyKey: input.idempotencyKey.trim(),
  };
  const docType = trimOrUndefined(input.docType);
  if (docType !== undefined) out.docType = docType;
  const linkedId = trimOrUndefined(input.linkedId);
  if (linkedId !== undefined) out.linkedId = linkedId;
  if (input.linkedType !== undefined) out.linkedType = input.linkedType;
  const body = trimOrUndefined(input.body);
  if (body !== undefined) out.body = body;
  return out;
}

/* ────────── filtering ────────── */

/**
 * Apply a search/direction/status filter to a list of cabinet
 * documents. Pure: never mutates the input. Empty / whitespace-only
 * `q` means "no text filter" — the input may come from a live
 * <input> and we don't want every keystroke to re-filter to nothing.
 */
export function filterCabinetDocuments(
  docs: ReadonlyArray<CabinetDocument>,
  filters: { direction?: CabinetDirection; status?: CabinetStatus; q?: string },
): CabinetDocument[] {
  const q = (filters.q ?? "").trim().toLowerCase();
  return docs.filter((d) => {
    if (filters.direction !== undefined && d.direction !== filters.direction) {
      return false;
    }
    if (filters.status !== undefined && d.status !== filters.status) {
      return false;
    }
    if (q.length > 0) {
      const title = (d.title ?? "").toLowerCase();
      if (!title.includes(q)) return false;
    }
    return true;
  });
}

/* ────────── ordering ────────── */

function updatedAtDesc(a: CabinetDocument, b: CabinetDocument): number {
  const av = a.updatedAt ?? "";
  const bv = b.updatedAt ?? "";
  if (av === bv) return 0;
  return bv.localeCompare(av);
}

/**
 * Sort cabinet documents by "activity": active rows float to the top
 * (so the operator sees in-flight work first), then within each bucket
 * the most-recently-updated first. The two-stage sort keeps the order
 * stable for equal keys (Array.prototype.sort is stable in ES2019+).
 */
export function sortCabinetDocumentsByActivity(
  docs: ReadonlyArray<CabinetDocument>,
): CabinetDocument[] {
  const bucket = (s: CabinetStatus) => (s === "active" ? 0 : 1);
  return docs
    .slice()
    .sort((a, b) => {
      const ba = bucket(a.status);
      const bb = bucket(b.status);
      if (ba !== bb) return ba - bb;
      return updatedAtDesc(a, b);
    });
}

/* ────────── classification ────────── */

export type CabinetTone = "positive" | "muted";

const STATUS_TONE: Record<CabinetStatus, CabinetTone> = {
  active: "positive",
  archived: "muted",
};

export function cabinetStatusTone(s: { status: CabinetStatus }): CabinetTone {
  return STATUS_TONE[s.status];
}

const STATUS_LABEL_EN: Record<CabinetStatus, string> = {
  active: "Active",
  archived: "Archived",
};

const STATUS_LABEL_HY: Record<CabinetStatus, string> = {
  active: "Ակտիվ",
  archived: "Արխիվացված",
};

/**
 * Human label for the status pill. Returns the English label; the
 * Armenian subtitle is exposed via `cabinetStatusLabelHy` so the UI
 * can pick. Mirrors `classifyFormStatus` (forms/status.ts).
 */
export function classifyCabinetStatus(s: { status: CabinetStatus }): string {
  return STATUS_LABEL_EN[s.status];
}

export function cabinetStatusLabelHy(s: { status: CabinetStatus }): string {
  return STATUS_LABEL_HY[s.status];
}

/* ────────── direction label (Armenian-first) ────────── */

const DIRECTION_LABEL_HY: Record<CabinetDirection, string> = {
  incoming: "Մուտքային",
  outgoing: "Ելքային",
  internal: "Ներքին",
};

const DIRECTION_LABEL_EN: Record<CabinetDirection, string> = {
  incoming: "Incoming",
  outgoing: "Outgoing",
  internal: "Internal",
};

/**
 * Direction pill label — Armenian-first. The Armenian word is the
 * primary string; the English gloss is appended in parens so the
 * pill is readable in dev / mixed-language contexts.
 */
export function directionLabelArm(d: CabinetDirection): string {
  const hy = DIRECTION_LABEL_HY[d];
  const en = DIRECTION_LABEL_EN[d];
  return `${hy} (${en})`;
}

/* ────────── empty-state messaging ────────── */

/**
 * Empty-state message when the current filter combination returns
 * zero rows. Returns a different string when `q` is set vs unset,
 * so the user gets distinct messaging for "your search returned
 * nothing" vs "no documents match this filter".
 */
export function cabinetEmptyMessage(filters: {
  direction?: CabinetDirection;
  status?: CabinetStatus;
  q?: string;
}): string {
  const q = (filters.q ?? "").trim();
  if (q.length > 0) {
    return `Ոչինչ չի գտնվել «${q}» հարցման համար`;
  }
  if (filters.status === "archived") {
    return "Արխիվացված փաստաթղթեր չկան";
  }
  if (filters.direction && filters.direction !== "internal") {
    const dirHy = DIRECTION_LABEL_HY[filters.direction];
    return `${dirHy} փաստաթղթեր չկան`;
  }
  return "Փաստաթղթեր դեռ չկան";
}

/* ────────── type-only re-export of the filter shape ────────── */

export type CabinetFilterInput = Pick<CabinetFilters, "direction" | "status" | "q">;
