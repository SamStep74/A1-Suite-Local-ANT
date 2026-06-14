/**
 * product-import — Pattern A port of A1-Platform's product-import
 * orchestrator. Adapted for ANT's SQLite + per-tenant storage model.
 *
 * Source: A1-Platform/src/product-import.js (304 lines) +
 * A1-Platform/src/product-importers/{crm,hayhashvapah,studio,sqlite}.js
 * (224 lines combined).
 *
 * ANT differences:
 *   - A1-Platform used Postgres + per-tenant pool. ANT has a
 *     single `node:sqlite` DatabaseSync. The importer function
 *     receives a `db` (and optionally a `storage`) — it never
 *     knows about connection pools.
 *   - A1-Platform's product list is `["studio", "hayhashvapah",
 *     "crm"]` (their Postgres schema names). ANT's product list
 *     is `["smb-crm", "hayhashvapah", "studio"]` (matches
 *     web-modern/src/lib/apps.ts).
 *   - A1-Platform's per-product importer is a function imported
 *     from `./product-importers/`. ANT's importer registry is
 *     injected at construction time so tests can substitute mocks
 *     without touching the filesystem.
 *   - `recordOperation` / `finishOperation` in the source were
 *     platformDb methods that wrote to a Postgres
 *     `product_import_operations` table. ANT's orchestration
 *     uses an injected `recordOperation({slug, product, status,
 *     details})` callback. Tests pass a spy.
 *
 * Public surface:
 *   createProductImporter(options) → { checkProductBundle,
 *     validateProductBundle, importProductData, importProductBundle,
 *     resolveProductBundle, productImportPathRecords,
 *     productImportPaths, sha256Files, productBundleFileChecks,
 *     productBundleImportOptions }
 *
 * Pure helpers (no I/O — fully unit-testable):
 *   normalizeProductImportSlug(slug)
 *   productRecordLabel(record, index)
 *   parseSourceManifest(json)
 *   buildProductBundle({slug, sourceRoot, sourceManifest, manifest, products, productOptions, fileRecords})
 *   sha256FilesFromBuffers(records, contentByPath) — content provided, no FS
 *
 * Importable via:
 *   const { createProductImporter } = require('./lib/product-import');
 *   const importer = createProductImporter({
 *     importers: { 'smb-crm': importSmbCrmJson, ... },
 *     productOrder: ['smb-crm', 'hayhashvapah', 'studio'],
 *     recordOperation: async ({slug, product, status, details}) => { ... }
 *   });
 */
'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

/* ── constants ──────────────────────────────────────────────────────── */

const DEFAULT_PRODUCT_SOURCE_ROOT = '/opt/a1/imports/product-sources';
const DEFAULT_PRODUCT_ORDER = Object.freeze(['smb-crm', 'hayhashvapah', 'studio']);

// Per-product default path templates. Resolved against the bundle
// source root. The keys match ANT's web-modern apps.ts.
const DEFAULT_PATH_TEMPLATES = Object.freeze({
  'smb-crm': {
    blueprintPath: 'crm/tenants/{slug}.json',
    recordsPath: 'crm/records/{slug}.json'
  },
  hayhashvapah: {
    sqlitePath: 'hayhashvapah/hayhashvapah.sqlite'
  },
  studio: {
    sqlitePath: 'studio/armosphera-one.db'
  }
});

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/* ── pure helpers ───────────────────────────────────────────────────── */

/** Normalize a tenant/product slug (kebab-case, lowercase). */
function normalizeProductImportSlug(slug) {
  const s = String(slug || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  if (!s) throw new Error(`Invalid slug: ${slug}`);
  if (!SLUG_RE.test(s)) throw new Error(`Invalid slug: ${slug}`);
  return s;
}

/** Display label for a file record. Matches A1-Platform's
 *  "<product>:<kind>:<index>" so the format is recognisable. */
function productRecordLabel(record, index) {
  return `${record.product || 'file'}:${record.kind || 'source'}:${index}`;
}

/** Defensive parse for source-manifest.json. Throws on missing
 *  tenant_slug. Returns the parsed object. */
function parseSourceManifest(json) {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('source-manifest.json must be a JSON object');
  }
  if (parsed.tenant_slug !== undefined && typeof parsed.tenant_slug !== 'string') {
    throw new Error('source-manifest.json tenant_slug must be a string');
  }
  return parsed;
}

/** Build the bundle descriptor returned by resolveProductBundle.
 *  Pure — accepts pre-resolved parts. */
function buildProductBundle({
  slug,
  sourceRoot,
  sourceManifest,
  manifest,
  products,
  productOptions,
  fileRecords
}) {
  return {
    slug,
    sourceRoot,
    sourceManifest,
    manifest: manifest || {},
    products: products || [],
    productOptions: productOptions || [],
    fileRecords: fileRecords || [],
    sourceFiles: (fileRecords || [])
      .filter((item) => item.product !== 'bundle')
      .map((item) => item.path)
  };
}

/** Composite SHA256 of a list of file records, given pre-loaded
 *  contents. Used by tests that don't want to touch the FS. */
async function sha256FilesFromBuffers(records, contentByPath) {
  const hash = crypto.createHash('sha256');
  const list = (records || [])
    .filter(Boolean)
    .map((record, index) =>
      typeof record === 'string'
        ? { path: record, product: 'file', kind: 'source', index }
        : { ...record, index }
    );
  for (const record of list) {
    const buf = contentByPath[record.path];
    if (!buf) throw new Error(`Missing content for ${record.path}`);
    hash.update(productRecordLabel(record, record.index));
    hash.update('\0');
    hash.update(buf);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/* ── factory ────────────────────────────────────────────────────────── */

function createProductImporter(options = {}) {
  const productOrder = options.productOrder || DEFAULT_PRODUCT_ORDER;
  const pathTemplates = { ...DEFAULT_PATH_TEMPLATES, ...(options.pathTemplates || {}) };
  const importers = options.importers || {};
  const recordOperation =
    options.recordOperation ||
    (async () => ({ id: 'noop' })); // tests can pass a spy; production wires this to the audit engine
  const finishOperation = options.finishOperation || (async () => {});

  if (!Array.isArray(productOrder) || productOrder.length === 0) {
    throw new Error('createProductImporter requires productOrder');
  }
  for (const product of productOrder) {
    if (!importers[product]) {
      throw new Error(`createProductImporter: no importer registered for product "${product}"`);
    }
    if (typeof importers[product] !== 'function') {
      throw new Error(`createProductImporter: importer for "${product}" must be a function`);
    }
  }

  function requiredPath(value, message) {
    const p = String(value || '').trim();
    if (!p) throw new Error(message);
    return p;
  }

  /** Resolve the per-product file paths for a given product. */
  function productImportPathRecords(product, opts = {}) {
    if (product === 'smb-crm') {
      return [
        { product, kind: 'blueprint', path: requiredPath(opts.blueprintPath, 'smb-crm import requires --blueprint') },
        { product, kind: 'records', path: requiredPath(opts.recordsPath, 'smb-crm import requires --records') }
      ];
    }
    if (product === 'hayhashvapah' || product === 'studio') {
      return [{ product, kind: 'sqlite', path: requiredPath(opts.sqlitePath, `${product} import requires --sqlite`) }];
    }
    if (product === 'csv' || product === 'generic-csv') {
      return [{ product, kind: 'csv', path: requiredPath(opts.csvPath, 'csv import requires --csv') }];
    }
    throw new Error(`Unknown product import: ${product}`);
  }

  function productImportPaths(product, opts = {}) {
    return productImportPathRecords(product, opts).map((r) => r.path);
  }

  async function readSourceManifest(sourceManifest) {
    if (!sourceManifest) return {};
    return parseSourceManifest(await fsp.readFile(path.resolve(sourceManifest), 'utf8'));
  }

  function bundleSourceRoot(opts = {}) {
    if (opts.sourceRoot) return path.resolve(opts.sourceRoot);
    if (opts.sourceManifest) return path.dirname(path.resolve(opts.sourceManifest));
    return DEFAULT_PRODUCT_SOURCE_ROOT;
  }

  /** Build per-product options from the bundle's source-manifest. */
  function productBundleImportOptions(product, slug, manifest = {}, opts = {}) {
    const sourceRoot = bundleSourceRoot(opts);
    const sources = manifest.sources || {};
    const sourceManifest = opts.sourceManifest
      ? path.resolve(opts.sourceManifest)
      : path.join(sourceRoot, 'source-manifest.json');
    const tpl = pathTemplates[product] || {};
    const resolve = (key, fallback) =>
      sources[product]?.[key] || (tpl[key] ? path.join(sourceRoot, tpl[key].replace('{slug}', slug)) : fallback);

    if (product === 'smb-crm') {
      return {
        product,
        slug,
        blueprintPath: resolve('remote_tenant_json') || opts.blueprintPath,
        recordsPath: resolve('remote_records_json') || opts.recordsPath,
        sourceManifest
      };
    }
    if (product === 'hayhashvapah') {
      return {
        product,
        slug,
        sqlitePath: resolve('remote_sqlite') || opts.sqlitePath,
        sourceManifest
      };
    }
    if (product === 'studio') {
      return {
        product,
        slug,
        sqlitePath: resolve('remote_sqlite') || opts.sqlitePath,
        appVersion: opts.appVersion,
        sourceManifest
      };
    }
    throw new Error(`Unknown product import: ${product}`);
  }

  /** Stat + sha256 every file in a file-record list. Does not
   *  throw on missing files — those surface as `ok: false`. */
  async function productBundleFileChecks(fileRecords) {
    const checks = [];
    for (const [index, file] of fileRecords.entries()) {
      try {
        const resolved = path.resolve(file.path);
        const stat = await fsp.stat(resolved);
        const content = stat.isFile() ? await fsp.readFile(resolved) : null;
        checks.push({
          ...file,
          path: resolved,
          ok: stat.isFile(),
          size: stat.isFile() ? stat.size : 0,
          checksum: content ? crypto.createHash('sha256').update(content).digest('hex') : null,
          checksumLabel: productRecordLabel(file, index),
          message: stat.isFile() ? 'file is readable' : 'not a file'
        });
      } catch {
        checks.push({
          ...file,
          path: path.resolve(file.path),
          ok: false,
          size: 0,
          checksum: null,
          checksumLabel: productRecordLabel(file, index),
          message: 'file missing'
        });
      }
    }
    return checks;
  }

  async function assertReadableFiles(fileRecords) {
    const checks = await productBundleFileChecks(fileRecords);
    const missing = checks.filter((c) => !c.ok);
    if (missing.length) {
      const error = new Error(
        `Product import bundle preflight failed; missing files: ${missing.map((c) => c.path).join(', ')}`
      );
      error.fileChecks = checks;
      throw error;
    }
    return checks;
  }

  /** Compute the composite SHA256 of a list of file records. */
  async function sha256Files(fileRecords) {
    const hash = crypto.createHash('sha256');
    const records = (fileRecords || [])
      .filter(Boolean)
      .map((record, index) =>
        typeof record === 'string'
          ? { path: record, product: 'file', kind: 'source', index }
          : { ...record, index }
      );
    for (const record of records) {
      const resolved = path.resolve(record.path);
      hash.update(productRecordLabel(record, record.index));
      hash.update('\0');
      hash.update(await fsp.readFile(resolved));
      hash.update('\0');
    }
    return hash.digest('hex');
  }

  /** Resolve a bundle: parse the manifest, build per-product
   *  options, gather file records. Pure-ish: no I/O except for
   *  reading the manifest. */
  async function resolveProductBundle(opts) {
    const slug = normalizeProductImportSlug(opts.slug);
    const sourceRoot = bundleSourceRoot(opts);
    const sourceManifest = opts.sourceManifest
      ? path.resolve(opts.sourceManifest)
      : path.join(sourceRoot, 'source-manifest.json');
    const manifest = await readSourceManifest(sourceManifest);
    const manifestSlug = manifest.tenant_slug
      ? normalizeProductImportSlug(manifest.tenant_slug)
      : slug;
    if (manifest.tenant_slug && manifestSlug !== slug) {
      throw new Error(`Source manifest tenant slug ${manifestSlug} does not match ${slug}`);
    }

    const products = [...productOrder];
    const productOptions = products.map((p) =>
      productBundleImportOptions(p, slug, manifest, { ...opts, sourceRoot, sourceManifest })
    );
    const fileRecords = [
      { product: 'bundle', kind: 'source-manifest', path: sourceManifest },
      ...productOptions.flatMap((o) => productImportPathRecords(o.product, o))
    ];

    return buildProductBundle({
      slug,
      sourceRoot,
      sourceManifest,
      manifest,
      products,
      productOptions,
      fileRecords
    });
  }

  /** Preflight: resolve + assert all files readable. Throws on
   *  missing files (with fileChecks attached to the error). */
  async function validateProductBundle(opts) {
    const bundle = await resolveProductBundle(opts);
    try {
      const fileChecks = await assertReadableFiles(bundle.fileRecords);
      return { ...bundle, fileChecks };
    } catch (error) {
      error.bundle = bundle;
      throw error;
    }
  }

  /** Non-throwing preflight: returns ok:false with error.message
   *  on any failure, ok:true with fileChecks on success. */
  async function checkProductBundle(opts) {
    try {
      const bundle = await validateProductBundle(opts);
      return {
        ok: true,
        slug: bundle.slug,
        sourceRoot: bundle.sourceRoot,
        sourceManifest: bundle.sourceManifest,
        products: bundle.products,
        files: bundle.fileChecks
      };
    } catch (error) {
      const sourceRoot = bundleSourceRoot(opts);
      const sourceManifest = opts.sourceManifest
        ? path.resolve(opts.sourceManifest)
        : path.join(sourceRoot, 'source-manifest.json');
      // When the bundle throws BEFORE the product list is built
      // (e.g. an early file-stat error), fall back to the configured
      // product order so the caller still sees the list.
      return {
        ok: false,
        slug: opts.slug ? normalizeProductImportSlug(opts.slug) : '',
        sourceRoot,
        sourceManifest,
        products: error.bundle?.products || [...productOrder],
        files: error.fileChecks || [],
        error: error.message
      };
    }
  }

  /** Import a single product. The product's importer is looked
   *  up in the `importers` registry. */
  async function importProductData(opts) {
    const product = String(opts.product || '').trim().toLowerCase();
    if (!product) throw new Error('importProductData requires opts.product');
    const slug = normalizeProductImportSlug(opts.slug);
    const sourceRecords = productImportPathRecords(product, opts);
    const sourcePaths = sourceRecords.map((r) => r.path);
    const sourceManifest = String(opts.sourceManifest || '').trim();
    const checksum = await sha256Files(sourceRecords);
    const artifactPath = sourceManifest || sourcePaths[0];
    const operation = await recordOperation({
      slug,
      product,
      status: 'started',
      details: { artifactPath, checksum }
    });

    try {
      const importer = importers[product];
      if (!importer) throw new Error(`No importer registered for product: ${product}`);
      const result = await importer({
        db: opts.db,
        storage: opts.storage,
        slug,
        org_id: opts.org_id || opts.orgId,
        blueprintPath: opts.blueprintPath,
        recordsPath: opts.recordsPath,
        sqlitePath: opts.sqlitePath,
        csvPath: opts.csvPath,
        appVersion: opts.appVersion,
        rowsByTable: opts.rowsByTable
      });
      await finishOperation(operation.id, 'completed', { artifactPath, checksum });
      return { product, slug, result, artifactPath, checksum, operationId: operation.id };
    } catch (error) {
      await finishOperation(operation.id, 'failed', { artifactPath, checksum, error: error.message });
      throw error;
    }
  }

  /** Import the full bundle (every product, in order). */
  async function importProductBundle(opts) {
    const bundle = await validateProductBundle(opts);
    const results = [];
    for (const productOptions of bundle.productOptions) {
      results.push(
        await importProductData({
          ...productOptions,
          db: opts.db,
          storage: opts.storage,
          // Carry org_id/orgId from the bundle opts so per-product
          // importers can use it for the target row key. Falls
          // back to the slug-derived default in the importer.
          org_id: opts.org_id || opts.orgId
        })
      );
    }
    return {
      slug: bundle.slug,
      sourceRoot: bundle.sourceRoot,
      sourceManifest: bundle.sourceManifest,
      products: bundle.products,
      results
    };
  }

  return {
    checkProductBundle,
    validateProductBundle,
    importProductData,
    importProductBundle,
    resolveProductBundle,
    productImportPathRecords,
    productImportPaths,
    sha256Files,
    productBundleFileChecks,
    productBundleImportOptions,
    // expose pure helpers for tests
    normalizeProductImportSlug,
    productRecordLabel,
    parseSourceManifest,
    buildProductBundle,
    sha256FilesFromBuffers
  };
}

module.exports = {
  createProductImporter,
  // pure helpers (also re-exported at top level for convenience)
  normalizeProductImportSlug,
  productRecordLabel,
  parseSourceManifest,
  buildProductBundle,
  sha256FilesFromBuffers,
  DEFAULT_PRODUCT_ORDER,
  DEFAULT_PATH_TEMPLATES
};
