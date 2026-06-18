#!/usr/bin/env node
/**
 * scripts/capture-screenshots.cjs — Playwright screenshot pass
 * for the new V2 surfaces. Drives Playwright via Node (per
 * memory: the playwright MCP is dead on this box).
 *
 * Run order:
 *   1. Start the Fastify backend on :4100 (via scripts/smoke.js,
 *      or a direct require of server/app.js with a non-default DB)
 *   2. Start the Vite SPA on :3000
 *   3. Wait for both to be reachable
 *   4. Log in via /api/login
 *   5. Drive the browser through the 4 new pages, capture PNGs
 *
 * For this slice we use the SAME DB + SPA dev server that the
 * user already runs locally. The script just connects, logs
 * in, and captures. Caller is responsible for starting the
 * servers (or running this with `START_FASTIFY=1` if a wrapper
 * exists).
 *
 * Output: /tmp/ant-screenshots-v2/*.png
 *
 *   login.png            - /app/login (form before submit)
 *   smb-crm-list.png     - /app/smb-crm
 *   ask-ai.png           - /app/smb-crm/ai
 *   quote-templates.png  - /app/smb-crm/quote-templates (after pick)
 *   integrations.png     - /app/smb-crm/integrations
 *   oauth-integrations.png - /app/smb-crm/integrations/oauth
 *
 * Usage:
 *   node scripts/capture-screenshots.cjs
 *   # OR with explicit URLs:
 *   SPA_BASE=http://localhost:3000 API_BASE=http://localhost:4100 \
 *     node scripts/capture-screenshots.cjs
 */
'use strict';

const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const SPA_BASE = process.env.SPA_BASE || 'http://localhost:3000';
const API_BASE = process.env.API_BASE || 'http://localhost:4100';
const OUTPUT_DIR = process.env.OUTPUT_DIR || '/tmp/ant-screenshots-v2';
const DEFAULT_EMAIL = process.env.DEFAULT_EMAIL || 'owner@armosphera.local';
const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || 'change-me-now';

async function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  return OUTPUT_DIR;
}

async function loginViaApi(request) {
  const res = await request.post(`${API_BASE}/api/login`, {
    data: { email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD },
    headers: { 'content-type': 'application/json' }
  });
  if (res.status() !== 200) {
    const body = await res.text();
    throw new Error(`login failed: HTTP ${res.status()}: ${body}`);
  }
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`login returned ok:false: ${JSON.stringify(json)}`);
  }
  return json;
}

async function capturePage(page, urlPath, filename, options = {}) {
  const fullUrl = `${SPA_BASE}${urlPath}`;
  console.log(`  → ${fullUrl}`);
  const resp = await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 30000 });
  if (!resp || !resp.ok()) {
    console.warn(`    warn: HTTP ${resp ? resp.status() : '???'} on ${urlPath}`);
  }
  // Wait for the SPA to actually render content. The
  // data-spa-hydrated attribute is set inline (always present),
  // so we wait for a meaningful body height + a known testid
  // (or any element with children) to indicate React mounted.
  await page.waitForFunction(
    () => {
      const root = document.querySelector('#root');
      return root && root.children.length > 0 && root.getBoundingClientRect().height > 100;
    },
    { timeout: 15000 }
  ).catch(() => console.warn('    warn: hydration wait timed out; capturing anyway'));
  // Extra beat for any in-flight data fetches.
  await page.waitForTimeout(options.waitMs || 1500);
  const out = path.join(OUTPUT_DIR, filename);
  await page.screenshot({ path: out, fullPage: options.fullPage !== false });
  console.log(`    saved ${out}`);
  return out;
}

async function main() {
  await ensureOutputDir();
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`SPA:   ${SPA_BASE}`);
  console.log(`API:   ${API_BASE}`);

  // Use the system-installed Chromium (per memory: cache at
  // /Users/samvelstepanyan/Library/Caches/ms-playwright/).
  // channel: 'chromium' would use the default; we set
  // executablePath explicitly when PLAYWRIGHT_BROWSERS_PATH
  // is set in the env so the dev environment controls which
  // binary is used.
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      // Persist cookies across pages (the session cookie is
      // set by the backend on /api/login).
    });

    // Login via the API context so the Set-Cookie response
    // gets attached to the browser context. Also capture the
    // sid token for the new SPA's sessionStorage.
    console.log('Logging in...');
    const loginJson = await loginViaApi(context.request);
    const bearerSid = loginJson.sid;
    console.log(`  bearer sid: ${bearerSid ? bearerSid.slice(0, 12) + '…' : '(none)'}`);
    // The Set-Cookie should now be in the context's cookie
    // jar. Verify.
    const cookies = await context.cookies();
    const sidCookie = cookies.find((c) => c.name === 'sid' || c.name === 'session');
    console.log(`  cookies: ${cookies.map((c) => c.name).join(', ')}`);
    if (!sidCookie) {
      console.warn('  warn: no sid cookie after login; the SPA may not be authenticated');
    }

    const page = await context.newPage();
    // Seed sessionStorage on the same origin as the SPA so
    // the bearer-token check (`sessionStorage["ant.bearerSid"]`)
    // passes on every page we capture. Playwright's
    // sessionStorage is per-context-and-origin; setting it
    // before any navigation is required.
    await page.goto(SPA_BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate((sid) => {
      window.sessionStorage.setItem("ant.bearerSid", sid);
    }, bearerSid);

    // Capture each page.
    await capturePage(page, '/app', 'home.png');
    await capturePage(page, '/app/smb-crm', 'smb-crm-list.png');
    await capturePage(page, '/app/smb-crm/ai', 'ask-ai.png');

    // For quote-templates, click a template card so the line
    // item editor shows.
    await capturePage(page, '/app/smb-crm/quote-templates', 'quote-templates-empty.png');
    const firstTemplate = page.locator('[data-testid="smb-crm-quote-template-card"]').first();
    if (await firstTemplate.count() > 0) {
      await firstTemplate.click();
      await page.waitForTimeout(500);
      await capturePage(page, '/app/smb-crm/quote-templates', 'quote-templates-picked.png');
    }

    await capturePage(page, '/app/smb-crm/integrations', 'integrations.png');
    await capturePage(page, '/app/smb-crm/integrations/oauth', 'oauth-integrations.png');

    console.log('All screenshots captured.');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
