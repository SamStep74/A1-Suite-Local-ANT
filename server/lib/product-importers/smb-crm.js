/**
 * product-importers/smb-crm — ANT port of A1-Platform's
 * `importCrmJson`. Imports a tenant's SMB-CRM blueprint + records
 * from two JSON files into ANT's `smb_crm_blueprints` table.
 *
 * Source mapping:
 *   A1-Platform `crm.tenant_blueprints`  → ANT `smb_crm_blueprints`
 *     (the table already has a `doc TEXT NOT NULL` column that
 *     stores the full blueprint JSON)
 *   A1-Platform `crm.records`            → ANT `smb_crm_blueprints`
 *     (separate row, distinguished by `industry = 'imported-records'`)
 *
 * The records JSON in the source is a free-form object
 * (customers, deals, etc.). ANT's smb_crm_blueprints.doc is a
 * free-form JSON blob too, so the port is shape-preserving. The
 * caller can later run a normalization pass to expand the records
 * doc into per-table rows.
 *
 * Public surface:
 *   importSmbCrmJson(options) — see A1-Platform importCrmJson
 *     for the contract. Returns { product, slug, blueprintKeys,
 *     recordKeys, blueprintId, recordsId }
 */
'use strict';

const crypto = require('node:crypto');

const { readJsonFile } = require('./json');

const BLUEPRINT_INDUSTRY = 'imported-blueprint';
const RECORDS_INDUSTRY = 'imported-records';

function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

async function importSmbCrmJson(options) {
  if (!options || !options.db) throw new Error('importSmbCrmJson requires db');
  if (!options.slug) throw new Error('importSmbCrmJson requires slug');
  if (!options.org_id && !options.orgId) {
    throw new Error('importSmbCrmJson requires org_id');
  }
  const orgId = options.org_id || options.orgId;
  const slug = String(options.slug);

  const blueprint = options.blueprint || (options.blueprintPath ? await readJsonFile(options.blueprintPath) : null);
  const records = options.records || (options.recordsPath ? await readJsonFile(options.recordsPath) : null);
  if (!blueprint && !records) {
    throw new Error('importSmbCrmJson requires blueprint or records (file path or inline)');
  }

  // The smb_crm_blueprints table requires (id, org_id, industry,
  // company_name, doc, created_at, updated_at). We default
  // company_name from the slug when the JSON doesn't carry it.
  const now = new Date().toISOString();
  let blueprintId = null;
  let recordsId = null;

  // node:sqlite needs table existence check before INSERT (some
  // test schemas may not have it).
  const hasBlueprints = options.db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = 'smb_crm_blueprints'`)
    .get();

  if (!hasBlueprints) {
    return {
      product: 'smb-crm',
      slug,
      skipped: 'smb_crm_blueprints table not present in target DB',
      blueprintKeys: blueprint ? Object.keys(blueprint).length : 0,
      recordKeys: records ? Object.keys(records).length : 0
    };
  }

  if (blueprint) {
    blueprintId = newId('bp');
    options.db
      .prepare(
        `INSERT OR REPLACE INTO smb_crm_blueprints
           (id, org_id, industry, company_name, language, subdomain, doc, source_provider, source_evidence_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        blueprintId,
        orgId,
        BLUEPRINT_INDUSTRY,
        String(blueprint.company_name || blueprint.companyName || slug),
        String(blueprint.language || blueprint.locale || 'en'),
        blueprint.subdomain || null,
        JSON.stringify(blueprint),
        'import',
        blueprint.evidence ? JSON.stringify(blueprint.evidence) : null,
        now,
        now
      );
  }

  if (records) {
    recordsId = newId('rec');
    options.db
      .prepare(
        `INSERT OR REPLACE INTO smb_crm_blueprints
           (id, org_id, industry, company_name, language, subdomain, doc, source_provider, source_evidence_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        recordsId,
        orgId,
        RECORDS_INDUSTRY,
        String(records.company_name || records.companyName || slug),
        String(records.language || records.locale || 'en'),
        records.subdomain || null,
        JSON.stringify(records),
        'import',
        records.evidence ? JSON.stringify(records.evidence) : null,
        now,
        now
      );
  }

  return {
    product: 'smb-crm',
    slug,
    blueprintId,
    recordsId,
    blueprintKeys: blueprint ? Object.keys(blueprint).length : 0,
    recordKeys: records ? Object.keys(records).length : 0
  };
}

module.exports = { importSmbCrmJson, BLUEPRINT_INDUSTRY, RECORDS_INDUSTRY };
