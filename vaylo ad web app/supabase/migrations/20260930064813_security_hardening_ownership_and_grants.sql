-- ============================================================================
-- SECURITY HARDENING: definer-grant hygiene, ownership foreign keys,
-- integrity constraints, and covering indexes.
-- ----------------------------------------------------------------------------
-- Baseline: security advisor run of 2026-09-30 against the live project plus a
-- static audit of all 63 migrations. Every state claim below was verified
-- against the LIVE database (row counts, pg_constraint, pg_index), not
-- inferred from migration files.
--
-- Sections:
--   1. Function privilege hygiene (advisor 0028 + targeted 0029 fixes)
--   2. Ownership foreign keys to auth.users (55 tables, after orphan cleanup)
--   3. Integrity constraints (ledger, balances, inventory, identity)
--   4. Covering indexes for the user_id lookups RLS policies force
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Function privilege hygiene
-- ---------------------------------------------------------------------------

-- 1a. guard_achievement_claims() is a TRIGGER function (20260928190000), not an
--     API. Trigger invocation does not consult EXECUTE, so this revoke changes
--     no behaviour — it only closes /rest/v1/rpc/guard_achievement_claims,
--     which the advisor flagged as an anon-executable SECURITY DEFINER
--     (lint 0028). Matches the treatment the other trigger helpers already got
--     in 20260927160000.
revoke all on function public.guard_achievement_claims() from public, anon, authenticated;

-- 1b. has_unlimited_credits(_user uuid) takes an arbitrary user id and answers
--     whether that user has unlimited credits — an entitlement bit about
--     somebody else. Its only callers are internal (credits_spend and the
--     ledger-spend wrapper); no client code invokes it. Closing it to clients
--     removes the one cross-user fact a signed-in athlete could currently pull.
--     Internal SECURITY DEFINER callers are unaffected by revokes.
revoke all on function public.has_unlimited_credits(uuid) from public, anon, authenticated;

-- 1c. The remaining advisor 0029 WARNs (authenticated-executable SECURITY
--     DEFINER functions: credits_spend, credits_grant, credits_claim_reward,
--     spend_coins, convert_credits_to_coins, purchase_avatar_item_coins,
--     purchase_cosmetic, equip/unequip_cosmetic, claim_event_pack,
--     redeem_referral, join/leave/update challenge RPCs, touch_streak,
--     cancel_my_subscription, get_my_entitlements, apply_credit_refill,
--     grant_unlimited_trial, find_user_by_friend_code, top_referrers,
--     sponsored_placements, record_brand_event, viewer_is_adult,
--     is_*_member, economy_value/credit_cost/starting_credits/coins_per_credit,
--     has_role, ai_call_allowed, record_fair_usage) were each re-checked
--     rather than blindly revoked. Every one of them derives the caller from
--     auth.uid() (never a client-supplied id), validates its inputs, and is
--     called by the shipped client (src/ grep verified) or internally by other
--     functions/policies. SECURITY DEFINER is required for each because the
--     operation must write tables whose write grants are closed to clients
--     (profiles balances, ledgers, inventory). Revoking them would break the
--     app; keeping them is the documented, intended design. No change.

-- ---------------------------------------------------------------------------
-- 2. Ownership foreign keys to auth.users(id)
-- ---------------------------------------------------------------------------
-- 55 tables carried a user_id column with no foreign key, so nothing guaranteed
-- ownership, and deleting an auth user left orphan rows behind forever.
--
-- Live orphan audit (2026-09-30): every table below had ZERO orphan rows
-- except subscriptions, whose 7 orphans are all default rows
-- (status='free', plan_type='free') written by handle_new_user for accounts
-- that were already deleted. They carry no entitlement and no money. They are
-- removed explicitly and documented here — not silently — before the FK with
-- ON DELETE CASCADE lands so the migration cannot fail on stale rows.
delete from public.subscriptions
 where user_id not in (select id from auth.users);

-- Three service-role-only telemetry ledgers are excluded: ai_call_events,
-- purchase_analytics, fair_usage_events. Keeping them FK-free preserves
-- their full history even if an auth user row is ever hard-deleted by an
-- operator; nothing in the client reads or writes them.
do $$
declare
  t text;
  tables text[] := array[
    'accountability_members','athlete_position','avatar_items','avatars',
    'basket_items','challenge_participants','coach_conversations',
    'coach_memories','coach_messages','coin_transactions','community_members',
    'community_pinned_avatars','community_posts','competition_sessions',
    'creator_profiles','cue_words','daily_action_logs','daily_actions',
    'equipment','event_pack_ownership','event_rivals','events',
    'friend_codes','friendships','hrv_baselines','injury_logs',
    'learning_progress','meal_logs','mental_checkins','mental_reviews',
    'notification_prefs','notifications','nutrition_plans','outcome_goals',
    'performance_logs','performance_metrics','plan_events','points_events',
    'privacy_settings','process_goals','referral_codes','streaks',
    'subscriptions','tactical_plans','team_members','training_loads',
    'user_purchases','user_region','user_segments','user_settings',
    'vpr_snapshots','water_logs','weekly_reviews'
  ];
begin
  foreach t in array tables loop
    begin
      execute format(
        'alter table public.%I add constraint %I_user_id_fkey
           foreign key (user_id) references auth.users(id) on delete cascade',
        t, t);
    exception
      when duplicate_object then null;  -- re-run of this migration
      when undefined_table  then null;  -- table absent in a partial environment
    end;
  end loop;
end $$;

-- friendships.friend_id is the second half of the pair and gets the same
-- ownership guarantee (cascade removes both sides when either account goes).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.friendships'::regclass
       and conname  = 'friendships_friend_id_fkey'
  ) then
    alter table public.friendships
      add constraint friendships_friend_id_fkey
      foreign key (friend_id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Integrity constraints (match existing product behaviour; live data had
--    zero violations of every rule added here on 2026-09-30)
-- ---------------------------------------------------------------------------

-- A ledger entry is a change; zero entries are noise (all writers insert
-- either a positive grant or a negative spend).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'credit_transactions_amount_nonzero') then
    alter table public.credit_transactions
      add constraint credit_transactions_amount_nonzero check (amount <> 0);
  end if;
end $$;

-- Balances can never go negative. writers clamp (credits_spend checks before
-- deducting); this makes it a database invariant, not a convention.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'credit_transactions_balance_nonneg') then
    alter table public.credit_transactions
      add constraint credit_transactions_balance_nonneg
      check (balance_after is null or balance_after >= 0);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'coin_transactions_amount_nonzero') then
    alter table public.coin_transactions
      add constraint coin_transactions_amount_nonzero check (amount <> 0);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_credits_nonneg') then
    alter table public.profiles
      add constraint profiles_credits_nonneg check (credits >= 0);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_coins_nonneg') then
    alter table public.profiles
      add constraint profiles_coins_nonneg check (coins >= 0);
  end if;
end $$;

-- Ownership ledger entries record what was actually paid (>= 0; 0 = free).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'event_pack_ownership_price_nonneg') then
    alter table public.event_pack_ownership
      add constraint event_pack_ownership_price_nonneg check (price_cents >= 0);
  end if;
end $$;

-- Identity invariants: you cannot be your own friend or your own referrer.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'friendships_not_self') then
    alter table public.friendships
      add constraint friendships_not_self check (user_id <> friend_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'referrals_not_self') then
    alter table public.referrals
      add constraint referrals_not_self check (referrer_id <> referee_id);
  end if;
end $$;

-- One claim per athlete per achievement (user_id, type, title). The client
-- writes milestone achievements on points thresholds; a retry or a
-- re-crossed threshold must not mint a second identical medal.
-- Live check before adding: zero duplicate groups existed.
create unique index if not exists achievements_user_claim_uq
  on public.achievements (user_id, type, title);

-- Already present, verified live and left untouched (listed for the record):
--   credit_transactions_idem_uniq  UNIQUE (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL
--   chest_claims                   UNIQUE (user_id, cycle_number)
--   referrals.referee_id           UNIQUE
--   referral_codes.code            UNIQUE
--   profiles.user_id               UNIQUE (+ pkey)
--   subscriptions.user_id          UNIQUE
--   challenge_participants         UNIQUE (challenge_id, user_id)
--   daily_action_logs              UNIQUE (action_id, log_date)
--   event_pack_ownership           UNIQUE (user_id, pack_id)
--   user_purchases                 UNIQUE (user_id, provider_reference) WHERE provider_reference IS NOT NULL
--   avatar_items                   PK covers (user_id, item_id) via unique constraint in 20260505 migration

-- ---------------------------------------------------------------------------
-- 4. Covering indexes for the user_id lookups every RLS policy performs
-- ---------------------------------------------------------------------------
-- RLS evaluates `user_id = auth.uid()` on each statement; without an index
-- each scan reads the whole table before the policy filters it. These 25
-- tables had a user_id column with NO index leading on it (live pg_index
-- check). One index each — no over-indexing: single-column b-trees are
-- enough for the per-user filters and small per-user sorts.
do $$
declare
  t text;
  tables text[] := array[
    'accountability_members','basket_items','challenge_participants',
    'coach_conversations','coach_memories','coach_messages','coin_transactions',
    'community_members','community_pinned_avatars','community_posts',
    'competition_sessions','cue_words','daily_actions','equipment',
    'event_rivals','injury_logs','meal_logs','mental_checkins',
    'mental_reviews','nutrition_plans','outcome_goals','process_goals',
    'tactical_plans','team_members','water_logs'
  ];
begin
  foreach t in array tables loop
    execute format(
      'create index if not exists idx_%I_user_id on public.%I (user_id)',
      t, t);
  end loop;
end $$;

-- coin_transactions history is read newest-first per user
-- (fetchCreditHistory/fetchCoinHistory order by created_at desc), so give the
-- sort a matching composite instead of the generic one above.
drop index if exists idx_coin_transactions_user_id;
create index if not exists idx_coin_transactions_user_created
  on public.coin_transactions (user_id, created_at desc);

notify pgrst, 'reload schema';
