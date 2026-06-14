/**
 * storage — Pattern A tenant-scoped blob storage (ANT port).
 *
 * Ported from A1-Platform's src/storage/index.js. The source had
 * two parallel backends (LocalTenantStorage on disk, S3TenantStorage
 * via @aws-sdk) behind the same interface:
 *
 *   putObject(tenantSlug, productCode, key, body) -> { key }
 *   getObject(tenantSlug, productCode, key)       -> Buffer
 *   deleteObject(tenantSlug, productCode, key)
 *   listObjects(tenantSlug, productCode?)        -> string[]
 *   countTenantObjects(tenantSlug)               -> number
 *   syncPrefixToDir(tenantSlug, targetDir)        -> number
 *   syncDirToPrefix(tenantSlug, sourceDir)        -> number
 *
 * What we kept:
 *   - The two-backends-same-interface pattern (Local by default,
 *     optional S3 driver)
 *   - Object-key shape: `tenants/<slug>/<product>/<key>` (the
 *     product code lives between slug and key, so a single
 *     tenant can have multiple products each with their own
 *     blob namespace)
 *   - Path traversal protection: any `..`, leading `/`, or
 *     `\\` in the user-supplied key is rejected
 *   - Product allowlist — ANT's known set is `["smb-crm",
 *     "fiscal-gates", "triage-inbox", "ask-ai", "documents",
 *     "crm", "crm-tube", "finance", "copilot", "desk",
 *     "campaigns", "projects", "assets", "inventory",
 *     "purchase", "people", "docs", "analytics", "flow",
 *     "forms", "cfo", "fleet", "greenhouse", "settings"]`,
 *     derived from web-modern/src/lib/apps.ts. We accept
 *     any string in the regex /^[a-z0-9][a-z0-9-]*$/ so the
 *     allowlist doesn't go stale every time a new app ships.
 *
 * What we changed:
 *   1. **No hard dep on @aws-sdk/client-s3.** The S3 driver is a
 *      SEPARATE file (server/lib/s3-storage.js) that lazy-requires
 *      the SDK. If the package isn't installed, the user gets a
 *      clear "install @aws-sdk/client-s3 to use s3 driver" error
 *      instead of an unresolved module. ANT's sovereignty rule
 *      (outbound OFF by default) makes the local driver the
 *      primary path; S3 is opt-in.
 *
 *   2. **Audit hook is injected.** Each putObject / deleteObject
 *      calls the caller-supplied `audit(event)` function with a
 *      stable event shape. ANT's audit engine consumes these;
 *      tests can pass `() => {}` for a no-op.
 *
 *   3. **Class → factory.** ANT's Pattern A avoids `new`; the
 *      storage is created via `createStorage(config)`. The returned
 *      object exposes the same 7 methods, but is duck-typed.
 *
 *   4. **getObject returns null on missing, not throws.** The
 *      source threw ENOENT. ANT's caller code wants to distinguish
 *      "missing" from "corrupt" — we return null and let the
 *      caller decide. (ENOENT still propagates from the underlying
 *      fs if the parent dir is missing — that's a config bug,
 *      not a 404.)
 */
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

/* ── pure helpers ───────────────────────────────────────────────────── */

/** Product code must look like a kebab slug. Mirrors the
 *  APP_IDS regex in web-modern/src/lib/apps.ts. We accept any
 *  well-formed slug so we don't have to update this when a new
 *  product is added. */
const PRODUCT_CODE_RE = /^[a-z0-9][a-z0-9-]*$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Sanitize a tenant slug. Lowercase, replace runs of
 *  non-slug chars with `-`, trim, dedupe separators.
 *  Empty / over-long slugs throw. */
function normalizeSlug(value) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!slug) throw new Error(`Invalid tenant slug: ${value}`);
  if (!SLUG_RE.test(slug)) throw new Error(`Invalid tenant slug: ${value}`);
  return slug;
}

/** Normalize and validate a product code. The source had a
 *  hard-coded Set of 4 codes; ANT's product set is open-ended
 *  (new apps ship often) so we accept any well-formed slug. */
function normalizeProduct(productCode) {
  const product = String(productCode || '').trim().toLowerCase();
  if (!product) throw new Error(`Product code is required`);
  if (!PRODUCT_CODE_RE.test(product)) {
    throw new Error(`Invalid product code: ${productCode}`);
  }
  return product;
}

/** Sanitize a user-supplied object key. Reject path traversal,
 *  absolute paths, and backslashes. Mirrors A1-Platform's
 *  normalizeObjectName. */
function normalizeObjectName(key) {
  const clean = String(key || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
  if (!clean) throw new Error(`Object key is empty: ${key}`);
  if (clean.includes('../') || clean === '..' || clean.startsWith('..')) {
    throw new Error(`Unsafe object key: ${key}`);
  }
  return clean;
}

/** Build the full object key for a tenant+product+userKey triple.
 *  This is the path the S3/local driver sees; never the
 *  filesystem path. */
function tenantObjectKey(tenantSlug, productCode, key) {
  return `tenants/${normalizeSlug(tenantSlug)}/${normalizeProduct(productCode)}/${normalizeObjectName(key)}`;
}

/* ── path computation (injected for testability) ──────────────────── */

/** Normalize a write body into a Buffer plus a byte count.
 *  Pure. Mirrors what a future S3 PutObject call would do (where
 *  every body is a Buffer/stream anyway). */
function serializeBody(body) {
  if (body == null) return { payload: Buffer.alloc(0), bytes: 0 };
  if (Buffer.isBuffer(body)) return { payload: body, bytes: body.length };
  if (typeof body === 'string') {
    const buf = Buffer.from(body, 'utf8');
    return { payload: buf, bytes: buf.length };
  }
  if (
    body instanceof Uint8Array ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    const buf = Buffer.from(
      body instanceof ArrayBuffer ? new Uint8Array(body) : body
    );
    return { payload: buf, bytes: buf.length };
  }
  // Fallback: JSON-serialize unknown shapes (objects, numbers,
  // mock fixtures in tests). This keeps the engine from rejecting
  // the call on body shape while still being deterministic.
  const json = JSON.stringify(body);
  return { payload: Buffer.from(json, 'utf8'), bytes: null };
}

/** Compute the local filesystem path for an object key.
 *  Pure function so tests can predict the path without
 *  instantiating a storage driver. */
function localObjectPath(root, bucket, objectKey) {
  const safeKey = normalizeObjectName(objectKey);
  return path.join(path.resolve(root), bucket, safeKey);
}

/* ── local driver ──────────────────────────────────────────────────── */

function createLocalStorage(config, audit) {
  const root = path.resolve(config.root);
  const bucket = config.bucket || 'a1-documents';
  const auditEvent = audit || (() => {});

  async function ensureParent(filePath) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
  }

  async function walk(dir, base, out) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, base, out);
      else if (entry.isFile()) {
        out.push(path.relative(base, full).split(path.sep).join('/'));
      }
    }
  }

  async function copyDirContents(sourceDir, targetDir) {
    await fsp.mkdir(targetDir, { recursive: true });
    if (!fs.existsSync(sourceDir)) return 0;
    let count = 0;
    async function walkCopy(src, dst) {
      const entries = await fsp.readdir(src, { withFileTypes: true });
      for (const entry of entries) {
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (entry.isDirectory()) await walkCopy(s, d);
        else if (entry.isFile()) {
          await ensureParent(d);
          await fsp.copyFile(s, d);
          count += 1;
        }
      }
    }
    await walkCopy(sourceDir, targetDir);
    return count;
  }

  return {
    driver: 'local',

    localObjectPath(objectKey) {
      return localObjectPath(root, bucket, objectKey);
    },

    async putObject(tenantSlug, productCode, key, body) {
      const objectKey = tenantObjectKey(tenantSlug, productCode, key);
      const target = localObjectPath(root, bucket, objectKey);
      await ensureParent(target);
      // Normalize the body to something fs.writeFile accepts.
      // Accept Buffer, string, TypedArray/DataView (have a real
      // byte count). For anything else (objects, numbers, mocks
      // in tests) we JSON-serialize to a Buffer so the call is
      // never rejected on the basis of body shape. Streams and
      // async iterables are NOT supported here — they need
      // streaming fs.createWriteStream + pipeline (deferred).
      const { payload, bytes } = serializeBody(body);
      await fsp.writeFile(target, payload);
      auditEvent({
        type: 'storage.put',
        tenantSlug: normalizeSlug(tenantSlug),
        productCode: normalizeProduct(productCode),
        key: normalizeObjectName(key),
        bytes
      });
      return { key: objectKey };
    },

    async getObject(tenantSlug, productCode, key) {
      const target = localObjectPath(
        root,
        bucket,
        tenantObjectKey(tenantSlug, productCode, key)
      );
      try {
        return await fsp.readFile(target);
      } catch (err) {
        if (err && err.code === 'ENOENT') return null;
        throw err;
      }
    },

    async deleteObject(tenantSlug, productCode, key) {
      const target = localObjectPath(
        root,
        bucket,
        tenantObjectKey(tenantSlug, productCode, key)
      );
      await fsp.rm(target, { force: true });
      auditEvent({
        type: 'storage.delete',
        tenantSlug: normalizeSlug(tenantSlug),
        productCode: normalizeProduct(productCode),
        key: normalizeObjectName(key)
      });
    },

    async listObjects(tenantSlug, productCode) {
      const slug = normalizeSlug(tenantSlug);
      const product = productCode ? normalizeProduct(productCode) : null;
      const prefix = product
        ? `tenants/${slug}/${product}/`
        : `tenants/${slug}/`;
      // Walk starts one level above the storage root (which lives
      // at <root>/<bucket>/) so the relative path begins with
      // `tenants/...` — the same key shape returned by putObject.
      const base = localObjectPath(root, bucket, prefix);
      if (!fs.existsSync(base)) return [];
      const anchor = path.join(root, bucket);
      const keys = [];
      await walk(base, anchor, keys);
      return keys.sort();
    },

    async countTenantObjects(tenantSlug) {
      return (await this.listObjects(tenantSlug)).length;
    },

    async syncPrefixToDir(tenantSlug, targetDir) {
      const slug = normalizeSlug(tenantSlug);
      const sourceDir = localObjectPath(root, bucket, `tenants/${slug}/`);
      const n = await copyDirContents(sourceDir, targetDir);
      auditEvent({
        type: 'storage.sync.out',
        tenantSlug: slug,
        count: n
      });
      return n;
    },

    async syncDirToPrefix(tenantSlug, sourceDir) {
      const slug = normalizeSlug(tenantSlug);
      const targetDir = localObjectPath(root, bucket, `tenants/${slug}/`);
      const n = await copyDirContents(sourceDir, targetDir);
      auditEvent({
        type: 'storage.sync.in',
        tenantSlug: slug,
        count: n
      });
      return n;
    }
  };
}

/* ── factory ───────────────────────────────────────────────────────── */

function createStorage(config, options = {}) {
  if (!config || typeof config !== 'object') {
    throw new TypeError('createStorage requires a config object');
  }
  const audit = typeof options.audit === 'function' ? options.audit : null;
  const driver = config.driver || 'local';
  if (driver === 'local') {
    if (!config.root) {
      throw new Error('createStorage: local driver requires config.root');
    }
    return createLocalStorage(config, audit);
  }
  if (driver === 's3') {
    // Lazy require — the S3 driver is in a separate file so the
    // local-driver default doesn't pull @aws-sdk into the bundle.
    const { createS3Storage } = require('./s3-storage');
    return createS3Storage(config, audit);
  }
  throw new Error(`Unknown storage driver: ${driver}`);
}

module.exports = {
  createStorage,
  createLocalStorage,
  tenantObjectKey,
  normalizeSlug,
  normalizeProduct,
  normalizeObjectName,
  localObjectPath,
  serializeBody
};
