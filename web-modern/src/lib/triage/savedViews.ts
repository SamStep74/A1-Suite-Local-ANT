/**
 * Triage Inbox — default saved views.
 *
 * The inbox ships with three named default views that every
 * user sees on first load (and that the e2e test asserts on):
 *
 *   1. My queue       — status=open, assignee=me. The default
 *                       landing view; what most users want first.
 *   2. Overdue        — status=open, source=invoice, query="overdue"
 *                       (we let the fixture signal it; the view
 *                       is filter-only, not date-driven yet).
 *   3. Awaiting       — status=open, source=approval, query=awaiting
 *                       customer / approval.
 *
 * These are stored in the same `savedViewsStore` as user-saved
 * views. The seeding is one-shot: if the user deletes a default,
 * it stays deleted. The seeding is keyed off an empty store —
 * a non-empty store means the user (or a prior session) has
 * already touched views, so we don't trample them.
 *
 * The names are returned as `MessageDescriptor`-shaped objects
 * (id + values) so the route can wrap them in `<Trans>` to
 * feed the Lingui catalog. The route never re-translates them
 * — only the i18n pipeline does.
 */
import { loadViews, saveView, type SavedView, type SavedViewState } from "../components/savedViewsStore";
import type { TriageViewFilter } from "./schemas";

/**
 * The literal id used as the DataTable's `tableId` for the
 * triage inbox. Both this module and the route use the same
 * constant so seeding and rendering agree on the storage key.
 */
export const TRIAGE_TABLE_ID = "triage-inbox";

/** Names of the three default views. Used as the row labels in
 *  the SavedViews dropdown. We use plain English here; the
 *  route wraps each in `<Trans>` so the catalog can localize. */
export const TRIAGE_DEFAULT_VIEW_IDS = {
  myQueue: "triage-default-my-queue",
  overdue: "triage-default-overdue",
  awaiting: "triage-default-awaiting",
} as const;

/** A default view = (id, labelKey, filter). */
export interface TriageDefaultView {
  id: string;
  /** Source-locale label; the route wraps this in <Trans>. */
  label: string;
  filter: TriageViewFilter;
}

export const TRIAGE_DEFAULT_VIEWS: ReadonlyArray<TriageDefaultView> = [
  {
    id: TRIAGE_DEFAULT_VIEW_IDS.myQueue,
    label: "My queue",
    filter: { statusIn: ["open"], assigneeMatch: "me" },
  },
  {
    id: TRIAGE_DEFAULT_VIEW_IDS.overdue,
    label: "Overdue",
    filter: { statusIn: ["open"], sourceIn: ["invoice"], query: "overdue" },
  },
  {
    id: TRIAGE_DEFAULT_VIEW_IDS.awaiting,
    label: "Awaiting customer",
    filter: { statusIn: ["open"], sourceIn: ["customer-reply", "approval"] },
  },
];

/**
 * Convert a `TriageViewFilter` into the `SavedViewState` shape
 * that the `savedViewsStore` round-trips. The store treats
 * `state` as opaque, so we stuff the filter into a single
 * string field (the store's `filter` is `string`, not the
 * richer triage shape). This keeps the store generic — when
 * 10.5 grows a second view surface (e.g. fiscal-gates), it
 * uses the same store and we don't fork the schema.
 *
 * The route reads `state.filter` back out and parses it as
 * JSON to recover the `TriageViewFilter`.
 */
export const encodeTriageFilter = (filter: TriageViewFilter): SavedViewState => ({
  sort: null,
  filter: JSON.stringify(filter),
  page: 0,
  pageSize: 25,
  columns: [],
});

/** Reverse of `encodeTriageFilter`. Tolerant of malformed JSON
 *  — returns an empty filter rather than throwing, so a
 *  corrupt localStorage entry never bricks the inbox. */
export const decodeTriageFilter = (state: SavedViewState): TriageViewFilter => {
  try {
    const parsed: unknown = JSON.parse(state.filter);
    if (parsed && typeof parsed === "object") {
      return parsed as TriageViewFilter;
    }
  } catch {
    // Fall through.
  }
  return {};
};

/**
 * Seed the saved-views store with the three default views if
 * and only if the user has never saved anything for this
 * tableId. Idempotent: calling it twice is a no-op the second
 * time.
 *
 * Returns the post-seed view list so the caller can pass it
 * straight into the SavedViews component on first mount.
 */
export function seedDefaultTriageViews(): SavedView[] {
  const existing = loadViews(TRIAGE_TABLE_ID);
  if (existing.length > 0) return existing;
  for (const v of TRIAGE_DEFAULT_VIEWS) {
    saveView(TRIAGE_TABLE_ID, v.label, encodeTriageFilter(v.filter));
  }
  return loadViews(TRIAGE_TABLE_ID);
}
