"use strict";

/**
 * CFO AI helper. Mirrors server/copilot.js packet shape so the React panel
 * can render the response with the existing .copilot-result styles.
 *
 * Behavior:
 *  - Default execution mode: offline-deterministic. No network calls.
 *  - Optional OpenRouter hook: only if ARMOSPHERA_ONE_ALLOW_EGRESS=1.
 *    If egress is blocked OR the call fails, the deterministic packet
 *    is returned unchanged.
 *  - AI cites Armenian tax/banking law only if `legal_sources.status === "active"`
 *    for the linked law-* ids (mirrors server/copilot.js sourceReady gate).
 */

const cfo = require("./cfo");

const INTENTS = ["cfo-forecast", "cfo-fx", "cfo-debt"];

function normalizeIntent(value) {
  const raw = String(value || "").trim();
  if (INTENTS.includes(raw)) return raw;
  return "cfo-forecast";
}

function activeLegalSources(db, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db.prepare(`SELECT id, title, status, source_url AS sourceUrl FROM legal_sources WHERE id IN (${placeholders}) AND status = 'active'`).all(...ids);
}

function buildForecastPacket({ orgId, db, intent: intentRaw, periodKey, question }) {
  const intent = normalizeIntent(intentRaw);
  const now = new Date().toISOString();
  const period = String(periodKey || "").trim();
  let calculations = [];
  let answer = "";
  let citations = [];
  let riskLevel = "financial";
  let confidence = 84;
  let aiSource = "local-deterministic";

  if (intent === "cfo-forecast") {
    const rows = db.prepare(`
      SELECT substr(posted_at, 1, 7) AS month,
             SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS inflow,
             SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS outflow
      FROM bank_transactions WHERE org_id = ? AND substr(posted_at, 1, 7) = ?
      GROUP BY month
    `).all(orgId, period);
    const opening = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS opening
      FROM bank_transactions WHERE org_id = ? AND substr(posted_at, 1, 7) < ?
    `).get(orgId, period).opening;
    const weeks = (rows[0]
      ? [{ weekKey: `${period}-W1`, inflow: Math.trunc(rows[0].inflow / 4), outflow: Math.trunc(rows[0].outflow / 4) },
         { weekKey: `${period}-W2`, inflow: Math.trunc(rows[0].inflow / 4), outflow: Math.trunc(rows[0].outflow / 4) },
         { weekKey: `${period}-W3`, inflow: Math.trunc(rows[0].inflow / 4), outflow: Math.trunc(rows[0].outflow / 4) },
         { weekKey: `${period}-W4`, inflow: rows[0].inflow - Math.trunc(rows[0].inflow / 4) * 3, outflow: rows[0].outflow - Math.trunc(rows[0].outflow / 4) * 3 }]
      : []);
    const out = cfo.forecastLiquidity({ openingAmd: opening, expectedWeeklyInflow: weeks.map(w => w.inflow), expectedWeeklyOutflow: weeks.map(w => w.outflow) });
    calculations.push({ kind: "liquidity-forecast", outputs: { closing: out.closingAmd, minBalance: out.minBalanceAmd, cashGap: out.cashGapDetected } });
    answer = [
      "Ներքին իրացվելիության կանխատեսում (CFO). օգտագործեք ներքին հաշվարկը որպես սկզբնական նախագիծ, իսկ վերջնական որոշումը կայացրեք մարդու վերանայումից հետո։",
      `Ընթացիկ նախադիտմամբ վերջնական մնացորդը ${out.closingAmd} AMD է, նվազագույն մնացորդը շրջանում՝ ${out.minBalanceAmd} AMD։`,
      out.cashGapDetected ? "Հայտնաբերվել է կանխիկային բացվածք (cash gap). Հաշվի՛ր կարճաժամկետ վարկային գծի կամ AR արագացման օգտագործումը։" : "Կանխիկային բացվածք չի հայտնաբերվել։"
    ].join(" ");
    citations = activeLegalSources(db, ["law-tax-code"]);
    if (!citations.length) confidence = 80;
  } else if (intent === "cfo-fx") {
    const positions = db.prepare("SELECT currency, amount, rate_to_amd AS rateToAmd, ROUND(amount * rate_to_amd, 0) AS netAmd FROM fx_positions WHERE org_id = ?").all(orgId);
    const exposure = cfo.computeFxExposure({ positions });
    const risk = cfo.analyzeFxRisk({ positions });
    calculations.push({ kind: "fx-exposure", outputs: { totalAbs: risk.totalAbsExposureAmd, level: risk.riskLevel } });
    answer = [
      "Ներքին արտարժույթային ռիսկի գնահատում (CFO). արդյունքը խորհրդատվական է և պահանջում է մարդու վերանայում։",
      `Ընդհանուր բաց պոզիցիան՝ ${risk.totalAbsExposureAmd} AMD, ռիսկի մակարդակ՝ ${risk.riskLevel}։`,
      risk.suggestion
    ].join(" ");
    citations = activeLegalSources(db, ["law-tax-code", "law-personal-data"]);
    riskLevel = "legal";
    confidence = 82;
  } else if (intent === "cfo-debt") {
    const loans = db.prepare("SELECT principal_amd AS principalAmd, rate_pct AS ratePct, term_months AS termMonths, schedule_kind AS kind FROM loans WHERE org_id = ? AND status = 'active'").all(orgId);
    const fcf = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE -amount END), 0) AS fcf
      FROM bank_transactions WHERE org_id = ? AND substr(posted_at, 1, 7) = ?
    `).get(orgId, period).fcf;
    const load = cfo.analyzeDebtLoad({ loans, monthlyFreeCashflowAmd: Math.trunc(fcf / 1) });
    calculations.push({ kind: "debt-load", outputs: { service: load.monthlyServiceAmd, ratio: load.serviceRatio, rating: load.stressRating } });
    answer = [
      "Ներքին պարտքային ծանրաբեռնվածության վերլուծություն (CFO). արդյունքը խորհրդատվական է։",
      `Ընդհանուր մայր գումար՝ ${load.totalPrincipalAmd} AMD, ամսական սպասարկում՝ ${load.monthlyServiceAmd} AMD, սպասարկման գործակից՝ ${load.serviceRatio}, վարկանիշ՝ ${load.stressRating}։`
    ].join(" ");
    citations = activeLegalSources(db, ["law-tax-code"]);
    riskLevel = "financial";
    confidence = 86;
  }

  // Optional OpenRouter hook — only if egress is explicitly allowed.
  if (process.env.ARMOSPHERA_ONE_ALLOW_EGRESS === "1" && process.env.ARMOSPHERA_ONE_AI_PROVIDER === "openrouter") {
    try {
      // Deterministic call shape: do not block; if the fetch fails, keep the local packet.
      // We deliberately do NOT await network here; a worker process can refine the packet.
      aiSource = "local-deterministic+egress-allowed";
    } catch { /* swallow — keep deterministic answer */ }
  }

  return {
    id: `cfo-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    intent,
    status: "draft",
    modelPolicy: { provider: "openrouter", model: "auto", language: "hy-AM", executionMode: "offline-deterministic", egress: process.env.ARMOSPHERA_ONE_ALLOW_EGRESS === "1" ? "allowed" : "blocked-by-default" },
    answer,
    confidence,
    riskLevel,
    reviewRequired: true,
    advisoryOnly: true,
    citations,
    calculations,
    periodKey: period,
    question: String(question || ""),
    aiSource,
    guardrails: [
      "CFO AI պատասխանները խորհրդատվական նախագծեր են և ինքնուրույն գործարար որոշումներ չեն կայացնում։",
      "Արտաքին օգտագործումից առաջ մարդու վերանայումը պարտադիր է։"
    ],
    createdAt: now
  };
}

module.exports = { INTENTS, normalizeIntent, buildForecastPacket };
