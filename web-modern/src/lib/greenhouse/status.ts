/**
 * Pure helpers for the Greenhouse workspace.
 *
 * Source of truth: server/app.js (the 7-tab greenhouse block) and the
 * Zod registry at web-modern/src/lib/api/schemas.ts (the Greenhouse*
 * schemas). The legacy web/src/greenhouse.jsx keeps houseId -> zoneId
 * -> cropId in local component state; the cross-tab guards
 * canCreateZone / canCreateCrop / canRecordHarvest mirror that gating
 * in pure form so the modern route can disable the relevant forms.
 *
 * Armenian labels use \uXXXX escapes for byte-exact parity with the
 * legacy file (web/src/greenhouse.jsx).
 */
import type {
  GreenhouseAiIntent,
  GreenhouseCropKind,
  GreenhouseEnergy,
  GreenhouseGlazingKind,
  GreenhouseGdd,
  GreenhouseHeatingKind,
  GreenhouseIrrigationKind,
  GreenhouseQualityGrade,
  GreenhouseYieldRow,
} from "../api/schemas";

export type {
  GreenhouseAiIntent,
  GreenhouseCropKind,
  GreenhouseGlazingKind,
  GreenhouseHeatingKind,
  GreenhouseIrrigationKind,
  GreenhouseQualityGrade,
};

export const GREENHOUSE_TABS = [
  "house",
  "zone",
  "crop",
  "climate",
  "energy",
  "bioprotection",
  "harvest",
] as const;
export type GreenhouseTab = (typeof GREENHOUSE_TABS)[number];

const TAB_LABEL_AM: Record<string, string> = {
  'house': "\u054B\u0565\u0580\u0574\u0578\u0581",
  'zone': "\u0533\u0578\u057F\u056B\u0576\u0565\u0580",
  'crop': "\u053F\u0578\u0582\u056C\u057F\u0578\u0582\u0580\u0561\u0576\u0565\u0580",
  'climate': "\u053F\u056C\u056B\u0574\u0561",
  'energy': "\u0537\u0576\u0565\u0580\u0563\u056B\u0561",
  'bioprotection': "\u054A\u0561\u0577\u057F\u057A\u0561\u0576\u0578\u0582\u0569\u0575\u0578\u0582\u0576",
  'harvest': "\u0532\u0565\u0580\u0584\u0561\u0570\u0561\u057E\u0561\u0584",
};

export function greenhouseTabLabelAm(tab: string): string {
  return TAB_LABEL_AM[tab as GreenhouseTab] ?? tab;
}

export function greenhouseTabToHash(tab: GreenhouseTab): string {
  return tab;
}

export function greenhouseTabFromHash(hash: string): GreenhouseTab {
  const cleaned = hash.replace(/^#/, "").trim();
  if ((GREENHOUSE_TABS as readonly string[]).includes(cleaned)) {
    return cleaned as GreenhouseTab;
  }
  return "house";
}

export const CROP_KINDS = [
  "tomato",
  "cucumber",
  "pepper",
  "lettuce",
  "strawberry",
  "herb",
] as const;

const CROP_LABELS_AM: Record<string, string> = {
  'tomato': "\u053C\u0578\u056C\u056B\u056F",
  'cucumber': "\u054E\u0561\u0580\u0578\u0582\u0576\u0563",
  'pepper': "\u054A\u0572\u057A\u0565\u0572",
  'lettuce': "\u0540\u0561\u0566\u0561\u0580",
  'strawberry': "\u0535\u056C\u0561\u056F",
  'herb': "\u053F\u0561\u0576\u0561\u0579\u0565\u0572\u0565\u0576",
};

export function cropKindLabelAm(kind: string): string {
  return CROP_LABELS_AM[kind as GreenhouseCropKind] ?? kind;
}

export const GLAZING_KINDS = ["glass", "poly", "film"] as const;

const GLAZING_KIND_LABELS_AM: Record<string, string> = {
  'glass': "\u0531\u057A\u0561\u056F\u056B",
  'poly': "\u054A\u0561\u0542\u0561\u053F\u0561\u0576\u0561\u0564",
  'film': "\u0532\u0561\u0576\u0561\u0576\u0531\u0564\u057B",
};

export function glazingKindLabelAm(kind: string): string {
  return GLAZING_KIND_LABELS_AM[kind as GreenhouseGlazingKind] ?? kind;
}

export const HEATING_KINDS = ["gas", "electric", "biomass", "geothermal"] as const;

const HEATING_KIND_LABELS_AM: Record<string, string> = {
  'gas': "\u0533\u0561\u0576",
  'electric': "\u0537\u056C\u0565\u056F\u057F\u0580\u0561\u056F\u0561\u0576",
  'biomass': "\u053F\u0565\u0572\u056B\u0578\u057D\u0561\u0575\u056B\u0576",
  'geothermal': "\u0535\u0576\u0561\u0580\u0533\u0561\u0574\u0561\u057D\u0578\u0572\u0561\u057E\u0561\u0580",
};

export function heatingKindLabelAm(kind: string): string {
  return HEATING_KIND_LABELS_AM[kind as GreenhouseHeatingKind] ?? kind;
}

export const IRRIGATION_KINDS = ["drip", "sprinkler", "flood", "manual"] as const;

const IRRIGATION_KIND_LABELS_AM: Record<string, string> = {
  'drip': "\u053F\u0541\u0576\u0561\u0563\u0578\u0582\u057F",
  'sprinkler': "\u0541\u0576\u0561\u0563\u0578\u0582\u057F\u0578\u057E",
  'flood': "\u0540\u0561\u056C\u0561\u0581\u0561\u057E",
  'manual': "\u0541\u0561\u057F\u0578\u0582\u0574\u0561\u0575\u0561\u0562\u0561\u0580",
};

export function irrigationKindLabelAm(kind: string): string {
  return IRRIGATION_KIND_LABELS_AM[kind as GreenhouseIrrigationKind] ?? kind;
}

export const QUALITY_GRADES = ["A", "B", "C"] as const;

const QUALITY_GRADE_LABELS_AM: Record<GreenhouseQualityGrade, string> = {
  A: "A",
  B: "B",
  C: "C",
};

export function qualityGradeLabelAm(grade: string): string {
  return QUALITY_GRADE_LABELS_AM[grade as GreenhouseQualityGrade] ?? grade;
}

export const GREENHOUSE_AI_INTENTS = [
  "yield-forecast",
  "climate-anomaly",
  "pest-risk",
] as const;

// GDD row format mirrors legacy web/src/greenhouse.jsx line 285.
// "GDD (base X°C)՝ Y, նմուշներ՝ Z"
export function formatGreenhouseGddRow(gdd: GreenhouseGdd): string {
  return `GDD (base ${gdd.baseTempC}°C)՝ ${gdd.growingDegreeDays}, \u0576\u0574\u0578\u0582\u0577\u0576\u0565\u0580\u055D ${gdd.sampleSize}`;
}

// Energy row format mirrors legacy web/src/greenhouse.jsx lines 280-281.
// "Ընդհdelays էdelays delays: {totalKwh} կWtdelay·z, gas, {totalGasM3} m³, Berdelays {totalKg} kg"
// " kWtdelay·z/kg {kwhPerKg}, m³/kg {gasM3PerKg}"
export function formatGreenhouseEnergyRow(energy: GreenhouseEnergy): string {
  return [
    `\u0538\u0576\u0564\u0570\u0561\u0576\u0578\u0582\u0580 \u0567\u056C\u0565\u056F\u057F\u0580\u0561\u0567\u0576\u0565\u0580\u0563\u056B\u0561: ${energy.totalKwh} \u056F\u054E\u057F\u00B7\u056A, \u0563\u0561\u0566\u055D ${energy.totalGasM3} \u0574\u00B3, \u0562\u0565\u0580\u0564\u055D ${energy.totalKg} \u056F\u0563`,
    `\u056F\u054E\u057F\u00B7\u056A/\u056F\u0563\u055D ${energy.kwhPerKg}, \u0574\u00B3/\u056F\u0563\u055D ${energy.gasM3PerKg}`,
  ].join("\n");
}

// Yield row format mirrors legacy web/src/greenhouse.jsx line 274.
// "{label}: սպdelays  {expectedKg} կg, իրdelays {actualKg} կg ({pct}%)"
export function formatGreenhouseYieldRow(row: GreenhouseYieldRow): string {
  const label = cropKindLabelAm(row.cropKind);
  const pct = row.pctOfForecast ?? 0;
  return `${label}: \u057D\u057A\u0561\u057D\u057E\u0578\u0572 ${row.expectedKg} \u056F\u0563, \u056B\u0580\u0561\u056F\u0561\u0576 ${row.actualKg} \u056F\u0563 (${pct}%)`;
}

const PERIOD_KEY_RE = /^\d{4}-\d{2}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidGreenhousePeriodKey(periodKey: string): boolean {
  return PERIOD_KEY_RE.test(periodKey);
}

export function isValidGreenhouseGddDateRange(
  from: string,
  to: string,
): { ok: boolean; reason?: string } {
  if (!ISO_DATE_RE.test(from)) {
    return { ok: false, reason: "from is not a YYYY-MM-DD date" };
  }
  if (!ISO_DATE_RE.test(to)) {
    return { ok: false, reason: "to is not a YYYY-MM-DD date" };
  }
  if (from > to) {
    return { ok: false, reason: "from must not be after to" };
  }
  return { ok: true };
}

export function canCreateZone(houseId: string | null): boolean {
  return typeof houseId === "string" && houseId.length > 0;
}

export function canCreateCrop(zoneId: string | null): boolean {
  return typeof zoneId === "string" && zoneId.length > 0;
}

export function canRecordHarvest(cropId: string | null): boolean {
  return typeof cropId === "string" && cropId.length > 0;
}

export type GreenhouseIdempotencyKind =
  | "ui-house"
  | "ui-zone"
  | "ui-crop"
  | "ui-bio"
  | "ui-harv"
  | "ui-ai";

export function generateGreenhouseIdempotencyKey(
  prefix: GreenhouseIdempotencyKind,
): string {
  return `${prefix}-${Date.now()}`;
}
