/**
 * providers/closely — Closely (closelyhq.com) outbound adapter.
 *
 * Phase 1: enrollment only. P2: contact pull, reply detection.
 *
 * Auth shape: `Bearer <apiKey>` header.
 *
 * Pure: no I/O, no DB import.
 */
'use strict';

const closelyProvider = {
  id: 'closely',
  displayName: 'Closely',
  apiHost: 'api.closelyhq.com',

  buildEnrollUrl(sequenceId) {
    return `https://api.closelyhq.com/v1/sequences/${encodeURIComponent(sequenceId)}/leads`;
  },

  buildEnrollBody({ contact, deal, action }) {
    return {
      sequence_id: action.sequenceId,
      email: contact.email,
      first_name: contact.firstName,
      last_name: contact.lastName,
      phone: contact.phone ?? null,
      // Closely's "lead fields" accept arbitrary key/value passthrough.
      custom_fields: [
        { key: 'a1_deal_id', value: deal.dealId },
        { key: 'a1_from_stage', value: deal.fromStageName ?? '' },
        { key: 'a1_to_stage', value: deal.toStageName }
      ]
    };
  },

  resolveAuthHeader(apiKey) {
    return `Bearer ${apiKey}`;
  }
};

module.exports = { closelyProvider };
