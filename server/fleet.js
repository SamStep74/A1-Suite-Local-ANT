"use strict";

// --- Trip state machine --------------------------------------------------------
const TRIP_TRANSITIONS = {
  planned: { departed: "in_transit", cancelled: "cancelled" },
  in_transit: { arrived: "arrived", cancelled: "cancelled" },
  arrived: {},
  cancelled: {}
};

const tripStateMachine = {
  next(current, action) {
    const allowed = TRIP_TRANSITIONS[current] || {};
    const next = allowed[action];
    if (!next) {
      const err = new Error(`invalid transition: ${current} -[${action}]-> ?`);
      err.statusCode = 400;
      throw err;
    }
    return next;
  }
};

// --- Trip cost ---------------------------------------------------------------
function computeTripCost({ fuelL, fuelCostPerL, km, repairCostPerKm }) {
  const f = Number(fuelL) || 0;
  const fp = Number(fuelCostPerL) || 0;
  const k = Number(km) || 0;
  const r = Number(repairCostPerKm) || 0;
  const fuel = Math.round(f * fp);
  const repairs = Math.round(k * r);
  return { fuel, repairs, total: fuel + repairs, liters: f, km: k };
}

// --- Fuel efficiency ----------------------------------------------------------
function fuelEfficiency({ liters, km }) {
  const l = Number(liters) || 0;
  const k = Number(km) || 0;
  if (l <= 0 || k <= 0) {
    return { lPer100km: 0, kmPerL: 0 };
  }
  return { lPer100km: Math.round((l / k) * 10000) / 100, kmPerL: k / l };
}

// --- Cold-chain compliance ----------------------------------------------------
const CATEGORY_RULES = {
  dairy:      { maxTempC: 6,  minTempC: 0 },
  frozen:     { maxTempC: -15, minTempC: -25 },
  produce:    { maxTempC: 10, minTempC: 1 },
  meat:       { maxTempC: 4,  minTempC: 0 },
  default:    { maxTempC: 8,  minTempC: 0 }
};

function coldChainCompliance(pings, { category = "default", maxMinutesOutOfRange = 30 } = {}) {
  const rule = CATEGORY_RULES[category] || CATEGORY_RULES.default;
  const sorted = [...pings].sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
  const breaches = [];
  let worstTempC = null;
  if (sorted.length === 0) {
    return { breaches, worstTempC, sustainedMinutes: 0 };
  }
  worstTempC = sorted[0].tempC;
  // Find longest consecutive out-of-range run.
  let runStart = null;
  let runMin = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const ping = sorted[i];
    if (ping.tempC > rule.maxTempC || ping.tempC < rule.minTempC) {
      if (runStart === null) { runStart = ping.recordedAt; runMin = 0; }
      worstTempC = Math.max(worstTempC, ping.tempC);
    }
    if (i > 0 && runStart) {
      const deltaMin = Math.round((new Date(ping.recordedAt) - new Date(sorted[i - 1].recordedAt)) / 60000);
      runMin += deltaMin;
    }
    if (runStart && (ping.tempC <= rule.maxTempC && ping.tempC >= rule.minTempC)) {
      if (runMin > maxMinutesOutOfRange) {
        breaches.push({ startedAt: runStart, endedAt: ping.recordedAt, minutes: runMin });
      }
      runStart = null; runMin = 0;
    }
  }
  if (runStart) {
    const endedAt = sorted[sorted.length - 1].recordedAt;
    if (runMin > maxMinutesOutOfRange) breaches.push({ startedAt: runStart, endedAt, minutes: runMin });
  }
  return { breaches, worstTempC, sustainedMinutes: runMin };
}

// --- Driver hours-of-service --------------------------------------------------
function driverHosBalance({ balanceMin, tripMinutes, dailyCapMin }) {
  const b = Number(balanceMin) || 0;
  const t = Number(tripMinutes) || 0;
  const cap = Number(dailyCapMin) || 600;
  if (t > cap) {
    return { allowed: false, shortfallMin: t - cap, remainingMin: Math.max(b - t, 0), dailyCapMin: cap };
  }
  return { allowed: b - t >= 0, shortfallMin: Math.max(t - b, 0), remainingMin: b - t, dailyCapMin: cap };
}

// --- Maintenance backlog ------------------------------------------------------
function maintenanceBacklog(repairs, { lookbackDays = 90 } = {}) {
  const now = Date.now();
  return repairs
    .filter(r => r.nextDueAt && new Date(r.nextDueAt).getTime() < now)
    .map(r => ({
      vehicleId: r.vehicleId,
      kind: r.kind,
      nextDueAt: r.nextDueAt,
      overdueDays: Math.round((now - new Date(r.nextDueAt).getTime()) / 86400000),
      expectedWithinDays: lookbackDays
    }));
}

module.exports = {
  TRIP_TRANSITIONS,
  CATEGORY_RULES,
  tripStateMachine,
  computeTripCost,
  fuelEfficiency,
  coldChainCompliance,
  driverHosBalance,
  maintenanceBacklog
};
