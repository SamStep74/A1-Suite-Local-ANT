const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext();
  const r = await ctx.request.post('http://localhost:4100/api/login', {
    data: { email: 'owner@armosphera.local', password: 'change-me-now' },
    headers: { 'content-type': 'application/json' }
  });
  console.log('status:', r.status());
  const json = await r.json();
  console.log('keys:', Object.keys(json).join(','));
  console.log('ok:', json.ok);
  console.log('sid:', json.sid);
  console.log('user.email:', json.user?.email);
  console.log('user.role:', json.user?.role);
  console.log('user.org_id:', json.user?.org_id);
  await browser.close();
})();
