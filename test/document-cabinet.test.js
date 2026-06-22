"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD, __test: dbTest } = require("../server/db");

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
    payload: { email, password }
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.headers["set-cookie"];
}

test("document-cabinet: list is auth-gated (401 without session)", async () => {
  await withApp(async app => {
    const res = await app.inject({ method: "GET", url: "/api/cabinet/documents" });
    assert.equal(res.statusCode, 401, res.body);
  });
});

test("document-cabinet: list requires docs app access (operator -> 403, owner -> 200)", async () => {
  await withApp(async app => {
    const operator = await login(app, "operator@armosphera.local", DEFAULT_PASSWORD);
    const blocked = await app.inject({ method: "GET", url: "/api/cabinet/documents", headers: { cookie: operator } });
    assert.equal(blocked.statusCode, 403, blocked.body);

    const owner = await login(app);
    const allowed = await app.inject({ method: "GET", url: "/api/cabinet/documents", headers: { cookie: owner } });
    assert.equal(allowed.statusCode, 200, allowed.body);
    assert.deepEqual(allowed.json().documents, [], "empty cabinet on a fresh org");
  });
});

test("document-cabinet: create a new document and list it, with idempotency replay", async () => {
  await withApp(async app => {
    const owner = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;

    const payload = {
      title: "Մուտքային պայմանագիր — Անի",
      direction: "incoming",
      linkedType: "customer",
      linkedId: "cust-ani",
      body: "Համաձայն պայմանների կողմերը պարտավորվում են ...",
      idempotencyKey: "cab-create-1"
    };
    const first = await app.inject({ method: "POST", url: "/api/cabinet/documents", headers: { cookie: owner }, payload });
    assert.equal(first.statusCode, 200, first.body);
    const doc = first.json().document;
    assert.ok(doc.id, "returns id");
    assert.equal(doc.direction, "incoming");
    assert.equal(doc.linkedType, "customer");
    assert.equal(doc.linkedId, "cust-ani");
    assert.equal(doc.status, "active");
    assert.equal(doc.currentVersion, 1);

    // Replay the same idempotency key -> same response, no extra audit row.
    const replay = await app.inject({ method: "POST", url: "/api/cabinet/documents", headers: { cookie: owner }, payload });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().document.id, doc.id, "replay returns the cached id");
    const after = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    assert.equal(after, before + 1, "idempotent create wrote exactly one audit row");

    // List returns it.
    const list = await app.inject({ method: "GET", url: "/api/cabinet/documents?direction=incoming", headers: { cookie: owner } });
    assert.equal(list.statusCode, 200, list.body);
    assert.ok(list.json().documents.some(d => d.id === doc.id), "new doc appears in the list");
  });
});

test("document-cabinet: filter by direction, status, and linkedType returns the right subset", async () => {
  await withApp(async app => {
    const owner = await login(app);

    // Seed: one incoming, one outgoing, one internal.
    for (const p of [
      { title: "Մուտքային Փաստաթուղթ", direction: "incoming", linkedType: "customer", linkedId: "cust-ani" },
      { title: "Ելքային Փաստաթուղթ", direction: "outgoing", linkedType: "customer", linkedId: "cust-nare" },
      { title: "Ներքին Հաշվետվություն", direction: "internal", linkedType: null, linkedId: null }
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/cabinet/documents",
        headers: { cookie: owner },
        payload: { ...p, idempotencyKey: `cab-filter-${p.direction}` }
      });
      assert.equal(res.statusCode, 200, res.body);
    }

    const incoming = await app.inject({ method: "GET", url: "/api/cabinet/documents?direction=incoming", headers: { cookie: owner } });
    assert.equal(incoming.statusCode, 200, incoming.body);
    assert.equal(incoming.json().documents.length, 1, "only one incoming");
    assert.equal(incoming.json().documents[0].direction, "incoming");

    const outgoing = await app.inject({ method: "GET", url: "/api/cabinet/documents?direction=outgoing", headers: { cookie: owner } });
    assert.equal(outgoing.json().documents.length, 1);

    const custScoped = await app.inject({ method: "GET", url: "/api/cabinet/documents?linkedType=customer&linkedId=cust-ani", headers: { cookie: owner } });
    assert.equal(custScoped.json().documents.length, 1);
    assert.equal(custScoped.json().documents[0].linkedId, "cust-ani");
  });
});

test("document-cabinet: read returns versions, signers, and AI annotations", async () => {
  await withApp(async app => {
    const owner = await login(app);
    const create = await app.inject({
      method: "POST",
      url: "/api/cabinet/documents",
      headers: { cookie: owner },
      payload: { title: "Read probe", direction: "incoming", linkedType: "customer", linkedId: "cust-ani", idempotencyKey: "cab-read-1" }
    });
    assert.equal(create.statusCode, 200, create.body);
    const docId = create.json().document.id;

    const read = await app.inject({ method: "GET", url: `/api/cabinet/documents/${docId}`, headers: { cookie: owner } });
    assert.equal(read.statusCode, 200, read.body);
    const body = read.json();
    assert.equal(body.document.id, docId);
    assert.ok(Array.isArray(body.versions), "versions array present");
    assert.ok(Array.isArray(body.signers), "signers array present");
    assert.ok(Array.isArray(body.aiAnnotations), "aiAnnotations array present");
    assert.equal(body.versions.length, 1, "first version is auto-created");
  });
});

test("document-cabinet: PATCH can link to a customer, archive, and soft-restore", async () => {
  await withApp(async app => {
    const owner = await login(app);
    const create = await app.inject({
      method: "POST",
      url: "/api/cabinet/documents",
      headers: { cookie: owner },
      payload: { title: "Linkable doc", direction: "incoming", idempotencyKey: "cab-link-1" }
    });
    const docId = create.json().document.id;

    const link = await app.inject({
      method: "PATCH",
      url: `/api/cabinet/documents/${docId}`,
      headers: { cookie: owner },
      payload: { linkedType: "customer", linkedId: "cust-ani" }
    });
    assert.equal(link.statusCode, 200, link.body);
    assert.equal(link.json().document.linkedId, "cust-ani");

    const archive = await app.inject({
      method: "PATCH",
      url: `/api/cabinet/documents/${docId}`,
      headers: { cookie: owner },
      payload: { status: "archived" }
    });
    assert.equal(archive.statusCode, 200, archive.body);
    assert.equal(archive.json().document.status, "archived");

    const restore = await app.inject({
      method: "PATCH",
      url: `/api/cabinet/documents/${docId}`,
      headers: { cookie: owner },
      payload: { status: "active" }
    });
    assert.equal(restore.statusCode, 200, restore.body);
    assert.equal(restore.json().document.status, "active");
  });
});

test("document-cabinet: version creation records parent + sha256, increments currentVersion", async () => {
  await withApp(async app => {
    const owner = await login(app);
    const create = await app.inject({
      method: "POST",
      url: "/api/cabinet/documents",
      headers: { cookie: owner },
      payload: { title: "Versioned doc", direction: "incoming", linkedType: "customer", linkedId: "cust-ani", idempotencyKey: "cab-ver-1" }
    });
    const docId = create.json().document.id;

    const v2 = await app.inject({
      method: "POST",
      url: `/api/cabinet/documents/${docId}/versions`,
      headers: { cookie: owner },
      payload: {
        parentVersion: 1,
        storagePath: "memory://v2.bin",
        mimeType: "application/pdf",
        byteSize: 4096,
        sha256: "a".repeat(64),
        idempotencyKey: "cab-ver-2"
      }
    });
    assert.equal(v2.statusCode, 200, v2.body);
    const v2Body = v2.json();
    assert.equal(v2Body.version.version, 2);
    assert.equal(v2Body.version.parentVersion, 1);
    assert.equal(v2Body.version.sha256, "a".repeat(64));
    assert.equal(v2Body.document.currentVersion, 2);

    const read = await app.inject({ method: "GET", url: `/api/cabinet/documents/${docId}`, headers: { cookie: owner } });
    assert.equal(read.json().versions.length, 2);
  });
});

test("document-cabinet: full-text search returns matching documents scoped to org", async () => {
  await withApp(async app => {
    const owner = await login(app);
    const titles = [
      "Հաշվետվություն առաքման ժամկետների մասին",
      "Հաշվետվություն վճարումների մասին",
      "Այլ փաստաթուղթ"
    ];
    for (let i = 0; i < titles.length; i++) {
      const created = await app.inject({
        method: "POST",
        url: "/api/cabinet/documents",
        headers: { cookie: owner },
        payload: { title: titles[i], direction: "internal", idempotencyKey: `cab-fts-${i}`, body: titles[i] }
      });
      assert.equal(created.statusCode, 200, created.body);
    }

    const search = await app.inject({ method: "GET", url: "/api/cabinet/search?q=" + encodeURIComponent("Հաշվետվություն"), headers: { cookie: owner } });
    assert.equal(search.statusCode, 200, search.body);
    const hits = search.json().hits;
    assert.equal(hits.length, 2, "two docs match the query");
    for (const hit of hits) {
      assert.equal(hit.orgId, "org-armosphera-demo", "hit is scoped to the org");
    }
  });
});

test("document-cabinet: schema falls back when SQLite lacks FTS5", () => {
  const statements = [];
  const fakeDb = {
    exec(sql) {
      statements.push(sql);
      if (statements.length === 1) {
        throw new Error("no such module: fts5");
      }
    }
  };

  dbTest.ensureCabinetFtsSchema(fakeDb);

  assert.equal(statements.length, 2);
  assert.match(statements[0], /CREATE VIRTUAL TABLE IF NOT EXISTS cabinet_fts USING fts5/);
  assert.match(statements[1], /CREATE TABLE IF NOT EXISTS cabinet_fts/);
  assert.match(statements[1], /PRIMARY KEY \(org_id, cabinet_id\)/);
});

test("document-cabinet: search works against fallback table without FTS5 MATCH", async () => {
  await withApp(async app => {
    const owner = await login(app);
    app.db.exec(`
      DROP TABLE cabinet_fts;
      CREATE TABLE cabinet_fts (
        org_id TEXT NOT NULL,
        cabinet_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (org_id, cabinet_id)
      );
    `);

    for (const [idx, title] of [
      "Fallback invoice probe",
      "Fallback delivery probe",
      "Unrelated document"
    ].entries()) {
      const created = await app.inject({
        method: "POST",
        url: "/api/cabinet/documents",
        headers: { cookie: owner },
        payload: { title, direction: "internal", idempotencyKey: `cab-fallback-search-${idx}`, body: title }
      });
      assert.equal(created.statusCode, 200, created.body);
    }

    const search = await app.inject({ method: "GET", url: "/api/cabinet/search?q=Fallback", headers: { cookie: owner } });
    assert.equal(search.statusCode, 200, search.body);
    assert.deepEqual(search.json().hits.map(hit => hit.title).sort(), [
      "Fallback delivery probe",
      "Fallback invoice probe"
    ]);
  });
});

test("document-cabinet: malformed id is rejected before persistence and audit emit", async () => {
  await withApp(async app => {
    const owner = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;

    const malformedPath = await app.inject({
      method: "GET",
      url: "/api/cabinet/documents/badAsecret-cabinet-path-id-token",
      headers: { cookie: owner }
    });
    assert.ok([400, 404].includes(malformedPath.statusCode), malformedPath.body);
    assert.doesNotMatch(malformedPath.body, /secret-cabinet-path-/);

    const notFound = await app.inject({ method: "GET", url: "/api/cabinet/documents/cab-missing", headers: { cookie: owner } });
    assert.equal(notFound.statusCode, 404, notFound.body);

    const after = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    assert.equal(after, before, "no audit row emitted for malformed/missing id");
  });
});

test("document-cabinet: e-sign prepare returns a stub envelope without state egress", async () => {
  await withApp(async app => {
    const owner = await login(app);
    const create = await app.inject({
      method: "POST",
      url: "/api/cabinet/documents",
      headers: { cookie: owner },
      payload: { title: "Esign probe", direction: "outgoing", linkedType: "customer", linkedId: "cust-ani", idempotencyKey: "cab-esign-1" }
    });
    const docId = create.json().document.id;

    const esign = await app.inject({
      method: "POST",
      url: "/api/cabinet/esign/prepare",
      headers: { cookie: owner },
      payload: { cabinetId: docId, signer: { name: "Անահիտ Ստորագրող", email: "anahit@armosphera.local" }, idempotencyKey: "cab-esign-prep-1" }
    });
    assert.equal(esign.statusCode, 200, esign.body);
    const env = esign.json();
    assert.ok(env.envelopeId, "envelopeId present");
    assert.equal(env.provider, "test-stub", "stub provider when STATE_INTEGRATION_MODE=test");
    assert.ok(["prepared", "pending"].includes(env.status), `status is prepared/pending: ${env.status}`);
  });
});

test("document-cabinet: e-sign prepare bridge writes state_integration_calls audit row with PII redaction", async () => {
  await withApp(async app => {
    const owner = await login(app);
    const create = await app.inject({
      method: "POST",
      url: "/api/cabinet/documents",
      headers: { cookie: owner },
      payload: { title: "Esign bridge probe", direction: "outgoing", linkedType: "customer", linkedId: "cust-bridge", idempotencyKey: "cab-esign-bridge-1" }
    });
    const docId = create.json().document.id;

    const before = app.db.prepare("SELECT COUNT(*) AS c FROM state_integration_calls").get().c;
    const esign = await app.inject({
      method: "POST",
      url: "/api/cabinet/esign/prepare",
      headers: { cookie: owner },
      payload: {
        cabinetId: docId,
        signer: { name: "Anahit Stepanyan", email: "anahit@armosphera.local", idNumber: "AN7654321" },
        idempotencyKey: "cab-esign-prep-bridge-1"
      }
    });
    assert.equal(esign.statusCode, 200, esign.body);
    const env = esign.json();
    assert.ok(env.envelopeId, "envelopeId present after bridge");
    assert.equal(env.provider, "test-stub", "stub provider routed via cabinet adapter");

    // Sub-plan 6 follow-up: the bridge must persist an audit row in
    // state_integration_calls so investigators can see the prepare
    // attempt without reading the per-org cabinet table.
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM state_integration_calls").get().c;
    assert.equal(after, before + 1, "state_integration_calls row must be written by the bridge");

    const row = app.db.prepare(
      "SELECT adapter, operation, request_id, status, request_json FROM state_integration_calls ORDER BY called_at DESC LIMIT 1"
    ).get();
    assert.equal(row.adapter, "cabinet", "audit row tagged with cabinet adapter");
    assert.equal(row.operation, "esign.prepare", "audit row tagged with esign.prepare operation");
    assert.equal(row.status, "prepared", "audit row records prepared status");
    assert.ok(row.request_id, "request_id present for cross-referencing with cabinet audit row");

    // PII redaction: the signer's idNumber must NOT be present in
    // cleartext in the persisted request_json. The hub's redactPII
    // replaces it with a [hash:sha256:<salt>:<digest>] marker.
    assert.ok(!row.request_json.includes("AN7654321"), "signer idNumber must not be persisted in cleartext");
    assert.ok(row.request_json.includes("[hash:sha256:"), "PII slot must be replaced with hashed marker");
  });
});
