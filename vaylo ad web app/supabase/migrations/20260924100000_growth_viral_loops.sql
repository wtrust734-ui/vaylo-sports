-- ============================================================================
-- Growth viral loops: challenge invites, referral leaderboard, free trial
-- ----------------------------------------------------------------------------
--  1. grant_unlimited_trial()  — one-tap 7-day Unlimited trial from the paywall.
--     One per user, ever. Rows with status='trial' + unlimited_credits=true flow
--     through get_my_entitlements() with zero client changes.
--  2. Public read policies for challenges / challenge_participants — the public
--     invite landing page must render for logged-out visitors.
--  3. join_challenge_by_id()   — logged-out athlete taps "Join" on the invite
--     page; after signup the client calls this to join without a second hop.
--     SECURITY DEFINER so a brand-new authed user (RLS self-policies) can still
--     bump participant_count. Re-joining is idempotent, not an error.
--  4. top_referrers()          — public monthly referral leaderboard rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Unlimited trial
-- ---------------------------------------------------------------------------
create or replace function public.grant_unlimited_trial(p_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_days integer := greatest(1, least(30, coalesce(p_days, 7)));
  v_trial_end timestamptz;
  v_status text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'auth_required');
  end if;

  select status into v_status from public.subscriptions where user_id = v_user;

  if v_status is not null and v_status <> 'free' then
    return jsonb_build_object('ok', false, 'error', 'already_subscribed');
  end if;

  if v_status = 'trial' then
    return jsonb_build_object('ok', false, 'error', 'trial_already_used');
  end if;

  v_trial_end := now() + make_interval(days => v_days);

  -- NOTE: subscriptions has no unique index on user_id, so ON CONFLICT is not
  -- available. Update-then-insert works whether or not a row already exists.
  update public.subscriptions
    set status = 'trial',
        plan_key = 'unlimited',
        plan_type = 'trial',
        trial_ends_at = v_trial_end,
        unlimited_credits = true,
        provider = 'trial',
        updated_at = now()
    where user_id = v_user;

  if not found then
    insert into public.subscriptions (user_id, status, plan_key, plan_type, trial_ends_at, unlimited_credits, provider)
    values (v_user, 'trial', 'unlimited', 'trial', v_trial_end, true, 'trial');
  end if;

  return jsonb_build_object('ok', true, 'trial_ends_at', v_trial_end, 'days', v_days);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Public read for challenges and participants (invite landing page)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'challenges' and policyname = 'challenges_public_read'
  ) then
    create policy challenges_public_read on public.challenges
      for select using (sponsor_brand_id is null);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'challenge_participants' and policyname = 'challenge_participants_public_read'
  ) then
    create policy challenge_participants_public_read on public.challenge_participants
      for select using (true);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Join a challenge (used right after signup from the invite page)
-- ---------------------------------------------------------------------------
create or replace function public.join_challenge_by_id(p_challenge uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_exists boolean;
  v_count integer;
begin
  if v_user is null then
    return jsonb_build_object('joined', false, 'reason', 'auth_required');
  end if;

  select exists(select 1 from public.challenges where id = p_challenge) into v_exists;
  if not v_exists then
    return jsonb_build_object('joined', false, 'reason', 'not_found');
  end if;

  if exists(select 1 from public.challenge_participants where challenge_id = p_challenge and user_id = v_user) then
    return jsonb_build_object('joined', true, 'already', true);
  end if;

  insert into public.challenge_participants (challenge_id, user_id, progress, status, joined_at)
  values (p_challenge, v_user, 0, 'active', now());

  update public.challenges
    set participant_count = coalesce(participant_count, 0) + 1
    where id = p_challenge
    returning participant_count into v_count;

  return jsonb_build_object('joined', true, 'already', false, 'participant_count', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Referral leaderboard (public, rolling window)
-- ---------------------------------------------------------------------------
create or replace function public.top_referrers(p_days integer default 30)
returns table (
  rank bigint,
  referrer_id uuid,
  display_name text,
  referral_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    row_number() over (order by count(r.id) desc, min(r.created_at) asc)::bigint as rank,
    r.referrer_id,
    coalesce(a.display_name, 'Athlete') as display_name,
    count(r.id)::bigint as referral_count
  from public.referrals r
  left join public.avatars a on a.user_id = r.referrer_id
  where r.created_at >= now() - make_interval(days => greatest(1, least(365, coalesce(p_days, 30))))
    and r.status in ('pending', 'granted')
  group by r.referrer_id, a.display_name
  order by referral_count desc, min(r.created_at) asc
  limit 25;
$$;

grant execute on function public.top_referrers(integer) to anon, authenticated;
grant execute on function public.grant_unlimited_trial(integer) to authenticated;
grant execute on function public.join_challenge_by_id(uuid) to authenticated;
