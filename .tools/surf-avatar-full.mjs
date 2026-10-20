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
const aH = { apikey: key };
const auH = { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + tok };
const otherUid = '00000000-0000-0000-0000-000000000001';

const avatar_catalog_anon = await fetch(new URL('/rest/v1/avatar_catalog?limit=1', base), { headers: aH });
const ac = JSON.parse(await avatar_catalog_anon.text());
console.log('1. avatar_catalog ANON SELECT:', avatar_catalog_anon.status, '| rows', ac.length, ac.length ? '| sample: ' + JSON.stringify(ac[0]).slice(0,180) : '| empty');

const avatar_catalog_auth = await fetch(new URL('/rest/v1/avatar_catalog?limit=1', base), { headers: auH });
const aca = JSON.parse(await avatar_catalog_auth.text());
console.log('2. avatar_catalog AUTH SELECT:', avatar_catalog_auth.status, '| rows', aca.length, aca.length ? '| sample: ' + JSON.stringify(aca[0]).slice(0,180) : '| empty');

const avatars_own = await fetch(new URL('/rest/v1/avatars?user_id=eq.' + uid + '&limit=1', base), { headers: auH });
const avOwn = JSON.parse(await avatars_own.text());
console.log('3. avatars (own uid) AUTH SELECT:', avatars_own.status, '| rows', avOwn.length);

const avatars_other = await fetch(new URL('/rest/v1/avatars?user_id=eq.' + otherUid + '&limit=1', base), { headers: auH });
const avOther = JSON.parse(await avatars_other.text());
console.log('4. avatars (other uid) AUTH SELECT:', avatars_other.status, '| rows', avOther.length, avOther.length > 0 ? '| LEAK' : '| scoped');

const avatars_anon = await fetch(new URL('/rest/v1/avatars?user_id=eq.' + uid + '&limit=1', base), { headers: aH });
const avAnon = JSON.parse(await avatars_anon.text());
console.log('5. avatars (our uid) ANON SELECT:', avatars_anon.status, '| rows', avAnon.length, avAnon.length > 0 ? '| anon CAN read user avatars' : '| anon blocked from user avatars');
