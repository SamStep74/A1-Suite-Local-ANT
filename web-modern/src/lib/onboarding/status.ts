/**
 * Pure helpers for the AI onboarding workspace.
 *
 * Source of truth: server/app.js (the 3 `/api/ai/*` route handlers and
 * `normalizeAiSettingsBody` boundary validation) and the Zod registry
 * at web-modern/src/lib/api/schemas.ts (the `Ai*` schemas).
 *
 * These helpers are UI-pure: no React, no I/O, no router. They re-derive
 * small UI affordances (live/offline status, Armenian-first source label,
 * 6 model field projection, PUT request body builder) and shape server
 * data for rendering. Tested in isolation under jsdom.
 *
 * Public surface:
 *  - AI_MODEL_KEYS                          → readonly enum array of the 6 model aspects
 *  - isModelsResponseLive                   → short-circuit: did the live OpenRouter list resolve?
 *  - modelsResponseLabel                    → Armenian label for the source chip
 *  - selectedModelIds                       → strip empty strings, return [key, id] tuples
 *  - putRequestFromForm                     → build the PUT body, dropping empty-string secrets
 *  - onboardingFormFromSettings             → inverse: redacted settings + live models → initial form
 *  - modelBelongsToKnownList                → is the stored model id still in the live list?
 */
import type {
  AiModel,
  AiModelKey,
  AiModelsResponse,
  AiSettingsModels,
  AiSettingsResponse,
} from "../api/schemas";

/* ────────── type re-exports (UI narrowing) ────────── */

export type { AiModel, AiModelKey, AiModelsResponse, AiSettingsModels, AiSettingsResponse };

/* ────────── enum constants ────────── */

/** The 6 model aspects the user can override. Order is significant for rendering. */
export const AI_MODEL_KEYS = ["default", "copilot", "transform", "finance", "crm", "docs"] as const;

/* ────────── live / offline classification ────────── */

/**
 * Short-circuit: is the live OpenRouter list reachable? Mirrors
 * `online: true` (only when source is "live") — the offline-fallback
 * case still serves models, but they are the bundled list, not the
 * real catalog. The UI should render the offline badge even when
 * `models.length > 0`.
 */
export function isModelsResponseLive(r: AiModelsResponse): boolean {
  return r.source === "live";
}

/* ────────── Armenian-first source label ────────── */

/**
 * Armenian label for the models source chip. Live → "Ուղիղ եթեր",
 * offline-fallback → "Պահեստային ցուցակ". Matches the legacy
 * `ai-onboarding.jsx` status messages.
 */
export function modelsResponseLabel(r: AiModelsResponse): string {
  if (r.source === "live") return "Ուղիղ եթեր";
  return "Պահեստային ցուցակ";
}

/* ────────── selected model id projection ────────── */

/**
 * Strip empty strings, return `[key, id]` tuples for the 6 model
 * fields. Used to render the "Currently selected" list — an empty
 * string means "inherit / auto" and should not be displayed as a
 * concrete choice.
 */
export function selectedModelIds(
  settings: AiSettingsModels,
): ReadonlyArray<readonly [AiModelKey, string]> {
  const out: Array<readonly [AiModelKey, string]> = [];
  for (const key of AI_MODEL_KEYS) {
    const v = settings[key];
    if (typeof v === "string" && v.length > 0) {
      out.push([key, v] as const);
    }
  }
  return out;
}

/* ────────── PUT request body builder ────────── */

function trimOrUndefined(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Build a `PUT /api/ai/settings` request body from a UI form state.
 *
 * Legacy behavior (mirrored from `web/src/ai-onboarding.jsx#save`):
 * blank secrets mean "leave unchanged". An empty `openrouterApiKey`
 * or `openNotebook.apiKey` in the form must NOT be sent. Empty
 * per-aspect model ids are likewise treated as "leave unchanged".
 * The server-side `normalizeAiSettingsBody` does deep-merge on
 * whichever fields are present, so omitting a key is the correct
 * way to express "no change".
 *
 * Also drops `openNotebook` entirely if all 3 sub-fields are
 * undefined — sending an empty `{}` would falsely look like a
 * "clear everything" patch.
 */
export function putRequestFromForm(
  form: {
    openrouterApiKey?: string;
    models: Partial<Record<AiModelKey, string>>;
    openNotebook: { enabled?: boolean; baseUrl?: string; apiKey?: string };
  },
  _priorSettings: AiSettingsResponse["settings"],
): {
  openrouterApiKey?: string;
  models?: Partial<Record<AiModelKey, string>>;
  openNotebook?: { enabled?: boolean; baseUrl?: string; apiKey?: string };
} {
  const out: {
    openrouterApiKey?: string;
    models?: Partial<Record<AiModelKey, string>>;
    openNotebook?: { enabled?: boolean; baseUrl?: string; apiKey?: string };
  } = {};

  const apiKey = trimOrUndefined(form.openrouterApiKey);
  if (apiKey !== undefined) out.openrouterApiKey = apiKey;

  // Per-aspect model ids: only include keys that have a non-empty value.
  // Empty string means "inherit / auto" and is treated as "leave unchanged".
  const modelsPatch: Partial<Record<AiModelKey, string>> = {};
  for (const key of AI_MODEL_KEYS) {
    const v = form.models[key];
    const trimmed = trimOrUndefined(v);
    if (trimmed !== undefined) modelsPatch[key] = trimmed;
  }
  if (Object.keys(modelsPatch).length > 0) out.models = modelsPatch;

  // openNotebook: include only sub-fields that the caller actually set.
  const on: { enabled?: boolean; baseUrl?: string; apiKey?: string } = {};
  if (form.openNotebook.enabled !== undefined) on.enabled = form.openNotebook.enabled;
  const baseUrl = trimOrUndefined(form.openNotebook.baseUrl);
  if (baseUrl !== undefined) on.baseUrl = baseUrl;
  const onApiKey = trimOrUndefined(form.openNotebook.apiKey);
  if (onApiKey !== undefined) on.apiKey = onApiKey;
  if (Object.keys(on).length > 0) out.openNotebook = on;

  return out;
}

/* ────────── inverse: redacted settings + live models → form state ────────── */

/**
 * Build the initial form state from the redacted server response.
 * The server never returns raw secrets — the `apiKeySet` boolean
 * drives the placeholder text, while the form's `apiKey` field
 * always starts as "" (a non-empty string would risk being sent
 * as an explicit "set to this value" patch on the next save).
 */
export function onboardingFormFromSettings(
  s: AiSettingsResponse["settings"],
  _m: AiModelsResponse["models"],
): {
  openrouterApiKey: string;
  models: Partial<Record<AiModelKey, string>>;
  openNotebook: { enabled: boolean; baseUrl: string; apiKey: string };
} {
  return {
    openrouterApiKey: "",
    models: { ...s.models },
    openNotebook: {
      enabled: s.openNotebook.enabled,
      baseUrl: s.openNotebook.baseUrl,
      apiKey: "",
    },
  };
}

/* ────────── orphan-model detection ────────── */

/**
 * True if the stored model id is still in the live list. The legacy
 * `ai-onboarding.jsx` used this to render the orphan option when a
 * model was removed from OpenRouter but still in the user's
 * settings (the user could still see / change their old selection
 * before it is overwritten).
 */
export function modelBelongsToKnownList(
  id: string,
  models: ReadonlyArray<AiModel>,
): boolean {
  if (typeof id !== "string" || id.length === 0) return false;
  for (const m of models) {
    if (m.id === id) return true;
  }
  return false;
}
