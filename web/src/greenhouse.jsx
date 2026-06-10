import React, { useEffect, useState } from "react";

const TABS = [
  { key: "house", label: "Ջերմոց" },
  { key: "zone", label: "Գոտիներ" },
  { key: "crop", label: "Կուլտուրաներ" },
  { key: "climate", label: "Կլիմա" },
  { key: "energy", label: "Էներգիա" },
  { key: "bioprotection", label: "Պաշտպանություն" },
  { key: "harvest", label: "Բերքահավաք" }
];

const CROP_KINDS = ["tomato", "cucumber", "pepper", "lettuce", "strawberry", "herb"];
const CROP_LABELS = {
  tomato: "Լոլիկ",
  cucumber: "Վարունգ",
  pepper: "Պղպեղ",
  lettuce: "Հազար",
  strawberry: "Ելակ",
  herb: "Կանաչեղեն"
};

export function GreenhousePanel({ onApi, actionState, canEdit }) {
  const [tab, setTab] = useState("house");
  const [name, setName] = useState("Armosphère-1");
  const [areaM2, setAreaM2] = useState(1200);
  const [glazingKind, setGlazingKind] = useState("glass");
  const [heatingKind, setHeatingKind] = useState("gas");
  const [houseId, setHouseId] = useState("");
  const [zoneName, setZoneName] = useState("Zone A");
  const [zoneArea, setZoneArea] = useState(400);
  const [irrigationKind, setIrrigationKind] = useState("drip");
  const [zoneId, setZoneId] = useState("");
  const [cropKind, setCropKind] = useState("tomato");
  const [plantedAt, setPlantedAt] = useState("2026-04-01");
  const [expectedHarvestAt, setExpectedHarvestAt] = useState("2026-07-15");
  const [expectedYieldKg, setExpectedYieldKg] = useState(1500);
  const [cropId, setCropId] = useState("");
  const [periodKey, setPeriodKey] = useState("2026-06");
  const [agentKind, setAgentKind] = useState("Spinosad");
  const [dose, setDose] = useState("0.3 l/ha");
  const [targetPest, setTargetPest] = useState("thrips");
  const [withdrawalDays, setWithdrawalDays] = useState(7);
  const [harvestedAt, setHarvestedAt] = useState("2026-06-08");
  const [quantityKg, setQuantityKg] = useState(100);
  const [qualityGrade, setQualityGrade] = useState("A");
  const [result, setResult] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const busy = actionState?.startsWith("greenhouse:");

  useEffect(() => { setResult(null); setAiResult(null); }, [tab]);

  async function call(method, url, payload) {
    return await onApi(url, { method, body: payload });
  }

  function idem(prefix) { return `${prefix}-${Date.now()}`; }

  async function createHouse() {
    const res = await call("POST", "/api/greenhouse/houses", {
      name, areaM2, glazingKind, heatingKind, idempotencyKey: idem("ui-house")
    });
    setResult({ kind: "house", data: res.greenhouse });
    setHouseId(res.greenhouse.id);
  }

  async function createZone() {
    if (!houseId) { setResult({ kind: "error", data: { error: "Ստեղծեք ջերմոց նախ" } }); return; }
    const res = await call("POST", "/api/greenhouse/zones", {
      greenhouseId: houseId, name: zoneName, areaM2: zoneArea, irrigationKind, idempotencyKey: idem("ui-zone")
    });
    setResult({ kind: "zone", data: res.zone });
    setZoneId(res.zone.id);
  }

  async function createCrop() {
    if (!zoneId) { setResult({ kind: "error", data: { error: "Ստեղծեք գոտի նախ" } }); return; }
    const res = await call("POST", "/api/greenhouse/crops", {
      zoneId, cropKind, plantedAt, expectedHarvestAt, expectedYieldKg, seedSource: "Hazera", idempotencyKey: idem("ui-crop")
    });
    setResult({ kind: "crop", data: res.crop });
    setCropId(res.crop.id);
  }

  async function loadYield() {
    if (!houseId) { setResult({ kind: "error", data: { error: "Ստեղծեք ջերմոց նախ" } }); return; }
    const res = await call("GET", `/api/greenhouse/${houseId}/analytics/yield?periodKey=${periodKey}`);
    setResult({ kind: "yield", data: res.yield });
  }

  async function loadEnergy() {
    if (!houseId) { setResult({ kind: "error", data: { error: "Ստեղծեք ջերմոց նախ" } }); return; }
    const res = await call("GET", `/api/greenhouse/${houseId}/analytics/energy?periodKey=${periodKey}`);
    setResult({ kind: "energy", data: res.energy });
  }

  async function loadGdd() {
    if (!houseId) { setResult({ kind: "error", data: { error: "Ստեղծեք ջերմոց նախ" } }); return; }
    const res = await call("GET", `/api/greenhouse/${houseId}/analytics/gdd?from=2026-04-01&to=2026-06-08&baseTempC=10`);
    setResult({ kind: "gdd", data: res.gdd });
  }

  async function applyBioprotection() {
    if (!zoneId) { setResult({ kind: "error", data: { error: "Ստեղծեք գոտի նախ" } }); return; }
    const res = await call("POST", "/api/greenhouse/bioprotection", {
      zoneId, appliedAt: harvestedAt, agentKind, dose, targetPest, withdrawalPeriodDays: withdrawalDays, recordedBy: "agronomist",
      idempotencyKey: idem("ui-bio")
    });
    setResult({ kind: "bioprotection", data: res });
  }

  async function recordHarvest() {
    if (!cropId) { setResult({ kind: "error", data: { error: "Ստեղծեք կուլտուրա նախ" } }); return; }
    try {
      const res = await call("POST", "/api/greenhouse/harvests", {
        cropId, harvestedAt, quantityKg, qualityGrade, idempotencyKey: idem("ui-harv")
      });
      setResult({ kind: "harvest", data: res.harvest });
    } catch (e) {
      setResult({ kind: "harvest-blocked", data: { error: e.message } });
    }
  }

  async function askAi() {
    const res = await call("POST", "/api/greenhouse/ai/yield-forecast", {
      periodKey, question: `yield-forecast for ${periodKey}`, idempotencyKey: idem("ui-ai")
    });
    setAiResult(res.packet);
  }

  return (
    <article className="panel greenhouse-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Greenhouse</span>
          <h2>{"Ջերմոցային կարագավարում"}</h2>
        </div>
        <nav className="row" role="tablist" aria-label="Greenhouse tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className="mini-action"
              disabled={busy}
              onClick={() => setTab(t.key)}
            >{t.label}</button>
          ))}
        </nav>
      </div>

      {tab === "house" && (
        <div className="inline-form">
          <label className="section-label" htmlFor="gh-name">{"Անվանում"}</label>
          <input id="gh-name" value={name} onChange={e => setName(e.target.value)} />
          <label className="section-label" htmlFor="gh-area">{"Մակերես (մ²)"}</label>
          <input id="gh-area" type="number" value={areaM2} onChange={e => setAreaM2(Number(e.target.value))} />
          <label className="section-label" htmlFor="gh-glazing">{"Ապակիների տեսակ"}</label>
          <select id="gh-glazing" value={glazingKind} onChange={e => setGlazingKind(e.target.value)}>
            <option value="glass">glass</option>
            <option value="poly">poly</option>
            <option value="film">film</option>
          </select>
          <label className="section-label" htmlFor="gh-heating">{"Ջեռուցման տեսակ"}</label>
          <select id="gh-heating" value={heatingKind} onChange={e => setHeatingKind(e.target.value)}>
            <option value="gas">gas</option>
            <option value="electric">electric</option>
            <option value="biomass">biomass</option>
            <option value="geothermal">geothermal</option>
          </select>
          {canEdit && <button className="mini-action" type="button" disabled={busy} onClick={createHouse}>{"Ստեղծել ջերմոց"}</button>}
        </div>
      )}

      {tab === "zone" && (
        <div className="inline-form">
          <label className="section-label" htmlFor="z-name">{"Գոտու անվանում"}</label>
          <input id="z-name" value={zoneName} onChange={e => setZoneName(e.target.value)} />
          <label className="section-label" htmlFor="z-area">{"Մակերես (մ²)"}</label>
          <input id="z-area" type="number" value={zoneArea} onChange={e => setZoneArea(Number(e.target.value))} />
          <label className="section-label" htmlFor="z-irrig">{"Ոռոգման տեսակ"}</label>
          <select id="z-irrig" value={irrigationKind} onChange={e => setIrrigationKind(e.target.value)}>
            <option value="drip">drip</option>
            <option value="sprinkler">sprinkler</option>
            <option value="flood">flood</option>
            <option value="manual">manual</option>
          </select>
          {canEdit && <button className="mini-action" type="button" disabled={busy} onClick={createZone}>{"Ստեղծել գոտի"}</button>}
        </div>
      )}

      {tab === "crop" && (
        <div className="inline-form">
          <label className="section-label" htmlFor="c-kind">{"Կուլտուրա"}</label>
          <select id="c-kind" value={cropKind} onChange={e => setCropKind(e.target.value)}>
            {CROP_KINDS.map(k => <option key={k} value={k}>{CROP_LABELS[k]}</option>)}
          </select>
          <label className="section-label" htmlFor="c-plant">{"Տնկման ամսաթիվ"}</label>
          <input id="c-plant" type="date" value={plantedAt} onChange={e => setPlantedAt(e.target.value)} />
          <label className="section-label" htmlFor="c-harv">{"Սպասվող բերքահավաք"}</label>
          <input id="c-harv" type="date" value={expectedHarvestAt} onChange={e => setExpectedHarvestAt(e.target.value)} />
          <label className="section-label" htmlFor="c-yield">{"Սպասվող բերք (կգ)"}</label>
          <input id="c-yield" type="number" value={expectedYieldKg} onChange={e => setExpectedYieldKg(Number(e.target.value))} />
          {canEdit && <button className="mini-action" type="button" disabled={busy} onClick={createCrop}>{"Տնկել կուլտուրա"}</button>}
        </div>
      )}

      {tab === "climate" && (
        <div className="row">
          <label className="section-label" htmlFor="gh-period-c">{"Շրջան"}</label>
          <input id="gh-period-c" value={periodKey} onChange={e => setPeriodKey(e.target.value)} placeholder="YYYY-MM" />
          <button className="mini-action" type="button" disabled={busy} onClick={loadGdd}>{"Բեռնել GDD (ջերմաստիճանային գումար)"}</button>
        </div>
      )}

      {tab === "energy" && (
        <div className="row">
          <label className="section-label" htmlFor="gh-period-e">{"Շրջան"}</label>
          <input id="gh-period-e" value={periodKey} onChange={e => setPeriodKey(e.target.value)} placeholder="YYYY-MM" />
          <button className="mini-action" type="button" disabled={busy} onClick={loadEnergy}>{"Բեռնել էներգիա"}</button>
        </div>
      )}

      {tab === "bioprotection" && (
        <div className="inline-form">
          <label className="section-label" htmlFor="b-agent">{"Պատրաստուկ"}</label>
          <input id="b-agent" value={agentKind} onChange={e => setAgentKind(e.target.value)} />
          <label className="section-label" htmlFor="b-dose">{"Դոզա"}</label>
          <input id="b-dose" value={dose} onChange={e => setDose(e.target.value)} />
          <label className="section-label" htmlFor="b-pest">{"Վնասատու"}</label>
          <input id="b-pest" value={targetPest} onChange={e => setTargetPest(e.target.value)} />
          <label className="section-label" htmlFor="b-wd">{"Սպասման ժամկետ (օր)"}</label>
          <input id="b-wd" type="number" value={withdrawalDays} onChange={e => setWithdrawalDays(Number(e.target.value))} />
          {canEdit && <button className="mini-action" type="button" disabled={busy} onClick={applyBioprotection}>{"Գրանցել մշակումը"}</button>}
        </div>
      )}

      {tab === "harvest" && (
        <div className="inline-form">
          <label className="section-label" htmlFor="h-date">{"Ամսաթիվ"}</label>
          <input id="h-date" type="date" value={harvestedAt} onChange={e => setHarvestedAt(e.target.value)} />
          <label className="section-label" htmlFor="h-qty">{"Քանակ (կգ)"}</label>
          <input id="h-qty" type="number" value={quantityKg} onChange={e => setQuantityKg(Number(e.target.value))} />
          <label className="section-label" htmlFor="h-grade">{"Որակ"}</label>
          <select id="h-grade" value={qualityGrade} onChange={e => setQualityGrade(e.target.value)}>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
          {canEdit && <button className="mini-action" type="button" disabled={busy} onClick={recordHarvest}>{"Գրանցել բերքահավաք"}</button>}
          <button className="mini-action" type="button" disabled={busy} onClick={loadYield}>{"Բերքի վերլուծություն"}</button>
        </div>
      )}

      <div className="row">
        <button className="mini-action" type="button" disabled={busy} onClick={askAi}>{"AI. Բերքի կանխատեսում"}</button>
      </div>

      {result && (
        <div className="copilot-result" data-testid="greenhouse-result">
          {result.kind === "house" && (
            <p>{"Ջերմոց"} <strong>{result.data.name}</strong> ({result.data.areaM2} մ²) — ID: <code>{result.data.id}</code></p>
          )}
          {result.kind === "zone" && (
            <p>{"Գոտի"} <strong>{result.data.name}</strong> ({result.data.areaM2} մ², {result.data.irrigationKind})</p>
          )}
          {result.kind === "crop" && (
            <p>{"Կուլտուրա"} <strong>{CROP_LABELS[result.data.cropKind] || result.data.cropKind}</strong> — կարգավիճակ՝ <span className="aging-badge">{result.data.status}</span></p>
          )}
          {result.kind === "yield" && (
            <ul>
              {result.data.rows.map(r => (
                <li key={r.cropId}>{CROP_LABELS[r.cropKind] || r.cropKind}: սպասվող {r.expectedKg} կգ, իրական {r.actualKg} կգ ({r.pctOfForecast ?? 0}%)</li>
              ))}
            </ul>
          )}
          {result.kind === "energy" && (
            <>
              <p>{"Ընդհանուր էլեկտրաէներգիա"}: <strong>{result.data.totalKwh} կՎտ·ժ</strong>, գազ՝ <strong>{result.data.totalGasM3} մ³</strong>, բերք՝ <strong>{result.data.totalKg} կգ</strong></p>
              <p>կՎտ·ժ/կգ՝ <strong>{result.data.kwhPerKg}</strong>, մ³/կգ՝ <strong>{result.data.gasM3PerKg}</strong></p>
            </>
          )}
          {result.kind === "gdd" && (
            <p>GDD (base {result.data.baseTempC}°C)՝ <strong>{result.data.growingDegreeDays}</strong>, նմուշներ՝ {result.data.sampleSize}</p>
          )}
          {result.kind === "bioprotection" && (
            <p>{"Մշակումը գրանցված է"} — {result.data?.bioprotection?.agentKind || agentKind}, սպասման ժամկետ՝ {withdrawalDays} օր</p>
          )}
          {result.kind === "harvest" && (
            <p>{"Բերքահավաք՝"} <strong>{result.data.quantityKg} կգ</strong> ({result.data.qualityGrade}) — lot: <code>{result.data.lotId}</code></p>
          )}
          {result.kind === "harvest-blocked" && (
            <p className="action-status">Արգելափակված է. {result.data.error}</p>
          )}
          {result.kind === "error" && (
            <p className="action-status">{result.data.error}</p>
          )}
        </div>
      )}

      {aiResult && (
        <div className="copilot-result" data-testid="greenhouse-ai">
          <p className="action-status">AI ({aiResult.intent}, {aiResult.aiSource})</p>
          <p>{aiResult.answer}</p>
          <p className="action-status">{"Վստահություն"}: {aiResult.confidence}, {"ռիսկի մակարդակ"}: {aiResult.riskLevel}</p>
        </div>
      )}
    </article>
  );
}
