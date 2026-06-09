import React, { useEffect, useMemo, useState } from "react";

const TABS = [
  { id: "registry", label: "Ռեեստր" },
  { id: "depreciation", label: "Հարկում" },
  { id: "maintenance", label: "Սպասարկում" },
  { id: "assignment", label: "Հանձնարարություն" }
];

export function AssetsPanel({ api, actionState }) {
  const [tab, setTab] = useState("registry");
  const [categories, setCategories] = useState([]);
  const [assets, setAssets] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [maintenance, setMaintenance] = useState([]);
  const [error, setError] = useState("");

  const busy = useMemo(() => actionState && actionState.startsWith("assets:"), [actionState]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/assets/report/value");
        if (!cancelled) setAssets(res.rollup || []);
      } catch (err) {
        if (!cancelled) setError(err.message || "Բեռնումը ձախողվեց");
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  async function loadSchedule(assetId) {
    setError("");
    const res = await api(`/api/assets/${assetId}/depreciation`);
    setSchedule(res);
  }

  async function loadMaintenance(assetId) {
    setError("");
    const res = await api(`/api/assets/${assetId}/maintenance-history`);
    setMaintenance(res.logs || []);
  }

  async function postDepreciation(assetId, periodKey) {
    setError("");
    await api(`/api/assets/${assetId}/post-depreciation`, {
      method: "POST",
      body: { periodKey, monthIndex: 0, idempotencyKey: `ui-post-depr-${Date.now()}` }
    });
  }

  return (
    <article className="panel assets-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Հաշվառում № 01 / 04</span>
          <h2>Հիմնական միջոցների կառավարում</h2>
        </div>
        <nav className="row" role="tablist">
          {TABS.map(item => (
            <button
              key={item.id}
              type="button"
              className={`mini-action ${tab === item.id ? "is-active" : ""}`}
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {error && <p className="action-status aging-badge">{error}</p>}

      {tab === "registry" && (
        <div className="copilot-result">
          <h3>Ընդհանուր արժեք՝ ըստ կատեգորիաների</h3>
          <table className="row">
            <thead>
              <tr><th>Կատեգորիա</th><th>Քանակ</th><th>Արժեք (AMD)</th><th>Մնացորդային արժեք</th></tr>
            </thead>
            <tbody>
              {assets.map(row => (
                <tr key={row.categoryId}>
                  <td>{row.categoryId}</td>
                  <td>{row.count}</td>
                  <td>{row.totalCostAmd.toLocaleString("hy-AM")}</td>
                  <td>{row.totalNbvAmd.toLocaleString("hy-AM")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "depreciation" && (
        <div className="inline-form">
          <input id="asset-schedule-id" placeholder="Ակտիվի ID" />
          <button className="mini-action" type="button" disabled={busy} onClick={() => loadSchedule(document.getElementById("asset-schedule-id").value)}>
            Հաշվել գրաֆիկը
          </button>
          {schedule && (
            <div className="copilot-result">
              <h3>Հարկման գրաֆիկ ({schedule.schedule.length} ամիս)</h3>
              <ol>
                {schedule.schedule.slice(0, 12).map(line => (
                  <li key={line.periodIndex}>
                    #{line.periodIndex + 1}: {line.depreciationAmd.toLocaleString("hy-AM")} AMD / NBV {line.netBookValueAmd.toLocaleString("hy-AM")}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {tab === "maintenance" && (
        <div className="inline-form">
          <input id="asset-maint-id" placeholder="Ակտիվի ID" />
          <button className="mini-action" type="button" disabled={busy} onClick={() => loadMaintenance(document.getElementById("asset-maint-id").value)}>
            Բեռնել պատմությունը
          </button>
          {maintenance.length > 0 && (
            <div className="copilot-result">
              <h3>Վերջին սպասարկումներ</h3>
              <ul>
                {maintenance.map(log => (
                  <li key={log.id}>{log.performed_at} - {log.kind} ({log.cost_amd.toLocaleString("hy-AM")} AMD)</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "assignment" && (
        <div className="inline-form">
          <input id="asset-assign-id" placeholder="Ակտիվի ID" />
          <input id="asset-assign-type" placeholder="Տիպ (employee)" />
          <input id="asset-assign-target" placeholder="Աշխատակցի ID" />
          <button
            className="mini-action"
            type="button"
            disabled={busy}
            onClick={async () => {
              const assetId = document.getElementById("asset-assign-id").value;
              const assigneeType = document.getElementById("asset-assign-type").value;
              const assigneeId = document.getElementById("asset-assign-target").value;
              await api(`/api/assets/${assetId}/assign`, {
                method: "POST",
                body: { assigneeType, assigneeId, idempotencyKey: `ui-assign-${Date.now()}` }
              });
            }}
          >
            Հանձնել
          </button>
        </div>
      )}
    </article>
  );
}
