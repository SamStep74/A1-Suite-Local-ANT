"use strict";

// Pure functions only — no require('node:sqlite'), no require('fastify').

const CROP_BASELINE_KG_PER_M2 = {
  tomato: 35,
  cucumber: 45,
  pepper: 25,
  lettuce: 30,
  strawberry: 18,
  herb: 12
};

const DEFAULT_BASE_TEMP_C = 10;
const ANOMALY_HIGH_C = 38;
const ANOMALY_LOW_C = 2;

function buildHouse({ name, areaM2, glazingKind, heatingKind, now }) {
  const cleanName = String(name || "").trim();
  if (cleanName.length < 2 || cleanName.length > 80) {
    const err = new Error("name must be 2-80 chars");
    err.statusCode = 400; throw err;
  }
  const area = Number(areaM2);
  if (!Number.isFinite(area) || area <= 0 || area > 100000) {
    const err = new Error("areaM2 must be 0 < areaM2 <= 100000");
    err.statusCode = 400; throw err;
  }
  if (!["glass", "poly", "film"].includes(glazingKind)) {
    const err = new Error("glazingKind must be glass|poly|film");
    err.statusCode = 400; throw err;
  }
  if (!["gas", "electric", "biomass", "geothermal"].includes(heatingKind)) {
    const err = new Error("heatingKind must be gas|electric|biomass|geothermal");
    err.statusCode = 400; throw err;
  }
  return {
    name: cleanName,
    areaM2: area,
    glazingKind,
    heatingKind,
    createdAt: now || new Date().toISOString()
  };
}

function buildZone({ greenhouseId, name, areaM2, irrigationKind }) {
  if (!greenhouseId) { const e = new Error("greenhouseId is required"); e.statusCode = 400; throw e; }
  const cleanName = String(name || "").trim();
  if (cleanName.length < 1) { const e = new Error("name is required"); e.statusCode = 400; throw e; }
  const area = Number(areaM2);
  if (!Number.isFinite(area) || area <= 0) { const e = new Error("areaM2 must be > 0"); e.statusCode = 400; throw e; }
  if (!["drip", "sprinkler", "flood", "manual"].includes(irrigationKind)) {
    const e = new Error("irrigationKind must be drip|sprinkler|flood|manual"); e.statusCode = 400; throw e;
  }
  return { greenhouseId, name: cleanName, areaM2: area, irrigationKind };
}

function buildCrop({ zoneId, cropKind, plantedAt, expectedHarvestAt, expectedYieldKg, seedSource }) {
  if (!zoneId) { const e = new Error("zoneId is required"); e.statusCode = 400; throw e; }
  if (!CROP_BASELINE_KG_PER_M2[cropKind]) {
    const e = new Error("cropKind must be tomato|cucumber|pepper|lettuce|strawberry|herb");
    e.statusCode = 400; throw e;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plantedAt) || !/^\d{4}-\d{2}-\d{2}$/.test(expectedHarvestAt)) {
    const e = new Error("plantedAt and expectedHarvestAt must be YYYY-MM-DD"); e.statusCode = 400; throw e;
  }
  if (new Date(expectedHarvestAt) <= new Date(plantedAt)) {
    const e = new Error("expectedHarvestAt must be after plantedAt"); e.statusCode = 400; throw e;
  }
  const expected = Number(expectedYieldKg);
  if (!Number.isFinite(expected) || expected <= 0) {
    const e = new Error("expectedYieldKg must be > 0"); e.statusCode = 400; throw e;
  }
  return { zoneId, cropKind, plantedAt, expectedHarvestAt, expectedYieldKg: expected, seedSource: seedSource || null, status: "planted" };
}

function patchCropStatus({ currentStatus, nextStatus }) {
  const allowed = { planted: ["growing", "failed"], growing: ["harvested", "failed"], harvested: [], failed: [] };
  if (!allowed[currentStatus] || !allowed[currentStatus].includes(nextStatus)) {
    const e = new Error(`cannot transition from ${currentStatus} to ${nextStatus}`); e.statusCode = 400; throw e;
  }
  return { status: nextStatus };
}

function ingestClimateBatch({ zoneId, readings, batchId }) {
  if (!zoneId) { const e = new Error("zoneId is required"); e.statusCode = 400; throw e; }
  if (!Array.isArray(readings) || readings.length === 0) {
    const e = new Error("readings must be a non-empty array"); e.statusCode = 400; throw e;
  }
  const norm = readings.map((r, idx) => {
    if (!r || !r.recordedAt) { const e = new Error(`readings[${idx}].recordedAt required`); e.statusCode = 400; throw e; }
    const t = Number(r.tempC);
    if (!Number.isFinite(t)) { const e = new Error(`readings[${idx}].tempC must be a number`); e.statusCode = 400; throw e; }
    return {
      zoneId,
      recordedAt: String(r.recordedAt),
      tempC: t,
      humidity: Number(r.humidity) || 0,
      lightLux: r.lightLux == null ? null : Number(r.lightLux),
      co2Ppm: r.co2Ppm == null ? null : Number(r.co2Ppm),
      sensorId: String(r.sensorId || "unknown"),
      batchId: String(batchId)
    };
  });
  return { zoneId, readings: norm, count: norm.length };
}

function ingestEnergyBatch({ greenhouseId, readings, periodKey }) {
  if (!greenhouseId) { const e = new Error("greenhouseId is required"); e.statusCode = 400; throw e; }
  if (!Array.isArray(readings) || readings.length === 0) {
    const e = new Error("readings must be a non-empty array"); e.statusCode = 400; throw e;
  }
  if (!/^\d{4}-\d{2}$/.test(String(periodKey || ""))) {
    const e = new Error("periodKey must be YYYY-MM"); e.statusCode = 400; throw e;
  }
  const norm = readings.map((r, idx) => ({
    greenhouseId,
    recordedAt: String(r.recordedAt),
    kwh: Number(r.kwh) || 0,
    gasM3: Number(r.gasM3) || 0,
    source: String(r.source || "smart-meter"),
    periodKey: String(periodKey)
  }));
  return { greenhouseId, readings: norm, periodKey, count: norm.length };
}

function buildBioprotection({ zoneId, appliedAt, agentKind, dose, targetPest, withdrawalPeriodDays, recordedBy }) {
  if (!zoneId) { const e = new Error("zoneId is required"); e.statusCode = 400; throw e; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(appliedAt || ""))) {
    const e = new Error("appliedAt must be YYYY-MM-DD"); e.statusCode = 400; throw e;
  }
  if (!agentKind) { const e = new Error("agentKind is required"); e.statusCode = 400; throw e; }
  if (!dose) { const e = new Error("dose is required"); e.statusCode = 400; throw e; }
  const wd = Number(withdrawalPeriodDays);
  if (!Number.isInteger(wd) || wd < 0 || wd > 60) {
    const e = new Error("withdrawalPeriodDays must be integer 0-60"); e.statusCode = 400; throw e;
  }
  return { zoneId, appliedAt, agentKind, dose, targetPest: targetPest || null, withdrawalPeriodDays: wd, recordedBy: recordedBy || null };
}

function enforceWithdrawalPeriod({ bioprotectionLogs, zoneId, harvestDate }) {
  const earliestSafe = bioprotectionLogs
    .filter(log => log.zone_id === zoneId)
    .map(log => {
      const applied = new Date(log.applied_at);
      const safe = new Date(applied.getTime() + Number(log.withdrawal_period_days) * 86400000);
      return safe;
    })
    .reduce((max, d) => (d > max ? d : max), new Date(0));
  const harvest = new Date(harvestDate);
  if (harvest < earliestSafe) {
    const err = new Error(`harvest blocked: earliest safe date is ${earliestSafe.toISOString().slice(0, 10)}`);
    err.statusCode = 409; err.code = "WITHDRAWAL_PERIOD_ACTIVE"; throw err;
  }
  return { cleared: true, earliestSafeDate: earliestSafe.toISOString().slice(0, 10) };
}

function computeGdd({ climateLogs, baseTempC = DEFAULT_BASE_TEMP_C }) {
  const total = climateLogs.reduce((sum, log) => {
    const t = Number(log.temp_c);
    if (!Number.isFinite(t)) return sum;
    return sum + Math.max(0, t - baseTempC);
  }, 0);
  return { growingDegreeDays: Number(total.toFixed(2)), baseTempC, sampleSize: climateLogs.length };
}

function computeEnergyPerKg({ energyLogs, harvests }) {
  const totalKwh = energyLogs.reduce((s, l) => s + Number(l.kwh || 0), 0);
  const totalGas = energyLogs.reduce((s, l) => s + Number(l.gas_m3 || 0), 0);
  const totalKg = harvests.reduce((s, h) => s + Number(h.quantity_kg || 0), 0);
  return {
    totalKwh: Number(totalKwh.toFixed(2)),
    totalGasM3: Number(totalGas.toFixed(2)),
    totalKg: Number(totalKg.toFixed(2)),
    kwhPerKg: totalKg > 0 ? Number((totalKwh / totalKg).toFixed(4)) : 0,
    gasM3PerKg: totalKg > 0 ? Number((totalGas / totalKg).toFixed(4)) : 0
  };
}

function computeYieldVsForecast({ crops, harvests }) {
  const byCrop = new Map();
  for (const h of harvests) {
    const cur = byCrop.get(h.crop_id) || 0;
    byCrop.set(h.crop_id, cur + Number(h.quantity_kg || 0));
  }
  return crops.map(crop => {
    const actual = Number((byCrop.get(crop.id) || 0).toFixed(2));
    const expected = Number(crop.expected_yield_kg || 0);
    return {
      cropId: crop.id,
      cropKind: crop.crop_kind,
      expectedKg: expected,
      actualKg: actual,
      deltaKg: Number((actual - expected).toFixed(2)),
      pctOfForecast: expected > 0 ? Number(((actual / expected) * 100).toFixed(2)) : null
    };
  });
}

function forecastYield({ cropKind, areaM2, gdd }) {
  const baseline = CROP_BASELINE_KG_PER_M2[cropKind] || 0;
  const heat = Number.isFinite(gdd) ? Math.min(1.3, 0.7 + gdd / 1500) : 1;
  const expected = Number((baseline * areaM2 * heat).toFixed(2));
  return { cropKind, areaM2, gddUsed: gdd, baselineKgPerM2: baseline, expectedKg: expected, model: "deterministic-local-v1" };
}

function alertClimateAnomaly({ climateLogs }) {
  const alerts = [];
  for (const log of climateLogs) {
    const t = Number(log.temp_c);
    if (Number.isFinite(t) && t > ANOMALY_HIGH_C) {
      alerts.push({ kind: "OVERHEAT", zoneId: log.zone_id, recordedAt: log.recorded_at, value: t, threshold: ANOMALY_HIGH_C });
    }
    if (Number.isFinite(t) && t < ANOMALY_LOW_C) {
      alerts.push({ kind: "FROST_RISK", zoneId: log.zone_id, recordedAt: log.recorded_at, value: t, threshold: ANOMALY_LOW_C });
    }
  }
  return { alerts, count: alerts.length };
}

module.exports = {
  buildHouse,
  buildZone,
  buildCrop,
  patchCropStatus,
  ingestClimateBatch,
  ingestEnergyBatch,
  buildBioprotection,
  enforceWithdrawalPeriod,
  computeGdd,
  computeEnergyPerKg,
  computeYieldVsForecast,
  forecastYield,
  alertClimateAnomaly,
  CROP_BASELINE_KG_PER_M2
};
