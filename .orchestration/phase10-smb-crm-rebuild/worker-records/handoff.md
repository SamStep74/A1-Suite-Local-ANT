# Handoff: phase10-smb-records → phase10-smb-{assist,automations,delivery,spa}

**Branch:** `wip/phase10-smb-records`
**Tag:** `phase10-smb-crm-v1` (to be pushed by deliverer)
**Worktree:** `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-records`
**Base:** `ant/ant/main` (foundation merged as `96aa417`)

## What this worker shipped

### Engine (1 pure file, no Fastify/sqlite/env imports)
| File | Public surface |
|------|----------------|
| `server/smbCrmRecords.js` | 30 functions (6 entities × 5 CRUD: create/get/list/update/delete) + `mergeCustomers` + 6 view adapters (`toCustomerView`, `toDealView`, `toTaskView`, `toQuoteView`, `toActivityView`, `toGoalView`) + 4 typed error classes (`RecordsError`, `NotFoundError`, `ConflictError`, `OrgMismatchError`) + 5 validators (locale, status, currency, email, nonEmptyString) + `inOrg` helper |

### Schema (server/db.js)
- `ensureSmbCrmRecordsSchema(db)` adds 6 tables (all with `org_id` scope + `created_at`/`updated_at` + snake_case cols, FKs use `ON DELETE SET NULL` to preserve history):
  - `smb_crm_customers` (fullName, email, phone, companyName, address, locale, status enum `active|lead|inactive`, branchId, tags_json, custom_json, merged_into_id)
  - `smb_crm_deals` (title, customer_id, value, currency, stage_id, probability, expected_close_date, status enum `open|won|lost`, owner_user_id, branchId, tags_json)
  - `smb_crm_todo_tasks` (title, description, customer_id, deal_id, due_at, status enum `open|done|cancelled`, priority enum `low|normal|high|urgent`, assigned_user_id) — **note the `todo_` infix: foundation reserved `smb_crm_tasks` for apply-time materialization, this track reserves `smb_crm_todo_tasks` for the runtime todo entity**
  - `smb_crm_quotes` (number, customer_id, deal_id, issue_date, expiry_date, status enum `draft|sent|accepted|declined|expired`, total_amount, currency, line_items_json)
  - `smb_crm_activities` (type enum `note|call|email|meeting|sms|task`, subject, body, customer_id, deal_id, quote_id, activity_at, created_by)
  - `smb_crm_goals` (name, metric, target_value, current_value, period_start, period_end, owner_user_id)
- Indexes on `(org_id, updated_at DESC)` for the list-by-recency path, plus entity-specific lookups on `(org_id, status)`, `(org_id, customer_id)`, `(org_id, deal_id)`, `(org_id, owner_user_id)`, `(org_id, assigned_user_id)`, `(org_id, merged_into_id)`.

### Routes (server/app.js — 31 thin handlers, all under `/api/smb-crm/*`)
All share the Pattern A spine:
`auth → requireAppAccess("smb-crm") → smbCrmAuth.requireSmbCrmPermission → idempotency_keys check → engine call → audit row → respond`

| Method | Path | Permission | Engine function | Audit type |
|--------|------|------------|-----------------|------------|
| GET    | `/customers` | `smb_crm.access` | `listCustomers` | — |
| POST   | `/customers` | `smb_crm.blueprint.apply` | `createCustomer` | `smb_crm.customer.created` |
| GET    | `/customers/:id` | `smb_crm.access` | `getCustomer` | — |
| PATCH  | `/customers/:id` | `smb_crm.blueprint.apply` | `updateCustomer` | `smb_crm.customer.updated` |
| DELETE | `/customers/:id` | `smb_crm.blueprint.apply` | `deleteCustomer` | `smb_crm.customer.deleted` |
| POST   | `/customers/merge` | `smb_crm.blueprint.apply` | `mergeCustomers` | `smb_crm.customer.merged` |
| GET    | `/deals` | `smb_crm.access` | `listDeals` | — |
| POST   | `/deals` | `smb_crm.blueprint.apply` | `createDeal` | `smb_crm.deal.created` |
| GET    | `/deals/:id` | `smb_crm.access` | `getDeal` | — |
| PATCH  | `/deals/:id` | `smb_crm.blueprint.apply` | `updateDeal` | `smb_crm.deal.updated` |
| DELETE | `/deals/:id` | `smb_crm.blueprint.apply` | `deleteDeal` | `smb_crm.deal.deleted` |
| GET    | `/tasks` | `smb_crm.access` | `listTasks` | — |
| POST   | `/tasks` | `smb_crm.blueprint.apply` | `createTask` | `smb_crm.task.created` |
| GET    | `/tasks/:id` | `smb_crm.access` | `getTask` | — |
| PATCH  | `/tasks/:id` | `smb_crm.blueprint.apply` | `updateTask` | `smb_crm.task.updated` |
| DELETE | `/tasks/:id` | `smb_crm.blueprint.apply` | `deleteTask` | `smb_crm.task.deleted` |
| GET    | `/quotes` | `smb_crm.access` | `listQuotes` | — |
| POST   | `/quotes` | `smb_crm.blueprint.apply` | `createQuote` | `smb_crm.quote.created` |
| GET    | `/quotes/:id` | `smb_crm.access` | `getQuote` | — |
| PATCH  | `/quotes/:id` | `smb_crm.blueprint.apply` | `updateQuote` | `smb_crm.quote.updated` |
| DELETE | `/quotes/:id` | `smb_crm.blueprint.apply` | `deleteQuote` | `smb_crm.quote.deleted` |
| GET    | `/activities` | `smb_crm.access` | `listActivities` | — |
| POST   | `/activities` | `smb_crm.blueprint.apply` | `createActivity` | `smb_crm.activity.created` |
| GET    | `/activities/:id` | `smb_crm.access` | `getActivity` | — |
| PATCH  | `/activities/:id` | `smb_crm.blueprint.apply` | `updateActivity` | `smb_crm.activity.updated` |
| DELETE | `/activities/:id` | `smb_crm.blueprint.apply` | `deleteActivity` | `smb_crm.activity.deleted` |
| GET    | `/goals` | `smb_crm.access` | `listGoals` | — |
| POST   | `/goals` | `smb_crm.blueprint.apply` | `createGoal` | `smb_crm.goal.created` |
| GET    | `/goals/:id` | `smb_crm.access` | `getGoal` | — |
| PATCH  | `/goals/:id` | `smb_crm.blueprint.apply` | `updateGoal` | `smb_crm.goal.updated` |
| DELETE | `/goals/:id` | `smb_crm.blueprint.apply` | `deleteGoal` | `smb_crm.goal.deleted` |

### Route helpers (de-duplicated; 5 helpers, not 30)
The 31 routes share 5 helper functions in `server/app.js` (recordsCreateRoute, recordsUpdateRoute, recordsDeleteRoute, recordsListRoute, recordsGetRoute) plus 6 entity descriptors that wire `{viewKey, listKey, create, get, list, update, delete, toView}` for each entity. The merge endpoint is its own handler because its envelope differs (`{ok, merge: {survivorId, loserId, survivor, loser}}`).

### Permission reuse strategy (no new codes added)
Per the contract, the records worker adds **zero** new `smb_crm.*` permission codes — it reuses the foundation's 11 codes:
- All reads (GET) → `smb_crm.access` (everyone with the app gets reads)
- All writes (POST/PATCH/DELETE + merge) → `smb_crm.blueprint.apply` (the same code that gates blueprint materialization; owner/admin have it, operator/operator-tier roles do not)
This means a read-only role (e.g. viewer) can list customers but cannot create them. The `customer.create`-style split lives at the V2 authorization layer.

### SPA contracts (web-modern)
- `web-modern/src/lib/api/schemas.ts` — 60+ new Zod shapes, gated by `/* ─── block-smb-crm-records-begin ─── */` / `/* ─── block-smb-crm-records-end ─── */` markers. Covers:
  - 6 entity view schemas + 6 Create/Update request schemas + 6 Get/List/Delete response schemas
  - 6 list query schemas with filter fields (status, search, customerId, dealId, ownerUserId, branchId, type, metric, etc.)
  - 5 shared enums (CustomerStatus, DealStatus, TaskStatus, TaskPriority, QuoteStatus, ActivityType)
  - 4 list-filter shapes for foundation materialization tables (Branches, Modules, Fields, PipelineStages) — reuses the foundation's `SmbCrmBranchSchema` for the branches response; defines `SmbCrmModuleSchema`, `SmbCrmFieldSchema`, `SmbCrmPipelineStageSchema` for the others
  - Merge request/response schemas for `/customers/merge`

### Tests (`test/smb-crm/records.test.js` — 12 contract gates)
1. auth-gated (401 without session) — `GET /api/smb-crm/customers`
2. app-access-gated (403 for Support user)
3. input-validated (400 on missing `idempotencyKey`) — `POST /api/smb-crm/customers`
4. happy-path audit-once (200 + exactly one audit row of type `smb_crm.customer.created`)
5. idempotent replay (same envelope returned, no duplicate audit)
6. cross-tenant safety (org A customer invisible to org B at engine + auth-helper level)
7. list-org-scoped (listCustomers with `toCustomerView` shows only own org's rows)
8. delete removes row + cross-tenant delete returns `false` (engine doesn't see foreign row)
9. updateCustomer preserves untouched fields (uses `toCustomerView` to assert camelCase shape)
10. mergeCustomers transfers B's linked rows (deal/quote/activity) to A + two-layer cross-tenant rejection (foreign caller → `NotFoundError`; same-org caller with foreign loser → `OrgMismatchError`)
11. createCustomer rejects invalid email + missing fullName (400)
12. RBAC contract guard (route returns 200 on `smb_crm.blueprint.apply`; auth helper throws `INVALID_PERMISSION` for non-`smb_crm.*` codes — regression guard against accidentally raising a new code)

## Conventions for downstream workers

### Naming conflicts to be aware of
- `smb_crm_tasks` is foundation's apply-time materialization table (for blueprint-imported todos). The records worker uses `smb_crm_todo_tasks` for the runtime todo entity. The route slug is `/api/smb-crm/tasks` (no `todo_` infix on the wire — that's an internal table-naming detail).
- `smb_crm_oportunidades` (foundation typo) is the apply-time opportunities table; the records worker does NOT mirror that typo — its deals table is `smb_crm_deals` (clean spelling).

### Engine contract: raw snake_case rows
The engine returns raw SQLite rows (snake_case). The route layer is responsible for converting to the camelCase view via `to*View` adapters. The Zod shapes match the camelCase view, not the raw row. Tests that probe engine state directly (e.g. test 7's "no cross-tenant leakage") MUST wrap engine returns in `to*View` before asserting camelCase fields.

### Cross-entity FK behavior
All cross-entity FKs use `ON DELETE SET NULL`. Deleting a customer preserves the deal/quote/activity history with `customer_id = NULL`. The merge endpoint is the supported way to consolidate two customers: it retargets deals/quotes/activities to the survivor in a single transaction, then stamps the loser's `merged_into_id`. The default `listCustomers` filter excludes merged rows (pass `includeMerged: "true"` to include).

### `mergeCustomers` cross-tenant contract (defense in depth, two layers)
1. **Org-scoped lookup** — `getCustomer(db, orgId, ...)` returns `null` for any row outside the caller's org. A foreign caller asking to merge rows they can't see gets `NotFoundError` (statusCode 404).
2. **Loser-foreign check** — even when the survivor is in the caller's org, the loser lookup happens with the same orgId scope. A foreign loser gets `OrgMismatchError` (statusCode 403, code `ORG_MISMATCH`).
This matches the foundation's `smbCrmAuth.requireSmbCrmPermission` layered defense (foreign orgId in user → ORG_MISMATCH at the auth layer; missing role → PERMISSION_DENIED).

### File map for downstream workers
- **Track 3 (assist)**: extends `smbCrmBlueprintGenerator` with apply helpers, plus `smbCrmTranslate` already supports the trilingual surface. The records worker added no translation surface; assist owns the customer/deal/etc. UI string catalog.
- **Track 4 (automations)**: new engines + tables. `smb_crm_automations` and `smb_crm_webhooks`. Wires `smb_crm.integration.manage`, `smb_crm.webhook.manage`, `smb_crm.automation.run`. The records surface is a natural trigger source (e.g. "on customer.created, dispatch webhook X").
- **Track 5 (delivery / SPA)**: imports the Zod shapes from `web-modern/src/lib/api/schemas.ts` (under the `block-smb-crm-records-*` markers) + uses `isSmbCrmPermissionCode` from `web-modern/src/lib/rbac/permissions.ts`. The records block ends on line 5556 of that file (foundation block is 4531–4770, records block is appended after).

### Hard constraints (preserved from foundation; do not violate)
- **Do NOT touch** `server/crmTube*` (Phase 9 track)
- **Do NOT touch** `web-modern/src/routes/app/crm-tube/*`
- **Do NOT touch** `server/rbac.js` — its `PERMISSIONS_BY_ROLE` is frozen; the 11 `smb_crm.*` codes live in the parallel `server/smbCrmAuth.js` helper
- **Do NOT touch** `server/tenants.js` — the records worker uses `server/smbCrmTenants.js` (Phase 10 SMB CRM tenant store) and never imports the legacy tenant store
- New engines must not import `fastify`, `app.js`, or read `process.env` directly
- New routes must follow the Pattern A spine (see foundation handoff §"Pattern A spine")

## Verification commands

```bash
# All 12 records contract tests
node --test test/smb-crm/records.test.js
# → 12/12 pass

# Full server test suite (run from repo root)
find test -name "*.test.js" -type f -print0 | xargs -0 node --test
# → 1000 total: 988 pass, 12 fail
# → 12 are pre-existing baseline failures on ant/ant/main
# → 0 new regressions (my 12 new tests all pass)

# Web-modern typecheck
cd web-modern && npx tsc --noEmit
# → exit 0
```

## Known baselines (failures expected on `ant/ant/main`, NOT this commit's fault)
- `api.test.js:52` — dashboard launcher source wiring
- `api.test.js:67` — integration connector rejects malformed path keys
- `api.test.js:174` — customer 360 joins
- `api.test.js:212` — failed webhook delivery can be retried
- `api.test.js:226` — service case mutations reject malformed metadata
- `api.test.js:243` — workflow rule state and rollback
- `api.test.js:569` — forms reject malformed metadata
- `api.test.js:683-687` — `fetcher` helper tests (5 cases)

These are independent of the SMB CRM track and predate this branch.

## Merge order (per `merge-order.md`)
1. ✅ `wip/phase10-smb-foundation` — merged as `96aa417`
2. 🟢 `wip/phase10-smb-records` (this branch)
3. ⏳ `wip/phase10-smb-assist` — depends on #1
4. ⏳ `wip/phase10-smb-automations` — depends on #1
5. ⏳ `wip/phase10-smb-spa` — depends on #1
6. ⏳ `wip/phase10-smb-delivery` — depends on #1, integrates #2-#5
