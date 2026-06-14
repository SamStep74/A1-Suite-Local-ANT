/**
 * product-importers/studio — ANT port of A1-Platform's
 * `importStudioSqlite`. Reads ALL tables from a Studio SQLite
 * source DB and writes them as JSON-blob rows in
 * `smb_crm_blueprints` (one row per source table, distinguished
 * by `industry = 'studio-<table>'`).
 *
 * Source: A1-Platform/src/product-importers/studio.js (70 lines).
 *
 * ANT adaptation: A1-Platform used Postgres `studio.legacy_rows`
 * keyed by `(import_batch_id, table_name, source_pk)`. ANT doesn't
 * have that table; we use the same JSON-blob-per-row pattern
 * that the smb-crm and hayhashvapah importers use. The
 * `importBatchId` is still returned for traceability, and the
 * detected `studioOrgId` is captured in the first `organizations`
 * row.
 *
 * Public surface:
 *   importStudioSqlite(options) — see A1-Platform source.
 *     Returns { product, importBatchId, studioOrgId, tables,
 *               rows, rowCounts }
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const { readSqliteRows } = require('./sqlite');

function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

function valueAsJson(row) {
  const clone = { ...row };
  delete clone.__rowid;
  return clone;
}

function sourcePrimaryKey(row) {
  if (row.id !== undefined && row.id !== null) return String(row.id);
  if (row.token !== undefined && row.token !== null) return String(row.token);
  if (row.email !== undefined && row.email !== null) return String(row.email);
  if (row.__rowid !== undefined && row.__rowid !== null) return String(row.__rowid);
  return crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
}

function detectedStudioOrgId(rowsByTable = {}) {
  const organizationIds = (rowsByTable.organizations || [])
    .map((row) => row?.id)
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).trim())
    .filter(Boolean);
  return organizationIds.length === 1 ? organizationIds[0] : '';
}

async function importStudioSqlite(options) {
  if (!options || !options.db) throw new Error('importStudioSqlite requires db');
  if (!options.org_id && !options.orgId) {
    throw new Error('importStudioSqlite requires org_id');
  }
  const orgId = options.org_id || options.orgId;
  const slug = String(options.slug || '');
  const sourcePath = options.sourcePath || options.sqlitePath;
  const rowsByTable =
    options.rowsByTable || (sourcePath && sourcePath !== 'inline' ? readSqliteRows(sourcePath) : {});
  const sourceSha256 =
    options.sourceSha256 ||
    (sourcePath && sourcePath !== 'inline' && fs.existsSync(sourcePath)
      ? crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex')
      : crypto.createHash('sha256').update(JSON.stringify(rowsByTable)).digest('hex'));
  const rowCounts = Object.fromEntries(
    Object.entries(rowsByTable).map(([table, rows]) => [table, rows.length])
  );

  const hasBlueprints = options.db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = 'smb_crm_blueprints'`)
    .get();

  if (!hasBlueprints) {
    return {
      product: 'studio',
      skipped: 'smb_crm_blueprints table not present in target DB',
      importBatchId: newId('studio-batch'),
      studioOrgId: detectedStudioOrgId(rowsByTable),
      tables: Object.keys(rowsByTable).length,
      rows: 0,
      rowCounts
    };
  }

  const importBatchId = newId('studio-batch');
  const now = new Date().toISOString();
  const insert = options.db.prepare(
    `INSERT OR REPLACE INTO smb_crm_blueprints
       (id, org_id, industry, company_name, language, subdomain, doc, source_provider, source_evidence_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let importedRows = 0;
  for (const [tableName, rows] of Object.entries(rowsByTable)) {
    for (const row of rows) {
      const sourcePk = sourcePrimaryKey(row);
      const id = newId(`studio-${tableName.replace(/[^a-z0-9]+/gi, '-')}`);
      const doc = {
        importBatchId,
        tableName,
        sourcePk,
        sourceSha256,
        sourcePath: sourcePath || 'inline',
        row: valueAsJson(row)
      };
      insert.run(
        id,
        orgId,
        `studio-${tableName}`,
        slug,
        'en',
        null,
        JSON.stringify(doc),
        'studio-import',
        JSON.stringify({ batchId: importBatchId, sourceSha256 }),
        now,
        now
      );
      importedRows += 1;
    }
  }

  return {
    product: 'studio',
    importBatchId,
    studioOrgId: detectedStudioOrgId(rowsByTable),
    tables: Object.keys(rowsByTable).length,
    rows: importedRows,
    rowCounts
  };
}

module.exports = { importStudioSqlite };
