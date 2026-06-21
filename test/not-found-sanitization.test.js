"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");

test("route not found responses do not echo unsafe request paths", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();

    const unsafeRequests = [
      ["POST", `/api/integrations/webhook-deliveries/${"a".repeat(161)}secret-webhook-delivery-overlong-token/retry`],
      ["POST", `/api/service/cases/${"a".repeat(161)}secret-service-reply-overlong-path-token/replies`],
      ["POST", `/api/workflow/rules/${"a".repeat(161)}secret-workflow-rule-overlong-token/state`],
      ["PATCH", `/api/forms/${"a".repeat(161)}secret-forms-patch-overlong-token`],
      ["GET", `/api/customer-360/${"a".repeat(161)}secret-customer-360-overlong-token`]
    ];

    for (const [method, url] of unsafeRequests) {
      const response = await app.inject({ method, url });
      assert.strictEqual(response.statusCode, 404, response.body);
      assert.deepStrictEqual(response.json(), {
        statusCode: 404,
        error: "Not Found",
        message: "Route not found"
      });
      assert.doesNotMatch(response.body, /secret-(webhook-delivery|service|workflow-rule|forms-patch-overlong|customer-360)-/);
      assert.doesNotMatch(response.body, /Route [A-Z]+:/);
    }
  } finally {
    await app.close();
  }
});
