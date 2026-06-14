/**
 * providers/instantly — Instantly (instantly.ai) outbound adapter.
 *
 * Phase 1: enrollment only. P2: campaign stats, lead-to-campaign
 * sync.
 *
 * Auth shape: `Bearer <apiKey>` header. Caller is responsible for
 * injecting this into the fetch request Authorization field.
 *
 * Pure: no I/O, no DB import.
 */
'use strict';

const instantlyProvider = {
  id: 'instantly',
  displayName: 'Instantly',
  apiHost: 'api.instantly.ai',

  buildEnrollUrl(sequenceId) {
    // Instantly's "campaign" == "sequence" in our model. mailboxAlias
    // is a per-sending-account grouping; Instantly uses emails[] array
    // so we pass the alias as a sending account label downstream.
    return `https://api.instantly.ai/v1/campaigns/${encodeURIComponent(sequenceId)}/leads`;
  },

  buildEnrollBody({ contact, deal, action }) {
    return {
      campaign_id: action.sequenceId,
      email: contact.email,
      first_name: contact.firstName,
      last_name: contact.lastName,
      phone: contact.phone ?? undefined,
      // Custom variables surface in the Instantly UI for templating.
      personalization: {
        deal_id: deal.dealId,
        from_stage: deal.fromStageName ?? '',
        to_stage: deal.toStageName
      }
    };
  },

  resolveAuthHeader(apiKey) {
    return `Bearer ${apiKey}`;
  }
};

module.exports = { instantlyProvider };
