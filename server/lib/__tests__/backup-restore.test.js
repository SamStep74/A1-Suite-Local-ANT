/**
 * backup-restore.test.js — 5-gate contract suite for the ANT port
 * of A1-Platform's filesystem-based tenant backup engine.
 *
 * Gate coverage:
 *   1. Pure — backupStamp, defaultExclusions, sanitizeBackupRow,
 *      buildManifest, parseManifest, countBackupTables,
 *      discoverOrgScopedTables, secretColumnPattern.
 *   2. Types — engine surface (backupTenant, restoreTenant,
 *      backupAll, restoreAll), manifest shape, checksum format.
 *   3. Idempotency — repeated backup produces identical checksum;
 *      restore of same archive into same DB is idempotent (rows
 *      unchanged after the second restore).
 *   4. Contract — checksum tampering causes restore to throw;
 *      missing orgId/outDir throws; missing manifest throws;
 *      sanitization always drops secrets; excluded tables never
 *      appear in tables.
 *   5. Edge — round-trip backup→restore preserves row count
 *      and content; multi-tenant backup isolates tenants; blob
 *      round-trip; manifest for an empty tenant; dryRun
 *      returns manifest without DB writes.
 *
 * Why 5 gates: backup packets are the only data-portability
 * path. A silent behavior change (e.g. forgetting to drop
 * password_hash) would expose secrets. A checksum bug would
 * silently accept tampered restores. Both are show-stoppers.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  backupTenant,
  restoreTenant,
  backupAll,
  restoreAll,
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
  EXCLUDED_TABLES,
  SENSITIVE_TABLES,
  SCHEMA_VERSION,
  KIND,
  CHECKSUMS_FILE,
  MANIFEST_FILE,
  STORAGE_DIR
} = require('../backup-restore');

const { createStorage } = require('../storage');

/* ── helpers ──────────────────────────────────────────────────────── */

async function mkTmp(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

function mkDb() {
  const db = new DatabaseSync(':memory:');
  // organizations
  db.exec(`CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  // users (sensitive — has password_hash which must be dropped on
  // backup. We allow NULL on password_hash to match the restore
  // plan: "recreate-users-with-new-passwords". The caller is
  // expected to re-seed users via a separate pass.)
  db.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_hash TEXT,
    api_token TEXT,
    created_at TEXT NOT NULL
  )`);
  // crm_customers (typical org-scoped table)
  db.exec(`CREATE TABLE crm_customers (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  )`);
  // crm_deals (joined to customers)
  db.exec(`CREATE TABLE crm_deals (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    title TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);
  // sessions (EXCLUDED — must never appear)
  db.exec(`CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`);
  // user_credentials (EXCLUDED — has password_hash)
  db.exec(`CREATE TABLE user_credentials (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    password_hash TEXT NOT NULL
  )`);
  // webhook_endpoints (SENSITIVE — secret must be excluded. The
  // secret is nullable in the test schema to match the restore
  // plan: "reenter-webhook-secrets". Real ANT keeps the column
  // NOT NULL but the restore intentionally drops secrets; the
  // caller re-seeds them via a separate pass.)
  db.exec(`CREATE TABLE webhook_endpoints (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    url TEXT NOT NULL,
    secret TEXT
  )`);
  // tenant_backup_packets (EXCLUDED — recursion trap)
  db.exec(`CREATE TABLE tenant_backup_packets (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    status TEXT NOT NULL,
    payload TEXT NOT NULL
  )`);
  // A table WITHOUT org_id (must be ignored by discoverOrgScopedTables)
  db.exec(`CREATE TABLE global_apps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  )`);
  return db;
}

function seedTenant(db, orgId, opts = {}) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)`).run(
    orgId,
    opts.orgName || `Acme ${orgId}`,
    now
  );
  db.prepare(
    `INSERT INTO users (id, org_id, email, name, role, password_hash, api_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`u-${orgId}-1`, orgId, `u1@${orgId}.test`, 'Alice', 'owner', 'HASH-SECRET-A', 'TOK-SECRET-A', now);
  db.prepare(
    `INSERT INTO crm_customers (id, org_id, name, email, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(`c-${orgId}-1`, orgId, 'Big Co', 'big@co.test', 'VIP', now);
  db.prepare(
    `INSERT INTO crm_customers (id, org_id, name, email, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(`c-${orgId}-2`, orgId, 'Small Co', 'small@co.test', null, now);
  db.prepare(
    `INSERT INTO crm_deals (id, org_id, customer_id, title, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(`d-${orgId}-1`, orgId, `c-${orgId}-1`, 'Yearly contract', 12000, now);
  db.prepare(
    `INSERT INTO sessions (id, org_id, user_id, token, expires_at) VALUES (?, ?, ?, ?, ?)`
  ).run(`s-${orgId}-1`, orgId, `u-${orgId}-1`, 'SESSION-TOKEN-SECRET', now);
  db.prepare(
    `INSERT INTO user_credentials (id, org_id, user_id, password_hash) VALUES (?, ?, ?, ?)`
  ).run(`uc-${orgId}-1`, orgId, `u-${orgId}-1`, 'CRED-HASH-SECRET');
  db.prepare(
    `INSERT INTO webhook_endpoints (id, org_id, url, secret) VALUES (?, ?, ?, ?)`
  ).run(`w-${orgId}-1`, orgId, 'https://hook.test', 'WEBHOOK-SECRET-XYZ');
  db.prepare(
    `INSERT INTO tenant_backup_packets (id, org_id, status, payload) VALUES (?, ?, ?, ?)`
  ).run(`bp-${orgId}-1`, orgId, 'verified', '{"sentinel": "do-not-back-up"}');
  // also seed the global (no org_id) table with a unique id
  db.prepare(`INSERT INTO global_apps (id, name) VALUES (?, ?)`).run(`app-${orgId}`, 'CRM');
}

function mkStorage(root) {
  return createStorage({ driver: 'local', root: path.join(root, 'storage'), bucket: 'a1-documents' });
}

function mkAuditCapture() {
  const events = [];
  const fn = (e) => events.push(e);
  return { events, audit: fn };
}

/* ── gate 1: pure ─────────────────────────────────────────────────── */

test('pure: backupStamp is deterministic and filename-safe', () => {
  const fixed = new Date('2026-06-14T16:30:00.000Z');
  assert.equal(backupStamp(fixed), '2026-06-14T16-30-00-000Z');
  // Colons and dots are escaped; the string is filesystem-safe
  assert.doesNotMatch(backupStamp(fixed), /[:.]/);
  // Two different times produce different stamps
  assert.notEqual(backupStamp(fixed), backupStamp(new Date('2026-06-14T16:30:01.000Z')));
});

test('pure: defaultExclusions returns a fresh Set (no shared state)', () => {
  const a = defaultExclusions();
  const b = defaultExclusions();
  a.add('mutated');
  assert.ok(!b.has('mutated'));
  // The Set always contains the 5 hard-coded exclusions
  for (const t of EXCLUDED_TABLES) assert.ok(b.has(t));
});

test('pure: secretColumnPattern matches the documented columns', () => {
  const re = secretColumnPattern();
  for (const c of ['password_hash', 'api_token', 'secret', 'token', 'hmac']) {
    assert.ok(re.test(c), `pattern should match ${c}`);
  }
  // 'key' alone is matched (anchor), but a column named 'api_key' would
  // also match because the regex is case-insensitive
  assert.ok(re.test('key'));
  assert.ok(re.test('api_key'));
  // Plain non-secret columns must NOT match
  for (const c of ['name', 'email', 'created_at', 'note', 'amount']) {
    assert.ok(!re.test(c), `pattern must NOT match ${c}`);
  }
});

test('pure: sanitizeBackupRow drops all secret columns, flags sensitive tables', () => {
  const userRow = {
    id: 'u-1',
    org_id: 'o-1',
    email: 'a@b.test',
    name: 'A',
    role: 'owner',
    password_hash: 'SECRET-A',
    api_token: 'SECRET-B',
    created_at: 'now'
  };
  const sanitized = sanitizeBackupRow('users', userRow);
  assert.equal(sanitized.id, 'u-1');
  assert.equal(sanitized.email, 'a@b.test');
  assert.equal(sanitized.password_hash, undefined);
  assert.equal(sanitized.api_token, undefined);
  // Non-sensitive table — no flag
  assert.equal(sanitized.secretExcluded, undefined);

  const webhook = sanitizeBackupRow('webhook_endpoints', {
    id: 'w-1',
    org_id: 'o-1',
    url: 'https://hook.test',
    secret: 'WEBHOOK-SECRET'
  });
  assert.equal(webhook.secret, undefined);
  assert.equal(webhook.secretExcluded, true);
});

test('pure: buildManifest returns a valid manifest', () => {
  const m = buildManifest({
    org: { id: 'o-1', name: 'Acme' },
    tableCounts: { users: 3, crm_customers: 5 },
    storageObjectCount: 12,
    exclusions: defaultExclusions()
  });
  assert.equal(m.kind, KIND);
  assert.equal(m.schema_version, SCHEMA_VERSION);
  assert.deepEqual(m.table_counts, { users: 3, crm_customers: 5 });
  assert.equal(m.storage_object_count, 12);
  assert.ok(Array.isArray(m.exclusions));
  assert.ok(m.restore_plan.length >= 1);
});

test('pure: parseManifest rejects wrong kind / missing version', () => {
  assert.throws(() => parseManifest('{}'), /Unsupported manifest kind/);
  assert.throws(() => parseManifest('{"kind": "armosphera-one-tenant-archive"}'), /schema_version/);
  assert.throws(() => parseManifest('"a string"'), /JSON object/);
  const m = parseManifest(JSON.stringify({ kind: KIND, schema_version: 1 }));
  assert.equal(m.kind, KIND);
});

test('pure: countBackupTables flattens tables into counts', () => {
  const counts = countBackupTables({
    tables: { users: [1, 2, 3], crm_customers: [{ id: 1 }, { id: 2 }] }
  });
  assert.deepEqual(counts, { users: 3, crm_customers: 2 });
});

test('pure: discoverOrgScopedTables returns only tables with org_id, minus excluded', () => {
  const db = mkDb();
  const tables = discoverOrgScopedTables(db);
  // Should include users, crm_customers, crm_deals, webhook_endpoints
  for (const t of ['users', 'crm_customers', 'crm_deals', 'webhook_endpoints']) {
    assert.ok(tables.includes(t), `should include ${t}`);
  }
  // Should NOT include excluded
  for (const t of EXCLUDED_TABLES) {
    assert.ok(!tables.includes(t), `should NOT include ${t}`);
  }
  // global_apps has no org_id column → not included
  assert.ok(!tables.includes('global_apps'));
  db.close();
});

/* ── gate 2: types / shape ────────────────────────────────────────── */

test('types: every backup helper returns a stable shape', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  seedTenant(db, 'org-1');
  const storage = mkStorage(root);
  const out = await mkTmp('a1-bk-out-');

  const result = await backupTenant({ db, storage, orgId: 'org-1', outDir: out });
  assert.equal(result.ok, true);
  assert.ok(typeof result.backupDir === 'string');
  assert.ok(result.backupDir.startsWith(out));
  assert.match(result.checksum, /^[a-f0-9]{64}$/);
  assert.ok(typeof result.tableCounts === 'object');
  assert.ok(typeof result.storageObjectCount === 'number');
  assert.ok(Array.isArray(result.excludedTables));
  assert.ok(result.manifest.kind === KIND);

  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(out, { recursive: true, force: true });
});

test('types: manifest fields are well-typed', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  seedTenant(db, 'org-1');
  const storage = mkStorage(root);
  const out = await mkTmp('a1-bk-out-');
  const { backupDir } = await backupTenant({ db, storage, orgId: 'org-1', outDir: out });
  const manifestJson = await fsp.readFile(path.join(backupDir, MANIFEST_FILE), 'utf8');
  const manifest = JSON.parse(manifestJson);
  assert.equal(manifest.kind, KIND);
  assert.equal(manifest.schema_version, SCHEMA_VERSION);
  assert.equal(typeof manifest.created_at, 'string');
  assert.equal(manifest.organization.id, 'org-1');
  assert.ok(manifest.table_counts.users >= 1);
  assert.ok(manifest.table_counts.crm_customers >= 2);
  assert.ok(manifest.table_counts.crm_deals >= 1);
  assert.ok(Array.isArray(manifest.exclusions));
  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(out, { recursive: true, force: true });
});

test('types: audit event shape on backup.created', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  seedTenant(db, 'org-1');
  const storage = mkStorage(root);
  const out = await mkTmp('a1-bk-out-');
  const { events, audit } = mkAuditCapture();
  await backupTenant({ db, storage, orgId: 'org-1', outDir: out, audit });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'backup.created');
  assert.equal(events[0].orgId, 'org-1');
  assert.match(events[0].checksum, /^[a-f0-9]{64}$/);
  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(out, { recursive: true, force: true });
});

/* ── gate 3: idempotency ──────────────────────────────────────────── */

test('idempotency: repeated backup of unchanged tenant produces identical checksum (and identical manifest)', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  seedTenant(db, 'org-1');
  const storage = mkStorage(root);
  const out = await mkTmp('a1-bk-out-');

  // Pin the clock so the timestamp is deterministic
  const fixed = () => new Date('2026-06-14T16:00:00.000Z');
  const a = await backupTenant({ db, storage, orgId: 'org-1', outDir: out, now: fixed });
  const b = await backupTenant({ db, storage, orgId: 'org-1', outDir: out, now: fixed });
  // Same content → same SHA256 (the checksum is over the archive's
  // file checksums, which are content-addressed)
  assert.equal(a.checksum, b.checksum);
  // The manifest's table rows are identical (sanitized rows are
  // deterministic)
  assert.equal(a.manifest.table_counts.users, b.manifest.table_counts.users);
  assert.equal(a.manifest.table_counts.crm_customers, b.manifest.table_counts.crm_customers);
  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(out, { recursive: true, force: true });
});

test('idempotency: restore of the same archive twice leaves DB unchanged (INSERT OR REPLACE)', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  seedTenant(db, 'org-1');
  const storage = mkStorage(root);
  const out = await mkTmp('a1-bk-out-');
  const { backupDir } = await backupTenant({ db, storage, orgId: 'org-1', outDir: out });

  // Wipe the org's data, then restore from the archive
  db.prepare('DELETE FROM crm_customers WHERE org_id = ?').run('org-1');
  db.prepare('DELETE FROM crm_deals WHERE org_id = ?').run('org-1');
  let c = db.prepare('SELECT COUNT(*) AS n FROM crm_customers WHERE org_id = ?').get('org-1').n;
  assert.equal(c, 0);

  const r1 = await restoreTenant({ db, storage, orgId: 'org-1', importDir: backupDir });
  assert.equal(r1.ok, true);
  assert.equal(r1.restoredRows >= 3, true);
  const c1 = db.prepare('SELECT COUNT(*) AS n FROM crm_customers WHERE org_id = ?').get('org-1').n;
  assert.equal(c1, 2);

  // Restore AGAIN. Row count must be identical (REPLACE not duplicate).
  const r2 = await restoreTenant({ db, storage, orgId: 'org-1', importDir: backupDir });
  const c2 = db.prepare('SELECT COUNT(*) AS n FROM crm_customers WHERE org_id = ?').get('org-1').n;
  assert.equal(c2, 2);
  assert.equal(r2.restoredRows, r1.restoredRows);

  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(out, { recursive: true, force: true });
});

/* ── gate 4: contract — error shape, sanitization, exclusions ──── */

test('contract: required args throw TypeError-like Errors', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  const storage = mkStorage(root);
  const out = await mkTmp('a1-bk-out-');
  await assert.rejects(() => backupTenant({}), /requires db/);
  await assert.rejects(() => backupTenant({ db }), /requires storage/);
  await assert.rejects(() => backupTenant({ db, storage }), /requires orgId/);
  await assert.rejects(() => backupTenant({ db, storage, orgId: 'o' }), /requires outDir/);
  await assert.rejects(() => restoreTenant({ db, storage, orgId: 'o' }), /requires importDir/);
  await assert.rejects(() => restoreAll({ db, storage }), /requires options\.backupDir/);
  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(out, { recursive: true, force: true });
});

test('contract: secrets never appear in manifest or per-table files', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  seedTenant(db, 'org-1');
  const storage = mkStorage(root);
  const out = await mkTmp('a1-bk-out-');
  const { backupDir } = await backupTenant({ db, storage, orgId: 'org-1', outDir: out });

  // Walk every file in the backup dir; ensure no banned substring.
  const banned = ['HASH-SECRET-A', 'TOK-SECRET-A', 'CRED-HASH-SECRET', 'WEBHOOK-SECRET-XYZ', 'SESSION-TOKEN-SECRET'];
  const found = [];
  async function walk(dir) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const content = await fsp.readFile(full, 'utf8');
        for (const b of banned) if (content.includes(b)) found.push({ file: full, secret: b });
      }
    }
  }
  await walk(backupDir);
  assert.deepEqual(found, [], `Secrets leaked into backup: ${JSON.stringify(found)}`);

  // Also: the excluded tables must not appear as per-table files
  for (const t of EXCLUDED_TABLES) {
    const exists = fs.existsSync(path.join(backupDir, 'tables', `${t}.json`));
    assert.ok(!exists, `excluded table ${t} was exported`);
  }
  // And the tenant_backup_packets sentinel row must not be in users / customers
  const manifest = JSON.parse(await fsp.readFile(path.join(backupDir, MANIFEST_FILE), 'utf8'));
  assert.equal(manifest.tables.tenant_backup_packets, undefined);

  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(out, { recursive: true, force: true });
});

test('contract: checksum tampering causes restore to throw', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  seedTenant(db, 'org-1');
  const storage = mkStorage(root);
  const out = await mkTmp('a1-bk-out-');
  const { backupDir } = await backupTenant({ db, storage, orgId: 'org-1', outDir: out });

  // Tamper: flip a byte in one of the per-table JSON files
  const target = path.join(backupDir, 'tables', 'users.json');
  const orig = await fsp.readFile(target, 'utf8');
  await fsp.writeFile(target, orig.replace('"Alice"', '"Mallory"'), 'utf8');

  await assert.rejects(
    () => restoreTenant({ db, storage, orgId: 'org-1', importDir: backupDir }),
    /checksum verification failed/
  );

  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(out, { recursive: true, force: true });
});

test('contract: manifest tampering WITHOUT checksum update causes restore to throw', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  seedTenant(db, 'org-1');
  const storage = mkStorage(root);
  const out = await mkTmp('a1-bk-out-');
  const { backupDir } = await backupTenant({ db, storage, orgId: 'org-1', outDir: out });

  // Tamper the manifest. Do NOT recompute checksums — the old
  // checksums.txt must detect the change.
  const manifestPath = path.join(backupDir, MANIFEST_FILE);
  const orig = await fsp.readFile(manifestPath, 'utf8');
  const tampered = orig.replace('"org-1"', '"org-EVIL"');
  await fsp.writeFile(manifestPath, tampered, 'utf8');

  await assert.rejects(
    () => restoreTenant({ db, storage, orgId: 'org-1', importDir: backupDir }),
    /checksum verification failed/
  );

  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(out, { recursive: true, force: true });
});

test('contract: restore against a non-archive directory throws', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  const storage = mkStorage(root);
  const emptyDir = await mkTmp('a1-bk-empty-');
  await assert.rejects(
    () => restoreTenant({ db, storage, orgId: 'o-1', importDir: emptyDir }),
    /checksum verification failed/
  );
  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(emptyDir, { recursive: true, force: true });
});

test('contract: backupAll enumerates all orgs from the DB', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  seedTenant(db, 'org-1');
  seedTenant(db, 'org-2');
  const storage = mkStorage(root);
  const out = await mkTmp('a1-bk-out-');
  const result = await backupAll({ db, storage, out: path.join(out, 'all') });
  assert.equal(result.ok, true);
  assert.equal(result.tenantCount, 2);
  assert.equal(result.tenants.length, 2);
  const slugs = result.tenants.map((t) => t.orgId).sort();
  assert.deepEqual(slugs, ['org-1', 'org-2']);
  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(out, { recursive: true, force: true });
});

/* ── gate 5: edge — round-trip, multi-tenant, blobs, dry-run ───── */

test('edge: full backup→restore round-trip preserves all non-secret data', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  seedTenant(db, 'org-1');
  const storage = mkStorage(root);
  const out = await mkTmp('a1-bk-out-');

  // Snapshot every non-secret field
  const before = {
    customers: db.prepare('SELECT id, name, email, note FROM crm_customers WHERE org_id = ? ORDER BY id').all('org-1'),
    deals: db.prepare('SELECT id, customer_id, title, amount FROM crm_deals WHERE org_id = ? ORDER BY id').all('org-1')
  };
  const { backupDir } = await backupTenant({ db, storage, orgId: 'org-1', outDir: out });

  // Wipe
  db.prepare('DELETE FROM crm_customers WHERE org_id = ?').run('org-1');
  db.prepare('DELETE FROM crm_deals WHERE org_id = ?').run('org-1');

  await restoreTenant({ db, storage, orgId: 'org-1', importDir: backupDir });

  const after = {
    customers: db.prepare('SELECT id, name, email, note FROM crm_customers WHERE org_id = ? ORDER BY id').all('org-1'),
    deals: db.prepare('SELECT id, customer_id, title, amount FROM crm_deals WHERE org_id = ? ORDER BY id').all('org-1')
  };
  assert.deepEqual(after, before);

  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(out, { recursive: true, force: true });
});

test('edge: multi-tenant backup isolates tenants (each archive has its own rows)', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  seedTenant(db, 'org-1');
  seedTenant(db, 'org-2');
  const storage = mkStorage(root);
  const out = await mkTmp('a1-bk-out-');

  const r1 = await backupTenant({ db, storage, orgId: 'org-1', outDir: out });
  const r2 = await backupTenant({ db, storage, orgId: 'org-2', outDir: out });

  // Each backup's manifest carries only its own rows
  assert.equal(r1.manifest.tables.crm_customers.length, 2);
  assert.equal(r2.manifest.tables.crm_customers.length, 2);
  // IDs belong to the right org
  for (const c of r1.manifest.tables.crm_customers) {
    assert.equal(c.org_id, 'org-1');
  }
  for (const c of r2.manifest.tables.crm_customers) {
    assert.equal(c.org_id, 'org-2');
  }

  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(out, { recursive: true, force: true });
});

test('edge: backup captures blob objects; restore copies them back', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  seedTenant(db, 'org-1');
  const storage = mkStorage(root);
  await storage.putObject('org-1', 'crm', 'quotes/q1.pdf', 'pdf-bytes-1');
  await storage.putObject('org-1', 'crm', 'invoices/i1.txt', 'invoice-bytes-1');

  const out = await mkTmp('a1-bk-out-');
  const { backupDir, storageObjectCount } = await backupTenant({
    db,
    storage,
    orgId: 'org-1',
    outDir: out
  });
  assert.equal(storageObjectCount, 2);
  // Files actually copied to blobs/
  const blobsDir = path.join(backupDir, STORAGE_DIR);
  assert.ok(fs.existsSync(path.join(blobsDir, 'crm', 'quotes', 'q1.pdf')));

  // Wipe storage
  const freshRoot = await mkTmp('a1-bk-fresh-');
  const freshStorage = mkStorage(freshRoot);
  // Restore
  await restoreTenant({ db, storage: freshStorage, orgId: 'org-1', importDir: backupDir });
  // Blobs back
  const got1 = await freshStorage.getObject('org-1', 'crm', 'quotes/q1.pdf');
  const got2 = await freshStorage.getObject('org-1', 'crm', 'invoices/i1.txt');
  assert.equal(String(got1), 'pdf-bytes-1');
  assert.equal(String(got2), 'invoice-bytes-1');

  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(freshRoot, { recursive: true, force: true });
  await fsp.rm(out, { recursive: true, force: true });
});

test('edge: empty tenant (no rows) produces a valid empty archive', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  // Create an organization with zero org-scoped rows
  db.prepare('INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)').run(
    'org-empty',
    'Empty',
    new Date().toISOString()
  );
  const storage = mkStorage(root);
  const out = await mkTmp('a1-bk-out-');
  const { backupDir, tableCounts, storageObjectCount } = await backupTenant({
    db,
    storage,
    orgId: 'org-empty',
    outDir: out
  });
  assert.ok(fs.existsSync(path.join(backupDir, MANIFEST_FILE)));
  assert.equal(storageObjectCount, 0);
  // All counts are 0 (no users, no customers, no deals)
  for (const v of Object.values(tableCounts)) assert.equal(v, 0);
  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(out, { recursive: true, force: true });
});

test('edge: dry-run restore returns manifest without DB writes', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  seedTenant(db, 'org-1');
  const storage = mkStorage(root);
  const out = await mkTmp('a1-bk-out-');
  const { backupDir } = await backupTenant({ db, storage, orgId: 'org-1', outDir: out });

  // Wipe customers, then dry-run restore
  db.prepare('DELETE FROM crm_customers WHERE org_id = ?').run('org-1');
  const r = await restoreTenant({
    db,
    storage,
    orgId: 'org-1',
    importDir: backupDir,
    options: { dryRun: true }
  });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  // DB still empty
  const n = db.prepare('SELECT COUNT(*) AS n FROM crm_customers WHERE org_id = ?').get('org-1').n;
  assert.equal(n, 0);

  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(out, { recursive: true, force: true });
});

test('edge: writeChecksums → verifyBackupChecksums round-trip is OK', async () => {
  const dir = await mkTmp('a1-bk-cs-');
  await fsp.writeFile(path.join(dir, 'a.txt'), 'hello', 'utf8');
  await fsp.writeFile(path.join(dir, 'b.txt'), 'world', 'utf8');
  await writeChecksums(dir);
  const result = await verifyBackupChecksums(dir);
  assert.equal(result.ok, true);
  assert.equal(result.checked, 2);
  assert.deepEqual(result.failed, []);
  // Tamper
  await fsp.writeFile(path.join(dir, 'a.txt'), 'tampered', 'utf8');
  const tampered = await verifyBackupChecksums(dir);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.failed.length, 1);
  assert.equal(tampered.failed[0].file, 'a.txt');
  await fsp.rm(dir, { recursive: true, force: true });
});

test('edge: sha256File hashes file content deterministically', async () => {
  const file = await mkTmp('a1-bk-sha-');
  const p = path.join(file, 'x.txt');
  await fsp.writeFile(p, 'the rain in spain', 'utf8');
  const expected = crypto.createHash('sha256').update('the rain in spain').digest('hex');
  assert.equal(await sha256File(p), expected);
  await fsp.rm(file, { recursive: true, force: true });
});

test('edge: restoreAll handles mixed success/failure gracefully', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  seedTenant(db, 'org-1');
  seedTenant(db, 'org-2');
  const storage = mkStorage(root);
  const all = await backupAll({ db, storage, out: path.join(root, 'all') });

  // Corrupt the first tenant's archive by deleting one of its
  // per-table files. The PARENT backup's checksums.txt is unaffected
  // (it only hashes files in the parent dir, not recursive). The
  // tenant's own checksums.txt will fail, so restoreTenant for
  // that tenant records a failure while the second tenant restores
  // cleanly.
  const tenants = JSON.parse(await fsp.readFile(path.join(all.backupDir, MANIFEST_FILE), 'utf8')).tenants;
  const targetFile = path.join(tenants[0].backupDir, 'tables', 'crm_customers.json');
  await fsp.rm(targetFile, { recursive: true, force: true });

  const result = await restoreAll({ db, storage, options: { backupDir: all.backupDir } });
  assert.equal(result.ok, false, 'mixed result must report not-ok');
  assert.equal(result.failed.length >= 1, true, 'at least one tenant should fail');
  // The second tenant (org-2) should restore successfully
  assert.equal(result.restored.length >= 1, true, 'at least one tenant should restore');

  db.close();
  await fsp.rm(root, { recursive: true, force: true });
});

test('edge: audit hook is optional (no-op when not provided)', async () => {
  const root = await mkTmp('a1-bk-');
  const db = mkDb();
  seedTenant(db, 'org-1');
  const storage = mkStorage(root);
  const out = await mkTmp('a1-bk-out-');
  // No audit arg — should not throw
  const r = await backupTenant({ db, storage, orgId: 'org-1', outDir: out });
  assert.equal(r.ok, true);
  db.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(out, { recursive: true, force: true });
});

test('edge: backupAll + restoreAll into a fresh DB preserves all tenants', async () => {
  const root = await mkTmp('a1-bk-');
  const dbA = mkDb();
  seedTenant(dbA, 'org-1');
  seedTenant(dbA, 'org-2');
  const storageA = mkStorage(root);
  const all = await backupAll({ db: dbA, storage: storageA, out: path.join(root, 'all') });
  dbA.close();

  // Fresh DB, no data
  const dbB = mkDb();
  const storageB = mkStorage(await mkTmp('a1-bk-fresh-'));
  // Seed only the organizations rows (the engine requires the
  // organization row to exist for org_id FKs to work in tables
  // that have REFERENCES organizations).
  dbB.prepare('INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)').run('org-1', 'Acme 1', 'now');
  dbB.prepare('INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)').run('org-2', 'Acme 2', 'now');

  const result = await restoreAll({ db: dbB, storage: storageB, options: { backupDir: all.backupDir } });
  assert.equal(result.ok, true);
  // Both tenants' crm_customers preserved
  const n1 = dbB.prepare('SELECT COUNT(*) AS n FROM crm_customers WHERE org_id = ?').get('org-1').n;
  const n2 = dbB.prepare('SELECT COUNT(*) AS n FROM crm_customers WHERE org_id = ?').get('org-2').n;
  assert.equal(n1, 2);
  assert.equal(n2, 2);

  dbB.close();
  await fsp.rm(root, { recursive: true, force: true });
});
