"use strict";

const INTENTS = ["vat", "payroll", "personal-data", "esign", "month-close"];

function normalizeIntent(value, question) {
  const raw = String(value || "").trim();
  if (INTENTS.includes(raw)) return raw;
  const text = String(question || "").toLowerCase();
  if (/(vat|src|tax|invoice|ԱԱՀ|հարկ)/i.test(text)) return "vat";
  if (/(payroll|salary|gross|net|աշխատավարձ|պահում)/i.test(text)) return "payroll";
  if (/(personal[-\s]?data|privacy|delete|export|consent|տվյալ|համաձայն)/i.test(text)) return "personal-data";
  if (/(esign|signature|signed|document|contract|ստորագր)/i.test(text)) return "esign";
  if (/(month|close|period|trial balance|փակում)/i.test(text)) return "month-close";
  return "vat";
}

function requiredAppForIntent(intent) {
  if (intent === "esign") return "docs";
  return intent === "personal-data" ? "crm" : "finance";
}

function buildCopilotPacket(input) {
  const now = input.now || new Date().toISOString();
  const intent = normalizeIntent(input.intent, input.question);
  const citations = Array.isArray(input.citations) ? input.citations : [];
  const calculations = Array.isArray(input.calculations) ? input.calculations : [];
  const context = input.context || {};
  const legal = citations.filter(source => /^law-/.test(source.id || ""));
  const citationRequired = ["vat", "personal-data", "esign", "month-close"].includes(intent);
  const sourceActive = legal.length > 0 && legal.every(source => source.status === "active");
  const status = citationRequired && legal.length === 0 ? "blocked-missing-citation" : "draft";
  const riskLevel = intent === "payroll" || intent === "month-close" ? "financial" : "legal";
  const reviewRequired = true;
  return {
    id: input.id,
    intent,
    status,
    answer: buildAnswer({ intent, question: input.question, citations, calculations, context, sourceActive }),
    confidence: confidenceForIntent(intent, citations, calculations),
    riskLevel,
    reviewRequired,
    advisoryOnly: true,
    citations,
    calculations,
    context,
    proposedActions: buildProposedActions({ intent, context, sourceActive }),
    guardrails: buildGuardrails(intent),
    createdAt: now
  };
}

function confidenceForIntent(intent, citations, calculations) {
  const base = intent === "payroll" ? 88 : intent === "month-close" ? 84 : 82;
  return Math.min(94, base + Math.min(citations.length, 2) * 3 + Math.min(calculations.length, 2) * 2);
}

function buildAnswer({ intent, citations, calculations, context, sourceActive }) {
  const citationNames = citations.map(source => source.title).filter(Boolean).join("; ") || "configured Armenian legal source registry";
  if (intent === "vat") {
    const vat = calculations.find(calc => calc.kind === "vat-report");
    const payable = vat && vat.outputs ? vat.outputs.netVatPayable : null;
    return [
      "Internal draft VAT guidance: use the cited Armenian tax source, verify the customer and accounting period, and keep the response under accountant review.",
      payable !== null ? `The current VAT preview shows ${payable} AMD net VAT payable for ${context.periodKey || "the selected period"}.` : "No VAT amount was posted by this response.",
      sourceActive ? "The VAT source is active, so the next step can be preparing an SRC export packet for accountant review." : "The VAT source is not active yet, so SRC export preparation stays disabled until accountant review.",
      `Cited source(s): ${citationNames}.`
    ].join(" ");
  }
  if (intent === "payroll") {
    const payroll = calculations.find(calc => calc.kind === "payroll-preview");
    const net = payroll && payroll.outputs ? payroll.outputs.net : null;
    return [
      "Internal payroll preview: calculate Armenian payroll deductions using the effective-dated payroll configuration for the selected date.",
      net !== null ? `The preview net salary is ${net} AMD.` : "No payroll run was posted by this response.",
      "Posting payroll still requires finance/operator review and an open period."
    ].join(" ");
  }
  if (intent === "personal-data") {
    const deleteMode = context.requestType === "delete";
    return [
      "Internal personal-data guidance: use the cited Armenian personal-data source and route the final action through owner/legal review.",
      deleteMode ? "For deletion requests, prepare a retention assessment first; do not delete accounting, contract, or statutory-retention records automatically." : "For export requests, prepare an auditable export request and packet after legal-source review.",
      sourceActive ? "The personal-data source is active for workflow preparation." : "The personal-data source is not active yet, so request preparation stays disabled until lawyer review.",
      `Cited source(s): ${citationNames}.`
    ].join(" ");
  }
  if (intent === "esign") {
    const doc = context.document || {};
    return [
      "Internal e-signature guidance: use the cited Armenian electronic document/signature source and inspect the local consent chain before relying on the document externally.",
      doc.id ? `Document ${doc.id} is currently ${doc.status || "unknown"} with ${(doc.signers || []).length} signer(s).` : "No document was selected.",
      "This response does not sign, seal, void, or send any document.",
      `Cited source(s): ${citationNames}.`
    ].join(" ");
  }
  return [
    "Internal month-close guidance: review the open period, trial balance, VAT preview, and period locks before closing.",
    "This response does not close the period or post accounting entries."
  ].join(" ");
}

function buildProposedActions({ intent, context, sourceActive }) {
  if (intent === "vat") {
    return [{
      key: "finance.src.prepare",
      label: "Prepare SRC export packet after VAT source review",
      method: "POST",
      path: "/api/finance/src-exports",
      payload: { periodKey: context.periodKey || "", note: "Prepared from copilot VAT guidance" },
      requiresApproval: true,
      mutates: true,
      disabledReason: sourceActive ? "" : "VAT legal source is not active yet"
    }];
  }
  if (intent === "payroll") {
    return [{
      key: "payroll.run.prepare",
      label: "Run payroll after finance review",
      method: "POST",
      path: "/api/payroll/run",
      payload: { employeeId: context.employee?.id || "", gross: context.gross || 0, runDate: context.asOf || "" },
      requiresApproval: true,
      mutates: true,
      disabledReason: ""
    }];
  }
  if (intent === "personal-data") {
    return [{
      key: "privacy.request.prepare",
      label: context.requestType === "delete" ? "Prepare deletion retention assessment request" : "Prepare data export request",
      method: "POST",
      path: "/api/privacy/requests",
      payload: {
        customerId: context.customer?.id || "",
        requestType: context.requestType || "export",
        requesterEmail: context.customer?.email || "",
        channel: "Copilot",
        note: "Prepared from copilot personal-data guidance"
      },
      requiresApproval: true,
      mutates: true,
      disabledReason: sourceActive ? "" : "Personal-data legal source is not active yet"
    }];
  }
  if (intent === "esign") {
    const docId = context.document?.id || "";
    return [{
      key: "docs.export.open",
      label: "Open printable document evidence certificate",
      method: "GET",
      path: docId ? `/api/docs/documents/${encodeURIComponent(docId)}/export` : "",
      payload: {},
      requiresApproval: false,
      mutates: false,
      disabledReason: docId ? "" : "Select a document first"
    }];
  }
  return [{
    key: "finance.period.close.prepare",
    label: "Review period close",
    method: "POST",
    path: context.periodKey ? `/api/finance/periods/${encodeURIComponent(context.periodKey)}/close` : "",
    payload: { reason: "Prepared from copilot month-close guidance" },
    requiresApproval: true,
    mutates: true,
    disabledReason: "Close only after accountant review"
  }];
}

function buildGuardrails(intent) {
  const common = [
    "Copilot responses are advisory drafts and do not execute business mutations.",
    "Human review is required before external legal, tax, accounting, or customer-facing use."
  ];
  if (intent === "vat") return [...common, "No SRC submission is performed by this response."];
  if (intent === "personal-data") return [...common, "Deletion is not executed automatically."];
  if (intent === "esign") return [...common, "No document signature, seal, send, or void action is performed."];
  if (intent === "payroll") return [...common, "No payroll run is posted by this response."];
  return [...common, "No finance period is closed by this response."];
}

module.exports = {
  INTENTS,
  normalizeIntent,
  requiredAppForIntent,
  buildCopilotPacket
};
