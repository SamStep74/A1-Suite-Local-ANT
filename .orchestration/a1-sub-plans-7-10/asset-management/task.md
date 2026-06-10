# Worker Task: asset-management
- Session: `a1-sub-plans-7-10`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-a1-sub-plans-7-10-asset-management`
- Branch: `a1/sub-plan-asset-management`
- Launcher status file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/a1-sub-plans-7-10/asset-management/status.md`
- Launcher handoff file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/a1-sub-plans-7-10/asset-management/handoff.md`
- Tag to ship: `asset-management-mvp`
## Seeded Local Overlays
- `HANDOFF.md`
- `package.json`
## Plan File
Path: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/docs/superpowers/plans/2026-06-08-a1-suite-ant-asset-management.md`
### Plan File Contents
<plan>
# Sub-Plan 8: Asset Management (Разное имущество) — Differentiator #1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track physical assets (equipment, vehicles, refrigeration units, greenhouses) and their lifecycle: acquisition, depreciation, maintenance schedule, assignment to employees or projects, write-off. Especially valuable for Spayka (refrigeration, vehicles) and Armosphère (greenhouses).

**Architecture:** Pattern A module `server/assets.js` (pure engine: depreciation schedule, maintenance interval, asset value roll-up) + `web/src/assets.jsx` panel (Asset Registry / Depreciation / Maintenance / Assignment tabs) + `test/assets.test.js`. New tables: `assets`, `asset_categories`, `asset_depreciation_schedules`, `asset_maintenance_logs`, `asset_assignments` (links to sub-plan 4 employees + sub-plan 9 fleet).

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. Straight-line and reducing-balance depreciation; AMD currency; no external dep.

**Depends on:** sub-plan 0 (Pattern A skeleton), sub-plan 4 (HR for assignments), sub-plan 9 (Fleet for vehicles), sub-plan 10 (Greenhouse for greenhouse assets).

---

## File Structure

- Create: `server/assets.js` — pure engine (depreciation math, maintenance intervals, NBV roll-up).
- Create: `test/assets.test.js` — Pattern A contract suite (auth, app access, validation, audit, idempotency, period lock, depreciation math).
- Modify: `server/db.js` — add 5 new tables inside the existing migration block.
- Modify: `server/app.js` — register 11 asset routes after the existing Pattern A blocks.
- Create: `web/src/assets.jsx` — 4-tab React panel (Registry / Depreciation / Maintenance / Assignment).
- Modify: `web/src/main.jsx` — mount the panel + action handlers.
- Modify: `HANDOFF.md` — add the asset-management milestone.

## DB additions

- `asset_categories` (id, org_id, name, default_useful_life_months, default_depreciation_method, default_residual_pct, asset_account_id, accum_depr_account_id, depr_expense_account_id, created_at)
- `assets` (id, org_id, category_id, name, serial, purchase_date, purchase_cost_amd, vendor_id, current_location_id, status, salvage_value_amd, parent_asset_id, created_at)
- `asset_depreciation_schedules` (id, asset_id, period_key, depreciation_amd, accumulated_amd, net_book_value_amd, status, posted_at)
- `asset_maintenance_logs` (id, asset_id, performed_at, kind, cost_amd, vendor_id, notes, file_id, next_due_at)
- `asset_assignments` (id, asset_id, assignee_type, assignee_id, assigned_at, returned_at, signature_doc_id)

## API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/assets/categories` | Create category |
| POST | `/api/assets` | Create asset |
| GET | `/api/assets/:id/depreciation` | Schedule |
| POST | `/api/assets/:id/post-depreciation?periodKey=...` | Post a depreciation line to ledger |
| GET | `/api/assets/:id/maintenance-history` | List maintenance |
| POST | `/api/assets/:id/maintenance` | Log maintenance |
| POST | `/api/assets/:id/assign` | Assign (employee, project, location) |
| POST | `/api/assets/:id/return` | Return / unassign |
| GET | `/api/assets/report/value` | Total NBV by category |
| POST | `/api/assets/:id/write-off` | Write off (with approval + audit) |

## Tasks

### Task 1: Write the RED contract test for the assets module

**Files:**
- Create: `test/assets.test.js`
- Read: `test/healthcheck.test.js` (style reference)
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

async function seedCategory(app, cookie, name = "Սարքեր") {
  const res = await app.inject({
    method: "POST",
    url: "/api/assets/categories",
    headers: { cookie },
    payload: {
      idempotencyKey: `cat-${name}-${Date.now()}`,
      name,
      defaultUsefulLifeMonths: 60,
      defaultDepreciationMethod: "straight_line",
      defaultResidualPct: 10,
      assetAccountId: "acct-1600",
      accumDeprAccountId: "acct-1601",
      deprExpenseAccountId: "acct-7100"
    }
  });
  assert.strictEqual(res.statusCode, 200, res.body);
  return res.json().category;
}

test("assets:create is auth-gated", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/assets/categories", payload: { name: "x" } });
    assert.strictEqual(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("assets:create requires assets app access", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/assets/categories",
      headers: { cookie },
      payload: { name: "x", idempotencyKey: "no-access" }
    });
    assert.strictEqual(res.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("assets:create validates input", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/assets/categories",
      headers: { cookie },
      payload: { idempotencyKey: "missing-name" }
    });
    assert.strictEqual(res.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("assets:create writes audit row", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    const cat = await seedCategory(app, cookie);
    assert.ok(cat.id, "category id returned");
    const after = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    assert.strictEqual(after, before + 1);
  } finally {
    await app.close();
  }
});

test("assets:create is idempotent on replay", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    const idem = `idem-${Date.now()}`;
    const payload = {
      method: "POST",
      url: "/api/assets/categories",
      headers: { cookie },
      payload: {
        idempotencyKey: idem,
        name: "Հովացման համակարգեր",
        defaultUsefulLifeMonths: 84,
        defaultDepreciationMethod: "reducing_balance",
        defaultResidualPct: 5,
        assetAccountId: "acct-1610",
        accumDeprAccountId: "acct-1611",
        deprExpenseAccountId: "acct-7110"
      }
    };
    const first = await app.inject(payload);
    const second = await app.inject(payload);
    assert.strictEqual(first.statusCode, 200);
    assert.strictEqual(second.statusCode, 200);
    assert.deepStrictEqual(first.json(), second.json());
    const after = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    assert.strictEqual(after, before + 1, "idempotent replay must not double-write audit");
  } finally {
    await app.close();
  }
});

test("assets:depreciation schedule applies straight-line math", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const cat = await seedCategory(app, cookie);
    const create = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: { cookie },
      payload: {
        idempotencyKey: `asset-${Date.now()}`,
        categoryId: cat.id,
        name: "Samsung սառնարան #1",
        serial: "SR-0001",
        purchaseDate: "2026-01-15",
        purchaseCostAmd: 1200000,
        vendorId: "v-samsung",
        locationId: "wh-cold-1",
        salvageValueAmd: 120000
      }
    });
    assert.strictEqual(create.statusCode, 200, create.body);
    const asset = create.json().asset;
    const sched = await app.inject({ method: "GET", url: `/api/assets/${asset.id}/depreciation`, headers: { cookie } });
    assert.strictEqual(sched.statusCode, 200);
    const body = sched.json();
    assert.strictEqual(body.schedule.length, 60, "60 monthly periods");
    assert.strictEqual(body.schedule[0].depreciationAmd, 18000, "straight-line = (1200000-120000)/60");
    assert.strictEqual(body.schedule[body.schedule.length - 1].netBookValueAmd, 120000, "ends at salvage");
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails (RED)**

Run:
```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/assets.test.js 2>&1 | tail -20
```

Expected: FAIL with `404` for `/api/assets/categories` and `/api/assets`.

- [ ] **Step 3: Commit RED tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add test/assets.test.js && git commit -m "test(assets): define Pattern A contract + depreciation math" && git push ant main
```

### Task 2: Add the pure engine module `server/assets.js`

**Files:**
- Create: `server/assets.js`

- [ ] **Step 1: Create the engine**

```js
"use strict";

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    const err = new Error(`${field} must be a positive integer`);
    err.statusCode = 400;
    throw err;
  }
}

function requirePositiveNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    const err = new Error(`${field} must be a non-negative number`);
    err.statusCode = 400;
    throw err;
  }
}

function validateCategoryInput(input) {
  if (!input || typeof input !== "object") {
    const err = new Error("body required");
    err.statusCode = 400;
    throw err;
  }
  const name = String(input.name || "").trim();
  if (name.length < 2 || name.length > 80) {
    const err = new Error("name must be 2-80 chars");
    err.statusCode = 400;
    throw err;
  }
  requirePositiveInteger(input.defaultUsefulLifeMonths, "defaultUsefulLifeMonths");
  if (!["straight_line", "reducing_balance"].includes(input.defaultDepreciationMethod)) {
    const err = new Error("defaultDepreciationMethod must be straight_line or reducing_balance");
    err.statusCode = 400;
    throw err;
  }
  requirePositiveNumber(input.defaultResidualPct, "defaultResidualPct");
  if (input.defaultResidualPct > 100) {
    const err = new Error("defaultResidualPct must be <= 100");
    err.statusCode = 400;
    throw err;
  }
  for (const field of ["assetAccountId", "accumDeprAccountId", "deprExpenseAccountId"]) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      const err = new Error(`${field} required`);
      err.statusCode = 400;
      throw err;
    }
  }
  return { name };
}

function validateAssetInput(input) {
  if (!input || typeof input !== "object") {
    const err = new Error("body required");
    err.statusCode = 400;
    throw err;
  }
  const name = String(input.name || "").trim();
  if (name.length < 2 || name.length > 120) {
    const err = new Error("name must be 2-120 chars");
    err.statusCode = 400;
    throw err;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.purchaseDate || ""))) {
    const err = new Error("purchaseDate must be YYYY-MM-DD");
    err.statusCode = 400;
    throw err;
  }
  requirePositiveNumber(input.purchaseCostAmd, "purchaseCostAmd");
  requirePositiveNumber(input.salvageValueAmd || 0, "salvageValueAmd");
  if ((input.salvageValueAmd || 0) > input.purchaseCostAmd) {
    const err = new Error("salvageValueAmd must be <= purchaseCostAmd");
    err.statusCode = 400;
    throw err;
  }
  if (typeof input.categoryId !== "string" || input.categoryId.length === 0) {
    const err = new Error("categoryId required");
    err.statusCode = 400;
    throw err;
  }
  return { name, purchaseCostAmd: Math.round(input.purchaseCostAmd), salvageValueAmd: Math.round(input.salvageValueAmd || 0) };
}

function depreciateStraightLine({ cost, salvage, lifeMonths }) {
  const depreciable = cost - salvage;
  const monthly = Math.round(depreciable / lifeMonths);
  let accumulated = 0;
  const schedule = [];
  for (let i = 0; i < lifeMonths; i += 1) {
    const isLast = i === lifeMonths - 1;
    const amount = isLast ? depreciable - accumulated : monthly;
    accumulated += amount;
    schedule.push({
      periodIndex: i,
      depreciationAmd: amount,
      accumulatedAmd: accumulated,
      netBookValueAmd: cost - accumulated
    });
  }
  return schedule;
}

function depreciateReducingBalance({ cost, salvage, lifeMonths, rate }) {
  const effectiveRate = rate || (2 / lifeMonths);
  let nbv = cost;
  let accumulated = 0;
  const schedule = [];
  for (let i = 0; i < lifeMonths; i += 1) {
    const amount = Math.round(nbv * effectiveRate);
    const floor = Math.max(0, nbv - salvage);
    const capped = Math.min(amount, floor);
    accumulated += capped;
    nbv = cost - accumulated;
    schedule.push({
      periodIndex: i,
      depreciationAmd: capped,
      accumulatedAmd: accumulated,
      netBookValueAmd: nbv
    });
  }
  return schedule;
}

function buildSchedule({ cost, salvage, lifeMonths, method, rate }) {
  if (method === "reducing_balance") return depreciateReducingBalance({ cost, salvage, lifeMonths, rate });
  return depreciateStraightLine({ cost, salvage, lifeMonths });
}

function nextMaintenanceDue({ lastPerformedAt, intervalDays }) {
  const last = new Date(lastPerformedAt).getTime();
  if (Number.isNaN(last)) {
    const err = new Error("lastPerformedAt must be ISO date");
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isInteger(intervalDays) || intervalDays <= 0) {
    const err = new Error("intervalDays must be positive integer");
    err.statusCode = 400;
    throw err;
  }
  const next = new Date(last + intervalDays * 86400000);
  return next.toISOString();
}

function rollUpValueByCategory(assets) {
  const totals = new Map();
  for (const asset of assets) {
    const key = asset.categoryId;
    const current = totals.get(key) || { categoryId: key, totalCostAmd: 0, totalNbvAmd: 0, count: 0 };
    current.totalCostAmd += asset.purchaseCostAmd;
    current.totalNbvAmd += asset.netBookValueAmd;
    current.count += 1;
    totals.set(key, current);
  }
  return Array.from(totals.values());
}

function applyMaintenanceToAsset({ asset, lastLog }) {
  if (!lastLog || !lastLog.nextDueAt) return asset;
  return { ...asset, nextMaintenanceDueAt: lastLog.nextDueAt };
}

module.exports = {
  validateCategoryInput,
  validateAssetInput,
  buildSchedule,
  nextMaintenanceDue,
  rollUpValueByCategory,
  applyMaintenanceToAsset
};
```

- [ ] **Step 2: Run focused unit check (still RED — route not registered yet)**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/assets.test.js 2>&1 | tail -10
```

Expected: still FAIL with `404`.

- [ ] **Step 3: Commit the engine**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/assets.js && git commit -m "feat(assets): add pure depreciation/maintenance/NBV engine" && git push ant main
```

### Task 3: Add the 5 new tables to `server/db.js`

**Files:**
- Modify: `server/db.js` (extend the existing migration block before the closing `})()` of the migration IIFE)

- [ ] **Step 1: Add the table DDL inside the existing migration block**

Inside `server/db.js`, locate the existing `db.exec(` block where all tables are created (the one that ends with `;`). Immediately BEFORE the closing `;`, append:

```js
    CREATE TABLE IF NOT EXISTS asset_categories (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      default_useful_life_months INTEGER NOT NULL,
      default_depreciation_method TEXT NOT NULL,
      default_residual_pct REAL NOT NULL,
      asset_account_id TEXT NOT NULL,
      accum_depr_account_id TEXT NOT NULL,
      depr_expense_account_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      name TEXT NOT NULL,
      serial TEXT,
      purchase_date TEXT NOT NULL,
      purchase_cost_amd INTEGER NOT NULL,
      vendor_id TEXT,
      current_location_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      salvage_value_amd INTEGER NOT NULL DEFAULT 0,
      parent_asset_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES asset_categories(id)
    );
    CREATE TABLE IF NOT EXISTS asset_depreciation_schedules (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      depreciation_amd INTEGER NOT NULL,
      accumulated_amd INTEGER NOT NULL,
      net_book_value_amd INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      posted_at TEXT,
      UNIQUE (asset_id, period_key),
      FOREIGN KEY (asset_id) REFERENCES assets(id)
    );
    CREATE TABLE IF NOT EXISTS asset_maintenance_logs (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      performed_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      cost_amd INTEGER NOT NULL DEFAULT 0,
      vendor_id TEXT,
      notes TEXT,
      file_id TEXT,
      next_due_at TEXT,
      FOREIGN KEY (asset_id) REFERENCES assets(id)
    );
    CREATE TABLE IF NOT EXISTS asset_assignments (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      assignee_type TEXT NOT NULL,
      assignee_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      returned_at TEXT,
      signature_doc_id TEXT,
      FOREIGN KEY (asset_id) REFERENCES assets(id)
    );
    CREATE INDEX IF NOT EXISTS idx_assets_org ON assets(org_id);
    CREATE INDEX IF NOT EXISTS idx_asset_depr_asset ON asset_depreciation_schedules(asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_maint_asset ON asset_maintenance_logs(asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_assign_asset ON asset_assignments(asset_id);
```

- [ ] **Step 2: Re-run the contract test (still RED — route not registered yet)**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/assets.test.js 2>&1 | tail -10
```

Expected: still FAIL with `404`.

- [ ] **Step 3: Commit the migration**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/db.js && git commit -m "feat(assets): migrate 5 asset tables" && git push ant main
```

### Task 4: Register the 11 routes in `server/app.js`

**Files:**
- Modify: `server/app.js` (add import near the top + register routes after the existing Pattern A block)

- [ ] **Step 1: Add the import**

Near other engine imports at the top of `server/app.js`:

```js
const assets = require("./assets");
```

- [ ] **Step 2: Add the category + asset create + schedule + post-depreciation routes**

```js
app.post("/api/assets/categories", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "assets");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) {
    const err = new Error("idempotencyKey is required");
    err.statusCode = 400;
    throw err;
  }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  assets.validateCategoryInput(body);
  const id = randomId("cat");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO asset_categories (id, org_id, name, default_useful_life_months, default_depreciation_method, default_residual_pct, asset_account_id, accum_depr_account_id, depr_expense_account_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    id, user.org_id, body.name.trim(), body.defaultUsefulLifeMonths, body.defaultDepreciationMethod, body.defaultResidualPct,
    body.assetAccountId, body.accumDeprAccountId, body.deprExpenseAccountId, now
  );
  const category = db.prepare("SELECT * FROM asset_categories WHERE id = ?").get(id);
  const envelope = { ok: true, category };
  db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(
    randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now
  );
  recordAudit(db, user, "assets.category.create", "asset_category", id, { name: category.name, idempotencyKey: idem });
  return envelope;
});

app.post("/api/assets", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "assets");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) {
    const err = new Error("idempotencyKey is required");
    err.statusCode = 400;
    throw err;
  }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  const cleaned = assets.validateAssetInput(body);
  const category = db.prepare("SELECT * FROM asset_categories WHERE id = ? AND org_id = ?").get(body.categoryId, user.org_id);
  if (!category) {
    const err = new Error("category not found");
    err.statusCode = 400;
    throw err;
  }
  const id = randomId("asset");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO assets (id, org_id, category_id, name, serial, purchase_date, purchase_cost_amd, vendor_id, current_location_id, status, salvage_value_amd, parent_asset_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    id, user.org_id, body.categoryId, cleaned.name, body.serial || null, body.purchaseDate, cleaned.purchaseCostAmd,
    body.vendorId || null, body.locationId || null, "active", cleaned.salvageValueAmd, body.parentAssetId || null, now
  );
  const asset = db.prepare("SELECT * FROM assets WHERE id = ?").get(id);
  const envelope = { ok: true, asset };
  db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(
    randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now
  );
  recordAudit(db, user, "assets.create", "asset", id, { name: asset.name, idempotencyKey: idem });
  return envelope;
});

app.get("/api/assets/:id/depreciation", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "assets");
  const asset = db.prepare("SELECT a.*, c.default_useful_life_months, c.default_depreciation_method, c.default_residual_pct, c.accum_depr_account_id, c.depr_expense_account_id FROM assets a JOIN asset_categories c ON c.id = a.category_id WHERE a.id = ? AND a.org_id = ?").get(request.params.id, user.org_id);
  if (!asset) {
    const err = new Error("asset not found");
    err.statusCode = 404;
    throw err;
  }
  const salvage = Math.round(asset.purchase_cost_amd * (asset.default_residual_pct / 100));
  const schedule = assets.buildSchedule({ cost: asset.purchase_cost_amd, salvage, lifeMonths: asset.default_useful_life_months, method: asset.default_depreciation_method });
  return { ok: true, schedule, salvageValueAmd: salvage };
});

app.post("/api/assets/:id/post-depreciation", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "assets");
  const periodKey = String(request.query.periodKey || "").trim();
  if (!/^\d{4}-\d{2}$/.test(periodKey)) {
    const err = new Error("periodKey must be YYYY-MM");
    err.statusCode = 400;
    throw err;
  }
  const asset = db.prepare("SELECT a.*, c.accum_depr_account_id, c.depr_expense_account_id FROM assets a JOIN asset_categories c ON c.id = a.category_id WHERE a.id = ? AND a.org_id = ?").get(request.params.id, user.org_id);
  if (!asset) {
    const err = new Error("asset not found");
    err.statusCode = 404;
    throw err;
  }
  const existing = db.prepare("SELECT * FROM asset_depreciation_schedules WHERE asset_id = ? AND period_key = ?").get(asset.id, periodKey);
  if (existing) return { ok: true, schedule: existing, replay: true };
  const salvage = Math.round(asset.purchase_cost_amd * (asset.salvage_value_amd > 0 ? 0 : 10) / 100);
  const schedule = assets.buildSchedule({ cost: asset.purchase_cost_amd, salvage, lifeMonths: 60, method: "straight_line" });
  const monthIndex = Math.max(0, Math.min(schedule.length - 1, Number(periodKey.slice(5, 7)) - 1));
  const line = schedule[monthIndex];
  const id = randomId("depr");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO asset_depreciation_schedules (id, asset_id, period_key, depreciation_amd, accumulated_amd, net_book_value_amd, status, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    id, asset.id, periodKey, line.depreciationAmd, line.accumulatedAmd, line.netBookValueAmd, "posted", now
  );
  postJournalEntry(db, user, {
    date: `${periodKey}-28`,
    description: `Հարկում համար ${asset.name} (${periodKey})`,
    debitAccount: asset.depr_expense_account_id,
    creditAccount: asset.accum_depr_account_id,
    amount: line.depreciationAmd
  });
  recordAudit(db, user, "assets.post-depreciation", "asset", asset.id, { periodKey, amount: line.depreciationAmd });
  return { ok: true, schedule: { id, periodKey, depreciationAmd: line.depreciationAmd, accumulatedAmd: line.accumulatedAmd, netBookValueAmd: line.netBookValueAmd } };
});
```

- [ ] **Step 3: Add the maintenance, assignment, return, value report, and write-off routes**

```js
app.get("/api/assets/:id/maintenance-history", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "assets");
  const rows = db.prepare("SELECT * FROM asset_maintenance_logs WHERE asset_id = ? ORDER BY performed_at DESC").all(request.params.id);
  return { ok: true, logs: rows };
});

app.post("/api/assets/:id/maintenance", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "assets");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) {
    const err = new Error("idempotencyKey is required");
    err.statusCode = 400;
    throw err;
  }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  if (!body.performedAt || !body.kind) {
    const err = new Error("performedAt and kind required");
    err.statusCode = 400;
    throw err;
  }
  const nextDueAt = body.intervalDays ? assets.nextMaintenanceDue({ lastPerformedAt: body.performedAt, intervalDays: body.intervalDays }) : null;
  const id = randomId("maint");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO asset_maintenance_logs (id, asset_id, performed_at, kind, cost_amd, vendor_id, notes, file_id, next_due_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    id, request.params.id, body.performedAt, body.kind, Math.round(body.costAmd || 0), body.vendorId || null, body.notes || null, body.fileId || null, nextDueAt
  );
  const log = db.prepare("SELECT * FROM asset_maintenance_logs WHERE id = ?").get(id);
  const envelope = { ok: true, log };
  db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(
    randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now
  );
  recordAudit(db, user, "assets.maintenance", "asset", request.params.id, { kind: body.kind, idempotencyKey: idem });
  return envelope;
});

app.post("/api/assets/:id/assign", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "assets");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) {
    const err = new Error("idempotencyKey is required");
    err.statusCode = 400;
    throw err;
  }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  if (!body.assigneeType || !body.assigneeId) {
    const err = new Error("assigneeType and assigneeId required");
    err.statusCode = 400;
    throw err;
  }
  const id = randomId("asgn");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO asset_assignments (id, asset_id, assignee_type, assignee_id, assigned_at, returned_at, signature_doc_id) VALUES (?, ?, ?, ?, ?, NULL, ?)").run(
    id, request.params.id, body.assigneeType, body.assigneeId, now, body.signatureDocId || null
  );
  const assignment = db.prepare("SELECT * FROM asset_assignments WHERE id = ?").get(id);
  const envelope = { ok: true, assignment };
  db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(
    randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now
  );
  recordAudit(db, user, "assets.assign", "asset", request.params.id, { assigneeType: body.assigneeType, assigneeId: body.assigneeId, idempotencyKey: idem });
  return envelope;
});

app.post("/api/assets/:id/return", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "assets");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) {
    const err = new Error("idempotencyKey is required");
    err.statusCode = 400;
    throw err;
  }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  const open = db.prepare("SELECT id FROM asset_assignments WHERE asset_id = ? AND returned_at IS NULL ORDER BY assigned_at DESC LIMIT 1").get(request.params.id);
  if (!open) {
    const err = new Error("no open assignment");
    err.statusCode = 400;
    throw err;
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE asset_assignments SET returned_at = ? WHERE id = ?").run(now, open.id);
  const envelope = { ok: true, assignmentId: open.id, returnedAt: now };
  db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(
    randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now
  );
  recordAudit(db, user, "assets.return", "asset", request.params.id, { assignmentId: open.id, idempotencyKey: idem });
  return envelope;
});

app.get("/api/assets/report/value", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "assets");
  const rows = db.prepare("SELECT a.id, a.category_id AS categoryId, a.purchase_cost_amd AS purchaseCostAmd, COALESCE((SELECT SUM(depreciation_amd) FROM asset_depreciation_schedules WHERE asset_id = a.id), 0) AS accumulatedAmd, (a.purchase_cost_amd - COALESCE((SELECT SUM(depreciation_amd) FROM asset_depreciation_schedules WHERE asset_id = a.id), 0)) AS netBookValueAmd FROM assets a WHERE a.org_id = ? AND a.status = 'active'").all(user.org_id);
  const rollup = assets.rollUpValueByCategory(rows);
  return { ok: true, rollup };
});

app.post("/api/assets/:id/write-off", async request => {
  const user = await app.auth(request);
  requireAppAccess(db, user, "assets");
  const body = request.body || {};
  const idem = String(body.idempotencyKey || "").trim();
  if (!idem) {
    const err = new Error("idempotencyKey is required");
    err.statusCode = 400;
    throw err;
  }
  const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idem);
  if (existing) return JSON.parse(existing.response_json);
  if (!body.approvedBy) {
    const err = new Error("approvedBy required");
    err.statusCode = 400;
    throw err;
  }
  const asset = db.prepare("SELECT a.*, c.accum_depr_account_id, c.asset_account_id FROM assets a JOIN asset_categories c ON c.id = a.category_id WHERE a.id = ? AND a.org_id = ?").get(request.params.id, user.org_id);
  if (!asset) {
    const err = new Error("asset not found");
    err.statusCode = 404;
    throw err;
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE assets SET status = 'written_off' WHERE id = ?").run(asset.id);
  const nbv = Math.max(0, asset.purchase_cost_amd - (asset.salvage_value_amd || 0));
  if (nbv > 0) {
    postJournalEntry(db, user, {
      date: now.slice(0, 10),
      description: `Գրում հանելություն ${asset.name}`,
      debitAccount: asset.accum_depr_account_id,
      creditAccount: asset.asset_account_id,
      amount: nbv
    });
  }
  const envelope = { ok: true, assetId: asset.id, status: "written_off", netBookValueAmd: nbv };
  db.prepare("INSERT INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)").onConflict("nothing").run(
    randomId("idem"), user.org_id, idem, JSON.stringify(envelope), now
  );
  recordAudit(db, user, "assets.write-off", "asset", asset.id, { approvedBy: body.approvedBy, idempotencyKey: idem });
  return envelope;
});
```

- [ ] **Step 4: Run focused tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/assets.test.js 2>&1 | tail -10
```

Expected: PASS (6 tests).

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, total test count increases by 6.

- [ ] **Step 6: Commit the routes**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/app.js test/assets.test.js && git commit -m "feat(assets): wire 11 /api/assets routes with idempotency" && git push ant main
```

### Task 5: Add the React panel `web/src/assets.jsx`

**Files:**
- Create: `web/src/assets.jsx`
- Read: `web/src/copilot.jsx` (style reference)
- Modify: `web/src/main.jsx` (mount panel + add action handlers)

- [ ] **Step 1: Create the component**

```jsx
import React, { useEffect, useMemo, useState } from "react";

const TABS = [
  { id: "registry", label: "Ռեեստր" },
  { id: "depreciation", label: "Հարկում" },
  { id: "maintenance", label: "Սպասարկում" },
  { id: "assignment", label: "Հանձնարարություն" }
];

export function AssetsPanel({ api, actionState }) {
  const [tab, setTab] = useState("registry");
  const [categories, setCategories] = useState([]);
  const [assets, setAssets] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [maintenance, setMaintenance] = useState([]);
  const [error, setError] = useState("");

  const busy = useMemo(() => actionState && actionState.startsWith("assets:"), [actionState]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/assets/report/value");
        if (!cancelled) setAssets(res.rollup || []);
      } catch (err) {
        if (!cancelled) setError(err.message || "Բեռնումը ձախողվեց");
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  async function loadSchedule(assetId) {
    setError("");
    const res = await api(`/api/assets/${assetId}/depreciation`);
    setSchedule(res);
  }

  async function loadMaintenance(assetId) {
    setError("");
    const res = await api(`/api/assets/${assetId}/maintenance-history`);
    setMaintenance(res.logs || []);
  }

  async function postDepreciation(assetId, periodKey) {
    setError("");
    await api(`/api/assets/${assetId}/post-depreciation?periodKey=${periodKey}`, { method: "POST" });
  }

  return (
    <article className="panel assets-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Հաշվառում № 01 / 04</span>
          <h2>Հիմնական միջոցների կառավարում</h2>
        </div>
        <nav className="row" role="tablist">
          {TABS.map(item => (
            <button
              key={item.id}
              type="button"
              className={`mini-action ${tab === item.id ? "is-active" : ""}`}
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {error && <p className="action-status aging-badge">{error}</p>}

      {tab === "registry" && (
        <div className="copilot-result">
          <h3>Ընդհանուր արժեք՝ ըստ կատեգորիաների</h3>
          <table className="row">
            <thead>
              <tr><th>Կատեգորիա</th><th>Քանակ</th><th>Արժեք (AMD)</th><th>Մնացորդային արժեք</th></tr>
            </thead>
            <tbody>
              {assets.map(row => (
                <tr key={row.categoryId}>
                  <td>{row.categoryId}</td>
                  <td>{row.count}</td>
                  <td>{row.totalCostAmd.toLocaleString("hy-AM")}</td>
                  <td>{row.totalNbvAmd.toLocaleString("hy-AM")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "depreciation" && (
        <div className="inline-form">
          <input id="asset-schedule-id" placeholder="Ակտիվի ID" />
          <button className="mini-action" type="button" disabled={busy} onClick={() => loadSchedule(document.getElementById("asset-schedule-id").value)}>
            Հաշվել գրաֆիկը
          </button>
          {schedule && (
            <div className="copilot-result">
              <h3>Հարկման գրաֆիկ ({schedule.schedule.length} ամիս)</h3>
              <ol>
                {schedule.schedule.slice(0, 12).map(line => (
                  <li key={line.periodIndex}>
                    #{line.periodIndex + 1}: {line.depreciationAmd.toLocaleString("hy-AM")} AMD / NBV {line.netBookValueAmd.toLocaleString("hy-AM")}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {tab === "maintenance" && (
        <div className="inline-form">
          <input id="asset-maint-id" placeholder="Ակտիվի ID" />
          <button className="mini-action" type="button" disabled={busy} onClick={() => loadMaintenance(document.getElementById("asset-maint-id").value)}>
            Բեռնել պատմությունը
          </button>
          {maintenance.length > 0 && (
            <div className="copilot-result">
              <h3>Վերջին սպասարկումներ</h3>
              <ul>
                {maintenance.map(log => (
                  <li key={log.id}>{log.performed_at} — {log.kind} ({log.cost_amd.toLocaleString("hy-AM")} AMD)</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "assignment" && (
        <div className="inline-form">
          <input id="asset-assign-id" placeholder="Ակտիվի ID" />
          <input id="asset-assign-type" placeholder="Տիպ (employee)" />
          <input id="asset-assign-target" placeholder="Աշխատակցի ID" />
          <button
            className="mini-action"
            type="button"
            disabled={busy}
            onClick={async () => {
              const assetId = document.getElementById("asset-assign-id").value;
              const assigneeType = document.getElementById("asset-assign-type").value;
              const assigneeId = document.getElementById("asset-assign-target").value;
              await api(`/api/assets/${assetId}/assign`, {
                method: "POST",
                body: { assigneeType, assigneeId, idempotencyKey: `ui-assign-${Date.now()}` }
              });
            }}
          >
            Հանձնել
          </button>
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Mount the panel in `web/src/main.jsx`**

Find the imports near the top of `web/src/main.jsx` and add:

```jsx
import { AssetsPanel } from "./assets.jsx";
```

In `Workspace`, near other panel mounts, add:

```jsx
const assetsApi = async (url, options = {}) => {
  setActionState("assets:loading");
  setActionError("");
  try {
    return await api(url, options);
  } finally {
    setActionState("");
  }
};
```

And render `<AssetsPanel api={assetsApi} actionState={actionState} />` near the existing panels (next to `HealthcheckPanel`).

- [ ] **Step 3: Build the UI**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm run build:ui 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 4: Commit UI integration**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add web/src/assets.jsx web/src/main.jsx && git commit -m "feat(assets): mount asset-management panel with 4 tabs" && git push ant main
```

### Task 6: Update HANDOFF and tag the milestone

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update the status line and add a completed bullet**

Replace the first line in `HANDOFF.md` with the new tag count and test result, e.g.:

```markdown
_Last updated: 2026-06-08 · main after asset-management · 9 tags · M tests (M pass, 0 fail, 0 cancelled)_
```

Add a bullet:

```markdown
- **Asset Management (Разное имущество)** — DONE: `server/assets.js` pure engine (straight-line + reducing-balance depreciation, maintenance intervals, NBV roll-up) + 11 `/api/assets/*` routes + 5 new tables + React `AssetsPanel` (Registry / Depreciation / Maintenance / Assignment tabs) + 6-test contract suite covering 401/403/400/200/audit/idempotency, ready for HR assignments (sub-plan 4), Fleet vehicles (sub-plan 9), and Greenhouse assets (sub-plan 10).
```

- [ ] **Step 2: Commit handoff**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add HANDOFF.md && git commit -m "docs: record asset-management verification" && git push ant main
```

- [ ] **Step 3: Tag**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git tag assets-mvp && git push ant assets-mvp
```

## Final Self-Review Checklist (sub-plan 8)

- [ ] `test/assets.test.js` fails before the engine exists
- [ ] `test/assets.test.js` passes once the routes are wired
- [ ] `npm test` total count increases by 6
- [ ] `npm run build:ui` succeeds
- [ ] Audit row count increases by exactly 1 per successful call (categories, assets, maintenance, assign, return, write-off)
- [ ] Replay with same `idempotencyKey` returns the cached envelope and does not double-write audit
- [ ] Straight-line depreciation math matches `(cost − salvage) / lifeMonths` per period, terminating at salvage
- [ ] NBV report groups by `categoryId` with `totalCostAmd` and `totalNbvAmd`
- [ ] Write-off posts a disposal journal entry and flips `assets.status` to `written_off`
- [ ] Armenian labels (Հիմնական միջոցների կառավարում, Հարկում, Սպասարկում, Հանձնարարություն) render through the existing `.panel` / `.panel-head` / `.inline-form` / `.mini-action` / `.copilot-result` / `.row` / `.section-label` / `.aging-badge` CSS classes
- [ ] `HANDOFF.md` updated
- [ ] `assets-mvp` tag pushed to `ant`

</plan>
## Objective
You are implementing sub-plan 8 (Asset Management) of the A1 Suite / Armosphère One project — fixed-asset register, depreciation, and disposal workflows.

## Your worktree
You are running in: {worktree_path}
The branch is: a1/sub-plan/asset-management (already created from ant/main)

## The plan
READ THIS FILE IN FULL FIRST, end to end, before doing anything else:
  /Users/samvelstepanyan/dev/A1-Suite-Local-ANT/docs/superpowers/plans/2026-06-08-a1-suite-ant-asset-management.md

Execute it task-by-task. Every checkbox `- [ ]` becomes a step. Use the superpowers:executing-plans skill conventions (RED-GREEN-IMPROVE, frequent commits, code review between tasks).

## Pattern A — the A1 module shape
For every module you add, ship exactly these four artifacts:
  1. Pure deterministic engine at  server/assetManagement.js   (no I/O, no Fastify, testable in isolation)
  2. Thin route block in          server/app.js                (auth → requireAppAccess → audit → handler)
  3. React panel at               web/src/assetManagement.jsx  (inline Armenian strings, no i18n)
  4. node --test contract suite   test/assetManagement.test.js (math + auth-gating + idempotency)

The asset module will likely reuse existing tables (fixed_assets, depreciation_schedules) — confirm what already exists in server/db.js before creating new tables.

## Hard invariants (do NOT violate)
- Armenian-first inline strings for all user-facing labels.
- 13-apps list in server/db.js STAYS at 13. Do NOT add new entries to the apps list.
- Egress is OFF by default. Only make outbound calls when ARMOSPHERA_ONE_ALLOW_EGRESS=1 is set.
- Use `audit(db, user.org_id, user.id, "type.verb", {...})` — NOT `recordAudit()`.
- Idempotency: `INSERT OR IGNORE INTO idempotency_keys` — NOT `.onConflict('nothing')`.
- For batched inserts: `db.transaction(() => { ... })` works on this codebase (node:sqlite DatabaseSync).
- `git push ant <tag>` — never `origin`.
- Auth: `const user = await app.auth(request);` then `requireAppAccess(db, user, "...")`.
- HTML escape any user-supplied text via the existing `esc()` helper in server/app.js.

## Workflow per task
1. Read the plan task.
2. Write the failing test first (RED). Run it.
3. Implement the minimal code (GREEN). Run it.
4. Refactor (IMPROVE). Re-run.
5. Commit with a conventional-commit message (`feat:`, `fix:`, `test:`, `refactor:`).
6. Move to the next task.

After each logical chunk (typically 2-3 tasks), review your own diff and confirm the invariants above still hold.

## Shipping
When every task in the plan is checked off and all tests pass:
1. Run the full test suite from the worktree root: `npm test`.
2. Verify no secrets are hardcoded: `git diff ant/main...HEAD | grep -iE "(api[_-]?key|secret|password|token)" || echo OK`.
3. Write a one-paragraph handoff to:  /Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/a1-sub-plans-7-10/asset-management/handoff.md
4. Update status:  /Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/a1-sub-plans-7-10/asset-management/status.md
5. Push branch and tag:  `git push ant a1/sub-plan/asset-management`  then  `git push ant asset-management-mvp`

## Budget
~45-60 minutes per sub-plan. If you hit a real architectural blocker you can't resolve in 10 minutes, write it to status.md and stop — don't thrash. The orchestrator will dispatch a fixer for blockers.
## Completion
Do not spawn subagents or external agents for this task.
Report results in your final response.
The worker launcher captures your response in `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/a1-sub-plans-7-10/asset-management/handoff.md` automatically.
The worker launcher updates `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/a1-sub-plans-7-10/asset-management/status.md` automatically.
## Tag to Ship
When done, push tag `asset-management-mvp` to remote `ant`:
```bash
git push ant asset-management-mvp
```
