/**
 * oauth/index — Barrel for the OAuth module.
 *
 * Slice 3: registry + state-store.
 * Slice 4: token-store + refresh.
 * Slice 5: scheduler + runtime (this update).
 */
'use strict';

const registry = require('./registry');
const stateStore = require('./state-store');
const tokenStore = require('./token-store');
const refresh = require('./refresh');
const scheduler = require('./scheduler');
const runtime = require('./runtime');

module.exports = {
  // Slice 3
  ...registry,
  ...stateStore,
  // Slice 4
  ...tokenStore,
  ...refresh,
  // Slice 5
  ...scheduler,
  ...runtime
};
