/**
 * /app/greenhouse — Greenhouse workspace.
 *
 * Phase 10.0 split: this file is now a thin composition layer.
 * All form/result/ai panel components live in
 * `lib/greenhouse/panels/` and are re-exported below so the
 * co-located test (./-index.test.tsx) keeps importing them from
 * "./index" by name.
 *
 * Pattern A route (TanStack-Start + Zod + TanStack-Query). Mirrors
 * the shape of /app/healthcheck (mutation-driven, no list query) and
 * the structure of /app/cabinet (tabs + form + result block).
 *
 * Phase 8.7 surface (mirrors server/app.js greenhouseApi):
 *   - Houses:        POST /api/greenhouse/houses
 *   - Zones:         POST /api/greenhouse/zones
 *   - Crops:         POST /api/greenhouse/crops
 *   - Climate (GDD): GET  /api/greenhouse/:id/analytics/gdd
 *   - Energy:        GET  /api/greenhouse/:id/analytics/energy
 *   - Yield:         GET  /api/greenhouse/:id/analytics/yield
 *   - Bioprotection: POST /api/greenhouse/bioprotection
 *   - Harvest:       POST /api/greenhouse/harvests
 *   - AI forecast:   POST /api/greenhouse/ai/yield-forecast
 *
 * State flow: houseId → zoneId → cropId is held in local component
 * state and exposed as "ID pills" (mirrors the legacy file
 * web/src/greenhouse.jsx lines 65/73/81). The cross-tab guards
 * canCreateZone / canCreateCrop / canRecordHarvest from
 * web-modern/src/lib/greenhouse/status.ts disable the relevant
 * forms until the parent id exists.
 *
 * App-tier gate: useUserAccess("greenhouse") — 403 if no access.
 *
 * Public subcomponents are exported with `export function` (not
 * default exports) so the co-located test can import them by name
 * and exercise the pieces in isolation. Mirrors the fleet and
 * cabinet test patterns.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, Lock, Sparkles, Sprout } from "lucide-react";
import { getJson, postJson } from "../../../lib/api/client";
import { useUserAccess } from "../../../lib/rbac/access.tsx";
import {
  GreenhouseAiForecastRequestSchema,
  GreenhouseAiForecastResponseSchema,
  GreenhouseBioprotectionCreateRequestSchema,
  GreenhouseBioprotectionCreateResponseSchema,
  GreenhouseCropCreateRequestSchema,
  GreenhouseCropCreateResponseSchema,
  GreenhouseEnergyResponseSchema,
  GreenhouseGddResponseSchema,
  GreenhouseHarvestCreateRequestSchema,
  GreenhouseHarvestCreateResponseSchema,
  GreenhouseHouseCreateRequestSchema,
  GreenhouseHouseCreateResponseSchema,
  GreenhouseYieldResponseSchema,
  GreenhouseZoneCreateRequestSchema,
  GreenhouseZoneCreateResponseSchema,
  type GreenhouseAiForecastPacket,
} from "../../../lib/api/schemas";
import {
  generateGreenhouseIdempotencyKey,
  greenhouseTabFromHash,
  type GreenhouseTab,
} from "../../../lib/greenhouse/status";
import {
  BioprotectionForm,
  ClimateForm,
  CropForm,
  EnergyForm,
  GreenhouseAiBlock,
  GreenhouseResultBlock,
  GreenhouseTabs,
  HarvestForm,
  HouseForm,
  ZoneForm,
  type GreenhouseResult,
} from "../../../lib/greenhouse/panels";

// Re-export the panel subcomponents + the GreenhouseResult type so
// the co-located test (./-index.test.tsx) keeps importing them from
// "./index".
export {
  BioprotectionForm,
  ClimateForm,
  CropForm,
  EnergyForm,
  GreenhouseAiBlock,
  GreenhouseResultBlock,
  GreenhouseTabs,
  HarvestForm,
  HouseForm,
  ZoneForm,
  type GreenhouseResult,
} from "../../../lib/greenhouse/panels";

/* ────────── 403 card (route-local) ────────── */

export function GreenhouseAccessDeniedCard() {
  return (
    <article
      data-testid="greenhouse-403"
      data-entity="greenhouse-forbidden"
      className="panel flex items-start gap-3 border-[color-mix(in_srgb,var(--color-ruby)_30%,transparent)]"
    >
      <Lock className="size-4 shrink-0 text-[var(--color-ruby)]" aria-hidden />
      <div>
        <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          {`Access restricted`}
        </h2>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Greenhouse workspace is not available for your role
        </p>
      </div>
    </article>
  );
}

/* ────────── root workspace ────────── */

function GreenhouseWorkspace() {
  const hasAccess = useUserAccess("greenhouse");

  // Cross-tab flow state. Mirrors the legacy component's
  // houseId/zoneId/cropId local state and the "ID pill" pattern.
  const [houseId, setHouseId] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [cropId, setCropId] = useState<string | null>(null);

  const initialTab =
    typeof window !== "undefined"
      ? greenhouseTabFromHash(window.location.hash)
      : "house";
  const [tab, setTab] = useState<GreenhouseTab>(initialTab);

  // Result block state — single object that switches content by kind.
  // Mirrors the legacy file's result + aiResult state.
  const [result, setResult] = useState<GreenhouseResult | null>(null);
  const [aiPacket, setAiPacket] = useState<GreenhouseAiForecastPacket | null>(null);

  // Climate + energy + yield share a periodKey input.
  const [periodKey, setPeriodKey] = useState("2026-06");

  /* ── mutations ── */
  const houseMut = useMutation({
    mutationFn: async (input: { name: string; areaM2: string; glazingKind: string; heatingKind: string }) => {
      const payload = GreenhouseHouseCreateRequestSchema.parse({
        name: input.name,
        areaM2: Number(input.areaM2),
        glazingKind: input.glazingKind,
        heatingKind: input.heatingKind,
        idempotencyKey: generateGreenhouseIdempotencyKey("ui-house"),
      });
      return postJson("/api/greenhouse/houses", payload, GreenhouseHouseCreateResponseSchema);
    },
    onSuccess: (res) => {
      setResult({
        kind: "house",
        data: { id: res.greenhouse.id, name: res.greenhouse.name, areaM2: res.greenhouse.areaM2 },
      });
      setHouseId(res.greenhouse.id);
    },
  });

  const zoneMut = useMutation({
    mutationFn: async (input: { name: string; areaM2: string; irrigationKind: string }) => {
      if (!houseId) {
        throw new Error("house id missing");
      }
      const payload = GreenhouseZoneCreateRequestSchema.parse({
        greenhouseId: houseId,
        name: input.name,
        areaM2: Number(input.areaM2),
        irrigationKind: input.irrigationKind,
        idempotencyKey: generateGreenhouseIdempotencyKey("ui-zone"),
      });
      return postJson("/api/greenhouse/zones", payload, GreenhouseZoneCreateResponseSchema);
    },
    onSuccess: (res) => {
      setResult({ kind: "zone", data: res.zone });
      setZoneId(res.zone.id);
    },
  });

  const cropMut = useMutation({
    mutationFn: async (input: { cropKind: string; plantedAt: string; expectedHarvestAt: string; expectedYieldKg: string; seedSource: string }) => {
      if (!zoneId) {
        throw new Error("zone id missing");
      }
      const payload = GreenhouseCropCreateRequestSchema.parse({
        zoneId,
        cropKind: input.cropKind,
        plantedAt: input.plantedAt,
        expectedHarvestAt: input.expectedHarvestAt,
        expectedYieldKg: Number(input.expectedYieldKg),
        seedSource: input.seedSource,
        idempotencyKey: generateGreenhouseIdempotencyKey("ui-crop"),
      });
      return postJson("/api/greenhouse/crops", payload, GreenhouseCropCreateResponseSchema);
    },
    onSuccess: (res) => {
      setResult({ kind: "crop", data: res.crop });
      setCropId(res.crop.id);
    },
  });

  const bioprotectionMut = useMutation({
    mutationFn: async (input: { appliedAt: string; agentKind: string; dose: string; targetPest: string; withdrawalPeriodDays: string; recordedBy: string }) => {
      if (!zoneId) {
        throw new Error("zone id missing");
      }
      const payload = GreenhouseBioprotectionCreateRequestSchema.parse({
        zoneId,
        appliedAt: input.appliedAt,
        agentKind: input.agentKind,
        dose: input.dose,
        targetPest: input.targetPest,
        withdrawalPeriodDays: Number(input.withdrawalPeriodDays),
        recordedBy: input.recordedBy,
        idempotencyKey: generateGreenhouseIdempotencyKey("ui-bio"),
      });
      return postJson(
        "/api/greenhouse/bioprotection",
        payload,
        GreenhouseBioprotectionCreateResponseSchema,
      );
    },
    onSuccess: (res) => {
      setResult({
        kind: "bioprotection",
        data: {
          agentKind: res.bioprotection.agentKind,
          withdrawalPeriodDays: res.bioprotection.withdrawalPeriodDays,
        },
      });
    },
  });

  const harvestMut = useMutation({
    mutationFn: async (input: { harvestedAt: string; quantityKg: string; qualityGrade: string }) => {
      if (!cropId) {
        throw new Error("crop id missing");
      }
      const payload = GreenhouseHarvestCreateRequestSchema.parse({
        cropId,
        harvestedAt: input.harvestedAt,
        quantityKg: Number(input.quantityKg),
        qualityGrade: input.qualityGrade,
        idempotencyKey: generateGreenhouseIdempotencyKey("ui-harv"),
      });
      return postJson("/api/greenhouse/harvests", payload, GreenhouseHarvestCreateResponseSchema);
    },
    onSuccess: (res) => {
      setResult({
        kind: "harvest",
        data: {
          id: res.harvest.id,
          quantityKg: res.harvest.quantityKg,
          qualityGrade: res.harvest.qualityGrade,
          lotId: res.harvest.lotId,
        },
      });
    },
  });

  const aiMut = useMutation({
    mutationFn: async (input: { periodKey: string; question: string }) => {
      const payload = GreenhouseAiForecastRequestSchema.parse({
        periodKey: input.periodKey,
        question: input.question,
        idempotencyKey: generateGreenhouseIdempotencyKey("ui-ai"),
      });
      return postJson(
        "/api/greenhouse/ai/yield-forecast",
        payload,
        GreenhouseAiForecastResponseSchema,
      );
    },
    onSuccess: (res) => {
      setAiPacket(res.packet);
    },
  });

  // ── ad-hoc fetchers for the analytics tabs (GETs, not mutations) ──
  const [climateError, setClimateError] = useState("");
  const [energyError, setEnergyError] = useState("");
  const [yieldError, setYieldError] = useState("");
  const [isClimatePending, setIsClimatePending] = useState(false);
  const [isEnergyPending, setIsEnergyPending] = useState(false);
  const [isYieldPending, setIsYieldPending] = useState(false);

  async function loadGdd(input: { periodKey: string }) {
    if (!houseId) {
      setResult({ kind: "error", data: { error: "Create house first" } });
      return;
    }
    setClimateError("");
    setIsClimatePending(true);
    try {
      const res = await getJson(
        `/api/greenhouse/${houseId}/analytics/gdd?periodKey=${input.periodKey}&from=2026-04-01&to=2026-06-08&baseTempC=10`,
        GreenhouseGddResponseSchema,
      );
      setResult({ kind: "gdd", data: res });
    } catch (err) {
      setClimateError((err as Error).message);
    } finally {
      setIsClimatePending(false);
    }
  }

  async function loadEnergy(input: { periodKey: string }) {
    if (!houseId) {
      setResult({ kind: "error", data: { error: "Create house first" } });
      return;
    }
    setEnergyError("");
    setIsEnergyPending(true);
    try {
      const res = await getJson(
        `/api/greenhouse/${houseId}/analytics/energy?periodKey=${input.periodKey}`,
        GreenhouseEnergyResponseSchema,
      );
      setResult({ kind: "energy", data: res.energy });
    } catch (err) {
      setEnergyError((err as Error).message);
    } finally {
      setIsEnergyPending(false);
    }
  }

  async function loadYield(input: { periodKey: string }) {
    if (!houseId) {
      setResult({ kind: "error", data: { error: "Create house first" } });
      return;
    }
    setYieldError("");
    setIsYieldPending(true);
    try {
      const res = await getJson(
        `/api/greenhouse/${houseId}/analytics/yield?periodKey=${input.periodKey}`,
        GreenhouseYieldResponseSchema,
      );
      setResult({ kind: "yield", data: res.rows });
    } catch (err) {
      setYieldError((err as Error).message);
    } finally {
      setIsYieldPending(false);
    }
  }

  if (!hasAccess) {
    return (
      <div
        className="mx-auto max-w-4xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
        data-testid="greenhouse-panel"
        data-entity="greenhouse-root"
      >
        <header className="space-y-1">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            <Sprout className="size-3" />
            App · Greenhouse
          </span>
          <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
            Greenhouse
          </h1>
        </header>
        <GreenhouseAccessDeniedCard />
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
      data-testid="greenhouse-panel"
      data-entity="greenhouse-root"
    >
      <header className="space-y-1">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          <Sprout className="size-3" />
          App · Greenhouse
        </span>
        <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
          Greenhouse
        </h1>
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          Greenhouse houses · zones · crops · climate · energy · bioprotection · harvest
        </p>
      </header>

      <GreenhouseTabs active={tab} onChange={setTab} />

      <section className="panel space-y-3" data-testid={`greenhouse-${tab}-panel`}>
        {tab === "house" ? (
          <div className="space-y-3">
            <HouseForm
              onSubmit={(input) => houseMut.mutate(input)}
              isPending={houseMut.isPending}
              error={houseMut.error ? (houseMut.error as Error).message : ""}
            />
            {houseId ? (
              <p data-testid="greenhouse-house-id-pill" className="text-[var(--text-sm)] text-[var(--color-muted)]">
                houseId: <code className="font-mono text-[11px]">{houseId}</code>
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === "zone" ? (
          <div className="space-y-3">
            <ZoneForm
              onSubmit={(input) => zoneMut.mutate(input)}
              isPending={zoneMut.isPending}
              error={zoneMut.error ? (zoneMut.error as Error).message : ""}
              houseId={houseId}
            />
            {zoneId ? (
              <p data-testid="greenhouse-zone-id-pill" className="text-[var(--text-sm)] text-[var(--color-muted)]">
                zoneId: <code className="font-mono text-[11px]">{zoneId}</code>
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === "crop" ? (
          <div className="space-y-3">
            <CropForm
              onSubmit={(input) => cropMut.mutate(input)}
              isPending={cropMut.isPending}
              error={cropMut.error ? (cropMut.error as Error).message : ""}
              zoneId={zoneId}
            />
            {cropId ? (
              <p data-testid="greenhouse-crop-id-pill" className="text-[var(--text-sm)] text-[var(--color-muted)]">
                cropId: <code className="font-mono text-[11px]">{cropId}</code>
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === "climate" ? (
          <div className="space-y-2">
            <ClimateForm
              onSubmit={loadGdd}
              isPending={isClimatePending}
              error={climateError}
              houseId={houseId}
            />
            <p className="text-[11px] text-[var(--color-muted)]">
              periodKey: {periodKey}{" "}
              <input
                type="text"
                value={periodKey}
                onChange={(e) => setPeriodKey(e.target.value)}
                className="ml-2 w-24 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-1 py-0.5 text-[11px] text-[var(--color-ink)]"
                data-testid="greenhouse-climate-shared-period"
              />
            </p>
          </div>
        ) : null}

        {tab === "energy" ? (
          <div className="space-y-2">
            <EnergyForm
              onSubmit={loadEnergy}
              isPending={isEnergyPending}
              error={energyError}
              houseId={houseId}
            />
          </div>
        ) : null}

        {tab === "bioprotection" ? (
          <div className="space-y-3">
            <BioprotectionForm
              onSubmit={(input) => bioprotectionMut.mutate(input)}
              isPending={bioprotectionMut.isPending}
              error={bioprotectionMut.error ? (bioprotectionMut.error as Error).message : ""}
              zoneId={zoneId}
            />
          </div>
        ) : null}

        {tab === "harvest" ? (
          <div className="space-y-3">
            <HarvestForm
              onSubmit={(input) => harvestMut.mutate(input)}
              isPending={harvestMut.isPending}
              error={harvestMut.error ? (harvestMut.error as Error).message : ""}
              onLoadYield={loadYield}
              isLoadingYield={isYieldPending}
              cropId={cropId}
              houseId={houseId}
            />
            {yieldError ? (
              <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)]">
                error: {yieldError}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Result block (single block, switches by result.kind) — mirrors
            the legacy file's <div className="copilot-result"> container. */}
        <div data-testid="greenhouse-result" data-entity="greenhouse-result-block">
          <GreenhouseResultBlock result={result} />
        </div>

        {/* AI block — separate because the legacy file renders aiResult
            outside the result switch (line 302-308). */}
        <div data-testid="greenhouse-ai-block">
          <button
            type="button"
            onClick={() =>
              aiMut.mutate({
                periodKey,
                question: `yield-forecast for ${periodKey}`,
              })
            }
            disabled={aiMut.isPending}
            data-testid="greenhouse-ai-button"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-line)] disabled:opacity-50"
          >
            <Sparkles className="size-3.5" />
            {aiMut.isPending ? "AI…" : "AI. Load forecast"}
          </button>
          <div className="mt-2">
            <GreenhouseAiBlock
              packet={aiPacket}
              pending={aiMut.isPending}
              error={aiMut.error ? (aiMut.error as Error).message : ""}
            />
          </div>
        </div>
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

/* ────────── file route ────────── */

export const Route = createFileRoute("/app/greenhouse/")({
  component: GreenhouseWorkspace,
});
