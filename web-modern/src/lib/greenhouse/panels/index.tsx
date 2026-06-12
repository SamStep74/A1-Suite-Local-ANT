/**
 * Greenhouse panel subcomponents — Phase 10.0 split.
 *
 * The 11 form/result/ai components below used to live in
 * `src/routes/app/greenhouse/index.tsx`. They are pure presentational
 * pieces that take `onSubmit / isPending / error / id-guards` and
 * render form fields; the workspace at the route file owns all
 * mutation wiring, fetch handlers, and cross-tab state (houseId ->
 * zoneId -> cropId). The discriminated-union `GreenhouseResult` type
 * is also exported from here so the route can re-export it for the
 * co-located test (./-index.test.tsx) and keep the same import
 * surface from `./index`.
 */
import { useState } from "react";
import { Plus, Send } from "lucide-react";
import { cn } from "../../utils/cn";
import {
  type GreenhouseAiForecastPacket,
  type GreenhouseEnergy,
  type GreenhouseGdd,
  type GreenhouseYieldRow,
  type GreenhouseZone,
  type GreenhouseCrop,
} from "../../api/schemas";
import {
  CROP_KINDS,
  GLAZING_KINDS,
  GREENHOUSE_TABS,
  HEATING_KINDS,
  IRRIGATION_KINDS,
  QUALITY_GRADES,
  canCreateCrop,
  canCreateZone,
  canRecordHarvest,
  cropKindLabelAm,
  greenhouseTabLabelAm,
  type GreenhouseTab,
} from "../status";

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
