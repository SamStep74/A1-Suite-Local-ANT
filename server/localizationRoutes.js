// RA localization API routes — exposes the localization/fiscal engines over HTTP.
//
// Every handler is STATELESS (it calls a pure engine and touches no tenant data),
// but still requires an authenticated session (app.auth) per the suite's access
// policy. Registered from buildApp via registerLocalizationRoutes(app), kept in its
// own module to minimize the footprint inside the large app.js.
//
// Payroll stays lazily required so this module remains isolated from app boot.

const localization = require("./localization");
const regions = require("./armeniaRegions");
const phone = require("./armeniaPhone");
const coa = require("./armeniaChartOfAccounts");
const vatReturn = require("./vatReturn");
const einvoice = require("./einvoice");

const MAX_QUERY_TEXT_LENGTH = 160;
const MAX_JSON_STRING_LENGTH = 1000;
const MAX_JSON_ARRAY_LENGTH = 100;
const MAX_JSON_KEYS = 80;
const MAX_JSON_DEPTH = 8;
const MAX_PAYROLL_GROSS = 1000000000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function invalidLocalizationMetadata(message = "Localization request requires safe metadata") {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "INVALID_LOCALIZATION_METADATA";
  return error;
}

function normalizeOptionalQueryText(query, key) {
  const value = query && query[key];
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw invalidLocalizationMetadata();
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_QUERY_TEXT_LENGTH || hasControlCharacters(trimmed)) {
    throw invalidLocalizationMetadata();
  }
  return trimmed;
}

function assertSafeJson(value, depth = 0) {
  if (depth > MAX_JSON_DEPTH) throw invalidLocalizationMetadata();
  if (value == null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw invalidLocalizationMetadata();
    return;
  }
  if (typeof value === "string") {
    if (value.length > MAX_JSON_STRING_LENGTH || hasControlCharacters(value)) throw invalidLocalizationMetadata();
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ARRAY_LENGTH) throw invalidLocalizationMetadata();
    for (const item of value) assertSafeJson(item, depth + 1);
    return;
  }
  if (!isPlainObject(value)) throw invalidLocalizationMetadata();
  const entries = Object.entries(value);
  if (entries.length > MAX_JSON_KEYS) throw invalidLocalizationMetadata();
  for (const [key, child] of entries) {
    if (typeof key !== "string" || key.length > MAX_QUERY_TEXT_LENGTH || hasControlCharacters(key)) {
      throw invalidLocalizationMetadata();
    }
    assertSafeJson(child, depth + 1);
  }
}

function normalizeBodyObject(body) {
  const value = body === undefined || body === null ? {} : body;
  if (!isPlainObject(value)) throw invalidLocalizationMetadata();
  assertSafeJson(value);
  return value;
}

function normalizePayrollGross(body) {
  const value = normalizeBodyObject(body).gross;
  const gross = typeof value === "number" ? value : (typeof value === "string" && value.trim() ? Number(value) : NaN);
  if (!Number.isFinite(gross) || gross < 0 || gross > MAX_PAYROLL_GROSS) {
    throw invalidLocalizationMetadata("Payroll gross must be a safe non-negative AMD amount");
  }
  return gross;
}

function normalizePlainObjectArray(body, key) {
  const value = body[key];
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_JSON_ARRAY_LENGTH) {
    throw invalidLocalizationMetadata();
  }
  for (const item of value) {
    if (!isPlainObject(item)) throw invalidLocalizationMetadata();
  }
  return value;
}

function normalizeOptionalPlainObject(body, key) {
  const value = body[key];
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw invalidLocalizationMetadata();
  return value;
}

function normalizeVatReturnPeriod(body) {
  const period = normalizeBodyObject(body);
  return {
    ...period,
    sales: normalizePlainObjectArray(period, "sales"),
    purchases: normalizePlainObjectArray(period, "purchases")
  };
}

function normalizeEInvoiceBody(body) {
  const invoice = normalizeBodyObject(body);
  return {
    ...invoice,
    supplier: normalizeOptionalPlainObject(invoice, "supplier"),
    buyer: normalizeOptionalPlainObject(invoice, "buyer"),
    lines: normalizePlainObjectArray(invoice, "lines")
  };
}

function registerLocalizationRoutes(app) {
  // Full RA chart of accounts, or a single code via ?code=
  app.get("/api/localization/chart-of-accounts", async (request) => {
    await app.auth(request);
    const code = normalizeOptionalQueryText(request.query, "code");
    if (code) {
      const account = coa.accountByCode(code);
      return account
        ? { ...account, normalBalance: coa.normalBalance(code) }
        : { error: "unknown account code" };
    }
    return { classes: coa.ACCOUNT_CLASSES, accounts: coa.STANDARD_ACCOUNTS };
  });

  app.get("/api/localization/hvhh", async (request) => {
    await app.auth(request);
    return localization.validateHvhh(normalizeOptionalQueryText(request.query, "value"));
  });

  app.get("/api/localization/regions", async (request) => {
    await app.auth(request);
    return { regions: regions.REGIONS };
  });

  app.get("/api/localization/phone", async (request) => {
    await app.auth(request);
    const value = normalizeOptionalQueryText(request.query, "value");
    return {
      valid: phone.isValidArmenianPhone(value),
      e164: phone.e164(value),
      formatted: phone.formatPhone(value),
    };
  });

  app.post("/api/finance/vat-return/compute", async (request) => {
    await app.auth(request);
    const period = normalizeVatReturnPeriod(request.body);
    const form = vatReturn.vatReturnForm(period);
    return {
      summary: vatReturn.computeVatReturn(period),
      form: form.lines,
      formSource: form.source,
      formLineDefinitions: form.lineDefinitions,
    };
  });

  app.post("/api/finance/payroll/compute", async (request) => {
    await app.auth(request);
    let payroll;
    try {
      payroll = require("./armeniaPayroll");
    } catch {
      return { error: "payroll engine unavailable" };
    }
    return payroll.computePayroll(normalizePayrollGross(request.body));
  });

  app.post("/api/finance/einvoice/build", async (request, reply) => {
    await app.auth(request);
    if (reply && typeof reply.header === "function") {
      reply.header("content-type", "application/xml; charset=utf-8");
    }
    return einvoice.buildEInvoiceXml(normalizeEInvoiceBody(request.body));
  });
}

module.exports = { registerLocalizationRoutes };
