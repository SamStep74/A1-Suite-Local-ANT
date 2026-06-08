# Sub-Plan 7: State Integrations (Гос. интеграции) — User Priority #7

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire A1 Suite into Armenian state services: State Revenue Committee (SRC) for tax reports / e-invoices, State Register of Legal Entities (SRLE / `e-register.am`) for counterparty verification, e-Government Gateway (`e-gov.am`) for e-signature, ID Card, Mobile ID, EKENG / e-customs for import/export declarations, licenses and permits. All adapters must run in `STATE_INTEGRATION_MODE=test` (stub) by default; real SOAP/REST calls opt in only with explicit env vars and audit.

**Architecture:** Extend the `server/stateIntegrations.js` stub created in sub-plan 1 with real adapter implementations behind a stable interface. Each adapter is its own module: `server/stateIntegrations/src.js`, `server/stateIntegrations/eRegister.js`, `server/stateIntegrations/eGov.js`, `server/stateIntegrations/customs.js`, `server/stateIntegrations/idCard.js`, `server/stateIntegrations/mobileId.js`. Each implements `prepare`, `send`, `fetchStatus`, `cancel`, `verifySignature`. The hub in `server/stateIntegrations.js` selects mode by env var and routes to the right adapter. A new test mode `test` returns deterministic canned responses that match the real adapter's contract (so the calling code is identical).

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. SOAP via `node:soap` or REST via `undici` depending on the real provider's docs. Local-only mode is the default; production opt-in via `STATE_INTEGRATION_MODE=production` + endpoint URLs + per-adapter API key in env. Crypto operations: Armenian e-sign uses `crypto` (RSA / ECDSA per `e-gov.am` spec); no third-party crypto unless required by the spec.

**Depends on:** sub-plan 0 (Pattern A skeleton), sub-plan 1 (cabinet for e-sign hook), sub-plan 6 (export for customs hook). All real SOAP/REST calls must be opt-in via `STATE_INTEGRATION_MODE=production` and explicit `*_ENABLED=1` per service; default = `test` (deterministic stubs).

---

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

## Tasks (high level)

1. **Tests (RED)** — `test/state-integrations.test.js`: each adapter in test mode returns the deterministic contract shape; idempotency; audit row written; production mode requires opt-in env + fails closed when missing; signature round-trip in test mode.
2. **Adapter hub** — `server/stateIntegrations.js`: select-by-env, route to adapter module, record `state_integration_calls` audit, attach call latency.
3. **Adapters (stub + real)** — write both stub and real for each: `src`, `eregister`, `egov`, `idcard`, `mobileid`, `customs`. Stubs return canned deterministic responses; real implementations are placeholders that throw `Error("provider integration not configured")` until credentials are provided. The cabinet route from sub-plan 1 calls `stateIntegrations.eSignAdapter`; export docs from sub-plan 6 call `stateIntegrations.customsAdapter`.
4. **DB migration** — 4 new tables in `server/db.js`.
5. **Routes** — register the unified dispatch and status routes; gate `production` mode by role.
6. **React state-integration admin** — `web/src/stateIntegrations.jsx`: status dashboard, call audit log, per-adapter mode toggle (gated to Owner).
7. **Handoff + tag** — `state-int-mvp`. **NOTE**: real SOAP/REST calls to live Armenian government endpoints require legal sign-off and credentials — this sub-plan ships the *contract + stubs*; production adapters are an explicit follow-up commit with credentials.
8. **Documentation** — `docs/STATE_INTEGRATIONS.md` listing the 6 adapters, their env-var opt-ins, and the data they exchange.

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
