// Armenian (RA) localization kernel.
//
// Reusable, dependency-free primitives that every A1 module attaches to:
//   - ՀՎՀՀ (HVHH): the Armenian taxpayer identification number, which also serves
//     as the business VAT id. Required on organizations, customers, and vendors.
//   - AMD: Armenian dram money formatting/rounding (dram has no minor unit in practice).
//
// Pure functions, offline, no I/O — safe to require from anywhere (server, scripts, tests).
// This is the localization "kernel" the operational modules (catalog, inventory,
// purchase, POS) depend on per the suite's Localization Checklist.

const AMD = Object.freeze({ code: "AMD", symbol: "֏", subunit: 0 });

// ՀՎՀՀ is exactly 8 numeric digits: 7 serial + 1 check digit. The official
// check-digit algorithm is not publicly published, so we validate the verifiable
// invariants (length, numeric, non-degenerate). `checkDigitVerifier` is a documented
// seam: pass one in once the official algorithm is sourced to tighten validation.
const HVHH_LENGTH = 8;

function normalizeHvhh(value) {
  if (value === null || value === undefined) return "";
  // Strip separators users commonly type (spaces, dots, hyphens).
  return String(value).replace(/[\s.\-]/g, "");
}

function validateHvhh(value, { checkDigitVerifier } = {}) {
  const normalized = normalizeHvhh(value);
  if (!normalized) return { ok: false, normalized: "", error: "ՀՎՀՀ-ն պարտադիր է" };
  if (!/^[0-9]+$/.test(normalized)) {
    return { ok: false, normalized, error: "ՀՎՀՀ-ն պետք է պարունակի միայն թվանշաններ" };
  }
  if (normalized.length !== HVHH_LENGTH) {
    return { ok: false, normalized, error: `ՀՎՀՀ-ն պետք է լինի ${HVHH_LENGTH} նիշ` };
  }
  if (/^(\d)\1{7}$/.test(normalized)) {
    return { ok: false, normalized, error: "ՀՎՀՀ-ն անվավեր է" };
  }
  if (typeof checkDigitVerifier === "function" && !checkDigitVerifier(normalized)) {
    return { ok: false, normalized, error: "ՀՎՀՀ-ի ստուգիչ նիշը սխալ է" };
  }
  return { ok: true, normalized, error: null };
}

function isValidHvhh(value, options) {
  return validateHvhh(value, options).ok;
}

// AMD money. Amounts are whole drams; round before storing/displaying.
function roundAmd(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function groupThousands(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatAmd(amount, { symbol = true } = {}) {
  const drams = roundAmd(amount);
  const sign = drams < 0 ? "-" : "";
  const grouped = sign + groupThousands(String(Math.abs(drams)));
  return symbol ? `${grouped} ${AMD.symbol}` : grouped;
}

module.exports = {
  AMD,
  HVHH_LENGTH,
  normalizeHvhh,
  validateHvhh,
  isValidHvhh,
  roundAmd,
  formatAmd,
};
