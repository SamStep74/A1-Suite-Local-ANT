/**
 * money() / numberShort() — Armenian Dram formatting.
 *
 * Locale `hy-AM` with currency `AMD`:
 *   1000     -> "1 000 ֏"        (NBSP between thousands, then symbol)
 *   1234.56  -> "1 235 ֏"        (rounded; AMD has no fractional units)
 *   0        -> "0 ֏"
 *   -500     -> "-500 ֏"
 * Compact notation appends "մլն" (million) or "հզր" (thousand).
 *
 * NOTE: The `hy-AM` locale uses U+00A0 (NBSP) as the thousands separator,
 * not a regular space — Intl.NumberFormat does this so amounts don't
 * break across lines.
 *
 * Source: web/src/finance.jsx (legacy AMD format).
 */
import { describe, expect, it } from "vitest";
import { money, numberShort } from "./money";

const NBSP = " ";

describe("money", () => {
  it("formats integer dram amounts with the AMD symbol and NBSP thousands", () => {
    expect(money(1000)).toBe(`1${NBSP}000${NBSP}֏`);
  });

  it("rounds fractional dram amounts (AMD has no decimals)", () => {
    expect(money(1234.56)).toBe(`1${NBSP}235${NBSP}֏`);
  });

  it("formats a small integer", () => {
    expect(money(42)).toBe(`42${NBSP}֏`);
  });

  it("formats zero with the dram sign", () => {
    expect(money(0)).toBe(`0${NBSP}֏`);
  });

  it("formats negative amounts with a leading minus", () => {
    expect(money(-500)).toBe(`-500${NBSP}֏`);
  });

  it("returns an em-dash for null", () => {
    expect(money(null)).toBe("—");
  });

  it("returns an em-dash for undefined", () => {
    expect(money(undefined)).toBe("—");
  });

  it("returns an em-dash for NaN", () => {
    expect(money(NaN)).toBe("—");
  });

  it("uses compact notation (մլն) when { compact: true } on a large amount", () => {
    expect(money(1_500_000, { compact: true })).toBe(`1,5${NBSP}մլն${NBSP}֏`);
  });

  it("uses compact notation (հզր) when { compact: true } on a small amount", () => {
    expect(money(1500, { compact: true })).toBe(`1,5${NBSP}հզր${NBSP}֏`);
  });

  it("compact output is shorter than the full format for the same large amount", () => {
    const full = money(2_500_000);
    const compact = money(2_500_000, { compact: true });
    expect(compact.length).toBeLessThan(full.length);
  });

  it("ignores undefined opts (defaults to full format)", () => {
    expect(money(1000, undefined)).toBe(`1${NBSP}000${NBSP}֏`);
  });

  it("ignores an empty opts object (defaults to full format)", () => {
    expect(money(1000, {})).toBe(`1${NBSP}000${NBSP}֏`);
  });
});

describe("numberShort", () => {
  it("returns an em-dash for null", () => {
    expect(numberShort(null)).toBe("—");
  });

  it("returns an em-dash for undefined", () => {
    expect(numberShort(undefined)).toBe("—");
  });

  it("returns an em-dash for NaN", () => {
    expect(numberShort(NaN)).toBe("—");
  });

  it("formats a number in compact notation (thousand range)", () => {
    expect(numberShort(1500)).toBe(`1,5${NBSP}հզր`);
  });

  it("formats a number in compact notation (million range)", () => {
    expect(numberShort(2_500_000)).toBe(`2,5${NBSP}մլն`);
  });

  it("formats a negative number in compact notation", () => {
    expect(numberShort(-1500)).toBe(`-1,5${NBSP}հզր`);
  });

  it("formats zero", () => {
    expect(numberShort(0)).toBe("0");
  });
});
