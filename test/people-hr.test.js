"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

test("people-hr: registry CRUD, write-gate, and payroll seam (employee -> payroll -> ledger)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();

    // Unauthenticated list -> 401
    const unauth = await app.inject({ method: "GET", url: "/api/people/employees" });
    assert.strictEqual(unauth.statusCode, 401);

    const owner = await login(app);
    const list = (await app.inject({ method: "GET", url: "/api/people/employees", headers: { cookie: owner } })).json();
    assert.ok(Array.isArray(list.employees) && list.employees.length >= 3, "seeded employees present");
    const anahit = list.employees.find(e => e.fullName.includes("Անահիտ"));
    assert.ok(anahit && anahit.grossSalary === 600000, "seeded Անահիտ has 600000 gross");

    // Create (Owner is a people writer)
    const created = await app.inject({
      method: "POST", url: "/api/people/employees", headers: { cookie: owner },
      payload: { fullName: "Գոռ Հովհաննիսյան", taxId: "12345678", position: "Developer", department: "Engineering", grossSalary: 800000, hireDate: "2026-01-10", email: "gor@armosphera.local" }
    });
    assert.strictEqual(created.statusCode, 200);
    const empId = created.json().employee.id;
    assert.strictEqual(created.json().employee.grossSalary, 800000);

    // Invalid ՀՎՀՀ (not 8 digits) -> 400
    const badTax = await app.inject({ method: "POST", url: "/api/people/employees", headers: { cookie: owner }, payload: { fullName: "Bad Tax", taxId: "123" } });
    assert.strictEqual(badTax.statusCode, 400);

    // Missing name -> 400
    const noName = await app.inject({ method: "POST", url: "/api/people/employees", headers: { cookie: owner }, payload: { grossSalary: 100000 } });
    assert.strictEqual(noName.statusCode, 400);

    // Write-gate: Auditor (read-only) cannot create -> 403
    const auditor = await login(app, "auditor@armosphera.local", DEFAULT_PASSWORD);
    const blocked = await app.inject({ method: "POST", url: "/api/people/employees", headers: { cookie: auditor }, payload: { fullName: "Should Fail" } });
    assert.strictEqual(blocked.statusCode, 403);

    // Patch: status + salary
    const patched = await app.inject({ method: "PATCH", url: `/api/people/employees/${empId}`, headers: { cookie: owner }, payload: { employmentStatus: "on-leave", grossSalary: 850000 } });
    assert.strictEqual(patched.statusCode, 200);
    assert.strictEqual(patched.json().employee.employmentStatus, "on-leave");
    assert.strictEqual(patched.json().employee.grossSalary, 850000);

    // Patch unknown employee -> 404
    const missing = await app.inject({ method: "PATCH", url: "/api/people/employees/nope", headers: { cookie: owner }, payload: { position: "x" } });
    assert.strictEqual(missing.statusCode, 404);

    // Payroll seam: run payroll FROM the registry (Անահիտ, gross 600000 -> net 436500 per the engine).
    // Use a non-seeded period (2099-03) to avoid the demo 2026-05 lock.
    const run = await app.inject({ method: "POST", url: `/api/people/employees/${anahit.id}/run-payroll`, headers: { cookie: owner }, payload: { runDate: "2099-03-15" } });
    assert.strictEqual(run.statusCode, 200);
    assert.strictEqual(run.json().run.gross, 600000);
    assert.strictEqual(run.json().run.net, 436500);
    assert.strictEqual(run.json().run.employeeName, anahit.fullName);

    // The run is persisted and visible in the payroll runs list
    const runs = (await app.inject({ method: "GET", url: "/api/payroll/runs", headers: { cookie: owner } })).json();
    assert.ok(runs.runs.some(r => r.net === 436500), "payroll run persisted");

    // Cannot run payroll for a terminated employee -> 409
    await app.inject({ method: "PATCH", url: `/api/people/employees/${empId}`, headers: { cookie: owner }, payload: { employmentStatus: "terminated" } });
    const termRun = await app.inject({ method: "POST", url: `/api/people/employees/${empId}/run-payroll`, headers: { cookie: owner }, payload: { runDate: "2099-03-15" } });
    assert.strictEqual(termRun.statusCode, 409);
  } finally { await app.close(); }
});

test("people-hr: cross-org isolation — a foreign employee is invisible (404, not 403)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);

    // Resolve the demo owner's org so we can seed a SEPARATE tenant.
    const ownerOrgId = app.db.prepare("SELECT org_id FROM users WHERE email = ?").get(DEFAULT_EMAIL).org_id;

    // Seed a second org (FK enforcement is ON) and an employee that belongs to it.
    const now = new Date().toISOString();
    const otherOrgId = "org-other-tenant";
    app.db.prepare(`INSERT INTO organizations (id, name, legal_name, tax_id, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(otherOrgId, "Other Tenant LLC", "Other Tenant LLC", "99999999", now);
    const foreignId = "emp-foreign-1";
    app.db.prepare(`INSERT INTO people_employees (id, org_id, full_name, tax_id, position, department, gross_salary, employment_status, hire_date, email, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(foreignId, otherOrgId, "Foreign Employee", "", "", "", 500000, "active", "", "", now, now);

    // The foreign employee must NOT appear in the owner's registry.
    const list = (await app.inject({ method: "GET", url: "/api/people/employees", headers: { cookie: owner } })).json();
    assert.ok(!list.employees.some(e => e.id === foreignId), "foreign employee leaked into owner registry");

    // PATCH a foreign employee -> 404 (resource invisible), NOT 403 (which would leak existence).
    const patch = await app.inject({ method: "PATCH", url: `/api/people/employees/${foreignId}`, headers: { cookie: owner }, payload: { position: "x" } });
    assert.strictEqual(patch.statusCode, 404);

    // run-payroll for a foreign employee -> 404 (cannot be scheduled across tenants).
    const run = await app.inject({ method: "POST", url: `/api/people/employees/${foreignId}/run-payroll`, headers: { cookie: owner }, payload: { runDate: "2099-04-15" } });
    assert.strictEqual(run.statusCode, 404);

    // Sanity: the foreign row still exists in its own tenant (we proved isolation, not deletion).
    const stillThere = app.db.prepare("SELECT org_id FROM people_employees WHERE id = ?").get(foreignId);
    assert.strictEqual(stillThere.org_id, otherOrgId);
    assert.notStrictEqual(otherOrgId, ownerOrgId);
  } finally { await app.close(); }
});

test("people-hr: payroll respects a closed finance period (409 PERIOD_LOCKED)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const orgId = app.db.prepare("SELECT org_id FROM users WHERE email = ?").get(DEFAULT_EMAIL).org_id;

    // Pick an open finance period and an active employee from the same tenant.
    const openPeriod = app.db.prepare("SELECT period_key FROM finance_periods WHERE org_id = ? AND status='open' LIMIT 1").get(orgId).period_key;
    const list = (await app.inject({ method: "GET", url: "/api/people/employees", headers: { cookie: owner } })).json();
    const employee = list.employees.find(e => e.employmentStatus === "active");
    assert.ok(employee, "an active seeded employee is available");

    // A run date inside the open period succeeds first (control).
    const runDate = `${openPeriod}-15`;
    const ok = await app.inject({ method: "POST", url: `/api/people/employees/${employee.id}/run-payroll`, headers: { cookie: owner }, payload: { runDate } });
    assert.strictEqual(ok.statusCode, 200);

    // Close that period, then a run dated inside it must be rejected with 409.
    const close = await app.inject({ method: "POST", url: `/api/finance/periods/${openPeriod}/close`, headers: { cookie: owner }, payload: { reason: "test close" } });
    assert.strictEqual(close.statusCode, 200);
    const locked = await app.inject({ method: "POST", url: `/api/people/employees/${employee.id}/run-payroll`, headers: { cookie: owner }, payload: { runDate } });
    assert.strictEqual(locked.statusCode, 409);
  } finally { await app.close(); }
});
