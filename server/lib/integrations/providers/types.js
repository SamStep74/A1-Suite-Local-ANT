/**
 * providers/types — Per-provider outbound adapter contract.
 *
 * Each adapter owns the HTTP shape for ONE external service
 * (Apollo, Instantly, Closely, ...). The Tube trigger dispatch
 * chain (server/smbCrmOutbound.js) routes through this contract
 * instead of hand-rolling URLs per provider.
 *
 * The contract is intentionally narrow: just `enrollContact` for
 * now. P2 will add PULL methods (search, enrich, sync) per
 * provider.
 *
 * Adding a new sequence provider:
 *   1. Add the literal id to SequenceProvider.id in this file
 *   2. Write a new providers/{name}.js implementing the contract
 *   3. Register it in providers/index.js PROVIDERS map
 *   4. Add it to the Zod enum for trigger action.provider
 *
 * Pure: no I/O, no DB import, no side effects.
 */
'use strict';

/**
 * Contact info shape that all sequence providers need.
 * @typedef {Object} SequenceContact
 * @property {string} email
 * @property {string} firstName
 * @property {string} lastName
 * @property {string|null} [phone]
 * @property {string} [externalContactId]
 */

/**
 * Deal context — providers that want it can attach it as metadata.
 * @typedef {Object} SequenceDealContext
 * @property {string} dealId
 * @property {string|null} fromStageName
 * @property {string} toStageName
 */

/**
 * Trigger action payload for enroll-in-sequence. Mirrors the
 * subset of TriggerActionEnrollInSequence that adapters need.
 * @typedef {Object} EnrollAction
 * @property {'apollo'|'instantly'|'closely'} provider
 * @property {string} sequenceId
 * @property {string} [mailboxAlias]
 * @property {string} [listId]
 */

/**
 * What the caller hands the adapter.
 * @typedef {Object} EnrollRequest
 * @property {string} tenantId
 * @property {string} integrationId
 * @property {EnrollAction} action
 * @property {SequenceContact} contact
 * @property {SequenceDealContext} deal
 * @property {string} correlationId  passed downstream as correlationId
 */

/**
 * A sequence provider that can enroll a contact.
 * @typedef {Object} SequenceProvider
 * @property {'apollo'|'instantly'|'closely'} id
 * @property {string} displayName
 * @property {string} apiHost
 * @property {(sequenceId: string, mailboxAlias?: string) => string} buildEnrollUrl
 * @property {(req: EnrollRequest) => Record<string, unknown>} buildEnrollBody
 * @property {(apiKey: string) => string} resolveAuthHeader
 * @property {(body: Record<string, unknown>) => (string|null)} [validateEnrollBody]
 */

const PROVIDER_IDS = /** @type {const} */ (['apollo', 'instantly', 'closely']);

/**
 * @param {unknown} value
 * @returns {import('./types').SequenceProvider['id']|null}
 */
function coerceProviderId(value) {
  if (typeof value === 'string' && PROVIDER_IDS.includes(/** @type {any} */ (value))) {
    return /** @type {any} */ (value);
  }
  return null;
}

module.exports = {
  PROVIDER_IDS,
  coerceProviderId
};
