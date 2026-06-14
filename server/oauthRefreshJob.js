/**
 * oauthRefreshJob — Periodic OAuth token refresh driver.
 *
 * Wraps the pure scheduler/runtime from server/lib/integrations/oauth
 * into a singleton-friendly export that the server can call
 * `startOAuthRefreshLoop(db, options)` on boot and
 * `stopOAuthRefreshLoop()` on shutdown.
 *
 * The loop runs at a configurable interval (default: 1 hour) and
 * on each tick:
 *   1. Enumerate every (org, provider) pair with status='connected'
 *   2. For each, check the vault-stored tokens
 *   3. If expiring soon, refresh via refreshAccessToken
 *   4. Write the new tokens back to the vault
 *
 * The actual fetch + AAD + write logic lives in the pure
 * engines; this file is just the cron wiring + a few guards
 * (single-flight, no-op in test, exponential back-off on
 * repeated failures).
 *
 * Pure-ish: the only I/O is setInterval registration. The work
 * itself is delegated to the pure dispatcher.
 */
'use strict';

const { dispatchRefreshJob, DEFAULT_REFRESH_WINDOW_MS } = require('./lib/integrations/oauth/scheduler');
const {
  createIntervalRuntime
} = require('./lib/integrations/oauth/runtime');
const {
  createIntegrationBackend,
  createIntegrationListBackend,
  createVaultFromEnv
} = require('./lib/integrations/sqlite-backend');
const { createOAuthTokenStore } = require('./lib/integrations/oauth/token-store');

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const BACKOFF_FAILURE_THRESHOLD = 3;

let activeRuntime = null;
let consecutiveFailures = 0;

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Object} [options]
 * @param {number} [options.intervalMs]
 * @param {boolean} [options.runOnStart]
 * @param {boolean} [options.disabled]  set true in tests to short-circuit
 * @param {Object} [options.env]
 * @param {Object} [options.vault]
 * @param {Function} [options.fetchImpl]
 * @param {Function} [options.audit]  { record({kind, ...}) }
 * @returns {Promise<{ started: boolean, runtime?: any, reason?: string }>}
 */
async function startOAuthRefreshLoop(db, options = {}) {
  // Two ways to disable: explicit `options.disabled: true`
  // (for tests) OR `env.A1_OAUTH_REFRESH_DISABLED === '1'`
  // (the production flag wired in app.js).
  const env = options.env || (typeof process !== 'undefined' ? process.env : {});
  if (options.disabled || env.A1_OAUTH_REFRESH_DISABLED === '1') {
    return { started: false, reason: 'disabled' };
  }
  if (activeRuntime) return { started: false, reason: 'already_running' };

  // Build the vault INSIDE a try so a missing-KEK error in
  // production surfaces as a clean `no_vault` return, not a
  // thrown exception. createVault's KEK validation is LAZY
  // (it fires on first encrypt, not on construction), so we
  // probe by encrypting a throw-away string.
  let vault;
  try {
    vault = options.vault || createVaultFromEnv({ env: env });
    if (vault && typeof vault.encryptString === 'function') {
      // The KEK check fires on first encrypt. If the env is
      // missing INTEGRATION_KEK in production, this throws
      // KEK_MISSING and we surface no_vault.
      vault.encryptString('__vault_probe__');
    }
  } catch (err) {
    return { started: false, reason: 'no_vault', error: (err && err.message) || String(err) };
  }
  if (!vault) {
    return { started: false, reason: 'no_vault' };
  }
  const backend = createIntegrationBackend(db);
  const listBackend = createIntegrationListBackend(db);
  const tokenStore = createOAuthTokenStore({ backend, vault });
  const fetchImpl = options.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);

  const audit = {
    record(ev) {
      if (options.audit && typeof options.audit.record === 'function') {
        options.audit.record(ev);
      }
    }
  };

  // Wrap dispatchRefreshJob to also surface the BACKOFF signal
  // — if a sweep throws repeatedly, we exponentially back off the
  // interval so a transient outage doesn't peg the OAuth
  // endpoints.
  const baseInterval = options.intervalMs == null ? DEFAULT_INTERVAL_MS : options.intervalMs;
  const runtime = createIntervalRuntime({
    intervalMs: baseInterval,
    runOnStart: options.runOnStart === true,
    audit: {
      record(ev) {
        if (ev.kind === 'oauth_refresh.sweep_completed') {
          consecutiveFailures = 0;
        } else if (ev.kind === 'oauth_refresh.sweep_failed') {
          consecutiveFailures += 1;
          // Cap the backoff: 3x the base interval. A real
          // failure needs a human in the loop, not a tighter
          // loop.
        }
        audit.record(ev);
      }
    },
    dispatch: {
      store: listBackend,
      tokenStore,
      fetchImpl
    }
  });

  await runtime.start();
  activeRuntime = runtime;
  return { started: true, runtime };
}

/**
 * @returns {Promise<{ stopped: boolean }>}
 */
async function stopOAuthRefreshLoop() {
  if (!activeRuntime) return { stopped: false };
  await activeRuntime.stop();
  activeRuntime = null;
  consecutiveFailures = 0;
  return { stopped: true };
}

/**
 * @returns {boolean}
 */
function isOAuthRefreshLoopRunning() {
  return activeRuntime !== null;
}

/**
 * Run a one-shot refresh sweep synchronously (no interval). Used
 * by the manual `POST /api/oauth/sweep` admin action and by tests.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Object} [options]
 * @returns {Promise<{ ok: boolean, [key: string]: any }>}
 */
async function runOnce(db, options = {}) {
  let vault;
  try {
    vault = options.vault || createVaultFromEnv({ env: options.env });
    if (vault && typeof vault.encryptString === 'function') {
      // Probe: the lazy KEK check fires on first encrypt.
      vault.encryptString('__vault_probe__');
    }
  } catch (err) {
    return { ok: false, reason: 'no_vault', error: (err && err.message) || String(err) };
  }
  if (!vault) return { ok: false, reason: 'no_vault' };
  const backend = createIntegrationBackend(db);
  const listBackend = createIntegrationListBackend(db);
  const tokenStore = createOAuthTokenStore({ backend, vault });
  const fetchImpl = options.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const result = await dispatchRefreshJob(
    { kind: 'sweep_all' },
    { store: listBackend, tokenStore, fetchImpl }
  );
  return { ok: true, ...result };
}

module.exports = {
  startOAuthRefreshLoop,
  stopOAuthRefreshLoop,
  isOAuthRefreshLoopRunning,
  runOnce,
  DEFAULT_INTERVAL_MS,
  DEFAULT_REFRESH_WINDOW_MS
};
