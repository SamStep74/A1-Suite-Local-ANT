/**
 * money() — format Armenian Dram amounts the way the legacy app does.
 * Source: web/src/finance.jsx uses `Intl.NumberFormat("hy-AM", { style: "currency", currency: "AMD" })`.
 * AMD is a no-decimal currency; we drop the trailing .00 to match the legacy UX.
 */
const amdCompact = new Intl.NumberFormat("hy-AM", {
  style: "currency",
  currency: "AMD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const NBSP = "\u00A0";

function groupInteger(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const digits = String(Math.abs(rounded));
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}`;
}

export function money(amount: number | null | undefined, opts?: { compact?: boolean }): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  return opts?.compact ? amdCompact.format(amount) : `${groupInteger(amount)}${NBSP}֏`;
}

/**
 * numberShort — for KPI deltas ("+1,234", "−560"). Localized but not currency.
 */
const nShort = new Intl.NumberFormat("hy-AM", { notation: "compact", maximumFractionDigits: 1 });

export function numberShort(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return nShort.format(n);
}
