# Sub-Plan 1: Document Cabinet (Документооборот) — User Priority #1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a true document cabinet on top of the existing Docs & Sign lifecycle (`web/src/docs.jsx`, `server/app.js` doc routes, `test/docs-*.test.js`). Cover incoming / outgoing / internal document flows, versioning, archive, OCR, full-content search, and AI features (auto-classify, extract attributes, find contract risks, compare revisions, draft replies). Stage Armenian state-signature integrations (ID Card, Mobile ID, e-signature) for sub-plan 7.

**Architecture:** New tables attach to the existing `customers` / `vendors` / `employees` graph via polymorphic `linked_type` + `linked_id`. The cabinet is one Pattern A module: `server/documentCabinet.js` (pure engine) + `server/app.js` cabinet routes + `web/src/cabinet.jsx` (list + viewer + AI sidebar) + `test/document-cabinet.test.js` (contract suite). OCR is a local Tesseract invocation behind an opt-in flag; AI features use the existing Copilot local engine pattern with a new `intent: "doc-classify" | "doc-extract" | "doc-risk-scan" | "doc-compare" | "doc-reply"`.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite` `DatabaseSync`, `node --test`, React + Vite. Local OCR via Tesseract CLI (`/usr/bin/tesseract`, with a `local-heuristic` fallback that records "ocr:manual-review" when unavailable). AI features delegate to `server/copilot.js` patterns but with a new `server/documentAi.js` engine so the Copilot file stays focused. Armenian e-signature integration is a stub adapter registered in sub-plan 7's `stateIntegrations.js`; this sub-plan only calls the adapter interface.

**Depends on:** sub-plan 0 (Pattern A skeleton). Existing `server/docs.js`-like logic in `server/app.js` is the contract to extend, not replace.

---

## File Structure

- Create: `server/documentCabinet.js` — pure engine (classify, extract, risk-scan, compare, reply draft).
- Create: `server/documentCabinetRoutes.js` — Fastify-style route handlers (called from `server/app.js`).
- Modify: `server/app.js` — register the new routes after the existing docs routes.
- Create: `server/documentAi.js` — pure AI helper (delegates to `server/copilot.js` engine for pattern reuse).
- Create: `web/src/cabinet.jsx` — list + viewer + AI sidebar.
- Modify: `web/src/main.jsx` — mount `<CabinetPanel />` near `<DocsPanel />`.
- Modify: `web/src/styles.css` — only if new layout classes are needed; reuse existing `panel`, `inline-form`, `copilot-result`.
- Create: `test/document-cabinet.test.js` — contract suite (~12 tests).
- Create: `test/document-cabinet-ai.test.js` — AI contract suite (~6 tests).
- Modify: `docs/LOCALIZATION_API.md` — document the new endpoints.
- Modify: `HANDOFF.md` — completed bullet, runbook.

## Spine reused

- `org_id` tenant scope.
- `customers` / `vendors` / `employees` polymorphic linkage (`linked_type` + `linked_id`).
- `audit_events` for every cabinet mutation.
- `legal_sources` gate for any reply/contract draft that may affect legal posture.
- `idempotency_keys` for upload / version / archive.
- `period_locks` not applicable (cabinet is not Finance-touching).
- `app_assignments` app code: `docs` (existing) for cabinet endpoints.

## API surface (this sub-plan)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/cabinet/documents` | List with filter by `direction` (incoming/outgoing/internal), `status` (active/archived), `linkedType`, `linkedId`, `query` (full-text) | required, `docs` app |
| POST | `/api/cabinet/documents` | Create cabinet doc record (link to existing `docs` template or upload) | required, `docs` app |
| GET | `/api/cabinet/documents/:id` | Read with versions + signers + AI annotations | required, `docs` app |
| PATCH | `/api/cabinet/documents/:id` | Update metadata / archive / link to record | required, `docs` app |
| POST | `/api/cabinet/documents/:id/versions` | Add a new version (file content + parent version id) | required, `docs` app |
| POST | `/api/cabinet/documents/:id/ocr` | Trigger local OCR (idempotent) | required, `docs` app |
| POST | `/api/cabinet/documents/:id/ai/classify` | AI classify (intent `doc-classify`) | required, `docs` app |
| POST | `/api/cabinet/documents/:id/ai/extract` | AI extract attributes (intent `doc-extract`) | required, `docs` app |
| POST | `/api/cabinet/documents/:id/ai/risk-scan` | AI find risks in a contract (intent `doc-risk-scan`) | required, `docs` app |
| POST | `/api/cabinet/documents/:id/ai/compare` | AI compare two versions (intent `doc-compare`) | required, `docs` app |
| POST | `/api/cabinet/documents/:id/ai/reply-draft` | AI generate a reply letter (intent `doc-reply`) | required, `docs` app |
| GET | `/api/cabinet/search?q=...` | Full-text search across `document_text` (FTS5 virtual table) | required, `docs` app |
| POST | `/api/cabinet/esign/prepare` | Prepare an e-signature request (calls `stateIntegrations.eSignAdapter`) | required, `docs` app |

## Database additions

In `server/db.js` migration block (idempotent `CREATE TABLE IF NOT EXISTS`):

```sql
CREATE TABLE IF NOT EXISTS cabinet_documents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  title TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('incoming','outgoing','internal')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  doc_type TEXT,
  linked_type TEXT,
  linked_id TEXT,
  ocr_status TEXT NOT NULL DEFAULT 'none' CHECK (ocr_status IN ('none','queued','done','failed','manual-review')),
  ocr_text TEXT,
  current_version INTEGER NOT NULL DEFAULT 1,
  ai_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cabinet_org ON cabinet_documents(org_id);
CREATE INDEX IF NOT EXISTS idx_cabinet_link ON cabinet_documents(org_id, linked_type, linked_id);

CREATE TABLE IF NOT EXISTS cabinet_document_versions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  cabinet_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  parent_version INTEGER,
  mime_type TEXT,
  byte_size INTEGER,
  storage_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (cabinet_id) REFERENCES cabinet_documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cabinet_versions ON cabinet_document_versions(org_id, cabinet_id, version);

CREATE TABLE IF NOT EXISTS cabinet_ai_annotations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  cabinet_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('classify','extract','risk','compare','reply','summary')),
  payload_json TEXT NOT NULL,
  confidence INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (cabinet_id) REFERENCES cabinet_documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cabinet_ai ON cabinet_ai_annotations(org_id, cabinet_id, kind);

CREATE VIRTUAL TABLE IF NOT EXISTS cabinet_fts USING fts5(
  org_id UNINDEXED,
  cabinet_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

## Task 1: Write the contract test file (RED)

**Files:**
- Create: `test/document-cabinet.test.js`

- [ ] **Step 1: Create the test file**

The test file must cover: auth gate, app access, create document (success + idempotency), list with filter, link to customer, version creation (parent + sha256), archive, soft restore, full-text search, malformed-id guard, audit emit, e-sign prepare (stub mode). See existing `test/docs-*.test.js` for the helper patterns; the file should be ~200 lines.

- [ ] **Step 2: Run RED**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/document-cabinet.test.js 2>&1 | tail -10
```

Expected: FAIL with 404 on every route.

- [ ] **Step 3: Commit RED**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add test/document-cabinet.test.js && git commit -m "test(cabinet): define document cabinet contract" && git push ant main
```

## Task 2: Pure engine `server/documentCabinet.js`

**Files:**
- Create: `server/documentCabinet.js`

Exports (all pure):
- `classifyDocument({ title, body })` → `{ suggestedType, confidence, reason }` (local heuristic fallback; calls `documentAi.classify` when AI is enabled).
- `extractAttributes({ title, body, docType })` → `{ attributes: { date?, counterparty?, amount?, currency?, dueDate? }, confidence }`.
- `scanRisks({ body, jurisdiction = "AM" })` → `{ risks: [{ id, label, severity, excerpt }], confidence }`.
- `compareRevisions({ leftText, rightText })` → `{ diffs: [{ kind: 'added'|'removed'|'changed', text, before?, after? }] }`.
- `draftReply({ incoming, tone, language })` → `{ body, citationIds: [] }` (returns a stub; AI engine replaces when enabled).
- `prepareESign({ cabinetId, signer })` → `{ envelopeId, status, provider }` (calls the stub adapter — see task 5).

- [ ] **Step 1: Implement the module**

Implementation uses pure string manipulation + a small keyword dictionary in Armenian + English for the `classify` and `extract` heuristics. The `compareRevisions` uses a simple line-level diff (no external dep). The `scanRisks` uses a fixed checklist of contract risk patterns (unlimited liability, unilateral termination, jurisdiction waiver, etc.).

- [ ] **Step 2: Commit engine**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/documentCabinet.js && git commit -m "feat(cabinet): add pure document cabinet engine" && git push ant main
```

## Task 3: AI helper `server/documentAi.js`

**Files:**
- Create: `server/documentAi.js`

Mirrors the `server/copilot.js` pattern: deterministic fallback when no AI is configured, optional OpenRouter hook when `OPENROUTER_API_KEY` is set and egress is allowed. Reuses the same egress gate.

- [ ] **Step 1: Implement**

Exports: `classify`, `extract`, `scanRisks`, `compareRevisions`, `draftReply`. Each function accepts normalized input and returns `{ result, citations: [], guardrails: [], sourceActive: boolean }`. When no AI is configured, returns the deterministic local fallback from `documentCabinet.js`.

- [ ] **Step 2: Commit**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/documentAi.js && git commit -m "feat(cabinet): add local-first document AI helper" && git push ant main
```

## Task 4: DB migration + route registration

**Files:**
- Modify: `server/db.js` — add the new tables and the FTS5 virtual table.
- Create: `server/documentCabinetRoutes.js` — Fastify route handlers.
- Modify: `server/app.js` — register the routes after the existing docs routes.

- [ ] **Step 1: Add tables to `server/db.js`**

Append the SQL from "Database additions" above to the migration block. Test with `buildApp({ dbPath: ":memory:" })` to confirm the tables are created.

- [ ] **Step 2: Implement the route handlers**

Each handler:
1. `await app.auth(request)` → user.
2. `requireAppAccess(db, user, "docs")`.
3. Validate `body` / `params`; 400 on malformed.
4. Idempotency: check `idempotency_keys` if the verb is mutating; 409 on duplicate.
5. Call `documentCabinet` engine or `documentAi` for AI verbs.
6. `recordAudit` with the action + target id.
7. Return `{ ok: true, ... }`.

- [ ] **Step 3: Register routes in `server/app.js`**

```js
const cabinetRoutes = require("./documentCabinetRoutes");
cabinetRoutes.register(app, db, { app, auth, requireAppAccess, recordAudit, randomId, documentCabinet, documentAi, stateIntegrations });
```

- [ ] **Step 4: Run tests — should be GREEN**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/document-cabinet.test.js 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Full suite + UI build**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10 && npm run build:ui 2>&1 | tail -10
```

Expected: PASS both; test count up by ~12.

- [ ] **Step 6: Commit**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/db.js server/documentCabinetRoutes.js server/app.js && git commit -m "feat(cabinet): register document cabinet routes" && git push ant main
```

## Task 5: E-sign stub adapter

**Files:**
- Create: `server/stateIntegrations.js` — adapter registry, returns stub responses when `STATE_INTEGRATION_MODE=test`.

- [ ] **Step 1: Implement stub**

Exports: `eSignAdapter`, `idCardAdapter`, `mobileIdAdapter`, `srcAdapter`, `eRegisterAdapter`, `customsAdapter`, `eGovAdapter`. Each returns a deterministic envelope. Selected by `STATE_INTEGRATION_MODE` (default `test`).

- [ ] **Step 2: Wire into cabinet route**

The `prepareESign` handler calls `stateIntegrations.eSignAdapter.prepare({ cabinetId, signer })`.

- [ ] **Step 3: Commit**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/stateIntegrations.js server/documentCabinetRoutes.js && git commit -m "feat(state-int): add test-mode state integration adapter stubs" && git push ant main
```

## Task 6: React Cabinet panel

**Files:**
- Create: `web/src/cabinet.jsx`
- Modify: `web/src/main.jsx`

- [ ] **Step 1: Build the panel**

Three columns: list (filterable by direction, status, search query), viewer (current version + version dropdown), AI sidebar (classify / extract / risk / compare / reply buttons + result). Reuse `.panel`, `.panel-head`, `.inline-form`, `.copilot-result`. No new CSS.

- [ ] **Step 2: Mount**

Import + add `cabinetAction` handler in `Workspace`. Render `<CabinetPanel />` near `<DocsPanel />`.

- [ ] **Step 3: Build UI**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm run build:ui 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add web/src/cabinet.jsx web/src/main.jsx && git commit -m "feat(cabinet): mount document cabinet panel" && git push ant main
```

## Task 7: Localization doc + handoff

**Files:**
- Modify: `docs/LOCALIZATION_API.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Document the new endpoints**

Add a `## Document Cabinet` section to `LOCALIZATION_API.md` listing the 13 routes with auth, response shape, and Armenian label dictionary.

- [ ] **Step 2: Update handoff status line + add a completed bullet**

```markdown
- **Document cabinet** — DONE: incoming/outgoing/internal flows, versioning, archive, local OCR, AI classify/extract/risk/compare/reply, full-text search, e-sign stub adapter; ~12 new contract tests; tests pass + UI builds.
```

- [ ] **Step 3: Commit + tag**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add docs/LOCALIZATION_API.md HANDOFF.md && git commit -m "docs: record document cabinet slice" && git push ant main
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git tag document-cabinet-mvp && git push ant document-cabinet-mvp
```

## Final Self-Review Checklist (sub-plan 1)

- [ ] Tests fail before, pass after; total test count up by ~12
- [ ] All 13 routes return the expected shape + status codes
- [ ] FTS5 search returns matching documents scoped to org
- [ ] OCR fallback to `manual-review` when Tesseract is missing
- [ ] AI features work in local-deterministic mode without egress
- [ ] Idempotency on create / version / OCR / AI verbs
- [ ] Audit row per mutation
- [ ] E-sign adapter is a stub; real adapter comes in sub-plan 7
- [ ] `HANDOFF.md` + `LOCALIZATION_API.md` updated
- [ ] `document-cabinet-mvp` tag pushed

## Deferred to other sub-plans

- Real e-signature integration (ID Card, Mobile ID, e-Gov) — sub-plan 7.
- AI features that need a local Armenian embedding model — sub-plan 9 of `docs/AI.md` (already documented as future work).
