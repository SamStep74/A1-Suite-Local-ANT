/**
 * Fleet panels — extracted from routes/app/fleet/index.tsx in Phase 10.0.
 *
 * Each function is a self-contained form/table used by the Fleet workspace.
 * No route context dependencies — all data is passed as props. The route
 * file re-exports these named symbols so existing co-located tests
 * (./index) keep working without changes.
 */
import { useState } from "react";
import { Circle, Fuel, Map, Plus, Send, Thermometer, Truck, User, Wrench } from "lucide-react";
import {
  type FleetColdChainComplianceResponse,
  type FleetColdChainLog,
  type FleetColdChainCategory,
  type FleetDriver,
  type FleetFuelEfficiencyRow,
  type FleetFuelLog,
  type FleetMaintenanceBacklogRow,
  type FleetRepair,
  type FleetTire,
  type FleetTrip,
  type FleetTripAction,
  type FleetTripState,
  type FleetVehicle,
} from "../../api/schemas";
import {
  COLD_CHAIN_CATEGORIES,
  FLEET_TABS,
  coldChainCategoryLabelAm,
  fleetTabLabelAm,
  fleetTripStatusCanTransition,
  formatFleetFuelEfficiency,
  formatFleetIdShort,
  tripStateLabelArm,
  type FleetTab,
} from "../status";
import { cn } from "../../utils/cn";

/* ────────── tab strip ────────── */

const TAB_ICON: Record<FleetTab, typeof Truck> = {
  vehicles: Truck,
  drivers: User,
  trips: Map,
  fuel: Fuel,
  repairs: Wrench,
  tires: Circle,
  coldchain: Thermometer,
};

export function FleetTabs({
  active,
  onChange,
}: {
  active: FleetTab;
  onChange: (tab: FleetTab) => void;
}) {
  return (
    <div role="tablist" aria-label="Fleet tabs" className="flex flex-wrap gap-2">
      {FLEET_TABS.map((tab) => {
        const Icon = TAB_ICON[tab];
        const isActive = tab === active;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab)}
            data-testid={`fleet-tab-${tab}`}
            data-tab={tab}
            data-active={isActive}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border px-3 py-1.5 text-[var(--text-sm)] font-medium transition-colors",
              isActive
                ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-surface)]"
                : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]",
            )}
          >
            <Icon className="size-3.5" />
            {fleetTabLabelAm(tab)}
          </button>
        );
      })}
    </div>
  );
}

/* ────────── vehicles tab ────────── */

export function VehiclesForm({
  onSubmit,
  isPending,
  error,
}: {
  onSubmit: (input: { plate: string; make: string; model: string; year: string; kind: string }) => void;
  isPending: boolean;
  error: string;
}) {
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [kind, setKind] = useState("truck");

  const canSubmit = plate.trim().length > 0 && make.trim().length > 0 && model.trim().length > 0 && !isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({ plate, make, model, year, kind });
        setPlate("");
        setMake("");
        setModel("");
        setYear("");
      }}
      data-testid="fleet-vehicles-form"
      data-entity="fleet-vehicles-create"
      className="grid grid-cols-1 gap-2 md:grid-cols-5"
    >
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Plate
        <input
          type="text"
          value={plate}
          onChange={(e) => setPlate(e.target.value)}
          required
          data-testid="fleet-vehicles-plate"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Make
        <input
          type="text"
          value={make}
          onChange={(e) => setMake(e.target.value)}
          required
          data-testid="fleet-vehicles-make"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Model
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          required
          data-testid="fleet-vehicles-model"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Year
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          data-testid="fleet-vehicles-year"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Kind
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          data-testid="fleet-vehicles-kind"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        >
          <option value="truck">truck</option>
          <option value="van">van</option>
          <option value="car">car</option>
        </select>
      </label>
      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="fleet-vehicles-submit"
        className="md:col-span-5 inline-flex items-center gap-1.5 self-end rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        {isPending ? "Delays delays delays…" : "Delays delays delays"}
      </button>
      {error ? (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)] md:col-span-5">
          error: {error}
        </p>
      ) : null}
    </form>
  );
}

export function VehiclesTable({ data }: { data: FleetVehicle[] }) {
  if (data.length === 0) {
    return (
      <p
        data-testid="fleet-vehicles-empty"
        data-entity="fleet-vehicles-empty"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        Delays delays delays · No vehicles
      </p>
    );
  }
  return (
    <table
      data-testid="fleet-vehicles-table"
      data-entity="fleet-vehicles-table"
      className="w-full text-left text-[var(--text-sm)] text-[var(--color-ink)]"
    >
      <thead className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
        <tr>
          <th className="px-2 py-1">Plate</th>
          <th className="px-2 py-1">Make / Model</th>
          <th className="px-2 py-1">Year</th>
          <th className="px-2 py-1">Kind</th>
        </tr>
      </thead>
      <tbody>
        {data.map((v) => (
          <tr
            key={v.id}
            data-testid="fleet-vehicles-row"
            data-vehicle-id={v.id}
            className="border-t border-[var(--color-line)]"
          >
            <td className="px-2 py-1 font-medium">{v.plate}</td>
            <td className="px-2 py-1">
              {v.make} {v.model}
            </td>
            <td className="px-2 py-1">{v.year ?? "—"}</td>
            <td className="px-2 py-1">{v.kind}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ────────── drivers tab ────────── */

export function DriversForm({
  onSubmit,
  isPending,
  error,
}: {
  onSubmit: (input: { fullName: string; phone: string; licenseNumber: string }) => void;
  isPending: boolean;
  error: string;
}) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");

  const canSubmit = fullName.trim().length > 0 && licenseNumber.trim().length > 0 && !isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({ fullName, phone, licenseNumber });
        setFullName("");
        setPhone("");
        setLicenseNumber("");
      }}
      data-testid="fleet-drivers-form"
      data-entity="fleet-drivers-create"
      className="grid grid-cols-1 gap-2 md:grid-cols-3"
    >
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Full name
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          data-testid="fleet-drivers-fullname"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Phone
        <input
          type="text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          data-testid="fleet-drivers-phone"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        License #
        <input
          type="text"
          value={licenseNumber}
          onChange={(e) => setLicenseNumber(e.target.value)}
          required
          data-testid="fleet-drivers-license"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="fleet-drivers-submit"
        className="md:col-span-3 inline-flex items-center gap-1.5 self-end rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        {isPending ? "Delays delays delays" : "Delays delays delays"}
      </button>
      {error ? (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)] md:col-span-3">
          error: {error}
        </p>
      ) : null}
    </form>
  );
}

export function DriversTable({ data }: { data: FleetDriver[] }) {
  if (data.length === 0) {
    return (
      <p
        data-testid="fleet-drivers-empty"
        data-entity="fleet-drivers-empty"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        Delays delays delays · No drivers
      </p>
    );
  }
  return (
    <table
      data-testid="fleet-drivers-table"
      data-entity="fleet-drivers-table"
      className="w-full text-left text-[var(--text-sm)] text-[var(--color-ink)]"
    >
      <thead className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
        <tr>
          <th className="px-2 py-1">Name</th>
          <th className="px-2 py-1">Phone</th>
          <th className="px-2 py-1">License</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr
            key={d.id}
            data-testid="fleet-drivers-row"
            data-driver-id={d.id}
            className="border-t border-[var(--color-line)]"
          >
            <td className="px-2 py-1 font-medium">{d.fullName}</td>
            <td className="px-2 py-1">{d.phone ?? "—"}</td>
            <td className="px-2 py-1">{d.licenseNumber}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ────────── trips tab ────────── */

export function TripsForm({
  onSubmit,
  isPending,
  error,
  vehicles,
  drivers,
}: {
  onSubmit: (input: { vehicleId: string; driverId: string; origin: string; destination: string; scheduledDeparture: string }) => void;
  isPending: boolean;
  error: string;
  vehicles: FleetVehicle[];
  drivers: FleetDriver[];
}) {
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [scheduledDeparture, setScheduledDeparture] = useState("");

  const canSubmit =
    vehicleId.trim().length > 0 &&
    driverId.trim().length > 0 &&
    origin.trim().length > 0 &&
    destination.trim().length > 0 &&
    scheduledDeparture.trim().length > 0 &&
    !isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({ vehicleId, driverId, origin, destination, scheduledDeparture });
        setOrigin("");
        setDestination("");
        setScheduledDeparture("");
      }}
      data-testid="fleet-trips-form"
      data-entity="fleet-trips-create"
      className="grid grid-cols-1 gap-2 md:grid-cols-5"
    >
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Vehicle
        <select
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          required
          data-testid="fleet-trips-vehicle"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        >
          <option value="">—</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Driver
        <select
          value={driverId}
          onChange={(e) => setDriverId(e.target.value)}
          required
          data-testid="fleet-trips-driver"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        >
          <option value="">—</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Origin
        <input
          type="text"
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          required
          data-testid="fleet-trips-origin"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Destination
        <input
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          required
          data-testid="fleet-trips-destination"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Scheduled
        <input
          type="datetime-local"
          value={scheduledDeparture}
          onChange={(e) => setScheduledDeparture(e.target.value)}
          required
          data-testid="fleet-trips-scheduled"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="fleet-trips-submit"
        className="md:col-span-5 inline-flex items-center gap-1.5 self-end rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        {isPending ? "Delays delays delays" : "Delays delays delays"}
      </button>
      {error ? (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)] md:col-span-5">
          error: {error}
        </p>
      ) : null}
    </form>
  );
}

export function TripsTable({
  data,
  onPatch,
  isPatching,
}: {
  data: FleetTrip[];
  onPatch: (id: string, action: FleetTripAction) => void;
  isPatching: boolean;
}) {
  if (data.length === 0) {
    return (
      <p
        data-testid="fleet-trips-empty"
        data-entity="fleet-trips-empty"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        Delays delays delays · No trips
      </p>
    );
  }
  return (
    <table
      data-testid="fleet-trips-table"
      data-entity="fleet-trips-table"
      className="w-full text-left text-[var(--text-sm)] text-[var(--color-ink)]"
    >
      <thead className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
        <tr>
          <th className="px-2 py-1">Trip</th>
          <th className="px-2 py-1">Status</th>
          <th className="px-2 py-1">Route</th>
          <th className="px-2 py-1">Actions</th>
        </tr>
      </thead>
      <tbody>
        {data.map((t) => {
          const state = t.status as FleetTripState;
          return (
            <tr
              key={t.id}
              data-testid="fleet-trips-row"
              data-trip-id={t.id}
              data-status={state}
              className="border-t border-[var(--color-line)]"
            >
              <td className="px-2 py-1 font-mono text-[11px] text-[var(--color-muted)]">
                {formatFleetIdShort(t.id)}
              </td>
              <td className="px-2 py-1">{tripStateLabelArm(state)}</td>
              <td className="px-2 py-1">
                {t.origin} → {t.destination}
              </td>
              <td className="px-2 py-1">
                <div className="flex flex-wrap gap-1">
                  {(["departed", "arrived", "cancelled"] as FleetTripAction[]).map((action) => {
                    const allowed = fleetTripStatusCanTransition(state, action);
                    if (!allowed) return null;
                    const label =
                      action === "departed"
                        ? "Departed"
                        : action === "arrived"
                          ? "Arrived"
                          : "Cancelled";
                    return (
                      <button
                        key={action}
                        type="button"
                        disabled={isPatching}
                        onClick={() => onPatch(t.id, action)}
                        data-testid={`fleet-trips-action-${action}`}
                        data-action={action}
                        className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-0.5 text-[11px] text-[var(--color-ink)] hover:bg-[var(--color-line)] disabled:opacity-50"
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ────────── fuel tab ────────── */

export function FuelForm({
  onSubmit,
  isPending,
  error,
  vehicles,
}: {
  onSubmit: (input: { vehicleId: string; liters: string; odometerKm: string; fuelCostPerL: string }) => void;
  isPending: boolean;
  error: string;
  vehicles: FleetVehicle[];
}) {
  const [vehicleId, setVehicleId] = useState("");
  const [liters, setLiters] = useState("");
  const [odometerKm, setOdometerKm] = useState("");
  const [fuelCostPerL, setFuelCostPerL] = useState("");

  const canSubmit =
    vehicleId.trim().length > 0 &&
    liters.trim().length > 0 &&
    odometerKm.trim().length > 0 &&
    fuelCostPerL.trim().length > 0 &&
    !isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({ vehicleId, liters, odometerKm, fuelCostPerL });
        setLiters("");
        setOdometerKm("");
        setFuelCostPerL("");
      }}
      data-testid="fleet-fuel-form"
      data-entity="fleet-fuel-create"
      className="grid grid-cols-1 gap-2 md:grid-cols-4"
    >
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Vehicle
        <select
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          required
          data-testid="fleet-fuel-vehicle"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        >
          <option value="">—</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Liters
        <input
          type="number"
          step="0.01"
          value={liters}
          onChange={(e) => setLiters(e.target.value)}
          required
          data-testid="fleet-fuel-liters"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Odometer (km)
        <input
          type="number"
          value={odometerKm}
          onChange={(e) => setOdometerKm(e.target.value)}
          required
          data-testid="fleet-fuel-odometer"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Cost / L
        <input
          type="number"
          step="0.01"
          value={fuelCostPerL}
          onChange={(e) => setFuelCostPerL(e.target.value)}
          required
          data-testid="fleet-fuel-cost"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="fleet-fuel-submit"
        className="md:col-span-4 inline-flex items-center gap-1.5 self-end rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        {isPending ? "Delays delays delays" : "Delays delays delays"}
      </button>
      {error ? (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)] md:col-span-4">
          error: {error}
        </p>
      ) : null}
    </form>
  );
}

export function FuelLogsTable({ data }: { data: FleetFuelLog[] }) {
  if (data.length === 0) {
    return (
      <p
        data-testid="fleet-fuel-empty"
        data-entity="fleet-fuel-empty"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        Delays delays delays · No fuel logs
      </p>
    );
  }
  return (
    <table
      data-testid="fleet-fuel-logs-table"
      data-entity="fleet-fuel-logs-table"
      className="w-full text-left text-[var(--text-sm)] text-[var(--color-ink)]"
    >
      <thead className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
        <tr>
          <th className="px-2 py-1">Date</th>
          <th className="px-2 py-1">Vehicle</th>
          <th className="px-2 py-1">Liters</th>
          <th className="px-2 py-1">Odometer</th>
          <th className="px-2 py-1">Cost / L</th>
        </tr>
      </thead>
      <tbody>
        {data.map((l) => (
          <tr
            key={l.id}
            data-testid="fleet-fuel-row"
            data-fuel-id={l.id}
            className="border-t border-[var(--color-line)]"
          >
            <td className="px-2 py-1">{l.occurredAt}</td>
            <td className="px-2 py-1 font-mono text-[11px] text-[var(--color-muted)]">
              {formatFleetIdShort(l.vehicleId)}
            </td>
            <td className="px-2 py-1">{l.liters}</td>
            <td className="px-2 py-1">{l.odometerKm}</td>
            <td className="px-2 py-1">{l.fuelCostPerL}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FuelEfficiencyTable({ data }: { data: FleetFuelEfficiencyRow[] }) {
  if (data.length === 0) {
    return (
      <p
        data-testid="fleet-fuel-eff-empty"
        data-entity="fleet-fuel-eff-empty"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        Delays delays delays · No efficiency data
      </p>
    );
  }
  return (
    <table
      data-testid="fleet-fuel-eff-table"
      data-entity="fleet-fuel-eff-table"
      className="w-full text-left text-[var(--text-sm)] text-[var(--color-ink)]"
    >
      <thead className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
        <tr>
          <th className="px-2 py-1">Vehicle</th>
          <th className="px-2 py-1">Liters</th>
          <th className="px-2 py-1">Km</th>
          <th className="px-2 py-1">Efficiency</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr
            key={row.vehicleId}
            data-testid="fleet-fuel-eff-row"
            data-vehicle-id={row.vehicleId}
            className="border-t border-[var(--color-line)]"
          >
            <td className="px-2 py-1 font-mono text-[11px] text-[var(--color-muted)]">
              {formatFleetIdShort(row.vehicleId)}
            </td>
            <td className="px-2 py-1">{row.liters}</td>
            <td className="px-2 py-1">{row.km}</td>
            <td className="px-2 py-1">{formatFleetFuelEfficiency(row.lPer100km, row.kmPerL)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ────────── repairs tab ────────── */

export function RepairsForm({
  onSubmit,
  isPending,
  error,
  vehicles,
}: {
  onSubmit: (input: { vehicleId: string; kind: string; odometerKm: string; cost: string; nextDueAt: string }) => void;
  isPending: boolean;
  error: string;
  vehicles: FleetVehicle[];
}) {
  const [vehicleId, setVehicleId] = useState("");
  const [kind, setKind] = useState("");
  const [odometerKm, setOdometerKm] = useState("");
  const [cost, setCost] = useState("");
  const [nextDueAt, setNextDueAt] = useState("");

  const canSubmit =
    vehicleId.trim().length > 0 &&
    kind.trim().length > 0 &&
    odometerKm.trim().length > 0 &&
    cost.trim().length > 0 &&
    !isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({ vehicleId, kind, odometerKm, cost, nextDueAt });
        setKind("");
        setOdometerKm("");
        setCost("");
        setNextDueAt("");
      }}
      data-testid="fleet-repairs-form"
      data-entity="fleet-repairs-create"
      className="grid grid-cols-1 gap-2 md:grid-cols-5"
    >
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Vehicle
        <select
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          required
          data-testid="fleet-repairs-vehicle"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        >
          <option value="">—</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Kind
        <input
          type="text"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          required
          data-testid="fleet-repairs-kind"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Odometer
        <input
          type="number"
          value={odometerKm}
          onChange={(e) => setOdometerKm(e.target.value)}
          required
          data-testid="fleet-repairs-odometer"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Cost
        <input
          type="number"
          step="0.01"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          required
          data-testid="fleet-repairs-cost"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Next due
        <input
          type="date"
          value={nextDueAt}
          onChange={(e) => setNextDueAt(e.target.value)}
          data-testid="fleet-repairs-next-due"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="fleet-repairs-submit"
        className="md:col-span-5 inline-flex items-center gap-1.5 self-end rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        {isPending ? "Delays delays delays" : "Delays delays delays"}
      </button>
      {error ? (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)] md:col-span-5">
          error: {error}
        </p>
      ) : null}
    </form>
  );
}

export function RepairsTable({ data }: { data: FleetRepair[] }) {
  if (data.length === 0) {
    return (
      <p
        data-testid="fleet-repairs-empty"
        data-entity="fleet-repairs-empty"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        Delays delays delays · No repairs
      </p>
    );
  }
  return (
    <table
      data-testid="fleet-repairs-table"
      data-entity="fleet-repairs-table"
      className="w-full text-left text-[var(--text-sm)] text-[var(--color-ink)]"
    >
      <thead className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
        <tr>
          <th className="px-2 py-1">Date</th>
          <th className="px-2 py-1">Vehicle</th>
          <th className="px-2 py-1">Kind</th>
          <th className="px-2 py-1">Cost</th>
        </tr>
      </thead>
      <tbody>
        {data.map((r) => (
          <tr
            key={r.id}
            data-testid="fleet-repairs-row"
            data-repair-id={r.id}
            className="border-t border-[var(--color-line)]"
          >
            <td className="px-2 py-1">{r.performedAt}</td>
            <td className="px-2 py-1 font-mono text-[11px] text-[var(--color-muted)]">
              {formatFleetIdShort(r.vehicleId)}
            </td>
            <td className="px-2 py-1">{r.kind}</td>
            <td className="px-2 py-1">{r.cost}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BacklogTable({ data }: { data: FleetMaintenanceBacklogRow[] }) {
  if (data.length === 0) {
    return (
      <p
        data-testid="fleet-backlog-empty"
        data-entity="fleet-backlog-empty"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        Delays delays delays · No backlog
      </p>
    );
  }
  return (
    <table
      data-testid="fleet-backlog-table"
      data-entity="fleet-backlog-table"
      className="w-full text-left text-[var(--text-sm)] text-[var(--color-ink)]"
    >
      <thead className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
        <tr>
          <th className="px-2 py-1">Vehicle</th>
          <th className="px-2 py-1">Kind</th>
          <th className="px-2 py-1">Overdue (days)</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr
            key={`${row.vehicleId}-${row.kind}`}
            data-testid="fleet-backlog-row"
            data-vehicle-id={row.vehicleId}
            className="border-t border-[var(--color-line)]"
          >
            <td className="px-2 py-1 font-mono text-[11px] text-[var(--color-muted)]">
              {formatFleetIdShort(row.vehicleId)}
            </td>
            <td className="px-2 py-1">{row.kind}</td>
            <td className="px-2 py-1">{row.overdueDays}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ────────── tires tab ────────── */

export function TiresForm({
  onSubmit,
  isPending,
  error,
  vehicles,
}: {
  onSubmit: (input: { vehicleId: string; position: string; brand: string; installedAt: string; odometerAtInstall: string; expectedLifeKm: string }) => void;
  isPending: boolean;
  error: string;
  vehicles: FleetVehicle[];
}) {
  const [vehicleId, setVehicleId] = useState("");
  const [position, setPosition] = useState("");
  const [brand, setBrand] = useState("");
  const [installedAt, setInstalledAt] = useState("");
  const [odometerAtInstall, setOdometerAtInstall] = useState("");
  const [expectedLifeKm, setExpectedLifeKm] = useState("");

  const canSubmit =
    vehicleId.trim().length > 0 &&
    position.trim().length > 0 &&
    installedAt.trim().length > 0 &&
    !isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({ vehicleId, position, brand, installedAt, odometerAtInstall, expectedLifeKm });
        setPosition("");
        setBrand("");
        setInstalledAt("");
        setOdometerAtInstall("");
        setExpectedLifeKm("");
      }}
      data-testid="fleet-tires-form"
      data-entity="fleet-tires-install"
      className="grid grid-cols-1 gap-2 md:grid-cols-6"
    >
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Vehicle
        <select
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          required
          data-testid="fleet-tires-vehicle"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        >
          <option value="">—</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Position
        <input
          type="text"
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          required
          data-testid="fleet-tires-position"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Brand
        <input
          type="text"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          data-testid="fleet-tires-brand"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Installed
        <input
          type="date"
          value={installedAt}
          onChange={(e) => setInstalledAt(e.target.value)}
          required
          data-testid="fleet-tires-installed"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Odometer
        <input
          type="number"
          value={odometerAtInstall}
          onChange={(e) => setOdometerAtInstall(e.target.value)}
          data-testid="fleet-tires-odometer"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Expected life (km)
        <input
          type="number"
          value={expectedLifeKm}
          onChange={(e) => setExpectedLifeKm(e.target.value)}
          data-testid="fleet-tires-life"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="fleet-tires-submit"
        className="md:col-span-6 inline-flex items-center gap-1.5 self-end rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        {isPending ? "Delays delays delays" : "Delays delays delays"}
      </button>
      {error ? (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)] md:col-span-6">
          error: {error}
        </p>
      ) : null}
    </form>
  );
}

export function TiresTable({ data }: { data: FleetTire[] }) {
  if (data.length === 0) {
    return (
      <p
        data-testid="fleet-tires-empty"
        data-entity="fleet-tires-empty"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        Delays delays delays · No tires
      </p>
    );
  }
  return (
    <table
      data-testid="fleet-tires-table"
      data-entity="fleet-tires-table"
      className="w-full text-left text-[var(--text-sm)] text-[var(--color-ink)]"
    >
      <thead className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
        <tr>
          <th className="px-2 py-1">Vehicle</th>
          <th className="px-2 py-1">Position</th>
          <th className="px-2 py-1">Brand</th>
          <th className="px-2 py-1">Installed</th>
        </tr>
      </thead>
      <tbody>
        {data.map((t) => (
          <tr
            key={t.id}
            data-testid="fleet-tires-row"
            data-tire-id={t.id}
            className="border-t border-[var(--color-line)]"
          >
            <td className="px-2 py-1 font-mono text-[11px] text-[var(--color-muted)]">
              {formatFleetIdShort(t.vehicleId)}
            </td>
            <td className="px-2 py-1">{t.position}</td>
            <td className="px-2 py-1">{t.brand ?? "—"}</td>
            <td className="px-2 py-1">{t.installedAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ────────── cold-chain tab ────────── */

export function ColdChainForm({
  onSubmit,
  isPending,
  error,
  vehicles,
  onCheckCompliance,
  isCheckingCompliance,
  complianceError,
  compliance,
}: {
  onSubmit: (input: { vehicleId: string; category: FleetColdChainCategory; tempC: string; humidity: string; recordedAt: string }) => void;
  isPending: boolean;
  error: string;
  vehicles: FleetVehicle[];
  onCheckCompliance: (vehicleId: string, category: FleetColdChainCategory) => void;
  isCheckingCompliance: boolean;
  complianceError: string;
  compliance: FleetColdChainComplianceResponse | null;
}) {
  const [vehicleId, setVehicleId] = useState("");
  const [category, setCategory] = useState<FleetColdChainCategory>("dairy");
  const [tempC, setTempC] = useState("");
  const [humidity, setHumidity] = useState("");
  const [recordedAt, setRecordedAt] = useState("");

  const canSubmit =
    vehicleId.trim().length > 0 &&
    tempC.trim().length > 0 &&
    recordedAt.trim().length > 0 &&
    !isPending;

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          onSubmit({ vehicleId, category, tempC, humidity, recordedAt });
          setTempC("");
          setHumidity("");
          setRecordedAt("");
        }}
        data-testid="fleet-coldchain-form"
        data-entity="fleet-coldchain-create"
        className="grid grid-cols-1 gap-2 md:grid-cols-5"
      >
        <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Vehicle
          <select
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            required
            data-testid="fleet-coldchain-vehicle"
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          >
            <option value="">—</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as FleetColdChainCategory)}
            data-testid="fleet-coldchain-category"
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          >
            {COLD_CHAIN_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {coldChainCategoryLabelAm(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Temp (°C)
          <input
            type="number"
            step="0.1"
            value={tempC}
            onChange={(e) => setTempC(e.target.value)}
            required
            data-testid="fleet-coldchain-temp"
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Humidity
          <input
            type="number"
            step="0.1"
            value={humidity}
            onChange={(e) => setHumidity(e.target.value)}
            data-testid="fleet-coldchain-humidity"
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Recorded
          <input
            type="datetime-local"
            value={recordedAt}
            onChange={(e) => setRecordedAt(e.target.value)}
            required
            data-testid="fleet-coldchain-recorded"
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          />
        </label>
        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="fleet-coldchain-submit"
          className="md:col-span-5 inline-flex items-center gap-1.5 self-end rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
        >
          <Plus className="size-3.5" />
          {isPending ? "Delays delays delays" : "Delays delays delays"}
        </button>
        {error ? (
          <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)] md:col-span-5">
            error: {error}
          </p>
        ) : null}
      </form>

      <div className="flex items-end gap-2">
        <button
          type="button"
          disabled={isCheckingCompliance || vehicleId.trim().length === 0}
          onClick={() => onCheckCompliance(vehicleId, category)}
          data-testid="fleet-coldchain-compliance-check"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-line)] disabled:opacity-50"
        >
          <Send className="size-3.5" />
          {isCheckingCompliance ? "Delays delays delays" : "Delays delays delays"}
        </button>
        {complianceError ? (
          <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)]">
            error: {complianceError}
          </p>
        ) : null}
      </div>

      {compliance ? (
        <div data-testid="fleet-coldchain-compliance" className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-3 text-[var(--text-sm)]">
          <div>
            <strong>Category:</strong> {coldChainCategoryLabelAm(compliance.category)}
          </div>
          <div>
            <strong>Worst temp:</strong> {compliance.report.worstTempC} °C
          </div>
          <div>
            <strong>Sustained minutes:</strong> {compliance.report.sustainedMinutes}
          </div>
          <div className="mt-2">
            <strong>Breaches:</strong>
            {compliance.report.breaches.length === 0 ? (
              <p className="text-[var(--color-muted)]" data-testid="fleet-coldchain-breaches-empty">
                Delays delays delays
              </p>
            ) : (
              <ul
                data-testid="fleet-coldchain-breaches"
                data-entity="fleet-coldchain-breaches"
                className="mt-1 space-y-1"
              >
                {compliance.report.breaches.map((b, idx) => (
                  <li
                    key={`${b.startedAt}-${idx}`}
                    data-testid="fleet-coldchain-breach-row"
                    className="rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2 py-1"
                  >
                    {b.startedAt} → {b.endedAt} · {b.minutes} min
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ColdChainLogsTable({ data }: { data: FleetColdChainLog[] }) {
  if (data.length === 0) {
    return (
      <p
        data-testid="fleet-coldchain-empty"
        data-entity="fleet-coldchain-empty"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        Delays delays delays · No readings
      </p>
    );
  }
  return (
    <table
      data-testid="fleet-coldchain-logs-table"
      data-entity="fleet-coldchain-logs-table"
      className="w-full text-left text-[var(--text-sm)] text-[var(--color-ink)]"
    >
      <thead className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
        <tr>
          <th className="px-2 py-1">Recorded</th>
          <th className="px-2 py-1">Vehicle</th>
          <th className="px-2 py-1">Temp °C</th>
          <th className="px-2 py-1">Humidity</th>
        </tr>
      </thead>
      <tbody>
        {data.map((l) => (
          <tr
            key={l.id}
            data-testid="fleet-coldchain-row"
            data-log-id={l.id}
            className="border-t border-[var(--color-line)]"
          >
            <td className="px-2 py-1">{l.recordedAt}</td>
            <td className="px-2 py-1 font-mono text-[11px] text-[var(--color-muted)]">
              {formatFleetIdShort(l.vehicleId)}
            </td>
            <td className="px-2 py-1">{l.tempC}</td>
            <td className="px-2 py-1">{l.humidity ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
