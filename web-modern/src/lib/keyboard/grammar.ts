/**
 * Keyboard — chord parsing + matching.
 *
 * A `chord` is a string of `+`-joined tokens. The grammar module
 * normalises the chord to a `ParsedChord` and provides a
 * `matches(event, parsed)` predicate that uses the parsed form
 * for cheap O(1) keydown dispatch.
 *
 * Conventions:
 *   - `mod` is a meta-modifier that resolves to Cmd on macOS and
 *     Ctrl elsewhere. `parseChord` expands it eagerly so the
 *     matching predicate can compare against concrete modifier
 *     state.
 *   - The key token is the *event.key* value (not event.code).
 *     This means we match what the user *typed*, not the physical
 *     key — e.g. "?" for shift+/, " " for space, "escape" for esc.
 *   - Modifier presence is exact: if a chord has no "shift" and
 *     the user holds shift, the chord does not match. This stops
 *     "k" firing when the user types "K" (which is shift+k).
 *   - The grammar is case-insensitive on the chord side; "MOD+K"
 *     and "mod+k" are equivalent.
 *
 * Why we don't use the W3C `KeyboardEvent.code`:
 *   `code` is layout-independent (always "KeyK") but locale-aware
 *   keyboard layouts (Armenian/Russian) would make this brittle.
 *   `event.key` is what the user sees, and matches the cheatsheet
 *   labels we render — keeping both sides on `key` removes a class
 *   of "press J, see ⓙ" surprises.
 */
import type { Modifier, ParsedChord } from "./schemas";

/** Canonicalise a `KeyboardEvent.key` into the form we use in
 *  chord strings. Lowercase, length-capped, with a small set of
 *  renaming exceptions (e.g. "Esc" → "escape"). */
export function canonicaliseKey(key: string): string {
  const k = key.length === 0 ? "" : key;
  if (k === "Esc" || k === "ESC") return "escape";
  if (k === " ") return " ";
  if (k.length === 1) return k.toLowerCase();
  return k.toLowerCase();
}

/** Whether the current platform treats "mod" as Cmd (true) or
 *  Ctrl (false). Cached on module load — a single page never
 *  changes OS mid-session. SSR-safe: defaults to `false`
 *  (Ctrl) when `navigator` is absent. */
const IS_MAC: boolean =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");

/** Expand a modifier token, mapping "mod" to the platform's
 *  primary meta-modifier. */
function expandModifier(token: string): Modifier | null {
  const t = token.trim().toLowerCase();
  if (t === "mod") return IS_MAC ? "meta" : "ctrl";
  if (t === "ctrl" || t === "meta" || t === "alt" || t === "shift") {
    return t as Modifier;
  }
  return null;
}

/** Parse a chord string into a `ParsedChord`. Throws a typed
 *  `ChordParseError` on bad input; the registry never calls
 *  this on a user-supplied value, so the error path is for
 *  development-time misconfig. */
export class ChordParseError extends Error {
  constructor(message: string, public readonly chord: string) {
    super(message);
    this.name = "ChordParseError";
  }
}

const TOKEN_RE = /^[a-z0-9?/]+$/;

export function parseChord(chord: string): ParsedChord {
  if (typeof chord !== "string" || chord.length === 0) {
    throw new ChordParseError("chord must be a non-empty string", String(chord));
  }
  const tokens = chord.split("+");
  const modifiers = new Set<Modifier>();
  let usesMod = false;
  let keyToken: string | null = null;
  for (const raw of tokens) {
    const token = raw.trim();
    if (token.length === 0) {
      throw new ChordParseError(`empty modifier in chord '${chord}'`, chord);
    }
    if (!TOKEN_RE.test(token)) {
      throw new ChordParseError(
        `invalid token '${token}' in chord '${chord}'`,
        chord,
      );
    }
    const mod = expandModifier(token);
    if (mod !== null) {
      if (keyToken !== null) {
        throw new ChordParseError(
          `modifier '${token}' must come before the key in chord '${chord}'`,
          chord,
        );
      }
      if (mod === "ctrl" || mod === "meta") usesMod = true;
      modifiers.add(mod);
      continue;
    }
    if (keyToken !== null) {
      throw new ChordParseError(
        `chord '${chord}' has more than one key token ('${keyToken}' and '${token}')`,
        chord,
      );
    }
    keyToken = token;
  }
  if (keyToken === null) {
    // No key token — every token was a modifier. We allow this for
    // platform shenanigans (e.g. "shift+shift" detectors in the
    // future) but for now we treat it as an error to keep the
    // grammar simple.
    throw new ChordParseError(
      `chord '${chord}' has no key token`,
      chord,
    );
  }
  return { key: keyToken, modifiers, usesMod };
}

/** Whether a `KeyboardEvent` matches a parsed chord. Modifier
 *  presence is exact: holding extra modifiers disqualifies the
 *  match. Caps Lock is ignored. */
export function matchesEvent(event: KeyboardEvent, parsed: ParsedChord): boolean {
  if (canonicaliseKey(event.key) !== parsed.key) return false;
  // Compare modifiers. Walk the parsed set, look up the
  // corresponding event flag, and require it to be present.
  // Then walk the *other* modifiers and require them to be
  // absent (so "k" doesn't fire when the user holds shift).
  for (const m of parsed.modifiers) {
    if (!flagFor(event, m)) return false;
  }
  // Check that no extra modifier is held. The "mod" alias has
  // already been expanded at parse time, so we just need to
  // ensure ctrl and meta are not both held when the parsed
  // chord requires neither.
  if (!parsed.modifiers.has("ctrl") && event.ctrlKey) return false;
  if (!parsed.modifiers.has("meta") && event.metaKey) return false;
  if (!parsed.modifiers.has("alt") && event.altKey) return false;
  // Printable symbols like "?" are reported as event.key="?" with
  // shiftKey=true on US keyboards. Treat the produced symbol as the
  // key contract so "?" can be registered as "?" instead of leaking
  // physical-key details into shortcut definitions.
  if (!parsed.modifiers.has("shift") && event.shiftKey && parsed.key !== "?") return false;
  return true;
}

function flagFor(event: KeyboardEvent, m: Modifier): boolean {
  switch (m) {
    case "ctrl":
      return event.ctrlKey;
    case "meta":
      return event.metaKey;
    case "alt":
      return event.altKey;
    case "shift":
      return event.shiftKey;
    case "none":
    case "mod":
      return false;
    default:
      return false;
  }
}

/** Render a chord as a human label, e.g. "mod+k" → "⌘K" on
 *  macOS, "Ctrl+K" elsewhere. Used by the cheatsheet. The
 *  return value is plain text (Lingui-safe when wrapped in t\`\`
 *  or Trans). */
export function shortcutLabel(chord: string): string {
  const parsed = parseChord(chord);
  const parts: string[] = [];
  if (parsed.modifiers.has("ctrl")) parts.push(IS_MAC ? "⌃" : "Ctrl");
  if (parsed.modifiers.has("meta")) parts.push("⌘");
  if (parsed.modifiers.has("alt")) parts.push(IS_MAC ? "⌥" : "Alt");
  if (parsed.modifiers.has("shift")) parts.push(IS_MAC ? "⇧" : "Shift");
  parts.push(humaniseKey(parsed.key));
  return parts.join(IS_MAC ? "" : "+");
}

function humaniseKey(key: string): string {
  if (key === " ") return "Space";
  if (key === "?") return "?";
  if (key === "escape") return IS_MAC ? "⎋" : "Esc";
  if (key === "enter") return "↵";
  if (key === "tab") return "⇥";
  if (key === "backspace") return "⌫";
  if (key === "arrowup") return "↑";
  if (key === "arrowdown") return "↓";
  if (key === "arrowleft") return "←";
  if (key === "arrowright") return "→";
  return key.toUpperCase();
}

/** Re-export so tests + the cheatsheet can branch on platform
 *  without re-implementing the detection. */
export const PLATFORM_IS_MAC = IS_MAC;
