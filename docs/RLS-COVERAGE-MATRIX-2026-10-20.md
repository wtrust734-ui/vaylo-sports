# RLS Coverage Verification — MDF-002 (2026-10-20)

**Scope:** every table in `public` of the live Supabase project
(`vvwhausdjzdmsyxekrcl`), verified against the **live database**
(`pg_class.relrowsecurity`, `pg_policies`, `information_schema.role_table_grants`)
and cross-checked against the migrations — not inferred from files alone.

## Result summary

| Check (live DB, post-fix) | Before | After |
|---|---|---|
| Tables in `public` schema | 187 | 187 |
| Tables with RLS **disabled** | 4 | **0** |
| Permissive `USING (true)` SELECT policies contradicting their migration's deny-all design | 2 | **0** |
| Public (anon) readable over-permissive `true` reads on `ad_engine_*` | 4 tables | **0** (gated to `auth.uid() is not null`) |
| Supabase security advisor lints added by this pass | — | none (remaining lints pre-existing, see §5) |

## 1. How this was verified

1. **Table + RLS state** straight from Postgres catalogs — `relrowsecurity`,
   `relforcerowsecurity` for every `public` table.
2. **Every policy** from `pg_policies` (name, cmd, roles, permissive flag, exact
   qual/with_check), flagged for `true`-like permissive conditions.
3. **Grants** from `information_schema.role_table_grants` for
   `anon` / `authenticated` / `public` / `service_role` — because a permissive
   policy without a grant is inert, and a grant without a policy is RLS-denied.
4. **Structural diff** — RLS-enabled tables with zero policies (deny-all by
   design, verified); granted DML with no matching policy (verified each is
   either covered by an `ALL` policy or an intentional deny).
5. **Cross-check** against the migrations as source of truth, which exposed
   live-only drift (policies on the DB that exist in no migration file).

## 2. Coverage matrix (grouped by classification)

### A. User-owned personal data (RLS enabled, self-scoped policies)
All `auth.uid()`-scoped; writes only on own rows; no `true` quals:

profiles, privacy_settings, user_settings, athlete_position, avatars
(self-read; public cosmetic read), avatar_items, user_profile_cosmetics
(owner + public cosmetic read), achievements, daily_actions, daily_action_logs
(+ partner view), water_logs, meal_logs, recovery_logs, training_loads,
performance_logs, performance_metrics, workouts, workout_imports,
training_plans, nutrition_plans, mental_checkins, mental_reviews, cue_words,
equipment, competition_sessions, tactical_plans, events, event_rivals,
injury_logs, hrv_baselines, life_events, plan_events, health_connections,
health_samples, health_workouts, health_sync_state, learning_progress,
learning_feedback, process_goals, outcome_goals, vpr_snapshots,
video_form_analyses, weekly_reviews, notifications, notification_prefs,
push_tokens, friend_codes, friend_requests, friendships, user_blocks,
activity_hypes, shared_activities, basket_items, user_purchases (read-only own),
purchase_analytics, coin_transactions (read-only own), credit_transactions
(read-only own), credit_transfers, credit_transfer_auth, xp_transactions,
points_events (read-only own), streaks, streak_activity_days,
streak_milestone_wins, fair_usage_events, subscriptions (read-only own),
direct_messages, coach_conversations, coach_messages, coach_memories,
coach_bookings, coach_orders, coach_deliveries, coach_credit_wallet,
coach_credit_entries, coach_earnings, coach_applications, marketplace_listings,
creator_profiles, user_region, user_segments (own + admin read), referrals,
referral_codes, referral_commissions / referral_payouts (read-only own),
content_reports, guardian_invites, guardian_links, chest_claims,
user_consumables, user_earned_grants, user_rewards, user_session_coin_grants.

### B. Shared/social (RLS enabled, deliberately community-scoped reads)
accountability_groups/members, teams, team_members, team_assignments,
communities, community_members, community_posts, community_pinned_avatars,
challenges, challenge_participants (public read is participant status only).

### C. Public reference/catalog (RLS enabled, public SELECT is the design)
avatar_catalog, cosmetic_bundles, cosmetic_bundle_items, country_pricing_map,
event_packs, event_trophy_events, pricing_tiers, reward_config,
reward_definitions, economy_config (active rows only, admin writes),
special_offers (windowed read), subscription_plans (active rows only),
marketplace_config, coach_credit_packs, referral_commission_config.

### D. Admin/service-only (RLS enabled; clients denied or admin-gated)
`closed_service_role_only` ALL policies: brands, brand_placements,
brand_metrics, ai_call_events. Deny-all policies: support_requests,
sponsor_enquiries, waitlist_campaigns, waitlist_campaign_sends,
waitlist_signups, app_error_reports (admin read/update via
`public.has_role(auth.uid(), 'admin')`), account_deletion_events (admin read),
referral_admin functions gate every admin path via
`_referral_admin_assert` → `has_role`.

### E. Deny-all with RLS enabled and no policies (intentional; service role bypasses)
health_connection_tokens, referral_admin_audit, referral_clicks,
referral_qualifications, reward_box_claims, video_analysis_quota_reservations,
video_analysis_request_claims, wearable_auth_states — **and, after this
pass:** private_secrets, xp_levels, xp_level_config, xp_reward_rules.

### F. Operator ad-pipeline (RLS enabled, reads gated to signed-in users)
ad_engine_budget / calendar / jobs / spawns — single SELECT policy
`to authenticated using (auth.uid() is not null)` (restored to the
20261018200000 intent); all client DML privileges revoked (runner-only writes
via service role). The ad_* studio tables (ad_assets … ad_video_shots) use
owner-scoped `ALL` + `authenticated` policies.

**Views / functions (out of table scope, recorded):** `coach_roster` and
`leaderboard_totals` are SECURITY DEFINER views (advisor ERROR);
`has_role`/`profile`-style SECURITY DEFINER RPCs are executable by clients —
all are pre-existing design decisions, listed in §5 with recommendations.

## 3. Gaps found and fixed (migration
`20261020100000_rls_coverage_hardening.sql`, applied to the live DB)

| # | Gap | Risk | Fix |
|---|---|---|---|
| 1 | `private_secrets` RLS disabled — holds the content-report escalation secret | One stray `grant` from full exposure | Enable RLS, no policies (deny-all for clients; service_role bypasses) |
| 2 | `xp_levels`, `xp_level_config`, `xp_reward_rules` RLS disabled | Same class | Enable RLS, no policies — identical to their migration's revoke-only intent |
| 3 | `support_requests` live-only policy `"Support requests readable"` `USING (true)` for `authenticated` — would expose every ticket incl. emails, bodies, `ip_hash`, child-safety flags the moment SELECT was re-granted | Drift contradicting the explicit deny-all migration | Policy dropped |
| 4 | `referral_commission_events` live-only policy `"Referral commission events readable"` `USING (true)` — cross-user commission ledger; migration says "No policies" | Drift | Policy dropped |
| 5 | `ad_engine_*` (4 tables): live policies drifted from `auth.uid() is not null` to `true` **plus** duplicate permissive policies — anon + every athlete could read the operator's campaign calendar, job payloads and budget ledger | Active exposure (anon had SELECT grant) | Drift policies dropped; single policy per table recreated exactly per migration intent; anon SELECT + all client write grants revoked |
| 6 | `account_deletion_events`: client INSERT/UPDATE/DELETE grants existed though RLS denies them | Least-privilege hygiene | Unused client DML grants revoked |

Not fixed by design (verified intentional): the 8 pre-existing deny-all tables
(§E), the owner-scoped `ad_*` studio tables, and the granted-but-RLS-denied DML
on tables whose app flows route writes through SECURITY DEFINER RPCs
(e.g. `profiles` deletes via delete-account flow, `points_events` immutability).

## 4. Verification test plan

Run per table row of the matrix above, using two **isolated test accounts** (A
and B) plus a signed-out anon client. Repeatably scripted via Supabase MCP by
re-running these catalog queries — no row data is ever read in tests:

1. **RLS enabled everywhere:** query
   `pg_class.relrowsecurity` — **pass** = 0 tables with RLS off (verified:
   `tables_without_rls = 0` post-fix).
2. **Cross-user read isolation:** for each account in §A, read table `T` as
   user B after creating rows as user A — **pass** = B sees only her rows /
   nothing, fail = any A-row returned.
3. **Cross-user write isolation:** as B, `update`/`delete` an A-owned row in
   each writable §A table — **pass** = 0 or 406/RLS error, fail = row mutated.
4. **anon lockdown:** anon client queries every §D/§E table and
   `ad_engine_*` — **pass** = empty/401 (RLS applies even to `to public`
   policies whose qual gates on `auth.uid()`).
5. **Service paths:** exercise edge functions that write §D/§E tables
   (delete-account, support-request, ad-engine tick) — **pass** = unchanged
   behavior (function status + rows via service role queries).
6. **Drift watch:** re-run the `pg_policies` inventory and diff against
   migrations monthly (the drift in §3 existed only on the live DB).

## 5. Known pre-existing items (out of MDF-002 table scope, flagged)

- **Advisor ERROR** — `coach_roster` and `leaderboard_totals` are
  SECURITY DEFINER views (they expose the creator's permissions, not the
  viewer's). `leaderboard_totals` is an accepted leaderboard aggregate;
  recommend re-pointing them to `security_invoker` views or RPCs in a
  follow-up.
- **Advisor WARN** — 17 SECURITY DEFINER functions reachable by `anon` and 86
  by `authenticated` (RPC surface). All authenticated-reachable ones are
  `auth.uid()`-scoped inside; the anon ones (`top_referrers`,
  `referral_click_record`, etc.) are intentionally public leaderboard/telemetry
  helpers. Spot-checked none mutates foreign users' data.
- **Advisor INFO** — "RLS enabled, no policy" on the 13 deny-all tables is the
  expected deliberate posture.
- Passwords: leaked-password protection is off in Auth settings (config, not
  SQL) — separate follow-up.
