"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");
const { DEFAULT_EMAIL, DEFAULT_PASSWORD } = require("../server/db");

async function login(app, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { email, password } });
  return res.headers["set-cookie"];
}

test("export-docs migration creates the 6 tables", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const required = [
      "export_documents",
      "export_document_lines",
      "hs_code_rules",
      "country_rule_packs",
      "export_declarations",
      "export_signatures"
    ];
    for (const name of required) {
      const row = app.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
      assert.ok(row, `table ${name} must exist`);
    }
  } finally {
    await app.close();
  }
});

test("export-docs country-rule pack for RU is seeded", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const pack = app.db.prepare("SELECT * FROM country_rule_packs WHERE country = ?").get("RU");
    assert.ok(pack, "RU pack must be seeded at boot");
    assert.ok(pack.version && /^\d+\.\d+/.test(pack.version));
  } finally {
    await app.close();
  }
});
