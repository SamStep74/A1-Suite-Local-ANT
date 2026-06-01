const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");
const { resolvePlatformTenant } = require("../server/platformTenant");

const PLATFORM_ENV = {
  A1_PLATFORM_TENANT_RESOLUTION: "1",
  A1_PLATFORM_API_URL: "http://platform.local",
  ARMOSPHERA_ONE_ALLOW_EGRESS: "1",
  ARMOSPHERA_ONE_EGRESS_ALLOWLIST: "platform.local"
};

async function login(app, host = "demo-client.a1suite.am") {
  const response = await app.inject({
    method: "POST",
    url: "/api/login",
    headers: { host },
    payload: { email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD }
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.headers["set-cookie"];
}

test("platform tenant resolution is opt-in", async () => {
  let called = false;
  const tenant = await resolvePlatformTenant({ headers: { host: "demo-client.a1suite.am" } }, {}, async () => {
    called = true;
  });

  assert.equal(tenant, null);
  assert.equal(called, false);
});

test("A1 Studio default platform URL targets the VM gateway tunnel", async () => {
  const tenant = await resolvePlatformTenant(
    { headers: { host: "demo-client.a1suite.am" } },
    { A1_PLATFORM_TENANT_RESOLUTION: "1" },
    async (url) => {
      assert.equal(String(url), "http://127.0.0.1:8088/api/tenants/current?product=studio");
      return { ok: true, status: 200, json: async () => ({ tenant: null }) };
    }
  );

  assert.equal(tenant, null);
});

test("A1 Studio exposes resolved platform tenant summary when enabled", async () => {
  const env = {
    ...PLATFORM_ENV,
    A1_PLATFORM_TOKEN: "platform-token"
  };
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    assert.equal(String(url), "http://platform.local/api/tenants/current?product=studio");
    assert.equal(options.headers["x-a1-request-host"], "demo-client.a1suite.am");
    assert.equal(options.headers.host, undefined);
    assert.equal(options.headers["x-a1-platform-token"], "platform-token");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        tenant: {
          id: "tenant-1",
          orgId: "org-armosphera-demo",
          slug: "demo-client",
          status: "active",
          modules: [
            { code: "studio", enabled: true },
            { product_code: "crm", secret: "module-secret" },
            { enabled: true, secret: "must-not-leak" }
          ],
          productCode: "studio",
          routeHost: "demo-client.a1suite.am",
          storagePrefix: "tenants/demo-client/",
          databaseUrl: "postgresql://a1:secret@postgres:5432/a1_tenant_demo_client"
        }
      })
    };
  };

  const app = buildApp({ dbPath: ":memory:", env, fetch: fetchImpl });
  await app.ready();
  try {
    const health = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "demo-client.a1suite.am" }
    });
    assert.equal(health.statusCode, 200, health.body);
    assert.deepEqual(health.json().platformTenant, { enabled: true, resolved: true, strict: false });
    assert.ok(!health.body.includes("tenant-1"));
    assert.ok(!health.body.includes("demo-client"));
    assert.ok(!health.body.includes("tenants/demo-client"));

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/platform/tenant",
      headers: { host: "demo-client.a1suite.am" }
    });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);

    const cookie = await login(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/platform/tenant",
      headers: { host: "demo-client.a1suite.am", cookie }
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.resolved, true);
    assert.equal(body.slug, "demo-client");
    assert.deepEqual(body.modules, ["studio", "crm"]);
    assert.equal(body.databaseUrlPresent, true);
    assert.equal(body.databaseUrl, undefined);
    assert.ok(!response.body.includes("postgresql://"));
    assert.ok(!response.body.includes("secret"));
    assert.ok(!response.body.includes("must-not-leak"));
    assert.equal(calls, 1);
  } finally {
    await app.close();
  }
});

test("platform tenant request host is sent through explicit header with real fetch", async () => {
  let receivedHost = "";
  let receivedRequestHost = "";
  const server = http.createServer((request, response) => {
    receivedHost = request.headers.host || "";
    receivedRequestHost = request.headers["x-a1-request-host"] || "";
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      tenant: {
        id: "tenant-real-fetch",
        orgId: "org-armosphera-demo",
        slug: "demo-client",
        status: "active",
        modules: [{ code: "studio", enabled: true }]
      }
    }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    const env = {
      A1_PLATFORM_TENANT_RESOLUTION: "1",
      A1_PLATFORM_API_URL: `http://127.0.0.1:${address.port}`
    };
    const tenant = await resolvePlatformTenant(
      { headers: { host: "demo-client.a1suite.am" } },
      env,
      globalThis.fetch
    );

    assert.equal(tenant.slug, "demo-client");
    assert.equal(receivedRequestHost, "demo-client.a1suite.am");
    assert.equal(receivedHost, `127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("platform tenant strict mode fails closed when platform returns no tenant", async () => {
  const env = {
    ...PLATFORM_ENV,
    A1_PLATFORM_TENANT_STRICT: "1"
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ tenant: null })
  });

  const app = buildApp({ dbPath: ":memory:", env, fetch: fetchImpl });
  await app.ready();
  try {
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { host: "missing-client.a1suite.am" } });
    assert.equal(response.statusCode, 404, response.body);
    assert.equal(response.json().error, "A1_PLATFORM_TENANT_NOT_FOUND");
  } finally {
    await app.close();
  }
});

test("platform tenant lookup fails open by default for non-blocking platform errors", async () => {
  const env = { ...PLATFORM_ENV };
  const fetchImpl = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: { code: "PLATFORM_TEMPORARY_UNAVAILABLE", message: "Platform unavailable" } })
  });

  const app = buildApp({ dbPath: ":memory:", env, fetch: fetchImpl });
  await app.ready();
  try {
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { host: "demo-client.a1suite.am" } });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().platformTenant, { enabled: true, resolved: false, strict: false });
  } finally {
    await app.close();
  }
});

test("platform tenant strict mode fails closed on lookup errors", async () => {
  const env = {
    ...PLATFORM_ENV,
    A1_PLATFORM_TENANT_STRICT: "1",
  };
  const fetchImpl = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: { code: "PLATFORM_TEMPORARY_UNAVAILABLE", message: "Platform unavailable" } })
  });

  const app = buildApp({ dbPath: ":memory:", env, fetch: fetchImpl });
  await app.ready();
  try {
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { host: "demo-client.a1suite.am" } });
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(response.json().error, "PLATFORM_TEMPORARY_UNAVAILABLE");
  } finally {
    await app.close();
  }
});

test("platform tenant strict errors are sanitized before returning to clients", async () => {
  const env = {
    ...PLATFORM_ENV,
    A1_PLATFORM_TENANT_STRICT: "1"
  };
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    json: async () => ({
      error: {
        code: "PLATFORM_AUTH_FAILED",
        message: "bad token platform-token with postgresql://a1:secret@postgres:5432/a1"
      }
    })
  });

  const app = buildApp({ dbPath: ":memory:", env, fetch: fetchImpl });
  await app.ready();
  try {
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { host: "demo-client.a1suite.am" } });
    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "PLATFORM_AUTH_FAILED");
    assert.equal(response.json().message, "A1 Platform tenant lookup failed");
    assert.ok(!response.body.includes("platform-token"));
    assert.ok(!response.body.includes("postgresql://"));
    assert.ok(!response.body.includes("secret"));
  } finally {
    await app.close();
  }
});

test("platform tenant lookup respects the outbound egress allowlist", async () => {
  const env = {
    A1_PLATFORM_TENANT_RESOLUTION: "1",
    A1_PLATFORM_API_URL: "http://platform.local"
  };
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({ tenant: null }) };
  };

  const app = buildApp({ dbPath: ":memory:", env, fetch: fetchImpl });
  await app.ready();
  try {
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { host: "demo-client.a1suite.am" } });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json().error, "EGRESS_BLOCKED");
    assert.equal(called, false);
  } finally {
    await app.close();
  }
});

test("platform tenant successful disabled payloads block Studio requests", async () => {
  const env = { ...PLATFORM_ENV };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      tenant: {
        id: "tenant-disabled",
        orgId: "org-armosphera-demo",
        slug: "demo-client",
        status: "disabled",
        modules: [{ code: "studio", enabled: true }]
      }
    })
  });

  const app = buildApp({ dbPath: ":memory:", env, fetch: fetchImpl });
  await app.ready();
  try {
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { host: "demo-client.a1suite.am" } });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json().error, "TENANT_DISABLED");
  } finally {
    await app.close();
  }
});

test("platform tenant successful module-disabled payloads block Studio requests", async () => {
  const env = { ...PLATFORM_ENV };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      tenant: {
        id: "tenant-module-disabled",
        orgId: "org-armosphera-demo",
        slug: "demo-client",
        status: "active",
        modules: [{ code: "studio", enabled: false }]
      }
    })
  });

  const app = buildApp({ dbPath: ":memory:", env, fetch: fetchImpl });
  await app.ready();
  try {
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { host: "demo-client.a1suite.am" } });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json().error, "MODULE_DISABLED");
  } finally {
    await app.close();
  }
});

test("platform tenant org mismatch rejects cross-host session replay", async () => {
  const env = { ...PLATFORM_ENV };
  const fetchImpl = async (url, options) => {
    const host = options.headers["x-a1-request-host"];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        tenant: {
          id: host === "other-client.a1suite.am" ? "tenant-other" : "tenant-demo",
          orgId: host === "other-client.a1suite.am" ? "org-other-tenant" : "org-armosphera-demo",
          slug: host === "other-client.a1suite.am" ? "other-client" : "demo-client",
          status: "active",
          modules: [{ code: "studio", enabled: true }]
        }
      })
    };
  };

  const app = buildApp({ dbPath: ":memory:", env, fetch: fetchImpl });
  await app.ready();
  try {
    const cookie = await login(app, "demo-client.a1suite.am");
    const response = await app.inject({
      method: "GET",
      url: "/api/platform/tenant",
      headers: { host: "other-client.a1suite.am", cookie }
    });
    assert.equal(response.statusCode, 403, response.body);
    assert.ok(response.body.includes("A1 platform tenant does not match this session"));
  } finally {
    await app.close();
  }
});

test("platform maintenance blocks Studio requests when tenant routing is enabled", async () => {
  const env = { ...PLATFORM_ENV };
  const fetchImpl = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: { code: "TENANT_MAINTENANCE", message: "Tenant is temporarily in maintenance" } })
  });

  const app = buildApp({ dbPath: ":memory:", env, fetch: fetchImpl });
  await app.ready();
  try {
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { host: "demo-client.a1suite.am" } });
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(response.json().error, "TENANT_MAINTENANCE");
    assert.ok(!response.body.includes("temporarily in maintenance"));
  } finally {
    await app.close();
  }
});
