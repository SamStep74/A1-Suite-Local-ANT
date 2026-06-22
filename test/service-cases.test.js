"use strict";
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

async function createFieldVisit(app, cookie, {
  serviceCase,
  assignedUserId,
  projectId = null,
  startOffsetHours = 12,
  location = "Customer site",
  worksheetSummary = "Technician worksheet prepared for service evidence.",
  status = "scheduled"
}) {
  const scheduledStartAt = new Date(Date.now() + startOffsetHours * 60 * 60 * 1000).toISOString();
  const scheduledEndAt = new Date(Date.now() + (startOffsetHours + 1) * 60 * 60 * 1000).toISOString();
  const response = await app.inject({
    method: "POST",
    url: "/api/service/field-visits",
    headers: { cookie },
    payload: {
      caseId: serviceCase.id,
      customerId: serviceCase.customerId,
      ...(projectId ? { projectId } : {}),
      assignedUserId,
      scheduledStartAt,
      scheduledEndAt,
      status,
      location,
      worksheetSummary
    }
  });
  assert.strictEqual(response.statusCode, 200, response.body);
  return response.json().visit;
}

function dispatchAlertId(kind, visitId, dedupeKey) {
  const version = crypto.createHash("sha256").update(dedupeKey, "utf8").digest("hex").slice(0, 12);
  return `svc-dispatch-alert-${kind}-v${version}-${visitId}`;
}

function assertDispatchNavigationEvidence(visit, expectedAddress = visit.location) {
  const navigation = visit.dispatchNavigation;
  assert.ok(navigation && typeof navigation === "object");
  assert.strictEqual(navigation.provider, "google-maps");
  assert.strictEqual(navigation.source, "service_field_visits.location");
  assert.strictEqual(navigation.address, expectedAddress);
  assert.ok(navigation.mapQuery.includes(expectedAddress), navigation.mapQuery);
  if (visit.customerName) assert.ok(navigation.mapQuery.includes(visit.customerName), navigation.mapQuery);
  if (visit.caseNumber) assert.ok(navigation.mapQuery.includes(visit.caseNumber), navigation.mapQuery);

  const mapUrl = new URL(navigation.mapUrl);
  assert.strictEqual(mapUrl.protocol, "https:");
  assert.strictEqual(mapUrl.hostname, "www.google.com");
  assert.strictEqual(mapUrl.pathname, "/maps/search/");
  assert.strictEqual(mapUrl.searchParams.get("api"), "1");
  assert.strictEqual(mapUrl.searchParams.get("query"), navigation.mapQuery);

  const directionsUrl = new URL(navigation.directionsUrl);
  assert.strictEqual(directionsUrl.protocol, "https:");
  assert.strictEqual(directionsUrl.hostname, "www.google.com");
  assert.strictEqual(directionsUrl.pathname, "/maps/dir/");
  assert.strictEqual(directionsUrl.searchParams.get("api"), "1");
  assert.strictEqual(directionsUrl.searchParams.get("destination"), expectedAddress);

  for (const url of [navigation.mapUrl, navigation.directionsUrl]) {
    assert.doesNotMatch(url, /[\x00-\x1f\x7f]/);
    assert.doesNotMatch(url, /\s/);
    assert.ok(url.startsWith("https://"));
  }
  return navigation;
}

function assertNavigationUrlsEncodeSpecialAddress(navigation, address) {
  const encodedAddress = new URLSearchParams({ value: address }).toString().replace(/^value=/, "");
  assert.ok(navigation.mapUrl.includes(encodedAddress), navigation.mapUrl);
  assert.ok(navigation.directionsUrl.includes(encodedAddress), navigation.directionsUrl);
  assert.ok(!navigation.mapUrl.includes(address), navigation.mapUrl);
  assert.ok(!navigation.directionsUrl.includes(address), navigation.directionsUrl);
}

function assertRouteOptimizationEvidence(visit, { stopNumber, totalStops }) {
  const routeOptimization = visit.dispatchNavigation?.routeOptimization;
  assert.ok(routeOptimization && typeof routeOptimization === "object");
  assert.strictEqual(routeOptimization.strategy, "scheduled-window-order-v1");
  assert.strictEqual(routeOptimization.status, "fallback");
  assert.strictEqual(routeOptimization.provider, "local-schedule");
  assert.strictEqual(routeOptimization.source, "service_field_visits.scheduled_start_at");
  assert.strictEqual(routeOptimization.locationSource, "service_field_visits.location");
  assert.strictEqual(routeOptimization.stopNumber, stopNumber);
  assert.strictEqual(routeOptimization.totalStops, totalStops);
  assert.strictEqual(routeOptimization.referenceAt, visit.scheduledStartAt);
  assert.strictEqual(routeOptimization.computedAt, visit.updatedAt || visit.createdAt || visit.scheduledStartAt);
  assert.deepStrictEqual(routeOptimization.limitations, ["distance-matrix-not-run"]);
  assert.ok(routeOptimization.summary.includes(`stop ${stopNumber} of ${totalStops}`), routeOptimization.summary);
}

function assertCostAllocationEvidence(visit, expectedMinutes = null) {
  const costAllocation = visit.costAllocation;
  assert.ok(costAllocation && typeof costAllocation === "object");
  assert.strictEqual(costAllocation.strategy, "scheduled-window-cost-basis-v1");
  assert.strictEqual(costAllocation.status, "estimate");
  assert.strictEqual(costAllocation.currency, "AMD");
  if (expectedMinutes !== null) {
    assert.strictEqual(costAllocation.scheduledMinutes, expectedMinutes);
    assert.strictEqual(costAllocation.laborMinutes, expectedMinutes);
  } else {
    assert.ok(Number.isSafeInteger(costAllocation.scheduledMinutes));
    assert.ok(costAllocation.scheduledMinutes >= 0);
  }
  assert.strictEqual(costAllocation.laborCost, 0);
  assert.strictEqual(costAllocation.travelCost, 0);
  assert.strictEqual(costAllocation.materialCost, 0);
  assert.strictEqual(costAllocation.totalCost, 0);
  assert.strictEqual(costAllocation.source, "service_field_visits.scheduled_start_at/service_field_visits.scheduled_end_at");
  assert.ok(Array.isArray(costAllocation.ledgerMappings));
  assert.ok(costAllocation.ledgerMappings.some(mapping => mapping.bucket === "labor" && mapping.managementAccount === "8112" && mapping.recognitionAccount === "7113" && mapping.status === "not-posted"));
  assert.ok(costAllocation.ledgerMappings.some(mapping => mapping.bucket === "travel" && mapping.expenseAccount === "713" && mapping.status === "not-posted"));
  assert.ok(costAllocation.ledgerMappings.some(mapping => mapping.bucket === "materials" && mapping.inventoryAccountClass === "2" && mapping.status === "not-posted"));
  assert.deepStrictEqual(costAllocation.limitations, [
    "labor-rate-not-configured",
    "travel-rate-not-configured",
    "inventory-consumption-not-linked",
    "not-posted-to-ledger"
  ]);
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
    const listedNavigation = assertDispatchNavigationEvidence(visits[0]);
    assertCostAllocationEvidence(visits[0]);

    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie } })).json();
    assert.ok(Array.isArray(console1.fieldVisits));
    const consoleVisit = console1.fieldVisits.find(visit => visit.id === visits[0].id);
    assert.ok(consoleVisit);
    assert.deepStrictEqual(consoleVisit.dispatchNavigation, listedNavigation);
    assert.deepStrictEqual(consoleVisit.costAllocation, visits[0].costAllocation);
  } finally { await app.close(); }
});

test("route optimization evidence orders active field visit stops by scheduled window", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const supportCookie = await login(app, "support@armosphera.local");
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } })).json();
    const serviceCase = console1.cases[0];
    const support = console1.agents.find(agent => agent.role === "Support");
    const manager = console1.agents.find(agent => agent.role === "Service Manager");
    assert.ok(support);
    assert.ok(manager);

    const laterSupportVisit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: support.id,
      startOffsetHours: 31,
      location: "Route stop beta"
    });
    const terminalSupportVisit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: support.id,
      startOffsetHours: 30,
      location: "Route terminal stop",
      status: "completed"
    });
    const earlierSupportVisit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: support.id,
      startOffsetHours: 29,
      location: "Route stop alpha"
    });
    const managerVisit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: manager.id,
      startOffsetHours: 28,
      location: "Manager route stop"
    });

    const listed = await app.inject({ method: "GET", url: "/api/service/field-visits", headers: { cookie: ownerCookie } });
    assert.strictEqual(listed.statusCode, 200, listed.body);
    const visits = listed.json().visits;
    const earlierListed = visits.find(visit => visit.id === earlierSupportVisit.id);
    const laterListed = visits.find(visit => visit.id === laterSupportVisit.id);
    const terminalListed = visits.find(visit => visit.id === terminalSupportVisit.id);
    assert.ok(earlierListed);
    assert.ok(laterListed);
    assert.ok(terminalListed);
    assertDispatchNavigationEvidence(earlierListed, earlierSupportVisit.location);
    assertDispatchNavigationEvidence(laterListed, laterSupportVisit.location);
    assertRouteOptimizationEvidence(earlierListed, { stopNumber: 1, totalStops: 2 });
    assertRouteOptimizationEvidence(laterListed, { stopNumber: 2, totalStops: 2 });
    assertCostAllocationEvidence(earlierListed, 60);
    assertCostAllocationEvidence(laterListed, 60);
    assertCostAllocationEvidence(terminalListed, 60);
    assert.strictEqual(terminalListed.dispatchNavigation.routeOptimization, undefined);

    const listedMine = await app.inject({ method: "GET", url: "/api/service/my-field-visits", headers: { cookie: supportCookie } });
    assert.strictEqual(listedMine.statusCode, 200, listedMine.body);
    const myVisits = listedMine.json().visits;
    assert.ok(myVisits.some(visit => visit.id === earlierSupportVisit.id));
    assert.ok(myVisits.some(visit => visit.id === terminalSupportVisit.id));
    assert.ok(!myVisits.some(visit => visit.id === managerVisit.id));
    assert.ok(myVisits.every(visit => visit.assignedUserId === support.id));
    assertRouteOptimizationEvidence(myVisits.find(visit => visit.id === earlierSupportVisit.id), { stopNumber: 1, totalStops: 2 });
    assertRouteOptimizationEvidence(myVisits.find(visit => visit.id === laterSupportVisit.id), { stopNumber: 2, totalStops: 2 });
    assertCostAllocationEvidence(myVisits.find(visit => visit.id === earlierSupportVisit.id), 60);
  } finally { await app.close(); }
});

test("route optimization evidence on field visit lists preserves tenant isolation", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } })).json();
    const serviceCase = console1.cases[0];
    const support = console1.agents.find(agent => agent.role === "Support");
    assert.ok(support);

    const ownerVisit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: support.id,
      startOffsetHours: 35,
      location: "Tenant owner route stop"
    });
    const now = new Date().toISOString();
    app.db.prepare("INSERT INTO organizations (id, name, legal_name, tax_id, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("org-route-foreign", "Route Foreign Org", "Route Foreign Org LLC", "78787878", "AMD", now);
    app.db.prepare(`
      INSERT INTO customers (id, org_id, name, tax_id, email, phone, segment, health_score, lifetime_value, open_receivables, last_touch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("cust-route-foreign", "org-route-foreign", "Route Foreign Customer", "78787879", "route.foreign@example.com", "", "Other", 50, 0, 0, "2026-05-01");
    app.db.prepare(`
      INSERT INTO service_cases (
        id, org_id, customer_id, ticket_id, case_number, subject, status, priority,
        channel, owner_user_id, sla_due_at, sla_status, ai_suggestion,
        knowledge_article, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "case-route-foreign",
      "org-route-foreign",
      "cust-route-foreign",
      null,
      "ROUTE-FOREIGN-1",
      "Foreign route case",
      "open",
      "medium",
      "Email",
      null,
      new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
      "on-track",
      "Foreign route suggestion",
      "KB-GENERAL-SERVICE",
      now,
      now
    );
    app.db.prepare(`
      INSERT INTO service_field_visits (
        id, org_id, case_id, customer_id, assigned_user_id,
        scheduled_start_at, scheduled_end_at, status, location,
        worksheet_summary, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "visit-route-foreign",
      "org-route-foreign",
      "case-route-foreign",
      "cust-route-foreign",
      support.id,
      new Date(Date.now() + 34 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() + 35 * 60 * 60 * 1000).toISOString(),
      "scheduled",
      "Foreign route stop",
      "Foreign route worksheet should remain isolated.",
      now,
      now
    );

    const listed = await app.inject({ method: "GET", url: "/api/service/field-visits", headers: { cookie: ownerCookie } });
    assert.strictEqual(listed.statusCode, 200, listed.body);
    assert.ok(!listed.json().visits.some(visit => visit.id === "visit-route-foreign"));
    const listedVisit = listed.json().visits.find(visit => visit.id === ownerVisit.id);
    assert.ok(listedVisit);
    assertRouteOptimizationEvidence(listedVisit, { stopNumber: 1, totalStops: 1 });

    const console2 = await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } });
    assert.strictEqual(console2.statusCode, 200, console2.body);
    assert.ok(!console2.json().fieldVisits.some(visit => visit.id === "visit-route-foreign"));
    const consoleVisit = console2.json().fieldVisits.find(visit => visit.id === ownerVisit.id);
    assert.ok(consoleVisit);
    assertRouteOptimizationEvidence(consoleVisit, { stopNumber: 1, totalStops: 1 });
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
    const linkedProject = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: {
        name: "Service-linked project",
        customerId: serviceCase.customerId,
        status: "active"
      }
    });
    assert.strictEqual(linkedProject.statusCode, 200, linkedProject.body);
    const scheduledStartAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const scheduledEndAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    const location = "Nare Clinic & Warehouse #7 / Komitas 12";

    const created = await app.inject({
      method: "POST",
      url: "/api/service/field-visits",
      headers: { cookie },
      payload: {
        caseId: serviceCase.id,
        customerId: serviceCase.customerId,
        projectId: linkedProject.json().project.id,
        assignedUserId: assignee.id,
        scheduledStartAt,
        scheduledEndAt,
        status: "scheduled",
        location,
        worksheetSummary: "Check printer queue and capture onsite evidence."
      }
    });
    assert.strictEqual(created.statusCode, 200, created.body);
    const visit = created.json().visit;
    assert.strictEqual(visit.caseId, serviceCase.id);
    assert.strictEqual(visit.caseNumber, serviceCase.caseNumber);
    assert.strictEqual(visit.customerId, serviceCase.customerId);
    assert.strictEqual(visit.projectId, linkedProject.json().project.id);
    assert.strictEqual(visit.customerName, serviceCase.customerName);
    assert.strictEqual(visit.assignedUserId, assignee.id);
    assert.strictEqual(visit.assignedUserName, assignee.name);
    assert.strictEqual(visit.scheduledStartAt, scheduledStartAt);
    assert.strictEqual(visit.scheduledEndAt, scheduledEndAt);
    assert.strictEqual(visit.location, location);
    assertNavigationUrlsEncodeSpecialAddress(assertDispatchNavigationEvidence(visit, location), location);

    const console2 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie } })).json();
    const consoleVisit = console2.fieldVisits.find(item => item.id === visit.id);
    assert.ok(consoleVisit);
    assertDispatchNavigationEvidence(consoleVisit, location);
    const auditCount = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?").get("service.field_visit.created").count;
    assert.strictEqual(auditCount, 1);

    const otherCustomer = console1.customers.find(customer => customer.id !== serviceCase.customerId);
    assert.ok(otherCustomer);
    const mismatchedProject = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: {
        name: "Wrong customer project",
        customerId: otherCustomer.id,
        status: "active"
      }
    });
    assert.strictEqual(mismatchedProject.statusCode, 200, mismatchedProject.body);
    const rejectedProject = await app.inject({
      method: "POST",
      url: "/api/service/field-visits",
      headers: { cookie },
      payload: {
        caseId: serviceCase.id,
        customerId: serviceCase.customerId,
        projectId: mismatchedProject.json().project.id,
        assignedUserId: assignee.id,
        scheduledStartAt,
        scheduledEndAt,
        status: "scheduled",
        location,
        worksheetSummary: "This visit should not link to a mismatched customer project."
      }
    });
    assert.strictEqual(rejectedProject.statusCode, 400, rejectedProject.body);
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
    const linkedProject = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: {
        name: "PATCH-linked service project",
        customerId: visit.customerId,
        status: "active"
      }
    });
    assert.strictEqual(linkedProject.statusCode, 200, linkedProject.body);
    const scheduledStartAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const scheduledEndAt = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();
    const location = "Nare Clinic & Server #2 / Komitas 18";

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/service/field-visits/${visit.id}`,
      headers: { cookie },
      payload: {
        status: "in-progress",
        location,
        worksheetSummary: "Technician confirmed router power cycle and attached service notes.",
        scheduledStartAt,
        scheduledEndAt,
        assignedUserId: assignee.id,
        projectId: linkedProject.json().project.id
      }
    });
    assert.strictEqual(patched.statusCode, 200, patched.body);
    const patchedVisit = patched.json().visit;
    assert.strictEqual(patchedVisit.status, "in-progress");
    assert.strictEqual(patchedVisit.location, location);
    assert.strictEqual(patchedVisit.worksheetSummary, "Technician confirmed router power cycle and attached service notes.");
    assert.strictEqual(patchedVisit.scheduledStartAt, scheduledStartAt);
    assert.strictEqual(patchedVisit.scheduledEndAt, scheduledEndAt);
    assert.strictEqual(patchedVisit.assignedUserId, assignee.id);
    assert.strictEqual(patchedVisit.projectId, linkedProject.json().project.id);
    assert.notStrictEqual(patchedVisit.dispatchNavigation.address, visit.dispatchNavigation.address);
    assertNavigationUrlsEncodeSpecialAddress(assertDispatchNavigationEvidence(patchedVisit, location), location);

    const otherCustomer = console1.customers.find(customer => customer.id !== visit.customerId);
    assert.ok(otherCustomer);
    const mismatchedProject = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: {
        name: "PATCH wrong customer project",
        customerId: otherCustomer.id,
        status: "active"
      }
    });
    assert.strictEqual(mismatchedProject.statusCode, 200, mismatchedProject.body);
    const rejectedProject = await app.inject({
      method: "PATCH",
      url: `/api/service/field-visits/${visit.id}`,
      headers: { cookie },
      payload: { projectId: mismatchedProject.json().project.id }
    });
    assert.strictEqual(rejectedProject.statusCode, 400, rejectedProject.body);

    const clearedProject = await app.inject({
      method: "PATCH",
      url: `/api/service/field-visits/${visit.id}`,
      headers: { cookie },
      payload: { projectId: null }
    });
    assert.strictEqual(clearedProject.statusCode, 200, clearedProject.body);
    assert.strictEqual(clearedProject.json().visit.projectId, null);

    const badWindow = await app.inject({
      method: "PATCH",
      url: `/api/service/field-visits/${visit.id}`,
      headers: { cookie },
      payload: { scheduledStartAt: scheduledEndAt, scheduledEndAt: scheduledStartAt }
    });
    assert.strictEqual(badWindow.statusCode, 400);
    const auditCount = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?").get("service.field_visit.updated").count;
    assert.strictEqual(auditCount, 2);
  } finally { await app.close(); }
});

test("assigned technician lists own visits and records technician status audit", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const supportCookie = await login(app, "support@armosphera.local");
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } })).json();
    const serviceCase = console1.cases[0];
    const support = console1.agents.find(agent => agent.role === "Support");
    const manager = console1.agents.find(agent => agent.role === "Service Manager");
    assert.ok(support);
    assert.ok(manager);

    const supportVisit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: support.id,
      startOffsetHours: 14,
      location: "Nare Clinic printer desk",
      worksheetSummary: "Initial technician worksheet."
    });
    const managerVisit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: manager.id,
      startOffsetHours: 16,
      location: "Nare Clinic server closet"
    });

    const listed = await app.inject({ method: "GET", url: "/api/service/my-field-visits", headers: { cookie: supportCookie } });
    assert.strictEqual(listed.statusCode, 200, listed.body);
    const visits = listed.json().visits;
    assert.ok(visits.some(visit => visit.id === supportVisit.id));
    assert.ok(!visits.some(visit => visit.id === managerVisit.id));
    assert.ok(visits.every(visit => visit.assignedUserId === support.id));
    assertDispatchNavigationEvidence(visits.find(visit => visit.id === supportVisit.id), supportVisit.location);

    const moves = [
      { status: "en-route", worksheetSummary: "Technician is en route with replacement paper tray.", changed: true },
      { status: "in-progress", changed: false },
      { status: "completed", worksheetSummary: "Printer queue cleared and customer confirmed output.", changed: true }
    ];
    for (const move of moves) {
      const moved = await app.inject({
        method: "POST",
        url: `/api/service/field-visits/${supportVisit.id}/technician-status`,
        headers: { cookie: supportCookie },
        payload: Object.prototype.hasOwnProperty.call(move, "worksheetSummary")
          ? { status: move.status, worksheetSummary: move.worksheetSummary }
          : { status: move.status }
      });
      assert.strictEqual(moved.statusCode, 200, moved.body);
      const movedBody = moved.json();
      assert.strictEqual(movedBody.visit.status, move.status);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(movedBody, "idempotent"), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(movedBody, "dispatchSync"), false);
      if (move.worksheetSummary) assert.strictEqual(movedBody.visit.worksheetSummary, move.worksheetSummary);
    }

    const auditRows = app.db.prepare(`
      SELECT user_id, details
      FROM audit_events
      WHERE type = ?
      ORDER BY id ASC
    `).all("service.field_visit.technician_status");
    assert.strictEqual(auditRows.length, 3);
    assert.ok(auditRows.every(row => row.user_id === support.id));
    const details = auditRows.map(row => JSON.parse(row.details));
    assert.deepStrictEqual(details.map(detail => detail.status), ["en-route", "in-progress", "completed"]);
    assert.deepStrictEqual(details.map(detail => detail.worksheetSummaryChanged), [true, false, true]);
    for (const detail of details) {
      assert.strictEqual(detail.visitId, supportVisit.id);
      assert.strictEqual(detail.caseId, serviceCase.id);
      assert.strictEqual(detail.customerId, serviceCase.customerId);
      assert.strictEqual(detail.actorUserId, support.id);
    }
  } finally { await app.close(); }
});

test("technician status supports offline-safe idempotent dispatch replay", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const supportCookie = await login(app, "support@armosphera.local");
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } })).json();
    const serviceCase = console1.cases[0];
    const support = console1.agents.find(agent => agent.role === "Support");
    assert.ok(support);
    const visit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: support.id,
      startOffsetHours: 17,
      location: "Nare Clinic dispatch desk",
      worksheetSummary: "Offline queue has not synced yet."
    });
    const idempotencyKey = "field-visit-replay-001";
    const payload = {
      status: "en-route",
      worksheetSummary: "Technician left the depot with replacement hardware.",
      idempotencyKey
    };

    const first = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${visit.id}/technician-status`,
      headers: { cookie: supportCookie },
      payload
    });
    assert.strictEqual(first.statusCode, 200, first.body);
    assert.strictEqual(first.json().idempotent, false);
    assert.deepStrictEqual(first.json().dispatchSync, { idempotencyKey, status: "en-route", replayed: false });
    assert.strictEqual(first.json().visit.status, "en-route");
    assert.strictEqual(first.json().visit.worksheetSummary, payload.worksheetSummary);

    const replay = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${visit.id}/technician-status`,
      headers: { cookie: supportCookie },
      payload
    });
    assert.strictEqual(replay.statusCode, 200, replay.body);
    assert.strictEqual(replay.json().idempotent, true);
    assert.deepStrictEqual(replay.json().dispatchSync, { idempotencyKey, status: "en-route", replayed: true });
    assert.strictEqual(replay.json().visit.status, "en-route");

    const auditRows = app.db.prepare(`
      SELECT details
      FROM audit_events
      WHERE type = ?
      ORDER BY id ASC
    `).all("service.field_visit.technician_status");
    assert.strictEqual(auditRows.length, 1);
    const details = JSON.parse(auditRows[0].details);
    assert.strictEqual(details.idempotencyKey, idempotencyKey);
    assert.strictEqual(details.dispatchSync.idempotencyKey, idempotencyKey);
    assert.strictEqual(details.dispatchSync.status, "en-route");
    assert.strictEqual(details.dispatchSync.replayed, false);
    assert.deepStrictEqual(Object.keys(details.dispatchSync.worksheetIntent).sort(), ["digest", "provided"]);
    assert.strictEqual(details.dispatchSync.worksheetIntent.provided, true);
    assert.ok(!auditRows[0].details.includes(payload.worksheetSummary), auditRows[0].details);

    const mismatchedWorksheet = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${visit.id}/technician-status`,
      headers: { cookie: supportCookie },
      payload: { ...payload, worksheetSummary: "A different offline note should be rejected." }
    });
    assert.strictEqual(mismatchedWorksheet.statusCode, 409, mismatchedWorksheet.body);
    assert.ok(!mismatchedWorksheet.body.includes(idempotencyKey), mismatchedWorksheet.body);

    const mismatchedStatus = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${visit.id}/technician-status`,
      headers: { cookie: supportCookie },
      payload: { ...payload, status: "in-progress" }
    });
    assert.strictEqual(mismatchedStatus.statusCode, 409, mismatchedStatus.body);

    const unchanged = app.db.prepare("SELECT status, worksheet_summary FROM service_field_visits WHERE id = ?").get(visit.id);
    assert.strictEqual(unchanged.status, "en-route");
    assert.strictEqual(unchanged.worksheet_summary, payload.worksheetSummary);
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?").get("service.field_visit.technician_status").count, 1);
  } finally { await app.close(); }
});

test("assigned technician dispatch alert feed is deterministic and assigned-only", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const supportCookie = await login(app, "support@armosphera.local");
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } })).json();
    const serviceCase = console1.cases[0];
    const support = console1.agents.find(agent => agent.role === "Support");
    const manager = console1.agents.find(agent => agent.role === "Service Manager");
    assert.ok(support);
    assert.ok(manager);

    const dueSoonVisit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: support.id,
      startOffsetHours: 1,
      location: "Nare Clinic soon dispatch desk"
    });
    const activeVisit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: support.id,
      startOffsetHours: -0.5,
      location: "Nare Clinic active route",
      status: "en-route"
    });
    const managerVisit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: manager.id,
      startOffsetHours: 1,
      location: "Nare Clinic manager-only alert"
    });

    const listed = await app.inject({ method: "GET", url: "/api/service/my-dispatch-alerts", headers: { cookie: supportCookie } });
    assert.strictEqual(listed.statusCode, 200, listed.body);
    const alerts = listed.json().alerts;
    assert.ok(alerts.length > 0);
    assert.ok(alerts.every(alert => alert.visitId !== managerVisit.id));
    assert.ok(alerts.every(alert => ["active-route", "due-soon", "gps-missing", "overdue-window"].includes(alert.kind)));

    const dueSoon = alerts.find(alert => alert.kind === "due-soon" && alert.visitId === dueSoonVisit.id);
    assert.ok(dueSoon);
    assert.strictEqual(dueSoon.dedupeKey, `service-field-visit:${dueSoonVisit.id}:due-soon:${dueSoonVisit.scheduledStartAt}`);
    assert.strictEqual(dueSoon.id, dispatchAlertId("due-soon", dueSoonVisit.id, dueSoon.dedupeKey));
    assert.strictEqual(dueSoon.severity, "medium");
    assert.strictEqual(dueSoon.notify, true);
    assert.strictEqual(dueSoon.caseNumber, serviceCase.caseNumber);
    assert.strictEqual(dueSoon.customerName, serviceCase.customerName);
    assert.strictEqual(dueSoon.location, dueSoonVisit.location);
    assert.strictEqual(dueSoon.status, "scheduled");
    assert.strictEqual(dueSoon.scheduledStartAt, dueSoonVisit.scheduledStartAt);
    assert.strictEqual(dueSoon.scheduledEndAt, dueSoonVisit.scheduledEndAt);
    assert.strictEqual(dueSoon.createdAt, dueSoon.referenceAt);
    assert.match(dueSoon.title, /Visit due soon/);
    assert.match(dueSoon.body, /within 2 hours/);

    const activeRoute = alerts.find(alert => alert.kind === "active-route" && alert.visitId === activeVisit.id);
    assert.ok(activeRoute);
    assert.strictEqual(activeRoute.id, dispatchAlertId("active-route", activeVisit.id, activeRoute.dedupeKey));
    assert.strictEqual(activeRoute.severity, "high");
    assert.strictEqual(activeRoute.notify, true);
    assert.strictEqual(activeRoute.status, "en-route");

    const gpsMissing = alerts.find(alert => alert.kind === "gps-missing" && alert.visitId === dueSoonVisit.id);
    assert.ok(gpsMissing);
    assert.strictEqual(gpsMissing.id, dispatchAlertId("gps-missing", dueSoonVisit.id, gpsMissing.dedupeKey));
    assert.strictEqual(gpsMissing.notify, false);
    assert.strictEqual(gpsMissing.severity, "info");

    const ownAlertOrder = alerts
      .filter(alert => [dueSoonVisit.id, activeVisit.id].includes(alert.visitId))
      .map(alert => `${alert.kind}:${alert.visitId}`);
    assert.deepStrictEqual(ownAlertOrder, [
      `active-route:${activeVisit.id}`,
      `gps-missing:${activeVisit.id}`,
      `due-soon:${dueSoonVisit.id}`,
      `gps-missing:${dueSoonVisit.id}`
    ]);
  } finally { await app.close(); }
});

test("dispatch gps-missing alert disappears after technician GPS capture", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const supportCookie = await login(app, "support@armosphera.local");
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } })).json();
    const serviceCase = console1.cases[0];
    const support = console1.agents.find(agent => agent.role === "Support");
    assert.ok(support);
    const visit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: support.id,
      startOffsetHours: 1,
      location: "Nare Clinic GPS missing alert"
    });

    const before = await app.inject({ method: "GET", url: "/api/service/my-dispatch-alerts", headers: { cookie: supportCookie } });
    assert.strictEqual(before.statusCode, 200, before.body);
    assert.ok(before.json().alerts.some(alert => alert.kind === "gps-missing" && alert.visitId === visit.id));

    const captured = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${visit.id}/technician-location`,
      headers: { cookie: supportCookie },
      payload: { latitude: 40.187, longitude: 44.515, capturedAt: "2026-06-22T10:00:00.000Z", source: "gps" }
    });
    assert.strictEqual(captured.statusCode, 200, captured.body);

    const after = await app.inject({ method: "GET", url: "/api/service/my-dispatch-alerts", headers: { cookie: supportCookie } });
    assert.strictEqual(after.statusCode, 200, after.body);
    assert.ok(!after.json().alerts.some(alert => alert.kind === "gps-missing" && alert.visitId === visit.id));
    assert.ok(after.json().alerts.some(alert => alert.kind === "due-soon" && alert.visitId === visit.id));
  } finally { await app.close(); }
});

test("dispatch alert acknowledgement rejects stale ids after reschedule", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const supportCookie = await login(app, "support@armosphera.local");
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } })).json();
    const serviceCase = console1.cases[0];
    const support = console1.agents.find(agent => agent.role === "Support");
    assert.ok(support);
    const visit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: support.id,
      startOffsetHours: 1,
      location: "Nare Clinic reschedule alert"
    });

    const feed = await app.inject({ method: "GET", url: "/api/service/my-dispatch-alerts", headers: { cookie: supportCookie } });
    assert.strictEqual(feed.statusCode, 200, feed.body);
    const originalAlert = feed.json().alerts.find(candidate => candidate.kind === "due-soon" && candidate.visitId === visit.id);
    assert.ok(originalAlert);
    assert.strictEqual(originalAlert.id, dispatchAlertId("due-soon", visit.id, originalAlert.dedupeKey));

    const rescheduledStartAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
    const rescheduledEndAt = new Date(Date.now() + 150 * 60 * 1000).toISOString();
    const rescheduled = await app.inject({
      method: "PATCH",
      url: `/api/service/field-visits/${visit.id}`,
      headers: { cookie: ownerCookie },
      payload: { scheduledStartAt: rescheduledStartAt, scheduledEndAt: rescheduledEndAt }
    });
    assert.strictEqual(rescheduled.statusCode, 200, rescheduled.body);

    const nextFeed = await app.inject({ method: "GET", url: "/api/service/my-dispatch-alerts", headers: { cookie: supportCookie } });
    assert.strictEqual(nextFeed.statusCode, 200, nextFeed.body);
    const nextAlert = nextFeed.json().alerts.find(candidate => candidate.kind === "due-soon" && candidate.visitId === visit.id);
    assert.ok(nextAlert);
    assert.notStrictEqual(nextAlert.dedupeKey, originalAlert.dedupeKey);
    assert.notStrictEqual(nextAlert.id, originalAlert.id);
    assert.strictEqual(nextAlert.id, dispatchAlertId("due-soon", visit.id, nextAlert.dedupeKey));

    const staleAck = await app.inject({
      method: "POST",
      url: `/api/service/dispatch-alerts/${originalAlert.id}/ack`,
      headers: { cookie: supportCookie }
    });
    assert.strictEqual(staleAck.statusCode, 404, staleAck.body);
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?").get("service.dispatch_alert.acknowledged").count, 0);

    const freshAck = await app.inject({
      method: "POST",
      url: `/api/service/dispatch-alerts/${nextAlert.id}/ack`,
      headers: { cookie: supportCookie }
    });
    assert.strictEqual(freshAck.statusCode, 200, freshAck.body);
    assert.strictEqual(freshAck.json().alert.id, nextAlert.id);
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?").get("service.dispatch_alert.acknowledged").count, 1);
  } finally { await app.close(); }
});

test("dispatch alert acknowledgements hide normal feed and include acknowledged alerts on request", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const supportCookie = await login(app, "support@armosphera.local");
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } })).json();
    const serviceCase = console1.cases[0];
    const support = console1.agents.find(agent => agent.role === "Support");
    assert.ok(support);
    const visit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: support.id,
      startOffsetHours: 1,
      location: "Nare Clinic acknowledgement desk"
    });

    const feed = await app.inject({ method: "GET", url: "/api/service/my-dispatch-alerts", headers: { cookie: supportCookie } });
    assert.strictEqual(feed.statusCode, 200, feed.body);
    const alert = feed.json().alerts.find(candidate => candidate.kind === "due-soon" && candidate.visitId === visit.id);
    assert.ok(alert);

    const acked = await app.inject({
      method: "POST",
      url: `/api/service/dispatch-alerts/${alert.id}/ack`,
      headers: { cookie: supportCookie },
      payload: { ignored: "client body is not persisted" }
    });
    assert.strictEqual(acked.statusCode, 200, acked.body);
    assert.strictEqual(acked.json().alert.id, alert.id);
    assert.strictEqual(acked.json().alert.acknowledged, true);

    const ackedAgain = await app.inject({
      method: "POST",
      url: `/api/service/dispatch-alerts/${alert.id}/ack`,
      headers: { cookie: supportCookie }
    });
    assert.strictEqual(ackedAgain.statusCode, 200, ackedAgain.body);
    assert.strictEqual(ackedAgain.json().alert.id, alert.id);
    assert.strictEqual(ackedAgain.json().alert.acknowledged, true);

    const hidden = await app.inject({ method: "GET", url: "/api/service/my-dispatch-alerts", headers: { cookie: supportCookie } });
    assert.strictEqual(hidden.statusCode, 200, hidden.body);
    assert.ok(!hidden.json().alerts.some(candidate => candidate.id === alert.id));

    const included = await app.inject({ method: "GET", url: "/api/service/my-dispatch-alerts?includeAcknowledged=true", headers: { cookie: supportCookie } });
    assert.strictEqual(included.statusCode, 200, included.body);
    const includedAlert = included.json().alerts.find(candidate => candidate.id === alert.id);
    assert.ok(includedAlert);
    assert.strictEqual(includedAlert.acknowledged, true);

    const ackRows = app.db.prepare(`
      SELECT user_id, details
      FROM audit_events
      WHERE type = ?
      ORDER BY id ASC
    `).all("service.dispatch_alert.acknowledged");
    assert.strictEqual(ackRows.length, 1);
    assert.strictEqual(ackRows[0].user_id, support.id);
    const details = JSON.parse(ackRows[0].details);
    assert.strictEqual(details.alertId, alert.id);
    assert.strictEqual(details.dedupeKey, alert.dedupeKey);
    assert.strictEqual(details.kind, alert.kind);
    assert.strictEqual(details.visitId, visit.id);
    assert.strictEqual(details.caseNumber, serviceCase.caseNumber);
    assert.strictEqual(details.referenceAt, alert.referenceAt);
    assert.ok(!JSON.stringify(details).includes("client body"));
  } finally { await app.close(); }
});

test("malformed dispatch alert acknowledgement has no side effects and no secret echo", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const supportCookie = await login(app, "support@armosphera.local");
    const secret = "sk-live-dispatch-alert-secret";
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?").get("service.dispatch_alert.acknowledged").count;
    const bad = await app.inject({
      method: "POST",
      url: `/api/service/dispatch-alerts/NOT-SAFE-${secret}/ack`,
      headers: { cookie: supportCookie },
      payload: { secret }
    });
    assert.strictEqual(bad.statusCode, 400);
    assert.ok(!bad.body.includes(secret), bad.body);
    const after = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?").get("service.dispatch_alert.acknowledged").count;
    assert.strictEqual(after, before);
  } finally { await app.close(); }
});

test("dispatch alert acknowledgement rejects encoded surrounding whitespace without audit", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const supportCookie = await login(app, "support@armosphera.local");
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } })).json();
    const serviceCase = console1.cases[0];
    const support = console1.agents.find(agent => agent.role === "Support");
    assert.ok(support);
    const visit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: support.id,
      startOffsetHours: 1,
      location: "Nare Clinic encoded alert id"
    });
    const feed = await app.inject({ method: "GET", url: "/api/service/my-dispatch-alerts", headers: { cookie: supportCookie } });
    assert.strictEqual(feed.statusCode, 200, feed.body);
    const alert = feed.json().alerts.find(candidate => candidate.kind === "due-soon" && candidate.visitId === visit.id);
    assert.ok(alert);

    const before = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?").get("service.dispatch_alert.acknowledged").count;
    const wrappedId = encodeURIComponent(` ${alert.id} `);
    const bad = await app.inject({
      method: "POST",
      url: `/api/service/dispatch-alerts/${wrappedId}/ack`,
      headers: { cookie: supportCookie }
    });
    assert.strictEqual(bad.statusCode, 400, bad.body);
    const after = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?").get("service.dispatch_alert.acknowledged").count;
    assert.strictEqual(after, before);
  } finally { await app.close(); }
});

test("dispatch alert feed and acknowledgement preserve tenant isolation", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const supportCookie = await login(app, "support@armosphera.local");
    const supportId = app.db.prepare("SELECT id FROM users WHERE email = ?").get("support@armosphera.local").id;
    const now = new Date().toISOString();
    const foreignStartAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const foreignEndAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    app.db.prepare("INSERT INTO organizations (id, name, legal_name, tax_id, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("org-alert-foreign", "Alert Foreign Org", "Alert Foreign Org LLC", "97979797", "AMD", now);
    app.db.prepare(`
      INSERT INTO customers (id, org_id, name, tax_id, email, phone, segment, health_score, lifetime_value, open_receivables, last_touch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("cust-alert-foreign", "org-alert-foreign", "Alert Foreign Customer", "97979798", "alert.foreign@example.com", "", "Other", 50, 0, 0, "2026-05-01");
    app.db.prepare(`
      INSERT INTO service_cases (
        id, org_id, customer_id, ticket_id, case_number, subject, status, priority,
        channel, owner_user_id, sla_due_at, sla_status, ai_suggestion,
        knowledge_article, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "case-alert-foreign",
      "org-alert-foreign",
      "cust-alert-foreign",
      null,
      "ALERT-FOREIGN-1",
      "Foreign dispatch alert case",
      "open",
      "medium",
      "Email",
      null,
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      "on-track",
      "Foreign alert suggestion",
      "KB-GENERAL-SERVICE",
      now,
      now
    );
    app.db.prepare(`
      INSERT INTO service_field_visits (
        id, org_id, case_id, customer_id, assigned_user_id,
        scheduled_start_at, scheduled_end_at, status, location,
        worksheet_summary, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "visit-alert-foreign",
      "org-alert-foreign",
      "case-alert-foreign",
      "cust-alert-foreign",
      supportId,
      foreignStartAt,
      foreignEndAt,
      "scheduled",
      "Foreign dispatch alert site",
      "Foreign alert should remain isolated.",
      now,
      now
    );

    const feed = await app.inject({ method: "GET", url: "/api/service/my-dispatch-alerts", headers: { cookie: supportCookie } });
    assert.strictEqual(feed.statusCode, 200, feed.body);
    assert.ok(!feed.json().alerts.some(alert => alert.visitId === "visit-alert-foreign"));

    const guessedAck = await app.inject({
      method: "POST",
      url: `/api/service/dispatch-alerts/${dispatchAlertId("due-soon", "visit-alert-foreign", `service-field-visit:visit-alert-foreign:due-soon:${foreignStartAt}`)}/ack`,
      headers: { cookie: supportCookie }
    });
    assert.strictEqual(guessedAck.statusCode, 404);
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type = ?").get("org-alert-foreign", "service.dispatch_alert.acknowledged").count, 0);
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?").get("service.dispatch_alert.acknowledged").count, 0);
  } finally { await app.close(); }
});

test("assigned technician captures GPS evidence and read paths surface latest location", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const supportCookie = await login(app, "support@armosphera.local");
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } })).json();
    const serviceCase = console1.cases[0];
    const support = console1.agents.find(agent => agent.role === "Support");
    const manager = console1.agents.find(agent => agent.role === "Service Manager");
    assert.ok(support);
    assert.ok(manager);

    const supportVisit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: support.id,
      startOffsetHours: 21,
      location: "Nare Clinic GPS capture desk"
    });
    const managerVisit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: manager.id,
      startOffsetHours: 22,
      location: "Nare Clinic supervisor capture desk"
    });
    const capturedAt = "2026-06-22T09:15:00.000Z";
    const firstLocation = {
      latitude: 40.181111,
      longitude: 44.513611,
      accuracyMeters: 8.5,
      capturedAt,
      source: "browser-geolocation"
    };

    const captured = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${supportVisit.id}/technician-location`,
      headers: { cookie: supportCookie },
      payload: firstLocation
    });
    assert.strictEqual(captured.statusCode, 200, captured.body);
    assert.strictEqual(captured.json().visit.technicianLocation.latitude, firstLocation.latitude);
    assert.strictEqual(captured.json().visit.technicianLocation.longitude, firstLocation.longitude);
    assert.strictEqual(captured.json().visit.technicianLocation.accuracyMeters, firstLocation.accuracyMeters);
    assert.strictEqual(captured.json().visit.technicianLocation.capturedAt, capturedAt);
    assert.strictEqual(captured.json().visit.technicianLocation.source, "browser-geolocation");
    assert.strictEqual(captured.json().visit.technicianLocation.capturedByUserId, support.id);
    assert.strictEqual(captured.json().visit.technicianLocation.provider, "google-maps");
    assert.ok(captured.json().visit.technicianLocation.mapUrl.includes("www.google.com/maps/search"), captured.json().visit.technicianLocation.mapUrl);

    const listedMine = await app.inject({ method: "GET", url: "/api/service/my-field-visits", headers: { cookie: supportCookie } });
    assert.strictEqual(listedMine.statusCode, 200, listedMine.body);
    const mineVisit = listedMine.json().visits.find(visit => visit.id === supportVisit.id);
    assert.ok(mineVisit);
    assert.deepStrictEqual(mineVisit.technicianLocation, captured.json().visit.technicianLocation);

    const listedAll = await app.inject({ method: "GET", url: "/api/service/field-visits", headers: { cookie: ownerCookie } });
    assert.strictEqual(listedAll.statusCode, 200, listedAll.body);
    const listedVisit = listedAll.json().visits.find(visit => visit.id === supportVisit.id);
    assert.ok(listedVisit);
    assert.deepStrictEqual(listedVisit.technicianLocation, captured.json().visit.technicianLocation);

    const moved = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${supportVisit.id}/technician-status`,
      headers: { cookie: supportCookie },
      payload: { status: "en-route" }
    });
    assert.strictEqual(moved.statusCode, 200, moved.body);
    assert.deepStrictEqual(moved.json().visit.technicianLocation, captured.json().visit.technicianLocation);

    const supervisorCapture = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${managerVisit.id}/technician-location`,
      headers: { cookie: ownerCookie },
      payload: { latitude: 40.19, longitude: 44.52, accuracyMeters: 20, capturedAt, source: "manual" }
    });
    assert.strictEqual(supervisorCapture.statusCode, 200, supervisorCapture.body);
    assert.strictEqual(supervisorCapture.json().visit.technicianLocation.source, "manual");
    assert.strictEqual(supervisorCapture.json().visit.technicianLocation.capturedByUserId, "user-owner");

    const auditRows = app.db.prepare(`
      SELECT user_id, details
      FROM audit_events
      WHERE type = ?
      ORDER BY id ASC
    `).all("service.field_visit.technician_location");
    assert.strictEqual(auditRows.length, 2);
    const supportDetails = JSON.parse(auditRows[0].details);
    assert.strictEqual(auditRows[0].user_id, support.id);
    assert.strictEqual(supportDetails.visitId, supportVisit.id);
    assert.strictEqual(supportDetails.caseId, serviceCase.id);
    assert.strictEqual(supportDetails.customerId, serviceCase.customerId);
    assert.strictEqual(supportDetails.actorUserId, support.id);
    assert.strictEqual(supportDetails.latitude, firstLocation.latitude);
    assert.strictEqual(supportDetails.longitude, firstLocation.longitude);
  } finally { await app.close(); }
});

test("technician location supports idempotent replay and mismatched-key conflict", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const supportCookie = await login(app, "support@armosphera.local");
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } })).json();
    const serviceCase = console1.cases[0];
    const support = console1.agents.find(agent => agent.role === "Support");
    assert.ok(support);
    const visit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: support.id,
      startOffsetHours: 23,
      location: "Nare Clinic idempotent GPS desk"
    });
    const idempotencyKey = "field-visit-location-001";
    const payload = {
      latitude: "40.187654",
      longitude: "44.526543",
      accuracyMeters: "11.25",
      source: "mobile",
      idempotencyKey
    };

    const first = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${visit.id}/technician-location`,
      headers: { cookie: supportCookie },
      payload
    });
    assert.strictEqual(first.statusCode, 200, first.body);
    assert.strictEqual(first.json().idempotent, false);
    assert.strictEqual(first.json().locationSync.idempotencyKey, idempotencyKey);
    assert.strictEqual(first.json().locationSync.replayed, false);
    assert.ok(first.json().locationSync.capturedAt);
    assert.strictEqual(first.json().visit.technicianLocation.latitude, 40.187654);
    assert.strictEqual(first.json().visit.technicianLocation.longitude, 44.526543);
    assert.strictEqual(first.json().visit.technicianLocation.accuracyMeters, 11.25);

    const replay = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${visit.id}/technician-location`,
      headers: { cookie: supportCookie },
      payload
    });
    assert.strictEqual(replay.statusCode, 200, replay.body);
    assert.strictEqual(replay.json().idempotent, true);
    assert.strictEqual(replay.json().locationSync.idempotencyKey, idempotencyKey);
    assert.strictEqual(replay.json().locationSync.replayed, true);
    assert.strictEqual(replay.json().locationSync.capturedAt, first.json().locationSync.capturedAt);
    assert.deepStrictEqual(replay.json().visit.technicianLocation, first.json().visit.technicianLocation);

    const mismatchedLocation = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${visit.id}/technician-location`,
      headers: { cookie: supportCookie },
      payload: { ...payload, latitude: 40.2 }
    });
    assert.strictEqual(mismatchedLocation.statusCode, 409, mismatchedLocation.body);
    assert.ok(!mismatchedLocation.body.includes(idempotencyKey), mismatchedLocation.body);

    const auditRows = app.db.prepare(`
      SELECT details
      FROM audit_events
      WHERE type = ?
      ORDER BY id ASC
    `).all("service.field_visit.technician_location");
    assert.strictEqual(auditRows.length, 1);
    const details = JSON.parse(auditRows[0].details);
    assert.strictEqual(details.idempotencyKey, idempotencyKey);
    assert.strictEqual(details.locationSync.idempotencyKey, idempotencyKey);
    assert.strictEqual(details.locationSync.replayed, false);
    assert.deepStrictEqual(Object.keys(details.locationSync.locationIntent).sort(), [
      "accuracyMeters",
      "capturedAt",
      "capturedAtProvided",
      "latitude",
      "longitude",
      "source"
    ]);
  } finally { await app.close(); }
});

test("unassigned support user cannot update another technician visit, but supervisor can", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const supportCookie = await login(app, "support@armosphera.local");
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } })).json();
    const serviceCase = console1.cases[0];
    const manager = console1.agents.find(agent => agent.role === "Service Manager");
    assert.ok(manager);
    const managerVisit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: manager.id,
      startOffsetHours: 18,
      worksheetSummary: "Manager-owned worksheet."
    });

    const blocked = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${managerVisit.id}/technician-status`,
      headers: { cookie: supportCookie },
      payload: { status: "en-route", worksheetSummary: "Support should not change this." }
    });
    assert.strictEqual(blocked.statusCode, 403);
    const blockedLocation = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${managerVisit.id}/technician-location`,
      headers: { cookie: supportCookie },
      payload: { latitude: 40.1, longitude: 44.1 }
    });
    assert.strictEqual(blockedLocation.statusCode, 403);
    const unchanged = app.db.prepare("SELECT status, worksheet_summary FROM service_field_visits WHERE id = ?").get(managerVisit.id);
    assert.strictEqual(unchanged.status, "scheduled");
    assert.strictEqual(unchanged.worksheet_summary, "Manager-owned worksheet.");
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?").get("service.field_visit.technician_status").count, 0);
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?").get("service.field_visit.technician_location").count, 0);

    const allowed = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${managerVisit.id}/technician-status`,
      headers: { cookie: ownerCookie },
      payload: { status: "en-route" }
    });
    assert.strictEqual(allowed.statusCode, 200, allowed.body);
    assert.strictEqual(allowed.json().visit.status, "en-route");
  } finally { await app.close(); }
});

test("malformed technician location requests have no side effects and no secret echo", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const supportCookie = await login(app, "support@armosphera.local");
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } })).json();
    const serviceCase = console1.cases[0];
    const support = console1.agents.find(agent => agent.role === "Support");
    assert.ok(support);
    const visit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: support.id,
      startOffsetHours: 24,
      worksheetSummary: "Location malformed request should not alter this."
    });
    const secret = "sk-live-technician-location-secret";

    const badPath = await app.inject({
      method: "POST",
      url: "/api/service/field-visits/NOT-SAFE/technician-location",
      headers: { cookie: supportCookie },
      payload: { latitude: 40.1, longitude: 44.1, idempotencyKey: secret }
    });
    assert.strictEqual(badPath.statusCode, 400);
    assert.ok(!badPath.body.includes(secret), badPath.body);

    const badLatitude = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${visit.id}/technician-location`,
      headers: { cookie: supportCookie },
      payload: { latitude: 91, longitude: 44.1, capturedAt: secret }
    });
    assert.strictEqual(badLatitude.statusCode, 400);
    assert.ok(!badLatitude.body.includes(secret), badLatitude.body);

    const badIdempotencyKey = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${visit.id}/technician-location`,
      headers: { cookie: supportCookie },
      payload: { latitude: 40.1, longitude: 44.1, idempotencyKey: `${secret}\nqueue` }
    });
    assert.strictEqual(badIdempotencyKey.statusCode, 400);
    assert.ok(!badIdempotencyKey.body.includes(secret), badIdempotencyKey.body);

    const badSource = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${visit.id}/technician-location`,
      headers: { cookie: supportCookie },
      payload: { latitude: 40.1, longitude: 44.1, source: "satellite\nsecret" }
    });
    assert.strictEqual(badSource.statusCode, 400);

    const unchanged = app.db.prepare("SELECT status, worksheet_summary FROM service_field_visits WHERE id = ?").get(visit.id);
    assert.strictEqual(unchanged.status, "scheduled");
    assert.strictEqual(unchanged.worksheet_summary, "Location malformed request should not alter this.");
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?").get("service.field_visit.technician_location").count, 0);
  } finally { await app.close(); }
});

test("malformed technician status requests have no side effects and no secret echo", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const supportCookie = await login(app, "support@armosphera.local");
    const console1 = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: ownerCookie } })).json();
    const serviceCase = console1.cases[0];
    const support = console1.agents.find(agent => agent.role === "Support");
    assert.ok(support);
    const visit = await createFieldVisit(app, ownerCookie, {
      serviceCase,
      assignedUserId: support.id,
      startOffsetHours: 20,
      worksheetSummary: "Original worksheet remains."
    });
    const secret = "sk-live-technician-status-secret";

    const badPath = await app.inject({
      method: "POST",
      url: "/api/service/field-visits/NOT-SAFE/technician-status",
      headers: { cookie: supportCookie },
      payload: { status: "completed", worksheetSummary: secret }
    });
    assert.strictEqual(badPath.statusCode, 400);
    assert.ok(!badPath.body.includes(secret), badPath.body);

    const badBody = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${visit.id}/technician-status`,
      headers: { cookie: supportCookie },
      payload: { status: secret, worksheetSummary: secret }
    });
    assert.strictEqual(badBody.statusCode, 400);
    assert.ok(!badBody.body.includes(secret), badBody.body);

    const badIdempotencyKey = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${visit.id}/technician-status`,
      headers: { cookie: supportCookie },
      payload: { status: "en-route", worksheetSummary: "Queued dispatch should not apply.", idempotencyKey: `${secret}\nqueue` }
    });
    assert.strictEqual(badIdempotencyKey.statusCode, 400);
    assert.ok(!badIdempotencyKey.body.includes(secret), badIdempotencyKey.body);

    const badTransition = await app.inject({
      method: "POST",
      url: `/api/service/field-visits/${visit.id}/technician-status`,
      headers: { cookie: supportCookie },
      payload: { status: "completed", worksheetSummary: "Skipped dispatch state." }
    });
    assert.strictEqual(badTransition.statusCode, 400);

    const unchanged = app.db.prepare("SELECT status, worksheet_summary FROM service_field_visits WHERE id = ?").get(visit.id);
    assert.strictEqual(unchanged.status, "scheduled");
    assert.strictEqual(unchanged.worksheet_summary, "Original worksheet remains.");
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?").get("service.field_visit.technician_status").count, 0);
  } finally { await app.close(); }
});

test("technician field visit routes preserve tenant isolation", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const ownerCookie = await login(app);
    const supportCookie = await login(app, "support@armosphera.local");
    const ownerOrgId = app.db.prepare("SELECT org_id FROM users WHERE email = ?").get(DEFAULT_EMAIL).org_id;
    const supportId = app.db.prepare("SELECT id FROM users WHERE email = ?").get("support@armosphera.local").id;
    const now = new Date().toISOString();

    app.db.prepare("INSERT INTO organizations (id, name, legal_name, tax_id, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("org-tech-foreign", "Technician Foreign Org", "Technician Foreign Org LLC", "98989898", "AMD", now);
    app.db.prepare(`
      INSERT INTO customers (id, org_id, name, tax_id, email, phone, segment, health_score, lifetime_value, open_receivables, last_touch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("cust-tech-foreign", "org-tech-foreign", "Technician Foreign Customer", "98989899", "tech.foreign@example.com", "", "Other", 50, 0, 0, "2026-05-01");
    app.db.prepare(`
      INSERT INTO service_cases (
        id, org_id, customer_id, ticket_id, case_number, subject, status, priority,
        channel, owner_user_id, sla_due_at, sla_status, ai_suggestion,
        knowledge_article, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "case-tech-foreign",
      "org-tech-foreign",
      "cust-tech-foreign",
      null,
      "TECH-FOREIGN-1",
      "Foreign technician case",
      "open",
      "medium",
      "Email",
      null,
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      "on-track",
      "Foreign technician suggestion",
      "KB-GENERAL-SERVICE",
      now,
      now
    );
    app.db.prepare(`
      INSERT INTO service_field_visits (
        id, org_id, case_id, customer_id, assigned_user_id,
        scheduled_start_at, scheduled_end_at, status, location,
        worksheet_summary, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "visit-tech-foreign",
      "org-tech-foreign",
      "case-tech-foreign",
      "cust-tech-foreign",
      supportId,
      new Date(Date.now() + 22 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
      "scheduled",
      "Foreign customer site",
      "Foreign worksheet should remain isolated.",
      now,
      now
    );

    const hiddenList = await app.inject({ method: "GET", url: "/api/service/my-field-visits", headers: { cookie: supportCookie } });
    assert.strictEqual(hiddenList.statusCode, 200, hiddenList.body);
    assert.ok(!hiddenList.json().visits.some(visit => visit.id === "visit-tech-foreign"));

    const crossOrgUpdate = await app.inject({
      method: "POST",
      url: "/api/service/field-visits/visit-tech-foreign/technician-status",
      headers: { cookie: ownerCookie },
      payload: { status: "en-route" }
    });
    assert.strictEqual(crossOrgUpdate.statusCode, 404);
    const crossOrgLocation = await app.inject({
      method: "POST",
      url: "/api/service/field-visits/visit-tech-foreign/technician-location",
      headers: { cookie: ownerCookie },
      payload: { latitude: 40.1, longitude: 44.1 }
    });
    assert.strictEqual(crossOrgLocation.statusCode, 404);
    assert.strictEqual(app.db.prepare("SELECT status FROM service_field_visits WHERE org_id = ? AND id = ?").get("org-tech-foreign", "visit-tech-foreign").status, "scheduled");
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM service_field_visits WHERE org_id = ? AND id = ?").get(ownerOrgId, "visit-tech-foreign").count, 0);
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type = ?").get("org-tech-foreign", "service.field_visit.technician_location").count, 0);
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
