# Armosphera One Claude — Handoff & State

_Last updated: 2026-06-01 · main after tenant-org mapping hardening · 37 tags · **319 tests (319 pass, 0 fail, 0 cancelled)**_

> **Repo home:** private GitHub `SamStep74/A1-Suite-Local`, developed locally at `~/dev/A1-Suite-Local` (moved off the OneDrive-synced folder — the old `node --test` "cancelled" stalls were OneDrive FS contention, now gone: the full suite runs clean on local disk).

A **sovereign, self-hostable Armenian business operating system** with phased one-to-one *functional* parity to Zoho One. Runs entirely on the customer's own server: a single Node/Fastify + SQLite process serving a React SPA, with **no external data dependency** except opt-in AI. Built for Armenian organizations that cannot use foreign clouds (government, banks, healthcare, legal).

---

## 1. What exists today

### Seven working domains on one shared data graph — a closed revenue loop
```
Forms (intake) ─▶ CRM (lead→deal→quote) ─▶ Projects (deliver, staffed by People-HR,
   ▲                                          logging billable time)
   │                                              │
 Desk (support) ◀── Docs & Sign (execute) ◀── Finance ◀─ billing seam (time→invoice→ledger)
```
Every arrow is a **validated FK between modules** sharing `customers` / `deals` / `people_employees` — integration depth, not copy-paste.

| Domain | Status | Key capability |
|---|---|---|
| **CRM** | complete (BE+UI) | leads, deals, quotes pipeline, activity timeline |
| **Finance** | complete (BE+UI) | double-entry ledger on RA chart of accounts; AR/AP/expenses/payroll/VAT/statements/opening-balances; history lists |
| **Desk** | complete (BE+UI) | helpdesk: create/list/transition/reassign, escalation governance |
| **People-HR** | complete (BE+UI) | employee registry (ՀՎՀՀ/salary) → payroll → ledger |
| **Docs & Sign** | complete (BE+UI) | document + multi-signer e-signature lifecycle, SHA-256 consent, local-only signers, printable Save-as-PDF evidence certificate |
| **Projects** | complete (BE+UI) | projects→tasks→milestones→time entries; lazy detail expander |
| **Forms** | complete (BE+UI) | intake forms; PUBLIC submit → creates a CRM lead (rate-limited, key-whitelisted) |

### Cross-app seams (the "suite, not a folder of apps" proof)
- **Forms → CRM**: public form submission creates a real CRM lead via `createCrmLead`.
- **People-HR → Finance**: an employee's salary runs payroll → posts `Dt 714 / Kt 521+525` to the ledger.
- **Projects → Finance (billing seam)**: unbilled logged minutes → a posted invoice (`Dt 221 / Kt 611+524`), entries marked billed (idempotent per project+period).

### Hardening (production-readiness pass — 20 slices)
1. **Effective-dated tax-rate versioning** (`tax_rates` table; recomputing a historical period uses the rate that applied *then*).
2. **Auth/MFA rate-limiting** (per-IP + per-email login throttle, MFA attempt cap → 429).
3. **UI error surfacing** (all 20 mutation handlers surface server errors in a dismissable banner; previously silent).
4. **Finance history lists** (expenses / bills / payroll-runs were postable but unviewable — now listed).
5. **Finance RBAC** (`requireFinanceOperator` 403-gates ledger-write endpoints).
6. **Project detail expander** (lazy task/milestone/time tree).
7. **Production readiness gate** (`/api/compliance/production-readiness`) blocks production use until legal sources have Accountant/Lawyer review and effective-dated VAT/payroll rates are configured.
8. **Professional source signoff** adds a Lawyer demo role, preserves reviewer-role metadata, and requires Accountant review for tax/VAT sources plus Lawyer review for personal-data/e-sign sources before the readiness gate can pass.
9. **Downstream professional source enforcement** applies the same Accountant/Lawyer source-signoff rule to Copilot proposed actions and downstream SRC/e-sign/privacy packet creation instead of trusting `legal_sources.status = active` alone.
10. **Copilot advisory audit trail** records every legal/accounting Copilot answer as metadata-only `copilot.advisory.generated` suite and audit events, using a SHA-256 question hash instead of storing raw prompt/answer text in durable logs.
11. **Copilot citation review evidence** renders each cited Armenian legal/accounting source with professional-review status, reviewer role/name, and latest review timestamp directly in the Copilot source list.
12. **Copilot citation source links** renders safe HTTP(S) links to the maintained Armenian source URL with a visible host label, fixes reviewed-date display to use `latestReview.createdAt`, and unit-tests malformed/non-HTTP link rejection.
13. **Legal source host stability** prevents legal-source review records from moving seeded Armenian sources to arbitrary hosts while still allowing same-host path/query/version updates.
14. **Legal source host block audit** records rejected cross-host review attempts as metadata-only `legal.source.review.blocked` suite/audit events without storing the raw rejected URL or mutating source history.
15. **Legal source HTTPS downgrade guard** blocks same-host HTTPS-to-HTTP source review updates and records only source id, normalized hosts, protocols, and `scheme-downgrade` reason.
16. **Legal source credentialed URL guard** rejects source review URLs with username/password userinfo before mutation, records only host/protocol metadata with `url-credentials`, and prevents credentialed legacy citation URLs from rendering as links.
17. **Audit reader gate and legal review note metadata** limits `/api/audit` to Owner/Admin/Auditor, keeps non-reader UI flows from fetching it, and stores only legal-review note hash/length in suite/audit metadata while preserving the canonical review note.
18. **A1 Platform tenant resolution bridge** optionally resolves Studio tenant context from A1 Platform via `x-a1-request-host`, keeps health public metadata minimal, gates detailed tenant summaries to audit readers, enforces egress/strict/disabled-tenant rules, and blocks cross-host session replay when Platform supplies an org mapping.
19. **Tenant-bound public forms and quotes** scopes anonymous public form pages/submissions and quote read/acceptance tokens by the resolved A1 Platform tenant org, returning generic `404` responses for wrong-host or unmapped-host access so public callers cannot distinguish foreign tenant resources from missing resources.
20. **Authenticated unmapped tenant fail-closed** rejects authenticated Studio API requests when A1 Platform resolves a tenant but does not provide a local organization mapping, while preserving local/single-tenant behavior and non-strict `tenant:null` fail-open behavior.

Sovereign foundation: outbound network **off by default** + opt-in egress allowlist (loopback always allowed); data dir outside the repo (OS app-support); optional bundled local AI (Ollama); offline Armenian legal RAG (BM25 + optional hybrid). One-command install (`deploy/install.sh`, launchd/systemd templates, WAL backup).

---

## 2. Architecture

- **`server/index.js`** — boot (host/port/dbPath from `server/config.js`).
- **`server/config.js`** — local-server policy: data-dir relocation, egress gate (`assertEgressAllowed`, deny-until-listed, loopback-always, 403), local-AI defaults.
- **`server/db.js`** (~12k lines) — `node:sqlite` `DatabaseSync`; full schema in `initSchema`; `seedIfEmpty` demo org/data; `ensure*Layer(db)` idempotent migrations (PRAGMA table_info + ALTER); effective-dated rate resolvers (`resolvePayrollConfig`/`resolveVatRate`).
- **`server/app.js`** (~49k lines) — Fastify; `buildApp({dbPath})`; cookie auth via `app.auth`; all routes in `registerApi`; role gates (`requireOwner`/`requireFinanceOperator`/`requireDocsWriter`/`requireProjectsWriter`/`requirePeopleWriter`/…); per-IP `enforceRateLimit`. No global auth hook — auth is opt-in per route (so public routes just omit `app.auth`).
- **`server/ledger.js`** — double-entry posting (period-lock-aware, idempotent via unique source index); chart 221/251/252/331/521/524/525/526/611/711/714.
- **`server/accounting.js`** / **`server/payroll.js`** / **`server/rag.js`** — verbatim ports (engine-underneath).
- **`web/src/main.jsx`** (~12k lines) — single SPA. **Data-presence render model (no router)**: panels render when their data is present. One bundled state object per app, fetched in `load()`'s app-gate. `api(path,{method,body})` cookie-auth helper that throws `new Error(data.error)`. Per-app panels in focused modules: `crm.jsx`, `finance.jsx`, `desk.jsx`, `people.jsx`, `docs.jsx`, `projects.jsx`, `forms.jsx`.

**Add-a-view pattern** (consistent across the whole app): new panel file → import into main.jsx → +1 fetch in the load() app-gate → +1 key on the bundled state object → render-by-presence. No new top-level state, no `Workspace` signature growth (the ~86 pilot props were bundled into one `pilot` object).

---

## 3. Running & verifying

```bash
# Boot (data dir defaults to OS app-support; override for a throwaway run)
PORT=4178 ARMOSPHERA_ONE_DB=/tmp/aoc.sqlite ARMOSPHERA_ONE_ALLOW_EGRESS=0 node server/index.js
# Login: owner@armosphera.local / change-me-now   (also: accountant@, lawyer@, operator@, support@, auditor@, …)
npm run build:ui     # vite build → public/
npm test             # node --test  (see caveat below)
```

### OPPO remote-control / live preview

Run from `~/dev/A1-Suite-Local`:

```bash
PORT=4178 HOST=0.0.0.0 ARMOSPHERA_ONE_DB=/tmp/a1-suite-copilot.sqlite ARMOSPHERA_ONE_ALLOW_EGRESS=0 node server/index.js
```

Open from OPPO on the same LAN using the exact URL printed by:

```bash
MAC_IP=$(ipconfig getifaddr en0 || ipconfig getifaddr en1)
printf 'http://%s:4178/\n' "$MAC_IP"
```

The Copilot slice is Armenian-first and exposes `COPILOT_PROVIDER=gemini`, `COPILOT_MODEL=gemini-3.5-flash`, and `COPILOT_LANGUAGE=hy-AM` in the response model policy. Local verification keeps execution deterministic with outbound disabled by default.

Current checkpoint:
- Latest tenant-org mapping hardening commit: `0d5f377` (`Harden platform tenant org mapping checks`), pushed with this handoff.
- Latest tenant-bound public routes commit: `f3d56bf` (`feat(platform): tenant-bind public routes`), pushed with this handoff.
- Latest A1 Platform tenant bridge commit: `bc7c56a` (`feat(platform): resolve A1 tenant context`), pushed with this handoff.
- Latest audit reader coverage commit: `3998d81` (`test(compliance): cover audit reader gate`), pushed with this handoff.
- Latest audit reader gate commit: `b21228e` (`feat(compliance): gate audit feed access`), pushed with this handoff.
- Latest legal source credentialed URL guard commit: `dbfbc01` (`feat(compliance): block credentialed legal source urls`), pushed with this handoff.
- Latest legal source HTTPS downgrade commit: `1cc47f4` (`feat(compliance): prevent legal source https downgrades`), pushed with this handoff.
- Latest legal source host-block audit commit: `469e7e4` (`feat(compliance): audit blocked legal source hosts`), pushed with this handoff.
- Latest legal source host-stability commit: `de44edf` (`feat(compliance): keep legal source reviews on host`), pushed with this handoff.
- Latest Copilot citation source-link commit: `f6532c6` (`feat(copilot): expose citation source links`), pushed with this handoff.
- Latest Copilot citation evidence commit: `784f06e` (`feat(copilot): show source review evidence`), pushed with this handoff.
- Previous Copilot audit trail commit: `3705542` (`feat(copilot): audit advisory answers`).
- Previous downstream source enforcement commit: `c0a4225` (`feat(compliance): enforce professional source gates downstream`).
- Previous professional source signoff commit: `357e874` (`feat(compliance): require professional source signoff`).
- Previous production readiness commit: `3fe4f93` (`feat(compliance): add production readiness review gate`).
- Previous copilot audit commit: `255ed4b` (`test(copilot): cover month-close preview guardrail`).
- Verification from `~/dev/A1-Suite-Local`: focused tenant suite `node --test test/platform-tenant.test.js` = 18 pass; `npm test` = 319 pass, 0 fail, 0 cancelled; `npm run build:ui` = pass; `ARMOSPHERA_ONE_DB=/tmp/a1-suite-auth-unmapped-smoke.sqlite ARMOSPHERA_ONE_ALLOW_EGRESS=0 npm run smoke` = pass; `git diff --check` = pass. Read-only explorer selected authenticated resolved-unmapped tenants as the next fail-closed gap; read-only review was requested for `HEAD^..HEAD`.
- Browser/API proof: restarted preview on the current checkout; `/api/health` remains public with `platformTenant.enabled=false` in local mode, and the in-app browser loads `http://127.0.0.1:4178/` with the Armenian A1 Suite login and no console errors. Platform lookup is opt-in, sends the original tenant host in `x-a1-request-host`, respects `ARMOSPHERA_ONE_ALLOW_EGRESS`/allowlist, caches per-host lookups, sanitizes Platform error messages, blocks strict null tenants, disabled tenants/modules, maintenance responses, rejects cross-host session replay when Platform returns an org mapping, hides public forms/quotes for wrong-host or unmapped-host public access, and now rejects authenticated routes for resolved tenants that lack a local org mapping.
- Live preview for OPPO while the Mac is awake: server bound to `0.0.0.0:4178`; current LAN URL is `http://10.250.30.18:4178/`; current throwaway DB is `/tmp/a1-suite-auth-unmapped-ui.sqlite`.
- Next unchecked task from `2026-06-01-armenian-legal-accounting-copilot.md`: none; checklist is complete. The old "retire in-repo suite" note is moot in this repo because there is no `suite/` directory here.

### ⚠ ENV CAVEAT — old OneDrive copy was flaky
`node --test` previously stalled / reported `cancelled` in the OneDrive-synced folder because of filesystem contention around the large `app.js`. The local `~/dev/A1-Suite-Local` checkout is the reliable working tree. If a future run regresses only in a synced/cloud folder, verify from this local checkout before treating it as a code failure. Reliable fallback patterns:
- **Per-file**: `node --test test/<one>.test.js` (one short invocation).
- **Clean worktree**: `git worktree add --detach /tmp/run HEAD && ln -s "$PWD/node_modules" /tmp/run/ && cd /tmp/run && node --test test/*.test.js`.
- Last clean full-suite run from `~/dev/A1-Suite-Local` at `0d5f377`: **319 tests / 319 pass / 0 fail / 0 cancelled**.

---

## 4. Tag history (37)
`armenian-copilot-mvp` → `auditor-rbac-coverage` → `billing-seam` → `checkpoint-handoff` → `deploy-packaging` → `desk-helpdesk` → `docs-export` → `docs-sign` → `docs-signature-evidence` → `docs-templates` → `employee-payroll-fk` → `finance-list-views` → `finance-opening-balances` → `forms` → `forms-public-page` → `harden-billpay` → `harden-rates-auth` → `harden-ui-errors` → `harden-ui-errors-complete` → `m1-foundation` → `m2-legal-rag` → `m3-accounting-complete` → `m3-accounting-engine` → `m3-accounting-ledger` → `m3-finance-reports` → `m3-payables` → `m3-payroll` → `people-hr` → `project-detail-view` → `projects` → `ui-crm-activity` → `ui-crm-quote-create` → `ui-crm-quotes` → `ui-finance-complete` → `ui-finance-interactive` → `ui-finance-reports` → `vat-rate-versioning`.

---

## 5. Backlog (deliberately deferred — all marginal or out-of-scope)
- ~~Employee payroll-history detail~~ — **DONE** (`employee-payroll-fk`): `employee_id` FK on `payroll_runs` (ON DELETE SET NULL), `GET /api/people/employees/:id/payroll-runs`, lazy per-employee history expander in the People-HR panel. Generic `/payroll/run` accepts an optional validated `employeeId`.
- ~~Docs signature-status detail expander~~ — **DONE** (`docs-signature-evidence`): per-signer SHA-256 + sealed doc hash, toggle in the Docs panel.
- ~~Forms public rendered page~~ — **DONE** (`forms-public-page`): `GET /f/:id` server-renders a published form as a standalone HTML page (no auth/SPA bundle), HTML-escaped (stored-XSS guard), posts to the rate-limited submit endpoint; draft/unknown → 404.
- ~~Docs signed-PDF export~~ — **DONE** (`docs-export`): authenticated `/api/docs/documents/:id/export` renders a self-contained printable certificate with `@media print`, pending/draft/voided watermarks, signer SHA-256 evidence, sealed document hash, cross-org 404, and HTML escaping.
- ~~Docs templates~~ — **DONE** (`docs-templates`): `document_templates` table + 3 seeded RA templates (NDA, service agreement, job offer); `GET /api/docs/templates` + `POST /api/docs/templates/:id/generate` create a normal draft; single-pass `{{placeholder}}` fill auto-fills org/customer/date and leaves a visible `[ԼՐԱՑՐԵՔ · FILL: x]` marker for the rest; Docs UI template picker derives its inputs from the template's declared variables.
- ~~VAT-rate versioning~~ — **DONE** (`vat-rate-versioning`): the 2 project-billing `/1.2` sites now use `resolveVatRate(db, orgId, issueDate)` via a central `splitVatInclusive(total, rate)` helper, so an invoice freezes the VAT rate in force on its issue date (history stays correct when a future rate is scheduled). `GET /api/finance/tax-rates` + a read-only Finance "Tax rates" panel surface the effective-dated rate history. Writing a new rate stays DB-level only (mis-entered tax rate is high-impact; pro review required).
- ~~Armenian legal/accounting copilot~~ — **DONE** (`armenian-copilot-mvp`): local advisory `POST /api/copilot/questions`, Gemini 3.5 Flash model policy metadata, Armenian-first UI/API/tests, citation-required VAT/privacy/e-sign guidance, deterministic payroll/VAT/month-close previews, month-close no-close guardrail coverage, proposed actions only, no external egress during validation.
- **Retire the in-repo `suite/`** — moot here; there is no `suite/` directory in `A1-Suite-Local`, and the related hub lives in the separate HayHashvapah repo.
- ~~Production readiness gate for accountant/lawyer review~~ — **DONE**: `GET /api/compliance/production-readiness` is a read-only compliance gate for Owner/Admin/Accountant/Lawyer/Auditor. Legal-source gates now require the latest active review to come from the matching professional role: Accountant for tax/VAT, Lawyer for personal-data and e-sign. Owner/Admin can still maintain source records, but their review alone does not clear production signoff.
- ~~Downstream professional source enforcement~~ — **DONE**: Copilot citations include professional-review readiness, proposed actions stay disabled after owner-only source maintenance, and SRC/e-sign/privacy packet creation requires matching Accountant/Lawyer source review before generating governed evidence packets.
- ~~Copilot advisory audit trail~~ — **DONE**: `POST /api/copilot/questions` now emits metadata-only `copilot.advisory.generated` suite/audit events, returns the fresh timeline events, and refreshes the rendered Event bus/Audit panels after an ask without persisting raw question or answer text in audit metadata.
- ~~Copilot citation review evidence~~ — **DONE**: Copilot source rows now show professional-review status, reviewer role/name, and latest review date in Armenian UI; owner-only source maintenance is visibly blocked, while Accountant/Lawyer review is visibly ready.
- ~~Copilot citation source links~~ — **DONE**: Copilot source rows now include an explicit `Բացել աղբյուրը` link with visible host, HTTP(S)-only client guard, `noopener noreferrer`, reviewed-date display from `latestReview.createdAt`, API contract tests, and pure UI-helper tests for malformed/non-HTTP URL rejection.
- ~~Legal source host stability~~ — **DONE**: legal-source review updates now normalize source hosts, allow same-host version/path/query changes such as `www.arlis.am` to `arlis.am`, reject arbitrary cross-host moves before persisting review history, and prove reviewed source URLs continue into legal-answer citations.
- ~~Legal source host block audit~~ — **DONE**: rejected cross-host legal-source review attempts now emit metadata-only `legal.source.review.blocked` suite/audit events with source id, normalized hosts, reason, requested status/date, and reviewer role, while preserving source URL/review history and avoiding durable storage of the raw rejected URL.
- ~~Legal source HTTPS downgrade guard~~ — **DONE**: maintained HTTPS legal/accounting source URLs cannot be downgraded to HTTP during review. Downgrade blocks emit `legal.source.review.blocked` with only source id, normalized hosts, protocols, and `scheme-downgrade` reason, while same-host HTTPS version updates remain accepted.
- ~~Legal source credentialed URL guard~~ — **DONE**: legal-source reviews reject source URLs containing URL userinfo before mutation. Blocks emit `legal.source.review.blocked` with only source id, normalized hosts, protocols, and `url-credentials` reason, while Copilot citation links refuse credentialed legacy source URLs.
- ~~Audit reader gate and legal review note metadata~~ — **DONE**: global audit access is limited to Owner/Admin/Auditor, non-reader UI flows no longer fetch `/api/audit`, and accepted legal-source review audit metadata keeps only note hash/length while preserving the canonical review note.
- ~~A1 Platform tenant resolution bridge~~ — **DONE**: Studio can optionally resolve tenant context from A1 Platform through the VM tunnel, forward tenant host via `x-a1-request-host`, redact public/detail summaries, enforce egress and strict/disabled states, and reject cross-host session replay when Platform supplies org mappings.

---

## 6. Conventions & guardrails (for the next contributor)
- **Local-server only**; outbound off by default; never register a persistent service during dev verification.
- **No `--no-verify`**, never change git config, no destructive git without explicit consent; attribution disabled (no Co-Authored-By).
- **Two-agent git hygiene**: this repo is often edited by parallel agents. Always `git status` before `git add`; **path-scope every commit** (`git add <my-files>`) so you never sweep another agent's staged work into your commit. Disjoint files → separate commits; shared file → combined commit naming both slices.
- **Verify every new UI surface in a real browser** (or via the live API) — `build:ui` passing ≠ component mounted (a bundled-but-unmounted component compiles fine). Confirm symbols are in scope via the runtime, not grep substrings.
- Money is whole-AMD INTEGER; dates ISO `YYYY-MM`/`YYYY-MM-DD`; VAT-inclusive 20% = `subtotal=round(total/1.2); vat=total−subtotal`.
