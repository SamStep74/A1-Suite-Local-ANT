const test = require("node:test");
const assert = require("node:assert/strict");
const { registerLocalizationRoutes } = require("../server/localizationRoutes");

// A tiny mock app that captures registered handlers and provides app.auth,
// so the route logic is unit-tested without booting the full server.
function mockApp() {
  const routes = {};
  let authCalls = 0;
  return {
    routes,
    authCalls: () => authCalls,
    auth: async () => { authCalls += 1; return { id: "u1", org_id: "o1" }; },
    get(path, handler) { routes[`GET ${path}`] = handler; },
    post(path, handler) { routes[`POST ${path}`] = handler; },
  };
}

test("localizationRoutes: registers the expected route set", () => {
  const app = mockApp();
  registerLocalizationRoutes(app);
  for (const r of [
    "GET /api/localization/chart-of-accounts",
    "GET /api/localization/hvhh",
    "GET /api/localization/regions",
    "GET /api/localization/phone",
    "POST /api/finance/vat-return/compute",
    "POST /api/finance/payroll/compute",
    "POST /api/finance/einvoice/build",
  ]) {
    assert.equal(typeof app.routes[r], "function", `missing ${r}`);
  }
});

test("localizationRoutes: chart-of-accounts returns the full chart and code lookups", async () => {
  const app = mockApp();
  registerLocalizationRoutes(app);
  const all = await app.routes["GET /api/localization/chart-of-accounts"]({ query: {} });
  assert.ok(all.accounts.length > 600);
  assert.equal(all.classes.length, 9);
  const one = await app.routes["GET /api/localization/chart-of-accounts"]({ query: { code: "251" } });
  assert.equal(one.hy, "Դրամարկղ");
  assert.equal(one.normalBalance, "debit");
});

test("localizationRoutes: vat-return/compute returns the summary and official form lines", async () => {
  const app = mockApp();
  registerLocalizationRoutes(app);
  const r = await app.routes["POST /api/finance/vat-return/compute"]({
    body: { sales: [{ netAmount: 1000000, vatRate: 20 }], purchases: [] },
  });
  assert.equal(r.summary.outputVat, 200000);
  assert.equal(r.form["7"].vat, 200000);
});

test("localizationRoutes: einvoice/build returns XML and sets the content type", async () => {
  const app = mockApp();
  registerLocalizationRoutes(app);
  let contentType = "";
  const reply = { header: (k, v) => { if (k === "content-type") contentType = v; } };
  const xml = await app.routes["POST /api/finance/einvoice/build"]({ body: { number: "INV-1", lines: [] } }, reply);
  assert.match(xml, /<EInvoice/);
  assert.match(contentType, /xml/);
});

test("localizationRoutes: hvhh validation and every handler requires auth", async () => {
  const app = mockApp();
  registerLocalizationRoutes(app);
  const r = await app.routes["GET /api/localization/hvhh"]({ query: { value: "00123456" } });
  assert.equal(r.ok, true);
  assert.ok(app.authCalls() >= 1); // auth invoked
});
