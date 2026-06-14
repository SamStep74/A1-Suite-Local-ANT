/**
 * config-vault — Pattern A port of
 * A1-SMB-CRM-HY-MAX/src/modules/integrations/config-vault.ts
 * (137 lines). Wraps the low-level vault with the per-tenant,
 * per-provider AAD context so callers don't have to remember the
 * AAD format.
 *
 * AAD format (preserved from source): `tenant:<id>|provider:<id>`
 *
 * Two modes:
 *   - Default (strict: false): plaintext legacy values pass through.
 *     Backward compat with rows written before the vault landed.
 *   - Strict (strict: true): throws on plaintext in any known
 *     secret field. Use for new code paths that should never
 *     see plaintext.
 *
 * Public surface:
 *   createConfigVault({ vault, defaults? }) → {
 *     sealConfigSecrets(tenantId, provider, config, opts?)
 *     openConfigSecrets(tenantId, provider, config, opts?)
 *     aadFor(tenantId, provider)
 *     defaultEncryptedFields
 *   }
 *
 * Pure helpers:
 *   aadFor(tenantId, provider)
 *   DEFAULT_ENCRYPTED_FIELDS (re-exported from vault)
 */
'use strict';

const { DEFAULT_ENCRYPTED_FIELDS } = require('../vault');

class VaultStrictError extends Error {
  constructor(message) {
    super(`[VAULT_STRICT] ${message}`);
    this.name = 'VaultStrictError';
  }
}

function aadFor(tenantId, provider) {
  return `tenant:${tenantId}|provider:${provider}`;
}

function createConfigVault(options = {}) {
  if (!options.vault) throw new Error('createConfigVault requires { vault }');
  const vault = options.vault;
  const defaults = options.defaults || DEFAULT_ENCRYPTED_FIELDS;
  const isVaultPacked = vault.isVaultPacked;

  function sealConfigSecrets(tenantId, provider, config, opts = {}) {
    const fields = opts.fields || defaults;
    if (opts.strict) {
      for (const f of fields) {
        const v = config[f];
        if (typeof v === 'string' && v.length > 0 && !isVaultPacked(v)) {
          throw new VaultStrictError(
            `Refusing to write plaintext secret in field "${f}" for ${tenantId}/${provider}. ` +
              `Pass through openConfigSecrets → sealConfigSecrets on the re-vault endpoint, or use the non-strict path.`
          );
        }
      }
    }
    return vault.encryptConfigSecrets(config, fields, { aad: aadFor(tenantId, provider) });
  }

  function openConfigSecrets(tenantId, provider, config, opts) {
    // Back-compat: openConfigSecrets(t, p, cfg, fieldsArray) is
    // still supported by callers written before the OpenOpts shape.
    let fields = defaults;
    let strict = false;
    if (Array.isArray(opts)) {
      fields = opts;
    } else if (opts && typeof opts === 'object') {
      fields = opts.fields || defaults;
      strict = opts.strict === true;
    }
    if (strict) {
      for (const f of fields) {
        const v = config[f];
        if (typeof v === 'string' && v.length > 0 && !isVaultPacked(v)) {
          throw new VaultStrictError(
            `Refusing to use plaintext secret in field "${f}" for ${tenantId}/${provider}. ` +
              `Run it through sealConfigSecrets first, or use the non-strict read path until re-vault.`
          );
        }
      }
    }
    return vault.decryptConfigSecrets(config, fields, { aad: aadFor(tenantId, provider) });
  }

  return {
    sealConfigSecrets,
    openConfigSecrets,
    aadFor,
    defaultEncryptedFields: defaults,
    VaultStrictError
  };
}

module.exports = {
  createConfigVault,
  aadFor,
  VaultStrictError,
  DEFAULT_ENCRYPTED_FIELDS
};
