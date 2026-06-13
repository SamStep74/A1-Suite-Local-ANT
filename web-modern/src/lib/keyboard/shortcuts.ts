/**
 * Keyboard — default keymap.
 *
 * The default keymap is the set of shortcuts that are always
 * available regardless of which route the user is on. Routes
 * (e.g. fiscal-gates, triage-inbox) register their own
 * feature-scoped entries on mount; this file only contains the
 * `global` ones plus a couple of "documents" / "ask-ai" entries
 * that are easy to demonstrate without requiring the route to
 * mount.
 *
 * Why the default keymap lives in `lib/` not `components/`:
 *   The keymap is pure data + side-effect handlers. It has no
 *   JSX, no Lingui macros, and no platform concerns other than
 *   `mod` (which the grammar module resolves). Keeping it
 *   out of the components tree means it can be unit-tested
 *   without a DOM and the route authors can import just the
 *   registrations they care about.
 *
 * NOTE: this file does NOT auto-register on import. The
 * `<KeyHandler>` component reads this map and calls
 * `registerShortcut` from a `useEffect`, so SSR is safe and
 * hot-reload doesn't double-register.
 */
import type { KeymapEntry } from "./schemas";

/** The set of always-on shortcuts. The handlers are no-ops
 *  here — the route is expected to register its own handlers
 *  for the same chord/scope and let registry's scope priority
 *  do the routing. The `description` is rendered in the
 *  cheatsheet.
 *
 *  In practice, `<KeyHandler>` registers its own entries with
 *  the actual handler implementations (open the palette,
 *  close panels, etc.), so this list is documentation-as-code:
 *  it tells the reader which chords are claimed at the global
 *  level. */
export const DEFAULT_KEYMAP: ReadonlyArray<Omit<KeymapEntry, "handler">> = [
  // ── Help ─────────────────────────────────────────────
  {
    id: "default.open-cheatsheet",
    groupId: "help",
    scope: "global",
    chord: "?",
    description: "Show keyboard shortcuts",
  },

  // ── Panels ────────────────────────────────────────────
  {
    id: "default.close-panel",
    groupId: "panels",
    scope: "global",
    chord: "escape",
    description: "Close the open panel or dialog",
  },
  {
    id: "default.open-command-palette",
    groupId: "panels",
    scope: "global",
    chord: "mod+k",
    description: "Open the command palette",
  },
  {
    id: "default.open-ask-ai",
    groupId: "panels",
    scope: "global",
    chord: "mod+i",
    description: "Open the Ask AI panel",
  },
  {
    id: "default.open-app-launcher",
    groupId: "panels",
    scope: "global",
    chord: "mod+o",
    description: "Open the app launcher",
  },

  // ── Navigation ───────────────────────────────────────
  // The "g" + (h|f|t) navigation chords are two-key sequences
  // (vim-style). The chord text only describes the *second*
  // key — the KeyHandler holds the "g is pending" state and
  // resolves the pair at dispatch time. Using a single-key
  // chord keeps `parseChord` simple (no multi-key tokens) and
  // keeps the grammar's modifier vs. key distinction clean.
  {
    id: "default.go-home",
    groupId: "navigation",
    scope: "global",
    chord: "h",
    description: "Go to the home dashboard (press g then h)",
  },
  {
    id: "default.go-finance",
    groupId: "navigation",
    scope: "global",
    chord: "f",
    description: "Go to the finance app (press g then f)",
  },
  {
    id: "default.go-triage",
    groupId: "navigation",
    scope: "global",
    chord: "t",
    description: "Go to the triage inbox (press g then t)",
  },

  // ── Lists ─────────────────────────────────────────────
  {
    id: "default.row-next",
    groupId: "lists",
    scope: "global",
    chord: "j",
    description: "Move to the next row",
  },
  {
    id: "default.row-prev",
    groupId: "lists",
    scope: "global",
    chord: "k",
    description: "Move to the previous row",
  },
  {
    id: "default.row-open",
    groupId: "lists",
    scope: "global",
    chord: "enter",
    description: "Open the focused row",
  },

  // ── Actions ───────────────────────────────────────────
  {
    id: "default.search",
    groupId: "actions",
    scope: "global",
    chord: "mod+/",
    description: "Focus the search input",
  },
];

/** Group labels in cheatsheet display order. The cheatsheet
 *  iterates this list and groups the matching entries. */
export const CHEATSHEET_GROUP_ORDER: ReadonlyArray<
  "help" | "panels" | "navigation" | "lists" | "actions" | "wizard"
> = ["help", "panels", "navigation", "lists", "actions", "wizard"];
