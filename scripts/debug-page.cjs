const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Login
  const login = await ctx.request.post('http://localhost:4100/api/login', {
    data: { email: 'owner@armosphera.local', password: 'change-me-now' },
    headers: { 'content-type': 'application/json' }
  });
  console.log('login status:', login.status());
  const cookies = await ctx.cookies();
  console.log('cookies:', cookies.map(c => c.name).join(','));
  const page = await ctx.newPage();
  page.on('console', m => console.log('[browser]', m.type(), m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  const r = await page.goto('http://localhost:4173/app/smb-crm/ai', { waitUntil: 'networkidle', timeout: 30000 });
  console.log('goto status:', r ? r.status() : 'none');
  await page.waitForTimeout(3000);
  const html = await page.content();
  console.log('--- HTML root length:', html.length, 'has <div id="root"> children?', html.includes('<div id="root">'));
  const rootChildCount = await page.evaluate(() => document.querySelector('#root')?.children.length || 0);
  console.log('root children count:', rootChildCount);
  const text = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log('body text (first 500):', text);
  await browser.close();
})();
