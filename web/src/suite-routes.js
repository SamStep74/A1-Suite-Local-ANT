export const SUITE_APP_IDS = ["crm", "finance", "copilot", "desk", "campaigns", "projects", "people", "docs", "analytics", "flow", "forms"];

export const SUITE_APP_ROUTE_ALIASES = {
  forms: "campaigns"
};

export function normalizeSuiteAppId(appId, assignedApps = null) {
  const canonical = SUITE_APP_ROUTE_ALIASES[appId] || appId;
  if (SUITE_APP_IDS.includes(canonical)) return canonical;
  if (assignedApps) {
    return assignedApps.length && assignedApps[0] ? assignedApps[0] : "crm";
  }
  return "crm";
}

export function normalizeSuiteAppIds(appIds = []) {
  const normalized = [];
  const seen = new Set();
  for (const appId of appIds || []) {
    const normalizedAppId = normalizeSuiteAppId(appId);
    if (normalizedAppId && !seen.has(normalizedAppId)) {
      seen.add(normalizedAppId);
      normalized.push(normalizedAppId);
    }
  }
  return normalized;
}

export function appIdFromLocation(pathname = window.location.pathname) {
  const match = String(pathname || "").match(/^\/app\/([^/?#]+)/);
  const appId = match ? decodeURIComponent(match[1]) : "";
  return normalizeSuiteAppId(appId);
}

export function appRoute(appId) {
  return `/app/${encodeURIComponent(appId)}`;
}
