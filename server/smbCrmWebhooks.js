"use strict";

/**
 * A1 SMB CRM — Inbound webhook engine (Track 4: M14.13).
 *
 * Pattern A: pure functions, no Fastify imports, no `node:sqlite`
 * imports, no `process.env` reads.
 *
 * 7 channels:
 *   whatsapp     — Meta WhatsApp Cloud API
 *   meta-leads   — Meta Lead Ads
 *   telephony    — generic telephony provider (Twilio, Voximplant, etc.)
 *   calendar     — Google / Outlook / Cal.com calendar event
 *   sheets       — Google Sheets row update
 *   email        — inbound IMAP / SendGrid inbound parse
 *   payment      — Stripe / Idram / Ameriabank payment webhook
 *
 * Public surface:
 *   handleInboundWebhook(db, orgId, channel, payload) → row
 *   listWebhookEvents(db, orgId, filters)             → row[]
 *   getWebhookEvent(db, orgId, id)                     → row | null
 *   processWebhookEvent(db, orgId, id)                 → row
 *   toWebhookEventView(raw)                            → camelCase
 *   normalizePayload(channel, payload)                 → object
 *
 * Each channel has a normalizer that maps the provider's wire
 * format to a stable internal shape. V1 is purely structural: no
 * real provider signing, no retries, no follow-on automations —
 * the row is persisted with a normalized payload and the SPA
 * renders it for human review.
 *
 * Idempotency: the inbound route uses an `idempotencyKey` (typically
 * the provider's own message ID). If the same (orgId, channel, key)
 * is seen twice, the second call returns the first row without
 * inserting a duplicate.
 *
 * Schema lives in `server/db.js#ensureSmbCrmAutomationSchema`
 * (`smb_crm_webhook_events` table, unique index on
 * (org_id, channel, idempotency_key)).
 */

const crypto = require("node:crypto");

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}

function nowIso() { return new Date().toISOString(); }

function safeJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

// ─── Errors ──────────────────────────────────────────────────────────────

class WebhooksError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = "WebhooksError";
    this.code = code;
    this.statusCode = statusCode || 400;
  }
}

class NotFoundError extends WebhooksError {
  constructor(message) { super("NOT_FOUND", message, 404); this.name = "NotFoundError"; }
}

// ─── Validation helpers ──────────────────────────────────────────────────

const VALID_CHANNELS = [
  "whatsapp",
  "meta-leads",
  "telephony",
  "calendar",
  "sheets",
  "email",
  "payment"
];

function nonEmptyString(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new WebhooksError("MISSING_FIELD", `${field} is required`);
  }
  return String(value).trim();
}

function validateChannel(value) {
  const v = nonEmptyString(value, "channel").toLowerCase();
  if (!VALID_CHANNELS.includes(v)) {
    throw new WebhooksError("INVALID_CHANNEL", `channel must be one of ${VALID_CHANNELS.join("|")}`);
  }
  return v;
}

function assertOrgScope(orgId) {
  if (!orgId || typeof orgId !== "string") {
    throw new WebhooksError("MISSING_ORG_ID", "orgId is required");
  }
}

function inOrg(db, table, orgId, id) {
  const row = db
    .prepare(`SELECT * FROM ${table} WHERE id = ? AND org_id = ?`)
    .get(id, orgId);
  return row || null;
}

// ════════════════════════════════════════════════════════════════════════
// NORMALIZERS
// Each returns a { normalized, idempotencyKey } tuple.
//   - `normalized` is the canonical internal shape
//   - `idempotencyKey` is the provider's unique-per-message id; if
//     the caller didn't supply one, we hash the payload to make
//     replays detectably idempotent.
// ════════════════════════════════════════════════════════════════════════

function _idempotencyKey(channel, payload, supplied) {
  if (supplied) return String(supplied);
  // Stable hash of (channel + first 4KB of payload). Same payload
  // produces the same key, so retries dedup.
  const stable = JSON.stringify({ channel, payload: payload || {} });
  return crypto.createHash("sha256").update(stable).digest("hex").slice(0, 32);
}

const NORMALIZERS = {
  "whatsapp": payload => {
    const entry = Array.isArray(payload.entry) ? payload.entry[0] : null;
    const change = entry && Array.isArray(entry.changes) ? entry.changes[0] : null;
    const value = change && change.value;
    const msg = value && Array.isArray(value.messages) ? value.messages[0] : null;
    return {
      normalized: {
        from: msg ? msg.from : null,
        body: msg && msg.text ? msg.text.body : null,
        messageId: msg ? msg.id : null,
        timestamp: msg ? msg.timestamp : null,
        phoneNumberId: value ? value.metadata && value.metadata.phone_number_id : null,
        displayPhoneNumber: value ? value.metadata && value.metadata.display_phone_number : null
      }
    };
  },
  "meta-leads": payload => {
    const entry = Array.isArray(payload.entry) ? payload.entry[0] : null;
    const change = entry && Array.isArray(entry.changes) ? entry.changes[0] : null;
    const lead = change && change.value && Array.isArray(change.value.leadgen_id)
      ? { leadgenId: change.value.leadgen_id[0] }
      : (change && change.value && change.value.leadgen_id
        ? { leadgenId: change.value.leadgen_id }
        : null);
    return {
      normalized: {
        leadgenId: lead ? lead.leadgenId : null,
        formId: change && change.value ? change.value.form_id : null,
        adId: change && change.value ? change.value.ad_id : null,
        campaignId: change && change.value ? change.value.campaign_id : null
      }
    };
  },
  "telephony": payload => ({
    normalized: {
      callId: payload && payload.CallSid || payload.callId || null,
      from: payload && payload.From || payload.from || null,
      to: payload && payload.To || payload.to || null,
      direction: payload && payload.Direction || payload.direction || null,
      status: payload && payload.CallStatus || payload.status || null,
      durationSec: payload && payload.Duration ? Number(payload.Duration) : null
    }
  }),
  "calendar": payload => ({
    normalized: {
      eventId: payload && (payload.id || payload.eventId) || null,
      summary: payload && (payload.summary || payload.title) || null,
      startAt: payload && (payload.start && (payload.start.dateTime || payload.start.date) || payload.startAt) || null,
      endAt: payload && (payload.end && (payload.end.dateTime || payload.end.date) || payload.endAt) || null,
      attendees: Array.isArray(payload && payload.attendees) ? payload.attendees.map(a => a.email || a.name || null) : []
    }
  }),
  "sheets": payload => ({
    normalized: {
      spreadsheetId: payload && (payload.spreadsheetId || payload.spreadsheet_id) || null,
      range: payload && payload.range || null,
      rowCount: payload && Array.isArray(payload.values) ? payload.values.length : null,
      columnCount: payload && Array.isArray(payload.values) && payload.values[0] ? payload.values[0].length : null,
      firstRow: payload && Array.isArray(payload.values) ? payload.values[0] : null
    }
  }),
  "email": payload => ({
    normalized: {
      messageId: payload && (payload.messageId || payload.MessageID || payload["Message-ID"]) || null,
      from: payload && (payload.from || payload.From) || null,
      to: payload && (payload.to || payload.To) || null,
      subject: payload && (payload.subject || payload.Subject) || null,
      bodyText: payload && (payload.text || payload.body || payload.Body) || null,
      receivedAt: payload && (payload.date || payload.received_at) || null
    }
  }),
  "payment": payload => ({
    normalized: {
      eventType: payload && (payload.type || payload.event_type) || null,
      paymentId: payload && (payload.id || payload.payment_id) || null,
      amount: payload && (payload.amount || payload.amount_total) ? Number(payload.amount || payload.amount_total) : null,
      currency: payload && (payload.currency || payload.currency_code) || null,
      status: payload && (payload.status || payload.payment_status) || null,
      customerId: payload && (payload.customer || payload.customer_id) || null
    }
  })
};

function normalizePayload(channel, payload) {
  const ch = validateChannel(channel);
  const normalizer = NORMALIZERS[ch];
  if (!normalizer) {
    throw new WebhooksError("INVALID_CHANNEL", `no normalizer for channel ${ch}`);
  }
  return normalizer(payload || {});
}

// ════════════════════════════════════════════════════════════════════════
// ENGINE
// ════════════════════════════════════════════════════════════════════════

function handleInboundWebhook(db, orgId, channel, payload, opts) {
  assertOrgScope(orgId);
  opts = opts || {};
  payload = payload || {};
  const ch = validateChannel(channel);
  const norm = normalizePayload(ch, payload);
  const idemKey = _idempotencyKey(ch, payload, opts.idempotencyKey);
  // Idempotency check first: the unique index on
  // (org_id, channel, idempotency_key) prevents duplicate rows,
  // but we also want to return the original envelope to the
  // caller without throwing — that's the contract of a webhook
  // receiver.
  if (idemKey) {
    const existing = db
      .prepare(`SELECT * FROM smb_crm_webhook_events WHERE org_id = ? AND channel = ? AND idempotency_key = ?`)
      .get(orgId, ch, idemKey);
    if (existing) return existing;
  }
  const id = randomId("whk");
  const now = nowIso();
  const fullPayload = {
    raw: payload,
    normalized: norm.normalized
  };
  db.prepare(`
    INSERT INTO smb_crm_webhook_events (
      id, org_id, channel, payload_json, status, idempotency_key, received_at
    ) VALUES (?, ?, ?, ?, 'received', ?, ?)
  `).run(id, orgId, ch, JSON.stringify(fullPayload), idemKey, now);
  return getWebhookEvent(db, orgId, id);
}

function listWebhookEvents(db, orgId, filters) {
  filters = filters || {};
  const where = ["org_id = ?"];
  const params = [orgId];
  if (filters.channel) {
    where.push("channel = ?");
    params.push(String(filters.channel).trim().toLowerCase());
  }
  if (filters.status) {
    where.push("status = ?");
    params.push(String(filters.status).trim().toLowerCase());
  }
  return db.prepare(`
    SELECT * FROM smb_crm_webhook_events
     WHERE ${where.join(" AND ")}
     ORDER BY received_at DESC
     LIMIT ?
  `).all(...params, Math.max(1, Math.min(500, Number(filters.limit) || 100)));
}

function getWebhookEvent(db, orgId, id) {
  return inOrg(db, "smb_crm_webhook_events", orgId, id);
}

function processWebhookEvent(db, orgId, id) {
  const row = inOrg(db, "smb_crm_webhook_events", orgId, id);
  if (!row) return null;
  // V1: deterministic transition received → processed. The actual
  // "do something with this" logic lives in the SPA or a future V2
  // dispatcher — for V1 the audit trail of "received" is enough.
  const now = nowIso();
  db.prepare(`
    UPDATE smb_crm_webhook_events
       SET status = 'processed', processed_at = ?
     WHERE id = ? AND org_id = ?
  `).run(now, id, orgId);
  return getWebhookEvent(db, orgId, id);
}

// ════════════════════════════════════════════════════════════════════════
// VIEW ADAPTER
// ════════════════════════════════════════════════════════════════════════

function toWebhookEventView(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    orgId: raw.org_id,
    channel: raw.channel,
    payload: safeJson(raw.payload_json, {}),
    status: raw.status,
    idempotencyKey: raw.idempotency_key,
    receivedAt: raw.received_at,
    processedAt: raw.processed_at,
    errorText: raw.error_text
  };
}

module.exports = {
  handleInboundWebhook,
  listWebhookEvents,
  getWebhookEvent,
  processWebhookEvent,
  normalizePayload,
  toWebhookEventView,
  VALID_CHANNELS,
  NORMALIZERS,
  WebhooksError,
  NotFoundError
};
