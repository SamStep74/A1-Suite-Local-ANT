"use strict";

/**
 * A1 CRM Tube — pure engine.
 *
 * Ported from a1-suite-local-extended/server/crm-tube/tube-db.js
 * (the v0.5 audit-grade engine, 9/9 contract tests green) to ANT's
 * server/<module>.js Pattern A shape:
 *   - CJS module, no `require('node:sqlite')` or `require('fastify')`
 *   - All functions accept `db` as first param so the route layer
 *     in server/app.js owns the Fastify surface, auth, app-access,
 *     validation, audit, and idempotency.
 *   - Idempotent: re-enrolling a contact into a sequence is a no-op
 *     via the UNIQUE(sequence_id, contact_id) constraint + a
 *     defense-in-depth per-row try/catch.
 *   - Armenian-first labels live in web-modern/src/lib/api/locale.ts.
 *
 * Phase 8.13 — Tube port. The /app/crm tab. Tag candidate: phase8-tube-v1.
 */

const crypto = require("node:crypto");

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}

function safeJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function nowIso() { return new Date().toISOString(); }

function cryptoRandomHex(len) {
  return crypto.randomBytes(len).toString("hex");
}

// ─── Tubes & stages ─────────────────────────────────────────────────────

/**
 * Idempotent: returns the existing default tube for the org, or
 * seeds a fresh "Default tube" + 6 stages (Lead/Qualified/Proposal/
 * Negotiation/Won/Lost) on first access. Caller never has to check.
 */
function ensureDefaultTube(db, orgId) {
  const existing = db
    .prepare("SELECT id FROM tube_tubes WHERE org_id = ? AND is_default = 1")
    .get(orgId);
  if (existing) return existing.id;
  const tubeId = randomId("tube");
  const now = nowIso();
  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO tube_tubes (id, org_id, name, description, is_default, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 0, ?, ?)
    `).run(tubeId, orgId, "Default tube", "Auto-created on first use.", now, now);
    const stages = [
      { name: "Lead",        probability: 10,  is_won: 0, is_lost: 0, color: "#94a3b8" },
      { name: "Qualified",   probability: 30,  is_won: 0, is_lost: 0, color: "#38bdf8" },
      { name: "Proposal",    probability: 60,  is_won: 0, is_lost: 0, color: "#f59e0b" },
      { name: "Negotiation", probability: 80,  is_won: 0, is_lost: 0, color: "#a855f7" },
      { name: "Won",         probability: 100, is_won: 1, is_lost: 0, color: "#10b981" },
      { name: "Lost",        probability: 0,   is_won: 0, is_lost: 1, color: "#ef4444" }
    ];
    const insertStage = db.prepare(`
      INSERT INTO tube_stages (id, org_id, tube_id, name, position, probability, is_won, is_lost, color, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stages.forEach((stage, index) => {
      insertStage.run(
        randomId("stage"), orgId, tubeId, stage.name, index,
        stage.probability, stage.is_won, stage.is_lost, stage.color, now
      );
    });
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* swallow */ }
    throw err;
  }
  return tubeId;
}

function listTubes(db, orgId) {
  const tubes = db
    .prepare("SELECT * FROM tube_tubes WHERE org_id = ? ORDER BY position, name")
    .all(orgId);
  const stages = db
    .prepare("SELECT * FROM tube_stages WHERE org_id = ? ORDER BY position")
    .all(orgId);
  return tubes.map(t => ({ ...t, stages: stages.filter(s => s.tube_id === t.id) }));
}

// ─── Deals ─────────────────────────────────────────────────────────────

function listDeals(db, orgId, filters) {
  filters = filters || {};
  const where = ["d.org_id = ?"];
  const params = [orgId];
  if (filters.stageId) { where.push("d.stage_id = ?"); params.push(filters.stageId); }
  if (filters.tubeId)  { where.push("d.tube_id = ?");  params.push(filters.tubeId); }
  if (filters.ownerId) { where.push("d.owner_user_id = ?"); params.push(filters.ownerId); }
  if (filters.status)  { where.push("d.status = ?");  params.push(filters.status); }
  return db.prepare(`
    SELECT d.*,
           c.full_name AS contact_name,
           c.email     AS contact_email,
           o.name      AS organization_name,
           s.name      AS stage_name,
           s.probability AS stage_probability
    FROM tube_deals d
    LEFT JOIN tube_contacts c       ON c.id = d.contact_id
    LEFT JOIN tube_organizations o  ON o.id = d.organization_id
    LEFT JOIN tube_stages s         ON s.id = d.stage_id
    WHERE ${where.join(" AND ")}
    ORDER BY d.updated_at DESC
    LIMIT ?
  `).all(...params, filters.limit || 200);
}

function getDeal(db, orgId, dealId) {
  return db.prepare(`
    SELECT d.*,
           c.full_name AS contact_name,
           c.email     AS contact_email,
           o.name      AS organization_name,
           s.name      AS stage_name,
           s.probability AS stage_probability,
           t.name      AS tube_name
    FROM tube_deals d
    LEFT JOIN tube_contacts c       ON c.id = d.contact_id
    LEFT JOIN tube_organizations o  ON o.id = d.organization_id
    LEFT JOIN tube_stages s         ON s.id = d.stage_id
    LEFT JOIN tube_tubes t          ON t.id = d.tube_id
    WHERE d.org_id = ? AND d.id = ?
  `).get(orgId, dealId) || null;
}

function moveDealStage(db, orgId, dealId, stageId) {
  const stage = db
    .prepare("SELECT * FROM tube_stages WHERE org_id = ? AND id = ?")
    .get(orgId, stageId);
  if (!stage) {
    const err = new Error("Stage not found");
    err.statusCode = 404;
    throw err;
  }
  const now = nowIso();
  const status = stage.is_won ? "won" : stage.is_lost ? "lost" : "open";
  const closedAt = (stage.is_won || stage.is_lost) ? now : null;
  db.prepare(`
    UPDATE tube_deals
       SET stage_id = ?, status = ?, closed_at = ?, updated_at = ?
     WHERE org_id = ? AND id = ?
  `).run(stageId, status, closedAt, now, orgId, dealId);
  return getDeal(db, orgId, dealId);
}

// ─── Contacts & organizations ──────────────────────────────────────────

function listContacts(db, orgId, filters) {
  filters = filters || {};
  return db.prepare(`
    SELECT c.*, o.name AS organization_name
    FROM tube_contacts c
    LEFT JOIN tube_organizations o ON o.id = c.organization_id
    WHERE c.org_id = ?
    ORDER BY c.updated_at DESC
    LIMIT ?
  `).all(orgId, filters.limit || 200);
}

function listOrganizations(db, orgId, filters) {
  filters = filters || {};
  return db.prepare(`
    SELECT * FROM tube_organizations
    WHERE org_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(orgId, filters.limit || 200);
}

// ─── Activity & conversations ─────────────────────────────────────────

function listActivities(db, orgId, filters) {
  filters = filters || {};
  const where = ["a.org_id = ?"];
  const params = [orgId];
  if (filters.dealId)    { where.push("a.deal_id = ?");    params.push(filters.dealId); }
  if (filters.contactId) { where.push("a.contact_id = ?"); params.push(filters.contactId); }
  if (filters.kind)      { where.push("a.kind = ?");      params.push(filters.kind); }
  return db.prepare(`
    SELECT a.*, d.title AS deal_title, c.full_name AS contact_name
    FROM tube_activities a
    LEFT JOIN tube_deals d    ON d.id = a.deal_id
    LEFT JOIN tube_contacts c ON c.id = a.contact_id
    WHERE ${where.join(" AND ")}
    ORDER BY a.occurred_at DESC
    LIMIT ?
  `).all(...params, filters.limit || 100);
}

function listConversations(db, orgId, filters) {
  filters = filters || {};
  return db.prepare(`
    SELECT conv.*, c.full_name AS contact_name, d.title AS deal_title,
           (SELECT body FROM tube_messages m
             WHERE m.conversation_id = conv.id
             ORDER BY sent_at DESC LIMIT 1) AS last_message_body
    FROM tube_conversations conv
    LEFT JOIN tube_contacts c ON c.id = conv.contact_id
    LEFT JOIN tube_deals d    ON d.id = conv.deal_id
    WHERE conv.org_id = ?
    ORDER BY conv.last_message_at DESC
    LIMIT ?
  `).all(orgId, filters.limit || 50);
}

// ─── Integrations ──────────────────────────────────────────────────────

function listIntegrations(db, orgId) {
  return db
    .prepare("SELECT * FROM tube_integrations WHERE org_id = ? ORDER BY connector_key")
    .all(orgId);
}

function getIntegration(db, orgId, key) {
  return db
    .prepare("SELECT * FROM tube_integrations WHERE org_id = ? AND connector_key = ?")
    .get(orgId, key) || null;
}

function upsertIntegration(db, orgId, integration) {
  const now = nowIso();
  const existing = getIntegration(db, orgId, integration.connector_key);
  if (existing) {
    db.prepare(`
      UPDATE tube_integrations
         SET status = ?, environment = ?, config = ?, secret_hash = ?,
             secret_fingerprint = ?, scopes = ?, capabilities = ?, updated_at = ?
       WHERE org_id = ? AND id = ?
    `).run(
      integration.status || existing.status,
      integration.environment || existing.environment,
      JSON.stringify(integration.config || safeJson(existing.config, {})),
      integration.secret_hash || existing.secret_hash,
      integration.secret_fingerprint || existing.secret_fingerprint,
      JSON.stringify(integration.scopes || safeJson(existing.scopes, [])),
      JSON.stringify(integration.capabilities || safeJson(existing.capabilities, [])),
      now,
      orgId,
      existing.id
    );
    return getIntegration(db, orgId, integration.connector_key);
  }
  const id = randomId("tube-int");
  db.prepare(`
    INSERT INTO tube_integrations (
      id, org_id, connector_key, display_name, status, environment, auth_type,
      config, secret_hash, secret_fingerprint, scopes, capabilities, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, orgId, integration.connector_key, integration.display_name,
    integration.status || "planned",
    integration.environment || "sandbox",
    integration.auth_type || "api-key",
    JSON.stringify(integration.config || {}),
    integration.secret_hash || null,
    integration.secret_fingerprint || null,
    JSON.stringify(integration.scopes || []),
    JSON.stringify(integration.capabilities || []),
    now, now
  );
  return getIntegration(db, orgId, integration.connector_key);
}

// ─── Audit log (tube-local; not the suite-wide audit_events) ───────────

function appendAudit(db, orgId, entry) {
  db.prepare(`
    INSERT INTO tube_audit_log (org_id, actor_user_id, action, target_type, target_id, payload, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    orgId,
    entry.actor_user_id || null,
    entry.action,
    entry.target_type || null,
    entry.target_id || null,
    JSON.stringify(entry.payload || {}),
    nowIso()
  );
}

// ─── Sequences (v0.5) ──────────────────────────────────────────────────

function countSteps(stepsJson) {
  try {
    const arr = JSON.parse(stepsJson || "[]");
    return Array.isArray(arr) ? arr.length : 0;
  } catch { return 0; }
}

function listSequences(db, orgId) {
  return db.prepare(`
    SELECT id, name, description, steps, is_active, integration_key, external_id,
           created_at, updated_at
    FROM tube_sequences
    WHERE org_id = ?
    ORDER BY updated_at DESC
  `).all(orgId).map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    is_active: !!row.is_active,
    integration_key: row.integration_key,
    external_id: row.external_id,
    step_count: countSteps(row.steps),
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}

function getSequence(db, orgId, sequenceId) {
  return db.prepare(`
    SELECT * FROM tube_sequences WHERE org_id = ? AND id = ?
  `).get(orgId, sequenceId) || null;
}

function createSequence(db, orgId, seq) {
  const id = seq.id || ("seq_" + cryptoRandomHex(10));
  const now = nowIso();
  const steps = JSON.stringify(Array.isArray(seq.steps) ? seq.steps : []);
  db.prepare(`
    INSERT INTO tube_sequences (
      id, org_id, name, description, steps, is_active, integration_key, external_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, orgId, String(seq.name || "Untitled sequence").trim(),
    seq.description || null, steps,
    seq.isActive ? 1 : 0,
    seq.integration_key || null, seq.external_id || null,
    now, now
  );
  return getSequence(db, orgId, id);
}

function updateSequence(db, orgId, sequenceId, patch) {
  const cur = getSequence(db, orgId, sequenceId);
  if (!cur) return null;
  const steps = Array.isArray(patch.steps) ? JSON.stringify(patch.steps) : cur.steps;
  db.prepare(`
    UPDATE tube_sequences
       SET name = ?, description = ?, steps = ?, is_active = ?,
           integration_key = ?, external_id = ?, updated_at = ?
     WHERE org_id = ? AND id = ?
  `).run(
    patch.name ?? cur.name,
    patch.description ?? cur.description,
    steps,
    patch.isActive != null ? (patch.isActive ? 1 : 0) : cur.is_active,
    patch.integration_key ?? cur.integration_key,
    patch.external_id ?? cur.external_id,
    nowIso(), orgId, sequenceId
  );
  return getSequence(db, orgId, sequenceId);
}

function deleteSequence(db, orgId, sequenceId) {
  db.prepare("DELETE FROM tube_sequences WHERE org_id = ? AND id = ?").run(orgId, sequenceId);
}

function isUniqueConstraintError(err) {
  if (!err) return false;
  const code = err.code || (err.cause && err.cause.code);
  if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT") return true;
  const msg = String(err.message || err);
  return /UNIQUE constraint failed/i.test(msg) || /constraint failed/i.test(msg);
}

/**
 * Idempotent enroll. Three layers:
 *   1. UNIQUE (sequence_id, contact_id) on tube_sequence_enrollments
 *      — load-bearing, the only thing that closes a concurrent race.
 *   2. Pre-check inside BEGIN — cheap fast path for the obvious no-op.
 *   3. Per-row try/catch on SQLITE_CONSTRAINT_UNIQUE — defense in depth;
 *      a concurrent enroll that slipped past the pre-check is treated
 *      as "already enrolled" rather than rolling back the whole batch.
 *
 * Returns the count of NEW rows inserted. The v0.5 audit proved
 * the test shim hid a race that landed duplicates; this engine
 * is the corrected shape, end-to-end.
 */
function enrollContactsInSequence(db, orgId, sequenceId, contactIds) {
  const now = nowIso();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO tube_sequence_enrollments
      (id, org_id, sequence_id, contact_id, status, enrolled_at, next_run_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `);
  const contactExists = db.prepare(
    "SELECT 1 FROM tube_contacts WHERE org_id = ? AND id = ?"
  );
  const enrollmentExists = db.prepare(
    "SELECT 1 FROM tube_sequence_enrollments WHERE sequence_id = ? AND contact_id = ?"
  );
  let n = 0;
  db.exec("BEGIN");
  try {
    for (const contactId of contactIds) {
      if (!contactExists.get(orgId, contactId)) continue;
      if (enrollmentExists.get(sequenceId, contactId)) continue;
      const enrollmentId = "enr_" + cryptoRandomHex(10);
      let result;
      try {
        result = insert.run(enrollmentId, orgId, sequenceId, contactId, now, now);
      } catch (err) {
        if (isUniqueConstraintError(err)) continue;
        throw err;
      }
      if (result.changes > 0) n += 1;
    }
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* swallow — original error wins */ }
    throw err;
  }
  return n;
}

function listSequenceEnrollments(db, orgId, sequenceId) {
  return db.prepare(`
    SELECT id, contact_id, status, enrolled_at, next_run_at
    FROM tube_sequence_enrollments
    WHERE org_id = ? AND sequence_id = ?
    ORDER BY enrolled_at DESC
  `).all(orgId, sequenceId);
}

// ─── Inbox (v0.5) ──────────────────────────────────────────────────────

/**
 * Unified inbox: returns activities + conversations tagged with a
 * particular entity. The frontend uses this to render the per-deal
 * activity drawer.
 */
function listInboxForEntity(db, orgId, opts) {
  const { entityType, id } = opts;
  const safeLimit = Math.max(1, Math.min(100, Number(opts.limit) || 20));
  if (entityType === "tube_deal" || entityType === "deal") {
    return db.prepare(`
      SELECT 'activity' AS kind, a.id AS id, a.contact_id AS contact_id,
             c.full_name AS contact_name, a.kind AS channel,
             a.subject AS subject, a.body AS body,
             a.occurred_at AS occurred_at, a.created_at AS created_at
      FROM tube_activities a
      LEFT JOIN tube_contacts c ON c.id = a.contact_id
      WHERE a.org_id = ? AND a.deal_id = ?
      UNION ALL
      SELECT 'conversation' AS kind, conv.id AS id, conv.contact_id AS contact_id,
             c.full_name AS contact_name, conv.channel AS channel,
             conv.subject AS subject, conv.subject AS body,
             conv.last_message_at AS occurred_at, conv.updated_at AS created_at
      FROM tube_conversations conv
      LEFT JOIN tube_contacts c ON c.id = conv.contact_id
      WHERE conv.org_id = ? AND conv.deal_id = ?
      ORDER BY occurred_at DESC
      LIMIT ?
    `).all(orgId, id, orgId, id, safeLimit);
  }
  if (entityType === "tube_contact" || entityType === "contact") {
    return db.prepare(`
      SELECT 'activity' AS kind, a.id AS id, a.contact_id AS contact_id,
             c.full_name AS contact_name, a.kind AS channel,
             a.subject AS subject, a.body AS body,
             a.occurred_at AS occurred_at, a.created_at AS created_at
      FROM tube_activities a
      LEFT JOIN tube_contacts c ON c.id = a.contact_id
      WHERE a.org_id = ? AND a.contact_id = ?
      UNION ALL
      SELECT 'conversation' AS kind, conv.id AS id, conv.contact_id AS contact_id,
             c.full_name AS contact_name, conv.channel AS channel,
             conv.subject AS subject, conv.subject AS body,
             conv.last_message_at AS occurred_at, conv.updated_at AS created_at
      FROM tube_conversations conv
      LEFT JOIN tube_contacts c ON c.id = conv.contact_id
      WHERE conv.org_id = ? AND conv.contact_id = ?
      ORDER BY occurred_at DESC
      LIMIT ?
    `).all(orgId, id, orgId, id, safeLimit);
  }
  return [];
}

// ─── Bulk contact enrich (v0.5) ───────────────────────────────────────

/**
 * Returns the contact rows for a list of ids in this org. The route
 * layer feeds these into the existing integration push pipeline
 * (apollo.contact.enrich / surfe.contact.enrich / pixxi.contact.enrich)
 * and writes the resulting enrichment JSON back to tube_contacts.enrichment.
 *
 * NOTE: tube_contacts does NOT carry a `domain` column (it lives on
 * tube_organizations). The enrichment providers (Apollo / Surfe /
 * Pixxi) match on email + linkedin_url + name.
 */
function findContactsForEnrich(db, orgId, contactIds) {
  if (!Array.isArray(contactIds) || contactIds.length === 0) return [];
  const placeholders = contactIds.map(() => "?").join(",");
  return db.prepare(`
    SELECT id, full_name, first_name, last_name, email, phone, linkedin_url,
           source, source_id
    FROM tube_contacts
    WHERE org_id = ? AND id IN (${placeholders})
  `).all(orgId, ...contactIds);
}

function writeContactEnrichment(db, orgId, contactId, enrichment) {
  db.prepare(`
    UPDATE tube_contacts
       SET enrichment = ?, status = 'enriched', updated_at = ?
     WHERE org_id = ? AND id = ?
  `).run(JSON.stringify(enrichment || {}), nowIso(), orgId, contactId);
}

module.exports = {
  ensureDefaultTube,
  listTubes,
  listDeals,
  getDeal,
  moveDealStage,
  listContacts,
  listOrganizations,
  listActivities,
  listConversations,
  listIntegrations,
  getIntegration,
  upsertIntegration,
  appendAudit,
  listSequences,
  getSequence,
  createSequence,
  updateSequence,
  deleteSequence,
  enrollContactsInSequence,
  listSequenceEnrollments,
  listInboxForEntity,
  findContactsForEnrich,
  writeContactEnrichment
};
