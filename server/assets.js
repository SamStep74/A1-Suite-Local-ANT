"use strict";

/**
 * Asset management pure engine. NO DB / Fastify imports. Mirrors the Pattern A
 * contract used by /docs/superpowers/plans/2026-06-08-a1-suite-ant-pattern-a-skeleton.md.
 *
 * All amounts are integer AMD minor units (no decimals). Asset values, salvage
 * values, and depreciation amounts are integers. Account identifiers are
 * Armenian-chart 3-digit codes (e.g. "111", "112", "711") so journal posting
 * can find real accounts.
 */

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    const err = new Error(`${field} must be a positive integer`);
    err.statusCode = 400;
    throw err;
  }
}

function requirePositiveNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    const err = new Error(`${field} must be a non-negative number`);
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isSafeInteger(value)) {
    const err = new Error(`${field} exceeds Number.MAX_SAFE_INTEGER`);
    err.statusCode = 400;
    throw err;
  }
}

function requireAccountCode(value, field) {
  if (typeof value !== "string" || !/^\d{3}$/.test(value)) {
    const err = new Error(`${field} must be a 3-digit Armenian chart-of-accounts code`);
    err.statusCode = 400;
    throw err;
  }
}

function requireIsoDate(value, field) {
  const raw = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const err = new Error(`${field} must be YYYY-MM-DD`);
    err.statusCode = 400;
    throw err;
  }
  const [y, m, d] = raw.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    const err = new Error(`${field} has impossible month/day`);
    err.statusCode = 400;
    throw err;
  }
  const daysInMonth = new Date(y, m, 0).getDate();
  if (d > daysInMonth) {
    const err = new Error(`${field} has impossible day for month`);
    err.statusCode = 400;
    throw err;
  }
  return raw;
}

function validateCategoryInput(input) {
  if (!input || typeof input !== "object") {
    const err = new Error("body required");
    err.statusCode = 400;
    throw err;
  }
  const name = String(input.name || "").trim();
  if (name.length < 2 || name.length > 80) {
    const err = new Error("name must be 2-80 chars");
    err.statusCode = 400;
    throw err;
  }
  requirePositiveInteger(input.defaultUsefulLifeMonths, "defaultUsefulLifeMonths");
  if (!["straight_line", "reducing_balance"].includes(input.defaultDepreciationMethod)) {
    const err = new Error("defaultDepreciationMethod must be straight_line or reducing_balance");
    err.statusCode = 400;
    throw err;
  }
  requirePositiveNumber(input.defaultResidualPct, "defaultResidualPct");
  if (input.defaultResidualPct > 100) {
    const err = new Error("defaultResidualPct must be <= 100");
    err.statusCode = 400;
    throw err;
  }
  for (const field of ["assetAccountId", "accumDeprAccountId", "deprExpenseAccountId"]) {
    requireAccountCode(input[field], field);
  }
  return { name };
}

function validateAssetInput(input) {
  if (!input || typeof input !== "object") {
    const err = new Error("body required");
    err.statusCode = 400;
    throw err;
  }
  const name = String(input.name || "").trim();
  if (name.length < 2 || name.length > 120) {
    const err = new Error("name must be 2-120 chars");
    err.statusCode = 400;
    throw err;
  }
  requireIsoDate(input.purchaseDate, "purchaseDate");
  requirePositiveNumber(input.purchaseCostAmd, "purchaseCostAmd");
  requirePositiveNumber(input.salvageValueAmd || 0, "salvageValueAmd");
  if ((input.salvageValueAmd || 0) > input.purchaseCostAmd) {
    const err = new Error("salvageValueAmd must be <= purchaseCostAmd");
    err.statusCode = 400;
    throw err;
  }
  if (typeof input.categoryId !== "string" || input.categoryId.length === 0) {
    const err = new Error("categoryId required");
    err.statusCode = 400;
    throw err;
  }
  const costAmd = Math.round(input.purchaseCostAmd);
  const salvageAmd = Math.round(input.salvageValueAmd || 0);
  if (!Number.isSafeInteger(costAmd) || !Number.isSafeInteger(salvageAmd)) {
    const err = new Error("rounded amount exceeds Number.MAX_SAFE_INTEGER");
    err.statusCode = 400;
    throw err;
  }
  return { name, purchaseCostAmd: costAmd, salvageValueAmd: salvageAmd };
}

function depreciateStraightLine({ cost, salvage, lifeMonths }) {
  const depreciable = cost - salvage;
  const monthly = Math.round(depreciable / lifeMonths);
  let accumulated = 0;
  const schedule = [];
  for (let i = 0; i < lifeMonths; i += 1) {
    const isLast = i === lifeMonths - 1;
    const amount = isLast ? depreciable - accumulated : monthly;
    accumulated += amount;
    schedule.push({
      periodIndex: i,
      depreciationAmd: amount,
      accumulatedAmd: accumulated,
      netBookValueAmd: cost - accumulated
    });
  }
  return schedule;
}

function depreciateReducingBalance({ cost, salvage, lifeMonths, rate }) {
  const effectiveRate = rate || (2 / lifeMonths);
  let nbv = cost;
  let accumulated = 0;
  const schedule = [];
  for (let i = 0; i < lifeMonths; i += 1) {
    const amount = Math.round(nbv * effectiveRate);
    const floor = Math.max(0, nbv - salvage);
    const capped = Math.min(amount, floor);
    accumulated += capped;
    nbv = cost - accumulated;
    schedule.push({
      periodIndex: i,
      depreciationAmd: capped,
      accumulatedAmd: accumulated,
      netBookValueAmd: nbv
    });
  }
  return schedule;
}

function buildSchedule({ cost, salvage, lifeMonths, method, rate }) {
  // Defensive cap: 50 years of monthly periods = 600. Prevents OOM if a
  // future caller bypasses the validator (e.g. via an internal script).
  if (!Number.isInteger(lifeMonths) || lifeMonths <= 0 || lifeMonths > 600) {
    const err = new Error("lifeMonths must be an integer between 1 and 600");
    err.statusCode = 400;
    throw err;
  }
  if (method === "reducing_balance") return depreciateReducingBalance({ cost, salvage, lifeMonths, rate });
  return depreciateStraightLine({ cost, salvage, lifeMonths });
}

function nextMaintenanceDue({ lastPerformedAt, intervalDays }) {
  const last = new Date(lastPerformedAt).getTime();
  if (Number.isNaN(last)) {
    const err = new Error("lastPerformedAt must be ISO date");
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isInteger(intervalDays) || intervalDays <= 0) {
    const err = new Error("intervalDays must be positive integer");
    err.statusCode = 400;
    throw err;
  }
  const next = new Date(last + intervalDays * 86400000);
  return next.toISOString();
}

function rollUpValueByCategory(assets) {
  const totals = new Map();
  for (const asset of assets) {
    const key = asset.categoryId;
    const current = totals.get(key) || { categoryId: key, totalCostAmd: 0, totalNbvAmd: 0, count: 0 };
    current.totalCostAmd += asset.purchaseCostAmd;
    current.totalNbvAmd += asset.netBookValueAmd;
    current.count += 1;
    totals.set(key, current);
  }
  return Array.from(totals.values());
}

function applyMaintenanceToAsset({ asset, lastLog }) {
  if (!lastLog || !lastLog.nextDueAt) return asset;
  return { ...asset, nextMaintenanceDueAt: lastLog.nextDueAt };
}

module.exports = {
  validateCategoryInput,
  validateAssetInput,
  buildSchedule,
  nextMaintenanceDue,
  rollUpValueByCategory,
  applyMaintenanceToAsset
};
