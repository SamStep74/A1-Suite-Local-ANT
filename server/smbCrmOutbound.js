"use strict";

/**
 * A1 SMB CRM — Outbound messaging engine (Track 4: M14.12).
 *
 * Pattern A: pure functions, no Fastify imports, no `node:sqlite`
 * imports, no `process.env` reads.
 *
 * Public surface:
 *   queueOutbound(db, orgId, input)   → row (status=queued)
 *   sendOutbound(db, orgId, id)        → row (status=sent | failed)
 *   sendOutboundBatch(db, orgId, ids)  → row[]
 *   listOutbound(db, orgId, filters)   → row[]
 *   getOutbound(db, orgId, id)         → row | null
 *   cancelOutbound(db, orgId, id)      → row | null
 *   toOutboundView(raw)                → camelCase
 *
 * Channels: whatsapp, sms, email, webhook. V1 uses a STUB provider
 * for all channels — it returns a deterministic envelope and
 * does NOT touch the network. The real provider implementations
 * are V2 (mirrors the crm-tube connector surface: each channel
 * can be swapped via an adapter pattern in a follow-up).
 *
 * Schema lives in `server/db.js#ensureSmbCrmAutomationSchema`
 * (`smb_crm_outbound_messages` table).
 *
 * Status lifecycle:
 *   queued → sending → sent   (happy path)
 *                    → failed (with error_text)
 *   queued → cancelled        (caller-driven, before send)
 *
 * Cross-tenant safety: every read+write takes `orgId` as a
 * positional argument. Foreign get/list returns `null` / `[]`.
 * Foreign send/cancel returns `null` (no-op).
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

class OutboundError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = "OutboundError";
    this.code = code;
    this.statusCode = statusCode || 400;
  }
}

class NotFoundError extends OutboundError {
  constructor(message) { super("NOT_FOUND", message, 404); this.name = "NotFoundError"; }
}

// ─── Validation helpers ──────────────────────────────────────────────────

const VALID_CHANNELS = ["whatsapp", "sms", "email", "webhook"];

function nonEmptyString(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new OutboundError("MISSING_FIELD", `${field} is required`);
  }
  return String(value).trim();
}

function validateChannel(value) {
  const v = nonEmptyString(value, "channel").toLowerCase();
  if (!VALID_CHANNELS.includes(v)) {
    throw new OutboundError("INVALID_CHANNEL", `channel must be one of ${VALID_CHANNELS.join("|")}`);
  }
  return v;
}

function assertOrgScope(orgId) {
  if (!orgId || typeof orgId !== "string") {
    throw new OutboundError("MISSING_ORG_ID", "orgId is required");
  }
}

function inOrg(db, table, orgId, id) {
  const row = db
    .prepare(`SELECT * FROM ${table} WHERE id = ? AND org_id = ?`)
    .get(id, orgId);
  return row || null;
}

// ─── Stub provider (V1) ──────────────────────────────────────────────────
// The V1 outbound engine never touches the network. Every channel
// is routed through this provider, which returns a deterministic
// envelope { providerMessageId, deliveredAt, response }.

const STUB_PROVIDER = {
  async send(channel, toAddress, body) {
    // Deterministic-ish envelope: id derives from inputs so tests
    // can assert exact values; deliveredAt is the current timestamp.
    const seed = `${channel}|${toAddress || ""}|${body || ""}`;
    const hash = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 12);
    return {
      provider: "stub",
      channel,
      providerMessageId: `stub-${hash}`,
      deliveredAt: nowIso(),
      response: { ok: true, channel, to: toAddress || null, bytes: (body || "").length }
    };
  }
};

// ════════════════════════════════════════════════════════════════════════
// QUEUE / SEND
// ════════════════════════════════════════════════════════════════════════

function queueOutbound(db, orgId, input, opts) {
  assertOrgScope(orgId);
  input = input || {};
  opts = opts || {};
  const channel = validateChannel(input.channel);
  const body = nonEmptyString(input.body, "body");
  const contactId = input.contactId ? String(input.contactId) : null;
  const toAddress = input.toAddress ? String(input.toAddress).trim() : null;
  const scheduledAt = input.scheduledAt ? String(input.scheduledAt) : null;
  const now = nowIso();
  const id = randomId("out");
  db.prepare(`
    INSERT INTO smb_crm_outbound_messages (
      id, org_id, channel, contact_id, to_address, body, status, scheduled_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
  `).run(id, orgId, channel, contactId, toAddress, body, scheduledAt, now);
  return getOutbound(db, orgId, id);
}

async function sendOutbound(db, orgId, id, provider) {
  provider = provider || STUB_PROVIDER;
  const row = inOrg(db, "smb_crm_outbound_messages", orgId, id);
  if (!row) return null;
  if (row.status === "cancelled") return row;
  // Move to "sending"
  db.prepare(`
    UPDATE smb_crm_outbound_messages
       SET status = 'sending'
     WHERE id = ? AND org_id = ?
  `).run(id, orgId);
  try {
    const result = await provider.send(row.channel, row.to_address, row.body);
    const sentAt = nowIso();
    // Persist the full envelope (provider / channel / providerMessageId /
    // deliveredAt / response) so the view adapter can expose them.
    db.prepare(`
      UPDATE smb_crm_outbound_messages
         SET status = 'sent', sent_at = ?, provider = ?, response_json = ?
       WHERE id = ? AND org_id = ?
    `).run(sentAt, result.provider, JSON.stringify(result), id, orgId);
  } catch (err) {
    const errText = String(err && err.message || err);
    db.prepare(`
      UPDATE smb_crm_outbound_messages
         SET status = 'failed', error_text = ?
       WHERE id = ? AND org_id = ?
    `).run(errText, id, orgId);
  }
  return getOutbound(db, orgId, id);
}

async function sendOutboundBatch(db, orgId, ids, provider) {
  provider = provider || STUB_PROVIDER;
  const out = [];
  for (const id of ids) {
    const row = await sendOutbound(db, orgId, id, provider);
    if (row) out.push(row);
  }
  return out;
}

function listOutbound(db, orgId, filters) {
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
  if (filters.contactId) {
    where.push("contact_id = ?");
    params.push(String(filters.contactId));
  }
  return db.prepare(`
    SELECT * FROM smb_crm_outbound_messages
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT ?
  `).all(...params, Math.max(1, Math.min(500, Number(filters.limit) || 100)));
}

function getOutbound(db, orgId, id) {
  return inOrg(db, "smb_crm_outbound_messages", orgId, id);
}

function cancelOutbound(db, orgId, id) {
  const row = inOrg(db, "smb_crm_outbound_messages", orgId, id);
  if (!row) return null;
  if (row.status === "sent" || row.status === "sending" || row.status === "cancelled") {
    return row; // cannot cancel a sent/sending/cancelled message
  }
  db.prepare(`
    UPDATE smb_crm_outbound_messages
       SET status = 'cancelled'
     WHERE id = ? AND org_id = ?
  `).run(id, orgId);
  return getOutbound(db, orgId, id);
}

// ════════════════════════════════════════════════════════════════════════
// VIEW ADAPTER
// ════════════════════════════════════════════════════════════════════════

function toOutboundView(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    orgId: raw.org_id,
    channel: raw.channel,
    contactId: raw.contact_id,
    toAddress: raw.to_address,
    body: raw.body,
    status: raw.status,
    scheduledAt: raw.scheduled_at,
    sentAt: raw.sent_at,
    provider: raw.provider,
    response: safeJson(raw.response_json, null),
    errorText: raw.error_text,
    createdAt: raw.created_at
  };
}

module.exports = {
  queueOutbound,
  sendOutbound,
  sendOutboundBatch,
  listOutbound,
  getOutbound,
  cancelOutbound,
  toOutboundView,
  // Constants
  VALID_CHANNELS,
  STUB_PROVIDER,
  // Errors
  OutboundError,
  NotFoundError
};
