-- Least privilege on the public RPC surface, and a trial that actually ends.
--
-- Two findings from the security audit, both invisible from the app.
--
-- (1) Twenty-four functions in `public` were executable by `anon`. Every one
--     carried the default PUBLIC grant (`=X/postgres`) that `create function`
--     applies and that nothing had revoked. Most are guarded by `auth.uid()`,
--     so an unauthenticated caller gets an exception rather than data — but
--     `is_group_member` / `is_community_member` / `is_team_member` take an
--     arbitrary user id and answer questions about *other* people, and
--     `has_role(_user_id, _role)` is a straight admin-membership oracle for any
--     uuid. `top_referrers` is the only one that genuinely serves anonymous
--     traffic (the public /referral-leaderboard route), so it keeps an explicit
--     grant and everything else loses the default.
--
-- (2) The 7-day Unlimited trial never expired. `grant_unlimited_trial` wrote
--     `trial_ends_at` and no object in the schema ever read it; it also never
--     set `expires_at`, so the generic expiry path in get_my_entitlements()
--     (which only inspects `active` rows) could not catch it either. The client
--     treats `status = 'trial'` as live, so one tap bought unlimited credits
--     permanently. The same function's `trial_already_used` branch was
--     unreachable — the preceding `status <> 'free'` check returned first — so
--     the one-trial-per-account guarantee its comment advertised was not
--     enforced at all.

-- ---------------------------------------------------------------------------
-- (1) Least privilege
-- ---------------------------------------------------------------------------

-- Trigger helpers. Trigger invocation does not consult EXECUTE, so no role
-- needs a grant on these — they were only ever reachable by accident.
revoke all on function public.block_self_hype() from public, anon, authenticated;
revoke all on function public.handle_community_created() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.sync_challenge_participant_count() from public, anon, authenticated;
revoke all on function public.sync_community_member_count() from public, anon, authenticated;
revoke all on function public.tg_health_connections_touch() from public, anon, authenticated;
revoke all on function public.update_updated_at_column() from public, anon, authenticated;

-- Signed-in only: these move credit/coin balances, mutate shared state, or
-- report on a user other than the caller. `authenticated` keeps its explicit
-- grant (verified present on all of them), so app behaviour is unchanged.
revoke all on function public.award_activity_points() from public, anon;
revoke all on function public.award_points(integer, text, text) from public, anon;
revoke all on function public.grant_unlimited_trial(integer) from public, anon;
revoke all on function public.join_challenge(uuid) from public, anon;
revoke all on function public.join_challenge_by_id(uuid) from public, anon;
revoke all on function public.leave_challenge(uuid) from public, anon;
revoke all on function public.update_challenge_progress(uuid, numeric) from public, anon;
revoke all on function public.purchase_avatar_item_coins(text, text, text, integer) from public, anon;
revoke all on function public.purchase_cosmetic(text) from public, anon;
revoke all on function public.spend_coins(integer, text) from public, anon;
revoke all on function public.spend_credits(integer, text) from public, anon;
revoke all on function public.is_community_member(uuid, uuid) from public, anon;
revoke all on function public.is_group_member(uuid, uuid) from public, anon;
revoke all on function public.is_team_member(uuid, uuid) from public, anon;
revoke all on function public.coins_per_credit() from public, anon;
revoke all on function public.is_adult_birthdate(date) from public, anon;

-- `has_role` needs EXECUTE from whoever evaluates a policy that calls it, and
-- two admin policies were scoped to `public` — which is what forced the oracle
-- open. They are admin-write policies on a table that also has a public read
-- policy, so narrowing them to `authenticated` (what they always meant) lets
-- the grant go without affecting anonymous reads.
alter policy "reward_config_admin_write" on public.reward_config to authenticated;
alter policy "reward_definitions_admin_write" on public.reward_definitions to authenticated;
revoke all on function public.has_role(uuid, public.app_role) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;

-- The one endpoint that a signed-out visitor legitimately calls.
revoke all on function public.top_referrers(integer) from public;
grant execute on function public.top_referrers(integer) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (2) Trial lifecycle
-- ---------------------------------------------------------------------------

-- An `active` row keeps saying `active` after `expires_at` passes (nothing
-- rewrites it on expiry — get_my_entitlements() only derives 'expired' at read
-- time), and `unlimited_credits` is never cleared when a plan lapses. Both
-- have to be checked here. 'trialing'/'renewing' are kept from the original
-- definition for compatibility even though nothing writes them.
create or replace function public.has_unlimited_credits(_user uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = _user
      and coalesce(s.unlimited_credits, false) = true
      and (
        s.is_lifetime
        or (
          s.status in ('active', 'trialing', 'renewing', 'lifetime')
          and (s.expires_at is null or s.expires_at > now())
        )
        or (
          s.status = 'trial'
          and s.trial_ends_at is not null
          and s.trial_ends_at > now()
        )
      )
  )
$function$;

-- The read the app actually shows. Deriving 'expired' for a lapsed trial is
-- what turns the client's `isActive` off: it accepts `status === 'trial'`.
create or replace function public.get_my_entitlements()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_sub public.subscriptions%rowtype;
  v_credits integer;
begin
  if v_user is null then return jsonb_build_object('plan_key','free'); end if;
  select * into v_sub from public.subscriptions where user_id = v_user;
  select credits into v_credits from public.profiles where user_id = v_user;

  if v_sub.id is null then
    return jsonb_build_object('plan_key','free','status','free','credits',coalesce(v_credits,0),
      'unlimited_credits',false,'monthly_credit_allowance',0,'is_lifetime',false);
  end if;

  if v_sub.status = 'active' and not v_sub.is_lifetime
     and v_sub.expires_at is not null and v_sub.expires_at < now() then
    v_sub.status := 'expired';
  end if;

  -- A trial ends at trial_ends_at. Without this the row stays 'trial' forever
  -- and the client keeps reporting Unlimited.
  if v_sub.status in ('trial', 'trialing') and not v_sub.is_lifetime
     and v_sub.trial_ends_at is not null and v_sub.trial_ends_at < now() then
    v_sub.status := 'expired';
  end if;

  return jsonb_build_object(
    'plan_key', case when v_sub.status in ('active','trial') or v_sub.is_lifetime then v_sub.plan_key else 'free' end,
    'status', v_sub.status,
    'billing_period', v_sub.billing_period,
    'product_id', v_sub.product_id,
    'credits', coalesce(v_credits,0),
    'unlimited_credits', (v_sub.unlimited_credits and (v_sub.status in ('active','trial') or v_sub.is_lifetime)),
    'monthly_credit_allowance', case when v_sub.status in ('active','trial') or v_sub.is_lifetime then v_sub.monthly_credit_allowance else 0 end,
    'credit_rollover_limit', v_sub.credit_rollover_limit,
    'is_lifetime', v_sub.is_lifetime,
    'cancel_at_period_end', v_sub.cancel_at_period_end,
    'renews_at', v_sub.renews_at,
    'expires_at', v_sub.expires_at,
    'next_refill_at', v_sub.next_refill_at,
    'legacy_plan_type', v_sub.plan_type
  );
end;
$function$;

-- `default 7` must be restated: CREATE OR REPLACE cannot remove a parameter
-- default that the existing function already declares (SQLSTATE 42P13).
create or replace function public.grant_unlimited_trial(p_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_days integer := greatest(1, least(30, coalesce(p_days, 7)));
  v_trial_end timestamptz;
  v_sub public.subscriptions%rowtype;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'auth_required');
  end if;

  select * into v_sub from public.subscriptions where user_id = v_user;

  -- One trial per account, decided by whether a trial was ever started rather
  -- than by the current status. The previous version tested `status = 'trial'`
  -- *after* rejecting every non-'free' status, so that branch never ran and a
  -- user whose row had been reset to 'free' could take the trial again.
  if v_sub.trial_ends_at is not null then
    return jsonb_build_object('ok', false, 'error', 'trial_already_used');
  end if;

  if v_sub.status is not null and v_sub.status <> 'free' then
    return jsonb_build_object('ok', false, 'error', 'already_subscribed');
  end if;

  v_trial_end := now() + make_interval(days => v_days);

  -- `expires_at` is set alongside `trial_ends_at`: it is the field every other
  -- consumer already understands (has_unlimited_credits, get_my_entitlements,
  -- and the edge-function entitlement check), so the trial now has one
  -- unambiguous end date instead of a field nobody reads.
  update public.subscriptions
    set status = 'trial',
        plan_key = 'unlimited',
        plan_type = 'trial',
        trial_ends_at = v_trial_end,
        expires_at = v_trial_end,
        unlimited_credits = true,
        provider = 'trial',
        updated_at = now()
    where user_id = v_user;

  if not found then
    insert into public.subscriptions
      (user_id, status, plan_key, plan_type, trial_ends_at, expires_at, unlimited_credits, provider)
    values (v_user, 'trial', 'unlimited', 'trial', v_trial_end, v_trial_end, true, 'trial');
  end if;

  return jsonb_build_object('ok', true, 'trial_ends_at', v_trial_end, 'days', v_days);
end;
$function$;

-- Cancelling used to set status = 'cancelled' immediately, which made
-- has_unlimited_credits() return false and revoked the remainder of a period
-- the user had already paid for — while the function still reported
-- `access_until: expires_at`. Access now runs to the end of the paid period and
-- `cancel_at_period_end` is what tells the client it will not renew.
create or replace function public.cancel_my_subscription()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_sub public.subscriptions%rowtype;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select * into v_sub from public.subscriptions where user_id = v_user for update;
  if v_sub.id is null then raise exception 'No subscription'; end if;
  if v_sub.is_lifetime then raise exception 'Lifetime ownership cannot be cancelled'; end if;

  -- Nothing paid-for left to honour (no period end on record), so revoke now.
  if v_sub.expires_at is null or v_sub.expires_at <= now() then
    update public.subscriptions
      set cancel_at_period_end = true, cancelled_at = now(),
          status = 'cancelled', updated_at = now()
      where user_id = v_user;
    return jsonb_build_object('ok', true, 'access_until', null);
  end if;

  update public.subscriptions
    set cancel_at_period_end = true,
        cancelled_at = now(),
        -- A trial stays a trial, so its own end date keeps governing access.
        status = case when v_sub.status = 'trial' then 'trial' else 'active' end,
        updated_at = now()
    where user_id = v_user;

  return jsonb_build_object('ok', true, 'access_until', v_sub.expires_at,
    'cancel_at_period_end', true);
end;
$function$;

-- These three are all called from the client while signed in.
revoke all on function public.has_unlimited_credits(uuid) from public, anon;
grant execute on function public.has_unlimited_credits(uuid) to authenticated, service_role;
revoke all on function public.get_my_entitlements() from public, anon;
grant execute on function public.get_my_entitlements() to authenticated, service_role;
revoke all on function public.cancel_my_subscription() from public, anon;
grant execute on function public.cancel_my_subscription() to authenticated, service_role;
