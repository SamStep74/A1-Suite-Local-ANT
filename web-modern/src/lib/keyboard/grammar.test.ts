/**
 * Keyboard — grammar unit tests.
 *
 * Pins the contract for `parseChord`, `matchesEvent`, and
 * `shortcutLabel`. The registry has its own test file; this one
 * covers pure-function logic only.
 */
import { describe, it, expect } from "vitest";
import {
  ChordParseError,
  canonicaliseKey,
  matchesEvent,
  parseChord,
  shortcutLabel,
} from "./grammar";

describe("canonicaliseKey", () => {
  it("lowercases single chars and 'Esc'", () => {
    expect(canonicaliseKey("K")).toBe("k");
    expect(canonicaliseKey("Esc")).toBe("escape");
    expect(canonicaliseKey(" ")).toBe(" ");
    expect(canonicaliseKey("?")).toBe("?");
  });
});

describe("parseChord", () => {
  it("parses a bare key", () => {
    const p = parseChord("k");
    expect(p.key).toBe("k");
    expect(p.modifiers.size).toBe(0);
  });

  it("parses a single modifier + key", () => {
    const p = parseChord("mod+k");
    expect(p.key).toBe("k");
    expect(p.modifiers.has("ctrl") || p.modifiers.has("meta")).toBe(true);
  });

  it("parses shift+? (the cheatsheet chord)", () => {
    const p = parseChord("shift+?");
    expect(p.key).toBe("?");
    expect(p.modifiers.has("shift")).toBe(true);
  });

  it("rejects two-key navigation chords like g+h (these are stateful, not parsed)", () => {
    // g+h is a vim-style two-key sequence. The KeyHandler
    // owns the "g is pending" state and registers the second
    // key as a single-key chord (just "h"). The grammar
    // therefore does NOT accept multi-key sequences — the
    // stateful pair is constructed in the handler, not the
    // chord string.
    expect(() => parseChord("g+h")).toThrow(ChordParseError);
  });

  it("rejects empty chords", () => {
    expect(() => parseChord("")).toThrow(ChordParseError);
  });

  it("rejects chords with a trailing modifier and no key", () => {
    expect(() => parseChord("mod+")).toThrow(ChordParseError);
  });

  it("rejects chords with two key tokens", () => {
    expect(() => parseChord("k+j")).toThrow(ChordParseError);
  });

  it("rejects uppercase tokens (canonicalise at parse time)", () => {
    expect(() => parseChord("MOD+K")).toThrow(ChordParseError);
  });
});

describe("matchesEvent", () => {
  it("matches a bare 'j' against a plain keydown", () => {
    const parsed = parseChord("j");
    const ev = new KeyboardEvent("keydown", { key: "j" });
    expect(matchesEvent(ev, parsed)).toBe(true);
  });

  it("does NOT match 'j' when the user is holding shift", () => {
    const parsed = parseChord("j");
    const ev = new KeyboardEvent("keydown", { key: "J", shiftKey: true });
    expect(matchesEvent(ev, parsed)).toBe(false);
  });

  it("matches 'shift+?' when shift is held and key is '?'", () => {
    const parsed = parseChord("shift+?");
    const ev = new KeyboardEvent("keydown", { key: "?", shiftKey: true });
    expect(matchesEvent(ev, parsed)).toBe(true);
  });

  it("does not match a different key", () => {
    const parsed = parseChord("k");
    const ev = new KeyboardEvent("keydown", { key: "j" });
    expect(matchesEvent(ev, parsed)).toBe(false);
  });
});

describe("shortcutLabel", () => {
  it("renders a bare key uppercased", () => {
    expect(shortcutLabel("j")).toBe("J");
  });

  it("renders ? literally", () => {
    expect(shortcutLabel("?")).toBe("?");
  });

  it("renders escape with a glyph (platform-conditional)", () => {
    const label = shortcutLabel("escape");
    expect(["⎋", "Esc"]).toContain(label);
  });
});
