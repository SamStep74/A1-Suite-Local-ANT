"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

async function getEmployeeId(app, cookie) {
  const res = await app.inject({ method: "GET", url: "/api/people/employees", headers: { cookie } });
  return res.json().employees[0].id;
}

test("hr: contract creation is auth-gated", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/hr/contracts",
      payload: { templateCode: "permanent", startDate: "2026-07-01", grossSalary: 600000, position: "Engineer", idempotencyKey: "hr-c-401" }
    });
    assert.strictEqual(res.statusCode, 401);
  } finally { await app.close(); }
});

test("hr: contract creation requires people app access", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/hr/contracts",
      headers: { cookie },
      payload: { templateCode: "permanent", startDate: "2026-07-01", grossSalary: 600000, position: "Engineer", idempotencyKey: "hr-c-403" }
    });
    assert.strictEqual(res.statusCode, 403);
  } finally { await app.close(); }
});

test("hr: contract creation validates input", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/hr/contracts",
      headers: { cookie },
      payload: { templateCode: "permanent" }
    });
    assert.strictEqual(res.statusCode, 400);
  } finally { await app.close(); }
});

test("hr: contract creation returns a rendered body and writes an audit row", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const employeeId = await getEmployeeId(app, cookie);
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    const res = await app.inject({
      method: "POST",
      url: "/api/hr/contracts",
      headers: { cookie },
      payload: {
        employeeId,
        templateCode: "permanent",
        startDate: "2026-07-01",
        grossSalary: 600000,
        position: "Senior Engineer",
        idempotencyKey: "hr-c-200"
      }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(body.contract.id.startsWith("emp-ct-"));
    assert.ok(/ՀՀ Աշխատանքային օրենսգիրք/.test(body.contract.bodyMd));
    assert.strictEqual(body.contract.grossSalary, 600000);
    const after = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    assert.strictEqual(after, before + 1);
  } finally { await app.close(); }
});

test("hr: contract creation is idempotent on replay", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const employeeId = await getEmployeeId(app, cookie);
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    const payload = {
      method: "POST", url: "/api/hr/contracts", headers: { cookie },
      payload: {
        employeeId, templateCode: "permanent", startDate: "2026-07-01",
        grossSalary: 600000, position: "Senior Engineer", idempotencyKey: "hr-c-idem"
      }
    };
    const first = await app.inject(payload);
    const second = await app.inject(payload);
    assert.strictEqual(first.statusCode, 200);
    assert.strictEqual(second.statusCode, 200);
    assert.deepStrictEqual(first.json(), second.json());
    const after = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    assert.strictEqual(after, before + 1);
  } finally { await app.close(); }
});

test("hr: leave request, balance check, approval, and order issuance flow end-to-end", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const employeeId = await getEmployeeId(app, cookie);

    // 1. Request leave
    const requestRes = await app.inject({
      method: "POST", url: "/api/hr/leave-requests", headers: { cookie },
      payload: { employeeId, kind: "annual", startDate: "2026-08-01", endDate: "2026-08-10", reason: "արձակուրդ", idempotencyKey: "hr-l-1" }
    });
    assert.strictEqual(requestRes.statusCode, 200, requestRes.body);
    const requestId = requestRes.json().leaveRequest.id;
    assert.strictEqual(requestRes.json().leaveRequest.days, 8);

    // 2. Balance for 2026
    const balanceRes = await app.inject({
      method: "GET", url: `/api/hr/leave-balances?employeeId=${employeeId}&year=2026`, headers: { cookie }
    });
    assert.strictEqual(balanceRes.statusCode, 200);
    const balance = balanceRes.json().balances.find(b => b.kind === "annual");
    assert.ok(balance && balance.entitledDays >= 20, "RA Labor Code default 20 working days/year");

    // 3. Approve
    const approveRes = await app.inject({
      method: "POST", url: `/api/hr/leave-requests/${requestId}/approve`, headers: { cookie },
      payload: { decision: "approved", idempotencyKey: "hr-l-app" }
    });
    assert.strictEqual(approveRes.statusCode, 200, approveRes.body);
    assert.strictEqual(approveRes.json().leaveRequest.status, "approved");

    // 4. Issue vacation order
    const orderRes = await app.inject({
      method: "POST", url: "/api/hr/orders", headers: { cookie },
      payload: { employeeId, orderType: "vacation", effectiveDate: "2026-08-01", idempotencyKey: "hr-o-1" }
    });
    assert.strictEqual(orderRes.statusCode, 200, orderRes.body);
    assert.ok(/Հրաման/.test(orderRes.json().order.bodyMd));
  } finally { await app.close(); }
});

test("hr: leave balance math subtracts used days", async () => {
  const { computeLeaveBalance } = require("../server/hr");
  const balance = computeLeaveBalance({
    entitled: 20,
    carriedOver: 4,
    approved: [{ kind: "annual", days: 5 }, { kind: "annual", days: 3 }]
  });
  assert.strictEqual(balance.remaining, 16);
  assert.strictEqual(balance.used, 8);
});

test("hr: business-trip allowance = per-diem × days + transport", async () => {
  const { computeTripAllowance } = require("../server/hr");
  const allowance = computeTripAllowance({ perDiemAmd: 12000, days: 7, transportationAmd: 45000 });
  assert.strictEqual(allowance.total, 12000 * 7 + 45000);
});

test("hr: timesheet weekly aggregation", async () => {
  const { aggregateTimesheet } = require("../server/hr");
  const report = aggregateTimesheet({
    entries: [
      { workDate: "2026-06-01", hours: 8, projectId: "p1" },
      { workDate: "2026-06-02", hours: 8, projectId: "p1" },
      { workDate: "2026-06-03", hours: 6, projectId: "p2" },
      { workDate: "2026-06-04", hours: 8, projectId: "p1" },
      { workDate: "2026-06-05", hours: 4, projectId: "p1" }
    ]
  });
  assert.strictEqual(report.totalHours, 34);
  assert.strictEqual(report.byProject.p1, 28);
  assert.strictEqual(report.byProject.p2, 6);
});

test("hr: KPI weighted score uses targets + actuals", async () => {
  const { scoreKpi } = require("../server/hr");
  const score = scoreKpi({
    targets: [
      { metric: "revenue", target: 100, weight: 0.6 },
      { metric: "nps", target: 50, weight: 0.4 }
    ],
    actuals: [
      { metric: "revenue", actual: 120 },
      { metric: "nps", actual: 40 }
    ]
  });
  // revenue: min(120/100, 1) * 100 = 100; nps: 40/50 * 100 = 80; weighted = 100*0.6 + 80*0.4 = 92
  assert.strictEqual(score.weighted, 92);
});

test("hr: turnover rate = leavers / average headcount", async () => {
  const { computeTurnover } = require("../server/hr");
  const out = computeTurnover({ startHeadcount: 100, endHeadcount: 110, leavers: 6 });
  assert.strictEqual(out.rate, 0.057);
});

test("hr: job-description draft cites Armenian Labor Code only when legal source is active", async () => {
  const { generateJobDescription } = require("../server/hr");
  const base = generateJobDescription({ position: "Senior Engineer", language: "hy-AM", legalSources: [] });
  assert.ok(!/ՀՀ Աշխատանքային օրենսգիրք/.test(base.body));
  const active = generateJobDescription({
    position: "Senior Engineer", language: "hy-AM",
    legalSources: [{ id: "law-labor-am", status: "active", title: "ՀՀ Աշխատանքային օրենսգիրք" }]
  });
  assert.ok(/ՀՀ Աշխատանքային օրենսգիրք/.test(active.body));
});
