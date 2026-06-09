"use strict";

/**
 * CFO pure engine. NO DB / Fastify imports. Mirrors Pattern A contract
 * used by /docs/superpowers/plans/2026-06-08-a1-suite-ant-pattern-a-skeleton.md.
 * All amounts are integer AMD minor units (no decimals). Multi-currency
 * inputs use an explicit `rateToAmd` so the engine is reproducible.
 */

const FX_HEDGE_THRESHOLD_AMD = 5_000_000;
const DEBT_STRESSED_THRESHOLD = 1.5; // monthly service / free cashflow

function computeCashFlow({ openingAmd, weeks }) {
  const opening = Number.isFinite(openingAmd) ? Math.trunc(openingAmd) : 0;
  const list = Array.isArray(weeks) ? weeks : [];
  let running = opening;
  const weekly = list.map(row => {
    const inflow = Number.isFinite(row.inflow) ? Math.trunc(row.inflow) : 0;
    const outflow = Number.isFinite(row.outflow) ? Math.trunc(row.outflow) : 0;
    const net = inflow - outflow;
    running += net;
    return { weekKey: String(row.weekKey), inflow, outflow, net, closing: running };
  });
  return { openingAmd: opening, closingAmd: running, weekly };
}

function computeBudgetVariance({ lines }) {
  const list = Array.isArray(lines) ? lines : [];
  const out = list.map(row => {
    const planned = Number.isFinite(row.planned) ? Math.trunc(row.planned) : 0;
    const actual = Number.isFinite(row.actual) ? Math.trunc(row.actual) : 0;
    const variance = actual - planned;
    const utilizationPct = planned === 0 ? 0 : Math.round((actual / planned) * 100);
    return { accountId: String(row.accountId), planned, actual, variance, utilizationPct };
  });
  const totalPlanned = out.reduce((s, r) => s + r.planned, 0);
  const totalActual = out.reduce((s, r) => s + r.actual, 0);
  return { lines: out, totalPlanned, totalActual, totalVariance: totalActual - totalPlanned };
}

function computeTreasuryPosition({ accounts }) {
  const list = Array.isArray(accounts) ? accounts : [];
  const byCurrency = new Map();
  for (const acc of list) {
    const cur = String(acc.currency);
    const bal = Number.isFinite(acc.balanceCache) ? Math.trunc(acc.balanceCache) : 0;
    const prev = byCurrency.get(cur) || { currency: cur, balance: 0, accountCount: 0 };
    byCurrency.set(cur, { currency: cur, balance: prev.balance + bal, accountCount: prev.accountCount + 1 });
  }
  return Array.from(byCurrency.values());
}

function buildPaymentCalendar({ arOpen = [], apOpen = [], loans = [] }) {
  const entries = [];
  for (const ar of arOpen) {
    entries.push({ date: String(ar.dueDate), amount: Math.trunc(ar.amountAmd), kind: "ar", source: ar.source || "invoice" });
  }
  for (const ap of apOpen) {
    entries.push({ date: String(ap.dueDate), amount: Math.trunc(ap.amountAmd), kind: "ap", source: ap.source || "bill" });
  }
  for (const ln of loans) {
    entries.push({ date: String(ln.dueDate), amount: Math.trunc(ln.principalDue) + Math.trunc(ln.interestDue), kind: "loan", source: "loan-schedule" });
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { entries, totalAmd: entries.reduce((s, e) => s + e.amount, 0) };
}

function computeFxExposure({ positions }) {
  const list = Array.isArray(positions) ? positions : [];
  const byCur = new Map();
  for (const p of list) {
    const cur = String(p.currency);
    const net = Number.isFinite(p.amount) ? Math.trunc(p.amount) : 0;
    const rate = Number.isFinite(p.rateToAmd) ? p.rateToAmd : 0;
    const prev = byCur.get(cur) || { currency: cur, net: 0, netAmd: 0 };
    byCur.set(cur, { currency: cur, net: prev.net + net, netAmd: prev.netAmd + Math.round(net * rate) });
  }
  const arr = Array.from(byCur.values());
  const hasThreshold = arr.some(row => Math.abs(row.netAmd) > FX_HEDGE_THRESHOLD_AMD);
  return { byCurrency: arr, hedgeSuggestion: hasThreshold ? "Հաշվի՛ր ֆորվարդային պայմանագրի օգտագործումը 5M AMD շեմից բարձր բաց պոզիցիաների համար։" : null };
}

function addMonths(iso, n) {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function amortizeLoan({ principalAmd, ratePct, termMonths, startDate, kind }) {
  const principal = Math.trunc(Number(principalAmd) || 0);
  const rate = Number(ratePct) / 100 / 12; // monthly
  const n = Math.max(1, Math.trunc(Number(termMonths) || 0));
  const rows = [];
  let balance = principal;
  if (kind === "equal-principal") {
    const principalDue = Math.round(principal / n);
    for (let i = 0; i < n; i++) {
      const interestDue = Math.round(balance * rate);
      balance = i === n - 1 ? 0 : balance - principalDue;
      rows.push({ periodKey: addMonths(startDate, i), principalDue: i === n - 1 ? principalDue + balance : principalDue, interestDue, balanceAfter: Math.max(0, balance) });
    }
    // final row fix-up
    rows[rows.length - 1].balanceAfter = 0;
    return rows;
  }
  // annuity: payment = P * r / (1 - (1+r)^-n)
  const payment = rate === 0 ? Math.round(principal / n) : Math.round((principal * rate) / (1 - Math.pow(1 + rate, -n)));
  for (let i = 0; i < n; i++) {
    const interestDue = Math.round(balance * rate);
    let principalDue = payment - interestDue;
    if (i === n - 1) principalDue = balance;
    balance = Math.max(0, balance - principalDue);
    rows.push({ periodKey: addMonths(startDate, i), principalDue, interestDue, balanceAfter: balance });
  }
  return rows;
}

function forecastLiquidity({ openingAmd, expectedWeeklyInflow, expectedWeeklyOutflow }) {
  const ins = Array.isArray(expectedWeeklyInflow) ? expectedWeeklyInflow : [];
  const outs = Array.isArray(expectedWeeklyOutflow) ? expectedWeeklyOutflow : [];
  const len = Math.max(ins.length, outs.length);
  const weeks = [];
  let running = Math.trunc(Number(openingAmd) || 0);
  let minBal = running;
  for (let i = 0; i < len; i++) {
    const inflow = Math.trunc(Number(ins[i]) || 0);
    const outflow = Math.trunc(Number(outs[i]) || 0);
    running += inflow - outflow;
    if (running < minBal) minBal = running;
    weeks.push({ weekIndex: i, inflow, outflow, closing: running });
  }
  return {
    weeks,
    openingAmd: Math.trunc(Number(openingAmd) || 0),
    closingAmd: running,
    minBalanceAmd: minBal,
    cashGapDetected: minBal < 0,
    aiSource: "local-deterministic"
  };
}

function analyzeFxRisk({ positions }) {
  const list = Array.isArray(positions) ? positions : [];
  const totalAbsAmd = list.reduce((s, p) => s + Math.abs(Math.round((p.net || 0) * (p.rateToAmd || 0))), 0);
  let riskLevel = "low";
  if (totalAbsAmd > 20_000_000) riskLevel = "high";
  else if (totalAbsAmd > 5_000_000) riskLevel = "medium";
  const top = [...list].sort((a, b) => Math.abs(b.netAmd || 0) - Math.abs(a.netAmd || 0))[0];
  return {
    riskLevel,
    totalAbsExposureAmd: totalAbsAmd,
    suggestion: top ? `${top.currency} բաց պոզիցիան գերազանցում է շեշտված շեմը (${top.netAmd} AMD)։ Հաշվի՛ր հեջավորում։` : "Բաց պոզիցիաները շեմից ցածր են։",
    aiSource: "local-deterministic"
  };
}

function analyzeDebtLoad({ loans, monthlyFreeCashflowAmd }) {
  const list = Array.isArray(loans) ? loans : [];
  const fcf = Math.trunc(Number(monthlyFreeCashflowAmd) || 0);
  const totalPrincipal = list.reduce((s, l) => s + Math.trunc(Number(l.principalAmd) || 0), 0);
  // monthly service = sum of first-row (principal + interest) of each amortization
  const monthlyService = list.reduce((s, l) => {
    const sched = amortizeLoan({ principalAmd: l.principalAmd, ratePct: l.ratePct, termMonths: l.termMonths, startDate: "2026-07-01", kind: l.kind || "annuity" });
    return s + (sched[0] ? sched[0].principalDue + sched[0].interestDue : 0);
  }, 0);
  const ratio = fcf > 0 ? monthlyService / fcf : Number.POSITIVE_INFINITY;
  let stressRating = "comfortable";
  if (!Number.isFinite(ratio) || ratio > 2) stressRating = "danger";
  else if (ratio > DEBT_STRESSED_THRESHOLD) stressRating = "stretched";
  return { totalPrincipalAmd: totalPrincipal, monthlyServiceAmd: monthlyService, monthlyFreeCashflowAmd: fcf, serviceRatio: Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null, stressRating, aiSource: "local-deterministic" };
}

module.exports = {
  computeCashFlow,
  computeBudgetVariance,
  computeTreasuryPosition,
  buildPaymentCalendar,
  computeFxExposure,
  amortizeLoan,
  forecastLiquidity,
  analyzeFxRisk,
  analyzeDebtLoad
};
