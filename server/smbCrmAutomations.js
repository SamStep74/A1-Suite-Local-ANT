"use strict";

/**
 * A1 SMB CRM — Automations engine (Track 4: M14.11).
 *
 * Pattern A: pure functions, no Fastify imports, no `node:sqlite`
 * imports, no `process.env` reads. Every function takes `db` as
 * its first argument; the route layer in `server/app.js` owns the
 * Fastify surface, auth, app-access, validation, idempotency, and
 * audit. Mirrors `server/smbCrmRecords.js` (records track).
 *
 * Public surface (15 functions):
 *
 *   CRUD
 *     createAutomation(db, orgId, input)   → row
 *     getAutomation(db, orgId, id)         → row | null
 *     listAutomations(db, orgId, filters)  → row[]
 *     updateAutomation(db, orgId, id, patch) → row | null
 *     deleteAutomation(db, orgId, id)      → boolean
 *
 *   Run lifecycle
 *     runAutomation(db, orgId, id, context)       → run row
 *     runAutomations(db, orgId, triggerEvent, ctx) → run row[]
 *
 *   Read views
 *     listAutomationRuns(db, orgId, filters) → run row[]
 *     getAutomationRun(db, orgId, id)         → run row | null
 *
 *   View adapters
 *     toAutomationView(raw)        → camelCase
 *     toAutomationRunView(raw)     → camelCase
 *
 *   Trigger matching
 *     findMatchingAutomations(db, orgId, triggerEvent) → row[]
 *
 * Cross-tenant safety: every read+write function takes `orgId` as
 * a positional argument. Foreign get/list returns `null` / `[]`.
 * Foreign delete returns `false`. The route layer MUST scope by
 * `user.org_id`.
 *
 * Schema lives in `server/db.js#ensureSmbCrmAutomationSchema` (the
 * `smb_crm_automations` and `smb_crm_automation_runs` tables).
 *
 * Triggers are matched by EXACT equality on `trigger_event`. The
 * V1 contract: no glob / pattern matching — the SPA wires
 * automations to specific event names like "customer.created",
 * "deal.stage_changed", "quote.sent". A future V2 may add pattern
 * support, but V1 keeps the matching trivial so the engine is
 * easy to reason about.
 *
 * Action dispatch (V1): the action_json shape is opaque to the
 * engine. `runAutomation` writes the action into the run log so
 * the SPA can replay it. Side-effects (outbound send, webhook fire,
 * etc.) are NOT done inline — they happen via the separate
 * Outbound / Webhook / Integration engines. This keeps the V1
 * automation runner deterministic and the action graph explicit.
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

class AutomationsError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = "AutomationsError";
    this.code = code;
    this.statusCode = statusCode || 400;
  }
}

class NotFoundError extends AutomationsError {
  constructor(message) { super("NOT_FOUND", message, 404); this.name = "NotFoundError"; }
}

class ConflictError extends AutomationsError {
  constructor(message) { super("CONFLICT", message, 409); this.name = "ConflictError"; }
}

// ─── Validation helpers ──────────────────────────────────────────────────

const VALID_TRIGGER_EVENTS = [
  "customer.created",
  "customer.updated",
  "customer.deleted",
  "deal.created",
  "deal.updated",
  "deal.stage_changed",
  "deal.won",
  "deal.lost",
  "task.created",
  "task.completed",
  "quote.created",
  "quote.sent",
  "quote.accepted",
  "activity.created",
  "automation.run",
  "webhook.received",
  "outbound.failed"
];

const VALID_ACTIONS = [
  "send_outbound_message",
  "fire_webhook",
  "create_activity",
  "create_task",
  "update_deal_stage",
  "noop"  // V1: useful for testing / dry-runs
];

function nonEmptyString(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new AutomationsError("MISSING_FIELD", `${field} is required`);
  }
  return String(value).trim();
}

function validateTriggerEvent(value) {
  const v = nonEmptyString(value, "triggerEvent").toLowerCase();
  if (!VALID_TRIGGER_EVENTS.includes(v)) {
    throw new AutomationsError("INVALID_TRIGGER", `triggerEvent must be one of ${VALID_TRIGGER_EVENTS.join("|")}`);
  }
  return v;
}

function validateAction(value) {
  const v = nonEmptyString(value, "action").toLowerCase();
  if (!VALID_ACTIONS.includes(v)) {
    throw new AutomationsError("INVALID_ACTION", `action must be one of ${VALID_ACTIONS.join("|")}`);
  }
  return v;
}

function validateBool01(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === 1 || value === 0) return value;
  const s = String(value).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return 1;
  if (s === "false" || s === "0" || s === "no") return 0;
  throw new AutomationsError("INVALID_BOOL", `expected boolean, got: ${value}`);
}

function assertOrgScope(orgId) {
  if (!orgId || typeof orgId !== "string") {
    throw new AutomationsError("MISSING_ORG_ID", "orgId is required");
  }
}

function inOrg(db, table, orgId, id) {
  const row = db
    .prepare(`SELECT * FROM ${table} WHERE id = ? AND org_id = ?`)
    .get(id, orgId);
  return row || null;
}

// ════════════════════════════════════════════════════════════════════════
// AUTOMATIONS CRUD
// ════════════════════════════════════════════════════════════════════════

function createAutomation(db, orgId, input, opts) {
  assertOrgScope(orgId);
  input = input || {};
  opts = opts || {};
  const name = nonEmptyString(input.name, "name");
  const triggerEvent = validateTriggerEvent(input.triggerEvent);
  const action = validateAction(input.action);
  const actionJson = JSON.stringify(input.actionJson || input.action_json || {});
  const enabled = validateBool01(input.enabled, 1);
  const now = nowIso();
  const id = randomId("auto");
  const createdBy = opts.createdBy ? String(opts.createdBy) : null;
  db.prepare(`
    INSERT INTO smb_crm_automations (
      id, org_id, name, trigger_event, action, action_json, enabled, created_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, orgId, name, triggerEvent, action, actionJson, enabled, createdBy, now, now);
  return getAutomation(db, orgId, id);
}

function getAutomation(db, orgId, id) {
  return inOrg(db, "smb_crm_automations", orgId, id);
}

function listAutomations(db, orgId, filters) {
  filters = filters || {};
  const where = ["org_id = ?"];
  const params = [orgId];
  if (filters.triggerEvent) {
    where.push("trigger_event = ?");
    params.push(String(filters.triggerEvent).trim().toLowerCase());
  }
  if (filters.enabled !== undefined && filters.enabled !== null && filters.enabled !== "" && filters.enabled !== "all") {
    where.push("enabled = ?");
    params.push(Number(filters.enabled) ? 1 : 0);
  }
  if (filters.search) {
    const like = `%${String(filters.search).trim().toLowerCase()}%`;
    where.push("LOWER(name) LIKE ?");
    params.push(like);
  }
  return db.prepare(`
    SELECT * FROM smb_crm_automations
     WHERE ${where.join(" AND ")}
     ORDER BY updated_at DESC
     LIMIT ?
  `).all(...params, Math.max(1, Math.min(500, Number(filters.limit) || 100)));
}

function updateAutomation(db, orgId, id, patch) {
  patch = patch || {};
  const existing = inOrg(db, "smb_crm_automations", orgId, id);
  if (!existing) return null;
  const now = nowIso();
  const sets = [];
  const params = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    params.push(nonEmptyString(patch.name, "name"));
  }
  if (patch.triggerEvent !== undefined) {
    sets.push("trigger_event = ?");
    params.push(validateTriggerEvent(patch.triggerEvent));
  }
  if (patch.action !== undefined) {
    sets.push("action = ?");
    params.push(validateAction(patch.action));
  }
  if (patch.actionJson !== undefined || patch.action_json !== undefined) {
    sets.push("action_json = ?");
    params.push(JSON.stringify(patch.actionJson || patch.action_json || {}));
  }
  if (patch.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(validateBool01(patch.enabled, 1));
  }
  if (sets.length === 0) return existing;
  sets.push("updated_at = ?");
  params.push(now);
  params.push(id, orgId);
  db.prepare(`UPDATE smb_crm_automations SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`)
    .run(...params);
  return getAutomation(db, orgId, id);
}

function deleteAutomation(db, orgId, id) {
  const result = db
    .prepare("DELETE FROM smb_crm_automations WHERE id = ? AND org_id = ?")
    .run(id, orgId);
  return result.changes > 0;
}

// ════════════════════════════════════════════════════════════════════════
// AUTOMATION RUNS
// ════════════════════════════════════════════════════════════════════════

function findMatchingAutomations(db, orgId, triggerEvent) {
  if (!triggerEvent) return [];
  return db
    .prepare(`
      SELECT * FROM smb_crm_automations
       WHERE org_id = ? AND trigger_event = ? AND enabled = 1
       ORDER BY created_at ASC
    `)
    .all(orgId, String(triggerEvent).trim().toLowerCase());
}

function runAutomation(db, orgId, id, context) {
  const auto = inOrg(db, "smb_crm_automations", orgId, id);
  if (!auto) return null;
  return _executeRun(db, orgId, auto, context || {}, "manual");
}

function runAutomations(db, orgId, triggerEvent, context) {
  const matches = findMatchingAutomations(db, orgId, triggerEvent);
  return matches.map(m => _executeRun(db, orgId, m, context || {}, "trigger"));
}

function _executeRun(db, orgId, automation, context, mode) {
  const runId = randomId("run");
  const now = nowIso();
  const logEnvelope = {
    automationId: automation.id,
    automationName: automation.name,
    triggerEvent: automation.trigger_event,
    action: automation.action,
    actionJson: safeJson(automation.action_json, {}),
    context: context || {},
    mode: mode,
    startedAt: now,
    steps: []
  };
  const initialStatus = "running";
  db.prepare(`
    INSERT INTO smb_crm_automation_runs (
      id, org_id, automation_id, trigger_event, status, started_at, log_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId, orgId, automation.id, automation.trigger_event,
    initialStatus, now, JSON.stringify(logEnvelope)
  );

  // V1: deterministic local execution. The engine doesn't dispatch
  // side-effects (outbound / webhook / etc.) — those are wired by
  // the SPA via the relevant routes. The run log records WHAT would
  // be dispatched so a human reviewer / future V2 can replay it.
  let status = "ok";
  let errorText = null;
  try {
    logEnvelope.steps.push({
      at: nowIso(),
      kind: "match",
      automationId: automation.id,
      triggerEvent: automation.trigger_event
    });
    logEnvelope.steps.push({
      at: nowIso(),
      kind: "would_dispatch",
      action: automation.action,
      actionJson: safeJson(automation.action_json, {}),
      context: context || {}
    });
  } catch (err) {
    status = "failed";
    errorText = String(err && err.message || err);
    logEnvelope.steps.push({ at: nowIso(), kind: "error", error: errorText });
  }
  const finishedAt = nowIso();
  logEnvelope.finishedAt = finishedAt;
  logEnvelope.finalStatus = status;
  db.prepare(`
    UPDATE smb_crm_automation_runs
       SET status = ?, finished_at = ?, log_json = ?, error_text = ?
     WHERE id = ? AND org_id = ?
  `).run(status, finishedAt, JSON.stringify(logEnvelope), errorText, runId, orgId);
  return getAutomationRun(db, orgId, runId);
}

function listAutomationRuns(db, orgId, filters) {
  filters = filters || {};
  const where = ["org_id = ?"];
  const params = [orgId];
  if (filters.automationId) {
    where.push("automation_id = ?");
    params.push(String(filters.automationId));
  }
  if (filters.triggerEvent) {
    where.push("trigger_event = ?");
    params.push(String(filters.triggerEvent).trim().toLowerCase());
  }
  if (filters.status) {
    where.push("status = ?");
    params.push(String(filters.status).trim().toLowerCase());
  }
  return db.prepare(`
    SELECT * FROM smb_crm_automation_runs
     WHERE ${where.join(" AND ")}
     ORDER BY started_at DESC
     LIMIT ?
  `).all(...params, Math.max(1, Math.min(500, Number(filters.limit) || 100)));
}

function getAutomationRun(db, orgId, id) {
  return inOrg(db, "smb_crm_automation_runs", orgId, id);
}

// ════════════════════════════════════════════════════════════════════════
// VIEW ADAPTERS
// ════════════════════════════════════════════════════════════════════════

function toAutomationView(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    orgId: raw.org_id,
    name: raw.name,
    triggerEvent: raw.trigger_event,
    action: raw.action,
    actionJson: safeJson(raw.action_json, {}),
    enabled: raw.enabled === 1 || raw.enabled === true,
    createdBy: raw.created_by,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at
  };
}

function toAutomationRunView(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    orgId: raw.org_id,
    automationId: raw.automation_id,
    triggerEvent: raw.trigger_event,
    status: raw.status,
    startedAt: raw.started_at,
    finishedAt: raw.finished_at,
    log: safeJson(raw.log_json, {}),
    errorText: raw.error_text
  };
}

module.exports = {
  // CRUD
  createAutomation,
  getAutomation,
  listAutomations,
  updateAutomation,
  deleteAutomation,
  // Run lifecycle
  runAutomation,
  runAutomations,
  listAutomationRuns,
  getAutomationRun,
  findMatchingAutomations,
  // View adapters
  toAutomationView,
  toAutomationRunView,
  // Errors
  AutomationsError,
  NotFoundError,
  ConflictError,
  // Constants (for callers)
  VALID_TRIGGER_EVENTS,
  VALID_ACTIONS
};
