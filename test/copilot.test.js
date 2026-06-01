"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

async function reviewSource(app, cookie, sourceId, title, note) {
  const urlById = {
    "law-tax-code": "https://www.arlis.am/hy/acts/224990?reviewed=2026-06-01",
    "law-personal-data": "https://www.arlis.am/DocumentView.aspx?docid=117034",
    "law-esign": "https://www.cba.am/EN/lalaws/Law_on_e_docs_and%20_e_signatures.pdf"
  };
  const res = await app.inject({
    method: "POST",
    url: `/api/legal/sources/${sourceId}/reviews`,
    headers: { cookie },
    payload: {
      title,
      sourceUrl: urlById[sourceId],
      effectiveDate: "2026-06-01",
      status: "active",
      reviewNote: note
    }
  });
  assert.strictEqual(res.statusCode, 200, res.body);
  return res.json().source;
}

test("copilot endpoint is auth-gated", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/questions",
      payload: { intent: "vat", customerId: "cust-nare", periodKey: "2026-05", question: "Explain VAT readiness." }
    });
    assert.strictEqual(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("VAT copilot returns cited legal/accounting guidance without creating SRC export", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM finance_src_exports").get().count;

    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/questions",
      headers: { cookie },
      payload: {
        intent: "vat",
        customerId: "cust-nare",
        periodKey: "2026-05",
        question: "Can we prepare Armenian VAT and SRC guidance for the May 2026 period?"
      }
    });

    assert.strictEqual(res.statusCode, 200, res.body);
    const body = res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.copilot.intent, "vat");
    assert.strictEqual(body.copilot.advisoryOnly, true);
    assert.strictEqual(body.copilot.reviewRequired, true);
    assert.strictEqual(body.copilot.riskLevel, "legal");
    assert.ok(body.copilot.answer.includes("VAT") || body.copilot.answer.includes("ԱԱՀ"));
    assert.ok(body.copilot.citations.some(source => source.id === "law-tax-code"));
    assert.ok(body.copilot.calculations.some(calc => calc.kind === "vat-report"));
    assert.ok(body.copilot.proposedActions.some(action => action.key === "finance.src.prepare" && action.mutates === true));

    const after = app.db.prepare("SELECT COUNT(*) AS count FROM finance_src_exports").get().count;
    assert.strictEqual(after, before, "copilot must not create SRC export packets");
  } finally {
    await app.close();
  }
});

test("VAT copilot enables SRC proposal only after VAT source review", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    await reviewSource(
      app,
      cookie,
      "law-tax-code",
      "RA Tax Code Article 63 VAT rate - accountant reviewed",
      "Accountant confirmed this source is active for copilot VAT guidance."
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/questions",
      headers: { cookie },
      payload: {
        intent: "vat",
        customerId: "cust-nare",
        periodKey: "2026-05",
        question: "Prepare internal VAT guidance and show the next SRC packet action."
      }
    });

    assert.strictEqual(res.statusCode, 200, res.body);
    const action = res.json().copilot.proposedActions.find(item => item.key === "finance.src.prepare");
    assert.ok(action);
    assert.strictEqual(action.disabledReason, "");
    assert.deepStrictEqual(action.payload.periodKey, "2026-05");
  } finally {
    await app.close();
  }
});

test("personal-data delete copilot proposes retention assessment, not deletion", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const beforeRequests = app.db.prepare("SELECT COUNT(*) AS count FROM privacy_requests").get().count;
    const beforeAssessments = app.db.prepare("SELECT COUNT(*) AS count FROM privacy_retention_assessments").get().count;

    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/questions",
      headers: { cookie },
      payload: {
        intent: "personal-data",
        customerId: "cust-ani",
        question: "Customer asks us to delete personal data. What is the safe Armenian-law workflow?"
      }
    });

    assert.strictEqual(res.statusCode, 200, res.body);
    const copilot = res.json().copilot;
    assert.strictEqual(copilot.intent, "personal-data");
    assert.ok(copilot.citations.some(source => source.id === "law-personal-data"));
    assert.ok(/retention|պահպան/i.test(copilot.answer));
    assert.ok(copilot.guardrails.some(text => /not.*automatic|not executed automatically|չի կատարվում/i.test(text)));
    assert.ok(copilot.proposedActions.some(action => action.key === "privacy.request.prepare" && action.payload.requestType === "delete"));
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM privacy_requests").get().count, beforeRequests);
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM privacy_retention_assessments").get().count, beforeAssessments);
  } finally {
    await app.close();
  }
});

test("e-sign copilot cites signature source and includes document evidence", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/questions",
      headers: { cookie },
      payload: {
        intent: "esign",
        documentId: "doc-anahit-nda",
        question: "Can we rely on this NDA signature evidence internally?"
      }
    });

    assert.strictEqual(res.statusCode, 200, res.body);
    const copilot = res.json().copilot;
    assert.strictEqual(copilot.intent, "esign");
    assert.ok(copilot.citations.some(source => source.id === "law-esign"));
    assert.strictEqual(copilot.context.document.id, "doc-anahit-nda");
    assert.ok(Array.isArray(copilot.context.document.signers));
    assert.ok(copilot.proposedActions.some(action => action.key === "docs.export.open" && action.path.includes("/api/docs/documents/doc-anahit-nda/export")));
  } finally {
    await app.close();
  }
});

test("payroll copilot previews calculation without posting payroll run", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const before = app.db.prepare("SELECT COUNT(*) AS count FROM payroll_runs").get().count;
    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/questions",
      headers: { cookie },
      payload: {
        intent: "payroll",
        gross: 600000,
        asOf: "2026-05-28",
        question: "Preview Armenian payroll deductions for 600000 AMD gross salary."
      }
    });

    assert.strictEqual(res.statusCode, 200, res.body);
    const copilot = res.json().copilot;
    assert.strictEqual(copilot.intent, "payroll");
    assert.ok(copilot.calculations.some(calc => calc.kind === "payroll-preview" && calc.outputs.net === 436500));
    assert.ok(copilot.proposedActions.some(action => action.key === "payroll.run.prepare" && action.mutates === true));
    assert.strictEqual(app.db.prepare("SELECT COUNT(*) AS count FROM payroll_runs").get().count, before);
  } finally {
    await app.close();
  }
});

test("copilot enforces app access for finance intents", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const supportCookie = await login(app, "support@armosphera.local", DEFAULT_PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/questions",
      headers: { cookie: supportCookie },
      payload: { intent: "vat", customerId: "cust-nare", periodKey: "2026-05", question: "Explain VAT readiness." }
    });
    assert.strictEqual(res.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("copilot returns 404 for unknown customer or document", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const cookie = await login(app);
    const badCustomer = await app.inject({
      method: "POST",
      url: "/api/copilot/questions",
      headers: { cookie },
      payload: { intent: "vat", customerId: "cust-nope", question: "Explain VAT." }
    });
    assert.strictEqual(badCustomer.statusCode, 404);

    const badDoc = await app.inject({
      method: "POST",
      url: "/api/copilot/questions",
      headers: { cookie },
      payload: { intent: "esign", documentId: "doc-nope", question: "Review signature evidence." }
    });
    assert.strictEqual(badDoc.statusCode, 404);
  } finally {
    await app.close();
  }
});
