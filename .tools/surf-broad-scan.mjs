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

// Shared/public config tables that are intentionally readable by anon and by any auth user.
// These are NOT user-scoped data; flagging them as anon-visible is expected, not a leak.
const SHARED_CONFIG_TABLES = new Set([
  'pricing_tiers',
  'country_pricing_map',
  'economy_config',
  'marketplace_config',
  'reward_definitions',
  'reward_config',
  'special_offers',
  'subscription_plans',
  'avatar_catalog',
  'event_packs',
  'event_trophy_events',
  'challenges',
  'coach_credit_packs',
  'cosmetic_bundle_items',
  'cosmetic_bundles',
  'user_profile_cosmetics',
]);

async function probe(table, where, value, headers) {
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

const tables = [
  'account_deletion_events','accountability_groups','accountability_members','achievements','activity_hypes',
  'ad_assets','ad_brand_settings','ad_campaigns','ad_chat_messages','ad_chat_sessions','ad_competitors',
  'ad_concepts','ad_engine_budget','ad_engine_calendar','ad_engine_jobs','ad_engine_spawns','ad_exports',
  'ad_image_artifacts','ad_image_concepts','ad_image_jobs','ad_image_projects','ad_library_items','ad_render_jobs',
  'ad_research_analyses','ad_research_findings','ad_research_opportunities','ad_research_projects',
  'ad_video_concepts','ad_video_render_jobs','ad_video_shots','ai_call_events','app_error_reports',
  'athlete_position','avatar_catalog','avatar_items','avatars','basket_items','brand_metrics','brand_placements',
  'brands','challenge_participants','challenges','chest_claims','coach_applications','coach_bookings',
  'coach_conversations','coach_credit_entries','coach_credit_packs','coach_credit_wallet','coach_deliveries',
  'coach_earnings','coach_memories','coach_messages','coach_orders','coach_roster','coin_transactions',
  'communities','community_members','community_pinned_avatars','community_posts','competition_sessions',
  'content_reports','cosmetic_bundle_items','cosmetic_bundles','country_pricing_map','creator_profiles',
  'credit_transactions','credit_transfer_auth','credit_transfers','cue_words','daily_action_logs','daily_actions',
  'direct_messages','economy_config','equipment','event_pack_ownership','event_packs','event_rivals',
  'event_trophy_events','events','fair_usage_events','feed_visible_activities','friend_codes','friend_requests',
  'friendships','guardian_invites','guardian_links','health_connection_tokens','health_connections','health_samples',
  'health_sync_state','health_workouts','hrv_baselines','injury_logs','leaderboard_totals','learning_feedback',
  'learning_progress','life_events','marketplace_config','marketplace_listings','meal_logs','mental_checkins',
  'mental_reviews','notification_prefs','notifications','nutrition_plans','outcome_goals','performance_logs',
  'performance_metrics','pipeline_chat','pipeline_jobs','plan_events','points_events','pricing_tiers',
  'privacy_settings','private_secrets','process_goals','profiles','purchase_analytics','push_tokens',
  'recovery_logs','referral_admin_audit','referral_clicks','referral_codes','referral_commission_config',
  'referral_commission_events','referral_commissions','referral_payouts','referral_qualifications','referrals',
  'reward_box_claims','reward_config','reward_definitions','shared_activities','special_offers','sponsor_enquiries',
  'streak_activity_days','streak_milestone_wins','streaks','subscription_plans','subscriptions','support_requests',
  'tactical_plans','team_assignments','team_members','teams','training_loads','training_plans','user_blocks',
  'user_consumables','user_earned_grants','user_profile_cosmetics','user_purchases','user_region','user_rewards',
  'user_roles','user_segments','user_session_coin_grants','user_settings','video_analysis_quota_reservations',
  'video_analysis_request_claims','video_form_analyses','vpr_snapshots','waitlist_campaign_sends',
  'waitlist_campaigns','waitlist_signups','water_logs','wearable_auth_states','weekly_reviews','workout_imports',
  'workouts','xp_level_config','xp_levels','xp_reward_rules','xp_transactions',
];

let suspicious = 0;
let checked = 0;
for (const table of tables) {
  checked++;
  const SHARED = SHARED_CONFIG_TABLES.has(table);
  const ours   = await probe(table, 'user_id', uid, auH);
  const others = await probe(table, 'user_id', otherUid, auH);
  const anon   = await probe(table, null, null, aH);

  let crossLeak = false;
  let anonLeak = false;

  if (others.status === 200 && typeof others.count === 'number' && others.count > 0) {
    crossLeak = true;
  }
  if (anon.status === 200 && typeof anon.count === 'number' && anon.count > 0) {
    anonLeak = true;
  }
  // Shared config tables are intentionally anon-readable; don't flag them.
  if (SHARED && anonLeak && !crossLeak) {
    anonLeak = false;
  }

  if (crossLeak || anonLeak) {
    console.log(
      table.padEnd(30),
      '| AUTH us=' + ours.count + ' (' + ours.status + ')',
      '| AUTH other=' + others.count + ' (' + others.status + ')',
      '| ANON=' + anon.count + ' (' + anon.status + ')',
      (crossLeak ? 'CROSS-LEAK' : '') + (anonLeak && crossLeak ? ' +ANON-LEAK' : (anonLeak ? ' ANON-LEAK' : '')),
    );
    suspicious++;
  }
}
console.log('checked:', checked, 'tables');
console.log('real data leaks (cross-user or anon user data visible):', suspicious);
