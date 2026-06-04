"use strict";

/**
 * Local, file-backed AI settings for the A1 Suite (local-first).
 *
 * Holds the single OpenRouter API key, the per-aspect model policy, and the
 * opt-in Open Notebook connector. Stored as JSON in the app data dir with
 * 0600 perms. Secrets never leave the server raw — use redactedForClient()
 * for anything sent to the browser.
 *
 * Resolution order for a model is: stored selection -> env default
 * (config.aiModels) -> "" (auto). See resolveModelPolicy().
 */

const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");

const FILE = "ai-settings.json";
const MODEL_KEYS = ["default", "copilot", "transform", "finance", "crm", "docs"];

function defaults() {
  const models = {};
  for (const key of MODEL_KEYS) models[key] = "";
  return { openrouterApiKey: "", models, openNotebook: { enabled: false, baseUrl: "", apiKey: "" } };
}

function filePath() {
  return path.join(config.resolveDataDir(), FILE);
}

function mergeSettings(base, patch) {
  const out = {
    openrouterApiKey: typeof patch.openrouterApiKey === "string" ? patch.openrouterApiKey.trim() : base.openrouterApiKey,
    models: { ...base.models },
    openNotebook: { ...base.openNotebook }
  };
  if (patch.models && typeof patch.models === "object") {
    for (const key of MODEL_KEYS) {
      if (typeof patch.models[key] === "string") out.models[key] = patch.models[key].trim();
    }
  }
  if (patch.openNotebook && typeof patch.openNotebook === "object") {
    const on = patch.openNotebook;
    if (typeof on.enabled === "boolean") out.openNotebook.enabled = on.enabled;
    if (typeof on.baseUrl === "string") out.openNotebook.baseUrl = on.baseUrl.trim().replace(/\/+$/, "");
    if (typeof on.apiKey === "string") out.openNotebook.apiKey = on.apiKey.trim();
  }
  return out;
}

function getSettings() {
  const base = defaults();
  let raw;
  try { raw = JSON.parse(fs.readFileSync(filePath(), "utf8")); }
  catch { return base; }
  if (!raw || typeof raw !== "object") return base;
  return mergeSettings(base, raw);
}

function updateSettings(patch = {}) {
  const next = mergeSettings(getSettings(), patch || {});
  const file = path.join(config.resolveDataDir(), FILE);
  fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* best-effort on platforms without POSIX perms */ }
  return next;
}

// Safe projection for the browser: secrets become boolean *Set flags.
function redactedForClient(settings = getSettings()) {
  return {
    openrouterApiKeySet: Boolean(settings.openrouterApiKey),
    models: { ...settings.models },
    openNotebook: {
      enabled: settings.openNotebook.enabled,
      baseUrl: settings.openNotebook.baseUrl,
      apiKeySet: Boolean(settings.openNotebook.apiKey)
    }
  };
}

// Effective per-aspect policy: stored selection wins, else env default, else auto.
function resolveModelPolicy() {
  const stored = getSettings().models;
  const policy = {};
  for (const key of MODEL_KEYS) {
    policy[key] = (stored[key] && stored[key].trim()) || config.aiModels[key] || "";
  }
  return policy;
}

module.exports = { getSettings, updateSettings, redactedForClient, resolveModelPolicy, MODEL_KEYS, defaults };
