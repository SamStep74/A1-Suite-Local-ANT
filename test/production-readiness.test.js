"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

async function reviewSource(app, cookie, sourceId, roleLabel) {
  const source = app.db.prepare("SELECT title, source_url AS sourceUrl, effective_date AS effectiveDate FROM legal_sources WHERE id = ?").get(sourceId);
  assert.ok(source, `${sourceId} seeded`);
  const res = await app.inject({
    method: "POST",
    url: `/api/legal/sources/${sourceId}/reviews`,
    headers: { cookie },
    payload: {
      title: `${source.title} - ${roleLabel} reviewed`,
      sourceUrl: source.sourceUrl,
      effectiveDate: source.effectiveDate,
      status: "active",
      reviewNote: `${roleLabel} confirmed this source for production readiness.`
    }
  });
  assert.strictEqual(res.statusCode, 200, res.body);
}

test("production readiness gate blocks production while legal/accounting sources need review", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const beforeReviews = app.db.prepare("SELECT COUNT(*) AS count FROM legal_source_reviews").get().count;

    const res = await app.inject({
      method: "GET",
      url: "/api/compliance/production-readiness?asOf=2026-05-31",
      headers: { cookie }
    });

    assert.strictEqual(res.statusCode, 200, res.body);
    const gate = res.json().readiness;
    assert.strictEqual(gate.status, "blocked");
    assert.strictEqual(gate.reviewRequired, true);
    assert.strictEqual(gate.asOf, "2026-05-31");
    assert.ok(gate.gates.some(item => item.key === "law-tax-code" && item.pass === false && item.ownerRole === "Accountant"));
    assert.ok(gate.gates.some(item => item.key === "law-personal-data" && item.pass === false && item.ownerRole === "Lawyer"));
    assert.ok(gate.gates.some(item => item.key === "tax-rate-vat-current" && item.pass === true));
    assert.ok(gate.gates.some(item => item.key === "tax-rate-payroll-current" && item.pass === true));
    assert.ok(gate.blockers.length >= 3, "legal sources block production");
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM legal_source_reviews").get().count, beforeReviews, "readiness gate is read-only");
  } finally {
    await app.close();
  }
});

test("production readiness gate becomes ready after required professional reviews", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    await reviewSource(app, cookie, "law-tax-code", "Accountant");
    await reviewSource(app, cookie, "law-personal-data", "Lawyer");
    await reviewSource(app, cookie, "law-esign", "Lawyer");

    const res = await app.inject({
      method: "GET",
      url: "/api/compliance/production-readiness?asOf=2026-05-31",
      headers: { cookie }
    });

    assert.strictEqual(res.statusCode, 200, res.body);
    const gate = res.json().readiness;
    assert.strictEqual(gate.status, "ready");
    assert.strictEqual(gate.reviewRequired, false);
    assert.strictEqual(gate.summary.blocked, 0);
    assert.strictEqual(gate.summary.passed, gate.summary.total);
    assert.ok(gate.gates.every(item => item.pass === true));
  } finally {
    await app.close();
  }
});

test("production readiness gate is limited to review roles", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const supportCookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const accountantCookie = await login(app, "accountant@armosphera.local", DEFAULT_PASSWORD);

    const blocked = await app.inject({
      method: "GET",
      url: "/api/compliance/production-readiness",
      headers: { cookie: supportCookie }
    });
    assert.strictEqual(blocked.statusCode, 403);

    const allowed = await app.inject({
      method: "GET",
      url: "/api/compliance/production-readiness",
      headers: { cookie: accountantCookie }
    });
    assert.strictEqual(allowed.statusCode, 200, allowed.body);
  } finally {
    await app.close();
  }
});
