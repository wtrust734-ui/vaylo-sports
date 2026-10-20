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

const tables = [
  'friend_requests',
  'friendships',
  'direct_messages',
  'user_blocks',
  'notification_prefs',
  'notifications',
  'mental_checkins',
  'mental_reviews',
  'meal_logs',
  'water_logs',
  'health_samples',
  'health_workouts',
  'health_connections',
  'health_sync_state',
  'injury_logs',
  'performance_logs',
  'training_loads',
  'daily_actions',
  'daily_action_logs',
  'xp_transactions',
  'points_events',
  'plan_events',
  'event_trophy_events',
  'competition_sessions',
  'streaks',
  'streak_activity_days',
  'streak_milestone_wins',
  'user_earned_grants',
  'user_consumables',
  'reward_box_claims',
  'chest_claims',
  'referrals',
  'referral_codes',
  'referral_clicks',
  'user_purchases',
  'basket_items',
  'generated_content',
];

for (const table of tables) {
  let ourRows, crossRows, anonRows, ourStatus, crossStatus, anonStatus;
  try {
    const ourR = await fetch(new URL('/rest/v1/' + table + '?user_id=eq.' + uid + '&limit=1', base), { headers: auH });
    ourStatus = ourR.status; ourRows = JSON.parse(await ourR.text());
  } catch { ourStatus = -1; ourRows = null; }
  try {
    const crossR = await fetch(new URL('/rest/v1/' + table + '?user_id=eq.' + otherUid + '&limit=1', base), { headers: auH });
    crossStatus = crossR.status; crossRows = JSON.parse(await crossR.text());
  } catch { crossStatus = -1; crossRows = null; }
  try {
    const anonR = await fetch(new URL('/rest/v1/' + table + '?limit=1', base), { headers: aH });
    anonStatus = anonR.status; anonRows = JSON.parse(await anonR.text());
  } catch { anonStatus = -1; anonRows = null; }

  const ourCount = Array.isArray(ourRows) ? ourRows.length : '?';
  const crossCount = Array.isArray(crossRows) ? crossRows.length : '?';
  const anonCount = Array.isArray(anonRows) ? anonRows.length : '?';
  const crossLeak = crossStatus === 200 && crossCount > 0;
  const anonLeak = anonStatus === 200 && anonCount > 0;
  console.log(
    table.padEnd(28),
    '| auth our=' + ourCount, '(' + ourStatus + ')',
    '| auth other=' + crossCount, '(' + crossStatus + ')', crossLeak ? 'CROSS-LEAK' : '',
    '| anon=' + anonCount, '(' + anonStatus + ')', anonLeak ? 'ANON-LEAK' : ''
  );
}
