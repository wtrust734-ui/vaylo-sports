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

// 1. INSERT our own profile row (the app writes these)
const id = crypto.randomUUID();
const ins = await fetch(new URL('/rest/v1/profiles', base), {
  method: 'POST',
  headers,
  body: JSON.stringify({
    id,
    user_id: uid,
    full_name: 'Surf Verification User',
    country: 'Test',
    sport: 'verification',
    credits: 999,
    coins: 999,
    preferred_units: 'metric',
    onboarding_complete: true,
    terms_accepted_at: new Date().toISOString(),
    is_guest: false,
  }),
});
const insBody = await ins.text();
console.log('1. profiles INSERT status:', ins.status, ins.status === 201 ? 'CREATED' : insBody.slice(0, 300));

// 2. READ it back — must be visible to us
const sel = await fetch(new URL('/rest/v1/profiles?user_id=eq.' + uid + '&limit=10', base), { headers });
const selBody = await sel.text();
const rows = JSON.parse(selBody);
const ourRow = rows.find(r => r.id === id);
console.log('2. profiles SELECT status:', sel.status, '| total rows for us:', rows.length, '| our new row found:', !!ourRow);
if (ourRow) console.log('   our row: credits=', ourRow.credits, 'name=', ourRow.full_name, 'sport=', ourRow.sport);

// 3. CROSS-USER read (bogus other uid) — must be empty
const otherUid = '00000000-0000-0000-0000-000000000001';
const cross = await fetch(new URL('/rest/v1/profiles?user_id=eq.' + otherUid + '&limit=10', base), { headers });
const crossRows = JSON.parse(await cross.text());
console.log('3. profiles cross-user(bogus) SELECT status:', cross.status, '| rows:', crossRows.length, crossRows.length > 0 ? 'LEAK' : 'scoped');

// 4. Another real user's row — we must NOT see it. Read all our profiles and confirm the pre-existing one is ours.
const realOtherUid = 'a635ae90-0987-4739-b262-6f5570b978de';
const cross2 = await fetch(new URL('/rest/v1/profiles?user_id=eq.' + realOtherUid + '&limit=10', base), { headers });
const cross2Rows = JSON.parse(await cross2.text());
console.log('4. profiles real-other-user(' + realOtherUid.slice(0, 8) + '...) SELECT status:', cross2.status, '| rows:', cross2Rows.length, cross2Rows.length > 0 ? 'LEAK' : 'scoped');

// 5. DELETE our test row to leave the table clean
if (ourRow) {
  const del = await fetch(new URL('/rest/v1/profiles?id=eq.' + id, base), { method: 'DELETE', headers });
  const delBody = await del.text();
  console.log('5. profiles DELETE status:', del.status, del.status === 200 ? 'removed' : delBody.slice(0, 200));
  // verify removal
  const re = await fetch(new URL('/rest/v1/profiles?id=eq.' + id, base), { headers });
  const reRows = JSON.parse(await re.text());
  console.log('   after DELETE, row still visible:', reRows.length > 0 ? 'LEAK' : 'gone');
}
