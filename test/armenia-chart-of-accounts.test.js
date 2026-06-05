const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ACCOUNT_CLASSES,
  STANDARD_ACCOUNTS,
  accountClass,
  accountByCode,
  accountsByType,
  accountsByClass,
  normalBalance,
} = require("../server/armeniaChartOfAccounts");

test("CoA: defines the 7 RA account classes by leading digit", () => {
  assert.equal(ACCOUNT_CLASSES.length, 7);
  const digits = ACCOUNT_CLASSES.map((c) => c.digit);
  assert.deepEqual(digits, [1, 2, 3, 4, 5, 6, 7]);
  for (const c of ACCOUNT_CLASSES) {
    assert.ok(c.hy && c.hy.length > 0, `class ${c.digit} missing hy`);
    assert.ok(["asset", "liability", "equity", "income", "expense"].includes(c.type));
    assert.ok(["debit", "credit"].includes(c.normalBalance));
  }
});

test("CoA: ships the canonical accounts with Armenian names", () => {
  assert.ok(STANDARD_ACCOUNTS.length >= 13);
  assert.equal(accountByCode("251").hy, "Դրամարկղ");
  assert.equal(accountByCode("226").hy, "Վերականգնվող ԱԱՀ"); // standard input-VAT (2xx asset)
  assert.equal(accountByCode("611").type, "income");
  assert.equal(accountByCode("999"), null);
});

test("CoA: accountClass maps a code to its RA class by leading digit", () => {
  assert.equal(accountClass("226").digit, 2);
  assert.equal(accountClass("226").type, "asset");
  assert.equal(accountClass("524").digit, 5);
  assert.equal(accountClass("524").type, "liability");
  assert.equal(accountClass("311").type, "equity");
  assert.equal(accountClass("611").type, "income");
  assert.equal(accountClass("714").type, "expense");
  assert.equal(accountClass("xyz"), null);
});

test("CoA: every standard account's type agrees with its class (internal consistency)", () => {
  for (const a of STANDARD_ACCOUNTS) {
    const cls = accountClass(a.code);
    assert.ok(cls, `no class for ${a.code}`);
    assert.equal(
      cls.type, a.type,
      `account ${a.code} type ${a.type} disagrees with class ${cls.digit} (${cls.type})`,
    );
    assert.match(a.code, /^[0-9]{3}$/);
  }
});

test("CoA: normalBalance follows the class (assets/expenses debit; the rest credit)", () => {
  assert.equal(normalBalance("251"), "debit"); // asset
  assert.equal(normalBalance("714"), "debit"); // expense
  assert.equal(normalBalance("611"), "credit"); // income
  assert.equal(normalBalance("311"), "credit"); // equity
  assert.equal(normalBalance("524"), "credit"); // liability
  assert.equal(normalBalance("zz"), null);
});

test("CoA: query helpers by type and by class", () => {
  const expenses = accountsByType("expense");
  assert.ok(expenses.length >= 4);
  assert.ok(expenses.every((a) => a.code.startsWith("7")));
  const class6 = accountsByClass(6);
  assert.ok(class6.every((a) => a.code.startsWith("6")));
  assert.ok(class6.some((a) => a.code === "611"));
});
