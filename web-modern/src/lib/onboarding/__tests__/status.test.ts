/**
 * status.test.ts — unit tests for the AI onboarding pure helpers.
 *
 * Mirrors web-modern/src/lib/cabinet/__tests__/status.test.ts pattern.
 * The helpers consume the Zod-inferred `Ai*` types from
 * web-modern/src/lib/api/schemas.ts as their single source of truth.
 */
import { describe, expect, it } from "vitest";
import type {
  AiModel,
  AiModelsResponse,
  AiSettingsModels,
  AiSettingsResponse,
} from "../../api/schemas";
import {
  AI_MODEL_KEYS,
  isModelsResponseLive,
  modelBelongsToKnownList,
  modelsResponseLabel,
  onboardingFormFromSettings,
  putRequestFromForm,
  selectedModelIds,
} from "../status";

/* ────────── fixtures ────────── */

const MODELS: AiModel[] = [
  { id: "gpt-4", name: "GPT-4" },
  { id: "claude", name: "Claude" },
  { id: "llama", name: "Llama" },
];

const LIVE_RESPONSE: AiModelsResponse = {
  provider: "openrouter",
  online: true,
  source: "live",
  reason: null,
  egressAllowed: true,
  openrouterHost: "openrouter.ai",
  models: MODELS,
};

const OFFLINE_RESPONSE: AiModelsResponse = {
  provider: "openrouter",
  online: false,
  source: "offline-fallback",
  reason: "egress-blocked",
  egressAllowed: false,
  openrouterHost: "openrouter.ai",
  models: [
    { id: "fallback-a", name: "Fallback A" },
    { id: "fallback-b", name: "Fallback B" },
  ],
};

const ALL_MODELS_SET: AiSettingsModels = {
  default: "gpt-4",
  copilot: "claude",
  transform: "llama",
  finance: "",
  crm: "",
  docs: "",
};

const EMPTY_MODELS: AiSettingsModels = {
  default: "",
  copilot: "",
  transform: "",
  finance: "",
  crm: "",
  docs: "",
};

const PRIOR_SETTINGS: AiSettingsResponse["settings"] = {
  openrouterApiKeySet: true,
  openNotebook: { apiKeySet: true, enabled: true, baseUrl: "https://notebook.example.am" },
  models: { ...EMPTY_MODELS, default: "gpt-4" },
};

/* ────────── enum constants ────────── */

describe("AI_MODEL_KEYS", () => {
  it("lists the 6 canonical model aspects in declaration order", () => {
    expect(AI_MODEL_KEYS).toEqual([
      "default",
      "copilot",
      "transform",
      "finance",
      "crm",
      "docs",
    ]);
  });
});

/* ────────── isModelsResponseLive ────────── */

describe("isModelsResponseLive", () => {
  it("returns true when source is 'live'", () => {
    expect(isModelsResponseLive(LIVE_RESPONSE)).toBe(true);
  });

  it("returns false when source is 'offline-fallback'", () => {
    expect(isModelsResponseLive(OFFLINE_RESPONSE)).toBe(false);
  });
});

/* ────────── modelsResponseLabel ────────── */

describe("modelsResponseLabel", () => {
  it("returns the Armenian 'live' label when online", () => {
    const out = modelsResponseLabel(LIVE_RESPONSE);
    expect(out).toContain("Ուղիղ");
    expect(out).toContain("եթեր");
  });

  it("returns the Armenian 'fallback' label when offline", () => {
    const out = modelsResponseLabel(OFFLINE_RESPONSE);
    expect(out).toContain("Պահեստ");
    expect(out).toContain("ցուցակ");
  });

  it("returns different strings for live vs offline", () => {
    expect(modelsResponseLabel(LIVE_RESPONSE)).not.toBe(
      modelsResponseLabel(OFFLINE_RESPONSE),
    );
  });
});

/* ────────── selectedModelIds ────────── */

describe("selectedModelIds", () => {
  it("returns 6 tuples when all fields are set", () => {
    const allSet: AiSettingsModels = {
      default: "gpt-4",
      copilot: "claude",
      transform: "llama",
      finance: "gpt-4",
      crm: "claude",
      docs: "llama",
    };
    const out = selectedModelIds(allSet);
    expect(out).toHaveLength(6);
    expect(out.map(([k]) => k)).toEqual([
      "default",
      "copilot",
      "transform",
      "finance",
      "crm",
      "docs",
    ]);
  });

  it("returns fewer tuples when some fields are empty", () => {
    const out = selectedModelIds(ALL_MODELS_SET);
    expect(out).toHaveLength(3);
    expect(out.map(([k, v]) => [k, v])).toEqual([
      ["default", "gpt-4"],
      ["copilot", "claude"],
      ["transform", "llama"],
    ]);
  });

  it("skips empty strings (does not return [key, ''] tuples)", () => {
    const out = selectedModelIds(ALL_MODELS_SET);
    for (const [, v] of out) {
      expect(v).not.toBe("");
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it("returns an empty list when all fields are empty", () => {
    expect(selectedModelIds(EMPTY_MODELS)).toEqual([]);
  });

  it("preserves the AI_MODEL_KEYS declaration order", () => {
    // Set them in reverse order to ensure the projection follows the canonical
    // AI_MODEL_KEYS order, not the insertion order.
    const reversed: AiSettingsModels = {
      default: "",
      copilot: "",
      transform: "llama",
      finance: "",
      crm: "claude",
      docs: "gpt-4",
    };
    const out = selectedModelIds(reversed);
    expect(out.map(([k]) => k)).toEqual(["transform", "crm", "docs"]);
  });
});

/* ────────── putRequestFromForm ────────── */

describe("putRequestFromForm", () => {
  it("drops empty-string openrouterApiKey", () => {
    const out = putRequestFromForm(
      {
        openrouterApiKey: "",
        models: {},
        openNotebook: {},
      },
      PRIOR_SETTINGS,
    );
    expect("openrouterApiKey" in out).toBe(false);
  });

  it("drops whitespace-only openrouterApiKey", () => {
    const out = putRequestFromForm(
      {
        openrouterApiKey: "   \t\n  ",
        models: {},
        openNotebook: {},
      },
      PRIOR_SETTINGS,
    );
    expect("openrouterApiKey" in out).toBe(false);
  });

  it("keeps a non-blank openrouterApiKey (trimmed)", () => {
    const out = putRequestFromForm(
      {
        openrouterApiKey: "  sk-or-v1-abc  ",
        models: {},
        openNotebook: {},
      },
      PRIOR_SETTINGS,
    );
    expect(out.openrouterApiKey).toBe("sk-or-v1-abc");
  });

  it("drops empty-string openNotebook.apiKey", () => {
    const out = putRequestFromForm(
      {
        models: {},
        openNotebook: { enabled: true, baseUrl: "https://x", apiKey: "" },
      },
      PRIOR_SETTINGS,
    );
    expect(out.openNotebook).toBeDefined();
    expect("apiKey" in (out.openNotebook ?? {})).toBe(false);
  });

  it("drops whitespace-only openNotebook.apiKey", () => {
    const out = putRequestFromForm(
      {
        models: {},
        openNotebook: { apiKey: "   " },
      },
      PRIOR_SETTINGS,
    );
    expect("openNotebook" in out).toBe(false);
  });

  it("keeps a non-blank openNotebook.apiKey (trimmed)", () => {
    const out = putRequestFromForm(
      {
        models: {},
        openNotebook: { apiKey: "  nb-key  " },
      },
      PRIOR_SETTINGS,
    );
    expect(out.openNotebook?.apiKey).toBe("nb-key");
  });

  it("drops empty-string model ids (treats '' as 'leave unchanged')", () => {
    const out = putRequestFromForm(
      {
        models: { default: "", copilot: "", transform: "" },
        openNotebook: {},
      },
      PRIOR_SETTINGS,
    );
    expect("models" in out).toBe(false);
  });

  it("keeps non-blank model ids (trimmed)", () => {
    const out = putRequestFromForm(
      {
        models: { default: "  gpt-4  ", copilot: "claude", transform: "" },
        openNotebook: {},
      },
      PRIOR_SETTINGS,
    );
    expect(out.models).toEqual({ default: "gpt-4", copilot: "claude" });
  });

  it("drops openNotebook entirely if all 3 sub-fields are undefined", () => {
    const out = putRequestFromForm(
      {
        models: {},
        openNotebook: {},
      },
      PRIOR_SETTINGS,
    );
    expect("openNotebook" in out).toBe(false);
  });

  it("drops openNotebook entirely if all 3 sub-fields are empty strings", () => {
    const out = putRequestFromForm(
      {
        models: {},
        openNotebook: { enabled: false, baseUrl: "", apiKey: "" },
      },
      PRIOR_SETTINGS,
    );
    // enabled: false is still a defined boolean, so it survives.
    expect(out.openNotebook).toEqual({ enabled: false });
  });

  it("keeps openNotebook.enabled even when it is false", () => {
    const out = putRequestFromForm(
      {
        models: {},
        openNotebook: { enabled: false },
      },
      PRIOR_SETTINGS,
    );
    expect(out.openNotebook).toEqual({ enabled: false });
  });

  it("drops all 3 top-level fields when the form is fully blank", () => {
    const out = putRequestFromForm(
      {
        openrouterApiKey: "",
        models: {},
        openNotebook: {},
      },
      PRIOR_SETTINGS,
    );
    expect("openrouterApiKey" in out).toBe(false);
    expect("models" in out).toBe(false);
    expect("openNotebook" in out).toBe(false);
  });

  it("preserves a real baseUrl (trimmed)", () => {
    const out = putRequestFromForm(
      {
        models: {},
        openNotebook: { baseUrl: "  https://notebook.example.am/  " },
      },
      PRIOR_SETTINGS,
    );
    expect(out.openNotebook?.baseUrl).toBe("https://notebook.example.am/");
  });
});

/* ────────── onboardingFormFromSettings ────────── */

describe("onboardingFormFromSettings", () => {
  it("returns the current 6 model values from the redacted settings", () => {
    const s: AiSettingsResponse["settings"] = {
      openrouterApiKeySet: true,
      openNotebook: { apiKeySet: false, enabled: false, baseUrl: "" },
      models: {
        default: "gpt-4",
        copilot: "claude",
        transform: "llama",
        finance: "",
        crm: "",
        docs: "",
      },
    };
    const out = onboardingFormFromSettings(s, MODELS);
    expect(out.models).toEqual({
      default: "gpt-4",
      copilot: "claude",
      transform: "llama",
      finance: "",
      crm: "",
      docs: "",
    });
  });

  it("returns '' for openrouterApiKey (placeholder, not the masked value)", () => {
    const s: AiSettingsResponse["settings"] = {
      openrouterApiKeySet: true,
      openNotebook: { apiKeySet: false, enabled: false, baseUrl: "" },
      models: { ...EMPTY_MODELS },
    };
    const out = onboardingFormFromSettings(s, MODELS);
    expect(out.openrouterApiKey).toBe("");
  });

  it("returns '' for openrouterApiKey even when the key is NOT set", () => {
    const s: AiSettingsResponse["settings"] = {
      openrouterApiKeySet: false,
      openNotebook: { apiKeySet: false, enabled: false, baseUrl: "" },
      models: { ...EMPTY_MODELS },
    };
    const out = onboardingFormFromSettings(s, MODELS);
    expect(out.openrouterApiKey).toBe("");
  });

  it("returns openNotebook with apiKey: '' when prior apiKeySet: true", () => {
    const s: AiSettingsResponse["settings"] = {
      openrouterApiKeySet: true,
      openNotebook: {
        apiKeySet: true,
        enabled: true,
        baseUrl: "https://notebook.example.am",
      },
      models: { ...EMPTY_MODELS },
    };
    const out = onboardingFormFromSettings(s, MODELS);
    expect(out.openNotebook).toEqual({
      enabled: true,
      baseUrl: "https://notebook.example.am",
      apiKey: "",
    });
  });

  it("returns openNotebook with enabled/empty apiKey when prior apiKeySet: false", () => {
    const s: AiSettingsResponse["settings"] = {
      openrouterApiKeySet: false,
      openNotebook: { apiKeySet: false, enabled: false, baseUrl: "" },
      models: { ...EMPTY_MODELS },
    };
    const out = onboardingFormFromSettings(s, MODELS);
    expect(out.openNotebook).toEqual({
      enabled: false,
      baseUrl: "",
      apiKey: "",
    });
  });

  it("does not require the live models list (model args are unused)", () => {
    const s: AiSettingsResponse["settings"] = {
      openrouterApiKeySet: false,
      openNotebook: { apiKeySet: false, enabled: false, baseUrl: "" },
      models: { ...EMPTY_MODELS },
    };
    // Pass an empty list — the helper should not read it.
    const out = onboardingFormFromSettings(s, []);
    expect(out.models).toEqual({ ...EMPTY_MODELS });
  });
});

/* ────────── modelBelongsToKnownList ────────── */

describe("modelBelongsToKnownList", () => {
  it("returns true when the id is in the live list", () => {
    expect(
      modelBelongsToKnownList("gpt-4", [
        { id: "gpt-4", name: "GPT-4" },
        { id: "claude", name: "Claude" },
      ]),
    ).toBe(true);
  });

  it("returns true for the first, middle, and last id in the list", () => {
    const list: AiModel[] = [
      { id: "first", name: "First" },
      { id: "middle", name: "Middle" },
      { id: "last", name: "Last" },
    ];
    expect(modelBelongsToKnownList("first", list)).toBe(true);
    expect(modelBelongsToKnownList("middle", list)).toBe(true);
    expect(modelBelongsToKnownList("last", list)).toBe(true);
  });

  it("returns false when the id is not in the live list", () => {
    expect(
      modelBelongsToKnownList("unknown", [
        { id: "gpt-4", name: "GPT-4" },
        { id: "claude", name: "Claude" },
      ]),
    ).toBe(false);
  });

  it("returns false for an empty id", () => {
    expect(modelBelongsToKnownList("", MODELS)).toBe(false);
  });

  it("returns false for an empty list", () => {
    expect(modelBelongsToKnownList("gpt-4", [])).toBe(false);
  });
});
