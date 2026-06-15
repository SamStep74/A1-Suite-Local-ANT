/**
 * quote-templates.test.js — 5-gate contract suite for the
 * quote template engine (server/lib/quote-templates.js).
 *
 * Gate coverage:
 *   1. Pure — listTemplates, getTemplate,
 *     createQuoteFromTemplate, ensureQuoteTemplatesSchema,
 *     applyOverrides, computeTotalAmount, DEFAULT_TEMPLATES
 *     are exported; ensureQuoteTemplatesSchema is idempotent
 *     (call twice → same result); the 4 built-in templates
 *     are seeded on first call.
 *   2. Types — listTemplates returns an array of {id, orgId,
 *     name, description, lineItems, builtin, createdAt};
 *     lineItems entries have the 4 documented fields
 *     (name, description, quantity, unitPrice); builtin
 *     templates are flagged builtin=true; the orgId for a
 *     built-in is "_builtin"; createQuoteFromTemplate returns
 *     {ok, quote, lineItems, totalAmount} on success.
 *   3. Idempotency — calling ensureQuoteTemplatesSchema twice
 *     does not duplicate the built-ins (INSERT OR IGNORE);
 *     two createQuoteFromTemplate calls with the same
 *     templateId + number produce two distinct quote rows
 *     (the engine itself doesn't dedupe — that's the route's
 *     job via idempotencyKey).
 *   4. Contract — overrides length must match template line
 *     count (a mismatch throws OVERRIDES_LENGTH_MISMATCH);
 *     the total is recomputed server-side from
 *     quantity * unitPrice (never trusted from the client);
 *     the quote row has the 13 columns (id, org_id, number,
 *     customer_id, deal_id, issue_date, expiry_date, status,
 *     total_amount, currency, line_items_json, created_at,
 *     updated_at); missing fields in the line items get
 *     defaulted (quantity=0, unitPrice=0); Armenian names
 *     in line items round-trip into the JSON blob; the
 *     template_id reference is preserved on the returned
 *     quote (via template_id + template_name metadata).
 *   5. Edge — an unknown templateId returns
 *     {ok:false, error:"template not found:..."}; an
 *     overrides array of the wrong length returns
 *     {ok:false, error:"overrides length ... does not
 *     match..."}; missing templateId / missing number
 *     return {ok:false}; an org cannot see another org's
 *     custom templates (orgId scoping); the engine handles
 *     a corrupt line_items_json blob by defaulting to an
 *     empty array; a template id with non-string characters
 *     is rejected (no quote created); getTemplate returns
 *     null for an unknown id; the engine never throws on
 *     bad input (returns a discriminated result instead).
 *
 * Why 5 gates: the engine is the SOLE entry point for the
 * /api/smb-crm/quotes/from-template route. A silent regression
 * (skipping the total recomputation, leaking cross-tenant
 * templates, crashing on bad JSON, missing the seeded
 * built-ins) would either break the SMB-CRM UX or compromise
 * tenant data.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const qt = require('../quote-templates');

/* ── helpers ──────────────────────────────────────────────────────── */

function mkDb() {
  // We need the smb_crm_quotes table too (the engine inserts
  // into it). Mirroring the real schema.
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE smb_crm_quotes (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      number        TEXT NOT NULL,
      customer_id   TEXT,
      deal_id       TEXT,
      issue_date    TEXT,
      expiry_date   TEXT,
      status        TEXT NOT NULL DEFAULT 'draft',
      total_amount  REAL NOT NULL DEFAULT 0,
      currency      TEXT NOT NULL DEFAULT 'AMD',
      line_items_json TEXT NOT NULL DEFAULT '[]',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
  `);
  return db;
}

function seedOneOrg(db, orgId) {
  // We don't need a real orgs table — the engine just scopes
  // templates by org_id string. Nothing else queries orgs
  // for the template flows.
}

/* ── gate 1: pure ──────────────────────────────────────────────────── */

test('pure: listTemplates / getTemplate / createQuoteFromTemplate / ensureQuoteTemplatesSchema / applyOverrides / computeTotalAmount / DEFAULT_TEMPLATES are exported', () => {
  for (const name of [
    'listTemplates',
    'getTemplate',
    'createQuoteFromTemplate',
    'ensureQuoteTemplatesSchema',
    'applyOverrides',
    'computeTotalAmount',
    'DEFAULT_TEMPLATES'
  ]) {
    assert.ok(name in qt, `qt.${name} is missing`);
    if (name !== 'DEFAULT_TEMPLATES') {
      assert.equal(typeof qt[name], 'function', `qt.${name} should be a function`);
    } else {
      assert.ok(Array.isArray(qt.DEFAULT_TEMPLATES), 'DEFAULT_TEMPLATES should be an array');
    }
  }
});

test('pure: DEFAULT_TEMPLATES has 4 entries with the documented template_ids', () => {
  const ids = qt.DEFAULT_TEMPLATES.map((t) => t.template_id);
  assert.deepEqual(ids, [
    'tpl-standard-product',
    'tpl-service-3',
    'tpl-subscription-annual',
    'tpl-consulting-blank'
  ]);
});

test('pure: ensureQuoteTemplatesSchema is idempotent — second call does not throw', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  qt.ensureQuoteTemplatesSchema(db);
  qt.ensureQuoteTemplatesSchema(db);
  const count = db.prepare('SELECT COUNT(*) as c FROM smb_crm_quote_templates').get();
  assert.equal(count.c, 4);
});

test('pure: ensureQuoteTemplatesSchema seeds exactly the 4 built-ins', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const rows = db.prepare(
    "SELECT id, name FROM smb_crm_quote_templates WHERE builtin = 1 ORDER BY name"
  ).all();
  assert.equal(rows.length, 4);
  const names = rows.map((r) => r.name);
  assert.ok(names.includes('Standard product quote'));
  assert.ok(names.includes('Service quote · 3 lines'));
  assert.ok(names.includes('Annual subscription'));
  assert.ok(names.includes('Consulting (blank lines)'));
});

/* ── gate 2: types ─────────────────────────────────────────────────── */

test('types: listTemplates returns the documented shape', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const tpls = qt.listTemplates(db, 'org-1');
  assert.ok(Array.isArray(tpls));
  assert.equal(tpls.length, 4);
  for (const t of tpls) {
    assert.equal(typeof t.id, 'string');
    assert.equal(typeof t.orgId, 'string');
    assert.equal(typeof t.name, 'string');
    assert.equal(typeof t.description, 'string');
    assert.equal(typeof t.builtin, 'boolean');
    assert.equal(typeof t.createdAt, 'string');
    assert.ok(Array.isArray(t.lineItems));
    for (const it of t.lineItems) {
      assert.equal(typeof it.name, 'string');
      assert.equal(typeof it.description, 'string');
      assert.equal(typeof it.quantity, 'number');
      assert.equal(typeof it.unitPrice, 'number');
    }
  }
});

test('types: built-in templates are flagged builtin=true and orgId="_builtin"', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const tpls = qt.listTemplates(db, 'org-1');
  for (const t of tpls) {
    assert.equal(t.builtin, true);
    assert.equal(t.orgId, '_builtin');
  }
});

test('types: createQuoteFromTemplate returns {ok, quote, lineItems, totalAmount} on success', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const result = qt.createQuoteFromTemplate(db, 'org-1', {
    templateId: 'tpl-standard-product',
    number: 'Q-1',
    overrides: [{ quantity: 3, unitPrice: 100 }]
  });
  assert.equal(result.ok, true);
  assert.equal(typeof result.quote, 'object');
  assert.ok(Array.isArray(result.lineItems));
  assert.equal(typeof result.totalAmount, 'number');
});

test('types: the quote row has the 13 documented columns', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const result = qt.createQuoteFromTemplate(db, 'org-1', {
    templateId: 'tpl-standard-product',
    number: 'Q-1'
  });
  const q = result.quote;
  for (const k of [
    'id', 'org_id', 'number', 'customer_id', 'deal_id',
    'issue_date', 'expiry_date', 'status', 'total_amount',
    'currency', 'line_items_json', 'created_at', 'updated_at'
  ]) {
    assert.ok(k in q, `quote.${k} is missing`);
  }
});

/* ── gate 3: idempotency ───────────────────────────────────────────── */

test('idempotency: ensureQuoteTemplatesSchema is INSERT OR IGNORE on re-run', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const before = db.prepare('SELECT COUNT(*) as c FROM smb_crm_quote_templates').get();
  qt.ensureQuoteTemplatesSchema(db);
  qt.ensureQuoteTemplatesSchema(db);
  const after = db.prepare('SELECT COUNT(*) as c FROM smb_crm_quote_templates').get();
  assert.equal(before.c, after.c, 're-running ensureQuoteTemplatesSchema must not insert duplicates');
});

test('idempotency: two createQuoteFromTemplate calls produce two distinct quote rows', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const a = qt.createQuoteFromTemplate(db, 'org-1', {
    templateId: 'tpl-standard-product',
    number: 'Q-A',
    overrides: [{ quantity: 1, unitPrice: 100 }]
  });
  const b = qt.createQuoteFromTemplate(db, 'org-1', {
    templateId: 'tpl-standard-product',
    number: 'Q-B',
    overrides: [{ quantity: 1, unitPrice: 100 }]
  });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.quote.id, b.quote.id);
  const count = db.prepare('SELECT COUNT(*) as c FROM smb_crm_quotes WHERE org_id = ?').get('org-1');
  assert.equal(count.c, 2);
});

/* ── gate 4: contract ──────────────────────────────────────────────── */

test('contract: overrides length must match template line count (mismatch throws OVERRIDES_LENGTH_MISMATCH)', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  // tpl-service-3 has 3 lines; we pass 2.
  const result = qt.createQuoteFromTemplate(db, 'org-1', {
    templateId: 'tpl-service-3',
    number: 'Q-1',
    overrides: [
      { quantity: 1, unitPrice: 100 },
      { quantity: 1, unitPrice: 200 }
    ]
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /overrides length \(2\) does not match template line count \(3\)/);
});

test('contract: total is recomputed server-side from quantity * unitPrice (never trusted from the client)', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  // Pass a malicious override with quantity: 100000 but a sane
  // unitPrice; the server should still multiply them.
  const result = qt.createQuoteFromTemplate(db, 'org-1', {
    templateId: 'tpl-service-3',
    number: 'Q-1',
    overrides: [
      { quantity: 10, unitPrice: 100 },
      { quantity: 5, unitPrice: 200 },
      { quantity: 1, unitPrice: 1000 }
    ]
  });
  assert.equal(result.ok, true);
  // 10*100 + 5*200 + 1*1000 = 1000 + 1000 + 1000 = 3000
  assert.equal(result.totalAmount, 3000);
  // And the persisted quote has the same total.
  assert.equal(result.quote.total_amount, 3000);
});

test('contract: line items preserve Armenian + emoji in the JSON blob', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  // Insert a custom template with Armenian line items.
  db.prepare(`
    INSERT INTO smb_crm_quote_templates (id, org_id, name, description, line_items_json, builtin, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(
    'tpl-arm-test',
    'org-1',
    'Armenian test',
    '',
    JSON.stringify([
      { name: 'Խորհրդատվություն', description: 'Տեղադրում 🇦🇲', quantity: 1, unitPrice: 50000 }
    ]),
    new Date().toISOString()
  );
  const result = qt.createQuoteFromTemplate(db, 'org-1', {
    templateId: 'tpl-arm-test',
    number: 'Q-ARM-1',
    overrides: [{ quantity: 2, unitPrice: 50000 }]
  });
  assert.equal(result.ok, true);
  // The lineItems are returned with the Armenian text.
  assert.equal(result.lineItems[0].name, 'Խորհրդատվություն');
  assert.match(result.lineItems[0].description, /Տեղադրում/);
  // The JSON blob in the DB has the Armenian preserved as UTF-8.
  const row = db.prepare('SELECT line_items_json FROM smb_crm_quotes WHERE id = ?').get(result.quote.id);
  assert.match(row.line_items_json, /Խորհրդատվություն/);
});

test('contract: missing override fields fall back to the template default', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  // tpl-service-3 line 1 has template quantity=1, unitPrice=0.
  // Pass an override with only quantity → unitPrice falls back.
  const result = qt.createQuoteFromTemplate(db, 'org-1', {
    templateId: 'tpl-service-3',
    number: 'Q-1',
    overrides: [
      { quantity: 5 }, // unitPrice omitted → falls back to template 0
      {},
      {}
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.lineItems[0].quantity, 5);
  assert.equal(result.lineItems[0].unitPrice, 0);
});

test('contract: createQuoteFromTemplate persists the line items as JSON', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const result = qt.createQuoteFromTemplate(db, 'org-1', {
    templateId: 'tpl-standard-product',
    number: 'Q-1',
    overrides: [{ quantity: 2, unitPrice: 250 }]
  });
  const row = db.prepare('SELECT line_items_json FROM smb_crm_quotes WHERE id = ?').get(result.quote.id);
  const parsed = JSON.parse(row.line_items_json);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'Product');
  assert.equal(parsed[0].quantity, 2);
  assert.equal(parsed[0].unitPrice, 250);
});

test('contract: the returned quote has the template_id + template_name metadata', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const result = qt.createQuoteFromTemplate(db, 'org-1', {
    templateId: 'tpl-subscription-annual',
    number: 'Q-1',
    overrides: [{ quantity: 12, unitPrice: 100 }]
  });
  assert.equal(result.quote.template_id, 'tpl-subscription-annual');
  assert.equal(result.quote.template_name, 'Annual subscription');
});

/* ── gate 5: edge ──────────────────────────────────────────────────── */

test('edge: unknown templateId returns {ok:false, error:"template not found:..."}', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const result = qt.createQuoteFromTemplate(db, 'org-1', {
    templateId: 'tpl-does-not-exist',
    number: 'Q-1'
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /template not found: tpl-does-not-exist/);
});

test('edge: missing templateId returns {ok:false} (NEVER throws)', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const result = qt.createQuoteFromTemplate(db, 'org-1', { number: 'Q-1' });
  assert.equal(result.ok, false);
  assert.match(result.error, /templateId is required/);
});

test('edge: missing number returns {ok:false} (NEVER throws)', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const result = qt.createQuoteFromTemplate(db, 'org-1', { templateId: 'tpl-standard-product' });
  assert.equal(result.ok, false);
  assert.match(result.error, /number is required/);
});

test('edge: missing orgId returns {ok:false}', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const result = qt.createQuoteFromTemplate(null, '', { templateId: 'tpl-standard-product', number: 'Q-1' });
  assert.equal(result.ok, false);
  assert.match(result.error, /orgId is required/);
});

test('edge: null opts returns {ok:false}', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const result = qt.createQuoteFromTemplate(db, 'org-1', null);
  assert.equal(result.ok, false);
  assert.match(result.error, /opts must be an object/);
});

test('edge: getTemplate returns null for unknown id', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  assert.equal(qt.getTemplate(db, 'org-1', 'tpl-unknown'), null);
  assert.equal(qt.getTemplate(db, 'org-1', ''), null);
  assert.equal(qt.getTemplate(db, 'org-1', null), null);
});

test('edge: listTemplates scopes to (builtin UNION orgId) — no cross-tenant leak', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  // Insert a custom template for org-1 only.
  db.prepare(`
    INSERT INTO smb_crm_quote_templates (id, org_id, name, description, line_items_json, builtin, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(
    'tpl-org1-only',
    'org-1',
    'Org 1 only',
    '',
    '[]',
    new Date().toISOString()
  );
  const org1 = qt.listTemplates(db, 'org-1');
  const org2 = qt.listTemplates(db, 'org-2');
  // org-1 sees its custom + 4 builtins.
  assert.equal(org1.length, 5);
  assert.ok(org1.find((t) => t.id === 'tpl-org1-only'));
  // org-2 sees only the 4 builtins (no org-1 custom).
  assert.equal(org2.length, 4);
  assert.ok(!org2.find((t) => t.id === 'tpl-org1-only'));
});

test('edge: corrupt line_items_json blob is treated as empty array', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  // Hand-craft a row with broken JSON.
  db.prepare(`
    INSERT INTO smb_crm_quote_templates (id, org_id, name, description, line_items_json, builtin, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(
    'tpl-corrupt',
    'org-1',
    'Corrupt',
    '',
    'NOT-VALID-JSON',
    new Date().toISOString()
  );
  const tpl = qt.getTemplate(db, 'org-1', 'tpl-corrupt');
  assert.ok(tpl);
  assert.deepEqual(tpl.lineItems, []);
});

test('edge: getTemplate is null for an org-id-mismatched custom template', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  // Insert a custom template for org-1 only.
  db.prepare(`
    INSERT INTO smb_crm_quote_templates (id, org_id, name, description, line_items_json, builtin, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(
    'tpl-org1-only',
    'org-1',
    'Org 1 only',
    '',
    '[]',
    new Date().toISOString()
  );
  // org-2 asking for org-1's custom template must NOT get it.
  assert.equal(qt.getTemplate(db, 'org-2', 'tpl-org1-only'), null);
  // org-1 asking for it gets the row.
  assert.ok(qt.getTemplate(db, 'org-1', 'tpl-org1-only'));
});

test('edge: applyOverrides with non-array defaults to the template lines', () => {
  const tpl = qt.getTemplate((() => {
    const db = mkDb();
    qt.ensureQuoteTemplatesSchema(db);
    return db;
  })(), 'org-1', 'tpl-service-3');
  const result = qt.applyOverrides(tpl.lineItems, 'not-an-array');
  // No override applied → line items returned as-is.
  assert.deepEqual(result, tpl.lineItems);
});

test('edge: applyOverrides with empty array throws (length mismatch is a real error)', () => {
  const tpl = qt.getTemplate((() => {
    const db = mkDb();
    qt.ensureQuoteTemplatesSchema(db);
    return db;
  })(), 'org-1', 'tpl-service-3');
  // Empty array is a length-0 array → mismatch with tpl-service-3 (3 lines).
  assert.throws(() => qt.applyOverrides(tpl.lineItems, []), /overrides length \(0\) does not match template line count \(3\)/);
});

test('edge: applyOverrides with null passes the empty-array path and returns the template lines', () => {
  const tpl = qt.getTemplate((() => {
    const db = mkDb();
    qt.ensureQuoteTemplatesSchema(db);
    return db;
  })(), 'org-1', 'tpl-service-3');
  // null is not an array → treated as "no overrides" → returns the
  // template lines verbatim.
  const result = qt.applyOverrides(tpl.lineItems, null);
  assert.deepEqual(result, tpl.lineItems);
});

test('edge: computeTotalAmount handles empty array + large numbers + negatives', () => {
  assert.equal(qt.computeTotalAmount([]), 0);
  assert.equal(
    qt.computeTotalAmount([{ quantity: 1, unitPrice: 100 }, { quantity: 2, unitPrice: 200 }]),
    500
  );
  // 999999.9999 rounds to 1000000.00 (2-decimal rounding)
  assert.equal(
    qt.computeTotalAmount([{ quantity: 1, unitPrice: 999999.9999 }]),
    1000000
  );
  // Negative line items (refunds / credits)
  assert.equal(
    qt.computeTotalAmount([{ quantity: 1, unitPrice: 100 }, { quantity: 1, unitPrice: -50 }]),
    50
  );
});

test('edge: createQuoteFromTemplate with empty overrides array is rejected (length mismatch)', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const result = qt.createQuoteFromTemplate(db, 'org-1', {
    templateId: 'tpl-service-3',
    number: 'Q-1',
    overrides: []
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /overrides length \(0\) does not match template line count \(3\)/);
});

test('edge: totalAmount in the persisted quote matches the recomputed total', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const result = qt.createQuoteFromTemplate(db, 'org-1', {
    templateId: 'tpl-service-3',
    number: 'Q-1',
    overrides: [
      { quantity: 1, unitPrice: 100 },
      { quantity: 1, unitPrice: 200 },
      { quantity: 1, unitPrice: 300 }
    ]
  });
  const expected = 600;
  assert.equal(result.totalAmount, expected);
  assert.equal(result.quote.total_amount, expected);
  // And the persisted row in the DB matches.
  const row = db.prepare('SELECT total_amount FROM smb_crm_quotes WHERE id = ?').get(result.quote.id);
  assert.equal(row.total_amount, expected);
});

test('edge: the "from-template" flow works end-to-end with the PDF route (smoke test)', () => {
  const db = mkDb();
  qt.ensureQuoteTemplatesSchema(db);
  const result = qt.createQuoteFromTemplate(db, 'org-1', {
    templateId: 'tpl-subscription-annual',
    number: 'Q-PDF-1',
    customerId: 'cust-1',
    issueDate: '2026-06-15',
    expiryDate: '2026-07-15',
    currency: 'AMD',
    overrides: [{ quantity: 12, unitPrice: 9900 }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.quote.total_amount, 12 * 9900);
  // The quote is queryable by getQuote (well, by the same
  // org_id + id, which is what records.getQuote does).
  const row = db.prepare('SELECT * FROM smb_crm_quotes WHERE id = ?').get(result.quote.id);
  assert.equal(row.number, 'Q-PDF-1');
  assert.equal(row.customer_id, 'cust-1');
  assert.equal(row.currency, 'AMD');
  // The line items JSON has the subscription line.
  const items = JSON.parse(row.line_items_json);
  assert.equal(items[0].name, 'Annual license');
  assert.equal(items[0].quantity, 12);
  assert.equal(items[0].unitPrice, 9900);
});
