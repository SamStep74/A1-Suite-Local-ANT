// E-invoice XML builder — Armenian invoice export engine.
//
// Produces a structured e-invoice document (ported from the HayHashvapah schema
// `urn:hayhashvapah:einvoice:1`), improved with MULTI-LINE support, whole-dram AMD
// amounts (via the localization kernel), and the official SRC e-invoice field set
// (per the SRC e-Invoicing User Guide): transaction type (Գործարքի տեսակ, mandatory
// since 2025-03-01), supplier VAT-payer reg № (ԱԱՀՎՀՀ), buyer passport fallback when
// no ՀՎՀՀ, and per-line unit price / excise / environmental fee.
//
// This is a structured EXPORT the user maps to the official SRC (src.am) e-invoice
// XSD before upload — the XSD ships inside the SRC desktop program (not published
// publicly) and submission requires the client's own SRC account + certificate, so
// the formal XSD mapping and submission are intentionally out of scope. Element
// names below are our representation of the official fields.
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

// Normalize a raw line into integer-dram amounts. Computes VAT from net*rate and the
// line total (= net + VAT + excise + env-fee, per the official form) unless provided.
function normalizeLine(line = {}) {
  const net = roundAmd(line.netAmount);
  const rate = Number(line.vatRate) || 0;
  const vat = line.vatAmount != null ? roundAmd(line.vatAmount) : roundAmd((net * rate) / 100);
  const excise = roundAmd(line.exciseAmount); // defaults 0
  const envFee = roundAmd(line.envFee); // defaults 0
  const quantity = line.quantity != null ? Number(line.quantity) : 1;
  const unitPrice = line.unitPrice != null
    ? roundAmd(line.unitPrice)
    : (quantity ? roundAmd(net / quantity) : 0);
  const total = line.lineTotal != null
    ? roundAmd(line.lineTotal)
    : roundAmd(net + vat + excise + envFee);
  return { description: line.description || "", quantity, unitPrice, net, rate, vat, excise, envFee, total };
}

function eInvoiceTotals(lines) {
  return (lines || []).map(normalizeLine).reduce(
    (a, l) => ({
      net: a.net + l.net, vat: a.vat + l.vat,
      excise: a.excise + l.excise, envFee: a.envFee + l.envFee, total: a.total + l.total,
    }),
    { net: 0, vat: 0, excise: 0, envFee: 0, total: 0 },
  );
}

function buildEInvoiceXml(invoice = {}) {
  const {
    number = "", issueDate = "", creationDate = "", dueDate = "", currency = "AMD",
    transactionType = "", supplier = {}, buyer = {}, lines = [],
  } = invoice;
  const norm = (lines || []).map(normalizeLine);
  const totals = norm.reduce(
    (a, l) => ({
      net: a.net + l.net, vat: a.vat + l.vat,
      excise: a.excise + l.excise, envFee: a.envFee + l.envFee, total: a.total + l.total,
    }),
    { net: 0, vat: 0, excise: 0, envFee: 0, total: 0 },
  );

  // Buyer identification: ՀՎՀՀ (TaxId) for organizations, else passport for individuals.
  const buyerId = (buyer.hvhh || buyer.taxId)
    ? `    <TaxId>${xmlEscape(buyer.hvhh || buyer.taxId)}</TaxId>`
    : (buyer.passport ? `    <PassportSeries>${xmlEscape(buyer.passport)}</PassportSeries>` : "    <TaxId/>");

  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!-- A1/HayHashvapah e-invoice export. Map fields to the official SRC e-invoice XSD",
    "     (https://src.am) before upload; submission requires the client's SRC account/certificate. -->",
    `<EInvoice xmlns="${EINVOICE_NAMESPACE}" currency="${xmlEscape(currency)}">`,
    `  <Number>${xmlEscape(number)}</Number>`,
    `  <TransactionType>${xmlEscape(transactionType)}</TransactionType>`,
    `  <IssueDate>${xmlEscape(String(issueDate).slice(0, 10))}</IssueDate>`,
    `  <CreationDate>${xmlEscape(String(creationDate || issueDate).slice(0, 10))}</CreationDate>`,
    `  <DueDate>${xmlEscape(String(dueDate || "").slice(0, 10))}</DueDate>`,
    "  <Supplier>",
    `    <Name>${xmlEscape(supplier.name)}</Name>`,
    `    <TaxId>${xmlEscape(supplier.hvhh || supplier.taxId || "")}</TaxId>`,
    `    <VatId>${xmlEscape(supplier.vatId || "")}</VatId>`,
    `    <Address>${xmlEscape(supplier.address || "")}</Address>`,
    "  </Supplier>",
    "  <Buyer>",
    `    <Name>${xmlEscape(buyer.name)}</Name>`,
    buyerId,
    `    <Address>${xmlEscape(buyer.address || "")}</Address>`,
    "  </Buyer>",
    "  <Lines>",
  ];
  for (const l of norm) {
    out.push(
      "    <Line>",
      `      <Description>${xmlEscape(l.description)}</Description>`,
      `      <Quantity>${l.quantity}</Quantity>`,
      `      <UnitPrice>${l.unitPrice}</UnitPrice>`,
      `      <NetAmount>${l.net}</NetAmount>`,
      `      <ExciseAmount>${l.excise}</ExciseAmount>`,
      `      <EnvFee>${l.envFee}</EnvFee>`,
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
    `    <TotalExcise>${totals.excise}</TotalExcise>`,
    `    <TotalEnvFee>${totals.envFee}</TotalEnvFee>`,
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
