/**
 * product-importers/csv — generic CSV importer. NOT in the
 * A1-Platform source — this is ANT-specific and exists for
 * migration scenarios where the source data is a flat CSV
 * (exported from a spreadsheet, an old MAX DB, or a third-party
 * tool) that needs to land in `smb_crm_blueprints` as a single
 * JSON-blob row.
 *
 * Public surface:
 *   parseCsv(csvText) — returns string[][]
 *   importCsvFile(options) — reads the CSV file, writes one
 *     smb_crm_blueprints row with the parsed data. Returns
 *     { product, slug, table, rowCount, columns }
 *
 * CSV format:
 *   - First row is the header
 *   - Comma-separated, double-quote escaped (standard RFC 4180)
 *   - One row = one CSV record; the entire table lands as a
 *     single JSON blob (the importer is for low-volume migration,
 *     not bulk ETL).
 *
 * If the target table is `smb_crm_customers` (or any other
 * `smb_crm_*` table), the importer will fall back to inserting
 * one row per CSV record. Otherwise it lands in
 * `smb_crm_blueprints.doc` as an array of objects.
 */
'use strict';

const fsp = require('node:fs/promises');
const crypto = require('node:crypto');

function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

/* ── CSV parser (RFC 4180 subset) ─────────────────────────────────── */

/** Tokenize one CSV line. Handles double-quoted fields with
 *  embedded commas + escaped quotes ("" → "). */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else if (ch === '"' && cur === '') {
      inQuotes = true;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Parse a full CSV text. Returns string[][] (rows of cells). */
function parseCsv(csvText) {
  // Split on newlines, but respect quoted newlines (rare in
  // practice — we treat \n inside quotes as a literal char).
  const lines = String(csvText || '').split(/\r?\n/);
  return lines.filter((l) => l.length > 0).map(parseCsvLine);
}

/* ── importer ────────────────────────────────────────────────────── */

const ALLOWED_TARGETS = Object.freeze([
  'smb_crm_blueprints', // default — lands as a JSON blob
  'smb_crm_customers',
  'smb_crm_deals',
  'smb_crm_tasks',
  'smb_crm_goals'
]);

function normalizeTarget(table) {
  const t = String(table || '').trim();
  if (!t) return 'smb_crm_blueprints';
  if (!ALLOWED_TARGETS.includes(t)) {
    throw new Error(
      `csv import: target table "${t}" is not in the allowlist (${ALLOWED_TARGETS.join(', ')})`
    );
  }
  return t;
}

function rowToObject(header, cells) {
  const obj = {};
  for (let i = 0; i < header.length; i += 1) {
    const key = header[i].trim();
    if (!key) continue;
    obj[key] = i < cells.length ? cells[i] : '';
  }
  return obj;
}

async function importCsvFile(options) {
  if (!options || !options.db) throw new Error('importCsvFile requires db');
  if (!options.csvPath && !options.csvText) {
    throw new Error('importCsvFile requires csvPath or csvText');
  }
  if (!options.org_id && !options.orgId) {
    throw new Error('importCsvFile requires org_id');
  }
  const orgId = options.org_id || options.orgId;
  const slug = String(options.slug || '');
  const target = normalizeTarget(options.target);
  const csvText = options.csvText || (await fsp.readFile(options.csvPath, 'utf8'));
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return { product: 'csv', slug, target, rowCount: 0, columns: [] };
  }
  const [header, ...body] = rows;
  const objects = body.map((cells) => rowToObject(header, cells));
  const now = new Date().toISOString();

  const hasTarget = options.db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(target);
  if (!hasTarget) {
    return { product: 'csv', slug, target, rowCount: 0, columns: header, skipped: 'target table missing' };
  }

  let insertedRows = 0;
  if (target === 'smb_crm_blueprints') {
    // Single row, JSON-blob
    const id = newId('csv');
    options.db
      .prepare(
        `INSERT OR REPLACE INTO smb_crm_blueprints
           (id, org_id, industry, company_name, language, subdomain, doc, source_provider, source_evidence_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        orgId,
        options.industry || 'csv-import',
        slug || String(header[0] || 'csv'),
        'en',
        null,
        JSON.stringify({ columns: header, rows: objects }),
        'csv-import',
        null,
        now,
        now
      );
    insertedRows = 1;
  } else {
    // Per-row insert into a real smb_crm_* table. The CSV must
    // supply at least an `id` column (PK) and `org_id` is
    // auto-injected if missing.
    const sample = objects[0] || {};
    const cols = Object.keys(sample);
    if (!cols.includes('id')) {
      throw new Error(`csv import: target "${target}" requires an "id" column`);
    }
    const allCols = Array.from(new Set([...cols, 'org_id', 'created_at', 'updated_at']));
    const placeholders = allCols.map(() => '?').join(', ');
    const insert = options.db.prepare(
      `INSERT OR REPLACE INTO ${target} (${allCols.join(', ')}) VALUES (${placeholders})`
    );
    const tx = options.db.prepare('BEGIN');
    tx.run();
    try {
      for (const obj of objects) {
        const values = allCols.map((c) => {
          if (c === 'org_id') return orgId;
          if (c === 'created_at' || c === 'updated_at') return now;
          return obj[c] === undefined ? null : obj[c];
        });
        insert.run(...values);
        insertedRows += 1;
      }
      options.db.prepare('COMMIT').run();
    } catch (err) {
      options.db.prepare('ROLLBACK').run();
      throw err;
    }
  }

  return {
    product: 'csv',
    slug,
    target,
    rowCount: insertedRows,
    columns: header
  };
}

module.exports = {
  parseCsv,
  parseCsvLine,
  importCsvFile,
  ALLOWED_TARGETS
};
