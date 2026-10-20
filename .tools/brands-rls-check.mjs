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

const aH = { apikey: key };
const auH = { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + tok };

const anonR = await fetch(new URL('/rest/v1/brands?limit=1', base), { headers: aH });
const anonBody = await anonR.text();
console.log('ANON brands SELECT: status', anonR.status, '| body:', anonBody.slice(0, 300));

const authR = await fetch(new URL('/rest/v1/brands?limit=1', base), { headers: auH });
const authBody = await authR.text();
console.log('AUTH brands SELECT: status', authR.status, '| body:', authBody.slice(0, 300));
