/**
 * oauth/scheduler — OAuth token refresh orchestration.
 *
 * Architecture:
 *   scheduler.js (this file)
 *     - Pure helpers: which tenants to sweep, which (tenant,
 *       provider) pairs need refresh, payload shape, dispatch
 *       orchestration.
 *     - `processSweep()` — fans out across every tenant with a
 *       connected OAuth integration, refreshes expiring tokens
 *       via `refreshTenantTokens`.
 *     - `processTenantJob()` — single-tenant force-refresh, used
 *       by the "Reconnect now" admin button.
 *     - `buildJobKindDispatcher()` — pure dispatch table for the
 *       two OAuthRefreshJob kinds.
 *
 *   runtime.js (next file)
 *     - The actual scheduler driver: a setInterval-based runner,
 *       a BullMQ adapter, or a console-log mock. The dispatcher
 *       decouples the data plane (this file, testable in
 *       isolation) from the runtime (whatever ANT uses today).
 *
 * ANT adaptation: Prisma is replaced with an injected
 * `IntegrationStore` (read-only adapter:
 * `findManyByTypeAndStatus(types[], status)`). The MAX BullMQ
 * queue / worker is replaced with a `dispatcher` argument —
 * callers wire the actual scheduler (setInterval, BullMQ, or a
 * test mock) at server start. The pure orchestration logic is
 * identical and testable without any runtime.
 */
'use strict';

const { listOAuthProviders, isOAuthProvider } = require('./registry');
const { refreshTenantTokens, forceRefreshTenantTokens } = require('./refresh');

const OAUTH_REFRESH_QUEUE = 'oauth-token-refresh';

/**
 * @typedef {Object} SweepAllJob
 * @property {'sweep_all'} kind
 *
 * @typedef {Object} RefreshTenantJob
 * @property {'refresh_tenant'} kind
 * @property {string} tenantId
 * @property {string[]} providers
 *
 * @typedef {SweepAllJob | RefreshTenantJob} OAuthRefreshJob
 */

/**
 * @typedef {Object} IntegrationStore
 * @property {(types: string[], status: string) => Promise<Array<{id: string, tenantId: string, type: string}>>} findManyByTypeAndStatus
 */

/**
 * Enumerate every (tenantId, provider) pair that has a CONNECTED
 * integration of an OAuth provider. Pure DB read — no HTTP.
 *
 * @param {Object} options
 * @param {string[]} [options.providers]
 * @param {IntegrationStore} options.store
 * @returns {Promise<Array<{tenantId: string, provider: string, integrationId: string}>>}
 */
async function enumerateTenantsWithOAuth(options) {
  if (!options || !options.store) {
    throw new Error('enumerateTenantsWithOAuth requires { store }');
  }
  const providers = options.providers || listOAuthProviders();
  if (providers.length === 0) return [];
  const rows = await options.store.findManyByTypeAndStatus(providers, 'connected');
  // Defensive: the store returns free strings; narrow to known
  // OAuth providers.
  const out = [];
  for (const r of rows) {
    if (!isOAuthProvider(r.type)) continue;
    out.push({ tenantId: r.tenantId, provider: r.type, integrationId: r.id });
  }
  return out;
}

/**
 * @typedef {Object} SweepOutcome
 * @property {string} tenantId
 * @property {string} provider
 * @property {{ok: boolean, [key: string]: any}} outcome
 */

/**
 * @typedef {Object} SweepResult
 * @property {number} tenantsScanned
 * @property {number} pairsProcessed
 * @property {SweepOutcome[]} outcomes
 */

/**
 * Run a sweep across all tenants. For each (tenant, provider)
 * pair, delegates to `refreshTenantTokens` which does plan +
 * refresh + write. Failures in one tenant do not stop the sweep.
 *
 * @param {Object} options
 * @param {IntegrationStore} options.store
 * @param {{ getOAuthTokens: Function, setOAuthTokens: Function }} options.tokenStore
 * @param {Function} [options.fetchImpl]
 * @param {Object} [options.env]
 * @returns {Promise<SweepResult>}
 */
async function processSweep(options) {
  if (!options || !options.store || !options.tokenStore) {
    throw new Error('processSweep requires { store, tokenStore }');
  }
  const pairs = await enumerateTenantsWithOAuth({ store: options.store });
  const tenants = new Set();
  const outcomes = [];

  // Group pairs by tenant to reuse one roundtrip per tenant.
  const byTenant = new Map();
  for (const p of pairs) {
    tenants.add(p.tenantId);
    const list = byTenant.get(p.tenantId) || [];
    list.push(p.provider);
    byTenant.set(p.tenantId, list);
  }

  for (const [tenantId, providers] of byTenant) {
    const out = await refreshTenantTokens(tenantId, providers, {
      tokenStore: options.tokenStore,
      fetchImpl: options.fetchImpl,
      env: options.env
    });
    for (const outcome of out) {
      outcomes.push({ tenantId, provider: outcome.provider, outcome });
    }
  }

  return {
    tenantsScanned: tenants.size,
    pairsProcessed: pairs.length,
    outcomes
  };
}

/**
 * Process a single-tenant refresh. The runtime dispatches a
 * `refresh_tenant` job when an operator wants to nudge a specific
 * tenant (e.g. from a "force refresh" admin button).
 *
 * @param {Object} payload  { kind: 'refresh_tenant', tenantId, providers }
 * @param {Object} options  { tokenStore, fetchImpl?, env? }
 * @returns {Promise<Array<{ok: boolean, provider: string, [key: string]: any}>>}
 */
async function processTenantJob(payload, options) {
  if (!payload || payload.kind !== 'refresh_tenant') {
    throw new Error('processTenantJob expects payload.kind === "refresh_tenant"');
  }
  if (!options || !options.tokenStore) {
    throw new Error('processTenantJob requires { tokenStore }');
  }
  // Defensive: the payload could reference providers we don't know.
  const known = (payload.providers || []).filter((p) => isOAuthProvider(p));
  return forceRefreshTenantTokens(payload.tenantId, known, options);
}

/**
 * Pure dispatch table for the two OAuthRefreshJob kinds. The
 * runtime adapter (runtime.js) calls this for each dequeued job.
 *
 * @param {OAuthRefreshJob} job
 * @param {Object} options  { store, tokenStore, fetchImpl?, env? }
 * @returns {Promise<any>}
 */
async function dispatchRefreshJob(job, options) {
  if (!job || typeof job.kind !== 'string') {
    return { skipped: true, reason: 'missing_kind' };
  }
  if (job.kind === 'sweep_all') {
    const result = await processSweep(options);
    return { kind: 'sweep_all', ...result };
  }
  if (job.kind === 'refresh_tenant') {
    const outcomes = await processTenantJob(job, options);
    return {
      kind: 'refresh_tenant',
      tenantId: job.tenantId,
      outcomes: outcomes.map((o) => ({ provider: o.provider, ok: o.ok, reason: o.reason }))
    };
  }
  // Discriminated union: a runtime job from an older version
  // could land here. Be safe.
  return { skipped: true, reason: 'unknown_kind' };
}

module.exports = {
  OAUTH_REFRESH_QUEUE,
  // Pure orchestration
  enumerateTenantsWithOAuth,
  processSweep,
  processTenantJob,
  dispatchRefreshJob
};
