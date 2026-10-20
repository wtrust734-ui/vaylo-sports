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
const otherUid = '00000000-0000-0000-0000-000000000001';
const aH = { apikey: key };
const auH = { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + tok };

async function tryCount(table, where, value, headers) {
  try {
    const url = value
      ? new URL('/rest/v1/' + table + '?' + where + '=eq.' + value + '&limit=1', base)
      : new URL('/rest/v1/' + table + '?limit=1', base);
    const r = await fetch(url, { headers });
    const body = await r.text();
    const d = JSON.parse(body);
    return { status: r.status, count: Array.isArray(d) ? d.length : 'non-array' };
  } catch (e) {
    return { status: -1, count: '?' };
  }
}

const probes = [
  { table: 'teams',               by: 'owner_id', value: uid },
  { table: 'team_members',        by: null,       value: null },
  { table: 'team_assignments',    by: null,       value: null },
  { table: 'communities',         by: 'owner_id', value: uid },
  { table: 'community_members',   by: null,       value: null },
  { table: 'community_posts',     by: null,       value: null },
  { table: 'user_segments',       by: null,       value: null },
  { table: 'user_roles',          by: 'user_id',  value: uid },
  { table: 'user_region',         by: 'user_id',  value: uid },
  { table: 'pricing_tiers',       by: null,       value: null },
  { table: 'country_pricing_map', by: null,       value: null },
  { table: 'economy_config',      by: null,       value: null },
  { table: 'marketplace_config',  by: null,       value: null },
  { table: 'generated_content',   by: 'user_id',  value: uid },
  { table: 'ad_campaigns',        by: 'owner_id', value: uid },
  { table: 'ad_concepts',         by: 'owner_id', value: uid },
  { table: 'ad_assets',           by: 'owner_id', value: uid },
  { table: 'ad_render_jobs',      by: 'owner_id', value: uid },
  { table: 'ad_library_items',    by: 'owner_id', value: uid },
  { table: 'ad_brand_settings',   by: 'owner_id', value: uid },
  { table: 'ad_chat_sessions',    by: 'owner_id', value: uid },
  { table: 'ad_chat_messages',    by: 'owner_id', value: uid },
  { table: 'ad_competitors',      by: 'owner_id', value: uid },
  { table: 'ad_video_concepts',   by: 'owner_id', value: uid },
  { table: 'ad_video_render_jobs',by: 'owner_id', value: uid },
  { table: 'ad_video_shots',      by: 'owner_id', value: uid },
  { table: 'ad_image_concepts',   by: 'owner_id', value: uid },
  { table: 'ad_image_jobs',       by: 'owner_id', value: uid },
  { table: 'ad_image_projects',   by: 'owner_id', value: uid },
  { table: 'ad_image_artifacts',  by: 'owner_id', value: uid },
  { table: 'ad_exports',          by: 'owner_id', value: uid },
  { table: 'ad_research_projects',by: 'owner_id', value: uid },
  { table: 'ad_research_analyses',by: 'owner_id', value: uid },
  { table: 'ad_research_findings',by: 'owner_id', value: uid },
  { table: 'ad_research_opportunities', by: 'owner_id', value: uid },
  { table: 'ai_call_events',      by: 'user_id',  value: uid },
  { table: 'app_error_reports',   by: 'user_id',  value: uid },
  { table: 'event_pack_ownership',by: 'user_id',  value: uid },
  { table: 'waitlist_signups',    by: 'user_id',  value: uid },
  { table: 'waitlist_campaigns',  by: null,       value: null },
  { table: 'waitlist_campaign_sends', by: null,   value: null },
  { table: 'purchase_analytics',  by: 'user_id',  value: uid },
  { table: 'credit_transactions', by: 'user_id',  value: uid },
  { table: 'coin_transactions',   by: 'user_id',  value: uid },
  { table: 'reward_definitions',  by: null,       value: null },
  { table: 'reward_config',       by: null,       value: null },
  { table: 'reward_box_claims',   by: 'user_id',  value: uid },
  { table: 'chest_claims',        by: 'user_id',  value: uid },
];

let flagged = 0;
for (const p of probes) {
  const ours   = await tryCount(p.table, p.by, p.value, auH);
  const others = await tryCount(p.table, p.by, otherUid, auH);
  const anon   = await tryCount(p.table, null, null, aH);

  let anonLeak = (() => {
    if (anon.status !== 200) return false;
    if (typeof anon.count !== 'number') return false;
    return anon.count > 0;
  })();
  let crossLeak = (() => {
    if (others.status !== 200) return false;
    if (typeof others.count !== 'number') return false;
    return others.count > 0;
  })();
  if (['pricing_tiers','country_pricing_map','economy_config','marketplace_config','reward_definitions','reward_config'].indexOf(p.table) !== -1) { anonLeak = false; crossLeak = false; }
  if (crossLeak || anonLeak) {
    console.log(
      p.table.padEnd(30),
      '| AUTH us=' + ours.count + ' (' + ours.status + ')',
      '| AUTH other=' + others.count + ' (' + others.status + ')',
      '| ANON=' + anon.count + ' (' + anon.status + ')',
      (crossLeak ? 'CROSS-LEAK' : '') + (anonLeak ? (' ' + 'ANON-LEAK') : ''),
    );
    flagged++;
  }
}
console.log('tables with data visible to wrong user or anon:', flagged);
