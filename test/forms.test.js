"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

test("forms: definition CRUD is auth-gated; public submit creates a CRM lead", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();

    // List is auth-gated -> 401
    const unauth = await app.inject({ method: "GET", url: "/api/forms" });
    assert.strictEqual(unauth.statusCode, 401);

    const owner = await login(app);
    const seeded = (await app.inject({ method: "GET", url: "/api/forms", headers: { cookie: owner } })).json();
    assert.ok(Array.isArray(seeded.forms) && seeded.forms.length >= 1, "seeded form present");
    assert.ok(seeded.forms.some(f => f.id === "form-lead-intake" && f.status === "published"), "seeded intake form is published");

    // Create a draft form
    const created = await app.inject({ method: "POST", url: "/api/forms", headers: { cookie: owner },
      payload: { title: "Ամրագրման հայտ", fields: [{ key: "contactName", label: "Անուն", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }] } });
    assert.strictEqual(created.statusCode, 200);
    const formId = created.json().form.id;
    assert.strictEqual(created.json().form.status, "draft");
    assert.strictEqual(created.json().form.fields.length, 2);

    // Title too short -> 400
    const bad = await app.inject({ method: "POST", url: "/api/forms", headers: { cookie: owner }, payload: { title: "x" } });
    assert.strictEqual(bad.statusCode, 400);

    // A DRAFT form cannot be submitted publicly -> 404 (only published forms accept submissions)
    const draftSubmit = await app.inject({ method: "POST", url: `/api/forms/${formId}/submit`, payload: { contactName: "Test", email: "t@example.com" } });
    assert.strictEqual(draftSubmit.statusCode, 404);

    // Publish it
    const published = await app.inject({ method: "PATCH", url: `/api/forms/${formId}`, headers: { cookie: owner }, payload: { status: "published" } });
    assert.strictEqual(published.json().form.status, "published");

    // PUBLIC submit (NO cookie) to the seeded published intake form -> creates a lead
    const leadsBefore = (await app.inject({ method: "GET", url: "/api/crm/leads", headers: { cookie: owner } })).json();
    const beforeCount = (leadsBefore.leads || []).length;
    const submit = await app.inject({ method: "POST", url: "/api/forms/form-lead-intake/submit",
      payload: { companyName: "Մարդ ՍՊԸ", contactName: "Արամ Մարդյան", email: "aram@example.com", phone: "+374 99 112233", interest: "Հետաքրքրված եմ ամրագրման ավտոմատացմամբ" } });
    assert.strictEqual(submit.statusCode, 200);
    // Public response is minimal — must NOT leak lead/org internals
    assert.deepStrictEqual(submit.json(), { ok: true, received: true });

    // The lead now exists in CRM
    const leadsAfter = (await app.inject({ method: "GET", url: "/api/crm/leads", headers: { cookie: owner } })).json();
    assert.strictEqual((leadsAfter.leads || []).length, beforeCount + 1, "a CRM lead was created from the public submission");
    assert.ok((leadsAfter.leads || []).some(l => l.email === "aram@example.com"), "lead carries the submitted email");

    // The submission is recorded against the form, linked to the lead
    const formDetail = (await app.inject({ method: "GET", url: "/api/forms/form-lead-intake", headers: { cookie: owner } })).json();
    assert.ok(formDetail.form.submissions.length >= 1, "submission recorded");
    assert.ok(formDetail.form.submissions[0].leadId, "submission linked to a lead");
    assert.strictEqual(formDetail.form.submissions[0].data.email, "aram@example.com");
  } finally { await app.close(); }
});

test("forms: write-gate (Auditor 403), key-whitelisting, and required-field enforcement on public submit", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);

    // Auditor cannot create forms -> 403
    const auditor = await login(app, "auditor@armosphera.local", DEFAULT_PASSWORD);
    const blocked = await app.inject({ method: "POST", url: "/api/forms", headers: { cookie: auditor }, payload: { title: "Should fail" } });
    assert.strictEqual(blocked.statusCode, 403);

    // Missing a required field on public submit -> 400 (seeded intake requires companyName/contactName/email/phone/interest)
    const missing = await app.inject({ method: "POST", url: "/api/forms/form-lead-intake/submit", payload: { contactName: "No Company" } });
    assert.strictEqual(missing.statusCode, 400);

    // Key-whitelisting: a public caller cannot inject undeclared keys into the stored submission.
    const ok = await app.inject({ method: "POST", url: "/api/forms/form-lead-intake/submit",
      payload: { companyName: "Բ ՍՊԸ", contactName: "Բ Անձ", email: "b@example.com", phone: "+374 99 000111", interest: "Հետաքրքրված եմ ձեր ծառայություններով", status: "qualified", org_id: "org-evil", evilKey: "x" } });
    assert.strictEqual(ok.statusCode, 200);
    const detail = (await app.inject({ method: "GET", url: "/api/forms/form-lead-intake", headers: { cookie: owner } })).json();
    const latest = detail.form.submissions[0].data;
    assert.strictEqual(latest.evilKey, undefined, "undeclared key was dropped");
    assert.strictEqual(latest.status, undefined, "injected status key was dropped");
    assert.strictEqual(latest.org_id, undefined, "injected org_id key was dropped");
  } finally { await app.close(); }
});

test("forms: submitting an unknown form id -> 404", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/forms/form-does-not-exist/submit", payload: { email: "x@example.com" } });
    assert.strictEqual(res.statusCode, 404);
  } finally { await app.close(); }
});

test("forms: public submit is per-IP rate limited (429 after the burst), and other IPs are unaffected", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const url = "/api/forms/form-lead-intake/submit";
    const payload = { companyName: "Spam Co", contactName: "Flood", email: "flood@example.com", phone: "+374 99 000000", interest: "flooding" };
    const attacker = "203.0.113.7";

    // Hammer from one IP. The limiter allows a bounded burst then must reject with 429.
    let okCount = 0;
    let limited = 0;
    for (let i = 0; i < 25; i++) {
      const res = await app.inject({ method: "POST", url, payload, remoteAddress: attacker });
      if (res.statusCode === 200) okCount += 1;
      else if (res.statusCode === 429) limited += 1;
      else assert.fail(`unexpected status ${res.statusCode} on attempt ${i}`);
    }
    assert.ok(okCount > 0, "some submissions should succeed before the limit");
    assert.ok(okCount <= 15, `burst should be bounded, got ${okCount} successes`);
    assert.ok(limited > 0, "excess submissions from one IP must be rejected with 429");

    // A DIFFERENT IP is not penalized by the attacker's flood (per-IP, not global).
    const other = await app.inject({ method: "POST", url, payload, remoteAddress: "198.51.100.42" });
    assert.strictEqual(other.statusCode, 200, "a fresh IP can still submit");
  } finally { await app.close(); }
});
