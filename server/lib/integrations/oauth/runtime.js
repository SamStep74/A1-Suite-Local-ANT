/**
 * oauth/runtime — Thin scheduler/worker driver for OAuth token
 * refresh, decoupled from the data plane (scheduler.js).
 *
 * Why split: the MAX source couples this to BullMQ + ioredis.
 * ANT is single-process, `node:sqlite`, no Redis. We provide a
 * pure dispatcher (dispatchRefreshJob in scheduler.js) and a
 * runtime driver that:
 *   - On the server, runs a `setInterval` loop that calls
 *     `processSweep` daily. Single-process, simple, restartable.
 *   - In tests, uses the `createMockRuntime()` factory to assert
 *     the dispatcher is called with the right shape.
 *
 * The runtime is intentionally minimal: it does NOT replace
 * BullMQ's retry, dead-letter, or observability features. If
 * ANT grows a worker-pool pattern (e.g. multiple server
 * processes), replace this file with a BullMQ adapter that
 * calls `dispatchRefreshJob` for each dequeued job — the
 * scheduler.js interface is the contract.
 *
 * Pure-ish: the only I/O is the `setInterval` registration +
 * optional audit hook. The work itself is delegated to the
 * pure dispatcher.
 */
'use strict';

const { dispatchRefreshJob } = require('./scheduler');

/**
 * @typedef {Object} AuditHook
 * @property {(event: { kind: string, tenantId: string|null, [key: string]: any }) => void} [record]
 */

/**
 * @typedef {Object} OAuthRuntime
 * @property {() => void} start
 * @property {() => Promise<void>} stop
 * @property {() => { running: boolean, lastRunAt: number|null, lastResult: any }} status
 */

/**
 * Build a runtime driver that runs `processSweep` on a fixed
 * interval. Useful for single-process deployments and tests.
 *
 * @param {Object} options
 * @param {number} [options.intervalMs]  how often to run the sweep (default 24h)
 * @param {boolean} [options.runOnStart]  run immediately on start()
 * @param {{ store: any, tokenStore: any, fetchImpl?: any, env?: any }} options.dispatch
 * @param {AuditHook} [options.audit]
 * @returns {OAuthRuntime}
 */
function createIntervalRuntime(options) {
  if (!options || !options.dispatch) {
    throw new Error('createIntervalRuntime requires { dispatch }');
  }
  const intervalMs = options.intervalMs == null ? 24 * 60 * 60 * 1000 : options.intervalMs;
  const runOnStart = options.runOnStart === true;
  const audit = options.audit || null;
  let timer = null;
  let running = false;
  let lastRunAt = null;
  let lastResult = null;

  async function tick() {
    if (running) return; // never overlap
    running = true;
    try {
      const result = await dispatchRefreshJob({ kind: 'sweep_all' }, options.dispatch);
      lastRunAt = Date.now();
      lastResult = result;
      if (audit && audit.record) {
        audit.record({
          kind: 'oauth_refresh.sweep_completed',
          tenantId: null,
          ok: true,
          tenantsScanned: result.tenantsScanned,
          pairsProcessed: result.pairsProcessed
        });
      }
    } catch (err) {
      lastRunAt = Date.now();
      lastResult = { error: (err && err.message) || String(err) };
      if (audit && audit.record) {
        audit.record({
          kind: 'oauth_refresh.sweep_failed',
          tenantId: null,
          ok: false,
          error: (err && err.message) || String(err)
        });
      }
    } finally {
      running = false;
    }
  }

  return {
    async start() {
      if (timer) return;
      if (runOnStart) await tick();
      timer = setInterval(() => { tick(); }, intervalMs);
      // Allow the process to exit even if the timer is running
      if (typeof timer.unref === 'function') timer.unref();
    },
    async stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    status() {
      return { running, lastRunAt, lastResult };
    }
  };
}

/**
 * Build a mock runtime that records calls without running any
 * I/O. Used by tests.
 *
 * @returns {OAuthRuntime & { calls: Array<{kind: string, [key: string]: any}>, runOnce: (job: any) => Promise<any> }}
 */
function createMockRuntime() {
  const calls = [];
  let running = false;
  let lastRunAt = null;
  let lastResult = null;

  async function runOnce(job) {
    calls.push(job);
    lastRunAt = Date.now();
    lastResult = { mocked: true, job };
    return lastResult;
  }

  return {
    async start() { running = true; },
    async stop() { running = false; },
    status() { return { running, lastRunAt, lastResult }; },
    runOnce,
    calls
  };
}

module.exports = {
  createIntervalRuntime,
  createMockRuntime
};
