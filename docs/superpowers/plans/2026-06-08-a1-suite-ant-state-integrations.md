# Sub-Plan 7: State Integrations (Гос. интеграции) — User Priority #7

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire A1 Suite into Armenian state services: State Revenue Committee (SRC) for tax reports / e-invoices, State Register of Legal Entities (SRLE / `e-register.am`) for counterparty verification, e-Government Gateway (`e-gov.am`) for e-signature, ID Card, Mobile ID, EKENG / e-customs for import/export declarations, licenses and permits. All adapters must run in `STATE_INTEGRATION_MODE=test` (stub) by default; real SOAP/REST calls opt in only with explicit env vars and audit.

**Architecture:** Extend the `server/stateIntegrations.js` stub created in sub-plan 1 with real adapter implementations behind a stable interface. Each adapter is its own module: `server/stateIntegrations/src.js`, `server/stateIntegrations/eRegister.js`, `server/stateIntegrations/eGov.js`, `server/stateIntegrations/customs.js`, `server/stateIntegrations/idCard.js`, `server/stateIntegrations/mobileId.js`. Each implements `prepare`, `send`, `fetchStatus`, `cancel`, `verifySignature`. The hub in `server/stateIntegrations.js` selects mode by env var and routes to the right adapter. A new test mode `test` returns deterministic canned responses that match the real adapter's contract (so the calling code is identical).

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. SOAP via `node:soap` or REST via `undici` depending on the real provider's docs. Local-only mode is the default; production opt-in via `STATE_INTEGRATION_MODE=production` + endpoint URLs + per-adapter API key in env. Crypto operations: Armenian e-sign uses `crypto` (RSA / ECDSA per `e-gov.am` spec); no third-party crypto unless required by the spec.

**Depends on:** sub-plan 0 (Pattern A skeleton), sub-plan 1 (cabinet for e-sign hook), sub-plan 6 (export for customs hook). All real SOAP/REST calls must be opt-in via `STATE_INTEGRATION_MODE=production` and explicit `*_ENABLED=1` per service; default = `test` (deterministic stubs).

---

## File Structure

- Create: `server/stateIntegrations.js` — hub module (extends sub-plan 1 stub) + adapter registry
- Create: `server/stateIntegrations/src.js` — SRC VAT / e-invoice adapter
- Create: `server/stateIntegrations/eRegister.js` — `e-register.am` counterparty lookup adapter
- Create: `server/stateIntegrations/eGov.js` — `e-gov.am` e-signature adapter
- Create: `server/stateIntegrations/customs.js` — EKENG customs declaration adapter
- Create: `server/stateIntegrations/idCard.js` — Armenian ID card verification adapter
- Create: `server/stateIntegrations/mobileId.js` — Mobile ID (Beeline / VivaCell / Ucom) challenge adapter
- Modify: `server/db.js` — add 4 new tables
- Modify: `server/app.js` — register the unified dispatch + status + audit routes
- Create: `web/src/stateIntegrations.jsx` — Owner-only status / audit / per-adapter toggle panel
- Modify: `web/src/main.jsx` — import + mount the panel in `Workspace`
- Modify: `HANDOFF.md` — record sub-plan 7 verification
- Create: `docs/STATE_INTEGRATIONS.md` — operator-facing doc: 6 adapters, env vars, data exchanged, legal basis
- Create: `test/state-integrations.test.js` — full Pattern A contract suite for the hub + per-adapter stubs

## DB additions

- `state_integration_calls` (id, org_id, adapter, operation, request_id, request_json, response_json, status, latency_ms, called_at)
- `state_integration_credentials` (id, org_id, adapter, alias, cert_alias, key_alias, created_at) — never store raw keys; reference macOS Keychain / env by alias
- `state_signatures` (id, org_id, document_id, adapter, signer_id_hash, signed_at, signature_b64, certificate_thumbprint, status)
- `state_id_verifications` (id, org_id, subject_id, adapter, verified_at, claims_json, evidence_doc_id)

## API surface (state-integration hub)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/state-int/:adapter/:operation` | Unified dispatch (e.g. `src/submit-vat`, `eregister/lookup`, `egov/sign`, `idcard/verify`, `mobileid/challenge`, `customs/declare-import`) |
| GET | `/api/state-int/:adapter/:operation/:requestId/status` | Poll status |
| GET | `/api/state-int/audit?from=...&to=...` | Read audit (auditor role) |

## Adapter contracts (each adapter implements these)

```js
// signature
async function prepare(input) { return { requestId, payload, status: "prepared" }; }
async function send(input) { return { requestId, status: "sent", providerRef }; }
async function fetchStatus({ providerRef }) { return { providerRef, status, lastCheckedAt, payload? }; }
async function cancel({ requestId }) { return { requestId, status: "cancelled" }; }
async function verifySignature({ documentId, signerClaims }) { return { verified: true|false, certificate, evidence }; }
```

## Acceptance

- All 6 adapters respond in test mode with deterministic envelopes.
- Calling a real adapter without `STATE_INTEGRATION_MODE=production` returns 403.
- Every call (success or failure) writes a `state_integration_calls` audit row.
- Signatures, ID verifications, and SRC submissions are first-class auditable events.

## Spine reused

`org_id`, `customers` (for e-register lookup), `vendors` (for customs), `employees` (for ID Card / Mobile ID), `cabinet_documents` (sub-plan 1), `export_documents` (sub-plan 6), `audit_events`, `idempotency_keys`, `legal_sources` (cite the relevant Armenian law for every adapter call).

## Deferred / explicit follow-up

- Real SOAP/XML signing against `e-gov.am` — requires a registered legal entity + a crypto cert.
- Real customs declaration submission — requires an EKENG-trusted integration account.
- ID Card / Mobile ID requires the operator to obtain a service-provider certificate from the Armenian Ministry of Justice.

---

## Tasks

### Task 1: DB migration — add 4 state-integration tables

**Files:**
- Modify: `server/db.js` (in the `initSchema` block, after the `export_documents` migration from sub-plan 6)
- Read: `server/db.js` to locate the existing `CREATE TABLE` statements and the `migrations` log table
- Test: `test/state-integrations.test.js` (will assert table presence in Task 2)

- [ ] **Step 1: Add the 4 tables to `initSchema`**

Inside the `initSchema` function in `server/db.js`, append after the last existing `CREATE TABLE` statement and before the closing of the schema block:

```js
db.exec(`
  CREATE TABLE IF NOT EXISTS state_integration_calls (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    adapter TEXT NOT NULL,
    operation TEXT NOT NULL,
    request_id TEXT NOT NULL,
    request_json TEXT NOT NULL,
    response_json TEXT,
    status TEXT NOT NULL,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    called_at TEXT NOT NULL,
    FOREIGN KEY (org_id) REFERENCES orgs(id)
  );
  CREATE INDEX IF NOT EXISTS idx_state_calls_org ON state_integration_calls(org_id, called_at);

  CREATE TABLE IF NOT EXISTS state_integration_credentials (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    adapter TEXT NOT NULL,
    alias TEXT NOT NULL,
    cert_alias TEXT,
    key_alias TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(org_id, adapter, alias),
    FOREIGN KEY (org_id) REFERENCES orgs(id)
  );

  CREATE TABLE IF NOT EXISTS state_signatures (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    adapter TEXT NOT NULL,
    signer_id_hash TEXT NOT NULL,
    signed_at TEXT NOT NULL,
    signature_b64 TEXT NOT NULL,
    certificate_thumbprint TEXT,
    status TEXT NOT NULL,
    FOREIGN KEY (org_id) REFERENCES orgs(id)
  );
  CREATE INDEX IF NOT EXISTS idx_state_sigs_doc ON state_signatures(document_id);

  CREATE TABLE IF NOT EXISTS state_id_verifications (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    adapter TEXT NOT NULL,
    verified_at TEXT NOT NULL,
    claims_json TEXT NOT NULL,
    evidence_doc_id TEXT,
    FOREIGN KEY (org_id) REFERENCES orgs(id)
  );
  CREATE INDEX IF NOT EXISTS idx_state_idv_subject ON state_id_verifications(subject_id);
`);
```

- [ ] **Step 2: Add the migration log line**

In the `recordMigration` call list at the bottom of `initSchema`, add:

```js
recordMigration(db, "2026-06-08-state-integrations");
```

- [ ] **Step 3: Run the existing test suite to verify the migration is additive**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, same test count as before. The new tables are additive and should not break any existing test.

- [ ] **Step 4: Commit the migration**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/db.js && git commit -m "feat(state-int): add 4 tables for state integration audit" && git push ant main
```

### Task 2: Hub + adapter registry with deterministic test-mode stubs

**Files:**
- Create: `server/stateIntegrations.js`
- Create: `test/state-integrations.test.js` (RED-first; commit before run)
- Test: `test/state-integrations.test.js`

- [ ] **Step 1: Write the RED test for the hub**

Create `test/state-integrations.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");
const { dispatch } = require("../server/stateIntegrations");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

test("state-int hub exposes 6 adapter names in test mode", () => {
  const adapters = ["src", "eregister", "egov", "idcard", "mobileid", "customs"];
  for (const name of adapters) {
    const mod = require(`../server/stateIntegrations/${name}`);
    assert.strictEqual(typeof mod.prepare, "function");
    assert.strictEqual(typeof mod.send, "function");
    assert.strictEqual(typeof mod.fetchStatus, "function");
    assert.strictEqual(typeof mod.cancel, "function");
    assert.strictEqual(typeof mod.verifySignature, "function");
  }
});

test("state-int hub: 401 on no-auth", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/state-int/src/submit-vat",
      payload: { period: "2026-Q1", netAmount: 100000, idempotencyKey: "k1" }
    });
    assert.strictEqual(res.statusCode, 401);
  } finally { await app.close(); }
});

test("state-int hub: 403 on missing app access (support role)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/state-int/src/submit-vat",
      headers: { cookie },
      payload: { period: "2026-Q1", netAmount: 100000, idempotencyKey: "k2" }
    });
    assert.strictEqual(res.statusCode, 403);
  } finally { await app.close(); }
});

test("state-int hub: 400 on malformed input", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/state-int/src/submit-vat",
      headers: { cookie },
      payload: { period: "bogus" }
    });
    assert.strictEqual(res.statusCode, 400);
  } finally { await app.close(); }
});

test("state-int hub: 200 happy path + audit row written", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const res = await app.inject({
      method: "POST",
      url: "/api/state-int/src/submit-vat",
      headers: { cookie },
      payload: { period: "2026-Q1", netAmount: 100000, vatRate: 20, idempotencyKey: "k3" }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.stateInt.status, "sent");
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.strictEqual(after, before + 1, "audit row must be written");
    const callCount = app.db.prepare("SELECT COUNT(*) AS c FROM state_integration_calls").get().c;
    assert.strictEqual(callCount, 1, "state_integration_calls row must be written");
  } finally { await app.close(); }
});

test("state-int hub: idempotent replay returns cached envelope, no duplicate audit", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    const payload = {
      method: "POST", url: "/api/state-int/eregister/lookup", headers: { cookie },
      payload: { taxId: "01234567", idempotencyKey: "k4" }
    };
    const first = await app.inject(payload);
    const second = await app.inject(payload);
    assert.strictEqual(first.statusCode, 200);
    assert.strictEqual(second.statusCode, 200);
    assert.deepStrictEqual(first.json(), second.json());
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c;
    assert.strictEqual(after, before + 1, "idempotency must suppress duplicate audit");
    const callCount = app.db.prepare("SELECT COUNT(*) AS c FROM state_integration_calls").get().c;
    assert.strictEqual(callCount, 1, "no duplicate call row on replay");
  } finally { await app.close(); }
});

test("state-int hub: 403 on production mode without opt-in env", async () => {
  const prev = process.env.STATE_INTEGRATION_MODE;
  process.env.STATE_INTEGRATION_MODE = "production";
  delete process.env.SRC_ENABLED;
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/state-int/src/submit-vat",
      headers: { cookie },
      payload: { period: "2026-Q1", netAmount: 1, vatRate: 20, idempotencyKey: "k5" }
    });
    assert.strictEqual(res.statusCode, 403);
  } finally {
    if (prev === undefined) delete process.env.STATE_INTEGRATION_MODE;
    else process.env.STATE_INTEGRATION_MODE = prev;
    await app.close();
  }
});

test("state-int hub: e-sign adapter returns deterministic signature envelope", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/state-int/egov/sign",
      headers: { cookie },
      payload: {
        documentId: "doc-1",
        signerClaims: { fullName: "Test User", idNumber: "AN1234567" },
        idempotencyKey: "k6"
      }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(body.stateInt.signatureB64);
    assert.ok(body.stateInt.certificateThumbprint);
  } finally { await app.close(); }
});

test("state-int audit endpoint requires auditor role", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "GET",
      url: "/api/state-int/audit",
      headers: { cookie }
    });
    assert.strictEqual(res.statusCode, 403);
  } finally { await app.close(); }
});
```

- [ ] **Step 2: Run tests to verify RED**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/state-integrations.test.js 2>&1 | tail -10
```

Expected: FAIL — adapter modules do not exist yet.

- [ ] **Step 3: Commit the RED tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add test/state-integrations.test.js && git commit -m "test(state-int): define hub + adapter contract suite" && git push ant main
```

- [ ] **Step 4: Implement the hub `server/stateIntegrations.js`**

```js
"use strict";
const path = require("node:path");
const crypto = require("node:crypto");

const SUPPORTED = ["src", "eregister", "egov", "idcard", "mobileid", "customs"];

function loadAdapter(name) {
  if (!SUPPORTED.includes(name)) {
    const err = new Error(`unknown adapter: ${name}`);
    err.statusCode = 404;
    throw err;
  }
  return require(path.join(__dirname, "stateIntegrations", `${name}.js`));
}

function currentMode() {
  return process.env.STATE_INTEGRATION_MODE === "production" ? "production" : "test";
}

function isAdapterEnabled(name) {
  if (currentMode() !== "production") return true;
  return process.env[`${name.toUpperCase()}_ENABLED`] === "1";
}

function ensureProductionOptIn(name) {
  if (currentMode() === "production" && !isAdapterEnabled(name)) {
    const err = new Error(`${name} adapter requires ${name.toUpperCase()}_ENABLED=1 in production`);
    err.statusCode = 403;
    throw err;
  }
}

function makeRequestId(orgId, adapter, operation) {
  return `si-${orgId.slice(0, 6)}-${adapter}-${operation}-${crypto.randomBytes(6).toString("hex")}`;
}

async function dispatch({ db, orgId, userId, adapter, operation, input }) {
  ensureProductionOptIn(adapter);
  const mod = loadAdapter(adapter);
  const requestId = makeRequestId(orgId, adapter, operation);
  const started = Date.now();
  const requestJson = JSON.stringify({ operation, input });
  const prep = await mod.prepare({ requestId, input });
  const sent = await mod.send({ requestId, payload: prep.payload });
  const latency = Date.now() - started;
  const responseJson = JSON.stringify({ prepare: prep, send: sent });
  const callId = `sic-${crypto.randomBytes(8).toString("hex")}`;
  db.prepare(`INSERT INTO state_integration_calls
    (id, org_id, adapter, operation, request_id, request_json, response_json, status, latency_ms, called_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    callId, orgId, adapter, operation, requestId, requestJson, responseJson, sent.status, latency, new Date().toISOString()
  );
  if (adapter === "egov" && operation === "sign") {
    const sigId = `sig-${crypto.randomBytes(8).toString("hex")}`;
    const signerHash = crypto.createHash("sha256").update(String(input.signerClaims?.idNumber || "")).digest("hex");
    const docId = String(input.documentId || "");
    db.prepare(`INSERT INTO state_signatures
      (id, org_id, document_id, adapter, signer_id_hash, signed_at, signature_b64, certificate_thumbprint, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      sigId, orgId, docId, adapter, signerHash, new Date().toISOString(),
      sent.signatureB64 || "", sent.certificateThumbprint || "", "valid"
    );
  }
  if (adapter === "idcard" && operation === "verify") {
    const verId = `idv-${crypto.randomBytes(8).toString("hex")}`;
    db.prepare(`INSERT INTO state_id_verifications
      (id, org_id, subject_id, adapter, verified_at, claims_json, evidence_doc_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      verId, orgId, String(input.subjectId || "unknown"), adapter,
      new Date().toISOString(), JSON.stringify(sent.claims || {}), null
    );
  }
  return { requestId, status: sent.status, ...sent };
}

module.exports = { dispatch, loadAdapter, currentMode, isAdapterEnabled, SUPPORTED };
```

- [ ] **Step 5: Run focused tests (still RED — adapter modules not built)**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/state-integrations.test.js 2>&1 | tail -10
```

Expected: still FAIL — adapter modules do not exist.

- [ ] **Step 6: Commit the hub**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/stateIntegrations.js && git commit -m "feat(state-int): add hub with mode-aware dispatch" && git push ant main
```

### Task 3: Implement the 6 test-mode adapter stubs

**Files:**
- Create: `server/stateIntegrations/src.js`
- Create: `server/stateIntegrations/eRegister.js`
- Create: `server/stateIntegrations/eGov.js`
- Create: `server/stateIntegrations/idCard.js`
- Create: `server/stateIntegrations/mobileId.js`
- Create: `server/stateIntegrations/customs.js`

- [ ] **Step 1: Create `server/stateIntegrations/src.js` (State Revenue Committee)**

```js
"use strict";
const crypto = require("node:crypto");

function validateVatPayload(input) {
  const period = String(input.period || "");
  if (!/^\d{4}-Q[1-4]$/.test(period)) {
    const err = new Error("period must match YYYY-Q[1-4]");
    err.statusCode = 400;
    throw err;
  }
  const net = Number(input.netAmount);
  if (!Number.isFinite(net) || net < 0 || net > 1e12) {
    const err = new Error("netAmount must be 0..1e12");
    err.statusCode = 400;
    throw err;
  }
  const vat = Number(input.vatRate || 0);
  if (!Number.isFinite(vat) || vat < 0 || vat > 50) {
    const err = new Error("vatRate must be 0..50");
    err.statusCode = 400;
    throw err;
  }
}

async function prepare({ requestId, input }) {
  validateVatPayload(input);
  return {
    requestId,
    payload: {
      declarationType: "VAT-RETURN",
      period: input.period,
      netAmount: Number(input.netAmount),
      vatRate: Number(input.vatRate || 0),
      vatAmount: Number((input.netAmount * (input.vatRate || 0) / 100).toFixed(2)),
      preparedAt: new Date().toISOString()
    },
    status: "prepared"
  };
}

async function send({ requestId }) {
  return {
    requestId,
    status: "sent",
    providerRef: `SRC-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    acceptedAt: new Date().toISOString()
  };
}

async function fetchStatus({ providerRef }) {
  return { providerRef, status: "accepted", lastCheckedAt: new Date().toISOString() };
}

async function cancel({ requestId }) {
  return { requestId, status: "cancelled" };
}

async function verifySignature() {
  return { verified: true, certificate: null, evidence: null };
}

module.exports = { prepare, send, fetchStatus, cancel, verifySignature };
```

- [ ] **Step 2: Create `server/stateIntegrations/eRegister.js`**

```js
"use strict";
const crypto = require("node:crypto");

function validate(input) {
  const taxId = String(input.taxId || "");
  if (!/^\d{8}$/.test(taxId)) {
    const err = new Error("taxId must be 8 digits (Armenian TIN format)");
    err.statusCode = 400;
    throw err;
  }
}

async function prepare({ requestId, input }) {
  validate(input);
  return {
    requestId,
    payload: { queryType: "LEGAL_ENTITY_LOOKUP", taxId: input.taxId },
    status: "prepared"
  };
}

async function send({ requestId }) {
  const taxId = arguments[0]?.payload?.taxId;
  return {
    requestId,
    status: "sent",
    providerRef: `SRLE-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    record: {
      taxId: taxId || "00000000",
      legalName: "Փորձնական ՍՊԸ (Test LLC)",
      status: "ACTIVE",
      registeredOn: "2018-04-12",
      address: "Երևան, Աբովյան 1"
    }
  };
}

async function fetchStatus({ providerRef }) {
  return { providerRef, status: "completed", lastCheckedAt: new Date().toISOString() };
}

async function cancel({ requestId }) {
  return { requestId, status: "cancelled" };
}

async function verifySignature() {
  return { verified: true, certificate: null, evidence: null };
}

module.exports = { prepare, send, fetchStatus, cancel, verifySignature };
```

- [ ] **Step 3: Create `server/stateIntegrations/eGov.js` (e-signature)**

```js
"use strict";
const crypto = require("node:crypto");

function validate(input) {
  if (!input.documentId || typeof input.documentId !== "string") {
    const err = new Error("documentId is required");
    err.statusCode = 400;
    throw err;
  }
  const claims = input.signerClaims || {};
  if (!/^AN\d{7}$/.test(String(claims.idNumber || ""))) {
    const err = new Error("signerClaims.idNumber must match AN\\d{7}");
    err.statusCode = 400;
    throw err;
  }
}

async function prepare({ requestId, input }) {
  validate(input);
  return {
    requestId,
    payload: {
      documentId: input.documentId,
      signerClaims: input.signerClaims,
      signedBytes: crypto.createHash("sha256").update(input.documentId).digest("hex")
    },
    status: "prepared"
  };
}

async function send({ requestId, payload }) {
  const key = crypto.createHmac("sha256", "test-egov-signing-key").update(payload.signedBytes);
  return {
    requestId,
    status: "sent",
    providerRef: `EGOV-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    signatureB64: key.digest("base64"),
    certificateThumbprint: crypto.createHash("sha1").update("test-cert").digest("hex"),
    signedAt: new Date().toISOString()
  };
}

async function fetchStatus({ providerRef }) {
  return { providerRef, status: "completed", lastCheckedAt: new Date().toISOString() };
}

async function cancel({ requestId }) {
  return { requestId, status: "cancelled" };
}

async function verifySignature({ payload }) {
  return {
    verified: true,
    certificate: { thumbprint: crypto.createHash("sha1").update("test-cert").digest("hex") },
    evidence: { documentId: payload?.documentId }
  };
}

module.exports = { prepare, send, fetchStatus, cancel, verifySignature };
```

- [ ] **Step 4: Create `server/stateIntegrations/idCard.js`**

```js
"use strict";
const crypto = require("node:crypto");

function validate(input) {
  const sid = String(input.subjectId || "");
  if (!/^AN\d{7}$/.test(sid)) {
    const err = new Error("subjectId must match AN\\d{7}");
    err.statusCode = 400;
    throw err;
  }
}

async function prepare({ requestId, input }) {
  validate(input);
  return { requestId, payload: { subjectId: input.subjectId }, status: "prepared" };
}

async function send({ requestId }) {
  return {
    requestId,
    status: "sent",
    providerRef: `IDCARD-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    claims: {
      fullName: "Test User",
      dateOfBirth: "1990-01-01",
      nationality: "AM",
      documentNumber: "AN1234567"
    }
  };
}

async function fetchStatus({ providerRef }) {
  return { providerRef, status: "completed", lastCheckedAt: new Date().toISOString() };
}

async function cancel({ requestId }) {
  return { requestId, status: "cancelled" };
}

async function verifySignature() {
  return { verified: true, certificate: null, evidence: null };
}

module.exports = { prepare, send, fetchStatus, cancel, verifySignature };
```

- [ ] **Step 5: Create `server/stateIntegrations/mobileId.js`**

```js
"use strict";
const crypto = require("node:crypto");

function validate(input) {
  const phone = String(input.phone || "");
  if (!/^\+374\d{8}$/.test(phone)) {
    const err = new Error("phone must match +374XXXXXXXX");
    err.statusCode = 400;
    throw err;
  }
}

async function prepare({ requestId, input }) {
  validate(input);
  return { requestId, payload: { phone: input.phone, op: "challenge" }, status: "prepared" };
}

async function send({ requestId }) {
  return {
    requestId,
    status: "sent",
    providerRef: `MID-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    challengeId: crypto.randomBytes(8).toString("hex"),
    ttl: 120
  };
}

async function fetchStatus({ providerRef }) {
  return { providerRef, status: "awaiting_user", lastCheckedAt: new Date().toISOString() };
}

async function cancel({ requestId }) {
  return { requestId, status: "cancelled" };
}

async function verifySignature() {
  return { verified: true, certificate: null, evidence: null };
}

module.exports = { prepare, send, fetchStatus, cancel, verifySignature };
```

- [ ] **Step 6: Create `server/stateIntegrations/customs.js` (EKENG / e-customs)**

```js
"use strict";
const crypto = require("node:crypto");

function validate(input) {
  const declType = String(input.declarationType || "");
  if (!["IMPORT", "EXPORT", "TRANSIT"].includes(declType)) {
    const err = new Error("declarationType must be IMPORT | EXPORT | TRANSIT");
    err.statusCode = 400;
    throw err;
  }
  const hsCode = String(input.hsCode || "");
  if (!/^\d{6,10}$/.test(hsCode)) {
    const err = new Error("hsCode must be 6-10 digits");
    err.statusCode = 400;
    throw err;
  }
  const value = Number(input.declaredValue);
  if (!Number.isFinite(value) || value < 0) {
    const err = new Error("declaredValue must be a non-negative number");
    err.statusCode = 400;
    throw err;
  }
}

async function prepare({ requestId, input }) {
  validate(input);
  return {
    requestId,
    payload: {
      declarationType: input.declarationType,
      hsCode: input.hsCode,
      declaredValue: input.declaredValue,
      currency: input.currency || "AMD"
    },
    status: "prepared"
  };
}

async function send({ requestId }) {
  return {
    requestId,
    status: "sent",
    providerRef: `EKENG-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    acceptedAt: new Date().toISOString()
  };
}

async function fetchStatus({ providerRef }) {
  return { providerRef, status: "in_review", lastCheckedAt: new Date().toISOString() };
}

async function cancel({ requestId }) {
  return { requestId, status: "cancelled" };
}

async function verifySignature() {
  return { verified: true, certificate: null, evidence: null };
}

module.exports = { prepare, send, fetchStatus, cancel, verifySignature };
```

- [ ] **Step 7: Run focused tests to verify GREEN**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/state-integrations.test.js 2>&1 | tail -20
```

Expected: still FAIL — route not registered yet. Adapter module loads pass; route + audit pass fail.

- [ ] **Step 8: Commit the 6 adapter stubs**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/stateIntegrations/ && git commit -m "feat(state-int): add 6 deterministic test-mode adapter stubs" && git push ant main
```

### Task 4: Wire the unified dispatch + status + audit routes

**Files:**
- Modify: `server/app.js` (add import near the top with other engine imports, and 3 new routes near the existing export/customs routes)
- Read: `server/app.js` to locate `requireAppAccess`, `recordAudit`, `idempotency_keys` pattern
- Test: `test/state-integrations.test.js`

- [ ] **Step 1: Add the import**

Near other engine imports at the top of `server/app.js`:

```js
const stateInt = require("./stateIntegrations");
```

- [ ] **Step 2: Add the dispatch route**

After the existing export routes (added in sub-plan 6), add:

```js
app.post("/api/state-int/:adapter/:operation", async (request, reply) => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "state");
  const { adapter, operation } = request.params;
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) {
    const err = new Error("idempotencyKey is required");
    err.statusCode = 400;
    throw err;
  }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  const result = await stateInt.dispatch({
    db, orgId: user.org_id, userId: user.id, adapter, operation, input: body
  });
  const envelope = { ok: true, stateInt: { adapter, operation, ...result } };
  db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(
    randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString()
  );
  recordAudit(db, user, "state-int.dispatch", "state_integration_calls", null, { adapter, operation, requestId: result.requestId });
  return envelope;
});
```

- [ ] **Step 3: Add the status route**

```js
app.get("/api/state-int/:adapter/:operation/:requestId/status", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "state");
  const { adapter, operation, requestId } = request.params;
  const row = db.prepare("SELECT response_json, status, called_at FROM state_integration_calls WHERE org_id = ? AND request_id = ? ORDER BY called_at DESC LIMIT 1").get(user.org_id, requestId);
  if (!row) {
    const err = new Error("requestId not found");
    err.statusCode = 404;
    throw err;
  }
  return { ok: true, stateIntStatus: { adapter, operation, requestId, status: row.status, calledAt: row.called_at, response: JSON.parse(row.response_json) } };
});
```

- [ ] **Step 4: Add the audit route (auditor-only)**

```js
app.get("/api/state-int/audit", async request => {
  const user = await app.auth(request);
  requireRole(user, "auditor");
  const url = new URL(request.url, "http://localhost");
  const from = url.searchParams.get("from") || "1970-01-01";
  const to = url.searchParams.get("to") || "2999-12-31";
  const rows = db.prepare("SELECT id, adapter, operation, request_id, status, latency_ms, called_at FROM state_integration_calls WHERE org_id = ? AND called_at BETWEEN ? AND ? ORDER BY called_at DESC LIMIT 200").all(user.org_id, from, to);
  return { ok: true, audit: rows };
});
```

- [ ] **Step 5: Run focused tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/state-integrations.test.js 2>&1 | tail -20
```

Expected: PASS (10 tests).

- [ ] **Step 6: Run full suite to confirm no regressions**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, total test count increases by 10.

- [ ] **Step 7: Commit the routes**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/app.js && git commit -m "feat(state-int): wire dispatch, status, and audit routes" && git push ant main
```

### Task 5: React panel — Owner-only state-integration admin

**Files:**
- Create: `web/src/stateIntegrations.jsx`
- Modify: `web/src/main.jsx` (import + mount the panel in `Workspace`)
- Read: `web/src/copilot.jsx` for style reference
- Build: `npm run build:ui`

- [ ] **Step 1: Create the component**

```jsx
import React, { useEffect, useState } from "react";

export function StateIntegrationsPanel({ api, role, actionState, setActionState }) {
  const [adapter, setAdapter] = useState("src");
  const [operation, setOperation] = useState("submit-vat");
  const [payload, setPayload] = useState(JSON.stringify({ period: "2026-Q1", netAmount: 100000, vatRate: 20 }, null, 2));
  const [result, setResult] = useState(null);
  const [audit, setAudit] = useState([]);
  const busy = actionState === "state-int:dispatch";
  const isAuditor = role === "auditor" || role === "owner";

  async function dispatchCall() {
    setActionState("state-int:dispatch");
    try {
      const idempotencyKey = `ui-${Date.now()}`;
      const body = JSON.parse(payload);
      const res = await api(`/api/state-int/${adapter}/${operation}`, {
        method: "POST",
        body: { ...body, idempotencyKey }
      });
      setResult(res);
    } catch (err) {
      setResult({ ok: false, error: String(err) });
    } finally {
      setActionState("");
    }
  }

  async function loadAudit() {
    if (!isAuditor) return;
    const res = await api(`/api/state-int/audit`);
    setAudit(res.audit || []);
  }

  useEffect(() => { loadAudit(); }, []);

  return (
    <article className="panel state-int-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Կառավարության ինտեգրացիաներ</span>
          <h2>State Integrations Hub</h2>
        </div>
        <div className="aging-badge">MODE: {process.env.STATE_INTEGRATION_MODE || "test"}</div>
      </div>
      <div className="inline-form">
        <label>Ադապտեր
          <select value={adapter} onChange={e => setAdapter(e.target.value)}>
            <option value="src">SRC (Հարկային կոմիտե)</option>
            <option value="eregister">e-Register.am</option>
            <option value="egov">e-Gov (Է-ստուխ)</option>
            <option value="idcard">ID Card</option>
            <option value="mobileid">Mobile ID</option>
            <option value="customs">e-Customs (EKENG)</option>
          </select>
        </label>
        <label>Գործողություն
          <input value={operation} onChange={e => setOperation(e.target.value)} />
        </label>
      </div>
      <div className="row">
        <label className="section-label">JSON մուտքագրվող</label>
        <textarea value={payload} onChange={e => setPayload(e.target.value)} rows={6} />
      </div>
      <div className="inline-form">
        <button className="mini-action" type="button" disabled={busy} onClick={dispatchCall}>
          {busy ? "Ուղարկվում է..." : "Ուղարկել"}
        </button>
        {isAuditor && (
          <button className="mini-action" type="button" onClick={loadAudit}>Թարմացնել audit</button>
        )}
      </div>
      {result && (
        <div className="copilot-result">
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
      {isAuditor && audit.length > 0 && (
        <div className="row">
          <span className="section-label">Վերջին կանչերը ({audit.length})</span>
          <ul>
            {audit.slice(0, 10).map(call => (
              <li key={call.id}>
                <code>{call.called_at}</code> · {call.adapter}/{call.operation} · <span className="aging-badge">{call.status}</span> · {call.latency_ms}ms
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Mount the panel in `web/src/main.jsx`**

Find the imports near the top of `web/src/main.jsx` and add:

```jsx
import { StateIntegrationsPanel } from "./stateIntegrations.jsx";
```

Inside the `Workspace` component, near other panel mounts, add:

```jsx
<StateIntegrationsPanel
  api={api}
  role={role}
  actionState={actionState}
  setActionState={setActionState}
/>
```

- [ ] **Step 3: Build the UI**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm run build:ui 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 4: Commit UI integration**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add web/src/stateIntegrations.jsx web/src/main.jsx && git commit -m "feat(state-int): mount Owner/auditor admin panel" && git push ant main
```

### Task 6: Documentation + HANDOFF update

**Files:**
- Create: `docs/STATE_INTEGRATIONS.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Create the operator-facing doc**

```markdown
# State Integrations (Гос. интеграции)

> **Status (2026-06-08):** Contracts and test-mode stubs are shipped. Real SOAP/REST
> calls to live Armenian government endpoints are gated behind `STATE_INTEGRATION_MODE=production`
> and per-adapter `*_ENABLED=1` env vars. Real adapters require legal sign-off, registered
> legal entity, and per-service credentials (see "Credentials" below).

## Adapters shipped

| Adapter | Armenian name | Default mode | Production env opt-in | Data exchanged |
|---|---|---|---|---|
| `src` | Հարկային կոմիտե (SRC) | test | `SRC_ENABLED=1` | VAT returns, e-invoices |
| `eregister` | Իրավաբանական անձանց ռեեստր | test | `EREGISTER_ENABLED=1` | Counterparty TIN lookup |
| `egov` | Է-կառավարություն (e-gov.am) | test | `EGOV_ENABLED=1` | Document e-signature |
| `idcard` | Անձնագիր | test | `IDCARD_ENABLED=1` | ID card claims |
| `mobileid` | Բջջային ID | test | `MOBILEID_ENABLED=1` | Mobile-ID challenges |
| `customs` | Մաքսային (EKENG) | test | `CUSTOMS_ENABLED=1` | Import/export declarations |

## Environment variables

```
STATE_INTEGRATION_MODE=test|production       # default: test
SRC_ENDPOINT=https://...                     # production only
SRC_ENABLED=1                                # production only
EREGISTER_ENDPOINT=...                       # production only
EGOV_SIGNING_KEY_ALIAS=armosphera-signing    # alias only; raw key in macOS Keychain
# ...etc
```

## Audit trail

Every call writes a row to `state_integration_calls` with the request/response JSON,
status, and latency. Signatures additionally write to `state_signatures`; ID verifications
write to `state_id_verifications`. Read via `GET /api/state-int/audit` (auditor role).

## Legal sources

- `legal_sources` table stores citations to the relevant Armenian law for each adapter call.
  Examples: RA Tax Code Art. 44 (VAT), RA Government Decree N 198-N (e-signature),
  RA Customs Code Art. 175 (declarations).

## Follow-up (NOT shipped in MVP)

- Real SOAP/XML signing against `e-gov.am` — requires registered legal entity + crypto cert.
- Real customs declaration submission — requires EKENG-trusted integration account.
- ID Card / Mobile ID requires operator's service-provider certificate from the Ministry of Justice.
```

- [ ] **Step 2: Update `HANDOFF.md`**

Replace the first line with:

```markdown
_Last updated: 2026-06-08 · main after state-integrations · N tags · M tests (M pass, 0 fail, 0 cancelled)_
```

Add a bullet:

```markdown
- **State Integrations (Гос. интеграции)** — DONE: hub + 6 deterministic test-mode adapter stubs (SRC, e-Register.am, e-Gov, ID Card, Mobile ID, e-Customs) + dispatch/status/audit routes + Owner/auditor React panel + 4 DB tables; production opt-in gated by `STATE_INTEGRATION_MODE=production` + per-adapter `*_ENABLED=1`.
```

- [ ] **Step 3: Commit the documentation**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add docs/STATE_INTEGRATIONS.md HANDOFF.md && git commit -m "docs(state-int): operator guide + HANDOFF verification" && git push ant main
```

### Task 7: Final verification + tag

**Files:**
- (no file changes; verification only)

- [ ] **Step 1: Run the full test suite**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, total test count includes the 10 new state-integrations tests.

- [ ] **Step 2: Verify build still passes**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm run build:ui 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 3: Verify the audit count increases by exactly 1 per successful dispatch**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/state-integrations.test.js 2>&1 | tail -20
```

Expected: 10 tests pass, including the idempotent-replay test which asserts `audit_events` increases by exactly 1 across two identical calls.

- [ ] **Step 4: Tag the MVP**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git tag state-int-mvp && git push ant state-int-mvp
```

- [ ] **Step 5: Tag commit (recorded separately in `HANDOFF.md` if needed)**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git log --oneline -5
```

Expected: 7 new commits visible, `state-int-mvp` tag pointing to the latest.

---

## Final Self-Review Checklist (sub-plan 7)

- [ ] 4 new tables (`state_integration_calls`, `state_integration_credentials`, `state_signatures`, `state_id_verifications`) created
- [ ] `server/stateIntegrations.js` hub implements mode-aware dispatch (`test` / `production`)
- [ ] All 6 adapter modules (src, eregister, egov, idcard, mobileid, customs) implement the 5-method contract
- [ ] `test/state-integrations.test.js` covers 401 (no-auth), 403 (missing app access), 400 (malformed input), 200 (happy path), audit row written (+1), and idempotent replay (no duplicate audit)
- [ ] Production mode without `*_ENABLED=1` returns 403
- [ ] E-sign adapter writes to `state_signatures`; ID verification writes to `state_id_verifications`
- [ ] `npm test` total count increases by 10
- [ ] `npm run build:ui` succeeds
- [ ] React `StateIntegrationsPanel` mounted, Armenian-first labels, reuses `.panel`, `.panel-head`, `.inline-form`, `.mini-action`, `.copilot-result`, `.row`, `.section-label`, `.aging-badge`
- [ ] `docs/STATE_INTEGRATIONS.md` documents 6 adapters, env-var opt-ins, data exchanged, and legal basis
- [ ] `HANDOFF.md` updated with sub-plan 7 bullet
- [ ] `state-int-mvp` tag pushed to `ant`
