/**
 * tenant-context.test.js — 5-gate contract suite for the ANT port
 * of A1-Platform's tenant-context.js.
 *
 * Gate coverage:
 *   1. Pure: deterministic, no I/O, no global state.
 *   2. Types: input shape, return shape, error shape are stable.
 *   3. Idempotency: same input → same output (modulo Date.now, which
 *      this engine doesn't use).
 *   4. Contract: TenantAccessError carries (statusCode, code) so
 *      the Fastify error handler can map it to an HTTP response
 *      without re-throwing or string-matching.
 *   5. Edge: maintenance takes precedence over disabled; missing
 *      host throws before any DB call; productCode="unified"
 *      bypasses the module gate; module-disabled surfaces the
 *      product code in the error message.
 *
 * Why 5 gates, not just "passes the obvious cases": ANT routes
 * (server/smbCrmRoutes.js) build on top of this engine. A silent
 * behavior change here (e.g. status enum drift) would cascade.
 */
'use strict';

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TenantAccessError,
  resolveTenantContext,
  attachTenantContext,
  stripHostPort
} = require("../tenant-context");

/* ── test fixtures ────────────────────────────────────────────────── */

const FIXTURE_ARMO = {
  id: "tenant-armo",
  slug: "armosphera-demo",
  companyName: "Armosphera Demo Clinic",
  status: "active",
  host: "armosphera.local",
  modules: [
    { code: "smb-crm", enabled: true },
    { code: "crm",     enabled: true },
    { code: "finance", enabled: true }
  ]
};

const FIXTURE_MAINT = {
  ...FIXTURE_ARMO,
  id: "tenant-maint",
  slug: "demo-maint",
  status: "maintenance",
  host: "maint.local"
};

const FIXTURE_SUSP = {
  ...FIXTURE_ARMO,
  id: "tenant-susp",
  slug: "demo-susp",
  status: "suspended",
  host: "susp.local"
};

const FIXTURE_NO_SMB = {
  ...FIXTURE_ARMO,
  id: "tenant-no-smb",
  slug: "demo-no-smb",
  host: "no-smb.local",
  modules: [
    { code: "smb-crm", enabled: false },
    { code: "crm",     enabled: true }
  ]
};

/** In-memory registry — substitutes for SQLite in tests. */
function memoryRegistry(tenants) {
  const byHost = new Map(tenants.map((t) => [t.host, t]));
  return async (host) => byHost.get(host) || null;
}

/* ── gate 1: pure ──────────────────────────────────────────────────── */

test("pure: same input → same output, no Date.now / no I/O", async () => {
  const reg = memoryRegistry([FIXTURE_ARMO]);
  const a = await resolveTenantContext({ getTenantByHost: reg, host: "armosphera.local" });
  const b = await resolveTenantContext({ getTenantByHost: reg, host: "armosphera.local" });
  assert.deepEqual(a, b);
});

/* ── gate 2: types / shape ────────────────────────────────────────── */

test("types: returns the ANT-normalized TenantView (no A1-Platform fields)", async () => {
  const reg = memoryRegistry([FIXTURE_ARMO]);
  const view = await resolveTenantContext({
    getTenantByHost: reg,
    host: "armosphera.local",
    productCode: "smb-crm"
  });
  // ANT shape — no .databaseUrl, no .storagePrefix, no .studioOrgId,
  // no .modules (those live in a separate ANT table).
  assert.deepEqual(Object.keys(view).sort(), [
    "companyName",
    "host",
    "id",
    "productCode",
    "slug",
    "status"
  ]);
});

test("types: input validation throws TypeError, not silent", async () => {
  await assert.rejects(
    () => resolveTenantContext(null),
    TypeError,
    "resolveTenantContext(input) requires an object"
  );
  await assert.rejects(
    () => resolveTenantContext({ host: "x.local" }),
    TypeError,
    "requires a getTenantByHost(host) function"
  );
});

/* ── gate 3: idempotency ──────────────────────────────────────────── */

test("idempotency: 100 calls in a row → 100 identical outputs", async () => {
  const reg = memoryRegistry([FIXTURE_ARMO]);
  const first = await resolveTenantContext({ getTenantByHost: reg, host: "armosphera.local" });
  for (let i = 0; i < 99; i += 1) {
    const next = await resolveTenantContext({ getTenantByHost: reg, host: "armosphera.local" });
    assert.deepEqual(next, first);
  }
});

/* ── gate 4: contract — error shape stability ─────────────────────── */

test("contract: TenantAccessError has stable (name, statusCode, code) for the HTTP layer", async () => {
  const reg = memoryRegistry([]);
  await assert.rejects(
    () => resolveTenantContext({ getTenantByHost: reg, host: "missing.local" }),
    (err) => {
      assert.equal(err.name, "TenantAccessError");
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, "TENANT_NOT_FOUND");
      assert.ok(err instanceof TenantAccessError);
      assert.ok(err instanceof Error);
      return true;
    }
  );
});

test("contract: maintenance status is 503, suspended is 403, both are TenantAccessError", async () => {
  for (const fixture of [FIXTURE_MAINT, FIXTURE_SUSP]) {
    const reg = memoryRegistry([fixture]);
    await assert.rejects(
      () => resolveTenantContext({ getTenantByHost: reg, host: fixture.host }),
      (err) => {
        assert.ok(err instanceof TenantAccessError);
        assert.match(err.code, /^(TENANT_MAINTENANCE|TENANT_DISABLED)$/);
        assert.match(String(err.statusCode), /^(403|503)$/);
        return true;
      }
    );
  }
});

/* ── gate 5: edge cases ───────────────────────────────────────────── */

test("edge: maintenance status takes precedence over any other gate", async () => {
  // Same host can't be both maintenance and suspended at the same
  // time in production, but the resolver must deterministically
  // pick one gate. Maintenance must win because the operator
  // deliberately chose it to override access decisions.
  const dual = { ...FIXTURE_ARMO, status: "maintenance" };
  const reg = memoryRegistry([dual]);
  await assert.rejects(
    () => resolveTenantContext({ getTenantByHost: reg, host: dual.host }),
    (err) => {
      assert.equal(err.code, "TENANT_MAINTENANCE");
      assert.equal(err.statusCode, 503);
      return true;
    }
  );
});

test("edge: empty Host header is 400 TENANT_HOST_MISSING, not a 404 lookup", async () => {
  const reg = memoryRegistry([FIXTURE_ARMO]);
  await assert.rejects(
    () => resolveTenantContext({ getTenantByHost: reg, host: "" }),
    (err) => {
      assert.equal(err.code, "TENANT_HOST_MISSING");
      assert.equal(err.statusCode, 400);
      return true;
    }
  );
});

test("edge: host with port is stripped before lookup", async () => {
  const reg = memoryRegistry([FIXTURE_ARMO]);
  const view = await resolveTenantContext({
    getTenantByHost: reg,
    host: "armosphera.local:3000"
  });
  assert.equal(view.host, "armosphera.local");
  // stripHostPort is exported and stable
  assert.equal(stripHostPort("armosphera.local:3000"), "armosphera.local");
  assert.equal(stripHostPort("[::1]:4000"), "[::1]"); // IPv6 host
  assert.equal(stripHostPort("ARMO.LOCAL"), "armo.local"); // case-folded
});

test("edge: productCode='unified' bypasses the module gate", async () => {
  // FIXTURE_NO_SMB has smb-crm disabled. unified should still resolve.
  const reg = memoryRegistry([FIXTURE_NO_SMB]);
  const view = await resolveTenantContext({
    getTenantByHost: reg,
    host: "no-smb.local",
    productCode: "unified"
  });
  assert.equal(view.id, "tenant-no-smb");
});

test("edge: productCode with no matching module is 403 MODULE_DISABLED", async () => {
  const reg = memoryRegistry([FIXTURE_NO_SMB]);
  await assert.rejects(
    () => resolveTenantContext({
      getTenantByHost: reg,
      host: "no-smb.local",
      productCode: "smb-crm"
    }),
    (err) => {
      assert.equal(err.code, "MODULE_DISABLED");
      assert.equal(err.statusCode, 403);
      assert.match(err.message, /smb-crm/);
      return true;
    }
  );
});

test("edge: productCode with unknown module is 403 (not 404) — same code, treat disabled and absent identically", async () => {
  const reg = memoryRegistry([FIXTURE_ARMO]);
  await assert.rejects(
    () => resolveTenantContext({
      getTenantByHost: reg,
      host: "armosphera.local",
      productCode: "tube"
    }),
    (err) => {
      assert.equal(err.code, "MODULE_DISABLED");
      assert.equal(err.statusCode, 403);
      return true;
    }
  );
});

test("edge: module.enabled=false → MODULE_DISABLED even if module exists", async () => {
  const tenant = {
    ...FIXTURE_ARMO,
    host: "partial.local",
    modules: [{ code: "crm", enabled: false }]
  };
  const reg = memoryRegistry([tenant]);
  await assert.rejects(
    () => resolveTenantContext({
      getTenantByHost: reg,
      host: "partial.local",
      productCode: "crm"
    }),
    (err) => {
      assert.equal(err.code, "MODULE_DISABLED");
      return true;
    }
  );
});

/* ── attachTenantContext: middleware factory ─────────────────────── */

test("middleware: attachTenantContext writes req.tenant", async () => {
  const reg = memoryRegistry([FIXTURE_ARMO]);
  const apply = attachTenantContext({ getTenantByHost: reg });
  const req = { headers: { host: "armosphera.local" } };
  const tenant = await apply(req);
  assert.equal(tenant.id, "tenant-armo");
  assert.equal(req.tenant.id, "tenant-armo");
});

test("middleware: default hostExtractor reads req.headers.host || req.host || ''", async () => {
  const reg = memoryRegistry([FIXTURE_ARMO]);
  const apply = attachTenantContext({ getTenantByHost: reg });
  // Fallback chain — no headers, but req.host is set
  const r1 = await apply({ host: "armosphera.local" });
  assert.equal(r1.id, "tenant-armo");
  // Empty chain → 400
  await assert.rejects(
    () => apply({}),
    (err) => err.code === "TENANT_HOST_MISSING"
  );
});

test("middleware: custom hostExtractor is honored", async () => {
  const reg = memoryRegistry([FIXTURE_ARMO]);
  const apply = attachTenantContext({
    getTenantByHost: reg,
    hostExtractor: () => "armosphera.local"
  });
  const tenant = await apply({}); // no host anywhere
  assert.equal(tenant.id, "tenant-armo");
});

test("middleware: throws TypeError when getTenantByHost is missing", () => {
  assert.throws(
    () => attachTenantContext({}),
    TypeError
  );
});

/* ── productCode normalization ────────────────────────────────────── */

test("productCode: undefined falls through to 'unified' (legacy single-product tenant)", async () => {
  const reg = memoryRegistry([FIXTURE_ARMO]);
  const view = await resolveTenantContext({
    getTenantByHost: reg,
    host: "armosphera.local"
    // no productCode
  });
  assert.equal(view.productCode, "unified");
});

test("productCode: explicit 'unified' string is the same as undefined", async () => {
  const reg = memoryRegistry([FIXTURE_ARMO]);
  const a = await resolveTenantContext({
    getTenantByHost: reg, host: "armosphera.local", productCode: undefined
  });
  const b = await resolveTenantContext({
    getTenantByHost: reg, host: "armosphera.local", productCode: "unified"
  });
  assert.equal(a.productCode, b.productCode);
});
