/**
 * backup-archive-routes.js — thin Fastify routes for the
 * filesystem-based tenant backup engine (server/lib/backup-restore.js).
 *
 * Endpoints:
 *   POST /api/admin/backup-archives
 *     body: { orgId?: string, outDir?: string, requireProductImports?: boolean }
 *     — owner-only. Creates a portable archive for the org (or
 *       ALL orgs if no orgId is given). Returns the manifest
 *       summary + checksum.
 *
 *   POST /api/admin/backup-archives/restore
 *     body: { backupDir: string, orgId: string, activate?: boolean, dryRun?: boolean }
 *     — owner-only. Restores a single org from a portable archive.
 *       The archive's checksums are verified first; tampering
 *       causes a 422 response. The org row must already exist
 *       in the target DB (the engine does not create it).
 *
 *   GET /api/admin/backup-archives/inspect?backupDir=...
 *     — owner-only. Returns the archive's manifest + checksum
 *       verification result without touching the DB. Useful for
 *       pre-flight checks before restore.
 *
 * The thin-route contract: parse, validate, call the engine, return
 * the engine's result. All I/O and policy is in backup-restore.js.
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');

const { createStorage } = require('./lib/storage');
const {
  backupTenant,
  restoreTenant,
  verifyBackupChecksums,
  parseManifest,
  MANIFEST_FILE
} = require('./lib/backup-restore');

/* ── defaults ──────────────────────────────────────────────────────── */

const DEFAULT_BUCKET = 'a1-documents';
// Archives live under <stateDir>/backups by default. Operators
// can override via options.outDir on the POST.
function defaultArchiveRoot(stateDir) {
  return path.join(stateDir || process.cwd(), 'backups', 'archives');
}

/* ── route registration ───────────────────────────────────────────── */

function registerBackupArchiveRoutes(app, { db, requireOwner, audit, fsp, stateDir }) {
  // Lazy storage factory. We do NOT cache across requests — the
  // local driver is cheap and this keeps the route file
  // side-effect free for tests.
  function getStorage(rootDir) {
    return createStorage({
      driver: 'local',
      root: rootDir,
      bucket: DEFAULT_BUCKET
    });
  }

  function rootDir() {
    return defaultArchiveRoot(stateDir);
  }

  /* ── create archive ──────────────────────────────────────────────── */

  app.post('/api/admin/backup-archives', async request => {
    const user = await app.auth(request);
    requireOwner(user);
    const body = request.body || {};
    const storage = getStorage(rootDir());

    if (body.orgId) {
      // Single-tenant archive.
      const result = await backupTenant({
        db,
        storage,
        orgId: String(body.orgId),
        outDir: body.outDir || rootDir(),
        options: { extraExclusions: body.extraExclusions || [] },
        audit
      });
      return { ok: true, archive: result };
    }

    // Multi-tenant: iterate every org in the DB.
    const orgIds = db
      .prepare('SELECT id FROM organizations ORDER BY id')
      .all()
      .map((row) => row.id);
    const archives = [];
    for (const orgId of orgIds) {
      const r = await backupTenant({
        db,
        storage,
        orgId,
        outDir: body.outDir || rootDir(),
        options: { extraExclusions: body.extraExclusions || [] },
        audit
      });
      archives.push({ orgId, backupDir: r.backupDir, checksum: r.checksum });
    }
    return { ok: true, archives };
  });

  /* ── restore ─────────────────────────────────────────────────────── */

  app.post('/api/admin/backup-archives/restore', async request => {
    const user = await app.auth(request);
    requireOwner(user);
    const body = request.body || {};
    if (!body.backupDir) {
      const err = new Error('backupDir is required');
      err.statusCode = 400;
      throw err;
    }
    if (!body.orgId) {
      const err = new Error('orgId is required');
      err.statusCode = 400;
      throw err;
    }
    const storage = getStorage(rootDir());
    const result = await restoreTenant({
      db,
      storage,
      orgId: String(body.orgId),
      importDir: String(body.backupDir),
      options: { dryRun: Boolean(body.dryRun) },
      audit
    });
    return { ok: true, restore: result };
  });

  /* ── inspect (no DB writes) ──────────────────────────────────────── */

  app.get('/api/admin/backup-archives/inspect', async request => {
    const user = await app.auth(request);
    requireOwner(user);
    const backupDir = String(request.query?.backupDir || '');
    if (!backupDir) {
      const err = new Error('backupDir query parameter is required');
      err.statusCode = 400;
      throw err;
    }
    const abs = path.resolve(backupDir);
    if (!fs.existsSync(abs)) {
      const err = new Error(`backupDir does not exist: ${abs}`);
      err.statusCode = 404;
      throw err;
    }
    const checksums = await verifyBackupChecksums(abs);
    let manifest = null;
    let manifestError = null;
    try {
      const json = await fsp.readFile(path.join(abs, MANIFEST_FILE), 'utf8');
      manifest = parseManifest(json);
    } catch (err) {
      manifestError = err.message;
    }
    return {
      ok: checksums.ok && !manifestError,
      backupDir: abs,
      checksums,
      manifest,
      manifestError
    };
  });
}

module.exports = { registerBackupArchiveRoutes, defaultArchiveRoot };
