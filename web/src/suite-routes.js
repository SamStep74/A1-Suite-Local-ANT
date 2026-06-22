"use strict";

const SUITE_APP_IDS = [
  "crm",
  "crm-tube",
  "smb-crm",
  "finance",
  "pos",
  "copilot",
  "desk",
  "campaigns",
  "projects",
  "assets",
  "inventory",
  "purchase",
  "people",
  "docs",
  "analytics",
  "flow",
  "forms",
  "cfo",
  "fleet",
  "greenhouse"
];

const SUITE_APP_ID_SET = new Set(SUITE_APP_IDS);
const SUITE_APP_ALIASES = new Map([
  ["accounting", "finance"],
  ["hayhashvapah", "finance"],
  ["hayhashvapah-finance", "finance"],
  ["mission-control", "copilot"],
  ["support", "desk"],
  ["workflow", "flow"],
  ["workflows", "flow"],
  ["document-cabinet", "docs"],
  ["cabinet", "docs"],
  ["warehouse", "inventory"],
  ["procurement", "purchase"]
]);

function decodeAppId(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return "";
  }
}

function canonicalSuiteAppId(value) {
  const id = decodeAppId(value).trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!id) return "";
  return SUITE_APP_ALIASES.get(id) || id;
}

function normalizeSuiteAppId(value, assignedAppIds = SUITE_APP_IDS) {
  const assigned = new Set(
    (Array.isArray(assignedAppIds) ? assignedAppIds : [])
      .map(canonicalSuiteAppId)
      .filter(id => SUITE_APP_ID_SET.has(id))
  );
  const fallback = assigned.size > 0 ? Array.from(assigned)[0] : "crm";
  const id = canonicalSuiteAppId(value);
  if (id && SUITE_APP_ID_SET.has(id) && (assigned.size === 0 || assigned.has(id))) {
    return id;
  }
  return fallback;
}

function appRoute(value, assignedAppIds) {
  return `/app/${normalizeSuiteAppId(value, assignedAppIds)}`;
}

exports.SUITE_APP_IDS = SUITE_APP_IDS;
exports.normalizeSuiteAppId = normalizeSuiteAppId;
exports.appRoute = appRoute;
