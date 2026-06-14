/**
 * oauth/index — Barrel for the OAuth module.
 *
 * Slice 3 ships the registry + state-store.
 * Slice 4 (this update) adds token-store + refresh.
 * Slice 5 will append scheduler + worker re-exports.
 */
'use strict';

const registry = require('./registry');
const stateStore = require('./state-store');
const tokenStore = require('./token-store');
const refresh = require('./refresh');

module.exports = {
  // Slice 3
  ...registry,
  ...stateStore,
  // Slice 4 (this commit)
  ...tokenStore,
  ...refresh
  // Slice 5 will append: scheduler, worker
};
