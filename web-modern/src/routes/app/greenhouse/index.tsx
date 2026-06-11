/**
 * /app/greenhouse — Greenhouse workspace.
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
 *
 * Form labels and button text are in English (mirrors the legacy
 * web/src/greenhouse.jsx). Armenian text is sourced exclusively
 * from the helper functions in web-modern/src/lib/greenhouse/status.ts
 * for byte-exact parity with worker 1's surface.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  ChevronLeft,
  Lock,
  Plus,
  Send,
  Sparkles,
  Sprout,
} from "lucide-react";
import { getJson, postJson } from "../../../lib/api/client";
import { useUserAccess } from "../../../lib/rbac/access.tsx";
import { cn } from "../../../lib/utils/cn";
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
  type GreenhouseEnergy,
  type GreenhouseGdd,
  type GreenhouseYieldRow,
  type GreenhouseZone,
  type GreenhouseCrop,
} from "../../../lib/api/schemas";
import {
  CROP_KINDS,
  GLAZING_KINDS,
  HEATING_KINDS,
  IRRIGATION_KINDS,
  QUALITY_GRADES,
  GREENHOUSE_TABS,
  canCreateCrop,
  canCreateZone,
  canRecordHarvest,
  cropKindLabelAm,
  generateGreenhouseIdempotencyKey,
  greenhouseTabFromHash,
  greenhouseTabLabelAm,
  type GreenhouseTab,
} from "../../../lib/greenhouse/status";

/* ────────── types (local) ────────── */

/** Discriminated union for the result block. Mirrors the legacy
 *  web/src/greenhouse.jsx result.kind values (lines 261-300). */
export type GreenhouseResult =
  | { kind: "house"; data: { id: string; name: string; areaM2: number } }
  | { kind: "zone"; data: GreenhouseZone }
  | { kind: "crop"; data: GreenhouseCrop }
  | { kind: "yield"; data: GreenhouseYieldRow[] }
  | { kind: "energy"; data: GreenhouseEnergy }
  | { kind: "gdd"; data: GreenhouseGdd }
  | { kind: "bioprotection"; data: { agentKind: string; withdrawalPeriodDays: number } }
  | { kind: "harvest"; data: { id: string; quantityKg: number; qualityGrade: string; lotId: string } }
  | { kind: "harvest-blocked"; data: { error: string } }
  | { kind: "error"; data: { error: string } };

/* ────────── file route ────────── */

export const Route = createFileRoute("/app/greenhouse/")({
  component: GreenhouseWorkspace,
});

/* ────────── 403 card ────────── */

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

/* ────────── tab strip ────────── */

export function GreenhouseTabs({
  active,
  onChange,
}: {
  active: GreenhouseTab;
  onChange: (tab: GreenhouseTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Greenhouse tabs"
      className="flex flex-wrap gap-2"
    >
      {GREENHOUSE_TABS.map((tab) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab)}
            data-testid={`greenhouse-tab-${tab}`}
            data-tab={tab}
            data-active={isActive}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border px-3 py-1.5 text-[var(--text-sm)] font-medium transition-colors",
              isActive
                ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-surface)]"
                : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]",
            )}
          >
            {greenhouseTabLabelAm(tab)}
          </button>
        );
      })}
    </div>
  );
}

/* ────────── house form ────────── */

export function HouseForm({
  onSubmit,
  isPending,
  error,
}: {
  onSubmit: (input: { name: string; areaM2: string; glazingKind: string; heatingKind: string }) => void;
  isPending: boolean;
  error: string;
}) {
  const [name, setName] = useState("Armosphère-1");
  const [areaM2, setAreaM2] = useState("1200");
  const [glazingKind, setGlazingKind] = useState("glass");
  const [heatingKind, setHeatingKind] = useState("gas");

  const canSubmit = name.trim().length > 0 && areaM2.trim().length > 0 && !isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({ name, areaM2, glazingKind, heatingKind });
      }}
      data-testid="greenhouse-house-form"
      data-entity="greenhouse-house-create"
      className="grid grid-cols-1 gap-2 md:grid-cols-4"
    >
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          data-testid="greenhouse-house-name"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Area (m²)
        <input
          type="number"
          value={areaM2}
          onChange={(e) => setAreaM2(e.target.value)}
          required
          data-testid="greenhouse-house-area"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Glazing
        <select
          value={glazingKind}
          onChange={(e) => setGlazingKind(e.target.value)}
          data-testid="greenhouse-house-glazing"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        >
          {GLAZING_KINDS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Heating
        <select
          value={heatingKind}
          onChange={(e) => setHeatingKind(e.target.value)}
          data-testid="greenhouse-house-heating"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
        >
          {HEATING_KINDS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="greenhouse-house-submit"
        className="md:col-span-4 inline-flex items-center gap-1.5 self-end rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        {isPending ? "Creating…" : "Create house"}
      </button>
      {error ? (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)] md:col-span-4">
          error: {error}
        </p>
      ) : null}
    </form>
  );
}

/* ────────── zone form ────────── */

export function ZoneForm({
  onSubmit,
  isPending,
  error,
  houseId,
}: {
  onSubmit: (input: { name: string; areaM2: string; irrigationKind: string }) => void;
  isPending: boolean;
  error: string;
  houseId: string | null;
}) {
  const [name, setName] = useState("Zone A");
  const [areaM2, setAreaM2] = useState("400");
  const [irrigationKind, setIrrigationKind] = useState("drip");
  const enabled = canCreateZone(houseId);

  const canSubmit = enabled && name.trim().length > 0 && areaM2.trim().length > 0 && !isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({ name, areaM2, irrigationKind });
      }}
      data-testid="greenhouse-zone-form"
      data-entity="greenhouse-zone-create"
      className="grid grid-cols-1 gap-2 md:grid-cols-3"
    >
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Zone name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={!enabled}
          data-testid="greenhouse-zone-name"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Area (m²)
        <input
          type="number"
          value={areaM2}
          onChange={(e) => setAreaM2(e.target.value)}
          required
          disabled={!enabled}
          data-testid="greenhouse-zone-area"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Irrigation
        <select
          value={irrigationKind}
          onChange={(e) => setIrrigationKind(e.target.value)}
          disabled={!enabled}
          data-testid="greenhouse-zone-irrigation"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
        >
          {IRRIGATION_KINDS.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="greenhouse-zone-submit"
        className="md:col-span-3 inline-flex items-center gap-1.5 self-end rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        {isPending ? "Creating…" : "Create zone"}
      </button>
      {error ? (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)] md:col-span-3">
          error: {error}
        </p>
      ) : null}
    </form>
  );
}

/* ────────── crop form ────────── */

export function CropForm({
  onSubmit,
  isPending,
  error,
  zoneId,
}: {
  onSubmit: (input: { cropKind: string; plantedAt: string; expectedHarvestAt: string; expectedYieldKg: string; seedSource: string }) => void;
  isPending: boolean;
  error: string;
  zoneId: string | null;
}) {
  const [cropKind, setCropKind] = useState("tomato");
  const [plantedAt, setPlantedAt] = useState("2026-04-01");
  const [expectedHarvestAt, setExpectedHarvestAt] = useState("2026-07-15");
  const [expectedYieldKg, setExpectedYieldKg] = useState("1500");
  const [seedSource, setSeedSource] = useState("Hazera");
  const enabled = canCreateCrop(zoneId);

  const canSubmit =
    enabled &&
    plantedAt.trim().length > 0 &&
    expectedHarvestAt.trim().length > 0 &&
    expectedYieldKg.trim().length > 0 &&
    seedSource.trim().length > 0 &&
    !isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({ cropKind, plantedAt, expectedHarvestAt, expectedYieldKg, seedSource });
      }}
      data-testid="greenhouse-crop-form"
      data-entity="greenhouse-crop-create"
      className="grid grid-cols-1 gap-2 md:grid-cols-5"
    >
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Crop
        <select
          value={cropKind}
          onChange={(e) => setCropKind(e.target.value)}
          disabled={!enabled}
          data-testid="greenhouse-crop-kind"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
        >
          {CROP_KINDS.map((c) => (
            <option key={c} value={c}>
              {cropKindLabelAm(c)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Planted
        <input
          type="date"
          value={plantedAt}
          onChange={(e) => setPlantedAt(e.target.value)}
          required
          disabled={!enabled}
          data-testid="greenhouse-crop-planted"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Expected harvest
        <input
          type="date"
          value={expectedHarvestAt}
          onChange={(e) => setExpectedHarvestAt(e.target.value)}
          required
          disabled={!enabled}
          data-testid="greenhouse-crop-expected-harvest"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Expected yield (kg)
        <input
          type="number"
          value={expectedYieldKg}
          onChange={(e) => setExpectedYieldKg(e.target.value)}
          required
          disabled={!enabled}
          data-testid="greenhouse-crop-expected-yield"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Seed source
        <input
          type="text"
          value={seedSource}
          onChange={(e) => setSeedSource(e.target.value)}
          required
          disabled={!enabled}
          data-testid="greenhouse-crop-seed-source"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
        />
      </label>
      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="greenhouse-crop-submit"
        className="md:col-span-5 inline-flex items-center gap-1.5 self-end rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        {isPending ? "Creating…" : "Create crop"}
      </button>
      {error ? (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)] md:col-span-5">
          error: {error}
        </p>
      ) : null}
    </form>
  );
}

/* ────────── climate form (GDD) ────────── */

export function ClimateForm({
  onSubmit,
  isPending,
  error,
  houseId,
}: {
  onSubmit: (input: { periodKey: string }) => void;
  isPending: boolean;
  error: string;
  houseId: string | null;
}) {
  const [periodKey, setPeriodKey] = useState("2026-06");
  const enabled = canCreateZone(houseId);
  const canSubmit = enabled && periodKey.trim().length > 0 && !isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({ periodKey });
      }}
      data-testid="greenhouse-climate-form"
      data-entity="greenhouse-climate-load"
      className="flex flex-wrap items-end gap-2"
    >
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Period (YYYY-MM)
        <input
          type="text"
          value={periodKey}
          onChange={(e) => setPeriodKey(e.target.value)}
          required
          disabled={!enabled}
          data-testid="greenhouse-climate-period"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
        />
      </label>
      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="greenhouse-climate-submit"
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
      >
        <Send className="size-3.5" />
        {isPending ? "Loading…" : "Load GDD"}
      </button>
      {error ? (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)]">
          error: {error}
        </p>
      ) : null}
    </form>
  );
}

/* ────────── energy form ────────── */

export function EnergyForm({
  onSubmit,
  isPending,
  error,
  houseId,
}: {
  onSubmit: (input: { periodKey: string }) => void;
  isPending: boolean;
  error: string;
  houseId: string | null;
}) {
  const [periodKey, setPeriodKey] = useState("2026-06");
  const enabled = canCreateZone(houseId);
  const canSubmit = enabled && periodKey.trim().length > 0 && !isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({ periodKey });
      }}
      data-testid="greenhouse-energy-form"
      data-entity="greenhouse-energy-load"
      className="flex flex-wrap items-end gap-2"
    >
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Period (YYYY-MM)
        <input
          type="text"
          value={periodKey}
          onChange={(e) => setPeriodKey(e.target.value)}
          required
          disabled={!enabled}
          data-testid="greenhouse-energy-period"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
        />
      </label>
      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="greenhouse-energy-submit"
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
      >
        <Send className="size-3.5" />
        {isPending ? "Loading…" : "Load energy"}
      </button>
      {error ? (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)]">
          error: {error}
        </p>
      ) : null}
    </form>
  );
}

/* ────────── bioprotection form ────────── */

export function BioprotectionForm({
  onSubmit,
  isPending,
  error,
  zoneId,
}: {
  onSubmit: (input: { appliedAt: string; agentKind: string; dose: string; targetPest: string; withdrawalPeriodDays: string; recordedBy: string }) => void;
  isPending: boolean;
  error: string;
  zoneId: string | null;
}) {
  const [appliedAt, setAppliedAt] = useState("2026-06-08");
  const [agentKind, setAgentKind] = useState("Spinosad");
  const [dose, setDose] = useState("0.3 l/ha");
  const [targetPest, setTargetPest] = useState("thrips");
  const [withdrawalPeriodDays, setWithdrawalPeriodDays] = useState("7");
  const [recordedBy, setRecordedBy] = useState("agronomist");
  const enabled = canCreateCrop(zoneId);

  const canSubmit =
    enabled &&
    appliedAt.trim().length > 0 &&
    agentKind.trim().length > 0 &&
    dose.trim().length > 0 &&
    targetPest.trim().length > 0 &&
    withdrawalPeriodDays.trim().length > 0 &&
    recordedBy.trim().length > 0 &&
    !isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({ appliedAt, agentKind, dose, targetPest, withdrawalPeriodDays, recordedBy });
      }}
      data-testid="greenhouse-bioprotection-form"
      data-entity="greenhouse-bioprotection-create"
      className="grid grid-cols-1 gap-2 md:grid-cols-3"
    >
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Agent
        <input
          type="text"
          value={agentKind}
          onChange={(e) => setAgentKind(e.target.value)}
          required
          disabled={!enabled}
          data-testid="greenhouse-bioprotection-agent"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Dose
        <input
          type="text"
          value={dose}
          onChange={(e) => setDose(e.target.value)}
          required
          disabled={!enabled}
          data-testid="greenhouse-bioprotection-dose"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Target pest
        <input
          type="text"
          value={targetPest}
          onChange={(e) => setTargetPest(e.target.value)}
          required
          disabled={!enabled}
          data-testid="greenhouse-bioprotection-pest"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Withdrawal (days)
        <input
          type="number"
          value={withdrawalPeriodDays}
          onChange={(e) => setWithdrawalPeriodDays(e.target.value)}
          required
          disabled={!enabled}
          data-testid="greenhouse-bioprotection-withdrawal"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Applied at
        <input
          type="date"
          value={appliedAt}
          onChange={(e) => setAppliedAt(e.target.value)}
          required
          disabled={!enabled}
          data-testid="greenhouse-bioprotection-applied"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Recorded by
        <input
          type="text"
          value={recordedBy}
          onChange={(e) => setRecordedBy(e.target.value)}
          required
          disabled={!enabled}
          data-testid="greenhouse-bioprotection-recorded-by"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
        />
      </label>
      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="greenhouse-bioprotection-submit"
        className="md:col-span-3 inline-flex items-center gap-1.5 self-end rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        {isPending ? "Recording…" : "Record bioprotection"}
      </button>
      {error ? (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)] md:col-span-3">
          error: {error}
        </p>
      ) : null}
    </form>
  );
}

/* ────────── harvest form ────────── */

export function HarvestForm({
  onSubmit,
  isPending,
  error,
  onLoadYield,
  isLoadingYield,
  cropId,
  houseId,
}: {
  onSubmit: (input: { harvestedAt: string; quantityKg: string; qualityGrade: string }) => void;
  isPending: boolean;
  error: string;
  onLoadYield: (input: { periodKey: string }) => void;
  isLoadingYield: boolean;
  cropId: string | null;
  houseId: string | null;
}) {
  const [harvestedAt, setHarvestedAt] = useState("2026-06-08");
  const [quantityKg, setQuantityKg] = useState("100");
  const [qualityGrade, setQualityGrade] = useState("A");
  const [periodKey, setPeriodKey] = useState("2026-06");
  const enabled = canRecordHarvest(cropId);
  const yieldEnabled = canCreateZone(houseId);

  const canSubmit =
    enabled &&
    harvestedAt.trim().length > 0 &&
    quantityKg.trim().length > 0 &&
    !isPending;

  return (
    <div className="space-y-3" data-testid="greenhouse-harvest-wrap">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          onSubmit({ harvestedAt, quantityKg, qualityGrade });
        }}
        data-testid="greenhouse-harvest-form"
        data-entity="greenhouse-harvest-create"
        className="grid grid-cols-1 gap-2 md:grid-cols-3"
      >
        <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Harvested at
          <input
            type="date"
            value={harvestedAt}
            onChange={(e) => setHarvestedAt(e.target.value)}
            required
            disabled={!enabled}
            data-testid="greenhouse-harvest-date"
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Quantity (kg)
          <input
            type="number"
            value={quantityKg}
            onChange={(e) => setQuantityKg(e.target.value)}
            required
            disabled={!enabled}
            data-testid="greenhouse-harvest-quantity"
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Quality grade
          <select
            value={qualityGrade}
            onChange={(e) => setQualityGrade(e.target.value)}
            disabled={!enabled}
            data-testid="greenhouse-harvest-grade"
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
          >
            {QUALITY_GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="greenhouse-harvest-submit"
          className="md:col-span-3 inline-flex items-center gap-1.5 self-end rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
        >
          <Plus className="size-3.5" />
          {isPending ? "Recording…" : "Record harvest"}
        </button>
        {error ? (
          <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)] md:col-span-3">
            error: {error}
          </p>
        ) : null}
      </form>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!yieldEnabled || isLoadingYield) return;
          onLoadYield({ periodKey });
        }}
        data-testid="greenhouse-yield-form"
        data-entity="greenhouse-yield-load"
        className="flex flex-wrap items-end gap-2"
      >
        <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Yield period (YYYY-MM)
          <input
            type="text"
            value={periodKey}
            onChange={(e) => setPeriodKey(e.target.value)}
            required
            disabled={!yieldEnabled}
            data-testid="greenhouse-yield-period"
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] disabled:opacity-50"
          />
        </label>
        <button
          type="submit"
          disabled={!yieldEnabled || isLoadingYield}
          data-testid="greenhouse-yield-submit"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-line)] disabled:opacity-50"
        >
          <Send className="size-3.5" />
          {isLoadingYield ? "Loading…" : "Load yield"}
        </button>
      </form>
    </div>
  );
}

/* ────────── result block (single block, switches by kind) ────────── */

export function GreenhouseResultBlock({ result }: { result: GreenhouseResult | null }) {
  if (!result) return null;
  if (result.kind === "house") {
    return (
      <p data-testid="greenhouse-result-house" data-entity="greenhouse-result">
        <strong>{result.data.name}</strong> ({result.data.areaM2} m²) — ID: <code>{result.data.id}</code>
      </p>
    );
  }
  if (result.kind === "zone") {
    return (
      <p data-testid="greenhouse-result-zone" data-entity="greenhouse-result">
        <strong>{result.data.name}</strong> ({result.data.areaM2} m², {result.data.irrigationKind})
      </p>
    );
  }
  if (result.kind === "crop") {
    return (
      <p data-testid="greenhouse-result-crop" data-entity="greenhouse-result">
        <strong>{cropKindLabelAm(result.data.cropKind)}</strong> — {result.data.status}
      </p>
    );
  }
  if (result.kind === "yield") {
    return (
      <ul data-testid="greenhouse-result-yield" data-entity="greenhouse-result" className="space-y-1">
        {result.data.map((row) => (
          <li key={row.cropId} className="text-[var(--text-sm)]">
            {row.expectedKg} → {row.actualKg ?? "—"} kg ({row.pctOfForecast ?? 0}%)
          </li>
        ))}
      </ul>
    );
  }
  if (result.kind === "energy") {
    return (
      <div data-testid="greenhouse-result-energy" data-entity="greenhouse-result" className="space-y-1 text-[var(--text-sm)]">
        <p>
          {result.data.totalKwh} kW·h, {result.data.totalGasM3} m³, {result.data.totalKg} kg
        </p>
        <p>
          {result.data.kwhPerKg} kW·h/kg · {result.data.gasM3PerKg} m³/kg
        </p>
      </div>
    );
  }
  if (result.kind === "gdd") {
    return (
      <p data-testid="greenhouse-result-gdd" data-entity="greenhouse-result">
        GDD (base {result.data.baseTempC}°C): {result.data.growingDegreeDays}
      </p>
    );
  }
  if (result.kind === "bioprotection") {
    return (
      <p data-testid="greenhouse-result-bioprotection" data-entity="greenhouse-result">
        {result.data.agentKind} ({result.data.withdrawalPeriodDays} days)
      </p>
    );
  }
  if (result.kind === "harvest") {
    return (
      <p data-testid="greenhouse-result-harvest" data-entity="greenhouse-result">
        {result.data.quantityKg} kg ({result.data.qualityGrade}) — lot: <code>{result.data.lotId}</code>
      </p>
    );
  }
  if (result.kind === "harvest-blocked") {
    return (
      <p role="alert" data-testid="greenhouse-result-harvest-blocked" data-entity="greenhouse-result" className="text-[var(--text-sm)] text-[var(--color-ruby)]">
        {result.data.error}
      </p>
    );
  }
  return (
    <p role="alert" data-testid="greenhouse-result-error" data-entity="greenhouse-result" className="text-[var(--text-sm)] text-[var(--color-ruby)]">
      {result.data.error}
    </p>
  );
}

export function GreenhouseAiBlock({
  packet,
  pending,
  error,
}: {
  packet: GreenhouseAiForecastPacket | null;
  pending: boolean;
  error: string;
}) {
  if (pending) {
    return (
      <p data-testid="greenhouse-ai-pending" className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Working…
      </p>
    );
  }
  if (error) {
    return (
      <p role="alert" data-testid="greenhouse-ai-error" className="text-[var(--text-sm)] text-[var(--color-ruby)]">
        error: {error}
      </p>
    );
  }
  if (!packet) return null;
  return (
    <div data-testid="greenhouse-ai" data-entity="greenhouse-ai-packet" className="space-y-1">
      <p className="text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        {packet.intent} · {packet.aiSource}
      </p>
      <p className="text-[var(--text-sm)] text-[var(--color-ink)]">{packet.answer}</p>
      <p className="text-[11px] text-[var(--color-muted)]">
        confidence {packet.confidence} · risk {packet.riskLevel}
      </p>
    </div>
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
