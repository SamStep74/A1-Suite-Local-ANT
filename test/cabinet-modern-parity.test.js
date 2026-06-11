/**
 * cabinet-modern-parity.test.js
 *
 * Phase 8.2 worker 3 — contract parity between the web-modern
 * Cabinet route's *expected* response shape and the Fastify backend's
 * *actual* response shape. This file lives next to the 11-case
 * `test/document-cabinet.test.js` and proves the modern route
 * stays in lockstep with the server contract.
 *
 * Pattern (matches test/document-cabinet.test.js):
 *   - withApp / login / app.inject (no live network, no DB on disk)
 *   - node:test plain CommonJS
 *   - default seeded owner account
 *
 * Schema strategy: the modern route imports its Zod schemas from
 * `web-modern/src/lib/api/schemas.ts` (worker 1's deliverable). Node
 * can't import a `.ts` file at runtime, so we re-declare the shape
 * inline with hand-rolled `assert` checks. If worker 1's schema
 * drifts from this declaration, the test still passes against the
 * server (the source of truth) and the handoff should flag the
 * drift for worker 1 to align.
 *
 *   // kept in sync with web-modern/src/lib/api/schemas.ts (Phase 8.2 worker 1)
 *
 * If a future parity test writer wants to use Zod directly, add
 * `zod` to the root package.json dependencies and replace the
 * `assertShape` helper with `SomeSchema.parse(json)`. The shape
 * constants below stay the same.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

// Re-declared from web-modern/src/lib/api/schemas.ts (Phase 8.2 worker 1).
// Keep in lockstep — see the comment at the top of this file.
//
// The Fastify backend returns two different shapes for a Cabinet
// document, depending on the endpoint:
//   - GET /api/cabinet/documents  → 12 keys (listDocuments SELECT,
//     no aiSummary / ocrText) — what the route's filter bar drives
//   - POST/PATCH /api/cabinet/documents  → 14 keys (readDocument
//     reads the full row, includes aiSummary + ocrText)
//
// Worker 1 should expose BOTH shapes (e.g. CabinetListDocumentSchema
// vs CabinetDocumentSchema) and document the wire-level drift here.
// Until then, this file locks both shapes so a future regression
// that drops either set of fields fails the suite loudly.
const CABINET_DOCUMENT_KEYS = Object.freeze([
  "id",
  "orgId",
  "title",
  "direction",
  "status",
  "docType",
  "linkedType",
  "linkedId",
  "ocrStatus",
  "currentVersion",
  "createdAt",
  "updatedAt",
]);

const CABINET_DOCUMENT_FULL_KEYS = Object.freeze([
  ...CABINET_DOCUMENT_KEYS,
  "aiSummary",
  "ocrText",
]);

const CABINET_LIST_RESPONSE_KEYS = Object.freeze(["documents"]);

const VALID_DIRECTIONS = new Set(["incoming", "outgoing", "internal"]);
const VALID_STATUSES = new Set(["active", "archived"]);

async function withApp(fn) {
  const app = buildApp({ dbPath: ":memory:" });
  await app.ready();
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({
    method: "POST",
    url: "/api/login",
    payload: { email, password },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.headers["set-cookie"];
}

/** Looser-than-zod parity check: asserts a value is a plain object
 *  that has exactly the expected keys, plus the values of the listed
 *  scalar fields are of the expected type. Unknown keys fail loudly
 *  so a server regression that drops or renames a field is caught
 *  the next time the suite runs. */
function assertShape(obj, expectedKeys, typeChecks = {}) {
  assert.equal(typeof obj, "object", `expected object, got ${typeof obj}`);
  assert.ok(obj !== null, "expected non-null object");
  const actualKeys = Object.keys(obj).sort();
  const expectedSorted = [...expectedKeys].sort();
  assert.deepEqual(
    actualKeys,
    expectedSorted,
    `key mismatch.\n  expected: ${expectedSorted.join(",")}\n  actual:   ${actualKeys.join(",")}`,
  );
  for (const [field, typeOf] of Object.entries(typeChecks)) {
    assert.equal(typeof obj[field], typeOf, `field ${field} should be ${typeOf}, got ${typeof obj[field]} (${JSON.stringify(obj[field])})`);
  }
}

/* ────────────────────────────────────────────────────────────────────
 * Parity 1 — list response shape
 * Mirrors document-cabinet "list requires docs app access" but adds a
 * structural shape lock on top of `assert.deepEqual(documents, [])`.
 * ──────────────────────────────────────────────────────────────────── */

test("cabinet-modern-parity: 1 — list response shape matches CabinetListResponseSchema", async () => {
  await withApp(async (app) => {
    const owner = await login(app);

    const res = await app.inject({
      method: "GET",
      url: "/api/cabinet/documents",
      headers: { cookie: owner },
    });
    assert.equal(res.statusCode, 200, res.body);

    const body = res.json();
    assertShape(body, CABINET_LIST_RESPONSE_KEYS, { documents: "object" });
    assert.ok(Array.isArray(body.documents), "documents must be an array");
  });
});

/* ────────────────────────────────────────────────────────────────────
 * Parity 2 — create → list round-trip
 * Proves the modern route's create-then-list pattern is supported
 * end-to-end. The contract tests already assert list contains the
 * created doc, but they don't lock the *shape* of the created doc
 * object — this one does.
 * ──────────────────────────────────────────────────────────────────── */

test("cabinet-modern-parity: 2 — create → list round-trip locks the document shape", async () => {
  await withApp(async (app) => {
    const owner = await login(app);

    const stamp = Date.now();
    const payload = {
      title: `Parity Test ${stamp}`,
      direction: "incoming",
      linkedType: "customer",
      linkedId: "cust-parity-1",
      docType: "contract",
      body: "Parity round-trip body",
      idempotencyKey: `cab-parity-2-${stamp}`,
    };

    const create = await app.inject({
      method: "POST",
      url: "/api/cabinet/documents",
      headers: { cookie: owner },
      payload,
    });
    assert.equal(create.statusCode, 200, create.body);
    const created = create.json().document;
    // POST returns the full row (readDocument), which has 14 keys
    // including aiSummary + ocrText. The list GET below uses the
    // 12-key subset (CABINET_DOCUMENT_KEYS).
    assertShape(created, CABINET_DOCUMENT_FULL_KEYS, {
      id: "string",
      title: "string",
      direction: "string",
      status: "string",
      docType: "string",
      currentVersion: "number",
      createdAt: "string",
      updatedAt: "string",
    });
    assert.ok(VALID_DIRECTIONS.has(created.direction), `direction must be one of ${[...VALID_DIRECTIONS].join("|")}`);
    assert.ok(VALID_STATUSES.has(created.status), `status must be one of ${[...VALID_STATUSES].join("|")}`);
    assert.equal(created.direction, "incoming");
    assert.equal(created.linkedType, "customer");
    assert.equal(created.linkedId, "cust-parity-1");
    assert.equal(created.currentVersion, 1, "first version is auto-created");

    const list = await app.inject({
      method: "GET",
      url: "/api/cabinet/documents",
      headers: { cookie: owner },
    });
    assert.equal(list.statusCode, 200, list.body);
    const docs = list.json().documents;
    const found = docs.find((d) => d.id === created.id);
    assert.ok(found, "newly created doc must appear in the list");
    assertShape(found, CABINET_DOCUMENT_KEYS);
  });
});

/* ────────────────────────────────────────────────────────────────────
 * Parity 3 — patch (archive) round-trip
 * Proves the modern route's Archive/Restore action wires through to
 * the API: PATCH status=archived, then list with ?status=archived
 * and confirm the doc surfaces. Mirrors the contract test's
 * archive step but adds the filter assertion.
 * ──────────────────────────────────────────────────────────────────── */

test("cabinet-modern-parity: 3 — patch (archive) → ?status=archived round-trip", async () => {
  await withApp(async (app) => {
    const owner = await login(app);

    const stamp = Date.now();
    const create = await app.inject({
      method: "POST",
      url: "/api/cabinet/documents",
      headers: { cookie: owner },
      payload: {
        title: `Parity Archive ${stamp}`,
        direction: "outgoing",
        idempotencyKey: `cab-parity-3-${stamp}`,
      },
    });
    assert.equal(create.statusCode, 200, create.body);
    const docId = create.json().document.id;

    const archive = await app.inject({
      method: "PATCH",
      url: `/api/cabinet/documents/${docId}`,
      headers: { cookie: owner },
      payload: { status: "archived" },
    });
    assert.equal(archive.statusCode, 200, archive.body);
    // PATCH returns the full row (readDocument), 14 keys.
    assertShape(archive.json().document, CABINET_DOCUMENT_FULL_KEYS, { status: "string" });
    assert.equal(archive.json().document.status, "archived");

    const listArchived = await app.inject({
      method: "GET",
      url: "/api/cabinet/documents?status=archived",
      headers: { cookie: owner },
    });
    assert.equal(listArchived.statusCode, 200, listArchived.body);
    const archived = listArchived.json().documents;
    assert.ok(
      archived.some((d) => d.id === docId),
      "archived doc must appear in ?status=archived",
    );
    for (const d of archived) {
      assert.equal(d.status, "archived", "every doc in the ?status=archived response must be archived");
    }
  });
});

/* ────────────────────────────────────────────────────────────────────
 * Parity 4 — filter query string is honored
 * Proves the modern route's filter bar wires through to the API:
 * seed one incoming + one outgoing doc, then GET ?direction=incoming
 * and assert the response contains *only* the incoming one.
 *
 * Distinct from the contract test "filter by direction" because
 * the contract test asserts three filters together — this one is
 * a focused, single-direction round-trip and asserts NO outgoing
 * doc leaks into the response.
 * ──────────────────────────────────────────────────────────────────── */

test("cabinet-modern-parity: 4 — ?direction=incoming returns only incoming docs (no outgoing leak)", async () => {
  await withApp(async (app) => {
    const owner = await login(app);

    const stamp = Date.now();
    const seed = [
      { title: `Parity In ${stamp}`, direction: "incoming", linkedType: "customer", linkedId: "cust-in", idempotencyKey: `cab-parity-4-in-${stamp}` },
      { title: `Parity Out ${stamp}`, direction: "outgoing", linkedType: "customer", linkedId: "cust-out", idempotencyKey: `cab-parity-4-out-${stamp}` },
    ];
    for (const p of seed) {
      const r = await app.inject({
        method: "POST",
        url: "/api/cabinet/documents",
        headers: { cookie: owner },
        payload: p,
      });
      assert.equal(r.statusCode, 200, r.body);
    }

    const filtered = await app.inject({
      method: "GET",
      url: "/api/cabinet/documents?direction=incoming",
      headers: { cookie: owner },
    });
    assert.equal(filtered.statusCode, 200, filtered.body);
    const docs = filtered.json().documents;
    assert.ok(docs.length >= 1, "at least one incoming doc in the filtered response");
    for (const d of docs) {
      assert.equal(d.direction, "incoming", "no outgoing docs may leak through ?direction=incoming");
    }
  });
});

/* ────────────────────────────────────────────────────────────────────
 * Parity 5 — response keys are stable
 * Locks the CabinetDocument key set. If the server drops or renames
 * a field, this test fails on the next run — before the modern
 * route silently starts seeing `undefined` in the UI.
 * ──────────────────────────────────────────────────────────────────── */

test("cabinet-modern-parity: 5 — CabinetDocument response keys are stable (contract lock)", async () => {
  await withApp(async (app) => {
    const owner = await login(app);

    // Seed at least one doc so the list isn't empty (we still assert
    // the same shape for a known empty payload in parity 1).
    const stamp = Date.now();
    const create = await app.inject({
      method: "POST",
      url: "/api/cabinet/documents",
      headers: { cookie: owner },
      payload: {
        title: `Parity Key Lock ${stamp}`,
        direction: "internal",
        idempotencyKey: `cab-parity-5-${stamp}`,
      },
    });
    assert.equal(create.statusCode, 200, create.body);
    const created = create.json().document;
    // POST returns the full row (readDocument), 14 keys.
    assert.deepEqual(
      new Set(Object.keys(created).sort()),
      new Set(CABINET_DOCUMENT_FULL_KEYS),
      `created CabinetDocument (POST) must have exactly: ${CABINET_DOCUMENT_FULL_KEYS.join(",")}`,
    );

    // And the list shape (one row, 12 keys — no aiSummary/ocrText).
    const list = await app.inject({
      method: "GET",
      url: "/api/cabinet/documents",
      headers: { cookie: owner },
    });
    assert.equal(list.statusCode, 200, list.body);
    const docs = list.json().documents;
    const found = docs.find((d) => d.id === created.id);
    assert.ok(found, "seed doc must appear in the list");
    assert.deepEqual(
      new Set(Object.keys(found).sort()),
      new Set(CABINET_DOCUMENT_KEYS),
      `list-row CabinetDocument (GET list) must have exactly: ${CABINET_DOCUMENT_KEYS.join(",")}`,
    );
  });
});
