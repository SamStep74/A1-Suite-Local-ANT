# Armosphera One Claude — Handoff & State

_Last updated: 2026-06-01 · main after production readiness review gate · 37 tags · **289 tests (289 pass, 0 fail, 0 cancelled)**_

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

### Hardening (production-readiness pass — 6 slices)
1. **Effective-dated tax-rate versioning** (`tax_rates` table; recomputing a historical period uses the rate that applied *then*).
2. **Auth/MFA rate-limiting** (per-IP + per-email login throttle, MFA attempt cap → 429).
3. **UI error surfacing** (all 20 mutation handlers surface server errors in a dismissable banner; previously silent).
4. **Finance history lists** (expenses / bills / payroll-runs were postable but unviewable — now listed).
5. **Finance RBAC** (`requireFinanceOperator` 403-gates ledger-write endpoints).
6. **Project detail expander** (lazy task/milestone/time tree).
7. **Production readiness gate** (`/api/compliance/production-readiness`) blocks production use until legal sources have Accountant/Lawyer review and effective-dated VAT/payroll rates are configured.

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
# Login: owner@armosphera.local / change-me-now   (also: operator@, support@, auditor@, …)
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
- Latest production readiness commit: `3fe4f93` (`feat(compliance): add production readiness review gate`), pushed with this handoff.
- Previous copilot audit commit: `255ed4b` (`test(copilot): cover month-close preview guardrail`).
- Verification from `~/dev/A1-Suite-Local`: `node --test test/production-readiness.test.js` = 3 pass; `npm test` = 289 pass, 0 fail, 0 cancelled; `npm run build:ui` = pass; `ARMOSPHERA_ONE_ALLOW_EGRESS=0 npm run smoke` = pass.
- Browser proof: Playwright desktop `1280x900` and mobile `390x844` render the Armenian production-readiness gate, blocked status, VAT/payroll gates, and review requirements with no horizontal overflow.
- Live preview for OPPO while the Mac is awake: server bound to `0.0.0.0:4178`; use the `MAC_IP` command above for the current LAN URL.
- Next unchecked task from `2026-06-01-armenian-legal-accounting-copilot.md`: none; checklist is complete. The old "retire in-repo suite" note is moot in this repo because there is no `suite/` directory here.

### ⚠ ENV CAVEAT — old OneDrive copy was flaky
`node --test` previously stalled / reported `cancelled` in the OneDrive-synced folder because of filesystem contention around the large `app.js`. The local `~/dev/A1-Suite-Local` checkout is the reliable working tree. If a future run regresses only in a synced/cloud folder, verify from this local checkout before treating it as a code failure. Reliable fallback patterns:
- **Per-file**: `node --test test/<one>.test.js` (one short invocation).
- **Clean worktree**: `git worktree add --detach /tmp/run HEAD && ln -s "$PWD/node_modules" /tmp/run/ && cd /tmp/run && node --test test/*.test.js`.
- Last clean full-suite run from `~/dev/A1-Suite-Local`: **289 tests / 289 pass / 0 fail / 0 cancelled**.

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
- ~~Production readiness gate for accountant/lawyer review~~ — **DONE**: `GET /api/compliance/production-readiness` is a read-only compliance gate for Owner/Admin/Accountant/Auditor, requiring Accountant review for the tax-code source, Lawyer review for personal-data and e-sign sources, plus configured effective-dated VAT/payroll rates before production use. Actual professional sign-off remains an operational step before customer deployment.

---

## 6. Conventions & guardrails (for the next contributor)
- **Local-server only**; outbound off by default; never register a persistent service during dev verification.
- **No `--no-verify`**, never change git config, no destructive git without explicit consent; attribution disabled (no Co-Authored-By).
- **Two-agent git hygiene**: this repo is often edited by parallel agents. Always `git status` before `git add`; **path-scope every commit** (`git add <my-files>`) so you never sweep another agent's staged work into your commit. Disjoint files → separate commits; shared file → combined commit naming both slices.
- **Verify every new UI surface in a real browser** (or via the live API) — `build:ui` passing ≠ component mounted (a bundled-but-unmounted component compiles fine). Confirm symbols are in scope via the runtime, not grep substrings.
- Money is whole-AMD INTEGER; dates ISO `YYYY-MM`/`YYYY-MM-DD`; VAT-inclusive 20% = `subtotal=round(total/1.2); vat=total−subtotal`.
