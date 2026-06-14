/**
 * product-importers/index.js — barrel.
 * Mirrors A1-Platform/src/product-importers/index.js.
 */
'use strict';

module.exports = {
  ...require('./smb-crm'),
  ...require('./hayhashvapah'),
  ...require('./studio'),
  ...require('./sqlite'),
  ...require('./json'),
  ...require('./csv')
};
