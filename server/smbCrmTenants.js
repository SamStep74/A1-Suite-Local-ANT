"use strict";

/**
 * SMB CRM — Tenants engine.
 *
 * Pattern A: pure functions, no Fastify imports, no `node:sqlite` imports.
 * All functions take `db` as the first argument; the route layer in
 * server/app.js owns the Fastify surface, auth, app-access, validation,
 * and audit.
 *
 * The legacy `lib/tenantStore.js` resolved tenants from `?tenant=` query
 * or `Host:` subdomain against JSON files. Phase 10 V1 collapses that
 * into a single SQLite row per tenant, with the row's `slug` and
 * `host` columns replacing the file lookup. Branches are a separate
 * table for multi-branch tenants (store chains).
 *
 * Tenant resolution order (mirrors the legacy):
 *   1. Explicit `{ slug }`           → exact slug match
 *   2. Explicit `{ host }`           → host column match
 *   3. Caller can pass either; pass null/undefined to list all.
 *
 * Cross-tenant safety: every read+write function takes `orgId` as a
 * positional argument; the route layer MUST scope by `user.org_id`.
 * The engine does not enforce RLS itself — that's a route-layer job,
 * same as `server/crmTube.js`.
 */

const crypto = require("node:crypto");

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}

function nowIso() { return new Date().toISOString(); }

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

class TenantNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "TenantNotFoundError";
    this.statusCode = 404;
    this.code = "TENANT_NOT_FOUND";
  }
}

class TenantConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "TenantConflictError";
    this.statusCode = 409;
    this.code = "TENANT_CONFLICT";
  }
}

/**
 * Resolve a tenant row by slug OR by host.
 *   resolveTenant(db, { slug: "my-shop" })
 *   resolveTenant(db, { host: "my-shop.armosphera.com" })
 * Returns the tenant row or null. Throws TenantNotFoundError on
 * explicit "not found" if `throwOnMissing` is true (the route layer
 * prefers to return 404 explicitly).
 */
function resolveTenant(db, identifier, opts) {
  if (!identifier || typeof identifier !== "object") return null;
  const id = String(identifier.slug || "").trim();
  const host = String(identifier.host || "").trim();
  if (id) return getTenantBySlug(db, id, opts);
  if (host) return getTenantByHost(db, host, opts);
  return null;
}

function getTenantBySlug(db, slug, opts) {
  const row = db
    .prepare("SELECT * FROM smb_crm_tenants WHERE slug = ?")
    .get(slugify(slug));
  if (!row && (opts && opts.throwOnMissing)) {
    throw new TenantNotFoundError(`Tenant not found: ${slug}`);
  }
  return row || null;
}

function getTenantByHost(db, host, opts) {
  const row = db
    .prepare("SELECT * FROM smb_crm_tenants WHERE host = ?")
    .get(String(host || "").trim().toLowerCase());
  if (!row && (opts && opts.throwOnMissing)) {
    throw new TenantNotFoundError(`Tenant not found for host: ${host}`);
  }
  return row || null;
}

function getTenantById(db, tenantId) {
  return db
    .prepare("SELECT * FROM smb_crm_tenants WHERE id = ?")
    .get(tenantId) || null;
}

/**
 * Create a tenant row. Validates slug uniqueness, generates a tenant
 * id, and returns the inserted row. Throws TenantConflictError if the
 * slug or host is already taken.
 *
 *   createTenant(db, { slug, companyName, locale, plan, branch? })
 *
 * `branch` is an optional inline branch (multi-branch tenants); when
 * provided, a smb_crm_branches row is created in the same call and
 * the tenant.branch_id is set to that branch's id.
 */
function createTenant(db, input) {
  if (!input || typeof input !== "object") {
    const err = new Error("input is required");
    err.statusCode = 400;
    throw err;
  }
  const slug = slugify(input.slug || input.companyName);
  if (!slug) {
    const err = new Error("slug (or companyName) is required");
    err.statusCode = 400;
    throw err;
  }
  const locale = String(input.locale || "en").trim();
  if (!["hy", "en", "ru"].includes(locale)) {
    const err = new Error("locale must be one of hy|en|ru");
    err.statusCode = 400;
    throw err;
  }
  const plan = String(input.plan || "trial").trim().toLowerCase();
  if (!["trial", "starter", "pro", "enterprise"].includes(plan)) {
    const err = new Error("plan must be one of trial|starter|pro|enterprise");
    err.statusCode = 400;
    throw err;
  }
  const host = input.host ? String(input.host).trim().toLowerCase() : null;
  if (host) {
    const existingHost = getTenantByHost(db, host);
    if (existingHost) throw new TenantConflictError(`Host already in use: ${host}`);
  }
  const existingSlug = getTenantBySlug(db, slug);
  if (existingSlug) throw new TenantConflictError(`Slug already in use: ${slug}`);

  const id = randomId("tenant");
  const now = nowIso();
  const settings = JSON.stringify(input.settings || {});
  const branchId = input.branch ? randomId("branch") : null;

  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO smb_crm_tenants (
        id, slug, host, company_name, locale, plan, settings_json,
        primary_branch_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, slug, host,
      String(input.companyName || slug),
      locale, plan, settings,
      branchId, now, now
    );
    if (input.branch) {
      db.prepare(`
        INSERT INTO smb_crm_branches (
          id, tenant_id, slug, name, is_primary, address, locale, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
      `).run(
        branchId, id,
        slugify(input.branch.slug || input.branch.name || "main"),
        String(input.branch.name || "Main branch"),
        input.branch.address || null,
        String(input.branch.locale || locale),
        now, now
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* swallow */ }
    throw err;
  }
  return getTenantById(db, id);
}

/**
 * Update mutable tenant settings (company name, locale, plan, host,
 * and the settings_json blob). Slug is intentionally NOT mutable —
 * the contract treats slug as a stable identifier.
 */
function updateTenantSettings(db, tenantId, patch) {
  if (!patch || typeof patch !== "object") return getTenantById(db, tenantId);
  const cur = getTenantById(db, tenantId);
  if (!cur) throw new TenantNotFoundError(`Tenant not found: ${tenantId}`);

  if (patch.host) {
    const host = String(patch.host).trim().toLowerCase();
    if (host !== cur.host) {
      const clash = getTenantByHost(db, host);
      if (clash && clash.id !== tenantId) {
        throw new TenantConflictError(`Host already in use: ${host}`);
      }
    }
  }
  if (patch.locale && !["hy", "en", "ru"].includes(patch.locale)) {
    const err = new Error("locale must be one of hy|en|ru");
    err.statusCode = 400;
    throw err;
  }
  if (patch.plan && !["trial", "starter", "pro", "enterprise"].includes(patch.plan)) {
    const err = new Error("plan must be one of trial|starter|pro|enterprise");
    err.statusCode = 400;
    throw err;
  }

  const now = nowIso();
  const settings = patch.settings !== undefined
    ? JSON.stringify(patch.settings)
    : cur.settings_json;

  db.prepare(`
    UPDATE smb_crm_tenants
       SET company_name = ?, host = ?, locale = ?, plan = ?, settings_json = ?, updated_at = ?
     WHERE id = ?
  `).run(
    patch.companyName !== undefined ? String(patch.companyName) : cur.company_name,
    patch.host !== undefined ? (patch.host ? String(patch.host).trim().toLowerCase() : null) : cur.host,
    patch.locale !== undefined ? patch.locale : cur.locale,
    patch.plan !== undefined ? patch.plan : cur.plan,
    settings,
    now,
    tenantId
  );
  return getTenantById(db, tenantId);
}

function listBranches(db, tenantId) {
  return db
    .prepare(`
      SELECT id, tenant_id, slug, name, is_primary, address, locale,
             created_at, updated_at
        FROM smb_crm_branches
       WHERE tenant_id = ?
       ORDER BY is_primary DESC, name
    `)
    .all(tenantId);
}

function listTenants(db, limit) {
  return db
    .prepare(`
      SELECT id, slug, host, company_name, locale, plan, primary_branch_id,
             created_at, updated_at
        FROM smb_crm_tenants
       ORDER BY created_at DESC
       LIMIT ?
    `)
    .all(Math.max(1, Math.min(500, Number(limit) || 100)));
}

/**
 * Lightweight row→object adapter for JSON serialization: the SQLite
 * row stores `company_name` (snake) and `settings_json` (string);
 * callers want `companyName` + parsed `settings`. Mirrors the shape
 * SmbCrmTenantSchema expects on the SPA side.
 */
function toTenantView(row) {
  if (!row) return null;
  let settings = {};
  if (row.settings_json) {
    try { settings = JSON.parse(row.settings_json); } catch { settings = {}; }
  }
  return {
    id: row.id,
    slug: row.slug,
    host: row.host || null,
    companyName: row.company_name,
    locale: row.locale,
    plan: row.plan,
    branchId: row.primary_branch_id || null,
    settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toBranchView(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    slug: row.slug,
    name: row.name,
    isPrimary: !!row.is_primary,
    address: row.address || null,
    locale: row.locale,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = {
  slugify,
  resolveTenant,
  getTenantBySlug,
  getTenantByHost,
  getTenantById,
  createTenant,
  updateTenantSettings,
  listBranches,
  listTenants,
  toTenantView,
  toBranchView,
  TenantNotFoundError,
  TenantConflictError
};
