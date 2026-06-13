/**
 * Keyboard — Zod schemas for the cross-feature keymap grammar.
 *
 * A `KeymapEntry` is the unit of registration: a chord (a single
 * key, optionally modified), a feature scope, a `groupId` for the
 * cheatsheet, and a `handler` that runs when the chord fires.
 *
 * Design notes:
 *   - Keys are normalised to lowercase + canonical form (" " for
 *     space, "escape" for esc, "?" for the shift-/ chord). The
 *     grammar module owns the transformation; everything else
 *     sees the canonical string.
 *   - `mod` is a meta-modifier that resolves to Cmd on macOS and
 *     Ctrl elsewhere. The cheatsheet renders the platform-correct
 *     glyph (⌘ vs Ctrl) — see `grammar.shortcutLabel`.
 *   - `scope` is a coarse feature tag ("global", "command-palette",
 *     "fiscal-gates", etc.). The registry matches on the *innermost*
 *     scope first so a route-level "j" overrides the global one
 *     while a chord is mounted on a fiscal-gates table.
 *   - `chord` deliberately does NOT include a "when" predicate;
 *     route authors that need a contextual shortcut should call
 *     `registerShortcut` from inside a `useEffect` tied to the
 *     feature state, so cleanup is automatic.
 *
 * This file is data-only. The runtime lives in `registry.ts` and
 * the parsing lives in `grammar.ts`.
 */
import { z } from "zod";

/** Coarse feature scope. Routes register shortcuts under one of
 *  these; the registry walks the scope chain on every keydown. */
export const FeatureScopeSchema = z.enum([
  "global",
  "command-palette",
  "fiscal-gates",
  "triage-inbox",
  "documents",
  "ask-ai",
]);
export type FeatureScope = z.infer<typeof FeatureScopeSchema>;

/** A modifier token. `mod` is the meta-modifier — Cmd on macOS,
 *  Ctrl elsewhere. `none` is the empty modifier set (bare keys). */
export const ModifierSchema = z.enum([
  "none",
  "mod",
  "ctrl",
  "meta",
  "alt",
  "shift",
]);
export type Modifier = z.infer<typeof ModifierSchema>;

/**
 * The grammatical shape of a single chord. Examples:
 *   "?"                     (shift+/)
 *   "mod+k"                 (Cmd/Ctrl + k)
 *   "escape"                (bare esc)
 *   "shift+arrowdown"       (shift + down-arrow)
 *
 * The grammar module (`grammar.ts`) owns the canonicalisation;
 * the schema only requires a structurally valid string. The
 * regex forbids uppercase + spaces (the canonical form is always
 * lowercase, joined by `+`).
 */
export const ChordSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9?]+(\+[a-z0-9?]+)*$/, {
    message:
      "chord must be lowercase tokens joined by '+' (e.g. 'mod+k', '?', 'shift+arrowdown')",
  });
export type Chord = z.infer<typeof ChordSchema>;

/** A registered keymap entry. The handler is intentionally typed
 *  loosely — the registry validates that handlers are pure
 *  side-effect functions and never throws. The signature
 *  `(e: KeyboardEvent) => void` matches what the registry will
 *  call on the way through. */
export interface KeymapEntry {
  /** Unique within a (scope, chord) pair. Used to disambiguate
   *  multiple handlers on the same chord. Defaults to "default". */
  id: string;
  /** Where this entry belongs in the cheatsheet. */
  groupId: ShortcutGroupId;
  /** What the shortcut does — user-facing short label. */
  description: string;
  /** Scope. The innermost matching scope wins. */
  scope: FeatureScope;
  /** Chord text. */
  chord: Chord;
  /** What to do when the chord fires. Must not throw. */
  handler: (event: KeyboardEvent) => void;
  /** When true, the shortcut is registered but inactive (skipped
   *  during dispatch). Useful for "I want to display this in the
   *  cheatsheet but it isn't wired up yet." Defaults to false. */
  enabled?: boolean;
}

/** A group label for the cheatsheet. The string is a stable id
 *  used for keys + i18n lookups; the cheatsheet renders the
 *  matching Trans macro. */
export const ShortcutGroupIdSchema = z.enum([
  "navigation",
  "actions",
  "wizard",
  "lists",
  "panels",
  "help",
]);
export type ShortcutGroupId = z.infer<typeof ShortcutGroupIdSchema>;

/** Zod schema for KeymapEntry minus the handler function. Use
 *  this if you need to validate a keymap config from JSON
 *  (e.g. user-defined shortcut overlays — not in this phase). */
export const KeymapEntryBaseSchema = z.object({
  id: z.string().min(1),
  groupId: ShortcutGroupIdSchema,
  description: z.string().min(1).max(200),
  scope: FeatureScopeSchema,
  chord: ChordSchema,
  enabled: z.boolean().optional(),
}) satisfies z.ZodType<Omit<KeymapEntry, "handler">>;

/** A parsed chord — ready for matching against a KeyboardEvent. */
export interface ParsedChord {
  /** Lower-cased key token (e.g. "k", "?", "arrowdown"). */
  key: string;
  /** Normalised modifier set, in canonical order. */
  modifiers: ReadonlySet<Modifier>;
  /** True if this is a meta-modifier chord (depends on platform). */
  usesMod: boolean;
}
