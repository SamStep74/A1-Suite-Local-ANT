"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

async function withLocale(value, fn) {
  const prev = process.env.A1_LOCALE;
  if (value === undefined) delete process.env.A1_LOCALE;
  else process.env.A1_LOCALE = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.A1_LOCALE;
    else process.env.A1_LOCALE = prev;
  }
}

async function createBillableProject(app, cookie) {
  // A project linked to a customer, with 3 hours (180 min) of logged time.
  const proj = (await app.inject({ method: "POST", url: "/api/projects", headers: { cookie },
    payload: { name: "Billable delivery", customerId: "cust-ani", status: "active" } })).json().project.id;
  await app.inject({ method: "POST", url: `/api/projects/${proj}/time-entries`, headers: { cookie }, payload: { minutes: 120, entryDate: "2099-03-05", note: "build" } });
  await app.inject({ method: "POST", url: `/api/projects/${proj}/time-entries`, headers: { cookie }, payload: { minutes: 60, entryDate: "2099-03-06", note: "review" } });
  return proj;
}

async function createProjectTask(app, cookie, projectId, payload) {
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/tasks`,
    headers: { cookie },
    payload
  });
  assert.strictEqual(response.statusCode, 200, response.body);
  return response.json().project.tasks.find(task => task.title === payload.title);
}

test("project-billing: unbilled time → posted invoice → ledger; entries marked billed; idempotent", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const proj = await createBillableProject(app, owner);

    // Preview: 180 min @ 10000 AMD/hr = 30000 gross; VAT-inclusive split 25000 + 5000.
    const preview = (await app.inject({ method: "GET", url: `/api/projects/${proj}/billing-preview?hourlyRate=10000`, headers: { cookie: owner } })).json();
    assert.strictEqual(preview.preview.unbilledMinutes, 180);
    assert.strictEqual(preview.preview.total, 30000);
    assert.strictEqual(preview.preview.subtotal, 25000);
    assert.strictEqual(preview.preview.vat, 5000);

    const defaultPreview = (await app.inject({ method: "GET", url: `/api/projects/${proj}/billing-preview`, headers: { cookie: owner } })).json();
    assert.strictEqual(defaultPreview.preview.unbilledMinutes, 180);
    assert.strictEqual(defaultPreview.preview.hourlyRate, 0);
    assert.strictEqual(defaultPreview.preview.total, 0);

    // Bill it (use a non-seeded open period via issueDate 2099-03).
    const billed = await app.inject({ method: "POST", url: `/api/projects/${proj}/bill-time`, headers: { cookie: owner },
      payload: { hourlyRate: 10000, issueDate: "2026-05-15" } });
    assert.strictEqual(billed.statusCode, 200);
    assert.strictEqual(billed.json().idempotent, false);
    assert.strictEqual(billed.json().billedMinutes, 180);
    const invoiceId = billed.json().invoice.id;
    assert.strictEqual(billed.json().invoice.total, 30000);
    assert.strictEqual(billed.json().invoice.vat, 5000);

    // The ledger reconciles: 221 receivable = +30000 (25000 revenue + 5000 VAT), balanced.
    const tb = (await app.inject({ method: "GET", url: "/api/finance/trial-balance", headers: { cookie: owner } })).json();
    const byCode = {};
    for (const r of (tb.rows || tb.accounts || [])) byCode[String(r.code)] = (r.debit || 0) - (r.credit || 0);
    assert.strictEqual(byCode["221"], 30000, "receivable debit 30000");
    assert.strictEqual(byCode["611"], -25000, "revenue credit 25000");
    assert.strictEqual(byCode["524"], -5000, "output VAT credit 5000");

    // Re-billing the SAME project/period is idempotent — no second invoice, no double-bill.
    const again = await app.inject({ method: "POST", url: `/api/projects/${proj}/bill-time`, headers: { cookie: owner },
      payload: { hourlyRate: 10000, issueDate: "2026-05-15" } });
    assert.strictEqual(again.statusCode, 200);
    assert.strictEqual(again.json().idempotent, true);

    // After billing, there is no more unbilled time.
    const preview2 = (await app.inject({ method: "GET", url: `/api/projects/${proj}/billing-preview?hourlyRate=10000`, headers: { cookie: owner } })).json();
    assert.strictEqual(preview2.preview.unbilledMinutes, 0, "all time now billed");

    // A fresh time entry becomes newly billable (next period).
    await app.inject({ method: "POST", url: `/api/projects/${proj}/time-entries`, headers: { cookie: owner }, payload: { minutes: 30, entryDate: "2099-04-02" } });
    const preview3 = (await app.inject({ method: "GET", url: `/api/projects/${proj}/billing-preview?hourlyRate=10000`, headers: { cookie: owner } })).json();
    assert.strictEqual(preview3.preview.unbilledMinutes, 30, "new entry is unbilled");
  } finally { await app.close(); }
});

test("project-billing: project profitability reports billed and unbilled revenue evidence", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const proj = await createBillableProject(app, owner);

    const initial = await app.inject({
      method: "GET",
      url: `/api/projects/${proj}/profitability?hourlyRate=10000&asOf=2026-05-15`,
      headers: { cookie: owner }
    });
    assert.strictEqual(initial.statusCode, 200, initial.body);
    assert.deepStrictEqual(Object.keys(initial.json()), ["profitability"]);
    assert.deepStrictEqual(Object.keys(initial.json().profitability), [
      "projectId", "customerId", "currency",
      "hourlyRate", "costRate",
      "billedMinutes", "billedEntries",
      "unbilledMinutes", "unbilledEntries",
      "totalMinutes", "totalEntries",
      "billedRevenue", "unbilledRevenue", "totalRevenue",
      "laborCostTotal", "productCostTotal",
      "fieldVisitCostTotal",
      "costTotal", "grossProfit", "grossMarginPct",
      "taskProfitability", "productCostEvidence",
      "fieldVisitCount", "fieldVisitCostEvidence",
      "invoiceCount",
      "invoices"
    ]);
    assert.deepStrictEqual(initial.json().profitability, {
      projectId: proj,
      customerId: "cust-ani",
      currency: "AMD",
      hourlyRate: 10000,
      costRate: 0,
      billedMinutes: 0,
      billedEntries: 0,
      unbilledMinutes: 180,
      unbilledEntries: 2,
      totalMinutes: 180,
      totalEntries: 2,
      billedRevenue: 0,
      unbilledRevenue: 30000,
      totalRevenue: 30000,
      laborCostTotal: 0,
      productCostTotal: 0,
      fieldVisitCostTotal: 0,
      costTotal: 0,
      grossProfit: 30000,
      grossMarginPct: 100,
      taskProfitability: [{
        taskId: null,
        taskTitle: "Unassigned",
        taskStatus: null,
        billedMinutes: 0,
        unbilledMinutes: 180,
        totalMinutes: 180,
        entries: 2,
        revenue: 30000,
        laborCost: 0,
        grossProfit: 30000,
        grossMarginPct: 100
      }],
      productCostEvidence: [],
      fieldVisitCount: 0,
      fieldVisitCostEvidence: [],
      invoiceCount: 0,
      invoices: []
    });

    const defaultRate = await app.inject({
      method: "GET",
      url: `/api/projects/${proj}/profitability`,
      headers: { cookie: owner }
    });
    assert.strictEqual(defaultRate.statusCode, 200, defaultRate.body);
    assert.strictEqual(defaultRate.json().profitability.hourlyRate, 0);
    assert.strictEqual(defaultRate.json().profitability.costRate, 0);
    assert.strictEqual(defaultRate.json().profitability.unbilledRevenue, 0);
    assert.strictEqual(defaultRate.json().profitability.totalRevenue, 0);
    assert.strictEqual(defaultRate.json().profitability.costTotal, 0);
    assert.strictEqual(defaultRate.json().profitability.grossMarginPct, null);
    assert.strictEqual(defaultRate.json().profitability.taskProfitability[0].revenue, 0);
    assert.strictEqual(defaultRate.json().profitability.taskProfitability[0].grossMarginPct, null);

    const billed = await app.inject({
      method: "POST",
      url: `/api/projects/${proj}/bill-time`,
      headers: { cookie: owner },
      payload: { hourlyRate: 10000, issueDate: "2026-05-15" }
    });
    assert.strictEqual(billed.statusCode, 200, billed.body);
    const invoice = billed.json().invoice;

    const afterBill = await app.inject({
      method: "GET",
      url: `/api/projects/${proj}/profitability?hourlyRate=10000&asOf=2026-05-15`,
      headers: { cookie: owner }
    });
    assert.strictEqual(afterBill.statusCode, 200, afterBill.body);
    assert.deepStrictEqual(afterBill.json().profitability, {
      projectId: proj,
      customerId: "cust-ani",
      currency: "AMD",
      hourlyRate: 10000,
      costRate: 0,
      billedMinutes: 180,
      billedEntries: 2,
      unbilledMinutes: 0,
      unbilledEntries: 0,
      totalMinutes: 180,
      totalEntries: 2,
      billedRevenue: 30000,
      unbilledRevenue: 0,
      totalRevenue: 30000,
      laborCostTotal: 0,
      productCostTotal: 0,
      fieldVisitCostTotal: 0,
      costTotal: 0,
      grossProfit: 30000,
      grossMarginPct: 100,
      taskProfitability: [{
        taskId: null,
        taskTitle: "Unassigned",
        taskStatus: null,
        billedMinutes: 180,
        unbilledMinutes: 0,
        totalMinutes: 180,
        entries: 2,
        revenue: 30000,
        laborCost: 0,
        grossProfit: 30000,
        grossMarginPct: 100
      }],
      productCostEvidence: [],
      fieldVisitCount: 0,
      fieldVisitCostEvidence: [],
      invoiceCount: 1,
      invoices: [{
        id: invoice.id,
        number: invoice.number,
        status: "open",
        total: 30000,
        subtotal: 25000,
        vat: 5000,
        issueDate: "2026-05-15",
        dueDate: "2026-05-29"
      }]
    });

    await app.inject({
      method: "POST",
      url: `/api/projects/${proj}/time-entries`,
      headers: { cookie: owner },
      payload: { minutes: 30, entryDate: "2026-05-20", note: "extra" }
    });
    const mixed = await app.inject({
      method: "GET",
      url: `/api/projects/${proj}/profitability?hourlyRate=10000&asOf=2026-05-20`,
      headers: { cookie: owner }
    });
    assert.strictEqual(mixed.statusCode, 200, mixed.body);
    assert.strictEqual(mixed.json().profitability.billedRevenue, 30000);
    assert.strictEqual(mixed.json().profitability.unbilledMinutes, 30);
    assert.strictEqual(mixed.json().profitability.unbilledRevenue, 5000);
    assert.strictEqual(mixed.json().profitability.totalRevenue, 35000);
    assert.deepStrictEqual(mixed.json().profitability.taskProfitability, [{
      taskId: null,
      taskTitle: "Unassigned",
      taskStatus: null,
      billedMinutes: 180,
      unbilledMinutes: 30,
      totalMinutes: 210,
      entries: 3,
      revenue: 35000,
      laborCost: 0,
      grossProfit: 35000,
      grossMarginPct: 100
    }]);
  } finally { await app.close(); }
});

test("project-billing: profitability rolls up task labor cost and catalog quote product cost", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const orgId = app.db.prepare("SELECT org_id FROM users WHERE email = ?").get(DEFAULT_EMAIL).org_id;
    const projectId = (await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: owner },
      payload: {
        name: "Catalog profitability delivery",
        customerId: "cust-ani",
        dealId: "deal-ani-inbox",
        status: "active"
      }
    })).json().project.id;

    const discovery = await createProjectTask(app, owner, projectId, { title: "Discovery", status: "in-progress" });
    const build = await createProjectTask(app, owner, projectId, { title: "Build", status: "todo" });
    await app.inject({ method: "POST", url: `/api/projects/${projectId}/time-entries`, headers: { cookie: owner }, payload: { taskId: discovery.id, minutes: 90, entryDate: "2026-05-10", note: "discovery" } });
    await app.inject({ method: "POST", url: `/api/projects/${projectId}/time-entries`, headers: { cookie: owner }, payload: { taskId: build.id, minutes: 30, entryDate: "2026-05-11", note: "build" } });
    await app.inject({ method: "POST", url: `/api/projects/${projectId}/time-entries`, headers: { cookie: owner }, payload: { minutes: 60, entryDate: "2026-05-12", note: "unassigned handoff" } });

    const serviceCase = (await app.inject({
      method: "POST",
      url: "/api/service/cases",
      headers: { cookie: owner },
      payload: { customerId: "cust-ani", subject: "Project-linked field visit", priority: "medium", channel: "Email" }
    })).json().case;
    const serviceConsole = (await app.inject({ method: "GET", url: "/api/service/console", headers: { cookie: owner } })).json();
    const assignee = serviceConsole.agents.find(agent => agent.role === "Service Manager") || serviceConsole.agents[0];
    const linkedVisit = await app.inject({
      method: "POST",
      url: "/api/service/field-visits",
      headers: { cookie: owner },
      payload: {
        caseId: serviceCase.id,
        customerId: "cust-ani",
        projectId,
        assignedUserId: assignee.id,
        scheduledStartAt: "2026-05-14T08:00:00.000Z",
        scheduledEndAt: "2026-05-14T09:15:00.000Z",
        status: "scheduled",
        location: "Ani Beauty project site",
        worksheetSummary: "Project-linked field-service evidence."
      }
    });
    assert.strictEqual(linkedVisit.statusCode, 200, linkedVisit.body);

    const quote = await app.inject({
      method: "POST",
      url: "/api/crm/quotes",
      headers: { cookie: owner },
      payload: {
        customerId: "cust-ani",
        dealId: "deal-ani-inbox",
        title: "Scanner evidence quote",
        validUntil: "2026-07-31",
        lines: [{
          catalogItemId: "catitem-pos-barcode-scanner",
          catalogItemVariantId: "catvar-pos-scanner-usb",
          quantity: 2,
          unitPrice: 100000
        }]
      }
    });
    assert.strictEqual(quote.statusCode, 200, quote.body);
    app.db.prepare("UPDATE quotes SET status = ?, sent_at = ?, updated_at = ? WHERE org_id = ? AND id = ?")
      .run("sent", "2026-05-13T10:00:00.000Z", "2026-05-13T10:00:00.000Z", orgId, quote.json().quote.id);

    const draftQuote = await app.inject({
      method: "POST",
      url: "/api/crm/quotes",
      headers: { cookie: owner },
      payload: {
        customerId: "cust-ani",
        dealId: "deal-ani-inbox",
        title: "Draft scanner quote",
        validUntil: "2026-07-31",
        lines: [{ catalogItemId: "catitem-pos-barcode-scanner", quantity: 1, unitPrice: 500000 }]
      }
    });
    assert.strictEqual(draftQuote.statusCode, 200, draftQuote.body);

    const zeroCostRate = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/profitability?hourlyRate=60000&costRate=0&asOf=2026-05-15`,
      headers: { cookie: owner }
    });
    assert.strictEqual(zeroCostRate.statusCode, 200, zeroCostRate.body);
    assert.strictEqual(zeroCostRate.json().profitability.laborCostTotal, 0);
    assert.strictEqual(zeroCostRate.json().profitability.productCostTotal, 124000);
    assert.strictEqual(zeroCostRate.json().profitability.fieldVisitCostTotal, 0);
    assert.strictEqual(zeroCostRate.json().profitability.fieldVisitCount, 1);
    assert.strictEqual(zeroCostRate.json().profitability.costTotal, 124000);
    assert.strictEqual(zeroCostRate.json().profitability.grossProfit, 56000);
    assert.strictEqual(zeroCostRate.json().profitability.grossMarginPct, 31.11);

    const detailed = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/profitability?hourlyRate=60000&costRate=3000&asOf=2026-05-15`,
      headers: { cookie: owner }
    });
    assert.strictEqual(detailed.statusCode, 200, detailed.body);
    assert.deepStrictEqual(detailed.json().profitability.taskProfitability, [
      {
        taskId: discovery.id,
        taskTitle: "Discovery",
        taskStatus: "in-progress",
        billedMinutes: 0,
        unbilledMinutes: 90,
        totalMinutes: 90,
        entries: 1,
        revenue: 90000,
        laborCost: 4500,
        grossProfit: 85500,
        grossMarginPct: 95
      },
      {
        taskId: build.id,
        taskTitle: "Build",
        taskStatus: "todo",
        billedMinutes: 0,
        unbilledMinutes: 30,
        totalMinutes: 30,
        entries: 1,
        revenue: 30000,
        laborCost: 1500,
        grossProfit: 28500,
        grossMarginPct: 95
      },
      {
        taskId: null,
        taskTitle: "Unassigned",
        taskStatus: null,
        billedMinutes: 0,
        unbilledMinutes: 60,
        totalMinutes: 60,
        entries: 1,
        revenue: 60000,
        laborCost: 3000,
        grossProfit: 57000,
        grossMarginPct: 95
      }
    ]);
    assert.deepStrictEqual(detailed.json().profitability.productCostEvidence, [{
      quoteId: quote.json().quote.id,
      quoteNumber: quote.json().quote.number,
      quoteStatus: "sent",
      catalogItemId: "catitem-pos-barcode-scanner",
      catalogSku: "HW-BARCODE-SCANNER",
      catalogName: "POS barcode scanner",
      catalogItemVariantId: "catvar-pos-scanner-usb",
      variantSku: "HW-BARCODE-SCANNER-USB",
      quantity: 2,
      revenue: 200000,
      unitCost: 62000,
      cost: 124000,
      grossProfit: 76000,
      grossMarginPct: 38
    }]);
    assert.strictEqual(detailed.json().profitability.totalRevenue, 180000);
    assert.strictEqual(detailed.json().profitability.laborCostTotal, 9000);
    assert.strictEqual(detailed.json().profitability.productCostTotal, 124000);
    assert.strictEqual(detailed.json().profitability.fieldVisitCostTotal, 3750);
    assert.deepStrictEqual(detailed.json().profitability.fieldVisitCostEvidence, [{
      visitId: linkedVisit.json().visit.id,
      caseId: serviceCase.id,
      caseNumber: serviceCase.caseNumber,
      subject: "Project-linked field visit",
      assignedUserId: assignee.id,
      assignedUserName: assignee.name,
      scheduledStartAt: "2026-05-14T08:00:00.000Z",
      scheduledEndAt: "2026-05-14T09:15:00.000Z",
      scheduledMinutes: 75,
      laborMinutes: 75,
      laborCost: 3750,
      travelCost: 0,
      materialCost: 0,
      totalCost: 3750,
      source: "service_field_visits.scheduled_start_at/service_field_visits.scheduled_end_at/project_profitability.costRate",
      limitations: [
        "travel-rate-not-configured",
        "inventory-consumption-not-linked",
        "not-posted-to-ledger"
      ],
      ledgerMappings: [
        {
          bucket: "labor",
          basis: "project-profitability-cost-rate",
          managementAccount: "8112",
          recognitionAccount: "7113",
          amount: 3750,
          status: "not-posted"
        },
        {
          bucket: "travel",
          basis: "rate-not-configured",
          expenseAccount: "713",
          amount: 0,
          status: "not-posted"
        },
        {
          bucket: "materials",
          basis: "inventory-consumption-not-linked",
          inventoryAccountClass: "2",
          recognitionAccount: "7113",
          amount: 0,
          status: "not-posted"
        }
      ]
    }]);
    assert.strictEqual(detailed.json().profitability.costTotal, 136750);
    assert.strictEqual(detailed.json().profitability.grossProfit, 43250);
    assert.strictEqual(detailed.json().profitability.grossMarginPct, 24.03);
  } finally { await app.close(); }
});

test("project-billing: RU billing stores kopecks while ledger reports rubles", async () => {
  await withLocale("ru", async () => {
    const app = buildApp({ dbPath: ":memory:" });
    try {
      await app.ready();
      const owner = await login(app);
      const orgId = app.db.prepare("SELECT org_id FROM users WHERE email = ?").get(DEFAULT_EMAIL).org_id;
      app.db.prepare("INSERT OR IGNORE INTO tax_rates (id, org_id, kind, effective_date, config, note, created_at) VALUES (?, ?, 'vat', ?, ?, ?, ?)")
        .run(`taxrate-${orgId}-ru-vat-2026`, orgId, "2026-01-01", JSON.stringify({ rate: 0.22 }), "RF 2026 VAT 22%", new Date().toISOString());

      const projectId = (await app.inject({
        method: "POST",
        url: "/api/projects",
        headers: { cookie: owner },
        payload: { name: "RUB billing", customerId: "cust-ani", status: "active" }
      })).json().project.id;
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/time-entries`,
        headers: { cookie: owner },
        payload: { minutes: 60, entryDate: "2026-05-10", note: "RUB hour" }
      });

      const billed = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bill-time`,
        headers: { cookie: owner },
        payload: { hourlyRate: 1000, issueDate: "2026-05-15" }
      });
      assert.strictEqual(billed.statusCode, 200, billed.body);
      assert.strictEqual(billed.json().invoice.total, 100000);
      assert.strictEqual(billed.json().invoice.vat, 18033);

      const tb = (await app.inject({ method: "GET", url: "/api/finance/trial-balance", headers: { cookie: owner } })).json();
      const byCode = Object.fromEntries(tb.rows.map(row => [String(row.code), row]));
      assert.strictEqual(byCode["62"].debit, 1000);
      assert.strictEqual(byCode["90"].credit, 819.67);
      assert.strictEqual(byCode["68"].credit, 180.33);
      assert.strictEqual(tb.balanced, true);
    } finally {
      await app.close();
    }
  });
});

test("project-billing: rejects malformed bill-time metadata before persistence", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const proj = await createBillableProject(app, owner);
    const orgId = app.db.prepare("SELECT org_id FROM users WHERE email = ?").get(DEFAULT_EMAIL).org_id;
    const draftInvoiceCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM finance_draft_invoices
      WHERE org_id = ?
        AND source_key LIKE ?
    `).get(orgId, `project-time:${proj}:%`).count;
    const invoiceCount = () => app.db.prepare("SELECT COUNT(*) AS count FROM invoices WHERE org_id = ?").get(orgId).count;
    const ledgerCount = () => app.db.prepare("SELECT COUNT(*) AS count FROM ledger_journal WHERE org_id = ?").get(orgId).count;
    const billedEntryCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM project_time_entries
      WHERE org_id = ?
        AND project_id = ?
        AND billed_invoice_id IS NOT NULL
    `).get(orgId, proj).count;
    const billedAuditCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM audit_events
      WHERE org_id = ?
        AND type = ?
    `).get(orgId, "projects.time.billed").count;

    const snapshot = {
      draftInvoices: draftInvoiceCount(),
      invoices: invoiceCount(),
      ledger: ledgerCount(),
      billedEntries: billedEntryCount(),
      auditEvents: billedAuditCount()
    };
    const malformedRequests = [
      ["secret-project-billing-array-body-token"],
      {
        hourlyRate: [10000],
        issueDate: "2026-05-15",
        token: "secret-project-billing-array-rate-token"
      },
      {
        hourlyRate: { value: 10000, token: "secret-project-billing-object-rate-token" },
        issueDate: "2026-05-15"
      },
      {
        hourlyRate: "10000\nsecret-project-billing-control-rate-token",
        issueDate: "2026-05-15"
      },
      {
        hourlyRate: 10000,
        issueDate: { date: "2026-05-15", token: "secret-project-billing-object-date-token" }
      },
      {
        hourlyRate: 10000,
        issueDate: "2026-02-31",
        token: "secret-project-billing-invalid-date-token"
      },
      {
        hourlyRate: 10000,
        issueDate: "2026-05-15",
        periodKey: ["2026-05"],
        token: "secret-project-billing-array-period-token"
      },
      {
        hourlyRate: 10000,
        issueDate: "2026-05-15",
        periodKey: "2026-13",
        token: "secret-project-billing-invalid-period-token"
      },
      {
        hourlyRate: 10000,
        issueDate: "2026-05-15",
        dueDays: { days: 14, token: "secret-project-billing-object-due-token" }
      },
      {
        hourlyRate: 10000,
        issueDate: "2026-05-15",
        dueDays: [14],
        token: "secret-project-billing-array-due-token"
      },
      {
        hourlyRate: 10000,
        issueDate: "2026-05-15",
        dueDays: "14\nsecret-project-billing-control-due-token"
      }
    ];

    for (const payload of malformedRequests) {
      const rejected = await app.inject({
        method: "POST",
        url: `/api/projects/${proj}/bill-time`,
        headers: { cookie: owner },
        payload
      });
      assert.strictEqual(rejected.statusCode, 400, rejected.body);
      assert.ok(!rejected.body.includes("secret-project-billing"), "rejected payload secret is not reflected");
      assert.deepStrictEqual({
        draftInvoices: draftInvoiceCount(),
        invoices: invoiceCount(),
        ledger: ledgerCount(),
        billedEntries: billedEntryCount(),
        auditEvents: billedAuditCount()
      }, snapshot, "malformed bill-time payload did not mutate billing state");
    }

    const billed = await app.inject({
      method: "POST",
      url: `/api/projects/${proj}/bill-time`,
      headers: { cookie: owner },
      payload: { hourlyRate: 10000, issueDate: "2026-05-15", periodKey: "2026-05", dueDays: 14 }
    });
    assert.strictEqual(billed.statusCode, 200, billed.body);
    assert.strictEqual(billed.json().idempotent, false);
    assert.strictEqual(billed.json().billedMinutes, 180);
    assert.strictEqual(draftInvoiceCount(), snapshot.draftInvoices + 1);
    assert.strictEqual(billedEntryCount(), 2);
    assert.strictEqual(billedAuditCount(), snapshot.auditEvents + 1);
  } finally { await app.close(); }
});

test("project-billing: rejects malformed billing-preview query before quoting", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const proj = await createBillableProject(app, owner);
    const rejectedUrls = [
      `/api/projects/${proj}/billing-preview?hourlyRate=abc`,
      `/api/projects/${proj}/billing-preview?hourlyRate=-1`,
      `/api/projects/${proj}/billing-preview?hourlyRate=10000&asOf=not-a-date`
    ];

    for (const url of rejectedUrls) {
      const rejected = await app.inject({
        method: "GET",
        url,
        headers: { cookie: owner }
      });
      assert.strictEqual(rejected.statusCode, 400, rejected.body);
    }
  } finally { await app.close(); }
});

test("project-billing: rejects malformed profitability query before reporting", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const proj = await createBillableProject(app, owner);
    const rejectedUrls = [
      `/api/projects/${proj}/profitability?hourlyRate=abc`,
      `/api/projects/${proj}/profitability?hourlyRate=-1`,
      `/api/projects/${proj}/profitability?hourlyRate=10000&costRate=abc`,
      `/api/projects/${proj}/profitability?hourlyRate=10000&costRate=-1`,
      `/api/projects/${proj}/profitability?hourlyRate=10000&costRate=1000%0Asecret-project-profitability-cost-token`,
      `/api/projects/${proj}/profitability?hourlyRate=10000&asOf=not-a-date`,
      `/api/projects/${proj}/profitability?hourlyRate=10000%0Asecret-project-profitability-query-token`
    ];

    for (const url of rejectedUrls) {
      const rejected = await app.inject({
        method: "GET",
        url,
        headers: { cookie: owner }
      });
      assert.strictEqual(rejected.statusCode, 400, rejected.body);
      assert.doesNotMatch(rejected.body, /secret-project-profitability/);
      assert.doesNotMatch(rejected.body, /secret-project-profitability-cost/);
    }
  } finally { await app.close(); }
});

test("project-billing: malformed project path ids are rejected before billing side effects", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const proj = await createBillableProject(app, owner);
    const orgId = app.db.prepare("SELECT org_id FROM users WHERE email = ?").get(DEFAULT_EMAIL).org_id;
    const draftInvoiceCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM finance_draft_invoices
      WHERE org_id = ?
        AND source_key LIKE ?
    `).get(orgId, "project-time:%").count;
    const invoiceCount = () => app.db.prepare("SELECT COUNT(*) AS count FROM invoices WHERE org_id = ?").get(orgId).count;
    const ledgerCount = () => app.db.prepare("SELECT COUNT(*) AS count FROM ledger_journal WHERE org_id = ?").get(orgId).count;
    const billedEntryCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM project_time_entries
      WHERE org_id = ?
        AND project_id = ?
        AND billed_invoice_id IS NOT NULL
    `).get(orgId, proj).count;
    const billedAuditCount = () => app.db.prepare(`
      SELECT COUNT(*) AS count
      FROM audit_events
      WHERE org_id = ?
        AND type = ?
    `).get(orgId, "projects.time.billed").count;
    const current = () => ({
      draftInvoices: draftInvoiceCount(),
      invoices: invoiceCount(),
      ledger: ledgerCount(),
      billedEntries: billedEntryCount(),
      auditEvents: billedAuditCount()
    });
    const before = current();

    const expectPathRejected = async ({ method, url, payload, statusCode = 400, message = /Invalid project id/ }) => {
      const request = { method, url, headers: { cookie: owner } };
      if (payload !== undefined) request.payload = payload;
      const response = await app.inject(request);
      assert.strictEqual(response.statusCode, statusCode, `${url}: ${response.body}`);
      if (statusCode === 400) assert.match(response.body, message);
      assert.doesNotMatch(response.body, /secret-project-billing-path-/);
      assert.deepStrictEqual(current(), before);
    };

    for (const request of [
      { method: "GET", url: "/api/projects/badAsecret-project-billing-path-preview-id-token/billing-preview?hourlyRate=10000" },
      { method: "GET", url: "/api/projects/bad_secret-project-billing-path-profitability-id-token/profitability?hourlyRate=10000" },
      { method: "POST", url: "/api/projects/bad_secret-project-billing-path-bill-id-token/bill-time", payload: { hourlyRate: 10000, issueDate: "2026-05-15", note: "secret-project-billing-path-body-token" } },
      { method: "GET", url: `/api/projects/${"a".repeat(161)}/billing-preview?hourlyRate=10000`, statusCode: 404 },
      { method: "GET", url: `/api/projects/${"a".repeat(161)}/profitability?hourlyRate=10000`, statusCode: 404 },
      { method: "POST", url: "/api/projects/bad%0Asecret-project-billing-path-control-id-token/bill-time", payload: { hourlyRate: 10000, issueDate: "2026-05-15" } }
    ]) {
      await expectPathRejected(request);
    }

    for (const request of [
      { method: "GET", url: "/api/projects/proj-missing/billing-preview?hourlyRate=10000", statusCode: 404 },
      { method: "GET", url: "/api/projects/proj-missing/profitability?hourlyRate=10000", statusCode: 404 },
      { method: "POST", url: "/api/projects/proj-missing/bill-time", payload: { hourlyRate: 10000, issueDate: "2026-05-15", note: "secret-project-billing-path-missing-body-token" }, statusCode: 404 }
    ]) {
      await expectPathRejected(request);
    }

    const preview = await app.inject({
      method: "GET",
      url: `/api/projects/${proj}/billing-preview?hourlyRate=10000`,
      headers: { cookie: owner }
    });
    assert.strictEqual(preview.statusCode, 200, preview.body);
    assert.strictEqual(preview.json().preview.unbilledMinutes, 180);
    assert.deepStrictEqual(current(), before);
  } finally { await app.close(); }
});

test("project-billing: cannot bill into a closed finance period (409 PERIOD_LOCKED)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);
    const proj = await createBillableProject(app, owner);

    // A control project proves the open period bills fine; the target project is billed for
    // the FIRST time only AFTER the period closes — so the idempotency short-circuit (which is
    // checked before the period gate) cannot mask the lock.
    const orgId = app.db.prepare("SELECT org_id FROM users WHERE email = ?").get(DEFAULT_EMAIL).org_id;
    const openPeriod = app.db.prepare("SELECT period_key FROM finance_periods WHERE org_id = ? AND status='open' LIMIT 1").get(orgId).period_key;
    const issueDate = `${openPeriod}-15`;
    const control = await app.inject({ method: "POST", url: `/api/projects/${proj}/bill-time`, headers: { cookie: owner }, payload: { hourlyRate: 10000, issueDate } });
    assert.strictEqual(control.statusCode, 200, "control bill into the open period succeeds");

    // A SEPARATE billable project that has never been billed in this period.
    const target = await createBillableProject(app, owner);

    // Close the period, then the target's FIRST bill into it must be rejected with 409.
    const close = await app.inject({ method: "POST", url: `/api/finance/periods/${openPeriod}/close`, headers: { cookie: owner }, payload: { reason: "month closed" } });
    assert.strictEqual(close.statusCode, 200, "owner closes the period");

    const lockedBill = await app.inject({ method: "POST", url: `/api/projects/${target}/bill-time`, headers: { cookie: owner }, payload: { hourlyRate: 10000, issueDate } });
    assert.strictEqual(lockedBill.statusCode, 409, "billing into a closed period is rejected");

    // The target's time remains UNBILLED — the rejected bill posted nothing.
    const preview = (await app.inject({ method: "GET", url: `/api/projects/${target}/billing-preview?hourlyRate=10000`, headers: { cookie: owner } })).json();
    assert.strictEqual(preview.preview.unbilledMinutes, 180, "closed-period bill left the time unbilled");
  } finally { await app.close(); }
});

test("project-billing: guards — no customer (400), no unbilled time (400), finance gate (403)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);

    // Project WITHOUT a customer cannot be billed.
    const noCust = (await app.inject({ method: "POST", url: "/api/projects", headers: { cookie: owner }, payload: { name: "Internal project" } })).json().project.id;
    await app.inject({ method: "POST", url: `/api/projects/${noCust}/time-entries`, headers: { cookie: owner }, payload: { minutes: 60, entryDate: "2099-03-05" } });
    const noCustBill = await app.inject({ method: "POST", url: `/api/projects/${noCust}/bill-time`, headers: { cookie: owner }, payload: { hourlyRate: 10000, issueDate: "2026-05-15" } });
    assert.strictEqual(noCustBill.statusCode, 400);

    // A customer project with NO time -> 400 (nothing to bill).
    const empty = (await app.inject({ method: "POST", url: "/api/projects", headers: { cookie: owner }, payload: { name: "Empty", customerId: "cust-ani" } })).json().project.id;
    const emptyBill = await app.inject({ method: "POST", url: `/api/projects/${empty}/bill-time`, headers: { cookie: owner }, payload: { hourlyRate: 10000, issueDate: "2026-05-15" } });
    assert.strictEqual(emptyBill.statusCode, 400);

    // Finance gate: an Operator (Projects writer but NOT a finance operator) cannot bill -> 403.
    const proj = await createBillableProject(app, owner);
    const opLogin = await app.inject({ method: "POST", url: "/api/login", payload: { email: "operator@armosphera.local", password: DEFAULT_PASSWORD } });
    const opCookie = opLogin.headers["set-cookie"];
    const opBill = await app.inject({ method: "POST", url: `/api/projects/${proj}/bill-time`, headers: { cookie: opCookie }, payload: { hourlyRate: 10000, issueDate: "2026-05-15" } });
    assert.strictEqual(opBill.statusCode, 403);
  } finally { await app.close(); }
});
