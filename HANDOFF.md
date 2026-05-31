# Armosphera One Claude — Handoff & State

_Last updated: 2026-05-31 · HEAD `cc65386` · 78 commits · 30 tags · 170 tests (0 fail, 1 env-timeout "cancelled")_

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
| **Docs & Sign** | complete (BE+UI) | document + multi-signer e-signature lifecycle, SHA-256 consent, local-only signers |
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

### ⚠ CRITICAL ENV CAVEAT — test runner flakiness on the OneDrive-synced working dir
`node --test` (especially the full suite) **stalls / reports `cancelled`** when run directly in this OneDrive-synced folder — filesystem contention reading the 49k-line `app.js`, made worse by parallel agents. **This is NOT a code failure** (`cancelled` ≠ `failed`). Reliable verification:
- **Per-file**: `node --test test/<one>.test.js` (one short invocation).
- **Clean worktree**: `git worktree add --detach /tmp/run HEAD && ln -s "$PWD/node_modules" /tmp/run/ && cd /tmp/run && node --test test/*.test.js`.
- Last clean full-suite run: **170 tests / 169 pass / 1 cancelled (env timeout) / 0 fail** (grew from 152 as parallel agents added systematic tenant-isolation + RBAC coverage: foreign-org → 404 on every `:id` route across service/forms, all-role access pinned on intentionally-open endpoints). Heaviest file `api.test.js` in isolation: 125/126 (the 1 again a timeout, not an assertion).

---

## 4. Tag history (28)
`m1-foundation` → `m2-legal-rag` → `m3-accounting-{engine,ledger,complete}` → `m3-{finance-reports,payroll,payables}` → `ui-finance-{reports,interactive,complete}` → `ui-crm-{quotes,quote-create,activity}` → `deploy-packaging` → `harden-billpay` → `finance-opening-balances` → **`desk-helpdesk`** → **`people-hr`** → **`docs-sign`** → **`projects`** → **`forms`** → **`billing-seam`** → `harden-rates-auth` → `harden-ui-errors` → `finance-list-views` → `harden-ui-errors-complete` → `project-detail-view` → `checkpoint-handoff` → `docs-signature-evidence`.

---

## 5. Backlog (deliberately deferred — all marginal or out-of-scope)
- **Employee payroll-history detail** — needs an `employee_id` FK on `payroll_runs` (currently `employee_name` free-text only); the all-runs Finance list already covers most of the value.
- ~~Docs signature-status detail expander~~ — **DONE** (`docs-signature-evidence`): per-signer SHA-256 + sealed doc hash, toggle in the Docs panel.
- **Docs templates + signed-PDF export**, **Forms public rendered page** (submit is API-only today), **VAT-rate versioning UI** (the `resolveVatRate` seam exists; the 7 inline `/1.2` sites weren't rewritten — low rate-change risk).
- **Retire the in-repo `suite/`** — lives in the *separate* HayHashvapah hub repo, not this one.
- **Accountant/lawyer review** of payroll/VAT rates + legal RAG content **required before production** tax/legal use.

---

## 6. Conventions & guardrails (for the next contributor)
- **Local-server only**; outbound off by default; never register a persistent service during dev verification.
- **No `--no-verify`**, never change git config, no destructive git without explicit consent; attribution disabled (no Co-Authored-By).
- **Two-agent git hygiene**: this repo is often edited by parallel agents. Always `git status` before `git add`; **path-scope every commit** (`git add <my-files>`) so you never sweep another agent's staged work into your commit. Disjoint files → separate commits; shared file → combined commit naming both slices.
- **Verify every new UI surface in a real browser** (or via the live API) — `build:ui` passing ≠ component mounted (a bundled-but-unmounted component compiles fine). Confirm symbols are in scope via the runtime, not grep substrings.
- Money is whole-AMD INTEGER; dates ISO `YYYY-MM`/`YYYY-MM-DD`; VAT-inclusive 20% = `subtotal=round(total/1.2); vat=total−subtotal`.
