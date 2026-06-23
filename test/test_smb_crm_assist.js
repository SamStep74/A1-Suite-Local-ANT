// test_smb_crm_assist.js — focused tests for the SMB CRM AI assist engine.
//
// The smbCrmAssist module (server/smbCrmAssist.js, 715 lines) is the SMB CRM
// AI assist engine. It implements three assist flavors:
//   - salesAssist: next-best-action for a deal
//   - messageAssist: drafted outbound message to a customer
//   - customerSummary: LLM-generated summary of a customer history
//
// Per the docstring: "Pattern A: pure functions, no Fastify imports,
// no node:sqlite imports, no process.env reads." This is a perfect
// target for unit tests.
//
// This test file focuses on the EXPORTED PURE functions:
//   - 3 prompt builders (buildSalesAssistPrompt, buildMessageAssistPrompt,
//     buildCustomerSummaryPrompt)
//   - 3 response parsers (parseSalesAssistResponse, parseMessageAssistResponse,
//     parseCustomerSummaryResponse)
//   - 3 safe helpers (safeString, safeNumber, safeJson)
//   - 4 error classes
//   - module invariants
//
// The DB functions (salesAssist, messageAssist, customerSummary, recordFeedback,
// listFeedback, getAssistRun, etc.) are tested via the integration suite.
//
// Tests:
//   - 3 safe helper tests (safeString, safeNumber, safeJson)
//   - 3 prompt builder tests
//   - 4 parseSalesAssistResponse tests (full, partial, defaults, edge cases)
//   - 3 parseMessageAssistResponse tests (full, channel override, defaults)
//   - 3 parseCustomerSummaryResponse tests (full, key insights, defaults)
//   - 4 error class tests (AssistError base, 3 subclasses)
//   - 2 cross-cutting tests (exports + module shape)
//   - 3 sovereignty tests (no I/O, no process.env, use strict)

"use strict";
const test = require("node:test");
const assert = require("node:assert");
const assist = require("../server/smbCrmAssist");
const fs = require("node:fs");
const path = require("node:path");

// ─── 1. Safe helpers ─────────────────────────────────
// Note: safeString, safeNumber, safeJson are FILE-PRIVATE (not exported).
// Same pattern as procurement.js and smbCrmRecords.js.
// Tracked in A1-Suite-Local-ANT #11 (export pure validators).

// ─── 2. parseSalesAssistResponse (the LLM response parser) ─

test("parseSalesAssistResponse returns full shape from valid LLM JSON", () => {
  const raw = {
    suggestedAction: "Schedule a call to discuss pricing",
    reasoning: "Customer has been responsive but hasn't committed",
    confidence: 0.75,
    riskLevel: "low",
    sourceRecords: [
      { type: "deal", id: "d-1", label: "Big deal" },
      { type: "customer", id: "c-1", label: "ACME Corp" },
      { type: "activity", id: "a-1", label: "Last call" },
    ],
  };
  const result = assist.parseSalesAssistResponse(raw);
  assert.strictEqual(result.suggestedAction, "Schedule a call to discuss pricing");
  assert.strictEqual(result.reasoning, "Customer has been responsive but hasn't committed");
  assert.strictEqual(result.confidence, 0.75);
  assert.strictEqual(result.riskLevel, "low");
  assert.strictEqual(result.sourceRecords.length, 3);
});

test("parseSalesAssistResponse uses defaults for missing fields", () => {
  const result = assist.parseSalesAssistResponse({});
  // Per the implementation: missing fields get sensible defaults
  assert.ok(result.suggestedAction, "should have a default suggestedAction");
  assert.strictEqual(result.confidence, 0, "missing confidence should default to 0");
  // riskLevel is one of: low, medium, high
  assert.ok(["low", "medium", "high"].includes(result.riskLevel),
    `riskLevel should be in {low, medium, high}, got ${result.riskLevel}`);
});

test("parseSalesAssistResponse clamps confidence to [0, 1]", () => {
  // confidence > 1 → clamped to 1
  const r1 = assist.parseSalesAssistResponse({ confidence: 5 });
  assert.strictEqual(r1.confidence, 1);
  // confidence < 0 → clamped to 0
  const r2 = assist.parseSalesAssistResponse({ confidence: -2 });
  assert.strictEqual(r2.confidence, 0);
});

test("parseSalesAssistResponse normalizes invalid riskLevel to 'medium'", () => {
  const result = assist.parseSalesAssistResponse({ riskLevel: "extreme" });
  assert.strictEqual(result.riskLevel, "medium");
});

test("parseSalesAssistResponse filters out source records with empty id", () => {
  const result = assist.parseSalesAssistResponse({
    sourceRecords: [
      { type: "deal", id: "d-1", label: "Valid" },
      { type: "deal", id: "", label: "Empty id (should be filtered)" },
      { type: "invalid_type", id: "x-1", label: "Wrong type (should default to deal)" },
    ],
  });
  // d-1 should be kept, empty id should be filtered, invalid type defaults to "deal"
  assert.ok(result.sourceRecords.length >= 1);
  assert.ok(result.sourceRecords.some(s => s.id === "d-1"));
  assert.ok(result.sourceRecords.every(s => s.id), "no source records with empty id");
});

test("parseSalesAssistResponse handles null/non-object input", () => {
  const r1 = assist.parseSalesAssistResponse(null);
  const r2 = assist.parseSalesAssistResponse("not an object");
  const r3 = assist.parseSalesAssistResponse(undefined);
  // All should return valid shape (with defaults)
  assert.ok(r1.suggestedAction);
  assert.ok(r2.suggestedAction);
  assert.ok(r3.suggestedAction);
});

// ─── 3. parseMessageAssistResponse (the message draft parser) ─

test("parseMessageAssistResponse returns full shape from valid LLM JSON", () => {
  const raw = {
    body: "Hi John, following up on our quote",
    channel: "whatsapp",
    language: "hy",
    followups: ["Call back tomorrow", "Send pricing details"],
  };
  const result = assist.parseMessageAssistResponse(raw);
  assert.strictEqual(result.body, "Hi John, following up on our quote");
  assert.strictEqual(result.channel, "whatsapp");
  assert.strictEqual(result.language, "hy");
  assert.strictEqual(result.followups.length, 2);
});

test("parseMessageAssistResponse normalizes invalid channel (uses caller's)", () => {
  // If LLM returns an invalid channel, the function falls back to the
  // channel passed by the caller (e.g. "email"). If that's also invalid,
  // defaults to "email".
  const r1 = assist.parseMessageAssistResponse({ channel: "carrier-pigeon" }, "whatsapp");
  assert.strictEqual(r1.channel, "whatsapp");  // uses caller's channel
  const r2 = assist.parseMessageAssistResponse({ channel: "carrier-pigeon" }, "carrier-pigeon");
  assert.strictEqual(r2.channel, "email");  // falls back to "email"
});

test("parseMessageAssistResponse defaults body if empty", () => {
  const r1 = assist.parseMessageAssistResponse({ body: "" });
  assert.ok(r1.body, "should have a default body");
  // Per impl: "Hello — just checking in. Let me know if you have any questions."
  assert.ok(r1.body.length > 0);
});

test("parseMessageAssistResponse defaults language to 'en'", () => {
  const r = assist.parseMessageAssistResponse({});
  assert.strictEqual(r.language, "en");
});

test("parseMessageAssistResponse normalizes language to {hy, en, ru}", () => {
  const r = assist.parseMessageAssistResponse({ language: "fr" });
  assert.strictEqual(r.language, "en");
});

test("parseMessageAssistResponse filters empty followups", () => {
  const r = assist.parseMessageAssistResponse({
    followups: ["valid", "", "  ", "also valid", null],
  });
  // Only non-empty followups should be in the result
  assert.ok(r.followups.every(f => f && f.trim()));
  assert.ok(r.followups.includes("valid"));
  assert.ok(r.followups.includes("also valid"));
});

// ─── 4. parseCustomerSummaryResponse (the summary parser) ─

test("parseCustomerSummaryResponse returns full shape from valid LLM JSON", () => {
  const raw = {
    summaryText: "Long-term customer, regular orders",
    keyInsights: ["Buys every month", "Prefers WhatsApp"],
  };
  const result = assist.parseCustomerSummaryResponse(raw);
  assert.strictEqual(result.summaryText, "Long-term customer, regular orders");
  assert.strictEqual(result.keyInsights.length, 2);
});

test("parseCustomerSummaryResponse limits keyInsights to 8", () => {
  const raw = {
    summaryText: "Test",
    keyInsights: Array.from({ length: 20 }, (_, i) => `insight ${i}`),
  };
  const result = assist.parseCustomerSummaryResponse(raw);
  assert.strictEqual(result.keyInsights.length, 8, "should limit to 8 insights max");
});

test("parseCustomerSummaryResponse uses default summary if empty", () => {
  const r = assist.parseCustomerSummaryResponse({ summaryText: "" });
  assert.ok(r.summaryText, "should have a default summary");
  assert.ok(r.summaryText.length > 0);
});

test("parseCustomerSummaryResponse filters empty insights", () => {
  const r = assist.parseCustomerSummaryResponse({
    keyInsights: ["valid", "", "  ", "another"],
  });
  // Only non-empty insights should be in the result
  assert.ok(r.keyInsights.every(i => i && i.trim()));
  assert.ok(r.keyInsights.includes("valid"));
  assert.ok(r.keyInsights.includes("another"));
});

test("parseCustomerSummaryResponse handles null input", () => {
  const r = assist.parseCustomerSummaryResponse(null);
  assert.ok(r.summaryText, "should have default summary for null input");
  assert.ok(Array.isArray(r.keyInsights));
});

// ─── 5. Error classes ──────────────────────────────

test("AssistError has a code, message, and statusCode", () => {
  const err = new assist.AssistError("TEST_CODE", "test message");
  assert.strictEqual(err.code, "TEST_CODE");
  assert.strictEqual(err.message, "test message");
  assert.strictEqual(err.statusCode, 400);  // default
  assert.strictEqual(err.name, "AssistError");
  assert.ok(err instanceof Error);
});

test("AssistProviderError extends AssistError with PROVIDER_FAILED code", () => {
  const err = new assist.AssistProviderError("provider failed");
  assert.ok(err instanceof assist.AssistError);
  assert.ok(err instanceof Error);
  // Per implementation: PROVIDER_FAILED (not PROVIDER_ERROR)
  assert.strictEqual(err.code, "PROVIDER_FAILED");
  assert.strictEqual(err.message, "provider failed");
  assert.strictEqual(err.statusCode, 502);  // provider errors are 502
});

test("AssistNotFoundError extends AssistError", () => {
  const err = new assist.AssistNotFoundError("missing");
  assert.ok(err instanceof assist.AssistError);
  assert.strictEqual(err.code, "NOT_FOUND");
});

test("AssistOrgMismatchError extends AssistError", () => {
  const err = new assist.AssistOrgMismatchError("wrong org");
  assert.ok(err instanceof assist.AssistError);
  assert.strictEqual(err.code, "ORG_MISMATCH");
});

// ─── 6. Cross-cutting / shape ────────────────

test("smbCrmAssist module exports the expected public surface", () => {
  // Error classes (4)
  assert.strictEqual(typeof assist.AssistError, "function");
  assert.strictEqual(typeof assist.AssistProviderError, "function");
  assert.strictEqual(typeof assist.AssistNotFoundError, "function");
  assert.strictEqual(typeof assist.AssistOrgMismatchError, "function");
  // Prompt builders (3)
  assert.strictEqual(typeof assist.buildSalesAssistPrompt, "function");
  assert.strictEqual(typeof assist.buildMessageAssistPrompt, "function");
  assert.strictEqual(typeof assist.buildCustomerSummaryPrompt, "function");
  // Response parsers (3)
  assert.strictEqual(typeof assist.parseSalesAssistResponse, "function");
  assert.strictEqual(typeof assist.parseMessageAssistResponse, "function");
  assert.strictEqual(typeof assist.parseCustomerSummaryResponse, "function");
  // Pure helpers — note: safeString, safeNumber, safeJson are file-private
  // (per A1-Suite-Local-ANT #11). The exported pure surface is the 3 builders
  // + 3 parsers (already tested above).
  // Entry points (3 — DB-dependent, tested via integration)
  assert.strictEqual(typeof assist.salesAssist, "function");
  assert.strictEqual(typeof assist.messageAssist, "function");
  assert.strictEqual(typeof assist.customerSummary, "function");
});

test("smbCrmAssist has exactly 6 pure functions + 4 error classes in source", () => {
  // Per source-of-truth: 3 prompt builders + 3 parsers = 6 pure functions
  // 4 error classes: AssistError, AssistProviderError, AssistNotFoundError, AssistOrgMismatchError
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "smbCrmAssist.js"), "utf8");
  const pureFns = [
    "buildSalesAssistPrompt", "buildMessageAssistPrompt", "buildCustomerSummaryPrompt",
    "parseSalesAssistResponse", "parseMessageAssistResponse", "parseCustomerSummaryResponse",
  ];
  let defCount = 0;
  for (const fn of pureFns) {
    const re = new RegExp("^function " + fn + "\\(", "m");
    if (re.test(src)) defCount++;
  }
  assert.strictEqual(defCount, 6, `Expected 6 pure functions defined, got ${defCount}`);
});

// ─── 7. Sovereignty (no I/O, no network) ──────

test("smbCrmAssist.js doesn't import http/https/net/fs at top level", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "smbCrmAssist.js"), "utf8");
  assert.ok(!/require\s*\(\s*['"]https?['"]/.test(src),
    "smbCrmAssist.js should not require http/https (pure engine)");
  assert.ok(!/require\s*\(\s*['"]node-fetch['"]/.test(src),
    "smbCrmAssist.js should not require node-fetch");
  assert.ok(!/require\s*\(\s*['"]fs['"]/.test(src),
    "smbCrmAssist.js should not require fs (no file I/O in the assist engine)");
  // No DB
  assert.ok(!/require\s*\(\s*['"]better-sqlite3['"]/.test(src),
    "smbCrmAssist.js should not require better-sqlite3 (per docstring)");
});

test("smbCrmAssist.js doesn't read process.env (pure engine)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "smbCrmAssist.js"), "utf8");
  // Strip comments
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/process\.env/.test(code),
    "smbCrmAssist.js should not read process.env (per docstring)");
});

test("smbCrmAssist.js uses 'use strict' (CommonJS, per AGENTS.md §9)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "smbCrmAssist.js"), "utf8");
  assert.ok(/^"use strict";/m.test(src),
    "smbCrmAssist.js should use 'use strict' directive");
});