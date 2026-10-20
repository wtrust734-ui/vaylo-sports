import fs from 'node:fs';
import { URL } from 'node:url';

function parseEnv() {
  const out = {};
  for (const line of fs.readFileSync('.env', 'utf8').trim().split(/\r?\n/)) {
    if (!line.includes('=') || line.startsWith('#')) continue;
    const [k, ...v] = line.split('=');
    out[k.trim()] = v.join('=').trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}
const env = parseEnv();
const base = new URL(env.VITE_SUPABASE_URL);
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const tok = fs.readFileSync('.surf-access-token.txt', 'utf8').trim();
const uid = '82b96b82-0478-4760-b7be-b58afd07703c';
const headers = { apikey: key, Authorization: 'Bearer ' + tok };

const r = await fetch(new URL('/rest/v1/profiles?user_id=eq.' + uid + '&limit=1', base), { headers });
const body = await r.text();
const data = JSON.parse(body);
console.log('status:', r.status);
console.log('profiles (own):', JSON.stringify(data[0] ?? null, null, 2));
console.log('explanation: empty array = auth saw the table but our user has no profile row yet (profiles likely INSERT-only via auth hook)');
