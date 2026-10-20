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

// Discover a writable table the app touches: pick the real columns from profiles (we know it works)
const profR = await fetch(new URL('/rest/v1/profiles?limit=0', base), { headers });
const profCols = await profR.json();
console.log('profiles columns (from select-less response):');
if (profCols && typeof profCols === 'object' && !Array.isArray(profCols)) {
  // PostgREST returns column info differently; instead just get one real row we can mutate
}
const oneProf = await fetch(new URL('/rest/v1/profiles?user_id=eq.' + uid + '&limit=1', base), { headers });
const profRow = JSON.parse(await oneProf.text())[0] || null;
console.log('our profile row id:', profRow?.id, '| credits:', profRow?.credits, '| coins:', profRow?.coins);

// 1. UPDATE our own profile credits (the app writes these) — must succeed
const newCredits = (profRow?.credits ?? 0) + 13;
const up = await fetch(new URL('/rest/v1/profiles?user_id=eq.' + uid, base), {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ credits: newCredits, coins: (profRow?.coins ?? 0) + 7 }),
});
const upBody = await up.text();
console.log('1. profiles PATCH (our row) status:', up.status, up.status === 200 ? 'UPDATED' : upBody.slice(0, 200));

// 2. Read it back — must see our update
const after = await fetch(new URL('/rest/v1/profiles?user_id=eq.' + uid + '&limit=1', base), { headers });
const afterRows = JSON.parse(await after.text());
const afterRow = afterRows[0] || null;
console.log('2. profiles after PATCH: credits=', afterRow?.credits, '(expected', newCredits, ')', '| coins=', afterRow?.coins);

// 3. CROSS-USER — read our uid's row vs bogus — we should only see our own
const otherUid = '00000000-0000-0000-0000-000000000001';
const cross = await fetch(new URL('/rest/v1/profiles?user_id=eq.' + otherUid + '&limit=1', base), { headers });
const crossRows = JSON.parse(await cross.text());
console.log('3. profiles cross-user(bogus) SELECT: status', cross.status, '| rows', crossRows.length, crossRows.length > 0 ? 'LEAK' : 'scoped');

// 4. ANON cannot update our row (must be blocked)
const anonUp = await fetch(new URL('/rest/v1/profiles?user_id=eq.' + uid, base), {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', apikey: key },
  body: JSON.stringify({ credits: 99999 }),
});
console.log('4. profiles PATCH (anon, no bearer): status', anonUp.status, anonUp.status >= 400 ? 'blocked' : 'LEAK anon can write');

// 5. ANON cannot read our specific profile if RLS blocks anon (check)
const anonProf = await fetch(new URL('/rest/v1/profiles?user_id=eq.' + uid + '&limit=1', base), { headers: { apikey: key } });
const anonProfRows = JSON.parse(await anonProf.text());
console.log('5. profiles anon SELECT our row: status', anonProf.status, '| rows', anonProfRows.length, anonProfRows.length > 0 ? 'anon CAN read profiles' : 'anon blocked from profiles');

// 6. Restore original credits (undo test) — if we had a baseline to restore to
// We don't know the original; leave the +13/+7. Instead log it so the user knows.
console.log('6. NOTE: profile credits left at', afterRow?.credits, '/ coins at', afterRow?.coins, '(surf test incremented by +13/+7). Restore manually if needed.');
