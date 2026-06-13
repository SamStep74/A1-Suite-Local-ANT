"use strict";

/**
 * A1 SMB CRM — Automations engine (Track 4: M14.11) smoke test.
 * 6 contract gates, 100% pure-engine (no Fastify / no HTTP).
 *
 * 1. createAutomation persists a row with the correct shape
 * 2. getAutomation is org-scoped (foreign org returns null)
 * 3. listAutomations filters by triggerEvent + enabled
 * 4. runAutomations matches the trigger and writes N run rows
 * 5. updateAutomation preserves untouched fields
 * 6. deleteAutomation removes the row + future runs don't match
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { openDatabase } = require("../../server/db");
const a = require("../../server/smbCrmAutomations");

function owner(db) {
  return db.prepare(`SELECT id, org_id FROM users WHERE role = 'Owner' LIMIT 1`).get();
}

function seedSecondOrg(db, slug = "org-b") {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO organizations (id, name, legal_name, tax_id, currency, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(slug, "Org B", "Org B LLC", "88888888", "AMD", now);
  db.prepare(`INSERT INTO users (id, org_id, email, name, role, password_hash, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(`user-${slug}`, slug, `owner-${slug}@x.test`, "Owner B", "Owner", "x", now);
}

test("smb-crm automations: createAutomation persists a row with the right shape", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  const row = a.createAutomation(db, o.org_id, {
    name: "Welcome new customer",
    triggerEvent: "customer.created",
    action: "send_outbound_message",
    actionJson: { channel: "whatsapp", template: "welcome" }
  }, { createdBy: o.id });
  assert.ok(row && row.id, "row returned with id");
  assert.equal(row.name, "Welcome new customer");
  assert.equal(row.trigger_event, "customer.created");
  assert.equal(row.action, "send_outbound_message");
  assert.equal(row.enabled, 1);
  assert.equal(typeof row.action_json, "string", "raw action_json is a JSON string");
  const view = a.toAutomationView(row);
  assert.equal(view.orgId, o.org_id);
  assert.equal(view.enabled, true);
  assert.equal(view.actionJson.channel, "whatsapp");
});

test("smb-crm automations: getAutomation is org-scoped (foreign org returns null)", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  const row = a.createAutomation(db, o.org_id, {
    name: "Solo", triggerEvent: "customer.created", action: "noop"
  });
  assert.ok(a.getAutomation(db, o.org_id, row.id), "owner A sees own row");
  seedSecondOrg(db, "org-b");
  assert.equal(a.getAutomation(db, "org-b", row.id), null, "owner B cannot see A's row");
});

test("smb-crm automations: listAutomations filters by triggerEvent + enabled", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  a.createAutomation(db, o.org_id, { name: "A1", triggerEvent: "customer.created", action: "noop" });
  a.createAutomation(db, o.org_id, { name: "A2", triggerEvent: "customer.created", action: "noop" });
  a.createAutomation(db, o.org_id, { name: "A3", triggerEvent: "deal.won", action: "noop" });
  a.createAutomation(db, o.org_id, { name: "A4", triggerEvent: "customer.created", action: "noop", enabled: false });
  const onlyCustomer = a.listAutomations(db, o.org_id, { triggerEvent: "customer.created" });
  assert.equal(onlyCustomer.length, 3, "all customer.created rows including disabled");
  const allEnabled = a.listAutomations(db, o.org_id, { triggerEvent: "customer.created", enabled: 1 });
  assert.equal(allEnabled.length, 2, "filter enabled=1 returns only enabled");
  const allDisabled = a.listAutomations(db, o.org_id, { triggerEvent: "customer.created", enabled: 0 });
  assert.equal(allDisabled.length, 1, "filter enabled=0 returns the disabled one");
  const includingDisabled = a.listAutomations(db, o.org_id, { triggerEvent: "customer.created", enabled: "all" });
  assert.equal(includingDisabled.length, 3, "enabled='all' is a no-op (caller bypasses filter)");
});

test("smb-crm automations: runAutomations matches the trigger and writes run rows", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  a.createAutomation(db, o.org_id, { name: "W", triggerEvent: "customer.created", action: "send_outbound_message", actionJson: { channel: "whatsapp" } });
  a.createAutomation(db, o.org_id, { name: "D", triggerEvent: "deal.won", action: "noop" });
  const runs = a.runAutomations(db, o.org_id, "customer.created", { customerId: "cust-1" });
  assert.equal(runs.length, 1, "only the matching automation runs");
  const run = runs[0];
  assert.equal(run.status, "ok");
  assert.equal(run.automation_id, runs[0].automation_id);
  const view = a.toAutomationRunView(run);
  assert.equal(view.triggerEvent, "customer.created");
  assert.ok(Array.isArray(view.log.steps) && view.log.steps.length >= 2, "run log has match + would_dispatch steps");
  const listRuns = a.listAutomationRuns(db, o.org_id, { triggerEvent: "customer.created" });
  assert.equal(listRuns.length, 1);
});

test("smb-crm automations: updateAutomation preserves untouched fields", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  const row = a.createAutomation(db, o.org_id, { name: "Orig", triggerEvent: "customer.created", action: "noop" });
  const updated = a.updateAutomation(db, o.org_id, row.id, { name: "Renamed" });
  assert.ok(updated, "row found");
  assert.equal(updated.name, "Renamed");
  assert.equal(updated.trigger_event, "customer.created", "untouched field preserved");
  assert.equal(updated.action, "noop", "untouched field preserved");
});

test("smb-crm automations: deleteAutomation removes the row + future runs don't match", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  const row = a.createAutomation(db, o.org_id, { name: "Doomed", triggerEvent: "customer.created", action: "noop" });
  const beforeRun = a.runAutomations(db, o.org_id, "customer.created", {});
  assert.equal(beforeRun.length, 1);
  const ok = a.deleteAutomation(db, o.org_id, row.id);
  assert.equal(ok, true);
  const after = a.getAutomation(db, o.org_id, row.id);
  assert.equal(after, null, "deleted row is gone");
  // Cross-tenant delete returns false (no row visible in foreign org).
  seedSecondOrg(db, "org-b");
  assert.equal(a.deleteAutomation(db, "org-b", row.id), false, "cross-tenant delete is a no-op");
  // Future runs no longer match (the row is gone).
  const afterRun = a.runAutomations(db, o.org_id, "customer.created", {});
  assert.equal(afterRun.length, 0);
});
