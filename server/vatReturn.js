// Armenian VAT return computation engine — RA finance kernel.
//
// Computes the period VAT position: output VAT (charged on sales) minus recoverable
// input VAT (paid on purchases) = net. A positive net is payable to the SRC; a
// negative net is a carried-forward credit (Armenia does not auto-refund — it carries).
// All amounts are whole dram via the localization kernel.
//
// The CALCULATION is standard RA VAT logic. vatReturnForm() additionally maps the
// figures onto the official SRC VAT-return form lines (decree N 298-Ն,
// arlis.am/hy/acts/136996): output lines 7/9/12/13/16, input lines 17/18/21, net 23.
// Pure functions, no I/O.

const { roundAmd } = require("./localization");

const STANDARD_VAT_RATE = 20;
const IMPUTED_VAT_RATE = 16.67; // VAT fraction of a VAT-inclusive price (20/120); form line 9

const VAT_RETURN_FORM_SOURCE = Object.freeze({
  id: "am-src-vat-excise-unified-return-n-298",
  titleHy: "Ավելացված արժեքի հարկի և ակցիզային հարկի միասնական հաշվարկ",
  titleEn: "VAT and excise tax unified return",
  authorityHy: "ՀՀ կառավարությանն առընթեր պետական եկամուտների կոմիտեի նախագահ",
  orderNumber: "N 298-Ն",
  adoptedDate: "2016-12-30",
  effectiveDate: "2018-01-01",
  sourceUrl: "https://www.arlis.am/hy/acts/136996",
  status: "active-incorporated",
});

const VAT_RETURN_FORM_LINE_DEFINITIONS = Object.freeze({
  "7": Object.freeze({
    section: "output",
    labelHy: "ԱԱՀ-ի 20% դրույքաչափով հարկվող գործարքներ",
    fields: Object.freeze(["base", "vat"]),
  }),
  "9": Object.freeze({
    section: "output",
    labelHy: "ԱԱՀ-ի 16.67% հաշվարկային դրույքաչափով հաշվարկվող գործարքներ",
    fields: Object.freeze(["base", "vat"]),
  }),
  "12": Object.freeze({
    section: "output",
    labelHy: "ԱԱՀ-ի 0-ական դրույքաչափով հարկվող գործարքներ",
    fields: Object.freeze(["base"]),
  }),
  "13": Object.freeze({
    section: "output",
    labelHy: "ԱԱՀ-ից ազատված գործարքներ",
    fields: Object.freeze(["base"]),
  }),
  "16": Object.freeze({
    section: "output-total",
    labelHy: "Ընդամենը ԱԱՀ-ի կրեդիտ",
    fields: Object.freeze(["base", "vat"]),
  }),
  "17": Object.freeze({
    section: "input",
    labelHy: "ՀՀ տարածք ներմուծված ապրանքներ",
    fields: Object.freeze(["base", "vat"]),
  }),
  "18": Object.freeze({
    section: "input",
    labelHy: "ՀՀ տարածքում ձեռք բերված ապրանքներ և ծառայություններ",
    fields: Object.freeze(["base", "vat"]),
  }),
  "21": Object.freeze({
    section: "input-total",
    labelHy: "Ընդամենը ԱԱՀ-ի դեբետ",
    fields: Object.freeze(["vat"]),
  }),
  "23": Object.freeze({
    section: "period-net",
    labelHy: "Հաշվետու ժամանակաշրջանի համար հաշվարկված ԱԱՀ",
    fields: Object.freeze(["payable", "recoverable"]),
  }),
});

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

// Classify a sale into the official form's output buckets.
function classifySale(line = {}) {
  const net = roundAmd(line.netAmount);
  const rate = Number(line.vatRate) || 0;
  const vat = line.vatAmount != null ? roundAmd(line.vatAmount) : roundAmd((net * rate) / 100);
  if (line.category === "exempt") return { bucket: "exempt", net, vat: 0 }; // line 13, art. 64
  if (rate === 0) return { bucket: "zero", net, vat: 0 }; // line 12, zero-rated, art. 65
  if (Math.abs(rate - IMPUTED_VAT_RATE) < 0.01) return { bucket: "imputed", net, vat }; // line 9
  return { bucket: "standard", net, vat }; // line 7, 20%
}

// Map a period onto the official SRC VAT-return form lines (decree N 298-Ն).
//   sales:     { netAmount, vatRate, vatAmount?, category?: "exempt" }
//   purchases: { netAmount, vatRate, vatAmount?, source?: "import"|"domestic", recoverable? }
// Each line gives { base, vat } (A = base առանց ԱԱՀ, B = VAT amount), whole dram.
function vatReturnForm({ sales = [], purchases = [] } = {}) {
  const o = { standardBase: 0, standardVat: 0, imputedBase: 0, imputedVat: 0, zeroBase: 0, exemptBase: 0 };
  for (const s of sales) {
    const c = classifySale(s);
    if (c.bucket === "standard") { o.standardBase += c.net; o.standardVat += c.vat; }
    else if (c.bucket === "imputed") { o.imputedBase += c.net; o.imputedVat += c.vat; }
    else if (c.bucket === "zero") o.zeroBase += c.net;
    else o.exemptBase += c.net;
  }
  const creditBase = o.standardBase + o.imputedBase + o.zeroBase + o.exemptBase;
  const creditVat = o.standardVat + o.imputedVat;

  let importBase = 0, importVat = 0, domesticBase = 0, domesticVat = 0;
  for (const p of purchases) {
    if (p.recoverable === false) continue;
    const { net, vat } = lineVat(p);
    if (p.source === "import") { importBase += net; importVat += vat; }
    else { domesticBase += net; domesticVat += vat; }
  }
  const debitVat = importVat + domesticVat;
  const net = creditVat - debitVat;

  return {
    source: VAT_RETURN_FORM_SOURCE,
    lineDefinitions: VAT_RETURN_FORM_LINE_DEFINITIONS,
    lines: {
      "7": { base: o.standardBase, vat: o.standardVat }, // 20% taxable transactions
      "9": { base: o.imputedBase, vat: o.imputedVat }, // 16.67% imputed
      "12": { base: o.zeroBase }, // zero-rated (art. 65)
      "13": { base: o.exemptBase }, // exempt (art. 64)
      "16": { base: creditBase, vat: creditVat }, // total VAT credit (output)
      "17": { base: importBase, vat: importVat }, // imported goods
      "18": { base: domesticBase, vat: domesticVat }, // domestic acquisitions
      "21": { vat: debitVat }, // total VAT debit (input)
      "23": { payable: Math.max(0, net), recoverable: Math.max(0, -net) }, // net for the period
    },
  };
}

module.exports = {
  STANDARD_VAT_RATE,
  IMPUTED_VAT_RATE,
  VAT_RETURN_FORM_SOURCE,
  VAT_RETURN_FORM_LINE_DEFINITIONS,
  computeVatReturn,
  vatReturnForm,
};
