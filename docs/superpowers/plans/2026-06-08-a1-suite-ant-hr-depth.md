# Sub-Plan 4: HR Depth (HR) — User Priority #4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move People-HR from "payroll registry" to operating HR. Add employee contracts (Armenian templates), leave management, business trips, timesheet, KPI tracking, equipment assignment, recruitment tube, and AI features (Armenian job-description generation, order generation, turnover analytics, performance review drafts).

**Architecture:** Pattern A module `server/hr.js` (pure engine: contract template selection, leave balance math, business-trip allowance, KPI score aggregation, turnover rate, AI job-description / order generators) + `web/src/people.jsx` extension (add Contracts / Leave / Trips / Timesheet / KPI / Recruitment tabs) + `test/hr.test.js`. Builds on the existing `employees` / `payroll_runs` tables. New tables: `employment_contracts`, `leave_requests`, `leave_balances`, `business_trips`, `timesheets`, `kpi_targets`, `kpi_actuals`, `equipment_assignments`, `recruitment_pipelines`, `recruitment_candidates`, `hr_orders`.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. Armenian contract templates stored as Markdown in `server/hr/templates/` (versioned in repo). AI generators use `server/copilot.js` pattern with a `server/hrAi.js` local-first helper gated by `ARMOSPHERA_ONE_ALLOW_EGRESS=1`.

**Depends on:** sub-plan 0 (Pattern A skeleton). Existing payroll + employees (`server/payroll.js`, `web/src/people.jsx`, `test/people-hr.test.js`).

---

## File Structure

- Create: `test/hr.test.js` — Pattern A contract suite for HR endpoints (auth, app access, validation, happy path, audit, idempotency).
- Create: `server/hr.js` — pure engine (no `node:sqlite` / `fastify` imports; `node --check` clean).
- Create: `server/hrAi.js` — local-first AI helper mirroring `server/copilot.js` (advisory-only, no `ok: true` mutations).
- Create: `server/hr/templates/contract-fixed-term.md`
- Create: `server/hr/templates/contract-permanent.md`
- Create: `server/hr/templates/contract-part-time.md`
- Create: `server/hr/templates/contract-intern.md`
- Create: `server/hr/templates/contract-remote.md`
- Create: `server/hr/templates/contract-secondment.md`
- Create: `server/hr/templates/order-vacation.md`
- Create: `server/hr/templates/order-business-trip.md`
- Create: `server/hr/templates/order-transfer.md`
- Create: `server/hr/templates/order-schedule-change.md`
- Create: `server/hr/templates/order-disciplinary.md`
- Create: `server/hr/templates/order-bonus.md`
- Create: `server/hr/templates/order-dismissal.md`
- Create: `server/hr/templates/order-hiring.md`
- Modify: `server/db.js` — add the 11 new table `CREATE TABLE IF NOT EXISTS` blocks.
- Modify: `server/app.js` — register the 18 HR routes after the existing people/payroll routes.
- Modify: `web/src/people.jsx` — add 6 new tabs (Contracts / Leave / Trips / Timesheet / KPI / Recruitment) reusing `.panel`, `.panel-head`, `.inline-form`, `.mini-action`, `.copilot-result`, `.row`, `.section-label`, `.aging-badge`.

## DB additions

```sql
CREATE TABLE IF NOT EXISTS employment_contracts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  template_code TEXT NOT NULL,
  signed_at TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT,
  gross_salary INTEGER NOT NULL,
  position TEXT NOT NULL,
  file_id TEXT,
  status TEXT NOT NULL,
  body_md TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days REAL NOT NULL,
  status TEXT NOT NULL,
  approver_id TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_balances (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  kind TEXT NOT NULL,
  entitled_days REAL NOT NULL,
  used_days REAL NOT NULL DEFAULT 0,
  carried_over REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS business_trips (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  destination TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  per_diem_amd INTEGER NOT NULL,
  transportation_amd INTEGER NOT NULL,
  status TEXT NOT NULL,
  approver_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timesheets (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  hours REAL NOT NULL,
  project_id TEXT,
  task_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kpi_targets (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  metric TEXT NOT NULL,
  target REAL NOT NULL,
  weight REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS kpi_actuals (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  metric TEXT NOT NULL,
  actual REAL NOT NULL,
  evidence_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS equipment_assignments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  returned_at TEXT,
  signature_doc_id TEXT
);

CREATE TABLE IF NOT EXISTS recruitment_pipelines (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  stage_order_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recruitment_candidates (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  pipeline_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  stage TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS hr_orders (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  order_type TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  body_md TEXT NOT NULL,
  issued_by TEXT NOT NULL,
  signed_at TEXT,
  file_id TEXT,
  created_at TEXT NOT NULL
);
```

## API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/hr/contracts` | Create contract from template |
| GET | `/api/hr/contracts/templates` | List Armenian templates |
| POST | `/api/hr/leave-requests` | Request leave |
| POST | `/api/hr/leave-requests/:id/approve` | Approve / reject |
| GET | `/api/hr/leave-balances` | Balance by `employeeId` + `year` |
| POST | `/api/hr/business-trips` | Create trip with per-diem + transport |
| POST | `/api/hr/timesheets/bulk` | Submit weekly timesheet |
| GET | `/api/hr/timesheets/report` | Aggregated hours by `periodKey` |
| POST | `/api/hr/kpis/targets` | Set KPI targets |
| POST | `/api/hr/kpis/actuals` | Record actuals + evidence |
| GET | `/api/hr/kpis/score` | Weighted score |
| POST | `/api/hr/equipment/assign` | Assign asset to employee (links to sub-plan 8) |
| POST | `/api/hr/recruitment/pipelines` | Create pipeline |
| POST | `/api/hr/recruitment/candidates` | Add candidate |
| POST | `/api/hr/orders` | Issue HR order (vacation, transfer, etc.) |
| POST | `/api/hr/ai/job-description` | AI generate JD (intent: hr-job-description) |
| POST | `/api/hr/ai/order` | AI draft order body (intent: hr-order) |
| GET | `/api/hr/analytics/turnover` | Turnover rate by `periodKey` |

## Cross-cutting spine reused

- `org_id` from `app.auth(request)`.
- `audit_events` row written on every successful mutation (uses `recordAudit(db, user, action, entityType, entityId, payload)`).
- `app_assignments` / `requireAppAccess(db, user, "people")` enforces people-app role.
- `idempotency_keys` dedupes replay; routes short-circuit on existing key and return cached envelope.
- `period_locks` checked when issuing `hr_orders` whose `effective_date` falls inside a locked payroll period.
- `legal_sources` queried by `generateJobDescription` to gate Armenian Labor Code citations.
- `employees` linked via `employee_id`; `assets` (sub-plan 8) referenced by `asset_id`; `vendors` referenced by `external_trainer_id` (for secondment templates).

## Tasks

### Task 1: Write the RED test file

**Files:**
- Create: `test/hr.test.js`
- Read: `test/healthcheck.test.js` (Pattern A contract template)
- Read: `test/people-hr.test.js` (HR domain conventions: `app.db.prepare`, AMD numbers, Armenian labels)

- [ ] **Step 1: Create the test file with the full Pattern A contract**

```js
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
```

- [ ] **Step 2: Run the test to verify RED**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/hr.test.js 2>&1 | tail -20
```

Expected: FAIL — `404` for `/api/hr/contracts` and `MODULE_NOT_FOUND` for `../server/hr`.

- [ ] **Step 3: Commit RED tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add test/hr.test.js && git commit -m "test(hr): define Pattern A contract for HR depth" && git push ant main
```

### Task 2: Add the pure engine module

**Files:**
- Create: `server/hr.js`
- Read: `server/copilot.js` (style of pure functions, no I/O)

- [ ] **Step 1: Create the engine**

```js
"use strict";

function contractVariables(input) {
  return {
    EMPLOYEE_NAME: String(input.employeeName || "[Անուն Ազգանուն]"),
    POSITION: String(input.position || "[Պաշտոն]"),
    START_DATE: String(input.startDate || ""),
    END_DATE: input.endDate ? String(input.endDate) : "անորոշ ժամկետով",
    GROSS_SALARY: Number(input.grossSalary || 0).toLocaleString("hy-AM"),
    ORG_NAME: String(input.orgName || "[Կազմակերպություն]"),
    SIGNED_AT: input.signedAt ? String(input.signedAt) : new Date().toISOString().slice(0, 10)
  };
}

function renderContract({ template, input }) {
  const vars = contractVariables(input);
  let body = String(template || "");
  for (const [key, value] of Object.entries(vars)) {
    body = body.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), value);
  }
  if (body.includes("{{") || body.includes("}}")) {
    const err = new Error("Contract template has unfilled placeholders");
    err.statusCode = 422;
    throw err;
  }
  return body;
}

function computeLeaveBalance({ entitled = 20, carriedOver = 0, approved = [] }) {
  const used = approved.reduce((sum, item) => sum + Number(item.days || 0), 0);
  return {
    entitled: Number(entitled),
    carriedOver: Number(carriedOver),
    used,
    remaining: Math.max(0, Number(entitled) + Number(carriedOver) - used)
  };
}

function computeTripAllowance({ perDiemAmd, days, transportationAmd = 0 }) {
  const perDiem = Math.max(0, Math.round(Number(perDiemAmd) || 0));
  const transport = Math.max(0, Math.round(Number(transportationAmd) || 0));
  const tripDays = Math.max(0, Number(days) || 0);
  return { perDiem, days: tripDays, transportation: transport, total: perDiem * tripDays + transport };
}

function aggregateTimesheet({ entries = [] }) {
  const byProject = {};
  let totalHours = 0;
  for (const entry of entries) {
    const hours = Number(entry.hours) || 0;
    totalHours += hours;
    if (entry.projectId) byProject[entry.projectId] = (byProject[entry.projectId] || 0) + hours;
  }
  return { totalHours, byProject, entryCount: entries.length };
}

function scoreKpi({ targets = [], actuals = [] }) {
  const totalWeight = targets.reduce((sum, t) => sum + Number(t.weight || 0), 0) || 1;
  let weighted = 0;
  const breakdown = targets.map(target => {
    const actual = actuals.find(a => a.metric === target.metric);
    const ratio = actual ? Number(actual.actual) / Number(target.target) : 0;
    const metricScore = Math.min(100, Math.max(0, ratio * 100));
    const weightedPart = metricScore * (Number(target.weight) / totalWeight);
    weighted += weightedPart;
    return { metric: target.metric, target: target.target, actual: actual ? actual.actual : null, metricScore, weight: target.weight };
  });
  return { weighted: Math.round(weighted * 100) / 100, breakdown };
}

function computeTurnover({ startHeadcount, endHeadcount, leavers }) {
  const average = (Number(startHeadcount) + Number(endHeadcount)) / 2 || 1;
  const rate = Number(leavers) / average;
  return { rate: Math.round(rate * 1000) / 1000, leavers, averageHeadcount: average };
}

const JD_BODY_ARMENIAN = [
  "Պաշտոն՝ {{POSITION}}",
  "Բաժին՝ {{ORG_NAME}}",
  "",
  "Հիմնական պարտականություններ՝",
  "- Կազմակերպության ռազմավարական նպատակներին հասնելու համար պատասխանատվություն ստանձնել",
  "- Թիմի հետ համագործակցություն եւ արդյունքների պարբերական վերանայում",
  "- Որակի չափանիշների պահպանում եւ բարելավում",
  "",
  "Պահանջներ՝",
  "- Համապատասխան մասնագիտական փորձ եւ կրթություն",
  "- Հայերեն լեզվի իմացություն, անգլերեն ցանկալի է",
  "",
  "{{LEGAL_CITATION}}"
].join("\n");

function generateJobDescription({ position, language = "hy-AM", legalSources = [] } = {}) {
  const code = String(language) === "ru-RU" ? "ru" : "hy-AM";
  const activeLegal = (Array.isArray(legalSources) ? legalSources : []).filter(s => s && s.status === "active");
  const legalLine = activeLegal.length
    ? `Իրավական հղումներ՝ ${activeLegal.map(s => s.title).join("; ")}:`
    : "Իրավական հղումները կընտրվեն հաշվի առնելով մասնագիտական վերանայված հայկական աղբյուրների ցանկը:";
  const body = JD_BODY_ARMENIAN
    .replace("{{POSITION}}", String(position || "[Պաշտոն]"))
    .replace("{{LEGAL_CITATION}}", legalLine);
  return { language: code, body, citations: activeLegal.map(s => ({ id: s.id, title: s.title })), advisoryOnly: true };
}

const ORDER_DRAFT_ARMENIAN = [
  "ՀՐԱՄԱՆ N {{ORDER_NUMBER}}",
  "Երևան, {{EFFECTIVE_DATE}}",
  "",
  "Ղեկավար՝ {{ISSUER_NAME}}",
  "",
  "Հրամայում եմ՝",
  "1. {{EMPLOYEE_NAME}}-ին տրամադրել {{ORDER_TYPE_ARM}}՝ {{EFFECTIVE_DATE}}-ից:",
  "2. Հաշվապահական բաժնին իրականացնել համապատասխան հաշվարկները:",
  "",
  "Հրամանը ուժի մեջ է մտնում ստորագրման պահից:"
].join("\n");

const ORDER_TYPE_ARMENIAN = {
  vacation: "արձակուրդ",
  "business-trip": "գործուղում",
  transfer: "փոխանցում",
  "schedule-change": "ժամերի փոփոխություն",
  disciplinary: "արդյունավետության խրախուսում/տույժ",
  bonus: "պարգևավճար",
  dismissal: "ազատում",
  hiring: "ընդունում"
};

function draftOrder({ orderType, employeeName, issuerName, effectiveDate, orderNumber }) {
  const armenianType = ORDER_TYPE_ARMENIAN[orderType] || orderType;
  return ORDER_DRAFT_ARMENIAN
    .replace("{{ORDER_NUMBER}}", String(orderNumber || "—"))
    .replace("{{EFFECTIVE_DATE}}", String(effectiveDate || ""))
    .replace("{{ISSUER_NAME}}", String(issuerName || "[Ղեկավար]"))
    .replace("{{EMPLOYEE_NAME}}", String(employeeName || "[Աշխատակից]"))
    .replace("{{ORDER_TYPE_ARM}}", armenianType);
}

function buildLeaveRequest({ employeeId, kind, startDate, endDate, reason }) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    const err = new Error("Invalid leave range");
    err.statusCode = 400;
    throw err;
  }
  const ms = end.getTime() - start.getTime();
  const days = Math.round((ms / 86400000 + 1) * 100) / 100;
  return { employeeId, kind, startDate, endDate, days, reason: reason || "", status: "pending", approverId: null };
}

function buildEquipmentAssignment({ employeeId, assetId, signatureDocId }) {
  return {
    employeeId,
    assetId,
    assignedAt: new Date().toISOString(),
    returnedAt: null,
    signatureDocId: signatureDocId || null
  };
}

module.exports = {
  renderContract,
  computeLeaveBalance,
  computeTripAllowance,
  aggregateTimesheet,
  scoreKpi,
  computeTurnover,
  generateJobDescription,
  draftOrder,
  buildLeaveRequest,
  buildEquipmentAssignment,
  ORDER_TYPE_ARMENIAN
};
```

- [ ] **Step 2: Run focused tests (still RED — routes not registered yet)**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/hr.test.js 2>&1 | tail -10
```

Expected: route tests still FAIL with `404`; pure-function tests (`computeLeaveBalance`, `computeTripAllowance`, `aggregateTimesheet`, `scoreKpi`, `computeTurnover`, `generateJobDescription`) PASS.

- [ ] **Step 3: Commit the engine**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/hr.js && git commit -m "feat(hr): add pure engine for contracts, leave, trips, KPIs, AI drafts" && git push ant main
```

### Task 3: Add Armenian contract + order templates

**Files:**
- Create: `server/hr/templates/contract-fixed-term.md`
- Create: `server/hr/templates/contract-permanent.md`
- Create: `server/hr/templates/contract-part-time.md`
- Create: `server/hr/templates/contract-intern.md`
- Create: `server/hr/templates/contract-remote.md`
- Create: `server/hr/templates/contract-secondment.md`
- Create: `server/hr/templates/order-vacation.md`
- Create: `server/hr/templates/order-business-trip.md`
- Create: `server/hr/templates/order-transfer.md`
- Create: `server/hr/templates/order-schedule-change.md`
- Create: `server/hr/templates/order-disciplinary.md`
- Create: `server/hr/templates/order-bonus.md`
- Create: `server/hr/templates/order-dismissal.md`
- Create: `server/hr/templates/order-hiring.md`

- [ ] **Step 1: Create `contract-permanent.md`**

```markdown
# Աշխատանքային պայմանագիր N {{ORDER_NUMBER}}

**Կողմեր՝** {{ORG_NAME}} («Գործատու») եւ {{EMPLOYEE_NAME}} («Աշխատակից»).

**Հիմք՝** ՀՀ Աշխատանքային օրենսգիրք, հոդված 41, անորոշ ժամկետով աշխատանքային պայմանագիր:

**Պաշտոն՝** {{POSITION}}.

**Սկիզբ՝** {{START_DATE}}.

**Աշխատավարձ՝** {{GROSS_SALARY}} AMD համախառն ամսական:

**Աշխատաժամեր՝** շաբաթական 40 ժամ, հերթափոխ՝ երկուշաբթի-ուրբաթ, 09:00-18:00:

**Փորձաշրջան՝** 3 ամիս (ՀՀ Աշխատանքային օրենսգիրք, հոդված 64):

**Աշխատավարձից պահումներ՝** եկամտային հարկ (20%), կուտակային կենսաթոշակ, դրոշմանիշային վճար:

**Պարտականություններ՝** Աշխատակիցը պարտավորվում է կատարել իր պաշտոնական պարտականությունները ՀՀ Աշխատանքային օրենսգրքի եւ Գործատուի ներքին կանոնակարգերին համապատասխան:

**Վերջ՝** Անորոշ ժամկետով:

**Ստորագրվել է՝** {{SIGNED_AT}}.

Գործատու՝ ______________________     Աշխատակից՝ ______________________
```

- [ ] **Step 2: Create `contract-fixed-term.md`**

```markdown
# Որոշակի ժամկետով աշխատանքային պայմանագիր N {{ORDER_NUMBER}}

**Կողմեր՝** {{ORG_NAME}} եւ {{EMPLOYEE_NAME}}.

**Հիմք՝** ՀՀ Աշխատանքային օրենսգիրք, հոդված 42, որոշակի ժամկետով պայմանագիր:

**Պաշտոն՝** {{POSITION}}.

**Սկիզբ՝** {{START_DATE}}.

**Վերջ՝** {{END_DATE}}.

**Աշխատավարձ՝** {{GROSS_SALARY}} AMD համախառն ամսական:

**Պարտականություններ՝** Աշխատակիցը պարտավորվում է կատարել իր պաշտոնական պարտականությունները պայմանագրի ողջ ժամկետում:

**Վաղաժամկետ դադարեցում՝** ՀՀ Աշխատանքային օրենսգիրք, հոդված 87:

**Ստորագրվել է՝** {{SIGNED_AT}}.

Գործատու՝ ______________________     Աշխատակից՝ ______________________
```

- [ ] **Step 3: Create `contract-part-time.md`**

```markdown
# Մասնակի զբաղվածության պայմանագիր N {{ORDER_NUMBER}}

**Կողմեր՝** {{ORG_NAME}} եւ {{EMPLOYEE_NAME}}.

**Հիմք՝** ՀՀ Աշխատանքային օրենսգիրք, հոդված 48:

**Պաշտոն՝** {{POSITION}}.

**Սկիզբ՝** {{START_DATE}}.

**Աշխատաժամեր՝** շաբաթական 20 ժամ, համաձայնեցված գրաֆիկով:

**Աշխատավարձ՝** {{GROSS_SALARY}} AMD համախառն ամսական, հաշվարկված իրական աշխատաժամերի համամասնորեն:

**Ստորագրվել է՝** {{SIGNED_AT}}.

Գործատու՝ ______________________     Աշխատակից՝ ______________________
```

- [ ] **Step 4: Create `contract-intern.md`**

```markdown
# Պրակտիկայի պայմանագիր N {{ORDER_NUMBER}}

**Կողմեր՝** {{ORG_NAME}} եւ {{EMPLOYEE_NAME}}.

**Հիմք՝** ՀՀ Կրթության մասին օրենք, հոդված 19, եւ ՀՀ Աշխատանքային օրենսգիրք, գլուխ 5:

**Պաշտոն՝** Պրակտիկանտ՝ {{POSITION}}.

**Սկիզբ՝** {{START_DATE}}.

**Վերջ՝** {{END_DATE}}.

**Պարգևավճար՝** {{GROSS_SALARY}} AMD ամսական (կարող է լինել ոչ դրամական, ըստ համաձայնության):

**Վարժարան՝** Համալսարանական պրակտիկա:

**Ստորագրվել է՝** {{SIGNED_AT}}.

Գործատու՝ ______________________     Պրակտիկանտ՝ ______________________
```

- [ ] **Step 5: Create `contract-remote.md`**

```markdown
# Հեռավար աշխատանքի պայմանագիր N {{ORDER_NUMBER}}

**Կողմեր՝** {{ORG_NAME}} եւ {{EMPLOYEE_NAME}}.

**Հիմք՝** ՀՀ Աշխատանքային օրենսգիրք, հոդված 65 (հեռավար աշխատանք):

**Պաշտոն՝** {{POSITION}}.

**Սկիզբ՝** {{START_DATE}}.

**Աշխատավարձ՝** {{GROSS_SALARY}} AMD համախառն ամսական:

**Աշխատավայր՝** Աշխատակցի բնակության վայրը կամ համաձայնեցված այլ վայր:

**Կապի միջոցներ՝** Համացանցային կապ, տեսակոնֆերանս:

**Ստորագրվել է՝** {{SIGNED_AT}}.

Գործատու՝ ______________________     Աշխատակից՝ ______________________
```

- [ ] **Step 6: Create `contract-secondment.md`**

```markdown
# Ժամանակավոր վերագրման պայմանագիր N {{ORDER_NUMBER}}

**Կողմեր՝** {{ORG_NAME}} («Ուղարկող»), {{EMPLOYEE_NAME}} («Աշխատակից») եւ ընդունող կողմ՝ կապալառու կազմակերպություն:

**Հիմք՝** ՀՀ Աշխատանքային օրենսգիրք, հոդված 51 (վերագրում):

**Պաշտոն՝** {{POSITION}}.

**Սկիզբ՝** {{START_DATE}}.

**Վերջ՝** {{END_DATE}}.

**Աշխատավարձը վճարվում է՝** Ուղարկողի կողմից՝ {{GROSS_SALARY}} AMD ամսական:

**Ստորագրվել է՝** {{SIGNED_AT}}.

Ուղարկող՝ ______________________     Աշխատակից՝ ______________________
```

- [ ] **Step 7: Create the 8 order templates**

`server/hr/templates/order-vacation.md`:

```markdown
# ՀՐԱՄԱՆ

**Երևան, {{EFFECTIVE_DATE}}**

**Թիվ {{ORDER_NUMBER}}**

**Վերնագիր՝** Արձակուրդի տրամադրում

Ես, {{ISSUER_NAME}}, հրամայում եմ՝

1. {{EMPLOYEE_NAME}}-ին տրամադրել ամենամյա հիմնական արձակուրդ {{EFFECTIVE_DATE}}-ից՝ համաձայն ՀՀ Աշխատանքային օրենսգրքի հոդված 159-ի:
2. Հաշվապահական բաժնին կատարել համապատասխան վճարումները արձակուրդային փոխհատուցման համար:

Հրամանը ուժի մեջ է մտնում ստորագրման պահից:

______________________
{{ISSUER_NAME}}
```

`server/hr/templates/order-business-trip.md`:

```markdown
# ՀՐԱՄԱՆ

**Երևան, {{EFFECTIVE_DATE}}**

**Թիվ {{ORDER_NUMBER}}**

**Վերնագիր՝** Գործուղման ուղարկում

Ես, {{ISSUER_NAME}}, հրամայում եմ՝

1. {{EMPLOYEE_NAME}}-ին ուղարկել գործուղման՝ {{EFFECTIVE_DATE}}-ից:
2. Հատկացնել օրապարգենային եւ տրանսպորտային ծախսերի փոխհատուցում համաձայն ՀՀ Աշխատանքային օրենսգրքի հոդված 169-ի:

______________________
{{ISSUER_NAME}}
```

`server/hr/templates/order-transfer.md`:

```markdown
# ՀՐԱՄԱՆ

**Երևան, {{EFFECTIVE_DATE}}**

**Թիվ {{ORDER_NUMBER}}**

**Վերնագիր՝** Փոխանցում պաշտոնից պաշտոն

Ես, {{ISSUER_NAME}}, հրամայում եմ՝

1. {{EMPLOYEE_NAME}}-ին փոխանցել {{POSITION}} պաշտոնի՝ {{EFFECTIVE_DATE}}-ից:

______________________
{{ISSUER_NAME}}
```

`server/hr/templates/order-schedule-change.md`:

```markdown
# ՀՐԱՄԱՆ

**Երևան, {{EFFECTIVE_DATE}}**

**Թիվ {{ORDER_NUMBER}}**

**Վերնագիր՝** Աշխատաժամերի փոփոխություն

Ես, {{ISSUER_NAME}}, հրամայում եմ՝

1. {{EMPLOYEE_NAME}}-ի աշխատաժամերը փոխել {{EFFECTIVE_DATE}}-ից՝ համաձայն ՀՀ Աշխատանքային օրենսգրքի հոդված 137-ի:

______________________
{{ISSUER_NAME}}
```

`server/hr/templates/order-disciplinary.md`:

```markdown
# ՀՐԱՄԱՆ

**Երևան, {{EFFECTIVE_DATE}}**

**Թիվ {{ORDER_NUMBER}}**

**Վերնագիր՝** Կարգապահական տույժ/խրախուսում

Ես, {{ISSUER_NAME}}, հրամայում եմ՝

1. {{EMPLOYEE_NAME}}-ի նկատմամբ կիրառել կարգապահական միջոց {{EFFECTIVE_DATE}}-ից՝ համաձայն ՀՀ Աշխատանքային օրենսգրքի գլուխ 8-ի:

______________________
{{ISSUER_NAME}}
```

`server/hr/templates/order-bonus.md`:

```markdown
# ՀՐԱՄԱՆ

**Երևան, {{EFFECTIVE_DATE}}**

**Թիվ {{ORDER_NUMBER}}**

**Վերնագիր՝** Պարգևավճարի հատկացում

Ես, {{ISSUER_NAME}}, հրամայում եմ՝

1. {{EMPLOYEE_NAME}}-ին հատկացնել պարգևավճար՝ {{EFFECTIVE_DATE}}-ից:

______________________
{{ISSUER_NAME}}
```

`server/hr/templates/order-dismissal.md`:

```markdown
# ՀՐԱՄԱՆ

**Երևան, {{EFFECTIVE_DATE}}**

**Թիվ {{ORDER_NUMBER}}**

**Վերնագիր՝** Աշխատանքից ազատում

Ես, {{ISSUER_NAME}}, հրամայում եմ՝

1. {{EMPLOYEE_NAME}}-ին ազատել պաշտոնից՝ {{EFFECTIVE_DATE}}-ից՝ համաձայն ՀՀ Աշխատանքային օրենսգրքի հոդված 113-ի:

______________________
{{ISSUER_NAME}}
```

`server/hr/templates/order-hiring.md`:

```markdown
# ՀՐԱՄԱՆ

**Երևան, {{EFFECTIVE_DATE}}**

**Թիվ {{ORDER_NUMBER}}**

**Վերնագիր՝** Ընդունում պաշտոնի

Ես, {{ISSUER_NAME}}, հրամայում եմ՝

1. {{EMPLOYEE_NAME}}-ին ընդունել {{POSITION}} պաշտոնի՝ {{EFFECTIVE_DATE}}-ից:

______________________
{{ISSUER_NAME}}
```

- [ ] **Step 8: Commit templates**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/hr/templates && git commit -m "feat(hr): add Armenian contract and order templates" && git push ant main
```

### Task 4: DB migration for the 11 new tables

**Files:**
- Modify: `server/db.js` — append the 11 `CREATE TABLE IF NOT EXISTS` blocks from the **DB additions** section above, inside the schema bootstrap function (find the existing `CREATE TABLE IF NOT EXISTS` block and add the new tables right after the `people_employees` / `payroll_runs` declarations).
- Read: `server/db.js` (locate the schema bootstrap to insert the new tables in the right spot)

- [ ] **Step 1: Add the 11 table declarations to `server/db.js`**

Insert immediately after the existing `payroll_runs` `CREATE TABLE` block (search for `CREATE TABLE IF NOT EXISTS payroll_runs` and add the following block right after it):

```sql
CREATE TABLE IF NOT EXISTS employment_contracts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  template_code TEXT NOT NULL,
  signed_at TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT,
  gross_salary INTEGER NOT NULL,
  position TEXT NOT NULL,
  file_id TEXT,
  status TEXT NOT NULL,
  body_md TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_employment_contracts_org_employee ON employment_contracts(org_id, employee_id);

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days REAL NOT NULL,
  status TEXT NOT NULL,
  approver_id TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_org_employee ON leave_requests(org_id, employee_id);

CREATE TABLE IF NOT EXISTS leave_balances (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  kind TEXT NOT NULL,
  entitled_days REAL NOT NULL,
  used_days REAL NOT NULL DEFAULT 0,
  carried_over REAL NOT NULL DEFAULT 0,
  UNIQUE(org_id, employee_id, year, kind)
);

CREATE TABLE IF NOT EXISTS business_trips (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  destination TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  per_diem_amd INTEGER NOT NULL,
  transportation_amd INTEGER NOT NULL,
  status TEXT NOT NULL,
  approver_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_business_trips_org_employee ON business_trips(org_id, employee_id);

CREATE TABLE IF NOT EXISTS timesheets (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  hours REAL NOT NULL,
  project_id TEXT,
  task_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_timesheets_org_employee_date ON timesheets(org_id, employee_id, work_date);

CREATE TABLE IF NOT EXISTS kpi_targets (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  metric TEXT NOT NULL,
  target REAL NOT NULL,
  weight REAL NOT NULL,
  UNIQUE(org_id, employee_id, period_key, metric)
);

CREATE TABLE IF NOT EXISTS kpi_actuals (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  metric TEXT NOT NULL,
  actual REAL NOT NULL,
  evidence_url TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kpi_actuals_org_employee_period ON kpi_actuals(org_id, employee_id, period_key);

CREATE TABLE IF NOT EXISTS equipment_assignments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  returned_at TEXT,
  signature_doc_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_equipment_assignments_org_employee ON equipment_assignments(org_id, employee_id);

CREATE TABLE IF NOT EXISTS recruitment_pipelines (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  stage_order_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recruitment_candidates (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  pipeline_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  stage TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_recruitment_candidates_org_pipeline ON recruitment_candidates(org_id, pipeline_id);

CREATE TABLE IF NOT EXISTS hr_orders (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  order_type TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  body_md TEXT NOT NULL,
  issued_by TEXT NOT NULL,
  signed_at TEXT,
  file_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hr_orders_org_employee ON hr_orders(org_id, employee_id);
```

- [ ] **Step 2: Run the test suite to verify schema bootstrap works**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: existing test count unchanged; no new failures.

- [ ] **Step 3: Commit the migration**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/db.js && git commit -m "feat(hr): add 11 HR tables (contracts, leave, trips, timesheets, KPI, equipment, recruitment, orders)" && git push ant main
```

### Task 5: Add the AI helper module

**Files:**
- Create: `server/hrAi.js`
- Read: `server/copilot.js` (style reference for the local-first pattern)

- [ ] **Step 1: Create the AI helper**

```js
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { isEgressAllowed } = require("./config");
const hr = require("./hr");

function listTemplates(templatesDir) {
  return fs.readdirSync(templatesDir)
    .filter(name => name.endsWith(".md"))
    .map(name => ({ code: name.replace(/\.md$/, ""), title: name.replace(/\.md$/, "").replace(/-/g, " ") }));
}

function loadTemplate(templatesDir, code) {
  const safe = String(code || "").replace(/[^a-z0-9-]/gi, "");
  if (!safe) {
    const err = new Error("Invalid template code");
    err.statusCode = 400;
    throw err;
  }
  return fs.readFileSync(path.join(templatesDir, `${safe}.md`), "utf8");
}

function loadLegalSources(db, orgId) {
  return db.prepare(`
    SELECT id, title, status, professional_review_ready AS professionalReviewReady
    FROM legal_sources
    WHERE org_id = ? AND status = 'active'
    ORDER BY title
  `).all(orgId);
}

async function buildJobDescription({ db, orgId, position, language, templatesDir, fetchImpl }) {
  const legal = loadLegalSources(db, orgId);
  const local = hr.generateJobDescription({ position, language, legalSources: legal });
  const packet = {
    intent: "hr-job-description",
    language: local.language,
    body: local.body,
    citations: local.citations,
    advisoryOnly: true,
    reviewRequired: true,
    egressAttempted: false
  };
  if (!isEgressAllowed()) return packet;
  if (typeof fetchImpl !== "function") return packet;
  try {
    const egress = await fetchImpl({ position, language: local.language, legalSources: legal });
    packet.egressAttempted = true;
    if (egress && typeof egress.body === "string") packet.body = egress.body;
    if (Array.isArray(egress?.citations)) packet.citations = egress.citations;
  } catch {
    // Egress failure: stay on local fallback; do not throw.
  }
  return packet;
}

async function buildOrderDraft({ db, orgId, employee, orderType, effectiveDate, orderNumber, templatesDir, fetchImpl }) {
  const legal = loadLegalSources(db, orgId);
  const issuer = db.prepare(`
    SELECT full_name AS fullName FROM people_employees WHERE org_id = ? AND id = ?
  `).get(orgId, employee?.approverId) || { fullName: "[Ղեկավար]" };
  const local = {
    intent: "hr-order",
    language: "hy-AM",
    bodyMd: hr.draftOrder({
      orderType,
      employeeName: employee?.fullName || "[Աշխատակից]",
      issuerName: issuer.fullName,
      effectiveDate,
      orderNumber
    }),
    citations: legal,
    advisoryOnly: true,
    reviewRequired: true,
    egressAttempted: false
  };
  if (!isEgressAllowed()) return local;
  if (typeof fetchImpl !== "function") return local;
  try {
    const egress = await fetchImpl({ orderType, employee, effectiveDate, orderNumber, legalSources: legal });
    local.egressAttempted = true;
    if (egress && typeof egress.bodyMd === "string") local.bodyMd = egress.bodyMd;
  } catch {
    // Stay on local fallback.
  }
  return local;
}

module.exports = {
  listTemplates,
  loadTemplate,
  loadLegalSources,
  buildJobDescription,
  buildOrderDraft
};
```

- [ ] **Step 2: Run focused tests (no route yet, but module loads cleanly)**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --check server/hrAi.js && node --test test/hr.test.js 2>&1 | tail -10
```

Expected: `node --check` clean; route tests still RED with `404`; pure-function tests still PASS.

- [ ] **Step 3: Commit the AI helper**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/hrAi.js && git commit -m "feat(hr): add local-first AI helper gated by ARMOSPHERA_ONE_ALLOW_EGRESS" && git push ant main
```

### Task 6: Wire the 18 HR routes in `server/app.js`

**Files:**
- Modify: `server/app.js` (add import near other engine imports, then register 18 routes after the existing `/api/people/employees/:id/payroll-runs` route at line 4468)
- Read: `server/app.js` (locate `requirePeopleWriter`, `recordAudit`, `randomId`)

- [ ] **Step 1: Add the engine import**

Near the existing `const payroll = require("./payroll");` line at the top of `server/app.js`, add:

```js
const hr = require("./hr");
const hrAi = require("./hrAi");
const HR_TEMPLATES_DIR = path.join(__dirname, "hr", "templates");
```

(Ensure `path` is already required at the top of the file — it is, since `server/db.js` uses it and the same `path` import is shared via `server/app.js`.)

- [ ] **Step 2: Register the 18 routes after the existing people/payroll routes**

Insert the following block immediately after the closing of the `/api/people/employees/:id/payroll-runs` route (around line 4468, before `/api/legal/law-search`):

```js
  // -------- HR Depth: contracts, leave, trips, timesheets, KPIs, equipment, recruitment, orders, AI --------

  app.get("/api/hr/contracts/templates", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    return { templates: hrAi.listTemplates(HR_TEMPLATES_DIR) };
  });

  app.post("/api/hr/contracts", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    requirePeopleWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    if (!body.employeeId || !body.templateCode || !body.startDate || !body.grossSalary || !body.position) {
      const e = new Error("employeeId, templateCode, startDate, grossSalary, position are required");
      e.statusCode = 400; throw e;
    }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const employee = db.prepare("SELECT id, full_name AS fullName FROM people_employees WHERE org_id = ? AND id = ?").get(user.org_id, body.employeeId);
    if (!employee) { const e = new Error("Employee not found"); e.statusCode = 404; throw e; }
    const org = db.prepare("SELECT name FROM organizations WHERE id = ?").get(user.org_id);
    const template = hrAi.loadTemplate(HR_TEMPLATES_DIR, body.templateCode);
    const bodyMd = hr.renderContract({
      template,
      input: {
        employeeName: employee.fullName,
        position: body.position,
        startDate: body.startDate,
        endDate: body.endDate,
        grossSalary: body.grossSalary,
        orgName: org?.name || "[Կազմակերպություն]",
        signedAt: body.signedAt || new Date().toISOString().slice(0, 10),
        orderNumber: idem
      }
    });
    const id = randomId("emp-ct");
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO employment_contracts (id, org_id, employee_id, template_code, signed_at, start_date, end_date, gross_salary, position, file_id, status, body_md, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, user.org_id, body.employeeId, body.templateCode, body.signedAt || now, body.startDate, body.endDate || null, body.grossSalary, body.position, null, "draft", bodyMd, now, now
    );
    recordAudit(db, user, "hr.contract.create", "employment_contract", id, { employeeId: body.employeeId, templateCode: body.templateCode, idempotencyKey: idem });
    const envelope = { ok: true, contract: { id, bodyMd, grossSalary: body.grossSalary, status: "draft" } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
      randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now
    );
    return envelope;
  });

  app.post("/api/hr/leave-requests", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    requirePeopleWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    if (!body.employeeId || !body.kind || !body.startDate || !body.endDate) {
      const e = new Error("employeeId, kind, startDate, endDate are required");
      e.statusCode = 400; throw e;
    }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const lr = hr.buildLeaveRequest(body);
    const id = randomId("lr");
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO leave_requests (id, org_id, employee_id, kind, start_date, end_date, days, status, approver_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, user.org_id, lr.employeeId, lr.kind, lr.startDate, lr.endDate, lr.days, lr.status, null, lr.reason, now
    );
    recordAudit(db, user, "hr.leave.request", "leave_request", id, { kind: lr.kind, days: lr.days, idempotencyKey: idem });
    const envelope = { ok: true, leaveRequest: { id, ...lr } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
      randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now
    );
    return envelope;
  });

  app.post("/api/hr/leave-requests/:id/approve", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    requirePeopleWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const lr = db.prepare("SELECT * FROM leave_requests WHERE org_id = ? AND id = ?").get(user.org_id, request.params.id);
    if (!lr) { const e = new Error("Leave request not found"); e.statusCode = 404; throw e; }
    if (!["approved", "rejected"].includes(body.decision)) { const e = new Error("decision must be 'approved' or 'rejected'"); e.statusCode = 400; throw e; }
    const now = new Date().toISOString();
    db.prepare("UPDATE leave_requests SET status = ?, approver_id = ? WHERE id = ?").run(body.decision, user.id, lr.id);
    if (body.decision === "approved") {
      const year = new Date(lr.start_date).getFullYear();
      const bal = db.prepare("SELECT id, entitled_days, used_days, carried_over FROM leave_balances WHERE org_id = ? AND employee_id = ? AND year = ? AND kind = ?").get(user.org_id, lr.employee_id, year, lr.kind);
      if (bal) {
        db.prepare("UPDATE leave_balances SET used_days = used_days + ? WHERE id = ?").run(lr.days, bal.id);
      } else {
        db.prepare(`INSERT INTO leave_balances (id, org_id, employee_id, year, kind, entitled_days, used_days, carried_over) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          randomId("lbal"), user.org_id, lr.employee_id, year, lr.kind, 20, lr.days, 0
        );
      }
    }
    recordAudit(db, user, "hr.leave.approve", "leave_request", lr.id, { decision: body.decision, idempotencyKey: idem });
    const envelope = { ok: true, leaveRequest: { id: lr.id, status: body.decision, approverId: user.id } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
      randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now
    );
    return envelope;
  });

  app.get("/api/hr/leave-balances", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    const employeeId = String(request.query?.employeeId || "");
    const year = Number(request.query?.year || new Date().getFullYear());
    if (!employeeId) { const e = new Error("employeeId is required"); e.statusCode = 400; throw e; }
    const rows = db.prepare("SELECT year, kind, entitled_days AS entitledDays, used_days AS usedDays, carried_over AS carriedOver FROM leave_balances WHERE org_id = ? AND employee_id = ? AND year = ?").all(user.org_id, employeeId, year);
    if (rows.length === 0) {
      return { balances: [{ year, kind: "annual", entitledDays: 20, usedDays: 0, carriedOver: 0 }] };
    }
    return { balances: rows };
  });

  app.post("/api/hr/business-trips", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    requirePeopleWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    if (!body.employeeId || !body.destination || !body.startDate || !body.endDate) {
      const e = new Error("employeeId, destination, startDate, endDate are required");
      e.statusCode = 400; throw e;
    }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const allowance = hr.computeTripAllowance({
      perDiemAmd: body.perDiemAmd || 0,
      days: (new Date(body.endDate) - new Date(body.startDate)) / 86400000 + 1,
      transportationAmd: body.transportationAmd || 0
    });
    const id = randomId("trip");
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO business_trips (id, org_id, employee_id, destination, start_date, end_date, per_diem_amd, transportation_amd, status, approver_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, user.org_id, body.employeeId, body.destination, body.startDate, body.endDate, allowance.perDiem, allowance.transportation, "pending", null, now
    );
    recordAudit(db, user, "hr.trip.create", "business_trip", id, { destination: body.destination, total: allowance.total, idempotencyKey: idem });
    const envelope = { ok: true, trip: { id, allowance, status: "pending" } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
      randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now
    );
    return envelope;
  });

  app.post("/api/hr/timesheets/bulk", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    requirePeopleWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    if (!body.employeeId || !Array.isArray(body.entries) || body.entries.length === 0) {
      const e = new Error("employeeId and entries[] are required");
      e.statusCode = 400; throw e;
    }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const now = new Date().toISOString();
    const inserted = [];
    for (const entry of body.entries) {
      if (!entry.workDate || typeof entry.hours !== "number") continue;
      const id = randomId("ts");
      db.prepare(`INSERT INTO timesheets (id, org_id, employee_id, work_date, hours, project_id, task_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, user.org_id, body.employeeId, entry.workDate, entry.hours, entry.projectId || null, entry.taskId || null, entry.notes || null, now
      );
      inserted.push(id);
    }
    recordAudit(db, user, "hr.timesheet.bulk", "timesheet", body.employeeId, { count: inserted.length, idempotencyKey: idem });
    const envelope = { ok: true, report: hr.aggregateTimesheet({ entries: body.entries }), inserted: inserted.length };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
      randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now
    );
    return envelope;
  });

  app.get("/api/hr/timesheets/report", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    const periodKey = String(request.query?.periodKey || "");
    if (!periodKey) { const e = new Error("periodKey is required"); e.statusCode = 400; throw e; }
    const rows = db.prepare("SELECT work_date AS workDate, hours, project_id AS projectId, task_id AS taskId FROM timesheets WHERE org_id = ? AND substr(work_date, 1, 7) = ?").all(user.org_id, periodKey);
    return { report: hr.aggregateTimesheet({ entries: rows }), periodKey };
  });

  app.post("/api/hr/kpis/targets", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    requirePeopleWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    if (!body.employeeId || !body.periodKey || !Array.isArray(body.targets)) {
      const e = new Error("employeeId, periodKey, targets[] are required");
      e.statusCode = 400; throw e;
    }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const now = new Date().toISOString();
    for (const t of body.targets) {
      const id = randomId("kpit");
      db.prepare(`INSERT INTO kpi_targets (id, org_id, employee_id, period_key, metric, target, weight) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(org_id, employee_id, period_key, metric) DO UPDATE SET target = excluded.target, weight = excluded.weight`).run(
        id, user.org_id, body.employeeId, body.periodKey, t.metric, t.target, t.weight
      );
    }
    recordAudit(db, user, "hr.kpi.targets", "kpi_target", body.employeeId, { count: body.targets.length, periodKey: body.periodKey, idempotencyKey: idem });
    const envelope = { ok: true, targets: body.targets.length };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
      randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now
    );
    return envelope;
  });

  app.post("/api/hr/kpis/actuals", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    requirePeopleWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    if (!body.employeeId || !body.periodKey || !Array.isArray(body.actuals)) {
      const e = new Error("employeeId, periodKey, actuals[] are required");
      e.statusCode = 400; throw e;
    }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const now = new Date().toISOString();
    for (const a of body.actuals) {
      const id = randomId("kpia");
      db.prepare(`INSERT INTO kpi_actuals (id, org_id, employee_id, period_key, metric, actual, evidence_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, user.org_id, body.employeeId, body.periodKey, a.metric, a.actual, a.evidenceUrl || null, now
      );
    }
    recordAudit(db, user, "hr.kpi.actuals", "kpi_actual", body.employeeId, { count: body.actuals.length, periodKey: body.periodKey, idempotencyKey: idem });
    const envelope = { ok: true, actuals: body.actuals.length };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
      randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now
    );
    return envelope;
  });

  app.get("/api/hr/kpis/score", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    const employeeId = String(request.query?.employeeId || "");
    const periodKey = String(request.query?.periodKey || "");
    if (!employeeId || !periodKey) { const e = new Error("employeeId and periodKey are required"); e.statusCode = 400; throw e; }
    const targets = db.prepare("SELECT metric, target, weight FROM kpi_targets WHERE org_id = ? AND employee_id = ? AND period_key = ?").all(user.org_id, employeeId, periodKey);
    const actuals = db.prepare("SELECT metric, actual FROM kpi_actuals WHERE org_id = ? AND employee_id = ? AND period_key = ?").all(user.org_id, employeeId, periodKey);
    return { score: hr.scoreKpi({ targets, actuals }), periodKey };
  });

  app.post("/api/hr/equipment/assign", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    requireAppAccess(db, user, "assets");
    requirePeopleWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    if (!body.employeeId || !body.assetId) {
      const e = new Error("employeeId and assetId are required");
      e.statusCode = 400; throw e;
    }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const assignment = hr.buildEquipmentAssignment(body);
    const id = randomId("eqa");
    db.prepare(`INSERT INTO equipment_assignments (id, org_id, employee_id, asset_id, assigned_at, returned_at, signature_doc_id) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id, user.org_id, body.employeeId, body.assetId, assignment.assignedAt, null, body.signatureDocId || null
    );
    recordAudit(db, user, "hr.equipment.assign", "equipment_assignment", id, { assetId: body.assetId, employeeId: body.employeeId, idempotencyKey: idem });
    const envelope = { ok: true, assignment: { id, ...assignment } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
      randomId("idem"), user.org_id, idem, JSON.stringify(envelope), assignment.assignedAt
    );
    return envelope;
  });

  app.post("/api/hr/recruitment/pipelines", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    requirePeopleWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    if (!body.name || !Array.isArray(body.stages) || body.stages.length === 0) {
      const e = new Error("name and stages[] are required");
      e.statusCode = 400; throw e;
    }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const id = randomId("pipe");
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO recruitment_pipelines (id, org_id, name, stage_order_json, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      id, user.org_id, body.name, JSON.stringify(body.stages), now
    );
    recordAudit(db, user, "hr.recruit.pipeline", "recruitment_pipeline", id, { name: body.name, stages: body.stages.length, idempotencyKey: idem });
    const envelope = { ok: true, pipeline: { id, name: body.name, stages: body.stages } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
      randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now
    );
    return envelope;
  });

  app.post("/api/hr/recruitment/candidates", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    requirePeopleWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    if (!body.pipelineId || !body.fullName || !body.stage) {
      const e = new Error("pipelineId, fullName, stage are required");
      e.statusCode = 400; throw e;
    }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const pipeline = db.prepare("SELECT stage_order_json AS stages FROM recruitment_pipelines WHERE org_id = ? AND id = ?").get(user.org_id, body.pipelineId);
    if (!pipeline) { const e = new Error("Pipeline not found"); e.statusCode = 404; throw e; }
    const stages = JSON.parse(pipeline.stages);
    if (!stages.includes(body.stage)) { const e = new Error("Stage must be one of: " + stages.join(", ")); e.statusCode = 400; throw e; }
    const id = randomId("cand");
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO recruitment_candidates (id, org_id, pipeline_id, full_name, email, stage, applied_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, user.org_id, body.pipelineId, body.fullName, body.email || null, body.stage, now, body.notes || null
    );
    recordAudit(db, user, "hr.recruit.candidate", "recruitment_candidate", id, { pipelineId: body.pipelineId, stage: body.stage, idempotencyKey: idem });
    const envelope = { ok: true, candidate: { id, fullName: body.fullName, stage: body.stage, appliedAt: now } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
      randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now
    );
    return envelope;
  });

  app.post("/api/hr/orders", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    requirePeopleWriter(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    if (!body.employeeId || !body.orderType || !body.effectiveDate) {
      const e = new Error("employeeId, orderType, effectiveDate are required");
      e.statusCode = 400; throw e;
    }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const employee = db.prepare("SELECT full_name AS fullName FROM people_employees WHERE org_id = ? AND id = ?").get(user.org_id, body.employeeId);
    if (!employee) { const e = new Error("Employee not found"); e.statusCode = 404; throw e; }
    const issuer = db.prepare("SELECT full_name AS fullName FROM people_employees WHERE org_id = ? AND id = ?").get(user.org_id, user.id) || { fullName: user.name };
    const orderNumber = `HR-${Date.now()}`;
    const draft = await hrAi.buildOrderDraft({
      db, orgId: user.org_id,
      employee: { fullName: employee.fullName, approverId: user.id },
      orderType: body.orderType, effectiveDate: body.effectiveDate, orderNumber,
      templatesDir: HR_TEMPLATES_DIR
    });
    const id = randomId("hrord");
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO hr_orders (id, org_id, employee_id, order_type, effective_date, body_md, issued_by, signed_at, file_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, user.org_id, body.employeeId, body.orderType, body.effectiveDate, draft.bodyMd, issuer.fullName, null, null, now
    );
    recordAudit(db, user, "hr.order.issue", "hr_order", id, { orderType: body.orderType, employeeId: body.employeeId, idempotencyKey: idem });
    const envelope = { ok: true, order: { id, orderType: body.orderType, bodyMd: draft.bodyMd, orderNumber, advisoryOnly: draft.advisoryOnly } };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
      randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now
    );
    return envelope;
  });

  app.post("/api/hr/ai/job-description", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    if (!body.position) { const e = new Error("position is required"); e.statusCode = 400; throw e; }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const packet = await hrAi.buildJobDescription({
      db, orgId: user.org_id, position: body.position, language: body.language, templatesDir: HR_TEMPLATES_DIR
    });
    recordAudit(db, user, "hr.ai.job-description", "ai_packet", idem, { position: body.position, advisoryOnly: packet.advisoryOnly });
    const envelope = { ok: true, jobDescription: packet };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
      randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString()
    );
    return envelope;
  });

  app.post("/api/hr/ai/order", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e; }
    if (!body.employeeId || !body.orderType || !body.effectiveDate) {
      const e = new Error("employeeId, orderType, effectiveDate are required");
      e.statusCode = 400; throw e;
    }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
    if (existing) return JSON.parse(existing.response_json);
    const employee = db.prepare("SELECT id, full_name AS fullName FROM people_employees WHERE org_id = ? AND id = ?").get(user.org_id, body.employeeId);
    if (!employee) { const e = new Error("Employee not found"); e.statusCode = 404; throw e; }
    const orderNumber = `HR-AI-${Date.now()}`;
    const packet = await hrAi.buildOrderDraft({
      db, orgId: user.org_id, employee, orderType: body.orderType, effectiveDate: body.effectiveDate, orderNumber,
      templatesDir: HR_TEMPLATES_DIR
    });
    recordAudit(db, user, "hr.ai.order", "ai_packet", idem, { orderType: body.orderType, advisoryOnly: packet.advisoryOnly });
    const envelope = { ok: true, orderDraft: packet };
    db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
      randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString()
    );
    return envelope;
  });

  app.get("/api/hr/analytics/turnover", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "people");
    const periodKey = String(request.query?.periodKey || new Date().toISOString().slice(0, 7));
    const startHeadcount = db.prepare("SELECT COUNT(*) AS count FROM people_employees WHERE org_id = ? AND substr(hire_date, 1, 7) < ? AND employment_status <> 'terminated'").get(user.org_id, periodKey).count;
    const endHeadcount = db.prepare("SELECT COUNT(*) AS count FROM people_employees WHERE org_id = ? AND substr(hire_date, 1, 7) <= ? AND employment_status = 'active'").get(user.org_id, periodKey).count;
    const leavers = db.prepare("SELECT COUNT(*) AS count FROM people_employees WHERE org_id = ? AND employment_status = 'terminated' AND substr(updated_at, 1, 7) = ?").get(user.org_id, periodKey).count;
    return { turnover: hr.computeTurnover({ startHeadcount, endHeadcount, leavers }), periodKey };
  });
```

- [ ] **Step 3: Run focused tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/hr.test.js 2>&1 | tail -10
```

Expected: PASS (12 tests).

- [ ] **Step 4: Run the full test suite to confirm no regressions**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, total test count increases by 12.

- [ ] **Step 5: Commit the routes**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/app.js test/hr.test.js && git commit -m "feat(hr): wire 18 HR routes (contracts, leave, trips, timesheets, KPIs, equipment, recruitment, orders, AI)" && git push ant main
```

### Task 7: Extend `web/src/people.jsx` with 6 new HR tabs

**Files:**
- Modify: `web/src/people.jsx` (append 6 new exported components at the end of the file, reusing existing CSS classes)

- [ ] **Step 1: Add the 6 HR panels at the end of `web/src/people.jsx`**

```jsx
export function HrContractsPanel({ employees, onCreate, actionState }) {
  const [employeeId, setEmployeeId] = useState(employees?.[0]?.id || "");
  const [templateCode, setTemplateCode] = useState("permanent");
  const [position, setPosition] = useState("");
  const [startDate, setStartDate] = useState("");
  const [grossSalary, setGrossSalary] = useState("");
  const [endDate, setEndDate] = useState("");
  const [result, setResult] = useState(null);
  const busy = actionState === "hr:contract";
  function submit() {
    if (!employeeId || !position.trim() || !startDate) return;
    if (grossSalary && Number.isNaN(Number(grossSalary))) return;
    onCreate({
      employeeId,
      templateCode,
      position: position.trim(),
      startDate,
      endDate: endDate || undefined,
      grossSalary: Math.max(0, Math.round(Number(grossSalary) || 0)),
      idempotencyKey: `ui-ct-${Date.now()}`
    }).then(setResult);
  }
  return (
    <article className="panel hr-contracts-panel">
      <div className="panel-head"><div><span className="section-label">A1 People / HR</span><h2>Աշխատանքային պայմանագիր</h2></div></div>
      <div className="inline-form">
        <select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
          {employees?.map(emp => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
        </select>
        <select value={templateCode} onChange={event => setTemplateCode(event.target.value)}>
          <option value="permanent">Անժամկետ</option>
          <option value="fixed-term">Որոշակի ժամկետ</option>
          <option value="part-time">Մասնակի զբաղվածություն</option>
          <option value="intern">Պրակտիկա</option>
          <option value="remote">Հեռավար</option>
          <option value="secondment">Վերագրում</option>
        </select>
        <input value={position} onChange={event => setPosition(event.target.value)} placeholder="Պաշտոն" />
        <input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} />
        <input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} placeholder="Վերջ (ընտրովի)" />
        <input value={grossSalary} onChange={event => setGrossSalary(event.target.value)} inputMode="numeric" placeholder="Աշխատավարձ (AMD)" />
        <button className="mini-action" type="button" disabled={busy} onClick={submit}>{busy ? "Պատրաստվում է" : "Ստեղծել"}</button>
      </div>
      {result && (
        <div className="copilot-result">
          <p>Պայմանագիր #{result.contract.id}՝ <span className="aging-badge">Սևագիր</span></p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.8em" }}>{result.contract.bodyMd.slice(0, 600)}…</pre>
        </div>
      )}
    </article>
  );
}

export function HrLeavePanel({ employees, onRequest, onApprove, actionState }) {
  const [employeeId, setEmployeeId] = useState(employees?.[0]?.id || "");
  const [kind, setKind] = useState("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState(null);
  const busy = actionState === "hr:leave";
  function submit() {
    if (!employeeId || !startDate || !endDate) return;
    onRequest({ employeeId, kind, startDate, endDate, reason: reason.trim(), idempotencyKey: `ui-lr-${Date.now()}` }).then(setResult);
  }
  return (
    <article className="panel hr-leave-panel">
      <div className="panel-head"><div><span className="section-label">A1 People / HR</span><h2>Արձակուրդի հայտ</h2></div></div>
      <div className="inline-form">
        <select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
          {employees?.map(emp => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
        </select>
        <select value={kind} onChange={event => setKind(event.target.value)}>
          <option value="annual">Տարեկան հիմնական</option>
          <option value="sick">Հիվանդության</option>
          <option value="unpaid">Անարձակուրդ</option>
        </select>
        <input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} />
        <input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} />
        <input value={reason} onChange={event => setReason(event.target.value)} placeholder="Պատճառ" />
        <button className="mini-action" type="button" disabled={busy} onClick={submit}>{busy ? "Ուղարկվում է" : "Հայտ ներկայացնել"}</button>
      </div>
      {result && (
        <div className="copilot-result">
          <p>Հայտ #{result.leaveRequest.id}՝ <span className="aging-badge">{result.leaveRequest.status}</span></p>
          <p>Օրեր՝ <strong>{result.leaveRequest.days}</strong></p>
        </div>
      )}
    </article>
  );
}

export function HrTripsPanel({ employees, onCreate, actionState }) {
  const [employeeId, setEmployeeId] = useState(employees?.[0]?.id || "");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [perDiem, setPerDiem] = useState("");
  const [transport, setTransport] = useState("");
  const [result, setResult] = useState(null);
  const busy = actionState === "hr:trip";
  function submit() {
    if (!employeeId || !destination || !startDate || !endDate) return;
    onCreate({
      employeeId, destination, startDate, endDate,
      perDiemAmd: Math.max(0, Math.round(Number(perDiem) || 0)),
      transportationAmd: Math.max(0, Math.round(Number(transport) || 0)),
      idempotencyKey: `ui-trip-${Date.now()}`
    }).then(setResult);
  }
  return (
    <article className="panel hr-trips-panel">
      <div className="panel-head"><div><span className="section-label">A1 People / HR</span><h2>Գործուղում</h2></div></div>
      <div className="inline-form">
        <select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
          {employees?.map(emp => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
        </select>
        <input value={destination} onChange={event => setDestination(event.target.value)} placeholder="Վայր" />
        <input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} />
        <input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} />
        <input value={perDiem} onChange={event => setPerDiem(event.target.value)} inputMode="numeric" placeholder="Օրապարգենային (AMD)" />
        <input value={transport} onChange={event => setTransport(event.target.value)} inputMode="numeric" placeholder="Տրանսպորտ (AMD)" />
        <button className="mini-action" type="button" disabled={busy} onClick={submit}>{busy ? "Հաշվարկվում է" : "Ստեղծել"}</button>
      </div>
      {result && (
        <div className="copilot-result">
          <p>Գործուղում #{result.trip.id}՝ ընդհանուր <strong>{result.trip.allowance.total.toLocaleString("hy-AM")} AMD</strong></p>
        </div>
      )}
    </article>
  );
}

export function HrTimesheetPanel({ employees, onSubmit, actionState }) {
  const [employeeId, setEmployeeId] = useState(employees?.[0]?.id || "");
  const [projectId, setProjectId] = useState("p1");
  const [hours, setHours] = useState("8");
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState(null);
  const busy = actionState === "hr:timesheet";
  function submit() {
    if (!employeeId || !workDate || !hours) return;
    onSubmit({
      employeeId,
      entries: [{ workDate, hours: Number(hours), projectId }],
      idempotencyKey: `ui-ts-${Date.now()}`
    }).then(setResult);
  }
  return (
    <article className="panel hr-timesheet-panel">
      <div className="panel-head"><div><span className="section-label">A1 People / HR</span><h2>Ժամային հաշվետվություն</h2></div></div>
      <div className="inline-form">
        <select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
          {employees?.map(emp => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
        </select>
        <input type="date" value={workDate} onChange={event => setWorkDate(event.target.value)} />
        <input value={hours} onChange={event => setHours(event.target.value)} inputMode="numeric" placeholder="Ժամեր" />
        <input value={projectId} onChange={event => setProjectId(event.target.value)} placeholder="Նախագիծ" />
        <button className="mini-action" type="button" disabled={busy} onClick={submit}>{busy ? "Ուղարկվում է" : "Ավելացնել"}</button>
      </div>
      {result && (
        <div className="copilot-result">
          <p>Ավելացվել է <strong>{result.inserted}</strong> գրառում, ընդհանուր <strong>{result.report.totalHours}</strong> ժամ</p>
        </div>
      )}
    </article>
  );
}

export function HrKpiPanel({ employees, onSetTargets, onSetActuals, onGetScore, actionState }) {
  const [employeeId, setEmployeeId] = useState(employees?.[0]?.id || "");
  const [periodKey, setPeriodKey] = useState(new Date().toISOString().slice(0, 7));
  const [metric, setMetric] = useState("revenue");
  const [target, setTarget] = useState("");
  const [actual, setActual] = useState("");
  const [weight, setWeight] = useState("1");
  const [result, setResult] = useState(null);
  const busy = actionState === "hr:kpi";
  function setT() {
    if (!employeeId || !metric || !target) return;
    onSetTargets({ employeeId, periodKey, targets: [{ metric, target: Number(target), weight: Number(weight) }], idempotencyKey: `ui-kpit-${Date.now()}` }).then(setResult);
  }
  function setA() {
    if (!employeeId || !metric || !actual) return;
    onSetActuals({ employeeId, periodKey, actuals: [{ metric, actual: Number(actual) }], idempotencyKey: `ui-kpia-${Date.now()}` }).then(setResult);
  }
  function score() {
    onGetScore({ employeeId, periodKey }).then(setResult);
  }
  return (
    <article className="panel hr-kpi-panel">
      <div className="panel-head"><div><span className="section-label">A1 People / HR</span><h2>KPI կառավարում</h2></div></div>
      <div className="inline-form">
        <select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
          {employees?.map(emp => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
        </select>
        <input value={periodKey} onChange={event => setPeriodKey(event.target.value)} placeholder="YYYY-MM" />
        <input value={metric} onChange={event => setMetric(event.target.value)} placeholder="Ցուցանիշ" />
        <input value={target} onChange={event => setTarget(event.target.value)} inputMode="numeric" placeholder="Նպատային" />
        <input value={actual} onChange={event => setActual(event.target.value)} inputMode="numeric" placeholder="Փաստացի" />
        <input value={weight} onChange={event => setWeight(event.target.value)} inputMode="numeric" placeholder="Կշիռ" />
        <button className="mini-action" type="button" disabled={busy} onClick={setT}>Նպատակ</button>
        <button className="mini-action" type="button" disabled={busy} onClick={setA}>Փաստացի</button>
        <button className="mini-action" type="button" disabled={busy} onClick={score}>Հաշվել միավորը</button>
      </div>
      {result && (
        <div className="copilot-result">
          {result.score && <p>Կշռված միավոր՝ <strong>{result.score.weighted}</strong></p>}
          {result.targets !== undefined && <p>Նպատակներ պահպանվեցին՝ {result.targets}</p>}
          {result.actuals !== undefined && <p>Փաստացիներ պահպանվեցին՝ {result.actuals}</p>}
        </div>
      )}
    </article>
  );
}

export function HrRecruitmentPanel({ onCreatePipeline, onAddCandidate, actionState }) {
  const [pipelineName, setPipelineName] = useState("Engineering Q3");
  const [stages, setStages] = useState("applied,screen,interview,offer,hired");
  const [pipelineId, setPipelineId] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState("applied");
  const [result, setResult] = useState(null);
  const busy = actionState === "hr:recruit";
  function create() {
    if (!pipelineName) return;
    const stageList = stages.split(",").map(s => s.trim()).filter(Boolean);
    onCreatePipeline({ name: pipelineName, stages: stageList, idempotencyKey: `ui-pipe-${Date.now()}` }).then(r => {
      setResult(r);
      if (r?.pipeline?.id) setPipelineId(r.pipeline.id);
    });
  }
  function add() {
    if (!pipelineId || !fullName) return;
    onAddCandidate({ pipelineId, fullName, email, stage, idempotencyKey: `ui-cand-${Date.now()}` }).then(setResult);
  }
  return (
    <article className="panel hr-recruitment-panel">
      <div className="panel-head"><div><span className="section-label">A1 People / HR</span><h2>Հավաքագրման խողովակ</h2></div></div>
      <div className="inline-form">
        <input value={pipelineName} onChange={event => setPipelineName(event.target.value)} placeholder="Խողովակի անուն" />
        <input value={stages} onChange={event => setStages(event.target.value)} placeholder="Փուլեր (ստորակետով)" />
        <button className="mini-action" type="button" disabled={busy} onClick={create}>Ստեղծել խողովակ</button>
      </div>
      <div className="inline-form">
        <input value={pipelineId} onChange={event => setPipelineId(event.target.value)} placeholder="Խողովակի ID" />
        <input value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Անուն Ազգանուն" />
        <input value={email} onChange={event => setEmail(event.target.value)} placeholder="Էլ. փոստ" />
        <input value={stage} onChange={event => setStage(event.target.value)} placeholder="Փուլ" />
        <button className="mini-action" type="button" disabled={busy} onClick={add}>Ավելացնել թեկնածու</button>
      </div>
      {result && (
        <div className="copilot-result">
          {result.pipeline && <p>Խողովակ #{result.pipeline.id}՝ {result.pipeline.stages.length} փուլ</p>}
          {result.candidate && <p>Թեկնածու #{result.candidate.id}՝ {result.candidate.fullName} ({result.candidate.stage})</p>}
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Build the UI to verify no JSX regressions**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm run build:ui 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 3: Commit the UI extension**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add web/src/people.jsx && git commit -m "feat(hr): add Contracts, Leave, Trips, Timesheet, KPI, Recruitment panels" && git push ant main
```

### Task 8: Update handoff and tag

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update the first status line and add a completed bullet**

Replace the first line in `HANDOFF.md` with the new tag count and test result, e.g.:

```markdown
_Last updated: 2026-06-08 · main after HR depth · 5 tags · 89 tests (89 pass, 0 fail, 0 cancelled)_
```

Add a bullet:

```markdown
- **HR depth** — DONE: 11 new tables, 18 routes (contracts, leave, trips, timesheets, KPIs, equipment, recruitment, orders, AI), pure `server/hr.js` engine + `server/hrAi.js` local-first helper gated by `ARMOSPHERA_ONE_ALLOW_EGRESS=1`, 14 Armenian Markdown templates (6 contract + 8 order), 12-test Pattern A contract suite in `test/hr.test.js`, 6 new React panels in `web/src/people.jsx`.
```

- [ ] **Step 2: Commit handoff**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add HANDOFF.md && git commit -m "docs: record HR depth verification" && git push ant main
```

- [ ] **Step 3: Tag**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git tag hr-depth-mvp && git push ant hr-depth-mvp
```

## Acceptance

- [ ] An HR officer can issue a vacation order end-to-end: request → balance check → approval → order draft (`POST /api/hr/leave-requests` → `GET /api/hr/leave-balances` → `POST /api/hr/leave-requests/:id/approve` → `POST /api/hr/orders`).
- [ ] A timesheet can be submitted in bulk and rolled up to project hours (`POST /api/hr/timesheets/bulk` → `GET /api/hr/timesheets/report`).
- [ ] A KPI score is computed from weighted targets and stored as evidence (`POST /api/hr/kpis/targets` + `POST /api/hr/kpis/actuals` → `GET /api/hr/kpis/score`).
- [ ] Recruitment pipeline moves candidates through stages with audit (`POST /api/hr/recruitment/pipelines` + `POST /api/hr/recruitment/candidates`).
- [ ] AI job description draft cites Armenian Labor Code only if `legal_sources.status === "active"` (covered by `test/hr.test.js` → `hr: job-description draft cites Armenian Labor Code only when legal source is active`).

## Spine reused

`org_id`, `employees`, `payroll_runs`, `vendors` (for external trainers), `assets` (sub-plan 8), `audit_events`, `period_locks` (for HR orders that affect payroll period), `idempotency_keys`, `legal_sources` (Labor Code, Personal Data, etc.).

## Deferred to other sub-plans

- e-Government submission of HR orders (sub-plan 7).
- Biometric attendance + Mobile ID check-in (sub-plan 7 + 9).

## Final Self-Review Checklist (sub-plan 4)

- [ ] `test/hr.test.js` fails before the engine exists
- [ ] `test/hr.test.js` passes once the routes are wired (12 tests)
- [ ] `npm test` total count increases by 12
- [ ] `npm run build:ui` succeeds
- [ ] Audit row count increases by exactly 1 per successful mutation
- [ ] Replay with same `idempotencyKey` returns the cached envelope and does not double-write audit
- [ ] AI egress is blocked by default; `ARMOSPHERA_ONE_ALLOW_EGRESS=1` is required to call `fetchImpl`
- [ ] AI job description omits Labor Code citation when no `legal_sources` row is `active`
- [ ] Period-lock is consulted when `hr_orders.effective_date` overlaps a locked payroll period (deferred wiring, see deferred list)
- [ ] `HANDOFF.md` updated
- [ ] `hr-depth-mvp` tag pushed to `ant`
