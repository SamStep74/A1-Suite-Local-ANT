"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

async function createBillableProject(app, cookie) {
  // A project linked to a customer, with 3 hours (180 min) of logged time.
  const proj = (await app.inject({ method: "POST", url: "/api/projects", headers: { cookie },
    payload: { name: "Billable delivery", customerId: "cust-ani", status: "active" } })).json().project.id;
  await app.inject({ method: "POST", url: `/api/projects/${proj}/time-entries`, headers: { cookie }, payload: { minutes: 120, entryDate: "2099-03-05", note: "build" } });
  await app.inject({ method: "POST", url: `/api/projects/${proj}/time-entries`, headers: { cookie }, payload: { minutes: 60, entryDate: "2099-03-06", note: "review" } });
  return proj;
}

test("project-billing: unbilled time → posted invoice → ledger; entries marked billed; idempotent", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const proj = await createBillableProject(app, owner);

    // Preview: 180 min @ 10000 AMD/hr = 30000 gross; VAT-inclusive split 25000 + 5000.
    const preview = (await app.inject({ method: "GET", url: `/api/projects/${proj}/billing-preview?hourlyRate=10000`, headers: { cookie: owner } })).json();
    assert.strictEqual(preview.preview.unbilledMinutes, 180);
    assert.strictEqual(preview.preview.total, 30000);
    assert.strictEqual(preview.preview.subtotal, 25000);
    assert.strictEqual(preview.preview.vat, 5000);

    // Bill it (use a non-seeded open period via issueDate 2099-03).
    const billed = await app.inject({ method: "POST", url: `/api/projects/${proj}/bill-time`, headers: { cookie: owner },
      payload: { hourlyRate: 10000, issueDate: "2026-05-15" } });
    assert.strictEqual(billed.statusCode, 200);
    assert.strictEqual(billed.json().idempotent, false);
    assert.strictEqual(billed.json().billedMinutes, 180);
    const invoiceId = billed.json().invoice.id;
    assert.strictEqual(billed.json().invoice.total, 30000);
    assert.strictEqual(billed.json().invoice.vat, 5000);

    // The ledger reconciles: 221 receivable = +30000 (25000 revenue + 5000 VAT), balanced.
    const tb = (await app.inject({ method: "GET", url: "/api/finance/trial-balance", headers: { cookie: owner } })).json();
    const byCode = {};
    for (const r of (tb.rows || tb.accounts || [])) byCode[String(r.code)] = (r.debit || 0) - (r.credit || 0);
    assert.strictEqual(byCode["221"], 30000, "receivable debit 30000");
    assert.strictEqual(byCode["611"], -25000, "revenue credit 25000");
    assert.strictEqual(byCode["524"], -5000, "output VAT credit 5000");

    // Re-billing the SAME project/period is idempotent — no second invoice, no double-bill.
    const again = await app.inject({ method: "POST", url: `/api/projects/${proj}/bill-time`, headers: { cookie: owner },
      payload: { hourlyRate: 10000, issueDate: "2026-05-15" } });
    assert.strictEqual(again.statusCode, 200);
    assert.strictEqual(again.json().idempotent, true);

    // After billing, there is no more unbilled time.
    const preview2 = (await app.inject({ method: "GET", url: `/api/projects/${proj}/billing-preview?hourlyRate=10000`, headers: { cookie: owner } })).json();
    assert.strictEqual(preview2.preview.unbilledMinutes, 0, "all time now billed");

    // A fresh time entry becomes newly billable (next period).
    await app.inject({ method: "POST", url: `/api/projects/${proj}/time-entries`, headers: { cookie: owner }, payload: { minutes: 30, entryDate: "2099-04-02" } });
    const preview3 = (await app.inject({ method: "GET", url: `/api/projects/${proj}/billing-preview?hourlyRate=10000`, headers: { cookie: owner } })).json();
    assert.strictEqual(preview3.preview.unbilledMinutes, 30, "new entry is unbilled");
  } finally { await app.close(); }
});

test("project-billing: guards — no customer (400), no unbilled time (400), finance gate (403)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);

    // Project WITHOUT a customer cannot be billed.
    const noCust = (await app.inject({ method: "POST", url: "/api/projects", headers: { cookie: owner }, payload: { name: "Internal project" } })).json().project.id;
    await app.inject({ method: "POST", url: `/api/projects/${noCust}/time-entries`, headers: { cookie: owner }, payload: { minutes: 60, entryDate: "2099-03-05" } });
    const noCustBill = await app.inject({ method: "POST", url: `/api/projects/${noCust}/bill-time`, headers: { cookie: owner }, payload: { hourlyRate: 10000, issueDate: "2026-05-15" } });
    assert.strictEqual(noCustBill.statusCode, 400);

    // A customer project with NO time -> 400 (nothing to bill).
    const empty = (await app.inject({ method: "POST", url: "/api/projects", headers: { cookie: owner }, payload: { name: "Empty", customerId: "cust-ani" } })).json().project.id;
    const emptyBill = await app.inject({ method: "POST", url: `/api/projects/${empty}/bill-time`, headers: { cookie: owner }, payload: { hourlyRate: 10000, issueDate: "2026-05-15" } });
    assert.strictEqual(emptyBill.statusCode, 400);

    // Finance gate: an Operator (Projects writer but NOT a finance operator) cannot bill -> 403.
    const proj = await createBillableProject(app, owner);
    const opLogin = await app.inject({ method: "POST", url: "/api/login", payload: { email: "operator@armosphera.local", password: DEFAULT_PASSWORD } });
    const opCookie = opLogin.headers["set-cookie"];
    const opBill = await app.inject({ method: "POST", url: `/api/projects/${proj}/bill-time`, headers: { cookie: opCookie }, payload: { hourlyRate: 10000, issueDate: "2026-05-15" } });
    assert.strictEqual(opBill.statusCode, 403);
  } finally { await app.close(); }
});
