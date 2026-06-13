"use strict";

/**
 * A1 SMB CRM — Accounting export engine (Track 4: M14.15).
 *
 * Pattern A: pure functions, no Fastify imports, no `node:sqlite`
 * imports, no `process.env` reads.
 *
 * Public surface:
 *   exportAccounting(db, orgId, input)  → { rows, csv, json, format }
 *   toExportRow(record, entityType)    → flat accounting column shape
 *   getColumns(entityType)              → column order
 *
 * The V1 export covers two entity types: deals (revenue side) and
 * quotes (issued side). The column set is intentionally narrow:
 * it gives the Armenian 1C-style accountant enough to import into
 * their tool, without pre-judging the format of every possible
 * downstream system. The format is "csv" by default; "json" is
 * supported for testing and for SPA preview.
 *
 * Period filter: `period` is a string like "2026-Q1" or "2026-05"
 * or "2026". It bounds the `created_at` (deals) or `issue_date`
 * (quotes) column. Empty period = no filter.
 *
 * Currency: all amounts are exported in the org's base currency.
 * Cross-currency conversion is V2.
 */

const VALID_ENTITY_TYPES = ["deal", "quote"];
const VALID_FORMATS = ["csv", "json"];

const COLUMNS = {
  deal: [
    "id", "title", "customerId", "customerName",
    "value", "currency", "stageId", "status",
    "probability", "expectedCloseDate", "ownerUserId",
    "createdAt", "updatedAt"
  ],
  quote: [
    "id", "number", "customerId", "customerName",
    "dealId", "totalAmount", "currency", "status",
    "issueDate", "expiryDate", "createdAt", "updatedAt"
  ]
};

function getColumns(entityType) {
  return COLUMNS[entityType] || [];
}

function validateEntityType(value) {
  const v = String(value || "deal").trim().toLowerCase();
  if (!VALID_ENTITY_TYPES.includes(v)) {
    throw new ExportError("INVALID_ENTITY_TYPE", `entityType must be one of ${VALID_ENTITY_TYPES.join("|")}`);
  }
  return v;
}

function validateFormat(value) {
  const v = String(value || "csv").trim().toLowerCase();
  if (!VALID_FORMATS.includes(v)) {
    throw new ExportError("INVALID_FORMAT", `format must be one of ${VALID_FORMATS.join("|")}`);
  }
  return v;
}

function _periodBound(period) {
  if (!period) return { start: null, end: null };
  const p = String(period).trim();
  // YYYY
  if (/^\d{4}$/.test(p)) {
    return { start: `${p}-01-01T00:00:00.000Z`, end: `${p}-12-31T23:59:59.999Z` };
  }
  // YYYY-MM
  if (/^\d{4}-\d{2}$/.test(p)) {
    const [y, m] = p.split("-");
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    return { start: `${p}-01T00:00:00.000Z`, end: `${p}-${String(lastDay).padStart(2, "0")}T23:59:59.999Z` };
  }
  // YYYY-Qn
  const qMatch = p.match(/^(\d{4})-Q([1-4])$/);
  if (qMatch) {
    const y = qMatch[1];
    const q = Number(qMatch[2]);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = q * 3;
    const lastDay = new Date(Number(y), endMonth, 0).getDate();
    return {
      start: `${y}-${String(startMonth).padStart(2, "0")}-01T00:00:00.000Z`,
      end: `${y}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}T23:59:59.999Z`
    };
  }
  return { start: null, end: null };
}

function toExportRow(record, entityType) {
  if (!record) return null;
  if (entityType === "deal") {
    return {
      id: record.id,
      title: record.title,
      customerId: record.customer_id,
      customerName: record.customer_name || "",
      value: record.value,
      currency: record.currency,
      stageId: record.stage_id,
      status: record.status,
      probability: record.probability,
      expectedCloseDate: record.expected_close_date,
      ownerUserId: record.owner_user_id,
      createdAt: record.created_at,
      updatedAt: record.updated_at
    };
  }
  if (entityType === "quote") {
    return {
      id: record.id,
      number: record.number,
      customerId: record.customer_id,
      customerName: record.customer_name || "",
      dealId: record.deal_id,
      totalAmount: record.total_amount,
      currency: record.currency,
      status: record.status,
      issueDate: record.issue_date,
      expiryDate: record.expiry_date,
      createdAt: record.created_at,
      updatedAt: record.updated_at
    };
  }
  return null;
}

function exportAccounting(db, orgId, input) {
  input = input || {};
  const entityType = validateEntityType(input.entityType);
  const format = validateFormat(input.format);
  const period = input.period ? String(input.period).trim() : null;
  const { start, end } = _periodBound(period);

  let records;
  if (entityType === "deal") {
    let sql = `SELECT d.*, c.full_name AS customer_name
                 FROM smb_crm_deals d
            LEFT JOIN smb_crm_customers c ON c.id = d.customer_id
                WHERE d.org_id = ?`;
    const params = [orgId];
    if (start) { sql += ` AND d.created_at >= ?`; params.push(start); }
    if (end)   { sql += ` AND d.created_at <= ?`; params.push(end); }
    sql += ` ORDER BY d.created_at DESC`;
    records = db.prepare(sql).all(...params);
  } else {
    // quote
    let sql = `SELECT q.*, c.full_name AS customer_name
                 FROM smb_crm_quotes q
            LEFT JOIN smb_crm_customers c ON c.id = q.customer_id
                WHERE q.org_id = ?`;
    const params = [orgId];
    if (start) { sql += ` AND q.issue_date >= ?`; params.push(start); }
    if (end)   { sql += ` AND q.issue_date <= ?`; params.push(end); }
    sql += ` ORDER BY q.issue_date DESC`;
    records = db.prepare(sql).all(...params);
  }

  const rows = records.map(r => toExportRow(r, entityType));
  const columns = getColumns(entityType);

  if (format === "json") {
    return {
      format: "json",
      entityType,
      period,
      columns,
      rows
    };
  }
  // CSV
  const csv = _toCsv(columns, rows);
  return {
    format: "csv",
    entityType,
    period,
    columns,
    rows,
    csv
  };
}

function _toCsv(columns, rows) {
  const header = columns.join(",");
  const lines = rows.map(r => columns.map(c => _csvCell(r[c])).join(","));
  return [header, ...lines].join("\n");
}

function _csvCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

class ExportError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = "ExportError";
    this.code = code;
    this.statusCode = statusCode || 400;
  }
}

module.exports = {
  exportAccounting,
  toExportRow,
  getColumns,
  validateEntityType,
  validateFormat,
  VALID_ENTITY_TYPES,
  VALID_FORMATS,
  ExportError
};
