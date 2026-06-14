/**
 * providers/apollo — Apollo (apollo.io) outbound adapter.
 *
 * Phase 1: enrollment only. P2: contact search, email enrichment.
 *
 * Auth shape: Apollo's enroll endpoint uses `api_key=...` as a
 * query param — we hand-build the URL and let resolveAuthHeader
 * return the literal `api_key=<key>` string. The caller (smbCrm
 * Outbound dispatch) appends it to the URL before sending.
 *
 * Pure: no I/O, no DB import.
 */
'use strict';

const apolloProvider = {
  id: 'apollo',
  displayName: 'Apollo',
  apiHost: 'api.apollo.io',

  buildEnrollUrl(sequenceId, mailboxAlias) {
    const url = new URL(
      `https://api.apollo.io/api/v1/emailer_campaigns/${encodeURIComponent(sequenceId)}/add_contact_ids`
    );
    url.searchParams.set('emailer_campaign_id', sequenceId);
    if (mailboxAlias) {
      url.searchParams.set('send_email_from_email_account_id', mailboxAlias);
    }
    return url.toString();
  },

  buildEnrollBody({ contact, deal, action }) {
    return {
      emailer_campaign_id: action.sequenceId,
      contact_ids: contact.externalContactId ? [contact.externalContactId] : undefined,
      send_email_from_email_account_id: action.mailboxAlias,
      // We attach deal context as Apollo "contact custom fields" so
      // the SDR sees deal origin in the Apollo UI.
      contact_custom_fields: {
        a1_deal_id: deal.dealId,
        a1_from_stage: deal.fromStageName ?? '',
        a1_to_stage: deal.toStageName
      }
    };
  },

  resolveAuthHeader(apiKey) {
    return `api_key=${apiKey}`;
  },

  validateEnrollBody(body) {
    const contactIds = stringArray(body.contact_ids) ?? stringArray(body['contact_ids[]']);
    if (!contactIds || !contactIds.length) {
      return 'Apollo sequence enrollment requires Apollo contact_ids[]; create or resolve the contact before enrolling.';
    }
    if (!stringValue(body.send_email_from_email_account_id)) {
      return 'Apollo sequence enrollment requires send_email_from_email_account_id.';
    }
    return null;
  }
};

function stringArray(value) {
  if (!Array.isArray(value)) return null;
  const out = value.filter(
    (item) => typeof item === 'string' && item.trim().length > 0
  );
  return out.length > 0 ? out : null;
}

function stringValue(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

module.exports = { apolloProvider };
