"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

test("projects: full hierarchy — project + task + milestone + time entry with rollups", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();

    const unauth = await app.inject({ method: "GET", url: "/api/projects" });
    assert.strictEqual(unauth.statusCode, 401);

    const owner = await login(app);
    const seeded = (await app.inject({ method: "GET", url: "/api/projects", headers: { cookie: owner } })).json();
    assert.ok(Array.isArray(seeded.projects) && seeded.projects.length >= 2, "seeded projects present");
    const nare = seeded.projects.find(p => p.id === "proj-nare-retention");
    assert.ok(nare, "seeded Նարե project present");
    assert.strictEqual(nare.taskTotal, 2, "rollup: 2 seeded tasks");
    assert.strictEqual(nare.totalMinutes, 180, "rollup: 180 seeded minutes");

    // Create a project linked to a customer + deal
    const created = await app.inject({ method: "POST", url: "/api/projects", headers: { cookie: owner },
      payload: { name: "Նոր առաքման նախագիծ", customerId: "cust-ani", dealId: "deal-ani-inbox", status: "active", dueDate: "2026-08-01" } });
    assert.strictEqual(created.statusCode, 200);
    const projId = created.json().project.id;
    assert.strictEqual(created.json().project.status, "active");
    assert.strictEqual(created.json().project.customerId, "cust-ani");
    assert.strictEqual(created.json().project.dealId, "deal-ani-inbox");

    // Name too short -> 400
    const badName = await app.inject({ method: "POST", url: "/api/projects", headers: { cookie: owner }, payload: { name: "x" } });
    assert.strictEqual(badName.statusCode, 400);

    // Unknown linked deal -> 400
    const badDeal = await app.inject({ method: "POST", url: "/api/projects", headers: { cookie: owner }, payload: { name: "Bad deal link", dealId: "deal-nope" } });
    assert.strictEqual(badDeal.statusCode, 400);

    // Add a task, assign to a seeded employee
    const taskRes = await app.inject({ method: "POST", url: `/api/projects/${projId}/tasks`, headers: { cookie: owner },
      payload: { title: "Կարգավորել ալիքները", assigneeEmployeeId: "emp-davit", dueDate: "2026-07-10" } });
    assert.strictEqual(taskRes.statusCode, 200);
    const taskId = taskRes.json().project.tasks[0].id;
    assert.strictEqual(taskRes.json().project.tasks[0].assigneeEmployeeId, "emp-davit");

    // Bad assignee -> 400
    const badAssignee = await app.inject({ method: "POST", url: `/api/projects/${projId}/tasks`, headers: { cookie: owner }, payload: { title: "x task", assigneeEmployeeId: "emp-nope" } });
    assert.strictEqual(badAssignee.statusCode, 400);

    // Move the task to done
    const taskDone = await app.inject({ method: "PATCH", url: `/api/projects/${projId}/tasks/${taskId}`, headers: { cookie: owner }, payload: { status: "done" } });
    assert.strictEqual(taskDone.statusCode, 200);
    assert.strictEqual(taskDone.json().project.tasks.find(t => t.id === taskId).status, "done");

    // Add a milestone, then reach it
    const msRes = await app.inject({ method: "POST", url: `/api/projects/${projId}/milestones`, headers: { cookie: owner }, payload: { title: "Արձակում", dueDate: "2026-07-20" } });
    assert.strictEqual(msRes.statusCode, 200);
    const msId = msRes.json().project.milestones[0].id;
    const msReached = await app.inject({ method: "PATCH", url: `/api/projects/${projId}/milestones/${msId}`, headers: { cookie: owner }, payload: { reached: true } });
    assert.strictEqual(msReached.json().project.milestones.find(m => m.id === msId).reached, 1);

    // Log time against the task
    const timeRes = await app.inject({ method: "POST", url: `/api/projects/${projId}/time-entries`, headers: { cookie: owner }, payload: { minutes: 90, taskId, note: "Setup", entryDate: "2026-06-01" } });
    assert.strictEqual(timeRes.statusCode, 200);
    assert.strictEqual(timeRes.json().project.totalMinutes, 90);

    // Zero/negative minutes -> 400
    const badTime = await app.inject({ method: "POST", url: `/api/projects/${projId}/time-entries`, headers: { cookie: owner }, payload: { minutes: 0 } });
    assert.strictEqual(badTime.statusCode, 400);

    // Rollups reflect in the list
    const list2 = (await app.inject({ method: "GET", url: "/api/projects", headers: { cookie: owner } })).json();
    const mine = list2.projects.find(p => p.id === projId);
    assert.strictEqual(mine.taskTotal, 1);
    assert.strictEqual(mine.taskDone, 1);
    assert.strictEqual(mine.milestoneReached, 1);
    assert.strictEqual(mine.totalMinutes, 90);
  } finally { await app.close(); }
});

test("projects: write-gate (Auditor 403) and cross-org isolation (404)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);

    // Auditor (read-only) cannot create -> 403
    const auditor = await login(app, "auditor@armosphera.local", DEFAULT_PASSWORD);
    const blocked = await app.inject({ method: "POST", url: "/api/projects", headers: { cookie: auditor }, payload: { name: "Should fail" } });
    assert.strictEqual(blocked.statusCode, 403);

    // Cross-org: seed a foreign project, confirm it's invisible + 404 on detail/mutate
    const now = new Date().toISOString();
    const otherOrgId = "org-other-proj";
    app.db.prepare("INSERT INTO organizations (id, name, legal_name, tax_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(otherOrgId, "Other Proj LLC", "Other Proj LLC", "66666666", now);
    const foreignId = "proj-foreign-1";
    app.db.prepare(`INSERT INTO projects (id, org_id, name, description, status, customer_id, deal_id, start_date, due_date, created_at, updated_at)
      VALUES (?, ?, ?, '', 'active', NULL, NULL, '', '', ?, ?)`).run(foreignId, otherOrgId, "Foreign project", now, now);

    const list = (await app.inject({ method: "GET", url: "/api/projects", headers: { cookie: owner } })).json();
    assert.ok(!list.projects.some(p => p.id === foreignId), "foreign project leaked into owner list");
    const get = await app.inject({ method: "GET", url: `/api/projects/${foreignId}`, headers: { cookie: owner } });
    assert.strictEqual(get.statusCode, 404);
    const addTask = await app.inject({ method: "POST", url: `/api/projects/${foreignId}/tasks`, headers: { cookie: owner }, payload: { title: "x" } });
    assert.strictEqual(addTask.statusCode, 404);
  } finally { await app.close(); }
});

test("projects: a child cannot be addressed under the wrong parent project (404)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);

    // Two sibling projects in the SAME org.
    const a = (await app.inject({ method: "POST", url: "/api/projects", headers: { cookie: owner }, payload: { name: "Project Alpha" } })).json().project.id;
    const b = (await app.inject({ method: "POST", url: "/api/projects", headers: { cookie: owner }, payload: { name: "Project Beta" } })).json().project.id;

    // A task + milestone that belong to A.
    const taskA = (await app.inject({ method: "POST", url: `/api/projects/${a}/tasks`, headers: { cookie: owner }, payload: { title: "Alpha task" } })).json().project.tasks[0].id;
    const msA = (await app.inject({ method: "POST", url: `/api/projects/${a}/milestones`, headers: { cookie: owner }, payload: { title: "Alpha milestone" } })).json().project.milestones[0].id;

    // Addressing A's task under parent B must 404 — the child is scoped to its real parent,
    // so a mismatched :id/:taskId pair cannot mutate across projects.
    const wrongParentTask = await app.inject({ method: "PATCH", url: `/api/projects/${b}/tasks/${taskA}`, headers: { cookie: owner }, payload: { status: "done" } });
    assert.strictEqual(wrongParentTask.statusCode, 404);

    // Same for milestones.
    const wrongParentMs = await app.inject({ method: "PATCH", url: `/api/projects/${b}/milestones/${msA}`, headers: { cookie: owner }, payload: { reached: true } });
    assert.strictEqual(wrongParentMs.statusCode, 404);

    // And a time entry referencing A's task while posting under B must be rejected (not silently mislinked).
    const wrongParentTime = await app.inject({ method: "POST", url: `/api/projects/${b}/time-entries`, headers: { cookie: owner }, payload: { minutes: 30, taskId: taskA } });
    assert.ok([400, 404].includes(wrongParentTime.statusCode), `expected 400/404 for cross-project task link, got ${wrongParentTime.statusCode}`);

    // Control: the correct parent still works.
    const ok = await app.inject({ method: "PATCH", url: `/api/projects/${a}/tasks/${taskA}`, headers: { cookie: owner }, payload: { status: "done" } });
    assert.strictEqual(ok.statusCode, 200);
  } finally { await app.close(); }
});
