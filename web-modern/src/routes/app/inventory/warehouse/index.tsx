/**
 * /app/inventory/warehouse — Warehouse workspace (Phase 10.0 split).
 *
 * This file is now a thin composition layer:
 *   - `Route` and the workspace/403/back-link components live here
 *     because they own query/mutation wiring and route-level
 *     metadata.
 *   - All form, list, row, and table subcomponents live in
 *     `lib/warehouse/panels` and are re-exported below so the
 *     co-located test (`./-index.test.tsx`) can still import them
 *     by name from `./index`.
 *
 * The 403 card and back-link are route-local because they depend
 * on the workspace's `userAccess` gate and TanStack's `<Link>` —
 * both are wiring concerns that don't belong to a pure panel.
 *
 * Source of truth: server/app.js#warehouse (lines 548-810) +
 * server/warehouse.js (FEFO, ABC, forecast, cold-storage). UI
 * helpers come from `lib/warehouse/status` (pure).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, Lock, Package } from "lucide-react";
import { getJson, postJson } from "../../../../lib/api/client";
import {
  WarehouseAbcResponseSchema,
  WarehouseColdStorageReadingsResponseSchema,
  WarehouseColdStorageReadingCreateRequestSchema,
  WarehouseColdStorageReadingCreateResponseSchema,
  WarehouseForecastRequestSchema,
  WarehouseForecastResponseSchema,
  WarehouseLotsResponseSchema,
  WarehouseLotCreateRequestSchema,
  WarehouseLotCreateResponseSchema,
  WarehouseSerialCreateRequestSchema,
  WarehouseSerialCreateResponseSchema,
  WarehouseTurnoverResponseSchema,
  type WarehouseSerial,
} from "../../../../lib/api/schemas";
import { type WarehouseTab } from "../../../../lib/warehouse/status";
import {
  WarehouseAbcTable,
  WarehouseColdStorageForm,
  WarehouseColdStorageList,
  WarehouseForecastForm,
  WarehouseLotsForm,
  WarehouseLotsList,
  WarehouseSerialForm,
  WarehouseSerialList,
  WarehouseTabStrip,
  WarehouseTurnoverTable,
} from "../../../../lib/warehouse/panels";

/* ────────── re-exports (preserves the test's named import surface) ─ */

export {
  WarehouseAbcTable,
  WarehouseColdStorageForm,
  WarehouseColdStorageList,
  WarehouseColdStorageReadingRow,
  WarehouseForecastForm,
  WarehouseLotRow,
  WarehouseLotsForm,
  WarehouseLotsList,
  WarehouseSerialForm,
  WarehouseSerialList,
  WarehouseSerialRow,
  WarehouseTabStrip,
  WarehouseTurnoverTable,
} from "../../../../lib/warehouse/panels";

/* ────────── access gate (TODO: wire to useAuth() in 8.4) ────────── */

// Mirrors /app/cabinet and /app/copilot/onboarding — server is the
// source of truth, UI defaults to permissive until the auth context
// lands. The workspace accepts an optional `userAccess` prop so the
// co-located test can render the 403 branch.
export type WarehouseAccess = "inventory" | "none";
const DEFAULT_USER_ACCESS: WarehouseAccess = "inventory";

/* ────────── file route ────────── */

export const Route = createFileRoute("/app/inventory/warehouse/")({
  component: WarehouseWorkspace,
});

/* ────────── workspace-only constants (also referenced by the
              analytics sub-headers; not panel-internal) ────────── */

const PERIOD_KEY = "2026-Q2";
const FORECAST_HORIZON_DAYS = 14;

/* ────────── 403 card (route-local — depends on workspace context) ─ */

export function WarehouseAccessDeniedCard() {
  return (
    <article
      data-testid="warehouse-403"
      data-entity="warehouse-forbidden"
      className="panel flex items-start gap-3 border-[color-mix(in_srgb,var(--color-ruby)_30%,transparent)]"
    >
      <Lock className="size-4 shrink-0 text-[var(--color-ruby)]" aria-hidden />
      <div>
        <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          Մուտքը սահմանափակված է
        </h2>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Պահեստը հասանելի է միայն inventory մուտք ունեցողներին
        </p>
      </div>
    </article>
  );
}

/* ────────── root workspace ────────── */

export function WarehouseWorkspace({
  userAccess = DEFAULT_USER_ACCESS,
}: {
  userAccess?: WarehouseAccess;
} = {}) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<WarehouseTab>("lots");
  const [lotError, setLotError] = useState("");
  const [serialError, setSerialError] = useState("");
  const [coldError, setColdError] = useState("");
  const [forecastError, setForecastError] = useState("");

  const hasAccess = userAccess === "inventory";

  const lotsQ = useQuery({
    queryKey: ["warehouse-lots"],
    queryFn: () => getJson("/api/warehouse/lots", WarehouseLotsResponseSchema),
    enabled: hasAccess,
  });

  const serialsQ = useQuery({
    queryKey: ["warehouse-serials"],
    queryFn: async () => {
      // The list is owner-seeded; the analytics tab relies on the
      // create response. For an empty start we render an empty state.
      return [] as WarehouseSerial[];
    },
    enabled: hasAccess,
  });

  const coldQ = useQuery({
    queryKey: ["warehouse-cold-storage"],
    queryFn: () =>
      getJson("/api/warehouse/cold-storage/readings", WarehouseColdStorageReadingsResponseSchema),
    enabled: hasAccess,
  });

  const abcQ = useQuery({
    queryKey: ["warehouse-abc", PERIOD_KEY],
    queryFn: () =>
      getJson(
        `/api/warehouse/analytics/abc?periodKey=${encodeURIComponent(PERIOD_KEY)}`,
        WarehouseAbcResponseSchema,
      ),
    enabled: hasAccess && activeTab === "analytics",
  });

  const turnoverQ = useQuery({
    queryKey: ["warehouse-turnover", PERIOD_KEY],
    queryFn: () =>
      getJson(
        `/api/warehouse/analytics/turnover?periodKey=${encodeURIComponent(PERIOD_KEY)}`,
        WarehouseTurnoverResponseSchema,
      ),
    enabled: hasAccess && activeTab === "analytics",
  });

  const createLotMut = useMutation({
    mutationFn: async (input: { productId: string; lotCode: string; expiryDate: string }) => {
      setLotError("");
      const payload = WarehouseLotCreateRequestSchema.parse({
        productId: input.productId,
        lotCode: input.lotCode,
        expiryDate: input.expiryDate || null,
      });
      return postJson(
        "/api/warehouse/lots",
        payload,
        WarehouseLotCreateResponseSchema,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouse-lots"] });
    },
    onError: (err: Error) => {
      setLotError(err.message);
    },
  });

  const createSerialMut = useMutation({
    mutationFn: async (input: { productId: string; serial: string }) => {
      setSerialError("");
      const payload = WarehouseSerialCreateRequestSchema.parse({
        productId: input.productId,
        serial: input.serial,
      });
      return postJson(
        "/api/warehouse/serials",
        payload,
        WarehouseSerialCreateResponseSchema,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouse-serials"] });
    },
    onError: (err: Error) => {
      setSerialError(err.message);
    },
  });

  const createColdMut = useMutation({
    mutationFn: async (input: { locationId: string; tempC: number; humidity: number | null }) => {
      setColdError("");
      const payload = WarehouseColdStorageReadingCreateRequestSchema.parse({
        locationId: input.locationId,
        recordedAt: new Date().toISOString(),
        tempC: input.tempC,
        humidity: input.humidity,
        sensorId: null,
      });
      return postJson(
        "/api/warehouse/cold-storage/readings",
        payload,
        WarehouseColdStorageReadingCreateResponseSchema,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouse-cold-storage"] });
    },
    onError: (err: Error) => {
      setColdError(err.message);
    },
  });

  const forecastMut = useMutation({
    mutationFn: async (input: { productId: string }) => {
      setForecastError("");
      const payload = WarehouseForecastRequestSchema.parse({
        productId: input.productId,
        horizonDays: FORECAST_HORIZON_DAYS,
        intent: "warehouse-restock",
      });
      return postJson(
        "/api/warehouse/forecast/restock",
        payload,
        WarehouseForecastResponseSchema,
      );
    },
    onError: (err: Error) => {
      setForecastError(err.message);
    },
  });

  if (!hasAccess) {
    return (
      <div
        className="mx-auto max-w-3xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
        data-testid="warehouse-panel"
        data-entity="warehouse-root"
      >
        <WarehouseAccessDeniedCard />
        <BackToInventory />
      </div>
    );
  }

  return (
    <div
      className="mx-auto max-w-6xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="warehouse-panel"
      data-entity="warehouse-root"
    >
      <header className="space-y-1">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          <Package className="size-3" />
          App · Warehouse
        </span>
        <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
          Պահեստ
        </h1>
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          Warehouse lots · serials · cold storage · analytics
        </p>
      </header>

      <WarehouseTabStrip active={activeTab} onChange={setActiveTab} />

      {activeTab === "lots" && (
        <section className="space-y-3" data-testid="warehouse-tab-panel-lots">
          <WarehouseLotsForm
            onSubmit={(input) => createLotMut.mutate(input)}
            isPending={createLotMut.isPending}
            error={lotError}
          />
          <WarehouseLotsList lots={lotsQ.data?.lots ?? []} />
        </section>
      )}

      {activeTab === "serials" && (
        <section className="space-y-3" data-testid="warehouse-tab-panel-serials">
          <WarehouseSerialForm
            onSubmit={(input) => createSerialMut.mutate(input)}
            isPending={createSerialMut.isPending}
            error={serialError}
          />
          <WarehouseSerialList serials={serialsQ.data ?? []} />
        </section>
      )}

      {activeTab === "cold" && (
        <section className="space-y-3" data-testid="warehouse-tab-panel-cold">
          <WarehouseColdStorageForm
            onSubmit={(input) => createColdMut.mutate(input)}
            isPending={createColdMut.isPending}
            error={coldError}
          />
          <WarehouseColdStorageList readings={coldQ.data?.readings ?? []} />
        </section>
      )}

      {activeTab === "analytics" && (
        <section className="space-y-5" data-testid="warehouse-tab-panel-analytics">
          <div className="panel space-y-2">
            <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              ABC · {PERIOD_KEY}
            </h3>
            <WarehouseAbcTable rows={abcQ.data?.abc ?? []} />
          </div>
          <div className="panel space-y-2">
            <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              Turnover · {PERIOD_KEY}
            </h3>
            <WarehouseTurnoverTable rows={turnoverQ.data?.turnover ?? []} />
          </div>
          <div className="panel space-y-2">
            <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              Forecast · restock
            </h3>
            <WarehouseForecastForm
              onSubmit={(input) => forecastMut.mutate(input)}
              isPending={forecastMut.isPending}
              result={
                forecastMut.data
                  ? {
                      suggestedQuantity: forecastMut.data.forecast.suggestedQuantity,
                      source: forecastMut.data.forecast.source,
                      reasoning: forecastMut.data.forecast.reasoning,
                    }
                  : null
              }
              error={forecastError}
            />
          </div>
        </section>
      )}

      <BackToInventory />
    </div>
  );
}

function BackToInventory() {
  return (
    <div>
      <Link
        to="/app/inventory"
        search={{ view: "catalog", status: "all" }}
        className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        back to Inventory
      </Link>
    </div>
  );
}
