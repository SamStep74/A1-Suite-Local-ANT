// RA localization API routes — exposes the localization/fiscal engines over HTTP.
//
// Every handler is STATELESS (it calls a pure engine and touches no tenant data),
// but still requires an authenticated session (app.auth) per the suite's access
// policy. Registered from buildApp via registerLocalizationRoutes(app), kept in its
// own module to minimize the footprint inside the large app.js.
//
// Engines that may not yet be on main (e.g. armeniaPayroll, PR #34) are required
// lazily inside the handler so the rest of the routes work regardless.

const localization = require("./localization");
const regions = require("./armeniaRegions");
const phone = require("./armeniaPhone");
const coa = require("./armeniaChartOfAccounts");
const vatReturn = require("./vatReturn");
const einvoice = require("./einvoice");

function registerLocalizationRoutes(app) {
  // Full RA chart of accounts, or a single code via ?code=
  app.get("/api/localization/chart-of-accounts", async (request) => {
    await app.auth(request);
    const code = request.query && request.query.code;
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
    return localization.validateHvhh(request.query && request.query.value);
  });

  app.get("/api/localization/regions", async (request) => {
    await app.auth(request);
    return { regions: regions.REGIONS };
  });

  app.get("/api/localization/phone", async (request) => {
    await app.auth(request);
    const value = request.query && request.query.value;
    return {
      valid: phone.isValidArmenianPhone(value),
      e164: phone.e164(value),
      formatted: phone.formatPhone(value),
    };
  });

  app.post("/api/finance/vat-return/compute", async (request) => {
    await app.auth(request);
    const period = request.body || {};
    return { summary: vatReturn.computeVatReturn(period), form: vatReturn.vatReturnForm(period).lines };
  });

  app.post("/api/finance/payroll/compute", async (request) => {
    await app.auth(request);
    let payroll;
    try {
      payroll = require("./armeniaPayroll");
    } catch {
      return { error: "payroll engine pending merge" };
    }
    return payroll.computePayroll(Number(request.body && request.body.gross));
  });

  app.post("/api/finance/einvoice/build", async (request, reply) => {
    await app.auth(request);
    if (reply && typeof reply.header === "function") {
      reply.header("content-type", "application/xml; charset=utf-8");
    }
    return einvoice.buildEInvoiceXml(request.body || {});
  });
}

module.exports = { registerLocalizationRoutes };
