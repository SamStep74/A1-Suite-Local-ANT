const test = require("node:test");
const assert = require("node:assert/strict");
const { computeVatReturn, STANDARD_VAT_RATE } = require("../server/vatReturn");

test("vat-return: net = output VAT minus recoverable input VAT (payable to SRC)", () => {
  const r = computeVatReturn({
    sales: [{ netAmount: 1000000, vatRate: 20 }],
    purchases: [{ netAmount: 400000, vatRate: 20 }],
  });
  assert.equal(r.outputVat, 200000);
  assert.equal(r.inputVat, 80000);
  assert.equal(r.net, 120000);
  assert.equal(r.payable, 120000);
  assert.equal(r.creditCarried, 0);
  assert.equal(r.taxableSales, 1000000);
});

test("vat-return: input exceeding output yields a carried credit, not a negative payable", () => {
  const r = computeVatReturn({
    sales: [{ netAmount: 100000, vatRate: 20 }], // output 20000
    purchases: [{ netAmount: 500000, vatRate: 20 }], // input 100000
  });
  assert.equal(r.net, -80000);
  assert.equal(r.payable, 0);
  assert.equal(r.creditCarried, 80000);
});

test("vat-return: non-recoverable purchases are excluded from input VAT", () => {
  const r = computeVatReturn({
    sales: [],
    purchases: [
      { netAmount: 100000, vatRate: 20, recoverable: true },
      { netAmount: 100000, vatRate: 20, recoverable: false },
    ],
  });
  assert.equal(r.inputVat, 20000); // only the recoverable one
});

test("vat-return: zero-rated/exempt sales add to base but not to output VAT", () => {
  const r = computeVatReturn({
    sales: [
      { netAmount: 100000, vatRate: 20 }, // 20000
      { netAmount: 50000, vatRate: 0 }, // exempt/zero-rated
    ],
    purchases: [],
  });
  assert.equal(r.outputVat, 20000);
  assert.equal(r.taxableSales, 150000);
});

test("vat-return: an explicit vatAmount overrides the computed one", () => {
  const r = computeVatReturn({
    sales: [{ netAmount: 100000, vatRate: 20, vatAmount: 0 }],
    purchases: [],
  });
  assert.equal(r.outputVat, 0);
});

test("vat-return: empty period is all zeros; RA standard rate is 20%", () => {
  const r = computeVatReturn({ sales: [], purchases: [] });
  assert.deepEqual(
    { o: r.outputVat, i: r.inputVat, n: r.net, p: r.payable, c: r.creditCarried },
    { o: 0, i: 0, n: 0, p: 0, c: 0 },
  );
  assert.equal(STANDARD_VAT_RATE, 20);
});
