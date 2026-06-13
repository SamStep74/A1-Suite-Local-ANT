"use strict";

/**
 * A1 SMB CRM — Track 4 engines smoke test (M14.12-M14.16).
 * Combined engine-level tests for outbound, webhooks, import,
 * accounting, integration. 5 contracts per engine ≈ 25 gates,
 * 100% pure-engine (no Fastify / no HTTP).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { openDatabase } = require("../../server/db");

const outbound    = require("../../server/smbCrmOutbound");
const webhooks    = require("../../server/smbCrmWebhooks");
const importer    = require("../../server/smbCrmImport");
const accounting  = require("../../server/smbCrmAccounting");
const integration = require("../../server/smbCrmIntegration");
const records     = require("../../server/smbCrmRecords");

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

const SAMPLE_PAYLOADS = {
  "whatsapp": {
    entry: [
      { changes: [
        { value: { messages: [ { from: "+374001", id: "wamid.1", text: { body: "hi" }, timestamp: "1700000000" } ] } }
      ] }
    ]
  },
  "meta-leads": { entry: [ { changes: [ { value: { leadgen_id: "123", form_id: "f1", ad_id: "a1" } } ] } ] },
  "telephony": { CallSid: "CA1", From: "+374001", To: "+374002", Direction: "inbound", CallStatus: "ringing", Duration: "30" },
  "calendar": { id: "evt-1", summary: "Demo", start: { dateTime: "2026-06-13T10:00:00Z" }, end: { dateTime: "2026-06-13T11:00:00Z" }, attendees: [ { email: "a@x.test" } ] },
  "sheets": { spreadsheetId: "ss1", range: "A1:D5", values: [ ["a", "b"], ["c", "d"] ] },
  "email": { messageId: "m1", from: "x@y.test", to: "z@y.test", subject: "Hi", text: "body" },
  "payment": { id: "pay_1", type: "charge.succeeded", amount: 1000, currency: "amd", status: "succeeded", customer: "cus_1" }
};

// ════════════════════════════════════════════════════════════════════════
// OUTBOUND
// ════════════════════════════════════════════════════════════════════════

test("smb-crm outbound: queue + send transitions queued → sent (stub)", async () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  const queued = outbound.queueOutbound(db, o.org_id, {
    channel: "whatsapp", toAddress: "+374001", body: "Hi there"
  });
  assert.equal(queued.status, "queued");
  const sent = await outbound.sendOutbound(db, o.org_id, queued.id);
  assert.equal(sent.status, "sent");
  assert.ok(sent.sent_at, "sent_at is set");
  assert.equal(sent.provider, "stub");
  const v = outbound.toOutboundView(sent);
  assert.equal(v.response.providerMessageId.startsWith("stub-"), true);
});

test("smb-crm outbound: sendOutboundBatch sends N messages", async () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const q = outbound.queueOutbound(db, o.org_id, {
      channel: "email", toAddress: `u${i}@x.test`, body: `body ${i}`
    });
    ids.push(q.id);
  }
  const out = await outbound.sendOutboundBatch(db, o.org_id, ids);
  assert.equal(out.length, 3);
  for (const row of out) assert.equal(row.status, "sent");
});

test("smb-crm outbound: cross-tenant send returns null", async () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  const q = outbound.queueOutbound(db, o.org_id, {
    channel: "sms", toAddress: "+374002", body: "ping"
  });
  seedSecondOrg(db, "org-b");
  const sent = await outbound.sendOutbound(db, "org-b", q.id);
  assert.equal(sent, null, "foreign send is a no-op");
});

test("smb-crm outbound: cancel queued message (sent-after-cancel is impossible)", async () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  const q = outbound.queueOutbound(db, o.org_id, { channel: "email", toAddress: "x@x.test", body: "x" });
  const cancelled = outbound.cancelOutbound(db, o.org_id, q.id);
  assert.equal(cancelled.status, "cancelled");
  // Trying to send a cancelled message keeps it cancelled.
  const sent = await outbound.sendOutbound(db, o.org_id, q.id);
  assert.equal(sent.status, "cancelled");
});

test("smb-crm outbound: invalid channel throws", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  assert.throws(
    () => outbound.queueOutbound(db, o.org_id, { channel: "carrier-pigeon", body: "x" }),
    (err) => err && err.code === "INVALID_CHANNEL"
  );
});

// ════════════════════════════════════════════════════════════════════════
// WEBHOOKS
// ════════════════════════════════════════════════════════════════════════

const CHANNELS = ["whatsapp", "meta-leads", "telephony", "calendar", "sheets", "email", "payment"];

test("smb-crm webhooks: all 7 channels normalize + persist", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  for (const ch of CHANNELS) {
    const sample = SAMPLE_PAYLOADS[ch];
    const row = webhooks.handleInboundWebhook(db, o.org_id, ch, sample);
    assert.ok(row, `row created for ${ch}`);
    assert.equal(row.channel, ch);
    const v = webhooks.toWebhookEventView(row);
    assert.equal(v.status, "received");
    assert.ok(v.payload.normalized, `${ch} has normalized payload`);
  }
});

test("smb-crm webhooks: idempotency dedup (same key returns same row)", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  const a = webhooks.handleInboundWebhook(db, o.org_id, "payment",
    { id: "pay_1", type: "charge.succeeded", amount: 1000 },
    { idempotencyKey: "evt-1" });
  const b = webhooks.handleInboundWebhook(db, o.org_id, "payment",
    { id: "pay_1", type: "charge.succeeded", amount: 1000 },
    { idempotencyKey: "evt-1" });
  assert.equal(a.id, b.id, "duplicate returns same row id");
  const count = db.prepare("SELECT COUNT(*) AS c FROM smb_crm_webhook_events").get().c;
  assert.equal(count, 1, "only one row written");
});

test("smb-crm webhooks: cross-tenant isolation (foreign org can't see row)", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  const row = webhooks.handleInboundWebhook(db, o.org_id, "email",
    { messageId: "m1", from: "x@y.test", subject: "hi" },
    { idempotencyKey: "k1" });
  seedSecondOrg(db, "org-b");
  const fromB = webhooks.getWebhookEvent(db, "org-b", row.id);
  assert.equal(fromB, null, "org B cannot see org A's webhook event");
  const list = webhooks.listWebhookEvents(db, "org-b", {});
  assert.equal(list.length, 0, "org B's list is empty");
});

test("smb-crm webhooks: processWebhookEvent transitions received → processed", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  const row = webhooks.handleInboundWebhook(db, o.org_id, "calendar",
    { id: "evt-1", summary: "Demo", start: { dateTime: "2026-06-13T10:00:00Z" } });
  const processed = webhooks.processWebhookEvent(db, o.org_id, row.id);
  assert.equal(processed.status, "processed");
  assert.ok(processed.processed_at, "processed_at set");
});

test("smb-crm webhooks: invalid channel throws", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  assert.throws(
    () => webhooks.handleInboundWebhook(db, o.org_id, "carrier-pigeon", {}),
    (err) => err && err.code === "INVALID_CHANNEL"
  );
});

// ════════════════════════════════════════════════════════════════════════
// IMPORT
// ════════════════════════════════════════════════════════════════════════

test("smb-crm import: parseCsv handles quoted commas + double-quote escapes", () => {
  const csv = "name,email,note\nAcme,acme@x.test,\"Hello, world\"\nBeta,beta@x.test,\"She said \"\"hi\"\"\"";
  const rows = importer.parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Acme");
  assert.equal(rows[0].note, "Hello, world");
  assert.equal(rows[1].note, 'She said "hi"');
});

test("smb-crm import: 5 customers → 5 records, 2 dupes (same email) → 1 record", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  const csv = [
    "fullName,email,phone",
    "A,a@x.test,+374001",
    "B,b@x.test,+374002",
    "C,c@x.test,+374003",
    "D,d@x.test,+374004",
    "E,e@x.test,+374005"
  ].join("\n");
  const first = importer.importCsv(db, o.org_id, {
    entityType: "customer", csv, dedupKey: "email"
  });
  assert.equal(first.totalRows, 5);
  assert.equal(first.importedRows, 5);
  assert.equal(first.dedupedRows, 0);
  assert.equal(first.erroredRows, 0);
  // Second import with 2 dupes: should report 0 imported, 2 deduped.
  const csv2 = [
    "fullName,email,phone",
    "A2,a@x.test,+374099",
    "F,f@x.test,+374006",
    "B2,b@x.test,+374098"
  ].join("\n");
  const second = importer.importCsv(db, o.org_id, {
    entityType: "customer", csv: csv2, dedupKey: "email"
  });
  assert.equal(second.totalRows, 3);
  assert.equal(second.importedRows, 1, "only F is new");
  assert.equal(second.dedupedRows, 2, "A2 and B2 are dupes");
  // Final state: 6 customers (5 + 1 new F).
  const all = records.listCustomers(db, o.org_id, { limit: 50 });
  assert.equal(all.length, 6);
});

test("smb-crm import: invalid rows reported in errors_json", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  const csv = [
    "fullName,email",
    "Acme,not-an-email",
    "Beta,beta@x.test"
  ].join("\n");
  const result = importer.importCsv(db, o.org_id, {
    entityType: "customer", csv
  });
  assert.equal(result.totalRows, 2);
  assert.equal(result.importedRows, 1, "Beta imported");
  assert.equal(result.erroredRows, 1, "Acme rejected (invalid email)");
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].rowIndex, 1);
  assert.match(result.errors[0].message, /email/i);
  const runRow = importer.getImportRun(db, o.org_id, result.run.id);
  assert.ok(runRow, "import run row persisted");
  const view = importer.toImportRunView(runRow);
  assert.equal(view.erroredRows, 1);
});

// ════════════════════════════════════════════════════════════════════════
// ACCOUNTING
// ════════════════════════════════════════════════════════════════════════

test("smb-crm accounting: deal export produces CSV with the right columns", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  // Seed a customer + a deal + a quote.
  const c = records.createCustomer(db, o.org_id, { fullName: "Acme" });
  records.createDeal(db, o.org_id, {
    title: "Big", customerId: c.id, value: 1000, currency: "AMD", status: "open"
  });
  records.createQuote(db, o.org_id, {
    number: "Q-1", customerId: c.id, totalAmount: 1500, currency: "AMD", status: "sent"
  });
  const out = accounting.exportAccounting(db, o.org_id, { entityType: "deal", format: "csv" });
  assert.equal(out.format, "csv");
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].title, "Big");
  assert.equal(out.rows[0].value, 1000);
  // CSV has the right header
  const header = out.csv.split("\n")[0];
  assert.ok(header.includes("id"), "header has id");
  assert.ok(header.includes("title"), "header has title");
  assert.ok(header.includes("value"), "header has value");
  assert.ok(header.includes("customerName"), "header has customerName (joined)");
  assert.equal(out.rows[0].customerName, "Acme");
});

test("smb-crm accounting: period filter 2026-Q1 bounds the export", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  const c = records.createCustomer(db, o.org_id, { fullName: "Acme" });
  // Manually set the deal's created_at to 2025-12 (before the period).
  const d = records.createDeal(db, o.org_id, { title: "Old", customerId: c.id, value: 100, currency: "AMD" });
  db.prepare("UPDATE smb_crm_deals SET created_at = ? WHERE id = ?").run("2025-12-15T10:00:00.000Z", d.id);
  // In-Q1 deal: 2026-02-15.
  const q1 = records.createDeal(db, o.org_id, { title: "Q1 Deal", customerId: c.id, value: 200, currency: "AMD" });
  db.prepare("UPDATE smb_crm_deals SET created_at = ? WHERE id = ?").run("2026-02-15T10:00:00.000Z", q1.id);
  // Out-of-Q1 (Q2) deal: 2026-06-13 (default now).
  records.createDeal(db, o.org_id, { title: "Q2 Deal", customerId: c.id, value: 300, currency: "AMD" });
  const out = accounting.exportAccounting(db, o.org_id, { entityType: "deal", format: "json", period: "2026-Q1" });
  assert.equal(out.rows.length, 1, "only the Q1 deal is exported");
  assert.equal(out.rows[0].title, "Q1 Deal");
});

test("smb-crm accounting: invalid entityType throws", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  assert.throws(
    () => accounting.exportAccounting(db, o.org_id, { entityType: "gl-journal" }),
    (err) => err && err.code === "INVALID_ENTITY_TYPE"
  );
});

// ════════════════════════════════════════════════════════════════════════
// INTEGRATION
// ════════════════════════════════════════════════════════════════════════

test("smb-crm integration: upsert + get + list", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  const created = integration.upsertIntegration(db, o.org_id, {
    integrationKey: "whatsapp-cloud", displayName: "WhatsApp Cloud",
    environment: "production", authType: "api_key", config: { phoneNumberId: "PNI1" }
  });
  assert.equal(created.integration_key, "whatsapp-cloud");
  const got = integration.getIntegration(db, o.org_id, "whatsapp-cloud");
  assert.ok(got, "get by key");
  const list = integration.listIntegrations(db, o.org_id, {});
  assert.equal(list.length, 1);
});

test("smb-crm integration: rotateSecret hashes + clears plaintext", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  integration.upsertIntegration(db, o.org_id, {
    integrationKey: "stripe", displayName: "Stripe"
  });
  const result = integration.rotateSecret(db, o.org_id, "stripe", "sk_live_abc123", o.id);
  assert.equal(result.fingerprint, require("node:crypto").createHash("sha256").update("sk_live_abc123").digest("hex").slice(0, 8));
  // The hash is sha256 hex (64 chars).
  const cred = db.prepare("SELECT * FROM smb_crm_integration_credentials WHERE integration_id = ?").get(result.view.id);
  assert.equal(cred.secret_hash.length, 64);
  assert.notEqual(cred.secret_hash, "sk_live_abc123", "plaintext is NOT stored");
  assert.equal(cred.rotated_by_user_id, o.id);
  // After rotation, status is "connected".
  assert.equal(result.view.status, "connected");
});

test("smb-crm integration: healthCheck returns deterministic stub envelope", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  integration.upsertIntegration(db, o.org_id, { integrationKey: "telegram-bot", displayName: "Telegram" });
  const row = integration.healthCheck(db, o.org_id, "telegram-bot");
  const v = integration.toIntegrationView(row);
  assert.equal(v.lastHealth.ok, true);
  assert.ok(v.lastHealth.checkedAt, "checkedAt set");
  assert.match(v.lastHealth.note, /stub health-check/);
  // upsert defaulted status to "disconnected" (no secret rotated yet);
  // healthCheck only persists last_health_*, doesn't change status.
  assert.equal(v.status, "disconnected");
  assert.ok(v.lastHealthAt, "last_health_at set on the row");
});

test("smb-crm integration: cross-tenant isolation", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  integration.upsertIntegration(db, o.org_id, { integrationKey: "stripe", displayName: "Stripe" });
  seedSecondOrg(db, "org-b");
  const fromB = integration.getIntegration(db, "org-b", "stripe");
  assert.equal(fromB, null, "org B cannot see org A's integration");
  const health = integration.healthCheck(db, "org-b", "stripe");
  assert.equal(health, null);
});

test("smb-crm integration: action trigger upsert (enabled + config)", () => {
  const db = openDatabase(":memory:");
  const o = owner(db);
  const i = integration.upsertIntegration(db, o.org_id, { integrationKey: "stripe", displayName: "Stripe" });
  const t = integration.upsertActionTrigger(db, o.org_id, {
    integrationId: i.id, actionKey: "charge.succeeded", enabled: true, config: { pipeline: "v1" }
  });
  assert.equal(t.action_key, "charge.succeeded");
  assert.equal(t.enabled, 1);
  const list = integration.getActionTriggers(db, o.org_id, i.id);
  assert.equal(list.length, 1);
  const view = integration.toActionTriggerView(t);
  assert.equal(view.enabled, true);
  assert.equal(view.config.pipeline, "v1");
});
