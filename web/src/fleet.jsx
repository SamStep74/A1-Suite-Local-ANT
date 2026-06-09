import React, { useState, useEffect, useCallback } from "react";

const TABS = [
  { id: "vehicles",   label: "Ավտոմեքենաներ / Vehicles" },
  { id: "drivers",    label: "Վարորդներ / Drivers" },
  { id: "trips",      label: "Ուղևորություններ / Trips" },
  { id: "fuel",       label: "Վառելիք / Fuel" },
  { id: "repairs",    label: "Վերանորոգումներ / Repairs" },
  { id: "tires",      label: "Անվադողեր / Tires" },
  { id: "coldchain",  label: "Սառը շղթա / Cold-Chain" }
];

const TRIP_STATES = ["planned", "in_transit", "arrived", "cancelled"];
const COLD_CHAIN_CATEGORIES = ["dairy", "frozen", "produce", "meat", "default"];

export function FleetPanel({ api, actionState, canWrite }) {
  const [tab, setTab] = useState("vehicles");
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [trips, setTrips] = useState([]);
  const [fuelLogs, setFuelLogs] = useState([]);
  const [repairs, setRepairs] = useState([]);
  const [tires, setTires] = useState([]);
  const [coldChain, setColdChain] = useState([]);
  const [fuelEff, setFuelEff] = useState([]);
  const [backlog, setBacklog] = useState([]);
  const [error, setError] = useState("");
  const [compliance, setCompliance] = useState(null);
  const busy = actionState && actionState.startsWith("fleet");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [v, d, t, f, r, ti, c, fe, bl] = await Promise.all([
        api("/api/fleet/vehicles").catch(() => ({ vehicles: [] })),
        api("/api/fleet/drivers").catch(() => ({ drivers: [] })),
        api("/api/fleet/trips").catch(() => ({ trips: [] })),
        api("/api/fleet/fuel-logs").catch(() => ({ fuelLogs: [] })),
        api("/api/fleet/repairs").catch(() => ({ repairs: [] })),
        api("/api/fleet/tires").catch(() => ({ tires: [] })),
        api("/api/fleet/cold-chain").catch(() => ({ logs: [] })),
        api("/api/fleet/analytics/fuel-efficiency?periodKey=" + new Date().toISOString().slice(0, 7)).catch(() => ({ efficiency: [] })),
        api("/api/fleet/analytics/maintenance-backlog").catch(() => ({ backlog: [] }))
      ]);
      setVehicles(v.vehicles || []);
      setDrivers(d.drivers || []);
      setTrips(t.trips || []);
      setFuelLogs(f.fuelLogs || []);
      setRepairs(r.repairs || []);
      setTires(ti.tires || []);
      setColdChain(c.logs || []);
      setFuelEff(fe.efficiency || []);
      setBacklog(bl.backlog || []);
    } catch (err) {
      setError(String(err.message || err));
    }
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  async function loadCompliance(vehicleId, category) {
    setError("");
    const r = await api(`/api/fleet/vehicles/${encodeURIComponent(vehicleId)}/cold-chain-compliance?category=${category || "default"}`);
    setCompliance(r);
  }

  return (
    <div className="suite-app-anchor" id="suite-app-fleet">
      <div className="card">
        <h2>Ավտոպարկ / Fleet Management</h2>
        <p className="muted">Փոխադրամիջոցներ, վարորդներ, երթուղիներ, վառելիք, վերանորոգում, անվադողեր, սառը շղթա</p>
        {error && <p className="error">{error}</p>}
        <div className="tabs" role="tablist">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "tab tab-active" : "tab"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "vehicles" && <VehiclesTab api={api} canWrite={canWrite} vehicles={vehicles} refresh={refresh} busy={busy} />}
        {tab === "drivers" && <DriversTab api={api} canWrite={canWrite} drivers={drivers} refresh={refresh} busy={busy} />}
        {tab === "trips" && <TripsTab api={api} canWrite={canWrite} trips={trips} vehicles={vehicles} drivers={drivers} refresh={refresh} busy={busy} />}
        {tab === "fuel" && <FuelTab api={api} canWrite={canWrite} logs={fuelLogs} eff={fuelEff} vehicles={vehicles} refresh={refresh} busy={busy} />}
        {tab === "repairs" && <RepairsTab api={api} canWrite={canWrite} repairs={repairs} backlog={backlog} vehicles={vehicles} refresh={refresh} busy={busy} />}
        {tab === "tires" && <TiresTab api={api} canWrite={canWrite} tires={tires} vehicles={vehicles} refresh={refresh} busy={busy} />}
        {tab === "coldchain" && <ColdChainTab api={api} canWrite={canWrite} logs={coldChain} vehicles={vehicles} compliance={compliance} loadCompliance={loadCompliance} busy={busy} />}
      </div>
    </div>
  );
}

function VehiclesTab({ api, canWrite, vehicles, refresh, busy }) {
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");

  async function createVehicle(e) {
    e.preventDefault();
    await api("/api/fleet/vehicles", {
      method: "POST",
      body: { plate, make, model, year: Number(year) || null, kind: "truck" }
    });
    setPlate(""); setMake(""); setModel(""); setYear("");
    refresh();
  }

  return (
    <div>
      {canWrite && (
        <form onSubmit={createVehicle} className="form-inline">
          <input placeholder="Պետհամարանիշ / Plate" value={plate} onChange={e => setPlate(e.target.value)} required />
          <input placeholder="Արտադրող / Make" value={make} onChange={e => setMake(e.target.value)} required />
          <input placeholder="Մոդել / Model" value={model} onChange={e => setModel(e.target.value)} required />
          <input placeholder="Տարի / Year" type="number" value={year} onChange={e => setYear(e.target.value)} />
          <button type="submit" disabled={busy}>Ավելացնել / Add</button>
        </form>
      )}
      <table className="data-table">
        <thead>
          <tr><th>Պետ. համար</th><th>Make</th><th>Model</th><th>Տարի</th></tr>
        </thead>
        <tbody>
          {vehicles.length === 0 && <tr><td colSpan={4} className="muted">Դատարկ / empty</td></tr>}
          {vehicles.map(v => (
            <tr key={v.id}>
              <td>{v.plate}</td>
              <td>{v.make}</td>
              <td>{v.model}</td>
              <td>{v.year || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DriversTab({ api, canWrite, drivers, refresh, busy }) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");

  async function createDriver(e) {
    e.preventDefault();
    await api("/api/fleet/drivers", { method: "POST", body: { fullName, phone, licenseNumber } });
    setFullName(""); setPhone(""); setLicenseNumber("");
    refresh();
  }

  return (
    <div>
      {canWrite && (
        <form onSubmit={createDriver} className="form-inline">
          <input placeholder="Անուն Ազգանուն / Full name" value={fullName} onChange={e => setFullName(e.target.value)} required />
          <input placeholder="Հեռախոս / Phone" value={phone} onChange={e => setPhone(e.target.value)} />
          <input placeholder="Վարորդական վկայական / License" value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} required />
          <button type="submit" disabled={busy}>Ավելացնել / Add</button>
        </form>
      )}
      <table className="data-table">
        <thead><tr><th>Անուն</th><th>Հեռախոս</th><th>Լիցենզիա</th></tr></thead>
        <tbody>
          {drivers.length === 0 && <tr><td colSpan={3} className="muted">Դատարկ / empty</td></tr>}
          {drivers.map(d => (
            <tr key={d.id}>
              <td>{d.fullName}</td>
              <td>{d.phone || "—"}</td>
              <td>{d.licenseNumber}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TripsTab({ api, canWrite, trips, vehicles, drivers, refresh, busy }) {
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [scheduledDeparture, setScheduledDeparture] = useState("");

  async function createTrip(e) {
    e.preventDefault();
    await api("/api/fleet/trips", {
      method: "POST",
      body: { vehicleId, driverId, origin, destination, scheduledDeparture }
    });
    setVehicleId(""); setDriverId(""); setOrigin(""); setDestination(""); setScheduledDeparture("");
    refresh();
  }

  async function patchStatus(tripId, action) {
    await api(`/api/fleet/trips/${encodeURIComponent(tripId)}/status`, { method: "PATCH", body: { action } });
    refresh();
  }

  return (
    <div>
      {canWrite && (
        <form onSubmit={createTrip} className="form-inline">
          <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} required>
            <option value="">— Ավտոմեքենա / Vehicle —</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate}</option>)}
          </select>
          <select value={driverId} onChange={e => setDriverId(e.target.value)} required>
            <option value="">— Վարորդ / Driver —</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.fullName}</option>)}
          </select>
          <input placeholder="Ուղարկում / Origin" value={origin} onChange={e => setOrigin(e.target.value)} required />
          <input placeholder="Նպատակ / Destination" value={destination} onChange={e => setDestination(e.target.value)} required />
          <input type="datetime-local" value={scheduledDeparture} onChange={e => setScheduledDeparture(e.target.value)} required />
          <button type="submit" disabled={busy}>Ստեղծել / Create</button>
        </form>
      )}
      <table className="data-table">
        <thead><tr><th>#</th><th>Վիճակ</th><th>Ուղարկում</th><th>Նպատակ</th><th>Գործողություն</th></tr></thead>
        <tbody>
          {trips.length === 0 && <tr><td colSpan={5} className="muted">Դատարկ / empty</td></tr>}
          {trips.map(t => (
            <tr key={t.id}>
              <td>{t.id.slice(-6)}</td>
              <td>{t.status}</td>
              <td>{t.origin}</td>
              <td>{t.destination}</td>
              <td>
                {canWrite && t.status === "planned" && (
                  <button onClick={() => patchStatus(t.id, "departed")} disabled={busy}>Մեկնել / Depart</button>
                )}
                {canWrite && t.status === "in_transit" && (
                  <button onClick={() => patchStatus(t.id, "arrived")} disabled={busy}>Ժամանել / Arrive</button>
                )}
                {canWrite && (t.status === "planned" || t.status === "in_transit") && (
                  <button onClick={() => patchStatus(t.id, "cancelled")} disabled={busy}>Չեղարկել / Cancel</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FuelTab({ api, canWrite, logs, eff, vehicles, refresh, busy }) {
  const [vehicleId, setVehicleId] = useState("");
  const [liters, setLiters] = useState("");
  const [odometerKm, setOdometerKm] = useState("");
  const [fuelCostPerL, setFuelCostPerL] = useState("");

  async function logFuel(e) {
    e.preventDefault();
    await api("/api/fleet/fuel-logs", {
      method: "POST",
      body: {
        vehicleId,
        liters: Number(liters),
        odometerKm: Number(odometerKm),
        fuelCostPerL: Number(fuelCostPerL)
      }
    });
    setVehicleId(""); setLiters(""); setOdometerKm(""); setFuelCostPerL("");
    refresh();
  }

  return (
    <div>
      {canWrite && (
        <form onSubmit={logFuel} className="form-inline">
          <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} required>
            <option value="">— Ավտոմեքենա —</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate}</option>)}
          </select>
          <input type="number" step="0.01" placeholder="Լիտր / Liters" value={liters} onChange={e => setLiters(e.target.value)} required />
          <input type="number" placeholder="Օդոմետր / Odometer (km)" value={odometerKm} onChange={e => setOdometerKm(e.target.value)} required />
          <input type="number" step="0.01" placeholder="Գին /լ / Cost per L" value={fuelCostPerL} onChange={e => setFuelCostPerL(e.target.value)} required />
          <button type="submit" disabled={busy}>Գրանցել / Log</button>
        </form>
      )}
      <h3>Վերջին գրառումներ / Recent logs</h3>
      <table className="data-table">
        <thead><tr><th>Ավտոմեքենա</th><th>Լիտր</th><th>Օդոմետր</th><th>Ամսաթիվ</th></tr></thead>
        <tbody>
          {logs.length === 0 && <tr><td colSpan={4} className="muted">Դատարկ / empty</td></tr>}
          {logs.map(f => (
            <tr key={f.id}>
              <td>{f.vehicleId.slice(-6)}</td>
              <td>{f.liters}</td>
              <td>{f.odometerKm}</td>
              <td>{f.occurredAt?.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Արդյունավետություն / Efficiency (this month)</h3>
      <table className="data-table">
        <thead><tr><th>Ավտոմեքենա</th><th>Liters</th><th>km</th><th>L/100km</th><th>km/L</th></tr></thead>
        <tbody>
          {eff.length === 0 && <tr><td colSpan={5} className="muted">Տվյալներ չկան / no data</td></tr>}
          {eff.map(e => (
            <tr key={e.vehicleId}>
              <td>{e.vehicleId.slice(-6)}</td>
              <td>{e.liters}</td>
              <td>{e.km}</td>
              <td>{e.lPer100km}</td>
              <td>{e.kmPerL?.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RepairsTab({ api, canWrite, repairs, backlog, vehicles, refresh, busy }) {
  const [vehicleId, setVehicleId] = useState("");
  const [kind, setKind] = useState("");
  const [odometerKm, setOdometerKm] = useState("");
  const [cost, setCost] = useState("");
  const [nextDueAt, setNextDueAt] = useState("");

  async function logRepair(e) {
    e.preventDefault();
    await api("/api/fleet/repairs", {
      method: "POST",
      body: { vehicleId, kind, odometerKm: Number(odometerKm), cost: Number(cost), nextDueAt: nextDueAt || null }
    });
    setVehicleId(""); setKind(""); setOdometerKm(""); setCost(""); setNextDueAt("");
    refresh();
  }

  return (
    <div>
      {canWrite && (
        <form onSubmit={logRepair} className="form-inline">
          <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} required>
            <option value="">— Ավտոմեքենա —</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate}</option>)}
          </select>
          <input placeholder="Տեսակ / Kind" value={kind} onChange={e => setKind(e.target.value)} required />
          <input type="number" placeholder="Օդոմետր / Odometer" value={odometerKm} onChange={e => setOdometerKm(e.target.value)} required />
          <input type="number" placeholder="Արժեք / Cost" value={cost} onChange={e => setCost(e.target.value)} required />
          <input type="date" placeholder="Հաջորդ ժամկետ / Next due" value={nextDueAt} onChange={e => setNextDueAt(e.target.value)} />
          <button type="submit" disabled={busy}>Գրանցել / Log</button>
        </form>
      )}
      <h3>Հետընթաց ցուցակ / Backlog</h3>
      <table className="data-table">
        <thead><tr><th>Ավտոմեքենա</th><th>Տեսակ</th><th>Ուշացած օրեր</th></tr></thead>
        <tbody>
          {backlog.length === 0 && <tr><td colSpan={3} className="muted">Դատարկ / empty</td></tr>}
          {backlog.map(b => (
            <tr key={b.vehicleId + b.kind}>
              <td>{b.vehicleId.slice(-6)}</td>
              <td>{b.kind}</td>
              <td>{b.overdueDays}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Վերանորոգումներ / Repairs</h3>
      <table className="data-table">
        <thead><tr><th>Ավտոմեքենա</th><th>Տեսակ</th><th>Արժեք</th><th>Ամսաթիվ</th></tr></thead>
        <tbody>
          {repairs.length === 0 && <tr><td colSpan={4} className="muted">Դատարկ / empty</td></tr>}
          {repairs.map(r => (
            <tr key={r.id}>
              <td>{r.vehicleId.slice(-6)}</td>
              <td>{r.kind}</td>
              <td>{r.cost}</td>
              <td>{r.performedAt?.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TiresTab({ api, canWrite, tires, vehicles, refresh, busy }) {
  const [vehicleId, setVehicleId] = useState("");
  const [position, setPosition] = useState("");
  const [brand, setBrand] = useState("");
  const [installedAt, setInstalledAt] = useState("");
  const [odometerAtInstall, setOdometerAtInstall] = useState("");
  const [expectedLifeKm, setExpectedLifeKm] = useState("");

  async function installTire(e) {
    e.preventDefault();
    await api("/api/fleet/tires/install", {
      method: "POST",
      body: {
        vehicleId, position, brand, installedAt,
        odometerAtInstall: Number(odometerAtInstall) || null,
        expectedLifeKm: Number(expectedLifeKm) || null
      }
    });
    setVehicleId(""); setPosition(""); setBrand(""); setInstalledAt(""); setOdometerAtInstall(""); setExpectedLifeKm("");
    refresh();
  }

  return (
    <div>
      {canWrite && (
        <form onSubmit={installTire} className="form-inline">
          <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} required>
            <option value="">— Ավտոմեքենա —</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate}</option>)}
          </select>
          <input placeholder="Դիրք / Position" value={position} onChange={e => setPosition(e.target.value)} required />
          <input placeholder="Ապրանքանիշ / Brand" value={brand} onChange={e => setBrand(e.target.value)} />
          <input type="date" value={installedAt} onChange={e => setInstalledAt(e.target.value)} required />
          <input type="number" placeholder="Օդոմետր / Odometer" value={odometerAtInstall} onChange={e => setOdometerAtInstall(e.target.value)} />
          <input type="number" placeholder="Ռեսուրս / Expected life km" value={expectedLifeKm} onChange={e => setExpectedLifeKm(e.target.value)} />
          <button type="submit" disabled={busy}>Տեղադրել / Install</button>
        </form>
      )}
      <table className="data-table">
        <thead><tr><th>Ավտոմեքենա</th><th>Դիրք</th><th>Ապրանքանիշ</th><th>Տեղադրման օր</th></tr></thead>
        <tbody>
          {tires.length === 0 && <tr><td colSpan={4} className="muted">Դատարկ / empty</td></tr>}
          {tires.map(t => (
            <tr key={t.id}>
              <td>{t.vehicleId.slice(-6)}</td>
              <td>{t.position}</td>
              <td>{t.brand || "—"}</td>
              <td>{t.installedAt?.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ColdChainTab({ api, canWrite, logs, vehicles, compliance, loadCompliance, busy }) {
  const [vehicleId, setVehicleId] = useState("");
  const [category, setCategory] = useState("dairy");

  return (
    <div>
      <div className="form-inline">
        <select value={vehicleId} onChange={e => setVehicleId(e.target.value)}>
          <option value="">— Ավտոմեքենա —</option>
          {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value)}>
          {COLD_CHAIN_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => vehicleId && loadCompliance(vehicleId, category)} disabled={!vehicleId || busy}>
          Հաշվել համապատասխանությունը / Compute compliance
        </button>
      </div>
      {compliance && (
        <div className="card-inner">
          <h3>Համապատասխանություն / Compliance</h3>
          <p>Category: <strong>{compliance.category}</strong> · Worst: <strong>{compliance.report?.worstTempC}</strong>°C · Sustained out-of-range: <strong>{compliance.report?.sustainedMinutes}</strong> min</p>
          {compliance.report?.breaches?.length === 0 && <p className="ok">✓ Խախտում չկա / No breaches</p>}
          {compliance.report?.breaches?.length > 0 && (
            <table className="data-table">
              <thead><tr><th>Սկիզբ</th><th>Վերջ</th><th>Տևողություն (րոպե)</th></tr></thead>
              <tbody>
                {compliance.report.breaches.map((b, idx) => (
                  <tr key={idx}>
                    <td>{b.startedAt?.slice(0, 16)}</td>
                    <td>{b.endedAt?.slice(0, 16)}</td>
                    <td>{b.minutes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <h3>Վերջին ընթերցումներ / Recent readings</h3>
      <table className="data-table">
        <thead><tr><th>Ավտոմեքենա</th><th>°C</th><th>Խոնավություն</th><th>Ամսաթիվ</th></tr></thead>
        <tbody>
          {logs.length === 0 && <tr><td colSpan={4} className="muted">Դատարկ / empty</td></tr>}
          {logs.map(l => (
            <tr key={l.id}>
              <td>{l.vehicleId?.slice(-6)}</td>
              <td>{l.tempC}</td>
              <td>{l.humidity ?? "—"}</td>
              <td>{l.recordedAt?.slice(0, 16)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
