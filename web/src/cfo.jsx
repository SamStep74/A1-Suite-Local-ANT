import React, { useEffect, useState } from "react";

const TABS = [
  { key: "cashflow", label: "Կանխիկային հոսք" },
  { key: "budget", label: "Բյուժե" },
  { key: "treasury", label: "Գանաարան" },
  { key: "calendar", label: "Վճարումների փրաձույաձ" },
  { key: "loans", label: "Վարկեր" }
];

function SvgLine({ points, width = 320, height = 80 }) {
  if (!points || points.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const max = Math.max(...points.map(p => p.value), 1);
  const min = Math.min(...points.map(p => p.value), 0);
  const span = Math.max(1, max - min);
  const stepX = width / (points.length - 1);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${(i * stepX).toFixed(1)} ${(height - ((p.value - min) / span) * height).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} role="img" aria-label="time series chart">
      <path d={path} fill="none" stroke="#0b6bcb" strokeWidth="2" />
    </svg>
  );
}

function SvgBars({ rows, width = 320, height = 80 }) {
  if (!rows || rows.length === 0) return <svg width={width} height={height} aria-hidden="true" />;
  const max = Math.max(...rows.map(r => Math.abs(r.value)), 1);
  const bw = width / rows.length;
  return (
    <svg width={width} height={height} role="img" aria-label="bar chart">
      {rows.map((r, i) => {
        const h = (Math.abs(r.value) / max) * height;
        const y = r.value < 0 ? height / 2 : height / 2 - h;
        const fill = r.value < 0 ? "#c0392b" : "#0b6bcb";
        return <rect key={r.label} x={(i * bw + 1).toFixed(1)} y={y.toFixed(1)} width={Math.max(2, bw - 2).toFixed(1)} height={h.toFixed(1)} fill={fill} />;
      })}
    </svg>
  );
}

export function CfoPanel({ onApi, actionState, canEdit }) {
  const [tab, setTab] = useState("cashflow");
  const [periodKey, setPeriodKey] = useState("2026-06");
  const [budgetName, setBudgetName] = useState("Q3 plan");
  const [result, setResult] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const busy = actionState?.startsWith("cfo:");

  useEffect(() => { setResult(null); setAiResult(null); }, [tab]);

  async function call(method, url, payload) {
    return await onApi(url, { method, body: payload });
  }

  async function loadCashflow() {
    const res = await call("GET", `/api/cfo/cash-flow?periodKey=${encodeURIComponent(periodKey)}`);
    setResult({ kind: "cashflow", data: res.cashFlow });
  }
  async function createBudget() {
    const res = await call("POST", "/api/cfo/budgets", {
      name: budgetName, periodKey, currency: "AMD", idempotencyKey: `ui-budget-${Date.now()}`
    });
    setResult({ kind: "budget", data: res.budget });
  }
  async function loadTreasury() {
    const res = await call("GET", "/api/cfo/treasury/positions");
    setResult({ kind: "treasury", data: res.treasury });
  }
  async function loadCalendar() {
    const res = await call("GET", `/api/cfo/payment-calendar?from=${periodKey}-01&to=${periodKey}-30`);
    setResult({ kind: "calendar", data: res.calendar });
  }
  async function loadLoans() {
    const res = await call("POST", "/api/cfo/loans", {
      lender: "Ameriabank", principalAmd: 1_200_000, currency: "AMD", ratePct: 12, termMonths: 12, startDate: `${periodKey}-15`, scheduleKind: "annuity",
      idempotencyKey: `ui-loan-${Date.now()}`
    });
    const schedule = await call("GET", `/api/cfo/loans/${encodeURIComponent(res.loan.id)}/schedule`);
    setResult({ kind: "loans", data: { loan: res.loan, schedule: schedule.schedule } });
  }
  async function askAi(intent) {
    const url = intent === "cfo-forecast" ? "/api/cfo/ai/forecast" : intent === "cfo-fx" ? "/api/cfo/ai/fx-risk" : "/api/cfo/ai/debt-load";
    const res = await call("POST", url, { periodKey, question: `${intent} for ${periodKey}`, idempotencyKey: `ui-${intent}-${Date.now()}` });
    setAiResult(res.copilot);
  }

  return (
    <article className="panel cfo-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">CFO</span>
          <h2>{"Ֆինանսական կարագավարում"}</h2>
        </div>
        <nav className="row" role="tablist" aria-label="CFO tabs">
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

      <div className="inline-form">
        <label className="section-label" htmlFor="cfo-period">{"Շրջան"}</label>
        <input id="cfo-period" value={periodKey} onChange={event => setPeriodKey(event.target.value)} placeholder="YYYY-MM" />
        {tab === "budget" && canEdit && (
          <>
            <label className="section-label" htmlFor="cfo-bname">{"Բյուժեի անվանում"}</label>
            <input id="cfo-bname" value={budgetName} onChange={event => setBudgetName(event.target.value)} />
          </>
        )}
      </div>

      <div className="row">
        {tab === "cashflow" && <button className="mini-action" type="button" disabled={busy} onClick={loadCashflow}>{"Բեռնել կանխիկային հոսքը"}</button>}
        {tab === "budget" && canEdit && <button className="mini-action" type="button" disabled={busy} onClick={createBudget}>{"Ստեղածել բյուժե"}</button>}
        {tab === "treasury" && <button className="mini-action" type="button" disabled={busy} onClick={loadTreasury}>{"Բեռնել գանաարանը"}</button>}
        {tab === "calendar" && <button className="mini-action" type="button" disabled={busy} onClick={loadCalendar}>{"Բեռնել Վճարումների փրաձույաձը"}</button>}
        {tab === "loans" && canEdit && <button className="mini-action" type="button" disabled={busy} onClick={loadLoans}>{"Ստեղածել և ցույձ տալ Վարկի ժամանակացույաձը"}</button>}
      </div>

      <div className="row">
        <button className="mini-action" type="button" disabled={busy} onClick={() => askAi("cfo-forecast")}>{"AI. Իրաձվելիուչյուն կանխատեսում"}</button>
        <button className="mini-action" type="button" disabled={busy} onClick={() => askAi("cfo-fx")}>{"AI. Արտարժույտային ռիսկ"}</button>
        <button className="mini-action" type="button" disabled={busy} onClick={() => askAi("cfo-debt")}>{"AI. Պարտքային անանցանբեռնվածուչյուն"}</button>
      </div>

      {result && (
        <div className="copilot-result" data-testid="cfo-result">
          {result.kind === "cashflow" && (
            <>
              <p>{"Բաձվուակք"}: <strong>{result.data.openingAmd} AMD</strong></p>
              <p>{"Վերձնական մնացորդ"}: <strong>{result.data.closingAmd} AMD</strong></p>
              <SvgLine points={result.data.weekly.map(w => ({ value: w.closing }))} />
              <ul>
                {result.data.weekly.map(w => (
                  <li key={w.weekKey}>{w.weekKey} — {"մուտլ"} {w.inflow}, {"ելլ"} {w.outflow}, {"զուտ"} {w.net}, {"մնացորդ"} {w.closing} <span className="aging-badge">{w.closing < 0 ? "Բաձվուակք" : "Լավ"}</span></li>
                ))}
              </ul>
            </>
          )}
          {result.kind === "budget" && (
            <p>{"Բյուժե"} <strong>{result.data.name}</strong>, {"Շրջան"} <strong>{result.data.periodKey}</strong>, {"արժույթ"} <strong>{result.data.currency}</strong></p>
          )}
          {result.kind === "treasury" && (
            <ul>{result.data.map(row => <li key={row.currency}>{row.currency}: {row.balance} AMD ({row.accountCount} {"հաշիվ"})</li>)}</ul>
          )}
          {result.kind === "calendar" && (
            <ul>{result.data.entries.map((e, i) => <li key={`${e.date}-${i}`}>{e.date} — {e.amount} AMD ({e.kind})</li>)}</ul>
          )}
          {result.kind === "loans" && (
            <SvgBars rows={result.data.schedule.map(r => ({ label: r.periodKey, value: r.principalDue + r.interestDue }))} />
          )}
        </div>
      )}

      {aiResult && (
        <div className="copilot-result" data-testid="cfo-ai">
          <p className="action-status">AI ({aiResult.intent}, {aiResult.aiSource})</p>
          <p>{aiResult.answer}</p>
          <p className="action-status">{"Վստահություն"}: {aiResult.confidence}, {"ռիսկի մակարդաչ"}: {aiResult.riskLevel}</p>
        </div>
      )}
    </article>
  );
}
