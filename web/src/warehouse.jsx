import React, { useEffect, useMemo, useState } from "react";

const amd = value => `${Number(value || 0).toLocaleString("hy-AM")} AMD`;
const num = value => Number(value || 0).toLocaleString("hy-AM");

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`mini-action ${active ? "" : "secondary"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function LotsTab({ lots, onCreate, onSelect, busy }) {
  const [productId, setProductId] = useState("catitem-pos-barcode-scanner");
  const [lotCode, setLotCode] = useState("LOT-2026-001");
  const [expiryDate, setExpiryDate] = useState("2027-06-01");
  return (
    <div className="rows">
      <form
        className="inline-form"
        onSubmit={event => {
          event.preventDefault();
          onCreate({ productId, lotCode, expiryDate });
        }}
      >
        <label>
          Ապրանք
          <input value={productId} onChange={event => setProductId(event.target.value)} disabled={busy} />
        </label>
        <label>
          Խմբի կոդ
          <input value={lotCode} onChange={event => setLotCode(event.target.value)} disabled={busy} />
        </label>
        <label>
          Պիտանիության ժամկետ
          <input value={expiryDate} onChange={event => setExpiryDate(event.target.value)} disabled={busy} />
        </label>
        <button className="mini-action" type="submit" disabled={busy}>
          {busy ? "Ավելացվում է…" : "Ավելացնել խմբաքանակ"}
        </button>
      </form>
      {lots.map(lot => (
        <div className="row warehouse-lot" key={lot.id} onClick={() => onSelect(lot)}>
          <span>
            {lot.lotCode} · պիտանիություն <strong>{lot.expiryDate || "առանց ժամկետի"}</strong>
          </span>
          <strong>{num(lot.id)}</strong>
        </div>
      ))}
      {lots.length === 0 && <div className="row"><span>Խմբաքանակներ դեռ չկան</span></div>}
    </div>
  );
}

function SerialsTab({ serials, onRegister, busy }) {
  const [productId, setProductId] = useState("catitem-pos-barcode-scanner");
  const [serial, setSerial] = useState("SN-2026-001");
  return (
    <div className="rows">
      <form
        className="inline-form"
        onSubmit={event => {
          event.preventDefault();
          onRegister({ productId, serial });
        }}
      >
        <label>
          Ապրանք
          <input value={productId} onChange={event => setProductId(event.target.value)} disabled={busy} />
        </label>
        <label>
          Սերիական համար
          <input value={serial} onChange={event => setSerial(event.target.value)} disabled={busy} />
        </label>
        <button className="mini-action" type="submit" disabled={busy}>
          {busy ? "Գրանցվում է…" : "Գրանցել սերիական համարը"}
        </button>
      </form>
      {serials.map(item => (
        <div className="row warehouse-serial" key={item.id}>
          <span>
            {item.serial} · {item.productId} · {item.status}
          </span>
          <strong>{item.currentLocationId || "առանց տեղադրության"}</strong>
        </div>
      ))}
      {serials.length === 0 && <div className="row"><span>Սերիական համարներ դեռ չկան</span></div>}
    </div>
  );
}

function ColdStorageTab({ readings, onRecord, busy }) {
  const [locationId, setLocationId] = useState("stockloc-main-warehouse");
  const [tempC, setTempC] = useState("4.0");
  const [humidity, setHumidity] = useState("75");
  return (
    <div className="rows">
      <form
        className="inline-form"
        onSubmit={event => {
          event.preventDefault();
          onRecord({ locationId, recordedAt: new Date().toISOString(), tempC: Number(tempC), humidity: Number(humidity), sensorId: "panel-ui" });
        }}
      >
        <label>
          Տեղադրություն
          <input value={locationId} onChange={event => setLocationId(event.target.value)} disabled={busy} />
        </label>
        <label>
          Ջերմաստիճան (°C)
          <input value={tempC} onChange={event => setTempC(event.target.value)} inputMode="decimal" disabled={busy} />
        </label>
        <label>
          Խոնավություն (%)
          <input value={humidity} onChange={event => setHumidity(event.target.value)} inputMode="decimal" disabled={busy} />
        </label>
        <button className="mini-action" type="submit" disabled={busy}>
          {busy ? "Հիշվում է…" : "Գրանցել սենսորի տվյալը"}
        </button>
      </form>
      {readings.map(reading => (
        <div className="row warehouse-cold-storage" key={reading.id}>
          <span>
            {reading.locationId} · {new Date(reading.recordedAt).toLocaleString("hy-AM")}
          </span>
          <strong>{Number(reading.tempC).toFixed(1)}°C · {reading.humidity == null ? "—" : `${Math.round(reading.humidity)}%`}</strong>
        </div>
      ))}
      {readings.length === 0 && <div className="row"><span>Սենսորի տվյալներ դեռ չկան</span></div>}
    </div>
  );
}

function AnalyticsTab({ abc, turnover, forecast, onForecast, busy }) {
  const [productId, setProductId] = useState("catitem-pos-barcode-scanner");
  return (
    <div className="rows">
      <div className="panel-head"><h3>ABC վերլուծություն (2026-Q2)</h3></div>
      {abc.map(row => (
        <div className="row warehouse-abc" key={row.productId}>
          <span>
            <strong className="aging-badge">{row.bucket}</strong> {row.productId}
          </span>
          <strong>{Math.round(row.revenueShare * 100)}% · կուտակային {Math.round(row.cumulativeShare * 100)}%</strong>
        </div>
      ))}
      {abc.length === 0 && <div className="row"><span>Վաճառքի տվյալներ դեռ չկան</span></div>}
      <div className="panel-head"><h3>Շրջանառություն (օրեր)</h3></div>
      {turnover.map(row => (
        <div className="row warehouse-turnover" key={row.productId}>
          <span>{row.productId}</span>
          <strong>{row.turnoverDays} օր</strong>
        </div>
      ))}
      {turnover.length === 0 && <div className="row"><span>Շրջանառության տվյալներ դեռ չկան</span></div>}
      <form
        className="inline-form"
        onSubmit={event => {
          event.preventDefault();
          onForecast({ productId, horizonDays: 14, intent: "warehouse-restock" });
        }}
      >
        <label>
          Ապրանքի ID
          <input value={productId} onChange={event => setProductId(event.target.value)} disabled={busy} />
        </label>
        <button className="mini-action" type="submit" disabled={busy}>
          {busy ? "Հաշվարկվում է…" : "Կանխատեսել վերապահեստավորումը"}
        </button>
      </form>
      {forecast && (
        <div className="copilot-result">
          <p>Առաջարկվող քանակ՝ <strong>{num(forecast.suggestedQuantity)}</strong></p>
          <p className="action-status">աղբյուր՝ {forecast.source} · {forecast.reasoning.join(" / ")}</p>
        </div>
      )}
    </div>
  );
}

export function WarehousePanel({
  lots,
  serials,
  readings,
  abc,
  turnover,
  forecast,
  actionState,
  onCreateLot,
  onRegisterSerial,
  onRecordReading,
  onRunForecast
}) {
  const [tab, setTab] = useState("lots");
  const busy = actionState === "warehouse:running";
  return (
    <article className="panel warehouse-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Պահեստի ընդլայնում</span>
          <h2>Խմբաքանակներ, սերիաներ, սառը պահեստ, վերլուծություն</h2>
        </div>
        <strong className="aging-badge">{lots.length} խմբաքանակ</strong>
      </div>
      <div className="inline-form">
        <TabButton active={tab === "lots"} onClick={() => setTab("lots")}>Խմբաքանակներ</TabButton>
        <TabButton active={tab === "serials"} onClick={() => setTab("serials")}>Սերիաներ</TabButton>
        <TabButton active={tab === "cold"} onClick={() => setTab("cold")}>Սառը պահեստ</TabButton>
        <TabButton active={tab === "analytics"} onClick={() => setTab("analytics")}>Վերլուծություն</TabButton>
      </div>
      {tab === "lots" && <LotsTab lots={lots} onCreate={onCreateLot} onSelect={() => {}} busy={busy} />}
      {tab === "serials" && <SerialsTab serials={serials} onRegister={onRegisterSerial} busy={busy} />}
      {tab === "cold" && <ColdStorageTab readings={readings} onRecord={onRecordReading} busy={busy} />}
      {tab === "analytics" && <AnalyticsTab abc={abc} turnover={turnover} forecast={forecast} onForecast={onRunForecast} busy={busy} />}
    </article>
  );
}
