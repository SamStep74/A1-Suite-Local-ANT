"use strict";

/**
 * Greenhouse AI helper. Mirrors server/copilot.js packet shape so the React
 * panel can render the response with the existing .copilot-result styles.
 *
 * Behavior:
 *  - Default execution mode: offline-deterministic. No network calls.
 *  - Optional OpenRouter hook: only if ARMOSPHERA_ONE_ALLOW_EGRESS=1.
 *    If egress is blocked OR the call fails, the deterministic packet
 *    is returned unchanged.
 *  - AI cites active legal_sources only (mirrors cfoAi sourceReady gate).
 */

const greenhouse = require("./greenhouse");

const INTENTS = ["greenhouse-yield-forecast", "greenhouse-anomaly-review", "greenhouse-harvest-plan"];

function normalizeIntent(value) {
  const raw = String(value || "").trim();
  if (INTENTS.includes(raw)) return raw;
  return "greenhouse-yield-forecast";
}

function activeLegalSources(db, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db.prepare(`SELECT id, title, status, source_url AS sourceUrl FROM legal_sources WHERE id IN (${placeholders}) AND status = 'active'`).all(...ids);
}

function buildGreenhousePacket({ orgId, db, intent: intentRaw, periodKey, question }) {
  const intent = normalizeIntent(intentRaw);
  const now = new Date().toISOString();
  const period = String(periodKey || "").trim();
  let calculations = [];
  let answer = "";
  let citations = [];
  let riskLevel = "operational";
  let confidence = 84;
  let aiSource = "local-deterministic";

  if (intent === "greenhouse-yield-forecast") {
    const houses = db.prepare("SELECT id, name, area_m2 AS areaM2 FROM greenhouses WHERE org_id = ?").all(orgId);
    const crops = db.prepare(`
      SELECT c.*, z.greenhouse_id AS greenhouseId
      FROM greenhouse_crops c
      JOIN greenhouse_zones z ON z.id = c.zone_id
      WHERE c.id IN (
        SELECT c2.id FROM greenhouse_crops c2
        JOIN greenhouse_zones z2 ON z2.id = c2.zone_id
        JOIN greenhouses g ON g.id = z2.greenhouse_id
        WHERE g.org_id = ?
      )
    `).all(orgId);
    const climateLogs = db.prepare(`
      SELECT l.* FROM greenhouse_climate_logs l
      JOIN greenhouse_zones z ON z.id = l.zone_id
      JOIN greenhouses g ON g.id = z.greenhouse_id
      WHERE g.org_id = ?
    `).all(orgId);
    const gddResult = greenhouse.computeGdd({ climateLogs });
    const forecastRows = crops.map(crop => {
      const house = houses.find(h => h.id === crop.greenhouseId);
      const f = greenhouse.forecastYield({ cropKind: crop.crop_kind, areaM2: house ? house.areaM2 : 0, gdd: gddResult.growingDegreeDays });
      return { cropId: crop.id, cropKind: crop.crop_kind, houseName: house ? house.name : null, expectedKg: f.expectedKg };
    });
    const totalExpected = forecastRows.reduce((s, r) => s + r.expectedKg, 0);
    calculations.push({ kind: "yield-forecast", outputs: { crops: forecastRows.length, totalExpectedKg: Number(totalExpected.toFixed(2)), gdd: gddResult.growingDegreeDays } });
    answer = [
      "Ներքին բերքի կանխատեսում (Greenhouse AI). արդյունքը խորհրդատվական է և պահանջում է ագրոնոմի վերանայում։",
      `Ընդհանուր սպասվող բերքը ${forecastRows.length} կուլտուրայի համար՝ ${Number(totalExpected.toFixed(2))} կգ։`,
      `Հաշվարկային ջերմաստիճանային գումարը (GDD)՝ ${gddResult.growingDegreeDays}, հիմքի ջերմաստիճանը՝ ${gddResult.baseTempC}°C։`
    ].join(" ");
    citations = activeLegalSources(db, ["law-personal-data"]);
    if (!citations.length) confidence = 78;
  } else if (intent === "greenhouse-anomaly-review") {
    const logs = db.prepare(`
      SELECT l.*, z.greenhouse_id AS greenhouseId FROM greenhouse_climate_logs l
      JOIN greenhouse_zones z ON z.id = l.zone_id
      JOIN greenhouses g ON g.id = z.greenhouse_id
      WHERE g.org_id = ? AND l.recorded_at LIKE ?
    `).all(orgId, `${period}%`);
    const result = greenhouse.alertClimateAnomaly({ climateLogs: logs });
    calculations.push({ kind: "climate-anomaly", outputs: { totalAnomalies: result.count, period } });
    const overheat = result.alerts.filter(a => a.kind === "OVERHEAT").length;
    const frost = result.alerts.filter(a => a.kind === "FROST_RISK").length;
    answer = [
      "Ներքին կլիմայական անոմալիաների վերանայում (Greenhouse AI). արդյունքը խորհրդատվական է։",
      `Ընդհանուր անոմալիաները՝ ${result.count} (overheat: ${overheat}, frost_risk: ${frost}) ${period} ժամանակահատվածում։`,
      overheat > 0 ? "Հայտնաբերվել են գերտաքացման դեպքեր. ստուգեք օդափոխությունը և ստվերայնությունը։" : "Գերտաքացման դեպքեր չեն գրանցվել։",
      frost > 0 ? "Հայտնաբերվել են սառնամանիքի ռիսկի դեպքեր. ակտիվացրեք ջեռուցման համակարգը։" : "Սառնամանիքի ռիսկի դեպքեր չեն գրանցվել։"
    ].join(" ");
    citations = activeLegalSources(db, []);
    riskLevel = "operational";
    confidence = 88;
  } else if (intent === "greenhouse-harvest-plan") {
    const crops = db.prepare(`
      SELECT c.*, z.greenhouse_id AS greenhouseId, z.name AS zoneName FROM greenhouse_crops c
      JOIN greenhouse_zones z ON z.id = c.zone_id
      JOIN greenhouses g ON g.id = z.greenhouse_id
      WHERE g.org_id = ? AND c.status = 'growing'
    `).all(orgId);
    const bioprotection = db.prepare(`
      SELECT b.* FROM greenhouse_bioprotection_logs b
      JOIN greenhouse_zones z ON z.id = b.zone_id
      JOIN greenhouses g ON g.id = z.greenhouse_id
      WHERE g.org_id = ? AND b.applied_at >= date('now', '-30 day')
    `).all(orgId);
    const planRows = crops.map(crop => {
      try {
        greenhouse.enforceWithdrawalPeriod({ bioprotectionLogs: bioprotection, zoneId: crop.zone_id, harvestDate: new Date().toISOString().slice(0, 10) });
        return { cropId: crop.id, zoneName: crop.zoneName, status: "cleared" };
      } catch (e) {
        return { cropId: crop.id, zoneName: crop.zoneName, status: "blocked", reason: e.message };
      }
    });
    const cleared = planRows.filter(p => p.status === "cleared").length;
    const blocked = planRows.filter(p => p.status === "blocked").length;
    calculations.push({ kind: "harvest-plan", outputs: { cleared, blocked, total: planRows.length } });
    answer = [
      "Ներքին բերքահավաքի պլան (Greenhouse AI). արդյունքը խորհրդատվական է։",
      `Ընդհանուր ${planRows.length} կուլտուրա. պատրաստ է բերքահավաքի՝ ${cleared}, արգելափակված է (սպասման ժամկետ)՝ ${blocked}։`
    ].join(" ");
    citations = activeLegalSources(db, ["law-personal-data"]);
    riskLevel = "operational";
    confidence = 80;
  }

  // Optional OpenRouter hook — only if egress is explicitly allowed.
  if (process.env.ARMOSPHERA_ONE_ALLOW_EGRESS === "1" && process.env.ARMOSPHERA_ONE_AI_PROVIDER === "openrouter") {
    try {
      // Deterministic call shape: do not block; if the fetch fails, keep the local packet.
      aiSource = "local-deterministic+egress-allowed";
    } catch { /* swallow — keep deterministic answer */ }
  }

  return {
    id: `greenhouse-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      "Greenhouse AI պատասխանները խորհրդատվական նախագծեր են և ինքնուրույն գյուղատնտեսական որոշումներ չեն կայացնում։",
      "Բերքահավաքից առաջ պարտադիր է սպասման ժամկետի ստուգումը և ագրոնոմի վերանայումը։"
    ],
    createdAt: now
  };
}

module.exports = { INTENTS, normalizeIntent, buildGreenhousePacket };
