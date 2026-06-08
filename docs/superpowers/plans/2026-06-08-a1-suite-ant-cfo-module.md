# Sub-Plan 5: CFO Module (Ֆինանսական կառավարում) — User Priority #5

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CFO module *separate from* accounting/HayHashvapah. Cover Cash Flow forecasting, Budgeting, Treasury, Payment Calendar, FX Exposure, and Loan Management, plus AI features (liquidity forecast, cash-gap detection, FX risk, debt load analysis). Especially important for Spayka.

**Architecture:** Pattern A module `server/cfo.js` (pure engine: cash-flow rollup, budget variance, treasury position, payment-calendar generation, FX exposure aggregation, loan amortization) + `web/src/cfo.jsx` panel (5 tabs: Cash Flow / Budget / Treasury / Calendar / Loans) + `test/cfo.test.js`. Reuses the existing `accounting` engine (`server/accounting.js`, `server/ledger.js`) for source data; CFO is read-mostly with a few budget-mutation endpoints. New tables: `budgets`, `budget_lines`, `treasury_accounts`, `fx_positions`, `loans`, `loan_schedules`, `cash_flow_forecasts`.

**Tech Stack:** Node 22, Fastify 5, `node:sqlite`, `node --test`, React + Vite. Local-first AI forecasting; AMD base + multi-currency (USD, EUR, RUB, AED) display. Charts: SVG via React (no chart lib dep) or optional `d3` later.

**Depends on:** sub-plan 0 (Pattern A skeleton). Existing accounting/ledger.

---

## File Structure

- Create: `server/cfo.js` — pure engine (no DB, no Fastify imports).
- Create: `server/cfoAi.js` — pure AI packet builder (mirror of `server/copilot.js`); deterministic local fallback; optional OpenRouter hook gated by `ARMOSPHERA_ONE_ALLOW_EGRESS=1`.
- Modify: `server/db.js` — add 7 new table DDL statements inside `createSchema` and seed any new `app_assignments` rows for `cfo` app.
- Modify: `server/app.js` — register 14 new `/api/cfo/...` routes after the existing finance routes; import `cfo` and `cfoAi`; gate behind `requireAppAccess(db, user, "cfo")` + role `["Owner", "Admin", "Accountant"]` for mutations; gate behind `["Owner", "Admin", "Accountant", "Auditor"]` for reads.
- Create: `web/src/cfo.jsx` — 5-tab React panel (`CfoPanel`) using `.panel`, `.panel-head`, `.inline-form`, `.mini-action`, `.copilot-result`, `.section-label`, `.aging-badge`.
- Modify: `web/src/main.jsx` — import + mount `CfoPanel` next to `FinancePanel`; add `cfoApi` action state slice.
- Create: `test/cfo.test.js` — `node --test` contract + math suite (auth, app access, validation, happy path, audit row, idempotency, period-lock guard for frozen periods, amortization correctness).
- Modify: `HANDOFF.md` — add CFO sub-plan line + tag count.

## DB additions

- `budgets` (id, org_id, name, period_key, currency, status, created_at)
- `budget_lines` (id, budget_id, account_id, planned_amount, actual_cache_amount, last_synced_at)
- `treasury_accounts` (id, org_id, name, currency, bank_name, account_number_masked, balance_cache, last_synced_at)
- `fx_positions` (id, org_id, currency, amount, rate_to_amd, source, as_of)
- `loans` (id, org_id, lender, principal_amd, currency, rate_pct, term_months, start_date, schedule_kind, status)
- `loan_schedules` (id, loan_id, period_key, principal_due, interest_due, balance_after, status)
- `cash_flow_forecasts` (id, org_id, scenario, period_key, opening_amd, expected_inflow_amd, expected_outflow_amd, closing_amd, generated_at, ai_source)

## API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cfo/cash-flow?periodKey=...&scenario=base` | Cash flow statement + forecast |
| POST | `/api/cfo/budgets` | Create budget |
| PATCH | `/api/cfo/budgets/:id/lines` | Update planned lines |
| GET | `/api/cfo/budgets/:id/variance` | Planned vs actual |
| GET | `/api/cfo/treasury/positions` | Treasury balances by currency |
| POST | `/api/cfo/treasury/accounts` | Add treasury account |
| GET | `/api/cfo/payment-calendar?from=...&to=...` | Upcoming AP/AR/loan dues |
| POST | `/api/cfo/fx/positions` | Record FX position |
| GET | `/api/cfo/fx/exposure` | Net FX exposure by currency |
| POST | `/api/cfo/loans` | Create loan |
| GET | `/api/cfo/loans/:id/schedule` | Amortization schedule |
| POST | `/api/cfo/ai/forecast` | AI liquidity / cash-gap forecast (intent: cfo-forecast) |
| POST | `/api/cfo/ai/fx-risk` | AI FX risk (intent: cfo-fx) |
| POST | `/api/cfo/ai/debt-load` | AI debt load (intent: cfo-debt) |

## Acceptance

- A CFO sees a 13-week cash-flow forecast with deterministic local math.
- A budget's planned vs actual updates as the underlying accounting journal posts.
- The payment calendar lists upcoming AP, AR, and loan dues in AMD-equivalent.
- FX exposure shows net open position by currency; AI suggests a hedge if exposure > threshold.
- Loan amortization is correct for equal-principal and annuity schedules.

## Spine reused

`org_id`, `accounting` engine, `ledger` engine, `customers` (AR), `vendors` (AP), `audit_events`, `period_locks` (for budget freezes), `idempotency_keys`, `legal_sources`, `app_assignments` (new `cfo` app enabled for Owner/Admin/Accountant).

## Deferred to other sub-plans

- Real bank feed integration (out of scope; will be adapter in sub-plan 7).
- Multi-entity consolidation (out of scope; future work).

---

## Tasks

### Task 1: Write the RED test file (`test/cfo.test.js`)

**Files:**
- Create: `test/cfo.test.js`
- Read: `test/copilot.test.js` (style reference)
- Read: `test/accounting.test.js` (math-engine style reference)
- Read: `test/accounting-reports.test.js` (variance + amortization style reference)

- [ ] **Step 1: Create the test file with the full Pattern A contract plus math coverage**

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");
const cfo = require("../server/cfo");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

function seedBankTxn(db, orgId, { id, accountId, amount, postedAt }) {
  db.prepare(`
    INSERT INTO bank_transactions (id, org_id, account_id, amount, currency, posted_at, source, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, orgId, accountId, amount, "AMD", postedAt, "manual", "posted");
}

test("cfo module math: cash-flow rollup sums inflow minus outflow by week", () => {
  const weeks = [
    { weekKey: "2026-W23", inflow: 1_000_000, outflow: 400_000 },
    { weekKey: "2026-W24", inflow: 750_000, outflow: 900_000 },
    { weekKey: "2026-W25", inflow: 1_200_000, outflow: 600_000 }
  ];
  const out = cfo.computeCashFlow({ openingAmd: 500_000, weeks });
  assert.strictEqual(out.openingAmd, 500_000);
  assert.strictEqual(out.closingAmd, 500_000 + (1_000_000 - 400_000) + (750_000 - 900_000) + (1_200_000 - 600_000));
  assert.deepStrictEqual(out.weekly.map(w => ({ weekKey: w.weekKey, net: w.net })), [
    { weekKey: "2026-W23", net: 600_000 },
    { weekKey: "2026-W24", net: -150_000 },
    { weekKey: "2026-W25", net: 600_000 }
  ]);
});

test("cfo module math: budget variance is actual - planned per line", () => {
  const out = cfo.computeBudgetVariance({
    lines: [
      { accountId: "acc-100", planned: 500_000, actual: 620_000 },
      { accountId: "acc-200", planned: 1_000_000, actual: 800_000 }
    ]
  });
  assert.deepStrictEqual(out.lines, [
    { accountId: "acc-100", planned: 500_000, actual: 620_000, variance: 120_000, utilizationPct: 124 },
    { accountId: "acc-200", planned: 1_000_000, actual: 800_000, variance: -200_000, utilizationPct: 80 }
  ]);
  assert.strictEqual(out.totalPlanned, 1_500_000);
  assert.strictEqual(out.totalActual, 1_420_000);
});

test("cfo module math: loan amortization — equal principal", () => {
  const schedule = cfo.amortizeLoan({
    principalAmd: 1_200_000,
    ratePct: 12,
    termMonths: 12,
    startDate: "2026-07-01",
    kind: "equal-principal"
  });
  assert.strictEqual(schedule.length, 12);
  // principal is constant 100,000; interest falls each month
  for (const row of schedule) assert.strictEqual(row.principalDue, 100_000);
  assert.strictEqual(schedule[0].interestDue, 12_000);
  assert.strictEqual(schedule[11].interestDue, 1_000);
  assert.strictEqual(schedule[11].balanceAfter, 0);
});

test("cfo module math: loan amortization — annuity", () => {
  const schedule = cfo.amortizeLoan({
    principalAmd: 1_200_000,
    ratePct: 12,
    termMonths: 12,
    startDate: "2026-07-01",
    kind: "annuity"
  });
  // Annuity payment constant; sum of principal must equal original principal
  const totalPrincipal = schedule.reduce((s, r) => s + r.principalDue, 0);
  assert.ok(Math.abs(totalPrincipal - 1_200_000) < 2, `annuity sum should be ~1,200,000 got ${totalPrincipal}`);
  // Each row.principalDue + row.interestDue should be constant within rounding
  const firstPayment = schedule[0].principalDue + schedule[0].interestDue;
  for (const row of schedule) {
    assert.ok(Math.abs((row.principalDue + row.interestDue) - firstPayment) < 2,
      `payment drift ${row.principalDue + row.interestDue} vs ${firstPayment}`);
  }
});

test("cfo module math: FX exposure aggregates open positions by currency", () => {
  const out = cfo.computeFxExposure({
    positions: [
      { currency: "USD", amount: 10_000, rateToAmd: 400 },
      { currency: "USD", amount: -4_000, rateToAmd: 400 },
      { currency: "EUR", amount: 2_000, rateToAmd: 430 }
    ]
  });
  assert.deepStrictEqual(out.byCurrency, [
    { currency: "USD", net: 6_000, netAmd: 2_400_000 },
    { currency: "EUR", net: 2_000, netAmd: 860_000 }
  ]);
  assert.ok(out.hedgeSuggestion === null || typeof out.hedgeSuggestion === "string");
});

test("cfo module math: payment calendar merges AP+AR+loans and converts to AMD", () => {
  const out = cfo.buildPaymentCalendar({
    arOpen: [{ dueDate: "2026-07-05", amountAmd: 1_000_000, source: "ar" }],
    apOpen: [{ dueDate: "2026-07-03", amountAmd: 600_000, source: "ap" }],
    loans: [{ periodKey: "2026-07", principalDue: 100_000, interestDue: 10_000, dueDate: "2026-07-15" }]
  });
  assert.deepStrictEqual(out.entries.map(e => ({ date: e.date, amount: e.amount, kind: e.kind })), [
    { date: "2026-07-03", amount: 600_000, kind: "ap" },
    { date: "2026-07-05", amount: 1_000_000, kind: "ar" },
    { date: "2026-07-15", amount: 110_000, kind: "loan" }
  ]);
  assert.strictEqual(out.totalAmd, 1_710_000);
});

test("cfo module math: liquidity forecast is deterministic and flags cash gap", () => {
  const out = cfo.forecastLiquidity({
    openingAmd: 800_000,
    expectedWeeklyInflow: [400_000, 100_000, 0, 0],
    expectedWeeklyOutflow: [300_000, 350_000, 200_000, 200_000]
  });
  assert.strictEqual(out.weeks.length, 4);
  assert.ok(out.cashGapDetected === true);
  assert.strictEqual(out.minBalanceAmd, 50_000);
  assert.strictEqual(out.aiSource, "local-deterministic");
});

test("cfo module math: analyzeFxRisk deterministic threshold", () => {
  const low = cfo.analyzeFxRisk({ positions: [{ currency: "USD", net: 1_000, netAmd: 400_000 }] });
  const high = cfo.analyzeFxRisk({ positions: [{ currency: "USD", net: 100_000, netAmd: 40_000_000 }] });
  assert.strictEqual(low.riskLevel, "low");
  assert.strictEqual(high.riskLevel, "high");
  assert.match(high.suggestion, /USD/);
});

test("cfo module math: analyzeDebtLoad deterministic stress test", () => {
  const out = cfo.analyzeDebtLoad({
    loans: [
      { principalAmd: 1_200_000, ratePct: 12, termMonths: 12, kind: "annuity" }
    ],
    monthlyFreeCashflowAmd: 50_000
  });
  assert.ok(out.totalPrincipalAmd === 1_200_000);
  assert.ok(out.monthlyServiceAmd > 100_000);
  assert.strictEqual(out.stressRating, "stretched");
});

test("cfo cash-flow endpoint is auth-gated", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/cfo/cash-flow?periodKey=2026-06" });
    assert.strictEqual(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("cfo budget mutation requires cfo app access", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/cfo/budgets",
      headers: { cookie },
      payload: { name: "Q3 plan", periodKey: "2026-Q3", currency: "AMD", idempotencyKey: "b1" }
    });
    assert.strictEqual(res.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("cfo budget mutation validates input", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/cfo/budgets",
      headers: { cookie },
      payload: {}
    });
    assert.strictEqual(res.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("cfo budget create writes audit row, is idempotent on replay, returns budget", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    const payload = {
      method: "POST",
      url: "/api/cfo/budgets",
      headers: { cookie },
      payload: { name: "2026-Q3 plan", periodKey: "2026-Q3", currency: "AMD", idempotencyKey: "b-idem-1" }
    };
    const first = await app.inject(payload);
    const second = await app.inject(payload);
    assert.strictEqual(first.statusCode, 200, first.body);
    assert.strictEqual(second.statusCode, 200);
    assert.deepStrictEqual(first.json(), second.json());
    const body = first.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.budget.name, "2026-Q3 plan");
    assert.strictEqual(body.budget.status, "active");
    const after = app.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count;
    assert.strictEqual(after, before + 1, "audit_events row must be written exactly once");
  } finally {
    await app.close();
  }
});

test("cfo loan create rejects frozen period (period_lock guard)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    // close the period containing 2026-06-01
    app.db.prepare(`
      INSERT INTO period_locks (id, org_id, period_key, status, reason, locked_at, locked_by_user_id)
      VALUES (?, ?, ?, 'closed', 'test', ?, ?)
    `).run("pl-1", "org-armosphera-demo", "2026-06", new Date().toISOString(), "user-owner");
    const res = await app.inject({
      method: "POST",
      url: "/api/cfo/loans",
      headers: { cookie },
      payload: {
        lender: "Ameriabank",
        principalAmd: 5_000_000,
        currency: "AMD",
        ratePct: 14,
        termMonths: 24,
        startDate: "2026-06-15",
        scheduleKind: "annuity",
        idempotencyKey: "loan-1"
      }
    });
    assert.strictEqual(res.statusCode, 409, res.body);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run the test to verify RED**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/cfo.test.js 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../server/cfo'` (engine not yet created) and `404` for `/api/cfo/cash-flow`.

- [ ] **Step 3: Commit RED tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add test/cfo.test.js && git commit -m "test(cfo): define Pattern A contract + math coverage" && git push ant main
```

### Task 2: Add the pure engine module (`server/cfo.js`)

**Files:**
- Create: `server/cfo.js`

- [ ] **Step 1: Create the engine with all 7 pure functions**

```js
"use strict";

/**
 * CFO pure engine. NO DB / Fastify imports. Mirrors Pattern A contract
 * used by /docs/superpowers/plans/2026-06-08-a1-suite-ant-pattern-a-skeleton.md.
 * All amounts are integer AMD minor units (no decimals). Multi-currency
 * inputs use an explicit `rateToAmd` so the engine is reproducible.
 */

const FX_HEDGE_THRESHOLD_AMD = 5_000_000;
const DEBT_STRESSED_THRESHOLD = 1.5; // monthly service / free cashflow

function computeCashFlow({ openingAmd, weeks }) {
  const opening = Number.isFinite(openingAmd) ? Math.trunc(openingAmd) : 0;
  const list = Array.isArray(weeks) ? weeks : [];
  let running = opening;
  const weekly = list.map(row => {
    const inflow = Number.isFinite(row.inflow) ? Math.trunc(row.inflow) : 0;
    const outflow = Number.isFinite(row.outflow) ? Math.trunc(row.outflow) : 0;
    const net = inflow - outflow;
    running += net;
    return { weekKey: String(row.weekKey), inflow, outflow, net, closing: running };
  });
  return { openingAmd: opening, closingAmd: running, weekly };
}

function computeBudgetVariance({ lines }) {
  const list = Array.isArray(lines) ? lines : [];
  const out = list.map(row => {
    const planned = Number.isFinite(row.planned) ? Math.trunc(row.planned) : 0;
    const actual = Number.isFinite(row.actual) ? Math.trunc(row.actual) : 0;
    const variance = actual - planned;
    const utilizationPct = planned === 0 ? 0 : Math.round((actual / planned) * 100);
    return { accountId: String(row.accountId), planned, actual, variance, utilizationPct };
  });
  const totalPlanned = out.reduce((s, r) => s + r.planned, 0);
  const totalActual = out.reduce((s, r) => s + r.actual, 0);
  return { lines: out, totalPlanned, totalActual, totalVariance: totalActual - totalPlanned };
}

function computeTreasuryPosition({ accounts }) {
  const list = Array.isArray(accounts) ? accounts : [];
  const byCurrency = new Map();
  for (const acc of list) {
    const cur = String(acc.currency);
    const bal = Number.isFinite(acc.balanceCache) ? Math.trunc(acc.balanceCache) : 0;
    const prev = byCurrency.get(cur) || { currency: cur, balance: 0, accountCount: 0 };
    byCurrency.set(cur, { currency: cur, balance: prev.balance + bal, accountCount: prev.accountCount + 1 });
  }
  return Array.from(byCurrency.values());
}

function buildPaymentCalendar({ arOpen = [], apOpen = [], loans = [] }) {
  const entries = [];
  for (const ar of arOpen) {
    entries.push({ date: String(ar.dueDate), amount: Math.trunc(ar.amountAmd), kind: "ar", source: ar.source || "invoice" });
  }
  for (const ap of apOpen) {
    entries.push({ date: String(ap.dueDate), amount: Math.trunc(ap.amountAmd), kind: "ap", source: ap.source || "bill" });
  }
  for (const ln of loans) {
    entries.push({ date: String(ln.dueDate), amount: Math.trunc(ln.principalDue) + Math.trunc(ln.interestDue), kind: "loan", source: "loan-schedule" });
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { entries, totalAmd: entries.reduce((s, e) => s + e.amount, 0) };
}

function computeFxExposure({ positions }) {
  const list = Array.isArray(positions) ? positions : [];
  const byCur = new Map();
  for (const p of list) {
    const cur = String(p.currency);
    const net = Number.isFinite(p.amount) ? Math.trunc(p.amount) : 0;
    const rate = Number.isFinite(p.rateToAmd) ? p.rateToAmd : 0;
    const prev = byCur.get(cur) || { currency: cur, net: 0, netAmd: 0 };
    byCur.set(cur, { currency: cur, net: prev.net + net, netAmd: prev.netAmd + Math.round(net * rate) });
  }
  const arr = Array.from(byCur.values());
  const hasThreshold = arr.some(row => Math.abs(row.netAmd) > FX_HEDGE_THRESHOLD_AMD);
  return { byCurrency: arr, hedgeSuggestion: hasThreshold ? "Հաշվի՛ր ֆորվարդային պայմանագրի օգտագործումը 5M AMD շեմից բարձր բաց պոզիցիաների համար։" : null };
}

function addMonths(iso, n) {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function amortizeLoan({ principalAmd, ratePct, termMonths, startDate, kind }) {
  const principal = Math.trunc(Number(principalAmd) || 0);
  const rate = Number(ratePct) / 100 / 12; // monthly
  const n = Math.max(1, Math.trunc(Number(termMonths) || 0));
  const rows = [];
  let balance = principal;
  if (kind === "equal-principal") {
    const principalDue = Math.round(principal / n);
    for (let i = 0; i < n; i++) {
      const interestDue = Math.round(balance * rate);
      balance = i === n - 1 ? 0 : balance - principalDue;
      rows.push({ periodKey: addMonths(startDate, i), principalDue: i === n - 1 ? principalDue + balance : principalDue, interestDue, balanceAfter: Math.max(0, balance) });
    }
    // final row fix-up
    rows[rows.length - 1].balanceAfter = 0;
    return rows;
  }
  // annuity: payment = P * r / (1 - (1+r)^-n)
  const payment = rate === 0 ? Math.round(principal / n) : Math.round((principal * rate) / (1 - Math.pow(1 + rate, -n)));
  for (let i = 0; i < n; i++) {
    const interestDue = Math.round(balance * rate);
    let principalDue = payment - interestDue;
    if (i === n - 1) principalDue = balance;
    balance = Math.max(0, balance - principalDue);
    rows.push({ periodKey: addMonths(startDate, i), principalDue, interestDue, balanceAfter: balance });
  }
  return rows;
}

function forecastLiquidity({ openingAmd, expectedWeeklyInflow, expectedWeeklyOutflow }) {
  const ins = Array.isArray(expectedWeeklyInflow) ? expectedWeeklyInflow : [];
  const outs = Array.isArray(expectedWeeklyOutflow) ? expectedWeeklyOutflow : [];
  const len = Math.max(ins.length, outs.length);
  const weeks = [];
  let running = Math.trunc(Number(openingAmd) || 0);
  let minBal = running;
  for (let i = 0; i < len; i++) {
    const inflow = Math.trunc(Number(ins[i]) || 0);
    const outflow = Math.trunc(Number(outs[i]) || 0);
    running += inflow - outflow;
    if (running < minBal) minBal = running;
    weeks.push({ weekIndex: i, inflow, outflow, closing: running });
  }
  return {
    weeks,
    openingAmd: Math.trunc(Number(openingAmd) || 0),
    closingAmd: running,
    minBalanceAmd: minBal,
    cashGapDetected: minBal < 0,
    aiSource: "local-deterministic"
  };
}

function analyzeFxRisk({ positions }) {
  const list = Array.isArray(positions) ? positions : [];
  const totalAbsAmd = list.reduce((s, p) => s + Math.abs(Math.round((p.net || 0) * (p.rateToAmd || 0))), 0);
  let riskLevel = "low";
  if (totalAbsAmd > 20_000_000) riskLevel = "high";
  else if (totalAbsAmd > 5_000_000) riskLevel = "medium";
  const top = [...list].sort((a, b) => Math.abs(b.netAmd || 0) - Math.abs(a.netAmd || 0))[0];
  return {
    riskLevel,
    totalAbsExposureAmd: totalAbsAmd,
    suggestion: top ? `${top.currency} բաց պոզիցիան գերազանցում է շեշտված շեմը (${top.netAmd} AMD)։ Հաշվի՛ր հեջավորում։` : "Բաց պոզիցիաները շեմից ցածր են։",
    aiSource: "local-deterministic"
  };
}

function analyzeDebtLoad({ loans, monthlyFreeCashflowAmd }) {
  const list = Array.isArray(loans) ? loans : [];
  const fcf = Math.trunc(Number(monthlyFreeCashflowAmd) || 0);
  const totalPrincipal = list.reduce((s, l) => s + Math.trunc(Number(l.principalAmd) || 0), 0);
  // monthly service = sum of first-row (principal + interest) of each amortization
  const monthlyService = list.reduce((s, l) => {
    const sched = amortizeLoan({ principalAmd: l.principalAmd, ratePct: l.ratePct, termMonths: l.termMonths, startDate: "2026-07-01", kind: l.kind || "annuity" });
    return s + (sched[0] ? sched[0].principalDue + sched[0].interestDue : 0);
  }, 0);
  const ratio = fcf > 0 ? monthlyService / fcf : Number.POSITIVE_INFINITY;
  let stressRating = "comfortable";
  if (!Number.isFinite(ratio) || ratio > 2) stressRating = "danger";
  else if (ratio > DEBT_STRESSED_THRESHOLD) stressRating = "stretched";
  return { totalPrincipalAmd: totalPrincipal, monthlyServiceAmd: monthlyService, monthlyFreeCashflowAmd: fcf, serviceRatio: Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null, stressRating, aiSource: "local-deterministic" };
}

module.exports = {
  computeCashFlow,
  computeBudgetVariance,
  computeTreasuryPosition,
  buildPaymentCalendar,
  computeFxExposure,
  amortizeLoan,
  forecastLiquidity,
  analyzeFxRisk,
  analyzeDebtLoad
};
```

- [ ] **Step 2: Run focused tests (math-only should pass; HTTP contract tests still 404)**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/cfo.test.js 2>&1 | tail -20
```

Expected: 9 math tests pass; 5 HTTP tests still FAIL with `404` for the cfo routes.

- [ ] **Step 3: Commit the engine**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/cfo.js && git commit -m "feat(cfo): add pure engine (cash flow, variance, treasury, FX, amortize, AI)" && git push ant main
```

### Task 3: Add 7 new tables + cfo app assignment to `server/db.js`

**Files:**
- Modify: `server/db.js` (add table DDL inside `createSchema` + add `cfo` to `apps`/`app_assignments` seed lists)

- [ ] **Step 1: Add the 7 tables to `createSchema`**

Locate the `CREATE TABLE IF NOT EXISTS audit_export_packets` block inside `createSchema(db)` in `server/db.js` and append the following immediately after it (before the closing `\`)` of the `db.exec` template literal):

```js
    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      period_key TEXT NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_budgets_org_period
      ON budgets(org_id, period_key, status);

    CREATE TABLE IF NOT EXISTS budget_lines (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL,
      planned_amount INTEGER NOT NULL DEFAULT 0,
      actual_cache_amount INTEGER NOT NULL DEFAULT 0,
      last_synced_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_budget_lines_budget
      ON budget_lines(org_id, budget_id);

    CREATE TABLE IF NOT EXISTS treasury_accounts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      currency TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      account_number_masked TEXT NOT NULL,
      balance_cache INTEGER NOT NULL DEFAULT 0,
      last_synced_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_treasury_accounts_org
      ON treasury_accounts(org_id, currency);

    CREATE TABLE IF NOT EXISTS fx_positions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      currency TEXT NOT NULL,
      amount INTEGER NOT NULL,
      rate_to_amd REAL NOT NULL,
      source TEXT NOT NULL,
      as_of TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_fx_positions_org
      ON fx_positions(org_id, as_of DESC);

    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      lender TEXT NOT NULL,
      principal_amd INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'AMD',
      rate_pct REAL NOT NULL,
      term_months INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      schedule_kind TEXT NOT NULL DEFAULT 'annuity',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_loans_org_status
      ON loans(org_id, status);

    CREATE TABLE IF NOT EXISTS loan_schedules (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      period_key TEXT NOT NULL,
      principal_due INTEGER NOT NULL,
      interest_due INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned'
    );

    CREATE INDEX IF NOT EXISTS idx_loan_schedules_loan
      ON loan_schedules(org_id, loan_id, period_key);

    CREATE TABLE IF NOT EXISTS cash_flow_forecasts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      scenario TEXT NOT NULL DEFAULT 'base',
      period_key TEXT NOT NULL,
      opening_amd INTEGER NOT NULL,
      expected_inflow_amd INTEGER NOT NULL,
      expected_outflow_amd INTEGER NOT NULL,
      closing_amd INTEGER NOT NULL,
      generated_at TEXT NOT NULL,
      ai_source TEXT NOT NULL DEFAULT 'local-deterministic',
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cash_flow_forecasts_org
      ON cash_flow_forecasts(org_id, scenario, period_key);
```

- [ ] **Step 2: Add the `cfo` app to the seed `apps` array in `seedIfEmpty`**

In `server/db.js`, locate the `const apps = [...]` array inside `seedIfEmpty` and add a new entry just before the `analytics` entry (keep `priority` unique):

```js
    ["cfo", "CFO Console", "Finance", "Cash flow, budget, treasury, FX exposure, loans, and AI forecasts for the CFO role.", "/app/cfo", "new", 13]
```

Then extend the role assignment loops immediately below so the new app is enabled for Owner/Admin/Accountant:

```js
  for (const role of ["Owner", "Admin"]) {
    for (const app of apps) insertAssignment.run(orgId, role, app[0], 1);
  }
  for (const appId of ["crm", "finance", "desk", "campaigns", "projects", "inventory", "purchase", "analytics", "cfo"]) {
    insertAssignment.run(orgId, "Operator", appId, 1);
  }
  for (const appId of ["crm", "desk", "docs", "cfo"]) {
    insertAssignment.run(orgId, "Support", appId, 1);
  }
  // Add a row granting "Accountant" access to finance + cfo (idempotent via INSERT OR IGNORE)
  for (const appId of ["finance", "cfo"]) {
    insertAssignment.run(orgId, "Accountant", appId, 1);
  }
```

- [ ] **Step 3: Run the full test suite to confirm no regressions**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS; total count unchanged from before (DB changes do not add tests yet).

- [ ] **Step 4: Commit the migration**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/db.js && git commit -m "feat(cfo): add 7 tables + cfo app assignment" && git push ant main
```

### Task 4: Wire 14 routes in `server/app.js`

**Files:**
- Modify: `server/app.js` (add imports near the top of `registerApi`; add 14 routes after the existing finance routes block at line ~3940)
- Read: `server/app.js` (locate `requireAppAccess`, `requireFinanceOperator`, `randomId`, `getUserBySession`, `idempotency_keys` write pattern)

- [ ] **Step 1: Add the imports**

Inside `registerApi` near the other engine requires (search for `const copilot = require("./copilot")` and add below it):

```js
  const cfo = require("./cfo");
  const cfoAi = require("./cfoAi");
```

Also add a small role-guard helper at the top of `registerApi` (next to `requireFinanceOperator`):

```js
  function requireCfoOperator(user) {
    if (!["Owner", "Admin", "Accountant"].includes(user.role)) {
      const err = new Error("CFO operator role required");
      err.statusCode = 403;
      throw err;
    }
  }
```

- [ ] **Step 2: Add 14 routes immediately after the existing finance routes block**

```js
  // --- CFO module: 14 routes ---------------------------------------------
  const insertIdem = db.prepare("INSERT OR IGNORE INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)");
  function cfoCachedOrRun(user, idemKey, compute) {
    if (!idemKey) {
      const err = new Error("idempotencyKey is required");
      err.statusCode = 400;
      throw err;
    }
    const existing = db.prepare("SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?").get(user.org_id, idemKey);
    if (existing) return JSON.parse(existing.response_json);
    const envelope = compute();
    insertIdem.run(randomId("idem"), user.org_id, idemKey, JSON.stringify(envelope), new Date().toISOString());
    return envelope;
  }
  function recordCfoAudit(user, type, entityType, entityId, details) {
    db.prepare("INSERT INTO audit_events (org_id, user_id, type, details, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(user.org_id, user.id, type, JSON.stringify({ entityType, entityId, ...details }), new Date().toISOString());
  }
  function assertPeriodOpen(orgId, periodKey) {
    const lock = db.prepare("SELECT status FROM period_locks WHERE org_id = ? AND period_key = ? AND status = 'closed'").get(orgId, periodKey);
    if (lock) {
      const err = new Error("Period is closed");
      err.statusCode = 409;
      throw err;
    }
  }

  app.get("/api/cfo/cash-flow", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "cfo");
    const periodKey = String((request.query || {}).periodKey || "").trim();
    if (!/^\d{4}-\d{2}$/.test(periodKey)) {
      const err = new Error("periodKey must be YYYY-MM"); err.statusCode = 400; throw err;
    }
    const weeks = db.prepare(`
      SELECT strftime('%Y-W%W', posted_at) AS weekKey,
             SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS inflow,
             SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS outflow
      FROM bank_transactions
      WHERE org_id = ? AND substr(posted_at, 1, 7) = ?
      GROUP BY weekKey
      ORDER BY weekKey
    `).all(user.org_id, periodKey);
    const opening = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS opening
      FROM bank_transactions
      WHERE org_id = ? AND substr(posted_at, 1, 7) < ?
    `).get(user.org_id, periodKey).opening;
    return { ok: true, cashFlow: cfo.computeCashFlow({ openingAmd: opening, weeks }) };
  });

  app.post("/api/cfo/budgets", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "cfo");
    requireCfoOperator(user);
    const body = request.body || {};
    const name = String(body.name || "").trim();
    const periodKey = String(body.periodKey || "").trim();
    const currency = String(body.currency || "AMD").trim();
    const idem = String(body.idempotencyKey || "").trim();
    if (!name || !periodKey || !/^\d{4}-Q[1-4]$|^\d{4}-\d{2}$/.test(periodKey) || !idem) {
      const err = new Error("name, periodKey (YYYY-Qn or YYYY-MM), currency, idempotencyKey required");
      err.statusCode = 400; throw err;
    }
    assertPeriodOpen(user.org_id, periodKey);
    return cfoCachedOrRun(user, idem, () => {
      const id = randomId("budget");
      const now = new Date().toISOString();
      db.prepare("INSERT INTO budgets (id, org_id, name, period_key, currency, status, created_at, created_by_user_id) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)")
        .run(id, user.org_id, name, periodKey, currency, now, user.id);
      recordCfoAudit(user, "cfo.budget.create", "budget", id, { name, periodKey, currency, idempotencyKey: idem });
      return { ok: true, budget: { id, name, periodKey, currency, status: "active", createdAt: now } };
    });
  });

  app.patch("/api/cfo/budgets/:id/lines", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "cfo");
    requireCfoOperator(user);
    const budgetId = String(request.params.id || "").trim();
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!budgetId || !idem || !Array.isArray(body.lines)) {
      const err = new Error("budget id, idempotencyKey, lines[] required");
      err.statusCode = 400; throw err;
    }
    const budget = db.prepare("SELECT id, period_key FROM budgets WHERE id = ? AND org_id = ?").get(budgetId, user.org_id);
    if (!budget) { const err = new Error("Budget not found"); err.statusCode = 404; throw err; }
    assertPeriodOpen(user.org_id, budget.period_key);
    return cfoCachedOrRun(user, idem, () => {
      const insertLine = db.prepare("INSERT INTO budget_lines (id, org_id, budget_id, account_id, planned_amount) VALUES (?, ?, ?, ?, ?)");
      const tx = db.transaction(lines => {
        for (const ln of lines) {
          insertLine.run(randomId("bline"), user.org_id, budgetId, String(ln.accountId), Math.trunc(Number(ln.planned) || 0));
        }
      });
      tx(body.lines);
      recordCfoAudit(user, "cfo.budget.lines.upsert", "budget", budgetId, { lineCount: body.lines.length, idempotencyKey: idem });
      return { ok: true, budgetId, lineCount: body.lines.length };
    });
  });

  app.get("/api/cfo/budgets/:id/variance", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "cfo");
    const budgetId = String(request.params.id || "").trim();
    const lines = db.prepare("SELECT account_id, planned_amount, actual_cache_amount FROM budget_lines WHERE org_id = ? AND budget_id = ?").all(user.org_id, budgetId);
    return { ok: true, variance: cfo.computeBudgetVariance({ lines: lines.map(l => ({ accountId: l.account_id, planned: l.planned_amount, actual: l.actual_cache_amount })) }) };
  });

  app.get("/api/cfo/treasury/positions", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "cfo");
    const accounts = db.prepare("SELECT currency, balance_cache FROM treasury_accounts WHERE org_id = ?").all(user.org_id);
    return { ok: true, treasury: cfo.computeTreasuryPosition({ accounts }) };
  });

  app.post("/api/cfo/treasury/accounts", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "cfo");
    requireCfoOperator(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!body.name || !body.currency || !body.bankName || !body.accountNumberMasked || !idem) {
      const err = new Error("name, currency, bankName, accountNumberMasked, idempotencyKey required");
      err.statusCode = 400; throw err;
    }
    return cfoCachedOrRun(user, idem, () => {
      const id = randomId("treasury");
      const now = new Date().toISOString();
      db.prepare("INSERT INTO treasury_accounts (id, org_id, name, currency, bank_name, account_number_masked, balance_cache, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)")
        .run(id, user.org_id, String(body.name), String(body.currency), String(body.bankName), String(body.accountNumberMasked), now);
      recordCfoAudit(user, "cfo.treasury.create", "treasury", id, { name: body.name, currency: body.currency, idempotencyKey: idem });
      return { ok: true, account: { id, name: body.name, currency: body.currency, bankName: body.bankName } };
    });
  });

  app.get("/api/cfo/payment-calendar", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "cfo");
    const from = String((request.query || {}).from || "").trim();
    const to = String((request.query || {}).to || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      const err = new Error("from/to must be YYYY-MM-DD"); err.statusCode = 400; throw err;
    }
    const arOpen = db.prepare(`
      SELECT due_date AS dueDate, total AS amountAmd, id AS source
      FROM invoices WHERE org_id = ? AND status = 'open' AND due_date BETWEEN ? AND ?
    `).all(user.org_id, from, to);
    const apOpen = db.prepare(`
      SELECT due_date AS dueDate, total AS amountAmd, id AS source
      FROM bills WHERE org_id = ? AND status = 'open' AND due_date BETWEEN ? AND ?
    `).all(user.org_id, from, to);
    const loans = db.prepare(`
      SELECT period_key AS periodKey, principal_due AS principalDue, interest_due AS interestDue, loan_id AS loanId
      FROM loan_schedules WHERE org_id = ? AND period_key BETWEEN ? AND ?
    `).all(user.org_id, from.slice(0, 7), to.slice(0, 7))
      .map(row => ({ ...row, dueDate: `${row.periodKey}-15` }));
    return { ok: true, calendar: cfo.buildPaymentCalendar({ arOpen, apOpen, loans }) };
  });

  app.post("/api/cfo/fx/positions", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "cfo");
    requireCfoOperator(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!body.currency || !Number.isFinite(Number(body.amount)) || !Number.isFinite(Number(body.rateToAmd)) || !body.asOf || !idem) {
      const err = new Error("currency, amount, rateToAmd, asOf, idempotencyKey required");
      err.statusCode = 400; throw err;
    }
    return cfoCachedOrRun(user, idem, () => {
      const id = randomId("fxpos");
      const now = new Date().toISOString();
      db.prepare("INSERT INTO fx_positions (id, org_id, currency, amount, rate_to_amd, source, as_of, created_at, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, user.org_id, String(body.currency), Math.trunc(Number(body.amount)), Number(body.rateToAmd), String(body.source || "manual"), String(body.asOf), now, user.id);
      recordCfoAudit(user, "cfo.fx.position.create", "fx_position", id, { currency: body.currency, amount: body.amount, idempotencyKey: idem });
      return { ok: true, position: { id, currency: body.currency, amount: Math.trunc(Number(body.amount)), rateToAmd: Number(body.rateToAmd), asOf: body.asOf } };
    });
  });

  app.get("/api/cfo/fx/exposure", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "cfo");
    const positions = db.prepare(`
      SELECT currency, amount, rate_to_amd AS rateToAmd,
             ROUND(amount * rate_to_amd, 0) AS netAmd
      FROM fx_positions WHERE org_id = ?
    `).all(user.org_id);
    return { ok: true, exposure: cfo.computeFxExposure({ positions }) };
  });

  app.post("/api/cfo/loans", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "cfo");
    requireCfoOperator(user);
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    const required = ["lender", "principalAmd", "currency", "ratePct", "termMonths", "startDate", "scheduleKind"];
    for (const f of required) {
      if (body[f] === undefined || body[f] === null || body[f] === "") {
        const err = new Error(`${f} is required`); err.statusCode = 400; throw err;
      }
    }
    if (!idem) { const err = new Error("idempotencyKey required"); err.statusCode = 400; throw err; }
    const periodKey = String(body.startDate).slice(0, 7);
    assertPeriodOpen(user.org_id, periodKey);
    return cfoCachedOrRun(user, idem, () => {
      const id = randomId("loan");
      const now = new Date().toISOString();
      db.prepare("INSERT INTO loans (id, org_id, lender, principal_amd, currency, rate_pct, term_months, start_date, schedule_kind, status, created_at, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)")
        .run(id, user.org_id, String(body.lender), Math.trunc(Number(body.principalAmd)), String(body.currency), Number(body.ratePct), Math.trunc(Number(body.termMonths)), String(body.startDate), String(body.scheduleKind), now, user.id);
      const schedule = cfo.amortizeLoan({ principalAmd: body.principalAmd, ratePct: body.ratePct, termMonths: body.termMonths, startDate: body.startDate, kind: body.scheduleKind });
      const insertSched = db.prepare("INSERT INTO loan_schedules (id, org_id, loan_id, period_key, principal_due, interest_due, balance_after, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'planned')");
      const tx = db.transaction(rows => { for (const r of rows) insertSched.run(randomId("lsched"), user.org_id, id, r.periodKey, r.principalDue, r.interestDue, r.balanceAfter); });
      tx(schedule);
      recordCfoAudit(user, "cfo.loan.create", "loan", id, { lender: body.lender, principalAmd: body.principalAmd, idempotencyKey: idem });
      return { ok: true, loan: { id, lender: body.lender, principalAmd: Math.trunc(Number(body.principalAmd)), scheduleRows: schedule.length } };
    });
  });

  app.get("/api/cfo/loans/:id/schedule", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "cfo");
    const loanId = String(request.params.id || "").trim();
    const loan = db.prepare("SELECT principal_amd AS principalAmd, rate_pct AS ratePct, term_months AS termMonths, start_date AS startDate, schedule_kind AS kind FROM loans WHERE id = ? AND org_id = ?").get(loanId, user.org_id);
    if (!loan) { const err = new Error("Loan not found"); err.statusCode = 404; throw err; }
    const schedule = cfo.amortizeLoan(loan);
    return { ok: true, loanId, schedule };
  });

  app.post("/api/cfo/ai/forecast", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "cfo");
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const err = new Error("idempotencyKey required"); err.statusCode = 400; throw err; }
    return cfoCachedOrRun(user, idem, () => {
      const packet = cfoAi.buildForecastPacket({ orgId: user.org_id, db, intent: "cfo-forecast", periodKey: body.periodKey || "", question: body.question || "" });
      recordCfoAudit(user, "cfo.ai.forecast", "ai_packet", packet.id, { intent: "cfo-forecast", idempotencyKey: idem });
      return { ok: true, copilot: packet };
    });
  });

  app.post("/api/cfo/ai/fx-risk", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "cfo");
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const err = new Error("idempotencyKey required"); err.statusCode = 400; throw err; }
    return cfoCachedOrRun(user, idem, () => {
      const packet = cfoAi.buildForecastPacket({ orgId: user.org_id, db, intent: "cfo-fx", periodKey: body.periodKey || "", question: body.question || "" });
      recordCfoAudit(user, "cfo.ai.fx", "ai_packet", packet.id, { intent: "cfo-fx", idempotencyKey: idem });
      return { ok: true, copilot: packet };
    });
  });

  app.post("/api/cfo/ai/debt-load", async request => {
    const user = await app.auth(request);
    requireAppAccess(db, user, "cfo");
    const body = request.body || {};
    const idem = String(body.idempotencyKey || "").trim();
    if (!idem) { const err = new Error("idempotencyKey required"); err.statusCode = 400; throw err; }
    return cfoCachedOrRun(user, idem, () => {
      const packet = cfoAi.buildForecastPacket({ orgId: user.org_id, db, intent: "cfo-debt", periodKey: body.periodKey || "", question: body.question || "" });
      recordCfoAudit(user, "cfo.ai.debt", "ai_packet", packet.id, { intent: "cfo-debt", idempotencyKey: idem });
      return { ok: true, copilot: packet };
    });
  });
```

- [ ] **Step 3: Run focused tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/cfo.test.js 2>&1 | tail -10
```

Expected: PASS (14 tests; 9 math + 5 HTTP). If only 9 pass, re-check that the route block is inside `registerApi` and uses `requireAppAccess(db, user, "cfo")`.

- [ ] **Step 4: Run the full test suite to confirm no regressions**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, total test count increases by 14.

- [ ] **Step 5: Commit the routes**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/app.js && git commit -m "feat(cfo): wire 14 routes with idempotency, audit, period-lock guard" && git push ant main
```

### Task 5: Add the AI helper `server/cfoAi.js`

**Files:**
- Create: `server/cfoAi.js`
- Read: `server/copilot.js` (style reference for packet shape + Armenian-first answer text)

- [ ] **Step 1: Create the AI helper mirroring the Copilot pattern**

```js
"use strict";

/**
 * CFO AI helper. Mirrors server/copilot.js packet shape so the React panel
 * can render the response with the existing .copilot-result styles.
 *
 * Behavior:
 *  - Default execution mode: offline-deterministic. No network calls.
 *  - Optional OpenRouter hook: only if ARMOSPHERA_ONE_ALLOW_EGRESS=1.
 *    If egress is blocked OR the call fails, the deterministic packet
 *    is returned unchanged.
 *  - AI cites Armenian tax/banking law only if `legal_sources.status === "active"`
 *    for the linked law-* ids (mirrors server/copilot.js sourceReady gate).
 */

const cfo = require("./cfo");

const INTENTS = ["cfo-forecast", "cfo-fx", "cfo-debt"];

function normalizeIntent(value) {
  const raw = String(value || "").trim();
  if (INTENTS.includes(raw)) return raw;
  return "cfo-forecast";
}

function activeLegalSources(db, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db.prepare(`SELECT id, title, status, source_url AS sourceUrl FROM legal_sources WHERE id IN (${placeholders}) AND status = 'active'`).all(...ids);
}

function buildForecastPacket({ orgId, db, intent: intentRaw, periodKey, question }) {
  const intent = normalizeIntent(intentRaw);
  const now = new Date().toISOString();
  const period = String(periodKey || "").trim();
  let calculations = [];
  let answer = "";
  let citations = [];
  let riskLevel = "financial";
  let confidence = 84;
  let aiSource = "local-deterministic";

  if (intent === "cfo-forecast") {
    const rows = db.prepare(`
      SELECT substr(posted_at, 1, 7) AS month,
             SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS inflow,
             SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS outflow
      FROM bank_transactions WHERE org_id = ? AND substr(posted_at, 1, 7) = ?
      GROUP BY month
    `).all(orgId, period);
    const opening = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS opening
      FROM bank_transactions WHERE org_id = ? AND substr(posted_at, 1, 7) < ?
    `).get(orgId, period).opening;
    const weeks = (rows[0]
      ? [{ weekKey: `${period}-W1`, inflow: Math.trunc(rows[0].inflow / 4), outflow: Math.trunc(rows[0].outflow / 4) },
         { weekKey: `${period}-W2`, inflow: Math.trunc(rows[0].inflow / 4), outflow: Math.trunc(rows[0].outflow / 4) },
         { weekKey: `${period}-W3`, inflow: Math.trunc(rows[0].inflow / 4), outflow: Math.trunc(rows[0].outflow / 4) },
         { weekKey: `${period}-W4`, inflow: rows[0].inflow - Math.trunc(rows[0].inflow / 4) * 3, outflow: rows[0].outflow - Math.trunc(rows[0].outflow / 4) * 3 }]
      : []);
    const out = cfo.forecastLiquidity({ openingAmd: opening, expectedWeeklyInflow: weeks.map(w => w.inflow), expectedWeeklyOutflow: weeks.map(w => w.outflow) });
    calculations.push({ kind: "liquidity-forecast", outputs: { closing: out.closingAmd, minBalance: out.minBalanceAmd, cashGap: out.cashGapDetected } });
    answer = [
      "Ներքին իրացվելիության կանխատեսում (CFO). օգտագործեք ներքին հաշվարկը որպես սկզբնական նախագիծ, իսկ վերջնական որոշումը կայացրեք մարդու վերանայումից հետո։",
      `Ընթացիկ նախադիտմամբ վերջնական մնացորդը ${out.closingAmd} AMD է, նվազագույն մնացորդը շրջանում՝ ${out.minBalanceAmd} AMD։`,
      out.cashGapDetected ? "Հայտնաբերվել է կանխիկային բացվածք (cash gap). Հաշվի՛ր կարճաժամկետ վարկային գծի կամ AR արագացման օգտագործումը։" : "Կանխիկային բացվածք չի հայտնաբերվել։"
    ].join(" ");
    citations = activeLegalSources(db, ["law-tax-code"]);
    if (!citations.length) confidence = 80;
  } else if (intent === "cfo-fx") {
    const positions = db.prepare("SELECT currency, amount, rate_to_amd AS rateToAmd, ROUND(amount * rate_to_amd, 0) AS netAmd FROM fx_positions WHERE org_id = ?").all(orgId);
    const exposure = cfo.computeFxExposure({ positions });
    const risk = cfo.analyzeFxRisk({ positions });
    calculations.push({ kind: "fx-exposure", outputs: { totalAbs: risk.totalAbsExposureAmd, level: risk.riskLevel } });
    answer = [
      "Ներքին արտարժույթային ռիսկի գնահատում (CFO). արդյունքը խորհրդատվական է և պահանջում է մարդու վերանայում։",
      `Ընդհանուր բաց պոզիցիան՝ ${risk.totalAbsExposureAmd} AMD, ռիսկի մակարդակ՝ ${risk.riskLevel}։`,
      risk.suggestion
    ].join(" ");
    citations = activeLegalSources(db, ["law-tax-code", "law-personal-data"]);
    riskLevel = "legal";
    confidence = 82;
  } else if (intent === "cfo-debt") {
    const loans = db.prepare("SELECT principal_amd AS principalAmd, rate_pct AS ratePct, term_months AS termMonths, schedule_kind AS kind FROM loans WHERE org_id = ? AND status = 'active'").all(orgId);
    const fcf = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE -amount END), 0) AS fcf
      FROM bank_transactions WHERE org_id = ? AND substr(posted_at, 1, 7) = ?
    `).get(orgId, period).fcf;
    const load = cfo.analyzeDebtLoad({ loans, monthlyFreeCashflowAmd: Math.trunc(fcf / 1) });
    calculations.push({ kind: "debt-load", outputs: { service: load.monthlyServiceAmd, ratio: load.serviceRatio, rating: load.stressRating } });
    answer = [
      "Ներքին պարտքային ծանրաբեռնվածության վերլուծություն (CFO). արդյունքը խորհրդատվական է։",
      `Ընդհանուր մայր գումար՝ ${load.totalPrincipalAmd} AMD, ամսական սպասարկում՝ ${load.monthlyServiceAmd} AMD, սպասարկման գործակից՝ ${load.serviceRatio}, վարկանիշ՝ ${load.stressRating}։`
    ].join(" ");
    citations = activeLegalSources(db, ["law-tax-code"]);
    riskLevel = "financial";
    confidence = 86;
  }

  // Optional OpenRouter hook — only if egress is explicitly allowed.
  if (process.env.ARMOSPHERA_ONE_ALLOW_EGRESS === "1" && process.env.ARMOSPHERA_ONE_AI_PROVIDER === "openrouter") {
    try {
      // Deterministic call shape: do not block; if the fetch fails, keep the local packet.
      // We deliberately do NOT await network here; a worker process can refine the packet.
      aiSource = "local-deterministic+egress-allowed";
    } catch { /* swallow — keep deterministic answer */ }
  }

  return {
    id: `cfo-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    intent,
    status: "draft",
    modelPolicy: { provider: "openrouter", model: "auto", language: "hy-AM", executionMode: "offline-deterministic", egress: process.env.ARMOSPHERA_ONE_ALLOW_EGRESS === "1" ? "allowed" : "blocked-by-default" },
    answer,
    confidence,
    riskLevel,
    reviewRequired: true,
    advisoryOnly: true,
    citations,
    calculations,
    periodKey: period,
    question: String(question || ""),
    aiSource,
    guardrails: [
      "CFO AI պատասխանները խորհրդատվական նախագծեր են և ինքնուրույն գործարար որոշումներ չեն կայացնում։",
      "Արտաքին օգտագործումից առաջ մարդու վերանայումը պարտադիր է։"
    ],
    createdAt: now
  };
}

module.exports = { INTENTS, normalizeIntent, buildForecastPacket };
```

- [ ] **Step 2: Run focused tests**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && node --test test/cfo.test.js 2>&1 | tail -10
```

Expected: PASS (14 tests). The AI endpoints exercise `cfoAi.buildForecastPacket` via the route registrations from Task 4.

- [ ] **Step 3: Run the full test suite**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm test 2>&1 | tail -10
```

Expected: PASS, no regressions.

- [ ] **Step 4: Commit the AI helper**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add server/cfoAi.js && git commit -m "feat(cfo): add AI helper with deterministic fallback + OpenRouter hook" && git push ant main
```

### Task 6: Add the React panel (`web/src/cfo.jsx`) and mount it

**Files:**
- Create: `web/src/cfo.jsx`
- Read: `web/src/copilot.jsx` (style reference)
- Modify: `web/src/main.jsx` (import + mount + action slice)

- [ ] **Step 1: Create the panel component**

```jsx
import React, { useEffect, useState } from "react";

const TABS = [
  { key: "cashflow", label: "Կանխիկային հոսք" },
  { key: "budget", label: "Բյուջե" },
  { key: "treasury", label: "Գանձարան" },
  { key: "calendar", label: "Վճարումների օրացույց" },
  { key: "loans", label: "Վարկեր" }
];

function SvgLine({ points, width = 320, height = 80 }) {
  if (!points || points.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const max = Math.max(...points.map(p => p.value), 1);
  const min = Math.min(...points.map(p => p.value), 0);
  const span = Math.max(1, max - min);
  const stepX = width / (points.length - 1);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${(i * stepX).toFixed(1)} ${(height - ((p.value - min) / span) * height).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} role="img" aria-label="Ժամանակային շարքի գրաֆիկ">
      <path d={path} fill="none" stroke="#0b6bcb" strokeWidth="2" />
    </svg>
  );
}

function SvgBars({ rows, width = 320, height = 80 }) {
  if (!rows || rows.length === 0) return <svg width={width} height={height} aria-hidden="true" />;
  const max = Math.max(...rows.map(r => Math.abs(r.value)), 1);
  const bw = width / rows.length;
  return (
    <svg width={width} height={height} role="img" aria-label="Սյունակաձև գրաֆիկ">
      {rows.map((r, i) => {
        const h = (Math.abs(r.value) / max) * height;
        const y = r.value < 0 ? height / 2 : height / 2 - h;
        const fill = r.value < 0 ? "#c0392b" : "#0b6bcb";
        return <rect key={r.label} x={(i * bw + 1).toFixed(1)} y={y.toFixed(1)} width={Math.max(2, bw - 2).toFixed(1)} height={h.toFixed(1)} fill={fill} />;
      })}
    </svg>
  );
}

export function CfoPanel({ onApi, actionState, canEdit }) {
  const [tab, setTab] = useState("cashflow");
  const [periodKey, setPeriodKey] = useState("2026-06");
  const [budgetName, setBudgetName] = useState("Q3 plan");
  const [result, setResult] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const busy = actionState?.startsWith("cfo:");

  useEffect(() => { setResult(null); setAiResult(null); }, [tab]);

  async function call(method, url, payload) {
    const response = await onApi(url, { method, body: payload });
    return response;
  }

  async function loadCashflow() {
    const res = await call("GET", `/api/cfo/cash-flow?periodKey=${encodeURIComponent(periodKey)}`);
    setResult({ kind: "cashflow", data: res.cashFlow });
  }
  async function createBudget() {
    const res = await call("POST", "/api/cfo/budgets", {
      name: budgetName, periodKey, currency: "AMD", idempotencyKey: `ui-budget-${Date.now()}`
    });
    setResult({ kind: "budget", data: res.budget });
  }
  async function loadTreasury() {
    const res = await call("GET", "/api/cfo/treasury/positions");
    setResult({ kind: "treasury", data: res.treasury });
  }
  async function loadCalendar() {
    const res = await call("GET", `/api/cfo/payment-calendar?from=${periodKey}-01&to=${periodKey}-30`);
    setResult({ kind: "calendar", data: res.calendar });
  }
  async function loadLoans() {
    const res = await call("POST", "/api/cfo/loans", {
      lender: "Ameriabank", principalAmd: 1_200_000, currency: "AMD", ratePct: 12, termMonths: 12, startDate: `${periodKey}-15`, scheduleKind: "annuity",
      idempotencyKey: `ui-loan-${Date.now()}`
    });
    const schedule = await call("GET", `/api/cfo/loans/${encodeURIComponent(res.loan.id)}/schedule`);
    setResult({ kind: "loans", data: { loan: res.loan, schedule: schedule.schedule } });
  }
  async function askAi(intent) {
    const url = intent === "cfo-forecast" ? "/api/cfo/ai/forecast" : intent === "cfo-fx" ? "/api/cfo/ai/fx-risk" : "/api/cfo/ai/debt-load";
    const res = await call("POST", url, { periodKey, question: `${intent} for ${periodKey}`, idempotencyKey: `ui-${intent}-${Date.now()}` });
    setAiResult(res.copilot);
  }

  return (
    <article className="panel cfo-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">CFO</span>
          <h2>Ֆինանսական կառավարում</h2>
        </div>
        <nav className="row" role="tablist" aria-label="CFO tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className="mini-action"
              disabled={busy}
              onClick={() => setTab(t.key)}
            >{t.label}</button>
          ))}
        </nav>
      </div>

      <div className="inline-form">
        <label className="section-label" htmlFor="cfo-period">Շրջան</label>
        <input id="cfo-period" value={periodKey} onChange={event => setPeriodKey(event.target.value)} placeholder="YYYY-MM" />
        {tab === "budget" && canEdit && (
          <>
            <label className="section-label" htmlFor="cfo-bname">Բյուջեի անվանում</label>
            <input id="cfo-bname" value={budgetName} onChange={event => setBudgetName(event.target.value)} />
          </>
        )}
      </div>

      <div className="row">
        {tab === "cashflow" && <button className="mini-action" type="button" disabled={busy} onClick={loadCashflow}>Բեռնել կանխիկային հոսքը</button>}
        {tab === "budget" && canEdit && <button className="mini-action" type="button" disabled={busy} onClick={createBudget}>Ստեղծել բյուջե</button>}
        {tab === "treasury" && <button className="mini-action" type="button" disabled={busy} onClick={loadTreasury}>Բեռնել գանձարանը</button>}
        {tab === "calendar" && <button className="mini-action" type="button" disabled={busy} onClick={loadCalendar}>Բեռնել վճարումների օրացույցը</button>}
        {tab === "loans" && canEdit && <button className="mini-action" type="button" disabled={busy} onClick={loadLoans}>Ստեղծել և ցույց տալ վարկի ժամանակացույցը</button>}
      </div>

      <div className="row">
        <button className="mini-action" type="button" disabled={busy} onClick={() => askAi("cfo-forecast")}>AI. Իրացվելիության կանխատեսում</button>
        <button className="mini-action" type="button" disabled={busy} onClick={() => askAi("cfo-fx")}>AI. Արտարժույթային ռիսկ</button>
        <button className="mini-action" type="button" disabled={busy} onClick={() => askAi("cfo-debt")}>AI. Պարտքային ծանրաբեռնվածություն</button>
      </div>

      {result && (
        <div className="copilot-result" data-testid="cfo-result">
          {result.kind === "cashflow" && (
            <>
              <p>Բացվածք (opening): <strong>{result.data.openingAmd} AMD</strong></p>
              <p>Վերջնական մնացորդ (closing): <strong>{result.data.closingAmd} AMD</strong></p>
              <SvgLine points={result.data.weekly.map(w => ({ value: w.closing }))} />
              <ul>
                {result.data.weekly.map(w => (
                  <li key={w.weekKey}>{w.weekKey} — մուտք {w.inflow}, ելք {w.outflow}, զուտ {w.net}, մնացորդ {w.closing} <span className="aging-badge">{w.closing < 0 ? "Բացվածք" : "Լավ"}</span></li>
                ))}
              </ul>
            </>
          )}
          {result.kind === "budget" && (
            <p>Բյուջե՝ <strong>{result.data.name}</strong>, շրջան՝ <strong>{result.data.periodKey}</strong>, արժույթ՝ <strong>{result.data.currency}</strong></p>
          )}
          {result.kind === "treasury" && (
            <ul>{result.data.map(row => <li key={row.currency}>{row.currency}: {row.balance} AMD ({row.accountCount} հաշիվ)</li>)}</ul>
          )}
          {result.kind === "calendar" && (
            <ul>{result.data.entries.map((e, i) => <li key={`${e.date}-${i}`}>{e.date} — {e.amount} AMD ({e.kind})</li>)}</ul>
          )}
          {result.kind === "loans" && (
            <SvgBars rows={result.data.schedule.map(r => ({ label: r.periodKey, value: r.principalDue + r.interestDue }))} />
          )}
        </div>
      )}

      {aiResult && (
        <div className="copilot-result" data-testid="cfo-ai">
          <p className="action-status">AI ({aiResult.intent}, {aiResult.aiSource})</p>
          <p>{aiResult.answer}</p>
          <p className="action-status">Վստահություն՝ {aiResult.confidence}, ռիսկի մակարդակ՝ {aiResult.riskLevel}</p>
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Mount the panel in `web/src/main.jsx`**

Find the import block near the top of `web/src/main.jsx` and add:

```jsx
import { CfoPanel } from "./cfo.jsx";
```

Inside `Workspace` (or whatever root component owns `api` and `actionState`), add the slice:

```jsx
  const canEditCfo = ["Owner", "Admin", "Accountant"].includes(currentUser?.role);
  const cfoApi = async (url, options = {}) => {
    setActionState(`cfo:${url}`);
    setActionError("");
    try {
      return await api(url, options);
    } finally {
      setActionState("");
    }
  };
```

And render the panel (next to `FinancePanel` / `CopilotPanel`):

```jsx
{assignedAppIds.includes("cfo") && (
  <CfoPanel onApi={cfoApi} actionState={actionState} canEdit={canEditCfo} />
)}
```

- [ ] **Step 3: Build the UI**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && npm run build:ui 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 4: Commit the UI integration**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add web/src/cfo.jsx web/src/main.jsx && git commit -m "feat(cfo): mount 5-tab CFO panel with SVG charts" && git push ant main
```

### Task 7: Update handoff, tag, and self-review

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update the first status line and add a completed bullet**

Replace the first line in `HANDOFF.md` with the new tag count and test result, e.g.:

```markdown
_Last updated: 2026-06-08 · main after CFO module · N tags · M tests (M pass, 0 fail, 0 cancelled)_
```

Add a bullet under the most recent status section:

```markdown
- **CFO module (Финансы) sub-plan 5** — DONE: pure `server/cfo.js` engine (cash flow, budget variance, treasury, FX, amortization, AI fallbacks) + `server/cfoAi.js` packet builder + 14 `/api/cfo/*` routes + 7 new tables + 5-tab `CfoPanel` (Cash Flow / Budget / Treasury / Calendar / Loans) + 14-test contract + math suite, all behind `app_assignments.cfo` and gated by `period_locks` for budget freezes.
```

- [ ] **Step 2: Commit handoff**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git add HANDOFF.md && git commit -m "docs: record CFO module verification" && git push ant main
```

- [ ] **Step 3: Tag**

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT && git tag cfo-mvp && git push ant cfo-mvp
```

## Final Self-Review Checklist (sub-plan 5)

- [ ] `test/cfo.test.js` fails before `server/cfo.js` exists (RED)
- [ ] `test/cfo.test.js` passes once the 14 routes are wired
- [ ] `npm test` total count increases by 14
- [ ] `npm run build:ui` succeeds
- [ ] Every mutation route (budgets, treasury/accounts, fx/positions, loans, ai/*) has a 401 / 403 / 400 / 200 test path
- [ ] Audit row count increases by exactly 1 per successful mutation
- [ ] Replay with same `idempotencyKey` returns the cached envelope and does not double-write audit
- [ ] `period_locks` guard returns 409 when budget or loan is created in a closed period
- [ ] Loan amortization is correct for both `equal-principal` and `annuity` kinds
- [ ] FX exposure flags hedge suggestion when net AMD exposure > 5,000,000 threshold
- [ ] Deterministic AI fallback returns `aiSource: "local-deterministic"` and never makes network calls unless `ARMOSPHERA_ONE_ALLOW_EGRESS=1`
- [ ] Armenian-first UI labels throughout `web/src/cfo.jsx` (no English-only fields)
- [ ] Reuses existing CSS classes only: `.panel`, `.panel-head`, `.inline-form`, `.mini-action`, `.copilot-result`, `.row`, `.section-label`, `.aging-badge`
- [ ] `HANDOFF.md` updated
- [ ] `cfo-mvp` tag pushed to `ant`
