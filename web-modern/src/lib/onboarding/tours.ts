/**
 * tours — the 5 default first-run tours.
 *
 * Tour catalog (Phase 10.5 W7, "onboarding"):
 *   1. fiscal-gates  → 3 steps · r1 W1 surface (in ant/main)
 *   2. triage-inbox  → 3 steps · r1 W2 surface (in ant/main)
 *   3. ask-ai        → 2 steps · r1 W3 surface (in ant/main)
 *   4. documents     → 4 steps · r2 W5 surface (deferred)
 *   5. settings      → 2 steps · r2 W6 surface (deferred)
 *
 * Why `deferred: true` for the W5 / W6 tours:
 *   The plan documents W5 / W6 as pre-reqs for these two tours.
 *   The worktrees for those workers exist but are "not started"
 *   at the time of W7's dispatch. Shipping the tour definitions
 *   (not just the surface code) is the right move:
 *     - The launcher menu still lists all 5 tours so the user
 *       knows they exist.
 *     - The body copy explicitly says "ships in 10.5 r2" so the
 *       user isn't surprised by a 404.
 *     - When W5 / W6 land, flipping `deferred` to `false` is a
 *       one-line change; no schema work, no overlay rework.
 *   This matches the W4 pattern (period-close-checklist shipped
 *   the surface in r1 and wired the inline action bar in r2).
 *
 * i18n:
 *   Every `title` and `body` is wrapped in `t({ message: ... })`
 *   so the Lingui extractor picks it up. The catalog's stored
 *   "source text" is the English-ish fallback; ru / hy translation
 *   is the 10.5-translation-pass worker's job.
 *
 * Why inline `t({ message: "..." })` calls (not a helper):
 *   The Lingui babel plugin statically scans macro call sites for
 *   the string literal. Wrapping the macro in a helper function
 *   (e.g. `const txt = (s) => t({ message: s })`) breaks the
 *   AST analysis and the extractor throws. Every other call site
 *   in the codebase inlines the literal — we follow suit.
 */
import { t } from "@lingui/core/macro";
import { tours as toursSchema, type Tour, type Tours } from "./schemas";

const RAW_TOURS: ReadonlyArray<Tour> = [
  {
    id: "fiscal-gates",
    feature: t({ message: "Fiscal gates" }),
    goal: t({ message: "Mark a gate as filed" }),
    icon: "Receipt",
    deferred: false,
    steps: [
      {
        kind: "navigate",
        routePath: "/app/fiscal-gates",
        title: t({ message: "Open Fiscal gates" }),
        body: t({
          message:
            "Fiscal gates is the per-period tax-action list. Click below to land on the workspace.",
        }),
      },
      {
        kind: "navigate",
        routePath: "/app/fiscal-gates",
        title: t({ message: "Select an overdue gate" }),
        body: t({
          message:
            "Use the row checkbox to pick a gate from the 'All overdue' saved view. The bulk action bar appears at the bottom.",
        }),
      },
      {
        kind: "navigate",
        routePath: "/app/fiscal-gates",
        title: t({ message: "Click 'Mark filed'" }),
        body: t({
          message:
            "Press the Mark filed button in the bulk bar. The gate moves to Filed and a 5-second Undo toast lets you revert.",
        }),
      },
    ],
  },
  {
    id: "triage-inbox",
    feature: t({ message: "Triage inbox" }),
    goal: t({ message: "Resolve an overdue item" }),
    icon: "Inbox",
    deferred: false,
    steps: [
      {
        kind: "navigate",
        routePath: "/app/triage-inbox",
        title: t({ message: "Open Triage inbox" }),
        body: t({
          message:
            "Triage inbox is the cross-feature work queue. Click below to land on the workspace.",
        }),
      },
      {
        kind: "navigate",
        routePath: "/app/triage-inbox",
        title: t({ message: "Click an overdue row" }),
        body: t({
          message:
            "Pick the first overdue row. The peek panel slides in from the right with the entity detail.",
        }),
      },
      {
        kind: "navigate",
        routePath: "/app/triage-inbox",
        title: t({ message: "Mark resolved" }),
        body: t({
          message:
            "Press Mark resolved in the peek panel. The item leaves the overdue view; a 5-second Undo toast lets you revert.",
        }),
      },
    ],
  },
  {
    id: "ask-ai",
    feature: t({ message: "Ask AI" }),
    goal: t({ message: "Ask a question" }),
    icon: "Sparkles",
    deferred: false,
    steps: [
      {
        kind: "navigate",
        routePath: "/app/finance",
        title: t({ message: "Open any app route" }),
        body: t({
          message:
            "Ask AI works from anywhere in /app/*. Land on the finance workspace for this tour.",
        }),
      },
      {
        kind: "navigate",
        routePath: "/app/finance",
        title: t({ message: "Open Ask AI and submit a question" }),
        body: t({
          message:
            "Click the Sparkles button in the Topbar (or press its shortcut). Type a question and press Submit. Citations appear under the answer.",
        }),
      },
    ],
  },
  {
    id: "documents",
    feature: t({ message: "Documents" }),
    goal: t({ message: "Create an invoice" }),
    icon: "FileText",
    deferred: true,
    steps: [
      {
        kind: "navigate",
        routePath: "/app/documents/invoice-create",
        title: t({ message: "Open invoice-create" }),
        body: t({
          message:
            "The invoice-create wizard is a 4-step stepper. The full wizard ships in 10.5 r2 W5; this tour is a preview.",
        }),
      },
      {
        kind: "info",
        title: t({ message: "Step 1: Counterparty" }),
        body: t({ message: "Pick the customer (or supplier) the invoice is for." }),
      },
      {
        kind: "info",
        title: t({ message: "Step 2: Line items" }),
        body: t({
          message: "Add the SKU / service lines, quantity, and unit price.",
        }),
      },
      {
        kind: "info",
        title: t({ message: "Step 3: Tax + dates" }),
        body: t({
          message: "Pick the VAT rate, issue date, and due date. Preview updates live.",
        }),
      },
      {
        kind: "info",
        title: t({ message: "Step 4: Review + submit" }),
        body: t({
          message: "Confirm the totals, then click Issue to post the invoice to the ledger.",
        }),
      },
    ],
  },
  {
    id: "settings",
    feature: t({ message: "Settings" }),
    goal: t({ message: "Switch locale" }),
    icon: "Settings",
    deferred: true,
    steps: [
      {
        kind: "navigate",
        routePath: "/app",
        title: t({ message: "Press ⌘K to open the cheatsheet" }),
        body: t({
          message:
            "The keyboard cheatsheet (10.5 r2 W6) lists every shortcut. Use the locale switcher in the Topbar to pick РУ.",
        }),
      },
      {
        kind: "navigate",
        routePath: "/app",
        title: t({ message: "Pick РУ in the locale switcher" }),
        body: t({
          message:
            "The dev-only locale switcher is in the Topbar (right side). Press РУ to switch to Russian.",
        }),
      },
    ],
  },
];

/** Parsed-and-validated tour catalog. Throws at module load if a
 *  tour definition drifts from the schema — the dev server hot
 *  reload will catch typos before they reach production. */
export const DEFAULT_TOURS: Tours = toursSchema.parse(RAW_TOURS);

/** Map for O(1) lookup in the launcher's "Start" action. */
export const DEFAULT_TOURS_BY_ID: Readonly<Record<string, Tour>> =
  DEFAULT_TOURS.reduce<Record<string, Tour>>((acc, tour) => {
    acc[tour.id] = tour;
    return acc;
  }, {});

/** All tour ids in the same order as DEFAULT_TOURS. Used by
 *  `readAllDone` to walk localStorage in one pass. */
export const ALL_TOUR_IDS: ReadonlyArray<string> = DEFAULT_TOURS.map((t) => t.id);
