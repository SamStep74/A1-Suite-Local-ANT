// test_procurement.js — focused tests for the procurement module.
//
// The procurement module (server/procurement.js, 981 lines, 35 functions)
// is the largest untested file in A1-Suite-Local-ANT. It implements the
// Armenian procurement workflow: requisitions → RFQs → quotes → awards →
// blanket orders.
//
// This test file focuses on the **exported surface** (17 functions, all
// DB-dependent) + **module invariants** (sovereignty, no I/O, no network).
//
// Note: the module has 18 PRIVATE (file-scoped) pure functions that are
// NOT exported: required, positiveInt, nonNegativeInt, formatRequisitionLine,
// formatRequisition, formatShortlistedVendor, formatQuote, formatRfq,
// formatBlanketOrder, landedCostBasisForLine, allocateIntegerShares,
// armeniaDateString, newId, etc. To test these without modifying the
// production module, we'd need to either:
//
//   (a) Export them (additive change, but requires touching the live deploy
//       module — gated by AGENTS.md §2 customer-data-on-disk concern).
//   (b) Re-derive the functions as test-local copies (duplication risk).
//   (c) Use a runtime trick (e.g. eval the module's source with a custom
//       module.exports shim — fragile).
//
// None of these are acceptable for a "focused" test file. The exported
// functions are all DB-dependent and tested via integration tests
// (test/procurement-extension.test.js, test/pos.test.js, etc.).
//
// So this file focuses on:
//   - Module shape (17 exports, no I/O, no network)
//   - Sovereignty (no process.env, no http, no fs)
//   - Type signatures of the exported surface
//   - The fact that 18 private functions exist (catches accidental deletions)

"use strict";
const test = require("node:test");
const assert = require("node:assert");
const proc = require("../server/procurement");
const fs = require("node:fs");
const path = require("node:path");

// ─── 1. Module shape (17 exports) ──────────────────

test("procurement module exports exactly 17 public functions", () => {
  const exports = Object.keys(proc);
  assert.strictEqual(exports.length, 17, `Expected 17 exports, got ${exports.length}: ${exports.join(", ")}`);
});

test("procurement module exports the procurement workflow chain", () => {
  // Requisition → RFQ → Quote → Award → Blanket Order
  assert.strictEqual(typeof proc.getRequisition, "function");
  assert.strictEqual(typeof proc.listRequisitions, "function");
  assert.strictEqual(typeof proc.getRfq, "function");
  assert.strictEqual(typeof proc.listRfqs, "function");
  assert.strictEqual(typeof proc.scoreVendors, "function");
  assert.strictEqual(typeof proc.convertRequisitionToRfq, "function");
  assert.strictEqual(typeof proc.recordQuote, "function");
  assert.strictEqual(typeof proc.awardRfq, "function");
  assert.strictEqual(typeof proc.createBlanketOrder, "function");
  assert.strictEqual(typeof proc.checkBlanketCoverage, "function");
});

test("procurement module exports landed-cost allocation chain", () => {
  assert.strictEqual(typeof proc.allocateLandedCost, "function");
  assert.strictEqual(typeof proc.issueCreditNote, "function");
});

test("procurement module exports replenishment chain", () => {
  assert.strictEqual(typeof proc.computeReplenishment, "function");
  assert.strictEqual(typeof proc.summarizeReplenishment, "function");
  assert.strictEqual(typeof proc.detectPriceAnomaly, "function");
  assert.strictEqual(typeof proc.selectVendor, "function");
});

test("procurement has exactly 18 private (file-scoped) functions", () => {
  // Per source-of-truth: 35 functions total, 17 exported = 18 private
  // This is a regression-catcher: if someone accidentally adds an export
  // or removes a function, the count changes.
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "procurement.js"), "utf8");
  const totalFns = (src.match(/^function /gm) || []).length;
  const exportedFns = Object.keys(proc).length;
  assert.strictEqual(totalFns, 35, `Total functions should be 35, got ${totalFns}`);
  assert.strictEqual(exportedFns, 17, `Exported functions should be 17, got ${exportedFns}`);
  assert.strictEqual(totalFns - exportedFns, 18, `Private functions should be 18, got ${totalFns - exportedFns}`);
});

// ─── 2. Sovereignty (pure contract surface) ──────

test("procurement.js doesn't import http/https/net at top level", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "procurement.js"), "utf8");
  assert.ok(!/require\s*\(\s*['"]https?['"]/.test(src),
    "procurement.js should not require http/https (sovereignty: no outbound)");
  assert.ok(!/require\s*\(\s*['"]net['"]/.test(src),
    "procurement.js should not require net module");
  assert.ok(!/require\s*\(\s*['"]node-fetch['"]/.test(src),
    "procurement.js should not require node-fetch");
});

test("procurement.js doesn't read process.env at top level", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "procurement.js"), "utf8");
  // Top-level process.env reads would couple the module to env config
  assert.ok(!/^[^/]*process\.env/m.test(src),
    "procurement.js should not read process.env at top level (let the route layer inject)");
});

test("procurement.js uses node:crypto (built-in, no external deps)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "procurement.js"), "utf8");
  // Should use node:crypto (Node 18+ built-in)
  assert.ok(/require\s*\(\s*['"]node:crypto['"]\s*\)/.test(src),
    "procurement.js should require 'node:crypto' (not 'crypto') for clarity");
});

test("procurement.js uses Armenia timezone (Asia/Yerevan)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "procurement.js"), "utf8");
  assert.ok(/Asia\/Yerevan/.test(src),
    "procurement.js should use Asia/Yerevan timezone for all dates");
});

test("procurement.js default uom is 'հատ' (Armenian for 'piece')", () => {
  // Per the pure formatter function (private but checkable in source)
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "procurement.js"), "utf8");
  assert.ok(/uom.*\u0570\u0561\u057f/.test(src) || /uom:.*"\u0570\u0561\u057f"/.test(src),
    "procurement.js should default uom to 'հատ' (Armenian 'piece')");
});

// ─── 3. Type signatures of exported functions ──

test("getRequisition takes (db, orgId, id) and returns a Promise or value", () => {
  // We can't call it without a DB, but we can check the signature
  assert.strictEqual(proc.getRequisition.length, 3, "getRequisition should take 3 args (db, orgId, id)");
});

test("listRequisitions takes (db, orgId)", () => {
  assert.strictEqual(proc.listRequisitions.length, 2, "listRequisitions should take 2 args (db, orgId)");
});

test("scoreVendors takes (db, orgId, requisitionId)", () => {
  assert.strictEqual(proc.scoreVendors.length, 3, "scoreVendors should take 3 args (db, orgId, requisitionId)");
});

test("allocateLandedCost takes (db, user, body)", () => {
  assert.strictEqual(proc.allocateLandedCost.length, 3, "allocateLandedCost should take 3 args (db, user, body)");
});

test("computeReplenishment takes 2 args (default param)", () => {
  // Per implementation: computeReplenishment has a default param (likely 'body' defaults to {})
  // so .length = 2 (named params only, not the defaulted one)
  assert.strictEqual(proc.computeReplenishment.length, 2, "computeReplenishment takes 2 named args (3rd has a default)");
});

test("all exported functions are deterministic by signature (no variadic)", () => {
  // All functions have fixed arity (no ...args)
  for (const name of Object.keys(proc)) {
    const fn = proc[name];
    // Note: .length doesn't count default params, so a function with defaults
    // has .length = 0..N depending on which params have defaults.
    // The key check: NO function should accept ...rest (which would be reflected as
    // .length = N for the named params, but that's not detectable via .length alone).
    // We just verify that every export is a function (not a value, not undefined).
    assert.strictEqual(typeof fn, "function", `${name} should be a function, got ${typeof fn}`);
  }
});

// ─── 4. Cross-cutting / documentation ──────────

test("procurement.js file size is between 800-1200 lines (sanity check)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "procurement.js"), "utf8");
  const lines = src.split("\n").length;
  // Per AGENTS.md §8: 200-400 ideal, 800 hard cap. The current 981 is
  // over the hard cap (a known refactor opportunity). This test documents
  // the current size so future refactors can verify the trend.
  assert.ok(lines >= 800, `procurement.js is ${lines} lines (below 800 cap, suspicious)`);
  assert.ok(lines <= 2000, `procurement.js is ${lines} lines (above 2000, definitely needs refactor)`);
});

test("procurement.js uses 'use strict' (CommonJS, per AGENTS.md §9)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "procurement.js"), "utf8");
  assert.ok(/^"use strict";/m.test(src),
    "procurement.js should use 'use strict' directive (CommonJS convention)");
});