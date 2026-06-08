# Sub-Plan 0: Pattern A Skeleton + Healthcheck Example

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the shared Pattern A skeleton (pure engine + thin route + React panel + `node --test` contract tests) with a trivial `healthcheck` example module so the convention is provable and every later sub-plan can reference it.

**Architecture:** A `server/<module>.js` module exports pure functions; a thin `app.post('/api/<module>/<verb>')` handler in `server/app.js` calls the module, enforces auth + app access + input validation + audit + idempotency, and returns a typed envelope. The React `web/src/<module>.jsx` component uses the existing `panel` design system. A `test/<module>.test.js` file uses `buildApp({ dbPath: ":memory:" })` + `app.inject` to prove all five spine contracts (auth, app access, input validation, role gate, audit, idempotency) in one pass.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite` `DatabaseSync`, `node --test`, React + Vite. The example module is intentionally trivial (echo with timestamp) so the pattern is visible without business-logic noise.

**Depends on:** nothing (first sub-plan to execute).

---

## File Structure

- Create: `server/healthcheck.js` — pure engine, no DB.
- Modify: `server/app.js` — add the route after the existing `/api/health` line.
- Create: `web/src/healthcheck.jsx` — one React panel that calls the route and shows the response.
- Modify: `web/src/main.jsx` — import + mount the panel.
- Modify: `web/src/styles.css` — reuse existing classes; no new CSS unless needed.
- Create: `test/healthcheck.test.js` — `node --test` contract suite.

## Cross-cutting spine reused

- `org_id` from `app.auth`.
- `audit_events` row written on every successful mutation.
- `app_assignments` / `requireAppAccess` enforces "health" app role.
- `idempotency_keys` dedupes replay.

## Pattern A contract (this is the contract every later sub-plan must satisfy)

1. **Pure engine**: `server/<module>.js` has `require('node:sqlite')` and `require('fastify')` excluded; the file passes `node --check` and is unit-testable without an app instance.
2. **Thin route**: `app.post('/api/<module>/<verb>')` does auth → app-access → validation → call pure function → audit → respond `{ ok: true, <module>: result }`. No business logic in the route.
3. **React panel**: `web/src/<module>.jsx` exports a named component, mounted in `Workspace` next to the relevant domain. Uses `.panel`, `.panel-head`, `.inline-form`, `.mini-action`.
4. **`node --test` contract suite**: auth gate (401), app access (403), input validation (400), happy path (200), audit row written, idempotent replay (same response, no duplicate audit), period-lock (if Finance-touching), malformed-id guard.
5. **Localization**: Armenian-first labels via `web/src/locale.js`; no English-only fields.

## Task 1: Write the RED test file

**Files:**
- Create: `test/healthcheck.test.js`
- Read: `test/api.test.js` (style reference)
- Read: `test/copilot.test.js` (style reference)

- [ ] **Step 1: Create the test file with the full contract**

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

test("healthcheck is auth-gated", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/healthcheck/ping", payload: { message: "hi" } });
    assert.strictEqual(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("healthcheck ping requires app access", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/healthcheck/ping",
      headers: { cookie },
      payload: { message: "hi" }
    });
    assert.strictEqual(res.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("healthcheck ping validates input", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/healthcheck/ping",
      headers: { cookie },
      payload: {}
    });
    assert.strictEqual(res.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("healthcheck ping returns deterministic echo + audit row", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    const res = await app.inject({
      method: "POST",
      url: "/api/healthcheck/ping",
      headers: { cookie },
      payload: { message: "skeleton", idempotencyKey: "hc-1" }
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.healthcheck.message, "skeleton");
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(body.healthcheck.respondedAt));
    const after = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    assert.strictEqual(after, before + 1, "audit_events row must be written");
  } finally {
    await app.close();
  }
});

test("healthcheck ping is idempotent on replay", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    const payload = { method: "POST", url: "/api/healthcheck/ping", headers: { cookie }, payload: { message: "skeleton", idempotencyKey: "hc-2" } };
    const first = await app.inject(payload);
    const second = await app.inject(payload);
    assert.strictEqual(first.statusCode, 200);
    assert.strictEqual(second.statusCode, 200);
    assert.deepStrictEqual(first.json(), second.json());
    const after = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    assert.strictEqual(after, before + 1, "idempotency must suppress duplicate audit row");
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/healthcheck.test.js 2>&1 | tail -20
```

Expected: FAIL with `404` for `/api/healthcheck/ping`.

- [ ] **Step 3: Commit RED tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add test/healthcheck.test.js && git commit -m "test(healthcheck): define Pattern A contract" && git push ant main
```

## Task 2: Add the pure engine module

**Files:**
- Create: `server/healthcheck.js`

- [ ] **Step 1: Create the engine**

```js
"use strict";

function buildPing({ message, now }) {
  const text = String(message || "").trim();
  if (text.length < 1 || text.length > 200) {
    const err = new Error("message must be 1-200 chars");
    err.statusCode = 400;
    throw err;
  }
  return {
    message: text,
    respondedAt: now || new Date().toISOString()
  };
}

module.exports = { buildPing };
```

- [ ] **Step 2: Run focused tests (still RED — route not registered yet)**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/healthcheck.test.js 2>&1 | tail -10
```

Expected: still FAIL with `404`.

- [ ] **Step 3: Commit the engine**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/healthcheck.js && git commit -m "feat(healthcheck): add pure ping engine" && git push ant main
```

## Task 3: Wire the route in `server/app.js`

**Files:**
- Modify: `server/app.js` (add import near top and route near other health routes)
- Read: `server/app.js` (locate the existing `/api/health` route and the `requireAppAccess` / `recordAudit` / `idempotency` helpers)

- [ ] **Step 1: Add the import**

Near other engine imports at the top of `server/app.js`:

```js
const healthcheck = require("./healthcheck");
```

- [ ] **Step 2: Add the route after the existing `/api/health` route**

```js
app.post("/api/healthcheck/ping", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "health");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) {
    const err = new Error("idempotencyKey is required");
    err.statusCode = 400;
    throw err;
  }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  const result = healthcheck.buildPing({ message: body.message, now: new Date().toISOString() });
  const envelope = { ok: true, healthcheck: result };
  db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(
    randomId("idem"), user.org_id, idem, JSON.stringify(envelope), new Date().toISOString()
  );
  recordAudit(db, user, "healthcheck.ping", "healthcheck", user.id, { message: result.message, idempotencyKey: idem });
  return envelope;
});
```

- [ ] **Step 3: Run focused tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/healthcheck.test.js 2>&1 | tail -10
```

Expected: PASS (5 tests).

- [ ] **Step 4: Run the full test suite to confirm no regressions**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, total test count increases by 5.

- [ ] **Step 5: Commit the route**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/app.js test/healthcheck.test.js && git commit -m "feat(healthcheck): wire /api/healthcheck/ping with idempotency" && git push ant main
```

## Task 4: Add the React panel

**Files:**
- Create: `web/src/healthcheck.jsx`
- Read: `web/src/copilot.jsx` (style reference)

- [ ] **Step 1: Create the component**

```jsx
import React, { useState } from "react";

export function HealthcheckPanel({ onPing, actionState }) {
  const [message, setMessage] = useState("skeleton");
  const [result, setResult] = useState(null);
  const busy = actionState === "healthcheck:ping";
  async function ping() {
    const response = await onPing({ message, idempotencyKey: `ui-${Date.now()}` });
    setResult(response);
  }
  return (
    <article className="panel healthcheck-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Pattern A skeleton</span>
          <h2>Healthcheck ping</h2>
        </div>
      </div>
      <div className="inline-form">
        <input value={message} onChange={event => setMessage(event.target.value)} />
        <button className="mini-action" type="button" disabled={busy} onClick={ping}>{busy ? "Pinging" : "Ping"}</button>
      </div>
      {result && (
        <div className="copilot-result">
          <p>echo: <strong>{result.message}</strong></p>
          <p className="action-status">at {result.respondedAt}</p>
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Mount the panel in `web/src/main.jsx`**

Find the imports near the top of `web/src/main.jsx` and add:

```jsx
import { HealthcheckPanel } from "./healthcheck.jsx";
```

In `Workspace`, near other panel mounts, add:

```jsx
const pingHealthcheck = async payload => {
  setActionState("healthcheck:ping");
  setActionError("");
  try {
    return await api("/api/healthcheck/ping", { method: "POST", body: payload });
  } finally {
    setActionState("");
  }
};
```

And render `<HealthcheckPanel onPing={pingHealthcheck} actionState={actionState} />` near the existing panels.

- [ ] **Step 3: Build the UI**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm run build:ui 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 4: Commit UI integration**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add web/src/healthcheck.jsx web/src/main.jsx && git commit -m "feat(healthcheck): mount Pattern A skeleton panel" && git push ant main
```

## Task 5: Update handoff and tag

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update the first status line and add a completed bullet**

Replace the first line in `HANDOFF.md` with the new tag count and test result, e.g.:

```markdown
_Last updated: 2026-06-08 · main after Pattern A skeleton · N tags · M tests (M pass, 0 fail, 0 cancelled)_
```

Add a bullet:

```markdown
- **Pattern A skeleton** — DONE: pure `server/healthcheck.js` engine + `/api/healthcheck/ping` route + React `HealthcheckPanel` + 5-test contract suite, serving as the convention every later sub-plan references.
```

- [ ] **Step 2: Commit handoff**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add HANDOFF.md && git commit -m "docs: record Pattern A skeleton verification" && git push ant main
```

- [ ] **Step 3: Tag**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git tag pattern-a-skeleton && git push ant pattern-a-skeleton
```

## Final Self-Review Checklist (sub-plan 0)

- [ ] `test/healthcheck.test.js` fails before the engine exists
- [ ] `test/healthcheck.test.js` passes once the route is wired
- [ ] `npm test` total count increases by 5
- [ ] `npm run build:ui` succeeds
- [ ] Audit row count increases by exactly 1 per successful call
- [ ] Replay with same `idempotencyKey` returns the cached envelope and does not double-write audit
- [ ] `HANDOFF.md` updated
- [ ] `pattern-a-skeleton` tag pushed to `ant`
