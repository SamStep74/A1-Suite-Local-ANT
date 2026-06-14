/**
 * product-importers/hayhashvapah — ANT port of
 * A1-Platform's `importHayhashvapahRows`.
 *
 * Source: A1-Platform/src/product-importers/hayhashvapah.js (63 lines).
 * Reads rows from a SQLite source DB (4 tables: accounts,
 * sessions, audit_log, meta) and writes them into ANT's
 * `smb_crm_*` equivalents.
 *
 * ANT doesn't have a separate `hayhashvapah.*` schema — the
 * accounting data lives in the SMB-CRM module's tables when
 * configured. For the v1 port, we write the imported rows into
 * `smb_crm_blueprints` as a JSON blob per table, distinguished
 * by `industry = 'hayhashvapah-<table>'`. This preserves the
 * import-as-blob pattern that A1-Platform's source uses
 * (everything went into jsonb `doc` columns).
 *
 * Public surface:
 *   importHayhashvapahRows(options) — see A1-Platform source.
 *     Returns { product, tables: {accounts, sessions, auditLog, meta}, counts: {...} }
 */
'use strict';

const crypto = require('node:crypto');

const { readSqliteRows } = require('./sqlite');

const TABLE_INDUSTRY_MAP = Object.freeze({
  accounts: 'hayhashvapah-accounts',
  sessions: 'hayhashvapah-sessions',
  audit_log: 'hayhashvapah-audit-log',
  meta: 'hayhashvapah-meta'
});

function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeRows(rowsByTable) {
  return {
    accounts: rowsByTable.accounts || [],
    sessions: rowsByTable.sessions || [],
    auditLog: rowsByTable.audit_log || [],
    meta: rowsByTable.meta || []
  };
}

async function importHayhashvapahRows(options) {
  if (!options || !options.db) throw new Error('importHayhashvapahRows requires db');
  if (!options.org_id && !options.orgId) {
    throw new Error('importHayhashvapahRows requires org_id');
  }
  const orgId = options.org_id || options.orgId;
  const slug = String(options.slug || '');

  const rows = normalizeRows(
    options.rowsByTable ||
      (options.sqlitePath ? readSqliteRows(options.sqlitePath, ['accounts', 'sessions', 'audit_log', 'meta']) : {})
  );

  const hasBlueprints = options.db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = 'smb_crm_blueprints'`)
    .get();

  if (!hasBlueprints) {
    return {
      product: 'hayhashvapah',
      skipped: 'smb_crm_blueprints table not present in target DB',
      counts: {
        accounts: rows.accounts.length,
        sessions: rows.sessions.length,
        auditLog: rows.auditLog.length,
        meta: rows.meta.length
      }
    };
  }

  const now = new Date().toISOString();
  const tables = {};
  const counts = {};

  for (const [logicalName, industry] of Object.entries(TABLE_INDUSTRY_MAP)) {
    const tableRows = rows[logicalName === 'audit_log' ? 'auditLog' : logicalName] || [];
    counts[logicalName === 'audit_log' ? 'auditLog' : logicalName] = tableRows.length;
    if (tableRows.length === 0) continue;

    const id = newId(`hh-${logicalName.replace('_', '-')}`);
    const insert = options.db.prepare(
      `INSERT OR REPLACE INTO smb_crm_blueprints
         (id, org_id, industry, company_name, language, subdomain, doc, source_provider, source_evidence_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run(
      id,
      orgId,
      industry,
      slug,
      'en',
      null,
      JSON.stringify({ rows: tableRows, sourceTable: logicalName }),
      'hayhashvapah-import',
      null,
      now,
      now
    );
    tables[logicalName] = id;
  }

  return {
    product: 'hayhashvapah',
    slug,
    tables,
    counts
  };
}

module.exports = { importHayhashvapahRows, TABLE_INDUSTRY_MAP };
