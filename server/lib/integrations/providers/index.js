/**
 * providers/index — Provider registry.
 *
 * The Tube trigger dispatch chain (server/smbCrmOutbound.js)
 * looks up the provider here instead of hand-rolling per-provider
 * switches. Adding a new sequence provider:
 *
 *   1. Add the literal id to PROVIDER_IDS in providers/types.js
 *   2. Write a new providers/{name}.js implementing the contract
 *   3. Register it in PROVIDERS below
 *   4. Add it to the Zod enum for trigger action.provider
 *
 * Pure: no I/O, no DB import.
 */
'use strict';

const { apolloProvider } = require('./apollo');
const { instantlyProvider } = require('./instantly');
const { closelyProvider } = require('./closely');

const PROVIDERS = {
  apollo: apolloProvider,
  instantly: instantlyProvider,
  closely: closelyProvider
};

class ProviderRegistryError extends Error {
  constructor(message) {
    super(`[PROVIDER_NOT_FOUND] ${message}`);
    this.name = 'ProviderRegistryError';
  }
}

function getSequenceProvider(id) {
  const p = PROVIDERS[id];
  if (!p) {
    throw new ProviderRegistryError(
      `Unknown sequence provider: ${id}. Known: ${listSequenceProviders().join(', ')}`
    );
  }
  return p;
}

function listSequenceProviders() {
  return Object.keys(PROVIDERS);
}

function isSequenceProvider(id) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id);
}

module.exports = {
  getSequenceProvider,
  listSequenceProviders,
  isSequenceProvider,
  ProviderRegistryError
};
