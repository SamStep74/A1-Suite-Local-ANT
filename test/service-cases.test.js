"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

test("service console exposes customers + agents pickers; create + PATCH a case", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const unauth = await app.inject({ method: "PATCH", url: "/api/service/cases/x", payload: { status: "open" } });
    assert.strictEqual(unauth.statusCode, 401);
    const cookie = await login(app);
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie } })).json();
    assert.ok(Array.isArray(console1.cases) && console1.cases.length >= 1);
    assert.ok(Array.isArray(console1.customers) && console1.customers.length >= 1);
    assert.ok(Array.isArray(console1.agents) && console1.agents.length >= 1);
    assert.ok(Array.isArray(console1.slaPolicies) && console1.slaPolicies.length >= 3);

    const customerId = console1.cases[0].customerId;
    const created = await app.inject({ method: "POST", url: "/api/service/cases", headers: { cookie },
      payload: { customerId, subject: "Printer not working", priority: "high", channel: "Email" } });
    assert.strictEqual(created.statusCode, 200);
    const caseId = created.json().case.id;
    assert.strictEqual(created.json().case.status, "open");

    const moved = await app.inject({ method: "PATCH", url: `/api/service/cases/${caseId}`, headers: { cookie }, payload: { status: "in-progress" } });
    assert.strictEqual(moved.statusCode, 200);
    assert.strictEqual(moved.json().case.status, "in-progress");

    const bad = await app.inject({ method: "PATCH", url: `/api/service/cases/${caseId}`, headers: { cookie }, payload: { status: "bogus" } });
    assert.strictEqual(bad.statusCode, 400);

    const agentId = console1.agents.find(a => a.id).id;
    const reassigned = await app.inject({ method: "PATCH", url: `/api/service/cases/${caseId}`, headers: { cookie }, payload: { ownerUserId: agentId } });
    assert.strictEqual(reassigned.statusCode, 200);
    const badOwner = await app.inject({ method: "PATCH", url: `/api/service/cases/${caseId}`, headers: { cookie }, payload: { ownerUserId: "nope" } });
    assert.strictEqual(badOwner.statusCode, 400);

    const missing = await app.inject({ method: "PATCH", url: "/api/service/cases/does-not-exist", headers: { cookie }, payload: { status: "open" } });
    assert.strictEqual(missing.statusCode, 404);
  } finally { await app.close(); }
});

test("service field visits are seeded, listed, and exposed in the service console", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const unauth = await app.inject({ method: "GET", url: "/api/service/field-visits" });
    assert.strictEqual(unauth.statusCode, 401);

    const auditorCookie = await login(app, "auditor@armosphera.local");
    const forbidden = await app.inject({ method: "GET", url: "/api/service/field-visits", headers: { cookie: auditorCookie } });
    assert.strictEqual(forbidden.statusCode, 403);

    const cookie = await login(app);
    const listed = await app.inject({ method: "GET", url: "/api/service/field-visits", headers: { cookie } });
    assert.strictEqual(listed.statusCode, 200, listed.body);
    const visits = listed.json().visits;
    assert.ok(Array.isArray(visits) && visits.length >= 1);
    assert.ok(visits[0].caseNumber);
    assert.ok(visits[0].subject);
    assert.ok(visits[0].customerName);
    assert.ok(visits[0].assignedUserName);

    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie } })).json();
    assert.ok(Array.isArray(console1.fieldVisits));
    assert.ok(console1.fieldVisits.some(visit => visit.id === visits[0].id));
  } finally { await app.close(); }
});

test("creating a service field visit validates case/customer/user and appears in console", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie } })).json();
    const serviceCase = console1.cases[0];
    const assignee = console1.agents.find(agent => agent.role === "Service Manager") || console1.agents[0];
    const scheduledStartAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const scheduledEndAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();

    const created = await app.inject({
      method: "POST",
      url: "/api/service/field-visits",
      headers: { cookie },
      payload: {
        caseId: serviceCase.id,
        customerId: serviceCase.customerId,
        assignedUserId: assignee.id,
        scheduledStartAt,
        scheduledEndAt,
        status: "scheduled",
        location: "Nare Clinic reception",
        worksheetSummary: "Check printer queue and capture onsite evidence."
      }
    });
    assert.strictEqual(created.statusCode, 200, created.body);
    const visit = created.json().visit;
    assert.strictEqual(visit.caseId, serviceCase.id);
    assert.strictEqual(visit.caseNumber, serviceCase.caseNumber);
    assert.strictEqual(visit.customerId, serviceCase.customerId);
    assert.strictEqual(visit.customerName, serviceCase.customerName);
    assert.strictEqual(visit.assignedUserId, assignee.id);
    assert.strictEqual(visit.assignedUserName, assignee.name);
    assert.strictEqual(visit.scheduledStartAt, scheduledStartAt);
    assert.strictEqual(visit.scheduledEndAt, scheduledEndAt);

    const console2 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie } })).json();
    assert.ok(console2.fieldVisits.some(item => item.id === visit.id));
    const auditCount = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?").get("service.field_visit.created").count;
    assert.strictEqual(auditCount, 1);
  } finally { await app.close(); }
});

test("PATCH updates service field visit worksheet, status, time, and assignee", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie } })).json();
    const visit = console1.fieldVisits[0];
    const assignee = console1.agents.find(agent => agent.id !== visit.assignedUserId) || console1.agents[0];
    const scheduledStartAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const scheduledEndAt = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/service/field-visits/${visit.id}`,
      headers: { cookie },
      payload: {
        status: "in-progress",
        location: "Nare Clinic server room",
        worksheetSummary: "Technician confirmed router power cycle and attached service notes.",
        scheduledStartAt,
        scheduledEndAt,
        assignedUserId: assignee.id
      }
    });
    assert.strictEqual(patched.statusCode, 200, patched.body);
    assert.strictEqual(patched.json().visit.status, "in-progress");
    assert.strictEqual(patched.json().visit.location, "Nare Clinic server room");
    assert.strictEqual(patched.json().visit.worksheetSummary, "Technician confirmed router power cycle and attached service notes.");
    assert.strictEqual(patched.json().visit.scheduledStartAt, scheduledStartAt);
    assert.strictEqual(patched.json().visit.scheduledEndAt, scheduledEndAt);
    assert.strictEqual(patched.json().visit.assignedUserId, assignee.id);

    const badWindow = await app.inject({
      method: "PATCH",
      url: `/api/service/field-visits/${visit.id}`,
      headers: { cookie },
      payload: { scheduledStartAt: scheduledEndAt, scheduledEndAt: scheduledStartAt }
    });
    assert.strictEqual(badWindow.statusCode, 400);
    const auditCount = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?").get("service.field_visit.updated").count;
    assert.strictEqual(auditCount, 1);
  } finally { await app.close(); }
});

test("service field visit writes are supervisor gated and tenant isolated", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const operatorCookie = await login(app, "operator@armosphera.local");
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } })).json();
    const serviceCase = console1.cases[0];
    const assignee = console1.agents.find(agent => agent.role === "Service Manager") || console1.agents[0];
    const scheduledStartAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    const scheduledEndAt = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
    const payload = {
      caseId: serviceCase.id,
      customerId: serviceCase.customerId,
      assignedUserId: assignee.id,
      scheduledStartAt,
      scheduledEndAt,
      location: "Customer branch",
      worksheetSummary: "Operator should not be able to create this visit."
    };
    const ownerOrgId = app.db.prepare("SELECT org_id FROM users WHERE email = ?").get(DEFAULT_EMAIL).org_id;
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM service_field_visits WHERE org_id = ?").get(ownerOrgId).count;

    const blocked = await app.inject({ method: "POST", url: "/api/service/field-visits", headers: { cookie: operatorCookie }, payload });
    assert.strictEqual(blocked.statusCode, 403);
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM service_field_visits WHERE org_id = ?").get(ownerOrgId).count, before);

    const now = new Date().toISOString();
    const hash = app.db.prepare("SELECT password_hash FROM users WHERE id = ?").get("user-owner").password_hash;
    app.db.prepare("INSERT INTO organizations (id, name, legal_name, tax_id, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("org-field-foreign", "Foreign Field Org", "Foreign Field Org LLC", "99990000", "AMD", now);
    app.db.prepare(`
      INSERT INTO customers (id, org_id, name, tax_id, email, phone, segment, health_score, lifetime_value, open_receivables, last_touch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("cust-field-foreign", "org-field-foreign", "Foreign Field Customer", "99990001", "foreign@example.com", "", "Other", 50, 0, 0, "2026-05-01");
    app.db.prepare("INSERT INTO users (id, org_id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("user-field-foreign", "org-field-foreign", "field.foreign@armosphera.local", "Foreign Field User", "Service Manager", hash, now);
    app.db.prepare(`
      INSERT INTO service_cases (
        id, org_id, customer_id, ticket_id, case_number, subject, status, priority,
        channel, owner_user_id, sla_due_at, sla_status, ai_suggestion,
        knowledge_article, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "case-field-foreign",
      "org-field-foreign",
      "cust-field-foreign",
      null,
      "FOREIGN-CASE-1",
      "Foreign service case",
      "open",
      "medium",
      "Email",
      "user-field-foreign",
      scheduledEndAt,
      "on-track",
      "Foreign suggestion",
      "KB-GENERAL-SERVICE",
      now,
      now
    );

    const foreignCase = await app.inject({
      method: "POST",
      url: "/api/service/field-visits",
      headers: { cookie: ownerCookie },
      payload: { ...payload, caseId: "case-field-foreign" }
    });
    assert.strictEqual(foreignCase.statusCode, 404);

    const foreignUser = await app.inject({
      method: "POST",
      url: "/api/service/field-visits",
      headers: { cookie: ownerCookie },
      payload: { ...payload, assignedUserId: "user-field-foreign" }
    });
    assert.strictEqual(foreignUser.statusCode, 400);
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM service_field_visits WHERE org_id = ?").get(ownerOrgId).count, before);
  } finally { await app.close(); }
});

test("malformed service field visit route/body has no side effects and no secret echo", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const ownerOrgId = app.db.prepare("SELECT org_id FROM users WHERE email = ?").get(DEFAULT_EMAIL).org_id;
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM service_field_visits WHERE org_id = ?").get(ownerOrgId).count;
    const secret = "sk-live-field-visit-secret";
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie } })).json();
    const serviceCase = console1.cases[0];
    const assignee = console1.agents[0];
    const scheduledEndAt = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString();

    const badPath = await app.inject({
      method: "PATCH",
      url: "/api/service/field-visits/NOT-SAFE",
      headers: { cookie },
      payload: { worksheetSummary: secret }
    });
    assert.strictEqual(badPath.statusCode, 400);
    assert.ok(!badPath.body.includes(secret), badPath.body);

    const badBody = await app.inject({
      method: "POST",
      url: "/api/service/field-visits",
      headers: { cookie },
      payload: {
        caseId: serviceCase.id,
        customerId: serviceCase.customerId,
        assignedUserId: assignee.id,
        scheduledStartAt: secret,
        scheduledEndAt,
        location: "Bad request location"
      }
    });
    assert.strictEqual(badBody.statusCode, 400);
    assert.ok(!badBody.body.includes(secret), badBody.body);
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM service_field_visits WHERE org_id = ?").get(ownerOrgId).count, before);
    const auditCount = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type LIKE 'service.field_visit.%'").get().count;
    assert.strictEqual(auditCount, 0);
  } finally { await app.close(); }
});

test("service SLA policies are seeded, listed, and service-access gated", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();

    const unauth = await app.inject({ method: "GET", url: "/api/service/sla-policies" });
    assert.strictEqual(unauth.statusCode, 401);

    const auditorCookie = await login(app, "auditor@armosphera.local");
    const forbidden = await app.inject({ method: "GET", url: "/api/service/sla-policies", headers: { cookie: auditorCookie } });
    assert.strictEqual(forbidden.statusCode, 403);

    const cookie = await login(app);
    const response = await app.inject({ method: "GET", url: "/api/service/sla-policies", headers: { cookie } });
    assert.strictEqual(response.statusCode, 200, response.body);
    const policies = response.json().policies;
    assert.ok(policies.some(policy => policy.priority === "high" && policy.channel === "" && policy.resolutionMinutes === 240));
    assert.ok(policies.some(policy => policy.priority === "medium" && policy.channel === "" && policy.resolutionMinutes === 1440));
    assert.ok(policies.some(policy => policy.priority === "low" && policy.channel === "" && policy.resolutionMinutes === 1440));
    assert.ok(policies.some(policy => policy.priority === "high" && policy.channel === "Telegram"));
  } finally { await app.close(); }
});

test("creating a service case uses the best matching active SLA policy", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie } })).json();
    const customerId = console1.customers[0].id;

    const policy = await app.inject({
      method: "POST",
      url: "/api/service/sla-policies",
      headers: { cookie },
      payload: {
        name: "Email high priority evidence",
        priority: "high",
        channel: "Email",
        responseMinutes: 10,
        resolutionMinutes: 90,
        active: true
      }
    });
    assert.strictEqual(policy.statusCode, 200, policy.body);

    const startedAt = Date.now();
    const created = await app.inject({
      method: "POST",
      url: "/api/service/cases",
      headers: { cookie },
      payload: { customerId, subject: "Email escalation response window", priority: "high", channel: "Email" }
    });
    assert.strictEqual(created.statusCode, 200, created.body);
    const dueDelta = new Date(created.json().case.slaDueAt).getTime() - startedAt;
    assert.ok(dueDelta >= 89 * 60 * 1000, `due date too early: ${dueDelta}`);
    assert.ok(dueDelta <= 91 * 60 * 1000, `due date too late: ${dueDelta}`);

    const fallbackChannel = await app.inject({
      method: "POST",
      url: "/api/service/cases",
      headers: { cookie },
      payload: { customerId, subject: "Manual high fallback policy", priority: "high", channel: "Manual" }
    });
    assert.strictEqual(fallbackChannel.statusCode, 200, fallbackChannel.body);
    const fallbackDelta = new Date(fallbackChannel.json().case.slaDueAt).getTime() - startedAt;
    assert.ok(fallbackDelta >= 239 * 60 * 1000, `fallback due date too early: ${fallbackDelta}`);
    assert.ok(fallbackDelta <= 241 * 60 * 1000, `fallback due date too late: ${fallbackDelta}`);

    const ownerOrgId = app.db.prepare("SELECT org_id FROM users WHERE email = ?").get(DEFAULT_EMAIL).org_id;
    app.db.prepare("DELETE FROM service_sla_policies WHERE org_id = ?").run(ownerOrgId);
    const noPolicyStartedAt = Date.now();
    const noPolicy = await app.inject({
      method: "POST",
      url: "/api/service/cases",
      headers: { cookie },
      payload: { customerId, subject: "No policy fallback window", priority: "low", channel: "Phone" }
    });
    assert.strictEqual(noPolicy.statusCode, 200, noPolicy.body);
    const noPolicyDelta = new Date(noPolicy.json().case.slaDueAt).getTime() - noPolicyStartedAt;
    assert.ok(noPolicyDelta >= 1439 * 60 * 1000, `no-policy due date too early: ${noPolicyDelta}`);
    assert.ok(noPolicyDelta <= 1441 * 60 * 1000, `no-policy due date too late: ${noPolicyDelta}`);
  } finally { await app.close(); }
});

test("service SLA policy writes are supervisor gated and tenant isolated", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const operatorCookie = await login(app, "operator@armosphera.local");
    const ownerOrgId = app.db.prepare("SELECT org_id FROM users WHERE email = ?").get(DEFAULT_EMAIL).org_id;

    const before = app.db.prepare("SELECT COUNT(*) AS count FROM service_sla_policies WHERE org_id = ?").get(ownerOrgId).count;
    const blocked = await app.inject({
      method: "POST",
      url: "/api/service/sla-policies",
      headers: { cookie: operatorCookie },
      payload: { name: "Operator cannot write", priority: "medium", channel: "Phone", responseMinutes: 30, resolutionMinutes: 120 }
    });
    assert.strictEqual(blocked.statusCode, 403);
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM service_sla_policies WHERE org_id = ?").get(ownerOrgId).count, before);

    const now = new Date().toISOString();
    const otherOrgId = "org-other-sla";
    app.db.prepare("INSERT INTO organizations (id, name, legal_name, tax_id, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(otherOrgId, "Other SLA LLC", "Other SLA LLC", "55555555", "AMD", now);
    app.db.prepare(`
      INSERT INTO service_sla_policies (
        id, org_id, name, priority, channel, response_minutes, resolution_minutes,
        active, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("sla-foreign-email-high", otherOrgId, "Foreign policy", "high", "Email", 1, 1, 1, now, now);

    const list = (await app.inject({ method: "GET", url: "/api/service/sla-policies", headers: { cookie: ownerCookie } })).json();
    assert.ok(!list.policies.some(policy => policy.id === "sla-foreign-email-high"));

    const created = await app.inject({
      method: "POST",
      url: "/api/service/sla-policies",
      headers: { cookie: ownerCookie },
      payload: { orgId: otherOrgId, name: "Phone low owner policy", priority: "low", channel: "Phone", responseMinutes: 120, resolutionMinutes: 360 }
    });
    assert.strictEqual(created.statusCode, 200, created.body);
    assert.strictEqual(created.json().policy.channel, "Phone");
    assert.strictEqual(created.json().policy.priority, "low");
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM service_sla_policies WHERE org_id = ?").get(otherOrgId).count, 1);
    assert.ok(app.db.prepare("SELECT id FROM service_sla_policies WHERE org_id = ? AND priority = 'low' AND channel = 'Phone'").get(ownerOrgId));
  } finally { await app.close(); }
});

test("malformed service SLA policy input has no side effects and no secret echo", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const ownerOrgId = app.db.prepare("SELECT org_id FROM users WHERE email = ?").get(DEFAULT_EMAIL).org_id;
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM service_sla_policies WHERE org_id = ?").get(ownerOrgId).count;
    const secret = "sk-live-do-not-echo";

    const bad = await app.inject({
      method: "POST",
      url: "/api/service/sla-policies",
      headers: { cookie },
      payload: { name: "Bad secret policy", priority: "high", channel: "Email", responseMinutes: secret, resolutionMinutes: 120 }
    });
    assert.strictEqual(bad.statusCode, 400);
    assert.ok(!bad.body.includes(secret), bad.body);
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM service_sla_policies WHERE org_id = ?").get(ownerOrgId).count, before);
  } finally { await app.close(); }
});

test("PATCH cannot de-escalate a supervisor-governed case without supervisor role", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app); // Owner is a service supervisor
    const list = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } })).json();
    const caseId = list.cases[0].id;

    // Owner (supervisor) escalates -> status becomes "escalated" (governed state)
    const escalated = await app.inject({ method: "POST", url: `/api/service/cases/${caseId}/escalate`, headers: { cookie: ownerCookie }, payload: { severity: "sla-risk", reason: "test escalation" } });
    assert.strictEqual(escalated.statusCode, 200);

    // A non-supervisor (Operator) must NOT be able to de-escalate via generic PATCH
    const opCookie = await login(app, "operator@armosphera.local");
    const blocked = await app.inject({ method: "PATCH", url: `/api/service/cases/${caseId}`, headers: { cookie: opCookie }, payload: { status: "in-progress" } });
    assert.strictEqual(blocked.statusCode, 403);

    // A supervisor still can
    const allowed = await app.inject({ method: "PATCH", url: `/api/service/cases/${caseId}`, headers: { cookie: ownerCookie }, payload: { status: "in-progress" } });
    assert.strictEqual(allowed.statusCode, 200);
    assert.strictEqual(allowed.json().case.status, "in-progress");
  } finally { await app.close(); }
});
