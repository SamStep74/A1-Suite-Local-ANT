// Quick schema-validation probe for the home dashboard.
import { ServiceConsoleSchema } from '../src/lib/api/schemas';

async function main() {
  const sidRes = await fetch('http://127.0.0.1:4100/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@armosphera.local', password: 'change-me-now' })
  });
  const sidBody = await sidRes.json() as { sid: string };
  const sid = sidBody.sid;
  console.log('SID:', sid.slice(0, 8) + '...');

  const res = await fetch('http://127.0.0.1:4100/api/service/console', {
    headers: { authorization: `Bearer ${sid}` }
  });
  const data = await res.json();
  const r = ServiceConsoleSchema.safeParse(data);
  if (r.success) {
    console.log('OK');
  } else {
    console.log('FAIL');
    console.log(JSON.stringify(r.error.format(), null, 2));
  }
}

main().catch(console.error);
