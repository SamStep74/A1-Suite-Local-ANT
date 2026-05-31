"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

test("forms-public-page: a published form renders a fillable HTML page wired to the submit API", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();

    // No auth required — this is a public lead-capture page.
    const res = await app.inject({ method: "GET", url: "/f/form-lead-intake" });
    assert.strictEqual(res.statusCode, 200);
    assert.match(res.headers["content-type"], /text\/html/, "served as HTML");

    const html = res.body;
    assert.match(html, /<form/, "renders a real <form>");
    // Posts to the existing rate-limited public submit endpoint (single submission path).
    assert.ok(html.includes("/api/forms/form-lead-intake/submit"), "wired to the submit API");
    // Declared field labels/keys are present so a visitor can fill them in.
    assert.ok(html.includes("companyName") && html.includes("contactName") && html.includes("email"), "declared fields rendered");
    // Required fields are marked required in the markup.
    assert.match(html, /required/, "required fields marked");
  } finally { await app.close(); }
});

test("forms-public-page: draft + unknown forms 404 (no draft leak)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);

    // A brand-new form defaults to draft — its public page must 404.
    const created = await app.inject({ method: "POST", url: "/api/forms", headers: { cookie: owner },
      payload: { title: "Draft only", fields: [{ key: "email", label: "Email", type: "email", required: true }] } });
    const draftId = created.json().form.id;
    const draftPage = await app.inject({ method: "GET", url: `/f/${draftId}` });
    assert.strictEqual(draftPage.statusCode, 404, "draft form is not publicly rendered");

    const unknown = await app.inject({ method: "GET", url: "/f/form-does-not-exist" });
    assert.strictEqual(unknown.statusCode, 404);
  } finally { await app.close(); }
});

test("forms-public-page: writer-authored title/labels are HTML-escaped (no stored XSS)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);

    const xss = "<script>alert('pwn')</script>";
    const created = await app.inject({ method: "POST", url: "/api/forms", headers: { cookie: owner },
      payload: { title: xss, fields: [{ key: "email", label: xss, type: "email", required: true }] } });
    const id = created.json().form.id;
    await app.inject({ method: "PATCH", url: `/api/forms/${id}`, headers: { cookie: owner }, payload: { status: "published" } });

    const page = await app.inject({ method: "GET", url: `/f/${id}` });
    assert.strictEqual(page.statusCode, 200);
    // The raw script tag must NOT appear; it must be escaped.
    assert.ok(!page.body.includes("<script>alert('pwn')</script>"), "raw script tag is not emitted");
    assert.ok(page.body.includes("&lt;script&gt;"), "title/label is HTML-escaped");
  } finally { await app.close(); }
});

test("forms-public-page: the rendered page actually submits and creates a CRM lead", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const owner = await login(app);

    // The page exists...
    const page = await app.inject({ method: "GET", url: "/f/form-lead-intake" });
    assert.strictEqual(page.statusCode, 200);

    // ...and the endpoint it points at creates a lead (end-to-end public path).
    const before = (await app.inject({ method: "GET", url: "/api/crm/leads", headers: { cookie: owner } })).json().leads.length;
    const submit = await app.inject({ method: "POST", url: "/api/forms/form-lead-intake/submit",
      payload: { companyName: "Page Co", contactName: "Visitor", email: "visitor@example.com", phone: "+374 99 555444", interest: "from the public page" } });
    assert.strictEqual(submit.statusCode, 200);
    const after = (await app.inject({ method: "GET", url: "/api/crm/leads", headers: { cookie: owner } })).json().leads.length;
    assert.strictEqual(after, before + 1, "public submission created a CRM lead");
  } finally { await app.close(); }
});
