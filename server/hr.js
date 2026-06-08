"use strict";

function contractVariables(input) {
  return {
    EMPLOYEE_NAME: String(input.employeeName || "[Անուն Ազգանուն]"),
    POSITION: String(input.position || "[Պաշտոն]"),
    START_DATE: String(input.startDate || ""),
    END_DATE: input.endDate ? String(input.endDate) : "անորոշ ժամկետով",
    GROSS_SALARY: Number(input.grossSalary || 0).toLocaleString("hy-AM"),
    ORG_NAME: String(input.orgName || "[Կազմակերպություն]"),
    SIGNED_AT: input.signedAt ? String(input.signedAt) : new Date().toISOString().slice(0, 10)
  };
}

function renderContract({ template, input }) {
  const vars = contractVariables(input);
  let body = String(template || "");
  for (const [key, value] of Object.entries(vars)) {
    body = body.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), value);
  }
  if (body.includes("{{") || body.includes("}}")) {
    const err = new Error("Contract template has unfilled placeholders");
    err.statusCode = 422;
    throw err;
  }
  return body;
}

function computeLeaveBalance({ entitled = 20, carriedOver = 0, approved = [] }) {
  const used = approved.reduce((sum, item) => sum + Number(item.days || 0), 0);
  return {
    entitled: Number(entitled),
    carriedOver: Number(carriedOver),
    used,
    remaining: Math.max(0, Number(entitled) + Number(carriedOver) - used)
  };
}

function computeTripAllowance({ perDiemAmd, days, transportationAmd = 0 }) {
  const perDiem = Math.max(0, Math.round(Number(perDiemAmd) || 0));
  const transport = Math.max(0, Math.round(Number(transportationAmd) || 0));
  const tripDays = Math.max(0, Number(days) || 0);
  return { perDiem, days: tripDays, transportation: transport, total: perDiem * tripDays + transport };
}

function aggregateTimesheet({ entries = [] }) {
  const byProject = {};
  let totalHours = 0;
  for (const entry of entries) {
    const hours = Number(entry.hours) || 0;
    totalHours += hours;
    if (entry.projectId) byProject[entry.projectId] = (byProject[entry.projectId] || 0) + hours;
  }
  return { totalHours, byProject, entryCount: entries.length };
}

function scoreKpi({ targets = [], actuals = [] }) {
  const totalWeight = targets.reduce((sum, t) => sum + Number(t.weight || 0), 0) || 1;
  let weighted = 0;
  const breakdown = targets.map(target => {
    const actual = actuals.find(a => a.metric === target.metric);
    const ratio = actual ? Number(actual.actual) / Number(target.target) : 0;
    const metricScore = Math.min(100, Math.max(0, ratio * 100));
    const weightedPart = metricScore * (Number(target.weight) / totalWeight);
    weighted += weightedPart;
    return { metric: target.metric, target: target.target, actual: actual ? actual.actual : null, metricScore, weight: target.weight };
  });
  return { weighted: Math.round(weighted * 100) / 100, breakdown };
}

function computeTurnover({ startHeadcount, endHeadcount, leavers }) {
  const average = (Number(startHeadcount) + Number(endHeadcount)) / 2 || 1;
  const rate = Number(leavers) / average;
  return { rate: Math.round(rate * 1000) / 1000, leavers, averageHeadcount: average };
}

const JD_BODY_ARMENIAN = [
  "Պաշտոն՝ {{POSITION}}",
  "Բաժին՝ {{ORG_NAME}}",
  "",
  "Հիմնական պարտականություններ՝",
  "- Կազմակերպության ռազմավարական նպատակներին հասնելու համար պատասխանատվություն ստանձնել",
  "- Թիմի հետ համագործակցություն եւ արդյունքների պարբերական վերանայում",
  "- Որակի չափանիշների պահպանում եւ բարելավում",
  "",
  "Պահանջներ՝",
  "- Համապատասխան մասնագիտական փորձ եւ կրթություն",
  "- Հայերեն լեզվի իմացություն, անգլերեն ցանկալի է",
  "",
  "{{LEGAL_CITATION}}"
].join("\n");

function generateJobDescription({ position, language = "hy-AM", legalSources = [] } = {}) {
  const code = String(language) === "ru-RU" ? "ru" : "hy-AM";
  const activeLegal = (Array.isArray(legalSources) ? legalSources : []).filter(s => s && s.status === "active");
  const legalLine = activeLegal.length
    ? `Իրավական հղումներ՝ ${activeLegal.map(s => s.title).join("; ")}:`
    : "Իրավական հղումները կընտրվեն հաշվի առնելով մասնագիտական վերանայված հայկական աղբյուրների ցանկը:";
  const body = JD_BODY_ARMENIAN
    .replace("{{POSITION}}", String(position || "[Պաշտոն]"))
    .replace("{{LEGAL_CITATION}}", legalLine);
  return { language: code, body, citations: activeLegal.map(s => ({ id: s.id, title: s.title })), advisoryOnly: true };
}

const ORDER_DRAFT_ARMENIAN = [
  "ՀՐԱՄԱՆ N {{ORDER_NUMBER}}",
  "Երևան, {{EFFECTIVE_DATE}}",
  "",
  "Ղեկավար՝ {{ISSUER_NAME}}",
  "",
  "Հրամայում եմ՝",
  "1. {{EMPLOYEE_NAME}}-ին տրամադրել {{ORDER_TYPE_ARM}}՝ {{EFFECTIVE_DATE}}-ից:",
  "2. Հաշվապահական բաժնին իրականացնել համապատասխան հաշվարկները:",
  "",
  "Հրամանը ուժի մեջ է մտնում ստորագրման պահից:"
].join("\n");

const ORDER_TYPE_ARMENIAN = {
  vacation: "արձակուրդ",
  "business-trip": "գործուղում",
  transfer: "փոխանցում",
  "schedule-change": "ժամերի փոփոխություն",
  disciplinary: "արդյունավետության խրախուսում/տույժ",
  bonus: "պարգևավճար",
  dismissal: "ազատում",
  hiring: "ընդունում"
};

function draftOrder({ orderType, employeeName, issuerName, effectiveDate, orderNumber }) {
  const armenianType = ORDER_TYPE_ARMENIAN[orderType] || orderType;
  return ORDER_DRAFT_ARMENIAN
    .replace("{{ORDER_NUMBER}}", String(orderNumber || "—"))
    .replace("{{EFFECTIVE_DATE}}", String(effectiveDate || ""))
    .replace("{{ISSUER_NAME}}", String(issuerName || "[Ղեկավար]"))
    .replace("{{EMPLOYEE_NAME}}", String(employeeName || "[Աշխատակից]"))
    .replace("{{ORDER_TYPE_ARM}}", armenianType);
}

function buildLeaveRequest({ employeeId, kind, startDate, endDate, reason }) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    const err = new Error("Invalid leave range");
    err.statusCode = 400;
    throw err;
  }
  const ms = end.getTime() - start.getTime();
  const days = Math.round((ms / 86400000 + 1) * 100) / 100;
  return { employeeId, kind, startDate, endDate, days, reason: reason || "", status: "pending", approverId: null };
}

function buildEquipmentAssignment({ employeeId, assetId, signatureDocId }) {
  return {
    employeeId,
    assetId,
    assignedAt: new Date().toISOString(),
    returnedAt: null,
    signatureDocId: signatureDocId || null
  };
}

module.exports = {
  renderContract,
  computeLeaveBalance,
  computeTripAllowance,
  aggregateTimesheet,
  scoreKpi,
  computeTurnover,
  generateJobDescription,
  draftOrder,
  buildLeaveRequest,
  buildEquipmentAssignment,
  ORDER_TYPE_ARMENIAN
};
