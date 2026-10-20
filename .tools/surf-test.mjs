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
const accessToken = fs.readFileSync('.surf-access-token.txt', 'utf8').trim();

const http = async (path, options = {}) => {
  const url = new URL(path, base);
  const r = await fetch(url, options);
  let body = '';
  try { body = await r.text(); } catch {}
  return { status: r.status, headers: Object.fromEntries(r.headers.entries()), body: body.slice(0, 800) };
};

const report = (label, r) => {
  console.log(`${label}: ${r.status} | ${r.headers['content-type'] || ''}`);
  if (r.status >= 400) console.log('   body:', r.body.slice(0, 300));
};

const uid = '82b96b82-0478-4760-b7be-b58afd07703c';

console.log('=== 1. ANON (publishable key only) — public lookups ===');
const anonCalls = [
  ['avatar_catalog (anon SELECT 1 row)', '/rest/v1/avatar_catalog?limit=1'],
  ['event_packs (anon SELECT 1 row)', '/rest/v1/event_packs?limit=1'],
  ['brands (anon SELECT 1 row)', '/rest/v1/brands?limit=1'],
  ['pricing_tiers (anon SELECT 1 row)', '/rest/v1/pricing_tiers?limit=1'],
  ['subscription_plans active (anon SELECT 1 row)', '/rest/v1/subscription_plans?limit=1&active=eq.true'],
];
for (const [label, path] of anonCalls) {
  report(label, await http(path, { headers: { apikey: key } }));
}

console.log('\n=== 2. AUTH (bearer token) — user-scoped reads ===');
const authCalls = [
  ['profiles (own row)', '/rest/v1/profiles?user_id=eq.' + uid],
  ['achievements (own)', '/rest/v1/achievements?user_id=eq.' + uid + '&limit=3'],
  ['nutrition_plans (own)', '/rest/v1/nutrition_plans?user_id=eq.' + uid + '&limit=3'],
  ['subscriptions (own)', '/rest/v1/subscriptions?user_id=eq.' + uid + '&limit=3'],
  ['avatars (own)', '/rest/v1/avatars?user_id=eq.' + uid + '&limit=3'],
];
for (const [label, path] of authCalls) {
  report(label, await http(path, {
    headers: { apikey: key, Authorization: 'Bearer ' + accessToken }
  }));
}

console.log('\n=== 3. AUTH — cross-user row MUST NOT be visible ===');
const otherUid = '00000000-0000-0000-0000-000000000001';
const crossCalls = [
  ['profiles (other user)', '/rest/v1/profiles?user_id=eq.' + otherUid + '&limit=1'],
  ['achievements (other user)', '/rest/v1/achievements?user_id=eq.' + otherUid + '&limit=1'],
  ['nutrition_plans (other user)', '/rest/v1/nutrition_plans?user_id=eq.' + otherUid + '&limit=1'],
];
for (const [label, path] of crossCalls) {
  const r = await http(path, {
    headers: { apikey: key, Authorization: 'Bearer ' + accessToken }
  });
  let data = [];
  try { data = JSON.parse(r.body || '[]'); } catch {}
  console.log(`${label}: ${r.status} | rows returned: ${data.length} ${r.status === 200 && data.length > 0 ? 'CROSS-USER DATA LEAK' : 'scoped'}`);
}

console.log('\n=== 4. AUTH — write path (INSERT own achievement) ===');
const insertR = await fetch(new URL('/rest/v1/achievements', base), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + accessToken },
  body: JSON.stringify({ id: crypto.randomUUID(), user_id: uid, achievement_id: 'surf-test-verification', earned_at: new Date().toISOString(), source: 'verification-run' }),
});
console.log('achievement INSERT:', insertR.status, insertR.status === 201 ? 'created' : (await insertR.text()).slice(0, 300));

console.log('\n=== 5. Confirm inserted row is readable only by us, then cleanup ===');
const selR = await http('/rest/v1/achievements?achievement_id=eq.surf-test-verification&limit=5', {
  headers: { apikey: key, Authorization: 'Bearer ' + accessToken }
});
let rows = [];
try { rows = JSON.parse(selR.body || '[]'); } catch {}
console.log('achievement SELECT (auth):', selR.status, 'rows:', rows.length, rows.length ? 'our row returned' : 'no rows');
if (rows.length) {
  const ids = rows.map(r => r.id).filter(Boolean);
  const delR = await fetch(new URL('/rest/v1/achievements?id=in.' + ids.map(id => `(${id})`).join(','), base), {
    method: 'DELETE',
    headers: { apikey: key, Authorization: 'Bearer ' + accessToken },
  });
  console.log('achievement DELETE cleanup:', delR.status, delR.status === 200 ? 'removed' : (await delR.text()).slice(0, 200));
}

console.log('\n=== 6. Verify the token decodes to our user ===');
const payloadB64 = accessToken.split('.')[1];
if (payloadB64) {
  const pad = payloadB64.length % 4 ? '='.repeat(4 - (payloadB64.length % 4)) : '';
  const json = Buffer.from(payloadB64 + pad, 'base64').toString('utf8');
  const claims = JSON.parse(json);
  console.log('token sub:', claims.sub, '| user_metadata.user_id:', claims.user_metadata?.user_id, '| role:', claims.role, '| aud:', claims.aud);
}
