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
