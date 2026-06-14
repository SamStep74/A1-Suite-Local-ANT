/**
 * oauth/index — Barrel for the OAuth module.
 *
 * Slice 3 ships the registry + state-store. Slices 4 and 5 will
 * add `token-store`, `refresh`, `scheduler`, and `worker`
 * re-exports here as those land.
 */
'use strict';

const registry = require('./registry');
const stateStore = require('./state-store');

module.exports = {
  // Slice 3 (this commit)
  ...registry,
  ...stateStore
  // Slices 4 + 5 will append: token-store, refresh, scheduler, worker
};
