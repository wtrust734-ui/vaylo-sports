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
const headers = { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + tok };

// 1. Anon reads avatar_catalog — must work (app uses it as a catalog)
const anonR = await fetch(new URL('/rest/v1/avatar_catalog?limit=1', base), { headers: { apikey: key } });
const anonRows = JSON.parse(await anonR.text());
console.log('1. avatar_catalog ANON SELECT: status', anonR.status, '| rows', anonRows.length, anonRows.length ? '| sample:', JSON.stringify(anonRows[0]).slice(0, 200) : '| empty');

// 2. Auth reads avatar_catalog (no filter) — must work (catalog is a shared read)
const authR = await fetch(new URL('/rest/v1/avatar_catalog?limit=1', base), { headers });
const authRows = JSON.parse(await authR.text());
console.log('2. avatar_catalog AUTH SELECT: status', authR.status, '| rows', authRows.length, authRows.length ? '| sample:', JSON.stringify(authRows[0]).slice(0, 200) : '| empty');

// 3. Cross-user: avatars table (user-owned) — verify scoping
const avatarsOwn = await fetch(new URL('/rest/v1/avatars?user_id=eq.' + uid + '&limit=1', base), { headers });
const avatarsOwnRows = JSON.parse(await avatarsOwn.text());
console.log('3. avatars (own user) SELECT: status', avatarsOwn.status, '| rows', avatarsOwnRows.length);

const otherUid = '00000000-0000-0000-0000-000000000001';
const avatarsCross = await fetch(new URL('/rest/v1/avatars?user_id=eq.' + otherUid + '&limit=1', base), { headers });
const avatarsCrossRows = JSON.parse(await avatarsCross.text());
console.log('4. avatars (other user) SELECT: status', avatarsCross.status, '| rows', avatarsCrossRows.length, avatarsCrossRows.length > 0 ? 'LEAK' : 'scoped');

// 4. Anon cannot read avatars (user-owned) — must be blocked
const avatarsAnon = await fetch(new URL('/rest/v1/avatars?user_id=eq.' + uid + '&limit=1', base), { headers: { apikey: key } });
const avatarsAnonRows = JSON.parse(await avatarsAnon.text());
console.log('5. avatars ANON SELECT (our uid): status', avatarsAnon.status, '| rows', avatarsAnonRows.length, avatarsAnonRows.length > 0 ? 'anon CAN read user avatars' : 'anon blocked from user avatars');
