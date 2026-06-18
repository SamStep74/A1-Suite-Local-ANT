/**
 * quote-templates — Pure CJS engine for the SMB-CRM quote
 * template library.
 *
 * Armenian SMBs reuse a small library of quote templates
 * (Standard product quote, Service quote, Subscription
 * quote, etc.) where the line items are pre-named and the
 * SMB just fills in quantity + unit price. Templates are
 * stored in a SQLite table (smb_crm_quote_templates), seeded
 * on db init with 4 built-ins + open-ended custom ones.
 *
 * The engine has 3 public surfaces:
 *   - listTemplates(db, orgId) → rows
 *   - getTemplate(db, orgId, id) → row or null
 *   - createQuoteFromTemplate(db, orgId, opts) → { ok, quote, error }
 *
 * `opts`:
 *   { templateId, customerId, dealId?, number, issueDate?,
 *     expiryDate?, currency?, status?, overrides? }
 *
 * `overrides` is an OPTIONAL array of the same length as the
 * template's line items, applied positionally. Each override
 * is { quantity?, unitPrice? } — name/description/total come
 * from the template; missing override fields fall back to the
 * template's defaults.
 *
 * Total amount is recomputed server-side from qty * unitPrice;
 * the override.total field is ignored. This is the "trust the
 * source over vibes" rule — the engine never trusts a client
 * total.
 *
 * Pure: no HTTP, no fetch, no module-level state. DB is the
 * only dependency, injected.
 */
'use strict';

const { randomId } = (() => {
  // The records layer uses its own randomId("quote-..."). We
  // import a tiny generator here to avoid coupling to the
  // records module. The pattern matches smbCrmRecords.js.
  const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
  function make(prefix) {
    let s = prefix;
    for (let i = 0; i < 12; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
  }
  return { randomId: make };
})();

const DEFAULT_TEMPLATES = [
  {
    template_id: 'tpl-standard-product',
    name: 'Standard product quote',
    description: 'Product name + 1 line of description. Single quantity.',
    line_items: [
      { name: 'Product', description: 'Catalog item', quantity: 1, unit_price: 0 }
    ]
  },
  {
    template_id: 'tpl-service-3',
    name: 'Service quote · 3 lines',
    description: '3 service lines: setup + monthly + one-time.',
    line_items: [
      { name: 'Setup', description: 'Onboarding and configuration', quantity: 1, unit_price: 0 },
      { name: 'Monthly service', description: 'Recurring monthly fee', quantity: 1, unit_price: 0 },
      { name: 'Training', description: 'One-time staff training', quantity: 1, unit_price: 0 }
    ]
  },
  {
    template_id: 'tpl-subscription-annual',
    name: 'Annual subscription',
    description: 'Single line: annual license + 1 month free.',
    line_items: [
      { name: 'Annual license', description: '12 months (1 month free)', quantity: 12, unit_price: 0 }
    ]
  },
  {
    template_id: 'tpl-consulting-blank',
    name: 'Consulting (blank lines)',
    description: '5 blank consulting lines. The SMB fills in qty + price.',
    line_items: [
      { name: 'Consulting 1', description: '', quantity: 1, unit_price: 0 },
      { name: 'Consulting 2', description: '', quantity: 1, unit_price: 0 },
      { name: 'Consulting 3', description: '', quantity: 1, unit_price: 0 },
      { name: 'Consulting 4', description: '', quantity: 1, unit_price: 0 },
      { name: 'Consulting 5', description: '', quantity: 1, unit_price: 0 }
    ]
  }
];

/**
 * @typedef {Object} QuoteTemplateLineItem
 * @property {string} name
 * @property {string} [description]
 * @property {number} quantity
 * @property {number} unitPrice
 */

/**
 * @typedef {Object} QuoteTemplate
 * @property {string} id          org-scoped primary key (e.g. "tpl-standard-product")
 * @property {string} orgId
 * @property {string} name
 * @property {string} [description]
 * @property {QuoteTemplateLineItem[]} lineItems
 * @property {boolean} builtin    true for the 4 seeded templates
 * @property {string} createdAt
 */

/**
 * Ensure the smb_crm_quote_templates table exists + the 4
 * built-in templates are seeded. Idempotent: re-runs are
 * safe. MUST be called from the initSchema path.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
function ensureQuoteTemplatesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS smb_crm_quote_templates (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL DEFAULT '_builtin',
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      line_items_json TEXT NOT NULL DEFAULT '[]',
      builtin       INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_smb_crm_quote_templates_org
      ON smb_crm_quote_templates(org_id, builtin DESC, name);
  `);
  // Seed the 4 built-ins. org_id = '_builtin' is a sentinel
  // meaning "available to every org". The listTemplates query
  // unions _builtin rows with the org's custom rows.
  const now = new Date().toISOString();
  const seed = db.prepare(`
    INSERT OR IGNORE INTO smb_crm_quote_templates
      (id, org_id, name, description, line_items_json, builtin, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `);
  for (const t of DEFAULT_TEMPLATES) {
    seed.run(
      t.template_id,
      '_builtin',
      t.name,
      t.description || '',
      JSON.stringify(t.line_items),
      now
    );
  }
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} orgId
 * @returns {QuoteTemplate[]}
 */
function listTemplates(db, orgId) {
  if (!orgId) throw new Error('orgId is required');
  const rows = db.prepare(`
    SELECT id, org_id, name, description, line_items_json, builtin, created_at
      FROM smb_crm_quote_templates
     WHERE org_id = '_builtin' OR org_id = ?
     ORDER BY builtin DESC, name
  `).all(orgId);
  return rows.map(rowToTemplate);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} orgId
 * @param {string} templateId
 * @returns {QuoteTemplate | null}
 */
function getTemplate(db, orgId, templateId) {
  if (!orgId || !templateId) return null;
  const row = db.prepare(`
    SELECT id, org_id, name, description, line_items_json, builtin, created_at
      FROM smb_crm_quote_templates
     WHERE id = ? AND (org_id = '_builtin' OR org_id = ?)
  `).get(templateId, orgId);
  return row ? rowToTemplate(row) : null;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {QuoteTemplate}
 */
function rowToTemplate(row) {
  let lineItems = [];
  try {
    lineItems = JSON.parse(row.line_items_json);
    if (!Array.isArray(lineItems)) lineItems = [];
  } catch (_) {
    lineItems = [];
  }
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description || '',
    lineItems: lineItems.map((it) => ({
      name: (it && it.name) || '',
      description: (it && it.description) || '',
      quantity: Number(it && it.quantity) || 0,
      unitPrice: Number(it && it.unitPrice) || 0
    })),
    builtin: row.builtin === 1,
    createdAt: row.created_at
  };
}

/**
 * Normalise the override list. An override may be a partial
 * object {quantity?, unitPrice?}. Missing fields fall back to
 * the template's defaults. The override array MUST be the
 * same length as the template's line items — anything else
 * is rejected.
 *
 * @param {QuoteTemplateLineItem[]} templateLines
 * @param {unknown} overrides
 * @returns {QuoteTemplateLineItem[]}
 */
function applyOverrides(templateLines, overrides) {
  if (!Array.isArray(overrides)) return templateLines.slice();
  if (overrides.length !== templateLines.length) {
    const err = new Error(`overrides length (${overrides.length}) does not match template line count (${templateLines.length})`);
    err.code = 'OVERRIDES_LENGTH_MISMATCH';
    throw err;
  }
  return templateLines.map((base, idx) => {
    const ov = overrides[idx] || {};
    const quantity = Number(ov.quantity) || base.quantity;
    const unitPrice = Number(ov.unitPrice) || base.unitPrice;
    return {
      name: base.name,
      description: base.description,
      quantity,
      unitPrice
    };
  });
}

/**
 * @param {QuoteTemplateLineItem[]} lineItems
 * @returns {number}  total amount, rounded to 2 decimals
 */
function computeTotalAmount(lineItems) {
  let total = 0;
  for (const it of lineItems) {
    const qty = Number(it.quantity) || 0;
    const price = Number(it.unitPrice) || 0;
    total += qty * price;
  }
  return Math.round(total * 100) / 100;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} orgId
 * @param {{
 *   templateId: string,
 *   number: string,
 *   customerId?: string,
 *   dealId?: string,
 *   issueDate?: string,
 *   expiryDate?: string,
 *   currency?: string,
 *   status?: string,
 *   overrides?: Array<{ quantity?: number, unitPrice?: number }>,
 * }} opts
 * @returns {{ ok: boolean, quote?: unknown, lineItems?: QuoteTemplateLineItem[], totalAmount?: number, error?: string }}
 */
function createQuoteFromTemplate(db, orgId, opts) {
  if (!orgId) return { ok: false, error: 'orgId is required' };
  if (!opts || typeof opts !== 'object') return { ok: false, error: 'opts must be an object' };
  if (!opts.templateId) return { ok: false, error: 'templateId is required' };
  if (!opts.number) return { ok: false, error: 'number is required' };

  const tpl = getTemplate(db, orgId, opts.templateId);
  if (!tpl) return { ok: false, error: `template not found: ${opts.templateId}` };

  let lineItems;
  try {
    lineItems = applyOverrides(tpl.lineItems, opts.overrides);
  } catch (err) {
    return { ok: false, error: err.message || 'overrides error' };
  }
  const totalAmount = computeTotalAmount(lineItems);
  const now = new Date().toISOString();
  const id = randomId('quote-');
  const currency = opts.currency || 'AMD';
  const status = opts.status || 'draft';

  db.prepare(`
    INSERT INTO smb_crm_quotes
      (id, org_id, number, customer_id, deal_id, issue_date, expiry_date,
       status, total_amount, currency, line_items_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    orgId,
    String(opts.number),
    opts.customerId ? String(opts.customerId) : null,
    opts.dealId ? String(opts.dealId) : null,
    opts.issueDate || null,
    opts.expiryDate || null,
    status,
    totalAmount,
    currency,
    JSON.stringify(lineItems),
    now,
    now
  );

  return {
    ok: true,
    quote: {
      id,
      org_id: orgId,
      number: String(opts.number),
      customer_id: opts.customerId || null,
      deal_id: opts.dealId || null,
      issue_date: opts.issueDate || null,
      expiry_date: opts.expiryDate || null,
      status,
      total_amount: totalAmount,
      currency,
      line_items_json: JSON.stringify(lineItems),
      created_at: now,
      updated_at: now,
      template_id: tpl.id,
      template_name: tpl.name
    },
    lineItems,
    totalAmount
  };
}

/**
 * Save a line-item set as a NEW org-scoped custom template.
 * Mirrors `createQuoteFromTemplate`'s "trust the source" rule:
 * the line items are validated + normalised server-side; the
 * template id is generated (not trusted from the client) and
 * scoped to the calling org.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} orgId
 * @param {{
 *   name: string,
 *   description?: string,
 *   lineItems: Array<{ name: string, description?: string, quantity: number, unitPrice: number }>,
 *   sourceTemplateId?: string  // optional metadata, NOT used to copy
 * }} input
 * @returns {{ ok: boolean, template?: QuoteTemplate, error?: string }}
 */
function saveAsTemplate(db, orgId, input) {
  if (!orgId) return { ok: false, error: 'orgId is required' };
  if (!input || typeof input !== 'object') return { ok: false, error: 'input must be an object' };
  if (typeof input.name !== 'string') return { ok: false, error: 'name is required' };
  const name = input.name.trim();
  if (name.length < 1 || name.length > 100) {
    return { ok: false, error: 'name must be 1-100 characters' };
  }
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 500) : '';
  if (!Array.isArray(input.lineItems) || input.lineItems.length < 1) {
    return { ok: false, error: 'lineItems must be a non-empty array' };
  }
  if (input.lineItems.length > 50) {
    return { ok: false, error: 'lineItems must have at most 50 entries' };
  }
  // Normalise + validate each line item. The engine mirrors
  // `applyOverrides`'s "missing field = 0" semantics.
  const lineItems = [];
  for (let i = 0; i < input.lineItems.length; i++) {
    const raw = input.lineItems[i];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: `lineItems[${i}] must be an object` };
    }
    const ln = String((raw && raw.name) || '').trim();
    if (ln.length < 1 || ln.length > 200) {
      return { ok: false, error: `lineItems[${i}].name must be 1-200 characters` };
    }
    const desc = typeof raw.description === 'string' ? raw.description.trim().slice(0, 500) : '';
    const quantity = Number(raw.quantity);
    const unitPrice = Number(raw.unitPrice);
    if (!Number.isFinite(quantity) || quantity < 0 || quantity > 1_000_000) {
      return { ok: false, error: `lineItems[${i}].quantity must be a finite number in [0, 1_000_000]` };
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000_000) {
      return { ok: false, error: `lineItems[${i}].unitPrice must be a finite number in [0, 1_000_000_000]` };
    }
    lineItems.push({ name: ln, description: desc, quantity, unitPrice });
  }

  // Generate a custom template id. Use the "tpl-custom-" prefix
  // so listTemplates's ORDER BY puts built-ins first by name
  // (alphabetical: "tpl-consulting-blank" < "tpl-custom-...").
  const id = `tpl-custom-${randomId('').replace(/^tpl-/, '')}`;
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO smb_crm_quote_templates
        (id, org_id, name, description, line_items_json, builtin, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).run(id, orgId, name, description, JSON.stringify(lineItems), now);
  } catch (err) {
    // Uniqueness collision: retry once with a new id. The
    // probability is astronomically low (12-char suffix over
    // 36^12 = 4.7e18 space) but we handle it cleanly.
    if (err && /UNIQUE/i.test(err.message)) {
      const retryId = `tpl-custom-${randomId('').replace(/^tpl-/, '')}`;
      db.prepare(`
        INSERT INTO smb_crm_quote_templates
          (id, org_id, name, description, line_items_json, builtin, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run(retryId, orgId, name, description, JSON.stringify(lineItems), now);
      return getTemplate(db, orgId, retryId)
        ? { ok: true, template: getTemplate(db, orgId, retryId) }
        : { ok: false, error: 'failed to save template' };
    }
    return { ok: false, error: (err && err.message) || 'db insert failed' };
  }
  return getTemplate(db, orgId, id)
    ? { ok: true, template: getTemplate(db, orgId, id) }
    : { ok: false, error: 'saved but template not found' };
}

module.exports = {
  ensureQuoteTemplatesSchema,
  listTemplates,
  getTemplate,
  createQuoteFromTemplate,
  saveAsTemplate,
  // exported for tests
  applyOverrides,
  computeTotalAmount,
  DEFAULT_TEMPLATES
};
