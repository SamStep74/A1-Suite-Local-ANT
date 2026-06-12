# Worker Task: phase10-smb-records
- Session: `phase10-smb-crm-rebuild`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Base branch: `ant/ant/main` (the foundation worker's branch tip — fetch at session start)
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-records`
- Branch: `wip/phase10-smb-records`
- Launcher status file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase10-smb-crm-rebuild/worker-records/status.md`
- Launcher handoff file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase10-smb-crm-rebuild/worker-records/handoff.md`
- Tag to ship: `phase10-smb-crm-v1`

## Contract

`/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase10-smb-crm-rebuild/contract.md` — your Track 2 deliverables are in §3 Track 2.

**Dependency:** foundation worker ships first. Your base branch is `ant/ant/main` AFTER foundation's merge (the foundation tables + permission codes already exist). If the foundation work isn't merged yet, you'll work against a stale base — rebase onto `ant/ant/main` once foundation is merged.

## Objective

You are the **records worker** for Phase 10. Goal: build the customer/deal/task/quote/activity/goal CRUD layer. This is the *second* of 5 parallel workers.

## Setup

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-records`
2. `git status` — verify on `wip/phase10-smb-records` branched from `ant/ant/main`.
3. `git fetch ant` to make sure you're at the current `ant/ant/main`. If foundation has already merged, you'll see the new `smb_crm_tenants` + `smb_crm_blueprints` tables in `server/db.js`. If not, you'll have to merge `wip/phase10-smb-foundation` into your base first.
4. `npm --prefix web-modern install --legacy-peer-deps`
5. `npm --prefix web-modern test` to confirm the 70+ existing test files pass (the foundation worker may have added more).

## Scope — TWO deliverables

### Deliverable 1: `server/smbCrmRecords.js` — pure engine for the 6 entities

```js
// Pattern: same as server/crmTube.js. NO Fastify imports. NO node:sqlite imports.

class RecordNotFoundError extends Error { ... }
class RecordConflictError extends Error { ... }   // duplicate email / phone per org

// 6 entities × 5 CRUD operations = 30 functions, all pure.
// Plus merge-customers (2 → 1 with a merge_log row).

// Customers:
function createCustomer(db, orgId, { fullName, email, phone, tags, status, branchId? })
function getCustomer(db, orgId, customerId)
function updateCustomer(db, orgId, customerId, patch)
function deleteCustomer(db, orgId, customerId)
function listCustomers(db, orgId, { search?, status?, branchId?, limit?, offset? })
function mergeCustomers(db, orgId, winnerId, loserId)  // 2 → 1, write merge_log

// Deals:
function createDeal(db, orgId, { title, value, currency, stageId, customerId, branchId? })
function getDeal(db, orgId, dealId)
function updateDeal(db, orgId, dealId, patch)
function deleteDeal(db, orgId, dealId)
function listDeals(db, orgId, { stageId?, customerId?, branchId?, limit?, offset? })
function moveDealStage(db, orgId, dealId, newStageId)  // logs to activities table

// Tasks:
function createTask, getTask, updateTask, deleteTask, listTasks (with assignees, due, status)

// Quotes:
function createQuote, getQuote, updateQuote, deleteQuote, listQuotes (with line items, status: draft|sent|accepted|rejected)

// Activities:
function createActivity, getActivity, listActivities (with dealId, customerId, occurredAt)
function aggregateActivities(db, orgId, { dealId, customerId, since? })  // timeline view

// Goals:
function createGoal, getGoal, updateGoal, deleteGoal, listGoals (with metric, target, period, progress)

// Branches:
function listBranches(db, orgId)  // already in foundation; you can use it
```

Wire `ensureSmbCrmRecordsSchema(db)` into the boot sequence in `server/app.js`. Migration: 10 new tables (customers, deals, tasks, quotes, activities, goals, pipeline_stages, fields, modules, branches — but branches is already in foundation; check before adding).

### Deliverable 2: Server routes (~25 thin routes in `server/app.js`)

All routes under `/api/smb-crm/<entity>/*`. Pattern A: `auth() → requireAppAccess(db, user, "smb-crm") → requirePermission(db, user, orgId, "smb_crm.<entity>.<action>") → validate (Zod) → call <module>.<fn>(db, orgId, ...) → audit → respond`.

Routes:
- `GET/POST /api/smb-crm/customers` (list / create)
- `GET/PATCH/DELETE /api/smb-crm/customers/:id`
- `POST /api/smb-crm/customers/merge` (input: `{ winnerId, loserId }`)
- `GET/POST /api/smb-crm/deals`
- `GET/PATCH/DELETE /api/smb-crm/deals/:id`
- `POST /api/smb-crm/deals/:id/move-stage` (input: `{ newStageId }`)
- `GET/POST /api/smb-crm/tasks`
- `GET/PATCH/DELETE /api/smb-crm/tasks/:id`
- `GET/POST /api/smb-crm/quotes`
- `GET/PATCH/DELETE /api/smb-crm/quotes/:id`
- `GET/POST /api/smb-crm/activities`
- `GET/POST /api/smb-crm/goals`
- `GET/PATCH/DELETE /api/smb-crm/goals/:id`
- `GET /api/smb-crm/branches` (delegate to foundation's `tenants.js#listBranches`)

### Deliverable 3: Zod shapes in `web-modern/src/lib/api/schemas.ts`

Append:
- `SmbCrmCustomerSchema`, `SmbCrmDealSchema`, `SmbCrmTaskSchema`, `SmbCrmQuoteSchema`, `SmbCrmActivitySchema`, `SmbCrmGoalSchema`, `SmbCrmPipelineStageSchema`, `SmbCrmModuleSchema`, `SmbCrmFieldSchema`, `SmbCrmBranchSchema`
- Plus the list/create/update request schemas for each.

## Tests — 12 contract tests (`test/smb-crm/records.test.js`)

1. customer CRUD (create, read, update, delete) + audit on each mutation
2. deal CRUD + stage move (with activity log entry)
3. task CRUD + assignment
4. quote CRUD + status change (draft → sent → accepted)
5. activity auto-logged on deal stage change
6. goal CRUD
7. customer merge: 2 customers → 1, with a `merge_log` row in the activities table
8. cross-tenant: customer in tenant A not visible from tenant B (403 with `code: "ORG_MISMATCH"`)
9. RBAC: viewer can read but not write
10. idempotency: re-POST returns cached envelope
11. branch: deal with `branch_id` only visible from that branch
12. activity timeline aggregation (events for a deal over 30 days, ordered desc)

## Workflow

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-records`
2. Read the contract. Read the foundation worker's handoff (in `.orchestration/phase10-smb-crm-rebuild/worker-foundation/handoff.md` if it exists, or in the branch's commit messages) to know what's already there.
3. Build the pure engine (`smbCrmRecords.js`).
4. Add the 10 tables to `server/db.js#ensureSmbCrmRecordsSchema` (and call it from the boot sequence).
5. Add the ~25 routes to `server/app.js`.
6. Add the Zod shapes to `web-modern/src/lib/api/schemas.ts`.
7. Run `npm test` to confirm all 12 contract tests pass.
8. Commit: `git add -A && git commit -m "feat(smb-crm): records (customer/deal/task/quote/activity/goal CRUD)"`.

## Final steps

1. `npm test` — confirm 12 new tests pass; full server suite still green.
2. `npm --prefix web-modern test` — confirm web-modern still green.
3. `npm --prefix web-modern run typecheck` — clean.
4. Push: `git push -u ant wip/phase10-smb-records`.
5. Write the handoff with test count delta + files created + any deviation.
6. Mark status.md as: `state=done, completed=<iso timestamp>`.

## Constraints (HARD)

- **Do NOT touch** `server/crmTube*` (the Tube port stays shipped).
- **Do NOT touch** `web-modern/src/routes/app/crm-tube/*` (the Tube SPA stays shipped).
- **Do NOT touch** `server/rbac.js` (the Phase 9 RBAC stays shipped).
- **Do NOT touch** `server/tenants.js` (the foundation's engine; only call its functions).
- **Do NOT push to `ant/ant/main`** — the orchestrator merges.
- Do not spawn subagents — do it inline.
- The 70+ existing test files on `ant/ant/main` MUST still pass.
- The Edit tool has been seen to corrupt Armenian text. Use the heredoc + python byte-level replacement workaround.
- Report results in your final response.
