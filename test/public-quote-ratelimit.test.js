"use strict";
// The public quote endpoints (GET /api/public/quotes/:token and POST .../accept) are
// unauthenticated and both resolve an attacker-supplied token via getPublicQuote — a
// token-enumeration surface. They must be per-IP rate limited so a single client cannot
// brute-force tokens or hammer the accept path.
const test = require("node:test");
const assert = require("node:assert");
const { buildApp } = require("../server/app");

// A seeded quote in "sent" status with a known public token (server/db.js).
const SEEDED_TOKEN = "public-quote-ani-inbox-token";

test("public quotes: GET is per-IP rate limited (429 after the burst); other IPs unaffected", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const url = `/api/public/quotes/${SEEDED_TOKEN}`;
    const attacker = "203.0.113.50";

    let ok = 0;
    let limited = 0;
    for (let i = 0; i < 50; i++) {
      const res = await app.inject({ method: "GET", url, remoteAddress: attacker });
      if (res.statusCode === 200) ok += 1;
      else if (res.statusCode === 429) limited += 1;
      else assert.fail(`unexpected status ${res.statusCode} on attempt ${i}`);
    }
    assert.ok(ok > 0, "some reads succeed before the limit");
    assert.ok(ok <= 35, `GET burst should be bounded (~30/min), got ${ok}`);
    assert.ok(limited > 0, "excess reads from one IP must be 429");

    // A different IP is not penalized by the attacker's flood.
    const other = await app.inject({ method: "GET", url, remoteAddress: "198.51.100.9" });
    assert.strictEqual(other.statusCode, 200, "a fresh IP can still read the quote");
  } finally { await app.close(); }
});

test("public quotes: token enumeration via GET is throttled even for unknown tokens (429)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const attacker = "203.0.113.51";
    let notFound = 0;
    let limited = 0;
    // Brute-force DIFFERENT tokens from one IP — per-token keying would never trip; per-IP must.
    for (let i = 0; i < 50; i++) {
      const res = await app.inject({ method: "GET", url: `/api/public/quotes/guess-${i}`, remoteAddress: attacker });
      if (res.statusCode === 404) notFound += 1;
      else if (res.statusCode === 429) limited += 1;
      else assert.fail(`unexpected status ${res.statusCode} on attempt ${i}`);
    }
    assert.ok(notFound > 0, "early guesses return 404");
    assert.ok(limited > 0, "sustained enumeration from one IP must be throttled with 429");
  } finally { await app.close(); }
});

test("public quotes: POST accept is per-IP rate limited (429 after the burst)", async () => {
  const app = buildApp({ dbPath: ":memory:" });
  try {
    await app.ready();
    const url = `/api/public/quotes/${SEEDED_TOKEN}/accept`;
    const attacker = "203.0.113.52";
    const payload = { signerName: "Brute Forcer", signerEmail: "brute@example.com" };

    let handled = 0; // 200 (accepted/idempotent) or 4xx from acceptance logic
    let limited = 0;
    for (let i = 0; i < 25; i++) {
      const res = await app.inject({ method: "POST", url, payload, remoteAddress: attacker });
      if (res.statusCode === 429) limited += 1;
      else handled += 1;
    }
    assert.ok(handled > 0, "some accepts are processed before the limit");
    assert.ok(handled <= 15, `accept burst should be bounded (~10/min), got ${handled}`);
    assert.ok(limited > 0, "excess accept attempts from one IP must be 429");
  } finally { await app.close(); }
});
