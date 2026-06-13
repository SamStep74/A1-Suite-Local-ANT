"use strict";

/**
 * A1 SMB CRM — CSV import + dedup engine (Track 4: M14.14).
 *
 * Pattern A: pure functions, no Fastify imports, no `node:sqlite`
 * imports, no `process.env` reads.
 *
 * Public surface:
 *   parseCsv(text)                          → row[]   (header-driven)
 *   importCsv(db, orgId, input, opts)       → { run, errors }
 *   listImportRuns(db, orgId, filters)      → run row[]
 *   getImportRun(db, orgId, id)             → run row | null
 *   toImportRunView(raw)                   → camelCase
 *
 * CSV parsing is hand-rolled and deliberately simple: a header row
 * followed by N data rows, comma-separated, with double-quote
 * escaping. No multi-line cells, no embedded newlines. This is
 * V1's "import from a Google Sheets export" path; richer CSV
 * (RFC 4180 multi-line) is V2.
 *
 * Dedup: when `dedupKey` is supplied (e.g. "email"), rows with the
 * same value in that column are collapsed — the FIRST occurrence
 * is kept, the rest are counted as `dedupedRows`. The dedup is
 * applied per-import-run AND across existing rows in the target
 * table: a row whose dedupKey already exists in the DB is
 * reported as `dedupedRows` (not re-inserted).
 *
 * Supported entity types: "customer", "deal", "task", "quote",
 * "activity", "goal". The import engine dispatches by `entityType`
 * to the corresponding records engine (smbCrmRecords). The
 * engine writes the records inside the same transaction as the
 * import_run row insert; if any error throws, the import_run row
 * is still written (with errors_json) so the SPA can show a
 * "X of Y imported, Z errors" toast.
 *
 * Schema lives in `server/db.js#ensureSmbCrmAutomationSchema`
 * (`smb_crm_import_runs` table).
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

class ImportError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = "ImportError";
    this.code = code;
    this.statusCode = statusCode || 400;
  }
}

// ─── Validation helpers ──────────────────────────────────────────────────

const VALID_ENTITY_TYPES = ["customer", "deal", "task", "quote", "activity", "goal"];

function nonEmptyString(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new ImportError("MISSING_FIELD", `${field} is required`);
  }
  return String(value).trim();
}

function validateEntityType(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!VALID_ENTITY_TYPES.includes(v)) {
    throw new ImportError("INVALID_ENTITY_TYPE", `entityType must be one of ${VALID_ENTITY_TYPES.join("|")}`);
  }
  return v;
}

function assertOrgScope(orgId) {
  if (!orgId || typeof orgId !== "string") {
    throw new ImportError("MISSING_ORG_ID", "orgId is required");
  }
}

// ════════════════════════════════════════════════════════════════════════
// CSV PARSER (V1: hand-rolled, single-line, double-quote escaping)
// ════════════════════════════════════════════════════════════════════════

function parseCsv(text) {
  if (text === null || text === undefined) return [];
  const input = String(text);
  // Strip a UTF-8 BOM if present.
  const src = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
  const lines = src.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) return [];
  const headerLine = lines[0];
  const headers = _splitCsvLine(headerLine).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = _splitCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] !== undefined ? cells[j] : "";
    }
    rows.push(row);
  }
  return rows;
}

function _splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { out.push(cur); cur = ""; }
      else { cur += c; }
    }
  }
  out.push(cur);
  return out;
}

// ════════════════════════════════════════════════════════════════════════
// ENTITY DISPATCH
// Maps entityType + a row object → the appropriate smbCrmRecords
// create function. Each entry normalizes camelCase CSV headers to
// the engine's input shape (mostly a no-op since both are
// camelCase, but it gives us a single chokepoint for validation
// and field aliasing).
// ════════════════════════════════════════════════════════════════════════

function _requireRecords() {
  // Lazy require so this engine can be unit-tested without booting
  // the records engine. The contract is intentionally narrow:
  // createCustomer, createDeal, createTask, createQuote,
  // createActivity, createGoal.
  return require("./smbCrmRecords");
}

function _coerceRow(entityType, row) {
  // CSV headers are case-insensitive in our usage; the keys from
  // parseCsv are already trimmed. This helper is the chokepoint
  // for value coercion (numbers, dates, enums).
  const r = { ...row };
  // Strip empty strings so engine defaults can fill in.
  for (const k of Object.keys(r)) {
    if (r[k] === "") delete r[k];
  }
  if (entityType === "deal" || entityType === "quote" || entityType === "goal") {
    if (r.value !== undefined) r.value = Number(r.value);
    if (r.totalAmount !== undefined) r.totalAmount = Number(r.totalAmount);
    if (r.targetValue !== undefined) r.targetValue = Number(r.targetValue);
    if (r.currentValue !== undefined) r.currentValue = Number(r.currentValue);
    if (r.probability !== undefined) r.probability = Number(r.probability);
  }
  if (entityType === "task") {
    if (r.dueAt !== undefined && r.dueAt) r.dueAt = new Date(r.dueAt).toISOString();
  }
  if (entityType === "activity") {
    if (r.activityAt !== undefined && r.activityAt) r.activityAt = new Date(r.activityAt).toISOString();
  }
  if (entityType === "quote") {
    if (r.issueDate !== undefined && r.issueDate) r.issueDate = new Date(r.issueDate).toISOString();
    if (r.expiryDate !== undefined && r.expiryDate) r.expiryDate = new Date(r.expiryDate).toISOString();
  }
  if (entityType === "goal") {
    if (r.periodStart !== undefined && r.periodStart) r.periodStart = new Date(r.periodStart).toISOString();
    if (r.periodEnd !== undefined && r.periodEnd) r.periodEnd = new Date(r.periodEnd).toISOString();
  }
  return r;
}

// ════════════════════════════════════════════════════════════════════════
// IMPORT
// ════════════════════════════════════════════════════════════════════════

function importCsv(db, orgId, input, opts) {
  assertOrgScope(orgId);
  input = input || {};
  opts = opts || {};
  const entityType = validateEntityType(input.entityType);
  const csvText = nonEmptyString(input.csv, "csv");
  const dedupKey = input.dedupKey ? String(input.dedupKey).trim() : null;
  const createdBy = opts.createdBy ? String(opts.createdBy) : null;

  const records = _requireRecords();
  const rows = parseCsv(csvText);
  const totalRows = rows.length;
  let importedRows = 0;
  let dedupedRows = 0;
  let erroredRows = 0;
  const errors = [];
  const seen = new Set();

  const dispatch = {
    customer: records.createCustomer,
    deal:     records.createDeal,
    task:     records.createTask,
    quote:    records.createQuote,
    activity: records.createActivity,
    goal:     records.createGoal
  }[entityType];

  for (let i = 0; i < rows.length; i++) {
    const rawRow = rows[i];
    const row = _coerceRow(entityType, rawRow);
    try {
      // In-import dedup: same dedupKey within the same import run.
      let isDupe = false;
      if (dedupKey) {
        const keyVal = String(rawRow[dedupKey] || "").trim();
        if (keyVal) {
          if (seen.has(keyVal)) {
            dedupedRows++;
            isDupe = true;
            continue;
          }
          // Cross-run dedup: check the table for an existing row
          // with the same dedupKey value.
          if (_existsByKey(db, orgId, entityType, dedupKey, keyVal)) {
            seen.add(keyVal);
            dedupedRows++;
            isDupe = true;
            continue;
          }
          seen.add(keyVal);
        }
      }
      const created = dispatch(db, orgId, row);
      if (created && created.id) importedRows++;
    } catch (err) {
      erroredRows++;
      errors.push({
        rowIndex: i + 1,  // 1-based, excluding header
        dedupKeyValue: dedupKey ? String(rawRow[dedupKey] || "") : null,
        message: String(err && err.message || err),
        code: err && err.code || "IMPORT_ERROR"
      });
    }
  }

  const runId = randomId("imp");
  const now = nowIso();
  db.prepare(`
    INSERT INTO smb_crm_import_runs (
      id, org_id, entity_type, total_rows, imported_rows, deduped_rows,
      errored_rows, errors_json, dedup_key, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId, orgId, entityType, totalRows, importedRows, dedupedRows,
    erroredRows, JSON.stringify(errors), dedupKey, createdBy, now
  );

  return {
    run: getImportRun(db, orgId, runId),
    importedRows,
    dedupedRows,
    erroredRows,
    totalRows,
    errors
  };
}

function _existsByKey(db, orgId, entityType, key, value) {
  // For customer/deal/task/quote/activity/goal, the dedupKey is
  // typically a unique-ish field (email, number, etc.). We use
  // a simple lookup against the corresponding smb_crm_* table.
  const table = `smb_crm_${entityType === "task" ? "todo_tasks" : entityType + "s"}`;
  const col = key;
  try {
    const row = db
      .prepare(`SELECT 1 AS hit FROM ${table} WHERE org_id = ? AND ${col} = ? LIMIT 1`)
      .get(orgId, value);
    return !!row;
  } catch {
    // Unknown column — silently skip the cross-run dedup check.
    // The error will surface on insert (column doesn't exist),
    // and the run row will still be written for audit.
    return false;
  }
}

function listImportRuns(db, orgId, filters) {
  filters = filters || {};
  const where = ["org_id = ?"];
  const params = [orgId];
  if (filters.entityType) {
    where.push("entity_type = ?");
    params.push(String(filters.entityType).trim().toLowerCase());
  }
  return db.prepare(`
    SELECT * FROM smb_crm_import_runs
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT ?
  `).all(...params, Math.max(1, Math.min(500, Number(filters.limit) || 100)));
}

function getImportRun(db, orgId, id) {
  const row = db
    .prepare("SELECT * FROM smb_crm_import_runs WHERE id = ? AND org_id = ?")
    .get(id, orgId);
  return row || null;
}

// ════════════════════════════════════════════════════════════════════════
// VIEW ADAPTER
// ════════════════════════════════════════════════════════════════════════

function toImportRunView(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    orgId: raw.org_id,
    entityType: raw.entity_type,
    totalRows: raw.total_rows,
    importedRows: raw.imported_rows,
    dedupedRows: raw.deduped_rows,
    erroredRows: raw.errored_rows,
    errors: safeJson(raw.errors_json, []),
    dedupKey: raw.dedup_key,
    createdBy: raw.created_by,
    createdAt: raw.created_at
  };
}

module.exports = {
  parseCsv,
  importCsv,
  listImportRuns,
  getImportRun,
  toImportRunView,
  VALID_ENTITY_TYPES,
  ImportError
};
