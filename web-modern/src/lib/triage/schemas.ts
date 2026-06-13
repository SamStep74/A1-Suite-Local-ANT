/**
 * Triage Inbox — Zod schemas for the cross-feature work queue.
 *
 * A `TriageItem` is a row in the unified inbox that surfaces
 * "things needing my attention" from across the app: overdue
 * invoices, unfiled tax gates, pending approvals, customer
 * replies, etc. Each item carries a `source` (which app produced
 * it) and a `status` (the lifecycle of the row in the inbox).
 *
 * This module is pure data — no React, no I/O, no localStorage.
 * The feed (`feed.ts`) reads from a fixture and validates each
 * row with `TriageItemSchema`. The route reads from the feed and
 * uses the Zod-inferred types for its TanStack Table columns.
 *
 * Why one big `source` union and not per-source schemas:
 *   Different sources contribute different fields (a `tax-gate`
 *   has a `period`, a `customer-reply` has a `threadId`). We
 *   could model those as a discriminated union, but the inbox
 *   surface only needs a flat view: every row has the 6 columns
 *   the table shows, plus an opaque `payload` object that
 *   `renderContent` can switch on if it cares.
 *
 * Stays compatible with Lingui: this file is data-only and has
 * no user-facing strings. The `Trans`/`t` macros never appear
 * here; the .po catalog extracts from the route + feed UI.
 */
import { z } from "zod";

/**
 * Lifecycle of a triage row in the inbox.
 *
 *  - `open`       : needs attention, default state.
 *  - `snoozed`    : user pushed it back (visible when filtering).
 *  - `resolved`   : user marked done (or system did). Renders
 *                   struck through. Hidden in the default view.
 *  - `assigned`   : user assigned it to a teammate. Still visible
 *                   in "My queue" only if the assignee is me.
 */
export const TriageStatusSchema = z.enum([
  "open",
  "snoozed",
  "resolved",
  "assigned",
]);
export type TriageStatus = z.infer<typeof TriageStatusSchema>;

/**
 * Origin system. Drives the source-icon column + the deep-link
 * target. New sources slot in here; the route maps each to an
 * icon (lucide) and a route prefix.
 */
export const TriageSourceSchema = z.enum([
  "invoice",
  "tax-gate",
  "approval",
  "customer-reply",
  "fleet",
  "purchase",
]);
export type TriageSource = z.infer<typeof TriageSourceSchema>;

/** A triage row — a single work item in the inbox. */
export const TriageItemSchema = z.object({
  /** Stable, opaque id (used as DataTable row id + PeekPanel key). */
  id: z.string().min(1),
  /** Where it came from. */
  source: TriageSourceSchema,
  /** Lifecycle. */
  status: TriageStatusSchema,
  /** Short headline (≤120 chars). Goes in the "Title" column. */
  title: z.string().min(1).max(200),
  /** Free-form subtitle (≤300 chars). Goes in the "Detail" column. */
  subtitle: z.string().max(400).default(""),
  /**
   * Whole-amount (in the workspace's base currency). Optional
   * because not every triage item has a number (e.g. a customer
   * reply doesn't). When present, formatted as currency in the
   * "Amount" column.
   */
  amount: z.number().nullable().default(null),
  /**
   * ISO-8601 timestamp the item was raised. Drives the
   * "Raised" column. The route uses date-fns to format it
   * relatively (e.g. "2h ago").
   */
  raisedAt: z.string().min(1),
  /**
   * Display name of the user the item is assigned to. Empty
   * string = unassigned. The "Owner" column is a string match
   * so views like "My queue" can filter on it.
   */
  assignee: z.string().default(""),
  /**
   * Per-source opaque payload. The route's `renderContent` can
   * switch on `source` to render the right detail body. The
   * shape is intentionally `Record<string, unknown>` — the
   * strict shape is the source module's responsibility, not
   * the inbox's.
   */
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type TriageItem = z.infer<typeof TriageItemSchema>;

/**
 * The full feed (paginated envelope). Mirrors the
 * `ApiResponse<T>` shape in `lib/patterns.md` for downstream
 * consistency, but the inbox today always loads the full set
 * (it's small, <500 rows).
 */
export const TriageFeedSchema = z.object({
  items: z.array(TriageItemSchema),
  /** ISO timestamp the snapshot was generated; for cache-bust UI. */
  generatedAt: z.string().min(1),
});
export type TriageFeed = z.infer<typeof TriageFeedSchema>;

/**
 * A filter predicate for the inbox's saved views. The route
 * builds these from the user's saved-view snapshot, then
 * `feed.applyView` (or the route's `useMemo`) runs them client
 * side. Each function returns true to KEEP the row.
 *
 * Stored as plain string unions in the snapshot so they
 * round-trip through `JSON.stringify` / `localStorage`.
 */
export interface TriageViewFilter {
  /** Status whitelist; empty = all. */
  statusIn?: ReadonlyArray<TriageStatus>;
  /** Source whitelist; empty = all. */
  sourceIn?: ReadonlyArray<TriageSource>;
  /** Free-text contains (matches title + subtitle, case-insensitive). */
  query?: string;
  /** Substring match on `assignee`; empty = all. */
  assigneeMatch?: string;
}

export const TriageViewFilterSchema = z.object({
  statusIn: z.array(TriageStatusSchema).optional(),
  sourceIn: z.array(TriageSourceSchema).optional(),
  query: z.string().optional(),
  assigneeMatch: z.string().optional(),
}) satisfies z.ZodType<TriageViewFilter>;
