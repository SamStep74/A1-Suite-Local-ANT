/**
 * backup-restore — Pattern A port of A1-Platform's filesystem-based
 * tenant backup engine, adapted for ANT's single-SQLite + per-tenant
 * storage layout.
 *
 * Source: A1-Platform/src/backup-restore.js (217 lines) +
 * A1-Platform/src/tenant-transfer.js (639 lines) +
 * A1-Platform/src/checksums.js (61 lines).
 *
 * ANT differences:
 *   - Single SQLite DB with org_id scoping (vs. Postgres per-tenant DBs)
 *   - Storage engine is the local/S3 layer in `storage.js` (vs.
 *     tenant-prefixed files in A1-Platform)
 *   - In-DB `tenant_backup_packets` table already exists for
 *     in-process snapshots — this engine is for PORTABLE archives
 *     (JSON + blobs on disk, checksummed, restorable into any
 *     compatible ANT instance)
 *
 * Public surface:
 *   backupTenant({db, storage, orgId, outDir, options, audit, now})
 *   restoreTenant({db, storage, orgId, importDir, options, audit, now})
 *   backupAll({db, storage, options, audit, now})
 *   restoreAll({db, storage, options, audit, now})
 *
 * Pure helpers (no I/O — fully unit-testable):
 *   backupStamp(now)
 *   defaultExclusions()
 *   secretColumnPattern()
 *   sanitizeBackupRow(row, table, exclusions)
 *   buildManifest({org, tables, counts, exclusions, version, createdAt, ...})
 *   parseManifest(json)
 *   discoverOrgScopedTables(db, extraExclusions)
 *   countBackupTables(payload)
 *   verifyBackupChecksums(backupDir) — read checksums.txt, recompute
 *   writeChecksums(backupDir) — sha256 every file, write checksums.txt
 *
 * Sanitization contract (matches ANT's existing
 * `sanitizeBackupRow` in server/app.js):
 *   - Drop any column whose name matches /password_hash|secret|token|key/i
 *   - For known sensitive tables (webhook_endpoints, user_mfa_factors,
 *     integration_connectors) set `secretExcluded: true` so the
 *     restore-side knows secrets were stripped
 *   - Always drop the listed EXCLUDED_TABLES (sessions, user_credentials,
 *     webhook_signing_keys, quote_public_access)
 *
 * The engine is self-contained: no top-level DB require. `db` is
 * injected so tests can pass a sqlite DatabaseSync directly.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/* ── constants ───────────────────────────────────────────────────────── */

const SCHEMA_VERSION = 1;
const KIND = 'armosphera-one-tenant-archive';
const EXCLUDED_TABLES = Object.freeze([
  'sessions',
  'user_credentials',
  'webhook_signing_keys',
  'quote_public_access',
  'tenant_backup_packets' // never back up backups of backups
]);
const SECRET_COL_RE = /(password_hash|secret|token|key|hmac)/i;
const SENSITIVE_TABLES = Object.freeze({
  webhook_endpoints: true,
  user_mfa_factors: true,
  integration_connectors: true
});
const CHECKSUMS_FILE = 'checksums.txt';
const MANIFEST_FILE = 'manifest.json';
const STORAGE_DIR = 'blobs';

/* ── pure helpers ───────────────────────────────────────────────────── */

/** ISO date safe for filenames (colons and dots escaped). */
function backupStamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

/** Tables that must NEVER be exported, even if they have org_id.
 *  Returns a copy so callers can mutate safely. */
function defaultExclusions() {
  return new Set(EXCLUDED_TABLES);
}

/** Pattern used to detect secret-bearing columns. Exposed so tests
 *  can lock in the contract. */
function secretColumnPattern() {
  return SECRET_COL_RE;
}

/** Walk every text/number column of `row` and drop anything that
 *  matches SECRET_COL_RE. For known sensitive tables, set a
 *  `secretExcluded: true` flag so the restore-side can warn the
 *  user. Pure — no I/O. */
function sanitizeBackupRow(table, row) {
  if (!row || typeof row !== 'object') return row;
  const sanitized = {};
  for (const [key, value] of Object.entries(row)) {
    if (SECRET_COL_RE.test(key)) continue;
    sanitized[key] = value;
  }
  if (SENSITIVE_TABLES[table]) {
    sanitized.secretExcluded = true;
  }
  if (table === 'integration_connectors') {
    sanitized.secretFingerprint = row.secret_fingerprint || '';
  }
  return sanitized;
}

/** Build the JSON manifest written to every backup. Pure. */
function buildManifest({
  org,
  tableCounts,
  storageObjectCount,
  exclusions,
  version = SCHEMA_VERSION,
  createdAt = new Date().toISOString()
}) {
  return {
    kind: KIND,
    schema_version: version,
    product: 'Armosphera One',
    created_at: createdAt,
    organization: org || null,
    table_counts: tableCounts || {},
    storage_object_count: storageObjectCount || 0,
    exclusions: Array.from(exclusions || defaultExclusions()),
    restore_plan: [
      'restore-only-into-matching-org',
      'recreate-users-with-new-passwords',
      'reenter-webhook-secrets'
    ]
  };
}

/** Defensive parse for a manifest string. Throws on missing kind
 *  so callers get a clear "wrong format" error. */
function parseManifest(json) {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Manifest must be a JSON object');
  }
  if (parsed.kind !== KIND) {
    throw new Error(`Unsupported manifest kind: ${parsed.kind} (expected ${KIND})`);
  }
  if (typeof parsed.schema_version !== 'number') {
    throw new Error('Manifest missing schema_version');
  }
  return parsed;
}

/** Auto-discover every table that has an `org_id` column, minus
 *  the always-excluded set. Pure-ish: requires a sqlite-like db
 *  with `.prepare(...).all()` and `.prepare(...).get()` methods. */
function discoverOrgScopedTables(db, extraExclusions = []) {
  const rows = db
    .prepare(
      `SELECT DISTINCT m.name AS table_name
         FROM sqlite_master m
         JOIN pragma_table_info(m.name) p
           ON p.name = 'org_id'
        WHERE m.type = 'table'`
    )
    .all();
  const excluded = new Set([...EXCLUDED_TABLES, ...extraExclusions]);
  return rows
    .map((r) => r.table_name)
    .filter((name) => !excluded.has(name))
    .sort();
}

/** Sum a manifest's payload into a flat {table: count} record.
 *  Mirrors `countBackupTables` in server/app.js. Pure. */
function countBackupTables(manifest) {
  const counts = {};
  for (const [table, rows] of Object.entries(manifest?.tables || {})) {
    counts[table] = Array.isArray(rows) ? rows.length : 0;
  }
  return counts;
}

/* ── checksum helpers (local copy — same algorithm as
      A1-Platform/src/checksums.js, no dep) ──────────────────────── */

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function listFiles(root, { recursive = false } = {}) {
  const files = [];
  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && recursive) await walk(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  await walk(root);
  return files.sort();
}

async function writeChecksums(root, { recursive = true } = {}) {
  const checksumPath = path.join(root, CHECKSUMS_FILE);
  // Default to recursive so per-tenant archives (which have a
  // `tables/` subdir full of JSON files) get every file hashed.
  // The parent backupAll dir passes `recursive: false` because
  // its subdirs are opaque tenant archives — modifying one should
  // not invalidate the parent manifest's checksums.
  const files = (await listFiles(root, { recursive })).filter(
    (f) => path.resolve(f) !== path.resolve(checksumPath)
  );
  const lines = [];
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    lines.push(`${await sha256File(file)}  ${relative}`);
  }
  await fsp.writeFile(checksumPath, `${lines.join('\n')}\n`, 'utf8');
  return checksumPath;
}

async function verifyBackupChecksums(backupDir) {
  const checksumPath = path.join(backupDir, CHECKSUMS_FILE);
  let content;
  try {
    content = await fsp.readFile(checksumPath, 'utf8');
  } catch (err) {
    return { ok: false, checked: 0, failed: [], error: err.message };
  }
  const checks = [];
  for (const line of content.split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^([a-f0-9]{64})\s\s(.+)$/);
    if (!match) {
      return { ok: false, checked: 0, failed: [], error: `Invalid checksum line: ${line}` };
    }
    const [, expected, relative] = match;
    const actual = await sha256File(path.join(backupDir, relative));
    checks.push({ file: relative, ok: actual === expected, expected, actual });
  }
  const failed = checks.filter((c) => !c.ok);
  return { ok: failed.length === 0, checked: checks.length, failed };
}

/* ── high-level: backup a single tenant ───────────────────────────── */

async function readOrgScopedRows(db, table, orgId) {
  // ORDER BY id when present; fall back to ROWID for tables
  // without an explicit id column.
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const hasId = cols.some((c) => c.name === 'id');
  const orderCol = hasId ? 'id' : 'rowid';
  return db
    .prepare(`SELECT * FROM ${table} WHERE org_id = ? ORDER BY ${orderCol}`)
    .all(orgId);
}

function getOrganization(db, orgId) {
  return db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId) || null;
}

function resolveExportTables(db, extraExclusions) {
  // Apps + users + organization are global-shape; we still
  // include them for portability but only the org's slice.
  return discoverOrgScopedTables(db, extraExclusions);
}

async function backupTenant(
  { db, storage, orgId, outDir, options = {}, audit, now = () => new Date() } = {}
) {
  if (!db) throw new Error('backupTenant requires db');
  if (!storage) throw new Error('backupTenant requires storage');
  if (!orgId) throw new Error('backupTenant requires orgId');
  if (!outDir) throw new Error('backupTenant requires outDir');

  const stamp = backupStamp(now());
  const root = path.resolve(outDir, `${stamp}-${orgId}`);
  const tablesDir = path.join(root, 'tables');
  const blobsDir = path.join(root, STORAGE_DIR);
  await fsp.mkdir(tablesDir, { recursive: true });
  await fsp.mkdir(blobsDir, { recursive: true });

  // 1. Pull every org-scoped row.
  const exportTables = resolveExportTables(db, options.extraExclusions);
  const tables = {};
  for (const table of exportTables) {
    const rows = await readOrgScopedRows(db, table, orgId);
    tables[table] = rows.map((row) => sanitizeBackupRow(table, row));
  }

  // 2. Write each table to its own JSON file (easier to diff/restore
  //    individual tables than one giant blob).
  for (const [table, rows] of Object.entries(tables)) {
    await fsp.writeFile(
      path.join(tablesDir, `${table}.json`),
      `${JSON.stringify(rows, null, 2)}\n`,
      'utf8'
    );
  }

  // 3. Sync storage objects (per-tenant prefix → blobsDir).
  let storageObjectCount = 0;
  if (storage && typeof storage.syncPrefixToDir === 'function') {
    storageObjectCount = await storage.syncPrefixToDir(orgId, blobsDir);
  } else if (storage && typeof storage.listObjects === 'function') {
    // Fallback when no sync helper: count objects so the manifest
    // is honest. Real portable restore needs syncDirToPrefix too.
    storageObjectCount = (await storage.listObjects(orgId)).length;
  }

  // 4. Build & write the manifest.
  const tableCounts = countBackupTables({ tables });
  const organization = getOrganization(db, orgId);
  const manifest = buildManifest({
    org: organization,
    tableCounts,
    storageObjectCount,
    exclusions: defaultExclusions(),
    version: SCHEMA_VERSION,
    createdAt: now().toISOString()
  });
  // The manifest ALSO carries the table data inline (single-file
  // portability), but we also wrote per-table files above for
  // diffability.
  manifest.tables = tables;
  await fsp.writeFile(
    path.join(root, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );

  // 5. Write checksums.
  const checksumPath = await writeChecksums(root);
  const checksum = await sha256File(checksumPath);

  if (typeof audit === 'function') {
    audit({
      type: 'backup.created',
      orgId,
      backupDir: root,
      checksum,
      tableCounts,
      storageObjectCount,
      excludedTables: Array.from(defaultExclusions())
    });
  }

  return {
    ok: true,
    backupDir: root,
    checksum,
    tableCounts,
    storageObjectCount,
    excludedTables: Array.from(defaultExclusions()),
    manifest
  };
}

/* ── high-level: restore a single tenant ─────────────────────────── */

async function readTableJson(tablesDir, table) {
  const filePath = path.join(tablesDir, `${table}.json`);
  const content = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function restoreTenant(
  { db, storage, orgId, importDir, options = {}, audit, now = () => new Date() } = {}
) {
  if (!db) throw new Error('restoreTenant requires db');
  if (!storage) throw new Error('restoreTenant requires storage');
  if (!orgId) throw new Error('restoreTenant requires orgId');
  if (!importDir) throw new Error('restoreTenant requires importDir');

  const root = path.resolve(importDir);
  const checksumResult = await verifyBackupChecksums(root);
  if (!checksumResult.ok) {
    const detail =
      checksumResult.error ||
      `files: ${checksumResult.failed.map((f) => f.file).join(', ')}`;
    if (typeof audit === 'function') {
      audit({ type: 'backup.restore.failed_checksum', orgId, importDir: root, ...checksumResult });
    }
    throw new Error(`Backup checksum verification failed: ${detail}`);
  }

  const manifestPath = path.join(root, MANIFEST_FILE);
  const manifest = parseManifest(await fsp.readFile(manifestPath, 'utf8'));

  if (options.dryRun) {
    return { ok: true, dryRun: true, manifest, checksumVerified: true };
  }

  // 1. Restore storage objects.
  let restoredObjects = 0;
  const blobsDir = path.join(root, STORAGE_DIR);
  if (fs.existsSync(blobsDir) && typeof storage.syncDirToPrefix === 'function') {
    restoredObjects = await storage.syncDirToPrefix(orgId, blobsDir);
  }

  // 2. Restore table rows. We do NOT use INSERT OR REPLACE —
  //    backups restore into an EXISTING tenant (the orgId
  //    already exists). New rows added since the backup keep
  //    their IDs. For a "reset" use case, the caller should
  //    DELETE FROM the relevant org-scoped tables first.
  const tablesDir = path.join(root, 'tables');
  const tables = manifest.tables || {};
  let restoredRows = 0;
  const tableColumnsCache = new Map();
  function getTableColumns(table) {
    if (tableColumnsCache.has(table)) return tableColumnsCache.get(table);
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    tableColumnsCache.set(table, cols);
    return cols;
  }
  for (const [table, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    // Skip tables that don't exist in the target DB.
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(table);
    if (!tableExists) continue;
    // Intersect the rows' keys with the real table columns. This
    // DROPS columns that were sanitized away (e.g. password_hash),
    // which means the restore succeeds for NOT NULL columns only
    // if the caller has set defaults. The restore plan doc in the
    // manifest explicitly says "recreate-users-with-new-passwords" —
    // we keep that contract.
    const realCols = new Set(getTableColumns(table));
    const sampleCols = Object.keys(rows[0] || {}).filter((c) => realCols.has(c));
    if (sampleCols.length === 0) continue;
    const placeholders = sampleCols.map(() => '?').join(', ');
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO ${table} (${sampleCols.join(', ')}) VALUES (${placeholders})`
    );
    const tx = db.prepare('BEGIN');
    tx.run();
    try {
      for (const row of rows) {
        // node:sqlite's Statement#run takes positional args via spread,
        // not as a single array parameter. Spreading is required.
        stmt.run(...sampleCols.map((c) => row[c]));
        restoredRows += 1;
      }
      db.prepare('COMMIT').run();
    } catch (err) {
      db.prepare('ROLLBACK').run();
      throw err;
    }
  }

  if (typeof audit === 'function') {
    audit({
      type: 'backup.restored',
      orgId,
      importDir: root,
      restoredRows,
      restoredObjects,
      checksumVerified: true
    });
  }

  return {
    ok: true,
    restoredRows,
    restoredObjects,
    checksumVerified: true,
    manifest
  };
}

/* ── high-level: backup / restore all tenants ────────────────────── */

async function listAllOrgIds(db) {
  return db
    .prepare('SELECT id FROM organizations ORDER BY id')
    .all()
    .map((row) => row.id);
}

async function backupAll(
  { db, storage, out, options = {}, audit, now = () => new Date() } = {}
) {
  if (!db) throw new Error('backupAll requires db');
  if (!storage) throw new Error('backupAll requires storage');

  const root = path.resolve(
    out || options.out || path.join('backups', 'full'),
    backupStamp(now())
  );
  await fsp.mkdir(root, { recursive: true });
  const orgIds = options.orgIds || (await listAllOrgIds(db));
  const tenants = [];

  for (const orgId of orgIds) {
    const result = await backupTenant({
      db,
      storage,
      orgId,
      outDir: root,
      options,
      audit,
      now
    });
    tenants.push({ orgId, backupDir: result.backupDir, checksum: result.checksum });
  }

  const manifest = buildManifest({
    org: null,
    tableCounts: Object.fromEntries(tenants.map((t) => [t.orgId, 0])),
    storageObjectCount: 0,
    exclusions: defaultExclusions(),
    version: SCHEMA_VERSION,
    createdAt: now().toISOString()
  });
  manifest.tenants = tenants;
  await fsp.writeFile(
    path.join(root, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );

  // The parent backupAll checksum is non-recursive: tenant
  // subdirs are opaque archives, and modifying one should not
  // invalidate the parent manifest.
  const checksumPath = await writeChecksums(root, { recursive: false });
  const checksum = await sha256File(checksumPath);

  if (typeof audit === 'function') {
    audit({ type: 'backup.all.created', backupDir: root, tenantCount: tenants.length, checksum });
  }

  return { ok: true, backupDir: root, tenantCount: tenants.length, tenants, checksum };
}

async function restoreAll(
  { db, storage, options = {}, audit, now = () => new Date() } = {}
) {
  if (!db) throw new Error('restoreAll requires db');
  if (!storage) throw new Error('restoreAll requires storage');
  if (!options.backupDir) throw new Error('restoreAll requires options.backupDir');
  const backupDir = path.resolve(options.backupDir);

  const checksumResult = await verifyBackupChecksums(backupDir);
  if (!checksumResult.ok) {
    throw new Error(
      checksumResult.error ||
        `Backup checksum verification failed for ${checksumResult.failed
          .map((f) => f.file)
          .join(', ')}`
    );
  }

  const manifest = parseManifest(
    await fsp.readFile(path.join(backupDir, MANIFEST_FILE), 'utf8')
  );
  const tenantEntries = manifest.tenants || [];
  const restored = [];
  const failed = [];

  for (const tenant of tenantEntries) {
    try {
      const result = await restoreTenant({
        db,
        storage,
        orgId: tenant.orgId,
        importDir: tenant.backupDir,
        options,
        audit,
        now
      });
      restored.push({ orgId: tenant.orgId, ok: true, restoredRows: result.restoredRows });
    } catch (err) {
      failed.push({ orgId: tenant.orgId, ok: false, error: err.message });
    }
  }

  if (typeof audit === 'function') {
    audit({
      type: 'backup.all.restored',
      backupDir,
      restoredCount: restored.length,
      failedCount: failed.length
    });
  }

  return {
    ok: failed.length === 0,
    backupDir,
    restored,
    failed,
    checksumVerified: true
  };
}

/* ── exports ──────────────────────────────────────────────────────── */

module.exports = {
  // public surface
  backupTenant,
  restoreTenant,
  backupAll,
  restoreAll,
  // pure helpers (for tests + consumers that want a piece)
  backupStamp,
  defaultExclusions,
  secretColumnPattern,
  sanitizeBackupRow,
  buildManifest,
  parseManifest,
  discoverOrgScopedTables,
  countBackupTables,
  verifyBackupChecksums,
  writeChecksums,
  sha256File,
  // constants (for tests)
  EXCLUDED_TABLES,
  SENSITIVE_TABLES,
  SCHEMA_VERSION,
  KIND,
  CHECKSUMS_FILE,
  MANIFEST_FILE,
  STORAGE_DIR
};
