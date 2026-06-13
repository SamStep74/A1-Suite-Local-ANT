"use strict";

/**
 * A1 SMB CRM — Records engine (Track 2: M14.5–M14.10).
 *
 * Pattern A: pure functions, no Fastify imports, no `node:sqlite`
 * imports, no `process.env` reads. Every function takes `db` as
 * its first argument; the route layer in `server/app.js` owns the
 * Fastify surface, auth, app-access, validation, idempotency, and
 * audit. Mirrors the shape of `server/crmTube.js` and
 * `server/smbCrmTenants.js`.
 *
 * 6 runtime entities, 5 CRUD operations each (30 functions), plus
 * `mergeCustomers` for dedup:
 *
 *   customers  → createCustomer  / getCustomer  / listCustomers  / updateCustomer  / deleteCustomer
 *   deals      → createDeal      / getDeal      / listDeals      / updateDeal      / deleteDeal
 *   todo_tasks → createTask      / getTask      / listTasks      / updateTask      / deleteTask
 *   quotes     → createQuote     / getQuote     / listQuotes     / updateQuote     / deleteQuote
 *   activities → createActivity  / getActivity  / listActivities / updateActivity  / deleteActivity
 *   goals      → createGoal      / getGoal      / listGoals      / updateGoal      / deleteGoal
 *   ─────      → mergeCustomers(db, orgId, { survivorId, loserId })
 *
 * Cross-tenant safety: every read+write function takes `orgId` as a
 * positional argument; the route layer MUST scope by `user.org_id`.
 * Cross-tenant `delete*` returns `false` (no-op) so the engine can
 * be called from batch paths without throwing. Cross-tenant `get*`
 * returns `null`. `mergeCustomers` throws `OrgMismatchError` on a
 * foreign org, because a silent no-op there would let the caller
 * think the dedup happened.
 *
 * Schema lives in `server/db.js#ensureSmbCrmRecordsSchema` (added
 * by the records worker). The `smb_crm_todo_tasks` table uses a
 * different slug from the foundation's `smb_crm_tasks` (which is
 * blueprint-apply-time materialization, see handoff §"File map").
 *
 * The `*View` helpers (`toCustomerView`, `toDealView`, …) are the
 * single place where the snake_case SQLite row gets reshaped to
 * the camelCase JSON the SPA consumes. Mirrors `toTenantView` in
 * `server/smbCrmTenants.js`.
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

class RecordsError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = "RecordsError";
    this.code = code;
    this.statusCode = statusCode || 400;
  }
}

class NotFoundError extends RecordsError {
  constructor(message) { super("NOT_FOUND", message, 404); this.name = "NotFoundError"; }
}

class ConflictError extends RecordsError {
  constructor(message) { super("CONFLICT", message, 409); this.name = "ConflictError"; }
}

class OrgMismatchError extends RecordsError {
  constructor(message) { super("ORG_MISMATCH", message, 403); this.name = "OrgMismatchError"; }
}

// ─── Validation helpers ──────────────────────────────────────────────────

const VALID_LOCALES = ["hy", "en", "ru"];
const VALID_CURRENCIES = ["AMD", "USD", "EUR", "RUR", "GBP"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateLocale(value, fallback) {
  const v = String(value || fallback || "en").trim().toLowerCase();
  if (!VALID_LOCALES.includes(v)) {
    throw new RecordsError("INVALID_LOCALE", `locale must be one of ${VALID_LOCALES.join("|")}`);
  }
  return v;
}

function validateStatus(value, allowed, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  if (!allowed.includes(v)) {
    throw new RecordsError("INVALID_STATUS", `status must be one of ${allowed.join("|")}`);
  }
  return v;
}

function validateCurrency(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback || "AMD";
  const v = String(value).trim().toUpperCase();
  if (!VALID_CURRENCIES.includes(v)) {
    throw new RecordsError("INVALID_CURRENCY", `currency must be one of ${VALID_CURRENCIES.join("|")}`);
  }
  return v;
}

function validateEmail(value) {
  if (value === undefined || value === null || value === "") return null;
  const v = String(value).trim();
  if (!EMAIL_RE.test(v)) {
    throw new RecordsError("INVALID_EMAIL", `email is malformed: ${v}`);
  }
  return v;
}

function nonEmptyString(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new RecordsError("MISSING_FIELD", `${field} is required`);
  }
  return String(value).trim();
}

// ─── org-scope guard ─────────────────────────────────────────────────────

function assertOrgScope(orgId) {
  if (!orgId || typeof orgId !== "string") {
    throw new RecordsError("MISSING_ORG_ID", "orgId is required");
  }
}

function inOrg(db, table, orgId, id) {
  const row = db
    .prepare(`SELECT * FROM ${table} WHERE id = ? AND org_id = ?`)
    .get(id, orgId);
  return row || null;
}

// ════════════════════════════════════════════════════════════════════════
// CUSTOMERS
// ════════════════════════════════════════════════════════════════════════

const CUSTOMER_STATUS = ["active", "lead", "inactive"];

function createCustomer(db, orgId, input) {
  assertOrgScope(orgId);
  input = input || {};
  const fullName = nonEmptyString(input.fullName, "fullName");
  const email = validateEmail(input.email);
  const now = nowIso();
  const id = randomId("cust");
  const locale = validateLocale(input.locale, "en");
  const status = validateStatus(input.status, CUSTOMER_STATUS, "active");
  const phone = input.phone ? String(input.phone).trim() : null;
  const companyName = input.companyName ? String(input.companyName).trim() : null;
  const address = input.address ? String(input.address).trim() : null;
  const branchId = input.branchId ? String(input.branchId) : null;
  const tags = JSON.stringify(Array.isArray(input.tags) ? input.tags : []);
  const custom = JSON.stringify(input.custom || {});
  db.prepare(`
    INSERT INTO smb_crm_customers (
      id, org_id, full_name, email, phone, company_name, address, locale,
      status, branch_id, tags_json, custom_json, merged_into_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(id, orgId, fullName, email, phone, companyName, address, locale,
         status, branchId, tags, custom, now, now);
  return getCustomer(db, orgId, id);
}

function getCustomer(db, orgId, id) {
  return inOrg(db, "smb_crm_customers", orgId, id);
}

function listCustomers(db, orgId, filters) {
  filters = filters || {};
  const where = ["org_id = ?"];
  const params = [orgId];
  if (filters.status) { where.push("status = ?"); params.push(String(filters.status).trim().toLowerCase()); }
  if (filters.search) {
    const like = `%${String(filters.search).trim().toLowerCase()}%`;
    where.push("(LOWER(full_name) LIKE ? OR LOWER(IFNULL(email,'')) LIKE ? OR LOWER(IFNULL(company_name,'')) LIKE ?)");
    params.push(like, like, like);
  }
  // Exclude merged-away rows by default; pass includeMerged=true to opt in.
  if (!filters.includeMerged) where.push("merged_into_id IS NULL");
  return db.prepare(`
    SELECT * FROM smb_crm_customers
     WHERE ${where.join(" AND ")}
     ORDER BY updated_at DESC
     LIMIT ?
  `).all(...params, Math.max(1, Math.min(500, Number(filters.limit) || 100)));
}

function updateCustomer(db, orgId, id, patch) {
  patch = patch || {};
  const cur = inOrg(db, "smb_crm_customers", orgId, id);
  if (!cur) return null;
  const now = nowIso();
  const next = {
    full_name: patch.fullName !== undefined ? nonEmptyString(patch.fullName, "fullName") : cur.full_name,
    email: patch.email !== undefined ? validateEmail(patch.email) : cur.email,
    phone: patch.phone !== undefined ? (patch.phone ? String(patch.phone).trim() : null) : cur.phone,
    company_name: patch.companyName !== undefined ? (patch.companyName ? String(patch.companyName).trim() : null) : cur.company_name,
    address: patch.address !== undefined ? (patch.address ? String(patch.address).trim() : null) : cur.address,
    locale: patch.locale !== undefined ? validateLocale(patch.locale) : cur.locale,
    status: patch.status !== undefined ? validateStatus(patch.status, CUSTOMER_STATUS, cur.status) : cur.status,
    branch_id: patch.branchId !== undefined ? (patch.branchId ? String(patch.branchId) : null) : cur.branch_id,
    tags_json: patch.tags !== undefined ? JSON.stringify(Array.isArray(patch.tags) ? patch.tags : safeJson(cur.tags_json, [])) : cur.tags_json,
    custom_json: patch.custom !== undefined ? JSON.stringify(patch.custom || {}) : cur.custom_json
  };
  db.prepare(`
    UPDATE smb_crm_customers
       SET full_name = ?, email = ?, phone = ?, company_name = ?, address = ?,
           locale = ?, status = ?, branch_id = ?, tags_json = ?, custom_json = ?,
           updated_at = ?
     WHERE id = ? AND org_id = ?
  `).run(
    next.full_name, next.email, next.phone, next.company_name, next.address,
    next.locale, next.status, next.branch_id, next.tags_json, next.custom_json,
    now, id, orgId
  );
  return getCustomer(db, orgId, id);
}

function deleteCustomer(db, orgId, id) {
  const cur = inOrg(db, "smb_crm_customers", orgId, id);
  if (!cur) return false;
  db.prepare("DELETE FROM smb_crm_customers WHERE id = ? AND org_id = ?").run(id, orgId);
  return true;
}

// ════════════════════════════════════════════════════════════════════════
// DEALS
// ════════════════════════════════════════════════════════════════════════

const DEAL_STATUS = ["open", "won", "lost"];

function createDeal(db, orgId, input) {
  assertOrgScope(orgId);
  input = input || {};
  const title = nonEmptyString(input.title, "title");
  const now = nowIso();
  const id = randomId("deal");
  const currency = validateCurrency(input.currency, "AMD");
  const status = validateStatus(input.status, DEAL_STATUS, "open");
  const customerId = input.customerId ? String(input.customerId) : null;
  // FK constraint will reject a customer that doesn't exist; the
  // engine doesn't pre-check so the error message stays consistent
  // with the rest of the schema.
  db.prepare(`
    INSERT INTO smb_crm_deals (
      id, org_id, title, customer_id, value, currency, stage_id, probability,
      expected_close_date, status, owner_user_id, branch_id, tags_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, orgId, title, customerId,
    Number(input.value) || 0,
    currency,
    input.stageId ? String(input.stageId) : null,
    Math.max(0, Math.min(100, Number(input.probability) || 0)),
    input.expectedCloseDate || null,
    status,
    input.ownerUserId || input.owner_user_id || null,
    input.branchId ? String(input.branchId) : null,
    JSON.stringify(Array.isArray(input.tags) ? input.tags : []),
    now, now
  );
  return getDeal(db, orgId, id);
}

function getDeal(db, orgId, id) {
  return inOrg(db, "smb_crm_deals", orgId, id);
}

function listDeals(db, orgId, filters) {
  filters = filters || {};
  const where = ["org_id = ?"];
  const params = [orgId];
  if (filters.status) { where.push("status = ?"); params.push(String(filters.status).trim().toLowerCase()); }
  if (filters.customerId) { where.push("customer_id = ?"); params.push(String(filters.customerId)); }
  if (filters.stageId) { where.push("stage_id = ?"); params.push(String(filters.stageId)); }
  if (filters.ownerUserId) { where.push("owner_user_id = ?"); params.push(String(filters.ownerUserId)); }
  return db.prepare(`
    SELECT * FROM smb_crm_deals
     WHERE ${where.join(" AND ")}
     ORDER BY updated_at DESC
     LIMIT ?
  `).all(...params, Math.max(1, Math.min(500, Number(filters.limit) || 100)));
}

function updateDeal(db, orgId, id, patch) {
  patch = patch || {};
  const cur = inOrg(db, "smb_crm_deals", orgId, id);
  if (!cur) return null;
  const now = nowIso();
  const next = {
    title: patch.title !== undefined ? nonEmptyString(patch.title, "title") : cur.title,
    customer_id: patch.customerId !== undefined ? (patch.customerId ? String(patch.customerId) : null) : cur.customer_id,
    value: patch.value !== undefined ? Number(patch.value) || 0 : cur.value,
    currency: patch.currency !== undefined ? validateCurrency(patch.currency) : cur.currency,
    stage_id: patch.stageId !== undefined ? (patch.stageId ? String(patch.stageId) : null) : cur.stage_id,
    probability: patch.probability !== undefined ? Math.max(0, Math.min(100, Number(patch.probability) || 0)) : cur.probability,
    expected_close_date: patch.expectedCloseDate !== undefined ? (patch.expectedCloseDate || null) : cur.expected_close_date,
    status: patch.status !== undefined ? validateStatus(patch.status, DEAL_STATUS, cur.status) : cur.status,
    owner_user_id: patch.ownerUserId !== undefined ? (patch.ownerUserId || null) : cur.owner_user_id,
    branch_id: patch.branchId !== undefined ? (patch.branchId ? String(patch.branchId) : null) : cur.branch_id,
    tags_json: patch.tags !== undefined ? JSON.stringify(Array.isArray(patch.tags) ? patch.tags : safeJson(cur.tags_json, [])) : cur.tags_json
  };
  db.prepare(`
    UPDATE smb_crm_deals
       SET title = ?, customer_id = ?, value = ?, currency = ?, stage_id = ?,
           probability = ?, expected_close_date = ?, status = ?, owner_user_id = ?,
           branch_id = ?, tags_json = ?, updated_at = ?
     WHERE id = ? AND org_id = ?
  `).run(
    next.title, next.customer_id, next.value, next.currency, next.stage_id,
    next.probability, next.expected_close_date, next.status, next.owner_user_id,
    next.branch_id, next.tags_json, now, id, orgId
  );
  return getDeal(db, orgId, id);
}

function deleteDeal(db, orgId, id) {
  const cur = inOrg(db, "smb_crm_deals", orgId, id);
  if (!cur) return false;
  db.prepare("DELETE FROM smb_crm_deals WHERE id = ? AND org_id = ?").run(id, orgId);
  return true;
}

// ════════════════════════════════════════════════════════════════════════
// TASKS
// ════════════════════════════════════════════════════════════════════════

const TASK_STATUS = ["open", "done", "cancelled"];
const TASK_PRIORITY = ["low", "normal", "high", "urgent"];

function createTask(db, orgId, input) {
  assertOrgScope(orgId);
  input = input || {};
  const title = nonEmptyString(input.title, "title");
  const now = nowIso();
  const id = randomId("task");
  const status = validateStatus(input.status, TASK_STATUS, "open");
  const priority = validateStatus(input.priority, TASK_PRIORITY, "normal");
  db.prepare(`
    INSERT INTO smb_crm_todo_tasks (
      id, org_id, title, description, customer_id, deal_id, due_at,
      status, priority, assigned_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, orgId, title,
    input.description ? String(input.description) : null,
    input.customerId ? String(input.customerId) : null,
    input.dealId ? String(input.dealId) : null,
    input.dueAt || input.due_at || null,
    status, priority,
    input.assignedUserId || input.assigned_user_id || null,
    now, now
  );
  return getTask(db, orgId, id);
}

function getTask(db, orgId, id) {
  return inOrg(db, "smb_crm_todo_tasks", orgId, id);
}

function listTasks(db, orgId, filters) {
  filters = filters || {};
  const where = ["org_id = ?"];
  const params = [orgId];
  if (filters.status) { where.push("status = ?"); params.push(String(filters.status).trim().toLowerCase()); }
  if (filters.priority) { where.push("priority = ?"); params.push(String(filters.priority).trim().toLowerCase()); }
  if (filters.customerId) { where.push("customer_id = ?"); params.push(String(filters.customerId)); }
  if (filters.dealId) { where.push("deal_id = ?"); params.push(String(filters.dealId)); }
  if (filters.assignedUserId) { where.push("assigned_user_id = ?"); params.push(String(filters.assignedUserId)); }
  return db.prepare(`
    SELECT * FROM smb_crm_todo_tasks
     WHERE ${where.join(" AND ")}
     ORDER BY
       CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
       due_at ASC,
       updated_at DESC
     LIMIT ?
  `).all(...params, Math.max(1, Math.min(500, Number(filters.limit) || 100)));
}

function updateTask(db, orgId, id, patch) {
  patch = patch || {};
  const cur = inOrg(db, "smb_crm_todo_tasks", orgId, id);
  if (!cur) return null;
  const now = nowIso();
  const next = {
    title: patch.title !== undefined ? nonEmptyString(patch.title, "title") : cur.title,
    description: patch.description !== undefined ? (patch.description ? String(patch.description) : null) : cur.description,
    customer_id: patch.customerId !== undefined ? (patch.customerId ? String(patch.customerId) : null) : cur.customer_id,
    deal_id: patch.dealId !== undefined ? (patch.dealId ? String(patch.dealId) : null) : cur.deal_id,
    due_at: patch.dueAt !== undefined ? (patch.dueAt || null) : cur.due_at,
    status: patch.status !== undefined ? validateStatus(patch.status, TASK_STATUS, cur.status) : cur.status,
    priority: patch.priority !== undefined ? validateStatus(patch.priority, TASK_PRIORITY, cur.priority) : cur.priority,
    assigned_user_id: patch.assignedUserId !== undefined ? (patch.assignedUserId || null) : cur.assigned_user_id
  };
  db.prepare(`
    UPDATE smb_crm_todo_tasks
       SET title = ?, description = ?, customer_id = ?, deal_id = ?, due_at = ?,
           status = ?, priority = ?, assigned_user_id = ?, updated_at = ?
     WHERE id = ? AND org_id = ?
  `).run(
    next.title, next.description, next.customer_id, next.deal_id, next.due_at,
    next.status, next.priority, next.assigned_user_id, now, id, orgId
  );
  return getTask(db, orgId, id);
}

function deleteTask(db, orgId, id) {
  const cur = inOrg(db, "smb_crm_todo_tasks", orgId, id);
  if (!cur) return false;
  db.prepare("DELETE FROM smb_crm_todo_tasks WHERE id = ? AND org_id = ?").run(id, orgId);
  return true;
}

// ════════════════════════════════════════════════════════════════════════
// QUOTES
// ════════════════════════════════════════════════════════════════════════

const QUOTE_STATUS = ["draft", "sent", "accepted", "declined", "expired"];

function createQuote(db, orgId, input) {
  assertOrgScope(orgId);
  input = input || {};
  const number = nonEmptyString(input.number, "number");
  const now = nowIso();
  const id = randomId("quote");
  const currency = validateCurrency(input.currency, "AMD");
  const status = validateStatus(input.status, QUOTE_STATUS, "draft");
  const lineItems = Array.isArray(input.lineItems) ? input.lineItems : [];
  // Number must be unique within the org.
  const clash = db.prepare(
    "SELECT id FROM smb_crm_quotes WHERE org_id = ? AND number = ?"
  ).get(orgId, number);
  if (clash) throw new ConflictError(`Quote number already in use: ${number}`);
  db.prepare(`
    INSERT INTO smb_crm_quotes (
      id, org_id, number, customer_id, deal_id, issue_date, expiry_date,
      status, total_amount, currency, line_items_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, orgId, number,
    input.customerId ? String(input.customerId) : null,
    input.dealId ? String(input.dealId) : null,
    input.issueDate || null,
    input.expiryDate || null,
    status,
    Number(input.totalAmount) || 0,
    currency,
    JSON.stringify(lineItems),
    now, now
  );
  return getQuote(db, orgId, id);
}

function getQuote(db, orgId, id) {
  return inOrg(db, "smb_crm_quotes", orgId, id);
}

function listQuotes(db, orgId, filters) {
  filters = filters || {};
  const where = ["org_id = ?"];
  const params = [orgId];
  if (filters.status) { where.push("status = ?"); params.push(String(filters.status).trim().toLowerCase()); }
  if (filters.customerId) { where.push("customer_id = ?"); params.push(String(filters.customerId)); }
  if (filters.dealId) { where.push("deal_id = ?"); params.push(String(filters.dealId)); }
  return db.prepare(`
    SELECT * FROM smb_crm_quotes
     WHERE ${where.join(" AND ")}
     ORDER BY updated_at DESC
     LIMIT ?
  `).all(...params, Math.max(1, Math.min(500, Number(filters.limit) || 100)));
}

function updateQuote(db, orgId, id, patch) {
  patch = patch || {};
  const cur = inOrg(db, "smb_crm_quotes", orgId, id);
  if (!cur) return null;
  const now = nowIso();
  let number = cur.number;
  if (patch.number !== undefined && patch.number !== cur.number) {
    number = nonEmptyString(patch.number, "number");
    const clash = db.prepare(
      "SELECT id FROM smb_crm_quotes WHERE org_id = ? AND number = ? AND id != ?"
    ).get(orgId, number, id);
    if (clash) throw new ConflictError(`Quote number already in use: ${number}`);
  }
  const next = {
    number,
    customer_id: patch.customerId !== undefined ? (patch.customerId ? String(patch.customerId) : null) : cur.customer_id,
    deal_id: patch.dealId !== undefined ? (patch.dealId ? String(patch.dealId) : null) : cur.deal_id,
    issue_date: patch.issueDate !== undefined ? (patch.issueDate || null) : cur.issue_date,
    expiry_date: patch.expiryDate !== undefined ? (patch.expiryDate || null) : cur.expiry_date,
    status: patch.status !== undefined ? validateStatus(patch.status, QUOTE_STATUS, cur.status) : cur.status,
    total_amount: patch.totalAmount !== undefined ? Number(patch.totalAmount) || 0 : cur.total_amount,
    currency: patch.currency !== undefined ? validateCurrency(patch.currency) : cur.currency,
    line_items_json: patch.lineItems !== undefined ? JSON.stringify(Array.isArray(patch.lineItems) ? patch.lineItems : []) : cur.line_items_json
  };
  db.prepare(`
    UPDATE smb_crm_quotes
       SET number = ?, customer_id = ?, deal_id = ?, issue_date = ?, expiry_date = ?,
           status = ?, total_amount = ?, currency = ?, line_items_json = ?, updated_at = ?
     WHERE id = ? AND org_id = ?
  `).run(
    next.number, next.customer_id, next.deal_id, next.issue_date, next.expiry_date,
    next.status, next.total_amount, next.currency, next.line_items_json, now, id, orgId
  );
  return getQuote(db, orgId, id);
}

function deleteQuote(db, orgId, id) {
  const cur = inOrg(db, "smb_crm_quotes", orgId, id);
  if (!cur) return false;
  db.prepare("DELETE FROM smb_crm_quotes WHERE id = ? AND org_id = ?").run(id, orgId);
  return true;
}

// ════════════════════════════════════════════════════════════════════════
// ACTIVITIES
// ════════════════════════════════════════════════════════════════════════

const ACTIVITY_TYPES = ["note", "call", "email", "meeting", "sms", "task"];

function createActivity(db, orgId, input) {
  assertOrgScope(orgId);
  input = input || {};
  const activityAt = input.activityAt || input.activity_at || nowIso();
  if (!activityAt) throw new RecordsError("MISSING_FIELD", "activityAt is required");
  const now = nowIso();
  const id = randomId("act");
  const type = validateStatus(input.type, ACTIVITY_TYPES, "note");
  db.prepare(`
    INSERT INTO smb_crm_activities (
      id, org_id, type, subject, body, customer_id, deal_id, quote_id,
      activity_at, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, orgId, type,
    input.subject ? String(input.subject) : null,
    input.body ? String(input.body) : null,
    input.customerId ? String(input.customerId) : null,
    input.dealId ? String(input.dealId) : null,
    input.quoteId ? String(input.quoteId) : null,
    activityAt,
    input.createdBy || null,
    now, now
  );
  return getActivity(db, orgId, id);
}

function getActivity(db, orgId, id) {
  return inOrg(db, "smb_crm_activities", orgId, id);
}

function listActivities(db, orgId, filters) {
  filters = filters || {};
  const where = ["org_id = ?"];
  const params = [orgId];
  if (filters.type) { where.push("type = ?"); params.push(String(filters.type).trim().toLowerCase()); }
  if (filters.customerId) { where.push("customer_id = ?"); params.push(String(filters.customerId)); }
  if (filters.dealId) { where.push("deal_id = ?"); params.push(String(filters.dealId)); }
  if (filters.quoteId) { where.push("quote_id = ?"); params.push(String(filters.quoteId)); }
  return db.prepare(`
    SELECT * FROM smb_crm_activities
     WHERE ${where.join(" AND ")}
     ORDER BY activity_at DESC
     LIMIT ?
  `).all(...params, Math.max(1, Math.min(500, Number(filters.limit) || 100)));
}

function updateActivity(db, orgId, id, patch) {
  patch = patch || {};
  const cur = inOrg(db, "smb_crm_activities", orgId, id);
  if (!cur) return null;
  const now = nowIso();
  const next = {
    type: patch.type !== undefined ? validateStatus(patch.type, ACTIVITY_TYPES, cur.type) : cur.type,
    subject: patch.subject !== undefined ? (patch.subject ? String(patch.subject) : null) : cur.subject,
    body: patch.body !== undefined ? (patch.body ? String(patch.body) : null) : cur.body,
    customer_id: patch.customerId !== undefined ? (patch.customerId ? String(patch.customerId) : null) : cur.customer_id,
    deal_id: patch.dealId !== undefined ? (patch.dealId ? String(patch.dealId) : null) : cur.deal_id,
    quote_id: patch.quoteId !== undefined ? (patch.quoteId ? String(patch.quoteId) : null) : cur.quote_id,
    activity_at: patch.activityAt !== undefined ? (patch.activityAt || cur.activity_at) : cur.activity_at
  };
  db.prepare(`
    UPDATE smb_crm_activities
       SET type = ?, subject = ?, body = ?, customer_id = ?, deal_id = ?,
           quote_id = ?, activity_at = ?, updated_at = ?
     WHERE id = ? AND org_id = ?
  `).run(
    next.type, next.subject, next.body, next.customer_id, next.deal_id,
    next.quote_id, next.activity_at, now, id, orgId
  );
  return getActivity(db, orgId, id);
}

function deleteActivity(db, orgId, id) {
  const cur = inOrg(db, "smb_crm_activities", orgId, id);
  if (!cur) return false;
  db.prepare("DELETE FROM smb_crm_activities WHERE id = ? AND org_id = ?").run(id, orgId);
  return true;
}

// ════════════════════════════════════════════════════════════════════════
// GOALS
// ════════════════════════════════════════════════════════════════════════

function createGoal(db, orgId, input) {
  assertOrgScope(orgId);
  input = input || {};
  const name = nonEmptyString(input.name, "name");
  const metric = nonEmptyString(input.metric, "metric");
  const now = nowIso();
  const id = randomId("goal");
  db.prepare(`
    INSERT INTO smb_crm_goals (
      id, org_id, name, metric, target_value, current_value,
      period_start, period_end, owner_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, orgId, name, metric,
    Number(input.targetValue) || 0,
    Number(input.currentValue) || 0,
    input.periodStart || null,
    input.periodEnd || null,
    input.ownerUserId || null,
    now, now
  );
  return getGoal(db, orgId, id);
}

function getGoal(db, orgId, id) {
  return inOrg(db, "smb_crm_goals", orgId, id);
}

function listGoals(db, orgId, filters) {
  filters = filters || {};
  const where = ["org_id = ?"];
  const params = [orgId];
  if (filters.metric) { where.push("metric = ?"); params.push(String(filters.metric)); }
  if (filters.ownerUserId) { where.push("owner_user_id = ?"); params.push(String(filters.ownerUserId)); }
  return db.prepare(`
    SELECT * FROM smb_crm_goals
     WHERE ${where.join(" AND ")}
     ORDER BY
       CASE WHEN period_end IS NULL THEN 1 ELSE 0 END,
       period_end ASC
     LIMIT ?
  `).all(...params, Math.max(1, Math.min(500, Number(filters.limit) || 100)));
}

function updateGoal(db, orgId, id, patch) {
  patch = patch || {};
  const cur = inOrg(db, "smb_crm_goals", orgId, id);
  if (!cur) return null;
  const now = nowIso();
  const next = {
    name: patch.name !== undefined ? nonEmptyString(patch.name, "name") : cur.name,
    metric: patch.metric !== undefined ? nonEmptyString(patch.metric, "metric") : cur.metric,
    target_value: patch.targetValue !== undefined ? Number(patch.targetValue) || 0 : cur.target_value,
    current_value: patch.currentValue !== undefined ? Number(patch.currentValue) || 0 : cur.current_value,
    period_start: patch.periodStart !== undefined ? (patch.periodStart || null) : cur.period_start,
    period_end: patch.periodEnd !== undefined ? (patch.periodEnd || null) : cur.period_end,
    owner_user_id: patch.ownerUserId !== undefined ? (patch.ownerUserId || null) : cur.owner_user_id
  };
  db.prepare(`
    UPDATE smb_crm_goals
       SET name = ?, metric = ?, target_value = ?, current_value = ?,
           period_start = ?, period_end = ?, owner_user_id = ?, updated_at = ?
     WHERE id = ? AND org_id = ?
  `).run(
    next.name, next.metric, next.target_value, next.current_value,
    next.period_start, next.period_end, next.owner_user_id, now, id, orgId
  );
  return getGoal(db, orgId, id);
}

function deleteGoal(db, orgId, id) {
  const cur = inOrg(db, "smb_crm_goals", orgId, id);
  if (!cur) return false;
  db.prepare("DELETE FROM smb_crm_goals WHERE id = ? AND org_id = ?").run(id, orgId);
  return true;
}

// ════════════════════════════════════════════════════════════════════════
// MERGE CUSTOMERS
// ════════════════════════════════════════════════════════════════════════

/**
 * Merge two customer rows in the same org. The survivor keeps its
 * id; the loser is stamped with `merged_into_id = survivorId` and
 * disappears from the default listCustomers view (the row is
 * preserved for audit/forensic purposes, not deleted).
 *
 * Linked rows (deals, quotes, activities) on the loser are
 * retargeted to the survivor in a single transaction. Tasks are
 * left alone (a task can outlive the customer it referenced).
 *
 * Throws:
 *   - RecordsError("MISSING_FIELD") if either id is missing
 *   - NotFoundError if either id is missing in this org
 *   - OrgMismatchError if either id exists in a different org
 *     (caller forged a body — refuse loudly so the dedup never
 *      silently targets a foreign customer)
 *   - RecordsError("SAME_CUSTOMER") if survivor === loser
 */
function mergeCustomers(db, orgId, input) {
  assertOrgScope(orgId);
  input = input || {};
  const survivorId = String(input.survivorId || "").trim();
  const loserId = String(input.loserId || "").trim();
  if (!survivorId || !loserId) {
    throw new RecordsError("MISSING_FIELD", "survivorId and loserId are required");
  }
  if (survivorId === loserId) {
    throw new RecordsError("SAME_CUSTOMER", "survivorId and loserId must differ");
  }
  const survivor = getCustomer(db, orgId, survivorId);
  if (!survivor) throw new NotFoundError(`Customer not found: ${survivorId}`);
  const loser = db.prepare("SELECT * FROM smb_crm_customers WHERE id = ?").get(loserId);
  if (!loser) throw new NotFoundError(`Customer not found: ${loserId}`);
  if (loser.org_id !== orgId) {
    // Forge attempt: the loser's id exists, but in a different org.
    throw new OrgMismatchError(`Cannot merge across org boundaries: ${loserId}`);
  }
  const now = nowIso();
  db.exec("BEGIN");
  try {
    // 1) Retarget the loser's linked rows. Tasks are left alone.
    db.prepare("UPDATE smb_crm_deals      SET customer_id = ?, updated_at = ? WHERE org_id = ? AND customer_id = ?")
      .run(survivorId, now, orgId, loserId);
    db.prepare("UPDATE smb_crm_quotes     SET customer_id = ?, updated_at = ? WHERE org_id = ? AND customer_id = ?")
      .run(survivorId, now, orgId, loserId);
    db.prepare("UPDATE smb_crm_activities SET customer_id = ?, updated_at = ? WHERE org_id = ? AND customer_id = ?")
      .run(survivorId, now, orgId, loserId);
    // 2) Stamp the loser row with merged_into_id.
    db.prepare(`
      UPDATE smb_crm_customers
         SET merged_into_id = ?, status = ?, updated_at = ?
       WHERE id = ? AND org_id = ?
    `).run(survivorId, "inactive", now, loserId, orgId);
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* swallow */ }
    throw err;
  }
  return {
    survivorId,
    loserId,
    survivor: getCustomer(db, orgId, survivorId),
    loser: getCustomer(db, orgId, loserId)
  };
}

// ════════════════════════════════════════════════════════════════════════
// VIEW ADAPTERS (snake → camel)
// ════════════════════════════════════════════════════════════════════════

function toCustomerView(row) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    fullName: row.full_name,
    email: row.email || null,
    phone: row.phone || null,
    companyName: row.company_name || null,
    address: row.address || null,
    locale: row.locale,
    status: row.status,
    branchId: row.branch_id || null,
    tags: safeJson(row.tags_json, []),
    custom: safeJson(row.custom_json, {}),
    mergedIntoId: row.merged_into_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toDealView(row) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    customerId: row.customer_id || null,
    value: Number(row.value) || 0,
    currency: row.currency,
    stageId: row.stage_id || null,
    probability: Number(row.probability) || 0,
    expectedCloseDate: row.expected_close_date || null,
    status: row.status,
    ownerUserId: row.owner_user_id || null,
    branchId: row.branch_id || null,
    tags: safeJson(row.tags_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toTaskView(row) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    description: row.description || null,
    customerId: row.customer_id || null,
    dealId: row.deal_id || null,
    dueAt: row.due_at || null,
    status: row.status,
    priority: row.priority,
    assignedUserId: row.assigned_user_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toQuoteView(row) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    number: row.number,
    customerId: row.customer_id || null,
    dealId: row.deal_id || null,
    issueDate: row.issue_date || null,
    expiryDate: row.expiry_date || null,
    status: row.status,
    totalAmount: Number(row.total_amount) || 0,
    currency: row.currency,
    lineItems: safeJson(row.line_items_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toActivityView(row) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    type: row.type,
    subject: row.subject || null,
    body: row.body || null,
    customerId: row.customer_id || null,
    dealId: row.deal_id || null,
    quoteId: row.quote_id || null,
    activityAt: row.activity_at,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toGoalView(row) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    metric: row.metric,
    targetValue: Number(row.target_value) || 0,
    currentValue: Number(row.current_value) || 0,
    periodStart: row.period_start || null,
    periodEnd: row.period_end || null,
    ownerUserId: row.owner_user_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════

module.exports = {
  // customers
  createCustomer, getCustomer, listCustomers, updateCustomer, deleteCustomer,
  // deals
  createDeal, getDeal, listDeals, updateDeal, deleteDeal,
  // tasks
  createTask, getTask, listTasks, updateTask, deleteTask,
  // quotes
  createQuote, getQuote, listQuotes, updateQuote, deleteQuote,
  // activities
  createActivity, getActivity, listActivities, updateActivity, deleteActivity,
  // goals
  createGoal, getGoal, listGoals, updateGoal, deleteGoal,
  // merge
  mergeCustomers,
  // views
  toCustomerView, toDealView, toTaskView, toQuoteView, toActivityView, toGoalView,
  // errors
  RecordsError, NotFoundError, ConflictError, OrgMismatchError
};
