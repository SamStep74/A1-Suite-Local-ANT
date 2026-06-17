"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Isolate the AI settings file per test process (settings are written to the data dir).
process.env.ARMOSPHERA_ONE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aoc-ai-endpoints-"));

const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

test("AI settings round-trip: save key/models/open-notebook, read back redacted", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);

    const before = await app.inject({ method: "GET", url: "/api/ai/settings", headers: { cookie } });
    assert.strictEqual(before.statusCode, 200, before.body);
    const b = before.json();
    assert.strictEqual(b.provider, "openrouter");
    assert.strictEqual(b.settings.openrouterApiKeySet, false);
    assert.ok(b.settings.models && Object.prototype.hasOwnProperty.call(b.settings.models, "copilot"));
    assert.strictEqual(b.settings.openNotebook.enabled, false);

    const put = await app.inject({
      method: "PUT", url: "/api/ai/settings", headers: { cookie },
      payload: {
        openrouterApiKey: "sk-or-secret-123",
        models: { default: "anthropic/claude-3.5-sonnet", copilot: "openai/gpt-4o", finance: "openai/gpt-4o-mini" },
        openNotebook: { enabled: true, baseUrl: "https://nb.a1.am/", apiKey: "on-secret" }
      }
    });
    assert.strictEqual(put.statusCode, 200, put.body);
    const p = put.json();
    assert.strictEqual(p.ok, true);
    assert.strictEqual(p.settings.openrouterApiKeySet, true);
    assert.strictEqual(p.settings.openrouterApiKey, undefined, "raw OpenRouter key must never be returned");
    assert.strictEqual(p.settings.models.default, "anthropic/claude-3.5-sonnet");
    assert.strictEqual(p.settings.openNotebook.enabled, true);
    assert.strictEqual(p.settings.openNotebook.baseUrl, "https://nb.a1.am", "trailing slash trimmed");
    assert.strictEqual(p.settings.openNotebook.apiKeySet, true);
    assert.strictEqual(p.settings.openNotebook.apiKey, undefined);

    // Whole response must not leak either raw secret.
    assert.ok(!put.body.includes("sk-or-secret-123"));
    assert.ok(!put.body.includes("on-secret"));

    const after = await app.inject({ method: "GET", url: "/api/ai/settings", headers: { cookie } });
    assert.strictEqual(after.json().settings.models.copilot, "openai/gpt-4o");
  } finally {
    await app.close();
  }
});

test("GET /api/ai/models always returns a non-empty menu (fallback when egress off)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({ method: "GET", url: "/api/ai/models", headers: { cookie } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const j = res.json();
    assert.strictEqual(j.provider, "openrouter");
    assert.strictEqual(j.online, false, "egress is off in tests");
    assert.strictEqual(j.source, "fallback");
    assert.ok(Array.isArray(j.models) && j.models.length > 0, "dropdown is never empty");
    assert.ok(j.models[0].id && j.models[0].name);
  } finally {
    await app.close();
  }
});

test("POST /api/ai/ask returns the existing Ask AI response contract", async () => {
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "disabled";
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/ai/ask",
      headers: { cookie },
      payload: {
        question: "What should I review?",
        context: {
          app: "finance",
          entity: "invoices",
          rawPath: "/app/finance/invoices",
        },
        idempotencyKey: "ask-contract-1",
      },
    });

    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(typeof body.answer, "string");
    assert.ok(body.answer.includes("What should I review?"));
    assert.deepStrictEqual(body.citations, [
      {
        kind: "route",
        id: "finance:invoices",
        app: "finance",
        label: "invoices",
        href: "/app/finance/invoices",
      },
    ]);
    assert.strictEqual(body.tokensUsed, 0);
    assert.strictEqual(body.idempotencyKey, "ask-contract-1");
  } finally {
    if (previousProvider === undefined) {
      delete process.env.AI_PROVIDER;
    } else {
      process.env.AI_PROVIDER = previousProvider;
    }
    await app.close();
  }
});

test("POST /api/ai/ask rejects users without the requested app assignment", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const disabled = await app.inject({
      method: "POST",
      url: "/api/apps/finance/assign",
      headers: { cookie: owner },
      payload: { role: "Operator", enabled: false },
    });
    assert.strictEqual(disabled.statusCode, 200, disabled.body);

    const operator = await login(app, "operator@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/ai/ask",
      headers: { cookie: operator },
      payload: {
        question: "Show finance health",
        context: { app: "finance" },
      },
    });
    assert.strictEqual(res.statusCode, 403, res.body);
  } finally {
    await app.close();
  }
});

test("POST /api/ai/ask maps extension routes to assigned apps", async () => {
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "disabled";
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/ai/ask",
      headers: { cookie: operator },
      payload: {
        question: "Help me finish this form",
        context: { app: "forms", rawPath: "/app/forms" },
        idempotencyKey: "ask-forms-role-route-1",
      },
    });

    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(res.json().idempotencyKey, "ask-forms-role-route-1");
  } finally {
    if (previousProvider === undefined) {
      delete process.env.AI_PROVIDER;
    } else {
      process.env.AI_PROVIDER = previousProvider;
    }
    await app.close();
  }
});

test("POST /api/ai/ask maps cabinet routes to Docs app access", async () => {
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "disabled";
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const salesperson = await login(app, "sales@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/ai/ask",
      headers: { cookie: salesperson },
      payload: {
        question: "Summarize this cabinet document",
        context: { app: "cabinet", rawPath: "/app/cabinet" },
        idempotencyKey: "ask-cabinet-docs-route-1",
      },
    });

    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(res.json().idempotencyKey, "ask-cabinet-docs-route-1");
  } finally {
    if (previousProvider === undefined) {
      delete process.env.AI_PROVIDER;
    } else {
      process.env.AI_PROVIDER = previousProvider;
    }
    await app.close();
  }
});

test("POST /api/ai/ask preserves general Ask AI page access for legacy roles", async () => {
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "disabled";
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/ai/ask",
      headers: { cookie: operator },
      payload: {
        question: "What can I ask from here?",
        context: { app: "copilot", rawPath: "/app/ask-ai" },
        idempotencyKey: "ask-general-page-operator-1",
      },
    });

    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(res.json().idempotencyKey, "ask-general-page-operator-1");
  } finally {
    if (previousProvider === undefined) {
      delete process.env.AI_PROVIDER;
    } else {
      process.env.AI_PROVIDER = previousProvider;
    }
    await app.close();
  }
});

test("POST /api/ai/ask lets app users use saved OpenRouter settings and filters blank citations", async () => {
  const previousAllowEgress = process.env.ARMOSPHERA_ONE_ALLOW_EGRESS;
  const previousAllowlist = process.env.ARMOSPHERA_ONE_EGRESS_ALLOWLIST;
  const previousFetch = globalThis.fetch;
  const calls = [];
  process.env.ARMOSPHERA_ONE_ALLOW_EGRESS = "1";
  process.env.ARMOSPHERA_ONE_EGRESS_ALLOWLIST = "openrouter.ai";
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                answer: "Use the finance dashboard.",
                citations: [
                  { kind: "route", id: "finance", app: "finance", label: "Finance", href: "/app/finance" },
                  { kind: "route", id: "bad-app", app: "", label: "Bad", href: "/app/bad" },
                  { kind: "route", id: "bad-href", app: "finance", label: "Bad href", href: "" }
                ],
                tokensUsed: 7
              })
            }
          }]
        });
      }
    };
  };

  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const settings = await app.inject({
      method: "PUT",
      url: "/api/ai/settings",
      headers: { cookie: owner },
      payload: {
        openrouterApiKey: "sk-or-test-ask",
        models: { default: "openai/gpt-4o-mini" }
      }
    });
    assert.strictEqual(settings.statusCode, 200, settings.body);

    const operator = await login(app, "operator@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/ai/ask",
      headers: { cookie: operator },
      payload: {
        question: "Where next?",
        context: { app: "finance" },
        idempotencyKey: "ask-provider-1"
      }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.answer, "Use the finance dashboard.");
    assert.deepStrictEqual(body.citations, [
      { kind: "route", id: "finance", app: "finance", label: "Finance", href: "/app/finance" }
    ]);
    assert.strictEqual(body.tokensUsed, 7);
    assert.strictEqual(body.idempotencyKey, "ask-provider-1");
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(JSON.parse(calls[0].init.body).model, "openai/gpt-4o-mini");
    assert.strictEqual(calls[0].init.headers.Authorization, "Bearer sk-or-test-ask");
  } finally {
    if (previousAllowEgress === undefined) delete process.env.ARMOSPHERA_ONE_ALLOW_EGRESS;
    else process.env.ARMOSPHERA_ONE_ALLOW_EGRESS = previousAllowEgress;
    if (previousAllowlist === undefined) delete process.env.ARMOSPHERA_ONE_EGRESS_ALLOWLIST;
    else process.env.ARMOSPHERA_ONE_EGRESS_ALLOWLIST = previousAllowlist;
    globalThis.fetch = previousFetch;
    await app.close();
  }
});

test("PUT /api/ai/settings validates input (400 on bad baseUrl and non-string key)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const badUrl = await app.inject({
      method: "PUT", url: "/api/ai/settings", headers: { cookie },
      payload: { openNotebook: { baseUrl: "ftp://nope" } }
    });
    assert.strictEqual(badUrl.statusCode, 400, badUrl.body);

    const badKey = await app.inject({
      method: "PUT", url: "/api/ai/settings", headers: { cookie },
      payload: { openrouterApiKey: 12345 }
    });
    assert.strictEqual(badKey.statusCode, 400, badKey.body);
  } finally {
    await app.close();
  }
});

test("AI settings are Owner-only (Operator is forbidden)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const operator = await login(app, "operator@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({ method: "GET", url: "/api/ai/settings", headers: { cookie: operator } });
    assert.strictEqual(res.statusCode, 403, res.body);
  } finally {
    await app.close();
  }
});
