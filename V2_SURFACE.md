# V2 Surface — A1-Suite-Local-ANT

The V2 surface is the second iteration of the **sovereign,
zero-dep, single-process** A1 stack. It ships the AI chat +
streaming, the PDF quote export, the quote template library
with full CRUD, the customer picker, and the e2e coverage
that proves the whole flow works against a real wire.

This document is the canonical index of what shipped, what
each surface guarantees, and the test contract that holds
it all together.

---

## V2 surface at a glance

| # | Slice | What | Tests | Commit |
|---|---|---|---|---|
| V2.1 | (earlier) | OAuth + integrations | 252 | (prior) |
| V2.2 | 8 | Ollama client (direct HTTP, no Vercel AI SDK) | 43 | `bbe5ae6` |
| V2.3 | 9 | AI chat (stateless `chatText` / `chatJson`) | 36 | `1fc174a` |
| V2.4 | 10 | PDF quote export (hand-rolled PDF 1.4) | 36 | `d216baf` |
| V2.5 | 11 | Ask AI page (4 presets, streaming toggle) | 14 | `556ccba` |
| V2.6 | 12 | Quote template engine (4 built-ins, custom CRUD) | 32 | `e9a5e51` |
| V2.6b | 13 | Quote templates SPA page | 17 | `05d0653` |
| V2.6c | 23 | Save-as-template UI + POST route | 5 + 7 | `614f76e` |
| V2.6d | 24 | Edit + delete custom templates | 10 + 7 | `38f00d1` |
| V2.7 | 14 | AI streaming NDJSON | 6 | `4dea818` |
| V2.8 | 16 | Real customer picker (replaces free-text input) | 5 | `0c31961` |
| V2.9 | 18-20 | e2e coverage for the new surfaces (3 specs) | 22 | `c72946e` |
| V2.10 | 22 | Real Ollama HTTP integration test (real server) | 16 | `2b68913` |
| V2.11 | 25 | e2e for save / edit / delete (8 new) | +8 | `86a889b` |
| V2.12 | 26 | Stub Ask AI endpoint in 4 e2e (pre-existing fix) | 4 fixed | `b0ed152` |
| V2.13 | 27 | Real HTTP route integration test (Fastify inject) | 13 | `54b121c` |
| V2.14 | 28 | Fix stepper testid in document-steppers e2e | 1 fixed | `b4e4905` |

**Live totals** (`ant/main` HEAD: `b4e4905`):
- server/lib: **543/543** tests across 17 engines
- SPA: **2544/2544** tests across 127 files
- e2e: **140/140** across 13 spec files
- tsc clean
- Real production bug fixed in `stream-handler.js` (was 500'ing on every streaming call)

---

## Endpoints shipped

### AI surface

| Route | Method | Auth | Body | Response |
|---|---|---|---|---|
| `/api/ai/status` | GET | Integration Reader (Owner/Admin/Auditor) | — | `{provider, baseURL, models, ok, error}` |
| `/api/ai/chat` | POST | Integration Writer (Owner/Admin) | `{system, user, temperature?, maxTokens?}` | `{ok, provider, model, data, error}` — discriminated result |
| `/api/ai/chat/stream` | POST | Integration Writer | same as `/api/ai/chat` | NDJSON: `{type:'token'\|'done'\|'error', data}` per line |
| `/api/ai/ask` | POST | session + Ask AI app access | `{question, context, idempotencyKey?}` | `{answer, citations, tokensUsed, idempotencyKey?}` (legacy Phase 10.5 surface) |

### SMB-CRM quote surface

| Route | Method | Auth | Body | Response |
|---|---|---|---|---|
| `/api/smb-crm/quote-templates` | GET | SMB-CRM app | — | `{templates: [{id, orgId, name, description, lineItems, builtin, createdAt}]}` (4 built-ins + org's custom) |
| `/api/smb-crm/quote-templates` | POST | SMB-CRM app | `{name, description?, lineItems, sourceTemplateId?}` | `{ok, template}` (create new org-scoped custom) |
| `/api/smb-crm/quote-templates/:id` | PUT | SMB-CRM app | `{name?, description?, lineItems?}` | `{ok, template}` (update custom only — builtins immutable) |
| `/api/smb-crm/quote-templates/:id` | DELETE | SMB-CRM app | — | `{ok}` (delete custom only) |
| `/api/smb-crm/quotes/from-template` | POST | SMB-CRM app | `{templateId, number, customerId?, dealId?, issueDate?, expiryDate?, currency?, status?, overrides?, idempotencyKey?}` | `{ok, quote, lineItems, totalAmount, idempotent?}` |
| `/api/smb-crm/quotes/:id.pdf` | GET | SMB-CRM app | — | `application/pdf` inline (hand-rolled PDF 1.4) |
| `/api/smb-crm/customers` | GET | SMB-CRM app | — | `{customers: [...]}` (for the customer picker) |

---

## The 5-gate test contract

Every server engine and SPA page in the V2 surface is held to
a 5-gate contract test. New slices **must** keep this contract
or the diff is rejected at review.

1. **Pure** — exports exist; the engine is a pure function
   (no I/O, no module-level state); the SPA renders without
   errors with empty state.
2. **Types** — every public function's return shape is
   declared and validated; discriminated results carry the
   documented `ok`/`data`/`error` shape.
3. **Idempotency** — same input → same output bytes; re-running
   `ensureXxxSchema` is a no-op; embedded JSON blobs survive
   serialise/parse round-trips.
4. **Contract** — request/response bodies match the Zod
   schema; the engine never trusts client totals (always
   recomputes from line items); audit hooks fire; RBAC
   enforces; built-ins are immutable.
5. **Edge** — invalid input returns `{ok:false, error}` (never
   throws); cross-tenant access is rejected at the WHERE
   clause; HTTP errors surface a 4xx/5xx; NDJSON streaming
   handles chunk boundaries + missing `done:true`.

---

## Key design rules locked in by V2

- **No Vercel AI SDK** — ANT is sovereign. Direct HTTP to
  Ollama (`POST /api/chat` + `/api/embeddings` + `/api/tags`).
  Anthropic + OpenAI return `not_implemented_on_ant:...`
  sentinels on this stack.
- **NDJSON streaming preferred over WebSockets** for LLM chat
  (matches Ollama's native protocol; abortable via the
  `AbortSignal` already on `fetch`; no `@fastify/websocket`
  plugin needed).
- **Hand-rolled PDF 1.4** for the quote export — 0-dep,
  Helvetica + Helvetica-Bold with WinAnsiEncoding, xref +
  trailer with free entry, `%%EOF` at the end (no trailing
  whitespace). Armenian transliterated to Latin for the
  printable body; preserved verbatim in `/Info /Subject` as
  UTF-8.
- **"Trust the source over vibes"** — the engine NEVER
  trusts a client-supplied `total` or `total_amount`. Server
  always recomputes from `qty * unitPrice`.
- **`org_id = '_builtin'`** is a sentinel meaning "available
  to every org". The listTemplates query unions `_builtin`
  rows with the org's custom rows. Custom templates are
  org-scoped by `org_id` and cannot leak across tenants.
- **`sourceTemplateId`** is optional metadata, NOT a copy
  trigger. The new template is its own row.
- **Citation schema is a discriminated union** —
  `kind: "route" | "document"`. The SPA test stubs MUST include
  `kind: "route"` or the Zod parse fails and the streaming
  flow never renders.
- **`ai.chat` and `ai.chat_stream` audit rows** in
  `audit_events.details` with `{provider, model, ok, error}`.
  The audit table is `audit_events` (NOT `audit_log`).
- **`chatText` ALWAYS calls `ollama.chatJson`** (even for
  text). The Ollama response must be valid JSON-extractable;
  plain text triggers `no_json_in_response`.
- **Stream-handler resolves ollama model + baseURL from
  `./ollama-client`** (NOT `./provider`, which doesn't re-export
  those). This was a real production bug exposed by slice 27.

---

## SPA pages shipped

| Route | Component | Status |
|---|---|---|
| `/app/ask-ai` | `web-modern/src/components/ai/AskAiPanel.tsx` | ✓ (legacy Phase 10.5) |
| `/app/ask-ai` | `web-modern/src/routes/app/ask-ai/index.tsx` | ✓ (V2.13 alias) |
| `/app/smb-crm/ai` | `web-modern/src/routes/app/smb-crm/ai/index.tsx` | ✓ (V2.5 — 4 presets, streaming toggle) |
| `/app/smb-crm/quote-templates` | `web-modern/src/routes/app/smb-crm/quote-templates/index.tsx` | ✓ (V2.6 — pick + edit + save + delete + create) |
| `/app/smb-crm/customers` | (inherited) | (uses the customer picker) |

The two Ask AI routes are aliases for the same backing engine
(`/api/ai/ask` for the legacy panel, `/api/ai/chat` + `/stream`
for the V2.5 page). The 4-preset page is the new canonical
surface; the panel remains for backward compatibility.

---

## How to run locally

```bash
# Backend
npm start                              # Fastify on :4100

# SPA
npm run start:spa                      # TanStack Start on :4173

# Tests
node scripts/run-node-tests.js         # server/lib (543)
cd web-modern && npx vitest run        # SPA (2544)
cd web-modern && npx playwright test   # e2e (140)

# Build
cd web-modern && npm run build
```

The dev box **does NOT have Ollama running** by default. The
V2 surface degrades gracefully:
- `/api/ai/chat` returns `{ok:false, provider:'none', error:'no_provider'}`
  when `AI_PROVIDER=disabled` (the default on this box).
- `/api/ai/chat/stream` returns a single NDJSON error event.
- The SPA shows the "AI provider output is unavailable..."
  server-side fallback.

To wire a real LLM:
```bash
AI_PROVIDER=ollama A1_SOVEREIGN_LLM_BASE_URL=http://127.0.0.1:11434 npm start
```

---

## What changed for the user

**Before V2**: The Armenian SMB could create a quote via a
free-text form, the PDF generator was external, and the Ask AI
panel returned canned stubs regardless of provider.

**After V2**:
- The SMB picks a **template** from a library of 4 built-ins
  (Standard product, Service 3-line, Annual subscription,
  Consulting blank) + their own custom ones.
- The line items are pre-named; the SMB fills in quantity +
  unit price. The **total is always recomputed server-side**
  (never trusted from the client).
- The quote renders to a **printable PDF** (inline, in a new
  tab) with Armenian preserved in the digital subject.
- The SMB can **save the current selection as a new
  template**, **rename** it, or **delete** it. Built-ins are
  immutable.
- The customer is picked from the **real customer list**
  (not typed free-text).
- The Ask AI page **streams** the answer token-by-token from
  the configured LLM, with a clear "AI provider unavailable"
  fallback when no LLM is wired.
- All 140 e2e tests pass; all 543 server tests pass; all
  2544 SPA tests pass.

---

## Gotchas locked in by the V2 build (see memory for full list)

- `db.js` is structured as `function ensureXxxSchema(db) {
  db.exec(\`...\`); }` blocks. JS code (require / try / etc.)
  MUST sit BETWEEN functions, never inside a template
  literal. Inserting `try { require... }` mid-`db.exec` string
  silently corrupts the JS parser.
- TanStack router test mock: `createFileRoute: () => (cfg) =>
  ({ fullPath, ..., options: cfg })`. `options: {}` makes
  `Route.options.component` undefined and the test renders
  nothing.
- vitest `beforeAll`/`afterAll` are not exposed as globals.
  Use `vi.stubGlobal("open", mock)` in `beforeEach` + restore
  in `afterEach`.
- `mockResolvedValue` doesn't work for async generators —
  use `mocks.xMock.mockImplementation(async function* () {
  yield ...; })`.
- The stream-handler's `providerMod.resolveChatModel` call
  was a pre-V2 bug exposed by the route integration test
  (slice 27). The fix: import `./ollama-client` directly.
- `test/concurrent` modes share in-memory DB state across
  tests in the same process; use `mkDb()` to get a fresh
  `:memory:` DB per test.

---

## Open work (deferred, not blocking)

- **Document-steppers wizard** had a 1-test e2e failure fixed
  in slice 28. The component itself is stable.
- **The 3 home dashboard widget errors** ("Couldn't load: API
  response did not match expected shape") are pre-existing
  schema drift between dashboard endpoints and the modern
  SPA's expected shape. NOT a V2 bug; tracked separately.
- **HH slice 302+** lives on `A1-SMB-HH-HY-MAX`, not ANT.
  V2 is complete on ANT; the next cross-repo work is in HH
  (HPKE, JWS detached verify, etc.).
- **Real Ollama end-to-end smoke** is not in the e2e suite
  because this dev box doesn't run Ollama. The slice 22 +
  slice 27 tests cover the real-wire path with a fake Ollama
  server; a real-Ollama smoke is a CI-tier concern.

---

*Last updated: 2026-06-18. `ant/main` HEAD: `b4e4905`.*
