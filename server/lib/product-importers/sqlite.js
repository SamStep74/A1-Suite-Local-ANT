/**
 * product-importers/sqlite — generic sqlite row reader (portable).
 * Direct port of A1-Platform/src/product-importers/sqlite.js with
 * one ANT-specific tweak: the table list query is more defensive
 * (we try `sqlite_schema` first, fall back to `sqlite_master` for
 * older Node versions).
 *
 * Public surface:
 *   openSqliteDatabase(dbPath) — opens a read-only handle
 *   sqliteTables(db) — list of user table names
 *   readSqliteRows(dbPath, tableNames?) — { [table]: [{__rowid, ...row}] }
 *   parseMaybeJson(value, fallback?) — defensive JSON.parse
 */
'use strict';

function openSqliteDatabase(dbPath) {
  let DatabaseSync;
  try {
    // eslint-disable-next-line global-require
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    throw new Error('SQLite imports require Node.js with node:sqlite support');
  }
  return new DatabaseSync(dbPath, { readOnly: true });
}

function parseMaybeJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback === null ? value : fallback;
  }
}

function sqliteTables(db) {
  // Try sqlite_schema (preferred), fall back to sqlite_master.
  let rows;
  try {
    rows = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
  } catch {
    rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
  }
  return rows.map((r) => r.name);
}

const TABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function readSqliteRows(dbPath, tableNames = null) {
  const db = openSqliteDatabase(dbPath);
  try {
    const allowed = new Set(tableNames || sqliteTables(db));
    const rowsByTable = {};
    for (const table of sqliteTables(db)) {
      if (!allowed.has(table)) continue;
      if (!TABLE_NAME_RE.test(table)) {
        throw new Error(`Unsafe SQLite table name: ${table}`);
      }
      rowsByTable[table] = db.prepare(`SELECT rowid AS __rowid, * FROM "${table}"`).all();
    }
    return rowsByTable;
  } finally {
    db.close();
  }
}

module.exports = {
  openSqliteDatabase,
  parseMaybeJson,
  sqliteTables,
  readSqliteRows,
  TABLE_NAME_RE
};
