/**
 * tenant-context — pure Host → tenant resolver (Pattern A engine, ANT port).
 *
 * Ported from A1-Platform's src/tenant-context.js. The original
 * resolved an A1-Platform `tenant` row (with `.modules[]`,
 * `.databaseUrl`, `.storagePrefix`, `.studioOrgId`) and threw a
 * `TenantAccessError` on:
 *
 *   - missing tenant for the host      → 404 TENANT_NOT_FOUND
 *   - maintenance or migrating status  → 503 TENANT_MAINTENANCE
 *   - suspended or archived status     → 403 TENANT_DISABLED
 *   - productCode not in tenant's mod- → 403 MODULE_DISABLED
 *     ules[] (when productCode ≠ "unified")
 *
 * What we changed for ANT:
 *
 *   1. The registry is now an INJECTED function `getTenantByHost(host)`
 *      instead of a class instance. The caller wires up the db query
 *      (so the test suite can pass a closure backed by an in-memory
 *      Map, no SQLite needed). ANT wires it up as
 *      `host => smbCrmTenants.getTenantByHost(db, host).then(toTenantView)`.
 *
 *   2. The returned shape is the ANT-normalized `TenantView`
 *      (id, slug, companyName, status, host, productCode) — NOT
 *      the A1-Platform shape with .modules[]. Per-tenant module
 *      flags live in the `smb_crm_tenant_modules` table in ANT;
 *      we don't shadow them here. The productCode gate is still
 *      enforced, but the tenant shape is the lean view.
 *
 *   3. `tenantContextMiddleware` becomes `attachTenantContext`:
 *      pure-function wrapper that takes the host from a caller-
 *      supplied extractor (so the test can pass any host string
 *      and the prod code can do `req => req.headers.host`). This
 *      matches the rest of ANT's engine layer — engines don't
 *      know about Fastify.
 *
 * The middleware pattern A1-Platform used (returning a function
 * that closes over a registry) lives on in our higher-level
 * `server/smbCrmRoutes.js` where it's wired into the request
 * lifecycle. This engine is the pure heart; the Fastify plugin
 * is elsewhere.
 */
'use strict';

/* ── errors ─────────────────────────────────────────────────────────── */

class TenantAccessError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} code  one of: TENANT_NOT_FOUND, TENANT_MAINTENANCE,
   *                       TENANT_DISABLED, MODULE_DISABLED
   * @param {string} message
   */
  constructor(statusCode, code, message) {
    super(message);
    this.name = "TenantAccessError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/* ── helpers ───────────────────────────────────────────────────────── */

/**
 * Strip the port off a Host header value. A1-Platform's `naming.js`
 * has the canonical version with a 200+ test suite; we re-implement
 * the 2-line version here because the import would pull in the rest
 * of A1-Platform's runtime (we want a pure function, no I/O).
 */
function stripHostPort(host) {
  if (!host) return "";
  // IPv6 host header values come bracketed: "[::1]:3000"
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    if (close >= 0) return host.slice(0, close + 1).toLowerCase();
    return host.toLowerCase();
  }
  const colon = host.lastIndexOf(":");
  // No port (e.g. "example.com" or "example.com:") — leave it
  if (colon < 0) return host.toLowerCase();
  const tail = host.slice(colon + 1);
  // All-digit tail = port; strip it
  if (/^\d+$/.test(tail)) return host.slice(0, colon).toLowerCase();
  return host.toLowerCase();
}

/* ── core resolver ─────────────────────────────────────────────────── */

/**
 * Resolve the tenant context for an inbound request.
 *
 * @param {object} input
 * @param {(host: string) => Promise<Tenant | null> | Tenant | null} input.getTenantByHost
 *   Resolves host → tenant row. Caller wires this from a real DB
 *   (smbCrmTenants.getTenantByHost) or a stub (tests).
 * @param {string} input.host
 *   The inbound Host header value (with or without port).
 * @param {string} [input.productCode="unified"]
 *   When "unified", the resolver skips the per-module gate. When
 *   any other value, the tenant must have that module enabled in
 *   its `modules[]` array (forward-compat: even though ANT stores
 *   module flags in a separate table today, we accept a modules
 *   array on the tenant object so the resolver stays a pure
 *   function and works with both schemas).
 * @returns {Promise<TenantContext>}
 *   The normalized tenant view: id, slug, companyName, status,
 *   host (the routeHost we resolved against), productCode.
 *   Throws TenantAccessError on any gate failure.
 */
async function resolveTenantContext(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("resolveTenantContext(input) requires an object");
  }
  const { getTenantByHost, productCode } = input;
  if (typeof getTenantByHost !== "function") {
    throw new TypeError("resolveTenantContext requires a getTenantByHost(host) function");
  }
  const routeHost = stripHostPort(input.host);
  if (!routeHost) {
    throw new TenantAccessError(
      400,
      "TENANT_HOST_MISSING",
      "Inbound request is missing the Host header"
    );
  }

  const tenant = await getTenantByHost(routeHost);
  if (!tenant) {
    throw new TenantAccessError(
      404,
      "TENANT_NOT_FOUND",
      `No tenant route for host ${routeHost}`
    );
  }

  const pc = productCode || "unified";

  // Status gates — order matters: maintenance takes precedence over
  // disabled because the operator may put a tenant in maintenance
  // while debugging (transient) and we'd rather show "we're working
  // on it" (503) than "you don't have access" (403).
  if (tenant.status === "maintenance" || tenant.status === "migrating") {
    throw new TenantAccessError(
      503,
      "TENANT_MAINTENANCE",
      "Tenant is temporarily in maintenance"
    );
  }
  if (
    tenant.status === "suspended" ||
    tenant.status === "archived" ||
    tenant.status === "disabled"
  ) {
    throw new TenantAccessError(
      403,
      "TENANT_DISABLED",
      `Tenant is ${tenant.status}`
    );
  }

  // Module gate — only enforced when the caller is asking for a
  // specific product. "unified" is the default for the legacy
  // single-product tenants and tests.
  if (pc !== "unified") {
    const modules = Array.isArray(tenant.modules) ? tenant.modules : [];
    const module = modules.find((item) => item && item.code === pc);
    if (!module || !module.enabled) {
      throw new TenantAccessError(
        403,
        "MODULE_DISABLED",
        `${pc} is not enabled for this tenant`
      );
    }
  }

  return {
    id: tenant.id,
    slug: tenant.slug,
    companyName: tenant.companyName,
    status: tenant.status,
    host: routeHost,
    productCode: pc
  };
}

/* ── middleware factory ───────────────────────────────────────────── */

/**
 * Build a request-attaching middleware. Pure factory: the closure
 * captures the host-extractor and the registry, returns a function
 * that takes one request-like object and writes `req.tenant` on it.
 *
 * @param {object} options
 * @param {Function} options.getTenantByHost
 * @param {(req) => string} options.hostExtractor
 *   Pull the host out of a request. Default: `req => req.headers?.host || req.host || ""`.
 * @param {string} [options.productCode="unified"]
 */
function attachTenantContext(options) {
  if (!options || typeof options.getTenantByHost !== "function") {
    throw new TypeError("attachTenantContext requires { getTenantByHost }");
  }
  const productCode = options.productCode || "unified";
  const hostExtractor =
    options.hostExtractor ||
    ((req) => (req && (req.headers?.host || req.host)) || "");
  return async function apply(req) {
    const host = hostExtractor(req);
    const tenant = await resolveTenantContext({
      getTenantByHost: options.getTenantByHost,
      host,
      productCode
    });
    if (req && typeof req === "object") req.tenant = tenant;
    return tenant;
  };
}

module.exports = {
  TenantAccessError,
  resolveTenantContext,
  attachTenantContext,
  stripHostPort
};
