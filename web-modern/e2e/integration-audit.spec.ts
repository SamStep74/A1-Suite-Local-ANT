// e2e/integration-audit.spec.ts — Comprehensive Playwright audit.
//
// Visits every major page in the app to identify errors, broken links,
// and inconsistencies. Uses the server's built-in seed data (no manual
// seeding needed).
//
// Run:
//   1. Start the server: cd ~/dev/armosphera/src/A1-Suite-Local-ANT
//      ARMOSPHERA_ONE_DB=/tmp/a1-test.db PORT=4100 node server/index.js
//   2. Start the SPA:    cd web-modern && npm run dev
//   3. Run:              npx playwright test e2e/integration-audit.spec.ts

import { test, expect, type Page } from "@playwright/test";
import { FASTIFY_URL, BASE_URL } from "./_helpers";

// --- 1. CONSISTENCY CHECKS (API level, no browser) ---

test("@audit /api/health returns 200 + ok:true", async ({ request }) => {
  const res = await request.get(`${FASTIFY_URL}/api/health`);
  expect(res.status(), "/api/health should be 200").toBe(200);
  const body = await res.json();
  expect(body.ok, "/api/health should return ok: true").toBe(true);
});

test("@audit /api/this-does-not-exist returns 404 (not 200/500)", async ({ request }) => {
  // Per healthcheck.sh: a /api/* path that 200s (rather than 404s) is
  // a sign the Fastify is not properly routing (SPA shell fallback)
  const res = await request.get(`${FASTIFY_URL}/api/this-does-not-exist`);
  expect(res.status(), "/api/this-does-not-exist should 404 (not 200/500)").toBe(404);
});

test("@audit /api/suite returns 200 (with auth)", async ({ request }) => {
  // First login to get a sid
  const loginRes = await request.post(`${FASTIFY_URL}/api/login`, {
    headers: { "Content-Type": "application/json" },
    data: { email: "owner@armosphera.local", password: "change-me-now" },
  });
  expect(loginRes.status(), "login should be 200").toBe(200);
  const body = await loginRes.json();
  const sid = body.sid;
  expect(sid, "login should return a sid").toBeTruthy();

  // Then GET /api/suite
  const res = await request.get(`${FASTIFY_URL}/api/suite`, {
    headers: { cookie: `sid=${sid}` },
  });
  expect(res.status(), "/api/suite should be 200").toBe(200);
  const suite = await res.json();
  expect(suite.organization, "suite should return an organization").toBeTruthy();
  expect(Array.isArray(suite.apps), "suite should return apps array").toBe(true);
});

// --- 2. VISIT EVERY MAJOR PAGE ---

const pages = [
  { name: "Topbar Home", path: "/app" },
  { name: "Analytics", path: "/app/analytics" },
  { name: "CRM Customers", path: "/app/crm/customers" },
  { name: "CRM Deals", path: "/app/crm/deals" },
  { name: "CRM Tasks", path: "/app/crm/tasks" },
  { name: "CRM Quotes", path: "/app/crm/quotes" },
  { name: "Ask AI", path: "/app/ask-ai" },
  { name: "Settings", path: "/app/settings" },
  { name: "Procurement", path: "/app/procurement" },
  { name: "Greenhouse", path: "/app/greenhouse" },
  { name: "Fleet", path: "/app/fleet" },
  { name: "Export Docs", path: "/app/export-docs" },
  { name: "Compliance", path: "/app/compliance" },
  { name: "CFO Reports", path: "/app/cfo-reports" },
  { name: "Period Close", path: "/app/period-close" },
  { name: "OAuth Integrations", path: "/app/oauth-integrations" },
];

for (const { name, path } of pages) {
  test(`@audit visit ${name} (${path})`, async ({ page }) => {
    const errors: string[] = [];
    const failedRequests: string[] = [];

    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(`console: ${msg.text()}`);
      }
    });
    page.on("requestfailed", (req) => {
      const url = req.url();
      if (url.includes("localhost") || url.includes("127.0.0.1")) {
        failedRequests.push(`${req.failure()?.errorText} ${url}`);
      }
    });
    page.on("response", (res) => {
      if (res.status() >= 500) {
        failedRequests.push(`HTTP ${res.status()} ${res.url()}`);
      }
    });

    const response = await page.goto(BASE_URL + path, { waitUntil: "domcontentloaded" });
    expect(response, `${name} should respond`).not.toBeNull();
    expect(
      response!.status(),
      `${name} should be 2xx or 3xx (was ${response!.status()})`,
    ).toBeLessThan(500);

    // Wait for app to settle
    await page.waitForTimeout(500);

    // Log errors
    if (errors.length > 0) {
      console.log(`\n[${name}] page errors:`);
      errors.forEach((e) => console.log(`  ${e}`));
    }
    if (failedRequests.length > 0) {
      console.log(`\n[${name}] failed requests:`);
      failedRequests.forEach((r) => console.log(`  ${r}`));
    }

    // The page should have SOMETHING (not a blank 404)
    const bodyText = await page.locator("body").innerText();
    expect(
      bodyText.trim().length,
      `${name} should have content`,
    ).toBeGreaterThan(50);
  });
}
