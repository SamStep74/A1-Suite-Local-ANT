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

test("projects: task dependencies serialize, dedupe, delete, and reject invalid graph links", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: owner },
      payload: { name: "Dependency graph project", status: "active" }
    });
    assert.strictEqual(created.statusCode, 200, created.body);
    const projectId = created.json().project.id;

    const createTask = async title => {
      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/tasks`,
        headers: { cookie: owner },
        payload: { title }
      });
      assert.strictEqual(response.statusCode, 200, response.body);
      return response.json().project.tasks.find(task => task.title === title).id;
    };
    const designTaskId = await createTask("Design dependency flow");
    const buildTaskId = await createTask("Build dependency flow");
    const launchTaskId = await createTask("Launch dependency flow");

    const added = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/${buildTaskId}/dependencies`,
      headers: { cookie: owner },
      payload: { dependsOnTaskId: designTaskId }
    });
    assert.strictEqual(added.statusCode, 200, added.body);
    assert.strictEqual(added.json().idempotent, false);
    let tasks = added.json().project.tasks;
    assert.deepStrictEqual(tasks.find(task => task.id === buildTaskId).blockedBy, [
      { id: designTaskId, title: "Design dependency flow", status: "todo" }
    ]);
    assert.deepStrictEqual(tasks.find(task => task.id === designTaskId).blocking, [
      { id: buildTaskId, title: "Build dependency flow", status: "todo" }
    ]);
    assert.deepStrictEqual(tasks.find(task => task.id === launchTaskId).blockedBy, []);
    assert.deepStrictEqual(tasks.find(task => task.id === launchTaskId).blocking, []);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/${buildTaskId}/dependencies`,
      headers: { cookie: owner },
      payload: { dependsOnTaskId: designTaskId }
    });
    assert.strictEqual(duplicate.statusCode, 200, duplicate.body);
    assert.strictEqual(duplicate.json().idempotent, true);
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM project_task_dependencies WHERE org_id = ? AND project_id = ?").get("org-armosphera-demo", projectId).count, 1);

    const detail = await app.inject({ method: "GET", url: `/api/projects/${projectId}`, headers: { cookie: owner } });
    assert.strictEqual(detail.statusCode, 200, detail.body);
    tasks = detail.json().project.tasks;
    assert.deepStrictEqual(tasks.find(task => task.id === buildTaskId).dependsOnTaskIds, [designTaskId]);
    assert.deepStrictEqual(tasks.find(task => task.id === designTaskId).blockingTaskIds, [buildTaskId]);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/tasks/${buildTaskId}/dependencies/${designTaskId}`,
      headers: { cookie: owner }
    });
    assert.strictEqual(deleted.statusCode, 200, deleted.body);
    assert.deepStrictEqual(deleted.json().project.tasks.find(task => task.id === buildTaskId).blockedBy, []);
    assert.deepStrictEqual(deleted.json().project.tasks.find(task => task.id === designTaskId).blocking, []);

    const deleteAgain = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/tasks/${buildTaskId}/dependencies/${designTaskId}`,
      headers: { cookie: owner }
    });
    assert.strictEqual(deleteAgain.statusCode, 200, deleteAgain.body);
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM project_task_dependencies WHERE org_id = ? AND project_id = ?").get("org-armosphera-demo", projectId).count, 0);

    const self = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/${buildTaskId}/dependencies`,
      headers: { cookie: owner },
      payload: { dependsOnTaskId: buildTaskId }
    });
    assert.strictEqual(self.statusCode, 400, self.body);

    const missingTask = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/ptask-missing/dependencies`,
      headers: { cookie: owner },
      payload: { dependsOnTaskId: designTaskId }
    });
    assert.strictEqual(missingTask.statusCode, 404, missingTask.body);

    const missingDependency = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/${buildTaskId}/dependencies`,
      headers: { cookie: owner },
      payload: { dependsOnTaskId: "ptask-missing" }
    });
    assert.strictEqual(missingDependency.statusCode, 404, missingDependency.body);

    const otherProject = (await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: owner },
      payload: { name: "Other dependency project" }
    })).json().project.id;
    const otherTask = await app.inject({
      method: "POST",
      url: `/api/projects/${otherProject}/tasks`,
      headers: { cookie: owner },
      payload: { title: "Other project dependency task" }
    });
    assert.strictEqual(otherTask.statusCode, 200, otherTask.body);
    const otherTaskId = otherTask.json().project.tasks[0].id;
    const wrongProjectDependency = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/${buildTaskId}/dependencies`,
      headers: { cookie: owner },
      payload: { dependsOnTaskId: otherTaskId }
    });
    assert.strictEqual(wrongProjectDependency.statusCode, 404, wrongProjectDependency.body);

    const edgeOne = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/${buildTaskId}/dependencies`,
      headers: { cookie: owner },
      payload: { dependsOnTaskId: designTaskId }
    });
    assert.strictEqual(edgeOne.statusCode, 200, edgeOne.body);
    const edgeTwo = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/${launchTaskId}/dependencies`,
      headers: { cookie: owner },
      payload: { dependsOnTaskId: buildTaskId }
    });
    assert.strictEqual(edgeTwo.statusCode, 200, edgeTwo.body);
    const cycle = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/${designTaskId}/dependencies`,
      headers: { cookie: owner },
      payload: { dependsOnTaskId: launchTaskId }
    });
    assert.strictEqual(cycle.statusCode, 400, cycle.body);
    assert.match(cycle.body, /cycle/i);
  } finally { await app.close(); }
});

test("projects: task parent subtasks serialize, clear, and reject invalid parent graphs", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const orgId = "org-armosphera-demo";

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: owner },
      payload: { name: "Subtask graph project", status: "active" }
    });
    assert.strictEqual(created.statusCode, 200, created.body);
    const projectId = created.json().project.id;
    const otherProject = (await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: owner },
      payload: { name: "Other subtask project" }
    })).json().project.id;

    const createTask = async (parentProjectId, title, payload = {}) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${parentProjectId}/tasks`,
        headers: { cookie: owner },
        payload: { title, ...payload }
      });
      assert.strictEqual(response.statusCode, 200, response.body);
      return response.json().project.tasks.find(task => task.title === title).id;
    };
    const taskRows = () => app.db.prepare(`
      SELECT id, title, status, parent_task_id AS parentTaskId
      FROM project_tasks
      WHERE org_id = ? AND project_id = ?
      ORDER BY id
    `).all(orgId, projectId);
    const snapshot = () => ({
      rows: taskRows(),
      tasks: app.db.prepare("SELECT COUNT(*) AS count FROM project_tasks WHERE org_id = ? AND project_id = ?").get(orgId, projectId).count,
      audits: app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type LIKE ?").get(orgId, "projects.%").count
    });
    const expectNoSideEffect = async ({ method, url, payload, statusCode, message, leakPattern = /secret-projects-parent-/ }) => {
      const before = snapshot();
      const request = { method, url, headers: { cookie: owner } };
      if (payload !== undefined) request.payload = payload;
      const response = await app.inject(request);
      assert.strictEqual(response.statusCode, statusCode, response.body);
      if (message) assert.match(response.body, message);
      assert.doesNotMatch(response.body, leakPattern);
      assert.deepStrictEqual(snapshot(), before);
      return response;
    };

    const parentTaskId = await createTask(projectId, "Parent implementation task");
    const childTaskId = await createTask(projectId, "Child implementation task", { parentTaskId });
    let detail = await app.inject({ method: "GET", url: `/api/projects/${projectId}`, headers: { cookie: owner } });
    assert.strictEqual(detail.statusCode, 200, detail.body);
    let tasks = detail.json().project.tasks;
    let parentTask = tasks.find(task => task.id === parentTaskId);
    let childTask = tasks.find(task => task.id === childTaskId);
    assert.strictEqual(childTask.parentTaskId, parentTaskId);
    assert.deepStrictEqual(childTask.parentTask, { id: parentTaskId, title: "Parent implementation task", status: "todo" });
    assert.deepStrictEqual(childTask.subtasks, []);
    assert.deepStrictEqual(parentTask.parentTask, null);
    assert.deepStrictEqual(parentTask.subtasks, [{ id: childTaskId, title: "Child implementation task", status: "todo" }]);

    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/tasks/${childTaskId}`,
      headers: { cookie: owner },
      payload: { parentTaskId: "" }
    });
    assert.strictEqual(cleared.statusCode, 200, cleared.body);
    tasks = cleared.json().project.tasks;
    parentTask = tasks.find(task => task.id === parentTaskId);
    childTask = tasks.find(task => task.id === childTaskId);
    assert.strictEqual(childTask.parentTaskId, null);
    assert.deepStrictEqual(childTask.parentTask, null);
    assert.deepStrictEqual(parentTask.subtasks, []);

    const restored = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/tasks/${childTaskId}`,
      headers: { cookie: owner },
      payload: { parentTaskId }
    });
    assert.strictEqual(restored.statusCode, 200, restored.body);
    const grandchildTaskId = await createTask(projectId, "Grandchild implementation task", { parentTaskId: childTaskId });
    assert.ok(grandchildTaskId);

    await expectNoSideEffect({
      method: "PATCH",
      url: `/api/projects/${projectId}/tasks/${parentTaskId}`,
      payload: { parentTaskId },
      statusCode: 400,
      message: /own parent/
    });
    await expectNoSideEffect({
      method: "PATCH",
      url: `/api/projects/${projectId}/tasks/${parentTaskId}`,
      payload: { parentTaskId: grandchildTaskId },
      statusCode: 400,
      message: /cycle/i
    });

    for (const request of [
      {
        method: "POST",
        url: `/api/projects/${projectId}/tasks`,
        payload: { title: "Malformed subtask parent", parentTaskId: "badAsecret-projects-parent-case-token" }
      },
      {
        method: "PATCH",
        url: `/api/projects/${projectId}/tasks/${childTaskId}`,
        payload: { parentTaskId: { value: parentTaskId, token: "secret-projects-parent-object-token" } }
      },
      {
        method: "PATCH",
        url: `/api/projects/${projectId}/tasks/${childTaskId}`,
        payload: { parentTaskId: `bad_secret-projects-parent-underscore-token` }
      },
      {
        method: "PATCH",
        url: `/api/projects/${projectId}/tasks/${childTaskId}`,
        payload: { parentTaskId: `${"a".repeat(161)}secret-projects-parent-long-token` }
      }
    ]) {
      await expectNoSideEffect({ ...request, statusCode: 400, message: /Invalid parent task id/ });
    }

    const otherTaskId = await createTask(otherProject, "Other project parent task");
    await expectNoSideEffect({
      method: "POST",
      url: `/api/projects/${projectId}/tasks`,
      payload: { title: "Cross project child", parentTaskId: otherTaskId },
      statusCode: 404
    });
    await expectNoSideEffect({
      method: "PATCH",
      url: `/api/projects/${projectId}/tasks/${childTaskId}`,
      payload: { parentTaskId: otherTaskId },
      statusCode: 404
    });

    const now = new Date().toISOString();
    const otherOrgId = "org-other-parent";
    const foreignProjectId = "proj-foreign-parent";
    const foreignTaskId = "ptask-foreign-secret-projects-parent-cross-org-token";
    app.db.prepare("INSERT INTO organizations (id, name, legal_name, tax_id, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(otherOrgId, "Other Parent LLC", "Other Parent LLC", "77777777", "AMD", now);
    app.db.prepare(`INSERT INTO projects (id, org_id, name, description, status, customer_id, deal_id, start_date, due_date, created_at, updated_at)
      VALUES (?, ?, ?, '', 'active', NULL, NULL, '', '', ?, ?)`).run(foreignProjectId, otherOrgId, "Foreign parent project", now, now);
    app.db.prepare(`INSERT INTO project_tasks (id, org_id, project_id, title, status, assignee_employee_id, due_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'todo', NULL, '', ?, ?)`).run(foreignTaskId, otherOrgId, foreignProjectId, "Foreign parent task", now, now);

    await expectNoSideEffect({
      method: "POST",
      url: `/api/projects/${projectId}/tasks`,
      payload: { title: "Cross org child", parentTaskId: foreignTaskId },
      statusCode: 404
    });
    await expectNoSideEffect({
      method: "PATCH",
      url: `/api/projects/${projectId}/tasks/${childTaskId}`,
      payload: { parentTaskId: foreignTaskId },
      statusCode: 404
    });
  } finally { await app.close(); }
});

test("projects: rejects malformed metadata before persistence", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const counts = () => ({
      projects: app.db.prepare("SELECT COUNT(*) AS count FROM projects WHERE org_id = ?").get("org-armosphera-demo").count,
      tasks: app.db.prepare("SELECT COUNT(*) AS count FROM project_tasks WHERE org_id = ?").get("org-armosphera-demo").count,
      dependencies: app.db.prepare("SELECT COUNT(*) AS count FROM project_task_dependencies WHERE org_id = ?").get("org-armosphera-demo").count,
      milestones: app.db.prepare("SELECT COUNT(*) AS count FROM project_milestones WHERE org_id = ?").get("org-armosphera-demo").count,
      timeEntries: app.db.prepare("SELECT COUNT(*) AS count FROM project_time_entries WHERE org_id = ?").get("org-armosphera-demo").count,
      audits: app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type LIKE ?").get("org-armosphera-demo", "projects.%").count
    });
    const expectRejected = async (method, url, payload) => {
      const response = await app.inject({ method, url, headers: { cookie: owner }, payload });
      assert.strictEqual(response.statusCode, 400, response.body);
      assert.doesNotMatch(response.body, /secret-projects-/);
    };

    const beforeProjectRejects = counts();
    for (const payload of [
      ["secret-projects-array-body-token"],
      { name: { value: "Project", token: "secret-projects-object-name-token" } },
      { name: `${"P".repeat(201)}secret-projects-long-name-token` },
      { name: "Valid project", description: "Bad\nsecret-projects-control-description-token" },
      { name: "Valid project", description: `${"D".repeat(4001)}secret-projects-long-description-token` },
      { name: "Valid project", status: { value: "active", token: "secret-projects-object-status-token" } },
      { name: "Valid project", status: "ghost-secret-projects-status-token" },
      { name: "Valid project", customerId: ["cust-ani", "secret-projects-customer-array-token"] },
      { name: "Valid project", dealId: { value: "deal-ani-inbox", token: "secret-projects-object-deal-token" } },
      { name: "Valid project", startDate: "2026-02-30" },
      { name: "Valid project", dueDate: "2026-06-01\nsecret-projects-control-due-token" }
    ]) {
      await expectRejected("POST", "/api/projects", payload);
    }
    assert.deepStrictEqual(counts(), beforeProjectRejects);

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: owner },
      payload: { name: "Governed project metadata", status: "active", dueDate: "2026-08-01" }
    });
    assert.strictEqual(created.statusCode, 200, created.body);
    const projectId = created.json().project.id;
    const afterProjectCreate = counts();

    for (const payload of [
      ["secret-projects-array-patch-token"],
      { name: { value: "Renamed project", token: "secret-projects-object-patch-name-token" } },
      { description: "Bad\nsecret-projects-control-patch-description-token" },
      { status: "ghost-secret-projects-patch-status-token" },
      { status: "" },
      { dueDate: "2026-02-30" }
    ]) {
      await expectRejected("PATCH", `/api/projects/${projectId}`, payload);
    }
    assert.deepStrictEqual(counts(), afterProjectCreate);

    const clearedProject = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}`,
      headers: { cookie: owner },
      payload: { description: "", dueDate: "" }
    });
    assert.strictEqual(clearedProject.statusCode, 200, clearedProject.body);
    assert.strictEqual(clearedProject.json().project.description, "");
    assert.strictEqual(clearedProject.json().project.dueDate, "");

    const task = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks`,
      headers: { cookie: owner },
      payload: { title: "Valid task", status: "todo", dueDate: "2026-07-01" }
    });
    assert.strictEqual(task.statusCode, 200, task.body);
    const taskId = task.json().project.tasks[0].id;
    const afterTaskCreate = counts();

    for (const payload of [
      ["secret-projects-task-array-token"],
      { title: { value: "Task", token: "secret-projects-object-task-title-token" } },
      { title: `${"T".repeat(201)}secret-projects-long-task-title-token` },
      { title: "Valid task", status: "ghost-secret-projects-task-status-token" },
      { title: "Valid task", assigneeEmployeeId: { value: "emp-davit", token: "secret-projects-object-assignee-token" } },
      { title: "Valid task", dueDate: "2026-02-30" }
    ]) {
      await expectRejected("POST", `/api/projects/${projectId}/tasks`, payload);
    }
    for (const payload of [
      ["secret-projects-task-patch-array-token"],
      { title: "Bad\nsecret-projects-control-task-title-token" },
      { status: { value: "done", token: "secret-projects-object-task-status-token" } },
      { status: "" },
      { assigneeEmployeeId: ["emp-davit", "secret-projects-task-assignee-array-token"] },
      { dueDate: "2026-02-30" }
    ]) {
      await expectRejected("PATCH", `/api/projects/${projectId}/tasks/${taskId}`, payload);
    }
    for (const payload of [
      ["secret-projects-dependency-array-token"],
      { dependsOnTaskId: { value: taskId, token: "secret-projects-object-dependency-token" } },
      { dependsOnTaskId: `badAsecret-projects-dependency-case-token` },
      { dependsOnTaskId: `bad_secret-projects-dependency-underscore-token` },
      { dependsOnTaskId: `${"a".repeat(161)}secret-projects-long-dependency-token` }
    ]) {
      await expectRejected("POST", `/api/projects/${projectId}/tasks/${taskId}/dependencies`, payload);
    }
    assert.deepStrictEqual(counts(), afterTaskCreate);

    const clearedTask = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/tasks/${taskId}`,
      headers: { cookie: owner },
      payload: { assigneeEmployeeId: "", dueDate: "" }
    });
    assert.strictEqual(clearedTask.statusCode, 200, clearedTask.body);
    assert.strictEqual(clearedTask.json().project.tasks[0].assigneeEmployeeId, null);
    assert.strictEqual(clearedTask.json().project.tasks[0].dueDate, "");

    const milestone = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/milestones`,
      headers: { cookie: owner },
      payload: { title: "Valid milestone", dueDate: "2026-07-10" }
    });
    assert.strictEqual(milestone.statusCode, 200, milestone.body);
    const milestoneId = milestone.json().project.milestones[0].id;
    const afterMilestoneCreate = counts();

    for (const payload of [
      ["secret-projects-milestone-array-token"],
      { title: { value: "Milestone", token: "secret-projects-object-milestone-title-token" } },
      { title: `${"M".repeat(201)}secret-projects-long-milestone-title-token` },
      { title: "Valid milestone", dueDate: "2026-02-30" }
    ]) {
      await expectRejected("POST", `/api/projects/${projectId}/milestones`, payload);
    }
    for (const payload of [
      ["secret-projects-milestone-patch-array-token"],
      { title: "Bad\nsecret-projects-control-milestone-title-token" },
      { reached: "false" },
      { dueDate: "2026-02-30" }
    ]) {
      await expectRejected("PATCH", `/api/projects/${projectId}/milestones/${milestoneId}`, payload);
    }
    assert.deepStrictEqual(counts(), afterMilestoneCreate);

    const clearedMilestone = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/milestones/${milestoneId}`,
      headers: { cookie: owner },
      payload: { dueDate: "" }
    });
    assert.strictEqual(clearedMilestone.statusCode, 200, clearedMilestone.body);
    assert.strictEqual(clearedMilestone.json().project.milestones[0].dueDate, "");

    const afterValidChildren = counts();
    for (const payload of [
      ["secret-projects-time-array-token"],
      { minutes: { value: 30, token: "secret-projects-object-minutes-token" } },
      { minutes: "NaN-secret-projects-minutes-token" },
      { minutes: 0.5 },
      { minutes: "44.6" },
      { minutes: 100001 },
      { minutes: 30, taskId: { value: taskId, token: "secret-projects-object-task-token" } },
      { minutes: 30, entryDate: "2026-02-30" },
      { minutes: 30, note: "Bad\nsecret-projects-control-time-note-token" },
      { minutes: 30, note: `${"N".repeat(1001)}secret-projects-long-time-note-token` }
    ]) {
      await expectRejected("POST", `/api/projects/${projectId}/time-entries`, payload);
    }
    assert.deepStrictEqual(counts(), afterValidChildren);

    const time = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/time-entries`,
      headers: { cookie: owner },
      payload: { minutes: "45", taskId, note: "Valid metadata after rejects", entryDate: "2026-06-02" }
    });
    assert.strictEqual(time.statusCode, 200, time.body);
    assert.strictEqual(time.json().project.totalMinutes, 45);
  } finally { await app.close(); }
});

test("projects: malformed path ids are rejected before lifecycle side effects", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: owner },
      payload: { name: "Path guarded project", status: "active", dueDate: "2026-08-01" }
    });
    assert.strictEqual(created.statusCode, 200, created.body);
    const projectId = created.json().project.id;

    const task = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks`,
      headers: { cookie: owner },
      payload: { title: "Path guarded task", dueDate: "2026-07-01" }
    });
    assert.strictEqual(task.statusCode, 200, task.body);
    const taskId = task.json().project.tasks[0].id;

    const milestone = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/milestones`,
      headers: { cookie: owner },
      payload: { title: "Path guarded milestone", dueDate: "2026-07-15" }
    });
    assert.strictEqual(milestone.statusCode, 200, milestone.body);
    const milestoneId = milestone.json().project.milestones[0].id;

    const counts = () => ({
      projects: app.db.prepare("SELECT COUNT(*) AS count FROM projects WHERE org_id = ?").get("org-armosphera-demo").count,
      tasks: app.db.prepare("SELECT COUNT(*) AS count FROM project_tasks WHERE org_id = ?").get("org-armosphera-demo").count,
      dependencies: app.db.prepare("SELECT COUNT(*) AS count FROM project_task_dependencies WHERE org_id = ?").get("org-armosphera-demo").count,
      milestones: app.db.prepare("SELECT COUNT(*) AS count FROM project_milestones WHERE org_id = ?").get("org-armosphera-demo").count,
      timeEntries: app.db.prepare("SELECT COUNT(*) AS count FROM project_time_entries WHERE org_id = ?").get("org-armosphera-demo").count,
      audits: app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type LIKE ?").get("org-armosphera-demo", "projects.%").count
    });
    const projectRow = () => app.db.prepare("SELECT name, description, status, due_date AS dueDate FROM projects WHERE org_id = ? AND id = ?").get("org-armosphera-demo", projectId);
    const taskRow = () => app.db.prepare("SELECT title, status, due_date AS dueDate FROM project_tasks WHERE org_id = ? AND id = ?").get("org-armosphera-demo", taskId);
    const milestoneRow = () => app.db.prepare("SELECT title, reached, due_date AS dueDate FROM project_milestones WHERE org_id = ? AND id = ?").get("org-armosphera-demo", milestoneId);
    const before = counts();
    const beforeProject = projectRow();
    const beforeTask = taskRow();
    const beforeMilestone = milestoneRow();

    const expectRejected = async ({ method, url, payload, statusCode = 400, statusCodes, message = /Invalid project id/ }) => {
      const request = { method, url, headers: { cookie: owner } };
      if (payload !== undefined) request.payload = payload;
      const response = await app.inject(request);
      const allowedStatuses = statusCodes || [statusCode];
      assert.ok(allowedStatuses.includes(response.statusCode), `${url}: ${response.body}`);
      if (response.statusCode === 400) assert.match(response.body, message);
      assert.doesNotMatch(response.body, /secret-projects-path-/);
      assert.deepStrictEqual(counts(), before);
      assert.deepStrictEqual(projectRow(), beforeProject);
      assert.deepStrictEqual(taskRow(), beforeTask);
      assert.deepStrictEqual(milestoneRow(), beforeMilestone);
    };

    for (const request of [
      { method: "GET", url: "/api/projects/badAsecret-projects-path-read-id-token" },
      { method: "PATCH", url: "/api/projects/bad_secret-projects-path-patch-id-token", payload: { name: "secret-projects-path-patch-body-token" } },
      { method: "POST", url: "/api/projects/badAsecret-projects-path-task-parent-token/tasks", payload: { title: "secret-projects-path-task-body-token" } },
      { method: "POST", url: "/api/projects/bad_secret-projects-path-milestone-parent-token/milestones", payload: { title: "secret-projects-path-milestone-body-token" } },
      { method: "POST", url: "/api/projects/badAsecret-projects-path-time-parent-token/time-entries", payload: { minutes: 30, note: "secret-projects-path-time-body-token" } },
      { method: "POST", url: `/api/projects/badAsecret-projects-path-dependency-parent-token/tasks/${taskId}/dependencies`, payload: { dependsOnTaskId: taskId } },
      { method: "DELETE", url: `/api/projects/bad_secret-projects-path-dependency-delete-parent-token/tasks/${taskId}/dependencies/${taskId}` },
      { method: "GET", url: "/api/projects/bad_secret-projects-path-preview-parent-token/billing-preview?hourlyRate=10000" },
      { method: "POST", url: "/api/projects/badAsecret-projects-path-bill-parent-token/bill-time", payload: { hourlyRate: 10000, issueDate: "2026-05-15", token: "secret-projects-path-bill-body-token" } },
      { method: "GET", url: `/api/projects/${"a".repeat(161)}`, statusCodes: [400, 404] },
      { method: "POST", url: "/api/projects/bad%0Asecret-projects-path-control-parent-token/tasks", payload: { title: "secret-projects-path-encoded-task-body-token" } },
      { method: "POST", url: "/api/projects/%20%20/time-entries", payload: { minutes: 30, note: "secret-projects-path-encoded-time-body-token" } },
      { method: "PATCH", url: `/api/projects/${projectId}/tasks/badAsecret-projects-path-task-id-token`, payload: { status: "done" }, message: /Invalid project task id/ },
      { method: "PATCH", url: `/api/projects/${projectId}/tasks/bad%0Asecret-projects-path-task-control-token`, payload: { title: "secret-projects-path-task-encoded-body-token" }, message: /Invalid project task id/ },
      { method: "POST", url: `/api/projects/${projectId}/tasks/badAsecret-projects-path-dependency-task-token/dependencies`, payload: { dependsOnTaskId: taskId }, message: /Invalid project task id/ },
      { method: "DELETE", url: `/api/projects/${projectId}/tasks/bad_secret-projects-path-dependency-delete-task-token/dependencies/${taskId}`, message: /Invalid project task id/ },
      { method: "POST", url: `/api/projects/${projectId}/tasks/${taskId}/dependencies`, payload: { dependsOnTaskId: "badAsecret-projects-path-dependency-body-token" }, message: /Invalid dependency task id/ },
      { method: "DELETE", url: `/api/projects/${projectId}/tasks/${taskId}/dependencies/badAsecret-projects-path-dependency-id-token`, message: /Invalid dependency task id/ },
      { method: "DELETE", url: `/api/projects/${projectId}/tasks/${taskId}/dependencies/%20%20`, message: /Invalid dependency task id/ },
      { method: "PATCH", url: `/api/projects/${projectId}/milestones/bad_secret-projects-path-milestone-id-token`, payload: { reached: true }, message: /Invalid project milestone id/ },
      { method: "PATCH", url: `/api/projects/${projectId}/milestones/%20%20`, payload: { title: "secret-projects-path-milestone-encoded-body-token" }, message: /Invalid project milestone id/ }
    ]) {
      await expectRejected(request);
    }

    for (const request of [
      { method: "GET", url: "/api/projects/proj-missing", statusCode: 404 },
      { method: "PATCH", url: "/api/projects/proj-missing", payload: { name: "secret-projects-path-missing-patch-body-token" }, statusCode: 404 },
      { method: "POST", url: "/api/projects/proj-missing/tasks", payload: { title: "secret-projects-path-missing-task-body-token" }, statusCode: 404 },
      { method: "POST", url: "/api/projects/proj-missing/milestones", payload: { title: "secret-projects-path-missing-milestone-body-token" }, statusCode: 404 },
      { method: "POST", url: "/api/projects/proj-missing/time-entries", payload: { minutes: 30, note: "secret-projects-path-missing-time-body-token" }, statusCode: 404 },
      { method: "POST", url: `/api/projects/proj-missing/tasks/${taskId}/dependencies`, payload: { dependsOnTaskId: taskId }, statusCode: 404 },
      { method: "DELETE", url: `/api/projects/proj-missing/tasks/${taskId}/dependencies/${taskId}`, statusCode: 404 },
      { method: "GET", url: "/api/projects/proj-missing/billing-preview?hourlyRate=10000", statusCode: 404 },
      { method: "POST", url: "/api/projects/proj-missing/bill-time", payload: { hourlyRate: 10000, issueDate: "2026-05-15", token: "secret-projects-path-missing-bill-body-token" }, statusCode: 404 },
      { method: "PATCH", url: `/api/projects/${projectId}/tasks/ptask-missing`, payload: { status: "done" }, statusCode: 404 },
      { method: "POST", url: `/api/projects/${projectId}/tasks/ptask-missing/dependencies`, payload: { dependsOnTaskId: taskId }, statusCode: 404 },
      { method: "POST", url: `/api/projects/${projectId}/tasks/${taskId}/dependencies`, payload: { dependsOnTaskId: "ptask-missing" }, statusCode: 404 },
      { method: "DELETE", url: `/api/projects/${projectId}/tasks/ptask-missing/dependencies/${taskId}`, statusCode: 404 },
      { method: "DELETE", url: `/api/projects/${projectId}/tasks/${taskId}/dependencies/ptask-missing`, statusCode: 404 },
      { method: "PATCH", url: `/api/projects/${projectId}/milestones/pms-missing`, payload: { reached: true }, statusCode: 404 }
    ]) {
      await expectRejected(request);
    }

    const time = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/time-entries`,
      headers: { cookie: owner },
      payload: { minutes: 30, taskId, note: "Valid path guard proof", entryDate: "2026-06-03" }
    });
    assert.strictEqual(time.statusCode, 200, time.body);
    assert.strictEqual(time.json().project.totalMinutes, 30);
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

    const gateProject = (await app.inject({ method: "POST", url: "/api/projects", headers: { cookie: owner }, payload: { name: "Dependency gate project" } })).json().project.id;
    const gateTaskA = (await app.inject({ method: "POST", url: `/api/projects/${gateProject}/tasks`, headers: { cookie: owner }, payload: { title: "Gate task A" } })).json().project.tasks[0].id;
    const gateTaskB = (await app.inject({ method: "POST", url: `/api/projects/${gateProject}/tasks`, headers: { cookie: owner }, payload: { title: "Gate task B" } })).json().project.tasks.find(task => task.title === "Gate task B").id;
    const auditorDependency = await app.inject({
      method: "POST",
      url: `/api/projects/${gateProject}/tasks/${gateTaskB}/dependencies`,
      headers: { cookie: auditor },
      payload: { dependsOnTaskId: gateTaskA }
    });
    assert.strictEqual(auditorDependency.statusCode, 403);
    const auditorDeleteDependency = await app.inject({
      method: "DELETE",
      url: `/api/projects/${gateProject}/tasks/${gateTaskB}/dependencies/${gateTaskA}`,
      headers: { cookie: auditor }
    });
    assert.strictEqual(auditorDeleteDependency.statusCode, 403);

    // Cross-org: seed a foreign project, confirm it's invisible + 404 on detail/mutate
    const now = new Date().toISOString();
    const otherOrgId = "org-other-proj";
    app.db.prepare("INSERT INTO organizations (id, name, legal_name, tax_id, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(otherOrgId, "Other Proj LLC", "Other Proj LLC", "66666666", "AMD", now);
    const foreignId = "proj-foreign-1";
    app.db.prepare(`INSERT INTO projects (id, org_id, name, description, status, customer_id, deal_id, start_date, due_date, created_at, updated_at)
      VALUES (?, ?, ?, '', 'active', NULL, NULL, '', '', ?, ?)`).run(foreignId, otherOrgId, "Foreign project", now, now);
    const foreignTaskId = "ptask-foreign-1";
    app.db.prepare(`INSERT INTO project_tasks (id, org_id, project_id, title, status, assignee_employee_id, due_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'todo', NULL, '', ?, ?)`).run(foreignTaskId, otherOrgId, foreignId, "Foreign dependency task", now, now);

    const list = (await app.inject({ method: "GET", url: "/api/projects", headers: { cookie: owner } })).json();
    assert.ok(!list.projects.some(p => p.id === foreignId), "foreign project leaked into owner list");
    const get = await app.inject({ method: "GET", url: `/api/projects/${foreignId}`, headers: { cookie: owner } });
    assert.strictEqual(get.statusCode, 404);
    const addTask = await app.inject({ method: "POST", url: `/api/projects/${foreignId}/tasks`, headers: { cookie: owner }, payload: { title: "x" } });
    assert.strictEqual(addTask.statusCode, 404);
    const addForeignDependency = await app.inject({
      method: "POST",
      url: `/api/projects/${gateProject}/tasks/${gateTaskB}/dependencies`,
      headers: { cookie: owner },
      payload: { dependsOnTaskId: foreignTaskId }
    });
    assert.strictEqual(addForeignDependency.statusCode, 404);
    const mutateForeignDependencyProject = await app.inject({
      method: "POST",
      url: `/api/projects/${foreignId}/tasks/${foreignTaskId}/dependencies`,
      headers: { cookie: owner },
      payload: { dependsOnTaskId: gateTaskA }
    });
    assert.strictEqual(mutateForeignDependencyProject.statusCode, 404);
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

test("project templates: list/detail and create project with copied tasks, milestones, and parent links", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();

    const unauth = await app.inject({ method: "GET", url: "/api/project-templates" });
    assert.strictEqual(unauth.statusCode, 401);

    const owner = await login(app);
    const list = await app.inject({ method: "GET", url: "/api/project-templates", headers: { cookie: owner } });
    assert.strictEqual(list.statusCode, 200, list.body);
    const templates = list.json().templates;
    assert.ok(templates.length >= 2, "seeded project templates present");
    const onboarding = templates.find(template => template.id === "ptpl-client-onboarding");
    assert.ok(onboarding, "client onboarding template listed");
    assert.strictEqual(onboarding.taskCount, 4);
    assert.strictEqual(onboarding.milestoneCount, 2);
    assert.strictEqual(onboarding.tasks.length, 4);
    assert.strictEqual(onboarding.milestones.length, 2);
    assert.ok(onboarding.tasks.some(task => task.parentTask?.title === "Configure customer channels"));

    const detail = await app.inject({ method: "GET", url: "/api/project-templates/ptpl-client-onboarding", headers: { cookie: owner } });
    assert.strictEqual(detail.statusCode, 200, detail.body);
    const template = detail.json().template;
    assert.strictEqual(template.id, "ptpl-client-onboarding");
    const parentTemplateTask = template.tasks.find(task => task.id === "ptplt-client-channel-parent");
    const childTemplateTask = template.tasks.find(task => task.id === "ptplt-client-channel-whatsapp");
    assert.deepStrictEqual(parentTemplateTask.subtasks, [{ id: childTemplateTask.id, title: childTemplateTask.title, status: "todo" }]);
    assert.deepStrictEqual(childTemplateTask.parentTask, { id: parentTemplateTask.id, title: parentTemplateTask.title, status: "todo" });

    const created = await app.inject({
      method: "POST",
      url: "/api/project-templates/ptpl-client-onboarding/create-project",
      headers: { cookie: owner },
      payload: {
        name: "Template-created onboarding",
        customerId: "cust-ani",
        dealId: "deal-ani-inbox",
        startDate: "2026-06-01",
        dueDate: "2026-06-30"
      }
    });
    assert.strictEqual(created.statusCode, 200, created.body);
    const body = created.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.template.id, "ptpl-client-onboarding");
    assert.strictEqual(body.project.name, "Template-created onboarding");
    assert.strictEqual(body.project.customerId, "cust-ani");
    assert.strictEqual(body.project.dealId, "deal-ani-inbox");
    assert.strictEqual(body.project.startDate, "2026-06-01");
    assert.strictEqual(body.project.dueDate, "2026-06-30");
    assert.strictEqual(body.project.tasks.length, template.tasks.length);
    assert.strictEqual(body.project.milestones.length, template.milestones.length);

    const copiedParent = body.project.tasks.find(task => task.title === "Configure customer channels");
    const copiedChild = body.project.tasks.find(task => task.title === "Connect WhatsApp inbox");
    assert.ok(copiedParent && copiedChild, "copied parent and child tasks present");
    assert.strictEqual(copiedParent.dueDate, "2026-06-06");
    assert.strictEqual(copiedChild.dueDate, "2026-06-08");
    assert.strictEqual(copiedChild.parentTaskId, copiedParent.id);
    assert.deepStrictEqual(copiedChild.parentTask, { id: copiedParent.id, title: copiedParent.title, status: "todo" });
    assert.deepStrictEqual(copiedParent.subtasks, [{ id: copiedChild.id, title: copiedChild.title, status: "todo" }]);

    const kickoff = body.project.milestones.find(milestone => milestone.title === "Kickoff accepted");
    assert.ok(kickoff, "copied kickoff milestone present");
    assert.strictEqual(kickoff.dueDate, "2026-06-04");

    const persisted = await app.inject({ method: "GET", url: `/api/projects/${body.project.id}`, headers: { cookie: owner } });
    assert.strictEqual(persisted.statusCode, 200, persisted.body);
    assert.strictEqual(persisted.json().project.tasks.find(task => task.id === copiedChild.id).parentTaskId, copiedParent.id);
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type = ?").get("org-armosphera-demo", "projects.template.project_created").count, 1);
  } finally { await app.close(); }
});

test("project templates: app access, writer gate, cross-org isolation, and malformed input guardrails", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const sales = await login(app, "sales@armosphera.local", DEFAULT_PASSWORD);
    const auditor = await login(app, "auditor@armosphera.local", DEFAULT_PASSWORD);
    const orgId = "org-armosphera-demo";
    const counts = () => ({
      projects: app.db.prepare("SELECT COUNT(*) AS count FROM projects WHERE org_id = ?").get(orgId).count,
      tasks: app.db.prepare("SELECT COUNT(*) AS count FROM project_tasks WHERE org_id = ?").get(orgId).count,
      milestones: app.db.prepare("SELECT COUNT(*) AS count FROM project_milestones WHERE org_id = ?").get(orgId).count,
      audits: app.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE org_id = ? AND type LIKE ?").get(orgId, "projects.template.%").count
    });
    const expectNoSideEffect = async ({ method, url, cookie = owner, payload, statusCode = 400, statusCodes, message, leakPattern = /secret-project-templates-/ }) => {
      const before = counts();
      const request = { method, url, headers: { cookie } };
      if (payload !== undefined) request.payload = payload;
      const response = await app.inject(request);
      const allowedStatuses = statusCodes || [statusCode];
      assert.ok(allowedStatuses.includes(response.statusCode), `${url}: ${response.body}`);
      if (message) assert.match(response.body, message);
      assert.doesNotMatch(response.body, leakPattern);
      assert.deepStrictEqual(counts(), before);
      return response;
    };

    const blockedByAppAccess = await expectNoSideEffect({
      method: "POST",
      url: "/api/project-templates/ptpl-client-onboarding/create-project",
      cookie: sales,
      payload: { name: "Sales lacks app access" },
      statusCode: 403
    });
    assert.match(blockedByAppAccess.body, /App access required/);

    app.db.prepare("INSERT OR REPLACE INTO app_assignments (org_id, role, app_id, enabled) VALUES (?, ?, ?, 1)")
      .run(orgId, "Auditor", "projects");
    const blockedByWriter = await expectNoSideEffect({
      method: "POST",
      url: "/api/project-templates/ptpl-client-onboarding/create-project",
      cookie: auditor,
      payload: { name: "Auditor has app but cannot write" },
      statusCode: 403
    });
    assert.match(blockedByWriter.body, /Projects writer role required/);

    const now = new Date().toISOString();
    const otherOrgId = "org-other-template";
    app.db.prepare("INSERT INTO organizations (id, name, legal_name, tax_id, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(otherOrgId, "Other Template LLC", "Other Template LLC", "55555555", "AMD", now);
    app.db.prepare("INSERT INTO project_templates (id, org_id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, '', 'active', ?, ?)")
      .run("ptpl-foreign-secret-project-templates-cross-org-token", otherOrgId, "Foreign template", now, now);
    app.db.prepare(`INSERT INTO project_template_tasks (id, org_id, template_id, title, status, due_offset_days, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'todo', 1, 1, ?, ?)`)
      .run("ptplt-foreign-secret-project-templates-cross-org-token", otherOrgId, "ptpl-foreign-secret-project-templates-cross-org-token", "Foreign task", now, now);

    const list = (await app.inject({ method: "GET", url: "/api/project-templates", headers: { cookie: owner } })).json();
    assert.ok(!list.templates.some(template => template.id === "ptpl-foreign-secret-project-templates-cross-org-token"));
    await expectNoSideEffect({
      method: "GET",
      url: "/api/project-templates/ptpl-foreign-secret-project-templates-cross-org-token",
      statusCode: 404
    });
    await expectNoSideEffect({
      method: "POST",
      url: "/api/project-templates/ptpl-foreign-secret-project-templates-cross-org-token/create-project",
      payload: { name: "Cross org secret-project-templates-create-token" },
      statusCode: 404
    });

    for (const request of [
      { method: "GET", url: "/api/project-templates/badAsecret-project-templates-path-token" },
      { method: "POST", url: "/api/project-templates/bad_secret-project-templates-path-token/create-project", payload: { name: "secret-project-templates-path-body-token" } },
      { method: "POST", url: "/api/project-templates/bad%0Asecret-project-templates-path-control-token/create-project", payload: { name: "secret-project-templates-path-encoded-body-token" } },
      { method: "GET", url: `/api/project-templates/${"a".repeat(161)}`, statusCodes: [400, 404] }
    ]) {
      await expectNoSideEffect({ ...request, statusCode: 400, message: request.statusCodes ? undefined : /Invalid project template id/ });
    }

    for (const payload of [
      ["secret-project-templates-array-body-token"],
      { name: { value: "Template project", token: "secret-project-templates-object-name-token" } },
      { name: `${"P".repeat(201)}secret-project-templates-long-name-token` },
      { customerId: ["cust-ani", "secret-project-templates-customer-array-token"] },
      { dealId: { value: "deal-ani-inbox", token: "secret-project-templates-object-deal-token" } },
      { startDate: "2026-02-30" },
      { dueDate: "2026-06-01\nsecret-project-templates-control-due-token" }
    ]) {
      await expectNoSideEffect({
        method: "POST",
        url: "/api/project-templates/ptpl-client-onboarding/create-project",
        payload,
        statusCode: 400
      });
    }

    const missingDeal = await expectNoSideEffect({
      method: "POST",
      url: "/api/project-templates/ptpl-client-onboarding/create-project",
      payload: { name: "Missing deal", dealId: "deal-missing-secret-project-templates-token" },
      statusCode: 400
    });
    assert.match(missingDeal.body, /Linked deal not found/);
  } finally { await app.close(); }
});
