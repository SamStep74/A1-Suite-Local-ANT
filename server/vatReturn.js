// Armenian VAT return computation engine — RA finance kernel.
//
// Computes the period VAT position: output VAT (charged on sales) minus recoverable
// input VAT (paid on purchases) = net. A positive net is payable to the SRC; a
// negative net is a carried-forward credit (Armenia does not auto-refund — it carries).
// All amounts are whole dram via the localization kernel.
//
// The CALCULATION is standard RA VAT logic. Mapping these figures onto the specific
// lines of the official SRC VAT-return form is a separate task (needs the form spec).
// Pure functions, no I/O.

const { roundAmd } = require("./localization");

const STANDARD_VAT_RATE = 20;

function lineVat(line = {}) {
  const net = roundAmd(line.netAmount);
  const rate = Number(line.vatRate) || 0;
  const vat = line.vatAmount != null ? roundAmd(line.vatAmount) : roundAmd((net * rate) / 100);
  return { net, vat };
}

function computeVatReturn({ sales = [], purchases = [] } = {}) {
  let outputVat = 0;
  let taxableSales = 0;
  for (const s of sales) {
    const { net, vat } = lineVat(s);
    outputVat += vat;
    taxableSales += net;
  }

  let inputVat = 0;
  let taxablePurchases = 0;
  for (const p of purchases) {
    const { net, vat } = lineVat(p);
    taxablePurchases += net;
    if (p.recoverable !== false) inputVat += vat; // recoverable by default
  }

  const net = outputVat - inputVat;
  return {
    outputVat,
    inputVat,
    taxableSales,
    taxablePurchases,
    net,
    payable: Math.max(0, net),
    creditCarried: Math.max(0, -net),
  };
}

module.exports = { STANDARD_VAT_RATE, computeVatReturn };
