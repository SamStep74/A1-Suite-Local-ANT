/**
 * product-importers/json — generic JSON file reader.
 *
 * Reads one or more JSON files and returns them as parsed objects
 * indexed by path. Used by importers that take JSON inputs
 * (the SMB-CRM blueprint + records importer).
 *
 * Public surface:
 *   readJsonFile(filePath) — single file → object
 *   readJsonFiles([paths]) — multiple files → { [path]: object }
 */
'use strict';

const fsp = require('node:fs/promises');

async function readJsonFile(filePath) {
  const content = await fsp.readFile(String(filePath), 'utf8');
  return JSON.parse(content);
}

async function readJsonFiles(paths) {
  const out = {};
  for (const p of paths) {
    out[String(p)] = await readJsonFile(p);
  }
  return out;
}

module.exports = { readJsonFile, readJsonFiles };
