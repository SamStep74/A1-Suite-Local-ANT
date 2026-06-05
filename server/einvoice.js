// E-invoice XML builder — Armenian invoice export engine.
//
// Produces a structured e-invoice document (ported from the HayHashvapah schema
// `urn:hayhashvapah:einvoice:1`), improved with MULTI-LINE support and whole-dram
// AMD amounts (via the localization kernel). This is a structured EXPORT the user
// maps to the official SRC (State Revenue Committee, src.am) e-invoice XSD before
// upload — the SRC schema and submission require the client's own SRC account and
// certificate, so they are intentionally out of scope here.
//
// Pure functions, no I/O.

const { roundAmd } = require("./localization");

const EINVOICE_NAMESPACE = "urn:hayhashvapah:einvoice:1";

function xmlEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Normalize a raw line into integer-dram amounts; computes VAT from net*rate and
// the line total unless explicitly provided (e.g. exempt/zero-rated lines).
function normalizeLine(line = {}) {
  const net = roundAmd(line.netAmount);
  const rate = Number(line.vatRate) || 0;
  const vat = line.vatAmount != null ? roundAmd(line.vatAmount) : roundAmd((net * rate) / 100);
  const total = line.lineTotal != null ? roundAmd(line.lineTotal) : roundAmd(net + vat);
  const quantity = line.quantity != null ? Number(line.quantity) : 1;
  return { description: line.description || "", quantity, net, rate, vat, total };
}

function eInvoiceTotals(lines) {
  return (lines || []).map(normalizeLine).reduce(
    (acc, l) => ({ net: acc.net + l.net, vat: acc.vat + l.vat, total: acc.total + l.total }),
    { net: 0, vat: 0, total: 0 },
  );
}

function buildEInvoiceXml(invoice = {}) {
  const {
    number = "", issueDate = "", dueDate = "", currency = "AMD",
    supplier = {}, buyer = {}, lines = [],
  } = invoice;
  const norm = (lines || []).map(normalizeLine);
  const totals = norm.reduce(
    (a, l) => ({ net: a.net + l.net, vat: a.vat + l.vat, total: a.total + l.total }),
    { net: 0, vat: 0, total: 0 },
  );
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!-- A1/HayHashvapah e-invoice export. Map fields to the official SRC e-invoice XSD",
    "     (https://src.am) before upload; submission requires the client's SRC account/certificate. -->",
    `<EInvoice xmlns="${EINVOICE_NAMESPACE}" currency="${xmlEscape(currency)}">`,
    `  <Number>${xmlEscape(number)}</Number>`,
    `  <IssueDate>${xmlEscape(String(issueDate).slice(0, 10))}</IssueDate>`,
    `  <DueDate>${xmlEscape(String(dueDate || "").slice(0, 10))}</DueDate>`,
    "  <Supplier>",
    `    <Name>${xmlEscape(supplier.name)}</Name>`,
    `    <TaxId>${xmlEscape(supplier.hvhh || supplier.taxId || "")}</TaxId>`,
    "  </Supplier>",
    "  <Buyer>",
    `    <Name>${xmlEscape(buyer.name)}</Name>`,
    `    <TaxId>${xmlEscape(buyer.hvhh || buyer.taxId || "")}</TaxId>`,
    "  </Buyer>",
    "  <Lines>",
  ];
  for (const l of norm) {
    out.push(
      "    <Line>",
      `      <Description>${xmlEscape(l.description)}</Description>`,
      `      <Quantity>${l.quantity}</Quantity>`,
      `      <NetAmount>${l.net}</NetAmount>`,
      `      <VatRate>${l.rate}</VatRate>`,
      `      <VatAmount>${l.vat}</VatAmount>`,
      `      <LineTotal>${l.total}</LineTotal>`,
      "    </Line>",
    );
  }
  out.push(
    "  </Lines>",
    "  <Totals>",
    `    <TotalNet>${totals.net}</TotalNet>`,
    `    <TotalVat>${totals.vat}</TotalVat>`,
    `    <TotalAmount>${totals.total}</TotalAmount>`,
    "  </Totals>",
    "</EInvoice>",
  );
  return out.join("\n");
}

module.exports = {
  EINVOICE_NAMESPACE,
  xmlEscape,
  normalizeLine,
  eInvoiceTotals,
  buildEInvoiceXml,
};
