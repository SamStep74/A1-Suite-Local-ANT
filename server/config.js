const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PRODUCT = Object.freeze({
  name: "Armosphera One Claude",
  slug: "armosphera-one-claude",
  appSupportDir: "ArmospheraOneClaude"
});

function computeDataDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.ARMOSPHERA_ONE_DATA_DIR) return env.ARMOSPHERA_ONE_DATA_DIR;
  if (platform === "darwin") return path.join(home, "Library", "Application Support", PRODUCT.appSupportDir);
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, PRODUCT.appSupportDir);
  }
  const xdg = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(xdg, PRODUCT.slug);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveDataDir() {
  return ensureDir(computeDataDir());
}

function resolveDbPath() {
  if (process.env.ARMOSPHERA_ONE_DB) return process.env.ARMOSPHERA_ONE_DB;
  return path.join(resolveDataDir(), "armosphera-one.db");
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

function allowEgress() {
  return process.env.ARMOSPHERA_ONE_ALLOW_EGRESS === "1";
}

function egressAllowlist() {
  return String(process.env.ARMOSPHERA_ONE_EGRESS_ALLOWLIST || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}

class EgressBlockedError extends Error {
  constructor(host) {
    super(`egress blocked: ${host} — outbound network is off. Set ARMOSPHERA_ONE_ALLOW_EGRESS=1 and add the host to ARMOSPHERA_ONE_EGRESS_ALLOWLIST.`);
    this.name = "EgressBlockedError";
    this.code = "EGRESS_BLOCKED";
    this.statusCode = 403;
  }
}

function hostOf(url) {
  try {
    let h = new URL(url).hostname.toLowerCase();
    if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1); // IPv6 literal [::1] -> ::1
    if (h.endsWith(".")) h = h.slice(0, -1);                       // strip FQDN trailing dot
    return h;
  } catch { return ""; }
}

function assertEgressAllowed(url) {
  const host = hostOf(url);
  if (LOOPBACK.has(host)) return; // loopback is always permitted — local-first IPC is never gated
  if (!allowEgress()) throw new EgressBlockedError(host || String(url));
  const list = egressAllowlist();
  if (!list.includes(host)) throw new EgressBlockedError(host || String(url)); // deny unless explicitly allowlisted
}

let fetchImpl = (...args) => globalThis.fetch(...args);
function setFetchImpl(fn) { fetchImpl = fn; }

async function safeFetch(url, options) {
  assertEgressAllowed(url);
  return fetchImpl(url, options);
}

const ai = Object.freeze({
  provider: process.env.AI_PROVIDER || "local",
  localBaseUrl: process.env.LOCAL_AI_BASE_URL || "http://127.0.0.1:11434/v1",
  localModel: process.env.LOCAL_AI_MODEL || "gemma3:4b"
});

module.exports = {
  PRODUCT,
  computeDataDir, ensureDir, resolveDataDir, resolveDbPath,
  allowEgress, egressAllowlist, assertEgressAllowed, EgressBlockedError,
  safeFetch, setFetchImpl,
  ai
};
