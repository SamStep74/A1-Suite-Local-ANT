/**
 * Triage Inbox — feed aggregator.
 *
 * Reads a static fixture (a TS module that exports an array of
 * untyped rows), validates each row through `TriageItemSchema`,
 * and returns the validated feed. There is NO real backend
 * wiring yet — the inbox ships in 10.5 with a typed fixture so
 * the UI is reviewable end-to-end. The 10.6 wiring pass will
 * swap the loader for a real `getJson` fetch against the Fastify
 * server.
 *
 * Pure module: no React, no I/O, no localStorage. The route
 * imports `loadTriageFeed()` and the e2e test imports it
 * directly to assert on row counts and ids.
 *
 * The fixture deliberately spans every source + every status so
 * the inbox has something to render in dev without us having to
 * seed 4 separate views. The fixture ids are stable strings so
 * the e2e test can pin specific rows.
 */
import { TriageFeedSchema, type TriageFeed, type TriageItem, type TriageViewFilter } from "./schemas";

/**
 * The raw, unvalidated fixture. Lives in this module (not a
 * separate `.json`) so we can use TypeScript narrowing on
 * import-side, and so the file count stays small (the plan
 * only asks for `feed.ts`).
 *
 * Dates are computed at module load via `relativeIso` so the
 * "Raised" column shows plausible relative timestamps during
 * dev without us having to bump the fixture every few weeks.
 */
const minutesAgo = (m: number): string =>
  new Date(Date.now() - m * 60_000).toISOString();
const hoursAgo = (h: number): string => minutesAgo(h * 60);
const daysAgo = (d: number): string => minutesAgo(d * 60 * 24);

const RAW_FIXTURE: ReadonlyArray<Omit<TriageItem, never>> = [
  {
    id: "inv-1042-overdue",
    source: "invoice",
    status: "open",
    title: "Invoice #1042 — 18 days overdue",
    subtitle: "Acme Logistics LLC · 240,000 AMD",
    amount: 240000,
    raisedAt: daysAgo(18),
    assignee: "me",
    payload: { invoiceId: 1042, customer: "Acme Logistics LLC" },
  },
  {
    id: "inv-1051-due-soon",
    source: "invoice",
    status: "open",
    title: "Invoice #1051 — due in 3 days",
    subtitle: "Northwind Trading · 85,000 AMD",
    amount: 85000,
    raisedAt: daysAgo(27),
    assignee: "",
    payload: { invoiceId: 1051, customer: "Northwind Trading" },
  },
  {
    id: "tg-2026-q1-vat",
    source: "tax-gate",
    status: "open",
    title: "Q1 2026 VAT return — unfiled",
    subtitle: "Period 2026-01-01 → 2026-03-31 · due 2026-04-25",
    amount: 0,
    raisedAt: daysAgo(3),
    assignee: "me",
    payload: { period: "2026-Q1", gateKind: "vat-return" },
  },
  {
    id: "tg-2026-q1-pit",
    source: "tax-gate",
    status: "assigned",
    title: "Q1 2026 PIT withholding",
    subtitle: "Assigned to A. Sargsyan · due 2026-04-30",
    amount: 0,
    raisedAt: daysAgo(5),
    assignee: "a.sargsyan",
    payload: { period: "2026-Q1", gateKind: "pit-withholding" },
  },
  {
    id: "ap-22-quote-approval",
    source: "approval",
    status: "open",
    title: "Quote Q-2026-0077 awaiting approval",
    subtitle: "Customer: Sevan Office Supplies · 1.2M AMD",
    amount: 1200000,
    raisedAt: hoursAgo(6),
    assignee: "me",
    payload: { quoteId: "Q-2026-0077" },
  },
  {
    id: "ap-23-po-approval",
    source: "approval",
    status: "snoozed",
    title: "PO #PO-9931 awaiting approval",
    subtitle: "Vendor: Office Hub · 420k AMD · snoozed until Mon",
    amount: 420000,
    raisedAt: daysAgo(1),
    assignee: "me",
    payload: { poId: "PO-9931" },
  },
  {
    id: "cr-thread-118",
    source: "customer-reply",
    status: "open",
    title: "Re: Order status — Ararat Wines",
    subtitle: "Customer asked about shipment #SHP-3381",
    amount: null,
    raisedAt: hoursAgo(2),
    assignee: "",
    payload: { threadId: 118, customer: "Ararat Wines" },
  },
  {
    id: "fleet-trip-884",
    source: "fleet",
    status: "open",
    title: "Trip #884 — cold-chain temperature alert",
    subtitle: "Reefer #R-12 · +6.4°C for 14 minutes",
    amount: null,
    raisedAt: minutesAgo(45),
    assignee: "dispatch",
    payload: { tripId: 884, reeferId: "R-12" },
  },
  {
    id: "po-gr-557",
    source: "purchase",
    status: "open",
    title: "Goods receipt #GR-557 — 3 items short",
    subtitle: "PO #PO-8821 · Office Hub · 3 of 12 received",
    amount: null,
    raisedAt: daysAgo(2),
    assignee: "me",
    payload: { grId: "GR-557", poId: "PO-8821" },
  },
  {
    id: "inv-1033-resolved",
    source: "invoice",
    status: "resolved",
    title: "Invoice #1033 — paid in full",
    subtitle: "Closed by system 4 days ago",
    amount: 320000,
    raisedAt: daysAgo(11),
    assignee: "system",
    payload: { invoiceId: 1033 },
  },
];

/** Internal: the validated, immutable feed. */
let cachedFeed: TriageFeed | null = null;

/**
 * Load the triage feed from the in-memory fixture, validating
 * each row. The first call does the validation; subsequent
 * calls return the cached result. Safe to call from multiple
 * components in the same render.
 *
 * The `payload` field is intentionally loose (`Record<string,
 * unknown>`) so we don't fight fixture noise during dev.
 */
export function loadTriageFeed(): TriageFeed {
  if (cachedFeed) return cachedFeed;
  const items: TriageItem[] = [];
  for (const raw of RAW_FIXTURE) {
    const parsed = TriageFeedSchema.shape.items.element.safeParse(raw);
    if (parsed.success) items.push(parsed.data);
    // Skip-and-continue on bad rows so a typo in the fixture
    // doesn't crash the inbox. A real loader would log the
    // dropped row.
  }
  cachedFeed = {
    items,
    generatedAt: new Date().toISOString(),
  };
  return cachedFeed;
}

/**
 * Apply a saved-view filter to a feed. Pure function — the
 * route uses it inside a `useMemo` so it only recomputes when
 * the filter or feed changes.
 *
 * Filter semantics:
 *  - Empty / missing arrays match all rows.
 *  - `query` is a case-insensitive substring match on title +
 *    subtitle.
 *  - `assigneeMatch` is a case-insensitive substring match on
 *    the assignee field. The view "My queue" passes "me" so
 *    unassigned + system rows are excluded.
 */
export function applyTriageView(
  feed: TriageFeed,
  filter: TriageViewFilter,
): TriageItem[] {
  const needle = filter.query?.trim().toLowerCase() ?? "";
  const assign = filter.assigneeMatch?.trim().toLowerCase() ?? "";
  return feed.items.filter((item) => {
    if (filter.statusIn && filter.statusIn.length > 0 && !filter.statusIn.includes(item.status)) {
      return false;
    }
    if (filter.sourceIn && filter.sourceIn.length > 0 && !filter.sourceIn.includes(item.source)) {
      return false;
    }
    if (needle) {
      const hay = `${item.title} ${item.subtitle}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (assign && !item.assignee.toLowerCase().includes(assign)) {
      return false;
    }
    return true;
  });
}

/**
 * Test-only: clear the cached feed. Production code never
 * calls this — the cache is per-process and the fixture is
 * static. The test suite uses it to assert against a clean
 * state.
 */
export function __clearTriageFeedForTests(): void {
  cachedFeed = null;
}
