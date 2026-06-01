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

test("platform tenant null lookup still fails open for authenticated routes outside strict mode", async () => {
  const env = { ...PLATFORM_ENV };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ tenant: null })
  });

  const app = buildApp({ dbPath: ":memory:", env, fetch: fetchImpl });
  await app.ready();
  try {
    const cookie = await login(app, "missing-client.a1suite.am");
    const response = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { host: "missing-client.a1suite.am", cookie }
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().organization.id, "org-armosphera-demo");
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

test("platform tenant resolved without org mapping rejects authenticated routes outside strict mode", async () => {
  const env = { ...PLATFORM_ENV };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      tenant: {
        id: "tenant-unmapped-auth",
        slug: "unmapped-auth",
        status: "active",
        modules: [{ code: "studio", enabled: true }]
      }
    })
  });

  const app = buildApp({ dbPath: ":memory:", env, fetch: fetchImpl });
  await app.ready();
  try {
    const health = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "unmapped-auth.a1suite.am" }
    });
    assert.equal(health.statusCode, 200, health.body);
    assert.deepEqual(health.json().platformTenant, { enabled: true, resolved: true, strict: false });

    const cookie = await login(app, "unmapped-auth.a1suite.am");
    for (const url of ["/api/me", "/api/suite", "/api/platform/tenant"]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { host: "unmapped-auth.a1suite.am", cookie }
      });
      assert.equal(response.statusCode, 403, `${url}: ${response.body}`);
      assert.ok(response.body.includes("A1 platform tenant is not mapped to this organization"));
    }
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

test("platform tenant binding hides public forms from the wrong tenant host", async () => {
  const env = { ...PLATFORM_ENV };
  const fetchImpl = platformTenantFetchByHost();
  const app = buildApp({ dbPath: ":memory:", env, fetch: fetchImpl });
  await app.ready();
  try {
    const goodPage = await app.inject({
      method: "GET",
      url: "/f/form-lead-intake",
      headers: { host: "demo-client.a1suite.am" }
    });
    assert.equal(goodPage.statusCode, 200, goodPage.body);

    const wrongPage = await app.inject({
      method: "GET",
      url: "/f/form-lead-intake",
      headers: { host: "other-client.a1suite.am" }
    });
    assert.equal(wrongPage.statusCode, 404, wrongPage.body);
    const missingPage = await app.inject({
      method: "GET",
      url: "/f/form-does-not-exist",
      headers: { host: "other-client.a1suite.am" }
    });
    assert.equal(wrongPage.headers["content-type"], missingPage.headers["content-type"]);
    assert.equal(wrongPage.body, missingPage.body);

    const before = app.db.prepare("SELECT COUNT(*) AS count FROM crm_leads WHERE org_id = ?").get("org-armosphera-demo").count;
    const wrongSubmit = await app.inject({
      method: "POST",
      url: "/api/forms/form-lead-intake/submit",
      headers: { host: "other-client.a1suite.am" },
      payload: {
        companyName: "Wrong Host LLC",
        contactName: "Wrong Host",
        email: "wrong@example.com",
        phone: "+374 99 000000",
        interest: "must not create a lead"
      }
    });
    assert.equal(wrongSubmit.statusCode, 404, wrongSubmit.body);
    const missingSubmit = await app.inject({
      method: "POST",
      url: "/api/forms/form-does-not-exist/submit",
      headers: { host: "other-client.a1suite.am" },
      payload: {
        companyName: "Missing Host LLC",
        contactName: "Missing Host",
        email: "missing@example.com"
      }
    });
    assert.equal(wrongSubmit.headers["content-type"], missingSubmit.headers["content-type"]);
    assert.equal(wrongSubmit.body, missingSubmit.body);
    const afterWrong = app.db.prepare("SELECT COUNT(*) AS count FROM crm_leads WHERE org_id = ?").get("org-armosphera-demo").count;
    assert.equal(afterWrong, before);

    const goodSubmit = await app.inject({
      method: "POST",
      url: "/api/forms/form-lead-intake/submit",
      headers: { host: "demo-client.a1suite.am" },
      payload: {
        companyName: "Tenant Match LLC",
        contactName: "Tenant Match",
        email: "match@example.com",
        phone: "+374 99 111111",
        interest: "tenant-bound form"
      }
    });
    assert.equal(goodSubmit.statusCode, 200, goodSubmit.body);
    const afterGood = app.db.prepare("SELECT COUNT(*) AS count FROM crm_leads WHERE org_id = ?").get("org-armosphera-demo").count;
    assert.equal(afterGood, before + 1);
  } finally {
    await app.close();
  }
});

test("platform tenant binding hides public quotes from the wrong tenant host", async () => {
  const env = { ...PLATFORM_ENV };
  const fetchImpl = platformTenantFetchByHost();
  const app = buildApp({ dbPath: ":memory:", env, fetch: fetchImpl });
  await app.ready();
  try {
    const token = "public-quote-ani-inbox-token";
    const goodQuote = await app.inject({
      method: "GET",
      url: `/api/public/quotes/${token}`,
      headers: { host: "demo-client.a1suite.am" }
    });
    assert.equal(goodQuote.statusCode, 200, goodQuote.body);

    const wrongQuote = await app.inject({
      method: "GET",
      url: `/api/public/quotes/${token}`,
      headers: { host: "other-client.a1suite.am" }
    });
    assert.equal(wrongQuote.statusCode, 404, wrongQuote.body);

    const wrongAccept = await app.inject({
      method: "POST",
      url: `/api/public/quotes/${token}/accept`,
      headers: { host: "other-client.a1suite.am" },
      payload: {
        signerName: "Wrong Host",
        signerEmail: "wrong@example.com",
        acceptedAt: "2026-05-26"
      }
    });
    assert.equal(wrongAccept.statusCode, 404, wrongAccept.body);
    const stillSent = app.db.prepare("SELECT status FROM quotes WHERE org_id = ? AND public_token = ?").get("org-armosphera-demo", token);
    assert.equal(stillSent.status, "sent");

    const goodAccept = await app.inject({
      method: "POST",
      url: `/api/public/quotes/${token}/accept`,
      headers: { host: "demo-client.a1suite.am" },
      payload: {
        signerName: "Tenant Match",
        signerEmail: "match@example.com",
        acceptedAt: "2026-05-26"
      }
    });
    assert.equal(goodAccept.statusCode, 200, goodAccept.body);
    assert.equal(goodAccept.json().quote.status, "accepted");
  } finally {
    await app.close();
  }
});

test("platform tenant binding hides public resources for unmapped tenant hosts", async () => {
  const env = { ...PLATFORM_ENV };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      tenant: {
        id: "tenant-unmapped",
        slug: "unmapped-client",
        status: "active",
        modules: [{ code: "studio", enabled: true }]
      }
    })
  });
  const app = buildApp({ dbPath: ":memory:", env, fetch: fetchImpl });
  await app.ready();
  try {
    const page = await app.inject({
      method: "GET",
      url: "/f/form-lead-intake",
      headers: { host: "unmapped-client.a1suite.am" }
    });
    assert.equal(page.statusCode, 404, page.body);
    const missingPage = await app.inject({
      method: "GET",
      url: "/f/form-does-not-exist",
      headers: { host: "unmapped-client.a1suite.am" }
    });
    assert.equal(page.headers["content-type"], missingPage.headers["content-type"]);
    assert.equal(page.body, missingPage.body);

    const submit = await app.inject({
      method: "POST",
      url: "/api/forms/form-lead-intake/submit",
      headers: { host: "unmapped-client.a1suite.am" },
      payload: {
        companyName: "Unmapped LLC",
        contactName: "Unmapped Host",
        email: "unmapped@example.com"
      }
    });
    assert.equal(submit.statusCode, 404, submit.body);
    const missingSubmit = await app.inject({
      method: "POST",
      url: "/api/forms/form-does-not-exist/submit",
      headers: { host: "unmapped-client.a1suite.am" },
      payload: {
        companyName: "Missing LLC",
        contactName: "Missing Host",
        email: "missing@example.com"
      }
    });
    assert.equal(submit.headers["content-type"], missingSubmit.headers["content-type"]);
    assert.equal(submit.body, missingSubmit.body);

    const token = "public-quote-ani-inbox-token";
    const quote = await app.inject({
      method: "GET",
      url: `/api/public/quotes/${token}`,
      headers: { host: "unmapped-client.a1suite.am" }
    });
    assert.equal(quote.statusCode, 404, quote.body);
    const missingQuote = await app.inject({
      method: "GET",
      url: "/api/public/quotes/public-quote-does-not-exist",
      headers: { host: "unmapped-client.a1suite.am" }
    });
    assert.equal(quote.headers["content-type"], missingQuote.headers["content-type"]);
    assert.equal(quote.body, missingQuote.body);

    const accept = await app.inject({
      method: "POST",
      url: `/api/public/quotes/${token}/accept`,
      headers: { host: "unmapped-client.a1suite.am" },
      payload: {
        signerName: "Unmapped Host",
        signerEmail: "unmapped@example.com",
        acceptedAt: "2026-05-26"
      }
    });
    assert.equal(accept.statusCode, 404, accept.body);
    const missingAccept = await app.inject({
      method: "POST",
      url: "/api/public/quotes/public-quote-does-not-exist/accept",
      headers: { host: "unmapped-client.a1suite.am" },
      payload: {
        signerName: "Missing Host",
        signerEmail: "missing@example.com",
        acceptedAt: "2026-05-26"
      }
    });
    assert.equal(accept.headers["content-type"], missingAccept.headers["content-type"]);
    assert.equal(accept.body, missingAccept.body);

    const leadCount = app.db.prepare("SELECT COUNT(*) AS count FROM crm_leads WHERE org_id = ? AND company_name = ?").get("org-armosphera-demo", "Unmapped LLC").count;
    assert.equal(leadCount, 0);
    const quoteStatus = app.db.prepare("SELECT status FROM quotes WHERE org_id = ? AND public_token = ?").get("org-armosphera-demo", token);
    assert.equal(quoteStatus.status, "sent");
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

function platformTenantFetchByHost() {
  return async (url, options) => {
    const host = options.headers["x-a1-request-host"];
    const other = host === "other-client.a1suite.am";
    return {
      ok: true,
      status: 200,
      json: async () => ({
        tenant: {
          id: other ? "tenant-other" : "tenant-demo",
          orgId: other ? "org-other-tenant" : "org-armosphera-demo",
          slug: other ? "other-client" : "demo-client",
          status: "active",
          modules: [{ code: "studio", enabled: true }]
        }
      })
    };
  };
}
