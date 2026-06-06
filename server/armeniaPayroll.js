// Armenian payroll rules engine — RA localization kernel.
//
// Computes an employee's gross → net pay under current (2026) RA rules. All four
// components are employee withholdings off the SAME gross (read independently):
//   1. Personal income tax (եկամտային հարկ): flat 20% (phased reduction complete 2023).
//   2. Mandatory funded pension (կուտակային վճար): tiered with a cap.
//   3. Stamp duty / military payment (դրոշմանիշային վճար): 2 brackets (since Dec 2025).
//   4. Universal health-insurance premium (առողջության ապահովագրավճար): Dec-2025 law.
// Sourced from official arlis.am laws and SRC guidance; whole dram via the kernel.
//
// Pure functions, no I/O.

const { roundAmd } = require("./localization");

const INCOME_TAX_RATE = 20; // flat %, since 1 Jan 2023

// Pension tiers (min wage 75,000 → threshold 15× = 1,125,000; cap 87,500).
const PENSION_LOW_CEIL = 500000;
const PENSION_CAP_THRESHOLD = 1125000;
const PENSION_CAP = 87500;

const STAMP_BRACKET_THRESHOLD = 1000000;
const STAMP_LOW = 1000;
const STAMP_HIGH = 15000;

const HEALTH_INSURANCE_MIN_GROSS = 200001;
const HEALTH_INSURANCE_LOW_CEIL = 500000;
const HEALTH_INSURANCE_LOW = 4800;
const HEALTH_INSURANCE_FULL = 10800;

function incomeTax(gross) {
  const g = roundAmd(gross);
  return g <= 0 ? 0 : roundAmd((g * INCOME_TAX_RATE) / 100);
}

function pension(gross) {
  const g = roundAmd(gross);
  if (g <= 0) return 0;
  if (g <= PENSION_LOW_CEIL) return roundAmd(g * 0.05);
  if (g <= PENSION_CAP_THRESHOLD) return roundAmd(g * 0.10 - 25000);
  return PENSION_CAP;
}

function stampDuty(gross) {
  const g = roundAmd(gross);
  if (g <= 0) return 0;
  return g <= STAMP_BRACKET_THRESHOLD ? STAMP_LOW : STAMP_HIGH;
}

function healthInsurance(gross) {
  const g = roundAmd(gross);
  if (g < HEALTH_INSURANCE_MIN_GROSS) return 0;
  return g <= HEALTH_INSURANCE_LOW_CEIL ? HEALTH_INSURANCE_LOW : HEALTH_INSURANCE_FULL;
}

function computePayroll(grossInput) {
  const gross = roundAmd(grossInput);
  const tax = incomeTax(gross);
  const pen = pension(gross);
  const stamp = stampDuty(gross);
  const health = healthInsurance(gross);
  const totalWithholdings = tax + pen + stamp + health;
  return {
    gross,
    incomeTax: tax,
    pension: pen,
    stampDuty: stamp,
    healthInsurance: health,
    totalWithholdings,
    net: gross - totalWithholdings,
  };
}

module.exports = {
  INCOME_TAX_RATE,
  PENSION_CAP,
  incomeTax,
  pension,
  stampDuty,
  healthInsurance,
  computePayroll,
};
