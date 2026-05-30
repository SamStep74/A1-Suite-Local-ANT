"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

test("docs-sign: full lifecycle draft -> signers -> send -> sign -> sealed signed", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();

    const unauth = await app.inject({ method: "GET", url: "/api/docs/documents" });
    assert.strictEqual(unauth.statusCode, 401);

    const owner = await login(app);
    const seeded = (await app.inject({ method: "GET", url: "/api/docs/documents", headers: { cookie: owner } })).json();
    assert.ok(Array.isArray(seeded.documents) && seeded.documents.length >= 2, "seeded documents present");

    // Create a draft
    const created = await app.inject({ method: "POST", url: "/api/docs/documents", headers: { cookie: owner },
      payload: { title: "Միջգործակալական համաձայնագիր", body: "Պայմանները...", docType: "agreement" } });
    assert.strictEqual(created.statusCode, 200);
    const docId = created.json().document.id;
    assert.strictEqual(created.json().document.status, "draft");

    // Title too short -> 400
    const badTitle = await app.inject({ method: "POST", url: "/api/docs/documents", headers: { cookie: owner }, payload: { title: "x" } });
    assert.strictEqual(badTitle.statusCode, 400);

    // Cannot send with no signers -> 409
    const sendEmpty = await app.inject({ method: "POST", url: `/api/docs/documents/${docId}/send`, headers: { cookie: owner }, payload: {} });
    assert.strictEqual(sendEmpty.statusCode, 409);

    // Add two signers
    const s1 = await app.inject({ method: "POST", url: `/api/docs/documents/${docId}/signers`, headers: { cookie: owner }, payload: { signerName: "Անահիտ Հակոբյան", signerEmail: "anahit@armosphera.local" } });
    assert.strictEqual(s1.statusCode, 200);
    const s2 = await app.inject({ method: "POST", url: `/api/docs/documents/${docId}/signers`, headers: { cookie: owner }, payload: { signerName: "Դավիթ Պետրոսյան" } });
    assert.strictEqual(s2.statusCode, 200);
    const signers = s2.json().document.signers;
    assert.strictEqual(signers.length, 2);

    // Edit is allowed while draft
    const edited = await app.inject({ method: "PATCH", url: `/api/docs/documents/${docId}`, headers: { cookie: owner }, payload: { body: "Թարմացված պայմաններ" } });
    assert.strictEqual(edited.statusCode, 200);

    // Send for signature
    const sent = await app.inject({ method: "POST", url: `/api/docs/documents/${docId}/send`, headers: { cookie: owner }, payload: {} });
    assert.strictEqual(sent.statusCode, 200);
    assert.strictEqual(sent.json().document.status, "out-for-signature");

    // Cannot edit once out for signature -> 409 (body is frozen before signing)
    const editLocked = await app.inject({ method: "PATCH", url: `/api/docs/documents/${docId}`, headers: { cookie: owner }, payload: { body: "tamper" } });
    assert.strictEqual(editLocked.statusCode, 409);

    // First signer signs -> still out-for-signature (one remaining)
    const sign1 = await app.inject({ method: "POST", url: `/api/docs/documents/${docId}/sign`, headers: { cookie: owner }, payload: { signerId: signers[0].id } });
    assert.strictEqual(sign1.statusCode, 200);
    assert.strictEqual(sign1.json().document.status, "out-for-signature");
    assert.strictEqual(sign1.json().document.signers.find(s => s.id === signers[0].id).status, "signed");

    // Double-sign the same signer -> 409
    const dup = await app.inject({ method: "POST", url: `/api/docs/documents/${docId}/sign`, headers: { cookie: owner }, payload: { signerId: signers[0].id } });
    assert.strictEqual(dup.statusCode, 409);

    // Last signer signs -> document seals to "signed" with a sealed checksum
    const sign2 = await app.inject({ method: "POST", url: `/api/docs/documents/${docId}/sign`, headers: { cookie: owner }, payload: { signerId: signers[1].id } });
    assert.strictEqual(sign2.statusCode, 200);
    assert.strictEqual(sign2.json().document.status, "signed");
    assert.ok(sign2.json().document.sealedChecksum && sign2.json().document.sealedChecksum.length === 64, "sha-256 sealed checksum present");
    assert.ok(sign2.json().document.signers.every(s => s.checksum && s.checksum.length === 64), "every signer has a consent checksum");

    // Cannot void a signed document -> 409 (executed contract is immutable)
    const voidSigned = await app.inject({ method: "POST", url: `/api/docs/documents/${docId}/void`, headers: { cookie: owner }, payload: {} });
    assert.strictEqual(voidSigned.statusCode, 409);
  } finally { await app.close(); }
});

test("docs-sign: write-gate (Auditor 403), void path, and signed-user binding", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);

    // Auditor (read-only) cannot create -> 403
    const auditor = await login(app, "auditor@armosphera.local", DEFAULT_PASSWORD);
    const blocked = await app.inject({ method: "POST", url: "/api/docs/documents", headers: { cookie: auditor }, payload: { title: "Should fail" } });
    assert.strictEqual(blocked.statusCode, 403);

    // Owner can void a draft
    const created = await app.inject({ method: "POST", url: "/api/docs/documents", headers: { cookie: owner }, payload: { title: "Void me please" } });
    const docId = created.json().document.id;
    const voided = await app.inject({ method: "POST", url: `/api/docs/documents/${docId}/void`, headers: { cookie: owner }, payload: { reason: "superseded" } });
    assert.strictEqual(voided.statusCode, 200);
    assert.strictEqual(voided.json().document.status, "voided");

    // Cannot add signers to a voided doc -> 409
    const lateSigner = await app.inject({ method: "POST", url: `/api/docs/documents/${docId}/signers`, headers: { cookie: owner }, payload: { signerName: "Too Late" } });
    assert.strictEqual(lateSigner.statusCode, 409);

    // Signer bound to a specific user can only be signed by THAT user.
    const opOrgId = app.db.prepare("SELECT org_id FROM users WHERE email = ?").get(DEFAULT_EMAIL).org_id;
    const operator = app.db.prepare("SELECT id FROM users WHERE org_id = ? AND role = 'Operator' LIMIT 1").get(opOrgId);
    const doc2 = await app.inject({ method: "POST", url: "/api/docs/documents", headers: { cookie: owner }, payload: { title: "User-bound signature" } });
    const doc2Id = doc2.json().document.id;
    await app.inject({ method: "POST", url: `/api/docs/documents/${doc2Id}/signers`, headers: { cookie: owner }, payload: { signerName: "Armosphera Operator", signerUserId: operator.id } });
    await app.inject({ method: "POST", url: `/api/docs/documents/${doc2Id}/send`, headers: { cookie: owner }, payload: {} });
    const full = (await app.inject({ method: "GET", url: `/api/docs/documents/${doc2Id}`, headers: { cookie: owner } })).json();
    const boundSignerId = full.document.signers[0].id;
    // Owner is NOT the bound user -> 403
    const wrongUser = await app.inject({ method: "POST", url: `/api/docs/documents/${doc2Id}/sign`, headers: { cookie: owner }, payload: { signerId: boundSignerId } });
    assert.strictEqual(wrongUser.statusCode, 403);
  } finally { await app.close(); }
});

test("docs-sign: cross-org isolation — a foreign document is invisible (404)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const now = new Date().toISOString();
    const otherOrgId = "org-other-docs";
    app.db.prepare("INSERT INTO organizations (id, name, legal_name, tax_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(otherOrgId, "Other Docs LLC", "Other Docs LLC", "77777777", now);
    const foreignId = "doc-foreign-1";
    app.db.prepare(`INSERT INTO documents (id, org_id, title, body, doc_type, status, customer_id, sealed_checksum, sealed_at, created_at, updated_at)
      VALUES (?, ?, ?, '', 'agreement', 'draft', NULL, '', '', ?, ?)`).run(foreignId, otherOrgId, "Foreign doc", now, now);

    const list = (await app.inject({ method: "GET", url: "/api/docs/documents", headers: { cookie: owner } })).json();
    assert.ok(!list.documents.some(d => d.id === foreignId), "foreign document leaked into owner list");

    const get = await app.inject({ method: "GET", url: `/api/docs/documents/${foreignId}`, headers: { cookie: owner } });
    assert.strictEqual(get.statusCode, 404);
    const send = await app.inject({ method: "POST", url: `/api/docs/documents/${foreignId}/send`, headers: { cookie: owner }, payload: {} });
    assert.strictEqual(send.statusCode, 404);
  } finally { await app.close(); }
});

test("docs-sign: read-only Auditor cannot record consent (sign) — 403, no fraudulent evidence", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);

    // Owner sets up a document out for signature with one named (non-user-bound) signer.
    const created = await app.inject({ method: "POST", url: "/api/docs/documents", headers: { cookie: owner }, payload: { title: "Auditor must not sign this" } });
    const docId = created.json().document.id;
    await app.inject({ method: "POST", url: `/api/docs/documents/${docId}/signers`, headers: { cookie: owner }, payload: { signerName: "Անանուն Ստորագրող" } });
    await app.inject({ method: "POST", url: `/api/docs/documents/${docId}/send`, headers: { cookie: owner }, payload: {} });
    const full = (await app.inject({ method: "GET", url: `/api/docs/documents/${docId}`, headers: { cookie: owner } })).json();
    const signerId = full.document.signers[0].id;

    // Auditor (read-only) attempts to sign the named slot -> 403, document stays out-for-signature.
    const auditor = await login(app, "auditor@armosphera.local", DEFAULT_PASSWORD);
    const attempt = await app.inject({ method: "POST", url: `/api/docs/documents/${docId}/sign`, headers: { cookie: auditor }, payload: { signerId } });
    assert.strictEqual(attempt.statusCode, 403);
    const after = (await app.inject({ method: "GET", url: `/api/docs/documents/${docId}`, headers: { cookie: owner } })).json();
    assert.strictEqual(after.document.status, "out-for-signature");
    assert.strictEqual(after.document.signers[0].status, "pending", "no consent was recorded");
    assert.strictEqual(after.document.signers[0].checksum, "", "no evidence checksum was written");
  } finally { await app.close(); }
});
