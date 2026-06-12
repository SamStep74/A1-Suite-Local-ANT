/**
 * /app/fleet — Fleet workspace.
 *
 * Phase 10.0 split: this file is now a thin composition layer.
 * All form/table panel components live in `lib/fleet/panels/` and
 * are re-exported below so the co-located test (./-index.test.tsx)
 * and the test-utility helpers (fleet/status) keep their public API.
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
import { ChevronLeft, Lock, Truck } from "lucide-react";
import { getJson, patchJson, postJson } from "../../../lib/api/client";
import { useUserAccess } from "../../../lib/rbac/access.tsx";
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
  type FleetTripAction,
} from "../../../lib/api/schemas";
import {
  fleetTabFromHash,
  generateFleetIdempotencyKey,
  type FleetTab,
} from "../../../lib/fleet/status";
import {
  BacklogTable,
  ColdChainForm,
  ColdChainLogsTable,
  DriversForm,
  DriversTable,
  FleetTabs,
  FuelEfficiencyTable,
  FuelForm,
  FuelLogsTable,
  RepairsForm,
  RepairsTable,
  TiresForm,
  TiresTable,
  TripsForm,
  TripsTable,
  VehiclesForm,
  VehiclesTable,
} from "../../../lib/fleet/panels";

// Re-export the panel subcomponents so the co-located test
// (./-index.test.tsx) keeps importing them from "./index".
export {
  BacklogTable,
  ColdChainForm,
  ColdChainLogsTable,
  DriversForm,
  DriversTable,
  FleetTabs,
  FuelEfficiencyTable,
  FuelForm,
  FuelLogsTable,
  RepairsForm,
  RepairsTable,
  TiresForm,
  TiresTable,
  TripsForm,
  TripsTable,
  VehiclesForm,
  VehiclesTable,
} from "../../../lib/fleet/panels";

/* ────────── 403 card (route-local) ────────── */

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
            Fleet
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
          Fleet
        </h1>
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          Fleet vehicles · drivers · trips · fuel · repairs · tires · cold chain
        </p>
      </header>

      <FleetTabs active={tab} onChange={setTab} />

      <section className="panel space-y-3" data-testid={`fleet-${tab}-panel`}>
        {queries.isPending ? (
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading…</p>
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

export const Route = createFileRoute("/app/fleet/")({
  component: FleetWorkspace,
});
