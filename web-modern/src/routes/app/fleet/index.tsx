/**
 * /app/fleet — Fleet workspace.
 *
 * Pattern A route (TanStack-Start + Zod + TanStack-Query). Mirrors
 * the shape of /app/healthcheck (single-screen panel) and the
 * structure of /app/cabinet (tabs + mutation + list/table) and
 * /app/assets (4+ tab workspace with role-gated 403).
 *
 * Phase 8.6 surface (mirrors server/app.js fleetApi):
 *   - Vehicles:  GET  /api/fleet/vehicles         + POST /api/fleet/vehicles
 *   - Drivers:   GET  /api/fleet/drivers          + POST /api/fleet/drivers
 *   - Trips:     GET  /api/fleet/trips            + POST /api/fleet/trips
 *                                              + PATCH /api/fleet/trips/:id/status
 *   - Fuel:      GET  /api/fleet/fuel-logs        + POST /api/fleet/fuel-logs
 *              + GET  /api/fleet/analytics/fuel-efficiency
 *   - Repairs:   GET  /api/fleet/repairs          + POST /api/fleet/repairs
 *              + GET  /api/fleet/analytics/maintenance-backlog
 *   - Tires:     GET  /api/fleet/tires            + POST /api/fleet/tires/install
 *   - ColdChain: GET  /api/fleet/cold-chain-logs  + GET /api/fleet/vehicles/:id/cold-chain-compliance
 *
 * App-tier gate: useUserAccess("fleet") — 403 if no access.
 * Public subcomponents are exported with `export function` (not
 * default exports) so the co-located test can import them by name
 * and exercise the pieces in isolation. Mirrors the assets test
 * pattern.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ChevronLeft,
  Circle,
  Fuel,
  Lock,
  Map,
  Plus,
  Send,
  Thermometer,
  Truck,
  User,
  Wrench,
} from "lucide-react";
import { getJson, patchJson, postJson } from "../../../lib/api/client";
import { useUserAccess } from "../../../lib/rbac/access.tsx";
import { cn } from "../../../lib/utils/cn";
import {
  FleetColdChainComplianceResponseSchema,
  FleetColdChainLogsResponseSchema,
  FleetDriverCreateRequestSchema,
  FleetDriverCreateResponseSchema,
  FleetDriversResponseSchema,
  FleetFuelEfficiencyResponseSchema,
  FleetFuelLogCreateRequestSchema,
  FleetFuelLogCreateResponseSchema,
  FleetFuelLogsResponseSchema,
  FleetMaintenanceBacklogResponseSchema,
  FleetRepairCreateRequestSchema,
  FleetRepairCreateResponseSchema,
  FleetRepairsResponseSchema,
  FleetTireInstallRequestSchema,
  FleetTireInstallResponseSchema,
  FleetTiresResponseSchema,
  FleetTripCreateRequestSchema,
  FleetTripCreateResponseSchema,
  FleetTripStatusPatchRequestSchema,
  FleetTripStatusPatchResponseSchema,
  FleetTripsResponseSchema,
  FleetVehicleCreateRequestSchema,
  FleetVehicleCreateResponseSchema,
  FleetVehiclesResponseSchema,
  type FleetColdChainCategory,
  type FleetColdChainComplianceResponse,
  type FleetColdChainLog,
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
} from "../../../lib/api/schemas";
import {
  COLD_CHAIN_CATEGORIES,
  FLEET_TABS,
  coldChainCategoryLabelAm,
  fleetTabFromHash,
  fleetTabLabelAm,
  fleetTripStatusCanTransition,
  formatFleetFuelEfficiency,
  formatFleetIdShort,
  generateFleetIdempotencyKey,
  tripStateLabelArm,
  type FleetTab,
} from "../../../lib/fleet/status";

/* ────────── file route ────────── */

export const Route = createFileRoute("/app/fleet/")({
  component: FleetWorkspace,
});

/* ────────── 403 card ────────── */

export function FleetAccessDeniedCard() {
  return (
    <article
      data-testid="fleet-403"
      data-entity="fleet-forbidden"
      className="panel flex items-start gap-3 border-[color-mix(in_srgb,var(--color-ruby)_30%,transparent)]"
    >
      <Lock className="size-4 shrink-0 text-[var(--color-ruby)]" aria-hidden />
      <div>
        <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          Մուտքը սահմանափակված է
        </h2>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Fleet workspace-ը հասանելի չէ ձեր դերի համար
        </p>
      </div>
    </article>
  );
}

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
        {isPending ? "Ավելացվում է…" : "Ավելացնել մեքենա"}
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
        {isPending ? "Delays" : "Delays delays"}
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
        Drivers delays · No drivers
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
        {isPending ? "Delays" : "Delays delays"}
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
                        ? "Delays"
                        : action === "arrived"
                          ? "Delays"
                          : "Delays";
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
        {isPending ? "Delays" : "Delays delays"}
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
        {isPending ? "Delays" : "Delays delays"}
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
        {isPending ? "Delays" : "Delays delays"}
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
    <div className="space-y-3" data-testid="fleet-coldchain-form-wrap">
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
          {isPending ? "Delays" : "Delays delays"}
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
          {isCheckingCompliance ? "Delays" : "Delays delays"}
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

/* ────────── root workspace ────────── */

function FleetWorkspace() {
  const qc = useQueryClient();
  const hasAccess = useUserAccess("fleet");

  const initialTab =
    typeof window !== "undefined"
      ? fleetTabFromHash(window.location.hash)
      : "vehicles";
  const [tab, setTab] = useState<FleetTab>(initialTab);

  // ── 9 GETs in parallel via useQuery with Promise.all (mirror legacy) ──
  const queries = useQuery({
    queryKey: [
      "fleet-all",
      "vehicles",
      "drivers",
      "trips",
      "fuel-logs",
      "repairs",
      "tires",
      "cold-chain-logs",
      "analytics-fuel-eff",
      "analytics-backlog",
    ],
    queryFn: async () => {
      const [vehicles, drivers, trips, fuelLogs, repairs, tires, coldChainLogs, fuelEff, backlog] =
        await Promise.all([
          getJson("/api/fleet/vehicles", FleetVehiclesResponseSchema),
          getJson("/api/fleet/drivers", FleetDriversResponseSchema),
          getJson("/api/fleet/trips", FleetTripsResponseSchema),
          getJson("/api/fleet/fuel-logs", FleetFuelLogsResponseSchema),
          getJson("/api/fleet/repairs", FleetRepairsResponseSchema),
          getJson("/api/fleet/tires", FleetTiresResponseSchema),
          getJson("/api/fleet/cold-chain-logs", FleetColdChainLogsResponseSchema),
          getJson("/api/fleet/analytics/fuel-efficiency", FleetFuelEfficiencyResponseSchema),
          getJson("/api/fleet/analytics/maintenance-backlog", FleetMaintenanceBacklogResponseSchema),
        ]);
      return {
        vehicles: vehicles.vehicles,
        drivers: drivers.drivers,
        trips: trips.trips,
        fuelLogs: fuelLogs.fuelLogs,
        repairs: repairs.repairs,
        tires: tires.tires,
        coldChainLogs: coldChainLogs.logs,
        fuelEff: fuelEff.efficiency,
        backlog: backlog.backlog,
      };
    },
  });

  // Memo derived data for child components (avoid re-renders when
  // unrelated fields change).
  const vehicles = useMemo(() => queries.data?.vehicles ?? [], [queries.data]);
  const drivers = useMemo(() => queries.data?.drivers ?? [], [queries.data]);
  const trips = useMemo(() => queries.data?.trips ?? [], [queries.data]);
  const fuelLogs = useMemo(() => queries.data?.fuelLogs ?? [], [queries.data]);
  const repairs = useMemo(() => queries.data?.repairs ?? [], [queries.data]);
  const tires = useMemo(() => queries.data?.tires ?? [], [queries.data]);
  const coldChainLogs = useMemo(() => queries.data?.coldChainLogs ?? [], [queries.data]);
  const fuelEff = useMemo(() => queries.data?.fuelEff ?? [], [queries.data]);
  const backlog = useMemo(() => queries.data?.backlog ?? [], [queries.data]);

  // Compliance is fetched on demand (not part of the parallel batch).
  const [complianceData, setComplianceData] = useState<FleetColdChainComplianceResponse | null>(null);
  const [complianceError, setComplianceError] = useState("");
  const [isCheckingCompliance, setIsCheckingCompliance] = useState(false);

  // ── Mutations: one per writer endpoint ──
  const refreshAll = () => qc.invalidateQueries({ queryKey: ["fleet-all"] });

  const vehiclesMut = useMutation({
    mutationFn: async (input: { plate: string; make: string; model: string; year: string; kind: string }) => {
      const payload = FleetVehicleCreateRequestSchema.parse({
        plate: input.plate,
        make: input.make,
        model: input.model,
        year: input.year.trim() ? Number(input.year) : null,
        kind: input.kind,
        idempotencyKey: generateFleetIdempotencyKey("vehicles-create"),
      });
      return postJson("/api/fleet/vehicles", payload, FleetVehicleCreateResponseSchema);
    },
    onSuccess: () => refreshAll(),
  });

  const driversMut = useMutation({
    mutationFn: async (input: { fullName: string; phone: string; licenseNumber: string }) => {
      const payload = FleetDriverCreateRequestSchema.parse({
        fullName: input.fullName,
        phone: input.phone.trim() ? input.phone : null,
        licenseNumber: input.licenseNumber,
        idempotencyKey: generateFleetIdempotencyKey("drivers-create"),
      });
      return postJson("/api/fleet/drivers", payload, FleetDriverCreateResponseSchema);
    },
    onSuccess: () => refreshAll(),
  });

  const tripsMut = useMutation({
    mutationFn: async (input: { vehicleId: string; driverId: string; origin: string; destination: string; scheduledDeparture: string }) => {
      const payload = FleetTripCreateRequestSchema.parse({
        ...input,
        idempotencyKey: generateFleetIdempotencyKey("trips-create"),
      });
      return postJson("/api/fleet/trips", payload, FleetTripCreateResponseSchema);
    },
    onSuccess: () => refreshAll(),
  });

  const tripsStatusMut = useMutation({
    mutationFn: async (input: { id: string; action: FleetTripAction }) => {
      const payload = FleetTripStatusPatchRequestSchema.parse({
        action: input.action,
        idempotencyKey: generateFleetIdempotencyKey("trips-status"),
      });
      return patchJson(
        `/api/fleet/trips/${input.id}/status`,
        payload,
        FleetTripStatusPatchResponseSchema,
      );
    },
    onSuccess: () => refreshAll(),
  });

  const fuelMut = useMutation({
    mutationFn: async (input: { vehicleId: string; liters: string; odometerKm: string; fuelCostPerL: string }) => {
      const payload = FleetFuelLogCreateRequestSchema.parse({
        vehicleId: input.vehicleId,
        liters: Number(input.liters),
        odometerKm: Number(input.odometerKm),
        fuelCostPerL: Number(input.fuelCostPerL),
        idempotencyKey: generateFleetIdempotencyKey("fuel-create"),
      });
      return postJson("/api/fleet/fuel-logs", payload, FleetFuelLogCreateResponseSchema);
    },
    onSuccess: () => refreshAll(),
  });

  const repairsMut = useMutation({
    mutationFn: async (input: { vehicleId: string; kind: string; odometerKm: string; cost: string; nextDueAt: string }) => {
      const payload = FleetRepairCreateRequestSchema.parse({
        vehicleId: input.vehicleId,
        kind: input.kind,
        odometerKm: Number(input.odometerKm),
        cost: Number(input.cost),
        nextDueAt: input.nextDueAt.trim() ? input.nextDueAt : null,
        idempotencyKey: generateFleetIdempotencyKey("repairs-create"),
      });
      return postJson("/api/fleet/repairs", payload, FleetRepairCreateResponseSchema);
    },
    onSuccess: () => refreshAll(),
  });

  const tiresMut = useMutation({
    mutationFn: async (input: { vehicleId: string; position: string; brand: string; installedAt: string; odometerAtInstall: string; expectedLifeKm: string }) => {
      const payload = FleetTireInstallRequestSchema.parse({
        vehicleId: input.vehicleId,
        position: input.position,
        brand: input.brand.trim() ? input.brand : null,
        installedAt: input.installedAt,
        odometerAtInstall: input.odometerAtInstall.trim() ? Number(input.odometerAtInstall) : null,
        expectedLifeKm: input.expectedLifeKm.trim() ? Number(input.expectedLifeKm) : null,
        idempotencyKey: generateFleetIdempotencyKey("tires-install"),
      });
      return postJson("/api/fleet/tires/install", payload, FleetTireInstallResponseSchema);
    },
    onSuccess: () => refreshAll(),
  });

  // Cold-chain: no write endpoint in this surface (read-only on the
  // server's list endpoint + the per-vehicle compliance report).

  // Compliance fetch handler — wraps the on-demand GET. The mutation-
  // free pattern keeps the test surface simple: just call
  // `onCheckCompliance(id, category)` and the result populates state.
  async function checkCompliance(vehicleId: string, category: FleetColdChainCategory) {
    setComplianceError("");
    setIsCheckingCompliance(true);
    try {
      const res = await getJson(
        `/api/fleet/vehicles/${vehicleId}/cold-chain-compliance?category=${category}`,
        FleetColdChainComplianceResponseSchema,
      );
      setComplianceData(res);
    } catch (err) {
      setComplianceError((err as Error).message);
      setComplianceData(null);
    } finally {
      setIsCheckingCompliance(false);
    }
  }

  if (!hasAccess) {
    return (
      <div
        className="mx-auto max-w-4xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
        data-testid="fleet-panel"
        data-entity="fleet-root"
      >
        <header className="space-y-1">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            <Truck className="size-3" />
            App · Fleet
          </span>
          <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
            Ավdelays
          </h1>
        </header>
        <FleetAccessDeniedCard />
        <div>
          <Link
            to="/app"
            className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            <ChevronLeft className="size-3.5" />
            back to Today
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mx-auto max-w-6xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="fleet-panel"
      data-entity="fleet-root"
    >
      <header className="space-y-1">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          <Truck className="size-3" />
          App · Fleet
        </span>
        <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
          Delays
        </h1>
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          Fleet vehicles · drivers · trips · fuel · repairs · tires · cold chain
        </p>
      </header>

      <FleetTabs active={tab} onChange={setTab} />

      <section className="panel space-y-3" data-testid={`fleet-${tab}-panel`}>
        {queries.isPending ? (
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Delays...</p>
        ) : queries.error ? (
          <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)]">
            error: {(queries.error as Error).message}
          </p>
        ) : null}

        {tab === "vehicles" ? (
          <div className="space-y-3">
            <VehiclesForm
              onSubmit={(input) => vehiclesMut.mutate(input)}
              isPending={vehiclesMut.isPending}
              error={vehiclesMut.error ? (vehiclesMut.error as Error).message : ""}
            />
            <VehiclesTable data={vehicles} />
          </div>
        ) : null}

        {tab === "drivers" ? (
          <div className="space-y-3">
            <DriversForm
              onSubmit={(input) => driversMut.mutate(input)}
              isPending={driversMut.isPending}
              error={driversMut.error ? (driversMut.error as Error).message : ""}
            />
            <DriversTable data={drivers} />
          </div>
        ) : null}

        {tab === "trips" ? (
          <div className="space-y-3">
            <TripsForm
              onSubmit={(input) => tripsMut.mutate(input)}
              isPending={tripsMut.isPending}
              error={tripsMut.error ? (tripsMut.error as Error).message : ""}
              vehicles={vehicles}
              drivers={drivers}
            />
            <TripsTable
              data={trips}
              onPatch={(id, action) => tripsStatusMut.mutate({ id, action })}
              isPatching={tripsStatusMut.isPending}
            />
          </div>
        ) : null}

        {tab === "fuel" ? (
          <div className="space-y-4">
            <FuelForm
              onSubmit={(input) => fuelMut.mutate(input)}
              isPending={fuelMut.isPending}
              error={fuelMut.error ? (fuelMut.error as Error).message : ""}
              vehicles={vehicles}
            />
            <FuelLogsTable data={fuelLogs} />
            <FuelEfficiencyTable data={fuelEff} />
          </div>
        ) : null}

        {tab === "repairs" ? (
          <div className="space-y-4">
            <RepairsForm
              onSubmit={(input) => repairsMut.mutate(input)}
              isPending={repairsMut.isPending}
              error={repairsMut.error ? (repairsMut.error as Error).message : ""}
              vehicles={vehicles}
            />
            <RepairsTable data={repairs} />
            <BacklogTable data={backlog} />
          </div>
        ) : null}

        {tab === "tires" ? (
          <div className="space-y-3">
            <TiresForm
              onSubmit={(input) => tiresMut.mutate(input)}
              isPending={tiresMut.isPending}
              error={tiresMut.error ? (tiresMut.error as Error).message : ""}
              vehicles={vehicles}
            />
            <TiresTable data={tires} />
          </div>
        ) : null}

        {tab === "coldchain" ? (
          <div className="space-y-4">
            <ColdChainForm
              onSubmit={() => {
                // Cold-chain log writes go to a non-fleet endpoint in
                // the legacy app; for now we just refresh on submit.
                refreshAll();
              }}
              isPending={false}
              error=""
              vehicles={vehicles}
              onCheckCompliance={checkCompliance}
              isCheckingCompliance={isCheckingCompliance}
              complianceError={complianceError}
              compliance={complianceData}
            />
            <ColdChainLogsTable data={coldChainLogs} />
          </div>
        ) : null}
      </section>

      <div>
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          back to Today
        </Link>
      </div>
    </div>
  );
}
