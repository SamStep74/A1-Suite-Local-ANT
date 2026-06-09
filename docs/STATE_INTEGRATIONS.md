# State Integrations (Կառավարության ինտեգրացիաներ)

Sub-plan 7 of the A1 Suite roadmap: a unified dispatch + audit hub for the
six Armenian state e-service providers a small Armenian business must
interact with. The slice is a **sovereign, fail-closed adapter layer** —
the in-process engine never reaches a real government endpoint unless an
operator explicitly opts in by setting `STATE_INTEGRATION_MODE=production`
plus a per-adapter `*_ENABLED=1`, and even then production code paths
throw `501` today (the production code paths are stub-only by design —
this slice ships test-mode envelopes, deterministic contracts, audit
trail, and the role-gated React panel).

> The 13-apps list in `server/db.js` **stays at 13**. State integrations
> does not become a 14th app — it sits inside the existing `finance` app
> for `requireAppAccess` (which already gates Support → 403, Accountant
> → 200, and Owner/Admin/Auditor → full audit visibility).

---

## 1. Adapters

All six adapters implement a fixed 5-method contract so the hub can
dispatch through one path:

```
prepare({ requestId, input }) -> { requestId, payload, status }
send({ requestId, payload, input }) -> { requestId, status, providerRef, ... }
fetchStatus({ providerRef, orgId }) -> { providerRef, status, lastCheckedAt }
cancel({ requestId, orgId }) -> { requestId, status }
verifySignature({ payload, signatureB64 }) -> { verified, mode, advisoryOnly, certificate, evidence }
```

| Adapter | Armenian label | Operation | Real endpoint (production opt-in only) | Legal source |
|---|---|---|---|---|
| `src` | ՀԾ — Հարկային կոմիտե | `submitVat` | `https://www.taxservice.am/` | RA Tax Code Art. 44 |
| `eregister` | e-Register.am | `lookup` | `https://www.e-register.am/` | RA Law on State Registration of Legal Entities |
| `egov` | e-Gov.am | `sign` | `https://www.egov.am/` | RA Law on Electronic Document & Electronic Digital Signature |
| `idcard` | ID Card | `verify` | Police biometric e-service | RA Law on Personal Identification Cards |
| `mobileid` | Mobile ID | `challenge` | EKENG / Beeline / VivaCell / Ucom | RA Law on Electronic Trust Services |
| `customs` | e-Customs | `declare` | `https://www.customs.am/` | RA Customs Code, RA Government Resolution N 727-N |

**Egress OFF by default.** The default mode is `test`; no adapter
initiates an outbound HTTP request. To talk to a real provider, the
operator must (a) implement the production code path, (b) set
`STATE_INTEGRATION_MODE=production`, and (c) opt in per-adapter with the
uppercase-named `*_ENABLED=1` flag (e.g. `SRC_ENABLED=1`).

---

## 2. Environment variables

| Variable | Default | Effect |
|---|---|---|
| `STATE_INTEGRATION_MODE` | `test` | When `test` (default) all adapters return deterministic envelopes and never touch the network. When `production`, `ensureProductionOptIn` checks the per-adapter `*_ENABLED=1` flag; the production `send()` paths throw `501` until implemented. |
| `SRC_ENABLED` | unset | Required in production for SRC. |
| `EREGISTER_ENABLED` | unset | Required in production for e-Register.am. |
| `EGOV_ENABLED` | unset | Required in production for e-Gov.am. |
| `IDCARD_ENABLED` | unset | Required in production for ID Card. |
| `MOBILEID_ENABLED` | unset | Required in production for Mobile ID. |
| `CUSTOMS_ENABLED` | unset | Required in production for e-Customs. |
| `ARMOSPHERA_ONE_ALLOW_EGRESS` | `0` | Project-wide egress gate; a production-mode adapter still cannot reach a real endpoint when this is `0`. |

The MODE badge in the React panel reads `process.env.STATE_INTEGRATION_MODE` at bundle time. A production rebuild flips the chip without any runtime check.

---

## 3. Data exchanged

The hub never persists cleartext PII into `state_integration_calls.request_json`
or `state_integration_calls.response_json`. The PII redaction pass
(`redactPII` in `server/stateIntegrations.js`) walks the input object and
replaces any of `idNumber`, `subjectId`, `phone`, `taxId`, `fullName`,
`dateOfBirth`, `documentNumber` with a one-way SHA-256 hash slice plus a
`__present: true` marker:

```json
{
  "idNumber": "[hash:sha256:9a3f7c1b4e2d8a55]",
  "idNumber__present": true,
  "period": "2026-Q1",
  "netAmount": 100000
}
```

The hub writes three audit tables on a successful dispatch:

- **`state_integration_calls`** — one row per `dispatch()` call. Carries
  the redacted `request_json`, the redacted `response_json`, the
  adapter's returned `status`, and the `latency_ms`.
- **`state_signatures`** — only when the adapter is `egov` and the
  operation is `sign`. Stores `signer_id_hash` (one-way SHA-256 of the
  signer's `idNumber` claim), the `document_id`, the `signature_b64`,
  and the `certificate_thumbprint`. The cleartext `idNumber` is never
  written.
- **`state_id_verifications`** — only when the adapter is `idcard` and
  the operation is `verify`. Stores the `subject_id`, the verified-at
  timestamp, and a `claims_json` blob (empty in test mode because the
  fail-closed stub does not fabricate identity claims).

---

## 4. API surface

| Method | Path | Role gate | Notes |
|---|---|---|---|
| `POST` | `/api/state-int/:adapter/:operation` | `requireAppAccess("finance")` (Owner/Admin/Accountant) | Idempotency: `idempotencyKey` body field, stored in `idempotency_keys` with `INSERT OR IGNORE` so a replay returns the cached envelope. |
| `GET` | `/api/state-int/:adapter/:operation/:requestId/status` | `requireAppAccess("finance")` | IDOR-safe: the `requestId` lookup also checks `org_id` matches the caller; cross-org lookups return `404`, not `403`, to avoid leaking existence. |
| `GET` | `/api/state-int/audit` | Owner / Admin / Auditor only | Returns the most recent 200 `state_integration_calls` rows for the caller's `org_id`, with optional `from` and `to` ISO date query params. |

The audit event type for every dispatch is `state-int.dispatch` and the
event metadata includes `adapter`, `operation`, and `requestId`. Idempotent
replays skip the audit write (matching the rest of the suite's
audit-once invariant).

---

## 5. Security hardening

| Risk | Mitigation |
|---|---|
| Fail-open signature verifier | Every adapter's `verifySignature` returns `{ verified: false, mode: "test", advisoryOnly: true }` — never `verified: true` in test mode. |
| Fake identity claims in test mode | e-Register returns `record: null` + `requestedTaxId`; ID Card returns `claims: null` + `requestedSubjectId`. No fabricated legal-entity or identity data ever leaves the test stub. |
| Mobile-ID challenge reuse | `mobileId.send` binds the `challengeId` to a SHA-256 of the validated phone (first 16 hex chars + 6 random bytes). A confirm step issued for one phone cannot be replayed against another. |
| SRC float arithmetic | `src.prepare` computes `vatAmount` in **integer minor units** (cents/dram) — `Math.round(netAmount * vatRate)`. A separate `vatAmountMajor` field carries the display value with 2-decimal rounding. |
| Cleartext PII in audit | `redactPII` walks the payload before the INSERT and replaces any PII key with a one-way hash. |
| IDOR on status | The status route matches `request_id` AND `org_id`; cross-org lookups return `404` instead of `403` to avoid leaking existence. |
| Production without opt-in | `ensureProductionOptIn` throws a `403` with a clear message if `STATE_INTEGRATION_MODE=production` and the per-adapter `*_ENABLED` flag is not `1`. |
| Production code path | Every adapter's `send()` checks `STATE_INTEGRATION_MODE === "production"` and throws `501` with a clear message until the production code path is implemented. |

---

## 6. Test contract

10 contract tests in `test/state-integrations.test.js` cover:

1. `state_integration_calls`, `state_integration_credentials`, `state_signatures`, `state_id_verifications` tables exist after `initSchema`.
2. All 6 adapters are loadable from the hub.
3. `POST /api/state-int/:adapter/:operation` returns `401` without auth.
4. `POST /api/state-int/:adapter/:operation` returns `403` for a Support-role user (Support has no `finance` app access).
5. `POST /api/state-int/:adapter/:operation` returns `400` on a malformed body (no `idempotencyKey`).
6. `POST /api/state-int/src/submitVat` returns `200` with a redacted VAT envelope on the happy path.
7. A replay of the same `idempotencyKey` returns the cached envelope and does NOT create a duplicate `state_integration_calls` row.
8. `POST /api/state-int/src/submitVat` returns `403` when `STATE_INTEGRATION_MODE=production` and `SRC_ENABLED` is not set.
9. `POST /api/state-int/egov/sign` writes a `state_signatures` row with a hashed `signer_id_hash`, a `signature_b64`, and a `certificate_thumbprint`.
10. `GET /api/state-int/audit` returns `403` for a non-Owner/Admin/Auditor role and `200` for an Auditor-role user.

All 10 tests pass. The full suite (884 passing) shows 8 pre-existing
failures unrelated to state integrations (dashboard launcher,
integration connector, customer 360, etc.).

---

## 7. React panel

`web/src/stateIntegrations.jsx` exports `StateIntegrationsPanel({ api,
role, actionState })`. It is mounted in `web/src/main.jsx` inside the
existing export-docs anchor, gated to Owner / Admin / Auditor. The
panel has an adapter selector (Armenian-first labels), an operation
selector, a JSON payload textarea pre-seeded with a sample payload for
each adapter, and a `Ուղարկել / Dispatch` button. The audit list at the
bottom polls `GET /api/state-int/audit` and renders the last 200 calls
for the caller's org.

`★ Inline Armenian labels:` `Կառավարության ինտեգրացիաներ`,
`Ադապտեր`, `Գործողություն`, `JSON մուտքագրվող`, `Ուղարկել`,
`Թարմացնել audit`, `advisoryOnly: true · ստուգումը պետք է հաստատվի production միացմամբ`.

The MODE chip (`MODE: test` / `MODE: production`) is bound at bundle
time from `process.env.STATE_INTEGRATION_MODE`; rebuild the UI to flip
it.

---

## 8. Files touched

- `server/db.js` — 4 new tables appended to `initSchema` after line 8058
- `server/stateIntegrations.js` — hub rewrite, new `dispatch` + legacy
  cabinet API preserved
- `server/stateIntegrations/src.js`, `eRegister.js`, `eGov.js`,
  `idCard.js`, `mobileId.js`, `customs.js` — 6 adapter modules
- `server/app.js` — 3 new routes after line 3318
- `test/state-integrations.test.js` — 10-test contract suite
- `web/src/stateIntegrations.jsx` — React panel
- `web/src/main.jsx` — import + mount

---

## 9. Backlog (deferred)

- Real SRC VAT submission via `https://www.taxservice.am/` SOAP endpoint
- Real e-Register.am lookup via the public company search
- Real e-Gov.am e-sign with an EKENG service-provider cert
- Real ID Card biometric verification
- Real Mobile-ID challenge with all three Armenian mobile carriers
- Real e-Customs declaration with the State Revenue Committee EDI bridge
- Per-adapter credentials table UI (the `state_integration_credentials`
  table exists; loading, encryption-at-rest, and rotation UI do not)
- HS code autocomplete and customs declaration draft builder in the panel
