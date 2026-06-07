"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { openDatabase } = require("../server/db");
const ledger = require("../server/ledger");

function withLocale(value, fn) {
  const prev = process.env.A1_LOCALE;
  if (value === undefined) delete process.env.A1_LOCALE;
  else process.env.A1_LOCALE = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.A1_LOCALE;
    else process.env.A1_LOCALE = prev;
  }
}

function freshDb() {
  const db = openDatabase(":memory:");
  const orgId = db.prepare("SELECT id FROM organizations LIMIT 1").get().id;
  return { db, orgId };
}

test("RU opening balances offset to equity 84 and the ledger balances", () => {
  withLocale("ru", () => {
    const { db, orgId } = freshDb();
    const res = ledger.postOpeningBalances(db, orgId, {
      asOf: "2026-01-01",
      entries: [
        { code: "51", amount: 1000000 }, // расчётный счёт (debit asset)
        { code: "10", amount: 200000 }, // материалы (debit)
        { code: "60", amount: 300000 }, // поставщики / AP (credit liability)
        { code: "80", amount: 900000 }, // уставный капитал (credit equity)
      ],
    });
    assert.equal(res.count, 4);
    const ob = ledger.openingBalances(db, orgId);
    const byCode = Object.fromEntries(ob.entries.map((e) => [e.code, e]));
    assert.equal(byCode["51"].side, "debit");
    assert.equal(byCode["51"].amount, 1000000);
    assert.equal(byCode["60"].side, "credit");
    assert.equal(byCode["80"].side, "credit");
    const tb = ledger.trialBalance(db, orgId);
    assert.equal(tb.balanced, true);
    assert.ok(Object.fromEntries(tb.rows.map((r) => [r.code, r]))["84"], "equity 84 contra present");
  });
});

test("RU opening balances preserve kopecks as integer minor units", () => {
  withLocale("ru", () => {
    const { db, orgId } = freshDb();
    const res = ledger.postOpeningBalances(db, orgId, {
      asOf: "2026-01-01",
      entries: [
        { code: "51", amount: 1000.55 },
        { code: "60", amount: 250.4 },
      ],
    });
    assert.equal(res.count, 2);
    const raw = db.prepare(`
      SELECT debit_code AS debitCode, credit_code AS creditCode, amount
      FROM ledger_journal
      WHERE org_id = ? AND source_type = 'opening_balance'
      ORDER BY amount
    `).all(orgId);
    assert.deepEqual(raw.map((r) => r.amount), [25040, 100055]);
    const ob = ledger.openingBalances(db, orgId);
    const byCode = Object.fromEntries(ob.entries.map((e) => [e.code, e]));
    assert.equal(byCode["51"].amount, 1000.55);
    assert.equal(byCode["60"].amount, 250.4);
    assert.equal(ob.openingEquity, 750.15);
    assert.equal(ledger.trialBalance(db, orgId).balanced, true);
  });
});

test("RU rejects AM-only opening-balance codes; accepts RU codes", () => {
  withLocale("ru", () => {
    const { db, orgId } = freshDb();
    const res = ledger.postOpeningBalances(db, orgId, { asOf: "2026-01-01", entries: [{ code: "251", amount: 500 }] });
    assert.equal(res.count, 0); // 251 is an AM cash code, not openable under RU
    assert.equal(ledger.openingBalanceAccountByCode("251"), null);
    assert.ok(ledger.openingBalanceAccountByCode("51"), "51 is openable under RU");
    assert.equal(ledger.openingBalanceSideForCode("60"), "credit");
  });
});

test("chartOfAccounts() exposes the RU opening-balance config", () => {
  withLocale("ru", () => {
    const coa = ledger.chartOfAccounts();
    assert.equal(coa.openingBalanceEquityCode, "84");
    assert.ok(coa.openingBalanceAccountCodes.includes("51"));
    assert.ok(!coa.openingBalanceAccountCodes.includes("251"));
  });
});

test("AM opening balances unchanged under the default locale (equity 331)", () => {
  withLocale(undefined, () => {
    const { db, orgId } = freshDb();
    const res = ledger.postOpeningBalances(db, orgId, { asOf: "2026-01-01", entries: [{ code: "251", amount: 1000 }] });
    assert.equal(res.count, 1);
    assert.equal(ledger.chartOfAccounts().openingBalanceEquityCode, "331");
    assert.equal(ledger.trialBalance(db, orgId).balanced, true);
  });
});
