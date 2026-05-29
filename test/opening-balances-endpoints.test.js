"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD } });
  return res.headers["set-cookie"];
}

test("opening-balances endpoints: auth, post, balanced statements, idempotent", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const unauth = await app.inject({ method: "GET", url: "/api/finance/opening-balances" });
    assert.strictEqual(unauth.statusCode, 401);
    const cookie = await login(app);
    const post = await app.inject({ method: "POST", url: "/api/finance/opening-balances", headers: { cookie },
      payload: { asOf: "2026-01-01", entries: [{ code: "251", amount: 1000000 }, { code: "521", amount: 400000 }] } });
    assert.strictEqual(post.statusCode, 200);
    assert.strictEqual(post.json().count, 2);
    assert.strictEqual(post.json().openingEquity, 600000);
    const st = await app.inject({ method: "GET", url: "/api/finance/statements", headers: { cookie } });
    assert.strictEqual(st.json().balanceSheet.balanced, true);
    assert.strictEqual(st.json().balanceSheet.totalEquity, 600000);
    // idempotent re-post
    await app.inject({ method: "POST", url: "/api/finance/opening-balances", headers: { cookie },
      payload: { asOf: "2026-01-01", entries: [{ code: "251", amount: 1000000 }, { code: "521", amount: 400000 }] } });
    const list = await app.inject({ method: "GET", url: "/api/finance/opening-balances", headers: { cookie } });
    assert.strictEqual(list.json().count, 2);
  } finally { await app.close(); }
});
